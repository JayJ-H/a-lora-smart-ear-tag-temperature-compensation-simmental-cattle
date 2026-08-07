import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  predictThShrcTemperature,
  selectTemperatureForAlert
} from './th-shrc-runtime.mjs'

const prediction = predictThShrcTemperature({
  cowNumber: 'demo-cow',
  earTemperature: 38.9,
  airTemperature: 31,
  timestamp: '2026-07-16T17:00:00+08:00'
})

assert.ok(prediction)
assert.equal(
  selectTemperatureForAlert({
    rectalTemperature: 39.1,
    compensatedTemperature: prediction.compensatedTemperature,
    earTemperature: 38.9
  }),
  39.1
)
assert.equal(
  selectTemperatureForAlert({
    compensatedTemperature: prediction.compensatedTemperature,
    earTemperature: 38.9
  }),
  prediction.compensatedTemperature
)
assert.equal(selectTemperatureForAlert({ earTemperature: 38.9 }), 38.9)

const backend = fs.readFileSync('scripts/mysql-backend-server.mjs', 'utf8')
for (const requiredText of [
  "from './th-shrc-runtime.mjs'",
  'record.compensatedTemperature',
  "ensureMqttDevice('ear_temperature', 'C')",
  "ensureMqttDevice('body_temperature', 'C')",
  'selectTemperatureForAlert(record)',
  'TH-SHRC补偿体温'
]) {
  assert.ok(backend.includes(requiredText), `Missing backend integration marker: ${requiredText}`)
}

const dockerfile = fs.readFileSync('ops/production/Dockerfile.api', 'utf8')
assert.ok(dockerfile.includes('COPY scripts/th-shrc-runtime.mjs'))
assert.ok(dockerfile.includes('COPY scripts/assets/th-shrc'))

const compose = fs.readFileSync('ops/production/docker-compose.prod.yml', 'utf8')
assert.ok(compose.includes('TH_SHRC_ENABLED: ${TH_SHRC_ENABLED:-true}'))

const liveCheck = fs.readFileSync('scripts/check-th-shrc-live.mjs', 'utf8')
for (const requiredText of [
  "mqtt.connect(mqttUrl",
  "earTemperature",
  "compensatedTemperature",
  "metric_code = 'body_temperature'",
  "status: 'PASS'"
]) {
  assert.ok(liveCheck.includes(requiredText), `Missing live integration check marker: ${requiredText}`)
}

console.log(
  JSON.stringify({
    status: 'PASS',
    precedence: ['rectalTemperature', 'compensatedTemperature', 'earTemperature'],
    samplePrediction: prediction
  })
)
