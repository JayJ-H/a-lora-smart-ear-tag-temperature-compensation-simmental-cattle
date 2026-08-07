import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
dotenv.config({ path: path.join(projectRoot, '运维', '生产配置', '.env.prod'), override: true, quiet: true })

const baseUrl = String(process.env.SMOKE_BASE_URL || 'http://127.0.0.1:9191').replace(/\/+$/, '')
const userName = process.env.SMOKE_USER || process.env.ADMIN_USER || 'admin'
const password = process.env.SMOKE_PASSWORD || process.env.ADMIN_PASSWORD || ''
const outPath = path.resolve(projectRoot, 'artifacts', 'dashboard-daily-top-cow.json')

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 9193),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

function dateKey(value) {
  if (value instanceof Date) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0')
    ].join('-')
  }
  const text = String(value || '').trim()
  const match = text.match(/\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : text.slice(0, 10)
}

function numeric(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function cowKeyOf(row) {
  return String(row.animal_id || row.cow_id || row.animal_number || row.cow_number || '').trim()
}

function cowNumberOf(row) {
  return String(row.animal_number || row.cow_number || row.animal_id || row.cow_id || '').trim()
}

function measuredAtOf(row) {
  return String(row.measured_at || row.milking_time || row.production_date || '').trim()
}

function businessKeyOf(row) {
  const cowKey = cowKeyOf(row) || cowNumberOf(row)
  const timeKey = measuredAtOf(row).slice(0, 16)
  const shiftKey = String(row.shift_id || '').trim()
  const valueKey = numeric(row.milk_yield).toFixed(3)
  return `${cowKey}|${timeKey}|${shiftKey}|${valueKey}`
}

function dedupeMilkRows(rows) {
  const byKey = new Map()
  for (const row of rows) {
    const key = businessKeyOf(row)
    const current = byKey.get(key)
    if (!current || Number(row.source_priority || 99) < Number(current.source_priority || 99)) {
      byKey.set(key, row)
    }
  }
  return Array.from(byKey.values())
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || Number(body?.code || 0) >= 400) {
    throw new Error(`${options.method || 'GET'} ${pathname} failed: HTTP ${response.status} ${JSON.stringify(body)}`)
  }
  return body?.data ?? body
}

async function login() {
  const data = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userName, password })
  })
  if (!data?.token) throw new Error('login returned no token')
  return data.token
}

async function rpc(token, method, payload = {}) {
  return requestJson('/api/db/rpc', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ method, ...payload })
  })
}

async function queryMilkRows(connection, startDate, endDate) {
  const [standardRows] = await connection.query(
    `
      SELECT
        m.animal_id,
        m.animal_id AS cow_id,
        COALESCE(a.animal_number, c.cow_number, m.animal_id) AS animal_number,
        COALESCE(a.animal_number, c.cow_number, m.animal_id) AS cow_number,
        DATE_FORMAT(COALESCE(m.measured_at, m.production_date, m.created_at), '%Y-%m-%d %H:%i:%s') AS measured_at,
        DATE_FORMAT(DATE(COALESCE(m.measured_at, m.production_date, m.created_at)), '%Y-%m-%d') AS production_date,
        m.shift_id,
        m.milk_yield,
        1 AS source_priority
      FROM milk_measurement m
      LEFT JOIN animal a ON a.id = m.animal_id
      LEFT JOIN cows c ON c.id = m.animal_id
      WHERE COALESCE(m.measured_at, m.production_date, m.created_at) IS NOT NULL
        AND DATE(COALESCE(m.measured_at, m.production_date, m.created_at)) BETWEEN ? AND ?
        AND m.milk_yield > 0 AND m.milk_yield <= 300
    `,
    [startDate, endDate]
  )
  const [legacyRows] = await connection.query(
    `
      SELECT
        COALESCE(animal_id, cow_id) AS animal_id,
        cow_id,
        COALESCE(animal_number, animal_id, cow_id) AS animal_number,
        COALESCE(animal_number, animal_id, cow_id) AS cow_number,
        DATE_FORMAT(COALESCE(measured_at, milking_time, created_at), '%Y-%m-%d %H:%i:%s') AS measured_at,
        DATE_FORMAT(COALESCE(milking_time, measured_at, created_at), '%Y-%m-%d %H:%i:%s') AS milking_time,
        DATE_FORMAT(DATE(COALESCE(measured_at, milking_time, created_at)), '%Y-%m-%d') AS production_date,
        shift_id,
        volume AS milk_yield,
        2 AS source_priority
      FROM milk_records
      WHERE COALESCE(measured_at, milking_time, created_at) IS NOT NULL
        AND DATE(COALESCE(measured_at, milking_time, created_at)) BETWEEN ? AND ?
        AND volume > 0
        AND volume <= 300
    `,
    [startDate, endDate]
  )
  return dedupeMilkRows([...standardRows, ...legacyRows])
}

function buildExpectedDailyTop(rows) {
  const dailyCowBuckets = new Map()
  for (const row of rows) {
    const day = dateKey(row.production_date)
    const cowKey = cowKeyOf(row)
    if (!day || !cowKey) continue
    const byCow = dailyCowBuckets.get(day) || new Map()
    const current = byCow.get(cowKey) || {
      date: day,
      cowKey,
      cowNumber: cowNumberOf(row) || cowKey,
      value: 0,
      records: 0
    }
    current.value += numeric(row.milk_yield)
    current.records += 1
    byCow.set(cowKey, current)
    dailyCowBuckets.set(day, byCow)
  }

  return new Map(
    Array.from(dailyCowBuckets.entries()).map(([day, byCow]) => {
      const top = Array.from(byCow.values())
        .map((item) => ({ ...item, value: Number(item.value.toFixed(3)) }))
        .sort((left, right) => right.value - left.value || left.cowNumber.localeCompare(right.cowNumber))[0]
      return [day, top]
    })
  )
}

async function main() {
  const token = await login()
  const snapshot = await rpc(token, 'getDashboardProductionSnapshot', {})
  const startDate = snapshot?.dateRange?.startDate
  const endDate = snapshot?.dateRange?.endDate
  if (!startDate || !endDate) throw new Error('dashboard snapshot returned no dateRange')

  const connection = await mysql.createConnection(dbConfig)
  let rows
  try {
    rows = await queryMilkRows(connection, startDate, endDate)
  } finally {
    await connection.end().catch(() => {})
  }

  const expected = buildExpectedDailyTop(rows)
  const mismatches = []
  for (const point of snapshot.topCowSeries || []) {
    const expectedPoint = expected.get(point.date)
    const expectedValue = expectedPoint ? Number(expectedPoint.value.toFixed(1)) : 0
    const actualValue = Number(numeric(point.value).toFixed(1))
    const expectedCow = expectedPoint?.cowNumber || ''
    const actualCow = String(point.cowNumber || '').trim()
    if (actualValue !== expectedValue || (expectedCow && actualCow && actualCow !== expectedCow)) {
      mismatches.push({
        date: point.date,
        expectedValue,
        actualValue,
        expectedCow,
        actualCow,
        expected: expectedPoint,
        actual: point
      })
    }
  }

  const report = {
    ok: mismatches.length === 0,
    generatedAt: new Date().toISOString(),
    baseUrl,
    dateRange: snapshot.dateRange,
    seriesCount: snapshot.topCowSeries?.length || 0,
    milkRows: rows.length,
    mismatches,
    sample: (snapshot.topCowSeries || []).filter((item) => Number(item.value || 0) > 0).slice(0, 5)
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

main().catch(async (error) => {
  const report = {
    ok: false,
    generatedAt: new Date().toISOString(),
    error: error?.stack || error?.message || String(error)
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true }).catch(() => {})
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {})
  console.error(error)
  process.exitCode = 1
})


