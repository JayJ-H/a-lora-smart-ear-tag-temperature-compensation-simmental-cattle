import fs from 'node:fs/promises'
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

const mysqlConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 9193),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management',
  connectionLimit: Number(process.env.MYSQL_POOL_LIMIT || 10)
}

const apiBaseUrl = (
  process.env.PRODUCTION_BASE_URL ||
  `http://127.0.0.1:${process.env.API_HOST_PORT || process.env.WEB_PORT || 9192}`
).replace(/\/$/, '')
const adminUser = process.env.PRODUCTION_ADMIN_USER || process.env.ADMIN_USER || ''
const adminPassword = process.env.PRODUCTION_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || ''

const DEFAULT_TABLES = [
  'animal',
  'cows',
  'sensors',
  'sensor_reading',
  'sensor_readings',
  'events',
  'devices',
  'persons',
  'pens',
  'diseases',
  'medicines',
  'transfer_reasons',
  'milk_measurement',
  'milk_records',
  'milk_quality_standards',
  'lactation_curves',
  'feed_records',
  'feed_formulas',
  'feed_inventory',
  'breeding_records',
  'reproduction_cycles',
  'alerts',
  'workflow_templates',
  'workflow_instances',
  'automated_actions',
  'smart_transfer_rules',
  'reminder_rules',
  'kpi_dashboards',
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
  'production_baseline_manifest',
  'operation_audit_log',
  'operation_audit_logs',
  'entry_events',
  'transfer_events',
  'exit_events',
  'breeding_events',
  'veterinary_events',
  'health_scores',
  'kpi_data',
  'economic_data'
]

const PRODUCTION_BASELINE_DOMAINS = [
  {
    domain: '奶厅与泌乳性能',
    tables: ['milk_records', 'milk_quality_standards', 'lactation_curves']
  },
  {
    domain: '泌乳传感器与硬件集成',
    tables: [
      'sensor_status',
      'sensor_calibrations',
      'hardware_devices',
      'integration_protocols',
      'data_synchronizations'
    ]
  },
  {
    domain: '繁殖育种',
    tables: ['breeding_records', 'reproduction_cycles', 'breeding_events']
  },
  {
    domain: '组学闭环',
    tables: [
      'omics_samples',
      'omics_datasets',
      'omics_markers',
      'multi_omics_associations',
      'breeding_analyses'
    ]
  },
  {
    domain: '生产经营闭环',
    tables: [
      'feed_formulas',
      'feed_records',
      'feed_inventory',
      'cost_items',
      'revenue_items',
      'economic_analysis',
      'budget_plans',
      'kpi_dashboards',
      'kpi_dashboard_data',
      'device_maintenance'
    ]
  }
]

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

const CATEGORY_LABELS = {
  animal_master: '动物主档',
  milk: '奶量',
  sensor: '传感器',
  audit: '审计',
  collation: 'collation',
  other: '其他'
}

const CATEGORY_ORDER = ['animal_master', 'milk', 'sensor', 'audit', 'collation', 'other']

const CORE_TABLES = [
  'animal',
  'cows',
  'sensors',
  'sensor_reading',
  'alerts',
  'health_scores',
  'automated_actions',
  'smart_transfer_rules',
  'reminder_rules',
  'workflow_templates',
  'workflow_instances',
  'integration_protocols',
  'data_synchronizations',
  'hardware_devices',
  'hardware_alerts'
]

const SCAN_TARGETS = [
  path.join(projectRoot, 'src', 'api', 'cow.ts'),
  path.join(projectRoot, 'src', 'views'),
  path.join(projectRoot, 'scripts', 'mysql-backend-server.mjs')
]

const FRONTEND_PRODUCTION_SCAN_TARGETS = [
  path.join(projectRoot, 'src', 'api'),
  path.join(projectRoot, 'src', 'views', 'dashboard'),
  path.join(projectRoot, 'src', 'views', 'statistics'),
  path.join(projectRoot, 'src', 'views', 'cow-info')
]

function normalizeTableName(name) {
  return String(name || '')
    .trim()
    .replace(/-/g, '_')
    .replace(/[^\w]/g, '')
    .toLowerCase()
}

function rel(filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/')
}

function countMatches(text, re) {
  return Array.from(text.matchAll(re)).length
}

function lineNumbersFor(text, re) {
  const lines = text.split(/\r?\n/)
  const hits = []
  lines.forEach((line, index) => {
    if (re.test(line)) hits.push(index + 1)
    re.lastIndex = 0
  })
  return hits
}

function safeJsonParse(value, fallback = {}) {
  if (value && typeof value === 'object') return value
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function textIncludesAny(row, tokens) {
  const text = JSON.stringify(row || {}).toLowerCase()
  return tokens.some((token) => text.includes(String(token).toLowerCase()))
}

function valueOf(row, ...names) {
  for (const name of names) {
    const value = row?.[name]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function uniqueStrings(values) {
  return [
    ...new Set(
      values
        .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
        .map((value) => String(value).trim())
    )
  ]
}

function makeIdSet(rows, selectors) {
  const values = new Set()
  for (const row of rows || []) {
    for (const selector of selectors) {
      const value = valueOf(row, selector)
      if (value !== undefined && value !== null && value !== '') values.add(String(value))
    }
  }
  return values
}

function hasSetValue(set, values) {
  return values.some((value) => value !== undefined && value !== null && value !== '' && set.has(String(value)))
}

function categorizeBlocker(item) {
  const haystack = `${item.area || ''} ${item.item || ''} ${item.detail || ''}`.toLowerCase()
  if (haystack.includes('collation')) return 'collation'
  if (haystack.includes('milk') || haystack.includes('milking') || haystack.includes('奶') || haystack.includes('泌乳')) return 'milk'
  if (haystack.includes('sensor') || haystack.includes('device') || haystack.includes('hardware') || haystack.includes('传感')) return 'sensor'
  if (haystack.includes('audit') || haystack.includes('operation_audit') || haystack.includes('审计')) return 'audit'
  if (haystack.includes('animal') || haystack.includes('cow') || haystack.includes('cows') || haystack.includes('牛') || haystack.includes('主档')) {
    return 'animal_master'
  }
  return 'other'
}

function withCategory(item) {
  return { category: categorizeBlocker(item), ...item }
}

function summarizeBlockersByCategory(items) {
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
  for (const item of items) {
    const category = item.category || categorizeBlocker(item)
    if (!summary[category]) {
      summary[category] = { label: category, blockers: 0, warnings: 0, total: 0 }
    }
    summary[category].total += 1
    if (item.severity === 'blocker') summary[category].blockers += 1
    if (item.severity === 'warning') summary[category].warnings += 1
  }
  return summary
}

async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function listFiles(target) {
  const exists = await pathExists(target)
  if (!exists) return []

  const stat = await fs.stat(target)
  if (stat.isFile()) return [target]
  if (!stat.isDirectory()) return []

  const entries = await fs.readdir(target, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(target, entry.name)
      if (entry.isDirectory()) return listFiles(fullPath)
      if (entry.isFile()) return Promise.resolve([fullPath])
      return Promise.resolve([])
    })
  )
  return nested.flat()
}

async function scanStaticFiles() {
  const files = (await Promise.all(SCAN_TARGETS.map(listFiles)))
    .flat()
    .filter((filePath) => /\.(mjs|js|ts|vue)$/.test(filePath))
  const findings = []

  for (const filePath of files) {
    const text = await fs.readFile(filePath, 'utf8')
    const mathRandom = countMatches(text, /Math\.random/g)
    const mock = countMatches(text, /\bmock\w*/gi)
    const generateRandomRecords = countMatches(text, /generateRandomRecords/g)

    if (mathRandom || mock || generateRandomRecords) {
      findings.push({
        file: rel(filePath),
        mathRandom,
        mock,
        generateRandomRecords,
        total: mathRandom + mock + generateRandomRecords,
        lines: {
          mathRandom: lineNumbersFor(text, /Math\.random/g).slice(0, 20),
          mock: lineNumbersFor(text, /\bmock\w*/gi).slice(0, 20),
          generateRandomRecords: lineNumbersFor(text, /generateRandomRecords/g).slice(0, 20)
        }
      })
    }
  }

  return findings.sort((a, b) => b.total - a.total || a.file.localeCompare(b.file))
}

function blockRangesFor(text, re) {
  const ranges = []
  let match
  while ((match = re.exec(text))) {
    const braceStart = text.indexOf('{', match.index)
    if (braceStart === -1) continue
    let depth = 0
    for (let index = braceStart; index < text.length; index += 1) {
      const char = text[index]
      if (char === '{') depth += 1
      if (char === '}') depth -= 1
      if (depth === 0) {
        ranges.push([match.index, index + 1])
        break
      }
    }
  }
  return ranges
}

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length
}

function isInsideRange(offset, ranges) {
  return ranges.some(([start, end]) => offset >= start && offset <= end)
}

function suspiciousMatches(text, pattern, allowedRanges) {
  const matches = []
  let match
  while ((match = pattern.exec(text))) {
    if (!isInsideRange(match.index, allowedRanges)) {
      matches.push({
        line: lineNumberAt(text, match.index),
        token: match[0].slice(0, 120)
      })
    }
  }
  return matches
}

async function scanFrontendMockIsolation() {
  const files = (await Promise.all(FRONTEND_PRODUCTION_SCAN_TARGETS.map(listFiles)))
    .flat()
    .filter((filePath) => /\.(ts|vue)$/.test(filePath))
  const findings = []

  for (const filePath of files) {
    const text = await fs.readFile(filePath, 'utf8')
    const allowedDemoRanges = blockRangesFor(text, /\bif\s*\(\s*isDemoMode\s*\)/g)
    const relative = rel(filePath)
    const cowApiDemoExportsAreIsolated =
      relative === 'src/api/cow.ts' &&
      /function\s+selectCowApi/.test(text) &&
      /if\s*\(\s*isDemoMode\s*\)\s*return\s+demoApi/.test(text) &&
      /createUnavailableApiProxy/.test(text)
    const mathRandom = cowApiDemoExportsAreIsolated
      ? []
      : suspiciousMatches(text, /Math\.random/g, allowedDemoRanges)
    const backendFallback = suspiciousMatches(
      text,
      /isBackendMode\s*\?\s*createBackendApiProxy[\s\S]{0,120}:\s*mock\w+|!\s*isBackendMode[\s\S]{0,160}\b(?:cowApi|sensorApi|mock\w+)/g,
      allowedDemoRanges
    )
    const directMockExport = suspiciousMatches(
      text,
      /export\s+const\s+\w+Api[\s\S]{0,160}:\s*mock\w+|selectCowApi[\s\S]{0,80}mock\w+/g,
      allowedDemoRanges
    ).filter((item) => !/selectCowApi/.test(item.token))

    if (mathRandom.length || backendFallback.length || directMockExport.length) {
      findings.push({
        file: relative,
        mathRandom,
        backendFallback,
        directMockExport,
        total: mathRandom.length + backendFallback.length + directMockExport.length
      })
    }
  }

  return findings.sort((a, b) => b.total - a.total || a.file.localeCompare(b.file))
}

function sliceBetween(text, startNeedle, endNeedle) {
  const start = text.indexOf(startNeedle)
  if (start === -1) return ''
  const end = endNeedle ? text.indexOf(endNeedle, start + startNeedle.length) : -1
  return text.slice(start, end === -1 ? undefined : end)
}

async function scanBackendRisks() {
  const backendPath = path.join(projectRoot, 'scripts', 'mysql-backend-server.mjs')
  const text = await fs.readFile(backendPath, 'utf8')
  const executeBlock = sliceBetween(
    text,
    "if (scope === 'automation' && method === 'executeAutomationCheck')",
    "if (scope === 'automation' && method === 'startWorkflow')"
  )
  const diagnosticsBlock = sliceBetween(
    text,
    "if (scope === 'hardware' && method === 'runSystemDiagnostics')",
    "if (scope === 'hardware' && method === 'registerHardwareDevice')"
  )
  const protocolBlock = sliceBetween(
    text,
    "if (scope === 'hardware' && method === 'testProtocolConnection')",
    "if (scope === 'hardware' && method === 'triggerDataSynchronization')"
  )

  return {
    file: 'scripts/mysql-backend-server.mjs',
    mathRandomCount: countMatches(text, /Math\.random/g),
    noopSuccessCount: countMatches(text, /success:\s*true,\s*noop:\s*true/g),
    noopTokenCount: countMatches(text, /\bnoop\b/g),
    unsupportedWriteGuard: text.includes('throw createUnsupportedMethodError(scope, method)'),
    targetHandlers: {
      executeAutomationCheck: {
        found: Boolean(executeBlock),
        usesMathRandom: /Math\.random/.test(executeBlock),
        usesDbHelper: /executeAutomationCheckFromDb/.test(executeBlock)
      },
      testProtocolConnection: {
        found: Boolean(protocolBlock),
        usesMathRandom: /Math\.random/.test(protocolBlock),
        usesDbHelper: /testProtocolConnectionFromDb/.test(protocolBlock)
      },
      runSystemDiagnostics: {
        found: Boolean(diagnosticsBlock),
        staticOnlyStub: /success:\s*true[\s\S]{0,120}diagnosticsId/.test(diagnosticsBlock) && !/buildSystemStatus/.test(diagnosticsBlock),
        usesSystemStatus: /buildSystemStatus/.test(diagnosticsBlock)
      }
    }
  }
}

async function tableExists(pool, tableName) {
  const table = normalizeTableName(tableName)
  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS total
      FROM information_schema.tables
      WHERE table_schema = ? AND table_name = ?
    `,
    [mysqlConfig.database, table]
  )
  return Number(rows?.[0]?.total || 0) > 0
}

async function countTable(pool, tableName) {
  const table = normalizeTableName(tableName)
  const exists = await tableExists(pool, table)
  if (!exists) {
    return { table, exists: false, count: null, error: 'table_missing' }
  }

  try {
    const [rows] = await pool.query(`SELECT COUNT(*) AS count FROM \`${table}\``)
    return { table, exists: true, count: Number(rows?.[0]?.count || 0), error: null }
  } catch (error) {
    return { table, exists: true, count: null, error: error?.message || String(error) }
  }
}

async function queryScalar(pool, sql, params = [], fallback = 0) {
  const [rows] = await pool.query(sql, params)
  const value = Object.values(rows?.[0] || {})[0]
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

async function queryRows(pool, sql, params = []) {
  const [rows] = await pool.query(sql, params)
  return Array.isArray(rows) ? rows : []
}

async function getModelConvergenceEvidence(pool) {
  const [dbRows] = await pool.query('SELECT @@collation_database AS database_collation')
  const databaseCollation = dbRows?.[0]?.database_collation || null
  const [tableRows] = await pool.query(
    `
      SELECT
        table_name AS table_name,
        table_collation AS table_collation,
        table_rows AS table_rows
      FROM information_schema.tables
      WHERE table_schema = ?
        AND table_name IN (${MODEL_CONVERGENCE_TABLES.map(() => '?').join(', ')})
    `,
    [mysqlConfig.database, ...MODEL_CONVERGENCE_TABLES]
  )
  const [columnRows] = await pool.query(
    `
      SELECT
        table_name AS table_name,
        column_name AS column_name,
        column_type AS column_type,
        is_nullable AS is_nullable,
        column_key AS column_key,
        collation_name AS collation_name
      FROM information_schema.columns
      WHERE table_schema = ?
        AND table_name IN (${MODEL_CONVERGENCE_TABLES.map(() => '?').join(', ')})
    `,
    [mysqlConfig.database, ...MODEL_CONVERGENCE_TABLES]
  )
  const tableMap = new Map(tableRows.map((row) => [row.table_name, row]))
  const columnMap = new Map()
  for (const row of columnRows) {
    if (!columnMap.has(row.table_name)) columnMap.set(row.table_name, new Map())
    columnMap.get(row.table_name).set(row.column_name, row)
  }
  const requiredColumns = [
    ['animal', 'id', 'animal primary key'],
    ['animal', 'animal_number', 'animal number'],
    ['cows', 'id', 'compat animal id'],
    ['cows', 'cow_number', 'compat animal number'],
    ['milk_measurement', 'animal_id', 'canonical milk animal reference'],
    ['milk_measurement', 'measured_at', 'canonical milk timestamp'],
    ['milk_measurement', 'milk_yield', 'canonical milk amount'],
    ['milk_records', 'cow_id', 'compat milk animal reference'],
    ['milk_records', 'milking_time', 'compat milk timestamp'],
    ['milk_records', 'volume', 'compat milk amount'],
    ['sensor_reading', 'animal_id', 'canonical sensor animal reference'],
    ['sensor_reading', 'metric_code', 'canonical sensor metric'],
    ['sensor_reading', 'measured_at', 'canonical sensor timestamp'],
    ['sensor_readings', 'cow_id', 'compat sensor animal reference'],
    ['operation_audit_log', 'animal_id', 'canonical audit animal reference'],
    ['operation_audit_log', 'operated_at', 'canonical audit timestamp'],
    ['operation_audit_logs', 'target_type', 'compat audit target type'],
    ['operation_audit_logs', 'target_id', 'compat audit target id']
  ]
  const tables = MODEL_CONVERGENCE_TABLES.map((table) => {
    const metadata = tableMap.get(table)
    return {
      table,
      role: REQUIRED_CANONICAL_TABLES.has(table) ? 'canonical' : 'compatibility',
      exists: Boolean(metadata),
      estimatedRows: metadata?.table_rows ?? null,
      tableCollation: metadata?.table_collation || null
    }
  })
  const columns = requiredColumns.map(([table, column, role]) => {
    const metadata = columnMap.get(table)?.get(column)
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
  const collationChecks = Object.entries(joinColumnGroups).map(([group, groupColumns]) => {
    const present = groupColumns
      .map(([table, column]) => {
        const metadata = columnMap.get(table)?.get(column)
        return metadata
          ? {
              table,
              column,
              columnType: metadata.column_type,
              collation: metadata.collation_name
            }
          : null
      })
      .filter(Boolean)
      .filter((item) => item.collation)
    const collations = uniqueStrings(present.map((item) => item.collation))
    return {
      group,
      ok: collations.length <= 1,
      collations,
      columns: present
    }
  })

  return {
    ok:
      tables.filter((item) => REQUIRED_CANONICAL_TABLES.has(item.table)).every((item) => item.exists) &&
      columns.filter((item) => REQUIRED_CANONICAL_TABLES.has(item.table)).every((item) => item.exists) &&
      collationChecks.every((item) => item.ok),
    databaseCollation,
    tables,
    requiredColumns: columns,
    collationChecks
  }
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatMysqlUtcDateTime(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
}

async function getDbCoverage() {
  const started = Date.now()
  const result = {
    ok: false,
    skipped: false,
    latencyMs: null,
    config: {
      host: mysqlConfig.host,
      port: mysqlConfig.port,
      user: mysqlConfig.user,
      database: mysqlConfig.database
    },
    tables: [],
    coreTables: [],
    modelConvergence: null,
    error: null
  }

  if (!mysqlConfig.password) {
    result.skipped = true
    result.error = 'MYSQL_PASSWORD is required for real DB coverage audit'
    return result
  }

  const pool = mysql.createPool({ ...mysqlConfig, waitForConnections: true, queueLimit: 0 })

  try {
    await pool.query('SELECT 1 AS ok')
    result.ok = true
    result.latencyMs = Date.now() - started
    result.tables = await Promise.all(DEFAULT_TABLES.map((table) => countTable(pool, table)))
    const tableMap = new Map(result.tables.map((item) => [item.table, item]))
    result.coreTables = CORE_TABLES.map((table) => tableMap.get(table) || { table, exists: false, count: null, error: 'not_scanned' })
    result.modelConvergence = await getModelConvergenceEvidence(pool).catch((error) => ({
      ok: false,
      error: error?.message || String(error)
    }))
    result.samples = await getDirectDbSamples(pool, result.coreTables)
  } catch (error) {
    result.latencyMs = Date.now() - started
    result.error = error?.message || String(error)
  } finally {
    await pool.end().catch(() => {})
  }

  return result
}

async function getDirectDbSamples(pool, coreTables) {
  const coreMap = Object.fromEntries(coreTables.map((item) => [item.table, item.count]))
  const activeAlerts = await queryScalar(
    pool,
    "SELECT COUNT(*) AS total FROM alerts WHERE LOWER(COALESCE(status, '')) IN ('active', 'pending', 'open', 'new', 'in_progress')"
  ).catch(() => 0)
  const criticalAlerts = await queryScalar(
    pool,
    "SELECT COUNT(*) AS total FROM alerts WHERE LOWER(COALESCE(severity, '')) = 'critical' AND LOWER(COALESCE(status, '')) IN ('active', 'pending', 'open', 'new', 'in_progress')"
  ).catch(() => 0)
  const freshCutoff = formatMysqlUtcDateTime(new Date(Date.now() - 2 * 60 * 60 * 1000))
  const freshSensorRecords = await queryScalar(
    pool,
    'SELECT COUNT(*) AS total FROM sensors WHERE COALESCE(ts, created_at) >= ?',
    [freshCutoff]
  ).catch(() => 0)
  const activeActions = await queryScalar(
    pool,
    "SELECT COUNT(*) AS total FROM automated_actions WHERE COALESCE(is_active, 1) <> 0 AND LOWER(COALESCE(status, '')) NOT IN ('inactive', 'disabled', 'offline', 'deleted')"
  ).catch(() => 0)
  const enabledTransfers = await queryScalar(
    pool,
    'SELECT COUNT(*) AS total FROM smart_transfer_rules WHERE COALESCE(enabled, 0) <> 0'
  ).catch(() => 0)
  const dueReminders = await queryScalar(
    pool,
    'SELECT COUNT(*) AS total FROM reminder_rules WHERE COALESCE(enabled, 0) <> 0 AND last_triggered IS NULL'
  ).catch(() => 0)
  const activeTemplates = await queryScalar(
    pool,
    'SELECT COUNT(*) AS total FROM workflow_templates WHERE COALESCE(is_active, 0) <> 0'
  ).catch(() => 0)
  const runningInstances = await queryScalar(
    pool,
    "SELECT COUNT(*) AS total FROM workflow_instances WHERE LOWER(COALESCE(status, '')) IN ('running', 'pending', 'in_progress', 'active')"
  ).catch(() => 0)
  const protocols = await queryScalar(pool, 'SELECT COUNT(*) AS total FROM integration_protocols').catch(() => 0)
  const syncs = await queryScalar(pool, 'SELECT COUNT(*) AS total FROM data_synchronizations').catch(() => 0)
  const devices = await queryScalar(pool, 'SELECT COUNT(*) AS total FROM hardware_devices').catch(() => 0)
  const [milkingMappingRows] = await pool
    .query(
      `
        SELECT id, source_device, target_system, data_type, configuration_json
        FROM data_synchronizations
        WHERE LOWER(CONCAT_WS(' ', id, source_device, target_system, data_type, JSON_UNQUOTE(configuration_json))) REGEXP 'milk|milking|奶|泌乳'
      `
    )
    .catch(() => [[]])
  const milkingSynchronizationMappings = Array.isArray(milkingMappingRows)
    ? milkingMappingRows.map((row) => {
        const configuration = safeJsonParse(row.configuration_json, {})
        const mapping = configuration.mapping || {}
        const mappingText = JSON.stringify(mapping).toLowerCase()
        return {
          id: row.id,
          dataType: row.data_type,
          mapping,
          hasMilkVolume: mappingText.includes('milk_volume'),
          hasCowId: mappingText.includes('cow_id'),
          hasTimestamp: mappingText.includes('timestamp')
        }
      })
    : []
  const productionBaselineChains = await getProductionBaselineChainEvidence(pool).catch((error) => ({
    ok: false,
    error: error?.message || String(error),
    milking: { ok: false, reasons: ['query_failed'] },
    omicsBreeding: { ok: false, reasons: ['query_failed'] },
    reproduction: { ok: false, reasons: ['query_failed'] }
  }))

  return {
    directDb: {
      productionBaselineChains,
      executeAutomationCheck: {
        success: true,
        triggeredActions: activeActions,
        triggeredTransfers: enabledTransfers,
        sentReminders: dueReminders,
        createdTasks: activeTemplates + runningInstances,
        source: 'direct-db-audit'
      },
      testProtocolConnection: protocols
        ? {
            success: false,
            reason: 'audit_requires_specific_protocol_id',
            counts: { protocols, synchronizations: syncs, devices },
            milkingSynchronizationMappings
          }
        : {
            success: false,
            reason: 'no_protocol_configured',
            errorMessage: 'No integration protocol records are configured in MySQL',
            counts: { protocols, synchronizations: syncs, devices },
            milkingSynchronizationMappings
          },
      runSystemDiagnostics: {
        success: Boolean(coreMap.cows > 0 && coreMap.sensors > 0 && coreMap.alerts > 0 && coreMap.health_scores > 0),
        backend: { expectedService: 'mysql-backend', apiBaseUrl },
        database: { ok: true, coreTableCounts: coreMap },
        signals: {
          activeAlerts,
          criticalAlerts,
          freshSensorRecords
        },
        mqtt: {
          configuredEnabled: String(process.env.MQTT_ENABLED || 'false').toLowerCase() === 'true',
          host: process.env.MQTT_HOST || '0.0.0.0',
          port: Number(process.env.MQTT_PORT || 1883),
          topic: process.env.MQTT_TOPIC || 'cattle/+/temperature'
        }
      }
    }
  }
}

async function getProductionBaselineChainEvidence(pool) {
  const [
    cows,
    productionBaselineManifests,
    hardwareDevices,
    dataSynchronizations,
    integrationProtocols,
    milkRecords,
    sensorStatus,
    sensorCalibrations,
    omicsSamples,
    omicsDatasets,
    omicsMarkers,
    multiOmicsAssociations,
    breedingAnalyses,
    breedingRecords,
    reproductionCycles,
    breedingEvents,
    feedFormulas,
    feedRecords,
    feedInventory,
    costItems,
    revenueItems,
    economicAnalyses,
    budgetPlans,
    kpiDashboards,
    kpiDashboardData,
    deviceMaintenance
  ] = await Promise.all([
    queryRows(pool, 'SELECT * FROM cows'),
    queryRows(pool, 'SELECT * FROM production_baseline_manifest'),
    queryRows(pool, 'SELECT * FROM hardware_devices'),
    queryRows(pool, 'SELECT * FROM data_synchronizations'),
    queryRows(pool, 'SELECT * FROM integration_protocols'),
    queryRows(pool, 'SELECT * FROM milk_records'),
    queryRows(pool, 'SELECT * FROM sensor_status'),
    queryRows(pool, 'SELECT * FROM sensor_calibrations'),
    queryRows(pool, 'SELECT * FROM omics_samples'),
    queryRows(pool, 'SELECT * FROM omics_datasets'),
    queryRows(pool, 'SELECT * FROM omics_markers'),
    queryRows(pool, 'SELECT * FROM multi_omics_associations'),
    queryRows(pool, 'SELECT * FROM breeding_analyses'),
    queryRows(pool, 'SELECT * FROM breeding_records'),
    queryRows(pool, 'SELECT * FROM reproduction_cycles'),
    queryRows(pool, 'SELECT * FROM breeding_events'),
    queryRows(pool, 'SELECT * FROM feed_formulas'),
    queryRows(pool, 'SELECT * FROM feed_records'),
    queryRows(pool, 'SELECT * FROM feed_inventory'),
    queryRows(pool, 'SELECT * FROM cost_items'),
    queryRows(pool, 'SELECT * FROM revenue_items'),
    queryRows(pool, 'SELECT * FROM economic_analysis'),
    queryRows(pool, 'SELECT * FROM budget_plans'),
    queryRows(pool, 'SELECT * FROM kpi_dashboards'),
    queryRows(pool, 'SELECT * FROM kpi_dashboard_data'),
    queryRows(pool, 'SELECT * FROM device_maintenance')
  ])

  const cowIds = makeIdSet(cows, ['id'])
  const cowNumbers = makeIdSet(cows, ['cow_number', 'cowNumber'])
  const requiredManifestDomains = ['种质资源与系谱', '奶厅与泌乳性能', '泌乳传感器与硬件集成', '生产经营闭环', '繁殖育种', '组学闭环']
  const manifestRows = productionBaselineManifests.filter(
    (row) =>
      String(valueOf(row, 'source_type', 'sourceType') || '') === 'deterministic_production_seed' &&
      String(valueOf(row, 'deterministic_seed', 'deterministicSeed') || '') === 'water-buffalo-production-v1' &&
      requiredManifestDomains.includes(String(valueOf(row, 'domain') || ''))
  )
  const manifestDomains = new Set(manifestRows.map((row) => String(valueOf(row, 'domain') || '')))
  const manifest = {
    rows: manifestRows.length,
    domains: [...manifestDomains],
    sourceType: 'deterministic_production_seed',
    deterministicSeed: 'water-buffalo-production-v1',
    missingDomains: requiredManifestDomains.filter((domain) => !manifestDomains.has(domain))
  }
  const protocolIds = makeIdSet(integrationProtocols, ['id'])
  const onlineParlorDevices = hardwareDevices.filter(
    (device) =>
      ['online', 'active', 'running', 'connected'].includes(String(valueOf(device, 'status') || '').toLowerCase()) &&
      textIncludesAny(device, ['milking', 'milk_volume', 'milk-meter', '奶厅', '挤奶', '奶量'])
  )
  const onlineParlorDeviceIds = makeIdSet(onlineParlorDevices, ['id'])
  const linkedSyncs = dataSynchronizations.filter(
    (sync) =>
      hasSetValue(protocolIds, [valueOf(sync, 'protocol_id', 'protocolId')]) &&
      hasSetValue(onlineParlorDeviceIds, [valueOf(sync, 'source_device', 'sourceDevice')]) &&
      ['active', 'ready', 'running', 'completed', 'success', 'idle', 'scheduled'].includes(
        String(valueOf(sync, 'status') || '').toLowerCase()
      ) &&
      textIncludesAny(sync, ['milk', 'milking', '奶', '泌乳'])
  )
  const acceptedMappings = linkedSyncs.filter((sync) => {
    const config = safeJsonParse(valueOf(sync, 'configuration_json', 'configurationJson', 'configuration'), {})
    const mappingText = JSON.stringify(config.mapping || {}).toLowerCase()
    return ['milk_volume', 'cow_id', 'timestamp'].every((token) => mappingText.includes(token))
  })
  const linkedMilkRecords = milkRecords.filter(
    (record) =>
      Number(valueOf(record, 'volume', 'milkVolume', 'milk_volume') || 0) > 0 &&
      hasSetValue(cowIds, [valueOf(record, 'cow_id', 'cowId')]) &&
      hasSetValue(onlineParlorDeviceIds, [valueOf(record, 'equipment_id', 'equipmentId')])
  )
  const linkedSensors = sensorStatus.filter(
    (sensor) =>
      hasSetValue(cowIds, [valueOf(sensor, 'cow_id', 'cowId')]) &&
      hasSetValue(onlineParlorDeviceIds, [valueOf(sensor, 'device_id', 'deviceId')]) &&
      ['online', 'active', 'running', 'connected'].includes(String(valueOf(sensor, 'status') || '').toLowerCase())
  )
  const linkedCalibrations = sensorCalibrations.filter((calibration) =>
    hasSetValue(onlineParlorDeviceIds, [valueOf(calibration, 'device_id', 'deviceId')])
  )
  const milking = {
    onlineParlorDevices: onlineParlorDevices.length,
    linkedSyncs: linkedSyncs.length,
    linkedMilkRecords: linkedMilkRecords.length,
    linkedSensors: linkedSensors.length,
    linkedCalibrations: linkedCalibrations.length,
    acceptedMappings: acceptedMappings.length
  }

  const sampleIds = makeIdSet(omicsSamples, ['id'])
  const linkedSamples = omicsSamples.filter(
    (sample) =>
      hasSetValue(cowIds, [valueOf(sample, 'cow_id', 'cowId')]) ||
      hasSetValue(cowNumbers, [valueOf(sample, 'cow_number', 'cowNumber')])
  )
  const linkedDatasets = omicsDatasets.filter((dataset) => {
    const datasetSampleIds = asArray(safeJsonParse(valueOf(dataset, 'sample_ids', 'sampleIds'), []))
    return datasetSampleIds.some((sampleId) => sampleIds.has(String(sampleId)))
  })
  const linkedDatasetIds = makeIdSet(linkedDatasets, ['id'])
  const markerCodes = makeIdSet(omicsMarkers, ['marker_code', 'markerCode'])
  const linkedMarkers = omicsMarkers.filter((marker) => hasSetValue(linkedDatasetIds, [valueOf(marker, 'dataset_id', 'datasetId')]))
  const linkedAssociations = multiOmicsAssociations.filter((association) => {
    const candidateMarkers = asArray(safeJsonParse(valueOf(association, 'candidate_markers', 'candidateMarkers'), []))
    const secondaryDatasetId = valueOf(association, 'secondary_dataset_id', 'secondaryDatasetId')
    return (
      hasSetValue(linkedDatasetIds, [valueOf(association, 'primary_dataset_id', 'primaryDatasetId')]) &&
      (!secondaryDatasetId || hasSetValue(linkedDatasetIds, [secondaryDatasetId])) &&
      (!candidateMarkers.length || candidateMarkers.some((markerCode) => markerCodes.has(String(markerCode))))
    )
  })
  const linkedAnalyses = breedingAnalyses.filter((analysis) => {
    const analysisDatasetIds = asArray(safeJsonParse(valueOf(analysis, 'dataset_ids', 'datasetIds'), []))
    const topCandidates = asArray(safeJsonParse(valueOf(analysis, 'top_candidates', 'topCandidates'), []))
    const datasetOk = analysisDatasetIds.some((datasetId) => linkedDatasetIds.has(String(datasetId)))
    const candidateOk = topCandidates.some(
      (candidate) =>
        hasSetValue(cowIds, [valueOf(candidate, 'cow_id', 'cowId')]) ||
        hasSetValue(cowNumbers, [valueOf(candidate, 'cow_number', 'cowNumber')])
    )
    return datasetOk && candidateOk && String(valueOf(analysis, 'status') || '').toLowerCase() === 'completed'
  })
  const omicsBreeding = {
    linkedSamples: linkedSamples.length,
    linkedDatasets: linkedDatasets.length,
    linkedMarkers: linkedMarkers.length,
    linkedAssociations: linkedAssociations.length,
    linkedAnalyses: linkedAnalyses.length
  }

  const cowNumberById = new Map(cows.map((cow) => [String(valueOf(cow, 'id')), String(valueOf(cow, 'cow_number', 'cowNumber') || '')]))
  const linkedRecords = breedingRecords.filter((record) => hasSetValue(cowIds, [valueOf(record, 'cow_id', 'cowId')]))
  const linkedCycles = reproductionCycles.filter((cycle) => hasSetValue(cowIds, [valueOf(cycle, 'cow_id', 'cowId')]))
  const linkedEvents = breedingEvents.filter((event) => hasSetValue(cowNumbers, [valueOf(event, 'cow_number', 'cowNumber')]))
  const recordCowIds = new Set(linkedRecords.map((record) => String(valueOf(record, 'cow_id', 'cowId'))))
  const cycleCowIds = new Set(linkedCycles.map((cycle) => String(valueOf(cycle, 'cow_id', 'cowId'))))
  const eventCowIds = new Set(
    linkedEvents
      .map((event) => String(valueOf(event, 'cow_number', 'cowNumber') || ''))
      .flatMap((cowNumber) =>
        cows
          .filter((cow) => String(valueOf(cow, 'cow_number', 'cowNumber') || '') === cowNumber)
          .map((cow) => String(valueOf(cow, 'id')))
      )
  )
  const closedCowIds = [...recordCowIds].filter((cowId) => cycleCowIds.has(cowId) && eventCowIds.has(cowId))
  const eventTypes = new Set(linkedEvents.map((event) => String(valueOf(event, 'event_type', 'eventType') || '').toLowerCase()))
  const reproduction = {
    linkedRecords: linkedRecords.length,
    linkedCycles: linkedCycles.length,
    linkedEvents: linkedEvents.length,
    closedCows: closedCowIds.length,
    closedCowNumbers: closedCowIds.map((cowId) => cowNumberById.get(cowId)).filter(Boolean),
    breedingEvents: [...eventTypes].some((type) => type.includes('insemination') || type.includes('配种')) ? 1 : 0,
    pregnancyOrCalvingEvents: [...eventTypes].some(
      (type) => type.includes('pregnancy') || type.includes('calving') || type.includes('妊娠') || type.includes('产犊')
    )
      ? 1
      : 0
  }

  const formulaIds = makeIdSet(feedFormulas, ['id'])
  const dashboardIds = makeIdSet(kpiDashboards, ['id'])
  const hardwareDeviceIds = makeIdSet(hardwareDevices, ['id'])
  const activeFormulas = feedFormulas.filter((formula) => {
    const value = valueOf(formula, 'is_active', 'isActive')
    return value === undefined || value === null || value === '' || Boolean(Number(value)) || value === true
  })
  const linkedFeedRecords = feedRecords.filter((record) => {
    const amount = Number(valueOf(record, 'actual_amount', 'actualAmount') || 0)
    const formulaId = valueOf(record, 'formula_id', 'formulaId')
    const cowId = valueOf(record, 'cow_id', 'cowId')
    const penId = valueOf(record, 'pen_id', 'penId')
    return amount > 0 && hasSetValue(formulaIds, [formulaId]) && (hasSetValue(cowIds, [cowId]) || Boolean(penId))
  })
  const totalActualFeed = linkedFeedRecords.reduce(
    (sum, record) => sum + Number(valueOf(record, 'actual_amount', 'actualAmount') || 0),
    0
  )
  const inventoryStock = feedInventory.reduce(
    (sum, item) => sum + Number(valueOf(item, 'current_stock', 'currentStock') || 0),
    0
  )
  const safeInventoryItems = feedInventory.filter(
    (item) => Number(valueOf(item, 'current_stock', 'currentStock') || 0) > Number(valueOf(item, 'minimum_stock', 'minimumStock') || 0)
  )
  const feedCosts = costItems.filter(
    (item) => Number(valueOf(item, 'amount') || 0) > 0 && textIncludesAny(item, ['feed', '饲料', 'tmr'])
  )
  const maintenanceCosts = costItems.filter(
    (item) => Number(valueOf(item, 'amount') || 0) > 0 && textIncludesAny(item, ['equipment', 'maintenance', '设备', '维护'])
  )
  const milkRevenue = revenueItems.filter(
    (item) => Number(valueOf(item, 'amount') || 0) > 0 && textIncludesAny(item, ['milk_sales', 'milk', '鲜奶', '水牛奶'])
  )
  const profitableAnalyses = economicAnalyses.filter((analysis) => {
    const payload = safeJsonParse(valueOf(analysis, 'payload'), {})
    const summary = payload.summary || safeJsonParse(valueOf(analysis, 'summary'), {})
    return Number(summary.totalRevenue || 0) > 0 && Number(summary.totalCost || 0) > 0
  })
  const activeBudgets = budgetPlans.filter((plan) => {
    const totalPlanned = Number(valueOf(plan, 'total_planned', 'totalPlanned') || 0)
    const totalActual = Number(valueOf(plan, 'total_actual', 'totalActual') || 0)
    return totalPlanned > 0 && totalActual > 0 && ['active', 'approved', 'completed'].includes(String(valueOf(plan, 'status') || '').toLowerCase())
  })
  const linkedKpiData = kpiDashboardData.filter((row) => hasSetValue(dashboardIds, [valueOf(row, 'dashboard_id', 'dashboardId')]))
  const linkedMaintenance = deviceMaintenance.filter((item) => hasSetValue(hardwareDeviceIds, [valueOf(item, 'device_id', 'deviceId')]))
  const openMaintenance = linkedMaintenance.filter(
    (item) => !['completed', 'cancelled'].includes(String(valueOf(item, 'status') || '').toLowerCase())
  )
  const feedSyncEvidence = linkedFeedRecords.filter((record) => textIncludesAny(record, ['production-seed', 'TMR', '库存', '成本']))
  const productionOperations = {
    activeFormulas: activeFormulas.length,
    linkedFeedRecords: linkedFeedRecords.length,
    inventoryItems: feedInventory.length,
    safeInventoryItems: safeInventoryItems.length,
    inventorySafetyDays: totalActualFeed > 0 ? Math.round(inventoryStock / totalActualFeed) : 0,
    feedCosts: feedCosts.length,
    maintenanceCosts: maintenanceCosts.length,
    milkRevenue: milkRevenue.length,
    profitableAnalyses: profitableAnalyses.length,
    activeBudgets: activeBudgets.length,
    linkedKpiData: linkedKpiData.length,
    linkedMaintenance: linkedMaintenance.length,
    openMaintenance: openMaintenance.length,
    feedSyncEvidence: feedSyncEvidence.length
  }
  const build = (values, requiredKeys) => {
    const reasons = requiredKeys
      .filter((key) => Number(values[key] || 0) <= 0)
      .map((key) => `${key}=0`)
    return { ...values, ok: reasons.length === 0, reasons }
  }
  const result = {
    manifest: build(manifest, ['rows']),
    milking: build(milking, [
      'onlineParlorDevices',
      'linkedSyncs',
      'linkedMilkRecords',
      'linkedSensors',
      'linkedCalibrations',
      'acceptedMappings'
    ]),
    omicsBreeding: build(omicsBreeding, [
      'linkedSamples',
      'linkedDatasets',
      'linkedMarkers',
      'linkedAssociations',
      'linkedAnalyses'
    ]),
    reproduction: build(reproduction, [
      'linkedRecords',
      'linkedCycles',
      'linkedEvents',
      'closedCows',
      'breedingEvents',
      'pregnancyOrCalvingEvents'
    ]),
    productionOperations: build(productionOperations, [
      'activeFormulas',
      'linkedFeedRecords',
      'safeInventoryItems',
      'feedCosts',
      'maintenanceCosts',
      'milkRevenue',
      'profitableAnalyses',
      'activeBudgets',
      'linkedKpiData',
      'linkedMaintenance',
      'feedSyncEvidence'
    ])
  }
  return {
    ok:
      result.manifest.ok &&
      result.manifest.missingDomains.length === 0 &&
      result.milking.ok &&
      result.omicsBreeding.ok &&
      result.reproduction.ok &&
      result.productionOperations.ok,
    ...result
  }
}

async function postJson(pathname, body, headers = {}) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
  const text = await response.text()
  let data = text
  try {
    data = JSON.parse(text)
  } catch {
    // keep text
  }
  return { httpStatus: response.status, body: data }
}

async function getAuditAuthHeaders() {
  if (!adminUser || !adminPassword) {
    return { headers: {}, auth: { attempted: false, ok: false, reason: 'missing_admin_credentials' } }
  }

  const login = await postJson('/api/auth/login', {
    userName: adminUser,
    password: adminPassword
  })
  const token = login.body?.data?.token || ''
  if (!token) {
    return {
      headers: {},
      auth: {
        attempted: true,
        ok: false,
        reason: 'login_returned_no_token',
        httpStatus: login.httpStatus
      }
    }
  }

  return {
    headers: { Authorization: token },
    auth: { attempted: true, ok: true, userName: adminUser, httpStatus: login.httpStatus }
  }
}

async function getHttpSamples() {
  const healthController = new AbortController()
  const timeout = setTimeout(() => healthController.abort(), 1500)
  try {
    const health = await fetch(`${apiBaseUrl}/api/health`, { signal: healthController.signal })
    clearTimeout(timeout)
    if (!health.ok) {
      return { available: false, apiBaseUrl, error: `health_http_${health.status}` }
    }

    const { headers: authHeaders, auth } = await getAuditAuthHeaders()
    const [automation, protocol, diagnostics] = await Promise.all([
      postJson('/api/cow/automation/executeAutomationCheck', { args: [] }, authHeaders),
      postJson('/api/cow/hardware/testProtocolConnection', { args: ['audit-missing-protocol'] }, authHeaders),
      postJson('/api/cow/hardware/runSystemDiagnostics', { args: [] }, authHeaders)
    ])
    const automationData = automation.body?.data?.data || automation.body?.data || {}
    const protocolData = protocol.body?.data?.data || protocol.body?.data || {}
    const diagnosticsData = diagnostics.body?.data?.data || diagnostics.body?.data || {}
    const mismatchReasons = []
    if (protocolData.success !== false || !protocolData.reason) {
      mismatchReasons.push('testProtocolConnection did not return deterministic unsupported/no-config failure')
    }
    if (!Array.isArray(diagnosticsData.results) || !diagnosticsData.system) {
      mismatchReasons.push('runSystemDiagnostics did not return real system results')
    }
    if (!automationData.source && !automationData.basis) {
      mismatchReasons.push('executeAutomationCheck response lacks DB basis metadata')
    }

    return {
      available: true,
      apiBaseUrl,
      auth,
      matchesCurrentBackendImplementation: mismatchReasons.length === 0,
      mismatchReasons,
      automation,
      protocol,
      diagnostics
    }
  } catch (error) {
    clearTimeout(timeout)
    return { available: false, apiBaseUrl, error: error?.message || String(error) }
  }
}

function summarizeRisks(staticFindings, backendRisks) {
  return {
    filesWithMathRandom: staticFindings.filter((item) => item.mathRandom > 0).length,
    filesWithMockToken: staticFindings.filter((item) => item.mock > 0).length,
    filesWithGenerateRandomRecords: staticFindings.filter((item) => item.generateRandomRecords > 0).length,
    backendHasMathRandom: backendRisks.mathRandomCount > 0,
    backendHasSuccessNoop: backendRisks.noopSuccessCount > 0,
    backendUnknownWritesUnsupported: backendRisks.unsupportedWriteGuard,
    targetHandlerRisks: backendRisks.targetHandlers
  }
}

function buildProductionBaselineCoverage(database) {
  const tableMap = new Map((database.tables || []).map((item) => [item.table, item]))
  const chains = database.samples?.directDb?.productionBaselineChains || {}

  return PRODUCTION_BASELINE_DOMAINS.map((domain) => {
    const tables = domain.tables.map((table) => {
      const normalized = normalizeTableName(table)
      const coverage = tableMap.get(normalized) || {
        table: normalized,
        exists: false,
        count: null,
        error: 'not_scanned'
      }
      return {
        table: normalized,
        exists: coverage.exists,
        count: coverage.count,
        error: coverage.error || null,
        nonEmpty: Number(coverage.count || 0) > 0
      }
    })

    return {
      domain: domain.domain,
      ok:
        tables.every((item) => item.exists && item.nonEmpty && !item.error) &&
        (domain.domain === '奶厅与泌乳性能'
          ? Boolean(chains.milking?.ok)
          : domain.domain === '泌乳传感器与硬件集成'
            ? Boolean(chains.milking?.ok)
            : domain.domain === '繁殖育种'
              ? Boolean(chains.reproduction?.ok)
              : domain.domain === '组学闭环'
                ? Boolean(chains.omicsBreeding?.ok)
                : domain.domain === '生产经营闭环'
                  ? Boolean(chains.productionOperations?.ok)
                  : true),
      chain:
        domain.domain === '奶厅与泌乳性能' || domain.domain === '泌乳传感器与硬件集成'
          ? chains.milking || null
          : domain.domain === '繁殖育种'
            ? chains.reproduction || null
            : domain.domain === '组学闭环'
              ? chains.omicsBreeding || null
              : domain.domain === '生产经营闭环'
                ? chains.productionOperations || null
                : null,
      tables
    }
  })
}

function buildProductionBlockers({
  backendMode,
  database,
  backendRisks,
  staticFiles,
  frontendMockIsolation,
  httpSamples
}) {
  const blockers = []
  const warnings = []
  const directDb = database.samples?.directDb || {}
  const coreCounts = directDb.runSystemDiagnostics?.database?.coreTableCounts || {}
  const signals = directDb.runSystemDiagnostics?.signals || {}
  const protocolCounts = directDb.testProtocolConnection?.counts || {}
  const milkingSynchronizationMappings = directDb.testProtocolConnection?.milkingSynchronizationMappings || []
  const productionBaselineChains = directDb.productionBaselineChains || {}
  const productionBaselineManifest = productionBaselineChains.manifest || {}

  if (backendMode !== 'backend') {
    blockers.push({
      severity: 'blocker',
      area: 'mode',
      item: 'backend-mode',
      detail: `VITE_ACCESS_MODE/VITE_DATA_MODE is ${backendMode || 'unset'}`
    })
  }
  if (!database.ok) {
    blockers.push({
      severity: 'blocker',
      area: 'database',
      item: 'mysql-connectivity',
      detail: database.error || 'MySQL connection failed'
    })
  }
  const modelConvergence = database.modelConvergence || {}
  if (modelConvergence.error) {
    blockers.push({
      severity: 'blocker',
      area: 'model-convergence',
      item: 'model-convergence-audit',
      detail: modelConvergence.error
    })
  }
  for (const table of modelConvergence.tables || []) {
    if (!table.exists && table.role === 'canonical') {
      blockers.push({
        severity: 'blocker',
        area: 'animal-master',
        item: `missing-canonical-${table.table}`,
        detail: `${table.table} canonical table is missing`
      })
    } else if (!table.exists) {
      warnings.push({
        severity: 'warning',
        area: 'compatibility',
        item: `missing-compat-${table.table}`,
        detail: `${table.table} compatibility table is missing`
      })
    }
  }
  for (const column of modelConvergence.requiredColumns || []) {
    if (!column.exists && REQUIRED_CANONICAL_TABLES.has(column.table)) {
      blockers.push({
        severity: 'blocker',
        area: 'animal-master',
        item: `missing-column-${column.table}.${column.column}`,
        detail: `${column.table}.${column.column} is required for model convergence (${column.role})`
      })
    } else if (!column.exists) {
      warnings.push({
        severity: 'warning',
        area: 'compatibility',
        item: `missing-column-${column.table}.${column.column}`,
        detail: `${column.table}.${column.column} compatibility column is missing (${column.role})`
      })
    }
  }
  for (const check of modelConvergence.collationChecks || []) {
    if (!check.ok) {
      blockers.push({
        severity: 'blocker',
        area: 'collation',
        item: `mixed-collation-${check.group}`,
        detail: `${check.group} join columns use mixed collations: ${check.collations.join(', ')}`
      })
    }
  }
  for (const table of ['cows', 'sensors', 'alerts', 'health_scores']) {
    if (!Number(coreCounts[table] || 0)) {
      blockers.push({
        severity: 'blocker',
        area: 'database',
        item: `core-table-${table}`,
        detail: `${table} has no production records`
      })
    }
  }
  const tableCounts = new Map((database.tables || []).map((item) => [item.table, item]))
  for (const domain of PRODUCTION_BASELINE_DOMAINS) {
    const missingTables = domain.tables
      .map((table) => {
        const normalized = normalizeTableName(table)
        const coverage = tableCounts.get(normalized)
        if (!coverage) return { table: normalized, reason: 'not scanned' }
        if (!coverage.exists) return { table: normalized, reason: coverage.error || 'table missing' }
        if (coverage.error) return { table: normalized, reason: coverage.error }
        if (!Number(coverage.count || 0)) return { table: normalized, reason: '0 rows' }
        return null
      })
      .filter(Boolean)

    if (missingTables.length > 0) {
      blockers.push({
        severity: 'blocker',
        area: 'production-baseline-data',
        item: `empty-domain-${domain.domain}`,
        detail: `${domain.domain} missing production data: ${missingTables
          .map((item) => `${item.table} (${item.reason})`)
          .join(', ')}`
      })
    }
  }
  if (backendRisks.mathRandomCount > 0) {
    blockers.push({
      severity: 'blocker',
      area: 'backend',
      item: 'backend-math-random',
      detail: `scripts/mysql-backend-server.mjs still has ${backendRisks.mathRandomCount} Math.random hits`
    })
  }
  if (
    !milkingSynchronizationMappings.some(
      (mapping) => mapping.hasMilkVolume && mapping.hasCowId && mapping.hasTimestamp
    )
  ) {
    blockers.push({
      severity: 'blocker',
      area: 'production-baseline-data',
      item: 'milking-sync-field-mapping',
      detail: 'data_synchronizations must expose a milking mapping containing milk_volume, cow_id and timestamp'
    })
  }
  if (!productionBaselineManifest.ok || productionBaselineManifest.missingDomains?.length) {
    blockers.push({
      severity: 'blocker',
      area: 'production-baseline-data',
      item: 'production-baseline-manifest',
      detail: `production_baseline_manifest must identify deterministic production baseline seed data for all domains; missing: ${(productionBaselineManifest.missingDomains || ['manifest']).join(', ')}`
    })
  }
  for (const [item, chain] of [
    ['milking-chain', productionBaselineChains.milking],
    ['omics-breeding-chain', productionBaselineChains.omicsBreeding],
    ['reproduction-chain', productionBaselineChains.reproduction],
    ['production-operations-chain', productionBaselineChains.productionOperations]
  ]) {
    if (!chain?.ok) {
      blockers.push({
        severity: 'blocker',
        area: 'production-baseline-chain',
        item,
        detail: `chain validation failed: ${(chain?.reasons || [productionBaselineChains.error || 'missing_chain_evidence']).join(', ')}`
      })
    }
  }
  if (backendRisks.noopSuccessCount > 0) {
    blockers.push({
      severity: 'blocker',
      area: 'backend',
      item: 'backend-success-noop',
      detail: `backend still has ${backendRisks.noopSuccessCount} success noop fallbacks`
    })
  }
  if (!backendRisks.unsupportedWriteGuard) {
    blockers.push({
      severity: 'blocker',
      area: 'backend',
      item: 'unsupported-write-guard',
      detail: 'unknown write methods are not guarded with an unsupported error'
    })
  }
  if (httpSamples.available && httpSamples.matchesCurrentBackendImplementation === false) {
    blockers.push({
      severity: 'blocker',
      area: 'runtime',
      item: 'deployed-backend-mismatch',
      detail: `HTTP ${httpSamples.apiBaseUrl} is reachable but does not match current backend file: ${httpSamples.mismatchReasons.join('; ')}`
    })
  }

  const emptyConfigTables = [
    ['integration_protocols', protocolCounts.protocols],
    ['data_synchronizations', protocolCounts.synchronizations],
    ['hardware_devices', protocolCounts.devices],
    ['automated_actions', directDb.executeAutomationCheck?.triggeredActions],
    ['smart_transfer_rules', directDb.executeAutomationCheck?.triggeredTransfers],
    ['reminder_rules', directDb.executeAutomationCheck?.sentReminders]
  ].filter(([, count]) => Number(count || 0) === 0)

  for (const [table] of emptyConfigTables) {
    warnings.push({
      severity: 'warning',
      area: 'configuration',
      item: `empty-${table}`,
      detail: `${table} is empty or has no active rows; related APIs return deterministic zero/no-config results`
    })
  }
  if (Number(signals.criticalAlerts || 0) > 0) {
    warnings.push({
      severity: 'warning',
      area: 'operations',
      item: 'active-critical-alerts',
      detail: `${signals.criticalAlerts} active critical alerts are present`
    })
  }
  if (Number(signals.freshSensorRecords || 0) === 0 && Number(coreCounts.sensors || 0) > 0) {
    warnings.push({
      severity: 'warning',
      area: 'operations',
      item: 'stale-sensor-data',
      detail: 'no sensor records in the last 2 hours'
    })
  }
  const filesWithRandom = staticFiles.filter((item) => item.mathRandom > 0)
  if (filesWithRandom.length > 0) {
    warnings.push({
      severity: 'warning',
      area: 'frontend-static-scan',
      item: 'src-views-random',
      detail: `${filesWithRandom.length} scanned frontend files still contain Math.random`
    })
  }
  if (frontendMockIsolation.length > 0) {
    blockers.push({
      severity: 'blocker',
      area: 'frontend-static-scan',
      item: 'unisolated-frontend-mock-random',
      detail: `${frontendMockIsolation.length} frontend files contain Math.random/mock fallback outside explicit demo isolation`
    })
  }

  const categorizedBlockers = blockers.map(withCategory)
  const categorizedWarnings = warnings.map(withCategory)

  return {
    blockers: categorizedBlockers,
    warnings: categorizedWarnings,
    byCategory: summarizeBlockersByCategory([...categorizedBlockers, ...categorizedWarnings]),
    summary: {
      blockerCount: categorizedBlockers.length,
      warningCount: categorizedWarnings.length,
      productionReady: categorizedBlockers.length === 0
    }
  }
}

function printReport(report) {
  console.log(`Backend mode: ${report.backendMode}`)
  console.log(`MySQL: ${report.database.config.user}@${report.database.config.host}:${report.database.config.port}/${report.database.config.database}`)

  console.log('\nCore DB table counts')
  console.table(
    report.database.coreTables.map((item) => ({
      table: item.table,
      exists: item.exists,
      count: item.count,
      error: item.error || ''
    }))
  )

  console.log('\nProduction baseline domain table counts')
  console.table(
    report.productionBaselineCoverage.flatMap((domain) =>
      domain.tables.map((item) => ({
        domain: domain.domain,
        table: item.table,
        exists: item.exists,
        count: item.count,
        nonEmpty: item.nonEmpty,
        chainOk: domain.chain ? Boolean(domain.chain.ok) : '',
        error: item.error || ''
      }))
    )
  )

  console.log('\nProduction baseline chain evidence')
  console.log(JSON.stringify(report.interfaceSamples.directDb?.productionBaselineChains || null, null, 2))

  console.log('\nModel convergence evidence')
  console.table(
    (report.database.modelConvergence?.tables || []).map((item) => ({
      table: item.table,
      role: item.role,
      exists: item.exists,
      estimatedRows: item.estimatedRows,
      tableCollation: item.tableCollation || ''
    }))
  )

  console.log('\nModel convergence collation checks')
  console.table(
    (report.database.modelConvergence?.collationChecks || []).map((item) => ({
      group: item.group,
      ok: item.ok,
      collations: item.collations.join(', ')
    }))
  )

  console.log('\nFiles containing Math.random/mock/generateRandomRecords')
  console.table(
    report.staticScan.files.map((item) => ({
      file: item.file,
      MathRandom: item.mathRandom,
      mock: item.mock,
      generateRandomRecords: item.generateRandomRecords,
      total: item.total
    }))
  )

  console.log('\nUnisolated frontend mock/random findings')
  console.table(
    report.frontendMockIsolation.map((item) => ({
      file: item.file,
      MathRandom: item.mathRandom.length,
      backendFallback: item.backendFallback.length,
      directMockExport: item.directMockExport.length,
      total: item.total
    }))
  )

  console.log('\nBackend noop/random risks')
  console.table([
    {
      file: report.backendRisks.file,
      MathRandom: report.backendRisks.mathRandomCount,
      successNoop: report.backendRisks.noopSuccessCount,
      noopTokens: report.backendRisks.noopTokenCount,
      unsupportedWriteGuard: report.backendRisks.unsupportedWriteGuard
    }
  ])

  console.log('\nProduction blockers')
  console.table(
    [...report.productionBlockers.blockers, ...report.productionBlockers.warnings].map((item) => ({
      severity: item.severity,
      category: item.category,
      area: item.area,
      item: item.item,
      detail: item.detail
    }))
  )

  console.log('\nProduction blockers by category')
  console.table(report.productionBlockers.byCategory)

  console.log('\nCore interface samples')
  console.log(JSON.stringify(report.interfaceSamples, null, 2))

  console.log('\nJSON report')
  console.log(JSON.stringify(report, null, 2))
}

async function main() {
  const [staticFiles, frontendMockIsolation, backendRisks, database, httpSamples] = await Promise.all([
    scanStaticFiles(),
    scanFrontendMockIsolation(),
    scanBackendRisks(),
    getDbCoverage(),
    getHttpSamples()
  ])
  const interfaceSamples = {
    directDb: database.samples?.directDb || null,
    http: httpSamples
  }
  const backendMode = process.env.VITE_ACCESS_MODE || process.env.VITE_DATA_MODE || 'unknown'
  const productionBlockers = buildProductionBlockers({
    backendMode,
    database,
    backendRisks,
    staticFiles,
    frontendMockIsolation,
    httpSamples
  })
  const report = {
    generatedAt: new Date().toISOString(),
    backendMode,
    database,
    productionBaselineCoverage: buildProductionBaselineCoverage(database),
    staticScan: {
      scope: ['src/api/cow.ts', 'src/views', 'scripts/mysql-backend-server.mjs'],
      files: staticFiles
    },
    frontendMockIsolation,
    backendRisks,
    riskSummary: summarizeRisks(staticFiles, backendRisks),
    productionBlockers,
    interfaceSamples
  }

  printReport(report)

  if (!database.ok) process.exitCode = 1
  if (!productionBlockers.summary.productionReady) process.exitCode = 1
  if (backendRisks.mathRandomCount > 0 || backendRisks.noopSuccessCount > 0) process.exitCode = 1
  if (frontendMockIsolation.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2))
  process.exitCode = 1
})
