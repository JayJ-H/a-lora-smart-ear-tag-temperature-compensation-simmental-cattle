#!/usr/bin/env python3
"""Run or verify the 520-record TH-SHRC analysis in a release package."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SCRIPTS = ROOT / ("脚本" if (ROOT / "脚本").is_dir() else "scripts")


def run(relative: str, *arguments: str) -> None:
    command = [sys.executable, str(SCRIPTS / relative), *arguments]
    completed = subprocess.run(command, cwd=ROOT, check=False)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--full", action="store_true", help="Rerun the five seeds and all analyses before verification.")
    args = parser.parse_args()
    if args.full:
        run("rebuild_all_measured_data.py", "--output", str(ROOT / "data"))
        run("verify_cross_cow_independence.py")
        run("run_all_measured_multiseed.py")
        run("summarize_all_measured.py")
        run("build_benchmark_input.py")
        run("run_five_seed_benchmark.py")
        run("run_th_shrc_ablation.py")
        run("run_th_shrc_overfitting_checks.py")
        run("run_th_shrc_shap.py")
        run("run_five_seed_conditional_shap.py")
        run("prepare_manuscript_shap_figures.py")
        run("release_sync_public_outputs.py", "--root", str(ROOT))
        completed = subprocess.run(
            [sys.executable, str(ROOT / "plot_manuscript_panels.py"), "--root", str(ROOT), "--skip-verification"],
            cwd=ROOT,
            check=False,
        )
        if completed.returncode != 0:
            raise SystemExit(completed.returncode)
        run("verify_scientific_results.py", "--stage", "full")
    run("verify_repository.py", "--root", str(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
