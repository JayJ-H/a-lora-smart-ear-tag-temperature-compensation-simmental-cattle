import * as databaseService from '@/services/数据库'

export interface V2ExportPeriodInput {
  periodType: string
  startAt?: string
  endAt?: string
  parityNo?: number | string
  lactationNo?: number | string
  cycleNo?: number | string
  customWindowCode?: string
}

export interface V2ExportScopeInput {
  scopeType: string
  scopeValue: string | number
}

export interface V2ExportRunInput {
  scopeCode: string
  scopeName: string
  scopeDomain: string
  sourceType: string
  fileName: string
  fileFormat: string
  rowCount: number
  checksum?: string
  fileSize?: number
  filePath?: string
  operatorName?: string
  startedAt?: string
  finishedAt?: string
  parameters?: Record<string, unknown>
  resultSnapshot?: Record<string, unknown>
  periods?: V2ExportPeriodInput[]
  scopes?: V2ExportScopeInput[]
  selectableFilters?: unknown
  selectableVariables?: unknown
  defaultPeriods?: unknown
}

export interface V2ExportRunResult {
  scopeId: string
  reportRunId: string
  exportFileId: string
  exportCode: string
  checksum: string
}

export interface V2ExportScopeDefinitionInput {
  scopeCode: string
  scopeName: string
  scopeDomain: string
  selectableFilters?: unknown
  selectableVariables?: unknown
  defaultPeriods?: unknown
  parameters?: Record<string, unknown>
  periods?: V2ExportPeriodInput[]
}

const EXPORT_SCOPE_TABLE = 'export_scope_definition'
const REPORT_RUN_TABLE = 'report_run'
const REPORT_RUN_ITEM_TABLE = 'report_run_item'
const REPORT_PERIOD_FILTER_TABLE = 'report_period_filter'
const REPORT_DATA_SCOPE_TABLE = 'report_data_scope'
const EXPORT_FILE_TABLE = 'export_file'
const OPERATION_AUDIT_TABLE = 'operation_audit_log'

function nowIso() {
  return new Date().toISOString()
}

function randomSuffix() {
  const cryptoObj = globalThis.crypto
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID().replace(/-/g, '').slice(0, 10)
  return Math.random().toString(36).slice(2, 12)
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${randomSuffix()}`.slice(0, 64)
}

function stableHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function compactCode(value: string) {
  const raw = String(value || 'export').trim() || 'export'
  const compact = raw
    .trim()
    .replace(/[^\w-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (compact && compact === raw) return compact.slice(0, 48)

  const suffix = `h${stableHash(raw)}`
  const prefix = compact || 'export'
  return `${prefix.slice(0, Math.max(1, 47 - suffix.length))}_${suffix}`.slice(0, 48)
}

function normalizeDateTime(value?: string) {
  return value || null
}

function normalizeInt(value?: number | string) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null
}

function clampScopeValue(value: string | number) {
  return String(value ?? '').slice(0, 128)
}

function scopeDomainOf(row: any) {
  return String(row?.scopeDomain ?? row?.scope_domain ?? '')
}

function rowTimestamp(row: any) {
  const raw = row?.updatedAt ?? row?.updated_at ?? row?.createdAt ?? row?.created_at
  const time = raw ? new Date(raw).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function isSameNamedScope(row: any, name: string, domain: string) {
  return (
    String(row?.name || '') === String(name || '') && scopeDomainOf(row) === String(domain || '')
  )
}

function pickCanonicalScope(rows: any[], code: string, name: string, domain: string) {
  const candidates = rows.filter(
    (row: any) =>
      String(row.code || '').toLowerCase() === code.toLowerCase() ||
      isSameNamedScope(row, name, domain)
  )
  return candidates.sort((left: any, right: any) => {
    const leftExact = String(left.code || '').toLowerCase() === code.toLowerCase() ? 1 : 0
    const rightExact = String(right.code || '').toLowerCase() === code.toLowerCase() ? 1 : 0
    if (leftExact !== rightExact) return rightExact - leftExact
    const leftActive = String(left.status || 'active') === 'active' ? 1 : 0
    const rightActive = String(right.status || 'active') === 'active' ? 1 : 0
    if (leftActive !== rightActive) return rightActive - leftActive
    return rowTimestamp(right) - rowTimestamp(left)
  })[0]
}

async function hashText(value: string) {
  const encoded = new TextEncoder().encode(value)
  if (globalThis.crypto?.subtle) {
    const buffer = await globalThis.crypto.subtle.digest('SHA-256', encoded)
    return Array.from(new Uint8Array(buffer))
      .map((item) => item.toString(16).padStart(2, '0'))
      .join('')
  }
  let hash = 0
  encoded.forEach((byte) => {
    hash = (Math.imul(31, hash) + byte) | 0
  })
  return `fallback-${Math.abs(hash).toString(16)}`
}

async function upsertRow(tableName: string, row: Record<string, unknown>) {
  const rows = await databaseService.getTableDataAsync(tableName, { silent: true })
  const existing = rows.find((item: any) => String(item.id || '') === String(row.id || ''))
  if (existing?.id) {
    await databaseService.updateTableRecordAsync(tableName, String(existing.id), row)
    return
  }
  await databaseService.addTableDataAsync(tableName, row)
}

async function repointScopeReferences(fromScopeId: string, toScopeId: string) {
  for (const tableName of [REPORT_PERIOD_FILTER_TABLE, REPORT_DATA_SCOPE_TABLE]) {
    const rows = await databaseService.getTableDataAsync(tableName, { silent: true })
    const referenced = rows.filter(
      (row: any) => String(row.exportScopeId ?? row.export_scope_id ?? '') === fromScopeId
    )
    for (const row of referenced) {
      await databaseService.updateTableRecordAsync(tableName, String(row.id), {
        export_scope_id: toScopeId
      })
    }
  }
}

async function removeDuplicateScopes(
  canonicalId: string,
  code: string,
  name: string,
  domain: string
) {
  const rows = await databaseService.getTableDataAsync(EXPORT_SCOPE_TABLE, { silent: true })
  const duplicates = rows.filter(
    (row: any) =>
      String(row.id || '') !== canonicalId &&
      (String(row.code || '').toLowerCase() === code.toLowerCase() ||
        isSameNamedScope(row, name, domain))
  )

  for (const duplicate of duplicates) {
    const duplicateId = String(duplicate.id || '')
    if (!duplicateId) continue
    await repointScopeReferences(duplicateId, canonicalId)
    await databaseService.deleteTableRecordAsync(EXPORT_SCOPE_TABLE, duplicateId)
  }
}

export async function upsertExportScopeDefinition(
  input: V2ExportScopeDefinitionInput,
  timestamp: string = nowIso()
) {
  const code = compactCode(input.scopeCode)
  const rows = await databaseService.getTableDataAsync(EXPORT_SCOPE_TABLE, { silent: true })
  const existing = pickCanonicalScope(rows, code, input.scopeName, input.scopeDomain)
  const id = String(existing?.id || `scope_${code}`.slice(0, 64))
  const payload = {
    id,
    code,
    name: input.scopeName,
    scope_domain: input.scopeDomain,
    selectable_filters: input.selectableFilters ?? input.parameters ?? {},
    selectable_variables: input.selectableVariables ?? [],
    default_periods: input.defaultPeriods ?? input.periods ?? [],
    status: 'active',
    created_at: existing?.createdAt || existing?.created_at || timestamp,
    updated_at: timestamp
  }

  if (existing?.id) {
    await databaseService.updateTableRecordAsync(EXPORT_SCOPE_TABLE, String(existing.id), payload)
  } else {
    await databaseService.addTableDataAsync(EXPORT_SCOPE_TABLE, payload)
  }
  await removeDuplicateScopes(id, code, input.scopeName, input.scopeDomain)
  return id
}

function periodPayloads(
  reportRunId: string,
  exportScopeId: string,
  input: V2ExportRunInput,
  timestamp: string
) {
  const periods = input.periods?.length ? input.periods : [{ periodType: 'all' }]

  return periods.map((period) => ({
    id: makeId('period'),
    report_run_id: reportRunId,
    export_scope_id: exportScopeId,
    period_type: period.periodType || 'all',
    start_at: normalizeDateTime(period.startAt),
    end_at: normalizeDateTime(period.endAt),
    parity_no: normalizeInt(period.parityNo),
    lactation_no: normalizeInt(period.lactationNo),
    cycle_no: normalizeInt(period.cycleNo),
    custom_window_code: period.customWindowCode || null,
    created_at: timestamp,
    updated_at: timestamp
  }))
}

function scopePayloads(
  reportRunId: string,
  exportScopeId: string,
  input: V2ExportRunInput,
  timestamp: string
) {
  const scopes = input.scopes?.length
    ? input.scopes
    : [{ scopeType: 'domain', scopeValue: input.scopeDomain }]

  return scopes
    .filter(
      (scope) =>
        scope.scopeType &&
        scope.scopeValue !== undefined &&
        scope.scopeValue !== null &&
        scope.scopeValue !== ''
    )
    .slice(0, 300)
    .map((scope) => ({
      id: makeId('scope_value'),
      report_run_id: reportRunId,
      export_scope_id: exportScopeId,
      scope_type: scope.scopeType,
      scope_value: clampScopeValue(scope.scopeValue),
      created_at: timestamp,
      updated_at: timestamp
    }))
}

export async function recordV2ExportRun(input: V2ExportRunInput): Promise<V2ExportRunResult> {
  const startedAt = input.startedAt || nowIso()
  const finishedAt = input.finishedAt || nowIso()
  const codeBase = compactCode(input.sourceType || input.scopeCode)
  const exportCode = `${codeBase}_${Date.now().toString(36)}_${randomSuffix()}`.slice(0, 64)
  const checksum =
    input.checksum ||
    (await hashText(
      JSON.stringify({
        fileName: input.fileName,
        rowCount: input.rowCount,
        parameters: input.parameters,
        resultSnapshot: input.resultSnapshot
      })
    ))
  const scopeId = await upsertExportScopeDefinition(input, startedAt)
  const reportRunId = makeId('run')
  const exportFileId = makeId('file')
  const periods = periodPayloads(reportRunId, scopeId, input, startedAt)
  const firstPeriod = periods[0]

  await databaseService.addTableDataAsync(REPORT_RUN_TABLE, {
    id: reportRunId,
    template_id: null,
    run_code: `run_${exportCode}`.slice(0, 64),
    run_name: `${input.scopeName} ${input.fileFormat.toUpperCase()} export`,
    period_type: firstPeriod?.period_type || 'all',
    period_start: firstPeriod?.start_at,
    period_end: firstPeriod?.end_at,
    filters: input.parameters || {},
    operator_name: input.operatorName || 'current_user',
    run_status: 'completed',
    started_at: startedAt,
    finished_at: finishedAt,
    created_at: startedAt,
    updated_at: finishedAt
  })

  await databaseService.addTableDataAsync(REPORT_RUN_ITEM_TABLE, [
    {
      id: makeId('item'),
      run_id: reportRunId,
      metric_id: null,
      metric_code: 'row_count',
      metric_value: input.rowCount,
      metric_text: String(input.rowCount),
      value_json: { label: 'row_count', value: input.rowCount },
      created_at: startedAt,
      updated_at: finishedAt
    },
    {
      id: makeId('item'),
      run_id: reportRunId,
      metric_id: null,
      metric_code: 'file_size',
      metric_value: input.fileSize || 0,
      metric_text: String(input.fileSize || 0),
      value_json: { label: 'file_size', value: input.fileSize || 0 },
      created_at: startedAt,
      updated_at: finishedAt
    }
  ])

  await databaseService.addTableDataAsync(REPORT_PERIOD_FILTER_TABLE, periods)
  await databaseService.addTableDataAsync(
    REPORT_DATA_SCOPE_TABLE,
    scopePayloads(reportRunId, scopeId, input, startedAt)
  )

  await databaseService.addTableDataAsync(EXPORT_FILE_TABLE, {
    id: exportFileId,
    export_code: exportCode,
    source_type: input.sourceType,
    source_id: reportRunId,
    file_name: input.fileName,
    file_format: input.fileFormat,
    file_path: input.filePath || null,
    file_size: input.fileSize || 0,
    row_count: input.rowCount,
    checksum,
    exported_by: input.operatorName || 'current_user',
    exported_at: finishedAt,
    created_at: startedAt,
    updated_at: finishedAt
  })

  await upsertRow(OPERATION_AUDIT_TABLE, {
    id: makeId('audit'),
    action_type: 'export_data',
    target_type: EXPORT_FILE_TABLE,
    target_id: exportFileId,
    animal_id: null,
    operator_name: input.operatorName || 'current_user',
    operated_at: finishedAt,
    request_payload: input.parameters || {},
    result_payload: {
      ...(input.resultSnapshot || {}),
      reportRunId,
      exportFileId,
      exportCode,
      checksum
    },
    status: 'success',
    client_ip: null,
    created_at: startedAt,
    updated_at: finishedAt
  })

  return {
    scopeId,
    reportRunId,
    exportFileId,
    exportCode,
    checksum
  }
}

export function estimatePayloadSize(rows: unknown[]) {
  return new TextEncoder().encode(JSON.stringify(rows || [])).length
}
