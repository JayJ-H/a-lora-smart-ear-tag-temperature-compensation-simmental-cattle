#!/usr/bin/env python3
"""Nested ridge utilities used by the TH-SHRC reproduction workflow."""

from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd


FEATURE_COLUMNS = [
    "SourceMemoryPredicted",
    "BatchSessionPredicted",
    "HierarchicalResidualPredicted",
]
LAMBDA_GRID = [0.0, 0.001, 0.01, 0.1, 1.0, 10.0, 100.0]


def r2_score(actual: Iterable[float], predicted: Iterable[float]) -> float:
    actual_array = np.asarray(actual, dtype=float)
    predicted_array = np.asarray(predicted, dtype=float)
    denominator = np.sum((actual_array - np.mean(actual_array)) ** 2)
    if denominator <= 0:
        return float("nan")
    return float(1 - np.sum((actual_array - predicted_array) ** 2) / denominator)


def rmse(actual: Iterable[float], predicted: Iterable[float]) -> float:
    actual_array = np.asarray(actual, dtype=float)
    predicted_array = np.asarray(predicted, dtype=float)
    return float(np.sqrt(np.mean((actual_array - predicted_array) ** 2)))


def mae(actual: Iterable[float], predicted: Iterable[float]) -> float:
    actual_array = np.asarray(actual, dtype=float)
    predicted_array = np.asarray(predicted, dtype=float)
    return float(np.mean(np.abs(actual_array - predicted_array)))


def make_inner_folds(outer_train: pd.DataFrame, seed: int) -> np.ndarray:
    if "MeasurementUnitID" not in outer_train.columns:
        raise RuntimeError("MeasurementUnitID is required for grouped inner folds")
    rng = np.random.default_rng(seed)
    inner = np.zeros(len(outer_train), dtype=int)
    cow_values = outer_train["CowKey"].to_numpy()
    unit_values = outer_train["MeasurementUnitID"].astype(str).to_numpy()
    for cow in pd.unique(cow_values):
        indices = np.where(cow_values == cow)[0]
        units = pd.unique(unit_values[indices])
        rng.shuffle(units)
        unit_folds = {unit: index % 5 for index, unit in enumerate(units)}
        inner[indices] = np.asarray([unit_folds[unit] for unit in unit_values[indices]])
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
    inner_folds = make_inner_folds(outer_train, 20260523 + 3000 + int(outer_fold))
    candidates: list[dict[str, float]] = []
    for regularization in LAMBDA_GRID:
        predictions = np.zeros(len(outer_train), dtype=float)
        for inner_fold in sorted(np.unique(inner_folds)):
            inner_train = outer_train.iloc[inner_folds != inner_fold]
            inner_test = outer_train.iloc[inner_folds == inner_fold]
            coefficients = fit_ridge(inner_train, regularization)
            predictions[inner_folds == inner_fold] = predict_ridge(
                inner_test, coefficients
            )
        candidates.append(
            {
                "SelectedLambda": float(regularization),
                "InnerRMSE": rmse(outer_train["Actual"], predictions),
                "InnerR2": r2_score(outer_train["Actual"], predictions),
                "InnerMAE": mae(outer_train["Actual"], predictions),
            }
        )
    return min(candidates, key=lambda row: (row["InnerRMSE"], row["SelectedLambda"]))


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
