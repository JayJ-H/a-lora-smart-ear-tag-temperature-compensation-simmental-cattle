import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
if (process.env.AUDIT_SKIP_PRODUCTION_ENV !== '1') {
  dotenv.config({ path: path.join(projectRoot, 'ops/production/.env.prod'), override: true, quiet: true })
}

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management',
  connectionLimit: Number(process.env.MYSQL_POOL_LIMIT || 10)
}

const QUERY_TIMEOUT_MS = Number(process.env.RELATIONSHIP_AUDIT_QUERY_TIMEOUT_MS || 30_000)
const FINDING_DETAIL_LIMIT = Number(process.env.RELATIONSHIP_AUDIT_FINDING_DETAIL_LIMIT || 8)
const MAX_COMPLEX_TRACE_ROWS = Number(process.env.RELATIONSHIP_AUDIT_MAX_COMPLEX_TRACE_ROWS || 20_000)
const SOURCE_RECORD_CHUNK_SIZE = Number(process.env.RELATIONSHIP_AUDIT_SOURCE_RECORD_CHUNK_SIZE || 1000)
const LARGE_SOURCE_RECORD_THRESHOLD = Number(process.env.RELATIONSHIP_AUDIT_LARGE_SOURCE_RECORD_THRESHOLD || 200)
const PROGRESS_LOG = process.env.RELATIONSHIP_AUDIT_PROGRESS === '1'
let querySequence = 0

const BUSINESS_TABLES = [
  'cows',
  'sensors',
  'events',
  'milk_records',
  'lactation_curves',
  'feed_records',
  'feed_formulas',
  'feed_inventory',
  'breeding_records',
  'reproduction_cycles',
  'alerts',
  'workflow_instances',
  'automated_actions',
  'smart_transfer_rules',
  'reminder_rules',
  'kpi_dashboard_data',
  'economic_analysis',
  'cost_items',
  'revenue_items',
  'budget_plans',
  'omics_samples',
  'omics_datasets',
  'omics_markers',
  'multi_omics_associations',
  'breeding_analyses',
  'phenotype_records',
  'omics_module_runs',
  'omics_workflow_runs',
  'omics_analysis_artifacts',
  'predictive_models',
  'prediction_results',
  'forecast_scenarios',
  'predictive_alerts',
  'sensor_status',
  'data_quality_checks',
  'sensor_calibrations',
  'hardware_devices',
  'integration_protocols',
  'data_synchronizations',
  'hardware_alerts',
  'device_maintenance',
  'integration_dashboards',
  'entry_events',
  'transfer_events',
  'exit_events',
  'export_audit_logs',
  'hardware_command_logs',
  'breeding_decision_runs',
  'operation_audit_logs',
  'breeding_events',
  'veterinary_events',
  'health_scores',
  'kpi_data',
  'economic_data'
]

const DIRECT_COW_ID_TABLES = new Set([
  'sensors',
  'milk_records',
  'lactation_curves',
  'breeding_records',
  'reproduction_cycles',
  'alerts',
  'phenotype_records'
])

const DIRECT_COW_NUMBER_TABLES = new Set([
  'entry_events',
  'transfer_events',
  'exit_events',
  'breeding_events',
  'veterinary_events'
])

const CONFIG_TABLES = new Set([
  'automated_actions',
  'smart_transfer_rules',
  'reminder_rules',
  'workflow_templates',
  'predictive_models',
  'feed_formulas',
  'feed_inventory',
  'milk_quality_standards',
  'pens',
  'persons',
  'diseases',
  'medicines',
  'transfer_reasons',
  'breed_types',
  'base_info_categories',
  'custom_fields',
  'import_configs',
  'export_configs',
  'phenotype_trait_definitions',
  'phenotype_export_methods',
  'logical_trait_rules'
])

const MODEL_CONVERGENCE_TABLES = [
  'animal',
  'cows',
  'milk_measurement',
  'milk_records',
  'sensor_reading',
  'sensor_readings',
  'operation_audit_log',
  'operation_audit_logs'
]

const REQUIRED_CANONICAL_TABLES = new Set(['animal', 'milk_measurement', 'sensor_reading', 'operation_audit_log'])
const COMPATIBILITY_TABLES = new Set(['cows', 'milk_records', 'sensor_readings', 'operation_audit_logs'])

const CATEGORY_LABELS = {
  animal_master: '动物主档',
  milk: '奶量',
  sensor: '传感器',
  audit: '审计',
  collation: 'collation',
  other: '其他'
}

const CATEGORY_ORDER = ['animal_master', 'milk', 'sensor', 'audit', 'collation', 'other']

const RELATIONSHIP_JSON_COLUMNS = [
  'payload',
  'feed_quality',
  'raw_payload',
  'metadata_json',
  'phenotype_links',
  'quality_metrics',
  'tags',
  'selection_index',
  'top_candidates',
  'parameters',
  'parameters_json',
  'metrics',
  'tables_json',
  'charts_json',
  'method_notes',
  'input_summary',
  'artifacts',
  'repository_ids',
  'module_ids',
  'module_run_ids',
  'factors',
  'impact_json',
  'recommendations',
  'training_data',
  'assumptions',
  'results',
  'budget_items',
  'layout_json',
  'devices',
  'alerts',
  'sync_status',
  'system_health',
  'data_flow',
  'filters_json',
  'result_snapshot',
  'command_payload',
  'ack_payload',
  'request_payload',
  'result_payload',
  'relation_scope',
  'source_record_ids',
  'cow_ids',
  'parts_used',
  'configuration_json',
  'location_json',
  'endpoints',
  'supported_devices',
  'configuration_json',
  'affected_systems',
  'recommended_actions'
]

const HEAVY_JSON_COLUMNS = new Set([
  'payload',
  'raw_payload',
  'tables_json',
  'charts_json',
  'artifacts',
  'result_snapshot',
  'request_payload',
  'result_payload'
])

const AUDIT_TEXT_COLLATION = 'utf8mb4_unicode_ci'

const FORCE_COMPLEX_TRACE_TABLES = new Set([
  'omics_datasets',
  'omics_markers',
  'multi_omics_associations',
  'breeding_analyses',
  'omics_module_runs',
  'omics_workflow_runs',
  'omics_analysis_artifacts',
  'cost_items',
  'revenue_items',
  'operation_audit_logs',
  'export_audit_logs',
  'hardware_command_logs',
  'breeding_decision_runs'
])

const COW_ID_KEYS = new Set([
  'cowid',
  'cow_id',
  'animalid',
  'animal_id',
  'sourcecowid',
  'source_cow_id',
  'targetcowid',
  'target_cow_id'
])

const COW_IDS_KEYS = new Set([
  'cowids',
  'cow_ids',
  'animalids',
  'animal_ids',
  'sourcecowids',
  'source_cow_ids',
  'targetcowids',
  'target_cow_ids',
  'affectedcowids',
  'affected_cow_ids'
])

const COW_NUMBER_KEYS = new Set([
  'cownumber',
  'cow_number',
  'sourcecownumber',
  'source_cow_number',
  'targetcownumber',
  'target_cow_number',
  'animalnumber',
  'animal_number'
])

const COW_NUMBERS_KEYS = new Set([
  'cownumbers',
  'cow_numbers',
  'sourcecownumbers',
  'source_cow_numbers',
  'targetcownumbers',
  'target_cow_numbers',
  'affectedcownumbers',
  'affected_cow_numbers'
])

const NON_ANIMAL_AUDIT_TARGET_TYPES = new Set([
  'auth_session',
  'auth',
  'login',
  'medicines',
  'medicine',
  'persons',
  'person',
  'base_info_categories',
  'base_info_category',
  'custom_fields',
  'custom_field',
  'import_configs',
  'import_config',
  'export_configs',
  'export_config',
  'phenotype_trait_definitions',
  'phenotype_trait_definition',
  'phenotype_export_methods',
  'phenotype_export_method',
  'logical_trait_rules',
  'logical_trait_rule',
  'permission',
  'role',
  'system',
  'config',
  'configuration'
])

const SYSTEM_TRACE_TARGET_TYPES = new Set([
  ...NON_ANIMAL_AUDIT_TARGET_TYPES,
  'hardware_devices',
  'hardware_device',
  'devices',
  'device',
  'gateway',
  'farm_unit',
  'pens',
  'pen',
  'trait_category',
  'trait_definition',
  'trait_observation_batch',
  'derivation_recompute_job',
  'milking_session',
  'time_period',
  'operation_audit_logs',
  'operation_audit_log',
  'export_audit_logs',
  'export_audit_log'
])

const LEGACY_UNRESOLVED_COW_TOKEN_PATTERN = /(?:cow_id|cow_number|animal_number)"?\s*:/i

function keyName(value) {
  return String(value || '').replace(/[\s-]/g, '_').toLowerCase()
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return value
  if (Buffer.isBuffer(value)) value = value.toString('utf8')
  if (typeof value !== 'string') return fallback
  const text = value.trim()
  if (!text) return fallback
  if (!['{', '['].includes(text[0])) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function unique(values) {
  return [
    ...new Set(
      values
        .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
        .map((value) => String(value).trim())
    )
  ]
}

function valuesFromMaybeArray(value) {
  if (Array.isArray(value)) return value.flatMap(valuesFromMaybeArray)
  if (value && typeof value === 'object') return []
  return value === undefined || value === null || value === '' ? [] : [String(value)]
}

function collectCowTokens(value, output = { ids: [], numbers: [] }) {
  if (value === null || value === undefined) return output
  const parsed = typeof value === 'string' ? parseJson(value, value) : value
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectCowTokens(item, output)
    return output
  }
  if (parsed && typeof parsed === 'object') {
    for (const [rawKey, rawValue] of Object.entries(parsed)) {
      const key = keyName(rawKey)
      if (COW_ID_KEYS.has(key)) output.ids.push(...valuesFromMaybeArray(rawValue))
      else if (COW_IDS_KEYS.has(key)) output.ids.push(...valuesFromMaybeArray(rawValue))
      else if (COW_NUMBER_KEYS.has(key)) output.numbers.push(...valuesFromMaybeArray(rawValue))
      else if (COW_NUMBERS_KEYS.has(key)) output.numbers.push(...valuesFromMaybeArray(rawValue))
      collectCowTokens(rawValue, output)
    }
  }
  return output
}

function arrayFromJsonColumn(row, column) {
  const value = row?.[column]
  if (Array.isArray(value)) return value
  const parsed = parseJson(value, [])
  return Array.isArray(parsed) ? parsed : []
}

function objectFromJsonColumn(row, column) {
  const value = row?.[column]
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  const parsed = parseJson(value, {})
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

function normalizeTableName(name) {
  return String(name || '')
    .trim()
    .replace(/-/g, '_')
    .replace(/[^\w]/g, '')
    .toLowerCase()
}

function quoteIdent(value) {
  const text = String(value || '')
  if (!/^[A-Za-z0-9_]+$/.test(text)) throw new Error(`Unsafe SQL identifier: ${text}`)
  return `\`${text}\``
}

function collatedText(sqlExpression) {
  return `CONVERT(${sqlExpression} USING utf8mb4) COLLATE ${AUDIT_TEXT_COLLATION}`
}

function textEquals(leftExpression, rightExpression) {
  return `${collatedText(leftExpression)} = ${collatedText(rightExpression)}`
}

function rowId(row) {
  return String(row?.id ?? row?.cow_number ?? row?.cow_id ?? '(no-id)')
}

function categorizeFinding(item) {
  if (item.category) return item.category
  const haystack = `${item.table || ''} ${item.item || ''} ${item.message || ''} ${item.detail || ''}`.toLowerCase()
  if (haystack.includes('collation')) return 'collation'
  if (haystack.includes('milk') || haystack.includes('奶') || haystack.includes('泌乳')) return 'milk'
  if (haystack.includes('sensor') || haystack.includes('device') || haystack.includes('传感')) return 'sensor'
  if (haystack.includes('audit') || haystack.includes('审计') || haystack.includes('operation_audit')) return 'audit'
  if (
    haystack.includes('animal') ||
    haystack.includes('cow') ||
    haystack.includes('cows') ||
    haystack.includes('牛') ||
    haystack.includes('主档')
  ) {
    return 'animal_master'
  }
  return 'other'
}

function summarizeFindingsByCategory(findings) {
  const summary = Object.fromEntries(
    CATEGORY_ORDER.map((category) => [
      category,
      {
        label: CATEGORY_LABELS[category],
        blockers: 0,
        warnings: 0,
        total: 0
      }
    ])
  )
  for (const item of findings) {
    const category = categorizeFinding(item)
    const occurrences = Number(item.occurrences || 1)
    if (!summary[category]) {
      summary[category] = { label: category, blockers: 0, warnings: 0, total: 0 }
    }
    summary[category].total += occurrences
    if (item.severity === 'blocker') summary[category].blockers += occurrences
    if (item.severity === 'warning') summary[category].warnings += occurrences
  }
  return summary
}

function pushFinding(findings, severity, table, id, message, evidence = {}, occurrences = 1) {
  const finding = {
    severity,
    table,
    id: String(id),
    message,
    occurrences: Number(occurrences || 1),
    evidence
  }
  finding.category = categorizeFinding(finding)
  findings.push(finding)
}

function compactSample(row) {
  const output = {}
  for (const [key, value] of Object.entries(row || {})) {
    if (value === undefined || value === null) {
      output[key] = value
      continue
    }
    if (typeof value === 'object') {
      output[key] = JSON.stringify(value).slice(0, 500)
      continue
    }
    output[key] = String(value).length > 500 ? `${String(value).slice(0, 500)}...` : value
  }
  return output
}

async function timed(timings, stage, fn) {
  const started = Date.now()
  try {
    return await fn()
  } finally {
    timings.push({ stage, elapsedMs: Date.now() - started })
  }
}

async function queryRows(db, sql, params = []) {
  const queryId = ++querySequence
  const started = Date.now()
  if (PROGRESS_LOG) {
    console.error(
      JSON.stringify({
        type: 'relationship-audit-query-start',
        queryId,
        sql: String(sql).replace(/\s+/g, ' ').trim().slice(0, 500)
      })
    )
  }
  const [rows] = await db.query({ sql, values: params, timeout: QUERY_TIMEOUT_MS })
  if (PROGRESS_LOG) {
    console.error(
      JSON.stringify({
        type: 'relationship-audit-query-end',
        queryId,
        elapsedMs: Date.now() - started,
        rows: Array.isArray(rows) ? rows.length : null
      })
    )
  }
  return Array.isArray(rows) ? rows : []
}

async function queryScalar(db, sql, params = [], fallback = 0) {
  const rows = await queryRows(db, sql, params)
  const value = Object.values(rows?.[0] || {})[0]
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

async function getSchemaMetadata(db, tables) {
  const uniqueTables = unique(tables)
  const tableRows = await queryRows(
    db,
    `
      SELECT
        TABLE_NAME AS tableName,
        TABLE_COLLATION AS tableCollation,
        TABLE_ROWS AS estimatedRows,
        DATA_LENGTH AS dataBytes,
        INDEX_LENGTH AS indexBytes
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${uniqueTables.map(() => '?').join(', ')})
    `,
    uniqueTables
  )
  const columnRows = await queryRows(
    db,
    `
      SELECT
        TABLE_NAME AS tableName,
        COLUMN_NAME AS columnName,
        COLUMN_TYPE AS columnType,
        IS_NULLABLE AS isNullable,
        COLUMN_KEY AS columnKey,
        COLLATION_NAME AS collationName
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${uniqueTables.map(() => '?').join(', ')})
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `,
    uniqueTables
  )

  const tableMeta = new Map(tableRows.map((row) => [row.tableName, row]))
  const columnsByTable = new Map()
  const columnMetaByTable = new Map()
  for (const row of columnRows) {
    if (!columnsByTable.has(row.tableName)) columnsByTable.set(row.tableName, new Set())
    if (!columnMetaByTable.has(row.tableName)) columnMetaByTable.set(row.tableName, new Map())
    columnsByTable.get(row.tableName).add(row.columnName)
    columnMetaByTable.get(row.tableName).set(row.columnName, row)
  }

  return {
    tableMeta,
    columnsByTable,
    columnMetaByTable,
    exists(table) {
      return tableMeta.has(table)
    },
    columns(table) {
      return columnsByTable.get(table) || new Set()
    },
    hasColumn(table, column) {
      return columnsByTable.get(table)?.has(column) || false
    }
  }
}

async function getExactTableCounts(db, schema, tables) {
  const entries = await Promise.all(
    tables.map(async (table) => {
      if (!schema.exists(table)) return [table, 0]
      const total = await queryScalar(db, `SELECT COUNT(*) AS total FROM ${quoteIdent(table)}`)
      return [table, total]
    })
  )
  return new Map(entries)
}

function existingColumns(schema, table, columns) {
  return unique(columns).filter((column) => schema.hasColumn(table, column))
}

async function loadRows(db, schema, table, columns, options = {}) {
  if (!schema.exists(table)) return []
  const selectedColumns = existingColumns(schema, table, columns)
  if (!selectedColumns.length) return []
  const where = options.where ? ` WHERE ${options.where}` : ''
  const limit = options.limit ? ' LIMIT ?' : ''
  const params = options.limit ? [...(options.params || []), Number(options.limit)] : options.params || []
  return queryRows(db, `SELECT ${selectedColumns.map(quoteIdent).join(', ')} FROM ${quoteIdent(table)}${where}${limit}`, params)
}

async function sampleQuery(db, sql, params = []) {
  return (await queryRows(db, `${sql} LIMIT ?`, [...params, FINDING_DETAIL_LIMIT])).map(compactSample)
}

async function pushCountFinding(findings, db, severity, table, message, countSql, countParams, sampleSql, sampleParams, evidence = {}) {
  const count = await queryScalar(db, countSql, countParams)
  if (count <= 0) return count
  const samples = sampleSql ? await sampleQuery(db, sampleSql, sampleParams) : []
  pushFinding(findings, severity, table, '(multiple)', message, { ...evidence, count, samples }, count)
  return count
}

async function getTableMetadata(db, tables) {
  const rows = await queryRows(
    db,
    `
      SELECT
        TABLE_NAME AS table_name,
        TABLE_COLLATION AS table_collation,
        TABLE_ROWS AS table_rows
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${tables.map(() => '?').join(', ')})
    `,
    tables
  )
  return new Map(rows.map((row) => [row.table_name, row]))
}

async function getColumnMetadata(db, tables) {
  return queryRows(
    db,
    `
      SELECT
        TABLE_NAME AS table_name,
        COLUMN_NAME AS column_name,
        COLUMN_TYPE AS column_type,
        IS_NULLABLE AS is_nullable,
        COLUMN_KEY AS column_key,
        COLLATION_NAME AS collation_name
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${tables.map(() => '?').join(', ')})
    `,
    tables
  )
}

async function auditModelConvergence(db, findings) {
  const dbSettings = await queryRows(db, 'SELECT @@collation_database AS database_collation')
  const databaseCollation = dbSettings?.[0]?.database_collation || null
  const tableMetadata = await getTableMetadata(db, MODEL_CONVERGENCE_TABLES)
  const columnRows = await getColumnMetadata(db, MODEL_CONVERGENCE_TABLES)
  const columnByTable = new Map()
  for (const row of columnRows) {
    if (!columnByTable.has(row.table_name)) columnByTable.set(row.table_name, new Map())
    columnByTable.get(row.table_name).set(row.column_name, row)
  }

  const tableSummary = MODEL_CONVERGENCE_TABLES.map((table) => {
    const metadata = tableMetadata.get(table)
    const role = REQUIRED_CANONICAL_TABLES.has(table)
      ? 'canonical'
      : COMPATIBILITY_TABLES.has(table)
        ? 'compatibility'
        : 'related'
    if (!metadata) {
      pushFinding(
        findings,
        REQUIRED_CANONICAL_TABLES.has(table) ? 'blocker' : 'warning',
        table,
        '(schema)',
        REQUIRED_CANONICAL_TABLES.has(table) ? 'required canonical table is missing' : 'compatibility table is missing',
        { role }
      )
    }
    return {
      table,
      role,
      exists: Boolean(metadata),
      estimatedRows: metadata?.table_rows ?? null,
      tableCollation: metadata?.table_collation ?? null
    }
  })

  const requiredColumns = [
    ['animal', 'id', 'canonical animal id'],
    ['animal', 'animal_number', 'canonical animal number'],
    ['cows', 'id', 'compat animal id'],
    ['cows', 'cow_number', 'compat animal number'],
    ['milk_measurement', 'animal_id', 'canonical animal reference'],
    ['milk_measurement', 'measured_at', 'canonical milk timestamp'],
    ['milk_measurement', 'milk_yield', 'canonical milk amount'],
    ['milk_records', 'cow_id', 'compat animal reference'],
    ['milk_records', 'milking_time', 'compat milk timestamp'],
    ['milk_records', 'volume', 'compat milk amount'],
    ['sensor_reading', 'animal_id', 'canonical sensor reference'],
    ['sensor_reading', 'metric_code', 'canonical sensor metric'],
    ['sensor_reading', 'measured_at', 'canonical sensor timestamp'],
    ['sensor_readings', 'cow_id', 'compat sensor reference'],
    ['operation_audit_log', 'animal_id', 'canonical audit animal reference'],
    ['operation_audit_log', 'operated_at', 'canonical audit timestamp'],
    ['operation_audit_logs', 'target_type', 'compat audit target type'],
    ['operation_audit_logs', 'target_id', 'compat audit target id']
  ].map(([table, column, role]) => {
    const metadata = columnByTable.get(table)?.get(column)
    if (tableMetadata.has(table) && !metadata) {
      pushFinding(findings, REQUIRED_CANONICAL_TABLES.has(table) ? 'blocker' : 'warning', table, '(schema)', 'required convergence column is missing', {
        column,
        role
      })
    }
    return {
      table,
      column,
      role,
      exists: Boolean(metadata),
      columnType: metadata?.column_type || null,
      nullable: metadata?.is_nullable || null,
      columnKey: metadata?.column_key || null,
      collation: metadata?.collation_name || null
    }
  })

  const joinColumnGroups = {
    animal_id: [
      ['animal', 'id'],
      ['cows', 'id'],
      ['milk_measurement', 'animal_id'],
      ['milk_records', 'cow_id'],
      ['sensor_reading', 'animal_id'],
      ['sensor_readings', 'cow_id'],
      ['operation_audit_log', 'animal_id']
    ],
    animal_number: [
      ['animal', 'animal_number'],
      ['cows', 'cow_number']
    ],
    audit_target: [
      ['operation_audit_log', 'target_type'],
      ['operation_audit_log', 'target_id'],
      ['operation_audit_logs', 'target_type'],
      ['operation_audit_logs', 'target_id']
    ]
  }

  const collationChecks = Object.entries(joinColumnGroups).map(([group, columns]) => {
    const present = columns
      .map(([table, column]) => {
        const metadata = columnByTable.get(table)?.get(column)
        return metadata
          ? {
              table,
              column,
              collation: metadata.collation_name,
              columnType: metadata.column_type
            }
          : null
      })
      .filter(Boolean)
      .filter((item) => item.collation)
    const collations = unique(present.map((item) => item.collation))
    if (collations.length > 1) {
      pushFinding(findings, 'blocker', 'collation', group, 'join-related text columns use mixed collations', {
        collations,
        columns: present
      })
    }
    return {
      group,
      ok: collations.length <= 1,
      collations,
      columns: present
    }
  })

  return {
    databaseCollation,
    tables: tableSummary,
    requiredColumns,
    collationChecks
  }
}

function mergeRelationCowIds(row, columns, refs) {
  const rowWithoutSourceRecords = { ...row }
  delete rowWithoutSourceRecords.source_record_ids
  delete rowWithoutSourceRecords.sourceRecordIds
  const tokens = collectCowTokens(rowWithoutSourceRecords)
  addAnimalNumberCowTokens(rowWithoutSourceRecords, tokens)
  for (const column of columns) {
    if (column === 'source_record_ids') continue
    if (row[column] !== undefined) {
      collectCowTokens(row[column], tokens)
      addAnimalNumberCowTokens(row[column], tokens)
    }
  }
  const ids = []
  for (const id of unique(tokens.ids)) {
    if (refs.cowById.has(id)) ids.push(id)
    else if (refs.cowByNumber.has(id)) ids.push(refs.cowByNumber.get(id).id)
  }
  for (const number of unique(tokens.numbers)) {
    if (refs.cowByNumber.has(number)) ids.push(refs.cowByNumber.get(number).id)
    else if (refs.cowById.has(number)) ids.push(number)
  }
  return unique(ids)
}

function resolveCowIdListValues(value, refs) {
  const ids = []
  const values = Array.isArray(value) ? value : arrayFromJsonColumn({ cow_ids: value }, 'cow_ids')
  for (const raw of values) {
    const token = String(raw || '').trim()
    if (!token) continue
    if (refs.cowById.has(token)) ids.push(token)
    else if (refs.cowByNumber.has(token)) ids.push(refs.cowByNumber.get(token).id)
  }
  return unique(ids)
}

function sourceRecordPayload(row) {
  const payload = objectFromJsonColumn(row, 'payload')
  const relationScope = objectFromJsonColumn(row, 'relation_scope')
  const inputSummary = objectFromJsonColumn(row, 'input_summary')
  const params = objectFromJsonColumn(row, 'parameters')
  const candidates = [
    row.source_record_ids,
    row.sourceRecordIds,
    row.source_table && row.source_record_id ? { [row.source_table]: [row.source_record_id] } : null,
    row.sourceTable && row.sourceRecordId ? { [row.sourceTable]: [row.sourceRecordId] } : null,
    relationScope.sourceRecordIds,
    relationScope.source_record_ids,
    payload.sourceRecordIds,
    payload.source_record_ids,
    payload.sourceRecords,
    payload.source_records,
    inputSummary.sourceRecordIds,
    inputSummary.source_record_ids,
    params.sourceRecordIds,
    params.source_record_ids
  ]
  for (const candidate of candidates) {
    const parsed = parseJson(candidate, candidate)
    if (parsed && ((Array.isArray(parsed) && parsed.length) || (typeof parsed === 'object' && Object.keys(parsed).length))) return parsed
  }
  return null
}

function normalizeSourceRecordPayload(sourceRecordIds) {
  if (!sourceRecordIds) return {}
  const parsed = parseJson(sourceRecordIds, sourceRecordIds)
  if (!parsed) return {}
  if (Array.isArray(parsed)) return normalizeSourceRecordArray(parsed)
  if (typeof parsed !== 'object') return {}
  const output = {}
  for (const [table, ids] of Object.entries(parsed)) {
    const normalizedTable = normalizeTableName(table)
    if (normalizedTable === 'unknown') {
      const normalizedUnknown = normalizeSourceRecordArray(Array.isArray(ids) ? ids : [ids])
      for (const [unknownTable, unknownIds] of Object.entries(normalizedUnknown)) {
        output[unknownTable] = unique([...(output[unknownTable] || []), ...unknownIds])
      }
      continue
    }
    output[normalizedTable] = unique(Array.isArray(ids) ? ids : [ids])
  }
  return output
}

function normalizeSourceRecordArray(values) {
  const output = {}
  const unknown = []
  for (const value of unique(values)) {
    const text = String(value || '').trim()
    if (text.startsWith('milk_missing_')) {
      if (!output.data_quality_issue) output.data_quality_issue = []
      output.data_quality_issue.push(text)
      continue
    }
    const parsedLegacy = parseLegacyUnresolvedSourceRecord(value)
    if (parsedLegacy && collectCowTokens(parsedLegacy).ids.concat(collectCowTokens(parsedLegacy).numbers).length) continue
    if (isLegacyUnresolvedCowToken(value)) continue

    const match = text.match(/^([A-Za-z0-9_-]+):(.+)$/)
    if (match) {
      const table = normalizeTableName(match[1])
      if (!output[table]) output[table] = []
      output[table].push(match[2])
      continue
    }
    unknown.push(text)
  }
  for (const [table, ids] of Object.entries(output)) output[table] = unique(ids)
  if (unknown.length) output.unknown = unknown
  return output
}

function parseLegacyUnresolvedSourceRecord(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text.startsWith('unresolved:')) return null
  const payload = text.slice('unresolved:'.length).trim()
  const parsed = parseJson(payload, null)
  if (parsed) return parsed
  const fallback = {}
  for (const key of ['cow_id', 'cow_number', 'animal_number']) {
    const match = payload.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`))
    if (match) fallback[key] = match[1]
  }
  return Object.keys(fallback).length ? fallback : null
}

function isLegacyUnresolvedCowToken(value) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!text.startsWith('unresolved:')) return false
  return LEGACY_UNRESOLVED_COW_TOKEN_PATTERN.test(text)
}

function collectSourceRecordCowTokens(value, output = { ids: [], numbers: [] }) {
  if (value === null || value === undefined) return output
  const parsed = typeof value === 'string' ? parseJson(value, value) : value
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectSourceRecordCowTokens(item, output)
    return output
  }
  if (parsed && typeof parsed === 'object') {
    collectCowTokens(parsed, output)
    addAnimalNumberCowTokens(parsed, output)
    for (const item of Object.values(parsed)) collectSourceRecordCowTokens(item, output)
    return output
  }
  const legacy = parseLegacyUnresolvedSourceRecord(parsed)
  if (legacy) {
    collectCowTokens(legacy, output)
    addAnimalNumberCowTokens(legacy, output)
  } else if (isLegacyUnresolvedCowToken(parsed)) {
    output.legacyUnresolvedCowTokens = Number(output.legacyUnresolvedCowTokens || 0) + 1
  }
  return output
}

function hasLegacyUnresolvedCowToken(value) {
  const tokens = collectSourceRecordCowTokens(value)
  return Number(tokens.legacyUnresolvedCowTokens || 0) > 0
}

function addAnimalNumberCowTokens(value, output) {
  const parsed = typeof value === 'string' ? parseJson(value, value) : value
  if (Array.isArray(parsed)) {
    for (const item of parsed) addAnimalNumberCowTokens(item, output)
    return output
  }
  if (parsed && typeof parsed === 'object') {
    for (const [rawKey, rawValue] of Object.entries(parsed)) {
      if (keyName(rawKey) === 'animal_number') output.numbers.push(...valuesFromMaybeArray(rawValue))
      addAnimalNumberCowTokens(rawValue, output)
    }
    return output
  }
  const legacy = parseLegacyUnresolvedSourceRecord(parsed)
  if (legacy?.animal_number) output.numbers.push(String(legacy.animal_number))
  return output
}

function rowHasCowTraceEvidence(row) {
  const tokens = collectCowTokens(row)
  addAnimalNumberCowTokens(row, tokens)
  return unique(tokens.ids).length > 0 || unique(tokens.numbers).length > 0
}

function isNonAnimalAuditScope(table, row) {
  if (table !== 'operation_audit_logs') return false
  if (rowHasCowTraceEvidence(row)) return false
  const targetType = normalizeTableName(row.target_type || row.targetType || row.action_type || row.actionType)
  if (NON_ANIMAL_AUDIT_TARGET_TYPES.has(targetType)) return true
  const method = normalizeTableName(objectFromJsonColumn(row, 'request_payload').method)
  if (method === 'deletetablerecord') return true
  if (method === 'updatetablerecord') {
    const sourceRecords = normalizeSourceRecordPayload(sourceRecordPayload(row))
    const sourceTables = Object.keys(sourceRecords)
    if (sourceTables.length && sourceTables.every((sourceTable) => ['animal_pen_assignment'].includes(sourceTable))) return true
  }
  return false
}

function isLegacyAuditImportCompatibilityRow(table, row) {
  if (table !== 'operation_audit_logs') return false
  const sourceRecords = sourceRecordPayload(row)
  return Boolean(sourceRecords && hasLegacyUnresolvedCowToken(sourceRecords))
}

function isSystemTraceRow(table, row) {
  const targetType = normalizeTableName(row.target_type || row.targetType || row.action_type || row.actionType || row.device_type || row.deviceType)
  const relationScope = objectFromJsonColumn(row, 'relation_scope')
  const scope = normalizeTableName(relationScope.scope)
  if (scope === 'system' || scope === 'config' || scope === 'repository') return true
  if (SYSTEM_TRACE_TARGET_TYPES.has(targetType)) return true
  if (table === 'hardware_devices') {
    const deviceType = normalizeTableName(row.device_type || row.deviceType)
    return ['gateway', 'base_station', 'basestation', 'server', 'hub'].includes(deviceType)
  }
  return false
}

function isZeroRowExportAudit(table, row) {
  if (table !== 'export_audit_logs') return false
  const result = objectFromJsonColumn(row, 'result_snapshot')
  const rowCount = Number(row.row_count ?? row.rowCount ?? result.exportedRows ?? result.rowCount ?? 0)
  return Number.isFinite(rowCount) && rowCount === 0
}

function shouldTreatUnlinkedAsCompatibility(table, row) {
  if (CONFIG_TABLES.has(table)) return true
  if (isSystemTraceRow(table, row)) return true
  if (isZeroRowExportAudit(table, row)) return true
  if (isNonAnimalAuditScope(table, row)) return true
  if (isLegacyAuditImportCompatibilityRow(table, row)) return true
  return false
}

function collectSourceRecordRefsFromRows(rows) {
  const refs = new Map()
  for (const row of rows || []) {
    const payload = normalizeSourceRecordPayload(sourceRecordPayload(row))
    for (const [table, ids] of Object.entries(payload)) {
      if (!refs.has(table)) refs.set(table, new Set())
      for (const id of ids) refs.get(table).add(String(id))
    }
  }
  return refs
}

function mergeSourceRecordRefs(target, source) {
  for (const [table, ids] of source.entries()) {
    if (!target.has(table)) target.set(table, new Set())
    for (const id of ids) target.get(table).add(String(id))
  }
}

function chunk(values, size) {
  const output = []
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size))
  return output
}

function resolveSampleCowIds(sampleIds, refs) {
  const cowIds = []
  const missing = []
  for (const sampleId of unique(sampleIds)) {
    const sample = refs.omicsSampleById.get(sampleId) || refs.omicsSampleByCode.get(sampleId)
    if (!sample) {
      missing.push(sampleId)
      continue
    }
    const sampleCowId = sample.cow_id || sample.cowId
    const sampleCowNumber = sample.cow_number || sample.cowNumber
    if (sampleCowId && refs.cowById.has(String(sampleCowId))) cowIds.push(String(sampleCowId))
    else if (sampleCowNumber && refs.cowByNumber.has(String(sampleCowNumber))) cowIds.push(refs.cowByNumber.get(String(sampleCowNumber)).id)
    else missing.push(sampleId)
  }
  return { cowIds: unique(cowIds), missing }
}

function resolveDatasetCowIds(datasetIds, refs) {
  const cowIds = []
  const missing = []
  const repositoryScopeTables = {
    phenotype: 'phenotype_records',
    'phenotype-records': 'phenotype_records',
    phenotype_records: 'phenotype_records',
    milk: 'milk_records',
    'milk-records': 'milk_records',
    milk_records: 'milk_records',
    pedigree: 'cows',
    cows: 'cows',
    breeding: 'breeding_records',
    breeding_records: 'breeding_records',
    sensors: 'sensors',
    sensor_status: 'sensor_status',
    feed: 'feed_records',
    feed_records: 'feed_records',
    production: 'milk_records',
    'omics-samples': 'omics_samples',
    omics_samples: 'omics_samples',
    'omics-markers': 'omics_markers',
    omics_markers: 'omics_markers',
    markers: 'omics_markers',
    associations: 'multi_omics_associations',
    'multi-omics-associations': 'multi_omics_associations',
    multi_omics_associations: 'multi_omics_associations',
    'breeding-analyses': 'breeding_analyses',
    breeding_analyses: 'breeding_analyses'
  }
  for (const datasetId of unique(datasetIds)) {
    if (datasetId === 'water_buffalo_production_baseline_v1') continue
    if (datasetId === 'omics-datasets' || datasetId === 'omics_datasets') {
      if (Number(refs.linkedCounts.get('omics_datasets') || 0) > 0) cowIds.push('scope:omics_datasets')
      else missing.push(datasetId)
      continue
    }
    const scopeTable = repositoryScopeTables[String(datasetId)]
    if (scopeTable) {
      if (!refs.tableCounts.has(scopeTable)) {
        missing.push(scopeTable)
      } else if (Number(refs.linkedCounts.get(scopeTable) || 0) > 0) {
        cowIds.push(`scope:${scopeTable}`)
      } else {
        missing.push(scopeTable)
      }
      continue
    }
    const dataset = refs.omicsDatasetById.get(datasetId) || refs.omicsDatasetByCode.get(datasetId)
    if (!dataset) {
      missing.push(datasetId)
      continue
    }
    const sampleIds = arrayFromJsonColumn(dataset, 'sample_ids')
    const resolved = resolveSampleCowIds(sampleIds, refs)
    cowIds.push(...resolved.cowIds)
    missing.push(...resolved.missing)
  }
  return { cowIds: unique(cowIds), missing: unique(missing) }
}

function relationColumnsForTable(schema, table) {
  const meta = schema.tableMeta.get(table)
  const skipHeavy = Number(meta?.dataBytes || 0) > 50 * 1024 * 1024
  const baseColumns = [
    'id',
    'animal_id',
    'cow_id',
    'cow_number',
    'pen_id',
    'current_pen',
    'dataset_id',
    'primary_dataset_id',
    'secondary_dataset_id',
    'run_id',
    'run_type',
    'action_type',
    'target_type',
    'target_id',
    'status',
    'sample_ids',
    'sample_count',
    'dataset_ids',
    'top_candidates',
    'selection_index',
    'repository_ids',
    'module_run_ids',
    'cow_ids',
    'relation_scope',
    'source_record_ids',
    'source_table',
    'source_record_id',
    'parameters',
    'input_summary'
  ]
  const jsonColumns = RELATIONSHIP_JSON_COLUMNS.filter((column) => !skipHeavy || !HEAVY_JSON_COLUMNS.has(column))
  return existingColumns(schema, table, [...baseColumns, ...jsonColumns])
}

function hasComplexTraceColumns(schema, table) {
  const columns = relationColumnsForTable(schema, table).filter((column) => !['id', 'cow_id', 'cow_number', 'current_pen'].includes(column))
  return columns.length > 0
}

function shouldUseComplexTrace(schema, table) {
  if (FORCE_COMPLEX_TRACE_TABLES.has(table)) return true
  if (table === 'cows' || table === 'feed_records') return false
  if (schema.hasColumn(table, 'cow_id') || schema.hasColumn(table, 'cow_number')) return false
  return hasComplexTraceColumns(schema, table)
}

async function resolveSourceRecordCowIds(sourceRecordIds, refs, stack = []) {
  const cowIds = []
  const missing = []
  const byTable = normalizeSourceRecordPayload(sourceRecordIds)
  for (const [table, ids] of Object.entries(byTable)) {
    const normalizedTable = normalizeTableName(table)
    const uniqueIds = unique(Array.isArray(ids) ? ids : [ids])
    if (normalizedTable === 'unknown') continue
    if (uniqueIds.length > LARGE_SOURCE_RECORD_THRESHOLD) {
      let resolvedCount = 0
      let missingCount = 0
      const missingSamples = []
      for (const id of uniqueIds) {
        const cacheKey = `${normalizedTable}:${id}`
        const cached = refs.recordTraceCache.get(cacheKey)
        if (cached?.cowIds?.length) {
          resolvedCount += 1
        } else {
          missingCount += 1
          if (missingSamples.length < FINDING_DETAIL_LIMIT) missingSamples.push(`${normalizedTable}:${id}`)
        }
      }
      if (resolvedCount) cowIds.push(`source_scope:${normalizedTable}:${resolvedCount}`)
      if (missingCount) missing.push(`${normalizedTable}:missing ${missingCount} source records (${missingSamples.join(', ')})`)
      continue
    }
    for (const id of uniqueIds) {
      if (stack.includes(`${normalizedTable}:${id}`)) continue
      const resolved = await refs.resolveRecordCowTrace(normalizedTable, id, [...stack, `${normalizedTable}:${id}`])
      cowIds.push(...resolved.cowIds)
      missing.push(...resolved.missing)
    }
  }
  return { cowIds: unique(cowIds), missing: unique(missing) }
}

async function resolveComplexRowCowTrace(table, row, refs, stack = []) {
  const cowIds = []
  const missing = []
  const via = []

  if (!row) return { cowIds, missing, via }

  if (table === 'cows') {
    if (row.id && refs.cowById.has(String(row.id))) return { cowIds: [String(row.id)], missing, via: ['self'] }
  }

  if (table === 'animal') {
    const animalId = row.id === undefined || row.id === null ? '' : String(row.id)
    const animalNumber = row.animal_number ?? row.animalNumber
    if (animalId && refs.cowById.has(animalId)) {
      cowIds.push(animalId)
      via.push('animal_id_to_cow')
    } else if (animalId && refs.cowByNumber.has(animalId)) {
      cowIds.push(refs.cowByNumber.get(animalId).id)
      via.push('animal_id_as_number')
    }
    if (animalNumber) {
      const number = String(animalNumber)
      if (refs.cowByNumber.has(number)) {
        cowIds.push(refs.cowByNumber.get(number).id)
        via.push('animal_number_to_cow')
      } else if (refs.cowById.has(number)) {
        cowIds.push(number)
        via.push('animal_number_as_id')
      } else {
        missing.push(`animal_number:${number}`)
      }
    }
  }

  const directCowId = row.cow_id ?? row.cowId
  const directCowNumber = row.cow_number ?? row.cowNumber
  if (directCowId) {
    const id = String(directCowId)
    if (refs.cowById.has(id)) {
      cowIds.push(id)
      via.push('cow_id')
    } else if (refs.cowByNumber.has(id)) {
      cowIds.push(refs.cowByNumber.get(id).id)
      via.push('cow_id_as_number')
    } else {
      missing.push(`cow_id:${id}`)
    }
  }
  if (directCowNumber) {
    const number = String(directCowNumber)
    if (refs.cowByNumber.has(number)) {
      cowIds.push(refs.cowByNumber.get(number).id)
      via.push('cow_number')
    } else if (refs.cowById.has(number)) {
      cowIds.push(number)
      via.push('cow_number_as_id')
    } else {
      missing.push(`cow_number:${number}`)
    }
  }

  const scopedCowIds = resolveCowIdListValues(row.cow_ids ?? row.cowIds, refs)
  if (scopedCowIds.length) {
    cowIds.push(...scopedCowIds)
    via.push('cow_ids')
  }

  if (table === 'omics_datasets') {
    const sampleIds = arrayFromJsonColumn(row, 'sample_ids')
    const resolved = resolveSampleCowIds(sampleIds, refs)
    cowIds.push(...resolved.cowIds)
    missing.push(...resolved.missing.map((id) => `sample:${id}`))
    if (resolved.cowIds.length) via.push('sample_ids_to_omics_samples')
  }

  if (table === 'hardware_devices' && isSystemTraceRow(table, row)) {
    cowIds.push(`scope:hardware_device:${rowId(row)}`)
    via.push('system_device_scope')
  }

  if (table === 'export_audit_logs' && isZeroRowExportAudit(table, row)) {
    cowIds.push(`scope:zero_row_export:${rowId(row)}`)
    via.push('zero_row_export_audit')
  }

  if (table === 'omics_markers') {
    const resolved = resolveDatasetCowIds([row.dataset_id || row.datasetId], refs)
    cowIds.push(...resolved.cowIds)
    missing.push(...resolved.missing.map((id) => `dataset:${id}`))
    if (resolved.cowIds.length) via.push('dataset_id_to_samples')
  }

  if (table === 'multi_omics_associations') {
    const resolved = resolveDatasetCowIds([row.primary_dataset_id || row.primaryDatasetId, row.secondary_dataset_id || row.secondaryDatasetId], refs)
    cowIds.push(...resolved.cowIds)
    missing.push(...resolved.missing.map((id) => `dataset:${id}`))
    if (resolved.cowIds.length) via.push('association_dataset_ids')
  }

  if (table === 'breeding_analyses') {
    const datasetIds = arrayFromJsonColumn(row, 'dataset_ids')
    const resolvedDatasets = resolveDatasetCowIds(datasetIds, refs)
    cowIds.push(...resolvedDatasets.cowIds)
    missing.push(...resolvedDatasets.missing.map((id) => `dataset:${id}`))
    cowIds.push(...mergeRelationCowIds(row, ['top_candidates', 'selection_index'], refs))
    if (resolvedDatasets.cowIds.length) via.push('dataset_ids')
    if (row.top_candidates) via.push('top_candidates')
  }

  if (table === 'omics_module_runs' || table === 'omics_workflow_runs') {
    const params = objectFromJsonColumn(row, 'parameters')
    const inputSummary = objectFromJsonColumn(row, 'input_summary')
    const repositoryIds = [
      ...(Array.isArray(row.repository_ids) ? row.repository_ids : arrayFromJsonColumn(row, 'repository_ids')),
      ...(Array.isArray(params.repositoryIds) ? params.repositoryIds : []),
      ...(params.repositoryId ? [params.repositoryId] : []),
      ...(params.datasetId ? [params.datasetId] : []),
      ...(inputSummary.datasetId ? [inputSummary.datasetId] : []),
      ...(Array.isArray(inputSummary.datasetIds) ? inputSummary.datasetIds : [])
    ]
    const sampleIds = [
      ...(Array.isArray(inputSummary.sampleIds) ? inputSummary.sampleIds : []),
      ...(Array.isArray(params.sampleIds) ? params.sampleIds : [])
    ]
    const resolvedDatasets = resolveDatasetCowIds(repositoryIds, refs)
    const resolvedSamples = resolveSampleCowIds(sampleIds, refs)
    cowIds.push(...resolvedDatasets.cowIds, ...resolvedSamples.cowIds, ...mergeRelationCowIds(row, ['parameters', 'input_summary'], refs))
    missing.push(...resolvedDatasets.missing.map((id) => `dataset:${id}`), ...resolvedSamples.missing.map((id) => `sample:${id}`))
    if (resolvedDatasets.cowIds.length) via.push('omics_run_dataset')
    if (resolvedSamples.cowIds.length) via.push('omics_run_samples')
  }

  if (table === 'omics_analysis_artifacts') {
    const runId = String(row.run_id || row.runId || '')
    const runType = String(row.run_type || row.runType || '')
    const runTable = runType === 'workflow' ? 'omics_workflow_runs' : 'omics_module_runs'
    const run = refs.rowByTableId.get(runTable)?.get(runId)
    if (run) {
      const resolved = await resolveComplexRowCowTrace(runTable, run, refs, [...stack, `${runTable}:${runId}`])
      cowIds.push(...resolved.cowIds)
      missing.push(...resolved.missing)
      if (resolved.cowIds.length) via.push('artifact_run')
    } else if (runId) {
      missing.push(`${runTable}:${runId}`)
    }
  }

  const sourceRecords = sourceRecordPayload(row)
  if (sourceRecords) {
    const sourceCowTokens = collectSourceRecordCowTokens(sourceRecords)
    for (const id of unique(sourceCowTokens.ids)) {
      if (refs.cowById.has(id)) cowIds.push(id)
      else if (refs.cowByNumber.has(id)) cowIds.push(refs.cowByNumber.get(id).id)
    }
    for (const number of unique(sourceCowTokens.numbers)) {
      if (refs.cowByNumber.has(number)) cowIds.push(refs.cowByNumber.get(number).id)
      else if (refs.cowById.has(number)) cowIds.push(number)
    }
    if (cowIds.length) via.push('source_record_cow_tokens')

    const resolved = await resolveSourceRecordCowIds(sourceRecords, refs, stack)
    cowIds.push(...resolved.cowIds)
    if (!cowIds.length) missing.push(...resolved.missing)
    if (resolved.cowIds.length) via.push('source_record_ids')
  }

  cowIds.push(...mergeRelationCowIds(row, relationColumnsForTable(refs.schema, table), refs))
  if (cowIds.length) via.push('json_relation')

  return { cowIds: unique(cowIds), missing: unique(missing), via: unique(via) }
}

async function createRefs(db, schema, tableCounts, linkedCounts) {
  const cows = await loadRows(db, schema, 'cows', [
    'id',
    'cow_number',
    'current_pen',
    'father_number',
    'mother_number',
    'grandfather_number',
    'grandmother_number'
  ])
  const omicsSamples = await loadRows(db, schema, 'omics_samples', ['id', 'sample_code', 'cow_id', 'cow_number'])
  const omicsDatasets = await loadRows(db, schema, 'omics_datasets', ['id', 'dataset_code', 'sample_ids', 'sample_count'])
  const omicsModuleRuns = await loadRows(db, schema, 'omics_module_runs', relationColumnsForTable(schema, 'omics_module_runs'))
  const omicsWorkflowRuns = await loadRows(db, schema, 'omics_workflow_runs', relationColumnsForTable(schema, 'omics_workflow_runs'))

  const refs = {
    db,
    schema,
    tableCounts,
    linkedCounts,
    cows,
    cowById: new Map(cows.map((row) => [String(row.id), row])),
    cowByNumber: new Map(cows.map((row) => [String(row.cow_number || row.cowNumber), row]).filter(([key]) => key && key !== 'undefined')),
    omicsSamples,
    omicsDatasets,
    omicsSampleById: new Map(omicsSamples.map((row) => [String(row.id), row])),
    omicsSampleByCode: new Map(omicsSamples.map((row) => [String(row.sample_code || row.sampleCode), row])),
    omicsDatasetById: new Map(omicsDatasets.map((row) => [String(row.id), row])),
    omicsDatasetByCode: new Map(omicsDatasets.map((row) => [String(row.dataset_code || row.datasetCode), row])),
    rowByTableId: new Map([
      ['cows', new Map(cows.map((row) => [rowId(row), row]))],
      ['omics_samples', new Map(omicsSamples.map((row) => [rowId(row), row]))],
      ['omics_datasets', new Map(omicsDatasets.map((row) => [rowId(row), row]))],
      ['omics_module_runs', new Map(omicsModuleRuns.map((row) => [rowId(row), row]))],
      ['omics_workflow_runs', new Map(omicsWorkflowRuns.map((row) => [rowId(row), row]))]
    ]),
    recordTraceCache: new Map(),
    pendingSourceRecordRefs: new Map(),
    async resolveRecordCowTrace(table, id, stack = []) {
      const normalizedTable = normalizeTableName(table)
      const normalizedId = String(id)
      const cacheKey = `${normalizedTable}:${normalizedId}`
      if (this.recordTraceCache.has(cacheKey)) return this.recordTraceCache.get(cacheKey)
      if (!this.schema.exists(normalizedTable)) {
        const resolved = { cowIds: [], missing: [`${normalizedTable}:${normalizedId}`], via: [] }
        this.recordTraceCache.set(cacheKey, resolved)
        return resolved
      }
      const cachedRow = this.rowByTableId.get(normalizedTable)?.get(normalizedId)
      if (cachedRow) {
        const resolved = await resolveComplexRowCowTrace(normalizedTable, cachedRow, this, stack)
        this.recordTraceCache.set(cacheKey, resolved)
        return resolved
      }
      if (!this.schema.hasColumn(normalizedTable, 'id')) {
        const resolved = { cowIds: [], missing: [`${normalizedTable}:${normalizedId}`], via: [] }
        this.recordTraceCache.set(cacheKey, resolved)
        return resolved
      }
      const rows = await loadRows(this.db, this.schema, normalizedTable, relationColumnsForTable(this.schema, normalizedTable), {
        where: `${quoteIdent('id')} = ?`,
        params: [normalizedId],
        limit: 1
      })
      if (!rows.length) {
        const resolved = { cowIds: [], missing: [`${normalizedTable}:${normalizedId}`], via: [] }
        this.recordTraceCache.set(cacheKey, resolved)
        return resolved
      }
      const resolved = await resolveComplexRowCowTrace(normalizedTable, rows[0], this, stack)
      this.recordTraceCache.set(cacheKey, resolved)
      return resolved
    }
  }

  return refs
}

async function primeSourceRecordTraceCache(db, schema, refs, sourceRefs) {
  const queue = new Map()
  mergeSourceRecordRefs(queue, sourceRefs)

  for (const [table, idSet] of queue.entries()) {
    const ids = unique([...idSet]).filter((id) => !refs.recordTraceCache.has(`${table}:${id}`))
    if (!ids.length || table === 'unknown') continue
    const largeSourceSet = ids.length > LARGE_SOURCE_RECORD_THRESHOLD
    if (!schema.exists(table) || !schema.hasColumn(table, 'id')) {
      for (const id of ids) refs.recordTraceCache.set(`${table}:${id}`, { cowIds: [], missing: [`${table}:${id}`], via: [] })
      continue
    }

    for (const idsChunk of chunk(ids, SOURCE_RECORD_CHUNK_SIZE)) {
      const selectedColumns = largeSourceSet
        ? existingColumns(schema, table, ['id', 'cow_id', 'cow_number', 'dataset_id', 'primary_dataset_id', 'secondary_dataset_id', 'sample_ids'])
        : relationColumnsForTable(schema, table)
      if (!selectedColumns.length) {
        for (const id of idsChunk) refs.recordTraceCache.set(`${table}:${id}`, { cowIds: [], missing: [`${table}:${id}`], via: [] })
        continue
      }
      const rows = await queryRows(
        db,
        `SELECT ${selectedColumns.map(quoteIdent).join(', ')}
         FROM ${quoteIdent(table)}
         WHERE ${quoteIdent('id')} IN (${idsChunk.map(() => '?').join(', ')})`,
        idsChunk
      )
      const rowById = new Map(rows.map((row) => [String(row.id), row]))
      if (!refs.rowByTableId.has(table)) refs.rowByTableId.set(table, new Map())
      for (const row of rows) refs.rowByTableId.get(table).set(rowId(row), row)
      for (const id of idsChunk) {
        const cacheKey = `${table}:${id}`
        if (refs.recordTraceCache.has(cacheKey)) continue
        const row = rowById.get(String(id))
        if (!row) {
          refs.recordTraceCache.set(cacheKey, { cowIds: [], missing: [`${table}:${id}`], via: [] })
          continue
        }
        const resolved = await resolveComplexRowCowTrace(table, row, refs, [cacheKey])
        refs.recordTraceCache.set(cacheKey, resolved)
        if (!largeSourceSet) mergeSourceRecordRefs(queue, collectSourceRecordRefsFromRows([row]))
      }
    }
  }
}

function directCowJoins(schema, table) {
  const joins = []
  const predicates = []
  const invalidChecks = []
  const tableRef = quoteIdent(table)

  if (schema.hasColumn(table, 'cow_id')) {
    joins.push(`LEFT JOIN ${quoteIdent('cows')} cow_id_ref ON ${textEquals('cow_id_ref.id', `t.${quoteIdent('cow_id')}`)}`)
    joins.push(`LEFT JOIN ${quoteIdent('cows')} cow_id_num_ref ON ${textEquals('cow_id_num_ref.cow_number', `t.${quoteIdent('cow_id')}`)}`)
    predicates.push('(cow_id_ref.id IS NOT NULL OR cow_id_num_ref.id IS NOT NULL)')
    invalidChecks.push({
      column: 'cow_id',
      condition: `t.${quoteIdent('cow_id')} IS NOT NULL AND t.${quoteIdent('cow_id')} <> '' AND cow_id_ref.id IS NULL AND cow_id_num_ref.id IS NULL`,
      sampleSql: `SELECT t.${schema.hasColumn(table, 'id') ? quoteIdent('id') : quoteIdent('cow_id')}, t.${quoteIdent('cow_id')} FROM ${tableRef} t ${joins.join(' ')} WHERE t.${quoteIdent('cow_id')} IS NOT NULL AND t.${quoteIdent('cow_id')} <> '' AND cow_id_ref.id IS NULL AND cow_id_num_ref.id IS NULL`
    })
  }

  if (schema.hasColumn(table, 'cow_number')) {
    joins.push(`LEFT JOIN ${quoteIdent('cows')} cow_number_ref ON ${textEquals('cow_number_ref.cow_number', `t.${quoteIdent('cow_number')}`)}`)
    joins.push(`LEFT JOIN ${quoteIdent('cows')} cow_number_id_ref ON ${textEquals('cow_number_id_ref.id', `t.${quoteIdent('cow_number')}`)}`)
    predicates.push('(cow_number_ref.id IS NOT NULL OR cow_number_id_ref.id IS NOT NULL)')
    invalidChecks.push({
      column: 'cow_number',
      condition: `t.${quoteIdent('cow_number')} IS NOT NULL AND t.${quoteIdent('cow_number')} <> '' AND cow_number_ref.id IS NULL AND cow_number_id_ref.id IS NULL`,
      sampleSql: `SELECT t.${schema.hasColumn(table, 'id') ? quoteIdent('id') : quoteIdent('cow_number')}, t.${quoteIdent('cow_number')} FROM ${tableRef} t ${joins.join(' ')} WHERE t.${quoteIdent('cow_number')} IS NOT NULL AND t.${quoteIdent('cow_number')} <> '' AND cow_number_ref.id IS NULL AND cow_number_id_ref.id IS NULL`
    })
  }

  return {
    joins,
    predicate: predicates.length ? `(${predicates.join(' OR ')})` : 'FALSE',
    invalidChecks
  }
}

async function auditDirectTable(db, schema, counts, findings, relationSummaryByTable, linkedCounts, table) {
  const total = Number(counts.get(table) || 0)
  if (!schema.exists(table)) {
    relationSummaryByTable.set(table, { table, rows: 0, linkedRows: 0, unlinkedRows: 0, status: 'missing' })
    return
  }
  if (!total) {
    linkedCounts.set(table, 0)
    relationSummaryByTable.set(table, { table, rows: 0, linkedRows: 0, unlinkedRows: 0, status: 'empty' })
    return
  }

  if (table === 'cows') {
    linkedCounts.set(table, total)
    relationSummaryByTable.set(table, { table, rows: total, linkedRows: total, unlinkedRows: 0, status: 'ok' })
    return
  }

  const tableRef = quoteIdent(table)

  if (DIRECT_COW_ID_TABLES.has(table) && !schema.hasColumn(table, 'cow_id')) {
    pushFinding(findings, 'blocker', table, '(schema)', 'mandatory cow_id column is missing', {}, 1)
  }
  if (DIRECT_COW_NUMBER_TABLES.has(table) && !schema.hasColumn(table, 'cow_number')) {
    pushFinding(findings, 'blocker', table, '(schema)', 'mandatory cow_number column is missing', {}, 1)
  }

  if (table === 'feed_records') {
    const direct = directCowJoins(schema, table)
    const penExists =
      schema.hasColumn(table, 'pen_id') && schema.exists('cows') && schema.hasColumn('cows', 'current_pen')
        ? `EXISTS (
            SELECT 1
            FROM ${quoteIdent('cows')} pen_cows
            LEFT JOIN ${quoteIdent('pens')} pen_ref ON ${textEquals('pen_ref.id', `t.${quoteIdent('pen_id')}`)}
            WHERE ${textEquals('pen_cows.current_pen', `t.${quoteIdent('pen_id')}`)}
               OR ${textEquals('pen_cows.current_pen', 'pen_ref.name')}
          )`
        : 'FALSE'
    const predicate = `(${direct.predicate} OR ${penExists})`
    const linkedRows = await queryScalar(db, `SELECT COUNT(*) AS total FROM ${tableRef} t ${direct.joins.join(' ')} WHERE ${predicate}`)
    linkedCounts.set(table, linkedRows)

    for (const check of direct.invalidChecks) {
      await pushCountFinding(
        findings,
        db,
        'blocker',
        table,
        `relationship references missing upstream rows (${check.column})`,
        `SELECT COUNT(*) AS total FROM ${tableRef} t ${direct.joins.join(' ')} WHERE ${check.condition}`,
        [],
        check.sampleSql,
        [],
        { column: check.column }
      )
    }

    if (schema.hasColumn(table, 'pen_id')) {
      await pushCountFinding(
        findings,
        db,
        'blocker',
        table,
        'feed_records.pen_id does not resolve to any current cow pen',
        `SELECT COUNT(*) AS total FROM ${tableRef} t ${direct.joins.join(' ')}
         WHERE (${schema.hasColumn(table, 'cow_id') ? `t.${quoteIdent('cow_id')} IS NULL OR t.${quoteIdent('cow_id')} = ''` : 'TRUE'})
           AND t.${quoteIdent('pen_id')} IS NOT NULL
           AND t.${quoteIdent('pen_id')} <> ''
           AND NOT (${penExists})`,
        [],
        `SELECT t.${schema.hasColumn(table, 'id') ? quoteIdent('id') : quoteIdent('pen_id')}, t.${quoteIdent('pen_id')} FROM ${tableRef} t ${direct.joins.join(' ')}
         WHERE (${schema.hasColumn(table, 'cow_id') ? `t.${quoteIdent('cow_id')} IS NULL OR t.${quoteIdent('cow_id')} = ''` : 'TRUE'})
           AND t.${quoteIdent('pen_id')} IS NOT NULL
           AND t.${quoteIdent('pen_id')} <> ''
           AND NOT (${penExists})`,
        []
      )
    }

    const unlinkedRows = total - linkedRows
    if (unlinkedRows > 0 && !CONFIG_TABLES.has(table)) {
      const samples = await sampleQuery(db, `SELECT t.${schema.hasColumn(table, 'id') ? quoteIdent('id') : quoteIdent('pen_id')} FROM ${tableRef} t ${direct.joins.join(' ')} WHERE NOT (${predicate})`)
      pushFinding(findings, 'blocker', table, '(multiple)', 'row has no trace path to cows', { count: unlinkedRows, samples }, unlinkedRows)
    }
    relationSummaryByTable.set(table, {
      table,
      rows: total,
      linkedRows,
      unlinkedRows,
      status: linkedRows === total || CONFIG_TABLES.has(table) ? 'ok' : 'needs_trace'
    })
    return
  }

  const hasDirectCow = schema.hasColumn(table, 'cow_id') || schema.hasColumn(table, 'cow_number')
  if (!hasDirectCow) {
    linkedCounts.set(table, CONFIG_TABLES.has(table) ? total : 0)
    if (!CONFIG_TABLES.has(table) && !shouldUseComplexTrace(schema, table)) {
      const columns = [...schema.columns(table)].filter((column) => column.includes('cow') || RELATIONSHIP_JSON_COLUMNS.includes(column))
      const samples = await loadRows(db, schema, table, ['id', 'cow_id', 'cow_number'], { limit: FINDING_DETAIL_LIMIT })
      pushFinding(
        findings,
        'blocker',
        table,
        '(multiple)',
        'row has no trace path to cows',
        { count: total, columns, samples: samples.map(compactSample) },
        total
      )
    }
    relationSummaryByTable.set(table, {
      table,
      rows: total,
      linkedRows: CONFIG_TABLES.has(table) ? total : 0,
      unlinkedRows: CONFIG_TABLES.has(table) ? 0 : total,
      status: CONFIG_TABLES.has(table) ? 'ok' : 'needs_trace'
    })
    return
  }

  const direct = directCowJoins(schema, table)
  const linkedRows = await queryScalar(db, `SELECT COUNT(*) AS total FROM ${tableRef} t ${direct.joins.join(' ')} WHERE ${direct.predicate}`)
  linkedCounts.set(table, linkedRows)

  if (DIRECT_COW_ID_TABLES.has(table) && schema.hasColumn(table, 'cow_id')) {
    await pushCountFinding(
      findings,
      db,
      'blocker',
      table,
      'mandatory cow_id is missing',
      `SELECT COUNT(*) AS total FROM ${tableRef} WHERE ${quoteIdent('cow_id')} IS NULL OR ${quoteIdent('cow_id')} = ''`,
      [],
      `SELECT ${schema.hasColumn(table, 'id') ? quoteIdent('id') : quoteIdent('cow_id')}, ${quoteIdent('cow_id')} FROM ${tableRef} WHERE ${quoteIdent('cow_id')} IS NULL OR ${quoteIdent('cow_id')} = ''`,
      []
    )
  }
  if (DIRECT_COW_NUMBER_TABLES.has(table) && schema.hasColumn(table, 'cow_number')) {
    await pushCountFinding(
      findings,
      db,
      'blocker',
      table,
      'mandatory cow_number is missing',
      `SELECT COUNT(*) AS total FROM ${tableRef} WHERE ${quoteIdent('cow_number')} IS NULL OR ${quoteIdent('cow_number')} = ''`,
      [],
      `SELECT ${schema.hasColumn(table, 'id') ? quoteIdent('id') : quoteIdent('cow_number')}, ${quoteIdent('cow_number')} FROM ${tableRef} WHERE ${quoteIdent('cow_number')} IS NULL OR ${quoteIdent('cow_number')} = ''`,
      []
    )
  }

  for (const check of direct.invalidChecks) {
    await pushCountFinding(
      findings,
      db,
      'blocker',
      table,
      `relationship references missing upstream rows (${check.column})`,
      `SELECT COUNT(*) AS total FROM ${tableRef} t ${direct.joins.join(' ')} WHERE ${check.condition}`,
      [],
      check.sampleSql,
      [],
      { column: check.column }
    )
  }

  const unlinkedRows = total - linkedRows
  if (unlinkedRows > 0 && !CONFIG_TABLES.has(table) && !shouldUseComplexTrace(schema, table)) {
    const samples = await sampleQuery(
      db,
      `SELECT t.${schema.hasColumn(table, 'id') ? quoteIdent('id') : schema.hasColumn(table, 'cow_id') ? quoteIdent('cow_id') : quoteIdent('cow_number')} FROM ${tableRef} t ${direct.joins.join(' ')} WHERE NOT (${direct.predicate})`
    )
    pushFinding(findings, 'blocker', table, '(multiple)', 'row has no trace path to cows', { count: unlinkedRows, samples }, unlinkedRows)
  }

  relationSummaryByTable.set(table, {
    table,
    rows: total,
    linkedRows,
    unlinkedRows,
    status: linkedRows === total || CONFIG_TABLES.has(table) ? 'ok' : 'needs_trace'
  })
}

async function auditComplexTraceTable(db, schema, counts, refs, findings, relationSummaryByTable, linkedCounts, table) {
  const total = Number(counts.get(table) || 0)
  if (!schema.exists(table)) {
    relationSummaryByTable.set(table, { table, rows: 0, linkedRows: 0, unlinkedRows: 0, status: 'missing' })
    linkedCounts.set(table, 0)
    return
  }
  if (!total) {
    relationSummaryByTable.set(table, { table, rows: 0, linkedRows: 0, unlinkedRows: 0, status: 'empty' })
    linkedCounts.set(table, 0)
    return
  }
  if (total > MAX_COMPLEX_TRACE_ROWS) {
    pushFinding(
      findings,
      'warning',
      table,
      '(audit-scope)',
      'complex JSON relationship audit exceeded row limit and was not fully expanded',
      { total, maxComplexTraceRows: MAX_COMPLEX_TRACE_ROWS },
      1
    )
    relationSummaryByTable.set(table, { table, rows: total, linkedRows: 0, unlinkedRows: total, status: 'needs_trace' })
    linkedCounts.set(table, 0)
    return
  }

  const rows = await loadRows(db, schema, table, relationColumnsForTable(schema, table))
  if (!refs.rowByTableId.has(table)) refs.rowByTableId.set(table, new Map())
  for (const row of rows) refs.rowByTableId.get(table).set(rowId(row), row)
  const tableSourceRefs = collectSourceRecordRefsFromRows(rows)
  mergeSourceRecordRefs(refs.pendingSourceRecordRefs, tableSourceRefs)
  await primeSourceRecordTraceCache(db, schema, refs, tableSourceRefs)

  let linkedRows = 0
  const missingRows = []
  const unlinkedRows = []
  const invalidTopCandidates = []

  for (const row of rows) {
    const resolved = await resolveComplexRowCowTrace(table, row, refs)
    if (resolved.cowIds.length) linkedRows += 1
    if (resolved.missing.length && !resolved.cowIds.length && !shouldTreatUnlinkedAsCompatibility(table, row)) {
      missingRows.push({ id: rowId(row), missing: resolved.missing.slice(0, 10) })
    }
    if (!resolved.cowIds.length && shouldTreatUnlinkedAsCompatibility(table, row)) {
      linkedRows += 1
    } else if (!resolved.cowIds.length && !CONFIG_TABLES.has(table)) {
      unlinkedRows.push({ id: rowId(row) })
    }

    if (table === 'breeding_analyses') {
      const candidates = arrayFromJsonColumn(row, 'top_candidates')
      for (const candidate of candidates) {
        const candidateTrace = mergeRelationCowIds(candidate, [], refs)
        if (!candidateTrace.length) {
          invalidTopCandidates.push({ id: rowId(row), candidate: compactSample(candidate) })
        }
      }
    }
  }

  linkedCounts.set(table, linkedRows)

  if (missingRows.length) {
    pushFinding(
      findings,
      'blocker',
      table,
      '(multiple)',
      'relationship references missing upstream rows',
      { count: missingRows.length, samples: missingRows.slice(0, FINDING_DETAIL_LIMIT) },
      missingRows.length
    )
  }
  if (unlinkedRows.length) {
    pushFinding(
      findings,
      'blocker',
      table,
      '(multiple)',
      'row has no trace path to cows',
      { count: unlinkedRows.length, samples: unlinkedRows.slice(0, FINDING_DETAIL_LIMIT) },
      unlinkedRows.length
    )
  }

  if (table === 'operation_audit_logs') {
    const nonAnimalRows = rows.filter((row) => isNonAnimalAuditScope(table, row))
    if (nonAnimalRows.length) {
      pushFinding(
        findings,
        'warning',
        table,
        '(historical-compat)',
        'non-animal audit scope has no cow trace and is treated as historical compatibility',
        { count: nonAnimalRows.length, samples: nonAnimalRows.slice(0, FINDING_DETAIL_LIMIT).map(compactSample) },
        nonAnimalRows.length
      )
    }
    const tombstoneRows = rows.filter((row) => {
      const request = objectFromJsonColumn(row, 'request_payload')
      return !rowHasCowTraceEvidence(row) && normalizeTableName(request.method) === 'deletetablerecord'
    })
    if (tombstoneRows.length) {
      pushFinding(
        findings,
        'warning',
        table,
        '(historical-compat)',
        'delete audit references already removed records and is treated as tombstone compatibility',
        { count: tombstoneRows.length, samples: tombstoneRows.slice(0, FINDING_DETAIL_LIMIT).map(compactSample) },
        tombstoneRows.length
      )
    }
    const legacyImportRows = rows.filter((row) => isLegacyAuditImportCompatibilityRow(table, row))
    if (legacyImportRows.length) {
      pushFinding(
        findings,
        'warning',
        table,
        '(historical-compat)',
        'legacy unresolved import audit token is truncated and treated as historical compatibility',
        { count: legacyImportRows.length, samples: legacyImportRows.slice(0, FINDING_DETAIL_LIMIT).map(compactSample) },
        legacyImportRows.length
      )
    }
  }
  if (table === 'export_audit_logs') {
    const zeroRows = rows.filter((row) => isZeroRowExportAudit(table, row))
    if (zeroRows.length) {
      pushFinding(
        findings,
        'warning',
        table,
        '(historical-compat)',
        'zero-row export audit has no cow trace because no records were exported',
        { count: zeroRows.length, samples: zeroRows.slice(0, FINDING_DETAIL_LIMIT).map(compactSample) },
        zeroRows.length
      )
    }
  }
  if (table === 'hardware_devices') {
    const systemRows = rows.filter((row) => isSystemTraceRow(table, row) && !rowHasCowTraceEvidence(row))
    if (systemRows.length) {
      pushFinding(
        findings,
        'warning',
        table,
        '(system-scope)',
        'system-level gateway/device is traced as infrastructure rather than cow assignment',
        { count: systemRows.length, samples: systemRows.slice(0, FINDING_DETAIL_LIMIT).map(compactSample) },
        systemRows.length
      )
    }
  }
  if (invalidTopCandidates.length) {
    pushFinding(
      findings,
      'blocker',
      table,
      '(multiple)',
      'top candidate does not resolve to cow',
      { count: invalidTopCandidates.length, samples: invalidTopCandidates.slice(0, FINDING_DETAIL_LIMIT) },
      invalidTopCandidates.length
    )
  }

  relationSummaryByTable.set(table, {
    table,
    rows: total,
    linkedRows,
    unlinkedRows: total - linkedRows,
    status: linkedRows === total || CONFIG_TABLES.has(table) ? 'ok' : 'needs_trace'
  })
}

async function auditCowsSpecial(db, schema, findings) {
  if (!schema.exists('cows')) return
  for (const key of ['father_number', 'mother_number', 'grandfather_number', 'grandmother_number']) {
    if (!schema.hasColumn('cows', key)) continue
    await pushCountFinding(
      findings,
      db,
      'warning',
      'cows',
      `${key} does not resolve to local cow_number`,
      `SELECT COUNT(*) AS total
       FROM ${quoteIdent('cows')} child
       LEFT JOIN ${quoteIdent('cows')} parent ON ${textEquals('parent.cow_number', `child.${quoteIdent(key)}`)}
       WHERE child.${quoteIdent(key)} IS NOT NULL
         AND child.${quoteIdent(key)} <> ''
         AND parent.id IS NULL`,
      [],
      `SELECT child.id, child.cow_number, child.${quoteIdent(key)} AS ${quoteIdent(key)}
       FROM ${quoteIdent('cows')} child
       LEFT JOIN ${quoteIdent('cows')} parent ON ${textEquals('parent.cow_number', `child.${quoteIdent(key)}`)}
       WHERE child.${quoteIdent(key)} IS NOT NULL
         AND child.${quoteIdent(key)} <> ''
         AND parent.id IS NULL`,
      [],
      { parentKey: key }
    )
  }
}

async function auditPhenotypeSpecial(db, schema, findings) {
  if (!schema.exists('phenotype_records')) return
  if (schema.hasColumn('phenotype_records', 'cow_id') && schema.hasColumn('phenotype_records', 'cow_number')) {
    await pushCountFinding(
      findings,
      db,
      'blocker',
      'phenotype_records',
      'cow_id and cow_number point to different cows',
      `SELECT COUNT(*) AS total
       FROM ${quoteIdent('phenotype_records')} p
       LEFT JOIN ${quoteIdent('cows')} c ON ${textEquals('c.id', 'p.cow_id')}
       WHERE p.cow_id IS NOT NULL
         AND p.cow_id <> ''
         AND p.cow_number IS NOT NULL
         AND p.cow_number <> ''
         AND c.id IS NOT NULL
         AND ${collatedText('c.cow_number')} <> ${collatedText('p.cow_number')}`,
      [],
      `SELECT p.id, p.cow_id, p.cow_number, c.cow_number AS expected_cow_number
       FROM ${quoteIdent('phenotype_records')} p
       LEFT JOIN ${quoteIdent('cows')} c ON ${textEquals('c.id', 'p.cow_id')}
       WHERE p.cow_id IS NOT NULL
         AND p.cow_id <> ''
         AND p.cow_number IS NOT NULL
         AND p.cow_number <> ''
         AND c.id IS NOT NULL
         AND ${collatedText('c.cow_number')} <> ${collatedText('p.cow_number')}`,
      []
    )
  }

  if (schema.hasColumn('phenotype_records', 'raw_payload')) {
    const sourceId = "JSON_UNQUOTE(JSON_EXTRACT(p.raw_payload, '$.sourceRecordId'))"
    const sourceTable = "JSON_UNQUOTE(JSON_EXTRACT(p.raw_payload, '$.sourceTable'))"
    const milkSourceFilter = `p.category LIKE '%泌乳%' AND ${sourceTable} = 'milk_records' AND ${sourceId} IS NOT NULL AND ${sourceId} <> ''`

    await pushCountFinding(
      findings,
      db,
      'blocker',
      'phenotype_records',
      'milk phenotype sourceRecordId does not resolve to milk_records',
      `SELECT COUNT(*) AS total
       FROM ${quoteIdent('phenotype_records')} p
       LEFT JOIN ${quoteIdent('milk_records')} m ON ${textEquals('m.id', sourceId)}
       WHERE ${milkSourceFilter}
         AND m.id IS NULL`,
      [],
      `SELECT p.id, p.cow_id, ${sourceId} AS sourceRecordId
       FROM ${quoteIdent('phenotype_records')} p
       LEFT JOIN ${quoteIdent('milk_records')} m ON ${textEquals('m.id', sourceId)}
       WHERE ${milkSourceFilter}
         AND m.id IS NULL`,
      []
    )

    await pushCountFinding(
      findings,
      db,
      'blocker',
      'phenotype_records',
      'milk phenotype source cow differs from phenotype cow',
      `SELECT COUNT(*) AS total
       FROM ${quoteIdent('phenotype_records')} p
       JOIN ${quoteIdent('milk_records')} m ON ${textEquals('m.id', sourceId)}
       WHERE ${milkSourceFilter}
         AND (m.cow_id IS NULL OR ${collatedText('m.cow_id')} <> ${collatedText('p.cow_id')})`,
      [],
      `SELECT p.id, p.cow_id AS phenotypeCowId, m.cow_id AS milkCowId, ${sourceId} AS sourceRecordId
       FROM ${quoteIdent('phenotype_records')} p
       JOIN ${quoteIdent('milk_records')} m ON ${textEquals('m.id', sourceId)}
       WHERE ${milkSourceFilter}
         AND (m.cow_id IS NULL OR ${collatedText('m.cow_id')} <> ${collatedText('p.cow_id')})`,
      []
    )
  }
}

async function auditOmicsDatasetSpecial(db, schema, refs, findings) {
  if (!schema.exists('omics_datasets')) return
  const rows = refs.omicsDatasets || []
  const mismatches = []
  for (const dataset of rows) {
    const sampleIds = arrayFromJsonColumn(dataset, 'sample_ids')
    if (Number(dataset.sample_count || 0) !== sampleIds.length) {
      mismatches.push({
        id: dataset.id,
        sample_count: dataset.sample_count,
        sampleIds: sampleIds.length
      })
    }
  }
  if (mismatches.length) {
    pushFinding(
      findings,
      'warning',
      'omics_datasets',
      '(multiple)',
      'sample_count does not match sample_ids length',
      { count: mismatches.length, samples: mismatches.slice(0, FINDING_DETAIL_LIMIT) },
      mismatches.length
    )
  }
}

async function auditGenericTables(db, schema, counts, findings, relationSummaryByTable, linkedCounts) {
  for (const table of BUSINESS_TABLES) {
    if (shouldUseComplexTrace(schema, table)) continue
    await auditDirectTable(db, schema, counts, findings, relationSummaryByTable, linkedCounts, table)
  }
}

async function auditComplexTables(db, schema, counts, refs, findings, relationSummaryByTable, linkedCounts) {
  for (const table of BUSINESS_TABLES) {
    if (!shouldUseComplexTrace(schema, table)) continue
    await auditComplexTraceTable(db, schema, counts, refs, findings, relationSummaryByTable, linkedCounts, table)
  }
}

function summarizeEntryCounts(findings) {
  const entries = {
    blockers: findings.filter((item) => item.severity === 'blocker').length,
    warnings: findings.filter((item) => item.severity === 'warning').length,
    total: findings.length
  }
  const occurrences = {
    blockers: findings
      .filter((item) => item.severity === 'blocker')
      .reduce((sum, item) => sum + Number(item.occurrences || 1), 0),
    warnings: findings
      .filter((item) => item.severity === 'warning')
      .reduce((sum, item) => sum + Number(item.occurrences || 1), 0)
  }
  occurrences.total = occurrences.blockers + occurrences.warnings
  return { entries, occurrences }
}

async function main() {
  const startedAt = Date.now()
  const timings = []
  const pool = mysql.createPool({ ...dbConfig, waitForConnections: true, queueLimit: 0 })
  try {
    const allKnownTables = unique([...BUSINESS_TABLES, 'pens', 'persons', ...MODEL_CONVERGENCE_TABLES])
    const schema = await timed(timings, 'schema-metadata', () => getSchemaMetadata(pool, allKnownTables))
    const counts = await timed(timings, 'table-counts', () => getExactTableCounts(pool, schema, BUSINESS_TABLES))
    const linkedCounts = new Map()
    const relationSummaryByTable = new Map()
    const findings = []

    const modelConvergence = await timed(timings, 'model-convergence', () => auditModelConvergence(pool, findings))
    await timed(timings, 'generic-relationship-audit', () => auditGenericTables(pool, schema, counts, findings, relationSummaryByTable, linkedCounts))
    const refs = await timed(timings, 'reference-load', () => createRefs(pool, schema, counts, linkedCounts))
    await timed(timings, 'complex-json-relationship-audit', () => auditComplexTables(pool, schema, counts, refs, findings, relationSummaryByTable, linkedCounts))
    await timed(timings, 'cow-pedigree-audit', () => auditCowsSpecial(pool, schema, findings))
    await timed(timings, 'phenotype-source-audit', () => auditPhenotypeSpecial(pool, schema, findings))
    await timed(timings, 'omics-dataset-audit', () => auditOmicsDatasetSpecial(pool, schema, refs, findings))

    const countsSummary = summarizeEntryCounts(findings)
    const relationSummary = BUSINESS_TABLES.map(
      (table) => relationSummaryByTable.get(table) || { table, rows: Number(counts.get(table) || 0), linkedRows: 0, unlinkedRows: Number(counts.get(table) || 0), status: 'not_scanned' }
    )
    const report = {
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      queryTimeoutMs: QUERY_TIMEOUT_MS,
      limits: {
        findingDetailLimit: FINDING_DETAIL_LIMIT,
        maxComplexTraceRows: MAX_COMPLEX_TRACE_ROWS
      },
      database: {
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database,
        user: dbConfig.user
      },
      cows: {
        total: Number(counts.get('cows') || 0),
        withCowNumber: refs.cowByNumber.size
      },
      relationSummary,
      modelConvergence,
      blockerSummaryByCategory: summarizeFindingsByCategory(findings),
      productionBlockers: countsSummary.occurrences.blockers,
      warnings: countsSummary.occurrences.warnings,
      findingEntries: countsSummary.entries,
      productionReady: countsSummary.occurrences.blockers === 0,
      timings,
      findings: findings.slice(0, 200)
    }
    console.log(JSON.stringify(report, null, 2))
    if (countsSummary.occurrences.blockers > 0) process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ productionReady: false, error: error.message, stack: error.stack }, null, 2))
  process.exitCode = 1
})
