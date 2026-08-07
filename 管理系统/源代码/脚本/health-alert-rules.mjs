export const THREE_POINT_HIGH_TEMPERATURE_THRESHOLD = 39.5
export const THREE_POINT_WINDOW_SIZE = 3
export const THREE_POINT_REQUIRED_HIGH_COUNT = 2

function finiteTemperature(point) {
  const value = Number(
    point?.temperature ?? point?.readingValue ?? point?.reading_value ?? point?.value
  )
  return Number.isFinite(value) ? value : null
}

/**
 * Readings must be ordered from oldest to newest. Invalid temperatures are
 * removed before the latest window is selected.
 */
export function evaluateTwoOfThreeHighTemperature(
  readings,
  {
    threshold = THREE_POINT_HIGH_TEMPERATURE_THRESHOLD,
    windowSize = THREE_POINT_WINDOW_SIZE,
    requiredHighCount = THREE_POINT_REQUIRED_HIGH_COUNT
  } = {}
) {
  const normalized = (Array.isArray(readings) ? readings : [])
    .map((point) => ({
      id: String(point?.id || ''),
      measuredAt: String(point?.measuredAt || point?.measured_at || point?.timestamp || ''),
      sourceMessageId: String(point?.sourceMessageId || point?.source_message_id || ''),
      temperature: finiteTemperature(point)
    }))
    .filter((point) => point.temperature !== null)

  const window = normalized.slice(-windowSize)
  const points = window.map((point, index) => ({
    ...point,
    position: index + 1,
    exceeded: point.temperature > threshold
  }))
  const evidence = points.filter((point) => point.exceeded)
  const highCount = evidence.length

  return {
    matched: points.length === windowSize && highCount >= requiredHighCount,
    threshold,
    windowSize,
    requiredHighCount,
    validPointCount: points.length,
    highCount,
    points,
    evidence
  }
}
