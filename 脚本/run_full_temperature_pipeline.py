#!/usr/bin/env python3
"""Run the complete TH-SHRC branch and stack reproduction."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


SHARED_ROOT = Path(__file__).resolve().parents[1]
ENTRY_POINT = SHARED_ROOT / "分析" / "TH-SHRC" / "reproduce_full_pipeline.py"


if __name__ == "__main__":
    raise SystemExit(
        subprocess.run(
            [sys.executable, str(ENTRY_POINT), *sys.argv[1:]],
            cwd=SHARED_ROOT,
            check=False,
        ).returncode
    )

