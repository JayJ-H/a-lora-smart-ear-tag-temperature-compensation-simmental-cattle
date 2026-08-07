import { createHash } from 'node:crypto'
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
const batchSize = Number(process.env.TRACE_BACKFILL_BATCH_SIZE || 1000)

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management',
  dateStrings: true
}

const text = (value) => String(value ?? '').trim()
const lower = (value) => text(value).toLowerCase()
const hash = (value) => createHash('sha1').update(String(value)).digest('hex').slice(0, 16)

function timeKey(value) {
  const raw = text(value)
  if (!raw) return ''
  return raw.replace('T', ' ').replace('Z', '').slice(0, 19)
}

function numericKey(value) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(4) : ''
}

function valueKey(numericValue, textValue) {
  const numeric = numericKey(numericValue)
  if (numeric) return `n:${numeric}`
  const raw = lower(textValue)
  return raw ? `t:${raw}` : 'empty'
}

function addToMap(map, key, row) {
  if (!key) return
  if (!map.has(key)) map.set(key, [])
  map.get(key).push(row)
}

function uniqueRows(rows) {
  const map = new Map()
  rows.forEach((row) => map.set(row.id, row))
  return Array.from(map.values())
}

function cowKeysFromPhenotype(row, cowContext) {
  const keys = new Set([text(row.cow_id), text(row.cow_number)].filter(Boolean))
  const animalByNumber = cowContext.animalByNumber.get(text(row.cow_number))
  if (animalByNumber?.id) keys.add(animalByNumber.id)
  const cowById = cowContext.cowsById.get(text(row.cow_id))
  if (cowById?.cow_number) {
    keys.add(cowById.cow_number)
    const animal = cowContext.animalByNumber.get(cowById.cow_number)
    if (animal?.id) keys.add(animal.id)
  }
  return Array.from(keys)
}

function cowKeysFromObservation(row, cowContext) {
  const keys = new Set([text(row.animal_id)].filter(Boolean))
  const animal = cowContext.animalById.get(text(row.animal_id))
  if (animal?.animal_number) keys.add(animal.animal_number)
  const cowById = cowContext.cowsById.get(text(row.animal_id))
  if (cowById?.cow_number) keys.add(cowById.cow_number)
  const cowByNumber = cowContext.cowsByNumber.get(text(animal?.animal_number))
  if (cowByNumber?.id) keys.add(cowByNumber.id)
  if (cowByNumber?.cow_number) keys.add(cowByNumber.cow_number)
  return Array.from(keys)
}

function traitKeysFromObservation(row) {
  return Array.from(new Set([text(row.trait_code), text(row.trait_id)].filter(Boolean)))
}

function buildKeys(cowKeys, traitKeys, at, numericValue, textValue, unit) {
  const keys = []
  const value = valueKey(numericValue, textValue)
  const date = timeKey(at)
  if (!date || !value) return keys
  for (const cowKey of cowKeys) {
    for (const traitKey of traitKeys) {
      if (!cowKey || !traitKey) continue
      keys.push({
        exact: `${cowKey}|${traitKey}|${date}|${value}|${lower(unit)}`,
        relaxed: `${cowKey}|${traitKey}|${date}|${value}|`
      })
    }
  }
  return keys
}

async function loadCowContext(connection) {
  const [animalRows] = await connection.query(
    `SELECT id, animal_number FROM animal`
  )
  const [cowRows] = await connection.query(
    `SELECT id, cow_number FROM cows`
  )
  return {
    animalById: new Map(animalRows.map((row) => [text(row.id), row])),
    animalByNumber: new Map(animalRows.map((row) => [text(row.animal_number), row]).filter(([key]) => key)),
    cowsById: new Map(cowRows.map((row) => [text(row.id), row])),
    cowsByNumber: new Map(cowRows.map((row) => [text(row.cow_number), row]).filter(([key]) => key))
  }
}

async function applyExternalMatches(connection, updates) {
  for (let index = 0; index < updates.length; index += batchSize) {
    const chunk = updates.slice(index, index + batchSize)
    const cases = chunk.map(() => 'WHEN ? THEN ?').join(' ')
    const ids = chunk.map(() => '?').join(',')
    const params = []
    chunk.forEach((item) => {
      params.push(item.observationId, item.phenotypeId)
    })
    chunk.forEach((item) => params.push(item.observationId))
    await connection.query(
      `UPDATE trait_observation
       SET source_type = 'phenotype-records',
           source_record_id = CASE id ${cases} END,
           updated_at = NOW(3)
       WHERE id IN (${ids})`,
      params
    )
  }
}

async function main() {
  const connection = await mysql.createConnection(dbConfig)
  try {
    await connection.query('SET NAMES utf8mb4')
    const cowContext = await loadCowContext(connection)
    const [[missingRow]] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM trait_observation
       WHERE source_record_id IS NULL OR source_record_id = ''`
    )
    const missingBefore = Number(missingRow.count || 0)

    const [phenotypeRows] = await connection.query(
      `SELECT id, cow_id, cow_number,
              DATE_FORMAT(collection_date, '%Y-%m-%d %H:%i:%s') AS collection_key,
              trait_code, value, text_value, unit
       FROM phenotype_records`
    )
    const exactIndex = new Map()
    const relaxedIndex = new Map()
    phenotypeRows.forEach((row) => {
      const cowKeys = cowKeysFromPhenotype(row, cowContext)
      const keys = buildKeys(cowKeys, [text(row.trait_code)], row.collection_key, row.value, row.text_value, row.unit)
      keys.forEach((key) => {
        addToMap(exactIndex, key.exact, row)
        addToMap(relaxedIndex, key.relaxed, row)
      })
    })

    const [observationRows] = await connection.query(
      `SELECT o.id, o.animal_id, o.trait_id,
              DATE_FORMAT(o.observed_at, '%Y-%m-%d %H:%i:%s') AS observed_key,
              o.numeric_value, o.text_value, o.unit,
              d.code AS trait_code
       FROM trait_observation o
       LEFT JOIN trait_definition d ON d.id = o.trait_id OR d.code = o.trait_id
       WHERE o.source_record_id IS NULL OR o.source_record_id = ''
       ORDER BY o.id`
    )

    const externalUpdates = []
    const ambiguous = []
    const tooLong = []
    let exactMatches = 0
    let relaxedMatches = 0
    for (const row of observationRows) {
      const cowKeys = cowKeysFromObservation(row, cowContext)
      const traitKeys = traitKeysFromObservation(row)
      const keys = buildKeys(cowKeys, traitKeys, row.observed_key, row.numeric_value, row.text_value, row.unit)
      let candidates = uniqueRows(keys.flatMap((key) => exactIndex.get(key.exact) || []))
      let matchMode = 'exact'
      if (!candidates.length) {
        candidates = uniqueRows(keys.flatMap((key) => relaxedIndex.get(key.relaxed) || []))
        matchMode = 'relaxed'
      }
      if (candidates.length === 1) {
        const phenotypeId = text(candidates[0].id)
        if (phenotypeId.length <= 64) {
          externalUpdates.push({ observationId: row.id, phenotypeId, matchMode })
          if (matchMode === 'exact') exactMatches += 1
          else relaxedMatches += 1
        } else {
          tooLong.push({ observationId: row.id, phenotypeId, length: phenotypeId.length })
        }
      } else if (candidates.length > 1) {
        ambiguous.push({
          observationId: row.id,
          candidates: candidates.slice(0, 5).map((item) => item.id)
        })
      }
    }

    const selfTraceCount = missingBefore - externalUpdates.length
    let appliedExternal = 0
    let appliedSelf = 0
    if (apply) {
      await connection.beginTransaction()
      await applyExternalMatches(connection, externalUpdates)
      appliedExternal = externalUpdates.length
      const [result] = await connection.query(
        `UPDATE trait_observation
         SET source_type = 'trait_observation',
             source_record_id = id,
             updated_at = NOW(3)
         WHERE source_record_id IS NULL OR source_record_id = ''`
      )
      appliedSelf = Number(result.affectedRows || 0)
      await connection.commit()
    }

    const [[afterRow]] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM trait_observation
       WHERE source_record_id IS NULL OR source_record_id = ''`
    )

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      missingBefore,
      phenotypeRows: phenotypeRows.length,
      observationRows: observationRows.length,
      externalMatches: externalUpdates.length,
      exactMatches,
      relaxedMatches,
      selfTraceCandidates: selfTraceCount,
      ambiguousMatches: ambiguous.length,
      tooLongPhenotypeIds: tooLong.length,
      appliedExternal,
      appliedSelf,
      missingAfter: Number(afterRow.count || 0),
      samples: {
        external: externalUpdates.slice(0, 5),
        ambiguous: ambiguous.slice(0, 5),
        tooLong: tooLong.slice(0, 5),
        selfTraceTokenExample: observationRows[0] ? {
          observationId: observationRows[0].id,
          sourceType: 'trait_observation',
          sourceRecordId: observationRows[0].id,
          tokenHash: hash(observationRows[0].id)
        } : null
      }
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
  process.exit(1)
})
