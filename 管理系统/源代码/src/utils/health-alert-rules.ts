import {
  evaluateTwoOfThreeHighTemperature as evaluateSharedRule,
  THREE_POINT_HIGH_TEMPERATURE_THRESHOLD,
  THREE_POINT_REQUIRED_HIGH_COUNT,
  THREE_POINT_WINDOW_SIZE
} from '../../脚本/health-alert-rules.mjs'
import type {
  TemperatureAlertEvaluation,
  TemperatureAlertPoint,
  TemperatureAlertRuleOptions,
  TemperatureReadingInput
} from '../../脚本/health-alert-rules.mjs'

export {
  THREE_POINT_HIGH_TEMPERATURE_THRESHOLD,
  THREE_POINT_REQUIRED_HIGH_COUNT,
  THREE_POINT_WINDOW_SIZE
}
export type {
  TemperatureAlertEvaluation,
  TemperatureAlertPoint,
  TemperatureAlertRuleOptions,
  TemperatureReadingInput
}

export const CURRENT_TEMPERATURE_ALERT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface PersistedAlertVisibilityInput {
  isTemperatureAlert: boolean
  detectedAt?: string | number | null
  threshold?: number | null
  ruleCode?: string | null
  temperatureWindowSize?: number | null
}

export function shouldSurfaceCurrentPersistedAlert(
  alert: PersistedAlertVisibilityInput,
  now = Date.now()
): boolean {
  if (!alert.isTemperatureAlert) return true

  const threshold = Number(alert.threshold)
  const windowSize = Number(alert.temperatureWindowSize)
  const ruleCode = String(alert.ruleCode || '').trim()
  const usesObsoleteThreshold =
    !ruleCode &&
    (!Number.isFinite(windowSize) || windowSize <= 0) &&
    Number.isFinite(threshold) &&
    threshold < THREE_POINT_HIGH_TEMPERATURE_THRESHOLD
  if (usesObsoleteThreshold) return false

  const detectedAt =
    typeof alert.detectedAt === 'number'
      ? alert.detectedAt
      : Date.parse(String(alert.detectedAt || ''))
  return (
    Number.isFinite(detectedAt) &&
    detectedAt > 0 &&
    detectedAt <= now &&
    now - detectedAt <= CURRENT_TEMPERATURE_ALERT_MAX_AGE_MS
  )
}

/**
 * Input must be ordered by measurement time from oldest to newest.
 */
export function evaluateTwoOfThreeHighTemperature(
  readings: readonly TemperatureReadingInput[] | null | undefined,
  options?: TemperatureAlertRuleOptions
): TemperatureAlertEvaluation {
  return evaluateSharedRule(readings, options)
}
