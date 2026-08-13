#!/usr/bin/env python3
"""Deterministically rebuild the 520-record measured-data contract."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from experiment_common import (
    DATA_DIR,
    FIVE_COLUMNS,
    FIVE_PATH,
    INPUT_PATH,
    SEEDS,
    SIGNATURE_COLUMNS,
    SOURCE_MEASUREMENTS_PATH,
    TRACE_PATH,
    VALIDATION_CONTRACT_PATH,
    load_config,
    recalculate_features,
    sha256,
)


def build() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    config = load_config()
    raw = pd.read_csv(SOURCE_MEASUREMENTS_PATH)
    contract = pd.read_csv(VALIDATION_CONTRACT_PATH)
    if len(raw) != int(config["rows"]) or len(contract) != int(config["rows"]):
        raise RuntimeError("Source snapshots must contain exactly 520 rows")
    if raw["RecordID"].duplicated().any() or contract["RecordID"].duplicated().any():
        raise RuntimeError("RecordID must be unique in both source snapshots")
    if not np.array_equal(raw["RecordID"].astype(str), contract["RecordID"].astype(str)):
        raise RuntimeError("Measurement and validation snapshots are not row-aligned")
    if raw["CowKey"].nunique() != int(config["cattle"]):
        raise RuntimeError("Unexpected cattle count")

    model_input = pd.DataFrame(
        {
            "RecordID": raw["RecordID"].astype(str),
            "CowKey": raw["CowKey"].astype(str),
            "Source": str(config["source"]),
            "RowID": contract["RowID"].astype(int),
            "SourceRowID": contract["SourceRowID"].astype(int),
        }
    )
    for column in SIGNATURE_COLUMNS:
        model_input[column] = pd.to_numeric(raw[column], errors="raise")
    model_input["SourceType"] = str(config["source_type"])
    model_input["EarStatus"] = str(config["ear_status"])
    model_input["SourceWeight"] = float(config["source_weight"])
    model_input["MeasurementUnitID"] = contract["MeasurementUnitID"].astype(str)
    model_input["AcquisitionSession"] = contract["AcquisitionSession"].astype(int)
    for seed in SEEDS:
        column = f"OuterFold_{seed}"
        model_input[column] = contract[column].astype(int)
    model_input = recalculate_features(model_input)

    sequence = (
        model_input.sort_values(
            ["CowKey", "AcquisitionSession", "MeasurementTime_hour", "RowID"],
            kind="stable",
        )
        .groupby(["CowKey", "AcquisitionSession"], sort=False)
        .cumcount()
        .add(1)
        .reindex(model_input.index)
    )
    trace = pd.DataFrame(
        {
            "RecordID": model_input["RecordID"].astype(str),
            "MeasurementUnitID": model_input["MeasurementUnitID"].astype(str),
            "CowKey": model_input["CowKey"].astype(str),
            **{column: model_input[column] for column in SIGNATURE_COLUMNS},
            "SequenceInCow": sequence.astype(int),
            "DataClass": "measured",
            "Source": str(config["source"]),
            "SourceWeight": float(config["source_weight"]),
        }
    )
    five = trace[FIVE_COLUMNS].copy()
    return trace, five, model_input


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DATA_DIR)
    parser.add_argument("--compare-data-dir", type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    trace, five, model_input = build()
    paths = {
        TRACE_PATH.name: output / TRACE_PATH.name,
        FIVE_PATH.name: output / FIVE_PATH.name,
        INPUT_PATH.name: output / INPUT_PATH.name,
    }
    trace.to_csv(paths[TRACE_PATH.name], index=False, lineterminator="\n")
    five.to_csv(paths[FIVE_PATH.name], index=False, lineterminator="\n")
    model_input.to_csv(paths[INPUT_PATH.name], index=False, lineterminator="\n")
    comparisons = {}
    if args.compare_data_dir is not None:
        compare = args.compare_data_dir.resolve()
        for name, path in paths.items():
            expected = compare / name
            byte_identical = sha256(path) == sha256(expected)
            equivalent = byte_identical
            comparison_mode = "sha256"
            if name == INPUT_PATH.name and not byte_identical:
                rebuilt_frame = pd.read_csv(path)
                expected_frame = pd.read_csv(expected)
                tolerant_columns = ["TimeSin", "TimeCos"]
                exact_columns = [
                    column
                    for column in rebuilt_frame.columns
                    if column not in tolerant_columns
                ]
                equivalent = (
                    list(rebuilt_frame.columns) == list(expected_frame.columns)
                    and rebuilt_frame[exact_columns].equals(expected_frame[exact_columns])
                    and np.allclose(
                        rebuilt_frame[tolerant_columns].to_numpy(float),
                        expected_frame[tolerant_columns].to_numpy(float),
                        rtol=0.0,
                        atol=1e-12,
                        equal_nan=True,
                    )
                )
                comparison_mode = "exact_except_TimeSin_TimeCos_atol_1e-12"
            comparisons[name] = {
                "rebuilt_sha256": sha256(path),
                "formal_sha256": sha256(expected),
                "byte_identical": byte_identical,
                "comparison_mode": comparison_mode,
                "identical": bool(equivalent),
            }
    report = {
        "status": "PASS" if all(row["identical"] for row in comparisons.values()) else "PASS",
        "rows": len(trace),
        "cattle": int(trace["CowKey"].nunique()),
        "measured_rows": int(trace["DataClass"].eq("measured").sum()),
        "data_sha256": {name: sha256(path) for name, path in paths.items()},
        "comparisons": comparisons,
    }
    if comparisons and not all(row["identical"] for row in comparisons.values()):
        report["status"] = "FAIL"
    report_path = output.parent / "rebuild_summary.json"
    report_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
