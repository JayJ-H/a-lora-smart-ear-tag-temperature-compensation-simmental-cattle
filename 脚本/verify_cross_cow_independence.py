#!/usr/bin/env python3
"""Verification exact and same-time near matches across cattle."""

from __future__ import annotations

import argparse
import json
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
FIVE_PATH = ROOT / "data" / "all_measured_520_five_columns.csv"
OUTPUT_DIR = ROOT / "outputs" / "checks" / "all_measured_cross_cow"
TEMPERATURE_COLUMNS = [
    "EarTemperature_C",
    "CoreReferenceTemperature_C",
    "AmbientTemperature_C",
]
SIGNATURE_COLUMNS = [*TEMPERATURE_COLUMNS, "MeasurementTime_hour"]


def json_records(frame: pd.DataFrame) -> list[dict[str, object]]:
    return json.loads(frame.to_json(orient="records"))


def maximum_matching(
    left: pd.DataFrame, right: pd.DataFrame, tolerance: float
) -> list[tuple[int, int]]:
    left_values = left[TEMPERATURE_COLUMNS].to_numpy(float)
    right_values = right[TEMPERATURE_COLUMNS].to_numpy(float)
    adjacency: dict[int, list[int]] = {}
    for left_index, values in enumerate(left_values):
        deltas = np.abs(right_values - values)
        available = np.flatnonzero(np.all(deltas <= tolerance + 1e-12, axis=1))
        adjacency[left_index] = sorted(
            (int(index) for index in available),
            key=lambda index: (
                float(np.max(deltas[index])),
                float(np.sum(deltas[index])),
                index,
            ),
        )
    right_to_left: dict[int, int] = {}

    def match_path(left_index: int, visited: set[int]) -> bool:
        for right_index in adjacency[left_index]:
            if right_index in visited:
                continue
            visited.add(right_index)
            if right_index not in right_to_left or match_path(
                right_to_left[right_index], visited
            ):
                right_to_left[right_index] = left_index
                return True
        return False

    for left_index in sorted(adjacency, key=lambda index: (len(adjacency[index]), index)):
        match_path(left_index, set())
    return sorted(
        (left_index, right_index)
        for right_index, left_index in right_to_left.items()
    )


def compare_pair(
    cow_a: str,
    cow_b: str,
    left: pd.DataFrame,
    right: pd.DataFrame,
    tolerance: float,
) -> dict[str, object]:
    matched: list[dict[str, float]] = []
    shared_times = sorted(
        set(left["MeasurementTime_hour"]).intersection(right["MeasurementTime_hour"])
    )
    for hour in shared_times:
        left_hour = left.loc[left["MeasurementTime_hour"].eq(hour)].reset_index(drop=True)
        right_hour = right.loc[right["MeasurementTime_hour"].eq(hour)].reset_index(drop=True)
        for left_index, right_index in maximum_matching(left_hour, right_hour, tolerance):
            left_row = left_hour.iloc[left_index]
            right_row = right_hour.iloc[right_index]
            matched.append(
                {
                    column: abs(float(left_row[column]) - float(right_row[column]))
                    for column in TEMPERATURE_COLUMNS
                }
            )
    pair = sorted((str(cow_a), str(cow_b)))
    return {
        "CowA": pair[0],
        "CowB": pair[1],
        "NearMatchCount": len(matched),
        "ExactEarCount": sum(row["EarTemperature_C"] <= 1e-12 for row in matched),
        "ExactCoreCount": sum(
            row["CoreReferenceTemperature_C"] <= 1e-12 for row in matched
        ),
        "ExactAmbientCount": sum(
            row["AmbientTemperature_C"] <= 1e-12 for row in matched
        ),
        "MeanMaxDelta_C": (
            float(np.mean([max(row.values()) for row in matched])) if matched else np.nan
        ),
        "MeanSumDelta_C": (
            float(np.mean([sum(row.values()) for row in matched])) if matched else np.nan
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=FIVE_PATH)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--tolerance", type=float, default=0.2)
    parser.add_argument("--max-pair-matches", type=int, default=4)
    args = parser.parse_args()
    five = pd.read_csv(args.input.resolve())
    required = {"CowKey", *SIGNATURE_COLUMNS}
    if not required.issubset(five.columns):
        raise RuntimeError(f"Missing columns: {sorted(required - set(five.columns))}")
    if len(five) != 520 or five["CowKey"].nunique() != 30:
        raise RuntimeError("Expected 520 records across 30 cattle")
    by_cow = {
        str(cow): group.reset_index(drop=True)
        for cow, group in five.groupby("CowKey", sort=True)
    }
    rows = [
        compare_pair(a, b, by_cow[a], by_cow[b], float(args.tolerance))
        for a, b in combinations(sorted(by_cow), 2)
    ]
    pairs = pd.DataFrame(rows).sort_values(
        ["NearMatchCount", "MeanMaxDelta_C", "CowA", "CowB"],
        ascending=[False, True, True, True],
        na_position="last",
        kind="stable",
    ).reset_index(drop=True)
    pairs.insert(0, "Rank", np.arange(1, len(pairs) + 1))
    exact_rows = int(five.duplicated(SIGNATURE_COLUMNS, keep=False).sum())
    exact_groups = int(
        five.groupby(SIGNATURE_COLUMNS, dropna=False).size().gt(1).sum()
    )
    triplet_groups = int(
        five.groupby(
            ["EarTemperature_C", "CoreReferenceTemperature_C", "MeasurementTime_hour"],
            dropna=False,
        )
        .size()
        .gt(1)
        .sum()
    )
    checks = {
        "four_field_signatures_unique": exact_groups == 0,
        "ear_core_time_triplets_unique": triplet_groups == 0,
        "pair_match_counts_bounded": int(pairs["NearMatchCount"].max())
        <= int(args.max_pair_matches),
    }
    report = {
        "status": "PASS" if all(checks.values()) else "FAIL",
        "rows": len(five),
        "cattle": int(five["CowKey"].nunique()),
        "pair_count": len(pairs),
        "tolerance_C": float(args.tolerance),
        "exact_duplicate_rows": exact_rows,
        "exact_duplicate_groups": exact_groups,
        "ear_core_time_triplet_groups": triplet_groups,
        "maximum_pair_match_count": int(pairs["NearMatchCount"].max()),
        "rank10_match_count": int(pairs.iloc[9]["NearMatchCount"]),
        "top_pairs": json_records(pairs.head(15)),
        "thresholds": {"max_pair_matches": int(args.max_pair_matches)},
        "checks": checks,
    }
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    pairs.to_csv(
        output / "pairwise_same_time_near_matches.csv", index=False, lineterminator="\n"
    )
    (output / "summary.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
