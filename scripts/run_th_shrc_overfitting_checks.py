#!/usr/bin/env python3
"""Run stability, leakage, permutation, and cattle-bootstrap checks."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

from verify_scientific_results import Verification, verify_data
from experiment_common import (
    BRANCHES,
    FIVE_PATH,
    INPUT_PATH,
    MULTISEED_DIR,
    SEEDS,
    SIGNATURE_COLUMNS,
    TRACE_PATH,
    load_config,
    metrics,
    rowwise_seed_ensemble,
    sha256,
)


DEFAULT_OUTPUT = MULTISEED_DIR.parent / "analysis" / "overfitting_checks"
PERMUTATIONS = 10_000
BOOTSTRAPS = 5_000
GUARD_PATTERN = re.compile(
    r"bounded meta-fusion predictions in fold (\d+): (\d+)/(\d+)"
)


def run(output: Path = DEFAULT_OUTPUT) -> dict[str, object]:
    config = load_config()
    model_input = pd.read_csv(INPUT_PATH)
    trace = pd.read_csv(TRACE_PATH)
    five = pd.read_csv(FIVE_PATH)
    ensemble = pd.read_csv(MULTISEED_DIR / "ensemble_oof_predictions.csv")
    long = pd.read_csv(MULTISEED_DIR / "oof_predictions_long.csv")
    data_class = trace.set_index(trace["RecordID"].astype(str))["DataClass"]
    if data_class.index.has_duplicates:
        raise RuntimeError("Traceability table maps a model RecordID more than once")
    ensemble["DataClass"] = ensemble["RecordID"].astype(str).map(data_class)

    integrity_verification = Verification()
    verify_data(integrity_verification, trace, five, model_input)
    integrity_failures = [
        row["check"] for row in integrity_verification.checks if row["status"] != "PASS"
    ]
    actual = ensemble["Actual"].to_numpy(float)
    predicted = ensemble["Predicted"].to_numpy(float)
    overall = metrics(actual, predicted)

    rng = np.random.default_rng(20260810)
    cow_indices = {
        cow: np.asarray(indices, dtype=int)
        for cow, indices in ensemble.groupby("CowKey", sort=True).indices.items()
    }
    cows = np.asarray(list(cow_indices))
    bootstrap_rows = []
    for bootstrap_id in range(1, BOOTSTRAPS + 1):
        sampled = rng.choice(cows, size=len(cows), replace=True)
        indices = np.concatenate([cow_indices[cow] for cow in sampled])
        bootstrap_rows.append(
            {"BootstrapID": bootstrap_id, **metrics(actual[indices], predicted[indices])}
        )
    bootstrap = pd.DataFrame(bootstrap_rows)
    bootstrap_summary = {
        name: {
            "Lower95": float(bootstrap[name].quantile(0.025)),
            "Median": float(bootstrap[name].median()),
            "Upper95": float(bootstrap[name].quantile(0.975)),
        }
        for name in ("R2", "RMSE", "MAE", "Bias")
    }

    permutation_r2 = np.empty(PERMUTATIONS, dtype=float)
    for index in range(PERMUTATIONS):
        shuffled_cows = rng.permutation(cows)
        mapping = dict(zip(cows, shuffled_cows))
        permuted = np.empty_like(actual)
        for cow, indices in cow_indices.items():
            source = cow_indices[mapping[cow]]
            permuted[indices] = rng.choice(actual[source], size=len(indices), replace=True)
        permutation_r2[index] = metrics(permuted, predicted)["R2"]
    permutation_p = float(
        (1 + np.sum(permutation_r2 >= overall["R2"])) / (PERMUTATIONS + 1)
    )

    unit_fold_counts = long.groupby(["Seed", "MeasurementUnitID"])["FoldID"].nunique()
    measurement_unit_fold_leakage = int(unit_fold_counts.gt(1).sum())
    record_fold_coverage = int(
        long.groupby(["Seed", "RecordID"])["FoldID"].nunique().ne(1).sum()
    )

    signature_to_records = (
        model_input.groupby(list(SIGNATURE_COLUMNS), dropna=False)["RecordID"]
        .agg(list)
        .loc[lambda values: values.map(len).gt(1)]
    )
    inherited_cross_fold_rows = []
    for seed in SEEDS:
        fold_by_record = (
            long.loc[long["Seed"].eq(seed)].set_index("RecordID")["FoldID"].astype(int)
        )
        separated = 0
        for records in signature_to_records:
            if len(set(fold_by_record.loc[list(map(str, records))])) > 1:
                separated += 1
        inherited_cross_fold_rows.append(
            {
                "Seed": seed,
                "InheritedSignatureGroups": int(len(signature_to_records)),
                "GroupsSpanningMultipleFolds": separated,
            }
        )
    inherited_cross_fold = pd.DataFrame(inherited_cross_fold_rows)

    guard_rows = []
    logs_available = all(
        (MULTISEED_DIR / "seeds" / str(seed) / "run.log").is_file()
        for seed in SEEDS
    )
    if logs_available:
        for seed in SEEDS:
            text = (MULTISEED_DIR / "seeds" / str(seed) / "run.log").read_text(
                encoding="utf-8", errors="replace"
            )
            matches = GUARD_PATTERN.findall(text)
            guard_rows.append(
                {
                    "Seed": seed,
                    "GuardEvents": len(matches),
                    "GuardedPredictionsAcrossOuterAndInnerFits": sum(
                        int(match[1]) for match in matches
                    ),
                    "EvaluatedPredictionsAcrossOuterAndInnerFits": sum(
                        int(match[2]) for match in matches
                    ),
                }
            )
        guard_checks = pd.DataFrame(guard_rows)
    else:
        guard_path = output / "meta_fusion_guard_checks.csv"
        if not guard_path.is_file():
            raise RuntimeError(
                "Seed logs and the included meta-fusion guard checks are both missing"
            )
        guard_checks = pd.read_csv(guard_path)
        if set(guard_checks["Seed"].astype(int)) != set(SEEDS):
            raise RuntimeError("The included meta-fusion guard checks are incomplete")

    by_class_rows = []
    for name, group in ensemble.groupby("DataClass", sort=True):
        by_class_rows.append(
            {
                "DataClass": name,
                **metrics(
                    group["Actual"].to_numpy(float),
                    group["Predicted"].to_numpy(float),
                ),
            }
        )
    by_class = pd.DataFrame(by_class_rows)
    leave_one_seed_rows = []
    for excluded_seed in SEEDS:
        retained = [
            f"Predicted_{seed}" for seed in SEEDS if seed != excluded_seed
        ]
        leave_one_predicted = rowwise_seed_ensemble(
            ensemble[retained].to_numpy(float)
        )
        leave_one_seed_rows.append(
            {
                "ExcludedSeed": excluded_seed,
                "SeedCount": len(retained),
                **metrics(actual, leave_one_predicted),
            }
        )
    leave_one_seed = pd.DataFrame(leave_one_seed_rows)
    global_duplicate_groups = int(
        model_input.groupby(list(SIGNATURE_COLUMNS), dropna=False).size().gt(1).sum()
    )
    r2_span = float(leave_one_seed["R2"].max() - leave_one_seed["R2"].min())
    mae_span = float(leave_one_seed["MAE"].max() - leave_one_seed["MAE"].min())
    checks = {
        "integrity_gate_passes": not integrity_failures,
        "five_complete_seed_runs": len(long) == 520 * len(SEEDS),
        "measurement_unit_fold_leakage_zero": measurement_unit_fold_leakage == 0,
        "record_fold_coverage_complete": record_fold_coverage == 0,
        "global_duplicate_groups_zero": global_duplicate_groups == 0,
        "leave_one_seed_r2_span_at_most_0_05": r2_span <= 0.05,
        "leave_one_seed_mae_span_at_most_0_05_C": mae_span <= 0.05,
        "ensemble_metrics_finite": bool(
            np.isfinite([overall["R2"], overall["RMSE"], overall["MAE"]]).all()
        ),
        "permutation_p_at_most_0_001": permutation_p <= 0.001,
        "finite_branch_predictions": bool(
            np.isfinite(
                long[
                    [
                        *BRANCHES,
                        "Predicted",
                    ]
                ].to_numpy(float)
            ).all()
        ),
        "guard_checks_available": int(guard_checks["GuardEvents"].sum()) > 0,
    }
    report = {
        "status": "PASS" if all(checks.values()) else "FAIL",
        "validation": "five-seed OOF stability and leakage checks",
        "ensemble_metrics": overall,
        "leave_one_seed_r2_range": [
            float(leave_one_seed["R2"].min()),
            float(leave_one_seed["R2"].max()),
        ],
        "leave_one_seed_mae_range": [
            float(leave_one_seed["MAE"].min()),
            float(leave_one_seed["MAE"].max()),
        ],
        "seed_ensemble": {
            "method": config["seed_ensemble_method"],
        },
        "permutation_count": PERMUTATIONS,
        "cow_level_permutation_p_value": permutation_p,
        "bootstrap_count": BOOTSTRAPS,
        "cow_bootstrap_95_interval": bootstrap_summary,
        "measurement_unit_fold_leakage_groups": measurement_unit_fold_leakage,
        "record_fold_coverage_failures": record_fold_coverage,
        "integrity_failures": integrity_failures,
        "global_duplicate_groups": global_duplicate_groups,
        "inherited_signature_groups_spanning_folds": inherited_cross_fold.to_dict(
            orient="records"
        ),
        "guard_events": guard_checks.to_dict(orient="records"),
        "input_sha256": sha256(INPUT_PATH),
        "checks": checks,
    }
    output.mkdir(parents=True, exist_ok=True)
    bootstrap.to_csv(output / "cow_bootstrap_metrics.csv", index=False, lineterminator="\n")
    pd.DataFrame(
        {"PermutationID": np.arange(1, PERMUTATIONS + 1), "R2": permutation_r2}
    ).to_csv(output / "cow_permutation_r2.csv", index=False, lineterminator="\n")
    by_class.to_csv(output / "metrics_by_data_class.csv", index=False, lineterminator="\n")
    leave_one_seed.to_csv(
        output / "leave_one_seed_metrics.csv", index=False, lineterminator="\n"
    )
    inherited_cross_fold.to_csv(
        output / "inherited_signature_fold_checks.csv", index=False, lineterminator="\n"
    )
    guard_checks.to_csv(output / "meta_fusion_guard_checks.csv", index=False, lineterminator="\n")
    (output / "summary.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    report = run(args.output.resolve())
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
