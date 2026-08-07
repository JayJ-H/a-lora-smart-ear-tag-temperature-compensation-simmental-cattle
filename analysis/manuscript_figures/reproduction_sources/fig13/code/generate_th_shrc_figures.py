from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]


def run(relative_script: str) -> None:
    completed = subprocess.run([sys.executable, relative_script], cwd=ROOT, check=False)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def main() -> None:
    run("analysis/benchmark_models/plot_benchmark.py")
    run("analysis/figures/plot_fig15_17_public.py")


if __name__ == "__main__":
    main()
