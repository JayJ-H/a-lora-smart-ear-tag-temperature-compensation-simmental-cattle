#!/usr/bin/env python3
"""Shared paths, metrics, and feature construction for the measured experiment."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "all_measured_config.json"
SOURCE_DIR = ROOT / "source_inputs"
DATA_DIR = ROOT / "data"
OUTPUT_DIR = ROOT / "outputs"
MULTISEED_DIR = OUTPUT_DIR / "all_measured_multiseed"
TRACE_PATH = DATA_DIR / "all_measured_520_traceable.csv"
FIVE_PATH = DATA_DIR / "all_measured_520_five_columns.csv"
INPUT_PATH = DATA_DIR / "all_measured_520_th_shrc_input.csv"
SOURCE_MEASUREMENTS_PATH = SOURCE_DIR / "all_measured_520_measurements.csv"
VALIDATION_CONTRACT_PATH = SOURCE_DIR / "all_measured_520_validation_contract.csv"
RUNNER = ROOT / "reproduction" / "th_shrc" / "code" / "run_core_experiment.py"
RSCRIPT = Path(os.environ.get("RSCRIPT", "Rscript"))
SIGNATURE_COLUMNS = [
    "EarTemperature_C",
    "CoreReferenceTemperature_C",
    "AmbientTemperature_C",
    "MeasurementTime_hour",
]
FIVE_COLUMNS = ["CowKey", *SIGNATURE_COLUMNS]
SEEDS = (20260523, 20260607, 20260701, 20260811, 20260903)
BRANCHES = (
    "SourceMemoryPredicted",
    "BatchSessionPredicted",
    "HierarchicalResidualPredicted",
)
BRANCH_WEIGHT_COLUMNS = [
    "WeightSourceMemory",
    "WeightBatchSession",
    "WeightHierarchicalResidual",
]


def load_config() -> dict[str, object]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float | int]:
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    residual = actual - predicted
    denominator = np.sum((actual - actual.mean()) ** 2)
    return {
        "N": int(len(actual)),
        "R2": float(1.0 - np.sum(residual**2) / denominator),
        "RMSE": float(np.sqrt(np.mean(residual**2))),
        "MAE": float(np.mean(np.abs(residual))),
        "Bias": float(np.mean(residual)),
    }


def rowwise_seed_ensemble(predictions: np.ndarray) -> np.ndarray:
    """Apply the fixed rowwise median across seed predictions."""
    values = np.asarray(predictions, dtype=float)
    if values.ndim != 2 or values.shape[1] < 2:
        raise ValueError("Seed predictions must be a two-dimensional matrix")
    return np.median(values, axis=1)


def recalculate_features(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    numeric = [
        *SIGNATURE_COLUMNS,
        "RowID",
        "SourceRowID",
        "SourceWeight",
        "AcquisitionSession",
    ]
    for column in numeric:
        result[column] = pd.to_numeric(result[column], errors="raise")
    work = result.sort_values(
        [
            "Source",
            "CowKey",
            "AcquisitionSession",
            "MeasurementTime_hour",
            "RowID",
        ],
        kind="stable",
    ).copy()
    grouped = work.groupby(
        ["Source", "CowKey", "AcquisitionSession"], sort=False
    )
    work["SeqInCowSource"] = grouped.cumcount() + 1
    work["CowSourceN"] = grouped["CowKey"].transform("size")
    work["EarLag1_C"] = grouped["EarTemperature_C"].shift(1)
    work["EarLag2_C"] = grouped["EarTemperature_C"].shift(2)
    work["AmbientLag1_C"] = grouped["AmbientTemperature_C"].shift(1)
    work["EarLag1_C"] = work["EarLag1_C"].fillna(work["EarTemperature_C"])
    work["EarLag2_C"] = work["EarLag2_C"].fillna(work["EarLag1_C"])
    work["AmbientLag1_C"] = work["AmbientLag1_C"].fillna(
        work["AmbientTemperature_C"]
    )
    work["EarDelta1_C"] = work["EarTemperature_C"] - work["EarLag1_C"]
    work["AmbientDelta1_C"] = (
        work["AmbientTemperature_C"] - work["AmbientLag1_C"]
    )
    angle = 2.0 * np.pi * work["MeasurementTime_hour"].to_numpy(float) / 24.0
    work["TimeSin"] = np.sin(angle)
    work["TimeCos"] = np.cos(angle)
    work["ThermalLoad"] = np.clip(
        (work["AmbientTemperature_C"].to_numpy(float) - 18.0) / 17.0,
        0.0,
        1.0,
    )
    work["EarAirGap_C"] = (
        work["EarTemperature_C"] - work["AmbientTemperature_C"]
    )
    work["HotFlag"] = (work["AmbientTemperature_C"] >= 30.0).astype(int)
    work["NightFlag"] = (
        (work["MeasurementTime_hour"] >= 20.0)
        | (work["MeasurementTime_hour"] <= 6.0)
    ).astype(int)
    return work.sort_values("RowID", kind="stable").reset_index(drop=True)
