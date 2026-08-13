import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
dotenv.config({ path: path.join(projectRoot, '运维', '生产配置', '.env.prod'), override: true, quiet: true })

const outPath = path.resolve(projectRoot, 'artifacts', 'shift-milk-production-closure.json')
const baseUrl = String(process.env.SMOKE_BASE_URL || 'http://127.0.0.1:9191').replace(/\/+$/, '')
const userName = process.env.SMOKE_USER || process.env.ADMIN_USER || 'admin'
const password = process.env.SMOKE_PASSWORD || process.env.ADMIN_PASSWORD || ''
const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 9193),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

function dateKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const text = String(value || '').trim()
  const match = text.match(/\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : text.slice(0, 10)
}

function addDays(key, days) {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function assert(ok, message, details = {}) {
  return { ok: !!ok, message, details }
}

async function queryOne(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params)
  return rows?.[0] || {}
}

async function queryAll(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params)
  return rows || []
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

async function cleanupScenario(connection) {
  const ids = ['milk_closure_curve', 'milk_closure_long', 'milk_closure_sparse']
  await connection.query('SET FOREIGN_KEY_CHECKS = 0')
  for (const id of ids) {
    await connection.query('DELETE FROM data_quality_issue WHERE animal_id = ? OR id LIKE ?', [id, `${id}%`])
    await connection.query('DELETE FROM milk_records WHERE cow_id = ? OR id LIKE ?', [id, `${id}%`])
    await connection.query('DELETE FROM milk_measurement WHERE animal_id = ? OR id LIKE ?', [id, `${id}%`])
    await connection.query('DELETE FROM milking_visit WHERE animal_id = ? OR id LIKE ?', [id, `${id}%`])
    await connection.query('DELETE FROM milking_session WHERE id LIKE ?', [`${id}%`])
    await connection.query('DELETE FROM fact_lactation_305 WHERE animal_id = ? OR id LIKE ?', [id, `${id}%`])
    await connection.query('DELETE FROM lactation_episode WHERE animal_id = ? OR id LIKE ?', [id, `${id}%`])
    await connection.query('DELETE FROM parity_episode WHERE animal_id = ? OR id LIKE ?', [id, `${id}%`])
    await connection.query('DELETE FROM cows WHERE id = ? OR cow_number = ?', [id, id.toUpperCase()])
    await connection.query('DELETE FROM animal WHERE id = ? OR animal_number = ?', [id, id.toUpperCase()])
  }
  await connection.query('SET FOREIGN_KEY_CHECKS = 1')
}

async function insertScenarioCow(connection, id, startDate) {
  const number = id.toUpperCase()
  await connection.query(
    `
      INSERT INTO animal (
        id, animal_number, name, breed, sex, birth_date, entry_date, status,
        reported_parity_no, lactation_start_date, created_at, updated_at
      ) VALUES (?, ?, ?, '广西水牛', '母', '2022-01-01', ?, 'active', 1, ?, NOW(3), NOW(3))
    `,
    [id, number, number, startDate, startDate]
  )
  await connection.query(
    `
      INSERT INTO cows (
        id, animal_id, cow_number, animal_number, breed, gender, birth_date,
        cow_type, status, parity, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '广西水牛', '母', '2022-01-01', '泌乳', '在群', 1, NOW(3), NOW(3))
    `,
    [id, id, number, number]
  )
  await connection.query(
    `
      INSERT INTO parity_episode (id, animal_id, parity_no, start_date, parity_status, created_at, updated_at)
      VALUES (?, ?, 1, ?, 'open', NOW(3), NOW(3))
    `,
    [`${id}_parity_1`, id, startDate]
  )
  await connection.query(
    `
      INSERT INTO lactation_episode (id, animal_id, lactation_no, parity_no, start_date, status, created_at, updated_at)
      VALUES (?, ?, 1, 1, ?, 'open', NOW(3), NOW(3))
    `,
    [`${id}_lactation_1`, id, startDate]
  )
}

async function insertMilk(connection, cowId, startDate, dayOffset, shift, milkYield) {
  const date = addDays(startDate, dayOffset)
  const hour = shift === '晚班' ? '18:00:00' : '06:00:00'
  const measuredAt = `${date} ${hour}`
  const id = `${cowId}_milk_${dayOffset}_${shift === '晚班' ? 'pm' : 'am'}`
  const sessionId = `milk_closure_session_${date.replaceAll('-', '')}_${shift === '晚班' ? 'pm' : 'am'}`
  const visitId = `${cowId}_visit_${dayOffset}_${shift === '晚班' ? 'pm' : 'am'}`
  const dim = dayOffset + 1
  await connection.query(
    `
      INSERT INTO milking_session (
        id, session_code, shift_id, production_date, started_at, source_type, source_table,
        source_record_id, session_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'validation', 'validate-shift-milk-production-closure', ?, 'recorded', NOW(3), NOW(3))
      ON DUPLICATE KEY UPDATE
        id = VALUES(id),
        shift_id = VALUES(shift_id),
        production_date = VALUES(production_date),
        started_at = VALUES(started_at),
        source_type = VALUES(source_type),
        source_table = VALUES(source_table),
        source_record_id = VALUES(source_record_id),
        session_status = VALUES(session_status),
        updated_at = NOW(3)
    `,
    [sessionId, `${date}-${shift}`, shift, date, measuredAt, sessionId]
  )
  await connection.query(
    `
      INSERT INTO milking_visit (
        id, session_id, session_code, animal_id, entered_at, measured_at,
        production_date, shift_id, parity_no, days_in_milk, period_source, milk_yield,
        source_type, source_table, source_record_id, quality_flag, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'system_derived_from_lactation_episode', ?,
        'validation', 'validate-shift-milk-production-closure', ?, 'valid', NOW(3), NOW(3))
    `,
    [visitId, sessionId, `${date}-${shift}`, cowId, measuredAt, measuredAt, date, shift, dim, milkYield, visitId]
  )
  await connection.query(
    `
      INSERT INTO milk_measurement (
        id, visit_id, animal_id, measured_at, production_date, shift_id,
        parity_no, lactation_id, days_in_milk, period_source, session_code, milk_yield,
        source_type, source_table, source_record_id, lactation_start_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'system_derived_from_lactation_episode', ?, ?,
        'validation', 'validate-shift-milk-production-closure', ?, ?, NOW(3), NOW(3))
    `,
    [id, visitId, cowId, measuredAt, date, shift, `${cowId}_lactation_1`, dim, `${date}-${shift}`, milkYield, id, startDate]
  )
}

async function insertScenarios(connection) {
  await cleanupScenario(connection)
  await insertScenarioCow(connection, 'milk_closure_curve', '2026-05-01')
  for (const day of [0, 1, 2, 4, 5, 6]) {
    await insertMilk(connection, 'milk_closure_curve', '2026-05-01', day, '早班', 7 + day * 0.2)
    await insertMilk(connection, 'milk_closure_curve', '2026-05-01', day, '晚班', 7.4 + day * 0.2)
  }

  await insertScenarioCow(connection, 'milk_closure_long', '2026-05-01')
  for (const day of [0, 1, 6, 7]) {
    await insertMilk(connection, 'milk_closure_long', '2026-05-01', day, '早班', 6 + day * 0.15)
    await insertMilk(connection, 'milk_closure_long', '2026-05-01', day, '晚班', 6.3 + day * 0.15)
  }

  await insertScenarioCow(connection, 'milk_closure_sparse', '2026-05-01')
  await connection.query(
    "UPDATE lactation_episode SET end_date = '2026-05-03', days_in_milk = 3 WHERE animal_id = 'milk_closure_sparse'"
  )
  await connection.query(
    "UPDATE parity_episode SET end_date = '2026-05-03' WHERE animal_id = 'milk_closure_sparse'"
  )
  await insertMilk(connection, 'milk_closure_sparse', '2026-05-01', 0, '早班', 5.8)
}

function findItem(items, cowNumber, date, shift) {
  return items.find((item) => item.cowNumber === cowNumber && item.date === date && item.expectedShift === shift)
}

async function main() {
  const connection = await mysql.createConnection(dbConfig)
  const checks = []
  let token = ''
  try {
    const counts = await queryOne(connection, `
      SELECT
        (SELECT COUNT(*) FROM animal) AS animal,
        (SELECT COUNT(*) FROM cows) AS cows,
        (SELECT COUNT(*) FROM parity_episode) AS parity_episode,
        (SELECT COUNT(*) FROM lactation_episode) AS lactation_episode,
        (SELECT COUNT(*) FROM milk_measurement) AS milk_measurement,
        (SELECT COUNT(*) FROM milk_records) AS milk_records,
        (SELECT COUNT(*) FROM milking_visit) AS milking_visit,
        (SELECT COUNT(DISTINCT production_date) FROM milk_measurement) AS milk_dates,
        (SELECT COUNT(DISTINCT shift_id) FROM milk_measurement) AS milk_shifts,
        (SELECT COUNT(*) FROM fact_lactation_305) AS fact_lactation_305
    `)
    checks.push(assert(Number(counts.animal) >= 265, '个体建档已通过页面导入', counts))
    checks.push(assert(Number(counts.parity_episode) >= 265 && Number(counts.lactation_episode) >= 265, '系谱胎次/产犊日已生成周期事实', counts))
    checks.push(assert(Number(counts.milk_measurement) >= 7182 && Number(counts.milk_records) >= 7182 && Number(counts.milking_visit) >= 7182, '奶厅测量已写入标准表、兼容表和访问表', counts))
    checks.push(assert(Number(counts.milk_dates) >= 30, '近 30 天产奶日期已入库', counts))
    checks.push(assert(Number(counts.fact_lactation_305) >= 200, '305 天事实已按 1-305 DIM 重算', counts))

    const milkCoverage = await queryOne(connection, `
      SELECT
        COUNT(*) AS total,
        SUM(parity_no IS NOT NULL) AS parity_filled,
        SUM(days_in_milk IS NOT NULL) AS dim_filled,
        MIN(days_in_milk) AS min_dim,
        MAX(days_in_milk) AS max_dim,
        COUNT(DISTINCT animal_id) AS cow_count
      FROM milk_measurement
    `)
    checks.push(assert(Number(milkCoverage.parity_filled) === Number(milkCoverage.total), '奶量明细全量归属胎次', milkCoverage))
    checks.push(assert(Number(milkCoverage.dim_filled) === Number(milkCoverage.total), '奶量明细全量计算 DIM/产奶天数', milkCoverage))

    const factCoverage = await queryOne(connection, `
      SELECT
        COUNT(*) AS rows_count,
        SUM(coverage_days > 0) AS coverage_filled,
        SUM(milk_yield_305 IS NOT NULL OR milk_305 IS NOT NULL) AS milk305_filled,
        MIN(coverage_days) AS min_coverage,
        MAX(coverage_days) AS max_coverage
      FROM fact_lactation_305
    `)
    checks.push(assert(Number(factCoverage.coverage_filled) === Number(factCoverage.rows_count), '305 天事实包含覆盖天数', factCoverage))
    checks.push(assert(Number(factCoverage.milk305_filled) === Number(factCoverage.rows_count), '305 天事实包含 305 天产量/观测和', factCoverage))

    const annualRows = await queryAll(connection, `
      SELECT
        a.animal_number,
        m.parity_no,
        COUNT(*) AS n,
        ROUND(SUM(m.milk_yield), 3) AS milk
      FROM milk_measurement m
      JOIN animal a ON a.id = m.animal_id
      WHERE m.production_date BETWEEN '2026-01-01' AND '2026-12-31'
      GROUP BY a.animal_number, m.parity_no
      ORDER BY n DESC
      LIMIT 10
    `)
    checks.push(assert(annualRows.length > 0 && annualRows.every((row) => Number(row.parity_no) > 0), '年度数据可按日期导出并保留胎次标记', { sample: annualRows.slice(0, 3) }))

    await insertScenarios(connection)
    token = await login()
    const review = await requestJson('/api/milk/missing-review?startDate=2026-05-01&endDate=2026-05-08&expectedShifts=早班,晚班', {
      headers: { Authorization: token }
    })
    const items = review.items || []
    const curveItem = findItem(items, 'MILK_CLOSURE_CURVE', '2026-05-04', '早班')
    const longItem = findItem(items, 'MILK_CLOSURE_LONG', '2026-05-04', '早班')
    const sparseItem = findItem(items, 'MILK_CLOSURE_SPARSE', '2026-05-02', '早班')
    checks.push(assert(curveItem?.recommendationMethod === 'lactation_305_curve' && Number(curveItem.recommendedMilk) > 0, '3 天以内缺失返回 305 曲线推荐值', { item: curveItem }))
    checks.push(assert(longItem?.recommendationMethod === 'manual_required' && Number(longItem.recommendedMilk) === 0, '连续缺失超过 3 天返回人工核对且不补偿', { item: longItem }))
    checks.push(assert(sparseItem?.recommendationMethod === 'manual_required' && Number(sparseItem.recommendedMilk) === 0, '有效产奶记录少于 2 次返回人工核对且不补偿', { item: sparseItem }))

    const report = {
      ok: checks.every((item) => item.ok),
      generatedAt: new Date().toISOString(),
      baseUrl,
      counts,
      milkCoverage,
      factCoverage,
      reviewSummary: review.summary,
      checks
    }
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(report, null, 2))
    if (!report.ok) process.exitCode = 1
  } finally {
    await connection.end().catch(() => {})
  }
}

main().catch(async (error) => {
  const report = { ok: false, generatedAt: new Date().toISOString(), error: error?.stack || error?.message || String(error) }
  await fs.mkdir(path.dirname(outPath), { recursive: true }).catch(() => {})
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {})
  console.error(error)
  process.exitCode = 1
})


