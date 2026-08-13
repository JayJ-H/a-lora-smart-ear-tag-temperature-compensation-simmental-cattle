#!/usr/bin/env python3
"""Run all required checks for the bilingual 520-record repository."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'outputs'


def main() -> int:
    environment = os.environ.copy()
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    commands = [
        (
            "scientific_results",
            [sys.executable, 'scripts/verify_scientific_results.py', "--stage", "full"],
        ),
        (
            "repository",
            [sys.executable, 'scripts/verify_repository.py', "--root", "."],
        ),
        ("system_tests", [sys.executable, 'system_tests/run_system_tests.py']),
        ("repository_integrity", [sys.executable, 'tools/check_repository_integrity.py']),
    ]
    results = []
    for name, command in commands:
        completed = subprocess.run(
            command,
            cwd=ROOT,
            env=environment,
            check=False,
        )
        results.append({"check": name, "returncode": completed.returncode})
    passed = all(row["returncode"] == 0 for row in results)
    payload = {"status": "PASS" if passed else "FAIL", "checks": results}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "full_verification_results.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(payload, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
