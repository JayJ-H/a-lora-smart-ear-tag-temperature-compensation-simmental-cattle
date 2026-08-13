#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
dotenv.config({
  path: path.join(projectRoot, 'ops/production/.env.prod'),
  override: true,
  quiet: true
})

const mysqlContainer =
  process.env.MYSQL_AUDIT_CONTAINER || process.env.MYSQL_CONTAINER_NAME || 'benniu-mysql'
const mysqlConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(
    process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306
  ),
  user: process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'cattle_management'
}

function sanitizeError(error) {
  return String(error?.message || error || '').replace(/password: [^)]+/gi, 'password: <redacted>')
}

function dockerMysqlUserHosts(user) {
  const sql = `
    SELECT User, Host
    FROM mysql.user
    WHERE User = '${String(user).replace(/'/g, "''")}'
    ORDER BY Host;
  `
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      mysqlContainer,
      'sh',
      '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --raw --silent'
    ],
    {
      input: sql,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    }
  )

  if (result.status !== 0) {
    return {
      ok: false,
      container: mysqlContainer,
      error: sanitizeError(result.stderr || result.stdout || 'docker mysql query failed')
    }
  }

  return {
    ok: true,
    container: mysqlContainer,
    hosts: result.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [accountUser, host] = line.split('\t')
        return { user: accountUser, host }
      })
  }
}

async function directConnectivity() {
  let connection
  try {
    connection = await mysql.createConnection(mysqlConfig)
    const [identityRows] = await connection.query(
      'SELECT CURRENT_USER() AS currentUser, USER() AS loginUser, DATABASE() AS databaseName'
    )
    const [countRows] = await connection.query(
      `
        SELECT
          SUM(table_name = 'cows') AS hasCowsTable,
          SUM(table_name = 'sensors') AS hasSensorsTable,
          SUM(table_name = 'alerts') AS hasAlertsTable
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN ('cows', 'sensors', 'alerts')
      `
    )
    const tableFlags = countRows?.[0] || {}
    const counts = {}
    for (const table of ['cows', 'sensors', 'alerts']) {
      if (!Number(tableFlags[`has${table[0].toUpperCase()}${table.slice(1)}Table`] || 0)) {
        counts[table] = null
        continue
      }
      const [rows] = await connection.query(`SELECT COUNT(*) AS total FROM \`${table}\``)
      counts[table] = Number(rows?.[0]?.total || 0)
    }
    return { ok: true, identity: identityRows?.[0] || null, counts }
  } catch (error) {
    return { ok: false, error: sanitizeError(error) }
  } finally {
    await connection?.end().catch(() => {})
  }
}

const direct = await directConnectivity()
const grants = dockerMysqlUserHosts(mysqlConfig.user)

const report = {
  ok: direct.ok,
  checkedAt: new Date().toISOString(),
  config: {
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    database: mysqlConfig.database,
    passwordConfigured: Boolean(mysqlConfig.password)
  },
  direct,
  grants
}

console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1
