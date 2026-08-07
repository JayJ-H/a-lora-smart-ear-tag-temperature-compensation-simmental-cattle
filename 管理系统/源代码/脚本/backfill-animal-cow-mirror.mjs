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
const boolNum = (value) => (value === true || value === 1 || value === '1' ? 1 : 0)
const parityNum = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0
}

const CP1252_BYTE_MAP = new Map(
  Object.entries({
    '\u20ac': 0x80,
    '\u201a': 0x82,
    '\u0192': 0x83,
    '\u201e': 0x84,
    '\u2026': 0x85,
    '\u2020': 0x86,
    '\u2021': 0x87,
    '\u02c6': 0x88,
    '\u2030': 0x89,
    '\u0160': 0x8a,
    '\u2039': 0x8b,
    '\u0152': 0x8c,
    '\u017d': 0x8e,
    '\u2018': 0x91,
    '\u2019': 0x92,
    '\u201c': 0x93,
    '\u201d': 0x94,
    '\u2022': 0x95,
    '\u2013': 0x96,
    '\u2014': 0x97,
    '\u02dc': 0x98,
    '\u2122': 0x99,
    '\u0161': 0x9a,
    '\u203a': 0x9b,
    '\u0153': 0x9c,
    '\u017e': 0x9e,
    '\u0178': 0x9f
  })
)

function cp1252Bytes(value) {
  const bytes = []
  for (const char of String(value)) {
    const code = char.codePointAt(0)
    if (CP1252_BYTE_MAP.has(char)) {
      bytes.push(CP1252_BYTE_MAP.get(char))
    } else if (code <= 0xff) {
      bytes.push(code)
    } else {
      return null
    }
  }
  return Buffer.from(bytes)
}

function maybeFixMojibake(value) {
  const raw = text(value)
  if (!/[ÃÂÄÅæçèéäå]/.test(raw)) return raw
  try {
    const bytes = cp1252Bytes(raw)
    const fixed = bytes ? bytes.toString('utf8') : ''
    if (/[\u4e00-\u9fff]/.test(fixed) && !fixed.includes('\ufffd')) return fixed
  } catch {
    // fall through to known business-value repairs
  }
  const known = new Map([
    ['æ³Œä¹³', '泌乳'],
    ['æ¯', '母'],
    ['æ‘©æ‹‰æ°´ç‰›', '西门塔尔牛'],
    ['å°¼é‡Œæ‹‰è²æ°´ç‰›', '西门塔尔牛']
  ])
  return known.get(raw) || raw
}

function buildUnitResolver(farmUnits = []) {
  const map = new Map()
  for (const row of farmUnits) {
    const value = row || {}
    ;[value.id, value.code, value.name]
      .map(text)
      .filter(Boolean)
      .forEach((key) => map.set(key, value))
  }
  return (value) => {
    const key = text(value)
    if (!key) return ''
    const matched = map.get(key)
    return matched ? text(matched.name || matched.code || matched.id) : ''
  }
}

function animalToCow(row, resolveUnitName) {
  const id = text(row.id)
  const number = text(row.animal_number)
  return {
    id,
    cow_number: number,
    ear_tag_number: text(row.ear_tag_number) || null,
    father_number: null,
    mother_number: null,
    grandfather_number: null,
    grandmother_number: null,
    breed: maybeFixMojibake(row.breed) || '西门塔尔牛',
    gender: maybeFixMojibake(row.sex) || '母',
    birth_date: row.birth_date || null,
    cow_type: maybeFixMojibake(row.production_purpose || row.current_stage_id) || null,
    current_pen: resolveUnitName(row.current_pen_id || row.current_unit_id) || null,
    status: maybeFixMojibake(row.status) || '在群',
    pregnancy: 0,
    mixing: 0,
    parity: parityNum(row.reported_parity_no),
    created_at: row.created_at || now(),
    updated_at: now()
  }
}

function cowToAnimal(row, resolveUnitId) {
  const id = text(row.id)
  const number = text(row.cow_number)
  const unitId = resolveUnitId(row.current_pen)
  const cowType = maybeFixMojibake(row.cow_type)
  return {
    id,
    animal_number: number,
    ear_tag_number: text(row.ear_tag_number) || null,
    electronic_tag: null,
    name: number,
    species: '牛',
    breed: maybeFixMojibake(row.breed) || '西门塔尔牛',
    sex: maybeFixMojibake(row.gender) || '母',
    birth_date: row.birth_date || null,
    entry_date: null,
    source_farm: null,
    current_stage_id: cowType || null,
    current_group_id: null,
    current_unit_id: unitId || null,
    current_pen_id: unitId || null,
    status: maybeFixMojibake(row.status) || '在群',
    genetic_line: null,
    production_purpose: cowType || null,
    notes: null,
    created_at: row.created_at || now(),
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

async function main() {
  const connection = await mysql.createConnection(dbConfig)
  try {
    await connection.query('SET NAMES utf8mb4')
    const [animalWithoutCows] = await connection.query(
      `SELECT a.*
       FROM animal a
       LEFT JOIN cows c ON c.id = a.id OR c.cow_number = a.animal_number
       WHERE c.id IS NULL
       ORDER BY a.id`
    )
    const [cowsWithoutAnimal] = await connection.query(
      `SELECT c.*
       FROM cows c
       LEFT JOIN animal a ON a.id = c.id OR a.animal_number = c.cow_number
       WHERE a.id IS NULL
       ORDER BY c.id`
    )
    const [farmUnits] = await connection.query(`SELECT id, code, name FROM farm_unit`)
    const resolveUnitName = buildUnitResolver(farmUnits)
    const resolveUnitId = (value) => {
      const key = text(value)
      if (!key) return ''
      const matched = farmUnits.find((row) => [row.id, row.code, row.name].map(text).includes(key))
      return matched ? text(matched.id) : ''
    }

    const cowRows = animalWithoutCows
      .map((row) => animalToCow(row, resolveUnitName))
      .filter((row) => row.id && row.cow_number)
    const animalRows = cowsWithoutAnimal
      .map((row) => cowToAnimal(row, resolveUnitId))
      .filter((row) => row.id && row.animal_number)

    if (apply) {
      await connection.beginTransaction()
      for (const row of cowRows) await upsert(connection, 'cows', row)
      for (const row of animalRows) await upsert(connection, 'animal', row)
      await connection.commit()
    }

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      animalWithoutCows: animalWithoutCows.length,
      cowsWithoutAnimal: cowsWithoutAnimal.length,
      wouldInsertCows: cowRows.length,
      wouldInsertAnimal: animalRows.length,
      sampleCowRows: cowRows.slice(0, 5),
      sampleAnimalRows: animalRows.slice(0, 5)
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
