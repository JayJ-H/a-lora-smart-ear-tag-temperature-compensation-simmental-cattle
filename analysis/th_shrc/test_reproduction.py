#!/usr/bin/env python3
"""Positive and negative smoke tests for the TH-SHRC entry point."""

from __future__ import annotations

import csv
import json
import subprocess
import sys
import tempfile
from pathlib import Path


SHARED_ROOT = Path(__file__).resolve().parents[2]
INPUT = SHARED_ROOT / "data" / "processed" / "th_shrc_oof_predictions.csv"
ENTRY_POINT = SHARED_ROOT / "scripts" / "run_temperature_analysis.py"


def make_drifted_input(source: Path, destination: Path) -> None:
    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        fields = list(reader.fieldnames or [])
    rows[0]["Predicted"] = str(float(rows[0]["Predicted"]) + 0.001)
    with destination.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def run_entry(input_path: Path, output_dir: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(ENTRY_POINT),
            "--input",
            str(input_path),
            "--output-dir",
            str(output_dir),
        ],
        cwd=Path(tempfile.gettempdir()),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="th_shrc_reproduction_") as temp:
        temp_root = Path(temp)
        baseline = run_entry(INPUT, temp_root / "baseline")
        if baseline.returncode != 0:
            print(baseline.stdout)
            print(baseline.stderr, file=sys.stderr)
            raise RuntimeError("Baseline reproduction did not pass")

        drifted_input = temp_root / "drifted_oof.csv"
        make_drifted_input(INPUT, drifted_input)
        drifted = run_entry(drifted_input, temp_root / "drifted")
        if drifted.returncode == 0:
            raise RuntimeError("A 0.001 C frozen-prediction drift was not detected")

        result = {
            "status": "PASS",
            "baseline_exit_code": baseline.returncode,
            "drifted_exit_code": drifted.returncode,
            "injected_prediction_drift_C": 0.001,
            "working_directory": tempfile.gettempdir(),
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
