#!/usr/bin/env python3
"""Compute exact linear SHAP values for the three TH-SHRC stack branches."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from experiment_common import BRANCHES, MULTISEED_DIR, ROOT, SEEDS, load_config


STACK_DIR = ROOT / "reproduction" / "th_shrc" / "pipeline" / "analysis" / "th_shrc"
if str(STACK_DIR) not in sys.path:
    sys.path.insert(0, str(STACK_DIR))
from reproduce_stack import choose_lambda, fit_ridge, predict_ridge  # noqa: E402


DEFAULT_OUTPUT = ROOT / "outputs" / "analysis" / "shap"


def median_seed_weights(additivity: pd.DataFrame) -> pd.DataFrame:
    """Return prediction-order weights for the fixed rowwise median."""
    rows: list[dict[str, object]] = []
    for record_id, group in additivity.groupby("RecordID", sort=False):
        ordered = group.sort_values(["SavedPredicted", "Seed"], kind="stable")
        position = (len(ordered) - 1) * 0.5
        lower = int(np.floor(position))
        upper = int(np.ceil(position))
        fraction = float(position - lower)
        selected = [(lower, 1.0 - fraction)]
        if upper != lower:
            selected.append((upper, fraction))
        for rank, weight in selected:
            row = ordered.iloc[rank]
            rows.append(
                {
                    "RecordID": str(record_id),
                    "Seed": int(row["Seed"]),
                    "PredictionRank": rank + 1,
                    "EnsembleWeight": float(weight),
                }
            )
    return pd.DataFrame(rows)


def run(output: Path = DEFAULT_OUTPUT) -> dict[str, object]:
    config = load_config()
    value_parts = []
    additivity_rows = []
    max_additivity = 0.0
    max_saved_difference = 0.0
    max_clip_adjustment = 0.0
    for seed in SEEDS:
        source = pd.read_csv(
            MULTISEED_DIR / "seeds" / str(seed) / "th_shrc_oof_predictions.csv"
        )
        for fold in sorted(source["FoldID"].astype(int).unique()):
            train = source.loc[source["FoldID"].astype(int).ne(fold)].copy()
            test = source.loc[source["FoldID"].astype(int).eq(fold)].copy()
            selected = choose_lambda(train, fold)
            coefficients = fit_ridge(train, selected["SelectedLambda"])
            background = train[list(BRANCHES)].mean(axis=0).to_numpy(float)
            values = test[list(BRANCHES)].to_numpy(float)
            shap = (values - background) * coefficients[1:].reshape(1, -1)
            base_value = float(coefficients[0] + np.dot(background, coefficients[1:]))
            unclipped = base_value + shap.sum(axis=1)
            direct = predict_ridge(test, coefficients)
            clipped = np.clip(direct, 35.0, 42.0)
            max_additivity = max(max_additivity, float(np.max(np.abs(unclipped - direct))))
            max_saved_difference = max(
                max_saved_difference,
                float(np.max(np.abs(clipped - test["Predicted"].to_numpy(float)))),
            )
            max_clip_adjustment = max(
                max_clip_adjustment, float(np.max(np.abs(clipped - unclipped)))
            )
            rows, features = shap.shape
            value_parts.append(
                pd.DataFrame(
                    {
                        "RecordID": np.repeat(test["RecordID"].astype(str).to_numpy(), features),
                        "MeasurementUnitID": np.repeat(
                            test["MeasurementUnitID"].astype(str).to_numpy(), features
                        ),
                        "CowKey": np.repeat(test["CowKey"].astype(str).to_numpy(), features),
                        "Seed": seed,
                        "FoldID": fold,
                        "Branch": np.tile(np.asarray(BRANCHES), rows),
                        "BranchValue": values.reshape(-1),
                        "TrainingBackground": np.tile(background, rows),
                        "SHAPValue": shap.reshape(-1),
                    }
                )
            )
            additivity_rows.append(
                pd.DataFrame(
                    {
                        "RecordID": test["RecordID"].astype(str).to_numpy(),
                        "CowKey": test["CowKey"].astype(str).to_numpy(),
                        "Seed": seed,
                        "FoldID": fold,
                        "BaseValue": base_value,
                        "SHAPSum": shap.sum(axis=1),
                        "UnclippedPredicted": unclipped,
                        "ClipAdjustment": clipped - unclipped,
                        "Predicted": clipped,
                        "SavedPredicted": test["Predicted"].to_numpy(float),
                    }
                )
            )

    values = pd.concat(value_parts, ignore_index=True)
    additivity = pd.concat(additivity_rows, ignore_index=True)
    summary = (
        values.groupby("Branch", as_index=False)
        .agg(
            MeanAbsSHAP=("SHAPValue", lambda data: float(np.mean(np.abs(data)))),
            MeanSHAP=("SHAPValue", "mean"),
            SHAPSD=("SHAPValue", "std"),
            BranchValueMean=("BranchValue", "mean"),
            BranchValueSD=("BranchValue", "std"),
        )
        .sort_values("MeanAbsSHAP", ascending=False)
    )

    selection = median_seed_weights(additivity)
    weighted_values = values.merge(
        selection[["RecordID", "Seed", "EnsembleWeight"]],
        on=["RecordID", "Seed"],
        validate="many_to_one",
    )
    for column in ("BranchValue", "TrainingBackground", "SHAPValue"):
        weighted_values[column] *= weighted_values["EnsembleWeight"]
    ensemble_values = (
        weighted_values.groupby(
            ["RecordID", "MeasurementUnitID", "CowKey", "Branch"], as_index=False
        )
        .agg(
            BranchValue=("BranchValue", "sum"),
            TrainingBackground=("TrainingBackground", "sum"),
            SHAPValue=("SHAPValue", "sum"),
        )
    )
    weighted_additivity = additivity.merge(
        selection[["RecordID", "Seed", "EnsembleWeight"]],
        on=["RecordID", "Seed"],
        validate="one_to_one",
    )
    for column in (
        "BaseValue",
        "SHAPSum",
        "ClipAdjustment",
        "Predicted",
        "SavedPredicted",
    ):
        weighted_additivity[column] *= weighted_additivity["EnsembleWeight"]
    ensemble_additivity = (
        weighted_additivity.groupby(["RecordID", "CowKey"], as_index=False)
        .agg(
            BaseValue=("BaseValue", "sum"),
            SHAPSum=("SHAPSum", "sum"),
            ClipAdjustment=("ClipAdjustment", "sum"),
            Predicted=("Predicted", "sum"),
            SavedPredicted=("SavedPredicted", "sum"),
        )
    )
    ensemble_shap_sum = ensemble_values.groupby("RecordID")["SHAPValue"].sum()
    aligned_sum = ensemble_additivity["RecordID"].map(ensemble_shap_sum).to_numpy(float)
    ensemble_difference = np.max(
        np.abs(
            ensemble_additivity["BaseValue"].to_numpy(float)
            + aligned_sum
            + ensemble_additivity["ClipAdjustment"].to_numpy(float)
            - ensemble_additivity["SavedPredicted"].to_numpy(float)
        )
    )
    official = pd.read_csv(MULTISEED_DIR / "ensemble_oof_predictions.csv").set_index(
        "RecordID"
    )["Predicted"]
    official_aligned = ensemble_additivity["RecordID"].map(official)
    official_difference = float(
        np.max(
            np.abs(
                ensemble_additivity["SavedPredicted"].to_numpy(float)
                - official_aligned.to_numpy(float)
            )
        )
    )
    selection_weight_sums = selection.groupby("RecordID")["EnsembleWeight"].sum()
    checks = {
        "five_seed_record_coverage": len(additivity) == 520 * len(SEEDS),
        "three_branch_coverage": len(values) == 520 * len(SEEDS) * len(BRANCHES),
        "finite_shap_values": bool(np.isfinite(values["SHAPValue"]).all()),
        "exact_linear_additivity": max_additivity <= 1e-10,
        "predictions_match_frozen": max_saved_difference <= 1e-8,
        "ensemble_additivity": float(ensemble_difference) <= 1e-10,
        "median_selection_complete": len(selection_weight_sums) == 520
        and bool(np.allclose(selection_weight_sums.to_numpy(float), 1.0)),
        "ensemble_predictions_match_official": official_difference <= 1e-10,
    }
    report = {
        "status": "PASS" if all(checks.values()) else "FAIL",
        "method": "exact linear SHAP per seed with fixed rowwise-median aggregation",
        "model": "TH-SHRC three-branch nested ridge stack",
        "seed_ensemble": {
            "method": config["seed_ensemble_method"],
            "selection_uses_observed_target": False,
        },
        "branches": list(BRANCHES),
        "max_linear_additivity_difference_C": max_additivity,
        "max_frozen_prediction_difference_C": max_saved_difference,
        "max_clip_adjustment_C": max_clip_adjustment,
        "max_ensemble_additivity_difference_C": float(ensemble_difference),
        "max_official_ensemble_difference_C": official_difference,
        "checks": checks,
    }
    output.mkdir(parents=True, exist_ok=True)
    obsolete_quantile_weights = output / "ensemble_quantile_seed_weights.csv"
    if obsolete_quantile_weights.is_file():
        obsolete_quantile_weights.unlink()
    values.to_csv(output / "shap_values_long.csv", index=False, lineterminator="\n")
    summary.to_csv(output / "shap_branch_summary.csv", index=False, lineterminator="\n")
    additivity.to_csv(output / "shap_additivity_check.csv", index=False, lineterminator="\n")
    ensemble_values.to_csv(
        output / "ensemble_shap_values.csv", index=False, lineterminator="\n"
    )
    ensemble_additivity.to_csv(
        output / "ensemble_shap_additivity.csv", index=False, lineterminator="\n"
    )
    selection.to_csv(
        output / "ensemble_median_seed_weights.csv", index=False, lineterminator="\n"
    )
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
