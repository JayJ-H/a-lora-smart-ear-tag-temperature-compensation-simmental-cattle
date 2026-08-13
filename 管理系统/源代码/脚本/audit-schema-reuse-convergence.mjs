import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const reportDir = path.join(projectRoot, 'reports', '20260610-schema-reuse-convergence')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
if (process.env.AUDIT_SKIP_PRODUCTION_ENV !== '1') {
  dotenv.config({ path: path.join(projectRoot, '运维/生产配置/.env.prod'), override: true, quiet: true })
}

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

const OUTPUT_JSON = path.join(reportDir, 'schema-reuse-convergence-report.json')
const OUTPUT_MD = path.join(reportDir, 'schema-reuse-convergence-summary.md')

const SOURCE_EXTENSIONS = new Set(['.ts', '.vue', '.mjs', '.sql', '.md'])
const SOURCE_ROOTS = ['src', '脚本', '数据库', 'docs']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'backups', 'artifacts'])

const FAMILY_DEFINITIONS = [
  {
    key: 'animal_identity.reference',
    label: 'Animal reference',
    target: 'animal_id for standard tables; cow_id only in compatibility tables',
    canonical: ['animal_id'],
    legacy: ['cow_id', 'source_cow_id', 'target_cow_id'],
    regex: /(^|_)cow_id$|(^|_)animal_id$|source_cow_id|target_cow_id|female_animal_id|male_animal_id|bull_animal_id|calf_animal_id/i
  },
  {
    key: 'animal_identity.number',
    label: 'Animal business number',
    target: 'animal_number for standard tables; cow_number only in compatibility tables',
    canonical: ['animal_number'],
    legacy: ['cow_number', 'source_cow_number', 'target_cow_number'],
    regex: /(^|_)cow_number$|(^|_)animal_number$|source_cow_number|target_cow_number/i
  },
  {
    key: 'animal_identity.tag',
    label: 'Animal identifiers and tags',
    target: 'animal_identifier for RFID/electronic tags, plus animal.ear_tag_number for visible ear tag',
    canonical: ['identifier_type', 'identifier_value', 'ear_tag_number', 'electronic_tag'],
    legacy: ['rfid', 'tag_id', '耳标'],
    regex: /ear_tag|electronic_tag|rfid|identifier_value|identifier_type|tag_id/i
  },
  {
    key: 'person.record_operator',
    label: 'Recorder/uploader',
    target: 'operator_id/operator_name',
    canonical: ['operator_id', 'operator_name'],
    legacy: ['recorder', 'operator', 'created_by', 'user_name', 'createdBy'],
    regex: /^(operator_id|operator_name|operator|recorder|created_by|createdby|user_name)$/i
  },
  {
    key: 'person.work_operator',
    label: 'On-site executor',
    target: 'work_operator_id/work_operator_name, resolved through persons.role',
    canonical: ['work_operator_id', 'work_operator_name'],
    legacy: ['collector', 'sampler', 'milker_id', 'technician', 'veterinarian', 'person', 'handler', 'doctor'],
    regex: /work_operator|collector|sampler|milker|technician|veterinarian|^person$|handler|doctor/i
  },
  {
    key: 'time.system',
    label: 'System write/update time',
    target: 'created_at/updated_at only for local system write/update time',
    canonical: ['created_at', 'updated_at'],
    legacy: ['last_updated'],
    regex: /^created_at$|^updated_at$|last_updated/i
  },
  {
    key: 'time.business',
    label: 'Business occurrence or measurement time',
    target: 'occurred_at for events, measured_at for measurements, observed_at for traits, collected_at for samples',
    canonical: ['occurred_at', 'measured_at', 'observed_at', 'collected_at'],
    legacy: ['event_time', 'entry_time', 'transfer_time', 'exit_time', 'collection_date', 'milking_time'],
    regex: /occurred_at|measured_at|observed_at|collected_at|event_time|entry_time|transfer_time|exit_time|collection_date|milking_time/i
  },
  {
    key: 'time.recorded',
    label: 'Source record time',
    target: 'recorded_at for source/original record time',
    canonical: ['recorded_at'],
    legacy: ['source_created_at', 'source_recorded_at', 'record_time'],
    regex: /recorded_at|source_created_at|source_recorded_at|record_time/i
  },
  {
    key: 'source.traceability',
    label: 'Source traceability',
    target: 'source_table/source_record_id for one source, source_record_ids for multiple source records',
    canonical: ['source_table', 'source_record_id', 'source_record_ids'],
    legacy: ['source', 'data_source', 'source_type', 'source_doc_type', 'source_doc_id', 'source_entity_type', 'source_entity_id', 'trigger_source'],
    regex: /source_table|source_record_id|source_record_ids|^source$|data_source|source_type|source_doc|source_entity|trigger_source/i
  },
  {
    key: 'status.lifecycle',
    label: 'Lifecycle/status',
    target: 'status for entity lifecycle; *_status only when domain state machines differ and use dictionary scopes',
    canonical: ['status'],
    legacy: ['event_status', 'case_status', 'request_status', 'job_status', 'run_status', 'session_status', 'visit_status', 'order_status', 'cycle_status', 'parity_status'],
    regex: /(^status$|_status$|status_|state$)/i
  },
  {
    key: 'status.quality',
    label: 'Quality flag/status',
    target: 'quality_flag for record quality, qc_status for batch QC, quality_score only for numeric scores',
    canonical: ['quality_flag', 'qc_status', 'quality_score'],
    legacy: ['quality', 'quality_grade', 'quality_metrics'],
    regex: /quality_flag|qc_status|quality_score|quality_grade|quality_metrics|^quality$/i
  },
  {
    key: 'location.unit',
    label: 'Farm unit/location',
    target: 'farm_unit.id stored in unit_id/from_unit_id/to_unit_id/current_unit_id',
    canonical: ['unit_id', 'from_unit_id', 'to_unit_id', 'current_unit_id'],
    legacy: ['pen', 'from_pen', 'to_pen', 'target_pen', 'current_pen', 'source_pens'],
    regex: /unit_id|current_unit_id|from_unit_id|to_unit_id|source_unit_id|work_unit_id|storage_unit_id|(^|_)pen$|from_pen|to_pen|target_pen|current_pen|source_pens/i
  },
  {
    key: 'trait.measurement',
    label: 'Trait/measurement value',
    target: 'trait_observation for generic traits, domain fact tables only for high-volume facts',
    canonical: ['trait_id', 'numeric_value', 'text_value', 'json_value', 'unit'],
    legacy: ['trait_code', 'trait_name', 'value', 'reading_value', 'milk_yield', 'result_value', 'actual_value', 'predicted_value'],
    regex: /trait_id|trait_code|trait_name|numeric_value|text_value|json_value|reading_value|milk_yield|result_value|actual_value|predicted_value|(^|_)value$|^unit$/i
  },
  {
    key: 'free_text.payload',
    label: 'Free text and payload',
    target: 'notes for human notes, raw_payload for external raw payload, custom_values for event custom fields',
    canonical: ['notes', 'raw_payload', 'custom_values'],
    legacy: ['payload', 'description', 'remark', 'comment', 'request_payload', 'result_payload'],
    regex: /notes|raw_payload|custom_values|payload|description|remark|comment|request_payload|result_payload/i
  }
]

const CORE_TABLE_EXPECTATIONS = {
  animal_event: {
    must: ['animal_id', 'occurred_at', 'operator_name', 'source_table', 'source_record_id', 'event_status'],
    should: ['work_operator_name']
  },
  event_reproduction_detail: {
    must: ['event_id', 'animal_id', 'animal_number', 'occurred_at', 'recorded_at', 'operator_name', 'source_table', 'source_record_id'],
    should: ['work_operator_name', 'work_operator_id', 'cow_number']
  },
  event_health_detail: {
    must: ['event_id', 'animal_id', 'animal_number', 'occurred_at', 'recorded_at', 'operator_name', 'source_table', 'source_record_id'],
    should: ['work_operator_name', 'work_operator_id', 'cow_number']
  },
  event_production_detail: {
    must: ['event_id', 'animal_id', 'animal_number', 'occurred_at', 'recorded_at', 'operator_name', 'source_table', 'source_record_id'],
    should: ['work_operator_name', 'work_operator_id', 'cow_number']
  },
  event_medicine_detail: {
    must: ['event_id', 'animal_id', 'animal_number', 'occurred_at', 'recorded_at', 'operator_name', 'source_table', 'source_record_id'],
    should: ['work_operator_name', 'work_operator_id', 'cow_number']
  },
  event_movement_detail: {
    must: ['event_id', 'animal_id', 'animal_number', 'occurred_at', 'recorded_at', 'operator_name', 'source_table', 'source_record_id'],
    should: ['work_operator_name', 'work_operator_id', 'cow_number']
  },
  milk_measurement: {
    must: ['animal_id', 'measured_at', 'source_table', 'source_record_id', 'operator_name'],
    should: ['recorded_at', 'work_operator_name', 'work_operator_id']
  },
  milk_records: {
    must: ['animal_id', 'animal_number', 'measured_at', 'source_table', 'source_record_id', 'operator_name'],
    should: ['cow_id', 'recorded_at', 'work_operator_name', 'work_operator_id']
  },
  milking_session: {
    must: ['operator_name', 'source_table', 'source_record_id'],
    should: ['recorded_at', 'work_operator_name', 'work_operator_id']
  },
  milking_visit: {
    must: ['animal_id', 'measured_at', 'source_table', 'source_record_id', 'operator_name'],
    should: ['recorded_at', 'work_operator_name', 'work_operator_id']
  },
  trait_observation: {
    must: ['animal_id', 'trait_id', 'observed_at', 'source_record_id'],
    should: ['operator_name', 'work_operator_name', 'work_operator_id']
  },
  phenotype_records: {
    must: ['animal_id', 'animal_number', 'trait_id', 'observed_at', 'source_table', 'source_record_id'],
    should: ['cow_id', 'cow_number', 'collection_date', 'trait_code', 'operator_name', 'work_operator_name', 'work_operator_id']
  },
  sensor_reading: {
    must: ['animal_id', 'animal_number', 'measured_at', 'source_table', 'source_record_id', 'raw_payload'],
    should: ['cow_id', 'cow_number', 'operator_name']
  },
  sensor_readings: {
    must: ['animal_id', 'animal_number', 'measured_at', 'source_table', 'source_record_id', 'raw_payload'],
    should: ['cow_id', 'cow_number', 'operator_name']
  },
  operation_audit_log: {
    must: ['operator_name', 'created_at', 'request_payload', 'result_payload', 'status'],
    should: ['operator_id']
  },
  operation_audit_logs: {
    must: ['status', 'request_payload', 'result_payload'],
    should: ['operator_name', 'operator_id']
  },
  omics_samples: {
    must: ['animal_id', 'animal_number', 'collected_at', 'status', 'source_table', 'source_record_id'],
    should: ['cow_id', 'cow_number', 'collection_date', 'operator_name', 'work_operator_name', 'work_operator_id']
  }
}

const IMPORTANT_TABLES = new Set([
  ...Object.keys(CORE_TABLE_EXPECTATIONS),
  'animal',
  'cows',
  'animal_identifier',
  'animal_pen_assignment',
  'farm_unit',
  'pens',
  'entry_events',
  'transfer_events',
  'exit_events',
  'breeding_events',
  'veterinary_events',
  'cow_events',
  'data_quality_issue',
  'fact_lactation_305'
])

const TARGET_CHARSET = 'utf8mb4'
const TARGET_COLLATION = 'utf8mb4_unicode_ci'

function companionCandidatesForLegacy(familyKey, column, table = '') {
  const normalized = text(column).toLowerCase()
  const normalizedTable = text(table).toLowerCase()
  if (familyKey === 'animal_identity.reference') return ['animal_id']
  if (familyKey === 'animal_identity.number') return ['animal_number']
  if (familyKey === 'person.record_operator') return ['operator_id', 'operator_name']
  if (familyKey === 'person.work_operator') return ['work_operator_id', 'work_operator_name']
  if (familyKey === 'time.business') {
    if (normalized === 'collection_date') return ['observed_at', 'measured_at', 'occurred_at', 'collected_at']
    if (normalized === 'milking_time') return ['measured_at', 'occurred_at']
    return ['occurred_at', 'measured_at', 'observed_at']
  }
  if (familyKey === 'time.recorded') return ['recorded_at']
  if (familyKey === 'source.traceability') return ['source_table', 'source_record_id', 'source_record_ids']
  if (familyKey === 'location.unit') {
    if (normalized === 'from_pen') return ['from_unit_id']
    if (normalized === 'to_pen' || normalized === 'target_pen') return ['to_unit_id']
    if (normalized === 'current_pen') return ['current_unit_id']
    if (normalized === 'source_pens') return ['source_unit_ids', 'source_record_ids']
    return ['unit_id', 'current_unit_id', 'from_unit_id', 'to_unit_id']
  }
  if (familyKey === 'trait.measurement') {
    if (normalized === 'trait_code' || normalized === 'trait_name') return ['trait_id']
    if (normalized === 'milk_yield') return ['milk_yield', 'numeric_value']
    if (normalized === 'reading_value') return ['reading_value', 'numeric_value']
    if (normalized === 'value' && normalizedTable.startsWith('sensor_reading')) return ['reading_value']
    if (normalized === 'value' || normalized.endsWith('_value')) return ['numeric_value', 'text_value', 'json_value']
    return ['numeric_value', 'text_value', 'json_value', 'unit']
  }
  if (familyKey === 'status.lifecycle') return ['status']
  if (familyKey === 'status.quality') return ['quality_flag', 'qc_status', 'quality_score']
  if (familyKey === 'free_text.payload') return ['notes', 'raw_payload', 'custom_values']
  return []
}

const HIGH_RISK_COMPANION_FAMILIES = new Set([
  'animal_identity.reference',
  'animal_identity.number',
  'person.record_operator',
  'person.work_operator',
  'time.business',
  'time.recorded',
  'source.traceability',
  'location.unit'
])

const JOIN_SENSITIVE_FAMILIES = new Set([
  'animal_identity.reference',
  'animal_identity.number',
  'animal_identity.tag',
  'person.record_operator',
  'person.work_operator',
  'source.traceability',
  'location.unit'
])

const DOMAIN_SPECIFIC_KEEP_COLUMNS = new Set([
  'status.lifecycle:animal_event.event_status',
  'status.lifecycle:milking_session.session_status',
  'status.lifecycle:milking_visit.visit_status',
  'free_text.payload:cow_events.payload',
  'free_text.payload:operation_audit_log.request_payload',
  'free_text.payload:operation_audit_log.result_payload',
  'free_text.payload:operation_audit_logs.request_payload',
  'free_text.payload:operation_audit_logs.result_payload'
])

const ALLOWED_DOMAIN_COLUMN_RULES = [
  {
    family: 'animal_identity.reference',
    column: /^(parent|bull|calf|female|male)_animal_id$/,
    rationale: 'Relationship tables need role-specific animal references; the subject animal still uses animal_id.'
  },
  {
    family: 'source.traceability',
    column: /^source_tables$/,
    rationale: 'Snapshot/research datasets may record multiple source tables; record identity still uses source_record_ids.'
  },
  {
    family: 'status.lifecycle',
    column: /^[a-z0-9_]+_status$/,
    rationale: 'Domain state-machine status; values must be controlled by dictionary scopes or fixed enums.'
  },
  {
    family: 'status.quality',
    column: /^(quality_grade|quality_metrics)$/,
    rationale: 'Quality grade/metrics are domain quality attributes, not lifecycle states.'
  },
  {
    family: 'free_text.payload',
    column: /^(ack_payload|artifact_payload|command_payload|dictionary_payload|method_notes|surgery_description)$/,
    rationale: 'Domain payload or method notes with a specific semantic contract.'
  },
  {
    family: 'location.unit',
    column: /^(current_pen_id|parent_unit_id|source_unit_id|storage_unit_id|work_unit_id)$/,
    rationale: 'Domain-specific unit references; business writes still use farm_unit ids.'
  },
  {
    family: 'trait.measurement',
    column: /^(identifier_value|breeding_value|original_value|corrected_value|filter_value|metric_value|scope_value|p_value)$/,
    rationale: 'Domain value fields that are not generic phenotype observations.'
  },
  {
    family: 'trait.measurement',
    table: /^fact_/,
    column: /^(min_value|max_value|avg_value|sum_value|last_value|milk_yield_305)$/,
    rationale: 'Aggregate fact columns are materialized metrics, not raw trait observations.'
  }
]

function isDomainSpecificKeepColumn(familyKey, item) {
  return DOMAIN_SPECIFIC_KEEP_COLUMNS.has(`${familyKey}:${item.table}.${item.column}`)
}

function allowedDomainFieldRationale(familyKey, item) {
  if (isDomainSpecificKeepColumn(familyKey, item)) {
    return 'Kept as a domain state/payload field instead of duplicating into a generic column.'
  }
  const match = ALLOWED_DOMAIN_COLUMN_RULES.find((rule) => {
    if (rule.family !== familyKey) return false
    if (rule.table && !rule.table.test(item.table)) return false
    return rule.column.test(item.column)
  })
  return match?.rationale || ''
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function text(value) {
  return String(value ?? '').trim()
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)))
}

function sample(items, limit = 12) {
  return items.slice(0, limit)
}

async function queryAll(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params)
  return rows || []
}

async function loadColumns(connection) {
  const rows = await queryAll(
    connection,
    `SELECT table_name,
            column_name,
            column_type,
            data_type,
            is_nullable,
            column_default,
            ordinal_position,
            character_set_name,
            collation_name
       FROM information_schema.columns
      WHERE table_schema = ?
      ORDER BY table_name, ordinal_position`,
    [dbConfig.database]
  )
  const byTable = new Map()
  for (const row of rows) {
    const tableName = row.table_name ?? row.TABLE_NAME
    const columnName = row.column_name ?? row.COLUMN_NAME
    if (!byTable.has(tableName)) byTable.set(tableName, [])
    byTable.get(tableName).push({
      table: tableName,
      column: columnName,
      type: row.column_type ?? row.COLUMN_TYPE,
      dataType: row.data_type ?? row.DATA_TYPE,
      nullable: row.is_nullable ?? row.IS_NULLABLE,
      default: row.column_default ?? row.COLUMN_DEFAULT,
      ordinal: row.ordinal_position ?? row.ORDINAL_POSITION,
      charset: row.character_set_name ?? row.CHARACTER_SET_NAME,
      collation: row.collation_name ?? row.COLLATION_NAME
    })
  }
  return { rows, byTable }
}

async function loadRowCounts(connection, tables) {
  const result = {}
  for (const table of tables) {
    if (!/^[A-Za-z0-9_]+$/.test(table)) continue
    try {
      const rows = await queryAll(connection, `SELECT COUNT(*) AS count FROM \`${table}\``)
      result[table] = Number(rows[0]?.count || 0)
    } catch {
      result[table] = null
    }
  }
  return result
}

function classifyColumn(table, column) {
  const matches = []
  for (const family of FAMILY_DEFINITIONS) {
    if (family.regex.test(column)) {
      const flavor = family.canonical.includes(column)
        ? 'canonical'
        : family.legacy.includes(column)
          ? 'legacy'
          : 'variant'
      matches.push({ family: family.key, flavor, table, column })
    }
  }
  return matches
}

function buildFamilyReport(columns) {
  const byFamily = new Map()
  for (const row of columns) {
    const tableName = row.table_name ?? row.TABLE_NAME
    const columnName = row.column_name ?? row.COLUMN_NAME
    const columnType = row.column_type ?? row.COLUMN_TYPE
    const charset = row.character_set_name ?? row.CHARACTER_SET_NAME
    const collation = row.collation_name ?? row.COLLATION_NAME
    const matches = classifyColumn(tableName, columnName)
    for (const match of matches) {
      if (!byFamily.has(match.family)) {
        const definition = FAMILY_DEFINITIONS.find((item) => item.key === match.family)
        byFamily.set(match.family, {
          key: match.family,
          label: definition.label,
          target: definition.target,
          canonical: definition.canonical,
          legacy: definition.legacy,
          columns: [],
          columnNames: new Set(),
          tables: new Set(),
          legacyColumns: [],
          variantColumns: []
        })
      }
      const family = byFamily.get(match.family)
      const item = { table: tableName, column: columnName, type: columnType, charset, collation, flavor: match.flavor }
      family.columns.push(item)
      family.columnNames.add(columnName)
      family.tables.add(tableName)
      if (match.flavor === 'legacy') family.legacyColumns.push(item)
      if (match.flavor === 'variant') family.variantColumns.push(item)
    }
  }
  return Array.from(byFamily.values()).map((family) => ({
    ...family,
    columnNames: Array.from(family.columnNames).sort(),
    tables: Array.from(family.tables).sort(),
    fragmentationScore: family.columnNames.size,
    legacyCount: family.legacyColumns.length,
    variantCount: family.variantColumns.length
  }))
}

function buildExpectationFindings(byTable, rowCounts) {
  const findings = []
  for (const [table, expectation] of Object.entries(CORE_TABLE_EXPECTATIONS)) {
    const columns = new Set((byTable.get(table) || []).map((row) => row.column))
    if (!columns.size) {
      findings.push({
        severity: 'high',
        type: 'missing_core_table',
        table,
        message: `${table} is not present in live schema`
      })
      continue
    }
    const missingMust = expectation.must.filter((column) => !columns.has(column))
    const missingShould = expectation.should.filter((column) => !columns.has(column))
    if (missingMust.length) {
      findings.push({
        severity: 'high',
        type: 'missing_required_canonical_columns',
        table,
        rowCount: rowCounts[table],
        missing: missingMust
      })
    }
    if (missingShould.length) {
      findings.push({
        severity: 'medium',
        type: 'missing_reuse_companion_columns',
        table,
        rowCount: rowCounts[table],
        missing: missingShould
      })
    }
  }
  return findings
}

function buildLegacyFieldFindings(familyReports, rowCounts) {
  const findings = []
  for (const family of familyReports) {
    const allowedDomainFields = family.variantColumns
      .map((item) => ({
        ...item,
        rowCount: rowCounts[item.table],
        rationale: allowedDomainFieldRationale(family.key, item)
      }))
      .filter((item) => item.rationale)
    const newAliasViolations = family.variantColumns
      .filter((item) => !allowedDomainFieldRationale(family.key, item))
      .map((item) => ({
        ...item,
        rowCount: rowCounts[item.table],
        target: family.target,
        suggestion: `Do not introduce ${item.column}; reuse ${family.canonical.join('/')} or register it as an allowed domain field with a rationale.`
      }))
    if (newAliasViolations.length) {
      findings.push({
        severity: 'high',
        type: 'new_alias_violation',
        family: family.key,
        target: family.target,
        columns: newAliasViolations
      })
    }
    if (allowedDomainFields.length) {
      findings.push({
        severity: 'low',
        type: 'allowed_domain_field',
        family: family.key,
        target: family.target,
        columns: allowedDomainFields
      })
    }
    if (family.fragmentationScore >= 8) {
      const disallowedNames = unique(newAliasViolations.map((item) => item.column))
      const allowedNames = unique(allowedDomainFields.map((item) => item.column))
      findings.push({
        severity: newAliasViolations.length ? 'high' : 'medium',
        type: 'high_field_name_fragmentation',
        family: family.key,
        target: family.target,
        columnNameCount: family.fragmentationScore,
        columnNames: family.columnNames,
        disallowedColumnNames: disallowedNames,
        allowedDomainColumnNames: allowedNames,
        legacyColumnNames: unique(family.legacyColumns.map((item) => item.column))
      })
    }
    const importantLegacy = family.legacyColumns.filter((item) => IMPORTANT_TABLES.has(item.table))
    if (importantLegacy.length) {
      const familyColumnsByTable = new Map()
      for (const item of family.columns) {
        if (!familyColumnsByTable.has(item.table)) familyColumnsByTable.set(item.table, new Set())
        familyColumnsByTable.get(item.table).add(item.column)
      }
      const withoutCompanion = []
      const withCompanion = []
      const domainSpecificKeep = []
      for (const item of importantLegacy) {
        const tableColumns = familyColumnsByTable.get(item.table) || new Set()
        const companions = companionCandidatesForLegacy(family.key, item.column, item.table)
        const presentCompanions = companions.filter((column) => tableColumns.has(column))
        const payload = {
          ...item,
          companionCandidates: companions,
          presentCompanions,
          rowCount: rowCounts[item.table]
        }
        const domainRationale = allowedDomainFieldRationale(family.key, item)
        if (presentCompanions.length) {
          withCompanion.push(payload)
        } else if (domainRationale) {
          domainSpecificKeep.push({
            ...payload,
            rationale: domainRationale
          })
        } else {
          withoutCompanion.push(payload)
        }
      }
      if (withoutCompanion.length) {
        findings.push({
          severity: HIGH_RISK_COMPANION_FAMILIES.has(family.key) ? 'high' : 'medium',
          type: 'legacy_field_without_canonical_companion',
          family: family.key,
          target: family.target,
          columns: withoutCompanion
        })
      }
      if (withCompanion.length) {
        findings.push({
          severity: 'low',
          type: 'legacy_field_with_canonical_companion',
          family: family.key,
          target: family.target,
          columns: withCompanion
        })
      }
      if (domainSpecificKeep.length) {
        findings.push({
          severity: 'low',
          type: 'domain_specific_field_kept_without_generic_duplicate',
          family: family.key,
          target: family.target,
          columns: domainSpecificKeep
        })
      }
    }
  }
  return findings
}

function buildCollationFindings(familyReports, rowCounts) {
  const findings = []
  for (const family of familyReports) {
    const mismatched = family.columns
      .filter((item) => item.collation && (item.charset !== TARGET_CHARSET || item.collation !== TARGET_COLLATION))
      .filter((item) => IMPORTANT_TABLES.has(item.table) || JOIN_SENSITIVE_FAMILIES.has(family.key))
      .map((item) => ({
        ...item,
        expectedCharset: TARGET_CHARSET,
        expectedCollation: TARGET_COLLATION,
        rowCount: rowCounts[item.table]
      }))
    if (!mismatched.length) continue
    findings.push({
      severity: JOIN_SENSITIVE_FAMILIES.has(family.key) ? 'high' : 'medium',
      type: 'collation_mismatch_on_reuse_family',
      family: family.key,
      target: family.target,
      columns: mismatched
    })
  }
  return findings
}

function walkFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(full, files)
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full)
    }
  }
  return files
}

function scanSourceTerms() {
  const terms = [
    'collector',
    'sampler',
    'milker',
    'technician',
    'veterinarian',
    'recorder',
    'operator',
    'source_created_at',
    'sourceCreatedAt',
    'event_time',
    'collection_date',
    'cow_id',
    'cow_number',
    'animal_id',
    'animal_number',
    'from_pen',
    'to_pen',
    'current_pen',
    'source_type',
    'data_source'
  ]
  const cnTerms = ['采集人', '采样人', '测定人', '挤奶员', '兽医', '育种员', '创建人', '上传人', '录入人', '记录人', '操作人', '户主']
  const files = SOURCE_ROOTS.flatMap((root) => walkFiles(path.join(projectRoot, root))).filter((file, index, arr) => arr.indexOf(file) === index)
  const counts = Object.fromEntries([...terms, ...cnTerms].map((term) => [term, { count: 0, samples: [] }]))
  for (const file of files) {
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const rel = path.relative(projectRoot, file).replace(/\\/g, '/')
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      for (const term of Object.keys(counts)) {
        if (!line.includes(term)) continue
        counts[term].count += 1
        if (counts[term].samples.length < 8) {
          counts[term].samples.push({ file: rel, line: i + 1, text: line.trim().slice(0, 220) })
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(counts).filter(([, value]) => value.count > 0))
}

function parseImportColumnCalls() {
  const file = path.join(projectRoot, 'src', 'services', 'import-templates.ts')
  if (!fs.existsSync(file)) return { findings: [], source: null }
  const content = fs.readFileSync(file, 'utf8')
  const lines = content.split(/\r?\n/)
  const findings = []
  const calls = extractImportColumnCalls(content)
  const riskyLabels = [
    { regex: /记录人|操作人|创建人|上传人|录入人|采集人|采样人|测定人|挤奶员|兽医|育种员/, expected: 'operator' },
    { regex: /状态|级别|结果|质量标记|班次|品种|圈舍|原因|疾病|药品|疫苗|单位|性别/, expected: 'dictionary optionSource' }
  ]
  for (const call of calls) {
    const { key, label, targetField, type, line, args } = call
    const hasDictionaryConstraint = type === 'select' && !/undefined\s*,\s*undefined\s*\)?$/.test(args)
    for (const risky of riskyLabels) {
      if (!risky.regex.test(`${key} ${label} ${targetField}`)) continue
      if (type === 'text' && risky.expected !== 'operator') {
        findings.push({
          severity: 'medium',
          type: 'import_template_text_for_dictionary_like_field',
          line,
          key,
          label,
          targetField,
          columnType: type,
          expected: risky.expected
        })
      }
      if (risky.expected === 'dictionary optionSource' && type === 'select' && !hasDictionaryConstraint) {
        findings.push({
          severity: 'high',
          type: 'import_template_select_without_options',
          line,
          key,
          label,
          targetField,
          columnType: type,
          expected: 'options or optionSource'
        })
      }
      if (risky.expected === 'operator' && !/operator_name|work_operator_name|operator_id|work_operator_id/.test(targetField)) {
        findings.push({
          severity: 'medium',
          type: 'import_template_person_semantic_not_using_operator_family',
          line,
          key,
          label,
          targetField,
          expected: 'operator_name or work_operator_name'
        })
      }
    }
  }
  return { findings, source: 'src/services/import-templates.ts' }
}

function scanForbiddenUserFacingFieldTerms() {
  const findings = []
  const forbidden = [/外部报告/, /外部报表/]
  const allowedFiles = new Set([
    '脚本/audit-schema-reuse-convergence.mjs',
    '脚本/audit-shift-milk-import-package-semantics.mjs'
  ])
  const files = SOURCE_ROOTS.flatMap((root) => walkFiles(path.join(projectRoot, root))).filter(
    (file, index, arr) => arr.indexOf(file) === index
  )
  for (const file of files) {
    const rel = path.relative(projectRoot, file).replace(/\\/g, '/')
    if (allowedFiles.has(rel)) continue
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const lines = content.split(/\r?\n/)
    lines.forEach((line, index) => {
      if (!forbidden.some((regex) => regex.test(line))) return
      findings.push({
        severity: 'high',
        type: 'forbidden_user_facing_external_report_term',
        file: rel,
        line: index + 1,
        message: 'Use reusable field names such as parity_no/days_in_milk/milk_yield_305/source_table/raw_payload instead of exposing external-report terminology.',
        text: line.trim().slice(0, 220)
      })
    })
  }
  return findings
}

function extractImportColumnCalls(content) {
  const calls = []
  let index = 0
  while (index < content.length) {
    const start = content.indexOf('column(', index)
    if (start < 0) break
    let depth = 0
    let quote = ''
    let end = start
    for (; end < content.length; end += 1) {
      const ch = content[end]
      const prev = content[end - 1]
      if (quote) {
        if (ch === quote && prev !== '\\') quote = ''
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch
        continue
      }
      if (ch === '(') depth += 1
      if (ch === ')') {
        depth -= 1
        if (depth === 0) {
          end += 1
          break
        }
      }
    }
    const call = content.slice(start, end)
    const strings = Array.from(call.matchAll(/['"`]([^'"`]+)['"`]/g)).map((match) => match[1])
    if (strings.length >= 4) {
      calls.push({
        line: content.slice(0, start).split(/\r?\n/).length,
        args: call,
        key: strings[0],
        label: strings[1],
        targetField: strings[2],
        type: strings[3]
      })
    }
    index = end || start + 7
  }
  return calls
}

function severityRank(value) {
  return { high: 0, medium: 1, low: 2 }[value] ?? 9
}

function buildMarkdown(report) {
  const topFindings = report.findings
    .slice()
    .sort((left, right) => severityRank(left.severity) - severityRank(right.severity))
    .slice(0, 40)
  const familyLines = report.familyReports
    .slice()
    .sort((left, right) => right.fragmentationScore - left.fragmentationScore)
    .map(
      (family) =>
        `| ${family.key} | ${family.fragmentationScore} | ${family.legacyCount} | ${family.target} | ${sample(family.columnNames, 14).join(', ')} |`
    )
    .join('\n')
  const findingLines = topFindings
    .map((finding) => {
      const detail =
        finding.table ||
        finding.family ||
        finding.type ||
        ''
      const columns = finding.missing
        ? `missing=${finding.missing.join(', ')}`
        : finding.columns
          ? sample(finding.columns.map((item) => `${item.table}.${item.column}`), 10).join(', ')
          : finding.columnNames
            ? sample(finding.columnNames, 12).join(', ')
            : finding.message || ''
      return `| ${finding.severity} | ${finding.type} | ${detail} | ${columns} |`
    })
    .join('\n')
  const sourceLines = Object.entries(report.sourceTermScan)
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, 30)
    .map(([term, value]) => `| ${term} | ${value.count} | ${value.samples[0]?.file || ''}:${value.samples[0]?.line || ''} |`)
    .join('\n')
  const gateLines = [
    `- New alias violations: ${report.governanceGate.newAliasViolations.length}`,
    `- Legacy aliases kept for compatibility: ${report.governanceGate.legacyAliases.length}`,
    `- Allowed domain fields: ${report.governanceGate.allowedDomainFields.length}`
  ].join('\n')
  const newAliasLines = report.governanceGate.newAliasViolations
    .slice(0, 30)
    .map((item) => `| ${item.family} | ${item.table}.${item.column} | ${item.target} |`)
    .join('\n')
  const allowedDomainLines = report.governanceGate.allowedDomainFields
    .slice(0, 30)
    .map((item) => `| ${item.family} | ${item.table}.${item.column} | ${item.rationale} |`)
    .join('\n')

  return `# Schema Reuse Convergence Audit

Generated: ${report.generatedAt}

Database: ${report.database.host}:${report.database.port}/${report.database.database}

## Executive Summary

- Live tables scanned: ${report.tableCount}
- Live columns scanned: ${report.columnCount}
- Findings: high=${report.findingCounts.high || 0}, medium=${report.findingCounts.medium || 0}, low=${report.findingCounts.low || 0}
- Collation mismatches on reuse families: ${report.collationMismatchCount}
- Report JSON: ${path.relative(projectRoot, OUTPUT_JSON).replace(/\\/g, '/')}

## Field Families

| Family | Distinct column names | Legacy columns | Target reuse family | Sample column names |
| --- | ---: | ---: | --- | --- |
${familyLines}

## Top Findings

| Severity | Type | Scope | Detail |
| --- | --- | --- | --- |
${findingLines}

## Governance Gate

${gateLines}

### New Alias Violations

| Family | Column | Target |
| --- | --- | --- |
${newAliasLines || '| - | - | - |'}

### Allowed Domain Fields

| Family | Column | Rationale |
| --- | --- | --- |
${allowedDomainLines || '| - | - | - |'}

## Compatibility Alias Policy

- legacy_field_with_canonical_companion means an old column still exists for compatibility, but the same table has the reusable canonical companion. It is not a blocking schema bug.
- legacy_field_without_canonical_companion means the old semantic is still the only structured home for that concept. These are the fields that need real schema work.
- collation_mismatch_on_reuse_family is a real bug because reused identity/person/source/location fields may fail joins across tables.
- new_alias_violation means a non-canonical, non-legacy, non-approved domain alias exists. This is a gate failure for new work.
- allowed_domain_field means the field is intentionally domain-specific and must keep a documented rationale.

## Source Term Hotspots

| Term | Count | First sample |
| --- | ---: | --- |
${sourceLines}

## Recommended Convergence Rules

1. Use animal/animal_number as the standard identity family; keep cow_id/cow_number as compatibility projection only.
2. Split people into two reusable roles: operator_name for recorder/uploader, work_operator_name for the on-site executor resolved through persons.role.
3. Keep created_at/updated_at for local system write time only; use recorded_at for source record time; use occurred_at/measured_at/observed_at for business time.
4. Store one-source traceability in source_table/source_record_id and multi-source traceability in source_record_ids; do not overload source/data_source/source_type with record identity.
5. Use farm_unit.id through unit_id/from_unit_id/to_unit_id/current_unit_id for real location writes; keep pen/from_pen/to_pen/current_pen as legacy display aliases.
6. Use dictionary scopes for status/event_status/quality_flag/qc_status instead of free text values.
7. Use trait_observation for generic numeric traits; add domain fact tables only when volume or business aggregation justifies it.
`
}

async function main() {
  ensureDir(reportDir)
  const connection = await mysql.createConnection(dbConfig)
  try {
    const { rows: columns, byTable } = await loadColumns(connection)
    const rowCounts = await loadRowCounts(connection, Array.from(byTable.keys()))
    const familyReports = buildFamilyReport(columns)
    const expectationFindings = buildExpectationFindings(byTable, rowCounts)
    const legacyFindings = buildLegacyFieldFindings(familyReports, rowCounts)
    const collationFindings = buildCollationFindings(familyReports, rowCounts)
    const importTemplate = parseImportColumnCalls()
    const forbiddenUserFacingFieldTerms = scanForbiddenUserFacingFieldTerms()
    const sourceTermScan = scanSourceTerms()
    const findings = [
      ...expectationFindings,
      ...legacyFindings,
      ...collationFindings,
      ...importTemplate.findings,
      ...forbiddenUserFacingFieldTerms
    ].sort(
      (left, right) => severityRank(left.severity) - severityRank(right.severity)
    )
    const findingCounts = findings.reduce((acc, finding) => {
      acc[finding.severity] = (acc[finding.severity] || 0) + 1
      return acc
    }, {})
    const report = {
      generatedAt: new Date().toISOString(),
      database: {
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database
      },
      tableCount: byTable.size,
      columnCount: columns.length,
      findingCounts,
      findings,
      familyReports,
      collationMismatchCount: collationFindings.reduce((count, finding) => count + (finding.columns?.length || 0), 0),
      governanceGate: {
        newAliasViolations: findings
          .filter((finding) => finding.type === 'new_alias_violation')
          .flatMap((finding) =>
            (finding.columns || []).map((column) => ({
              family: finding.family,
              target: finding.target,
              table: column.table,
              column: column.column,
              suggestion: column.suggestion
            }))
          ),
        legacyAliases: findings
          .filter((finding) => finding.type === 'legacy_field_with_canonical_companion')
          .flatMap((finding) =>
            (finding.columns || []).map((column) => ({
              family: finding.family,
              target: finding.target,
              table: column.table,
              column: column.column,
              presentCompanions: column.presentCompanions || []
            }))
          ),
        allowedDomainFields: findings
          .filter((finding) => finding.type === 'allowed_domain_field' || finding.type === 'domain_specific_field_kept_without_generic_duplicate')
          .flatMap((finding) =>
            (finding.columns || []).map((column) => ({
              family: finding.family,
              target: finding.target,
              table: column.table,
              column: column.column,
              rationale: column.rationale || ''
            }))
          )
      },
      sourceTermScan,
      rowCounts: Object.fromEntries(Object.entries(rowCounts).filter(([table]) => IMPORTANT_TABLES.has(table))),
      importTemplateSource: importTemplate.source,
      forbiddenUserFacingFieldTerms
    }
    fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), 'utf8')

    console.log(`schema reuse convergence audit complete`)
    console.log(`tables=${report.tableCount} columns=${report.columnCount}`)
    console.log(`findings high=${findingCounts.high || 0} medium=${findingCounts.medium || 0} low=${findingCounts.low || 0}`)
    console.log(`json=${path.relative(projectRoot, OUTPUT_JSON)}`)
    console.log(`summary=${path.relative(projectRoot, OUTPUT_MD)}`)
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
