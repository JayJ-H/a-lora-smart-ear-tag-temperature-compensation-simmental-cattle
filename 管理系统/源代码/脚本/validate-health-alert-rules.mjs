import assert from 'node:assert/strict'
import {
  evaluateTwoOfThreeHighTemperature,
  THREE_POINT_HIGH_TEMPERATURE_THRESHOLD
} from './health-alert-rules.mjs'

const point = (temperature, id) => ({
  id,
  temperature,
  measuredAt: `2026-07-13 10:0${id}:00`
})

const cases = [
  { name: 'first two consecutive', values: [39.6, 39.7, 38.8], matched: true },
  { name: 'first and last', values: [39.6, 38.8, 39.7], matched: true },
  { name: 'last two consecutive', values: [38.8, 39.6, 39.7], matched: true },
  { name: 'only one high point', values: [39.6, 39.5, 38.8], matched: false },
  { name: 'equal threshold is not above', values: [39.5, 39.5, 39.6], matched: false },
  { name: 'fewer than three valid points', values: [39.6, 39.7], matched: false },
  { name: 'use latest three points', values: [40.1, 38.7, 39.6, 39.7], matched: true }
]

for (const testCase of cases) {
  const result = evaluateTwoOfThreeHighTemperature(
    testCase.values.map((temperature, index) => point(temperature, index + 1))
  )
  assert.equal(result.matched, testCase.matched, testCase.name)
}

const firstLast = evaluateTwoOfThreeHighTemperature([
  point(39.6, 1),
  point(38.8, 2),
  point(39.7, 3)
])
assert.deepEqual(
  firstLast.evidence.map((item) => item.position),
  [1, 3]
)
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

console.log(
  JSON.stringify(
    {
      ok: true,
      rule: 'two_of_three_temperature_points_above_39_5',
      threshold: THREE_POINT_HIGH_TEMPERATURE_THRESHOLD,
      cases: cases.length
    },
    null,
    2
  )
)
