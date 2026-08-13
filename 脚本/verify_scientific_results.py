#!/usr/bin/env python3
"""Verify the complete 520-record measured-data TH-SHRC contract."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from experiment_common import (
    BRANCHES,
    DATA_DIR,
    FIVE_COLUMNS,
    FIVE_PATH,
    INPUT_PATH,
    MULTISEED_DIR,
    ROOT,
    SEEDS,
    SIGNATURE_COLUMNS,
    SOURCE_MEASUREMENTS_PATH,
    TRACE_PATH,
    VALIDATION_CONTRACT_PATH,
    load_config,
    metrics,
    recalculate_features,
    rowwise_seed_ensemble,
    sha256,
)


class Verification:
    def __init__(self) -> None:
        self.checks: list[dict[str, object]] = []

    def add(self, name: str, passed: bool, detail: str) -> None:
        self.checks.append(
            {"check": name, "status": "PASS" if passed else "FAIL", "detail": detail}
        )

    @property
    def passed(self) -> bool:
        return all(row["status"] == "PASS" for row in self.checks)


def exact_numeric(left: pd.DataFrame, right: pd.DataFrame, columns: list[str]) -> bool:
    return np.array_equal(
        left[columns].to_numpy(float),
        right[columns].to_numpy(float),
        equal_nan=True,
    )


def verify_data(
    check: Verification,
    trace: pd.DataFrame,
    five: pd.DataFrame,
    model_input: pd.DataFrame,
) -> None:
    config = load_config()
    raw = pd.read_csv(SOURCE_MEASUREMENTS_PATH)
    contract = pd.read_csv(VALIDATION_CONTRACT_PATH)
    check.add(
        "row_contract",
        len(trace) == len(five) == len(model_input) == len(raw) == len(contract) == 520,
        f"trace={len(trace)}; five={len(five)}; input={len(model_input)}",
    )
    check.add(
        "all_records_measured",
        trace["DataClass"].eq("measured").all(),
        f"values={sorted(trace['DataClass'].astype(str).unique())}",
    )
    check.add(
        "cattle_count",
        trace["CowKey"].nunique() == int(config["cattle"]),
        f"cattle={trace['CowKey'].nunique()}",
    )
    check.add(
        "record_identity",
        np.array_equal(trace["RecordID"].astype(str), raw["RecordID"].astype(str))
        and np.array_equal(model_input["RecordID"].astype(str), raw["RecordID"].astype(str))
        and trace["RecordID"].is_unique,
        f"unique={trace['RecordID'].nunique()}",
    )
    check.add(
        "source_measurements_unchanged",
        np.array_equal(trace["CowKey"].astype(str), raw["CowKey"].astype(str))
        and exact_numeric(trace, raw, list(SIGNATURE_COLUMNS)),
        f"source_sha256={sha256(SOURCE_MEASUREMENTS_PATH)}",
    )
    check.add(
        "five_column_projection",
        np.array_equal(five.astype(str), trace[FIVE_COLUMNS].astype(str)),
        "five-column file is the ordered trace projection",
    )
    check.add(
        "trace_model_values",
        np.array_equal(trace["CowKey"].astype(str), model_input["CowKey"].astype(str))
        and exact_numeric(trace, model_input, list(SIGNATURE_COLUMNS)),
        "trace and model input values match in row order",
    )
    sources = sorted(model_input["Source"].astype(str).unique())
    weights = sorted(model_input["SourceWeight"].astype(float).unique())
    check.add("single_source", sources == [str(config["source"])], f"values={sources}")
    check.add("unit_weights", weights == [1.0], f"values={weights}")
    duplicate_groups = int(
        model_input.groupby(list(SIGNATURE_COLUMNS), dropna=False).size().gt(1).sum()
    )
    triplet_groups = int(
        model_input.groupby(
            ["EarTemperature_C", "CoreReferenceTemperature_C", "MeasurementTime_hour"],
            dropna=False,
        )
        .size()
        .gt(1)
        .sum()
    )
    check.add("signature_uniqueness", duplicate_groups == 0, f"groups={duplicate_groups}")
    check.add("triplet_uniqueness", triplet_groups == 0, f"groups={triplet_groups}")
    derived = [
        "SeqInCowSource",
        "CowSourceN",
        "EarLag1_C",
        "EarLag2_C",
        "AmbientLag1_C",
        "EarDelta1_C",
        "AmbientDelta1_C",
        "TimeSin",
        "TimeCos",
        "ThermalLoad",
        "EarAirGap_C",
        "HotFlag",
        "NightFlag",
    ]
    recalculated = recalculate_features(model_input)
    check.add(
        "derived_features_recalculate",
        np.allclose(
            recalculated[derived].to_numpy(float),
            model_input[derived].to_numpy(float),
            rtol=0.0,
            atol=1e-12,
        ),
        "all derived model features reproduce",
    )
    fold_columns = [f"OuterFold_{seed}" for seed in SEEDS]
    folds_ok = all(
        column in model_input
        and set(model_input[column].astype(int).unique()) == {1, 2, 3, 4, 5}
        and np.array_equal(model_input[column].astype(int), contract[column].astype(int))
        for column in fold_columns
    )
    check.add("five_fixed_fold_columns", folds_ok, f"columns={fold_columns}")


def read_gate(check: Verification, name: str, path: Path) -> dict[str, object]:
    if not path.is_file():
        check.add(name, False, f"missing={path}")
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    check.add(name, payload.get("status") == "PASS", f"status={payload.get('status')}")
    return payload


def verify_full(check: Verification, trace: pd.DataFrame, model_input: pd.DataFrame) -> None:
    config = load_config()
    summary = read_gate(check, "multiseed_summary", MULTISEED_DIR / "summary.json")
    ensemble_path = MULTISEED_DIR / "ensemble_oof_predictions.csv"
    long_path = MULTISEED_DIR / "oof_predictions_long.csv"
    if ensemble_path.is_file() and long_path.is_file():
        ensemble = pd.read_csv(ensemble_path)
        long = pd.read_csv(long_path)
        prediction_columns = [f"Predicted_{seed}" for seed in SEEDS]
        recomputed = rowwise_seed_ensemble(
            ensemble[prediction_columns].to_numpy(float)
        )
        actual = ensemble["Actual"].to_numpy(float)
        score = metrics(actual, recomputed)
        check.add(
            "seed_ensemble_recalculates",
            np.allclose(recomputed, ensemble["Predicted"].to_numpy(float), atol=1e-12),
            f"maximum_difference={np.max(np.abs(recomputed - ensemble['Predicted']))}",
        )
        public_oof_path = ROOT / (
            "数据/处理数据/th_shrc_oof_predictions.csv"
            if (ROOT / "数据").is_dir()
            else "data/processed/th_shrc_oof_predictions.csv"
        )
        public_oof = pd.read_csv(public_oof_path)
        frozen_columns = [
            "Actual",
            *prediction_columns,
            "Predicted",
            "Residual",
        ]
        exact_public_oof = (
            len(public_oof) == len(ensemble)
            and np.array_equal(
                public_oof["RecordID"].astype(str).to_numpy(),
                ensemble["RecordID"].astype(str).to_numpy(),
            )
            and np.array_equal(
                public_oof[frozen_columns].to_numpy(float),
                ensemble[frozen_columns].to_numpy(float),
            )
        )
        check.add(
            "frozen_oof_rows_match_public_table",
            exact_public_oof,
            "formal ensemble predictions match the public OOF table row by row",
        )
        check.add(
            "formal_metrics_finite",
            bool(np.isfinite([score["R2"], score["RMSE"], score["MAE"]]).all())
            and config["seed_ensemble_method"] == "rowwise_median",
            f"method={config['seed_ensemble_method']}; R2={score['R2']}; MAE={score['MAE']}",
        )
        check.add(
            "five_seed_three_branch_coverage",
            len(long) == 520 * len(SEEDS)
            and long[[*BRANCHES, "Predicted"]].notna().all().all()
            and not long.duplicated(["Seed", "RecordID"]).any(),
            f"rows={len(long)}",
        )
        check.add(
            "prediction_targets_match_input",
            np.array_equal(actual, model_input["CoreReferenceTemperature_C"].to_numpy(float)),
            "ensemble targets match model input",
        )
        check.add(
            "measured_class_reporting",
            summary.get("by_data_class", [{}])[0].get("DataClass") == "measured"
            and int(summary.get("by_data_class", [{}])[0].get("N", 0)) == 520,
            f"rows={summary.get('by_data_class')}",
        )
    else:
        check.add("formal_prediction_files", False, "ensemble or long predictions missing")

    read_gate(
        check,
        "cross_cow_near_matches",
        ROOT / "outputs" / "validation" / "cross_cow_independence" / "summary.json",
    )
    benchmark = read_gate(
        check,
        "benchmark33",
        ROOT / "outputs" / "analysis" / "benchmark33" / "benchmark_verification.json",
    )
    check.add(
        "benchmark33_complete",
        int(benchmark.get("expected_model_count", 0)) == 33
        and int(benchmark.get("retrained_model_count", 0)) == 33
        and not benchmark.get("failed_models")
        and not benchmark.get("incomplete_models"),
        f"completed={benchmark.get('retrained_model_count')}",
    )
    analysis_reports = {}
    for name in ("ablation", "overfitting_checks", "shap"):
        analysis_reports[name] = read_gate(
            check,
            f"analysis_{name}",
            ROOT / "outputs" / "analysis" / name / "summary.json",
        )
    ablation = analysis_reports["ablation"]
    check.add(
        "strict_mechanism_ablation",
        ablation.get("analysis") == "strict mechanism-level ablation"
        and int(ablation.get("bootstrap", {}).get("replicates", 0)) == 10_000
        and ablation.get("bootstrap", {}).get("published_figure_unit") == "paired record"
        and ablation.get("bootstrap", {}).get("dependence_robustness_unit")
        == "paired cow cluster"
        and float(ablation.get("max_full_ensemble_difference_C", float("inf"))) <= 1e-10,
        "mechanism routes disabled before downstream refitting; 10,000 paired record and cow-cluster replicates",
    )
    if (ROOT / "analysis" / "manuscript_figures" / "panel_manifest.csv").is_file():
        panel_manifest = ROOT / "analysis" / "manuscript_figures" / "panel_manifest.csv"
        reproduction = ROOT / "analysis" / "manuscript_figures" / "reproduction_sources"
        figure_output = "outputs"
    elif (ROOT / "分析" / "论文图源" / "panel_manifest.csv").is_file():
        panel_manifest = ROOT / "分析" / "论文图源" / "panel_manifest.csv"
        reproduction = ROOT / "分析" / "论文图源" / "图源复现"
        figure_output = "输出"
    else:
        panel_manifest = ROOT / "输出" / "论文图件" / "小图交付" / "panel_manifest.csv"
        reproduction = None
        figure_output = None
    panels = pd.read_csv(panel_manifest) if panel_manifest.is_file() else pd.DataFrame()
    missing_panels: list[str] = []
    if reproduction is not None and not panels.empty:
        for row in panels.itertuples(index=False):
            directory = reproduction / f"fig{int(row.manuscript_figure):02d}" / str(figure_output)
            for suffix in (".png", ".svg"):
                path = directory / f"{row.output_stem}{suffix}"
                if not path.is_file():
                    missing_panels.append(str(path.relative_to(ROOT)))
    workspace_qa = ROOT / "outputs" / "manuscript_figure_qa" / "manuscript_panel_qa.json"
    qa = json.loads(workspace_qa.read_text(encoding="utf-8")) if workspace_qa.is_file() else {}
    qa_status_ok = qa.get("status") == "PASS" if reproduction is None else True
    check.add(
        "figure_qa",
        qa_status_ok
        and len(panels) == 23
        and "status" in panels
        and panels["status"].eq("PASS").all()
        and not missing_panels,
        f"report_status={qa.get('status', 'manifest-only')}; panels={len(panels)}; missing={missing_panels}",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=("data", "full"), default="full")
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "outputs" / "validation" / "scientific_results.json",
    )
    args = parser.parse_args()
    trace = pd.read_csv(TRACE_PATH)
    five = pd.read_csv(FIVE_PATH)
    model_input = pd.read_csv(INPUT_PATH)
    check = Verification()
    verify_data(check, trace, five, model_input)
    if args.stage == "full":
        verify_full(check, trace, model_input)
    report = {
        "status": "PASS" if check.passed else "FAIL",
        "stage": args.stage,
        "data_dir": DATA_DIR.relative_to(ROOT).as_posix(),
        "checks": check.checks,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if check.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
