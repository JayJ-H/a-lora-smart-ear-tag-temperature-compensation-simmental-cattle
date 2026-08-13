import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

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

const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
const finding = (severity, code, message, evidence = '') => ({ severity, code, message, evidence })

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
    [dbConfig.database, table]
  )
  return Number(rows?.[0]?.count || 0) > 0
}

function auditSourceContracts() {
  const issues = []
  const backend = read('脚本/mysql-backend-server.mjs')
  const importer = read('src/services/import-adapter.ts')

  if (!/const days = avg === null && parityYield === null && milk305 !== null \? 305 : uploadedDays/.test(backend)) {
    issues.push(finding('high', 'SUMMARY_305_SPLIT_SHRINK_RISK', '后端汇总待拆分仍可能用 milk305/305 只拆 reported_days，导致确认总量缩水。'))
  }
  if (!/const coverageDays = bucket\.days\.size \|\| bucket\.count/.test(importer)) {
    issues.push(finding('high', 'IMPORT_COVERAGE_DAYS_RECORD_COUNT_RISK', '导入路径 fact_lactation_305.coverage_days 仍可能使用记录数而不是唯一天数。'))
  }
  if (/stableId\('lactation', input\.cowId, parityNo, bucket\.start\)/.test(importer)) {
    issues.push(finding('high', 'IMPORT_LACTATION_ID_MISMATCH', '导入路径 fact_lactation_305.lactation_id 仍使用 lactation 而不是 lactation_episode 口径。'))
  }
  if (!/await auditOperation\(\{[\s\S]*actionType: 'confirm_milk_missing_fill'/.test(backend)) {
    issues.push(finding('high', 'MILK_REVIEW_AUDIT_BYPASSES_CANONICAL', '泌乳缺失确认未走 auditOperation canonical 审计。'))
  }
  if (!/method:\s*'lactation_305_curve'/.test(backend) || !/MILK_REVIEW_MAX_RECOMMENDABLE_MISSING_RUN_DAYS\s*=\s*3/.test(backend)) {
    issues.push(finding('high', 'MILK_REVIEW_RECOMMENDATION_RULE_DRIFT', '泌乳缺失推荐未固定为 305 天曲线和连续缺失 3 天阈值。'))
  }

  return issues
}

async function auditDatabase() {
  const issues = []
  let connection
  try {
    connection = await mysql.createConnection(dbConfig)
    for (const table of ['milk_measurement', 'milk_records', 'fact_lactation_305', 'lactation_episode', 'data_quality_issue']) {
      if (!(await tableExists(connection, table))) {
        issues.push(finding('high', 'REQUIRED_TABLE_MISSING', `缺少泌乳闭环必需表 ${table}。`))
      }
    }
    if (!(await tableExists(connection, 'fact_lactation_305')) || !(await tableExists(connection, 'milk_measurement'))) return issues

    const [coverageRows] = await connection.query(`
      SELECT COUNT(*) AS count
      FROM fact_lactation_305 f
      JOIN (
        SELECT animal_id, parity_no, lactation_id, COUNT(*) AS raw_records,
               COUNT(DISTINCT COALESCE(days_in_milk, DATE(production_date), DATE(measured_at))) AS actual_days
        FROM milk_measurement
        WHERE days_in_milk BETWEEN 1 AND 305
        GROUP BY animal_id, parity_no, lactation_id
      ) m ON m.animal_id = f.animal_id AND m.parity_no = f.parity_no AND m.lactation_id = f.lactation_id
      WHERE f.coverage_days IS NOT NULL
        AND f.coverage_days <> m.actual_days
    `)
    const coverageMismatch = Number(coverageRows?.[0]?.count || 0)
    if (coverageMismatch > 0) {
      issues.push(finding('warning', 'FACT_305_COVERAGE_DAYS_MISMATCH', 'fact_lactation_305.coverage_days 与 milk_measurement 唯一 DIM/日期数不一致。', String(coverageMismatch)))
    }

    const [staleRows] = await connection.query(`
      SELECT COUNT(*) AS count
      FROM fact_lactation_305 f
      JOIN (
        SELECT animal_id, parity_no, lactation_id, ROUND(SUM(milk_yield), 2) AS measurement_305,
               COUNT(DISTINCT COALESCE(days_in_milk, DATE(production_date), DATE(measured_at))) AS measurement_days
        FROM milk_measurement
        WHERE days_in_milk BETWEEN 1 AND 305
        GROUP BY animal_id, parity_no, lactation_id
      ) m ON m.animal_id = f.animal_id AND m.parity_no = f.parity_no AND m.lactation_id = f.lactation_id
      WHERE ABS(COALESCE(f.milk_yield_305, f.milk_305, 0) - m.measurement_305) > 0.01
         OR COALESCE(f.coverage_days, f.record_days, 0) <> m.measurement_days
    `)
    const stale = Number(staleRows?.[0]?.count || 0)
    if (stale > 0) {
      issues.push(finding('warning', 'FACT_305_STALE_OR_MISMATCH', 'fact_lactation_305 与 milk_measurement 汇总不一致，可能需要重算。', String(stale)))
    }

    if (await tableExists(connection, 'lactation_episode')) {
      const [orphanRows] = await connection.query(`
        SELECT COUNT(*) AS count
        FROM milk_measurement m
        LEFT JOIN lactation_episode l ON l.id = m.lactation_id
        WHERE m.source_table = 'milk_missing_review'
          AND m.lactation_id IS NOT NULL
          AND l.id IS NULL
      `)
      const orphan = Number(orphanRows?.[0]?.count || 0)
      if (orphan > 0) {
        issues.push(finding('high', 'MILK_REVIEW_LACTATION_ID_ORPHAN', '泌乳复核补录 milk_measurement.lactation_id 找不到 lactation_episode。', String(orphan)))
      }
    }
  } catch (error) {
    issues.push(finding('warning', 'DB_CONNECT_SKIPPED', `数据库连接失败，已跳过泌乳复核数据审计：${error?.message || String(error)}`))
  } finally {
    await connection?.end().catch(() => undefined)
  }
  return issues
}

const issues = [...auditSourceContracts(), ...(await auditDatabase())]
const blocking = issues.filter((item) => item.severity === 'high')
console.log(JSON.stringify({ ok: blocking.length === 0, blockingCount: blocking.length, issues }, null, 2))
if (blocking.length) process.exitCode = 1
