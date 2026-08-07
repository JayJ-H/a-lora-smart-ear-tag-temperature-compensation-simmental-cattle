export function formatDateOnly(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? localDatePart(value) : fallback
  }
  const raw = String(value).trim()
  if (!raw) return fallback
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (match) {
    return [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-')
  }
  const date = new Date(raw)
  return Number.isFinite(date.getTime()) ? localDatePart(date) : fallback
}

function localDatePart(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}
