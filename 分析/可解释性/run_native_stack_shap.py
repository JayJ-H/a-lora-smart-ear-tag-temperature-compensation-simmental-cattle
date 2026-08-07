"""Reproduce native SHAP values for the fitted TH-SHRC ridge stack."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd


SHARED_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = SHARED_ROOT / "数据" / "处理数据" / "th_shrc_oof_predictions.csv"
DEFAULT_OUTPUT = SHARED_ROOT / "输出" / "分析" / "可解释性" / "原生堆叠SHAP"
FEATURES = [
    "SourceMemoryPredicted",
    "BatchSessionPredicted",
    "HierarchicalResidualPredicted",
]
WEIGHTS = [
    "StackWeightSourceMemory",
    "StackWeightBatchSession",
    "StackWeightHierarchicalResidual",
]
MEANINGS = {
    "SourceMemoryPredicted": "thermal-state memory and retrieval component",
    "BatchSessionPredicted": "individual and session calibration component",
    "HierarchicalResidualPredicted": "hierarchical residual correction component",
}
EXPECTED_MEAN_ABS = {
    "SourceMemoryPredicted": 0.11758851093800544,
    "BatchSessionPredicted": 0.12905794960465952,
    "HierarchicalResidualPredicted": 0.2514347618601517,
}


def require_input(data: pd.DataFrame) -> None:
    required = {
        "RecordID",
        "RowID",
        "FoldID",
        "Actual",
        "Predicted",
        "StackIntercept",
        *FEATURES,
        *WEIGHTS,
    }
    missing = sorted(required - set(data.columns))
    if missing:
        raise RuntimeError(f"Input is missing required columns: {missing}")
    if len(data) != 503 or data["RowID"].nunique() != 503:
        raise RuntimeError("Native stack SHAP requires 503 unique OOF rows")
    if set(data["FoldID"].astype(int)) != {1, 2, 3, 4, 5}:
        raise RuntimeError("FoldID must contain exactly folds 1 through 5")
    if "CowID_raw" in data.columns:
        raise RuntimeError("Public input must not contain CowID_raw")


def reproduce(data: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict[str, object]]:
    require_input(data)
    value_frames: list[pd.DataFrame] = []
    audit_rows: list[dict[str, object]] = []

    for fold_id in sorted(data["FoldID"].astype(int).unique()):
        train = data[data["FoldID"].astype(int) != fold_id]
        test = data[data["FoldID"].astype(int) == fold_id].copy()
        if any(test[column].nunique(dropna=False) != 1 for column in ["StackIntercept", *WEIGHTS]):
            raise RuntimeError(f"Stack settings are not constant within fold {fold_id}")

        intercept = float(test["StackIntercept"].iloc[0])
        coefficients = test[WEIGHTS].iloc[0].to_numpy(float)
        background_mean = train[FEATURES].mean(axis=0).to_numpy(float)
        feature_values = test[FEATURES].to_numpy(float)
        shap_values = (feature_values - background_mean) * coefficients
        base_value = intercept + float(background_mean @ coefficients)
        reconstructed = base_value + shap_values.sum(axis=1)
        unclipped = intercept + feature_values @ coefficients

        values = test[["RecordID", "RowID", "FoldID", "Actual", "Predicted"]].copy()
        values["SHAP_base_value_C"] = base_value
        values["SHAP_sum_C"] = shap_values.sum(axis=1)
        values["SHAP_reconstructed_unclipped_C"] = reconstructed
        for index, feature in enumerate(FEATURES):
            values[f"SHAP_{feature}_C"] = shap_values[:, index]
        value_frames.append(values)

        audit_rows.append(
            {
                "FoldID": fold_id,
                "N": len(test),
                "MaxAbsDiff_SHAP_to_unclipped_stack_C": float(
                    np.max(np.abs(reconstructed - unclipped))
                ),
                "MaxAbsDiff_Unclipped_to_saved_prediction_C": float(
                    np.max(np.abs(unclipped - test["Predicted"].to_numpy(float)))
                ),
                "ClippedRows": int(np.sum(np.clip(unclipped, 35.0, 42.0) != unclipped)),
            }
        )

    values = pd.concat(value_frames, ignore_index=True).sort_values("RowID").reset_index(drop=True)
    audit = pd.DataFrame(audit_rows)
    summary_rows = []
    for feature in FEATURES:
        feature_values = values[f"SHAP_{feature}_C"].to_numpy(float)
        summary_rows.append(
            {
                "Level": "native_final_stack_shap",
                "Feature": feature,
                "Meaning": MEANINGS[feature],
                "MeanAbsSHAP_C": float(np.mean(np.abs(feature_values))),
                "MeanSignedSHAP_C": float(np.mean(feature_values)),
                "MedianAbsSHAP_C": float(np.median(np.abs(feature_values))),
                "P90AbsSHAP_C": float(np.quantile(np.abs(feature_values), 0.90)),
            }
        )
    summary = pd.DataFrame(summary_rows).sort_values("MeanAbsSHAP_C", ascending=False)
    summary["Rank_by_MeanAbsSHAP"] = np.arange(1, len(summary) + 1)

    summary_differences = {
        row.Feature: abs(float(row.MeanAbsSHAP_C) - EXPECTED_MEAN_ABS[row.Feature])
        for row in summary.itertuples()
    }
    max_additivity = float(audit["MaxAbsDiff_SHAP_to_unclipped_stack_C"].max())
    max_saved_difference = float(audit["MaxAbsDiff_Unclipped_to_saved_prediction_C"].max())
    status = (
        "PASS"
        if max(summary_differences.values()) <= 1e-12
        and max_additivity <= 1e-12
        and max_saved_difference <= 1e-12
        else "FAIL"
    )
    result: dict[str, object] = {
        "status": status,
        "method": "fold-wise native linear SHAP for the fitted ridge stack",
        "background": "mean of the corresponding outer-training fold",
        "rows": len(values),
        "folds": 5,
        "summary_max_abs_difference": max(summary_differences.values()),
        "additivity_max_abs_difference_C": max_additivity,
        "saved_prediction_max_abs_difference_C": max_saved_difference,
        "clipped_rows": int(audit["ClippedRows"].sum()),
    }
    return summary, values, audit, result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    summary, values, audit, result = reproduce(pd.read_csv(args.input.resolve()))
    summary.to_csv(output_dir / "native_stack_shap_summary.csv", index=False, lineterminator="\n")
    values.to_csv(output_dir / "native_stack_shap_values.csv", index=False, lineterminator="\n")
    audit.to_csv(output_dir / "native_stack_shap_additivity_check.csv", index=False, lineterminator="\n")
    (output_dir / "native_stack_shap_verification.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
