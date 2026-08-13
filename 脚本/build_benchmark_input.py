#!/usr/bin/env python3
"""Build one fold-seed-aligned 33-model benchmark input."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "data" / "all_measured_520_th_shrc_input.csv"
DEFAULT_TRACE = ROOT / "data" / "all_measured_520_traceable.csv"
DEFAULT_LONG = ROOT / "outputs" / "all_measured_multiseed" / "oof_predictions_long.csv"
DEFAULT_OUTPUT_ROOT = ROOT / "outputs" / "analysis" / "benchmark33" / "seeds"
DEFAULT_SEED = 20260523


def run(
    data_path: Path,
    trace_path: Path,
    long_path: Path,
    output: Path,
    seed: int,
) -> dict[str, object]:
    data = pd.read_csv(data_path, encoding="utf-8-sig")
    trace = pd.read_csv(trace_path, encoding="utf-8-sig")
    long = pd.read_csv(long_path, encoding="utf-8-sig")
    seed_rows = long.loc[
        long["Seed"].astype(int).eq(seed), ["RecordID", "FoldID", "Predicted"]
    ].copy()
    folds = seed_rows[["RecordID", "FoldID"]]
    if len(folds) != len(data) or folds["RecordID"].nunique() != len(data):
        raise RuntimeError(f"seed {seed} does not contain one fold per record")

    prediction = seed_rows[["RecordID", "Predicted"]].rename(
        columns={"Predicted": "PredictedTHSHRC"}
    )
    classes = trace[["RecordID", "DataClass"]]
    frame = data.merge(folds, on="RecordID", validate="one_to_one")
    frame = frame.merge(prediction, on="RecordID", validate="one_to_one")
    frame = frame.merge(classes, on="RecordID", validate="one_to_one")
    ambient = frame["AmbientTemperature_C"].to_numpy(float)
    frame["HeatSegment"] = np.where(
        ambient >= 30.0, "hot", np.where(ambient < 18.0, "cold", "moderate")
    )
    frame["SessionID"] = frame["Source"].astype(str) + "_" + frame["CowKey"].astype(str)
    frame["Ear"] = frame["EarTemperature_C"]
    frame["Air"] = frame["AmbientTemperature_C"]
    frame["Time"] = frame["MeasurementTime_hour"]
    frame["Actual"] = frame["CoreReferenceTemperature_C"]
    frame["Predicted"] = frame["PredictedTHSHRC"]
    frame["Residual"] = frame["Actual"] - frame["Predicted"]
    frame["BenchmarkSeed"] = seed
    frame["FoldMode"] = f"fixed_outer_fold_{seed}"

    if len(frame) != 520 or frame["CowKey"].nunique() != 30:
        raise RuntimeError("benchmark input is not 520 rows from 30 cattle")
    if set(frame["FoldID"].astype(int)) != {1, 2, 3, 4, 5}:
        raise RuntimeError("benchmark FoldID does not contain all five folds")
    unit_folds = frame.groupby("MeasurementUnitID")["FoldID"].nunique()
    if not unit_folds.eq(1).all():
        raise RuntimeError("a measurement unit spans multiple benchmark folds")
    output.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output, index=False, encoding="utf-8", lineterminator="\n")
    return {
        "status": "PASS",
        "rows": len(frame),
        "cows": int(frame["CowKey"].nunique()),
        "benchmark_seed": seed,
        "proposed_prediction": "fold-aligned single-seed TH-SHRC OOF prediction",
        "output": str(output.resolve()),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--trace", type=Path, default=DEFAULT_TRACE)
    parser.add_argument("--long", type=Path, default=DEFAULT_LONG)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    output = args.output or DEFAULT_OUTPUT_ROOT / str(args.seed) / "benchmark_input.csv"
    print(
        json.dumps(
            run(args.data, args.trace, args.long, output, args.seed),
            indent=2,
        )
    )
