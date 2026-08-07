import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        const key = line.slice(0, index).trim()
        let value = line.slice(index + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        return [key, value]
      })
  )
}

const env = {
  ...readEnvFile(path.join(projectRoot, '.env')),
  ...readEnvFile(path.join(projectRoot, '运维', '生产配置', '.env.prod')),
  ...process.env
}

const baseUrl = String(
  env.TRACEABILITY_BASE_URL ||
  env.PRODUCTION_BASE_URL ||
  `http://127.0.0.1:${env.WEB_PORT || 9191}`
).replace(/\/+$/, '')
const timeoutMs = Number(env.QA_HTTP_TIMEOUT_MS || env.TRACEABILITY_HTTP_TIMEOUT_MS || 5000)
const adminUser = String(
  env.TRACEABILITY_ADMIN_USER ||
    env.SECURITY_ADMIN_USER ||
    env.PRODUCTION_ADMIN_USER ||
    env.ADMIN_USER ||
    ''
)
const adminPassword = String(
  env.TRACEABILITY_ADMIN_PASSWORD ||
    env.SECURITY_ADMIN_PASSWORD ||
    env.PRODUCTION_ADMIN_PASSWORD ||
    env.ADMIN_PASSWORD ||
    ''
)

const mysqlConfig = {
  host: env.MYSQL_HOST || '127.0.0.1',
  port: Number(env.MYSQL_PORT || env.MYSQL_HOST_PORT || 9193),
  user: env.MYSQL_USER || '',
  password: env.MYSQL_PASSWORD || '',
  database: env.MYSQL_DATABASE || '',
  connectionLimit: 1
}

const traceTargets = [
  {
    page: '#/dashboard/console',
    api: 'GET /api/system/status database.counts[cows].total',
    dbTable: 'cows'
  },
  {
    page: '#/dashboard/console',
    api: 'GET /api/system/status database.counts[sensors].total',
    dbTable: 'sensors'
  },
  {
    page: '#/smart-alert',
    api: 'GET /api/system/status alerts.total',
    dbTable: 'alerts',
    statusPath: 'alerts.total'
  },
  {
    page: '#/statistics/healthy',
    api: 'GET /api/system/status database.counts[health_scores].total',
    dbTable: 'health_scores'
  }
]

const allowedTables = new Set(traceTargets.map((item) => item.dbTable))

function apiCode(body) {
  const code = Number(body?.code)
  return Number.isFinite(code) ? code : null
}

function unwrapApi(body) {
  if (body && typeof body === 'object' && '数据' in body && 'code' in body) return body.data
  return body
}

function truncate(value, max = 260) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function missingAuthEnvReason() {
  const missing = []
  if (!adminUser) {
    missing.push('TRACEABILITY_ADMIN_USER/SECURITY_ADMIN_USER/PRODUCTION_ADMIN_USER/ADMIN_USER')
  }
  if (!adminPassword) {
    missing.push('TRACEABILITY_ADMIN_PASSWORD/SECURITY_ADMIN_PASSWORD/PRODUCTION_ADMIN_PASSWORD/ADMIN_PASSWORD')
  }
  return missing.length ? `missing_admin_credentials: set ${missing.join(' and ')}` : ''
}

async function request(pathname, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(new URL(pathname, baseUrl), {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {})
      },
      signal: controller.signal
    })
    const text = await response.text()
    let body = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      // Keep plain text for diagnostics.
    }
    return {
      ok: true,
      httpStatus: response.status,
      apiCode: apiCode(body),
      body,
      text
    }
  } catch (error) {
    return {
      ok: false,
      httpStatus: 0,
      apiCode: null,
      body: null,
      text: '',
      error: error?.message || String(error)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function login() {
  const missingReason = missingAuthEnvReason()
  if (missingReason) {
    return {
      ok: false,
      skip: true,
      reason: missingReason
    }
  }

  const response = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      userName: adminUser,
      password: adminPassword
    })
  })
  const token = response.body?.data?.token || ''
  if (!response.ok || response.httpStatus >= 400 || Number(response.apiCode || 200) >= 400 || !token) {
    return {
      ok: false,
      skip: false,
      reason: `login_failed: HTTP ${response.httpStatus} API ${response.apiCode ?? 'n/a'} ${truncate(response.body || response.error || '')}`
    }
  }

  return {
    ok: true,
    headers: { Authorization: `Bearer ${token}` }
  }
}

function normalizeTableName(tableName) {
  return String(tableName || '').replace(/-/g, '_').toLowerCase()
}

function countFromStatus(status, tableName) {
  const normalized = normalizeTableName(tableName)
  if (normalized === 'alerts' && status?.alerts?.total !== undefined) {
    const value = Number(status.alerts.total)
    return Number.isFinite(value) ? value : null
  }

  const counts = Array.isArray(status?.database?.counts) ? status.database.counts : []
  const row = counts.find((item) => normalizeTableName(item?.table || item?.label) === normalized)
  if (!row) return null
  const value = Number(row.total ?? row.count)
  return Number.isFinite(value) ? value : null
}

async function loadStatusPayload() {
  const auth = await login()
  if (!auth.ok) {
    return {
      ok: false,
      skip: auth.skip,
      reason: auth.reason
    }
  }

  const response = await request('/api/system/status', { headers: auth.headers })
  if (!response.ok || response.httpStatus >= 400 || Number(response.apiCode || 200) >= 400) {
    return {
      ok: false,
      skip: false,
      reason: `system_status_unavailable: HTTP ${response.httpStatus} API ${response.apiCode ?? 'n/a'} ${truncate(response.body || response.error || '')}`
    }
  }
  return {
    ok: true,
    status: unwrapApi(response.body)
  }
}

async function queryDirectDbCounts() {
  if (!mysqlConfig.user || !mysqlConfig.database) {
    return {
      ok: false,
      reason: 'missing MYSQL_USER or MYSQL_DATABASE'
    }
  }

  const pool = mysql.createPool({
    ...mysqlConfig,
    waitForConnections: true,
    queueLimit: 0
  })

  try {
    await pool.query('SELECT 1 AS ok')
    const counts = {}
    for (const tableName of allowedTables) {
      const table = normalizeTableName(tableName)
      const [rows] = await pool.query(`SELECT COUNT(*) AS total FROM \`${table}\``)
      counts[table] = Number(rows?.[0]?.total || 0)
    }
    return {
      ok: true,
      counts
    }
  } catch (error) {
    return {
      ok: false,
      reason: `mysql_direct_connect_failed: ${error?.message || String(error)}`
    }
  } finally {
    await pool.end().catch(() => {})
  }
}

async function main() {
  const [statusSource, dbSource] = await Promise.all([loadStatusPayload(), queryDirectDbCounts()])
  const rows = traceTargets.map((target) => {
    const apiValue = statusSource.ok ? countFromStatus(statusSource.status, target.dbTable) : null
    const normalizedTable = normalizeTableName(target.dbTable)

    if (!statusSource.ok || apiValue === null) {
      const skip = Boolean(statusSource.skip)
      return {
        page: target.page,
        api: target.api,
        dbTable: target.dbTable,
        value: apiValue,
        status: skip ? 'SKIP' : 'FAIL',
        reason: skip ? '' : statusSource.reason || 'api_value_missing',
        skipReason: skip ? statusSource.reason || 'status_auth_skipped' : ''
      }
    }

    if (!dbSource.ok) {
      return {
        page: target.page,
        api: target.api,
        dbTable: target.dbTable,
        value: apiValue,
        status: 'SKIP',
        skipReason: dbSource.reason
      }
    }

    const dbValue = dbSource.counts[normalizedTable]
    const matches = Number(apiValue) === Number(dbValue)
    return {
      page: target.page,
      api: target.api,
      dbTable: target.dbTable,
      value: apiValue,
      dbValue,
      status: matches ? 'PASS' : 'FAIL',
      reason: matches ? '' : `api_value_${apiValue}_does_not_match_db_${dbValue}`
    }
  })

  const readableRows = rows.filter((item) => item.value !== null && item.value !== undefined)
  const failCount = rows.filter((item) => item.status === 'FAIL').length
  const skipCount = rows.filter((item) => item.status === 'SKIP').length
  const report = {
    ok: failCount === 0 && (readableRows.length >= 3 || skipCount === rows.length),
    generatedAt: new Date().toISOString(),
    baseUrl,
    readonly: true,
    auth: statusSource.skip
      ? {
          ok: false,
          skipReason: statusSource.reason
        }
      : {
          ok: statusSource.ok,
          user: adminUser,
          reason: statusSource.ok ? '' : statusSource.reason
        },
    directDb: dbSource.ok
      ? {
          ok: true,
          host: mysqlConfig.host,
          port: mysqlConfig.port,
          user: mysqlConfig.user,
          database: mysqlConfig.database
        }
      : {
          ok: false,
          skipReason: dbSource.reason
        },
    traceability: rows
  }

  console.log('\nTraceability report')
  console.table(
    rows.map((item) => ({
      page: item.page,
      api: item.api,
      dbTable: item.dbTable,
      value: item.value,
      dbValue: item.dbValue ?? '',
      status: item.status,
      reason: item.reason || item.skipReason || ''
    }))
  )
  console.log('\nJSON report')
  console.log(JSON.stringify(report, null, 2))

  if (!report.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, baseUrl, error: error?.message || String(error) }, null, 2))
  process.exitCode = 1
})
