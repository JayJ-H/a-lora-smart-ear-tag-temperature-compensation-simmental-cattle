#!/usr/bin/env python3
"""Refit the benchmark with fixed search choices and compare row-level OOF predictions."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

import run_benchmark as benchmark

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = ROOT / "数据" / "处理数据" / "th_shrc_oof_predictions.csv"
DEFAULT_REFERENCE = ROOT / "数据" / "处理数据" / "model_benchmark_oof_predictions.csv"
DEFAULT_CHOICES = ROOT / "输出" / "分析" / "基准模型" / "表格" / "14_evolutionary_search_choices.csv"
DEFAULT_OUTPUT = ROOT / "输出" / "分析" / "benchmark_replay"

FACTORIES = {
    "GA_SVR_RBF": benchmark.factory_svr,
    "PSO_RandomForest": benchmark.factory_rf,
    "DE_GradientBoosting": benchmark.factory_gbm,
    "SA_KNN": benchmark.factory_knn,
    "GWO_ExtraTrees": benchmark.factory_extratrees,
    "DE_XGBoost": benchmark.factory_xgb,
}


def replay_evolution_model(
    frame: pd.DataFrame,
    model_name: str,
    choices: pd.DataFrame,
    seed: int,
) -> pd.DataFrame:
    factory = FACTORIES[model_name]
    metadata = choices.loc[choices["Model"] == model_name].copy()
    if set(metadata["FoldID"].astype(int)) != {1, 2, 3, 4, 5}:
        raise RuntimeError(f"{model_name} does not have five saved fold choices")

    actual = frame["Actual"].to_numpy(float)
    parts = []
    for fold_id in sorted(frame["FoldID"].astype(int).unique()):
        train_mask = frame["FoldID"].astype(int).to_numpy() != fold_id
        test_mask = ~train_mask
        row = metadata.loc[metadata["FoldID"].astype(int) == fold_id].iloc[0]
        params = json.loads(row["BestParams"])
        fold_seed = seed + 1000 + int(fold_id) * 31
        model = factory(params, fold_seed + 101)
        model.fit(frame.loc[train_mask].reset_index(drop=True), actual[train_mask])
        predicted = np.asarray(model.predict(frame.loc[test_mask]), dtype=float)
        parts.append(
            pd.DataFrame(
                {
                    "Model": model_name,
                    "RowID": frame.loc[test_mask, "RowID"].astype(int).to_numpy(),
                    "FoldID": frame.loc[test_mask, "FoldID"].astype(int).to_numpy(),
                    "Actual": actual[test_mask],
                    "Predicted": predicted,
                }
            )
        )
    return pd.concat(parts, ignore_index=True)


def compare_predictions(replayed: pd.DataFrame, reference: pd.DataFrame) -> pd.DataFrame:
    joined = replayed.merge(
        reference[["Model", "RowID", "FoldID", "Actual", "Predicted"]],
        on=["Model", "RowID", "FoldID"],
        how="outer",
        suffixes=("_replayed", "_reference"),
        indicator=True,
        validate="one_to_one",
    )
    if not (joined["_merge"] == "both").all():
        raise RuntimeError("Replayed and reference model-row identities differ")
    joined["ActualAbsDifference"] = np.abs(
        joined["Actual_replayed"].to_numpy(float)
        - joined["Actual_reference"].to_numpy(float)
    )
    joined["PredictionAbsDifference"] = np.abs(
        joined["Predicted_replayed"].to_numpy(float)
        - joined["Predicted_reference"].to_numpy(float)
    )
    rows = []
    for model_name, group in joined.groupby("Model", sort=True):
        replay_metrics = benchmark.metric_dict(
            group["Actual_replayed"].to_numpy(float),
            group["Predicted_replayed"].to_numpy(float),
        )
        reference_metrics = benchmark.metric_dict(
            group["Actual_reference"].to_numpy(float),
            group["Predicted_reference"].to_numpy(float),
        )
        rows.append(
            {
                "Model": model_name,
                "Rows": len(group),
                "MaximumPredictionAbsDifference": float(group["PredictionAbsDifference"].max()),
                "R2Replayed": replay_metrics["R2"],
                "R2Reference": reference_metrics["R2"],
                "R2AbsDifference": abs(replay_metrics["R2"] - reference_metrics["R2"]),
                "RMSEReplayed": replay_metrics["RMSE"],
                "RMSEReference": reference_metrics["RMSE"],
                "RMSEAbsDifference": abs(replay_metrics["RMSE"] - reference_metrics["RMSE"]),
                "MAEReplayed": replay_metrics["MAE"],
                "MAEReference": reference_metrics["MAE"],
                "MAEAbsDifference": abs(replay_metrics["MAE"] - reference_metrics["MAE"]),
            }
        )
    return pd.DataFrame(rows)


def run(args: argparse.Namespace) -> dict[str, object]:
    np.random.seed(args.seed)
    frame = benchmark.load_data(args.input.resolve())
    reference = pd.read_csv(args.reference.resolve())
    choices = pd.read_csv(args.choices.resolve())
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    start = time.perf_counter()
    prediction_parts = [
        benchmark.prediction_rows_for_reference(frame)[
            ["Model", "RowID", "FoldID", "Actual", "Predicted"]
        ]
    ]

    for spec in benchmark.conventional_model_specs():
        predictions, _, _ = benchmark.run_oof_model(frame, spec, args.seed)
        prediction_parts.append(
            predictions[["Model", "RowID", "FoldID", "Actual", "Predicted"]]
        )
        print(f"refit {spec.model_name}", flush=True)

    for model_name in FACTORIES:
        prediction_parts.append(
            replay_evolution_model(frame, model_name, choices, args.seed)
        )
        print(f"refit {model_name} with fixed choices", flush=True)

    replayed = pd.concat(prediction_parts, ignore_index=True).sort_values(
        ["Model", "RowID"]
    )
    comparison = compare_predictions(replayed, reference)
    elapsed = time.perf_counter() - start

    max_prediction_difference = float(comparison["MaximumPredictionAbsDifference"].max())
    max_r2_difference = float(comparison["R2AbsDifference"].max())
    max_rmse_difference = float(comparison["RMSEAbsDifference"].max())
    max_mae_difference = float(comparison["MAEAbsDifference"].max())
    status = "PASS" if (
        len(replayed) == 33 * 503
        and replayed["Model"].nunique() == 33
        and max_r2_difference <= args.metric_tolerance
        and max_rmse_difference <= args.metric_tolerance
        and max_mae_difference <= args.metric_tolerance
    ) else "FAIL"

    replayed.to_csv(
        output_dir / "benchmark_oof_predictions_replayed.csv",
        index=False,
        lineterminator="\n",
    )
    comparison.to_csv(
        output_dir / "benchmark_model_comparison.csv",
        index=False,
        lineterminator="\n",
    )
    payload = {
        "status": status,
        "rows": int(len(replayed)),
        "models": int(replayed["Model"].nunique()),
        "seed": args.seed,
        "method": "model refit with fixed evolutionary search choices",
        "elapsed_seconds": round(elapsed, 3),
        "maximum_prediction_abs_difference": max_prediction_difference,
        "maximum_r2_abs_difference": max_r2_difference,
        "maximum_rmse_abs_difference": max_rmse_difference,
        "maximum_mae_abs_difference": max_mae_difference,
        "metric_tolerance": args.metric_tolerance,
    }
    (output_dir / "benchmark_replay_verification.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(payload, indent=2))
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--reference", type=Path, default=DEFAULT_REFERENCE)
    parser.add_argument("--choices", type=Path, default=DEFAULT_CHOICES)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--seed", type=int, default=20260709)
    parser.add_argument("--metric-tolerance", type=float, default=0.025)
    return parser.parse_args()


if __name__ == "__main__":
    result = run(parse_args())
    raise SystemExit(0 if result["status"] == "PASS" else 1)
