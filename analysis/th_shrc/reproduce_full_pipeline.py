#!/usr/bin/env python3
"""Retrain all TH-SHRC branches and verify the final same-animal OOF result."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd


SHARED_ROOT = Path(__file__).resolve().parents[2]
COMMON_DIR = SHARED_ROOT / "analysis" / "common"
if str(COMMON_DIR) not in sys.path:
    sys.path.insert(0, str(COMMON_DIR))

from runtime_metadata import collect_runtime_metadata  # noqa: E402
from reproduce_stack import (  # noqa: E402
    EXPECTED,
    FEATURE_COLUMNS,
    calculate_metrics,
    choose_lambda,
    fit_ridge,
    predict_ridge,
)


UPSTREAM_DIR = Path(__file__).resolve().parent / "upstream_modules"
DEFAULT_FROZEN = SHARED_ROOT / "data" / "processed" / "th_shrc_oof_predictions.csv"
DEFAULT_OUTPUT = SHARED_ROOT / "outputs" / "analysis"
SOURCE_MEMORY_TOLERANCE_C = 0.05
EXACT_BRANCH_TOLERANCE_C = 1e-8
FINAL_PREDICTION_TOLERANCE_C = 0.02
FINAL_METRIC_TOLERANCE = 5e-4


def find_rscript(explicit: Path | None) -> Path:
    candidates = []
    if explicit is not None:
        candidates.append(explicit)
    on_path = shutil.which("Rscript")
    if on_path:
        candidates.append(Path(on_path))
    if os.name == "nt":
        candidates.extend(sorted(Path(r"C:\Program Files\R").glob("R-*\\bin\\Rscript.exe"), reverse=True))
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise RuntimeError("Rscript was not found; provide --rscript or install R 4.5.x")


def read_r_runtime(rscript: Path) -> dict[str, object]:
    expression = (
        "pkgs<-c('dplyr','gbm','mgcv','e1071','xgboost','MASS','tidyr','ggplot2');"
        "cat('r_version\\t',R.version.string,'\\n',sep='');"
        "cat('platform\\t',R.version$platform,'\\n',sep='');"
        "for(p in pkgs)cat('package\\t',p,'\\t',as.character(packageVersion(p)),'\\n',sep='')"
    )
    completed = subprocess.run(
        [str(rscript), "-e", expression],
        cwd=UPSTREAM_DIR,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    result: dict[str, object] = {"packages": {}}
    for line in completed.stdout.splitlines():
        fields = line.split("\t")
        if fields[0] == "r_version":
            result["version"] = fields[1]
        elif fields[0] == "platform":
            result["platform"] = fields[1]
        elif fields[0] == "package":
            result["packages"][fields[1]] = fields[2]
    return result


def run_upstream(rscript: Path, output_dir: Path) -> None:
    upstream_output = output_dir / "upstream"
    upstream_output.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment["TH_SHRC_BRANCH_OUTPUT_DIR"] = str(upstream_output)
    for script_name in [
        "run_memory_calibration_oof.R",
        "run_hierarchical_residual_oof.R",
    ]:
        completed = subprocess.run(
            [str(rscript), str(UPSTREAM_DIR / script_name)],
            cwd=UPSTREAM_DIR,
            env=environment,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(f"Upstream script failed: {script_name}")


def maximum_difference(left: pd.Series, right: pd.Series) -> float:
    return float(np.max(np.abs(left.to_numpy(float) - right.to_numpy(float))))


def reproduce(frozen_path: Path, output_dir: Path) -> dict[str, object]:
    frozen = pd.read_csv(frozen_path)
    dual = pd.read_csv(output_dir / "upstream" / "memory_calibration_oof_predictions.csv")
    residual = pd.read_csv(output_dir / "upstream" / "hierarchical_residual_oof_predictions.csv")

    dual_columns = ["RowID", "FoldID", "SourceMemoryPredicted", "BatchSessionPredicted"]
    residual_columns = ["RowID", "FoldID", "Predicted"]
    generated = dual[dual_columns].merge(
        residual[residual_columns].rename(columns={"Predicted": "HierarchicalResidualPredicted"}),
        on=["RowID", "FoldID"],
        validate="one_to_one",
    )
    if len(generated) != 503 or generated["RowID"].nunique() != 503:
        raise RuntimeError("Generated upstream branches do not contain 503 unique rows")

    merged = frozen.drop(columns=FEATURE_COLUMNS).merge(
        generated,
        on=["RowID", "FoldID"],
        validate="one_to_one",
    )
    if len(merged) != 503:
        raise RuntimeError("Generated branches do not match all frozen RowID/FoldID pairs")

    prediction_frames = []
    weight_rows = []
    for fold_id in sorted(merged["FoldID"].astype(int).unique()):
        train = merged[merged["FoldID"].astype(int) != fold_id].copy()
        test = merged[merged["FoldID"].astype(int) == fold_id].copy()
        selected = choose_lambda(train, fold_id)
        coefficients = fit_ridge(train, selected["SelectedLambda"])
        test["FullRetrainPredicted"] = np.clip(predict_ridge(test, coefficients), 35.0, 42.0)
        prediction_frames.append(test)
        weight_rows.append(
            {
                "FoldID": fold_id,
                "SelectedLambda": selected["SelectedLambda"],
                "InnerRMSE": selected["InnerRMSE"],
                "Intercept": coefficients[0],
                "WeightSourceMemory": coefficients[1],
                "WeightBatchSession": coefficients[2],
                "WeightHierarchicalResidual": coefficients[3],
            }
        )

    predictions = pd.concat(prediction_frames, ignore_index=True).sort_values(
        ["FoldID", "Source", "RowID"]
    )
    predictions["FrozenFinalPredicted"] = predictions["Predicted"]
    predictions["FinalPredictionDifference"] = (
        predictions["FullRetrainPredicted"] - predictions["FrozenFinalPredicted"]
    )
    metrics = calculate_metrics(predictions, "FullRetrainPredicted")

    frozen_by_row = frozen.set_index("RowID")
    generated_by_row = generated.set_index("RowID")
    branch_differences = {
        column: maximum_difference(
            generated_by_row[column].sort_index(),
            frozen_by_row[column].sort_index(),
        )
        for column in FEATURE_COLUMNS
    }
    metric_differences = {
        name: abs(float(metrics[name]) - float(EXPECTED[name]))
        for name in ["R2", "RMSE", "MAE", "AbsoluteErrorLE0_5"]
    }
    final_prediction_difference = float(predictions["FinalPredictionDifference"].abs().max())
    checks = {
        "source_memory_branch": branch_differences["SourceMemoryPredicted"] <= SOURCE_MEMORY_TOLERANCE_C,
        "batch_session_branch": branch_differences["BatchSessionPredicted"] <= EXACT_BRANCH_TOLERANCE_C,
        "hierarchical_residual_branch": branch_differences["HierarchicalResidualPredicted"] <= EXACT_BRANCH_TOLERANCE_C,
        "final_prediction": final_prediction_difference <= FINAL_PREDICTION_TOLERANCE_C,
        "final_metrics": max(metric_differences.values()) <= FINAL_METRIC_TOLERANCE,
    }
    status = "PASS" if all(checks.values()) else "FAIL"

    output_dir.mkdir(parents=True, exist_ok=True)
    prediction_columns = [
        "RecordID", "RowID", "CowKey", "Source", "FoldID", "Actual",
        *FEATURE_COLUMNS, "FrozenFinalPredicted", "FullRetrainPredicted",
        "FinalPredictionDifference",
    ]
    predictions[prediction_columns].to_csv(
        output_dir / "full_pipeline_retrained_oof_predictions.csv",
        index=False,
        encoding="utf-8",
        lineterminator="\n",
    )
    pd.DataFrame(weight_rows).to_csv(
        output_dir / "full_pipeline_stack_weights.csv",
        index=False,
        encoding="utf-8",
        lineterminator="\n",
    )
    pd.DataFrame([{"Model": "TH-SHRC full retrain", **metrics, "Status": status}]).to_csv(
        output_dir / "full_pipeline_retraining_metrics.csv",
        index=False,
        encoding="utf-8",
        lineterminator="\n",
    )
    result = {
        "status": status,
        "validation": "row-level same-animal random five-fold OOF",
        "checks": checks,
        "branch_max_abs_difference_C": branch_differences,
        "final_prediction_max_abs_difference_C": final_prediction_difference,
        "metric_differences": metric_differences,
        "metrics": metrics,
        "tolerances": {
            "source_memory_C": SOURCE_MEMORY_TOLERANCE_C,
            "exact_branch_C": EXACT_BRANCH_TOLERANCE_C,
            "final_prediction_C": FINAL_PREDICTION_TOLERANCE_C,
            "final_metric": FINAL_METRIC_TOLERANCE,
        },
    }
    (output_dir / "full_pipeline_retraining_verification.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frozen", type=Path, default=DEFAULT_FROZEN)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--rscript", type=Path)
    parser.add_argument(
        "--skip-upstream",
        action="store_true",
        help="Reuse existing upstream output files instead of retraining them.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = args.output_dir.resolve()
    rscript = find_rscript(args.rscript)
    if not args.skip_upstream:
        run_upstream(rscript, output_dir)
    result = reproduce(args.frozen.resolve(), output_dir)

    source_paths = list(UPSTREAM_DIR.glob("*.R")) + [
        Path(__file__),
        Path(__file__).with_name("reproduce_stack.py"),
    ]
    metadata = collect_runtime_metadata(
        source_paths,
        SHARED_ROOT,
        r_runtime=read_r_runtime(rscript),
    )
    (output_dir / "runtime_environment.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
