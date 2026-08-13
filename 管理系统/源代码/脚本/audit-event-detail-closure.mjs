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
  const databaseTs = read('src/services/database.ts')

  if (!/function writeCowEventDetailTables/.test(databaseTs)) {
    issues.push(finding('high', 'ADD_COW_EVENT_DETAIL_HELPER_MISSING', 'addCowEvent 缺少事件明细写入 helper。'))
  }
  if (!/await writeCowEventDetailTables\(animalEvent, eventCode, details\)/.test(databaseTs)) {
    issues.push(finding('high', 'ADD_COW_EVENT_DETAIL_CALL_MISSING', 'addCowEvent 写 animal_event 后未调用事件明细写入。'))
  }
  if (/reproduction_cycle,gestation_episode,dry_period_episode/.test(databaseTs)) {
    issues.push(finding('high', 'RECOMPUTE_TARGETS_OVERCLAIM', 'derivation_recompute_job 仍声明当前未实现的 reproduction_cycle/gestation_episode/dry_period_episode 重算目标。'))
  }

  return issues
}

async function auditDatabase() {
  const issues = []
  let connection
  try {
    connection = await mysql.createConnection(dbConfig)
    const requiredTables = [
      'animal_event',
      'cow_events',
      'event_reproduction_detail',
      'event_movement_detail',
      'event_health_detail',
      'event_medicine_detail',
      'event_production_detail',
      'derivation_recompute_job'
    ]
    for (const table of requiredTables) {
      if (!(await tableExists(connection, table))) {
        issues.push(finding('high', 'REQUIRED_TABLE_MISSING', `缺少事件闭环必需表 ${table}。`))
      }
    }
    if (!(await tableExists(connection, 'animal_event'))) return issues

    const checks = [
      {
        code: 'REPRO_EVENT_WITHOUT_DETAIL',
        table: 'event_reproduction_detail',
        eventTypes: ['insemination', 'pregnancy_check', 'calving', 'abortion', 'heat']
      },
      {
        code: 'MOVEMENT_EVENT_WITHOUT_DETAIL',
        table: 'event_movement_detail',
        eventTypes: ['entry', 'transfer', 'exit', 'death']
      },
      {
        code: 'HEALTH_EVENT_WITHOUT_DETAIL',
        table: 'event_health_detail',
        eventTypes: ['diagnosis', 'treatment', 'medication', 'vaccination', 'death']
      },
      {
        code: 'PRODUCTION_EVENT_WITHOUT_DETAIL',
        table: 'event_production_detail',
        eventTypes: ['milking', 'milking_session', 'milk_quality', 'dhi_test', 'feeding', 'feed_delivery', 'feed_adjustment', 'weighing', 'body_measurement', 'dry_off']
      }
    ]
    for (const check of checks) {
      if (!(await tableExists(connection, check.table))) continue
      const placeholders = check.eventTypes.map(() => '?').join(',')
      const [rows] = await connection.query(
        `
          SELECT COUNT(*) AS count
          FROM animal_event ae
          LEFT JOIN \`${check.table}\` d ON d.event_id = ae.id
          WHERE ae.event_type IN (${placeholders})
            AND d.id IS NULL
        `,
        check.eventTypes
      )
      const count = Number(rows?.[0]?.count || 0)
      if (count > 0) {
        issues.push(finding('warning', check.code, `${check.table} 存在历史缺明细 animal_event。`, String(count)))
      }
    }

    if (await tableExists(connection, 'derivation_recompute_job')) {
      const [pendingRows] = await connection.query(`
        SELECT COUNT(*) AS count
        FROM derivation_recompute_job
        WHERE COALESCE(job_status, '') = 'pending'
          AND COALESCE(created_at, updated_at, NOW()) < DATE_SUB(NOW(), INTERVAL 1 HOUR)
      `)
      const pending = Number(pendingRows?.[0]?.count || 0)
      if (pending > 0) {
        issues.push(finding('warning', 'LONG_PENDING_RECOMPUTE_JOBS', '存在超过 1 小时仍 pending 的周期重算任务。', String(pending)))
      }
    }
  } catch (error) {
    issues.push(finding('warning', 'DB_CONNECT_SKIPPED', `数据库连接失败，已跳过事件闭环数据审计：${error?.message || String(error)}`))
  } finally {
    await connection?.end().catch(() => undefined)
  }
  return issues
}

const issues = [...auditSourceContracts(), ...(await auditDatabase())]
const blocking = issues.filter((item) => item.severity === 'high')
console.log(JSON.stringify({ ok: blocking.length === 0, blockingCount: blocking.length, issues }, null, 2))
if (blocking.length) process.exitCode = 1
