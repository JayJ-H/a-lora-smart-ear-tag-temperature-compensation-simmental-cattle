#!/usr/bin/env python3
"""Run and verify the TH-SHRC analysis stages."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "outputs"


def find_rscript(explicit: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit.expanduser())
    discovered = shutil.which("Rscript")
    if discovered:
        candidates.append(Path(discovered))
    if os.name == "nt":
        candidates.extend(
            sorted(Path(r"C:\Program Files\R").glob(r"R-*\bin\Rscript.exe"), reverse=True)
        )
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise RuntimeError("Rscript was not found; provide --rscript or install R 4.x")


def portable_argument(value: str) -> str:
    path = Path(value)
    if path == Path(sys.executable):
        return "python"
    if path.name.lower() in {"rscript", "rscript.exe"} and path.is_absolute():
        return "Rscript"
    if path.is_absolute():
        try:
            return path.relative_to(ROOT).as_posix()
        except ValueError:
            return "<external-path>"
    return value.replace("\\", "/")


def display_command(command: list[str]) -> str:
    return subprocess.list2cmdline([portable_argument(argument) for argument in command])


def run_stage(label: str, command: list[str]) -> dict[str, object]:
    print(f"\n=== {label} ===", flush=True)
    print(f"$ {display_command(command)}", flush=True)
    started = time.monotonic()
    completed = subprocess.run(command, cwd=ROOT, check=False)
    elapsed = time.monotonic() - started
    status = "PASS" if completed.returncode == 0 else "FAIL"
    print(f"{label}: {status} ({elapsed:.1f} s)", flush=True)
    return {
        "label": label,
        "command": display_command(command),
        "returncode": completed.returncode,
        "status": status,
        "elapsed_seconds": round(elapsed, 3),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Output root; defaults to the repository outputs directory.",
    )
    parser.add_argument("--rscript", type=Path, help="Path to Rscript when it is not on PATH.")
    parser.add_argument(
        "--skip-upstream",
        action="store_true",
        help="Reuse TH-SHRC upstream files already present below OUTPUT_DIR/analysis/upstream.",
    )
    parser.add_argument(
        "--shap-mode",
        choices=("verify", "smoke", "full"),
        default="smoke",
        help="Table verification only, five-fold smoke run, or the complete 503-row replay.",
    )
    parser.add_argument(
        "--resume-shap",
        action="store_true",
        help="Reuse complete conditional-SHAP chunks already present in the selected output directory.",
    )
    return parser.parse_args()


def build_stages(args: argparse.Namespace, rscript: Path) -> list[tuple[str, list[str]]]:
    output_root = args.output_dir.resolve()
    analysis_output = output_root / "analysis"
    benchmark_output = analysis_output / "benchmark"
    interpretability_output = analysis_output / "interpretability"
    python = sys.executable

    full_pipeline = [
        python,
        "analysis/th_shrc/reproduce_full_pipeline.py",
        "--output-dir",
        str(analysis_output),
        "--rscript",
        str(rscript),
    ]
    if args.skip_upstream:
        full_pipeline.append("--skip-upstream")

    stages: list[tuple[str, list[str]]] = [
        (
            "official_nested_stack",
            [
                python,
                "scripts/run_temperature_analysis.py",
                "--output-dir",
                str(output_root),
                "--verify-docs",
            ],
        ),
        ("complete_th_shrc_retrain", full_pipeline),
        (
            "model_benchmark_33",
            [
                python,
                "analysis/benchmark_models/run_benchmark.py",
                "--output-dir",
                str(benchmark_output),
            ],
        ),
        (
            "model_benchmark_figure",
            [
                python,
                "analysis/benchmark_models/plot_benchmark.py",
                "--benchmark-output-dir",
                str(benchmark_output),
            ],
        ),
        (
            "ablation_and_bootstrap",
            [
                python,
                "analysis/ablation/run_ablation.py",
                "--output-dir",
                str(analysis_output / "ablation"),
                "--candidate-input",
                str(analysis_output / "upstream" / "hierarchical_residual_oof_predictions.csv"),
            ],
        ),
        (
            "native_stack_shap",
            [
                python,
                "analysis/interpretability/run_native_stack_shap.py",
                "--output-dir",
                str(interpretability_output / "native_stack"),
            ],
        ),
        (
            "conditional_shap_verification",
            [
                python,
                "analysis/interpretability/verify_conditional_shap.py",
                "--output-dir",
                str(interpretability_output / "conditional_shap"),
            ],
        ),
    ]

    if args.shap_mode != "verify":
        shap_command = [
            str(rscript),
            "analysis/interpretability/run_full_pipeline_shap.R",
            "--output-dir",
            str(interpretability_output / "full_pipeline_shap"),
        ]
        if args.shap_mode == "smoke":
            shap_command.extend(["--target-limit-per-fold", "1"])
        if args.resume_shap:
            shap_command.append("--resume")
        stages.append((f"conditional_shap_{args.shap_mode}", shap_command))

    stages.extend(
        [
            (
                "public_analysis_figures",
                [
                    str(rscript),
                    "analysis/interpretability/plot_publication_figures.R",
                    "--output-dir",
                    str(interpretability_output / "figures"),
                ],
            ),
            (
                "unified_result_verification",
                [
                    python,
                    "scripts/verify_results.py",
                    "--output-dir",
                    str(output_root),
                ],
            ),
        ]
    )
    return stages


def main() -> int:
    args = parse_args()
    output_root = args.output_dir.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    summary_path = output_root / "analysis_pipeline_results.json"

    try:
        rscript = find_rscript(args.rscript)
        stages = build_stages(args, rscript)
    except Exception as exc:
        payload = {
            "status": "FAIL",
            "validation": "same-cow random five-fold OOF",
            "error": f"{type(exc).__name__}: {exc}",
            "stages": [],
        }
        summary_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(payload["error"], file=sys.stderr)
        return 1

    results: list[dict[str, object]] = []
    for label, command in stages:
        result = run_stage(label, command)
        results.append(result)
        if result["status"] != "PASS":
            break

    failed = [result for result in results if result["status"] != "PASS"]
    complete = len(results) == len(stages)
    payload = {
        "status": "PASS" if complete and not failed else "FAIL",
        "validation": "same-cow random five-fold OOF",
        "shap_mode": args.shap_mode,
        "rscript": rscript.name,
        "output_root": str(output_root.relative_to(ROOT)) if output_root.is_relative_to(ROOT) else "external",
        "passed": sum(result["status"] == "PASS" for result in results),
        "failed": len(failed),
        "planned": len(stages),
        "stages": results,
    }
    summary_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"\nANALYSIS_PIPELINE_STATUS={payload['status']}")
    print(f"SUMMARY={summary_path}")
    return 0 if payload["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
