import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

const importBatch = process.env.TEMPERATURE_IMPORT_BATCH || '2026-05-temperature-alert-v1'
const backendUrl = process.env.LOCAL_BACKEND_URL || 'http://127.0.0.1:9192'
const frontendUrl = process.env.LOCAL_FRONTEND_URL || 'http://127.0.0.1:9191'

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 9193),
  user: process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'cattle_management'
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let body = text
  try {
    body = JSON.parse(text)
  } catch {
    // keep raw response text
  }
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${text.slice(0, 200)}`)
  }
  return body
}

function unwrapApiData(body, label) {
  if (body && typeof body === 'object' && 'code' in body) {
    if (body.code >= 400) throw new Error(`${label} returned API code ${body.code}: ${body.msg || 'unknown error'}`)
    return body.data
  }
  return body
}

function validateSystemStatus(status) {
  if (!status || typeof status !== 'object') throw new Error('System status payload is empty')
  if (!status.backend?.ok) throw new Error('System status reports backend offline')
  if (!status.database?.ok) throw new Error(`System status reports database error: ${status.database?.error || 'unknown'}`)
  if (!status.dataFreshness) throw new Error('System status missing dataFreshness')
  if (!status.alerts) throw new Error('System status missing alerts')
  if (!status.readiness?.items?.length) throw new Error('System status missing readiness items')

  const sensorTotal = Number(status.dataFreshness.totalCount || 0)
  const alertTotal = Number(status.alerts.total || 0)
  if (sensorTotal < 270) throw new Error(`System status expected at least 270 sensors, got ${sensorTotal}`)
  if (alertTotal <= 0) throw new Error('System status expected alerts, got 0')

  return {
    generatedAt: status.generatedAt,
    readiness: {
      level: status.readiness.level,
      percent: status.readiness.percent,
      risks: (status.readiness.risks || []).map((item) => item.label)
    },
    dataFreshness: {
      state: status.dataFreshness.state,
      totalCount: status.dataFreshness.totalCount,
      last24hCount: status.dataFreshness.last24hCount,
      ageMinutes: status.dataFreshness.ageMinutes,
      latest: status.dataFreshness.latest
    },
    alerts: {
      total: status.alerts.total,
      active: status.alerts.active,
      bySeverity: status.alerts.bySeverity,
      latest: status.alerts.latest
    }
  }
}

async function checkDatabase() {
  let connection
  try {
    connection = await mysql.createConnection(dbConfig)
  } catch (error) {
    throw new Error(
      `Cannot connect to MySQL at ${dbConfig.host}:${dbConfig.port}/${dbConfig.database} as ${dbConfig.user}: ${error.message || error.code || error}`
    )
  }
  try {
    const [identityRows] = await connection.query(
      'SELECT CURRENT_USER() AS currentUser, DATABASE() AS dbName'
    )
    const [counts] = await connection.query(
      `
        SELECT 'cows' AS tableName, COUNT(*) AS countValue
        FROM cows
        WHERE cow_number BETWEEN '51' AND '60'
        UNION ALL
        SELECT 'sensors', COUNT(*)
        FROM sensors
        WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.importBatch')) = ?
        UNION ALL
        SELECT 'alerts', COUNT(*)
        FROM alerts
        WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.importBatch')) = ?
        UNION ALL
        SELECT 'health_scores', COUNT(*)
        FROM health_scores
        WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.importBatch')) = ?
      `,
      [importBatch, importBatch, importBatch]
    )
    const countMap = Object.fromEntries(
      counts.map((row) => [row.tableName, Number(row.countValue)])
    )

    if (countMap.cows < 10) throw new Error(`Expected at least 10 cows, got ${countMap.cows}`)
    if (countMap.sensors !== 270) throw new Error(`Expected 270 imported sensors, got ${countMap.sensors}`)
    if (countMap.alerts <= 0) throw new Error('Expected imported alerts, got 0')
    if (countMap.health_scores < 10) {
      throw new Error(`Expected at least 10 health scores, got ${countMap.health_scores}`)
    }

    return {
      ok: true,
      identity: identityRows[0],
      counts: countMap
    }
  } finally {
    if (connection) await connection.end()
  }
}

async function checkBackend() {
  const health = await requestJson(`${backendUrl}/api/health`)
  const systemStatus = validateSystemStatus(
    unwrapApiData(await requestJson(`${backendUrl}/api/system/status`), 'system status')
  )
  const rpc = await requestJson(`${backendUrl}/api/db/rpc`, {
    method: 'POST',
    body: JSON.stringify({
      method: 'getTableData',
      tableName: 'alerts'
    })
  })
  const alerts = Array.isArray(rpc?.data) ? rpc.data : []
  const importedAlerts = alerts.filter((alert) => alert.importBatch === importBatch)
  if (importedAlerts.length <= 0) {
    throw new Error('Backend RPC returned no imported alerts')
  }
  return {
    ok: true,
    health,
    systemStatus,
    importedAlerts: importedAlerts.length,
    sampleAlert: importedAlerts[0]
  }
}

async function checkFrontendProxy() {
  const health = await requestJson(`${frontendUrl}/api/health`)
  const systemStatus = validateSystemStatus(
    unwrapApiData(await requestJson(`${frontendUrl}/api/system/status`), 'frontend proxy system status')
  )
  return {
    ok: true,
    health,
    systemStatus
  }
}

async function main() {
  const checks = {
    database: await checkDatabase(),
    backend: await checkBackend(),
    frontendProxy: await checkFrontendProxy()
  }

  console.log(JSON.stringify({ ok: true, importBatch, checks }, null, 2))
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        importBatch,
        error: error.message
      },
      null,
      2
    )
  )
  process.exitCode = 1
})
