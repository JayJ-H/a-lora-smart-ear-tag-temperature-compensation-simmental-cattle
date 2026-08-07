import crypto from 'node:crypto'
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

const apply = process.argv.includes('--apply')
const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

function stableId(prefix, ...values) {
  const raw = values.map((value) => String(value ?? '')).join(':')
  const body = raw.replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 10)
  return [prefix, body.slice(0, Math.max(0, 64 - prefix.length - hash.length - 2)), hash]
    .filter(Boolean)
    .join('_')
    .slice(0, 64)
}

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [dbConfig.database, table, column]
  )
  return Number(rows?.[0]?.count || 0) > 0
}

async function addColumnIfMissing(connection, table, column, definition, changes) {
  if (await columnExists(connection, table, column)) return
  changes.push({ action: apply ? 'add_column' : 'would_add_column', table, column, definition })
  if (apply) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
}

async function ensureFactColumns(connection, changes) {
  await addColumnIfMissing(connection, 'fact_lactation_305', 'milk_yield_305', 'DECIMAL(18,6) NULL', changes)
  await addColumnIfMissing(connection, 'fact_lactation_305', 'animal_number', 'VARCHAR(64) NULL', changes)
  await addColumnIfMissing(connection, 'fact_lactation_305', 'cow_number', 'VARCHAR(64) NULL', changes)
  await addColumnIfMissing(connection, 'fact_lactation_305', 'lactation_no', 'INT NULL', changes)
  await addColumnIfMissing(connection, 'fact_lactation_305', 'record_count', 'INT NULL', changes)
  await addColumnIfMissing(connection, 'fact_lactation_305', 'coverage_days', 'INT NULL', changes)
  await addColumnIfMissing(connection, 'fact_lactation_305', 'missing_days', 'INT NULL', changes)
  await addColumnIfMissing(connection, 'fact_lactation_305', 'source_table', 'VARCHAR(512) NULL', changes)
  await addColumnIfMissing(connection, 'fact_lactation_305', 'source_record_ids', 'JSON NULL', changes)
}

async function loadFactRows(connection) {
  const [rows] = await connection.query(`
    SELECT
      m.animal_id,
      COALESCE(a.animal_number, m.animal_id) AS animal_number,
      COALESCE(m.parity_no, l.parity_no, 1) AS parity_no,
      COALESCE(m.lactation_id, l.id, CONCAT('lactation_episode_', m.animal_id, '_', COALESCE(m.parity_no, 1))) AS lactation_id,
      MIN(COALESCE(l.start_date, DATE_SUB(DATE(m.measured_at), INTERVAL GREATEST(COALESCE(m.days_in_milk, 1) - 1, 0) DAY), m.production_date, DATE(m.measured_at))) AS start_date,
      MAX(COALESCE(m.production_date, DATE(m.measured_at))) AS end_date,
      ROUND(SUM(COALESCE(m.milk_yield, 0)), 6) AS milk_305,
      COUNT(*) AS record_count,
      COUNT(DISTINCT COALESCE(m.days_in_milk, DATEDIFF(COALESCE(m.production_date, DATE(m.measured_at)), l.start_date) + 1, DATE(m.production_date), DATE(m.measured_at))) AS coverage_days,
      JSON_ARRAYAGG(m.id) AS source_record_ids
    FROM milk_measurement m
    LEFT JOIN lactation_episode l
      ON l.animal_id = m.animal_id
     AND (m.lactation_id = l.id OR (m.lactation_id IS NULL AND (m.parity_no IS NULL OR m.parity_no = l.parity_no)))
     AND (l.start_date IS NULL OR COALESCE(m.production_date, DATE(m.measured_at)) >= l.start_date)
     AND (l.end_date IS NULL OR COALESCE(m.production_date, DATE(m.measured_at)) <= l.end_date)
    LEFT JOIN animal a ON a.id = m.animal_id
    WHERE m.animal_id IS NOT NULL
      AND m.milk_yield IS NOT NULL
      AND COALESCE(m.days_in_milk, DATEDIFF(COALESCE(m.production_date, DATE(m.measured_at)), l.start_date) + 1, 1) BETWEEN 1 AND 305
    GROUP BY m.animal_id, COALESCE(m.parity_no, l.parity_no, 1), COALESCE(m.lactation_id, l.id, CONCAT('lactation_episode_', m.animal_id, '_', COALESCE(m.parity_no, 1)))
  `)
  return rows
}

async function upsertFactRows(connection, rows, changes) {
  changes.push({ action: apply ? 'upsert_fact_lactation_305' : 'would_upsert_fact_lactation_305', count: rows.length })
  if (!apply) return
  const now = new Date()
  for (const row of rows) {
    const id = stableId('fact_lactation_305', row.animal_id, row.parity_no, row.lactation_id)
    const coverageDays = Number(row.coverage_days || 0)
    await connection.query(
      `
        INSERT INTO fact_lactation_305 (
          id, animal_id, animal_number, cow_number, lactation_id, parity_no, lactation_no,
          start_date, end_date, milk_305, milk_yield_305, record_days, record_count,
          coverage_days, missing_days, estimated_flag, method_code, source_table,
          source_record_ids, recomputed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'milk_measurement_sum_1_305', 'milk_measurement', CAST(? AS JSON), ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          animal_number = VALUES(animal_number),
          cow_number = VALUES(cow_number),
          parity_no = VALUES(parity_no),
          lactation_no = VALUES(lactation_no),
          start_date = VALUES(start_date),
          end_date = VALUES(end_date),
          milk_305 = VALUES(milk_305),
          milk_yield_305 = VALUES(milk_yield_305),
          record_days = VALUES(record_days),
          record_count = VALUES(record_count),
          coverage_days = VALUES(coverage_days),
          missing_days = VALUES(missing_days),
          estimated_flag = VALUES(estimated_flag),
          method_code = VALUES(method_code),
          source_table = VALUES(source_table),
          source_record_ids = VALUES(source_record_ids),
          recomputed_at = VALUES(recomputed_at),
          updated_at = VALUES(updated_at)
      `,
      [
        id,
        row.animal_id,
        row.animal_number,
        row.animal_number,
        row.lactation_id,
        row.parity_no,
        row.parity_no,
        row.start_date,
        row.end_date,
        row.milk_305,
        row.milk_305,
        coverageDays,
        row.record_count,
        coverageDays,
        Math.max(0, 305 - coverageDays),
        JSON.stringify(row.source_record_ids || []),
        now,
        now,
        now
      ]
    )
  }
}

async function completePendingJobs(connection, changes) {
  const [rows] = await connection.query(`
    SELECT COUNT(*) AS count
    FROM derivation_recompute_job
    WHERE COALESCE(job_status, '') = 'pending'
  `)
  const count = Number(rows?.[0]?.count || 0)
  changes.push({ action: apply ? 'complete_pending_recompute_jobs' : 'would_complete_pending_recompute_jobs', count })
  if (apply && count) {
    await connection.query(`
      UPDATE derivation_recompute_job
      SET job_status = 'completed',
          finished_at = COALESCE(finished_at, NOW(3)),
          updated_at = NOW(3)
      WHERE COALESCE(job_status, '') = 'pending'
    `)
  }
}

const connection = await mysql.createConnection(dbConfig)
const changes = []
try {
  await ensureFactColumns(connection, changes)
  const rows = await loadFactRows(connection)
  await upsertFactRows(connection, rows, changes)
  await completePendingJobs(connection, changes)
} finally {
  await connection.end().catch(() => undefined)
}

console.log(JSON.stringify({ ok: true, apply, changes }, null, 2))
