#!/usr/bin/env python3
"""Validate the stored 33-model benchmark outputs and metadata."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


SHARED_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = SHARED_ROOT / "outputs" / "analysis" / "benchmark"
INPUT = SHARED_ROOT / "data" / "processed" / "th_shrc_oof_predictions.csv"


def main() -> int:
    source = pd.read_csv(INPUT)
    summary = pd.read_csv(OUTPUT / "tables" / "14_full_model_benchmark_summary.csv")
    predictions = pd.read_csv(
        OUTPUT / "tables" / "14_full_model_benchmark_predictions.csv"
    )
    inventory = pd.read_csv(
        OUTPUT / "tables" / "14_full_model_benchmark_model_inventory.csv"
    )
    verification = json.loads(
        (OUTPUT / "benchmark_verification.json").read_text(encoding="utf-8")
    )
    checks = {
        "summary_has_33_models": summary["Model"].nunique() == 33,
        "predictions_have_33_models": predictions["Model"].nunique() == 33,
        "each_model_has_503_rows": bool(
            (predictions.groupby("Model").size() == 503).all()
        ),
        "five_outer_folds": set(predictions["FoldID"].astype(int))
        == {1, 2, 3, 4, 5},
        "anonymous_cow_count": predictions["CowKey"].nunique() == 30,
        "anonymous_category_partitions_preserved": set(source["SourceType"])
        == {"reference_stratum_1", "reference_stratum_2"}
        and set(source["EarStatus"]) == {"ear_status_1", "ear_status_2"},
        "proposed_model_name_matches_reference": "TH_SHRC" in set(summary["Model"])
        and "StrictThreeModelStack_reference" not in set(summary["Model"]),
        "inventory_complete": len(inventory) == 33
        and bool((inventory["RunStatus"] == "done").all()),
        "verification_passed": verification["status"] == "PASS",
    }
    failures = [name for name, passed in checks.items() if not passed]
    for name, passed in checks.items():
        print(f"{'PASS' if passed else 'FAIL'} {name}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
