import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
dotenv.config({ path: path.join(projectRoot, 'ops/production/.env.prod'), override: true, quiet: true })

const apply = process.argv.includes('--apply')

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

const AUDIT_TABLES = ['operation_audit_logs', 'operation_audit_log', 'export_audit_logs']

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
    [dbConfig.database, table]
  )
  return Number(rows?.[0]?.count || 0) > 0
}

async function countRows(connection, table) {
  if (!(await tableExists(connection, table))) return null
  const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\``)
  return Number(rows?.[0]?.count || 0)
}

async function main() {
  const connection = await mysql.createConnection(dbConfig)
  const before = {}
  const after = {}
  const deleted = {}

  try {
    for (const table of AUDIT_TABLES) {
      before[table] = await countRows(connection, table)
    }

    if (apply) await connection.beginTransaction()
    for (const table of AUDIT_TABLES) {
      if (before[table] === null) {
        deleted[table] = null
        continue
      }
      deleted[table] = before[table]
      if (apply && before[table] > 0) {
        await connection.query(`DELETE FROM \`${table}\``)
      }
    }
    if (apply) await connection.commit()

    for (const table of AUDIT_TABLES) {
      after[table] = await countRows(connection, table)
    }

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      database: `${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
      policy: 'framework-cleanup: remove historical operation/export audit rows only; keep schema, dictionaries, templates, pens, persons and trait definitions',
      before,
      deleted: apply ? deleted : Object.fromEntries(Object.entries(deleted).map(([table, count]) => [table, count === null ? null : 0])),
      wouldDelete: apply ? undefined : deleted,
      after
    }, null, 2))
  } catch (error) {
    if (apply) await connection.rollback().catch(() => undefined)
    throw error
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
