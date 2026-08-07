export interface DmuFieldMapping {
  key: string
  dmuName: string
  role: 'animalId' | 'trait' | 'fixed' | 'random'
}

export interface DmuDirForm {
  jobName: string
  model: string
  animalIdColumn: string
  traitColumns: string[]
  fixedEffects: string[]
  randomEffects: string[]
  fieldMappings?: DmuFieldMapping[]
  relationshipFileName: string
  dataFileName: string
  resultFileName: string
  missingValue: string
}

export interface DmuInputRow {
  animalId: string
  values: Record<string, number | string>
}

export interface DmuGeneratedFiles {
  dirFileName: string
  dataFileName: string
  dirText: string
  dataText: string
  executorConfigured: boolean
  message: string
}

export interface DmuResultRow {
  animalId: string
  trait: string
  value: number
  rank?: number
  raw: Record<string, string>
}

function dmuEnvValue(key: string) {
  const viteEnv = (import.meta as any)?.env || {}
  const processEnv =
    typeof process !== 'undefined' && (process as any)?.env ? (process as any).env : {}
  return viteEnv[key] || processEnv[key] || ''
}

export function isDmuExecutorConfigured() {
  return Boolean(dmuEnvValue('VITE_DMU_EXECUTOR_URL') || dmuEnvValue('VITE_DMU_EXECUTOR_PATH'))
}

export function buildDmuFiles(form: DmuDirForm, rows: DmuInputRow[]): DmuGeneratedFiles {
  const mappedColumns = normalizeDmuMappings(form)
  const traits = mappedColumns.filter((mapping) => mapping.role === 'trait')
  const fixed = mappedColumns.filter((mapping) => mapping.role === 'fixed')
  const random = mappedColumns.filter((mapping) => mapping.role === 'random')
  const dataFileName = form.dataFileName || `${safeName(form.jobName)}.dat`
  const dirFileName = `${safeName(form.jobName)}.DIR`
  const dataText = rows
    .map((row) => mappedColumns.map((mapping) => formatDmuValue(row.values[mapping.key], form.missingValue)).join(' '))
    .join('\n')
  const dirLines = [
    `$COMMENT ${form.jobName}`,
    `$DATA ${dataFileName}`,
    `$VARIABLES ${mappedColumns.map((mapping) => mapping.dmuName).join(' ')}`,
    `$MODEL ${form.model}`,
    `$TRAITS ${traits.map((mapping) => mapping.dmuName).join(' ')}`,
    `$FIXED ${fixed.map((mapping) => mapping.dmuName).join(' ') || 'none'}`,
    `$RANDOM ${random.map((mapping) => mapping.dmuName).join(' ') || 'animal'}`,
    `$RELATIONSHIP ${form.relationshipFileName || 'pedigree.rel'}`,
    `$MISSING ${form.missingValue || '-999'}`,
    `$RESULT ${form.resultFileName || `${safeName(form.jobName)}.SOL`}`
  ]
  const executorConfigured = isDmuExecutorConfigured()
  return {
    dirFileName,
    dataFileName,
    dirText: `${dirLines.join('\n')}\n`,
    dataText: `${dataText}\n`,
    executorConfigured,
    message: executorConfigured
      ? '已生成 DMU 输入文件，可交给已配置执行器运行。'
      : '未检测到 DMU 执行器配置；当前只生成 DIR/DAT 文件并支持结果导入。'
  }
}

function normalizeDmuMappings(form: DmuDirForm): DmuFieldMapping[] {
  if (form.fieldMappings?.length) {
    return dedupeMappings(
      form.fieldMappings
        .filter((mapping) => mapping.key && mapping.dmuName && mapping.role)
        .map((mapping) => ({
          ...mapping,
          dmuName: safeColumnName(mapping.dmuName)
        }))
    )
  }
  const animalName = safeColumnName(form.animalIdColumn || 'animal')
  return dedupeMappings([
    { key: 'animalId', dmuName: animalName, role: 'animalId' },
    ...form.fixedEffects.filter(Boolean).map((key) => ({
      key,
      dmuName: safeColumnName(key),
      role: 'fixed' as const
    })),
    ...form.randomEffects.filter(Boolean).map((key) => ({
      key,
      dmuName: safeColumnName(key),
      role: 'random' as const
    })),
    ...form.traitColumns.filter(Boolean).map((key) => ({
      key,
      dmuName: safeColumnName(key),
      role: 'trait' as const
    }))
  ])
}

function dedupeMappings(mappings: DmuFieldMapping[]) {
  const seen = new Set<string>()
  return mappings.filter((mapping) => {
    const key = `${mapping.role}:${mapping.dmuName}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parseDmuResult(text: string): DmuResultRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (!lines.length) return []
  const delimiter = lines[0].includes(',') ? ',' : /\s+/
  const headers = splitLine(lines[0], delimiter)
  const hasHeader = headers.some((header) => /animal|cow|trait|value|ebv|gebv|rank/i.test(header))
  const bodyLines = hasHeader ? lines.slice(1) : lines
  const normalizedHeaders = hasHeader ? headers : ['animalId', 'trait', 'value', 'rank']
  return bodyLines.map((line, index) => {
    const cells = splitLine(line, delimiter)
    const raw = normalizedHeaders.reduce<Record<string, string>>((result, header, cellIndex) => {
      result[header] = cells[cellIndex] || ''
      return result
    }, {})
    const animalId = firstText(
      raw.animalId,
      raw.animal_id,
      raw.cowId,
      raw.cow_id,
      raw.cowNumber,
      raw.cow_number,
      cells[0]
    )
    const trait = firstText(raw.trait, raw.traitCode, raw.trait_code, cells[1], 'trait')
    const value = Number(firstText(raw.value, raw.ebv, raw.gebv, raw.solution, cells[2], '0'))
    const rank = Number(firstText(raw.rank, cells[3], String(index + 1)))
    return {
      animalId,
      trait,
      value: Number.isFinite(value) ? value : 0,
      rank: Number.isFinite(rank) ? rank : undefined,
      raw
    }
  })
}

function splitLine(line: string, delimiter: ',' | RegExp) {
  return line
    .split(delimiter)
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '')
}

function safeName(value: string) {
  return (value || 'dmu_job').replace(/[^a-zA-Z0-9_-]+/g, '_')
}

function safeColumnName(value: string) {
  return (value || 'field').replace(/[^a-zA-Z0-9_]+/g, '_')
}

function formatDmuValue(value: number | string | undefined, missingValue: string) {
  if (value === undefined || value === null || value === '') return missingValue || '-999'
  return String(value)
}

function firstText(...values: unknown[]) {
  return values.map((value) => String(value ?? '').trim()).find(Boolean) || ''
}
