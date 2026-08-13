#!/usr/bin/env python3
"""Run and aggregate the 33-model benchmark across the five fixed fold seeds."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

from build_benchmark_input import run as build_input
from experiment_common import MULTISEED_DIR, ROOT, SEEDS, load_config
from run_33_model_benchmark import PROPOSED_MODEL_NAME, metric_dict


DEFAULT_OUTPUT = ROOT / "outputs" / "analysis" / "benchmark33"
TABLE_NAMES = {
    "summary": "14_full_model_benchmark_summary.csv",
    "fold": "14_full_model_benchmark_fold_metrics.csv",
    "predictions": "14_full_model_benchmark_predictions.csv",
    "inventory": "14_full_model_benchmark_model_inventory.csv",
    "choices": "14_evolutionary_search_choices.csv",
    "class_metrics": "15_model_metrics_by_data_class.csv",
}


def json_text(payload: object) -> str:
    """Serialize pandas/numpy scalar values without weakening the report schema."""
    return json.dumps(
        payload,
        indent=2,
        default=lambda value: value.item() if isinstance(value, np.generic) else str(value),
    )


def seed_dir(output_dir: Path, seed: int) -> Path:
    return output_dir / "seeds" / str(seed)


def prepare_inputs(output_dir: Path) -> list[dict[str, object]]:
    reports = []
    for seed in SEEDS:
        target = seed_dir(output_dir, seed) / "benchmark_input.csv"
        reports.append(
            build_input(
                ROOT / "data" / "all_measured_520_th_shrc_input.csv",
                ROOT / "data" / "all_measured_520_traceable.csv",
                MULTISEED_DIR / "oof_predictions_long.csv",
                target,
                seed,
            )
        )
    return reports


def run_seed(output_dir: Path, seed: int) -> dict[str, object]:
    directory = seed_dir(output_dir, seed)
    log_path = directory / "benchmark_run.log"
    command = [
        sys.executable,
        str(ROOT / "scripts" / "run_33_model_benchmark.py"),
        "--input",
        str(directory / "benchmark_input.csv"),
        "--output-dir",
        str(directory),
        "--seed",
        str(seed),
        "--fail-fast",
    ]
    start = time.perf_counter()
    with log_path.open("w", encoding="utf-8", newline="\n") as log:
        completed = subprocess.run(
            command,
            cwd=ROOT,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
            check=False,
        )
    report = {
        "seed": seed,
        "return_code": completed.returncode,
        "elapsed_seconds": time.perf_counter() - start,
        "log": log_path.resolve().relative_to(ROOT.resolve()).as_posix(),
    }
    if completed.returncode != 0:
        raise RuntimeError(json_text(report))
    verification = json.loads(
        (directory / "benchmark_verification.json").read_text(encoding="utf-8")
    )
    if verification.get("status") != "PASS":
        raise RuntimeError(f"seed {seed} verification failed: {verification}")
    return report


def run_all_seeds(output_dir: Path, workers: int) -> list[dict[str, object]]:
    reports = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(run_seed, output_dir, seed): seed for seed in SEEDS}
        for future in as_completed(futures):
            report = future.result()
            reports.append(report)
            print(
                f"[seed {report['seed']}] PASS in {report['elapsed_seconds']:.1f} s",
                flush=True,
            )
    return sorted(reports, key=lambda row: int(row["seed"]))


def read_seed_table(output_dir: Path, seed: int, key: str) -> pd.DataFrame:
    return pd.read_csv(
        seed_dir(output_dir, seed) / "tables" / TABLE_NAMES[key],
        encoding="utf-8-sig",
    )


def aggregate(output_dir: Path, run_reports: list[dict[str, object]]) -> dict[str, object]:
    tables_dir = output_dir / "tables"
    tables_dir.mkdir(parents=True, exist_ok=True)
    seed_prediction_parts = []
    seed_fold_parts = []
    seed_summary_parts = []
    seed_choice_parts = []
    seed_inventory_parts = []
    seed_verifications = []
    for seed in SEEDS:
        predictions = read_seed_table(output_dir, seed, "predictions")
        predictions.insert(0, "Seed", seed)
        seed_prediction_parts.append(predictions)
        fold_metrics = read_seed_table(output_dir, seed, "fold")
        fold_metrics.insert(0, "Seed", seed)
        seed_fold_parts.append(fold_metrics)
        summary = read_seed_table(output_dir, seed, "summary")
        summary.insert(0, "Seed", seed)
        seed_summary_parts.append(summary)
        choices = read_seed_table(output_dir, seed, "choices")
        choices.insert(0, "Seed", seed)
        seed_choice_parts.append(choices)
        inventory = read_seed_table(output_dir, seed, "inventory")
        inventory.insert(0, "Seed", seed)
        seed_inventory_parts.append(inventory)
        seed_verifications.append(
            json.loads(
                (seed_dir(output_dir, seed) / "benchmark_verification.json").read_text(
                    encoding="utf-8"
                )
            )
        )

    seed_predictions = pd.concat(seed_prediction_parts, ignore_index=True)
    seed_fold_metrics = pd.concat(seed_fold_parts, ignore_index=True)
    seed_summaries = pd.concat(seed_summary_parts, ignore_index=True)
    seed_choices = pd.concat(seed_choice_parts, ignore_index=True)
    seed_inventories = pd.concat(seed_inventory_parts, ignore_index=True)
    key = ["Model", "RowID"]
    invariant_columns = [
        "ModelFamily",
        "BenchmarkGroup",
        "FeatureSet",
        "CowKey",
        "Source",
        "Actual",
    ]
    invariant_ok = all(
        seed_predictions.groupby(key)[column].nunique(dropna=False).eq(1).all()
        for column in invariant_columns
    )
    formal = (
        seed_predictions.sort_values([*key, "Seed"])
        .groupby(key, as_index=False)
        .agg(
            ModelFamily=("ModelFamily", "first"),
            BenchmarkGroup=("BenchmarkGroup", "first"),
            FeatureSet=("FeatureSet", "first"),
            CowKey=("CowKey", "first"),
            Source=("Source", "first"),
            Actual=("Actual", "first"),
            Predicted=("Predicted", "median"),
        )
    )
    formal.insert(5, "FoldID", "five_seed_median")
    formal.insert(6, "FoldMode", "five_fixed_partitions_rowwise_median")
    formal["SeedCount"] = len(SEEDS)
    formal["Aggregation"] = "rowwise_median"
    formal = formal[
        [
            "Model",
            "ModelFamily",
            "BenchmarkGroup",
            "FeatureSet",
            "RowID",
            "FoldID",
            "FoldMode",
            "CowKey",
            "Source",
            "Actual",
            "Predicted",
            "SeedCount",
            "Aggregation",
        ]
    ].sort_values(["Model", "RowID"])

    elapsed_by_model = seed_summaries.groupby("Model")["ElapsedSecondsTotal"].sum()
    notes_by_model = seed_inventories.groupby("Model")["Notes"].first()
    summary_rows = []
    for model, group in formal.groupby("Model", sort=True):
        first = group.iloc[0]
        summary_rows.append(
            {
                "Model": model,
                "ModelFamily": first["ModelFamily"],
                "BenchmarkGroup": first["BenchmarkGroup"],
                "FeatureSet": (
                    "five_seed_th_shrc_ensemble"
                    if model == PROPOSED_MODEL_NAME
                    else first["FeatureSet"]
                ),
                "FoldMode": "five_fixed_partitions_rowwise_median",
                "FoldCountPerSeed": 5,
                "SeedCount": len(SEEDS),
                "CowCount": int(group["CowKey"].nunique()),
                "SourceCount": int(group["Source"].nunique()),
                "ElapsedSecondsTotal": float(elapsed_by_model[model]),
                "Notes": str(notes_by_model[model])
                + " Formal prediction is the rowwise median across five fold seeds.",
                **metric_dict(
                    group["Actual"].to_numpy(float), group["Predicted"].to_numpy(float)
                ),
            }
        )
    summary = pd.DataFrame(summary_rows).sort_values(
        ["R2", "RMSE"], ascending=[False, True]
    )

    seed_fold_metrics["Notes"] = (
        seed_fold_metrics["Notes"].astype(str)
        + " Seed-level fold metric before formal rowwise-median aggregation."
    )
    fold_metrics = seed_fold_metrics.sort_values(["Model", "Seed", "FoldID"])

    inventory_rows = []
    for model, group in seed_inventories.groupby("Model", sort=True):
        first = group.iloc[0]
        inventory_rows.append(
            {
                "Model": model,
                "ModelFamily": first["ModelFamily"],
                "BenchmarkGroup": first["BenchmarkGroup"],
                "FeatureSet": (
                    "five_seed_th_shrc_ensemble"
                    if model == PROPOSED_MODEL_NAME
                    else first["FeatureSet"]
                ),
                "SeedCount": int(group["Seed"].nunique()),
                "Aggregation": "rowwise_median",
                "RunStatus": "done" if group["RunStatus"].eq("done").all() else "failed",
                "Notes": str(first["Notes"]),
            }
        )
    inventory = pd.DataFrame(inventory_rows)
    class_metrics = summary[
        [
            "Model",
            "ModelFamily",
            "BenchmarkGroup",
            "N",
            "R2",
            "RMSE",
            "MAE",
            "Bias_actual_minus_pred",
            "ErrorSD",
            "MedianAE",
            "P75_AE",
            "P90_AE",
            "P95_AE",
            "MaxAE",
            "Within_0_1C",
            "Within_0_2C",
            "Within_0_3C",
            "Within_0_5C",
        ]
    ].copy()
    class_metrics.insert(3, "DataClass", "measured")

    counts = seed_predictions.groupby(["Model", "Seed"]).agg(
        Rows=("RowID", "size"), UniqueRows=("RowID", "nunique")
    )
    formal_counts = formal.groupby("Model").agg(
        Rows=("RowID", "size"), UniqueRows=("RowID", "nunique")
    )
    median_recomputed = seed_predictions.groupby(key)["Predicted"].median()
    formal_indexed = formal.set_index(key)["Predicted"]
    median_difference = float(
        np.max(np.abs(median_recomputed.sort_index() - formal_indexed.sort_index()))
    )
    official = pd.read_csv(MULTISEED_DIR / "ensemble_oof_predictions.csv")
    row_lookup = pd.read_csv(seed_dir(output_dir, SEEDS[0]) / "benchmark_input.csv")[
        ["RowID", "RecordID"]
    ]
    official = official.merge(row_lookup, on="RecordID", validate="one_to_one")
    th_formal = formal.loc[formal["Model"].eq(PROPOSED_MODEL_NAME), ["RowID", "Predicted"]]
    th_check = th_formal.merge(
        official[["RowID", "Predicted"]],
        on="RowID",
        suffixes=("_benchmark", "_official"),
        validate="one_to_one",
    )
    th_difference = float(
        np.max(
            np.abs(
                th_check["Predicted_benchmark"].to_numpy(float)
                - th_check["Predicted_official"].to_numpy(float)
            )
        )
    )
    checks = {
        "five_fixed_seeds": bool(
            sorted(seed_predictions["Seed"].unique().tolist()) == sorted(SEEDS)
        ),
        "all_seed_runs_pass": all(item.get("status") == "PASS" for item in seed_verifications),
        "seed_prediction_coverage": len(seed_predictions) == 33 * len(SEEDS) * 520
        and counts["Rows"].eq(520).all()
        and counts["UniqueRows"].eq(520).all(),
        "formal_prediction_coverage": len(formal) == 33 * 520
        and formal_counts["Rows"].eq(520).all()
        and formal_counts["UniqueRows"].eq(520).all(),
        "model_count": summary["Model"].nunique() == 33,
        "metadata_invariant_across_seeds": bool(invariant_ok),
        "rowwise_median_recalculates": median_difference <= 1e-12,
        "th_shrc_matches_formal_ensemble": th_difference <= 1e-12,
        "inventory_complete": len(inventory) == 33
        and inventory["RunStatus"].eq("done").all()
        and inventory["SeedCount"].eq(len(SEEDS)).all(),
        "fold_metric_coverage": len(fold_metrics) == 33 * len(SEEDS) * 5,
    }
    verification = {
        "status": "PASS" if all(checks.values()) else "FAIL",
        "validation_design": "five fixed measurement-unit-grouped same-animal five-fold OOF partitions",
        "formal_aggregation": "rowwise_median",
        "benchmark_scope": "modeling-strategy comparison; feature information budgets differ because TH-SHRC includes lag and acquisition-session features",
        "seeds": SEEDS,
        "expected_model_count": 33,
        "retrained_model_count": int(summary["Model"].nunique()),
        "rows_per_model": 520,
        "seed_level_prediction_rows": len(seed_predictions),
        "formal_prediction_rows": len(formal),
        "failed_models": inventory.loc[
            inventory["RunStatus"].ne("done"), "Model"
        ].tolist(),
        "incomplete_models": formal_counts.loc[
            formal_counts["Rows"].ne(520) | formal_counts["UniqueRows"].ne(520)
        ].index.tolist(),
        "max_rowwise_median_difference_C": median_difference,
        "max_th_shrc_official_difference_C": th_difference,
        "checks": checks,
    }

    summary.to_csv(tables_dir / TABLE_NAMES["summary"], index=False, encoding="utf-8-sig")
    fold_metrics.to_csv(tables_dir / TABLE_NAMES["fold"], index=False, encoding="utf-8-sig")
    formal.to_csv(tables_dir / TABLE_NAMES["predictions"], index=False, encoding="utf-8-sig")
    inventory.to_csv(tables_dir / TABLE_NAMES["inventory"], index=False, encoding="utf-8-sig")
    seed_choices.to_csv(tables_dir / TABLE_NAMES["choices"], index=False, encoding="utf-8-sig")
    class_metrics.to_csv(
        tables_dir / TABLE_NAMES["class_metrics"], index=False, encoding="utf-8-sig"
    )
    seed_predictions.to_csv(
        tables_dir / "14_full_model_benchmark_seed_predictions.csv",
        index=False,
        encoding="utf-8-sig",
    )
    seed_summaries.to_csv(
        tables_dir / "14_full_model_benchmark_seed_summary.csv",
        index=False,
        encoding="utf-8-sig",
    )
    seed_inventories.to_csv(
        tables_dir / "14_full_model_benchmark_seed_inventory.csv",
        index=False,
        encoding="utf-8-sig",
    )
    (output_dir / "benchmark_verification.json").write_text(
        json_text(verification) + "\n", encoding="utf-8"
    )
    (output_dir / "runtime_environment.json").write_text(
        json_text(
            {
                "python": sys.version.split()[0],
                "seeds": SEEDS,
                "formal_aggregation": "rowwise_median",
                "parallel_seed_processes": len(SEEDS),
            },
        )
        + "\n",
        encoding="utf-8",
    )
    report_lines = [
        "# 33-model five-seed benchmark",
        "",
        "Each strategy was evaluated under the same five fixed OOF fold seeds; formal predictions are rowwise medians.",
        "This is a modeling-strategy comparison, not an equal-information-budget comparison, because TH-SHRC includes lag and acquisition-session features.",
        "",
        "| Model | R2 | RMSE (C) | MAE (C) |",
        "|---|---:|---:|---:|",
    ]
    for _, row in summary.head(12).iterrows():
        report_lines.append(
            f"| {row['Model']} | {row['R2']:.4f} | {row['RMSE']:.4f} | {row['MAE']:.4f} |"
        )
    (output_dir / "benchmark_reproduction_report.md").write_text(
        "\n".join(report_lines) + "\n", encoding="utf-8"
    )
    (output_dir / "five_seed_run_report.json").write_text(
        json_text(
            {
                "status": verification["status"],
                "inputs": prepare_inputs(output_dir) if False else "prepared before runs",
                "runs": run_reports,
                "verification": verification,
            },
        )
        + "\n",
        encoding="utf-8",
    )
    return verification


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--workers", type=int, default=len(SEEDS))
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--aggregate-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = args.output_dir.resolve()
    config = load_config()
    if config.get("seed_ensemble_method") != "rowwise_median":
        raise RuntimeError("benchmark requires the declared rowwise_median ensemble")
    input_reports = prepare_inputs(output_dir)
    if args.prepare_only:
        print(json_text({"status": "PASS", "inputs": input_reports}))
        return 0
    run_reports = [] if args.aggregate_only else run_all_seeds(output_dir, args.workers)
    verification = aggregate(output_dir, run_reports)
    print(json_text(verification))
    return 0 if verification["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
