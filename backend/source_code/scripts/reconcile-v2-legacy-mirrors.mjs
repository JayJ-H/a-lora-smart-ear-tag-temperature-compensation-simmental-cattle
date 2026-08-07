import { createHash } from 'node:crypto'
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
const batchSize = Number(process.env.MIRROR_RECONCILE_BATCH_SIZE || 500)

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
const hash = (value) => createHash('sha1').update(String(value)).digest('hex').slice(0, 20)

function timeKey(value) {
  return text(value).replace('T', ' ').replace('Z', '').slice(0, 19)
}

function mysqlNow() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23)
}

function mysqlDateTime(value) {
  const raw = text(value)
  if (!raw) return mysqlNow()
  return raw.replace('T', ' ').replace('Z', '').slice(0, 23)
}

function numericKey(value, digits = 4) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(digits) : ''
}

function valueKey(numericValue, textValue) {
  const numeric = numericKey(numericValue)
  if (numeric) return `n:${numeric}`
  const raw = lower(textValue)
  return raw ? `t:${raw}` : 'empty'
}

function add(map, key, row) {
  if (!key) return
  if (!map.has(key)) map.set(key, [])
  map.get(key).push(row)
}

function mapRows(rows, keyFn) {
  const map = new Map()
  rows.forEach((row) => add(map, keyFn(row), row))
  return map
}

function compareMaps(standardMap, legacyMap) {
  const keys = new Set([...standardMap.keys(), ...legacyMap.keys()])
  const standardOnly = []
  const legacyOnly = []
  const matched = []
  const duplicateKeys = []
  keys.forEach((key) => {
    const standardRows = standardMap.get(key) || []
    const legacyRows = legacyMap.get(key) || []
    if (standardRows.length > 1 || legacyRows.length > 1) {
      duplicateKeys.push({ key, standard: standardRows.length, legacy: legacyRows.length })
    }
    if (standardRows.length && legacyRows.length) matched.push({ key, standard: standardRows.length, legacy: legacyRows.length })
    else if (standardRows.length) standardOnly.push(...standardRows.map((row) => ({ key, row })))
    else legacyOnly.push(...legacyRows.map((row) => ({ key, row })))
  })
  return { matched, standardOnly, legacyOnly, duplicateKeys }
}

async function loadContexts(connection) {
  const [animals] = await connection.query(`SELECT id, animal_number FROM animal`)
  const [cows] = await connection.query(`SELECT id, cow_number FROM cows`)
  const [traits] = await connection.query(`SELECT id, code, name FROM trait_definition`)
  return {
    animalById: new Map(animals.map((row) => [text(row.id), row])),
    animalByNumber: new Map(animals.map((row) => [text(row.animal_number), row]).filter(([key]) => key)),
    cowsById: new Map(cows.map((row) => [text(row.id), row])),
    cowsByNumber: new Map(cows.map((row) => [text(row.cow_number), row]).filter(([key]) => key)),
    traitById: new Map(traits.map((row) => [text(row.id), row])),
    traitByCode: new Map(traits.map((row) => [text(row.code), row]).filter(([key]) => key))
  }
}

function animalForAnyRef(context, id, number) {
  const rawId = text(id)
  const rawNumber = text(number)
  return (
    context.animalById.get(rawId) ||
    context.animalByNumber.get(rawNumber) ||
    context.animalByNumber.get(context.cowsById.get(rawId)?.cow_number || '') ||
    null
  )
}

function cowNumberForAnimal(context, animalId) {
  const animal = context.animalById.get(text(animalId))
  return animal?.animal_number || context.cowsById.get(text(animalId))?.cow_number || ''
}

function phenotypeStandardKey(row, context) {
  const trait = context.traitById.get(text(row.trait_id)) || context.traitByCode.get(text(row.trait_id))
  const cowNumber = cowNumberForAnimal(context, row.animal_id)
  return [
    text(row.animal_id) || cowNumber,
    text(trait?.code || row.trait_id),
    timeKey(row.observed_key),
    valueKey(row.numeric_value, row.text_value),
    lower(row.unit)
  ].join('|')
}

function phenotypeLegacyKey(row, context) {
  const animal = animalForAnyRef(context, row.cow_id, row.cow_number)
  return [
    text(animal?.id || row.cow_id || row.cow_number),
    text(row.trait_code),
    timeKey(row.collection_key),
    valueKey(row.value, row.text_value),
    lower(row.unit)
  ].join('|')
}

function milkStandardKey(row, context) {
  return [
    text(row.animal_id),
    timeKey(row.measured_key),
    text(row.shift_id),
    numericKey(row.milk_yield, 2)
  ].join('|')
}

function milkLegacyKey(row, context) {
  const animal = animalForAnyRef(context, row.cow_id, row.cow_number)
  return [
    text(animal?.id || row.cow_id),
    timeKey(row.milking_key),
    text(row.shift_id),
    numericKey(row.volume, 2)
  ].join('|')
}

function eventStandardKey(row, context) {
  return [
    text(row.animal_id) || cowNumberForAnimal(context, row.animal_id),
    text(row.event_code || row.event_type),
    timeKey(row.occurred_key),
    text(row.source_record_id || row.id)
  ].join('|')
}

function eventLegacyKey(row, context) {
  const animal = animalForAnyRef(context, row.cow_id, row.cow_number)
  return [
    text(animal?.id || row.cow_id || row.cow_number),
    text(row.event_code || row.event_type),
    timeKey(row.event_key),
    text(row.source_record_id || row.id)
  ].join('|')
}

async function insertRows(connection, table, rows) {
  if (!rows.length) return 0
  let inserted = 0
  for (let index = 0; index < rows.length; index += batchSize) {
    const chunk = rows.slice(index, index + batchSize)
    const columns = Object.keys(chunk[0])
    const placeholders = chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',')
    const params = chunk.flatMap((row) => columns.map((column) => row[column]))
    const updates = columns
      .filter((column) => column !== 'id')
      .map((column) => `\`${column}\` = VALUES(\`${column}\`)`)
      .join(', ')
    const [result] = await connection.query(
      `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(',')})
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE ${updates}`,
      params
    )
    inserted += Number(result.affectedRows || 0)
  }
  return inserted
}

function buildTraitObservationFromPhenotype(item, context) {
  const row = item.row
  const animal = animalForAnyRef(context, row.cow_id, row.cow_number)
  const trait = context.traitByCode.get(text(row.trait_code))
  if (!animal || !trait || text(row.id).length > 64) return null
  return {
    id: `trait-mirror-${hash(row.id)}`,
    animal_id: animal.id,
    trait_id: trait.id,
    observed_at: row.collection_key,
    production_date: row.collection_key ? row.collection_key.slice(0, 10) : null,
    numeric_value: row.value === null || row.value === undefined || row.value === '' ? null : row.value,
    text_value: row.text_value || null,
    unit: row.unit || null,
    collector: row.collector || null,
    source_type: 'phenotype-records',
    source_record_id: row.id,
    quality_flag: 'valid',
    created_at: mysqlDateTime(row.created_at),
    updated_at: mysqlNow()
  }
}

function buildPhenotypeFromTraitObservation(item, context) {
  const row = item.row
  const trait = context.traitById.get(text(row.trait_id)) || context.traitByCode.get(text(row.trait_id))
  if (!trait) return null
  return {
    id: `phenotype-mirror-${hash(row.id)}`,
    cow_id: row.animal_id,
    cow_number: cowNumberForAnimal(context, row.animal_id) || null,
    collection_date: row.observed_key,
    trait_code: trait.code,
    trait_name: trait.name || null,
    category: null,
    value: row.numeric_value === null || row.numeric_value === undefined || row.numeric_value === '' ? null : row.numeric_value,
    text_value: row.text_value || null,
    unit: row.unit || null,
    source: 'trait_observation',
    collector: row.collector || null,
    data_source: 'real',
    pedigree_linked: 0,
    omics_linked: 0,
    raw_payload: JSON.stringify({ sourceTable: 'trait_observation', sourceRecordId: row.id }),
    created_at: mysqlDateTime(row.created_at),
    updated_at: mysqlNow()
  }
}

function buildMilkMeasurementFromLegacy(item, context) {
  const row = item.row
  const animal = animalForAnyRef(context, row.cow_id, row.cow_number)
  if (!animal || text(row.id).length > 128) return null
  return {
    id: `milk-mirror-${hash(row.id)}`,
    animal_id: animal.id,
    measured_at: row.milking_key,
    production_date: row.milking_key ? row.milking_key.slice(0, 10) : null,
    shift_id: row.shift_id || null,
    parity_no: row.parity_no || null,
    days_in_milk: row.days_in_milk || null,
    milk_yield: row.volume || 0,
    source_type: row.source_type || 'milk-records',
    quality_flag: 'valid',
    created_at: mysqlDateTime(row.created_at),
    updated_at: mysqlNow(),
    source_table: 'milk-records',
    source_record_id: row.id,
    operator_name: row.operator_name || null,
    period_source: row.period_source || null
  }
}

function buildMilkRecordFromMeasurement(item, context) {
  const row = item.row
  return {
    id: `milk-record-mirror-${hash(row.id)}`,
    cow_id: row.animal_id,
    milking_time: row.measured_key,
    volume: row.milk_yield || 0,
    milk_quality: JSON.stringify({ sourceTable: 'milk_measurement', sourceRecordId: row.id }),
    milking_method: null,
    milker_id: null,
    equipment_id: null,
    notes: null,
    created_at: mysqlDateTime(row.created_at),
    shift_id: row.shift_id || null,
    parity_no: row.parity_no || null,
    days_in_milk: row.days_in_milk || null,
    period_source: row.period_source || null,
    session_code: row.session_code || null,
    source_type: row.source_type || 'milk_measurement',
    source_table: 'milk_measurement',
    source_record_id: row.id,
    operator_name: row.operator_name || null
  }
}

function isGeneratedMirrorRow(row) {
  const id = text(row.id)
  return /(^|-)mirror-/.test(id)
}

async function main() {
  const connection = await mysql.createConnection(dbConfig)
  try {
    await connection.query('SET NAMES utf8mb4')
    const context = await loadContexts(connection)
    const [traitRows] = await connection.query(
      `SELECT o.id, o.animal_id, o.trait_id,
              DATE_FORMAT(o.observed_at, '%Y-%m-%d %H:%i:%s') AS observed_key,
              o.numeric_value, o.text_value, o.unit, o.collector, o.created_at
       FROM trait_observation o`
    )
    const [phenotypeRows] = await connection.query(
      `SELECT id, cow_id, cow_number,
              DATE_FORMAT(collection_date, '%Y-%m-%d %H:%i:%s') AS collection_key,
              trait_code, trait_name, value, text_value, unit, source, collector, created_at
       FROM phenotype_records`
    )
    const [milkMeasurementRows] = await connection.query(
      `SELECT id, animal_id, DATE_FORMAT(measured_at, '%Y-%m-%d %H:%i:%s') AS measured_key,
              shift_id, parity_no, days_in_milk, milk_yield, source_type, source_table,
              source_record_id, operator_name, period_source, session_code, created_at
       FROM milk_measurement`
    )
    const [milkRecordRows] = await connection.query(
      `SELECT id, cow_id, DATE_FORMAT(milking_time, '%Y-%m-%d %H:%i:%s') AS milking_key,
              shift_id, parity_no, days_in_milk, volume, source_type, source_table,
              source_record_id, operator_name, period_source, session_code, created_at
       FROM milk_records`
    )
    const [animalEventRows] = await connection.query(
      `SELECT id, animal_id, event_code, event_type,
              DATE_FORMAT(occurred_at, '%Y-%m-%d %H:%i:%s') AS occurred_key,
              source_record_id, created_at
       FROM animal_event`
    )
    const [cowEventRows] = await connection.query(
      `SELECT id,
              COALESCE(
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.animalId')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.animal_id')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.cowId')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.cow_id'))
              ) AS cow_id,
              COALESCE(
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.cowNumber')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.cow_number')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.animalNumber')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.animal_number'))
              ) AS cow_number,
              COALESCE(
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.eventCode')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.event_code')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.eventType')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.event_type'))
              ) AS event_code,
              COALESCE(
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.eventType')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.event_type')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.eventCode')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.event_code'))
              ) AS event_type,
              DATE_FORMAT(COALESCE(
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.occurredAt')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.occurred_at')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.eventTime')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.eventDate')),
                created_at
              ), '%Y-%m-%d %H:%i:%s') AS event_key,
              COALESCE(
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.sourceRecordId')),
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$.source_record_id'))
              ) AS source_record_id,
              created_at
       FROM cow_events`
    )

    const phenotypeCompare = compareMaps(
      mapRows(traitRows, (row) => phenotypeStandardKey(row, context)),
      mapRows(phenotypeRows, (row) => phenotypeLegacyKey(row, context))
    )
    const milkCompare = compareMaps(
      mapRows(milkMeasurementRows, (row) => milkStandardKey(row, context)),
      mapRows(milkRecordRows, (row) => milkLegacyKey(row, context))
    )
    const eventCompare = compareMaps(
      mapRows(animalEventRows, (row) => eventStandardKey(row, context)),
      mapRows(cowEventRows, (row) => eventLegacyKey(row, context))
    )

    const traitInsertRows = phenotypeCompare.legacyOnly
      .filter((item) => (phenotypeCompare.duplicateKeys.find((dup) => dup.key === item.key) ? false : true))
      .filter((item) => !isGeneratedMirrorRow(item.row))
      .map((item) => buildTraitObservationFromPhenotype(item, context))
      .filter(Boolean)
    const phenotypeInsertRows = phenotypeCompare.standardOnly
      .filter((item) => (phenotypeCompare.duplicateKeys.find((dup) => dup.key === item.key) ? false : true))
      .filter((item) => !isGeneratedMirrorRow(item.row))
      .map((item) => buildPhenotypeFromTraitObservation(item, context))
      .filter(Boolean)
    const milkMeasurementInsertRows = milkCompare.legacyOnly
      .filter((item) => (milkCompare.duplicateKeys.find((dup) => dup.key === item.key) ? false : true))
      .filter((item) => !isGeneratedMirrorRow(item.row))
      .map((item) => buildMilkMeasurementFromLegacy(item, context))
      .filter(Boolean)
    const milkRecordInsertRows = milkCompare.standardOnly
      .filter((item) => (milkCompare.duplicateKeys.find((dup) => dup.key === item.key) ? false : true))
      .filter((item) => !isGeneratedMirrorRow(item.row))
      .map((item) => buildMilkRecordFromMeasurement(item, context))
      .filter(Boolean)

    let inserted = {
      traitObservation: 0,
      phenotypeRecords: 0,
      milkMeasurement: 0,
      milkRecords: 0
    }
    if (apply) {
      await connection.beginTransaction()
      inserted.traitObservation = await insertRows(connection, 'trait_observation', traitInsertRows)
      inserted.phenotypeRecords = await insertRows(connection, 'phenotype_records', phenotypeInsertRows)
      inserted.milkMeasurement = await insertRows(connection, 'milk_measurement', milkMeasurementInsertRows)
      inserted.milkRecords = await insertRows(connection, 'milk_records', milkRecordInsertRows)
      await connection.commit()
    }

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      phenotype: {
        standardRows: traitRows.length,
        legacyRows: phenotypeRows.length,
        matchedKeys: phenotypeCompare.matched.length,
        standardOnly: phenotypeCompare.standardOnly.length,
        legacyOnly: phenotypeCompare.legacyOnly.length,
        duplicateKeys: phenotypeCompare.duplicateKeys.length,
        insertableTraitObservation: traitInsertRows.length,
        insertablePhenotypeRecords: phenotypeInsertRows.length
      },
      milk: {
        standardRows: milkMeasurementRows.length,
        legacyRows: milkRecordRows.length,
        matchedKeys: milkCompare.matched.length,
        standardOnly: milkCompare.standardOnly.length,
        legacyOnly: milkCompare.legacyOnly.length,
        duplicateKeys: milkCompare.duplicateKeys.length,
        insertableMilkMeasurement: milkMeasurementInsertRows.length,
        insertableMilkRecords: milkRecordInsertRows.length
      },
      event: {
        standardRows: animalEventRows.length,
        legacyRows: cowEventRows.length,
        matchedKeys: eventCompare.matched.length,
        standardOnly: eventCompare.standardOnly.length,
        legacyOnly: eventCompare.legacyOnly.length,
        duplicateKeys: eventCompare.duplicateKeys.length,
        applyPolicy: 'report-only'
      },
      inserted,
      insertedNote: apply ? 'MySQL affectedRows; duplicate-key updates may count as affected rows.' : 'dry-run only',
      samples: {
        phenotypeStandardOnly: phenotypeCompare.standardOnly.slice(0, 5).map((item) => item.row.id),
        phenotypeLegacyOnly: phenotypeCompare.legacyOnly.slice(0, 5).map((item) => item.row.id),
        milkStandardOnly: milkCompare.standardOnly.slice(0, 5).map((item) => item.row.id),
        milkLegacyOnly: milkCompare.legacyOnly.slice(0, 5).map((item) => item.row.id),
        phenotypeDuplicateKeys: phenotypeCompare.duplicateKeys.slice(0, 5),
        milkDuplicateKeys: milkCompare.duplicateKeys.slice(0, 5),
        eventStandardOnly: eventCompare.standardOnly.slice(0, 5).map((item) => item.row.id),
        eventLegacyOnly: eventCompare.legacyOnly.slice(0, 5).map((item) => item.row.id),
        eventDuplicateKeys: eventCompare.duplicateKeys.slice(0, 5)
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
