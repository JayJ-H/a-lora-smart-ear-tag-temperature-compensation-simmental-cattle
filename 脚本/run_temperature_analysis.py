#!/usr/bin/env python3
"""Run the TH-SHRC temperature reproduction from any working directory."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


SHARED_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = SHARED_ROOT / "数据" / "处理数据" / "th_shrc_oof_predictions.csv"
DEFAULT_OUTPUT_DIR = SHARED_ROOT / "输出"
REPRODUCTION_SCRIPT = SHARED_ROOT / "分析" / "TH-SHRC" / "reproduce_stack.py"


def verify_docs(output_dir: Path) -> dict[str, object]:
    required = [
        SHARED_ROOT / "分析" / "TH-SHRC" / "README.md",
        SHARED_ROOT / "数据" / "README.md",
        output_dir / "temperature_reproduction_report.md",
        output_dir / "model_metrics.csv",
        output_dir / "th_shrc_stack_weights.csv",
        output_dir / "th_shrc_reproduced_oof_predictions.csv",
    ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError("Missing documentation or reproduction outputs: " + "; ".join(missing))

    analysis_readme = required[0].read_text(encoding="utf-8")
    report = required[2].read_text(encoding="utf-8")
    phrase_groups = [
        ("same-cow", "同牛"),
        ("thermal-memory", "热记忆"),
        ("nested ridge", "嵌套ridge"),
        ("503",),
        ("30",),
    ]
    combined = (analysis_readme + "\n" + report).lower()
    absent = ["/".join(group) for group in phrase_groups if not any(term.lower() in combined for term in group)]
    if absent:
        raise RuntimeError("Reproduction boundary documentation is incomplete: " + "; ".join(absent))
    return {"status": "PASS", "files": len(required), "boundary_groups": len(phrase_groups)}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--tolerance", type=float, default=1e-8)
    parser.add_argument(
        "--verify-docs",
        action="store_true",
        help="Also verify the reproduction documentation.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    command = [
        sys.executable,
        str(REPRODUCTION_SCRIPT),
        "--input",
        str(args.input.resolve()),
        "--output-dir",
        str(args.output_dir.resolve()),
        "--tolerance",
        str(args.tolerance),
    ]
    completed = subprocess.run(command, cwd=SHARED_ROOT, check=False)
    if completed.returncode != 0:
        return completed.returncode
    if args.verify_docs:
        try:
            result = verify_docs(args.output_dir.resolve())
        except Exception as exc:
            print(f"Documentation verification failed: {exc}", file=sys.stderr)
            return 1
        print(json.dumps({"文档": result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
