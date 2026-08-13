import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const reportDir = path.join(projectRoot, 'reports', '20260611-db-element-source-alignment')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
if (process.env.AUDIT_SKIP_PRODUCTION_ENV !== '1') {
  dotenv.config({ path: path.join(projectRoot, 'ops/production/.env.prod'), override: true, quiet: true })
}

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

const OUTPUT_JSON = path.join(reportDir, 'database-element-source-alignment-report.json')
const OUTPUT_MD = path.join(reportDir, 'database-element-source-alignment-summary.md')

const USER_FACING_TABLES = [
  'animal',
  'cows',
  'animal_identifier',
  'animal_parentage',
  'farm_unit',
  'pens',
  'persons',
  'diseases',
  'medicines',
  'medicine',
  'medicine_batch',
  'breed_types',
  'transfer_reasons',
  'base_info_categories',
  'production_shift',
  'trait_category',
  'trait_definition',
  'phenotype_trait_definitions',
  'device',
  'hardware_devices',
  'devices',
  'sensors',
  'sensor_status'
]

const SEEDISH_RE = /(vis-|visual_week|visual-week|可视化|acceptance|验收|buf-|BUF-|demo|milk_stat|MILK-STAT|validate-milk-production-statistics|链路验证|"\s*TEST\d*"\s*)/i

const ELEMENT_GROUPS = [
  {
    key: 'housing_unit',
    label: '圈舍/牛舍',
    canonical: 'farm_unit',
    page: 'pens',
    pageName: '平台管理/圈舍管理',
    referenceTables: [
      ['animal', ['current_unit_id', 'current_pen_id']],
      ['animal_pen_assignment', ['unit_id']],
      ['event_movement_detail', ['from_unit_id', 'to_unit_id']],
      ['entry_events', ['pen']],
      ['transfer_events', ['from_pen', 'to_pen']],
      ['device', ['unit_id']]
    ]
  },
  {
    key: 'medicine',
    label: '药品',
    canonical: 'medicine',
    page: 'medicines',
    pageName: '平台管理/药品管理',
    referenceTables: [
      ['event_medicine_detail', ['medicine_code', 'medicine_name']],
      ['medication_order', ['medicine_id', 'medicine_code']],
      ['medication_administration', ['medicine_id', 'medicine_code']],
      ['medicine_batch', ['medicine_id']]
    ]
  },
  {
    key: 'milk_shift',
    label: '奶厅班次',
    canonical: 'production_shift',
    page: 'base_info_categories',
    pageScope: 'milk:shifts',
    pageName: '平台管理/班次管理',
    referenceTables: [
      ['milk_measurement', ['shift_id', 'shift_name']],
      ['milk_records', ['shift_id', 'shift_name', 'shift']]
    ]
  },
  {
    key: 'trait_dictionary',
    label: '性状词典',
    canonical: 'trait_definition',
    page: 'phenotype_trait_definitions',
    pageName: '平台管理/表型性状',
    referenceTables: [
      ['trait_observation', ['trait_id', 'trait_code']],
      ['phenotype_records', ['trait_id', 'trait_code', 'trait_name']]
    ]
  },
  {
    key: 'device',
    label: '设备/耳标',
    canonical: 'device',
    page: 'hardware_devices',
    pageName: '数据设备/硬件设备',
    referenceTables: [
      ['animal_device_assignment', ['device_id']],
      ['sensor_reading', ['device_id']],
      ['sensor_readings', ['device_id']],
      ['sensor_status', ['device_id']]
    ]
  },
  {
    key: 'breed',
    label: '品种',
    canonical: 'breed_types',
    page: 'breed_types',
    pageName: '平台管理/品种管理',
    referenceTables: [
      ['animal', ['breed', 'calf_breed']],
      ['cows', ['breed']]
    ]
  },
  {
    key: 'person',
    label: '人员',
    canonical: 'persons',
    page: 'persons',
    pageName: '平台管理/人员管理',
    referenceTables: [
      ['animal_event', ['operator_name', 'work_operator_name']],
      ['milk_measurement', ['operator_name', 'work_operator_name']],
      ['trait_observation', ['operator_name', 'work_operator_name', 'collector']],
      ['operation_audit_log', ['operator_name']],
      ['operation_audit_logs', ['operator_name', 'operator']],
      ['entry_events', ['recorder']],
      ['transfer_events', ['recorder']],
      ['exit_events', ['recorder']]
    ]
  },
  {
    key: 'disease',
    label: '疾病',
    canonical: 'diseases',
    page: 'diseases',
    pageName: '平台管理/疾病管理',
    referenceTables: [
      ['event_health_detail', ['diagnosis_name', 'disease_name', 'diagnosis']],
      ['veterinary_events', ['diagnosis', 'disease_name']]
    ]
  },
  {
    key: 'transfer_reason',
    label: '转群/入群/离群原因',
    canonical: 'transfer_reasons',
    page: 'transfer_reasons',
    pageName: '平台管理/转群原因',
    referenceTables: [
      ['entry_events', ['reason']],
      ['transfer_events', ['reason']],
      ['exit_events', ['reason']],
      ['event_movement_detail', ['reason']]
    ]
  }
]

const text = (value) => String(value ?? '').trim()
const lowerText = (value) => text(value).toLowerCase()
const quote = (name) => `\`${String(name).replace(/`/g, '``')}\``

function parseJson(value) {
  if (!value) return {}
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function pickValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key]
    if (value !== undefined && value !== null && text(value)) return value
  }
  const payload = parseJson(row?.payload)
  for (const key of keys) {
    const value = payload?.[key]
    if (value !== undefined && value !== null && text(value)) return value
  }
  return ''
}

function normalizeKey(value) {
  return lowerText(value).replace(/\s+/g, '').replace(/[｜|/\\]+/g, '')
}

function rowIdentity(row) {
  return [
    pickValue(row, ['id']),
    pickValue(row, ['code', 'value']),
    pickValue(row, ['name', 'label'])
  ]
    .map(normalizeKey)
    .filter(Boolean)
}

function isSeedishRow(row) {
  const raw = JSON.stringify(row || {})
  return SEEDISH_RE.test(raw)
}

function safeSample(rows, size = 8) {
  return rows.slice(0, size).map((row) => {
    const payload = parseJson(row.payload)
    return {
      id: row.id,
      code: row.code || payload.code,
      name: row.name || payload.name || row.label || payload.label,
      category: row.category || payload.category || row.unit_type || row.device_type,
      status: row.status || payload.status
    }
  })
}

async function queryAll(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params)
  return rows || []
}

async function tableExists(connection, table) {
  const rows = await queryAll(
    connection,
    `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
    [dbConfig.database, table]
  )
  return Number(rows[0]?.count || rows[0]?.COUNT || 0) > 0
}

async function columnSet(connection, table) {
  const rows = await queryAll(
    connection,
    `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`,
    [dbConfig.database, table]
  )
  return new Set(rows.map((row) => row.COLUMN_NAME || row.column_name))
}

async function countRows(connection, table) {
  if (!(await tableExists(connection, table))) return null
  const rows = await queryAll(connection, `SELECT COUNT(*) AS count FROM ${quote(table)}`)
  return Number(rows[0]?.count || 0)
}

async function readRows(connection, table, columns = '*', where = '', params = []) {
  if (!(await tableExists(connection, table))) return []
  const sql = `SELECT ${columns} FROM ${quote(table)}${where ? ` WHERE ${where}` : ''}`
  return queryAll(connection, sql, params)
}

async function readPageRows(connection, group) {
  if (group.pageScope) {
    return readRows(connection, group.page, '*', 'scope = ?', [group.pageScope])
  }
  return readRows(connection, group.page)
}

function compareRows(canonicalRows, pageRows) {
  const canonicalKeys = new Map()
  const pageKeys = new Map()
  canonicalRows.forEach((row) => rowIdentity(row).forEach((key) => canonicalKeys.set(key, row)))
  pageRows.forEach((row) => rowIdentity(row).forEach((key) => pageKeys.set(key, row)))
  const canonicalMissingPage = []
  const pageMissingCanonical = []

  canonicalRows.forEach((row) => {
    if (!rowIdentity(row).some((key) => pageKeys.has(key))) canonicalMissingPage.push(row)
  })
  pageRows.forEach((row) => {
    if (!rowIdentity(row).some((key) => canonicalKeys.has(key))) pageMissingCanonical.push(row)
  })
  return { canonicalMissingPage, pageMissingCanonical }
}

async function auditReferences(connection, group, canonicalRows, pageRows) {
  const findings = []
  const validKeys = new Set(
    [...canonicalRows, ...pageRows]
      .flatMap(rowIdentity)
      .filter(Boolean)
  )
  if (!validKeys.size) return findings

  for (const [table, columns] of group.referenceTables || []) {
    if (!(await tableExists(connection, table))) continue
    const existingColumns = await columnSet(connection, table)
    const checkedColumns = columns.filter((column) => existingColumns.has(column))
    for (const column of checkedColumns) {
      const rows = await queryAll(
        connection,
        `SELECT ${quote(column)} AS value, COUNT(*) AS count
         FROM ${quote(table)}
         WHERE ${quote(column)} IS NOT NULL AND ${quote(column)} <> ''
         GROUP BY ${quote(column)}
         ORDER BY count DESC
         LIMIT 80`
      )
      const missing = rows.filter((row) => !validKeys.has(normalizeKey(row.value)))
      if (missing.length) {
        findings.push({
          severity: 'medium',
          code: 'dictionary_reference_missing',
          message: `${table}.${column} has values not found in ${group.label} dictionary`,
          group: group.key,
          table,
          column,
          missing: missing.slice(0, 12)
        })
      }
    }
  }
  return findings
}

async function main() {
  fs.mkdirSync(reportDir, { recursive: true })
  const startedAt = new Date().toISOString()
  const connection = await mysql.createConnection(dbConfig)
  const findings = []
  const addFinding = (severity, code, message, details = {}) => {
    findings.push({ severity, code, message, ...details })
  }

  try {
    await connection.query('SET NAMES utf8mb4')

    const tableCounts = {}
    for (const table of USER_FACING_TABLES) {
      tableCounts[table] = await countRows(connection, table)
    }

    const seedishResidue = []
    for (const table of USER_FACING_TABLES) {
      if (!(await tableExists(connection, table))) continue
      const rows = await readRows(connection, table)
      const matches = rows.filter(isSeedishRow)
      if (matches.length) {
        seedishResidue.push({ table, count: matches.length, sample: safeSample(matches) })
        const severity = ['device', 'hardware_devices', 'trait_definition', 'trait_category', 'medicines', 'diseases', 'animal', 'cows'].includes(table)
          ? 'high'
          : 'medium'
        addFinding(severity, 'seed_or_visual_residue', `${table} contains visual/demo/acceptance residue`, {
          table,
          count: matches.length,
          sample: safeSample(matches)
        })
      }
    }

    const groupReports = []
    for (const group of ELEMENT_GROUPS) {
      const canonicalRows = await readRows(connection, group.canonical)
      const pageRows = await readPageRows(connection, group)
      const { canonicalMissingPage, pageMissingCanonical } = compareRows(canonicalRows, pageRows)
      const report = {
        key: group.key,
        label: group.label,
        canonical: group.canonical,
        page: group.page,
        pageScope: group.pageScope || '',
        canonicalRows: canonicalRows.length,
        pageRows: pageRows.length,
        canonicalMissingPage: canonicalMissingPage.length,
        pageMissingCanonical: pageMissingCanonical.length,
        sampleCanonicalMissingPage: safeSample(canonicalMissingPage),
        samplePageMissingCanonical: safeSample(pageMissingCanonical)
      }
      groupReports.push(report)

      if (group.canonical !== group.page && pageRows.length > 0 && canonicalRows.length === 0) {
        addFinding('high', 'canonical_empty_but_page_has_values', `${group.label}: canonical table ${group.canonical} is empty but ${group.pageName} has values`, report)
      } else if (group.canonical !== group.page && pageMissingCanonical.length > 0) {
        addFinding('medium', 'page_values_missing_canonical', `${group.label}: page values are not mirrored to canonical table`, report)
      }
      if (group.canonical !== group.page && canonicalMissingPage.length > 0) {
        addFinding('medium', 'canonical_values_missing_page', `${group.label}: canonical values are not visible in page source`, report)
      }

      for (const finding of await auditReferences(connection, group, canonicalRows, pageRows)) {
        findings.push(finding)
      }
    }

    const [hardwareOrphans] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM hardware_devices hd
       WHERE JSON_EXTRACT(hd.relation_scope, '$.orphanCowIds') IS NOT NULL
          OR JSON_EXTRACT(hd.configuration_json, '$.sourceType') = 'visual_week_seed'`
    ).catch(() => [[{ count: 0 }]])
    if (Number(hardwareOrphans?.count || 0) > 0) {
      addFinding('high', 'hardware_orphan_visual_seed', 'hardware_devices still contains visual seed or orphan device inventory rows', {
        count: Number(hardwareOrphans.count || 0)
      })
    }

    const summary = {
      startedAt,
      database: `${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
      tableCounts,
      groupReports,
      seedishResidue,
      findingCount: findings.length,
      highFindingCount: findings.filter((item) => item.severity === 'high').length,
      mediumFindingCount: findings.filter((item) => item.severity === 'medium').length,
      lowFindingCount: findings.filter((item) => item.severity === 'low').length
    }

    fs.writeFileSync(OUTPUT_JSON, JSON.stringify({ summary, findings }, null, 2))
    fs.writeFileSync(
      OUTPUT_MD,
      [
        '# Database Element Source Alignment Audit',
        '',
        `Generated: ${startedAt}`,
        `Database: ${summary.database}`,
        '',
        `Findings: high=${summary.highFindingCount} medium=${summary.mediumFindingCount} low=${summary.lowFindingCount}`,
        '',
        '## Element Groups',
        '',
        '| Element | Canonical | Page source | Canonical rows | Page rows | Page missing canonical | Canonical missing page |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: |',
        ...groupReports.map((item) =>
          `| ${item.label} | ${item.canonical} | ${item.page}${item.pageScope ? `:${item.pageScope}` : ''} | ${item.canonicalRows} | ${item.pageRows} | ${item.pageMissingCanonical} | ${item.canonicalMissingPage} |`
        ),
        '',
        '## Findings',
        '',
        '| Severity | Code | Message |',
        '| --- | --- | --- |',
        ...findings.slice(0, 80).map((item) => `| ${item.severity} | ${item.code} | ${String(item.message).replace(/\|/g, '/')} |`)
      ].join('\n')
    )

    console.log(JSON.stringify({
      summary: {
        database: summary.database,
        findingCount: summary.findingCount,
        highFindingCount: summary.highFindingCount,
        mediumFindingCount: summary.mediumFindingCount,
        seedishTables: seedishResidue.map((item) => `${item.table}:${item.count}`),
        report: path.relative(projectRoot, OUTPUT_JSON),
        summary: path.relative(projectRoot, OUTPUT_MD)
      },
      topFindings: findings.slice(0, 20)
    }, null, 2))
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
