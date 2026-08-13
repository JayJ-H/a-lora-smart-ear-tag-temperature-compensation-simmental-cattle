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

  const auditFunction = backend.match(/async function auditOperation[\s\S]*?\n}\n\nfunction sanitizeAuditPayload/)
  if (!auditFunction || !/insertRow\('operation_audit_log'/.test(auditFunction[0])) {
    issues.push(finding('high', 'AUDIT_CANONICAL_WRITE_MISSING', 'auditOperation 未主写 operation_audit_log。'))
  }
  if (!auditFunction || !/insertRow\('operation_audit_logs'/.test(auditFunction[0])) {
    issues.push(finding('high', 'AUDIT_LEGACY_MIRROR_MISSING', 'auditOperation 未同步 operation_audit_logs 兼容镜像。'))
  }
  if (/operation_audit_log:\s*'operation_audit_logs'/.test(backend)) {
    issues.push(finding('high', 'AUDIT_ENTITY_MAP_POINTS_TO_LEGACY', 'ENTITY_TABLE_MAP 仍把 operation_audit_log 指向旧表。'))
  }
  if (!/table === 'operation_audit_log' \|\| table === 'operation_audit_logs'/.test(backend)) {
    issues.push(finding('high', 'AUDIT_PREPROCESS_MISSING', '后端 preprocessPayloadByTable 未归一化 operation_audit_log(s)。'))
  }
  if (!/case 'operation-audit-log'/.test(frontendDb)) {
    issues.push(finding('warning', 'FRONTEND_AUDIT_NORMALIZER_MISSING', '前端 database.ts 未显式归一化 operation_audit_log。'))
  }
  if (/insertRow\('operation_audit_logs'/.test(backend.replace(auditFunction?.[0] || '', ''))) {
    issues.push(finding('warning', 'DIRECT_LEGACY_AUDIT_WRITE_REMAINS', '后端仍有 auditOperation 外的 operation_audit_logs 直写，需要逐步收敛。'))
  }

  return issues
}

async function auditDatabase() {
  const issues = []
  let connection
  try {
    connection = await mysql.createConnection(dbConfig)
    for (const table of ['operation_audit_log', 'operation_audit_logs']) {
      if (!(await tableExists(connection, table))) {
        issues.push(finding('high', 'REQUIRED_TABLE_MISSING', `缺少审计闭环必需表 ${table}。`))
      }
    }
    for (const [table, columns] of Object.entries({
      operation_audit_log: ['action_type', 'target_type', 'operated_at', 'operator_name'],
      operation_audit_logs: ['action_type', 'target_type', 'target_id', 'created_at']
    })) {
      for (const column of columns) {
        if ((await tableExists(connection, table)) && !(await columnExists(connection, table, column))) {
          issues.push(finding('high', 'REQUIRED_COLUMN_MISSING', `${table}.${column} 不存在。`))
        }
      }
    }

    if (await tableExists(connection, 'operation_audit_log')) {
      const [missingRequired] = await connection.query(`
        SELECT COUNT(*) AS count
        FROM operation_audit_log
        WHERE action_type IS NULL OR action_type = '' OR target_type IS NULL OR target_type = '' OR operated_at IS NULL
      `)
      if (Number(missingRequired?.[0]?.count || 0) > 0) {
        issues.push(finding('high', 'AUDIT_REQUIRED_VALUE_MISSING', 'operation_audit_log 存在缺 action_type/target_type/operated_at 的记录。', String(missingRequired[0].count)))
      }

      const [orphanAnimal] = await connection.query(`
        SELECT COUNT(*) AS count
        FROM operation_audit_log l
        LEFT JOIN animal a ON a.id = l.animal_id
        WHERE l.animal_id IS NOT NULL AND a.id IS NULL
      `)
      if (Number(orphanAnimal?.[0]?.count || 0) > 0) {
        issues.push(finding('high', 'AUDIT_ANIMAL_ORPHAN', 'operation_audit_log.animal_id 存在找不到 animal 的断链。', String(orphanAnimal[0].count)))
      }
    }

    if ((await tableExists(connection, 'operation_audit_log')) && (await tableExists(connection, 'operation_audit_logs'))) {
      const [mirrorRows] = await connection.query(`
        SELECT COUNT(*) AS canonical_count,
               SUM(CASE WHEN logs.id IS NULL THEN 1 ELSE 0 END) AS canonical_without_legacy
        FROM operation_audit_log log1
        LEFT JOIN operation_audit_logs logs ON logs.id = log1.id
      `)
      const missingMirror = Number(mirrorRows?.[0]?.canonical_without_legacy || 0)
      if (missingMirror > 0) {
        issues.push(finding('warning', 'AUDIT_LEGACY_MIRROR_MISSING_ROWS', '部分 operation_audit_log 没有 operation_audit_logs 兼容镜像。', String(missingMirror)))
      }
    }
  } catch (error) {
    issues.push(finding('warning', 'DB_CONNECT_SKIPPED', `数据库连接失败，已跳过操作审计数据审计：${error?.message || String(error)}`))
  } finally {
    await connection?.end().catch(() => undefined)
  }
  return issues
}

const issues = [...auditSourceContracts(), ...(await auditDatabase())]
const blocking = issues.filter((item) => item.severity === 'high')
console.log(JSON.stringify({ ok: blocking.length === 0, blockingCount: blocking.length, issues }, null, 2))
if (blocking.length) process.exitCode = 1
