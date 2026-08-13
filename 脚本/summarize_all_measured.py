#!/usr/bin/env python3
"""Summarize measured-data predictions and three-branch fusion weights."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from experiment_common import (
    BRANCH_WEIGHT_COLUMNS,
    INPUT_PATH,
    OUTPUT_DIR,
    SEEDS,
    TRACE_PATH,
    load_config,
    metrics,
    rowwise_seed_ensemble,
    sha256,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=INPUT_PATH)
    parser.add_argument("--trace", type=Path, default=TRACE_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_DIR / "all_measured_multiseed")
    args = parser.parse_args()
    input_path = args.input.resolve()
    trace = pd.read_csv(args.trace.resolve())
    model_input = pd.read_csv(input_path)
    output = args.output.resolve()
    predictions = []
    weights = []
    for seed in SEEDS:
        seed_dir = output / "seeds" / str(seed)
        current = pd.read_csv(seed_dir / "th_shrc_oof_predictions.csv")
        current.insert(0, "Seed", seed)
        predictions.append(current)
        current_weights = pd.read_csv(seed_dir / "stack_weights.csv")
        current_weights.insert(0, "Seed", seed)
        weights.append(current_weights)
    long = pd.concat(predictions, ignore_index=True)
    weight_table = pd.concat(weights, ignore_index=True)
    wide = long.pivot(index="RecordID", columns="Seed", values="Predicted")
    wide = wide.reindex(model_input["RecordID"].astype(str))
    ensemble = model_input[["RecordID", "MeasurementUnitID", "CowKey", "CoreReferenceTemperature_C"]].copy()
    ensemble = ensemble.rename(columns={"CoreReferenceTemperature_C": "Actual"})
    for seed in SEEDS:
        ensemble[f"Predicted_{seed}"] = wide[seed].to_numpy(float)
    config = load_config()
    prediction_columns = [f"Predicted_{seed}" for seed in SEEDS]
    ensemble["Predicted"] = rowwise_seed_ensemble(
        ensemble[prediction_columns].to_numpy(float)
    )
    ensemble["Residual"] = ensemble["Actual"] - ensemble["Predicted"]
    ensemble["DataClass"] = trace["DataClass"].to_numpy(str)
    overall = metrics(ensemble["Actual"], ensemble["Predicted"])
    by_class = []
    for name, group in ensemble.groupby("DataClass", sort=True):
        by_class.append({"DataClass": name, **metrics(group["Actual"], group["Predicted"])})
    checks = {
        "five_seeds_complete": len(long) == 520 * len(SEEDS),
        "three_branch_weights_present": not weight_table[BRANCH_WEIGHT_COLUMNS].isna().any().any(),
        "formal_metrics_finite": bool(
            np.isfinite([overall["R2"], overall["RMSE"], overall["MAE"]]).all()
        ),
        "fixed_median_declared": config["seed_ensemble_method"] == "rowwise_median",
    }
    weight_summary = weight_table[BRANCH_WEIGHT_COLUMNS].agg(["mean", "std", "min", "max"]).T.reset_index(names="Branch")
    report = {
        "status": "PASS" if all(checks.values()) else "FAIL",
        "model": "TH-SHRC",
        "validation": config["validation"],
        "seed_ensemble": {
            "method": config["seed_ensemble_method"],
            "seeds": list(SEEDS),
        },
        "input_sha256": sha256(input_path),
        "ensemble": overall,
        "by_data_class": by_class,
        "checks": checks,
        "branch_weight_summary": weight_summary.to_dict(orient="records"),
    }
    long.to_csv(output / "oof_predictions_long.csv", index=False, lineterminator="\n")
    ensemble.to_csv(output / "ensemble_oof_predictions.csv", index=False, lineterminator="\n")
    weight_table.to_csv(output / "stack_weights_all_seeds.csv", index=False, lineterminator="\n")
    weight_summary.to_csv(output / "stack_weight_summary.csv", index=False, lineterminator="\n")
    pd.DataFrame([overall]).to_csv(output / "ensemble_metrics.csv", index=False, lineterminator="\n")
    pd.DataFrame(by_class).to_csv(output / "metrics_by_data_class.csv", index=False, lineterminator="\n")
    (output / "summary.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
