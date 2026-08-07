"""Focused tests for native and conditional TH-SHRC interpretability."""

from __future__ import annotations

import importlib.util
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

import pandas as pd


HERE = Path(__file__).resolve().parent
SHARED_ROOT = HERE.parents[1]
DATA_DIR = SHARED_ROOT / "data" / "processed"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def find_rscript() -> Path | None:
    discovered = shutil.which("Rscript")
    candidates = [
        Path(discovered) if discovered else None,
        Path(r"C:\Program Files\R\R-4.5.3\bin\Rscript.exe"),
    ]
    return next((path for path in candidates if path is not None and path.exists()), None)


def png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()[:24]
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError(f"Not a PNG file: {path}")
    return struct.unpack(">II", data[16:24])


def main() -> int:
    native = load_module("run_native_stack_shap", HERE / "run_native_stack_shap.py")
    conditional = load_module("verify_conditional_shap", HERE / "verify_conditional_shap.py")
    checks: list[tuple[str, bool]] = []

    oof = pd.read_csv(DATA_DIR / "th_shrc_oof_predictions.csv")
    shap_stack = pd.read_csv(DATA_DIR / "th_shrc_conditional_shap_stack_choices.csv")
    stack_columns = {
        "FoldID",
        "Intercept",
        "WeightSourceMemory",
        "WeightBatchSession",
        "WeightHierarchicalResidual",
    }
    checks.append(
        (
            "conditional_stack_choices",
            len(shap_stack) == 5
            and set(shap_stack.columns) == stack_columns
            and set(shap_stack["FoldID"]) == {1, 2, 3, 4, 5}
            and not shap_stack["FoldID"].duplicated().any()
            and shap_stack[list(stack_columns - {"FoldID"})].notna().all().all(),
        )
    )
    native_summary, native_values, native_audit, native_result = native.reproduce(oof)
    checks.append(("native_status", native_result["status"] == "PASS"))
    checks.append(("native_rows", len(native_values) == 503 and len(native_audit) == 5))
    checks.append(("native_top_component", native_summary.iloc[0]["Feature"] == "HierarchicalResidualPredicted"))
    checks.append(("native_additivity", native_result["additivity_max_abs_difference_C"] <= 1e-12))

    values = pd.read_csv(DATA_DIR / "th_shrc_shap_values.csv")
    frozen_summary = pd.read_csv(DATA_DIR / "th_shrc_shap_summary.csv")
    paired = pd.read_csv(DATA_DIR / "paired_temperature_records.csv")
    reproduced_summary, audit, result = conditional.verify(values, frozen_summary, paired, oof)
    checks.append(("conditional_status", result["status"] == "PASS"))
    checks.append(("conditional_rows", len(audit) == 503 and len(reproduced_summary) == 4))
    checks.append(("conditional_top_group", result["top_group"] == "Time_diurnal"))
    checks.append(("conditional_additivity", result["additivity_max_abs_difference_C"] <= 1e-12))
    checks.append(("official_boundary", result["conditional_vs_official_max_abs_difference_C"] > 0.1))

    modified = values.copy()
    modified.loc[0, "SHAP_Ear_temperature_C"] += 0.01
    _, _, negative_result = conditional.verify(modified, frozen_summary, paired, oof)
    checks.append(("negative_drift_detection", negative_result["status"] == "FAIL"))

    rscript = find_rscript()
    skipped: list[str] = []
    if rscript is None:
        skipped.append("rscript-dependent replay and figure export")
    else:
        self_test = subprocess.run(
            [str(rscript), str(HERE / "run_full_pipeline_shap.R"), "--self-test"],
            cwd=HERE,
            check=False,
            capture_output=True,
            text=True,
        )
        checks.append(
            (
                "full_pipeline_shap_self_test",
                self_test.returncode == 0 and "FULL_PIPELINE_SHAP_SELF_TEST=PASS" in self_test.stdout,
            )
        )
        with tempfile.TemporaryDirectory(prefix="th_shrc_figures_") as temp_dir:
            plot_test = subprocess.run(
                [str(rscript), str(HERE / "plot_publication_figures.R"), "--output-dir", temp_dir],
                cwd=HERE,
                check=False,
                capture_output=True,
                text=True,
            )
            figure_files = list(Path(temp_dir).glob("*"))
            png_files = list(Path(temp_dir).glob("*.png"))
            svg_files = list(Path(temp_dir).glob("*.svg"))
            checks.append(
                (
                    "r_figure_export",
                    plot_test.returncode == 0
                    and "FIGURE_STATUS=PASS" in plot_test.stdout
                    and len(figure_files) == 24,
                )
            )
            checks.append(
                (
                    "r_figure_png_dimensions",
                    len(png_files) == 6
                    and all(width >= 2000 and height >= 1400 for width, height in map(png_dimensions, png_files)),
                )
            )
            checks.append(
                (
                    "editable_svg_text",
                    len(svg_files) == 6 and all("<text" in path.read_text(encoding="utf-8") for path in svg_files),
                )
            )

    failures = [name for name, passed in checks if not passed]
    for name, passed in checks:
        print(f"[{'PASS' if passed else 'FAIL'}] {name}")
    print(f"INTERPRETABILITY_TESTS={len(checks) - len(failures)}/{len(checks)}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
