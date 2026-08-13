#!/usr/bin/env python3
"""Run the same TH-SHRC core branches and nested ridge stack on one scenario."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "pipeline" / "analysis" / "th_shrc"
UPSTREAM = PIPELINE / "upstream_modules"
if str(PIPELINE) not in sys.path:
    sys.path.insert(0, str(PIPELINE))

from reproduce_stack import (  # noqa: E402
    calculate_metrics,
    choose_lambda,
    fit_ridge,
    predict_ridge,
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def find_rscript(explicit: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit)
    discovered = shutil.which("Rscript")
    if discovered:
        candidates.append(Path(discovered))
    if os.name == "nt":
        program_files = os.environ.get("ProgramFiles")
        if program_files:
            candidates.extend(
                sorted((Path(program_files) / "R").glob(r"R-*\bin\Rscript.exe"), reverse=True)
            )
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise RuntimeError("Rscript was not found")


def run_r_stage(script: str, rscript: Path, environment: dict[str, str], log: Path) -> None:
    started = time.monotonic()
    completed = subprocess.run(
        [str(rscript), str(UPSTREAM / script)],
        cwd=UPSTREAM,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8") as handle:
        handle.write(f"\n=== {script} ===\n")
        handle.write(completed.stdout)
        handle.write(completed.stderr)
        handle.write(
            f"\nreturncode={completed.returncode} elapsed_seconds={time.monotonic() - started:.3f}\n"
        )
    if completed.returncode != 0:
        raise RuntimeError(f"R stage failed: {script}; see {log}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "scenario",
        choices=("all_measured_520",),
    )
    parser.add_argument("--rscript", type=Path)
    parser.add_argument("--fold-seed", type=int, default=20260523)
    parser.add_argument("--output-name")
    parser.add_argument("--input-path", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--expected-rows", type=int)
    parser.add_argument("--expected-analysis-rows", type=int)
    parser.add_argument("--minimum-records", type=int)
    parser.add_argument("--analysis-scope", choices=("all_unique",))
    args = parser.parse_args()

    scenario_root = ROOT / "scenarios" / args.scenario
    input_path = (
        args.input_path.resolve()
        if args.input_path
        else scenario_root / "data" / "processed" / "paired_temperature_records.csv"
    )
    if args.output_dir and args.output_name:
        raise RuntimeError("Use either --output-dir or --output-name, not both")
    output = args.output_dir.resolve() if args.output_dir else scenario_root / "outputs"
    if args.output_name:
        output = output / args.output_name
    upstream_output = output / "upstream"
    log_path = output / "run.log"
    if not input_path.is_file():
        raise RuntimeError(f"Missing scenario input: {input_path}")

    settings = {
        "all_measured_520": {
            "rows": 520,
            "analysis_rows": 520,
            "minimum_records": 7,
            "analysis_scope": "all_unique",
        },
    }[args.scenario]
    if args.expected_rows is not None:
        settings = {
            "rows": args.expected_rows,
            "analysis_rows": args.expected_analysis_rows or args.expected_rows,
            "minimum_records": args.minimum_records or 8,
            "analysis_scope": args.analysis_scope or "all_unique",
        }
    data = pd.read_csv(input_path)
    if len(data) != settings["rows"]:
        raise RuntimeError(f"Unexpected input row count: {len(data)}")

    if settings.get("analysis_scope") != "all_unique":
        raise RuntimeError("The reproduction supports only the all_unique analysis scope")
    counts = data.groupby("CowKey")["CowKey"].transform("size")
    analysis_data = data[counts >= settings["minimum_records"]].copy()
    expected_analysis_rows = int(settings.get("analysis_rows", settings["rows"]))
    if len(analysis_data) != expected_analysis_rows:
        raise RuntimeError(
            f"Unexpected analysis row count: {len(analysis_data)}; "
            f"expected {expected_analysis_rows}"
        )

    rscript = find_rscript(args.rscript)
    environment = os.environ.copy()
    environment["TH_SHRC_PUBLIC_INPUT"] = str(input_path.resolve())
    environment["TH_SHRC_BRANCH_OUTPUT_DIR"] = str(upstream_output.resolve())
    environment["TH_SHRC_MIN_RECORDS"] = str(settings["minimum_records"])
    environment["TH_SHRC_ANALYSIS_SCOPE"] = str(
        settings.get("analysis_scope", "all_unique")
    )
    environment["TH_SHRC_FOLD_SEED"] = str(args.fold_seed)
    output.mkdir(parents=True, exist_ok=True)
    log_path.write_text("", encoding="utf-8")

    started = time.monotonic()
    run_r_stage("run_memory_calibration_oof.R", rscript, environment, log_path)
    run_r_stage("run_hierarchical_residual_oof.R", rscript, environment, log_path)

    memory = pd.read_csv(upstream_output / "memory_calibration_oof_predictions.csv")
    residual = pd.read_csv(upstream_output / "hierarchical_residual_oof_predictions.csv")
    generated = memory[
        [
            "RowID",
            "FoldID",
            "CowKey",
            "Source",
            "Actual",
            "SourceMemoryPredicted",
            "BatchSessionPredicted",
        ]
    ].merge(
        residual[["RowID", "FoldID", "Predicted"]].rename(
            columns={"Predicted": "HierarchicalResidualPredicted"}
        ),
        on=["RowID", "FoldID"],
        validate="one_to_one",
    )
    generated = generated.merge(
        analysis_data[["RecordID", "RowID", "MeasurementUnitID"]],
        on="RowID",
        validate="one_to_one",
    )
    if (
        len(generated) != len(analysis_data)
        or generated["RowID"].nunique() != len(analysis_data)
    ):
        raise RuntimeError("Generated branches do not cover every scenario row")

    prediction_frames: list[pd.DataFrame] = []
    weight_rows: list[dict[str, object]] = []
    for fold_id in sorted(generated["FoldID"].astype(int).unique()):
        train = generated[generated["FoldID"].astype(int) != fold_id].copy()
        test = generated[generated["FoldID"].astype(int) == fold_id].copy()
        selected = choose_lambda(train, fold_id)
        coefficients = fit_ridge(train, selected["SelectedLambda"])
        test["Predicted"] = np.clip(predict_ridge(test, coefficients), 35.0, 42.0)
        test["Residual"] = test["Actual"] - test["Predicted"]
        prediction_frames.append(test)
        weight_rows.append(
            {
                "FoldID": fold_id,
                "OuterTrainN": len(train),
                "OuterTestN": len(test),
                "SelectedLambda": selected["SelectedLambda"],
                "InnerRMSE": selected["InnerRMSE"],
                "InnerR2": selected["InnerR2"],
                "InnerMAE": selected["InnerMAE"],
                "Intercept": coefficients[0],
                "WeightSourceMemory": coefficients[1],
                "WeightBatchSession": coefficients[2],
                "WeightHierarchicalResidual": coefficients[3],
            }
        )

    predictions = pd.concat(prediction_frames, ignore_index=True).sort_values(
        ["FoldID", "Source", "RowID"]
    )
    metrics = calculate_metrics(predictions, "Predicted")
    prediction_columns = [
        "RecordID",
        "MeasurementUnitID",
        "RowID",
        "CowKey",
        "Source",
        "FoldID",
        "Actual",
        "SourceMemoryPredicted",
        "BatchSessionPredicted",
        "HierarchicalResidualPredicted",
        "Predicted",
        "Residual",
    ]
    predictions[prediction_columns].to_csv(
        output / "th_shrc_oof_predictions.csv",
        index=False,
        encoding="utf-8",
        lineterminator="\n",
    )
    pd.DataFrame(weight_rows).to_csv(
        output / "stack_weights.csv",
        index=False,
        encoding="utf-8",
        lineterminator="\n",
    )
    pd.DataFrame([{"Scenario": args.scenario, **metrics}]).to_csv(
        output / "th_shrc_metrics.csv",
        index=False,
        encoding="utf-8",
        lineterminator="\n",
    )
    result = {
        "status": "PASS",
        "scenario": args.scenario,
        "validation": "measurement-unit-grouped same-animal five-fold OOF",
        "input_rows": len(data),
        "input_cows": int(data["CowKey"].nunique()),
        "measurement_units": int(data["MeasurementUnitID"].nunique()),
        "analysis_rows": len(analysis_data),
        "analysis_cows": int(analysis_data["CowKey"].nunique()),
        "folds": sorted(int(value) for value in predictions["FoldID"].unique()),
        "minimum_records_setting": settings["minimum_records"],
        "fold_seed": args.fold_seed,
        "input_sha256": sha256(input_path),
        "metrics": metrics,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "rscript": rscript.name,
    }
    (output / "run_summary.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
