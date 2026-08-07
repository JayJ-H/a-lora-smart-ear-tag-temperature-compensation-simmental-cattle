#!/usr/bin/env python3
"""Positive and negative tests for mechanism-level ablation reproduction."""

from __future__ import annotations

import csv
import json
import subprocess
import sys
import tempfile
from pathlib import Path


SHARED_ROOT = Path(__file__).resolve().parents[2]
ENTRY = Path(__file__).resolve().parent / "run_ablation.py"
ABLATION_INPUT = SHARED_ROOT / "data" / "processed" / "th_shrc_ablation_oof_predictions.csv"
BRANCH_INPUT = SHARED_ROOT / "data" / "processed" / "th_shrc_mechanism_branch_inputs.csv"


def execute(
    output_dir: Path,
    ablation_input: Path = ABLATION_INPUT,
    branch_input: Path = BRANCH_INPUT,
):
    command = [
        sys.executable,
        str(ENTRY),
        "--ablation-input",
        str(ablation_input),
        "--branch-input",
        str(branch_input),
        "--output-dir",
        str(output_dir),
    ]
    return subprocess.run(
        command,
        cwd=tempfile.gettempdir(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def make_drifted_input(destination: Path) -> None:
    with ABLATION_INPUT.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        fields = list(reader.fieldnames or [])
    rows[0]["Predicted_Without_A_BC_C"] = str(
        float(rows[0]["Predicted_Without_A_BC_C"]) + 0.01
    )
    with destination.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def make_drifted_branch_input(destination: Path) -> None:
    with BRANCH_INPUT.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        fields = list(reader.fieldnames or [])
    rows[0]["PureMemory"] = str(float(rows[0]["PureMemory"]) + 0.01)
    with destination.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="th_shrc_ablation_") as temp:
        root = Path(temp)
        baseline = execute(root / "baseline")
        if baseline.returncode != 0:
            print(baseline.stdout)
            print(baseline.stderr, file=sys.stderr)
            raise RuntimeError("Baseline ablation reproduction failed")
        verification = json.loads(
            (root / "baseline" / "ablation_verification.json").read_text(encoding="utf-8")
        )
        if verification["bootstrap_replicates"] != 10000:
            raise RuntimeError("Bootstrap replicate count changed")
        for configuration in ("without_a", "without_b", "without_c"):
            difference = verification[
                f"{configuration}_prediction_max_abs_difference_C"
            ]
            if difference > verification["prediction_tolerance_C"]:
                raise RuntimeError(f"{configuration} no longer reproduces exactly")
        if not (root / "baseline" / "tables" / "mechanism_choices.csv").is_file():
            raise RuntimeError("Mechanism choices were not exported")

        drifted_input = root / "drifted_ablation.csv"
        make_drifted_input(drifted_input)
        drifted = execute(root / "drifted", drifted_input)
        if drifted.returncode == 0:
            raise RuntimeError("Injected w/o-A prediction drift was not detected")

        drifted_branch_input = root / "drifted_branch.csv"
        make_drifted_branch_input(drifted_branch_input)
        drifted_branch = execute(
            root / "drifted_branch", branch_input=drifted_branch_input
        )
        if drifted_branch.returncode == 0:
            raise RuntimeError("Injected PureMemory branch drift was not detected")

        print(
            json.dumps(
                {
                    "status": "PASS",
                    "baseline_exit_code": baseline.returncode,
                    "drifted_exit_code": drifted.returncode,
                    "drifted_branch_exit_code": drifted_branch.returncode,
                    "injected_prediction_drift_C": 0.01,
                    "injected_pure_memory_drift_C": 0.01,
                    "bootstrap_replicates": verification["bootstrap_replicates"],
                },
                indent=2,
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
