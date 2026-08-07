#!/usr/bin/env python3
"""Refit and verify the TH-SHRC ridge stack from reference OOF branches."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd


SHARED_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = SHARED_ROOT / "data" / "processed" / "th_shrc_oof_predictions.csv"
DEFAULT_OUTPUT_DIR = SHARED_ROOT / "outputs"
FEATURE_COLUMNS = [
    "SourceMemoryPredicted",
    "BatchSessionPredicted",
    "HierarchicalResidualPredicted",
]
LAMBDA_GRID = [0.0, 0.001, 0.01, 0.1, 1.0, 10.0, 100.0]
EXPECTED = {
    "N": 503,
    "CowCount": 30,
    "R2": 0.8551359051012453,
    "RMSE": 0.25195565941200593,
    "MAE": 0.1345534257161156,
    "AbsoluteErrorLE0_5": 0.9423459244532804,
}


def r2_score(actual: Iterable[float], predicted: Iterable[float]) -> float:
    actual_array = np.asarray(actual, dtype=float)
    predicted_array = np.asarray(predicted, dtype=float)
    denominator = np.sum((actual_array - np.mean(actual_array)) ** 2)
    if denominator <= 0:
        return float("nan")
    return float(
        1 - np.sum((actual_array - predicted_array) ** 2) / denominator
    )


def rmse(actual: Iterable[float], predicted: Iterable[float]) -> float:
    actual_array = np.asarray(actual, dtype=float)
    predicted_array = np.asarray(predicted, dtype=float)
    return float(np.sqrt(np.mean((actual_array - predicted_array) ** 2)))


def mae(actual: Iterable[float], predicted: Iterable[float]) -> float:
    actual_array = np.asarray(actual, dtype=float)
    predicted_array = np.asarray(predicted, dtype=float)
    return float(np.mean(np.abs(actual_array - predicted_array)))


def make_inner_folds(outer_train: pd.DataFrame, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    inner = np.zeros(len(outer_train), dtype=int)
    cows = pd.unique(outer_train["CowKey"])
    cow_values = outer_train["CowKey"].to_numpy()
    for cow in cows:
        indices = np.where(cow_values == cow)[0]
        rng.shuffle(indices)
        inner[indices] = np.arange(len(indices)) % 5
    return inner + 1


def fit_ridge(train: pd.DataFrame, regularization: float) -> np.ndarray:
    features = train[FEATURE_COLUMNS].to_numpy(float)
    design = np.column_stack([np.ones(len(train)), features])
    target = train["Actual"].to_numpy(float)
    penalty = np.eye(design.shape[1]) * regularization
    penalty[0, 0] = 0.0
    return np.linalg.pinv(design.T @ design + penalty) @ (design.T @ target)


def predict_ridge(data: pd.DataFrame, coefficients: np.ndarray) -> np.ndarray:
    features = data[FEATURE_COLUMNS].to_numpy(float)
    design = np.column_stack([np.ones(len(data)), features])
    return design @ coefficients


def choose_lambda(outer_train: pd.DataFrame, outer_fold: int) -> dict[str, float]:
    inner_folds = make_inner_folds(
        outer_train,
        20260523 + 3000 + int(outer_fold),
    )
    candidates: list[dict[str, float]] = []
    for regularization in LAMBDA_GRID:
        predictions = np.zeros(len(outer_train), dtype=float)
        for inner_fold in sorted(np.unique(inner_folds)):
            inner_train = outer_train.iloc[inner_folds != inner_fold].copy()
            inner_test = outer_train.iloc[inner_folds == inner_fold].copy()
            coefficients = fit_ridge(inner_train, regularization)
            predictions[inner_folds == inner_fold] = predict_ridge(
                inner_test, coefficients
            )
        candidates.append(
            {
                "SelectedLambda": regularization,
                "InnerRMSE": rmse(outer_train["Actual"], predictions),
                "InnerR2": r2_score(outer_train["Actual"], predictions),
                "InnerMAE": mae(outer_train["Actual"], predictions),
            }
        )
    return min(candidates, key=lambda row: (row["InnerRMSE"], row["SelectedLambda"]))


def require_input_scope(data: pd.DataFrame) -> None:
    required = {
        "RecordID",
        "FoldMode",
        "FoldID",
        "RowID",
        "CowKey",
        "Source",
        "Actual",
        "Predicted",
        "Residual",
        "SelectedLambda",
        "InnerChoiceRMSE",
        "StackIntercept",
        "StackWeightSourceMemory",
        "StackWeightBatchSession",
        "StackWeightHierarchicalResidual",
        *FEATURE_COLUMNS,
    }
    missing = sorted(required - set(data.columns))
    if missing:
        raise RuntimeError(f"Input is missing required fields: {missing}")
    if len(data) != EXPECTED["N"] or data["RowID"].nunique() != EXPECTED["N"]:
        raise RuntimeError(
            f"Expected 503 unique rows, got N={len(data)}, unique RowID={data['RowID'].nunique()}"
        )
    if data["CowKey"].nunique() != EXPECTED["CowCount"]:
        raise RuntimeError(
            f"Expected 30 CowKey values, got {data['CowKey'].nunique()}"
        )
    if set(data["FoldID"].astype(int)) != {1, 2, 3, 4, 5}:
        raise RuntimeError("FoldID must contain exactly 1, 2, 3, 4, and 5")
    if set(data["FoldMode"].astype(str)) != {"within_cow_random5"}:
        raise RuntimeError("Unexpected validation mode")
    if "CowID_raw" in data.columns:
        raise RuntimeError("Public reproduction input must not contain CowID_raw")


def calculate_metrics(data: pd.DataFrame, prediction_column: str) -> dict[str, float]:
    actual = data["Actual"].to_numpy(float)
    predicted = data[prediction_column].to_numpy(float)
    errors = actual - predicted
    return {
        "N": int(len(data)),
        "CowCount": int(data["CowKey"].nunique()),
        "R2": r2_score(actual, predicted),
        "RMSE": rmse(actual, predicted),
        "MAE": mae(actual, predicted),
        "Bias": float(np.mean(errors)),
        "ErrorSD": float(np.std(errors, ddof=1)),
        "AbsoluteErrorLE0_5": float(np.mean(np.abs(errors) <= 0.5)),
    }


def reproduce(input_path: Path, output_dir: Path, tolerance: float) -> dict[str, object]:
    data = pd.read_csv(input_path)
    require_input_scope(data)

    prediction_frames: list[pd.DataFrame] = []
    weight_rows: list[dict[str, object]] = []
    for outer_fold in sorted(data["FoldID"].astype(int).unique()):
        outer_train = data[data["FoldID"].astype(int) != outer_fold].copy()
        outer_test = data[data["FoldID"].astype(int) == outer_fold].copy()
        selected = choose_lambda(outer_train, outer_fold)
        coefficients = fit_ridge(outer_train, selected["SelectedLambda"])
        reproduced = np.clip(predict_ridge(outer_test, coefficients), 35.0, 42.0)

        result = outer_test[
            ["RecordID", "RowID", "CowKey", "Source", "FoldID", "Actual", "Predicted"]
        ].copy()
        result = result.rename(columns={"Predicted": "FrozenPredicted"})
        result["ReproducedPredicted"] = reproduced
        result["PredictionDifference"] = (
            result["ReproducedPredicted"] - result["FrozenPredicted"]
        )
        result["ReproducedResidual"] = (
            result["Actual"] - result["ReproducedPredicted"]
        )
        prediction_frames.append(result)

        frozen = outer_test.iloc[0]
        frozen_columns = {
            "SelectedLambda": float(frozen["SelectedLambda"]),
            "InnerRMSE": float(frozen["InnerChoiceRMSE"]),
            "Intercept": float(frozen["StackIntercept"]),
            "WeightSourceMemory": float(frozen["StackWeightSourceMemory"]),
            "WeightBatchSession": float(frozen["StackWeightBatchSession"]),
            "WeightHierarchicalResidual": float(frozen["StackWeightHierarchicalResidual"]),
        }
        if any(
            outer_test[column].nunique(dropna=False) != 1
            for column in [
                "SelectedLambda",
                "InnerChoiceRMSE",
                "StackIntercept",
                "StackWeightSourceMemory",
                "StackWeightBatchSession",
                "StackWeightHierarchicalResidual",
            ]
        ):
            raise RuntimeError(f"Frozen stack settings are not constant in fold {outer_fold}")
        reproduced_columns = {
            "SelectedLambda": float(selected["SelectedLambda"]),
            "InnerRMSE": float(selected["InnerRMSE"]),
            "Intercept": float(coefficients[0]),
            "WeightSourceMemory": float(coefficients[1]),
            "WeightBatchSession": float(coefficients[2]),
            "WeightHierarchicalResidual": float(coefficients[3]),
        }
        weight_row: dict[str, object] = {
            "FoldID": outer_fold,
            "OuterTrainN": len(outer_train),
            "OuterTestN": len(outer_test),
            "InnerR2": selected["InnerR2"],
            "InnerMAE": selected["InnerMAE"],
        }
        for name, value in reproduced_columns.items():
            weight_row[name] = value
            weight_row[f"Frozen{name}"] = frozen_columns[name]
            weight_row[f"{name}AbsDifference"] = abs(value - frozen_columns[name])
        weight_rows.append(weight_row)

    predictions = pd.concat(prediction_frames, ignore_index=True).sort_values(
        ["FoldID", "Source", "RowID"]
    )
    weights = pd.DataFrame(weight_rows)
    metrics = calculate_metrics(predictions, "ReproducedPredicted")

    prediction_max_diff = float(predictions["PredictionDifference"].abs().max())
    weight_difference_columns = [
        column for column in weights.columns if column.endswith("AbsDifference")
    ]
    weight_max_diff = float(weights[weight_difference_columns].to_numpy(float).max())
    metric_differences = {
        name: abs(float(metrics[name]) - float(expected))
        for name, expected in EXPECTED.items()
    }
    metric_max_diff = max(metric_differences.values())
    residual_max_diff = float(
        np.max(
            np.abs(
                predictions["ReproducedResidual"].to_numpy(float)
                - (
                    predictions["Actual"].to_numpy(float)
                    - predictions["ReproducedPredicted"].to_numpy(float)
                )
            )
        )
    )
    status = "PASS" if max(
        prediction_max_diff,
        weight_max_diff,
        metric_max_diff,
        residual_max_diff,
    ) <= tolerance else "FAIL"

    output_dir.mkdir(parents=True, exist_ok=True)
    predictions_path = output_dir / "th_shrc_reproduced_oof_predictions.csv"
    weights_path = output_dir / "th_shrc_stack_weights.csv"
    metrics_path = output_dir / "model_metrics.csv"
    report_path = output_dir / "temperature_reproduction_report.md"
    predictions.to_csv(predictions_path, index=False, encoding="utf-8", lineterminator="\n")
    weights.to_csv(weights_path, index=False, encoding="utf-8", lineterminator="\n")

    metrics_row = {
        "Model": "TH-SHRC",
        "FullName": "Thermal-Hysteresis-aware Stacked Hierarchical Residual Compensation",
        "Validation": "row-level within-cow random five-fold OOF",
        **metrics,
        "MaxPredictionAbsDifference": prediction_max_diff,
        "MaxStackSettingAbsDifference": weight_max_diff,
        "MaxExpectedMetricAbsDifference": metric_max_diff,
        "Status": status,
    }
    pd.DataFrame([metrics_row]).to_csv(
        metrics_path, index=False, encoding="utf-8", lineterminator="\n"
    )

    report = f"""# TH-SHRC temperature reproduction

| Item | Value |
|---|---:|
| Status | {status} |
| Rows | {len(data)} |
| Cattle | {data['CowKey'].nunique()} |
| R2 | {metrics['R2']:.15f} |
| RMSE (C) | {metrics['RMSE']:.15f} |
| MAE (C) | {metrics['MAE']:.15f} |
| Absolute error <= 0.5 C | {metrics['AbsoluteErrorLE0_5']:.15f} |
| Maximum prediction difference (C) | {prediction_max_diff:.12g} |
| Maximum stack-setting difference | {weight_max_diff:.12g} |
| Maximum metric difference | {metric_max_diff:.12g} |

Validation: same-cow random five-fold OOF. The command refits the nested ridge stack from the three branch-level OOF prediction columns.
"""
    report_path.write_text(report, encoding="utf-8", newline="\n")

    return {
        "status": status,
        "rows": len(predictions),
        "cows": int(data["CowKey"].nunique()),
        "r2": metrics["R2"],
        "rmse": metrics["RMSE"],
        "mae": metrics["MAE"],
        "prediction_max_abs_diff": prediction_max_diff,
        "stack_setting_max_abs_diff": weight_max_diff,
        "metric_max_abs_diff": metric_max_diff,
        "outputs": {
            "predictions": predictions_path.relative_to(SHARED_ROOT).as_posix(),
            "weights": weights_path.relative_to(SHARED_ROOT).as_posix(),
            "metrics": metrics_path.relative_to(SHARED_ROOT).as_posix(),
            "report": report_path.relative_to(SHARED_ROOT).as_posix(),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--tolerance", type=float, default=1e-8)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = reproduce(args.input.resolve(), args.output_dir.resolve(), args.tolerance)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
