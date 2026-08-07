#!/usr/bin/env python3
"""Recompute TH-SHRC mechanism ablations, bootstrap, and disabled-route OOF predictions."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd


SHARED_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = SHARED_ROOT / "data" / "processed"
DEFAULT_FULL_INPUT = DATA_DIR / "th_shrc_oof_predictions.csv"
DEFAULT_ABLATION_INPUT = DATA_DIR / "th_shrc_ablation_oof_predictions.csv"
DEFAULT_CANDIDATE_INPUT = DATA_DIR / "th_shrc_mechanism_candidate_oof_predictions.csv"
DEFAULT_PAIRED_INPUT = DATA_DIR / "paired_temperature_records.csv"
DEFAULT_BRANCH_INPUT = DATA_DIR / "th_shrc_mechanism_branch_inputs.csv"
DEFAULT_MECHANISM_CHOICES = DATA_DIR / "th_shrc_mechanism_choices.csv"
DEFAULT_METRICS = DATA_DIR / "th_shrc_ablation_metrics.csv"
DEFAULT_BOOTSTRAP = DATA_DIR / "th_shrc_ablation_bootstrap.csv"
DEFAULT_OUTPUT = SHARED_ROOT / "outputs" / "analysis" / "ablation"
SEED = 20260723
BOOTSTRAP_REPLICATES = 10000
LAMBDA_GRID = [0.0, 0.001, 0.01, 0.1, 1.0, 10.0, 100.0]
AB_FEATURES = ["SourceMemoryPredicted", "BatchSessionPredicted"]
CANDIDATE_COLUMNS = [
    "eb_exact", "eb_medium", "eb_coarse",
    "global_exact", "global_medium", "global_coarse",
    "may_session", "may_session_hour", "ridge",
    "xgb_residual", "direct_xgb",
]
GLOBAL_CANDIDATE_COLUMNS = ["global_exact", "global_medium", "global_coarse"]
MEMORY_CONFIGS = [
    ("global_k1_t2_e03_a5", 1, 2.0, 0.3, 5.0, 1.0),
    ("global_k1_t2_e06_a5", 1, 2.0, 0.6, 5.0, 1.0),
    ("global_k1_t2_e06_a10", 1, 2.0, 0.6, 10.0, 1.0),
    ("global_k2_t2_e03_a5_b05", 2, 2.0, 0.3, 5.0, 0.5),
    ("global_k2_t2_e06_a5_b05", 2, 2.0, 0.6, 5.0, 0.5),
    ("global_k2_t2_e06_a10_b05", 2, 2.0, 0.6, 10.0, 0.5),
    ("global_k2_t2_e03_a5_b1", 2, 2.0, 0.3, 5.0, 1.0),
    ("global_k2_t2_e06_a5_b1", 2, 2.0, 0.6, 5.0, 1.0),
]
CONFIGURATIONS = [
    ("Full A+B+C", "Predicted_Full_ABC_C"),
    ("w/o C (A+B)", "Predicted_Without_C_AB_C"),
    ("w/o B (A+C)", "Predicted_Without_B_AC_C"),
    ("w/o A (B+C)", "Predicted_Without_A_BC_C"),
]
BOOTSTRAP_COLUMNS = {
    "w/o A (B+C)": "Predicted_Without_A_BC_C",
    "w/o B (A+C)": "Predicted_Without_B_AC_C",
    "w/o C (A+B)": "Predicted_Without_C_AB_C",
}


def r2_score(actual: Iterable[float], predicted: Iterable[float]) -> float:
    actual_array = np.asarray(actual, dtype=float)
    predicted_array = np.asarray(predicted, dtype=float)
    denominator = np.sum((actual_array - np.mean(actual_array)) ** 2)
    return float(1.0 - np.sum((actual_array - predicted_array) ** 2) / denominator)


def calculate_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    errors = actual - predicted
    absolute_errors = np.abs(errors)
    return {
        "N": int(len(actual)),
        "R2": r2_score(actual, predicted),
        "RMSE_C": float(np.sqrt(np.mean(errors**2))),
        "MAE_C": float(np.mean(absolute_errors)),
        "Bias_C": float(np.mean(errors)),
        "MedianAE_C": float(np.median(absolute_errors)),
        "P95_AE_C": float(np.quantile(absolute_errors, 0.95)),
        "Within_0_2C": float(np.mean(absolute_errors <= 0.2)),
        "Within_0_3C": float(np.mean(absolute_errors <= 0.3)),
        "Within_0_5C": float(np.mean(absolute_errors <= 0.5)),
    }


def require_inputs(full: pd.DataFrame, ablation: pd.DataFrame) -> None:
    full_required = {
        "RecordID", "RowID", "FoldID", "CowKey", "Source", "Actual",
        "Ear", "Air", "Time", "Predicted", "HierarchicalResidualPredicted", *AB_FEATURES,
    }
    ablation_required = {
        "RecordID", "RowID", "FoldID", "CowKey", "Source", "Actual_C",
        *(column for _, column in CONFIGURATIONS),
    }
    for name, frame, required in [
        ("full", full, full_required),
        ("ablation", ablation, ablation_required),
    ]:
        missing = sorted(required - set(frame.columns))
        if missing:
            raise ValueError(f"{name} input is missing columns: {missing}")
        if len(frame) != 503 or frame["RowID"].nunique() != 503:
            raise ValueError(f"{name} input must contain 503 unique RowID values")
        if frame["CowKey"].nunique() != 30:
            raise ValueError(f"{name} input must contain 30 anonymous CowKey values")
        if set(frame["FoldID"].astype(int)) != {1, 2, 3, 4, 5}:
            raise ValueError(f"{name} input must contain five outer folds")
        if "CowID_raw" in frame.columns:
            raise ValueError(f"{name} public input must not contain CowID_raw")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def align_inputs(full: pd.DataFrame, ablation: pd.DataFrame) -> tuple[pd.DataFrame, float]:
    columns = [
        "RecordID", "RowID", "FoldID", "CowKey", "Source", "Actual", "Predicted",
    ]
    aligned = ablation.merge(
        full[columns], on="RowID", how="left", suffixes=("", "_full"), validate="one_to_one"
    )
    identity_ok = (
        (aligned["RecordID"] == aligned["RecordID_full"])
        & (aligned["FoldID"].astype(int) == aligned["FoldID_full"].astype(int))
        & (aligned["CowKey"] == aligned["CowKey_full"])
        & (aligned["Source"] == aligned["Source_full"])
    ).all()
    if not identity_ok:
        raise ValueError("Ablation and full OOF row identities do not align")
    maximum_difference = float(
        max(
            np.max(np.abs(aligned["Actual_C"] - aligned["Actual"])),
            np.max(
                np.abs(aligned["Predicted_Full_ABC_C"] - aligned["Predicted"])
            ),
        )
    )
    return aligned, maximum_difference


def make_inner_folds(outer_train: pd.DataFrame, outer_fold: int) -> np.ndarray:
    rng = np.random.default_rng(20260523 + 3000 + int(outer_fold))
    inner = np.zeros(len(outer_train), dtype=int)
    cow_values = outer_train["CowKey"].to_numpy()
    for cow in pd.unique(outer_train["CowKey"]):
        indices = np.where(cow_values == cow)[0]
        rng.shuffle(indices)
        inner[indices] = np.arange(len(indices)) % 5
    return inner + 1


def fit_ridge(train: pd.DataFrame, regularization: float) -> np.ndarray:
    features = train[AB_FEATURES].to_numpy(float)
    design = np.column_stack([np.ones(len(train)), features])
    target = train["Actual"].to_numpy(float)
    penalty = np.eye(design.shape[1]) * regularization
    penalty[0, 0] = 0.0
    return np.linalg.pinv(design.T @ design + penalty) @ (design.T @ target)


def predict_ridge(data: pd.DataFrame, coefficients: np.ndarray) -> np.ndarray:
    features = data[AB_FEATURES].to_numpy(float)
    return np.column_stack([np.ones(len(data)), features]) @ coefficients


def choose_lambda(outer_train: pd.DataFrame, outer_fold: int) -> tuple[float, float]:
    inner_folds = make_inner_folds(outer_train, outer_fold)
    candidates: list[tuple[float, float]] = []
    for regularization in LAMBDA_GRID:
        predictions = np.zeros(len(outer_train), dtype=float)
        for inner_fold in sorted(np.unique(inner_folds)):
            train = outer_train.iloc[inner_folds != inner_fold]
            test = outer_train.iloc[inner_folds == inner_fold]
            coefficients = fit_ridge(train, regularization)
            predictions[inner_folds == inner_fold] = predict_ridge(test, coefficients)
        inner_rmse = float(
            np.sqrt(np.mean((outer_train["Actual"].to_numpy(float) - predictions) ** 2))
        )
        candidates.append((regularization, inner_rmse))
    return min(candidates, key=lambda item: (item[1], item[0]))


def reproduce_without_c(full: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    prediction_parts: list[pd.DataFrame] = []
    choices: list[dict[str, float]] = []
    for outer_fold in sorted(full["FoldID"].astype(int).unique()):
        train = full[full["FoldID"].astype(int) != outer_fold].copy()
        test = full[full["FoldID"].astype(int) == outer_fold].copy()
        regularization, inner_rmse = choose_lambda(train, outer_fold)
        coefficients = fit_ridge(train, regularization)
        predicted = np.clip(predict_ridge(test, coefficients), 35.0, 42.0)
        part = test[["RecordID", "RowID", "FoldID", "CowKey", "Source", "Actual"]].copy()
        part["Reproduced_Without_C_AB_C"] = predicted
        prediction_parts.append(part)
        choices.append(
            {
                "FoldID": int(outer_fold),
                "SelectedLambda": regularization,
                "InnerRMSE": inner_rmse,
                "Intercept": float(coefficients[0]),
                "WeightA": float(coefficients[1]),
                "WeightB": float(coefficients[2]),
            }
        )
    predictions = pd.concat(prediction_parts, ignore_index=True).sort_values("RowID")
    return predictions, pd.DataFrame(choices)


def fit_feature_ridge(
    train: pd.DataFrame, feature_columns: list[str], regularization: float
) -> np.ndarray:
    design = np.column_stack(
        [np.ones(len(train)), train[feature_columns].to_numpy(float)]
    )
    target = train["Actual"].to_numpy(float)
    penalty = np.eye(design.shape[1]) * regularization
    penalty[0, 0] = 0.0
    return np.linalg.pinv(design.T @ design + penalty) @ (design.T @ target)


def predict_feature_ridge(
    data: pd.DataFrame, feature_columns: list[str], coefficients: np.ndarray
) -> np.ndarray:
    design = np.column_stack(
        [np.ones(len(data)), data[feature_columns].to_numpy(float)]
    )
    return design @ coefficients


def cross_fitted_feature_stack(
    frame: pd.DataFrame, feature_columns: list[str], method: str
) -> tuple[np.ndarray, pd.DataFrame]:
    predictions = np.zeros(len(frame), dtype=float)
    choices: list[dict[str, object]] = []
    for outer_fold in sorted(frame["FoldID"].astype(int).unique()):
        train = frame[frame["FoldID"].astype(int) != outer_fold].copy()
        test = frame[frame["FoldID"].astype(int) == outer_fold].copy()
        inner_folds = make_inner_folds(train, outer_fold)
        candidates: list[tuple[float, float]] = []
        for regularization in LAMBDA_GRID:
            inner_predictions = np.zeros(len(train), dtype=float)
            for inner_fold in sorted(np.unique(inner_folds)):
                inner_train = train.iloc[inner_folds != inner_fold]
                inner_valid = train.iloc[inner_folds == inner_fold]
                coefficients = fit_feature_ridge(
                    inner_train, feature_columns, regularization
                )
                inner_predictions[inner_folds == inner_fold] = predict_feature_ridge(
                    inner_valid, feature_columns, coefficients
                )
            candidates.append(
                (
                    regularization,
                    float(
                        np.sqrt(
                            np.mean(
                                (
                                    train["Actual"].to_numpy(float)
                                    - inner_predictions
                                )
                                ** 2
                            )
                        )
                    ),
                )
            )
        regularization, inner_rmse = min(
            candidates, key=lambda item: (item[1], item[0])
        )
        coefficients = fit_feature_ridge(train, feature_columns, regularization)
        predictions[test.index] = np.clip(
            predict_feature_ridge(test, feature_columns, coefficients), 35.0, 42.0
        )
        choice: dict[str, object] = {
            "Method": method,
            "FoldID": int(outer_fold),
            "SelectedLambda": regularization,
            "InnerRMSE": inner_rmse,
        }
        for index, value in enumerate(coefficients):
            choice[f"Beta_{index}"] = float(value)
        choices.append(choice)
    return predictions, pd.DataFrame(choices)


def simplex_weights(dimension: int, step: float = 0.05) -> np.ndarray:
    values = np.arange(0.0, 1.0 + 1e-12, step)
    if dimension == 1:
        return np.ones((1, 1))
    if dimension == 2:
        return np.array([[a, 1.0 - a] for a in values])
    if dimension == 3:
        return np.array(
            [
                [a, b, 1.0 - a - b]
                for a in values
                for b in values
                if a + b <= 1.0 + 1e-12
            ]
        )
    raise ValueError("Only up to three selected candidates are supported")


def select_candidate_mix(
    train: pd.DataFrame, candidate_columns: list[str], mask: np.ndarray | None = None
) -> dict[str, object]:
    all_predictions = train[candidate_columns].to_numpy(float)
    if mask is None:
        mask = np.ones(len(train), dtype=bool)
    valid = mask & np.isfinite(all_predictions).all(axis=1)
    if valid.sum() < 8:
        valid = np.isfinite(all_predictions).all(axis=1)
    target = train.loc[valid, "Actual"].to_numpy(float)
    predictions = train.loc[valid, candidate_columns].to_numpy(float)
    individual_rmse = np.sqrt(np.mean((predictions - target[:, None]) ** 2, axis=0))
    strongest = [
        candidate_columns[index]
        for index in np.argsort(individual_rmse)[: min(3, len(candidate_columns))]
    ]
    best: dict[str, object] = {
        "rmse": np.inf,
        "columns": [candidate_columns[0]],
        "weights": np.array([1.0]),
        "n": int(valid.sum()),
    }
    for column in candidate_columns:
        score = float(
            np.sqrt(
                np.mean(
                    (train.loc[valid, column].to_numpy(float) - target) ** 2
                )
            )
        )
        if score < float(best["rmse"]):
            best = {
                "rmse": score,
                "columns": [column],
                "weights": np.array([1.0]),
                "n": int(valid.sum()),
            }
    weights = simplex_weights(len(strongest))
    mixtures = train.loc[valid, strongest].to_numpy(float) @ weights.T
    scores = np.sqrt(np.mean((mixtures - target[:, None]) ** 2, axis=0))
    selected = int(np.argmin(scores))
    if scores[selected] < float(best["rmse"]):
        best = {
            "rmse": float(scores[selected]),
            "columns": strongest,
            "weights": weights[selected],
            "n": int(valid.sum()),
        }
    return best


def candidate_replay_oof(
    frame: pd.DataFrame,
    candidate_columns: list[str],
    method: str,
    by_source: bool,
) -> tuple[np.ndarray, pd.DataFrame]:
    predictions = np.zeros(len(frame), dtype=float)
    choices: list[dict[str, object]] = []
    for outer_fold in sorted(frame["FoldID"].astype(int).unique()):
        train = frame[frame["FoldID"].astype(int) != outer_fold]
        test = frame[frame["FoldID"].astype(int) == outer_fold]
        groups = sorted(test["Source"].astype(str).unique()) if by_source else ["ALL"]
        for group in groups:
            if by_source:
                train_mask = train["Source"].astype(str).to_numpy() == group
                test_mask = test["Source"].astype(str).to_numpy() == group
            else:
                train_mask = np.ones(len(train), dtype=bool)
                test_mask = np.ones(len(test), dtype=bool)
            selected = select_candidate_mix(train, candidate_columns, train_mask)
            selected_columns = list(selected["columns"])
            selected_weights = np.asarray(selected["weights"], dtype=float)
            predictions[test.index[test_mask]] = (
                test.loc[test_mask, selected_columns].to_numpy(float)
                @ selected_weights
            )
            choice: dict[str, object] = {
                "Method": method,
                "FoldID": int(outer_fold),
                "Source": group,
                "ChosenCandidates": "+".join(selected_columns),
                "InnerRMSE": float(selected["rmse"]),
                "TrainingN": int(selected["n"]),
            }
            for column, weight in zip(selected_columns, selected_weights):
                choice[f"Weight_{column}"] = float(weight)
            choices.append(choice)
    return predictions, pd.DataFrame(choices)


def circular_time_distance(left: np.ndarray, right: float) -> np.ndarray:
    difference = np.abs(left - right)
    return np.minimum(difference, 24.0 - difference)


def memory_predict(
    train: pd.DataFrame, test: pd.DataFrame, configuration: tuple[object, ...]
) -> np.ndarray:
    _, neighbor_count, time_bandwidth, ear_bandwidth, air_bandwidth, kernel_bandwidth = configuration
    train_time = train["Time"].to_numpy(float)
    train_ear = train["Ear"].to_numpy(float)
    train_air = train["Air"].to_numpy(float)
    train_actual = train["Actual"].to_numpy(float)
    train_weight = train["SourceWeight"].to_numpy(float)
    output = np.zeros(len(test), dtype=float)
    for row_index, row in enumerate(test.itertuples()):
        distance_squared = (
            (circular_time_distance(train_time, row.Time) / time_bandwidth) ** 2
            + (np.abs(train_ear - row.Ear) / ear_bandwidth) ** 2
            + (np.abs(train_air - row.Air) / air_bandwidth) ** 2
        )
        neighbors = np.argsort(distance_squared)[: min(int(neighbor_count), len(train))]
        if len(neighbors) == 1:
            output[row_index] = train_actual[neighbors[0]]
        else:
            weights = (
                np.exp(
                    -0.5
                    * distance_squared[neighbors]
                    / float(kernel_bandwidth) ** 2
                )
                * np.maximum(train_weight[neighbors], 1e-6)
            )
            output[row_index] = (
                np.sum(weights * train_actual[neighbors]) / np.sum(weights)
                if weights.sum() > 1e-12
                else train_actual[neighbors].mean()
            )
    return output


def pure_memory_oof(frame: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
    predictions = np.zeros(len(frame), dtype=float)
    choices: list[dict[str, object]] = []
    for outer_fold in sorted(frame["FoldID"].astype(int).unique()):
        train = frame[frame["FoldID"].astype(int) != outer_fold].copy()
        test = frame[frame["FoldID"].astype(int) == outer_fold].copy()
        rng = np.random.default_rng(20260523 + 1000 + int(outer_fold))
        inner_folds = np.zeros(len(train), dtype=int)
        cow_values = train["CowKey"].astype(str).to_numpy()
        for cow in pd.unique(cow_values):
            indices = np.where(cow_values == cow)[0]
            rng.shuffle(indices)
            inner_folds[indices] = np.arange(len(indices)) % 5
        inner_folds += 1
        inner_predictions = np.zeros((len(train), len(MEMORY_CONFIGS)))
        for inner_fold in sorted(np.unique(inner_folds)):
            inner_train = train.iloc[inner_folds != inner_fold]
            inner_valid = train.iloc[inner_folds == inner_fold]
            for config_index, configuration in enumerate(MEMORY_CONFIGS):
                inner_predictions[inner_folds == inner_fold, config_index] = memory_predict(
                    inner_train, inner_valid, configuration
                )
        for source in sorted(test["Source"].astype(str).unique()):
            source_train = train["Source"].astype(str).to_numpy() == source
            if source_train.sum() < 8:
                source_train = np.ones(len(train), dtype=bool)
            scores = [
                float(
                    np.sqrt(
                        np.mean(
                            (
                                train["Actual"].to_numpy(float)[source_train]
                                - inner_predictions[source_train, config_index]
                            )
                            ** 2
                        )
                    )
                )
                for config_index in range(len(MEMORY_CONFIGS))
            ]
            selected_index = int(np.argmin(scores))
            source_test = test["Source"].astype(str).to_numpy() == source
            predictions[test.index[source_test]] = memory_predict(
                train, test.loc[source_test], MEMORY_CONFIGS[selected_index]
            )
            choices.append(
                {
                    "Method": "Pure thermal-state memory",
                    "FoldID": int(outer_fold),
                    "Source": source,
                    "Configuration": MEMORY_CONFIGS[selected_index][0],
                    "InnerRMSE": scores[selected_index],
                }
            )
    return predictions, pd.DataFrame(choices)


def build_mechanism_frame(
    full: pd.DataFrame, candidates: pd.DataFrame, paired: pd.DataFrame
) -> pd.DataFrame:
    candidate_required = {
        "RowID", "FoldID", "CowKey", "Source", *CANDIDATE_COLUMNS
    }
    paired_required = {"RecordID", "RowID", "CowKey", "Source", "SourceWeight"}
    for name, frame, required in [
        ("candidate", candidates, candidate_required),
        ("paired", paired, paired_required),
    ]:
        missing = sorted(required - set(frame.columns))
        if missing:
            raise ValueError(f"{name} input is missing columns: {missing}")
        if len(frame) != 503 or frame["RowID"].nunique() != 503:
            raise ValueError(f"{name} input must contain 503 unique RowID values")
        if "CowID_raw" in frame.columns:
            raise ValueError(f"{name} public input must not contain CowID_raw")

    candidate_identity_columns = ["RowID", "FoldID", "CowKey", "Source"]
    if "RecordID" in candidates.columns:
        candidate_identity_columns.insert(0, "RecordID")
    candidate_identity = full[candidate_identity_columns].merge(
        candidates[candidate_identity_columns],
        on="RowID",
        how="left",
        suffixes=("", "_candidate"),
        validate="one_to_one",
    )
    if not all(
        (
            candidate_identity[column].astype(str)
            == candidate_identity[f"{column}_candidate"].astype(str)
        ).all()
        for column in candidate_identity_columns
        if column != "RowID"
    ):
        raise ValueError("Candidate input identities do not align with full OOF rows")

    paired_identity = full[["RecordID", "RowID", "CowKey", "Source"]].merge(
        paired[["RecordID", "RowID", "CowKey", "Source"]],
        on="RowID",
        how="left",
        suffixes=("", "_paired"),
        validate="one_to_one",
    )
    if not all(
        (
            paired_identity[column].astype(str)
            == paired_identity[f"{column}_paired"].astype(str)
        ).all()
        for column in ["RecordID", "CowKey", "Source"]
    ):
        raise ValueError("Paired input identities do not align with full OOF rows")

    frame = full[
        [
            "RecordID", "RowID", "FoldID", "CowKey", "Source",
            "Ear", "Air", "Time", "Actual", "Predicted",
            "SourceMemoryPredicted", "BatchSessionPredicted",
            "HierarchicalResidualPredicted",
        ]
    ].copy()
    frame = frame.merge(
        paired[["RowID", "SourceWeight"]], on="RowID", how="left", validate="one_to_one"
    )
    frame = frame.merge(
        candidates[["RowID", *CANDIDATE_COLUMNS]],
        on="RowID",
        how="left",
        validate="one_to_one",
    )
    frame = frame.sort_values("RowID").reset_index(drop=True)
    if frame[["SourceWeight", *CANDIDATE_COLUMNS]].isna().any().any():
        raise ValueError("Mechanism replay inputs contain missing required values")
    return frame


def attach_saved_branch_inputs(
    frame: pd.DataFrame, branch_inputs: pd.DataFrame
) -> tuple[pd.DataFrame, float]:
    required = {
        "RecordID", "RowID", "FoldID", "CowKey", "Source",
        "Ear", "Air", "Time", "Actual", "A_full", "B_full", "C_full",
        "OriginalFullPrediction", "PureMemory", "GlobalThermalCells",
    }
    missing = sorted(required - set(branch_inputs.columns))
    if missing:
        raise ValueError(f"saved branch input is missing columns: {missing}")
    if len(branch_inputs) != 503 or branch_inputs["RowID"].nunique() != 503:
        raise ValueError("saved branch input must contain 503 unique RowID values")
    if "CowID_raw" in branch_inputs.columns:
        raise ValueError("saved branch public input must not contain CowID_raw")

    identity_columns = ["RecordID", "RowID", "FoldID", "CowKey", "Source"]
    identity = frame[identity_columns].merge(
        branch_inputs[identity_columns],
        on="RowID",
        how="left",
        suffixes=("", "_saved"),
        validate="one_to_one",
    )
    if not all(
        (
            identity[column].astype(str)
            == identity[f"{column}_saved"].astype(str)
        ).all()
        for column in ["RecordID", "FoldID", "CowKey", "Source"]
    ):
        raise ValueError("Saved branch inputs do not align with public OOF rows")

    aligned = frame.merge(
        branch_inputs[
            [
                "RowID", "Ear", "Air", "Time", "Actual", "A_full", "B_full",
                "C_full", "OriginalFullPrediction", "PureMemory",
                "GlobalThermalCells",
            ]
        ],
        on="RowID",
        how="left",
        suffixes=("", "_saved"),
        validate="one_to_one",
    )
    comparison_pairs = [
        ("Ear", "Ear_saved"),
        ("Air", "Air_saved"),
        ("Time", "Time_saved"),
        ("Actual", "Actual_saved"),
        ("SourceMemoryPredicted", "A_full"),
        ("BatchSessionPredicted", "B_full"),
        ("HierarchicalResidualPredicted", "C_full"),
        ("Predicted", "OriginalFullPrediction"),
    ]
    maximum_difference = max(
        float(np.max(np.abs(aligned[left].to_numpy(float) - aligned[right].to_numpy(float))))
        for left, right in comparison_pairs
    )
    if aligned[["PureMemory", "GlobalThermalCells"]].isna().any().any():
        raise ValueError("Saved mechanism branch predictions contain missing values")
    return aligned, maximum_difference


def require_mechanism_choices(choices: pd.DataFrame) -> None:
    required = {"Method", "FoldID", "Source"}
    missing = sorted(required - set(choices.columns))
    if missing:
        raise ValueError(f"mechanism choices input is missing columns: {missing}")
    if len(choices) != 90:
        raise ValueError("mechanism choices input must contain 90 rows")
    public_sources = set(choices["Source"].dropna().astype(str))
    if not public_sources.issubset({"S01", "S03", "S04", "ALL"}):
        raise ValueError("mechanism choices input contains non-public source labels")
    if "CowID_raw" in choices.columns:
        raise ValueError("mechanism choices public input must not contain CowID_raw")


def reproduce_without_a_and_b(
    full: pd.DataFrame,
    candidates: pd.DataFrame,
    paired: pd.DataFrame,
    branch_inputs: pd.DataFrame,
    mechanism_choices: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, pd.DataFrame], float]:
    frame = build_mechanism_frame(full, candidates, paired)
    frame, branch_alignment_difference = attach_saved_branch_inputs(
        frame, branch_inputs
    )
    require_mechanism_choices(mechanism_choices)
    _, without_a_route_choices = candidate_replay_oof(
        frame,
        ["ridge", "direct_xgb"],
        "w/o thermal-state memory/retrieval",
        by_source=True,
    )
    without_a, without_a_stack_choices = cross_fitted_feature_stack(
        frame,
        ["ridge", "direct_xgb"],
        "w/o thermal-state memory/retrieval",
    )
    without_b, without_b_stack_choices = cross_fitted_feature_stack(
        frame,
        ["PureMemory", "GlobalThermalCells"],
        "w/o individual/session calibration",
    )
    predictions = frame[
        ["RecordID", "RowID", "FoldID", "CowKey", "Source", "Actual"]
    ].copy()
    predictions["Reproduced_Without_A_BC_C"] = without_a
    predictions["Reproduced_Without_B_AC_C"] = without_b
    choices = {
        "without_a_route_choices": without_a_route_choices,
        "without_a_stack_choices": without_a_stack_choices,
        "without_b_stack_choices": without_b_stack_choices,
        "mechanism_choices": mechanism_choices,
    }
    return predictions, choices, branch_alignment_difference


def reproduce_metric_table(
    ablation: pd.DataFrame, frozen_metrics: pd.DataFrame
) -> tuple[pd.DataFrame, dict[str, dict[str, float]]]:
    actual = ablation["Actual_C"].to_numpy(float)
    calculated: dict[str, dict[str, float]] = {}
    for configuration, prediction_column in CONFIGURATIONS:
        calculated[configuration] = calculate_metrics(
            actual, ablation[prediction_column].to_numpy(float)
        )
    full = calculated["Full A+B+C"]
    rows: list[dict[str, object]] = []
    frozen_by_configuration = frozen_metrics.set_index("Configuration")
    for configuration, _ in CONFIGURATIONS:
        row = frozen_by_configuration.loc[configuration].to_dict()
        row["Configuration"] = configuration
        row.update(calculated[configuration])
        row["Delta_R2_vs_full"] = calculated[configuration]["R2"] - full["R2"]
        row["Delta_RMSE_vs_full_C"] = (
            calculated[configuration]["RMSE_C"] - full["RMSE_C"]
        )
        row["Delta_MAE_vs_full_C"] = (
            calculated[configuration]["MAE_C"] - full["MAE_C"]
        )
        rows.append(row)
    result = pd.DataFrame(rows)
    return result[frozen_metrics.columns], calculated


def reproduce_bootstrap(
    ablation: pd.DataFrame,
    frozen_bootstrap: pd.DataFrame,
    metrics: dict[str, dict[str, float]],
) -> pd.DataFrame:
    actual = ablation["Actual_C"].to_numpy(float)
    full_prediction = ablation["Predicted_Full_ABC_C"].to_numpy(float)
    rng = np.random.default_rng(SEED)
    rows: list[dict[str, object]] = []
    for _, frozen_row in frozen_bootstrap.iterrows():
        configuration = str(frozen_row["Configuration"])
        prediction = ablation[BOOTSTRAP_COLUMNS[configuration]].to_numpy(float)
        sample_indices = rng.integers(
            0, len(actual), size=(BOOTSTRAP_REPLICATES, len(actual))
        )
        sampled_actual = actual[sample_indices]
        full_errors = sampled_actual - full_prediction[sample_indices]
        ablated_errors = sampled_actual - prediction[sample_indices]
        rmse_delta = np.sqrt(np.mean(ablated_errors**2, axis=1)) - np.sqrt(
            np.mean(full_errors**2, axis=1)
        )
        mae_delta = np.mean(np.abs(ablated_errors), axis=1) - np.mean(
            np.abs(full_errors), axis=1
        )
        rows.append(
            {
                "Configuration": configuration,
                "RemovedModel": frozen_row["RemovedModel"],
                "Delta_RMSE_C": metrics[configuration]["RMSE_C"]
                - metrics["Full A+B+C"]["RMSE_C"],
                "Delta_RMSE_CI2.5_C": float(np.quantile(rmse_delta, 0.025)),
                "Delta_RMSE_CI97.5_C": float(np.quantile(rmse_delta, 0.975)),
                "Delta_MAE_C": metrics[configuration]["MAE_C"]
                - metrics["Full A+B+C"]["MAE_C"],
                "Delta_MAE_CI2.5_C": float(np.quantile(mae_delta, 0.025)),
                "Delta_MAE_CI97.5_C": float(np.quantile(mae_delta, 0.975)),
                "BootstrapN": BOOTSTRAP_REPLICATES,
            }
        )
    return pd.DataFrame(rows)[frozen_bootstrap.columns]


def max_numeric_difference(left: pd.DataFrame, right: pd.DataFrame) -> float:
    numeric_columns = [
        column
        for column in left.columns
        if pd.api.types.is_numeric_dtype(left[column])
        and pd.api.types.is_numeric_dtype(right[column])
    ]
    return float(
        np.max(
            np.abs(
                left[numeric_columns].to_numpy(float)
                - right[numeric_columns].to_numpy(float)
            )
        )
    )


def run(args: argparse.Namespace) -> dict[str, object]:
    full = pd.read_csv(args.full_input)
    ablation = pd.read_csv(args.ablation_input)
    candidates = pd.read_csv(args.candidate_input)
    paired = pd.read_csv(args.paired_input)
    branch_inputs = pd.read_csv(args.branch_input)
    mechanism_choices = pd.read_csv(args.mechanism_choices)
    frozen_metrics = pd.read_csv(args.frozen_metrics)
    frozen_bootstrap = pd.read_csv(args.frozen_bootstrap)
    require_inputs(full, ablation)
    _, full_alignment_difference = align_inputs(full, ablation)

    reproduced_metrics, metric_values = reproduce_metric_table(ablation, frozen_metrics)
    reproduced_bootstrap = reproduce_bootstrap(
        ablation, frozen_bootstrap, metric_values
    )
    without_c, without_c_choices = reproduce_without_c(full)
    without_c_check = without_c.merge(
        ablation[["RowID", "Predicted_Without_C_AB_C"]],
        on="RowID",
        how="left",
        validate="one_to_one",
    )
    without_c_check["PredictionDifference_C"] = (
        without_c_check["Reproduced_Without_C_AB_C"]
        - without_c_check["Predicted_Without_C_AB_C"]
    )
    mechanism_predictions, mechanism_choices, branch_alignment_difference = (
        reproduce_without_a_and_b(
            full, candidates, paired, branch_inputs, mechanism_choices
        )
    )
    mechanism_check = mechanism_predictions.merge(
        ablation[
            ["RowID", "Predicted_Without_A_BC_C", "Predicted_Without_B_AC_C"]
        ],
        on="RowID",
        how="left",
        validate="one_to_one",
    )
    mechanism_check["Without_A_PredictionDifference_C"] = (
        mechanism_check["Reproduced_Without_A_BC_C"]
        - mechanism_check["Predicted_Without_A_BC_C"]
    )
    mechanism_check["Without_B_PredictionDifference_C"] = (
        mechanism_check["Reproduced_Without_B_AC_C"]
        - mechanism_check["Predicted_Without_B_AC_C"]
    )

    metric_difference = max_numeric_difference(reproduced_metrics, frozen_metrics)
    bootstrap_difference = max_numeric_difference(
        reproduced_bootstrap, frozen_bootstrap
    )
    without_c_difference = float(
        without_c_check["PredictionDifference_C"].abs().max()
    )
    without_a_difference = float(
        mechanism_check["Without_A_PredictionDifference_C"].abs().max()
    )
    without_b_difference = float(
        mechanism_check["Without_B_PredictionDifference_C"].abs().max()
    )
    status = "PASS" if (
        full_alignment_difference <= args.table_tolerance
        and branch_alignment_difference <= args.prediction_tolerance
        and metric_difference <= args.table_tolerance
        and bootstrap_difference <= args.table_tolerance
        and without_a_difference <= args.prediction_tolerance
        and without_b_difference <= args.prediction_tolerance
        and without_c_difference <= args.prediction_tolerance
    ) else "FAIL"

    output_dir = args.output_dir.resolve()
    tables_dir = output_dir / "tables"
    tables_dir.mkdir(parents=True, exist_ok=True)
    reproduced_metrics.to_csv(
        tables_dir / "ablation_metrics_reproduced.csv", index=False, encoding="utf-8"
    )
    reproduced_bootstrap.to_csv(
        tables_dir / "ablation_bootstrap_reproduced.csv", index=False, encoding="utf-8"
    )
    without_c_check.to_csv(
        tables_dir / "without_c_reproduced_predictions.csv", index=False, encoding="utf-8"
    )
    without_c_choices.to_csv(
        tables_dir / "without_c_stack_choices.csv", index=False, encoding="utf-8"
    )
    mechanism_check.to_csv(
        tables_dir / "without_a_b_reproduced_predictions.csv",
        index=False,
        encoding="utf-8",
    )
    for name, choices in mechanism_choices.items():
        choices.to_csv(
            tables_dir / f"{name}.csv", index=False, encoding="utf-8"
        )

    verification = {
        "status": status,
        "validation_design": "same-cow random five-fold OOF",
        "rows": 503,
        "cows": 30,
        "bootstrap_seed": SEED,
        "bootstrap_replicates": BOOTSTRAP_REPLICATES,
        "full_alignment_max_abs_difference": full_alignment_difference,
        "saved_branch_alignment_max_abs_difference_C": branch_alignment_difference,
        "metric_table_max_abs_difference": metric_difference,
        "bootstrap_table_max_abs_difference": bootstrap_difference,
        "without_a_prediction_max_abs_difference_C": without_a_difference,
        "without_b_prediction_max_abs_difference_C": without_b_difference,
        "without_c_prediction_max_abs_difference_C": without_c_difference,
        "input_sha256": {
            "candidate_predictions": sha256_file(args.candidate_input),
            "branch_inputs": sha256_file(args.branch_input),
            "mechanism_choices": sha256_file(args.mechanism_choices),
        },
        "table_tolerance": args.table_tolerance,
        "prediction_tolerance_C": args.prediction_tolerance,
        "scope": {
            "full": "metrics are recalculated from the 503 OOF rows",
            "without_c": "A+B nested ridge is refitted",
            "without_a": "ridge/XGBoost candidates are reselected and nested ridge is refitted",
            "without_b": "nested ridge is refitted from PureMemory and GlobalThermalCells candidates",
        },
    }
    (output_dir / "ablation_verification.json").write_text(
        json.dumps(verification, indent=2) + "\n", encoding="utf-8"
    )
    report = f"""# TH-SHRC mechanism ablation

| Item | Value |
|---|---:|
| Status | {status} |
| Rows | 503 |
| Bootstrap replicates | {BOOTSTRAP_REPLICATES:,} |
| Seed | {SEED} |
| Maximum metric difference | {metric_difference:.12g} |
| Maximum bootstrap difference | {bootstrap_difference:.12g} |
| Maximum w/o-A prediction difference (C) | {without_a_difference:.12g} |
| Maximum w/o-B prediction difference (C) | {without_b_difference:.12g} |
| Maximum w/o-C prediction difference (C) | {without_c_difference:.12g} |

All configurations use the fixed same-cow outer folds.
"""
    (output_dir / "README.md").write_text(report, encoding="utf-8")
    print(json.dumps(verification, indent=2))
    return verification


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--full-input", type=Path, default=DEFAULT_FULL_INPUT)
    parser.add_argument("--ablation-input", type=Path, default=DEFAULT_ABLATION_INPUT)
    parser.add_argument("--candidate-input", type=Path, default=DEFAULT_CANDIDATE_INPUT)
    parser.add_argument("--paired-input", type=Path, default=DEFAULT_PAIRED_INPUT)
    parser.add_argument("--branch-input", type=Path, default=DEFAULT_BRANCH_INPUT)
    parser.add_argument(
        "--mechanism-choices", type=Path, default=DEFAULT_MECHANISM_CHOICES
    )
    parser.add_argument("--frozen-metrics", type=Path, default=DEFAULT_METRICS)
    parser.add_argument("--frozen-bootstrap", type=Path, default=DEFAULT_BOOTSTRAP)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--table-tolerance", type=float, default=1e-12)
    parser.add_argument("--prediction-tolerance", type=float, default=1e-8)
    return parser.parse_args()


if __name__ == "__main__":
    result = run(parse_args())
    raise SystemExit(0 if result["status"] == "PASS" else 1)
