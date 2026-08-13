#!/usr/bin/env python3
"""Run fixed five-seed TH-SHRC OOF validation for measured records."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from experiment_common import INPUT_PATH, OUTPUT_DIR, RSCRIPT, RUNNER, SEEDS, sha256


def run_one(seed: int, input_path: Path, output: Path, threads: int) -> dict[str, object]:
    seed_output = output / "seeds" / str(seed)
    seed_output.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    for name in (
        "OMP_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "MKL_NUM_THREADS",
        "VECLIB_MAXIMUM_THREADS",
        "NUMEXPR_NUM_THREADS",
    ):
        environment[name] = str(threads)
    command = [
        sys.executable,
        str(RUNNER),
        "all_measured_520",
        "--input-path",
        str(input_path),
        "--output-dir",
        str(seed_output),
        "--expected-rows",
        "520",
        "--expected-analysis-rows",
        "520",
        "--minimum-records",
        "7",
        "--analysis-scope",
        "all_unique",
        "--fold-seed",
        str(seed),
        "--rscript",
        str(RSCRIPT),
    ]
    completed = subprocess.run(
        command,
        cwd=RUNNER.parents[3],
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=1800,
        check=False,
    )
    (seed_output / "launcher.stdout.log").write_text(
        completed.stdout, encoding="utf-8"
    )
    (seed_output / "launcher.stderr.log").write_text(
        completed.stderr, encoding="utf-8"
    )
    if completed.returncode != 0:
        raise RuntimeError(f"Seed {seed} failed; see {seed_output}")
    return {"seed": seed, "status": "PASS", "output": str(seed_output)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=INPUT_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_DIR / "all_measured_multiseed")
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--threads-per-run", type=int, default=3)
    parser.add_argument("--seeds", nargs="*", type=int, default=list(SEEDS))
    args = parser.parse_args()
    input_path = args.input.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    selected_seeds = tuple(args.seeds)
    unknown = sorted(set(selected_seeds) - set(SEEDS))
    if unknown:
        raise ValueError(f"Unsupported seeds: {unknown}")
    workers = max(1, min(int(args.workers), len(selected_seeds)))
    results = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(run_one, seed, input_path, output, args.threads_per_run): seed
            for seed in selected_seeds
        }
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            print(json.dumps(result), flush=True)
    report = {"input_sha256": sha256(input_path), "runs": sorted(results, key=lambda row: row["seed"])}
    (output / "runs.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
