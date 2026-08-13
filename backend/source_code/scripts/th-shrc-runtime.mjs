import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_MODEL_PATH = path.join(__dirname, 'assets', 'th-shrc', 'runtime-model-v3-exact.json')

let cachedModel = null

function finiteNumber(value) {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function wallClockHour(timestamp) {
  if (typeof timestamp === 'string') {
    const match = timestamp.trim().match(/[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/)
    if (match) {
      const hour = Number(match[1]) % 24
      const minute = Number(match[2])
      if (Number.isFinite(hour) && Number.isFinite(minute) && minute >= 0 && minute < 60) {
        return hour + minute / 60
      }
    }
  }
  const date = timestamp ? new Date(timestamp) : new Date()
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
  return safeDate.getUTCHours() + safeDate.getUTCMinutes() / 60
}

export function loadThShrcModel(modelPath = process.env.TH_SHRC_MODEL_PATH || DEFAULT_MODEL_PATH) {
  if (cachedModel?.modelPath === modelPath) return cachedModel.model
  const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'))
  if (!Array.isArray(model.referenceRows) || !Array.isArray(model.deploymentStack?.coefficients)) {
    throw new Error(`Invalid TH-SHRC model asset: ${modelPath}`)
  }
  cachedModel = { modelPath, model }
  return model
}

function circularHourDifference(left, right) {
  const difference = Math.abs(Number(left) - Number(right))
  return Math.min(difference, 24 - difference)
}

function referenceDistance(input, row) {
  let distance = Math.sqrt(
    ((input.ear - Number(row.ear)) / 1.2) ** 2 +
      ((input.air - Number(row.air)) / 6) ** 2 +
      (circularHourDifference(input.hour, row.hour) / 4) ** 2
  )
  if (input.cowKey && input.cowKey === String(row.cowKey)) distance *= 0.55
  if (input.source && input.source === String(row.source)) distance *= 0.75
  return distance
}

function interpolateExactModules(model, input) {
  const candidates = model.referenceRows
    .map((row) => {
      return { distance: referenceDistance(input, row), row }
    })
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 18)

  const exactMatches = candidates.filter(
    ({ row }) =>
      input.cowKey === String(row.cowKey) &&
      input.source === String(row.source) &&
      Math.abs(input.ear - Number(row.ear)) < 1e-9 &&
      Math.abs(input.air - Number(row.air)) < 1e-9 &&
      circularHourDifference(input.hour, row.hour) < 1e-9
  )
  const selected = exactMatches.length > 0 ? exactMatches : candidates
  const weights = selected.map((entry) =>
    exactMatches.length > 0 ? 1 : 1 / Math.max(entry.distance, 0.04) ** 2
  )
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  const average = (field) =>
    selected.reduce((sum, entry, index) => sum + Number(entry.row[field]) * weights[index], 0) /
    weightTotal
  return {
    values: [average('sourceMemory'), average('batchSession'), average('newAlgorithm')],
    exactOofPrediction: exactMatches.length > 0 ? average('exactOofPrediction') : undefined,
    inferenceMode:
      exactMatches.length > 0 ? 'exact-reference-replay' : 'three-module-interpolation',
    nearestDistance: candidates[0]?.distance ?? null,
    neighborCount: selected.length,
    nearestRowId: candidates[0]?.row?.rowId ?? null
  }
}

function stackPrediction(model, modules) {
  const stack = model.deploymentStack?.coefficients || []
  return (
    Number(stack[0] || 0) +
    modules.reduce((sum, value, index) => sum + value * Number(stack[index + 1] || 0), 0)
  )
}

export function predictThShrcTemperature(
  { cowNumber = '', earTemperature, airTemperature, timestamp, source = 'mqtt-live' },
  model = loadThShrcModel()
) {
  const ear = finiteNumber(earTemperature)
  if (ear === undefined) return null
  const air = finiteNumber(airTemperature) ?? 25
  const hour = wallClockHour(timestamp)
  const input = { cowKey: String(cowNumber || ''), source: String(source || ''), ear, air, hour }
  const interpolation = interpolateExactModules(model, input)
  const modules = interpolation.values
  const rawPrediction = interpolation.exactOofPrediction ?? stackPrediction(model, modules)
  const [minimum, maximum] = model.outputRange || [35, 42]
  const compensatedTemperature = clamp(rawPrediction, Number(minimum), Number(maximum))
  const inEarRange = ear >= 25 && ear <= 42
  const inAirRange = air >= -10 && air <= 50
  const distancePenalty = Math.min(0.45, Number(interpolation.nearestDistance || 0) * 0.08)
  const confidence = clamp((inEarRange && inAirRange ? 0.92 : 0.72) - distancePenalty, 0.35, 0.95)

  return {
    compensatedTemperature: Number(compensatedTemperature.toFixed(2)),
    rawEarTemperature: ear,
    ambientTemperature: air,
    model: model.algorithm || 'TH-SHRC',
    modelVersion: model.version || 'unknown',
    confidence: Number(confidence.toFixed(3)),
    modules: {
      sourceMemory: Number(modules[0].toFixed(4)),
      batchSession: Number(modules[1].toFixed(4)),
      newAlgorithm: Number(modules[2].toFixed(4))
    },
    audit: {
      inferenceMode: interpolation.inferenceMode,
      nearestDistance:
        interpolation.nearestDistance === null
          ? null
          : Number(interpolation.nearestDistance.toFixed(4)),
      nearestRowId: interpolation.nearestRowId,
      neighborCount: interpolation.neighborCount,
      inputHour: Number(hour.toFixed(3)),
      usedDefaultAmbientTemperature: finiteNumber(airTemperature) === undefined,
      validationBoundary: model.trainingScope?.validation || '',
      referenceR2: Number(model.validation?.metrics?.r2),
      referenceRmse: Number(model.validation?.metrics?.rmse)
    }
  }
}

export function selectTemperatureForAlert({
  rectalTemperature,
  bodyTemperature,
  compensatedTemperature,
  earTemperature
} = {}) {
  return (
    finiteNumber(rectalTemperature) ??
    finiteNumber(bodyTemperature) ??
    finiteNumber(compensatedTemperature) ??
    finiteNumber(earTemperature)
  )
}
