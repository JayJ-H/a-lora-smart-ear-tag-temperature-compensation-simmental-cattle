"""Verify the four-group conditional full-pipeline SHAP results."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd


SHARED_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_VALUES = SHARED_ROOT / "data" / "processed" / "th_shrc_shap_values.csv"
DEFAULT_SUMMARY = SHARED_ROOT / "data" / "processed" / "th_shrc_shap_summary.csv"
DEFAULT_PAIRED = SHARED_ROOT / "data" / "processed" / "paired_temperature_records.csv"
DEFAULT_OOF = SHARED_ROOT / "data" / "processed" / "th_shrc_oof_predictions.csv"
DEFAULT_OUTPUT = SHARED_ROOT / "outputs" / "analysis" / "interpretability" / "conditional_shap"
GROUP_COLUMNS = {
    "Ear_temperature": "SHAP_Ear_temperature_C",
    "Ambient_temperature": "SHAP_Ambient_temperature_C",
    "Time_diurnal": "SHAP_Time_diurnal_C",
    "Cow_identity": "SHAP_Cow_identity_C",
}


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


def verify(
    values: pd.DataFrame,
    frozen_summary: pd.DataFrame,
    paired: pd.DataFrame,
    oof: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, object]]:
    required = {
        "RecordID",
        "RowID",
        "CowKey",
        "Ear_C",
        "Air_C",
        "Time_hour",
        "TechnicalBaselinePrediction_C",
        "ConditionalFullPipelinePrediction_C",
        "ReconstructedPrediction_C",
        "AdditivityDifference_C",
        "OfficialOOFPrediction_C",
        "ConditionalVsOfficialDifference_C",
        *GROUP_COLUMNS.values(),
    }
    missing = sorted(required - set(values.columns))
    if missing:
        raise RuntimeError(f"SHAP values are missing required fields: {missing}")
    if len(values) != 503 or values["RecordID"].nunique() != 503:
        raise RuntimeError("Conditional SHAP input must contain 503 unique records")
    if "CowID_raw" in values.columns or "CowID_raw" in paired.columns or "CowID_raw" in oof.columns:
        raise RuntimeError("Public SHAP verification inputs must not contain CowID_raw")

    metadata = paired[[
        "RecordID",
        "RowID",
        "CowKey",
        "EarTemperature_C",
        "AmbientTemperature_C",
        "MeasurementTime_hour",
    ]]
    metadata_check = values.merge(metadata, on=["RecordID", "RowID", "CowKey"], validate="one_to_one")
    metadata_max_difference = float(
        np.max(
            np.abs(
                metadata_check[["Ear_C", "Air_C", "Time_hour"]].to_numpy(float)
                - metadata_check[[
                    "EarTemperature_C",
                    "AmbientTemperature_C",
                    "MeasurementTime_hour",
                ]].to_numpy(float)
            )
        )
    )

    oof_check = values[["RecordID", "OfficialOOFPrediction_C"]].merge(
        oof[["RecordID", "Predicted"]], on="RecordID", validate="one_to_one"
    )
    official_max_difference = float(
        np.max(
            np.abs(
                oof_check["OfficialOOFPrediction_C"].to_numpy(float)
                - oof_check["Predicted"].to_numpy(float)
            )
        )
    )

    reconstructed = values["TechnicalBaselinePrediction_C"].to_numpy(float)
    for column in GROUP_COLUMNS.values():
        reconstructed = reconstructed + values[column].to_numpy(float)
    conditional = values["ConditionalFullPipelinePrediction_C"].to_numpy(float)
    official = values["OfficialOOFPrediction_C"].to_numpy(float)
    additivity_max_difference = float(np.max(np.abs(reconstructed - conditional)))
    stored_reconstruction_max_difference = float(
        np.max(np.abs(values["ReconstructedPrediction_C"].to_numpy(float) - conditional))
    )
    stored_additivity_max_difference = float(
        np.max(np.abs(values["AdditivityDifference_C"].to_numpy(float) - (reconstructed - conditional)))
    )
    conditional_boundary_max_difference = float(np.max(np.abs(conditional - official)))
    stored_boundary_max_difference = float(
        np.max(
            np.abs(
                values["ConditionalVsOfficialDifference_C"].to_numpy(float)
                - (conditional - official)
            )
        )
    )

    reproduced_summary = summarise(values)
    joined_summary = reproduced_summary.merge(
        frozen_summary,
        on=["FeatureGroup", "Rank_by_MeanAbsSHAP"],
        suffixes=("_reproduced", "_frozen"),
        validate="one_to_one",
    )
    summary_metric_columns = [
        "MeanAbsSHAP_C",
        "MeanSignedSHAP_C",
        "MedianAbsSHAP_C",
        "P90AbsSHAP_C",
    ]
    summary_max_difference = max(
        float(
            np.max(
                np.abs(
                    joined_summary[f"{column}_reproduced"].to_numpy(float)
                    - joined_summary[f"{column}_frozen"].to_numpy(float)
                )
            )
        )
        for column in summary_metric_columns
    )
    audit = values[[
        "RecordID",
        "RowID",
        "TechnicalBaselinePrediction_C",
        "ConditionalFullPipelinePrediction_C",
        "OfficialOOFPrediction_C",
    ]].copy()
    audit["ReproducedPrediction_C"] = reconstructed
    audit["ReproducedAdditivityDifference_C"] = reconstructed - conditional
    audit["ConditionalVsOfficialDifference_C"] = conditional - official

    checks = {
        "record_metadata": metadata_max_difference <= 1e-12,
        "official_oof_identity": official_max_difference <= 1e-12,
        "conditional_additivity": additivity_max_difference <= 1e-12,
        "stored_reconstruction": stored_reconstruction_max_difference <= 1e-12,
        "stored_additivity": stored_additivity_max_difference <= 1e-12,
        "stored_conditional_boundary": stored_boundary_max_difference <= 1e-12,
        "summary": summary_max_difference <= 1e-12,
        "conditional_is_not_official_oof": conditional_boundary_max_difference > 0.1,
    }
    result: dict[str, object] = {
        "status": "PASS" if all(checks.values()) else "FAIL",
        "method": "four-group conditional Shapley values with source and row-order state fixed in the technical baseline",
        "rows": len(values),
        "groups": len(GROUP_COLUMNS),
        "checks": checks,
        "metadata_max_abs_difference": metadata_max_difference,
        "official_oof_max_abs_difference_C": official_max_difference,
        "additivity_max_abs_difference_C": additivity_max_difference,
        "summary_max_abs_difference_C": summary_max_difference,
        "conditional_vs_official_max_abs_difference_C": conditional_boundary_max_difference,
        "top_group": reproduced_summary.iloc[0]["FeatureGroup"],
    }
    return reproduced_summary, audit, result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--values", type=Path, default=DEFAULT_VALUES)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    parser.add_argument("--paired", type=Path, default=DEFAULT_PAIRED)
    parser.add_argument("--oof", type=Path, default=DEFAULT_OOF)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    summary, audit, result = verify(
        pd.read_csv(args.values.resolve()),
        pd.read_csv(args.summary.resolve()),
        pd.read_csv(args.paired.resolve()),
        pd.read_csv(args.oof.resolve()),
    )
    summary.to_csv(output_dir / "conditional_shap_summary_reproduced.csv", index=False, lineterminator="\n")
    audit.to_csv(output_dir / "conditional_shap_additivity_check.csv", index=False, lineterminator="\n")
    (output_dir / "conditional_shap_verification.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
