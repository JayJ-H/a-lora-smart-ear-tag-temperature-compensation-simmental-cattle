import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env') })
dotenv.config({ path: path.join(projectRoot, '运维/生产配置/.env.prod'), override: true })

const config = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 9193),
  user: process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'cattle_management'
}

const requiredColumns = {
  animal: [
    'calf_breed',
    'reported_parity_no',
    'lactation_start_date',
    'lactation_end_date',
    'reported_days_in_milk',
    'reported_parity_yield',
    'reported_milk_305',
    'reported_avg_daily_milk'
  ],
  milking_session: ['shift_id', 'operator_name', 'source_type', 'source_table', 'source_record_id'],
  milking_visit: [
    'session_code',
    'production_date',
    'measured_at',
    'shift_id',
    'parity_no',
    'days_in_milk',
    'period_source',
    'milk_yield',
    'quality_flag',
    'source_type',
    'source_table',
    'source_record_id',
    'operator_name'
  ],
  milk_measurement: [
    'shift_id',
    'days_in_milk',
    'period_source',
    'session_code',
    'source_table',
    'source_record_id',
    'operator_name',
    'lactation_start_date',
    'lactation_end_date',
    'reported_days_in_milk',
    'reported_parity_yield',
    'reported_milk_305',
    'reported_avg_daily_milk'
  ],
  milk_records: [
    'shift_id',
    'parity_no',
    'days_in_milk',
    'period_source',
    'session_code',
    'source_table',
    'source_record_id',
    'operator_name'
  ],
  fact_lactation_305: [
    'milk_yield_305',
    'animal_number',
    'cow_number',
    'lactation_no',
    'record_count',
    'coverage_days',
    'missing_days',
    'start_date',
    'end_date',
    'source_table',
    'source_record_ids'
  ],
  data_quality_issue: [
    'source_table',
    'source_record_id',
    'issue_level',
    'issue_status',
    'resolved_at',
    'detail'
  ]
}

const connection = await mysql.createConnection(config)

try {
  if (process.argv.includes('--scenario')) {
    await runScenario(connection)
  }

  const missing = []
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const [rows] = await connection.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
      `,
      [config.database, table]
    )
    const existing = new Set(rows.map((row) => row.column_name || row.COLUMN_NAME).filter(Boolean))
    for (const column of columns) {
      if (!existing.has(column)) missing.push(`${table}.${column}`)
    }
  }

  const [counts] = await connection.query(`
    SELECT
      (SELECT COUNT(*) FROM animal) AS animal_count,
      (SELECT COUNT(*) FROM lactation_episode) AS lactation_count,
      (SELECT COUNT(*) FROM parity_episode) AS parity_count,
      (SELECT COUNT(*) FROM milk_measurement) AS milk_measurement_count,
      (SELECT COUNT(*) FROM data_quality_issue WHERE issue_type = 'milk_missing_production') AS milk_missing_issue_count
  `)

  if (missing.length) {
    console.error(JSON.stringify({ ok: false, missing, counts: counts[0] }, null, 2))
    process.exitCode = 1
  } else {
    console.log(JSON.stringify({ ok: true, checkedTables: Object.keys(requiredColumns), counts: counts[0] }, null, 2))
  }
} finally {
  await connection.end()
}

async function runScenario(connection) {
  const cowId = 'milk_stat_test_cow'
  const cowNumber = 'MILK-STAT-001'
  const summaryCowId = 'milk_stat_summary_cow'
  const summaryCowNumber = 'MILK-STAT-SUMMARY-001'
  const parityCowId = 'milk_stat_parity_cow'
  const parityCowNumber = 'MILK-STAT-PARITY-001'
  const sessionRows = [
    ['2025-05-01', '早班', 7.8],
    ['2025-05-01', '晚班', 8.1],
    ['2025-05-02', '早班', 8.0],
    ['2025-05-02', '晚班', 8.2],
    ['2025-05-05', '早班', 8.6],
    ['2025-05-05', '晚班', 8.9],
    ['2025-05-06', '早班', 8.4]
  ]
  await connection.query('SET FOREIGN_KEY_CHECKS = 0')
  await connection.query("DELETE FROM data_quality_issue WHERE id LIKE 'milk_stat_test_%' OR animal_id IN (?, ?, ?)", [cowId, summaryCowId, parityCowId])
  await connection.query("DELETE FROM milk_measurement WHERE id LIKE 'milk_stat_test_%' OR animal_id IN (?, ?, ?)", [cowId, summaryCowId, parityCowId])
  await connection.query("DELETE FROM milking_visit WHERE id LIKE 'milk_stat_test_%' OR animal_id IN (?, ?, ?)", [cowId, summaryCowId, parityCowId])
  await connection.query(`
    DELETE FROM milking_session
    WHERE id LIKE 'milk_stat_test_%'
      OR source_table = 'validate-milk-production-statistics'
      OR session_code IN (
        '2025-05-01-早班', '2025-05-01-晚班',
        '2025-05-02-早班', '2025-05-02-晚班',
        '2025-05-05-早班', '2025-05-05-晚班',
        '2025-05-06-早班'
      )
  `)
  await connection.query("DELETE FROM fact_lactation_305 WHERE id LIKE 'milk_stat_test_%' OR animal_id IN (?, ?, ?)", [cowId, summaryCowId, parityCowId])
  await connection.query("DELETE FROM lactation_episode WHERE id LIKE 'milk_stat_test_%' OR animal_id IN (?, ?, ?)", [cowId, summaryCowId, parityCowId])
  await connection.query("DELETE FROM parity_episode WHERE id LIKE 'milk_stat_test_%' OR animal_id IN (?, ?, ?)", [cowId, summaryCowId, parityCowId])
  await connection.query("DELETE FROM cows WHERE id IN (?, ?, ?) OR cow_number IN (?, ?, ?)", [cowId, summaryCowId, parityCowId, cowNumber, summaryCowNumber, parityCowNumber])
  await connection.query("DELETE FROM animal WHERE id IN (?, ?, ?)", [cowId, summaryCowId, parityCowId])
  await connection.query('SET FOREIGN_KEY_CHECKS = 1')

  await connection.query(
    `
      INSERT INTO animal (
        id, animal_number, breed, sex, birth_date, entry_date, status,
        lactation_start_date, reported_parity_no, reported_days_in_milk,
        reported_milk_305, reported_avg_daily_milk, created_at, updated_at
      ) VALUES (?, ?, '广西水牛', '母', '2022-01-01', '2024-01-01', 'active', '2025-05-01', 1, 5, 2460, 8.1, NOW(3), NOW(3))
    `,
    [cowId, cowNumber]
  )
  await connection.query(
    `
      INSERT INTO animal (
        id, animal_number, breed, sex, birth_date, entry_date, status,
        lactation_start_date, reported_parity_no, reported_days_in_milk,
        reported_parity_yield, reported_milk_305, reported_avg_daily_milk, created_at, updated_at
      ) VALUES (?, ?, '广西水牛', '母', '2021-03-01', '2024-02-01', 'active',
        '2025-06-01', 2, 10, 92.5, 2500, 9.25, NOW(3), NOW(3))
    `,
    [summaryCowId, summaryCowNumber]
  )
  await connection.query(
    `
      INSERT INTO animal (
        id, animal_number, breed, sex, birth_date, entry_date, status,
        created_at, updated_at
      ) VALUES (?, ?, '广西水牛', '母', '2020-01-01', '2023-01-01', 'active', NOW(3), NOW(3))
    `,
    [parityCowId, parityCowNumber]
  )
  await connection.query(
    `
      INSERT INTO cows (
        id, cow_number, breed, gender, birth_date, cow_type, status, created_at, updated_at
      ) VALUES (?, ?, '广西水牛', '母', '2022-01-01', '泌乳', '在群', NOW(3), NOW(3))
    `,
    [cowId, cowNumber]
  )
  await connection.query(
    `
      INSERT INTO cows (
        id, cow_number, breed, gender, birth_date, cow_type, status, created_at, updated_at
      ) VALUES (?, ?, '广西水牛', '母', '2021-03-01', '泌乳', '在群', NOW(3), NOW(3))
    `,
    [summaryCowId, summaryCowNumber]
  )
  await connection.query(
    `
      INSERT INTO cows (
        id, cow_number, breed, gender, birth_date, cow_type, status, created_at, updated_at
      ) VALUES (?, ?, '广西水牛', '母', '2020-01-01', '泌乳', '在群', NOW(3), NOW(3))
    `,
    [parityCowId, parityCowNumber]
  )
  await connection.query(
    `
      INSERT INTO parity_episode (
        id, animal_id, parity_no, start_date, parity_status, created_at, updated_at
      ) VALUES ('milk_stat_test_parity_1', ?, 1, '2025-05-01', 'open', NOW(3), NOW(3))
    `,
    [cowId]
  )
  await connection.query(
    `
      INSERT INTO parity_episode (
        id, animal_id, parity_no, start_date, end_date, parity_status, created_at, updated_at
      ) VALUES
        ('milk_stat_test_parity_cross_1', ?, 1, '2024-10-01', '2025-09-19', 'closed', NOW(3), NOW(3)),
        ('milk_stat_test_parity_cross_2', ?, 2, '2025-09-20', NULL, 'open', NOW(3), NOW(3))
    `,
    [parityCowId, parityCowId]
  )
  await connection.query(
    `
      INSERT INTO lactation_episode (
        id, animal_id, lactation_no, parity_no, start_date, end_date, days_in_milk, status, created_at, updated_at
      ) VALUES
        ('milk_stat_test_lactation_cross_1', ?, 1, 1, '2024-10-01', '2025-09-19', 354, 'closed', NOW(3), NOW(3)),
        ('milk_stat_test_lactation_cross_2', ?, 2, 2, '2025-09-20', NULL, 120, 'open', NOW(3), NOW(3))
    `,
    [parityCowId, parityCowId]
  )
  await connection.query(
    `
      INSERT INTO lactation_episode (
        id, animal_id, lactation_no, parity_no, start_date, days_in_milk, status, created_at, updated_at
      ) VALUES ('milk_stat_test_lactation_summary_1', ?, 2, 2, '2025-06-01', 10, 'open', NOW(3), NOW(3))
    `,
    [summaryCowId]
  )
  await connection.query(
    `
      INSERT INTO fact_lactation_305 (
        id, animal_id, animal_number, cow_number, lactation_id, parity_no, lactation_no,
        start_date, milk_yield_305, record_count, coverage_days, missing_days,
        source_table, source_record_ids, created_at, updated_at
      ) VALUES (
        'milk_stat_test_fact_summary_1', ?, ?, ?, 'milk_stat_test_lactation_summary_1',
        2, 2, '2025-06-01', 2500, 10, 10, 295, 'validation',
        JSON_ARRAY('milk-summary:validation'), NOW(3), NOW(3)
      )
    `,
    [summaryCowId, summaryCowNumber, summaryCowNumber]
  )
  await connection.query(
    `
      INSERT INTO lactation_episode (
        id, animal_id, lactation_no, parity_no, start_date, days_in_milk, status, created_at, updated_at
      ) VALUES ('milk_stat_test_lactation_1', ?, 1, 1, '2025-05-01', 5, 'open', NOW(3), NOW(3))
    `,
    [cowId]
  )
  for (const [date, shift, milkYield] of sessionRows) {
    const hour = shift === '早班' ? '06:00:00' : '18:00:00'
    const measuredAt = `${date} ${hour}`
    const suffix = `${date.replace(/-/g, '')}_${shift === '早班' ? 'am' : 'pm'}`
    const sessionId = `milk_stat_test_session_${suffix}`
    const visitId = `milk_stat_test_visit_${suffix}`
    const measurementId = `milk_stat_test_measure_${suffix}`
    await connection.query(
      `
        INSERT INTO milking_session (
          id, session_code, shift_id, production_date, started_at, operator_name,
          source_type, source_table, source_record_id, session_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, '链路验证', 'validation', 'validate-milk-production-statistics', ?, 'recorded', NOW(3), NOW(3))
      `,
      [sessionId, `${date}-${shift}`, shift, date, measuredAt, sessionId]
    )
    await connection.query(
      `
        INSERT INTO milking_visit (
          id, session_id, session_code, animal_id, entered_at, measured_at, production_date,
          shift_id, parity_no, days_in_milk, period_source, milk_yield, source_type, source_table,
          source_record_id, operator_name, quality_flag, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, DATEDIFF(?, '2025-05-01') + 1, 'system_derived_from_lactation_episode', ?, 'validation',
          'validate-milk-production-statistics', ?, '链路验证', 'valid', NOW(3), NOW(3))
      `,
      [visitId, sessionId, `${date}-${shift}`, cowId, measuredAt, measuredAt, date, shift, date, milkYield, visitId]
    )
    await connection.query(
      `
        INSERT INTO milk_measurement (
          id, visit_id, animal_id, measured_at, production_date, shift_id, parity_no,
          lactation_id, days_in_milk, period_source, session_code, milk_yield, source_type, source_table,
          source_record_id, operator_name, quality_flag, lactation_start_date, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 'milk_stat_test_lactation_1', DATEDIFF(?, '2025-05-01') + 1,
          'system_derived_from_lactation_episode',
          ?, ?, 'validation', 'validate-milk-production-statistics', ?, '链路验证', 'valid', '2025-05-01', NOW(3), NOW(3))
      `,
      [measurementId, visitId, cowId, measuredAt, date, shift, date, `${date}-${shift}`, milkYield, measurementId]
    )
  }

  const [observed] = await connection.query(
    `
      SELECT production_date, COUNT(*) AS shift_count, SUM(milk_yield) AS daily_milk
      FROM milk_measurement
      WHERE animal_id = ? AND production_date BETWEEN '2025-05-01' AND '2025-05-05'
      GROUP BY production_date
      ORDER BY production_date
    `,
    [cowId]
  )
  const observedDates = new Set(observed.map((row) => dateKey(row.production_date)))
  const expectedDates = ['2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05']
  const missingDates = expectedDates.filter((date) => !observedDates.has(date))
  if (missingDates.join(',') !== '2025-05-03,2025-05-04') {
    throw new Error(`缺失日期验证失败: ${missingDates.join(',')}`)
  }
  const missingShiftCount = missingDates.length * 2 + 1
  const [singleShiftRows] = await connection.query(
    `
      SELECT production_date, COUNT(*) AS shift_count
      FROM milk_measurement
      WHERE animal_id = ? AND production_date = '2025-05-06'
      GROUP BY production_date
    `,
    [cowId]
  )
  if (Number(singleShiftRows[0]?.shift_count || 0) !== 1) throw new Error('单班次缺失验证失败：2025-05-06 应只有早班记录')
  if (missingShiftCount !== 5) throw new Error(`缺失班次验证失败: ${missingShiftCount}`)

  const [periodSourceRows] = await connection.query(
    `
      SELECT COUNT(*) AS count
      FROM milk_measurement
      WHERE animal_id = ? AND period_source = 'system_derived_from_lactation_episode'
    `,
    [cowId]
  )
  if (Number(periodSourceRows[0]?.count || 0) !== sessionRows.length) {
    throw new Error('产奶明细 period_source 验证失败：导入/补录记录必须保留胎次来源')
  }

  const [summaryRows] = await connection.query(
    `
      SELECT a.id, a.reported_days_in_milk, a.reported_avg_daily_milk, f.milk_yield_305
      FROM animal a
      LEFT JOIN fact_lactation_305 f ON f.animal_id = a.id
      WHERE a.id = ?
    `,
    [summaryCowId]
  )
  const summary = summaryRows[0]
  if (!summary || Number(summary.reported_days_in_milk) !== 10 || Number(summary.reported_avg_daily_milk) <= 0 || Number(summary.milk_yield_305) <= 0) {
    throw new Error('汇总待拆分验证失败：泌乳汇总字段或305事实缺失')
  }

  const [parityChecks] = await connection.query(
    `
      SELECT parity_no, DATEDIFF(?, start_date) + 1 AS dim
      FROM parity_episode
      WHERE animal_id = ? AND ? BETWEEN start_date AND COALESCE(end_date, '9999-12-31')
      UNION ALL
      SELECT parity_no, DATEDIFF(?, start_date) + 1 AS dim
      FROM parity_episode
      WHERE animal_id = ? AND ? BETWEEN start_date AND COALESCE(end_date, '9999-12-31')
      ORDER BY parity_no
    `,
    ['2025-02-01', parityCowId, '2025-02-01', '2025-10-01', parityCowId, '2025-10-01']
  )
  const parityText = parityChecks.map((row) => `${row.parity_no}:${row.dim}`).join(',')
  if (parityText !== '1:124,2:12') {
    throw new Error(`跨年度胎次归属验证失败: ${parityText}`)
  }
}

function dateKey(value) {
  if (value instanceof Date) {
    const pad = (number) => String(number).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  return String(value || '').slice(0, 10)
}

