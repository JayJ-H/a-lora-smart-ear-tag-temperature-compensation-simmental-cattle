export const THREE_POINT_HIGH_TEMPERATURE_THRESHOLD: 39.5
export const THREE_POINT_WINDOW_SIZE: 3
export const THREE_POINT_REQUIRED_HIGH_COUNT: 2

export interface TemperatureReadingInput {
  id?: string | number | null
  temperature?: unknown
  readingValue?: unknown
  reading_value?: unknown
  value?: unknown
  measuredAt?: string | number | null
  measured_at?: string | number | null
  timestamp?: string | number | null
  sourceMessageId?: string | number | null
  source_message_id?: string | number | null
}

export interface TemperatureAlertRuleOptions {
  threshold?: number
  windowSize?: number
  requiredHighCount?: number
}

export interface TemperatureAlertPoint {
  id: string
  measuredAt: string
  sourceMessageId: string
  temperature: number
  position: number
  exceeded: boolean
}

export interface TemperatureAlertEvaluation {
  matched: boolean
  threshold: number
  windowSize: number
  requiredHighCount: number
  validPointCount: number
  highCount: number
  points: TemperatureAlertPoint[]
  evidence: TemperatureAlertPoint[]
}

/**
 * Evaluates the latest valid readings from an oldest-to-newest input sequence.
 */
export function evaluateTwoOfThreeHighTemperature(
  readings: readonly TemperatureReadingInput[] | null | undefined,
  options?: TemperatureAlertRuleOptions
): TemperatureAlertEvaluation
