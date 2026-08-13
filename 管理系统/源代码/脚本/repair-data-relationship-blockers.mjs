import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const allowNonProductionApply = args.has('--allow-non-production-apply')
const outputDir = path.join(projectRoot, 'reports', '20260606-db-data-quality', 'raw')
let dbConfigError = null

function pickEnv(names, fallback) {
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined && value !== '') {
      return { value, source: name }
    }
  }
  return { value: fallback, source: 'default' }
}

function parsePort(selection) {
  const port = Number(selection.value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error(`Invalid MySQL port from ${selection.source}`)
    error.code = 'INVALID_DB_PORT'
    error.connectionDiagnostic = {
      port: selection.value,
      portSource: selection.source
    }
    dbConfigError = error
    return 3306
  }
  return port
}

const dbSelections = {
  host: pickEnv(['MYSQL_AUDIT_HOST', 'MYSQL_HOST'], '127.0.0.1'),
  port: pickEnv(['MYSQL_AUDIT_PORT', 'MYSQL_AUDIT_HOST_PORT', 'MYSQL_HOST_PORT', 'MYSQL_PORT'], '3306'),
  user: pickEnv(['MYSQL_AUDIT_USER', 'MYSQL_USER'], 'cattle_user'),
  password: pickEnv(['MYSQL_AUDIT_PASSWORD', 'MYSQL_PASSWORD'], ''),
  database: pickEnv(['MYSQL_AUDIT_DATABASE', 'MYSQL_DATABASE'], 'cattle_management')
}

const dbConfig = {
  host: dbSelections.host.value,
  port: parsePort(dbSelections.port),
  user: dbSelections.user.value,
  password: dbSelections.password.value,
  database: dbSelections.database.value,
  multipleStatements: false
}

function sanitizedConnectionDiagnostic() {
  return {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    database: dbConfig.database,
    passwordConfigured: Boolean(dbConfig.password),
    sources: {
      host: dbSelections.host.source,
      port: dbSelections.port.source,
      user: dbSelections.user.source,
      password: dbSelections.password.source,
      database: dbSelections.database.source
    },
    usingMysqlAuditOverrides: Object.values(dbSelections).some((selection) => selection.source.startsWith('MYSQL_AUDIT_')),
    missingMysqlAuditOverrides: Object.fromEntries(
      Object.entries(dbSelections).map(([key, selection]) => [key, !selection.source.startsWith('MYSQL_AUDIT_')])
    ),
    loadsProductionEnv: false
  }
}

function mysqlErrorSummary(error) {
  return {
    code: error?.code || 'UNKNOWN',
    errno: error?.errno,
    sqlState: error?.sqlState,
    message: error?.message || String(error)
  }
}

function connectionAction(error) {
  const auditNames = 'MYSQL_AUDIT_HOST, MYSQL_AUDIT_PORT, MYSQL_AUDIT_USER, MYSQL_AUDIT_PASSWORD, MYSQL_AUDIT_DATABASE'
  const base = `Set or correct explicit ${auditNames} for a read-capable audit account; these override .env fallbacks and this script never reads 运维/生产配置/.env.prod.`
  if (error?.code === 'ER_ACCESS_DENIED_ERROR') {
    return `Credentials were rejected by MySQL. ${base}`
  }
  if (error?.code === 'ER_BAD_DB_ERROR') {
    return `The configured database does not exist or is not visible to the user. ${base}`
  }
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT' || error?.code === 'ENOTFOUND') {
    return `MySQL host/port was unreachable. ${base}`
  }
  if (error?.code === 'INVALID_DB_PORT') {
    return `The configured port is invalid. ${base}`
  }
  return base
}

function buildConnectionFailure(error) {
  return {
    ok: false,
    mode: apply ? 'apply-isolated' : 'dry-run',
    stage: 'connect',
    error: 'MySQL connection failed before relationship repair dry-run could inspect data',
    mysqlError: mysqlErrorSummary(error),
    database: {
      ...sanitizedConnectionDiagnostic(),
      ...(error?.connectionDiagnostic || {})
    },
    actionRequired: connectionAction(error)
  }
}

const productionCowIds = ['buf-cow-0001', 'buf-cow-0002', 'buf-cow-0003']
const productionCowNumbers = ['BUF-0001', 'BUF-0002', 'BUF-0003']
const milkRecordIds = ['milk-buf-0001-am', 'milk-buf-0002-am', 'milk-buf-0003-am', 'milk-buf-0001-mid', 'milk-buf-0002-mid', 'milk-buf-0003-night']
const feedRecordIds = ['feed-buf-0001-am', 'feed-buf-0002-am', 'feed-buf-0003-am', 'feed-pen-lactating-pm']
const sensorStatusIds = ['sensor-status-buf-0001', 'sensor-status-buf-0002', 'sensor-status-buf-0003']

function help() {
  return `Usage:
  node 脚本/repair-data-relationship-blockers.mjs [--dry-run]
  node 脚本/repair-data-relationship-blockers.mjs --apply --allow-non-production-apply

Default mode is dry-run. The script never loads 运维/生产配置/.env.prod.
Connection precedence: MYSQL_AUDIT_HOST, MYSQL_AUDIT_PORT, MYSQL_AUDIT_USER, MYSQL_AUDIT_PASSWORD, MYSQL_AUDIT_DATABASE override .env MYSQL_* values.
On connection failure, dry-run writes a sanitized diagnostic with host/port/user/数据库/passwordConfigured and env sources.
--apply is refused for database cattle_management; use an isolated clone database.
Outputs:
  reports/20260606-db-data-quality/raw/relationship-repair-dry-run.json
  reports/20260606-db-data-quality/raw/relationship-repair-authorized.sql
  reports/20260606-db-data-quality/raw/relationship-repair-rollback.sql`
}

function json(value) {
  return JSON.stringify(value)
}

function quoteSql(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  return `'${String(value).replace(/'/g, "''")}'`
}

function insertSql(table, row, columns) {
  const selected = columns.filter((column) => row[column] !== undefined)
  return `INSERT INTO \`${table}\` (${selected.map((column) => `\`${column}\``).join(', ')})
VALUES (${selected.map((column) => quoteSql(row[column])).join(', ')})
ON DUPLICATE KEY UPDATE \`id\` = \`id\`;`
}

async function queryRows(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params)
  return Array.isArray(rows) ? rows : []
}

async function tableExists(connection, table) {
  const rows = await queryRows(
    connection,
    `SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  )
  return Number(rows?.[0]?.total || 0) > 0
}

async function columnsForTable(connection, table) {
  const rows = await queryRows(
    connection,
    `SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  )
  return rows.map((row) => row.columnName)
}

async function countSql(connection, sql, params = []) {
  const rows = await queryRows(connection, sql, params)
  return Number(Object.values(rows?.[0] || {})[0] || 0)
}

async function loadCowTraceScope(connection) {
  if (!(await tableExists(connection, 'cows'))) {
    return { cowIds: productionCowIds, cowNumbers: productionCowNumbers, source: 'fallback_constants' }
  }
  const preferredRows = await queryRows(
    connection,
    `SELECT id, cow_number AS cowNumber
     FROM cows
     WHERE id IN (?, ?, ?)
        OR cow_number IN (?, ?, ?)
     ORDER BY FIELD(id, ?, ?, ?), cow_number
     LIMIT 3`,
    [...productionCowIds, ...productionCowNumbers, ...productionCowIds]
  )
  const rows = preferredRows.length
    ? preferredRows
    : await queryRows(
        connection,
        `SELECT id, cow_number AS cowNumber
         FROM cows
         WHERE id IS NOT NULL
           AND id <> ''
           AND cow_number IS NOT NULL
           AND cow_number <> ''
         ORDER BY cow_number
         LIMIT 3`
      )
  return {
    cowIds: rows.map((row) => String(row.id)),
    cowNumbers: rows.map((row) => String(row.cowNumber || row.id)),
    source: preferredRows.length ? 'preferred_baseline_cows' : 'first_available_cows'
  }
}

function buildHardwareRow(nowSql, cowTraceScope) {
  const cowIds = cowTraceScope.cowIds.length ? cowTraceScope.cowIds : productionCowIds
  const cowNumbers = cowTraceScope.cowNumbers.length ? cowTraceScope.cowNumbers : productionCowNumbers
  return {
    id: 'seed-device-readiness-gateway',
    name: 'Seed Device Readiness Gateway',
    device_type: '网关',
    status: 'online',
    brand: 'GXLab',
    model: 'Readiness-GW',
    serial_number: 'GX-SEED-READINESS-GW',
    location_json: json({ area: 'production-baseline', station: 'relationship-audit-readiness' }),
    last_seen: nowSql,
    firmware_version: '1.0.0',
    capabilities: json(['relationship_audit_trace', 'device_readiness', 'baseline_gateway']),
    configuration_json: json({
      source: '脚本/repair-data-relationship-blockers.mjs',
      deterministicSeed: 'water-buffalo-production-v1',
      nonDestructiveRepair: true
    }),
    installed_at: '2026-06-06 00:00:00.000',
    maintenance_schedule: json({ intervalDays: 30, nextDueDate: '2026-07-06' }),
    cow_ids: json(cowIds),
    relation_scope: json({
      scope: 'cow_group',
      domain: 'hardware_readiness',
      cowIds,
      cowNumbers,
      cowScopeSource: cowTraceScope.source,
      tracePolicy: 'gateway links directly to cow_ids; source rows are optional context'
    }),
    source_record_ids: json({})
  }
}

function buildPersonRow(nowSql) {
  return {
    id: 'person-breeding-tech',
    name: 'Breeding Technician',
    department: 'Breeding',
    role: 'Breeding Technician',
    phone: '',
    email: '',
    status: 'active',
    hire_date: '2024-01-01',
    notes: 'Deterministic production baseline operator restored for relationship trace integrity.',
    created_at: nowSql,
    updated_at: nowSql,
    is_active: 1
  }
}

async function maybeInsert(connection, table, row, report) {
  const exists = await tableExists(connection, table)
  if (!exists) {
    report.repairs.push({ table, action: 'skip', reason: 'table_missing', estimatedInsertRows: 0 })
    return
  }
  const columns = await columnsForTable(connection, table)
  const present = await countSql(connection, `SELECT COUNT(*) AS total FROM \`${table}\` WHERE id = ?`, [row.id])
  const sql = insertSql(table, row, columns)
  report.authorizedSql.push(sql)
  if (table === 'hardware_devices') {
    report.rollbackSql.push(
      `UPDATE \`hardware_devices\` SET \`status\` = 'inactive', \`configuration_json\` = JSON_SET(COALESCE(\`configuration_json\`, JSON_OBJECT()), '$.softRollback', true, '$.softRollbackAt', CURRENT_TIMESTAMP(3)) WHERE \`id\` = 'seed-device-readiness-gateway';`
    )
  }
  if (table === 'persons') {
    report.rollbackSql.push(
      `UPDATE \`persons\` SET \`status\` = 'inactive', \`is_active\` = 0, \`notes\` = CONCAT(COALESCE(\`notes\`, ''), ' | soft rollback by relationship repair') WHERE \`id\` = 'person-breeding-tech';`
    )
  }
  report.repairs.push({
    table,
    id: row.id,
    action: present ? 'none' : apply ? 'inserted' : 'would_insert',
    estimatedInsertRows: present ? 0 : 1,
    estimatedUpdateRows: 0,
    businessDomain: table === 'hardware_devices' ? 'hardware readiness / production operations' : 'audit actor reference'
  })
  if (!present && apply) {
    const selected = columns.filter((column) => row[column] !== undefined)
    await connection.execute(
      `INSERT INTO \`${table}\` (${selected.map((column) => `\`${column}\``).join(', ')})
       VALUES (${selected.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE \`id\` = \`id\``,
      selected.map((column) => row[column])
    )
  }
}

async function collectAuditRuleEvidence(connection) {
  const evidence = {}
  evidence.omicsMarkerRefs = await optionalCountSql(
    connection,
    `SELECT COUNT(*) AS total
     FROM (
       SELECT id FROM omics_module_runs WHERE CAST(source_record_ids AS CHAR) LIKE '%omics_markers%'
       UNION ALL
       SELECT id FROM omics_workflow_runs WHERE CAST(source_record_ids AS CHAR) LIKE '%omics_markers%'
       UNION ALL
       SELECT id FROM omics_analysis_artifacts WHERE CAST(source_record_ids AS CHAR) LIKE '%omics_markers%'
     ) x`
  )
  evidence.legacyAuditUnresolvedRows = await optionalCountSql(
    connection,
    `SELECT COUNT(*) AS total
     FROM operation_audit_logs
     WHERE CAST(source_record_ids AS CHAR) LIKE '%unresolved:%'
       AND CAST(source_record_ids AS CHAR) REGEXP 'cow_id|cow_number|animal_number'`
  )
  evidence.costRevenueRowsWithCowIds = await optionalCountSql(
    connection,
    `SELECT COUNT(*) AS total
     FROM (
       SELECT id FROM cost_items WHERE JSON_LENGTH(COALESCE(cow_ids, JSON_ARRAY())) > 0
       UNION ALL
       SELECT id FROM revenue_items WHERE JSON_LENGTH(COALESCE(cow_ids, JSON_ARRAY())) > 0
     ) x`
  )
  return evidence
}

async function optionalCountSql(connection, sql, params = []) {
  try {
    return await countSql(connection, sql, params)
  } catch {
    return 0
  }
}

async function safeCollectAuditRuleEvidence(connection) {
  try {
    return await collectAuditRuleEvidence(connection)
  } catch (error) {
    return { error: error?.message || String(error) }
  }
}

async function main() {
  if (args.has('--help') || args.has('-h')) {
    console.log(help())
    return
  }
  if (apply && (!allowNonProductionApply || dbConfig.database === 'cattle_management')) {
    throw new Error('--apply is only allowed with --allow-non-production-apply against an isolated non-cattle_management database')
  }

  await fs.mkdir(outputDir, { recursive: true })
  if (dbConfigError) {
    const failure = buildConnectionFailure(dbConfigError)
    await fs.writeFile(path.join(outputDir, 'relationship-repair-dry-run.json'), `${JSON.stringify(failure, null, 2)}\n`)
    console.error(JSON.stringify(failure, null, 2))
    process.exitCode = 1
    return
  }

  const nowSql = '2026-06-06 00:00:00.000'
  const report = {
    ok: false,
    mode: apply ? 'apply-isolated' : 'dry-run',
    database: sanitizedConnectionDiagnostic(),
    safety: {
      loadsProductionEnv: false,
      destructiveSql: false,
      productionApplyRefused: dbConfig.database === 'cattle_management'
    },
    repairs: [],
    auditRuleEvidence: {},
    authorizedSql: [],
    rollbackSql: []
  }
  let connection

  try {
    connection = await mysql.createConnection(dbConfig)
  } catch (error) {
    const failure = buildConnectionFailure(error)
    await fs.writeFile(path.join(outputDir, 'relationship-repair-dry-run.json'), `${JSON.stringify(failure, null, 2)}\n`)
    console.error(JSON.stringify(failure, null, 2))
    process.exitCode = 1
    return
  }

  try {
    if (apply) await connection.beginTransaction()
    const cowTraceScope = await loadCowTraceScope(connection)
    report.cowTraceScope = cowTraceScope
    await maybeInsert(connection, 'hardware_devices', buildHardwareRow(nowSql, cowTraceScope), report)
    await maybeInsert(connection, 'persons', buildPersonRow(nowSql), report)
    report.auditRuleEvidence = await safeCollectAuditRuleEvidence(connection)
    if (apply) await connection.commit()
    report.ok = true
  } catch (error) {
    if (apply) await connection.rollback().catch(() => {})
    report.error = error?.message || String(error)
    throw error
  } finally {
    await connection.end().catch(() => {})
    const summary = {
      ...report,
      authorizedSqlStatements: report.authorizedSql,
      rollbackSqlStatements: report.rollbackSql,
      authorizedSql: `${report.authorizedSql.length} statement(s) written to relationship-repair-authorized.sql`,
      rollbackSql: `${report.rollbackSql.length} statement(s) written to relationship-repair-rollback.sql`
    }
    await fs.writeFile(path.join(outputDir, 'relationship-repair-dry-run.json'), `${JSON.stringify(summary, null, 2)}\n`)
    await fs.writeFile(path.join(outputDir, 'relationship-repair-authorized.sql'), `${report.authorizedSql.join('\n\n')}\n`)
    await fs.writeFile(path.join(outputDir, 'relationship-repair-rollback.sql'), `${report.rollbackSql.join('\n\n')}\n`)
    console.log(JSON.stringify(summary, null, 2))
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2))
  process.exitCode = 1
})
