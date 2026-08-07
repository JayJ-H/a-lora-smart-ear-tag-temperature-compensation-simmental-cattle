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

const apply = process.argv.includes('--apply')
const nowIso = new Date().toISOString()

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return fallback
  }
}

function asArray(value) {
  const parsed = parseJson(value, value)
  if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean)
  if (parsed && typeof parsed === 'object') return Object.values(parsed).flat().map((item) => String(item || '').trim()).filter(Boolean)
  const text = String(parsed || '').trim()
  return text ? [text] : []
}

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
    [dbConfig.database, table]
  )
  return Number(rows?.[0]?.count || 0) > 0
}

async function loadExistingCowIds(connection, ids) {
  const uniqueIds = [...new Set(ids)].filter(Boolean)
  const existing = new Set()
  if (!uniqueIds.length) return existing
  for (let index = 0; index < uniqueIds.length; index += 500) {
    const chunk = uniqueIds.slice(index, index + 500)
    const placeholders = chunk.map(() => '?').join(',')
    const [animalRows] = await connection.query(
      `SELECT id, animal_number FROM animal WHERE id IN (${placeholders}) OR animal_number IN (${placeholders})`,
      [...chunk, ...chunk]
    )
    const [cowRows] = await connection.query(
      `SELECT id, cow_number FROM cows WHERE id IN (${placeholders}) OR cow_number IN (${placeholders})`,
      [...chunk, ...chunk]
    )
    for (const row of [...animalRows, ...cowRows]) {
      if (row.id) existing.add(String(row.id))
      if (row.animal_number) existing.add(String(row.animal_number))
      if (row.cow_number) existing.add(String(row.cow_number))
    }
  }
  return existing
}

function buildScope(row, validCowIds, orphanCowIds) {
  const currentScope = parseJson(row.relation_scope, {}) || {}
  if (validCowIds.length) {
    return {
      ...currentScope,
      scope: currentScope.scope || 'cow_group',
      cowIds: validCowIds,
      orphanCowIds,
      repairedAt: nowIso,
      tracePolicy: 'valid cow bindings retained; orphan device bindings removed'
    }
  }
  return {
    ...currentScope,
    scope: 'system',
    domain: 'hardware_inventory',
    cowIds: [],
    orphanCowIds,
    repairedAt: nowIso,
    tracePolicy: 'device remains in inventory; removed cow binding because referenced animal/cow no longer exists'
  }
}

async function main() {
  const connection = await mysql.createConnection(dbConfig)
  const report = {
    ok: false,
    mode: apply ? 'apply' : 'dry-run',
    database: { host: dbConfig.host, port: dbConfig.port, database: dbConfig.database },
    scannedRows: 0,
    affectedRows: 0,
    fullyOrphanedRows: 0,
    partiallyOrphanedRows: 0,
    samples: []
  }

  try {
    if (!(await tableExists(connection, 'hardware_devices'))) {
      report.ok = true
      report.skipped = 'hardware_devices table missing'
      console.log(JSON.stringify(report, null, 2))
      return
    }

    const [rows] = await connection.query(`
      SELECT id, cow_ids, relation_scope, source_record_ids
      FROM hardware_devices
      WHERE JSON_LENGTH(COALESCE(cow_ids, JSON_ARRAY())) > 0
      LIMIT 50000
    `)
    report.scannedRows = rows.length
    const allCowIds = rows.flatMap((row) => asArray(row.cow_ids))
    const existing = await loadExistingCowIds(connection, allCowIds)
    const updates = []

    for (const row of rows) {
      const originalCowIds = asArray(row.cow_ids)
      const validCowIds = originalCowIds.filter((id) => existing.has(id))
      const orphanCowIds = originalCowIds.filter((id) => !existing.has(id))
      if (!orphanCowIds.length) continue
      updates.push({
        id: row.id,
        originalCowIds,
        validCowIds,
        orphanCowIds,
        nextScope: buildScope(row, validCowIds, orphanCowIds)
      })
    }

    report.affectedRows = updates.length
    report.fullyOrphanedRows = updates.filter((item) => item.validCowIds.length === 0).length
    report.partiallyOrphanedRows = updates.filter((item) => item.validCowIds.length > 0).length
    report.samples = updates.slice(0, 10).map((item) => ({
      id: item.id,
      originalCowIds: item.originalCowIds,
      validCowIds: item.validCowIds,
      orphanCowIds: item.orphanCowIds
    }))

    if (apply && updates.length) {
      await connection.beginTransaction()
      try {
        for (const item of updates) {
          await connection.query(
            `
              UPDATE hardware_devices
              SET cow_ids = CAST(? AS JSON),
                  relation_scope = CAST(? AS JSON)
              WHERE id = ?
            `,
            [JSON.stringify(item.validCowIds), JSON.stringify(item.nextScope), item.id]
          )
        }
        await connection.commit()
      } catch (error) {
        await connection.rollback().catch(() => undefined)
        throw error
      }
    }

    report.ok = true
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await connection.end().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2))
  process.exitCode = 1
})
