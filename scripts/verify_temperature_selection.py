#!/usr/bin/env python3
"""Verify the 1129-to-503 temperature selection trace."""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    status = read_rows(DATA / "metadata/temperature_candidate_row_status.csv")
    summary = read_rows(DATA / "metadata/temperature_selection_summary.csv")
    raw = read_rows(DATA / "raw_anonymized/paired_temperature_raw_anonymized.csv")
    processed = read_rows(DATA / "processed/paired_temperature_records.csv")
    oof = read_rows(DATA / "processed/th_shrc_oof_predictions.csv")

    require(len(status) == 1129, f"expected 1129 candidate rows, got {len(status)}")
    require(len(raw) == len(processed) == len(oof) == 503, "final tables are not all 503 rows")
    record_ids = [row["RecordID"] for row in status]
    require(len(set(record_ids)) == 1129, "candidate RecordID values are not unique")

    reason_counts = Counter(row["SelectionReason"] for row in status)
    expected_reasons = Counter(
        {
            "included_fixed_real_ge8_analysis_set": 503,
            "excluded_estimated_reference_source": 326,
            "excluded_case_or_compensated_source": 270,
            "excluded_animal_fewer_than_8_eligible_records": 30,
        }
    )
    require(reason_counts == expected_reasons, f"selection reasons differ: {dict(reason_counts)}")
    require(
        [int(row["RowsRemaining"]) for row in summary] == [1129, 803, 533, 533, 503],
        "selection-summary remaining-row counts differ",
    )

    included_ids = {
        row["RecordID"] for row in status if row["IncludedInAnalysis"] == "1"
    }
    for name, rows in {"raw": raw, "processed": processed, "oof": oof}.items():
        ids = {row["RecordID"] for row in rows}
        require(ids == included_ids, f"{name} RecordID set differs from the inclusion trace")

    final_cows = {row["CowKey"] for row in raw}
    require(
        final_cows == {f"C{index:03d}" for index in range(1, 31)},
        "final CowKey values are not exactly C001-C030",
    )
    require(
        all(re.fullmatch(r"S\d{2}", row["Source"]) for row in status + raw + oof),
        "a public source code is not neutral Sxx format",
    )
    require(
        all(
            re.fullmatch(r"[CX]\d{3}", row["CandidateCowKey"])
            for row in status
        ),
        "a candidate animal code is not neutral Cxxx/Xxxx format",
    )

    payload = {
        "status": "PASS",
        "candidate_rows": len(status),
        "included_rows": len(included_ids),
        "excluded_rows": len(status) - len(included_ids),
        "final_animals": len(final_cows),
        "reason_counts": dict(sorted(reason_counts.items())),
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Temperature selection verification failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

