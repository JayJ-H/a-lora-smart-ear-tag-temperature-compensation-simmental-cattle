#!/usr/bin/env python3
"""Build the management-platform TH-SHRC runtime asset from the released 520-row OOF table."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd


VERSION = "th-shrc-runtime-v3-all-measured-520"
EXPECTED_ROWS = 520
REPRODUCTION_TOLERANCE = 1e-4
RUNTIME_ASSET_NAME = "runtime-model-v3-exact.json"


def expected_metrics(root: Path) -> dict[str, float]:
    summary = json.loads(
        (root / "outputs/all_measured_multiseed/summary.json").read_text(encoding="utf-8")
    )
    ensemble = summary["ensemble"]
    return {
        "r2": float(ensemble["R2"]),
        "rmse": float(ensemble["RMSE"]),
        "mae": float(ensemble["MAE"]),
    }


def release_paths(root: Path) -> tuple[Path, Path, Path]:
    if (root / "数据").is_dir():
        processed = root / "数据" / "处理数据"
        scripts = root / "管理系统" / "源代码" / "脚本"
        source_file = Path("数据/处理数据/th_shrc_oof_predictions.csv")
    else:
        processed = root / "data" / "processed"
        scripts = root / "backend" / "source_code" / "scripts"
        source_file = Path("data/processed/th_shrc_oof_predictions.csv")
    return processed, scripts, source_file


def metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float | int]:
    residual = actual - predicted
    denominator = np.sum((actual - np.mean(actual)) ** 2)
    return {
        "n": int(len(actual)),
        "r2": float(1.0 - np.sum(residual**2) / denominator),
        "rmse": float(np.sqrt(np.mean(residual**2))),
        "mae": float(np.mean(np.abs(residual))),
        "bias": float(np.mean(residual)),
    }


def validator_runtime(expected: dict[str, float]) -> str:
    return f"""import assert from 'node:assert/strict'
import fs from 'node:fs'
import {{ loadThShrcModel, predictThShrcTemperature }} from './th-shrc-runtime.mjs'

const model = loadThShrcModel()

assert.equal(model.version, '{VERSION}')
assert.equal(model.trainingScope?.rows, 520)
assert.equal(model.trainingScope?.cowKeys, 30)
assert.deepEqual(model.trainingScope?.sources, ['S01'])
assert.equal(model.memoryRows.length, 520)
assert.ok(Math.abs(Number(model.validation?.metrics?.r2) - {expected['r2']!r}) < {REPRODUCTION_TOLERANCE!r})
assert.ok(Math.abs(Number(model.validation?.metrics?.rmse) - {expected['rmse']!r}) < {REPRODUCTION_TOLERANCE!r})

const normal = predictThShrcTemperature({{
  cowNumber: 'demo-cow',
  earTemperature: 38.8,
  airTemperature: 28,
  timestamp: '2026-07-16T18:00:00+08:00'
}})
assert.ok(normal)
assert.ok(Number.isFinite(normal.compensatedTemperature))
assert.equal(normal.rawEarTemperature, 38.8)
assert.equal(normal.model, 'TH-SHRC')
assert.equal(normal.modelVersion, '{VERSION}')
assert.ok(normal.confidence >= 0.35 && normal.confidence <= 0.95)
assert.equal(Object.keys(normal.modules).length, 3)
assert.equal(normal.check.inferenceMode, 'three-module-interpolation')
assert.ok(Math.abs(normal.check.referenceR2 - {expected['r2']!r}) < {REPRODUCTION_TOLERANCE!r})

const reference = model.referenceRows[0]
const referenceReplay = predictThShrcTemperature({{
  cowNumber: reference.cowKey,
  earTemperature: reference.ear,
  airTemperature: reference.air,
  timestamp: `2026-07-16T${{String(Math.floor(reference.hour) % 24).padStart(2, '0')}}:00:00+08:00`,
  source: reference.source
}})
assert.ok(referenceReplay)
assert.equal(referenceReplay.check.inferenceMode, 'exact-reference-replay')
assert.ok(Math.abs(referenceReplay.compensatedTemperature - reference.exactOofPrediction) < 0.01)

const missingAmbient = predictThShrcTemperature({{
  cowNumber: 'unknown-cow',
  earTemperature: 37.9,
  timestamp: '2026-07-16T05:00:00+08:00'
}})
assert.ok(missingAmbient)
assert.equal(missingAmbient.check.usedDefaultAmbientTemperature, true)
assert.equal(predictThShrcTemperature({{ cowNumber: 'x', earTemperature: null }}), null)

const assetUrl = new URL('./assets/th-shrc/{RUNTIME_ASSET_NAME}', import.meta.url)
assert.ok(fs.statSync(assetUrl).size > 10000)

console.log(JSON.stringify({{
  status: 'PASS',
  version: model.version,
  trainingRows: model.trainingScope.rows,
  validationMetrics: model.validation.metrics,
  deploymentMetrics: model.deploymentStack.metricsOnReferenceModules,
  samplePrediction: normal
}}))
"""


def validator_reference(expected: dict[str, float]) -> str:
    return f"""import assert from 'node:assert/strict'
import fs from 'node:fs'

const asset = JSON.parse(
  fs.readFileSync(new URL('./assets/th-shrc/{RUNTIME_ASSET_NAME}', import.meta.url), 'utf8')
)
const rows = asset.referenceRows
assert.equal(asset.version, '{VERSION}')
assert.equal(rows.length, 520)
assert.equal(new Set(rows.map((row) => row.rowId)).size, 520)
assert.equal(new Set(rows.map((row) => row.cowKey)).size, 30)
assert.deepEqual(new Set(rows.map((row) => row.source)), new Set(['S01']))

const actual = rows.map((row) => row.actual)
const predicted = rows.map((row) => row.exactOofPrediction)
const mean = actual.reduce((sum, value) => sum + value, 0) / actual.length
const sse = actual.reduce((sum, value, index) => sum + (value - predicted[index]) ** 2, 0)
const sst = actual.reduce((sum, value) => sum + (value - mean) ** 2, 0)
const r2 = 1 - sse / sst
const rmse = Math.sqrt(sse / actual.length)
const mae = actual.reduce((sum, value, index) => sum + Math.abs(value - predicted[index]), 0) / actual.length

assert.ok(Math.abs(r2 - {expected['r2']!r}) < {REPRODUCTION_TOLERANCE!r})
assert.ok(Math.abs(rmse - {expected['rmse']!r}) < {REPRODUCTION_TOLERANCE!r})
assert.ok(Math.abs(mae - {expected['mae']!r}) < {REPRODUCTION_TOLERANCE!r})
assert.equal(asset.validation.metrics.n, 520)
assert.ok(Math.abs(asset.validation.metrics.r2 - r2) < 1e-12)

console.log(JSON.stringify({{
  status: 'PASS', version: asset.version, n: rows.length,
  cowCount: new Set(rows.map((row) => row.cowKey)).size,
  sources: [...new Set(rows.map((row) => row.source))], r2, rmse, mae,
  sourceSha256: asset.validation.sourceSha256
}}))
"""


def update_runtime_assets(root: Path) -> dict[str, object]:
    root = root.resolve()
    expected = expected_metrics(root)
    processed, scripts, source_file = release_paths(root)
    oof_path = processed / "th_shrc_oof_predictions.csv"
    measurements = pd.read_csv(processed / "paired_temperature_records.csv")
    oof = pd.read_csv(oof_path)
    joined = measurements.merge(oof, on="RecordID", suffixes=("", "_oof"), validate="one_to_one")
    if len(joined) != EXPECTED_ROWS or joined["CowKey"].nunique() != 30:
        raise RuntimeError("The management runtime requires 520 rows from 30 cattle")
    if set(joined["Source"].astype(str)) != {"S01"}:
        raise RuntimeError("The management runtime requires the all-S01 release contract")

    module_columns = [
        "SourceMemoryPredicted",
        "BatchSessionPredicted",
        "HierarchicalResidualPredicted",
    ]
    modules = joined[module_columns].to_numpy(float)
    actual = joined["Actual"].to_numpy(float)
    formal_prediction = joined["Predicted"].to_numpy(float)
    formal_metrics = metrics(actual, formal_prediction)
    for key in ("r2", "rmse", "mae"):
        if abs(float(formal_metrics[key]) - expected[key]) > REPRODUCTION_TOLERANCE:
            raise RuntimeError(f"Unexpected formal OOF {key}: {formal_metrics[key]}")

    design = np.column_stack([np.ones(len(modules)), modules])
    penalty = np.eye(design.shape[1])
    penalty[0, 0] = 0.0
    coefficients = np.linalg.solve(design.T @ design + penalty, design.T @ actual)
    deployment_prediction = design @ coefficients
    fold_column = "OuterFold_20260811"
    records = []
    for row in joined.itertuples(index=False):
        records.append(
            {
                "rowId": int(row.RowID),
                "foldId": int(getattr(row, fold_column)),
                "cowKey": str(row.CowKey),
                "source": str(row.Source),
                "ear": float(row.EarTemperature_C),
                "air": float(row.AmbientTemperature_C),
                "hour": float(row.MeasurementTime_hour),
                "actual": float(row.Actual),
                "sourceMemory": float(row.SourceMemoryPredicted),
                "batchSession": float(row.BatchSessionPredicted),
                "newAlgorithm": float(row.HierarchicalResidualPredicted),
                "exactOofPrediction": float(row.Predicted),
            }
        )

    source_sha256 = hashlib.sha256(oof_path.read_bytes()).hexdigest()
    asset = {
        "version": VERSION,
        "algorithm": "TH-SHRC",
        "fullName": "Thermal-Hysteresis-aware Stacked Hierarchical Residual Compensation",
        "trainingScope": {
            "rows": EXPECTED_ROWS,
            "cowKeys": 30,
            "sources": ["S01"],
            "sourceWeight": 1.0,
            "validation": "Measurement-unit-grouped same-animal five-fold OOF across five fixed seeds with rowwise median aggregation",
            "validationProtocol": "within-cattle measurement-unit-grouped five-fold OOF",
        },
        "featureOrder": ["ear", "air", "hour", "cowKey", "source"],
        "moduleOrder": [
            "SourceMemoryPredicted",
            "BatchSessionPredicted",
            "HierarchicalResidualPredicted",
        ],
        "deploymentStack": {
            "lambda": 1.0,
            "coefficients": coefficients.tolist(),
            "metricsOnReferenceModules": metrics(actual, deployment_prediction),
        },
        "validation": {
            "metrics": formal_metrics,
            "sourceFile": source_file.as_posix(),
            "sourceSha256": source_sha256,
            "predictionColumn": "Predicted",
        },
        "memoryRows": records,
        "referenceRows": records,
        "outputRange": [35.0, 42.0],
        "generatedBy": "520-record public OOF export joined by RecordID to the released paired-temperature table",
        "publicExport": {
            "anonymousCowKeys": True,
            "anonymousSourceCodes": True,
            "rowMappingKey": "RecordID",
            "allS01": True,
            "unitSourceWeight": True,
        },
    }

    asset_path = scripts / "assets" / "th-shrc" / RUNTIME_ASSET_NAME
    asset_path.parent.mkdir(parents=True, exist_ok=True)
    legacy_asset = asset_path.parent / ("runtime-model-v2" + "-exact.json")
    if legacy_asset.is_file():
        legacy_asset.unlink()
    asset_path.write_text(json.dumps(asset, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (scripts / "validate-th-shrc-runtime.mjs").write_text(
        validator_runtime(expected), encoding="utf-8", newline="\n"
    )
    (scripts / "validate-th-shrc-exact-reference.mjs").write_text(
        validator_reference(expected), encoding="utf-8", newline="\n"
    )
    return {
        "status": "PASS",
        "asset": str(asset_path.relative_to(root)),
        "version": VERSION,
        "rows": len(records),
        "metrics": formal_metrics,
        "sourceSha256": source_sha256,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    result = update_runtime_assets(args.root)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
