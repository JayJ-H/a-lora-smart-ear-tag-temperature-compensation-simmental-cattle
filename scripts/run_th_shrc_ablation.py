#!/usr/bin/env python3
"""Run strict mechanism-level TH-SHRC ablation on the five OOF repeats."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from experiment_common import (
    INPUT_PATH,
    MULTISEED_DIR,
    ROOT,
    SEEDS,
    load_config,
    metrics,
    rowwise_seed_ensemble,
)


STACK_DIR = ROOT / "reproduction" / "th_shrc" / "pipeline" / "analysis" / "th_shrc"
if str(STACK_DIR) not in sys.path:
    sys.path.insert(0, str(STACK_DIR))
from reproduce_stack import LAMBDA_GRID, make_inner_folds  # noqa: E402


DEFAULT_OUTPUT = ROOT / "outputs" / "analysis" / "ablation"
PUBLIC_DATA = (
    ROOT / "数据" / "处理数据"
    if (ROOT / "数据").is_dir()
    else ROOT / "data" / "processed"
)
BOOTSTRAP_REPLICATES = 10_000
BOOTSTRAP_SEED = 20260723
STACK_INNER_SEED = 20260523
DIRECT_COLUMNS = ["ridge", "direct_xgb"]
GLOBAL_CELL_COLUMNS = ["global_exact", "global_medium", "global_coarse"]
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
    ("Full", "Full A+B+C", "Full A+B+C", "", "Full TH-SHRC"),
    ("WithoutC", "A+B", "w/o C (A+B)", "C", "w/o hierarchical residual correction"),
    ("WithoutB", "A+C", "w/o B (A+C)", "B", "w/o individual/session calibration"),
    ("WithoutA", "B+C", "w/o A (B+C)", "A", "w/o thermal-state memory/retrieval"),
]
PREDICTION_COLUMNS = {
    "Full": "Predicted_Full_ABC_C",
    "WithoutA": "Predicted_Without_A_BC_C",
    "WithoutB": "Predicted_Without_B_AC_C",
    "WithoutC": "Predicted_Without_C_AB_C",
}


def fit_ridge(frame: pd.DataFrame, columns: list[str], regularization: float) -> np.ndarray:
    design = np.column_stack([np.ones(len(frame)), frame[columns].to_numpy(float)])
    penalty = np.eye(design.shape[1]) * regularization
    penalty[0, 0] = 0.0
    return np.linalg.pinv(design.T @ design + penalty) @ (
        design.T @ frame["Actual"].to_numpy(float)
    )


def predict_ridge(frame: pd.DataFrame, columns: list[str], coefficients: np.ndarray) -> np.ndarray:
    design = np.column_stack([np.ones(len(frame)), frame[columns].to_numpy(float)])
    return design @ coefficients


def cross_fitted_stack(
    frame: pd.DataFrame, columns: list[str], method: str
) -> tuple[np.ndarray, pd.DataFrame]:
    predicted = np.zeros(len(frame), dtype=float)
    choices: list[dict[str, object]] = []
    for fold in sorted(frame["FoldID"].astype(int).unique()):
        train = frame.loc[frame["FoldID"].astype(int).ne(fold)].copy()
        test = frame.loc[frame["FoldID"].astype(int).eq(fold)].copy()
        inner = make_inner_folds(train, STACK_INNER_SEED + 3000 + int(fold))
        candidates: list[tuple[float, float]] = []
        for regularization in LAMBDA_GRID:
            inner_prediction = np.zeros(len(train), dtype=float)
            for inner_fold in sorted(np.unique(inner)):
                inner_train = train.iloc[inner != inner_fold]
                inner_valid = train.iloc[inner == inner_fold]
                coefficients = fit_ridge(inner_train, columns, regularization)
                inner_prediction[inner == inner_fold] = predict_ridge(
                    inner_valid, columns, coefficients
                )
            score = metrics(train["Actual"].to_numpy(float), inner_prediction)["RMSE"]
            candidates.append((float(regularization), float(score)))
        regularization, inner_rmse = min(candidates, key=lambda row: (row[1], row[0]))
        coefficients = fit_ridge(train, columns, regularization)
        predicted[test.index] = np.clip(
            predict_ridge(test, columns, coefficients), 35.0, 42.0
        )
        choice: dict[str, object] = {
            "Method": method,
            "FoldID": int(fold),
            "SelectedLambda": regularization,
            "InnerRMSE": inner_rmse,
        }
        for index, value in enumerate(coefficients):
            choice[f"Beta_{index}"] = float(value)
        choices.append(choice)
    return predicted, pd.DataFrame(choices)


def simplex_weights(dimension: int, step: float = 0.05) -> np.ndarray:
    values = np.arange(0.0, 1.0 + 1e-12, step)
    if dimension == 1:
        return np.ones((1, 1))
    if dimension == 2:
        return np.asarray([[value, 1.0 - value] for value in values])
    if dimension == 3:
        return np.asarray(
            [
                [left, middle, 1.0 - left - middle]
                for left in values
                for middle in values
                if left + middle <= 1.0 + 1e-12
            ]
        )
    raise ValueError("Candidate selection supports at most three selected routes")


def select_candidate_mix(train: pd.DataFrame, columns: list[str]) -> dict[str, object]:
    valid = np.isfinite(train[columns].to_numpy(float)).all(axis=1)
    actual = train.loc[valid, "Actual"].to_numpy(float)
    candidate_values = train.loc[valid, columns].to_numpy(float)
    individual_rmse = np.sqrt(np.mean((candidate_values - actual[:, None]) ** 2, axis=0))
    strongest = [columns[index] for index in np.argsort(individual_rmse)[: min(3, len(columns))]]
    best: dict[str, object] = {
        "rmse": float(individual_rmse.min()),
        "columns": [columns[int(np.argmin(individual_rmse))]],
        "weights": np.ones(1),
        "n": int(valid.sum()),
    }
    weights = simplex_weights(len(strongest))
    mixtures = train.loc[valid, strongest].to_numpy(float) @ weights.T
    scores = np.sqrt(np.mean((mixtures - actual[:, None]) ** 2, axis=0))
    selected = int(np.argmin(scores))
    if float(scores[selected]) < float(best["rmse"]):
        best = {
            "rmse": float(scores[selected]),
            "columns": strongest,
            "weights": weights[selected],
            "n": int(valid.sum()),
        }
    return best


def candidate_replay_oof(
    frame: pd.DataFrame, columns: list[str], method: str
) -> tuple[np.ndarray, pd.DataFrame]:
    predicted = np.zeros(len(frame), dtype=float)
    choices: list[dict[str, object]] = []
    for fold in sorted(frame["FoldID"].astype(int).unique()):
        train = frame.loc[frame["FoldID"].astype(int).ne(fold)]
        test = frame.loc[frame["FoldID"].astype(int).eq(fold)]
        selected = select_candidate_mix(train, columns)
        selected_columns = list(selected["columns"])
        selected_weights = np.asarray(selected["weights"], dtype=float)
        predicted[test.index] = test[selected_columns].to_numpy(float) @ selected_weights
        choice: dict[str, object] = {
            "Method": method,
            "FoldID": int(fold),
            "Source": "S01",
            "ChosenCandidates": "+".join(selected_columns),
            "InnerRMSE": float(selected["rmse"]),
            "TrainingN": int(selected["n"]),
        }
        for column, weight in zip(selected_columns, selected_weights):
            choice[f"Weight_{column}"] = float(weight)
        choices.append(choice)
    return predicted, pd.DataFrame(choices)


def circular_time_distance(left: np.ndarray, right: float) -> np.ndarray:
    difference = np.abs(left - right)
    return np.minimum(difference, 24.0 - difference)


def memory_predict(
    train: pd.DataFrame, test: pd.DataFrame, configuration: tuple[object, ...]
) -> np.ndarray:
    _, neighbors, time_bandwidth, ear_bandwidth, air_bandwidth, kernel_bandwidth = configuration
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
        selected = np.argsort(distance_squared)[: min(int(neighbors), len(train))]
        if len(selected) == 1:
            output[row_index] = train_actual[selected[0]]
            continue
        weights = (
            np.exp(-0.5 * distance_squared[selected] / float(kernel_bandwidth) ** 2)
            * np.maximum(train_weight[selected], 1e-6)
        )
        output[row_index] = (
            float(np.sum(weights * train_actual[selected]) / np.sum(weights))
            if weights.sum() > 1e-12
            else float(train_actual[selected].mean())
        )
    return output


def pure_memory_oof(frame: pd.DataFrame, seed: int) -> tuple[np.ndarray, pd.DataFrame]:
    predicted = np.zeros(len(frame), dtype=float)
    choices: list[dict[str, object]] = []
    for fold in sorted(frame["FoldID"].astype(int).unique()):
        train = frame.loc[frame["FoldID"].astype(int).ne(fold)].copy()
        test = frame.loc[frame["FoldID"].astype(int).eq(fold)].copy()
        inner = make_inner_folds(train, int(seed) + 1000 + int(fold))
        inner_predictions = np.zeros((len(train), len(MEMORY_CONFIGS)), dtype=float)
        for inner_fold in sorted(np.unique(inner)):
            inner_train = train.iloc[inner != inner_fold]
            inner_valid = train.iloc[inner == inner_fold]
            for index, configuration in enumerate(MEMORY_CONFIGS):
                inner_predictions[inner == inner_fold, index] = memory_predict(
                    inner_train, inner_valid, configuration
                )
        scores = np.sqrt(
            np.mean(
                (train["Actual"].to_numpy(float)[:, None] - inner_predictions) ** 2,
                axis=0,
            )
        )
        selected = int(np.argmin(scores))
        predicted[test.index] = memory_predict(train, test, MEMORY_CONFIGS[selected])
        choices.append(
            {
                "Method": "Pure thermal-state memory",
                "FoldID": int(fold),
                "Source": "S01",
                "Configuration": MEMORY_CONFIGS[selected][0],
                "InnerRMSE": float(scores[selected]),
            }
        )
    return predicted, pd.DataFrame(choices)


def load_seed_frame(seed: int, model_input: pd.DataFrame) -> pd.DataFrame:
    seed_dir = MULTISEED_DIR / "seeds" / str(seed)
    full = pd.read_csv(seed_dir / "th_shrc_oof_predictions.csv")
    candidates = pd.read_csv(seed_dir / "upstream" / "hierarchical_residual_oof_predictions.csv")
    required_candidates = [*DIRECT_COLUMNS, *GLOBAL_CELL_COLUMNS]
    missing = sorted(set(required_candidates) - set(candidates.columns))
    if missing:
        raise RuntimeError(f"Seed {seed} candidate table is missing {missing}")
    frame = full.merge(
        model_input[
            [
                "RecordID",
                "EarTemperature_C",
                "AmbientTemperature_C",
                "MeasurementTime_hour",
                "SourceWeight",
            ]
        ],
        on="RecordID",
        validate="one_to_one",
    ).merge(
        candidates[["RowID", "FoldID", "CowKey", "Source", *required_candidates]],
        on="RowID",
        suffixes=("", "_candidate"),
        validate="one_to_one",
    )
    for identity in ("FoldID", "CowKey", "Source"):
        if not (frame[identity].astype(str) == frame[f"{identity}_candidate"].astype(str)).all():
            raise RuntimeError(f"Seed {seed} candidate {identity} identities do not align")
    frame = frame.rename(
        columns={
            "EarTemperature_C": "Ear",
            "AmbientTemperature_C": "Air",
            "MeasurementTime_hour": "Time",
        }
    ).sort_values("RowID").reset_index(drop=True)
    if len(frame) != 520 or frame["RecordID"].nunique() != 520:
        raise RuntimeError(f"Seed {seed} does not contain 520 unique OOF records")
    return frame


def run_seed(seed: int, model_input: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    frame = load_seed_frame(seed, model_input)
    pure_memory, pure_choices = pure_memory_oof(frame, seed)
    frame["PureMemory"] = pure_memory
    global_cells, global_choices = candidate_replay_oof(
        frame, GLOBAL_CELL_COLUMNS, "Global non-individual thermal cells"
    )
    frame["GlobalThermalCells"] = global_cells
    without_a, without_a_choices = cross_fitted_stack(
        frame, DIRECT_COLUMNS, "w/o thermal-state memory/retrieval"
    )
    without_b, without_b_choices = cross_fitted_stack(
        frame, ["PureMemory", "GlobalThermalCells"], "w/o individual/session calibration"
    )
    without_c, without_c_choices = cross_fitted_stack(
        frame,
        ["SourceMemoryPredicted", "BatchSessionPredicted"],
        "w/o hierarchical residual correction",
    )
    predictions = frame[
        ["RecordID", "MeasurementUnitID", "RowID", "CowKey", "Source", "FoldID", "Actual"]
    ].copy()
    predictions["Full"] = frame["Predicted"].to_numpy(float)
    predictions["WithoutA"] = without_a
    predictions["WithoutB"] = without_b
    predictions["WithoutC"] = without_c
    predictions.insert(0, "Seed", int(seed))
    choice_frames = [pure_choices, global_choices, without_a_choices, without_b_choices, without_c_choices]
    choices = pd.concat(choice_frames, ignore_index=True, sort=False)
    choices.insert(0, "Seed", int(seed))
    return predictions, choices


def calculate_metric_row(actual: Iterable[float], predicted: Iterable[float]) -> dict[str, float | int]:
    actual_array = np.asarray(actual, dtype=float)
    predicted_array = np.asarray(predicted, dtype=float)
    residual = actual_array - predicted_array
    absolute = np.abs(residual)
    result = metrics(actual_array, predicted_array)
    return {
        "N": int(len(actual_array)),
        "R2": float(result["R2"]),
        "RMSE_C": float(result["RMSE"]),
        "MAE_C": float(result["MAE"]),
        "Bias_C": float(result["Bias"]),
        "MedianAE_C": float(np.median(absolute)),
        "P95_AE_C": float(np.quantile(absolute, 0.95)),
        "Within_0_2C": float(np.mean(absolute <= 0.2)),
        "Within_0_3C": float(np.mean(absolute <= 0.3)),
        "Within_0_5C": float(np.mean(absolute <= 0.5)),
    }


def bootstrap_tables(wide: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    actual = wide["Actual_C"].to_numpy(float)
    full = wide[PREDICTION_COLUMNS["Full"]].to_numpy(float)
    point_metrics = {
        name: calculate_metric_row(actual, wide[column].to_numpy(float))
        for name, column in PREDICTION_COLUMNS.items()
    }
    row_rng = np.random.default_rng(BOOTSTRAP_SEED)
    cow_rng = np.random.default_rng(BOOTSTRAP_SEED)
    cow_indices = {
        cow: indices.to_numpy(int)
        for cow, indices in wide.groupby("CowKey", sort=True).groups.items()
    }
    cows = np.asarray(list(cow_indices), dtype=object)
    row_results: list[dict[str, object]] = []
    cow_results: list[dict[str, object]] = []
    for name in ("WithoutA", "WithoutB", "WithoutC"):
        column = PREDICTION_COLUMNS[name]
        ablated = wide[column].to_numpy(float)
        samples = row_rng.integers(0, len(wide), size=(BOOTSTRAP_REPLICATES, len(wide)))
        sampled_actual = actual[samples]
        full_error = sampled_actual - full[samples]
        ablated_error = sampled_actual - ablated[samples]
        row_rmse = np.sqrt(np.mean(ablated_error**2, axis=1)) - np.sqrt(
            np.mean(full_error**2, axis=1)
        )
        row_mae = np.mean(np.abs(ablated_error), axis=1) - np.mean(
            np.abs(full_error), axis=1
        )
        cow_rmse = np.empty(BOOTSTRAP_REPLICATES, dtype=float)
        cow_mae = np.empty(BOOTSTRAP_REPLICATES, dtype=float)
        for bootstrap_index in range(BOOTSTRAP_REPLICATES):
            sampled_cows = cow_rng.choice(cows, size=len(cows), replace=True)
            indices = np.concatenate([cow_indices[cow] for cow in sampled_cows])
            full_error_current = actual[indices] - full[indices]
            ablated_error_current = actual[indices] - ablated[indices]
            cow_rmse[bootstrap_index] = (
                np.sqrt(np.mean(ablated_error_current**2))
                - np.sqrt(np.mean(full_error_current**2))
            )
            cow_mae[bootstrap_index] = (
                np.mean(np.abs(ablated_error_current))
                - np.mean(np.abs(full_error_current))
            )
        configuration = next(row[2] for row in CONFIGURATIONS if row[0] == name)
        removed = next(row[3] for row in CONFIGURATIONS if row[0] == name)
        point_rmse = float(point_metrics[name]["RMSE_C"] - point_metrics["Full"]["RMSE_C"])
        point_mae = float(point_metrics[name]["MAE_C"] - point_metrics["Full"]["MAE_C"])
        for output, rmse_values, mae_values, unit in (
            (row_results, row_rmse, row_mae, "record"),
            (cow_results, cow_rmse, cow_mae, "cow_cluster"),
        ):
            output.append(
                {
                    "Configuration": configuration,
                    "RemovedModel": removed,
                    "Delta_RMSE_C": point_rmse,
                    "Delta_RMSE_CI2.5_C": float(np.quantile(rmse_values, 0.025)),
                    "Delta_RMSE_CI97.5_C": float(np.quantile(rmse_values, 0.975)),
                    "Delta_MAE_C": point_mae,
                    "Delta_MAE_CI2.5_C": float(np.quantile(mae_values, 0.025)),
                    "Delta_MAE_CI97.5_C": float(np.quantile(mae_values, 0.975)),
                    "BootstrapN": BOOTSTRAP_REPLICATES,
                    "ResamplingUnit": unit,
                }
            )
    return pd.DataFrame(row_results), pd.DataFrame(cow_results)


def run(output: Path = DEFAULT_OUTPUT) -> dict[str, object]:
    model_input = pd.read_csv(INPUT_PATH)
    long_frames: list[pd.DataFrame] = []
    choice_frames: list[pd.DataFrame] = []
    repeat_rows: list[dict[str, object]] = []
    for seed in SEEDS:
        predictions, choices = run_seed(seed, model_input)
        long_frames.append(predictions)
        choice_frames.append(choices)
        for name, _, configuration, _, _ in CONFIGURATIONS:
            repeat_rows.append(
                {
                    "Seed": int(seed),
                    "Configuration": configuration,
                    **calculate_metric_row(predictions["Actual"], predictions[name]),
                }
            )
    long = pd.concat(long_frames, ignore_index=True)
    choices = pd.concat(choice_frames, ignore_index=True, sort=False)
    identity = long.loc[long["Seed"].eq(SEEDS[0])].set_index("RecordID")
    wide = identity[["MeasurementUnitID", "RowID", "CowKey", "Source", "FoldID", "Actual"]].copy()
    for name, _, _, _, _ in CONFIGURATIONS:
        pivot = long.pivot(index="RecordID", columns="Seed", values=name).reindex(wide.index)
        wide[PREDICTION_COLUMNS[name]] = rowwise_seed_ensemble(pivot[list(SEEDS)].to_numpy(float))
    wide = wide.rename(columns={"Actual": "Actual_C"}).reset_index()
    full_metrics = calculate_metric_row(wide["Actual_C"], wide[PREDICTION_COLUMNS["Full"]])
    metric_rows: list[dict[str, object]] = []
    for name, display, configuration, removed, method in CONFIGURATIONS:
        result = calculate_metric_row(wide["Actual_C"], wide[PREDICTION_COLUMNS[name]])
        metric_rows.append(
            {
                "Display": display,
                "Configuration": configuration,
                "Method": method,
                **result,
                "Delta_R2_vs_full": float(result["R2"] - full_metrics["R2"]),
                "Delta_RMSE_vs_full_C": float(result["RMSE_C"] - full_metrics["RMSE_C"]),
                "Delta_MAE_vs_full_C": float(result["MAE_C"] - full_metrics["MAE_C"]),
                "RemovedModel": removed,
                "ModelDefinition": "A=thermal-state memory/retrieval; B=individual/session calibration; C=hierarchical residual-correction route",
            }
        )
    metric_table = pd.DataFrame(metric_rows)
    row_bootstrap, cow_bootstrap = bootstrap_tables(wide)
    public_bootstrap = row_bootstrap.drop(columns="ResamplingUnit")

    official = pd.read_csv(MULTISEED_DIR / "ensemble_oof_predictions.csv").set_index("RecordID")
    aligned_official = official.reindex(wide["RecordID"])
    full_difference = float(
        np.max(
            np.abs(
                aligned_official["Predicted"].to_numpy(float)
                - wide[PREDICTION_COLUMNS["Full"]].to_numpy(float)
            )
        )
    )
    checks = {
        "five_seed_four_configuration_coverage": len(long) == len(SEEDS) * 4 * 520 / 4,
        "strict_routes_finite": bool(
            np.isfinite(wide[list(PREDICTION_COLUMNS.values())].to_numpy(float)).all()
        ),
        "full_ensemble_matches_frozen": full_difference <= 1e-10,
        "row_bootstrap_complete": bool(
            len(row_bootstrap) == 3
            and row_bootstrap["BootstrapN"].eq(BOOTSTRAP_REPLICATES).all()
        ),
        "cow_cluster_bootstrap_complete": bool(
            len(cow_bootstrap) == 3
            and cow_bootstrap["BootstrapN"].eq(BOOTSTRAP_REPLICATES).all()
        ),
    }
    report = {
        "status": "PASS" if all(checks.values()) else "FAIL",
        "analysis": "strict mechanism-level ablation",
        "validation": "five fixed measurement-unit-grouped same-animal OOF repeats",
        "seed_ensemble": {
            "method": load_config()["seed_ensemble_method"],
        },
        "mechanisms": {
            "A": "thermal-state memory/retrieval; removal disables lookup, EB, and session-memory routes and retains direct Ridge/XGBoost routes",
            "B": "individual/session calibration; removal retains non-cow-conditioned pure memory and global thermal cells",
            "C": "hierarchical residual correction; removal refits the final learner using A and B only",
        },
        "bootstrap": {
            "replicates": BOOTSTRAP_REPLICATES,
            "published_figure_unit": "paired record",
            "dependence_robustness_unit": "paired cow cluster",
        },
        "full_metrics": full_metrics,
        "max_full_ensemble_difference_C": full_difference,
        "checks": checks,
    }
    output.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    long.to_csv(output / "strict_ablation_seed_predictions.csv", index=False, lineterminator="\n")
    choices.to_csv(output / "strict_ablation_choices.csv", index=False, lineterminator="\n")
    pd.DataFrame(repeat_rows).to_csv(
        output / "strict_ablation_seed_metrics.csv", index=False, lineterminator="\n"
    )
    wide.to_csv(output / "strict_ablation_ensemble_predictions.csv", index=False, lineterminator="\n")
    metric_table.to_csv(output / "strict_ablation_metrics.csv", index=False, lineterminator="\n")
    row_bootstrap.to_csv(output / "paired_record_bootstrap.csv", index=False, lineterminator="\n")
    cow_bootstrap.to_csv(output / "paired_cow_cluster_bootstrap.csv", index=False, lineterminator="\n")
    metric_table.to_csv(PUBLIC_DATA / "th_shrc_ablation_metrics.csv", index=False, lineterminator="\n")
    public_bootstrap.to_csv(PUBLIC_DATA / "th_shrc_ablation_bootstrap.csv", index=False, lineterminator="\n")
    cow_bootstrap.to_csv(
        PUBLIC_DATA / "th_shrc_ablation_cow_cluster_bootstrap.csv", index=False, lineterminator="\n"
    )
    wide.to_csv(PUBLIC_DATA / "th_shrc_ablation_oof_predictions.csv", index=False, lineterminator="\n")
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
