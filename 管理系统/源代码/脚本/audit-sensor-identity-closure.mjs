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

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [dbConfig.database, table, column]
  )
  return Number(rows?.[0]?.count || 0) > 0
}

function auditSourceContracts() {
  const issues = []
  const backend = read('脚本/mysql-backend-server.mjs')
  const frontendDb = read('src/services/database.ts')

  if (!/table === 'sensor_reading' \|\| table === 'sensor_readings'/.test(backend)) {
    issues.push(finding('high', 'BACKEND_SENSOR_PREPROCESS_MISSING', '后端 preprocessPayloadByTable 未归一化 sensor_reading/sensor_readings 字段。'))
  }
  if (!/await insertRow\('sensor_reading'/.test(backend) || !/await insertRow\('sensor_readings'/.test(backend)) {
    issues.push(finding('high', 'MQTT_CANONICAL_SENSOR_WRITE_MISSING', 'MQTT 入库未同时写 sensor_reading 和兼容 sensor_readings。'))
  }
  if (!/async function ensureCowForMqttRecord/.test(backend) || !/await insertRow\('animal'/.test(backend)) {
    issues.push(finding('high', 'MQTT_ANIMAL_RESOLUTION_MISSING', 'MQTT 牛只解析仍未确保 canonical animal。'))
  }
  if (!/case 'sensor-reading':[\s\S]*case 'sensor-readings'/.test(frontendDb)) {
    issues.push(finding('high', 'FRONTEND_SENSOR_NORMALIZER_MISSING', '前端 database.ts 未归一化 sensor_reading/sensor-readings 字段。'))
  }
  if (!/metric_code/.test(frontendDb) || !/measured_at/.test(frontendDb) || !/reading_value/.test(frontendDb)) {
    issues.push(finding('high', 'FRONTEND_SENSOR_REQUIRED_FIELDS_MISSING', '前端 addSensorReading 未写 metric_code/measured_at/reading_value。'))
  }

  return issues
}

async function auditDatabase() {
  const issues = []
  let connection
  try {
    connection = await mysql.createConnection(dbConfig)
    for (const table of ['animal', 'animal_identifier', 'sensor_reading', 'sensor_readings']) {
      if (!(await tableExists(connection, table))) {
        issues.push(finding('high', 'REQUIRED_TABLE_MISSING', `缺少传感器闭环必需表 ${table}。`))
      }
    }

    for (const [table, columns] of Object.entries({
      sensor_reading: ['animal_id', 'metric_code', 'measured_at', 'reading_value'],
      sensor_readings: ['cow_id', 'metric_code', 'measured_at', 'reading_value']
    })) {
      for (const column of columns) {
        if ((await tableExists(connection, table)) && !(await columnExists(connection, table, column))) {
          issues.push(finding('high', 'REQUIRED_COLUMN_MISSING', `${table}.${column} 不存在。`))
        }
      }
    }

    if (await tableExists(connection, 'sensor_reading')) {
      const [missingRequired] = await connection.query(`
        SELECT COUNT(*) AS count
        FROM sensor_reading
        WHERE metric_code IS NULL OR metric_code = '' OR measured_at IS NULL
      `)
      if (Number(missingRequired?.[0]?.count || 0) > 0) {
        issues.push(finding('high', 'CANONICAL_SENSOR_REQUIRED_VALUE_MISSING', 'sensor_reading 存在缺 metric_code/measured_at 的事实行。', String(missingRequired[0].count)))
      }

      const [orphanAnimal] = await connection.query(`
        SELECT COUNT(*) AS count
        FROM sensor_reading sr
        LEFT JOIN animal a ON a.id = sr.animal_id
        WHERE sr.animal_id IS NOT NULL AND a.id IS NULL
      `)
      if (Number(orphanAnimal?.[0]?.count || 0) > 0) {
        issues.push(finding('high', 'SENSOR_ANIMAL_ORPHAN', 'sensor_reading.animal_id 存在找不到 animal 的断链。', String(orphanAnimal[0].count)))
      }
    }

    if ((await tableExists(connection, 'sensor_reading')) && (await tableExists(connection, 'sensor_readings'))) {
      const [mirrorRows] = await connection.query(`
        SELECT COUNT(*) AS standard_count,
               SUM(CASE WHEN sr2.id IS NULL THEN 1 ELSE 0 END) AS standard_without_legacy
        FROM sensor_reading sr
        LEFT JOIN sensor_readings sr2 ON sr2.id = sr.id
      `)
      const missingMirror = Number(mirrorRows?.[0]?.standard_without_legacy || 0)
      if (missingMirror > 0) {
        issues.push(finding('warning', 'SENSOR_LEGACY_MIRROR_MISSING', '部分 sensor_reading 没有 sensor_readings 兼容镜像。', String(missingMirror)))
      }
    }
  } catch (error) {
    issues.push(finding('warning', 'DB_CONNECT_SKIPPED', `数据库连接失败，已跳过传感器数据审计：${error?.message || String(error)}`))
  } finally {
    await connection?.end().catch(() => undefined)
  }
  return issues
}

const issues = [...auditSourceContracts(), ...(await auditDatabase())]
const blocking = issues.filter((item) => item.severity === 'high')
console.log(JSON.stringify({ ok: blocking.length === 0, blockingCount: blocking.length, issues }, null, 2))
if (blocking.length) process.exitCode = 1
