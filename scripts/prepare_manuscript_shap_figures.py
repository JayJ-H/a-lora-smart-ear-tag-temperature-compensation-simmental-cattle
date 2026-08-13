#!/usr/bin/env python3
"""Prepare the recovered GitHub Fig. 18-19 tables from 520-row SHAP output."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
R_OUTPUT = ROOT / "reproduction" / "conditional_shap_runtime" / "five_seed" / "ensemble"
if (ROOT / "数据").is_dir():
    PACKAGE_DATA = ROOT / "分析" / "论文图源" / "图源复现" / "fig18" / "数据"
    PROCESSED = ROOT / "数据" / "处理数据"
else:
    PACKAGE_DATA = (
        ROOT
        / "analysis"
        / "manuscript_figures"
        / "reproduction_sources"
        / "fig18"
        / "data"
    )
    PROCESSED = ROOT / "data" / "processed"

FEATURE_MAP = {
    "Ear_temperature": ("Ear", "SHAP_Ear_temperature_C", "SHAP_Ear"),
    "Ambient_temperature": ("Air", "SHAP_Ambient_temperature_C", "SHAP_Air"),
    "Time_diurnal": ("Time", "SHAP_Time_diurnal_C", "SHAP_Time"),
    "Cow_identity": ("CowID_raw", "SHAP_Cow_identity_C", "SHAP_CowID"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--r-output", type=Path, default=R_OUTPUT)
    parser.add_argument("--package-data", type=Path, default=PACKAGE_DATA)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = args.r_output.resolve()
    destination = args.package_data.resolve()
    destination.mkdir(parents=True, exist_ok=True)

    values = pd.read_csv(source / "conditional_shap_values_reproduced_all_520.csv")
    summary = pd.read_csv(source / "conditional_shap_summary_reproduced_all_520.csv")
    check = pd.read_csv(source / "conditional_shap_additivity_check_all_520.csv")
    if len(values) != 520 or values["RowID"].nunique() != 520:
        raise RuntimeError("Expected 520 unique conditional-SHAP rows")
    if set(summary["FeatureGroup"]) != set(FEATURE_MAP):
        raise RuntimeError("Unexpected four-domain SHAP group set")
    if float(np.abs(values["AdditivityDifference_C"]).max()) > 1e-12:
        raise RuntimeError("Conditional SHAP additivity failed")

    shap_wide = pd.DataFrame(index=values["RowID"].astype(int))
    shap_wide.index.name = "TargetRowID"
    for feature_group, (_, input_column, output_column) in FEATURE_MAP.items():
        shap_wide[FEATURE_MAP[feature_group][0]] = values[input_column].to_numpy(float)

    summary_export = summary.copy()
    summary_export["FeatureGroup"] = summary_export["FeatureGroup"].map(
        {group: output for group, (output, _, _) in FEATURE_MAP.items()}
    )
    summary_export = summary_export.drop(columns=["Rank_by_MeanAbsSHAP"])

    additivity_export = pd.DataFrame(
        {
            "TargetRowID": values["RowID"].astype(int),
            "TechnicalBaselinePrediction_C": values["TechnicalBaselinePrediction_C"],
            "FullPipelinePrediction_C": values["ConditionalFullPipelinePrediction_C"],
            "OfficialOOFPrediction_C": values["OfficialOOFPrediction_C"],
            "ReconstructedPrediction_C": values["ReconstructedPrediction_C"],
            "AdditivityDifference_C": values["AdditivityDifference_C"],
            "ConditionalVsOfficialDifference_C": values["ConditionalVsOfficialDifference_C"],
        }
    )
    plotting_rows = pd.DataFrame(
        {
            "TargetRowID": values["RowID"].astype(int),
            "CowID": values["CowKey"].astype(str),
            "Ear": values["Ear_C"].to_numpy(float),
            "Air": values["Air_C"].to_numpy(float),
            "Time": values["Time_hour"].to_numpy(float),
            "EarAirGap": values["EarAirGap_C"].to_numpy(float),
            "SHAP_Ear": values["SHAP_Ear_temperature_C"].to_numpy(float),
            "SHAP_Air": values["SHAP_Ambient_temperature_C"].to_numpy(float),
            "SHAP_Time": values["SHAP_Time_diurnal_C"].to_numpy(float),
            "SHAP_CowID": values["SHAP_Cow_identity_C"].to_numpy(float),
        }
    )

    shap_wide.to_csv(destination / "SHAP_wide.csv", lineterminator="\n")
    summary_export.to_csv(destination / "SHAP_summary.csv", index=False, lineterminator="\n")
    additivity_export.to_csv(destination / "SHAP_additivity_check.csv", index=False, lineterminator="\n")
    plotting_rows.to_csv(destination / "plotting_rows.csv", index=False, lineterminator="\n")

    shutil.copy2(source / "conditional_shap_values_reproduced_all_520.csv", PROCESSED / "th_shrc_shap_values.csv")
    shutil.copy2(source / "conditional_shap_summary_reproduced_all_520.csv", PROCESSED / "th_shrc_shap_summary.csv")
    report = {
        "status": "PASS",
        "rows": 520,
        "groups": 4,
        "method": "schema-only mapping from native four-domain conditional SHAP output",
        "value_mapping": {group: {"source": source_column, "plot_column": plot_column} for group, (_, source_column, plot_column) in FEATURE_MAP.items()},
        "conditional_prediction_field": "FullPipelinePrediction_C",
        "official_oof_field": "OfficialOOFPrediction_C",
        "additivity_max_abs_difference_C": float(np.abs(values["AdditivityDifference_C"]).max()),
        "conditional_vs_official_max_abs_difference_C": float(np.abs(values["ConditionalVsOfficialDifference_C"]).max()),
    }
    (destination / "SHAP_plot_adapter_check.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
