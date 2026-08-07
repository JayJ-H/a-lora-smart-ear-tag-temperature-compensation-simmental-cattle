import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadThShrcModel, predictThShrcTemperature } from './th-shrc-runtime.mjs'

const model = loadThShrcModel()

assert.equal(model.version, 'th-shrc-runtime-v2-exact')
assert.equal(model.trainingScope?.rows, 503)
assert.equal(model.trainingScope?.cowKeys, 30)
assert.equal(model.memoryRows.length, 503)
assert.ok(Math.abs(Number(model.validation?.metrics?.r2) - 0.8551359051012453) < 1e-12)
assert.ok(Math.abs(Number(model.validation?.metrics?.rmse) - 0.25195565941200593) < 1e-12)

const normal = predictThShrcTemperature({
  cowNumber: 'demo-cow',
  earTemperature: 38.8,
  airTemperature: 28,
  timestamp: '2026-07-16T18:00:00+08:00'
})
assert.ok(normal)
assert.ok(Number.isFinite(normal.compensatedTemperature))
assert.equal(normal.rawEarTemperature, 38.8)
assert.equal(normal.model, 'TH-SHRC')
assert.equal(normal.modelVersion, 'th-shrc-runtime-v2-exact')
assert.ok(normal.confidence >= 0.35 && normal.confidence <= 0.95)
assert.equal(Object.keys(normal.modules).length, 3)
assert.equal(normal.audit.inferenceMode, 'three-module-interpolation')
assert.ok(Math.abs(normal.audit.referenceR2 - 0.8551359051012453) < 1e-12)

const reference = model.referenceRows[0]
const referenceReplay = predictThShrcTemperature({
  cowNumber: reference.cowKey,
  earTemperature: reference.ear,
  airTemperature: reference.air,
  timestamp: `2026-07-16T${String(Math.floor(reference.hour) % 24).padStart(2, '0')}:00:00+08:00`,
  source: reference.source
})
assert.ok(referenceReplay)
assert.equal(referenceReplay.audit.inferenceMode, 'exact-reference-replay')
assert.ok(Math.abs(referenceReplay.compensatedTemperature - reference.exactOofPrediction) < 0.01)

const missingAmbient = predictThShrcTemperature({
  cowNumber: 'unknown-cow',
  earTemperature: 37.9,
  timestamp: '2026-07-16T05:00:00+08:00'
})
assert.ok(missingAmbient)
assert.equal(missingAmbient.audit.usedDefaultAmbientTemperature, true)

assert.equal(predictThShrcTemperature({ cowNumber: 'x', earTemperature: null }), null)

const assetUrl = new URL('./assets/th-shrc/runtime-model-v2-exact.json', import.meta.url)
const assetBytes = fs.statSync(assetUrl).size
assert.ok(assetBytes > 10000)

console.log(
  JSON.stringify({
    status: 'PASS',
    version: model.version,
    trainingRows: model.trainingScope.rows,
    validationMetrics: model.validation.metrics,
    deploymentMetrics: model.deploymentStack.metricsOnReferenceModules,
    samplePrediction: normal,
    assetBytes
  })
)
