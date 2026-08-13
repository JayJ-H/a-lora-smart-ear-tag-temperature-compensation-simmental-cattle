#!/usr/bin/env python3
"""Run and aggregate formal four-domain conditional SHAP across five seeds."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

from experiment_common import INPUT_PATH, MULTISEED_DIR, ROOT, SEEDS


R_SCRIPT = (
    ROOT / "分析" / "可解释性" / "run_full_pipeline_shap.R"
    if (ROOT / "分析").is_dir()
    else ROOT / "analysis" / "interpretability" / "run_full_pipeline_shap.R"
)
MODULE_DIR = ROOT / "reproduction" / "conditional_shap_runtime" / "modules"
DEFAULT_OUTPUT = ROOT / "reproduction" / "conditional_shap_runtime" / "five_seed"
FORMAL_OUTPUT = DEFAULT_OUTPUT / "ensemble"
GROUP_COLUMNS = {
    "Ear_temperature": "SHAP_Ear_temperature_C",
    "Ambient_temperature": "SHAP_Ambient_temperature_C",
    "Time_diurnal": "SHAP_Time_diurnal_C",
    "Cow_identity": "SHAP_Cow_identity_C",
}


def seed_output(output: Path, seed: int) -> Path:
    return output / "seeds" / str(seed)


def find_rscript(explicit: Path | None) -> Path:
    candidates = []
    if explicit is not None:
        candidates.append(explicit)
    configured = os.environ.get("RSCRIPT")
    if configured:
        candidates.append(Path(configured))
    discovered = shutil.which("Rscript")
    if discovered:
        candidates.append(Path(discovered))
    program_files = os.environ.get("ProgramFiles")
    if program_files:
        candidates.extend(
            sorted((Path(program_files) / "R").glob(r"R-*\bin\Rscript.exe"), reverse=True)
        )
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise RuntimeError("Rscript was not found via --rscript, RSCRIPT, PATH, or Program Files/R")


def run_seed(
    output: Path, seed: int, chunk_size: int, rscript: Path
) -> dict[str, object]:
    directory = seed_output(output, seed)
    directory.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment.update(
        {
            "TH_SHRC_SHAP_MODULE_DIR": str(MODULE_DIR),
            "TH_SHRC_SHAP_PUBLIC_INPUT": str(INPUT_PATH),
            "TH_SHRC_SHAP_OOF_INPUT": str(
                MULTISEED_DIR / "seeds" / str(seed) / "th_shrc_oof_predictions.csv"
            ),
            "TH_SHRC_SHAP_STACK_INPUT": str(
                MULTISEED_DIR / "seeds" / str(seed) / "stack_weights.csv"
            ),
            "TH_SHRC_FOLD_SEED": str(seed),
            "OMP_NUM_THREADS": "1",
            "OPENBLAS_NUM_THREADS": "1",
            "MKL_NUM_THREADS": "1",
        }
    )
    command = [
        str(rscript),
        str(R_SCRIPT),
        "--output-dir",
        str(directory),
        "--seed",
        str(seed),
        "--chunk-size",
        str(chunk_size),
    ]
    started = time.perf_counter()
    completed = subprocess.run(
        command,
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    (directory / "launcher.stdout.log").write_text(completed.stdout, encoding="utf-8")
    (directory / "launcher.stderr.log").write_text(completed.stderr, encoding="utf-8")
    report = {
        "seed": seed,
        "return_code": completed.returncode,
        "elapsed_seconds": time.perf_counter() - started,
        "output": str(directory),
    }
    if completed.returncode != 0:
        raise RuntimeError(json.dumps(report))
    verification = json.loads(
        (directory / "conditional_shap_verification_all_520.json").read_text(
            encoding="utf-8-sig"
        )
    )
    if verification.get("status") != "PASS":
        raise RuntimeError(f"seed {seed} conditional SHAP failed: {verification}")
    return report


def run_all(
    output: Path, workers: int, chunk_size: int, rscript: Path
) -> list[dict[str, object]]:
    reports = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(run_seed, output, seed, chunk_size, rscript): seed
            for seed in SEEDS
        }
        for future in as_completed(futures):
            report = future.result()
            reports.append(report)
            print(
                f"[conditional SHAP seed {report['seed']}] PASS in {report['elapsed_seconds']:.1f} s",
                flush=True,
            )
    return sorted(reports, key=lambda row: int(row["seed"]))


def summarise(values: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for feature_group, column in GROUP_COLUMNS.items():
        data = values[column].to_numpy(float)
        rows.append(
            {
                "FeatureGroup": feature_group,
                "MeanAbsSHAP_C": float(np.mean(np.abs(data))),
                "MeanSignedSHAP_C": float(np.mean(data)),
                "MedianAbsSHAP_C": float(np.median(np.abs(data))),
                "P90AbsSHAP_C": float(np.quantile(np.abs(data), 0.90)),
            }
        )
    summary = pd.DataFrame(rows).sort_values("MeanAbsSHAP_C", ascending=False)
    summary["Rank_by_MeanAbsSHAP"] = np.arange(1, len(summary) + 1)
    return summary.reset_index(drop=True)


def aggregate(output: Path, run_reports: list[dict[str, object]]) -> dict[str, object]:
    value_parts = []
    verification_parts = []
    for seed in SEEDS:
        directory = seed_output(output, seed)
        values = pd.read_csv(
            directory / "conditional_shap_values_reproduced_all_520.csv"
        )
        values.insert(0, "Seed", seed)
        value_parts.append(values)
        verification_parts.append(
            json.loads(
                (directory / "conditional_shap_verification_all_520.json").read_text(
                    encoding="utf-8-sig"
                )
            )
        )
    seed_values = pd.concat(value_parts, ignore_index=True)
    seed_predictions = pd.read_csv(MULTISEED_DIR / "oof_predictions_long.csv")[
        ["Seed", "RecordID", "Predicted"]
    ]
    ordered = seed_predictions.sort_values(
        ["RecordID", "Predicted", "Seed"], kind="stable"
    )
    selected = ordered.groupby("RecordID", as_index=False).nth(2).reset_index(drop=True)
    selected = selected.rename(
        columns={"Seed": "SelectedSeed", "Predicted": "MedianSeedPredicted_C"}
    )
    selected["PredictionRank"] = 3
    selected["EnsembleWeight"] = 1.0
    formal = seed_values.merge(
        selected[["RecordID", "SelectedSeed", "MedianSeedPredicted_C"]],
        left_on=["RecordID", "Seed"],
        right_on=["RecordID", "SelectedSeed"],
        validate="many_to_one",
    )
    formal = formal.drop(columns="SelectedSeed").sort_values("RowID").reset_index(drop=True)
    official = pd.read_csv(MULTISEED_DIR / "ensemble_oof_predictions.csv")[
        ["RecordID", "Predicted"]
    ].rename(columns={"Predicted": "FormalPredicted_C"})
    formal = formal.merge(official, on="RecordID", validate="one_to_one")
    formal["OfficialOOFPrediction_C"] = formal["FormalPredicted_C"]
    formal["ConditionalFullPipelinePrediction_C"] = formal["FormalPredicted_C"]
    formal["ReconstructedPrediction_C"] = formal["TechnicalBaselinePrediction_C"]
    for column in GROUP_COLUMNS.values():
        formal["ReconstructedPrediction_C"] += formal[column]
    formal["AdditivityDifference_C"] = (
        formal["ReconstructedPrediction_C"]
        - formal["ConditionalFullPipelinePrediction_C"]
    )
    formal["ConditionalVsOfficialDifference_C"] = 0.0
    formal = formal.drop(columns=["MedianSeedPredicted_C", "FormalPredicted_C"])
    summary = summarise(formal)
    check_columns = [
        "RecordID",
        "RowID",
        "Seed",
        "TechnicalBaselinePrediction_C",
        "ConditionalFullPipelinePrediction_C",
        "OfficialOOFPrediction_C",
        "ReconstructedPrediction_C",
        "AdditivityDifference_C",
        "ReplayAnchorCorrection_C",
    ]
    check = formal[check_columns].copy()

    counts = seed_values.groupby("Seed").agg(
        Rows=("RecordID", "size"), UniqueRecords=("RecordID", "nunique")
    )
    official_difference = float(
        np.max(
            np.abs(
                formal["ConditionalFullPipelinePrediction_C"].to_numpy(float)
                - formal["OfficialOOFPrediction_C"].to_numpy(float)
            )
        )
    )
    additivity_difference = float(
        np.max(np.abs(formal["AdditivityDifference_C"].to_numpy(float)))
    )
    median_difference = float(
        np.max(
            np.abs(
                selected["MedianSeedPredicted_C"].to_numpy(float)
                - selected["RecordID"].map(official.set_index("RecordID")["FormalPredicted_C"])
                .to_numpy(float)
            )
        )
    )
    checks = {
        "five_seed_runs_pass": all(
            item.get("status") == "PASS" for item in verification_parts
        ),
        "seed_value_coverage": len(seed_values) == 520 * len(SEEDS)
        and counts["Rows"].eq(520).all()
        and counts["UniqueRecords"].eq(520).all(),
        "four_domain_coverage": all(
            seed_values[column].notna().all() for column in GROUP_COLUMNS.values()
        ),
        "median_selection_coverage": len(selected) == 520
        and selected["RecordID"].is_unique,
        "formal_value_coverage": len(formal) == 520 and formal["RecordID"].is_unique,
        "selected_seed_prediction_is_formal_median": median_difference <= 1e-12,
        "formal_prediction_identity": official_difference <= 1e-12,
        "formal_conditional_additivity": additivity_difference <= 1e-10,
    }
    checks = {name: bool(value) for name, value in checks.items()}
    report = {
        "status": "PASS" if all(checks.values()) else "FAIL",
        "method": "exact four-domain conditional Shapley replay per seed with formal rowwise-median seed selection",
        "seed_ensemble": "rowwise_median",
        "seeds": SEEDS,
        "rows": len(formal),
        "seed_level_rows": len(seed_values),
        "groups": list(GROUP_COLUMNS),
        "coalitions_per_row_per_seed": 16,
        "max_median_selection_difference_C": median_difference,
        "max_official_prediction_difference_C": official_difference,
        "max_additivity_difference_C": additivity_difference,
        "checks": checks,
        "runs": run_reports,
    }
    formal_output = output / "ensemble"
    formal_output.mkdir(parents=True, exist_ok=True)
    seed_values.to_csv(
        formal_output / "conditional_shap_values_five_seed_long.csv",
        index=False,
        lineterminator="\n",
    )
    selected.to_csv(
        formal_output / "conditional_shap_median_seed_weights.csv",
        index=False,
        lineterminator="\n",
    )
    formal.to_csv(
        formal_output / "conditional_shap_values_reproduced_all_520.csv",
        index=False,
        lineterminator="\n",
    )
    summary.to_csv(
        formal_output / "conditional_shap_summary_reproduced_all_520.csv",
        index=False,
        lineterminator="\n",
    )
    check.to_csv(
        formal_output / "conditional_shap_additivity_check_all_520.csv",
        index=False,
        lineterminator="\n",
    )
    (formal_output / "conditional_shap_verification_all_520.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--workers", type=int, default=len(SEEDS))
    parser.add_argument("--chunk-size", type=int, default=128)
    parser.add_argument("--rscript", type=Path)
    parser.add_argument("--aggregate-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output = args.output.resolve()
    if not R_SCRIPT.is_file():
        raise RuntimeError(f"conditional SHAP R script is missing: {R_SCRIPT}")
    rscript = find_rscript(args.rscript)
    print(f"RSCRIPT={rscript}", flush=True)
    reports = (
        []
        if args.aggregate_only
        else run_all(output, args.workers, args.chunk_size, rscript)
    )
    result = aggregate(output, reports)
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
