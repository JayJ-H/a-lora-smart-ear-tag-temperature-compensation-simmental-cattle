#!/usr/bin/env python3
"""Verify one bilingual 520-record authoring-release release."""

from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image


BASE_EXPECTED = {
    "rows": 520,
    "cattle": 30,
}
REPRODUCTION_TOLERANCE = 1e-4
MANUAL_FIGURES = tuple(range(10, 20))
MANUAL_ARTWORK_EXTENSIONS = {
    ".ai",
    ".eps",
    ".opj",
    ".opju",
    ".pdf",
    ".png",
    ".svg",
    ".tif",
    ".tiff",
}


def artwork_visible_text(path: Path) -> str:
    root = ET.parse(path).getroot()
    return "\n".join(
        "".join(element.itertext())
        for element in root.iter()
        if element.tag.rsplit("}", 1)[-1] == "text"
    )


def artwork_has_word(path: Path, word: str) -> bool:
    return re.search(
        r"(?<![a-z])" + re.escape(word.lower()) + r"(?![a-z])",
        artwork_visible_text(path).lower(),
    ) is not None


def metric_values(frame: pd.DataFrame) -> dict[str, float | int]:
    actual = frame["Actual"].to_numpy(float)
    predicted = frame["Predicted"].to_numpy(float)
    residual = actual - predicted
    denominator = np.sum((actual - np.mean(actual)) ** 2)
    return {
        "rows": int(len(frame)),
        "r2": float(1.0 - np.sum(residual**2) / denominator),
        "rmse": float(np.sqrt(np.mean(residual**2))),
        "mae": float(np.mean(np.abs(residual))),
    }


def package_paths(root: Path) -> dict[str, Path]:
    if (root / "数据").is_dir():
        return {
            "language": Path("zh"),
            "data": root / "数据" / "处理数据",
            "outputs": root / "输出",
            "figures": root / "分析" / "论文图源",
            "reproduction": root / "分析" / "论文图源" / "图源复现",
            "sources": root / "分析" / "论文图源" / "图源文件",
            "figure_output_name": Path("输出"),
            "runtime": root / "管理系统" / "源代码" / "脚本",
            "quality_controlled": root / "数据" / "匿名质控数据",
            "legacy_raw": root / "数据" / ("匿名" + "原始数据"),
            "firmware": root / "固件" / "耳标" / "main" / "main.cpp",
            "protocol": root / "固件" / "协议" / "packet_bit_layout.csv",
            "system_tests": root / "系统测试" / "run_system_tests.py",
        }
    return {
        "language": Path("en"),
        "data": root / "data" / "processed",
        "outputs": root / "outputs",
        "figures": root / "analysis" / "manuscript_figures",
        "reproduction": root / "analysis" / "manuscript_figures" / "reproduction_sources",
        "sources": root / "analysis" / "manuscript_figures" / "source_assets",
        "figure_output_name": Path("outputs"),
        "runtime": root / "backend" / "source_code" / "scripts",
        "quality_controlled": root / "data" / "quality_controlled_anonymized",
        "legacy_raw": root / "data" / ("raw_" + "anonymized"),
        "firmware": root / "firmware" / "ear_tag" / "main" / "main.cpp",
        "protocol": root / "firmware" / "protocol" / "packet_bit_layout.csv",
        "system_tests": root / "system_tests" / "run_system_tests.py",
    }


def add(checks: list[dict[str, object]], name: str, passed: bool, detail: str) -> None:
    checks.append({"check": name, "status": "PASS" if passed else "FAIL", "detail": detail})


def expected_contract(root: Path) -> dict[str, float | int]:
    summary = json.loads(
        (root / "outputs/all_measured_multiseed/summary.json").read_text(encoding="utf-8")
    )
    ensemble = summary["ensemble"]
    return {
        **BASE_EXPECTED,
        "r2": float(ensemble["R2"]),
        "rmse": float(ensemble["RMSE"]),
        "mae": float(ensemble["MAE"]),
    }


def verify(root: Path, manual_artwork: str = "auto") -> dict[str, object]:
    paths = package_paths(root)
    expected = expected_contract(root)
    data = paths["data"]
    checks: list[dict[str, object]] = []
    if manual_artwork == "auto":
        manual_artwork = "present"

    measurements = pd.read_csv(data / "paired_temperature_records.csv")
    formal_input_path = root / "data" / "all_measured_520_th_shrc_input.csv"
    oof = pd.read_csv(data / "th_shrc_oof_predictions.csv")
    metrics = metric_values(oof)
    quality_files = sorted(
        path.name for path in paths["quality_controlled"].glob("*.csv")
    )
    add(
        checks,
        "quality_controlled_public_data",
        paths["quality_controlled"].is_dir()
        and not paths["legacy_raw"].exists()
        and "paired_temperature_quality_controlled_anonymized.csv" in quality_files
        and "lora_packet_level_quality_controlled.csv" in quality_files,
        f"files={quality_files}; legacy_raw_exists={paths['legacy_raw'].exists()}",
    )
    firmware_text = paths["firmware"].read_text(encoding="utf-8")
    protocol_text = paths["protocol"].read_text(encoding="utf-8")
    system_test_text = paths["system_tests"].read_text(encoding="utf-8")
    add(
        checks,
        "temperature_protocol_45C",
        bool(re.search(r"^#define\s+TEMP_TENTHS_MAX\s+450\b", firmware_text, flags=re.M))
        and protocol_text.count("0.0..45.0 C") == 2
        and "0 <= ear <= 450" in system_test_text
        and '(85, 450, 450, "8b85c2")' in system_test_text,
        "two 9-bit temperature channels retain the 3-byte frame and accept 0.0-45.0 C",
    )
    add(
        checks,
        "measurement_contract",
        len(measurements) == expected["rows"]
        and measurements["CowKey"].nunique() == expected["cattle"]
        and measurements["RecordID"].nunique() == expected["rows"]
        and set(measurements["Source"].astype(str)) == {"S01"}
        and np.allclose(measurements["SourceWeight"].to_numpy(float), 1.0),
        f"rows={len(measurements)}, cattle={measurements['CowKey'].nunique()}",
    )
    add(
        checks,
        "session_aware_processed_input",
        formal_input_path.is_file()
        and (data / "paired_temperature_records.csv").read_bytes()
        == formal_input_path.read_bytes(),
        "processed measurement table is byte-identical to the formal session-aware model input",
    )
    data_readme = (data.parent / "README.md").read_text(encoding="utf-8")
    add(
        checks,
        "acquisition_session_definition",
        "AcquisitionSession" in data_readme
        and ("不暴露日历日期" in data_readme or "without exposing calendar dates" in data_readme),
        "AcquisitionSession is documented as an anonymized within-session ordering identifier",
    )
    cross_cow_report_path = (
        root / "outputs" / "validation" / "cross_cow_independence" / "summary.json"
    )
    cross_cow_report = (
        json.loads(cross_cow_report_path.read_text(encoding="utf-8"))
        if cross_cow_report_path.is_file()
        else {}
    )
    maximum_pair_matches = cross_cow_report.get("maximum_pair_match_count")
    declared_pair_limit = cross_cow_report.get("thresholds", {}).get(
        "max_pair_matches"
    )
    add(
        checks,
        "cross_cow_independence_check",
        cross_cow_report.get("status") == "PASS"
        and cross_cow_report.get("pair_count") == 435
        and cross_cow_report.get("exact_duplicate_groups") == 0
        and cross_cow_report.get("ear_core_time_triplet_groups") == 0
        and isinstance(maximum_pair_matches, int)
        and isinstance(declared_pair_limit, int)
        and maximum_pair_matches <= declared_pair_limit,
        (
            f"report_exists={cross_cow_report_path.is_file()}, "
            f"status={cross_cow_report.get('status')}, "
            f"pairs={cross_cow_report.get('pair_count')}, "
            f"exact_groups={cross_cow_report.get('exact_duplicate_groups')}, "
            f"ear_core_time_groups={cross_cow_report.get('ear_core_time_triplet_groups')}, "
            f"maximum_pair_matches={maximum_pair_matches}, limit={declared_pair_limit}"
        ),
    )
    signature_columns = [
        "EarTemperature_C",
        "CoreReferenceTemperature_C",
        "AmbientTemperature_C",
        "MeasurementTime_hour",
    ]
    triplet_columns = [
        "EarTemperature_C",
        "CoreReferenceTemperature_C",
        "MeasurementTime_hour",
    ]
    signature_duplicates = int(
        measurements.groupby(signature_columns, dropna=False).size().gt(1).sum()
    )
    triplet_duplicates = int(
        measurements.groupby(triplet_columns, dropna=False).size().gt(1).sum()
    )
    add(
        checks,
        "independent_measurements",
        signature_duplicates == 0 and triplet_duplicates == 0,
        f"four_field_groups={signature_duplicates}, ear_core_time_groups={triplet_duplicates}",
    )
    add(
        checks,
        "formal_oof_metrics",
        len(oof) == expected["rows"]
        and oof["RecordID"].nunique() == expected["rows"]
        and all(abs(float(metrics[key]) - float(expected[key])) <= REPRODUCTION_TOLERANCE for key in ("r2", "rmse", "mae")),
        json.dumps(metrics, sort_keys=True),
    )

    formal_ensemble = pd.read_csv(
        root / "outputs" / "all_measured_multiseed" / "ensemble_oof_predictions.csv"
    )
    frozen_columns = [
        "Actual",
        "Predicted_20260523",
        "Predicted_20260607",
        "Predicted_20260701",
        "Predicted_20260811",
        "Predicted_20260903",
        "Predicted",
        "Residual",
    ]
    exact_oof = (
        len(oof) == len(formal_ensemble)
        and np.array_equal(
            oof["RecordID"].astype(str).to_numpy(),
            formal_ensemble["RecordID"].astype(str).to_numpy(),
        )
        and np.array_equal(
            oof[frozen_columns].to_numpy(float),
            formal_ensemble[frozen_columns].to_numpy(float),
        )
    )
    add(
        checks,
        "frozen_oof_rows",
        exact_oof,
        "formal ensemble and public OOF predictions match row by row",
    )

    benchmark_summary = pd.read_csv(data / "model_benchmark_metrics.csv")
    benchmark_predictions = pd.read_csv(data / "model_benchmark_oof_predictions.csv")
    counts = benchmark_predictions.groupby("Model", sort=False).size()
    add(
        checks,
        "benchmark_33_models",
        benchmark_summary["Model"].nunique() == 33
        and len(counts) == 33
        and counts.eq(expected["rows"]).all(),
        f"models={len(counts)}, rows_per_model={sorted(counts.unique().tolist())}",
    )

    ablation = pd.read_csv(data / "th_shrc_ablation_metrics.csv")
    ablation_rows = pd.read_csv(data / "th_shrc_ablation_oof_predictions.csv")
    full = ablation.loc[ablation["Configuration"] == "Full A+B+C"].iloc[0]
    add(
        checks,
        "strict_ablation",
        len(ablation) == 4
        and len(ablation_rows) == expected["rows"]
        and abs(float(full["R2"]) - float(expected["r2"])) <= REPRODUCTION_TOLERANCE
        and abs(float(full["MAE_C"]) - float(expected["mae"])) <= REPRODUCTION_TOLERANCE,
        f"configurations={len(ablation)}, rows={len(ablation_rows)}",
    )

    shap = pd.read_csv(data / "th_shrc_shap_values.csv")
    shap_summary = pd.read_csv(data / "th_shrc_shap_summary.csv")
    add(
        checks,
        "conditional_shap",
        len(shap) == expected["rows"]
        and shap["RecordID"].nunique() == expected["rows"]
        and len(shap_summary) == 4
        and float(np.abs(shap["AdditivityDifference_C"]).max()) <= 1e-12,
        f"rows={len(shap)}, groups={len(shap_summary)}",
    )

    panel_manifest = paths["figures"] / "panel_manifest.csv"
    panels = pd.read_csv(panel_manifest)
    missing: list[str] = []
    for row in panels.itertuples(index=False):
        directory = (
            paths["reproduction"]
            / f"fig{int(row.manuscript_figure):02d}"
            / paths["figure_output_name"]
        )
        stem = str(row.output_stem)
        for suffix in (".png", ".svg"):
            if not (directory / f"{stem}{suffix}").is_file():
                missing.append(f"Fig{row.manuscript_figure}{row.panel}:{suffix}")
    add(checks, "program_panels", len(panels) == 23 and not missing, f"panels={len(panels)}, missing={missing}")

    size_manifest = pd.read_csv(paths["figures"] / "PANEL_SIZE_MANIFEST.csv")
    fig12_geometry: list[dict[str, object]] = []
    fig12_geometry_ok = True
    for row in panels.loc[panels["manuscript_figure"].eq(12)].itertuples(index=False):
        png = (
            paths["reproduction"]
            / "fig12"
            / paths["figure_output_name"]
            / f"{row.output_stem}.png"
        )
        size_row = size_manifest.loc[
            size_manifest["panel"].astype(str).eq(str(row.output_stem))
        ].iloc[0]
        with Image.open(png) as image:
            dpi_x, dpi_y = image.info.get("dpi", (0.0, 0.0))
            expected_width = float(size_row["width_mm"]) / 25.4 * float(dpi_x)
            expected_height = float(size_row["height_mm"]) / 25.4 * float(dpi_y)
            panel_ok = (
                abs(float(dpi_x) - 600.0) <= 0.1
                and abs(float(dpi_y) - 600.0) <= 0.1
                and abs(image.width - expected_width) <= 1.0
                and abs(image.height - expected_height) <= 1.0
            )
            fig12_geometry_ok = fig12_geometry_ok and panel_ok
            fig12_geometry.append(
                {
                    "panel": str(row.output_stem),
                    "pixels": [image.width, image.height],
                    "dpi": [round(float(dpi_x), 3), round(float(dpi_y), 3)],
                }
            )
    add(
        checks,
        "fig12_small_panel_geometry",
        fig12_geometry_ok and len(fig12_geometry) == 4,
        json.dumps(fig12_geometry, ensure_ascii=False),
    )

    artwork_spelling_findings: list[str] = []
    for figure, correct_spelling, removed_index in (
        (3, "Backoff", 6),
        (4, "Information", 4),
    ):
        misspelling = (
            correct_spelling[:removed_index] + correct_spelling[removed_index + 1 :]
        )
        for suffix in (".svg",):
            artwork = paths["sources"] / f"fig{figure:02d}" / "final" / f"Fig{figure:02d}{suffix}"
            if not artwork.is_file():
                artwork_spelling_findings.append(f"missing:{artwork.relative_to(root)}")
            elif not artwork_has_word(artwork, correct_spelling):
                artwork_spelling_findings.append(
                    f"{artwork.relative_to(root)}:missing-{correct_spelling}"
                )
            elif artwork_has_word(artwork, misspelling):
                artwork_spelling_findings.append(
                    f"{artwork.relative_to(root)}:{misspelling}"
                )
    add(
        checks,
        "final_artwork_spelling",
        not artwork_spelling_findings,
        f"findings={artwork_spelling_findings}",
    )

    manual_files: dict[int, list[str]] = {}
    for figure in MANUAL_FIGURES:
        directory = paths["sources"] / f"fig{figure:02d}"
        manual_files[figure] = (
            [
                str(path.relative_to(root))
                for path in directory.rglob("*")
                if path.is_file() and path.suffix.lower() in MANUAL_ARTWORK_EXTENSIONS
            ]
            if directory.exists()
            else []
        )
    populated = [figure for figure, files in manual_files.items() if files]
    if manual_artwork == "empty":
        add(checks, "manual_final_slots_empty", not populated, f"populated_figures={populated}")
    elif manual_artwork == "editable":
        missing_figures = [
            figure
            for figure, files in manual_files.items()
            if not any(Path(path).suffix.lower() == ".ai" for path in files)
        ]
        add(
            checks,
            "editable_illustrator_sources_complete",
            not missing_figures,
            f"populated_figures={populated}, missing_ai_figures={missing_figures}; final files supplied",
        )
    elif manual_artwork == "present":
        missing_figures = [figure for figure, files in manual_files.items() if not files]
        add(
            checks,
            "manual_final_artwork_complete",
            not missing_figures,
            f"populated_figures={populated}, missing_figures={missing_figures}",
        )
    elif manual_artwork == "ignore":
        add(checks, "manual_final_artwork_not_checked", True, f"populated_figures={populated}")
    else:
        raise ValueError(f"Unsupported manual-artwork mode: {manual_artwork}")

    fig20_paths = [
        path
        for path in paths["figures"].rglob("*")
        if path.is_file() and "fig20" in str(path.relative_to(paths["figures"])).lower()
    ]
    add(
        checks,
        "manuscript_scope_fig1_to_fig19",
        not fig20_paths,
        f"fig20_files={[str(path.relative_to(root)) for path in fig20_paths]}",
    )

    runtime_scripts = paths["runtime"]
    runtime_asset = runtime_scripts / "assets" / "th-shrc" / "runtime-model-v3-exact.json"
    runtime = json.loads(runtime_asset.read_text(encoding="utf-8"))
    runtime_references = runtime.get("referenceRows", [])
    runtime_metrics = runtime.get("validation", {}).get("metrics", {})
    validator_text = "\n".join(
        (runtime_scripts / name).read_text(encoding="utf-8")
        for name in ("validate-th-shrc-runtime.mjs", "validate-th-shrc-exact-reference.mjs")
    )
    add(
        checks,
        "management_runtime_520",
        runtime.get("version") == "th-shrc-runtime-v3-all-measured-520"
        and runtime.get("fullName") == "Thermal-Hysteresis-aware Stacked Hierarchical Residual Compensation"
        and runtime.get("trainingScope", {}).get("rows") == expected["rows"]
        and runtime.get("trainingScope", {}).get("sources") == ["S01"]
        and len(runtime_references) == expected["rows"]
        and len({row.get("rowId") for row in runtime_references}) == expected["rows"]
        and {row.get("source") for row in runtime_references} == {"S01"}
        and abs(float(runtime_metrics.get("r2")) - float(expected["r2"])) <= REPRODUCTION_TOLERANCE
        and abs(float(runtime_metrics.get("mae")) - float(expected["mae"])) <= REPRODUCTION_TOLERANCE
        and "model.trainingScope?.rows, 503" not in validator_text,
        f"version={runtime.get('version')}, rows={len(runtime_references)}, sources={sorted({row.get('source') for row in runtime_references})}",
    )

    required_commands = [root / "run_all_checks.py", root / "run_analysis_pipeline.py", root / "plot_manuscript_panels.py"]
    add(
        checks,
        "root_reproduction_commands",
        all(path.is_file() for path in required_commands),
        f"commands={[path.name for path in required_commands if path.is_file()]}",
    )

    project_root_marker = "G:/" + "Project/"
    user_root_marker = "C:/" + "Users/"
    absolute_pattern = re.compile(
        r"(?:[A-Za-z]:\\|"
        + re.escape(project_root_marker)
        + "|"
        + re.escape(user_root_marker)
        + ")"
    )
    generated_json = [
        paths["outputs"] / "repository_validation.json",
        paths["outputs"] / "full_verification_results.json",
        paths["outputs"] / "manuscript_panel_rebuild.json",
        paths["outputs"] / "public_output_sync.json",
    ]
    leaked_paths = []
    for path in generated_json:
        if path.is_file() and absolute_pattern.search(path.read_text(encoding="utf-8", errors="ignore")):
            leaked_paths.append(str(path.relative_to(root)))
    add(checks, "portable_generated_reports", not leaked_paths, f"absolute_path_reports={leaked_paths}")

    runs_path = root / "outputs" / "all_measured_multiseed" / "runs.json"
    runs = json.loads(runs_path.read_text(encoding="utf-8"))
    run_outputs = [str(row.get("output", "")) for row in runs.get("runs", [])]
    add(
        checks,
        "portable_seed_run_manifest",
        len(run_outputs) == 5
        and all(output.startswith("outputs/all_measured_multiseed/seeds/") for output in run_outputs)
        and not any(absolute_pattern.search(output) for output in run_outputs),
        f"outputs={run_outputs}",
    )
    seed_metadata = [
        path
        for directory in sorted((root / "outputs" / "all_measured_multiseed" / "seeds").glob("*"))
        if directory.is_dir()
        for name in ("run_summary.json", "launcher.stdout.log")
        if (path := directory / name).is_file()
    ]
    local_seed_metadata = [
        str(path.relative_to(root))
        for path in seed_metadata
        if absolute_pattern.search(path.read_text(encoding="utf-8", errors="ignore"))
    ]
    add(
        checks,
        "portable_seed_run_metadata",
        len(seed_metadata) == 10 and not local_seed_metadata,
        f"files={len(seed_metadata)}, machine_local={local_seed_metadata}",
    )

    benchmark_portability_files = [
        *sorted((root / "outputs" / "analysis" / "benchmark33" / "seeds").glob("*/benchmark_run.log")),
        root / "outputs" / "analysis" / "benchmark33" / "five_seed_run_report.json",
    ]
    local_benchmark_metadata = [
        str(path.relative_to(root))
        for path in benchmark_portability_files
        if path.is_file()
        and absolute_pattern.search(path.read_text(encoding="utf-8", errors="ignore"))
    ]
    obsolete_quantile_output = root / "outputs" / "analysis" / "seed_quantiles"
    obsolete_shap_weights = (
        root
        / "outputs"
        / "analysis"
        / "shap"
        / "ensemble_quantile_seed_weights.csv"
    )
    add(
        checks,
        "release_output_hygiene",
        not obsolete_quantile_output.exists()
        and not obsolete_shap_weights.exists()
        and not local_benchmark_metadata,
        (
            f"obsolete_quantile_output={obsolete_quantile_output.exists()}, "
            f"obsolete_shap_weights={obsolete_shap_weights.exists()}, "
            f"machine_local_benchmark_metadata={local_benchmark_metadata}"
        ),
    )
    non_ascii_paths = [
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if not path.relative_to(root).as_posix().isascii()
    ]
    add(
        checks,
        "english_release_paths_ascii",
        str(paths["language"]) != "en" or not non_ascii_paths,
        f"non_ascii_path_count={len(non_ascii_paths)}",
    )

    status = "PASS" if all(row["status"] == "PASS" for row in checks) else "FAIL"
    payload = {
        "status": status,
        "language": str(paths["language"]),
        "root": ".",
        "manual_artwork": manual_artwork,
        "expected": expected,
        "checks": checks,
    }
    output = paths["outputs"] / "repository_validation.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument(
        "--manual-artwork",
        choices=("auto", "empty", "editable", "present", "ignore"),
        default="auto",
        help="Validate author-managed Fig. 10-19 slots; auto validates the included final artwork.",
    )
    args = parser.parse_args()
    payload = verify(args.root.resolve(), args.manual_artwork)
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0 if payload["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
