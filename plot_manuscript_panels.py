#!/usr/bin/env python3
"""Rebuild and distribute the 23 program-generated manuscript panels."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


GROUPS = ("10", "12", "13-14", "15-17", "18-19")
MAPPINGS = {
    "10": [
        (10, "Fig10b_PDR_NatureStyle", "Fig10b_PDR", ("png", "svg", "pdf")),
        (10, "Fig10c_RSSI_NatureStyle", "Fig10c_RSSI", ("png", "svg", "pdf")),
        (10, "Fig10d_SNR_NatureStyle", "Fig10d_SNR", ("png", "svg", "pdf")),
    ],
    "12": [
        (12, "Fig12a_before_compensation", "Fig12a_before_compensation", ("png", "svg", "pdf", "tiff")),
        (12, "Fig12b_after_compensation", "Fig12b_after_compensation", ("png", "svg", "pdf", "tiff")),
        (12, "Fig12c_bland_altman_standard", "Fig12c_bland_altman", ("png", "svg", "pdf", "tiff")),
        (12, "Fig12d_absolute_error_ecdf", "Fig12d_absolute_error_ecdf", ("png", "svg", "pdf", "tiff")),
    ],
    "13-14": [
        (13, "Fig13A1_all33_R2", "Fig13a_R2_33_models", ("png", "svg", "pdf", "tiff")),
        (13, "Fig13A2_all33_RMSE", "Fig13b_RMSE_33_models", ("png", "svg", "pdf", "tiff")),
        (13, "Fig13A3_all33_MAE", "Fig13c_MAE_33_models", ("png", "svg", "pdf", "tiff")),
        (14, "Fig14a_DE_XGBoost", "Fig14a_DE_XGBoost", ("png", "svg", "pdf", "tiff")),
        (14, "Fig14b_Ear_only_linear", "Fig14b_Ear_only_linear", ("png", "svg", "pdf", "tiff")),
        (14, "Fig14c_LightGBM", "Fig14c_LightGBM", ("png", "svg", "pdf", "tiff")),
        (14, "Fig14d_TH_SHRC", "Fig14d_TH_SHRC", ("png", "svg", "pdf", "tiff")),
    ],
    "15-17": [
        (15, "Fig15a_component_combination_ablation", "Fig15a_component_combination_ablation", ("png", "svg", "pdf", "tiff")),
        (15, "Fig15b_nested_performance", "Fig15b_nested_performance", ("png", "svg", "pdf", "tiff")),
        (16, "Fig16_representative_OOF_trajectory", "Fig16_representative_OOF_trajectory", ("png", "svg", "pdf", "tiff")),
        (17, "Fig17_relative_performance_radar", "Fig17_relative_performance_radar", ("png", "svg", "pdf", "tiff")),
    ],
    "18-19": [
        (18, "Fig18a_conditional_SHAP_heatmap", "Fig18a_conditional_SHAP_heatmap", ("png", "svg", "pdf", "tiff")),
        (18, "Fig18b_global_SHAP_contribution", "Fig18b_global_SHAP_contribution", ("png", "svg", "pdf", "tiff")),
        (19, "Fig19a_ear_temperature_dependence", "Fig19a_ear_temperature_dependence", ("png", "svg", "pdf", "tiff")),
        (19, "Fig19b_ambient_temperature_dependence", "Fig19b_ambient_temperature_dependence", ("png", "svg", "pdf", "tiff")),
        (19, "Fig19c_sampling_time_dependence", "Fig19c_sampling_time_dependence", ("png", "svg", "pdf", "tiff")),
    ],
}


def package_paths(root: Path) -> dict[str, Path | str]:
    if (root / "数据").is_dir():
        return {
            "reproduction": root / "分析" / "论文图源" / "图源复现",
            "data_name": "数据",
            "output_name": "输出",
            "scripts": root / "脚本",
            "report": root / "输出" / "manuscript_panel_rebuild.json",
        }
    return {
        "reproduction": root / "analysis" / "manuscript_figures" / "reproduction_sources",
        "data_name": "data",
        "output_name": "outputs",
        "scripts": root / "scripts",
        "report": root / "outputs" / "manuscript_panel_rebuild.json",
    }


def run(command: list[str], root: Path, environment: dict[str, str]) -> None:
    completed = subprocess.run(command, cwd=root, env=environment, check=False)
    if completed.returncode != 0:
        raise RuntimeError(f"Plotting command failed with return code {completed.returncode}: {command[1]}")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--groups", nargs="+", choices=GROUPS, default=list(GROUPS))
    parser.add_argument("--skip-verification", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    paths = package_paths(root)
    reproduction = Path(paths["reproduction"])
    data_name = str(paths["data_name"])
    output_name = str(paths["output_name"])
    environment = os.environ.copy()
    environment["MPLBACKEND"] = "Agg"
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    rows: list[dict[str, object]] = []

    with tempfile.TemporaryDirectory(prefix="th_shrc_panels_") as temporary:
        work = Path(temporary)
        for group in args.groups:
            native = work / group
            native.mkdir(parents=True)
            if group == "10":
                fig = reproduction / "fig10"
                command = [sys.executable, str(fig / "code" / "plot_lora_communication_nature_style.py"), "--input", str(fig / data_name / "SAT_RSSI_SNR.xlsx"), "--output", str(native)]
            elif group == "12":
                fig = reproduction / "fig12"
                command = [sys.executable, str(fig / "code" / "plot_fig12_4panel_final.py"), "--input-csv", str(fig / data_name / "Fig12_input_520_records.csv"), "--output-dir", str(native), "--expected-rows", "520", "--publication-layout", "--compact-artwork"]
            elif group == "13-14":
                fig = reproduction / "fig13"
                command = [sys.executable, str(fig / "code" / "generate_th_shrc_figures.py"), "--data-dir", str(fig / data_name), "--output-dir", str(native), "--publication-layout", "--compact-artwork"]
            elif group == "15-17":
                fig = reproduction / "fig15"
                command = [sys.executable, str(fig / "code" / "plot_fig15_17_public.py"), "--data-dir", str(fig / data_name), "--output-dir", str(native), "--publication-layout", "--compact-artwork"]
            else:
                fig = reproduction / "fig18"
                command = [sys.executable, str(fig / "code" / "reproduce_all_shap_figures.py"), "--package-root", str(fig), "--output-dir", str(native), "--publication-layout", "--compact-artwork"]
            run(command, root, environment)

            for figure, native_stem, delivery_stem, formats in MAPPINGS[group]:
                destination = reproduction / f"fig{figure:02d}" / output_name
                destination.mkdir(parents=True, exist_ok=True)
                for suffix in formats:
                    source = native / f"{native_stem}.{suffix}"
                    if not source.is_file() or source.stat().st_size == 0:
                        raise FileNotFoundError(source)
                    target = destination / f"{delivery_stem}.{suffix}"
                    shutil.copy2(source, target)
                    rows.append(
                        {
                            "group": group,
                            "figure": figure,
                            "source_stem": native_stem,
                            "delivery": str(target.relative_to(root)),
                            "bytes": target.stat().st_size,
                            "sha256": sha256(target),
                        }
                    )

    verification_returncode = None
    if not args.skip_verification:
        verifier = Path(paths["scripts"]) / "verify_repository.py"
        completed = subprocess.run(
            [sys.executable, str(verifier), "--root", str(root)], cwd=root, env=environment, check=False
        )
        verification_returncode = completed.returncode
        if completed.returncode != 0:
            raise RuntimeError("Release verification failed after rebuilding manuscript panels")

    report = {
        "status": "PASS",
        "groups": list(args.groups),
        "panel_count": sum(len(MAPPINGS[group]) for group in args.groups),
        "file_count": len(rows),
        "verification_returncode": verification_returncode,
        "files": rows,
    }
    report_path = Path(paths["report"])
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "files"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
