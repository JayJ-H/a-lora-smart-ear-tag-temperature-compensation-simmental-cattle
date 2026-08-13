#!/usr/bin/env python3
"""Synchronize recomputed internal outputs with the bilingual public release tables."""

from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

import pandas as pd

from release_update_runtime_model import update_runtime_assets


ROOT = Path(__file__).resolve().parents[1]


def copy_file(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def package_paths(root: Path) -> dict[str, Path | str]:
    if (root / "数据").is_dir():
        return {
            "processed": root / "数据" / "处理数据",
            "raw": root / "数据" / "匿名质控数据",
            "reproduction": root / "分析" / "论文图源" / "图源复现",
            "data_name": "数据",
            "report": root / "输出" / "public_output_sync.json",
        }
    return {
        "processed": root / "data" / "processed",
        "raw": root / "data" / "quality_controlled_anonymized",
        "reproduction": root / "analysis" / "manuscript_figures" / "reproduction_sources",
        "data_name": "data",
        "report": root / "outputs" / "public_output_sync.json",
    }


def portable_executable_name(value: object) -> str:
    parts = re.split(r"[\\/]", str(value))
    return parts[-1] if parts and parts[-1] else "Rscript"


def sanitize_seed_metadata(root: Path) -> int:
    changed = 0
    seeds = root / "outputs" / "all_measured_multiseed" / "seeds"
    for directory in sorted(path for path in seeds.glob("*") if path.is_dir()):
        for name in ("run_summary.json", "launcher.stdout.log"):
            path = directory / name
            if not path.is_file():
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if "rscript" not in payload:
                continue
            portable = portable_executable_name(payload["rscript"])
            if payload["rscript"] != portable:
                payload["rscript"] = portable
                path.write_text(
                    json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8",
                )
                changed += 1
    return changed


def sanitize_benchmark_metadata(root: Path) -> int:
    changed = 0
    benchmark = root / "outputs" / "analysis" / "benchmark33"
    absolute_benchmark = re.compile(
        r"[A-Za-z]:[\\/][^\r\n]*?[\\/]outputs[\\/]analysis[\\/]benchmark33",
        flags=re.I,
    )
    for path in sorted(benchmark.glob("seeds/*/benchmark_run.log")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        portable = absolute_benchmark.sub("outputs/analysis/benchmark33", text)
        if portable != text:
            path.write_text(portable, encoding="utf-8", newline="\n")
            changed += 1

    report_path = benchmark / "five_seed_run_report.json"
    if report_path.is_file():
        report = json.loads(report_path.read_text(encoding="utf-8"))
        report_changed = False
        for run in report.get("runs", []):
            portable_log = (
                f"outputs/analysis/benchmark33/seeds/{int(run['seed'])}/benchmark_run.log"
            )
            if run.get("log") != portable_log:
                run["log"] = portable_log
                report_changed = True
        if report_changed:
            report_path.write_text(
                json.dumps(report, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            changed += 1
    return changed


def remove_nonrelease_outputs(root: Path) -> int:
    removed = 0
    obsolete = root / "outputs" / "analysis" / "seed_quantiles"
    if obsolete.exists():
        shutil.rmtree(obsolete)
        removed += 1
    obsolete_shap_weights = (
        root
        / "outputs"
        / "analysis"
        / "shap"
        / "ensemble_quantile_seed_weights.csv"
    )
    if obsolete_shap_weights.is_file():
        obsolete_shap_weights.unlink()
        removed += 1
    return removed


def public_oof(root: Path, measurements: pd.DataFrame) -> pd.DataFrame:
    ensemble = pd.read_csv(root / "outputs" / "all_measured_multiseed" / "ensemble_oof_predictions.csv")
    long = pd.read_csv(root / "outputs" / "all_measured_multiseed" / "oof_predictions_long.csv")
    branches = [
        "SourceMemoryPredicted",
        "BatchSessionPredicted",
        "HierarchicalResidualPredicted",
    ]
    branch_medians = (
        long.groupby("RecordID", sort=False)[branches]
        .median()
        .reset_index()
    )
    base = measurements[
        [
            "RecordID",
            "MeasurementUnitID",
            "CowKey",
            "Source",
            "RowID",
            "EarTemperature_C",
            "AmbientTemperature_C",
            "MeasurementTime_hour",
            "CoreReferenceTemperature_C",
        ]
    ].rename(
        columns={
            "EarTemperature_C": "Ear",
            "AmbientTemperature_C": "Air",
            "MeasurementTime_hour": "Time",
            "CoreReferenceTemperature_C": "Actual",
        }
    )
    prediction_columns = [column for column in ensemble if column.startswith("Predicted_")]
    return (
        base.merge(branch_medians, on="RecordID", validate="one_to_one")
        .merge(
            ensemble[["RecordID", *prediction_columns, "Predicted", "Residual", "DataClass"]],
            on="RecordID",
            validate="one_to_one",
        )
    )


def sync(root: Path) -> dict[str, object]:
    root = root.resolve()
    paths = package_paths(root)
    processed = Path(paths["processed"])
    raw = Path(paths["raw"])
    reproduction = Path(paths["reproduction"])
    data_name = str(paths["data_name"])
    measurements = pd.read_csv(root / "data" / "all_measured_520_th_shrc_input.csv")
    oof = public_oof(root, measurements)
    if len(measurements) != 520 or len(oof) != 520:
        raise RuntimeError("Public synchronization requires 520 measurement and OOF rows")

    processed.mkdir(parents=True, exist_ok=True)
    copy_file(
        root / "data" / "all_measured_520_th_shrc_input.csv",
        processed / "paired_temperature_records.csv",
    )
    oof.to_csv(processed / "th_shrc_oof_predictions.csv", index=False, lineterminator="\n")
    raw_table = measurements[
        [
            "RecordID",
            "CowKey",
            "Source",
            "RowID",
            "SourceRowID",
            "EarTemperature_C",
            "CoreReferenceTemperature_C",
            "AmbientTemperature_C",
            "MeasurementTime_hour",
        ]
    ]
    raw.mkdir(parents=True, exist_ok=True)
    raw_table.to_csv(
        raw / "paired_temperature_quality_controlled_anonymized.csv",
        index=False,
        lineterminator="\n",
    )

    runs_path = root / "outputs" / "all_measured_multiseed" / "runs.json"
    runs = json.loads(runs_path.read_text(encoding="utf-8"))
    for run in runs.get("runs", []):
        run["output"] = f"outputs/all_measured_multiseed/seeds/{int(run['seed'])}"
    runs_path.write_text(json.dumps(runs, indent=2) + "\n", encoding="utf-8")
    sanitized_seed_files = sanitize_seed_metadata(root)
    sanitized_benchmark_files = sanitize_benchmark_metadata(root)
    removed_nonrelease_directories = remove_nonrelease_outputs(root)

    direct = {
        "outputs/analysis/benchmark33/tables/14_full_model_benchmark_summary.csv": "model_benchmark_metrics.csv",
        "outputs/analysis/benchmark33/tables/14_full_model_benchmark_predictions.csv": "model_benchmark_oof_predictions.csv",
        "outputs/analysis/benchmark33/tables/14_full_model_benchmark_fold_metrics.csv": "model_benchmark_fold_metrics.csv",
        "outputs/analysis/benchmark33/tables/14_full_model_benchmark_model_inventory.csv": "model_benchmark_model_inventory.csv",
        "outputs/analysis/benchmark33/tables/14_evolutionary_search_choices.csv": "model_benchmark_evolutionary_choices.csv",
        "outputs/all_measured_multiseed/oof_predictions_long.csv": "th_shrc_five_seed_branch_oof_predictions.csv",
        "outputs/all_measured_multiseed/stack_weights_all_seeds.csv": "th_shrc_stack_weights_all_seeds.csv",
        "outputs/all_measured_multiseed/stack_weight_summary.csv": "th_shrc_stack_weight_summary.csv",
        "outputs/analysis/overfitting_checks/leave_one_seed_metrics.csv": "th_shrc_leave_one_seed_metrics.csv",
        "outputs/analysis/overfitting_checks/cow_bootstrap_metrics.csv": "th_shrc_cow_bootstrap_metrics.csv",
        "outputs/analysis/overfitting_checks/cow_permutation_r2.csv": "th_shrc_cow_permutation_r2.csv",
    }
    for source, name in direct.items():
        copy_file(root / source, processed / name)

    fig11_data = reproduction / "fig11" / data_name
    fig12_data = reproduction / "fig12" / data_name
    fig13_data = reproduction / "fig13" / data_name
    fig15_data = reproduction / "fig15" / data_name
    for directory in (fig11_data, fig12_data, fig13_data, fig15_data):
        directory.mkdir(parents=True, exist_ok=True)

    fig11 = measurements[
        ["EarTemperature_C", "AmbientTemperature_C", "CoreReferenceTemperature_C"]
    ].rename(
        columns={
            "EarTemperature_C": "Ear_surface_temperature_C",
            "AmbientTemperature_C": "Local_ambient_temperature_C",
            "CoreReferenceTemperature_C": "Core_temperature_C",
        }
    )
    fig11["Compensation_gap_C"] = fig11["Core_temperature_C"] - fig11["Ear_surface_temperature_C"]
    fig11.to_csv(fig11_data / "Fig11_true3D_plot_data.csv", index=False, lineterminator="\n")
    oof[["RecordID", "Ear", "Air", "Actual", "Predicted"]].to_csv(
        fig12_data / "Fig12_input_520_records.csv", index=False, lineterminator="\n"
    )
    benchmark = {
        "14_full_model_benchmark_summary.csv": "benchmark_summary.csv",
        "14_full_model_benchmark_fold_metrics.csv": "benchmark_fold.csv",
        "14_full_model_benchmark_predictions.csv": "benchmark_predictions.csv",
    }
    for source, name in benchmark.items():
        copy_file(root / "outputs" / "analysis" / "benchmark33" / "tables" / source, fig13_data / name)
    for name in (
        "th_shrc_ablation_metrics.csv",
        "th_shrc_ablation_bootstrap.csv",
        "th_shrc_ablation_oof_predictions.csv",
    ):
        copy_file(processed / name, fig15_data / name)

    runtime = update_runtime_assets(root)
    report = {
        "status": "PASS",
        "measurement_rows": len(measurements),
        "oof_rows": len(oof),
        "runtime": runtime,
        "sanitized_seed_metadata_files": sanitized_seed_files,
        "sanitized_benchmark_metadata_files": sanitized_benchmark_files,
        "removed_nonrelease_directories": removed_nonrelease_directories,
        "conditional_shap": "five-seed formal four-domain tables retained and verified separately",
    }
    report_path = Path(paths["report"])
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    sync(args.root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
