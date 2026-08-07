import assert from 'node:assert/strict'
import { evaluateTwoOfThreeHighTemperature as evaluateNodeRule } from './health-alert-rules.mjs'
import {
  CURRENT_TEMPERATURE_ALERT_MAX_AGE_MS,
  evaluateTwoOfThreeHighTemperature as evaluateFrontendRule,
  shouldSurfaceCurrentPersistedAlert,
  THREE_POINT_HIGH_TEMPERATURE_THRESHOLD
} from '../src/utils/health-alert-rules'

const cases = [
  {
    name: 'first and last high points',
    readings: [
      { id: 1, temperature: 39.6, measuredAt: '2026-07-13 10:01:00' },
      { id: 2, temperature: 38.8, measuredAt: '2026-07-13 10:02:00' },
      { id: 3, temperature: 39.7, measuredAt: '2026-07-13 10:03:00' }
    ],
    matched: true
  },
  {
    name: 'latest three valid points with field aliases',
    readings: [
      { id: 1, temperature: 40.1, measuredAt: '2026-07-13 10:01:00' },
      { id: 2, temperature: 'invalid', measuredAt: '2026-07-13 10:02:00' },
      { id: 3, readingValue: 38.8, measured_at: '2026-07-13 10:03:00' },
      { id: 4, reading_value: '39.6', timestamp: '2026-07-13 10:04:00' },
      { id: 5, value: 39.7, measuredAt: '2026-07-13 10:05:00' }
    ],
    matched: true
  },
  {
    name: 'equal threshold does not count',
    readings: [{ temperature: 39.5 }, { temperature: 39.5 }, { temperature: 39.6 }],
    matched: false
  }
] as const

for (const testCase of cases) {
  const frontendResult = evaluateFrontendRule(testCase.readings)
  const nodeResult = evaluateNodeRule(testCase.readings)

  assert.deepEqual(frontendResult, nodeResult, `${testCase.name}: frontend and Node results differ`)
  assert.equal(frontendResult.matched, testCase.matched, testCase.name)
}

const firstLast = evaluateFrontendRule(cases[0].readings)
assert.deepEqual(
  firstLast.evidence.map(({ position, temperature, measuredAt }) => ({
    position,
    temperature,
    measuredAt
  })),
  [
    { position: 1, temperature: 39.6, measuredAt: '2026-07-13 10:01:00' },
    { position: 3, temperature: 39.7, measuredAt: '2026-07-13 10:03:00' }
  ]
)
assert.equal(firstLast.threshold, THREE_POINT_HIGH_TEMPERATURE_THRESHOLD)

const policyNow = Date.parse('2026-07-13T12:00:00.000Z')
const policyCases = [
  {
    name: 'legacy 39.2 threshold is not current',
    alert: {
      isTemperatureAlert: true,
      detectedAt: policyNow - 60_000,
      threshold: 39.2,
      temperatureWindowSize: 0
    },
    visible: false
  },
  {
    name: 'recent three-point alert is current',
    alert: {
      isTemperatureAlert: true,
      detectedAt: policyNow - 60_000,
      threshold: 39.5,
      ruleCode: 'temperature_two_of_three_above_39_5',
      temperatureWindowSize: 3
    },
    visible: true
  },
  {
    name: 'recent critical single-point alert is current',
    alert: {
      isTemperatureAlert: true,
      detectedAt: policyNow - 60_000,
      threshold: 40,
      ruleCode: 'temperature_single_point_threshold',
      temperatureWindowSize: 0
    },
    visible: true
  },
  {
    name: 'stale temperature alert is not current',
    alert: {
      isTemperatureAlert: true,
      detectedAt: policyNow - CURRENT_TEMPERATURE_ALERT_MAX_AGE_MS - 1,
      threshold: 40,
      ruleCode: 'temperature_single_point_threshold'
    },
    visible: false
  },
  {
    name: 'stale non-temperature alert stays in the operational queue',
    alert: {
      isTemperatureAlert: false,
      detectedAt: policyNow - CURRENT_TEMPERATURE_ALERT_MAX_AGE_MS - 1
    },
    visible: true
  },
  {
    name: 'future temperature alert is rejected',
    alert: {
      isTemperatureAlert: true,
      detectedAt: policyNow + 1,
      threshold: 40
    },
    visible: false
  }
] as const

for (const testCase of policyCases) {
  assert.equal(
    shouldSurfaceCurrentPersistedAlert(testCase.alert, policyNow),
    testCase.visible,
    testCase.name
  )
}

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: 'frontend_delegates_to_node_health_alert_rule',
      parityCases: cases.length,
      persistedAlertPolicyCases: policyCases.length
    },
    null,
    2
  )
)
