#!/usr/bin/env python3
"""Verify TH-SHRC and LoRa result tables from row-level data."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterable


SHARED = Path(__file__).resolve().parents[1]
DEFAULT_DATA = SHARED / "data"
DEFAULT_OUTPUT = SHARED / "outputs"


@dataclass
class Check:
    group: str
    check: str
    status: str
    detail: str
    computed: str = ""
    expected: str = ""
    tolerance: str = ""


CHECKS: list[Check] = []


def add_check(
    group: str,
    check: str,
    passed: bool,
    detail: str,
    computed: object = "",
    expected: object = "",
    tolerance: object = "",
) -> None:
    CHECKS.append(
        Check(
            group=group,
            check=check,
            status="PASS" if passed else "FAIL",
            detail=detail,
            computed=str(computed),
            expected=str(expected),
            tolerance=str(tolerance),
        )
    )


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def floats(rows: Iterable[dict[str, str]], column: str) -> list[float]:
    return [float(row[column]) for row in rows]


def quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def metrics(actual: list[float], predicted: list[float]) -> dict[str, float]:
    if len(actual) != len(predicted) or not actual:
        raise ValueError("Metric arrays must be non-empty and have equal length")
    n = len(actual)
    residual = [a - p for a, p in zip(actual, predicted)]
    absolute = [abs(value) for value in residual]
    mean_actual = math.fsum(actual) / n
    sum_squared_error = math.fsum(value * value for value in residual)
    total_sum_squares = math.fsum((value - mean_actual) ** 2 for value in actual)
    mean_residual = math.fsum(residual) / n
    return {
        "N": float(n),
        "R2": 1.0 - sum_squared_error / total_sum_squares,
        "RMSE": math.sqrt(sum_squared_error / n),
        "MAE": math.fsum(absolute) / n,
        "Bias_actual_minus_pred": mean_residual,
        "ErrorSD": math.sqrt(
            math.fsum((value - mean_residual) ** 2 for value in residual) / (n - 1)
        ),
        "MedianAE": quantile(absolute, 0.50),
        "P75_AE": quantile(absolute, 0.75),
        "P90_AE": quantile(absolute, 0.90),
        "P95_AE": quantile(absolute, 0.95),
        "MaxAE": max(absolute),
        "Within_0_1C": sum(value <= 0.1 for value in absolute) / n,
        "Within_0_2C": sum(value <= 0.2 for value in absolute) / n,
        "Within_0_3C": sum(value <= 0.3 for value in absolute) / n,
        "Within_0_5C": sum(value <= 0.5 for value in absolute) / n,
    }


def close(actual: float, expected: float, tolerance: float = 1e-10) -> bool:
    return math.isclose(actual, expected, rel_tol=0.0, abs_tol=tolerance)


def maximum_metric_difference(
    calculated: dict[str, float],
    expected: dict[str, str],
    mapping: dict[str, str],
) -> float:
    return max(
        abs(calculated[calculated_name] - float(expected[expected_name]))
        for calculated_name, expected_name in mapping.items()
    )


def verify_manifest(data_dir: Path) -> None:
    group = "provenance"
    manifest_path = data_dir / "metadata/result_source_manifest.csv"
    rows = read_rows(manifest_path)
    failures = []
    for row in rows:
        public_path = data_dir / row["PublicFile"]
        if not public_path.exists():
            failures.append(f"missing:{row['PublicFile']}")
            continue
        actual_hash = sha256(public_path)
        if actual_hash != row["PublicSHA256"]:
            failures.append(f"hash:{row['PublicFile']}")
    add_check(
        group,
        "public_result_file_hashes",
        not failures and len(rows) == 11,
        "All 11 result files match the provenance manifest."
        if not failures
        else "; ".join(failures),
        len(rows) - len(failures),
        11,
    )


def verify_main_oof(data_dir: Path) -> dict[str, dict[str, str]]:
    group = "main_th_shrc"
    rows = read_rows(data_dir / "processed/th_shrc_oof_predictions.csv")
    by_row = {row["RowID"]: row for row in rows}
    shape_ok = (
        len(rows) == 503
        and len(by_row) == 503
        and len({row["RecordID"] for row in rows}) == 503
        and len({row["CowKey"] for row in rows}) == 30
        and {row["FoldID"] for row in rows} == {"1", "2", "3", "4", "5"}
        and {row["FoldMode"] for row in rows} == {"within_cow_random5"}
    )
    add_check(
        group,
        "oof_design",
        shape_ok,
        "503 unique records, 30 CowKey values, and five within-cow random OOF folds.",
        f"rows={len(rows)}, cows={len({r['CowKey'] for r in rows})}",
        "rows=503, cows=30, folds=1..5",
    )

    calculated = metrics(floats(rows, "Actual"), floats(rows, "Predicted"))
    expected = {
        "R2": 0.8551359051012453,
        "RMSE": 0.25195565941200593,
        "MAE": 0.1345534257161156,
        "Within_0_5C": 0.9423459244532804,
    }
    difference = max(abs(calculated[key] - value) for key, value in expected.items())
    add_check(
        group,
        "official_oof_metrics",
        difference <= 1e-12,
        "R2, RMSE, MAE, and 0.5 C coverage recomputed from all OOF predictions.",
        json.dumps({key: calculated[key] for key in expected}, sort_keys=True),
        json.dumps(expected, sort_keys=True),
        "1e-12",
    )

    residual_difference = max(
        abs((float(row["Actual"]) - float(row["Predicted"])) - float(row["Residual"]))
        for row in rows
    )
    add_check(
        group,
        "stored_residuals",
        residual_difference <= 1e-12,
        "Every stored residual equals Actual - Predicted.",
        residual_difference,
        0.0,
        "1e-12",
    )
    return by_row


def verify_benchmark(data_dir: Path, oof: dict[str, dict[str, str]]) -> None:
    group = "benchmark"
    rows = read_rows(data_dir / "processed/model_benchmark_oof_predictions.csv")
    summaries = read_rows(data_dir / "processed/model_benchmark_metrics.csv")
    by_model: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        by_model[row["Model"]].append(row)
    summary_by_model = {row["Model"]: row for row in summaries}

    shape_ok = (
        len(rows) == 16599
        and len(by_model) == 33
        and len(summaries) == 33
        and all(len(model_rows) == 503 for model_rows in by_model.values())
        and set(by_model) == set(summary_by_model)
    )
    add_check(
        group,
        "benchmark_shape",
        shape_ok,
        "All 33 models contain one prediction for each of 503 records.",
        f"rows={len(rows)}, models={len(by_model)}",
        "rows=16599, models=33",
    )

    identity_failures = 0
    metric_difference = 0.0
    metric_mapping = {
        "N": "N",
        "R2": "R2",
        "RMSE": "RMSE",
        "MAE": "MAE",
        "Bias_actual_minus_pred": "Bias_actual_minus_pred",
        "ErrorSD": "ErrorSD",
        "MedianAE": "MedianAE",
        "P75_AE": "P75_AE",
        "P90_AE": "P90_AE",
        "P95_AE": "P95_AE",
        "MaxAE": "MaxAE",
        "Within_0_1C": "Within_0_1C",
        "Within_0_2C": "Within_0_2C",
        "Within_0_3C": "Within_0_3C",
        "Within_0_5C": "Within_0_5C",
    }
    for model, model_rows in by_model.items():
        model_by_row = {row["RowID"]: row for row in model_rows}
        if set(model_by_row) != set(oof):
            identity_failures += 1
            continue
        if any(
            not close(float(row["Actual"]), float(oof[row_id]["Actual"]), 1e-12)
            for row_id, row in model_by_row.items()
        ):
            identity_failures += 1
        calculated = metrics(
            floats(model_rows, "Actual"), floats(model_rows, "Predicted")
        )
        metric_difference = max(
            metric_difference,
            maximum_metric_difference(
                calculated, summary_by_model[model], metric_mapping
            ),
        )
    add_check(
        group,
        "benchmark_record_identity",
        identity_failures == 0,
        "Each model uses the same RowID and Actual values as the official OOF table.",
        identity_failures,
        0,
    )
    add_check(
        group,
        "benchmark_metrics",
        metric_difference <= 1e-10,
        "All displayed benchmark metrics recomputed from row-level predictions.",
        metric_difference,
        0.0,
        "1e-10",
    )

    proposed = {row["RowID"]: row for row in by_model.get("TH_SHRC", [])}
    proposed_difference = max(
        (
            abs(float(proposed[row_id]["Predicted"]) - float(oof[row_id]["Predicted"]))
            for row_id in oof
        ),
        default=math.inf,
    )
    add_check(
        group,
        "proposed_model_matches_official_oof",
        proposed_difference <= 1e-12,
        "TH_SHRC benchmark predictions match the OOF reference.",
        proposed_difference,
        0.0,
        "1e-12",
    )


def verify_ablation(data_dir: Path, oof: dict[str, dict[str, str]]) -> None:
    group = "ablation"
    rows = read_rows(data_dir / "processed/th_shrc_ablation_oof_predictions.csv")
    summaries = read_rows(data_dir / "processed/th_shrc_ablation_metrics.csv")
    bootstrap = read_rows(data_dir / "processed/th_shrc_ablation_bootstrap.csv")
    by_row = {row["RowID"]: row for row in rows}
    identity_difference = max(
        max(
            abs(float(row["Actual_C"]) - float(oof[row_id]["Actual"])),
            abs(
                float(row["Predicted_Full_ABC_C"])
                - float(oof[row_id]["Predicted"])
            ),
        )
        for row_id, row in by_row.items()
    )
    add_check(
        group,
        "ablation_record_identity",
        len(rows) == 503 and set(by_row) == set(oof) and identity_difference <= 1e-12,
        "Ablation rows and the full A+B+C prediction match the official OOF table.",
        f"rows={len(rows)}, max_diff={identity_difference}",
        "rows=503, max_diff=0",
        "1e-12",
    )

    configuration_columns = {
        "Full A+B+C": "Predicted_Full_ABC_C",
        "w/o A (B+C)": "Predicted_Without_A_BC_C",
        "w/o B (A+C)": "Predicted_Without_B_AC_C",
        "w/o C (A+B)": "Predicted_Without_C_AB_C",
    }
    summary_by_configuration = {row["Configuration"]: row for row in summaries}
    calculated_by_configuration = {}
    actual = floats(rows, "Actual_C")
    for configuration, column in configuration_columns.items():
        calculated_by_configuration[configuration] = metrics(
            actual, floats(rows, column)
        )
    full = calculated_by_configuration["Full A+B+C"]
    metric_difference = 0.0
    for configuration, calculated in calculated_by_configuration.items():
        calculated = dict(calculated)
        calculated["Bias_C"] = calculated["Bias_actual_minus_pred"]
        calculated["RMSE_C"] = calculated["RMSE"]
        calculated["MAE_C"] = calculated["MAE"]
        calculated["MedianAE_C"] = calculated["MedianAE"]
        calculated["P95_AE_C"] = calculated["P95_AE"]
        calculated["Delta_R2_vs_full"] = calculated["R2"] - full["R2"]
        calculated["Delta_RMSE_vs_full_C"] = calculated["RMSE"] - full["RMSE"]
        calculated["Delta_MAE_vs_full_C"] = calculated["MAE"] - full["MAE"]
        mapping = {
            "N": "N",
            "R2": "R2",
            "RMSE_C": "RMSE_C",
            "MAE_C": "MAE_C",
            "Bias_C": "Bias_C",
            "MedianAE_C": "MedianAE_C",
            "P95_AE_C": "P95_AE_C",
            "Within_0_2C": "Within_0_2C",
            "Within_0_3C": "Within_0_3C",
            "Within_0_5C": "Within_0_5C",
            "Delta_R2_vs_full": "Delta_R2_vs_full",
            "Delta_RMSE_vs_full_C": "Delta_RMSE_vs_full_C",
            "Delta_MAE_vs_full_C": "Delta_MAE_vs_full_C",
        }
        metric_difference = max(
            metric_difference,
            maximum_metric_difference(
                calculated, summary_by_configuration[configuration], mapping
            ),
        )
    add_check(
        group,
        "ablation_metrics",
        metric_difference <= 1e-10,
        "All four mechanism-level configurations were recomputed from 503 OOF rows.",
        metric_difference,
        0.0,
        "1e-10",
    )

    bootstrap_ok = len(bootstrap) == 3
    point_difference = 0.0
    for row in bootstrap:
        configuration = row["Configuration"]
        calculated = calculated_by_configuration[configuration]
        point_difference = max(
            point_difference,
            abs(
                float(row["Delta_RMSE_C"])
                - (calculated["RMSE"] - full["RMSE"])
            ),
            abs(
                float(row["Delta_MAE_C"])
                - (calculated["MAE"] - full["MAE"])
            ),
        )
        bootstrap_ok = bootstrap_ok and int(row["BootstrapN"]) == 10000
        bootstrap_ok = bootstrap_ok and 0 < float(row["Delta_RMSE_CI2.5_C"])
        bootstrap_ok = bootstrap_ok and (
            float(row["Delta_RMSE_CI2.5_C"])
            < float(row["Delta_RMSE_C"])
            < float(row["Delta_RMSE_CI97.5_C"])
        )
    add_check(
        group,
        "ablation_bootstrap_reference_summary",
        bootstrap_ok and point_difference <= 1e-12,
        "The 10,000-replicate summary has valid intervals and point deltas consistent with the recalculated metrics.",
        f"rows={len(bootstrap)}, max_point_diff={point_difference}",
        "rows=3, max_point_diff=0",
        "1e-12",
    )


def verify_shap(data_dir: Path, oof: dict[str, dict[str, str]]) -> None:
    group = "shap"
    rows = read_rows(data_dir / "processed/th_shrc_shap_values.csv")
    summaries = read_rows(data_dir / "processed/th_shrc_shap_summary.csv")
    by_row = {row["RowID"]: row for row in rows}
    identity_difference = 0.0
    for row_id, row in by_row.items():
        source = oof[row_id]
        identity_difference = max(
            identity_difference,
            abs(float(row["Ear_C"]) - float(source["Ear"])),
            abs(float(row["Air_C"]) - float(source["Air"])),
            abs(float(row["Time_hour"]) - float(source["Time"])),
            abs(
                float(row["OfficialOOFPrediction_C"])
                - float(source["Predicted"])
            ),
        )
        if row["RecordID"] != source["RecordID"] or row["CowKey"] != source["CowKey"]:
            identity_difference = math.inf
    add_check(
        group,
        "shap_record_identity",
        len(rows) == 503 and set(by_row) == set(oof) and identity_difference <= 1e-12,
        "SHAP rows match the anonymous identity and measurement fields.",
        f"rows={len(rows)}, max_diff={identity_difference}",
        "rows=503, max_diff=0",
        "1e-12",
    )

    groups = {
        "Time_diurnal": "SHAP_Time_diurnal_C",
        "Ear_temperature": "SHAP_Ear_temperature_C",
        "Cow_identity": "SHAP_Cow_identity_C",
        "Ambient_temperature": "SHAP_Ambient_temperature_C",
    }
    summary_by_group = {row["FeatureGroup"]: row for row in summaries}
    calculated_summaries = {}
    for name, column in groups.items():
        values = floats(rows, column)
        absolute = [abs(value) for value in values]
        calculated_summaries[name] = {
            "MeanAbsSHAP_C": math.fsum(absolute) / len(values),
            "MeanSignedSHAP_C": math.fsum(values) / len(values),
            "MedianAbsSHAP_C": quantile(absolute, 0.50),
            "P90AbsSHAP_C": quantile(absolute, 0.90),
        }
    metric_difference = 0.0
    for name, calculated in calculated_summaries.items():
        metric_difference = max(
            metric_difference,
            max(
                abs(value - float(summary_by_group[name][metric]))
                for metric, value in calculated.items()
            ),
        )
    calculated_rank = [
        name
        for name, _ in sorted(
            calculated_summaries.items(),
            key=lambda item: item[1]["MeanAbsSHAP_C"],
            reverse=True,
        )
    ]
    expected_rank = [
        row["FeatureGroup"]
        for row in sorted(summaries, key=lambda row: int(row["Rank_by_MeanAbsSHAP"]))
    ]
    add_check(
        group,
        "shap_four_group_summary",
        len(summaries) == 4
        and metric_difference <= 1e-12
        and calculated_rank == expected_rank,
        "Four displayed SHAP group summaries and their ranking were recomputed from 503 rows.",
        f"max_diff={metric_difference}, rank={calculated_rank}",
        f"max_diff=0, rank={expected_rank}",
        "1e-12",
    )

    additivity_difference = 0.0
    stored_difference = 0.0
    conditional_difference = 0.0
    for row in rows:
        reconstructed = float(row["TechnicalBaselinePrediction_C"]) + math.fsum(
            float(row[column]) for column in groups.values()
        )
        conditional = float(row["ConditionalFullPipelinePrediction_C"])
        official = float(row["OfficialOOFPrediction_C"])
        additivity_difference = max(
            additivity_difference,
            abs(reconstructed - conditional),
            abs(float(row["ReconstructedPrediction_C"]) - conditional),
            abs(float(row["AdditivityDifference_C"])),
        )
        stored_difference = max(
            stored_difference,
            abs(
                float(row["ConditionalVsOfficialDifference_C"])
                - (conditional - official)
            ),
        )
        conditional_difference = max(
            conditional_difference, abs(conditional - official)
        )
    add_check(
        group,
        "shap_internal_additivity",
        additivity_difference <= 1e-12,
        "Technical baseline plus four conditional SHAP groups reconstructs the conditional full-pipeline value.",
        additivity_difference,
        0.0,
        "1e-12",
    )
    expected_conditional_difference = 0.14352658317555722
    add_check(
        group,
        "shap_official_oof_boundary",
        stored_difference <= 1e-12
        and close(conditional_difference, expected_conditional_difference, 1e-12),
        "The conditional SHAP table reconstructs the conditional full-pipeline value; reported accuracy metrics are recomputed from the OOF predictions.",
        f"max_abs_conditional_vs_official={conditional_difference}",
        f"max_abs_conditional_vs_official={expected_conditional_difference}",
        "1e-12",
    )


def verify_lora(data_dir: Path) -> None:
    group = "lora"
    rows = read_rows(data_dir / "processed/lora_packet_level_records.csv")
    distances = {int(row["Distance_m"]) for row in rows}
    directions = {row["Direction"] for row in rows}
    cells = Counter((row["Distance_m"], row["Direction"]) for row in rows)
    design_ok = (
        len(rows) == 4000
        and distances == {50, 100, 150, 200, 250}
        and len(directions) == 8
        and len(cells) == 40
        and set(cells.values()) == {100}
        and len({row["PacketRecordID"] for row in rows}) == 4000
    )
    add_check(
        group,
        "packet_test_design",
        design_ok,
        "The packet table contains 5 distances x 8 directions x 100 packets.",
        f"rows={len(rows)}, cells={len(cells)}, counts={sorted(set(cells.values()))}",
        "rows=4000, cells=40, counts=[100]",
    )

    received = sum(int(row["Received"]) for row in rows)
    by_distance = defaultdict(list)
    for row in rows:
        by_distance[int(row["Distance_m"])].append(int(row["Received"]))
    overall_pdr = received / len(rows)
    pdr_200 = math.fsum(by_distance[200]) / len(by_distance[200])
    pdr_250 = math.fsum(by_distance[250]) / len(by_distance[250])
    pdr_ok = (
        received == 3751
        and close(overall_pdr, 0.93775, 1e-12)
        and close(pdr_200, 0.93875, 1e-12)
        and close(pdr_250, 0.83125, 1e-12)
    )
    add_check(
        group,
        "packet_delivery_ratio",
        pdr_ok,
        "PDR values were recomputed from all packet-level Received flags.",
        json.dumps(
            {
                "received": received,
                "lost": len(rows) - received,
                "overall": overall_pdr,
                "200m": pdr_200,
                "250m": pdr_250,
            },
            sort_keys=True,
        ),
        '{"received": 3751, "lost": 249, "overall": 0.93775, "200m": 0.93875, "250m": 0.83125}',
    )

    signal_ok = all(
        (
            row["Received"] == "1"
            and row["RSSI_dBm"] != ""
            and row["SNR_dB"] != ""
            and row["PacketLoss"] == "0"
            and row["SourceSentinelValue"] == ""
            and row["SignalMetricValid"] == "1"
            and row["SignalMetricStatus"] == "received_packet_valid_metrics"
        )
        or (
            row["Received"] == "0"
            and row["RSSI_dBm"] == ""
            and row["SNR_dB"] == ""
            and row["PacketLoss"] == "1"
            and row["SourceSentinelValue"] == "91"
            and row["SignalMetricValid"] == "0"
            and row["SignalMetricStatus"] == "lost_packet_source_sentinel_removed"
        )
        for row in rows
    )
    add_check(
        group,
        "packet_signal_consistency",
        signal_ok,
        "Received and packet-loss flags are complementary; the 249 lost-packet 91 sentinels are preserved only in SourceSentinelValue and excluded from RSSI/SNR.",
    )


def run_group(name: str, function: Callable[[], object]) -> object | None:
    before = len(CHECKS)
    try:
        return function()
    except Exception as exc:
        del CHECKS[before:]
        add_check(name, "group_execution", False, f"{type(exc).__name__}: {exc}")
        return None


def write_reports(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "verification_checks.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=list(asdict(CHECKS[0])),
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(asdict(check) for check in CHECKS)

    passed = sum(check.status == "PASS" for check in CHECKS)
    payload = {
        "overall_status": "PASS" if passed == len(CHECKS) else "FAIL",
        "passed": passed,
        "failed": len(CHECKS) - passed,
        "total": len(CHECKS),
        "checks": [asdict(check) for check in CHECKS],
    }
    (output_dir / "verification_results.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )

    lines = [
        "# Unified result verification",
        "",
        f"Overall: **{payload['overall_status']}** ({passed}/{len(CHECKS)} checks passed)",
        "",
        "| Group | Check | Status | Detail |",
        "|---|---|---:|---|",
    ]
    for check in CHECKS:
        detail = check.detail.replace("|", "\\|")
        lines.append(f"| {check.group} | {check.check} | {check.status} | {detail} |")
    lines.extend(["", "Row-level inputs are used for TH-SHRC, benchmark, ablation, SHAP, and LoRa checks.", ""])
    (output_dir / "verification_report.md").write_text(
        "\n".join(lines), encoding="utf-8"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    data_dir = args.data_dir.resolve()
    output_dir = args.output_dir.resolve()

    run_group("provenance", lambda: verify_manifest(data_dir))
    oof_result = run_group("main_th_shrc", lambda: verify_main_oof(data_dir))
    oof = oof_result if isinstance(oof_result, dict) else {}
    run_group("benchmark", lambda: verify_benchmark(data_dir, oof))
    run_group("ablation", lambda: verify_ablation(data_dir, oof))
    run_group("shap", lambda: verify_shap(data_dir, oof))
    run_group("lora", lambda: verify_lora(data_dir))
    write_reports(output_dir)

    passed = sum(check.status == "PASS" for check in CHECKS)
    print(f"Unified verification: {passed}/{len(CHECKS)} checks passed")
    for check in CHECKS:
        print(f"[{check.status}] {check.group}.{check.check}: {check.detail}")
    return 0 if passed == len(CHECKS) else 1


if __name__ == "__main__":
    sys.exit(main())
