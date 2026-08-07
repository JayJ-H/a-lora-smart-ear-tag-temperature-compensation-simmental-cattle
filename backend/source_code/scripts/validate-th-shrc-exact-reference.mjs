import assert from 'node:assert/strict'
import fs from 'node:fs'

const asset = JSON.parse(
  fs.readFileSync(new URL('./assets/th-shrc/runtime-model-v2-exact.json', import.meta.url), 'utf8')
)
const rows = asset.referenceRows
assert.equal(asset.version, 'th-shrc-runtime-v2-exact')
assert.equal(rows.length, 503)
assert.equal(new Set(rows.map((row) => row.rowId)).size, 503)
assert.equal(new Set(rows.map((row) => row.cowKey)).size, 30)

const actual = rows.map((row) => row.actual)
const predicted = rows.map((row) => row.exactOofPrediction)
const mean = actual.reduce((sum, value) => sum + value, 0) / actual.length
const sse = actual.reduce((sum, value, index) => sum + (value - predicted[index]) ** 2, 0)
const sst = actual.reduce((sum, value) => sum + (value - mean) ** 2, 0)
const r2 = 1 - sse / sst
const rmse = Math.sqrt(sse / actual.length)
const mae =
  actual.reduce((sum, value, index) => sum + Math.abs(value - predicted[index]), 0) / actual.length

assert.ok(Math.abs(r2 - 0.8551359051012453) < 1e-12)
assert.ok(Math.abs(rmse - 0.25195565941200593) < 1e-12)
assert.ok(Math.abs(mae - 0.1345534257161157) < 1e-12)
assert.equal(asset.validation.metrics.n, 503)
assert.ok(Math.abs(asset.validation.metrics.r2 - r2) < 1e-12)

console.log(
  JSON.stringify({
    status: 'PASS',
    version: asset.version,
    n: rows.length,
    cowCount: new Set(rows.map((row) => row.cowKey)).size,
    r2,
    rmse,
    mae,
    sourceSha256: asset.validation.sourceSha256
  })
)
