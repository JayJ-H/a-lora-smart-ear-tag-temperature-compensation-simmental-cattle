import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
dotenv.config({ path: path.join(projectRoot, '运维/生产配置/.env.prod'), override: true, quiet: true })

const apply = process.argv.includes('--apply')

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

const now = () => new Date()
const text = (value) => String(value ?? '').trim()
const stableId = (prefix, value) =>
  `${prefix}-${text(value).replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]+/g, '-').slice(0, 52)}`

function penToFarmUnit(row) {
  const name = text(row.name)
  return {
    id: text(row.id) || stableId('pen', name),
    code: text(row.id) || name,
    name,
    unit_type: 'pen',
    parent_unit_id: null,
    capacity: Number.isFinite(Number(row.capacity)) ? Number(row.capacity) : null,
    location_label: null,
    environment_config: null,
    status: text(row.status) || (row.is_active === 0 ? 'inactive' : 'active'),
    created_at: row.created_at || now(),
    updated_at: now()
  }
}

function farmUnitToPen(row) {
  return {
    id: text(row.id),
    name: text(row.name || row.code),
    category: text(row.unit_type) || 'pen',
    created_at: row.created_at || now(),
    capacity: Number.isFinite(Number(row.capacity)) ? Number(row.capacity) : null,
    area: null,
    manager: null,
    status: text(row.status) || 'active',
    is_active: text(row.status).toLowerCase() === 'inactive' ? 0 : 1,
    updated_at: now()
  }
}

async function upsert(connection, table, row) {
  const keys = Object.keys(row)
  const sql = `INSERT INTO \`${table}\` (${keys.map((key) => `\`${key}\``).join(', ')})
    VALUES (${keys.map(() => '?').join(', ')})
    ON DUPLICATE KEY UPDATE ${keys.filter((key) => !['id', 'created_at'].includes(key)).map((key) => `\`${key}\` = VALUES(\`${key}\`)`).join(', ')}`
  await connection.query(sql, keys.map((key) => row[key]))
}

async function collationDiffs(connection) {
  const [rows] = await connection.query(
    `SELECT table_name, column_name, collation_name
     FROM information_schema.columns
     WHERE table_schema = ?
       AND table_name = 'pens'
       AND data_type IN ('varchar','char','text','longtext','mediumtext')
       AND collation_name <> 'utf8mb4_unicode_ci'
     ORDER BY column_name`,
    [dbConfig.database]
  )
  return rows
}

async function main() {
  const connection = await mysql.createConnection(dbConfig)
  try {
    await connection.query('SET NAMES utf8mb4')
    const [pensMissingFarmUnit] = await connection.query(
      `SELECT p.*
       FROM pens p
       LEFT JOIN farm_unit fu
         ON CONVERT(fu.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
         OR CONVERT(fu.code USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
         OR CONVERT(fu.name USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.name USING utf8mb4) COLLATE utf8mb4_unicode_ci
       WHERE fu.id IS NULL
       ORDER BY p.id`
    )
    const [farmUnitsMissingPens] = await connection.query(
      `SELECT fu.*
       FROM farm_unit fu
       LEFT JOIN pens p
         ON CONVERT(p.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(fu.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
         OR CONVERT(p.name USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(fu.name USING utf8mb4) COLLATE utf8mb4_unicode_ci
       WHERE fu.unit_type = 'pen' AND p.id IS NULL
       ORDER BY fu.id`
    )
    const [animalCurrentPenMissingFarmUnit] = await connection.query(
      `SELECT a.id, a.animal_number, a.current_pen_id, a.current_unit_id
       FROM animal a
       LEFT JOIN farm_unit fu
         ON fu.id = a.current_pen_id OR fu.code = a.current_pen_id
       WHERE a.current_pen_id IS NOT NULL AND a.current_pen_id <> '' AND fu.id IS NULL
       ORDER BY a.id`
    )
    const collationRows = await collationDiffs(connection)

    const farmRows = pensMissingFarmUnit.map(penToFarmUnit).filter((row) => row.id && row.name)
    const penRows = farmUnitsMissingPens.map(farmUnitToPen).filter((row) => row.id && row.name)

    if (apply) {
      await connection.beginTransaction()
      if (collationRows.length) {
        await connection.query('ALTER TABLE pens CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
      }
      for (const row of farmRows) await upsert(connection, 'farm_unit', row)
      for (const row of penRows) await upsert(connection, 'pens', row)
      await connection.commit()
    }

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      pensMissingFarmUnit: pensMissingFarmUnit.length,
      farmUnitsMissingPens: farmUnitsMissingPens.length,
      animalCurrentPenMissingFarmUnit: animalCurrentPenMissingFarmUnit.length,
      pensCollationColumnsToConvert: collationRows.length,
      wouldInsertFarmUnit: farmRows.length,
      wouldInsertPens: penRows.length,
      sampleFarmRows: farmRows.slice(0, 5),
      samplePenRows: penRows.slice(0, 5),
      sampleAnimalCurrentPenGaps: animalCurrentPenMissingFarmUnit.slice(0, 10)
    }, null, 2))
  } catch (error) {
    try {
      await connection.rollback()
    } catch {
      // ignore
    }
    throw error
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
