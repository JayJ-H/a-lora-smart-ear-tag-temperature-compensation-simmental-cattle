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

const CRITICAL_TABLES = [
  'animal',
  'cows',
  'animal_identifier',
  'animal_parentage',
  'farm_unit',
  'pens',
  'animal_pen_assignment',
  'animal_event',
  'cow_events',
  'entry_events',
  'transfer_events',
  'exit_events',
  'breeding_events',
  'veterinary_events',
  'trait_category',
  'trait_definition',
  'trait_observation',
  'phenotype_records',
  'milk_measurement',
  'milk_records',
  'base_info_categories',
  'custom_fields',
  'export_configs',
  'import_configs',
  'operation_audit_logs',
  'export_audit_logs'
]

const REQUIRED_COLUMNS = {
  animal: ['id', 'animal_number', 'status', 'current_pen_id', 'current_unit_id'],
  cows: ['id', 'cow_number', 'status', 'current_pen'],
  animal_event: ['id', 'animal_id', 'event_type', 'event_code', 'occurred_at', 'operator_name', 'source_record_id', 'custom_values'],
  trait_observation: ['id', 'animal_id', 'trait_id', 'observed_at', 'numeric_value', 'source_record_id'],
  milk_measurement: ['id', 'animal_id', 'measured_at', 'production_date', 'shift_id', 'parity_no', 'days_in_milk', 'milk_yield', 'source_record_id'],
  farm_unit: ['id', 'code', 'name', 'unit_type', 'status'],
  pens: ['id', 'name', 'category', 'status'],
  custom_fields: ['id', 'payload'],
  base_info_categories: ['id', 'payload']
}

const LEGACY_PAIRS = [
  ['animal_event', 'cow_events'],
  ['trait_observation', 'phenotype_records'],
  ['milk_measurement', 'milk_records'],
  ['animal', 'cows']
]

const text = (value) => String(value ?? '').trim()

function normalizeTableName(value) {
  return String(value || '')
    .trim()
    .replace(/-/g, '_')
    .replace(/[^\w]/g, '')
    .toLowerCase()
}

function walkFiles(dir, extensions, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git'].includes(entry.name)) walkFiles(full, extensions, files)
      continue
    }
    if (extensions.includes(path.extname(entry.name))) files.push(full)
  }
  return files
}

function scanFrontendTableReferences() {
  const files = walkFiles(path.join(projectRoot, 'src'), ['.ts', '.vue', '.mjs'])
  const patterns = [
    { regex: /getTableDataAsync\(\s*['"`]([^'"`]+)['"`]/g, mode: 'read' },
    { regex: /addTableDataAsync\(\s*['"`]([^'"`]+)['"`]/g, mode: 'write' },
    { regex: /updateTableRecordAsync\(\s*['"`]([^'"`]+)['"`]/g, mode: 'write' },
    { regex: /deleteTableRecordAsync\(\s*['"`]([^'"`]+)['"`]/g, mode: 'write' },
    { regex: /safeRows(?:<[^>]+>)?\(\s*['"`]([^'"`]+)['"`]/g, mode: 'read' },
    { regex: /safeTable\(\s*['"`]([^'"`]+)['"`]/g, mode: 'read' },
    { regex: /readTableSafe\(\s*['"`]([^'"`]+)['"`]/g, mode: 'read' },
    { regex: /readTable\(\s*['"`]([^'"`]+)['"`]/g, mode: 'read' }
  ]
  const refs = new Map()
  for (const file of files) {
    const rel = path.relative(projectRoot, file).replace(/\\/g, '/')
    const text = fs.readFileSync(file, 'utf8')
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern.regex)) {
        const raw = match[1]
        const normalized = normalizeTableName(raw)
        if (!refs.has(normalized)) {
          refs.set(normalized, {
            rawNames: new Set(),
            files: new Set(),
            readFiles: new Set(),
            writeFiles: new Set()
          })
        }
        refs.get(normalized).rawNames.add(raw)
        refs.get(normalized).files.add(rel)
        if (pattern.mode === 'read') refs.get(normalized).readFiles.add(rel)
        if (pattern.mode === 'write') refs.get(normalized).writeFiles.add(rel)
      }
    }
  }
  return Array.from(refs.entries())
    .map(([table, value]) => ({
      table,
      rawNames: Array.from(value.rawNames).sort(),
      files: Array.from(value.files).sort(),
      readFiles: Array.from(value.readFiles).sort(),
      writeFiles: Array.from(value.writeFiles).sort()
    }))
    .sort((left, right) => left.table.localeCompare(right.table))
}

async function queryOne(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params)
  return rows?.[0] || {}
}

async function queryAll(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params)
  return rows || []
}

async function tableExists(connection, table) {
  const row = await queryOne(
    connection,
    `SELECT COUNT(*) AS count
     FROM information_schema.tables
     WHERE table_schema = ? AND table_name = ?`,
    [dbConfig.database, table]
  )
  return Number(row.count || 0) > 0
}

async function countRows(connection, table) {
  if (!(await tableExists(connection, table))) return null
  const row = await queryOne(connection, `SELECT COUNT(*) AS count FROM \`${table}\``)
  return Number(row.count || 0)
}

function timeKey(value) {
  return text(value).replace('T', ' ').replace('Z', '').slice(0, 19)
}

function numericKey(value, digits = 4) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(digits) : ''
}

function valueKey(numericValue, textValue) {
  const numeric = numericKey(numericValue)
  if (numeric) return `n:${numeric}`
  const raw = text(textValue).toLowerCase()
  return raw ? `t:${raw}` : 'empty'
}

function addMap(map, key, row) {
  if (!key) return
  if (!map.has(key)) map.set(key, [])
  map.get(key).push(row)
}

function compareKeyMaps(standardRows, legacyRows, standardKey, legacyKey) {
  const standardMap = new Map()
  const legacyMap = new Map()
  standardRows.forEach((row) => addMap(standardMap, standardKey(row), row))
  legacyRows.forEach((row) => addMap(legacyMap, legacyKey(row), row))
  const keys = new Set([...standardMap.keys(), ...legacyMap.keys()])
  let matchedKeys = 0
  let standardOnly = 0
  let legacyOnly = 0
  let duplicateKeys = 0
  for (const key of keys) {
    const standard = standardMap.get(key) || []
    const legacy = legacyMap.get(key) || []
    if (standard.length > 1 || legacy.length > 1) duplicateKeys += 1
    if (standard.length && legacy.length) matchedKeys += 1
    else if (standard.length) standardOnly += standard.length
    else legacyOnly += legacy.length
  }
  return { matchedKeys, standardOnly, legacyOnly, duplicateKeys }
}

async function main() {
  const startedAt = new Date().toISOString()
  const connection = await mysql.createConnection(dbConfig)
  try {
    await connection.query('SET NAMES utf8mb4')
    const frontendRefs = scanFrontendTableReferences()
    const dbTables = await queryAll(
      connection,
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = ?
       ORDER BY table_name`,
      [dbConfig.database]
    )
    const dbTableSet = new Set(dbTables.map((row) => row.TABLE_NAME || row.table_name))

    const columns = await queryAll(
      connection,
      `SELECT table_name, column_name, data_type, character_set_name, collation_name
       FROM information_schema.columns
       WHERE table_schema = ?
       ORDER BY table_name, ordinal_position`,
      [dbConfig.database]
    )
    const columnMap = new Map()
    for (const row of columns) {
      const table = row.TABLE_NAME || row.table_name
      const column = row.COLUMN_NAME || row.column_name
      if (!columnMap.has(table)) columnMap.set(table, new Set())
      columnMap.get(table).add(column)
    }

    const findings = []
    const addFinding = (severity, code, message, details = {}) => {
      findings.push({ severity, code, message, details })
    }

    for (const ref of frontendRefs) {
      if (!dbTableSet.has(ref.table)) {
        addFinding('high', 'frontend_table_missing_in_mysql', `Frontend references table not present in MySQL: ${ref.table}`, {
          rawNames: ref.rawNames,
          files: ref.files.slice(0, 12)
        })
      }
    }

    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
      const existing = columnMap.get(table) || new Set()
      const missing = required.filter((column) => !existing.has(column))
      if (missing.length) {
        addFinding('high', 'required_columns_missing', `${table} is missing required columns`, { table, missing })
      }
    }

    const rowCounts = {}
    for (const table of CRITICAL_TABLES) {
      rowCounts[table] = await countRows(connection, table)
    }

    const pairCounts = []
    for (const [standard, legacy] of LEGACY_PAIRS) {
      pairCounts.push({
        standard,
        legacy,
        standardRows: rowCounts[standard] ?? (await countRows(connection, standard)),
        legacyRows: rowCounts[legacy] ?? (await countRows(connection, legacy))
      })
    }

    const [animalRows] = await connection.query(`SELECT id, animal_number FROM animal`)
    const [cowRows] = await connection.query(`SELECT id, cow_number FROM cows`)
    const [traitRows] = await connection.query(`SELECT id, code FROM trait_definition`)
    const animalById = new Map(animalRows.map((row) => [text(row.id), row]))
    const animalByNumber = new Map(animalRows.map((row) => [text(row.animal_number), row]).filter(([key]) => key))
    const cowsById = new Map(cowRows.map((row) => [text(row.id), row]))
    const traitById = new Map(traitRows.map((row) => [text(row.id), row]))
    const traitByCode = new Map(traitRows.map((row) => [text(row.code), row]).filter(([key]) => key))
    const animalForRef = (id, number) =>
      animalById.get(text(id)) ||
      animalByNumber.get(text(number)) ||
      animalByNumber.get(text(cowsById.get(text(id))?.cow_number)) ||
      null
    const cowNumberForAnimal = (animalId) =>
      animalById.get(text(animalId))?.animal_number || cowsById.get(text(animalId))?.cow_number || ''

    const [traitMirrorRows] = await connection.query(
      `SELECT o.id, o.animal_id, o.trait_id,
              DATE_FORMAT(o.observed_at, '%Y-%m-%d %H:%i:%s') AS observed_key,
              o.numeric_value, o.text_value, o.unit
       FROM trait_observation o`
    )
    const [phenotypeMirrorRows] = await connection.query(
      `SELECT id, cow_id, cow_number,
              DATE_FORMAT(collection_date, '%Y-%m-%d %H:%i:%s') AS collection_key,
              trait_code, value, text_value, unit
       FROM phenotype_records`
    )
    const [milkMeasurementMirrorRows] = await connection.query(
      `SELECT id, animal_id,
              DATE_FORMAT(measured_at, '%Y-%m-%d %H:%i:%s') AS measured_key,
              shift_id, milk_yield
       FROM milk_measurement`
    )
    const [milkRecordMirrorRows] = await connection.query(
      `SELECT id, cow_id,
              DATE_FORMAT(milking_time, '%Y-%m-%d %H:%i:%s') AS milking_key,
              shift_id, volume
       FROM milk_records`
    )
    const mirrorDrift = {
      phenotype: compareKeyMaps(
        traitMirrorRows,
        phenotypeMirrorRows,
        (row) => {
          const trait = traitById.get(text(row.trait_id)) || traitByCode.get(text(row.trait_id))
          return [
            text(row.animal_id) || cowNumberForAnimal(row.animal_id),
            text(trait?.code || row.trait_id),
            timeKey(row.observed_key),
            valueKey(row.numeric_value, row.text_value),
            text(row.unit).toLowerCase()
          ].join('|')
        },
        (row) => {
          const animal = animalForRef(row.cow_id, row.cow_number)
          return [
            text(animal?.id || row.cow_id || row.cow_number),
            text(row.trait_code),
            timeKey(row.collection_key),
            valueKey(row.value, row.text_value),
            text(row.unit).toLowerCase()
          ].join('|')
        }
      ),
      milk: compareKeyMaps(
        milkMeasurementMirrorRows,
        milkRecordMirrorRows,
        (row) => [
          text(row.animal_id),
          timeKey(row.measured_key),
          text(row.shift_id),
          numericKey(row.milk_yield, 2)
        ].join('|'),
        (row) => {
          const animal = animalForRef(row.cow_id, '')
          return [
            text(animal?.id || row.cow_id),
            timeKey(row.milking_key),
            text(row.shift_id),
            numericKey(row.volume, 2)
          ].join('|')
        }
      )
    }

    const orphanChecks = {
      animalWithoutCows: await queryOne(
        connection,
        `SELECT COUNT(*) AS count
         FROM animal a
         LEFT JOIN cows c ON c.id = a.id OR c.cow_number = a.animal_number
         WHERE c.id IS NULL`
      ),
      cowsWithoutAnimal: await queryOne(
        connection,
        `SELECT COUNT(*) AS count
         FROM cows c
         LEFT JOIN animal a ON a.id = c.id OR a.animal_number = c.cow_number
         WHERE a.id IS NULL`
      ),
      eventMissingAnimal: await queryOne(
        connection,
        `SELECT COUNT(*) AS count
         FROM animal_event ae
         LEFT JOIN animal a ON a.id = ae.animal_id
         WHERE a.id IS NULL`
      ),
      traitMissingAnimal: await queryOne(
        connection,
        `SELECT COUNT(*) AS count
         FROM trait_observation t
         LEFT JOIN animal a ON a.id = t.animal_id
         WHERE a.id IS NULL`
      ),
      traitMissingDefinition: await queryOne(
        connection,
        `SELECT COUNT(*) AS count
         FROM trait_observation t
         LEFT JOIN trait_definition d ON d.id = t.trait_id OR d.code = t.trait_id
         WHERE d.id IS NULL`
      ),
      milkMissingAnimal: await queryOne(
        connection,
        `SELECT COUNT(*) AS count
         FROM milk_measurement m
         LEFT JOIN animal a ON a.id = m.animal_id
         WHERE a.id IS NULL`
      ),
      animalPenAssignmentMissingUnit: await queryOne(
        connection,
        `SELECT COUNT(*) AS count
         FROM animal_pen_assignment apa
         LEFT JOIN farm_unit fu ON fu.id = apa.unit_id
         WHERE fu.id IS NULL`
      )
    }

    for (const [key, row] of Object.entries(orphanChecks)) {
      const count = Number(row.count || 0)
      if (count > 0) addFinding('high', key, `${key} has ${count} rows`, { count })
    }

    const driftChecks = {
      traitObservationNoSourceRecord: await queryOne(
        connection,
        `SELECT COUNT(*) AS count FROM trait_observation WHERE source_record_id IS NULL OR source_record_id = ''`
      ),
      traitObservationExternalTraceability: await queryOne(
        connection,
        `SELECT COUNT(*) AS count
         FROM trait_observation
         WHERE NULLIF(source_record_id, '') IS NOT NULL
           AND source_type = 'phenotype-records'`
      ),
      traitObservationSelfTraceability: await queryOne(
        connection,
        `SELECT COUNT(*) AS count
         FROM trait_observation
         WHERE NULLIF(source_record_id, '') IS NOT NULL
           AND source_type = 'trait_observation'
           AND source_record_id = id`
      ),
      traitObservationPotentiallyAmbiguousTraceability: await queryOne(
        connection,
        `SELECT COUNT(*) AS count
         FROM trait_observation
         WHERE NULLIF(source_record_id, '') IS NOT NULL
           AND source_type = 'trait_observation'
           AND source_record_id <> id`
      ),
      traitObservationNoParity: await queryOne(
        connection,
        `SELECT COUNT(*) AS count FROM trait_observation WHERE parity_no IS NULL`
      ),
      milkMeasurementNoSourceRecord: await queryOne(
        connection,
        `SELECT COUNT(*) AS count FROM milk_measurement WHERE source_record_id IS NULL OR source_record_id = ''`
      ),
      milkMeasurementNoParity: await queryOne(
        connection,
        `SELECT COUNT(*) AS count FROM milk_measurement WHERE parity_no IS NULL`
      ),
      milkMeasurementNoDim: await queryOne(
        connection,
        `SELECT COUNT(*) AS count FROM milk_measurement WHERE days_in_milk IS NULL`
      ),
      customFieldsMissingOptionSource: await queryOne(
        connection,
        `SELECT COUNT(*) AS count
         FROM custom_fields
         WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.type')) IN ('select', 'multi-select', 'radio', 'checkbox')
           AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.optionSource')), '') IS NULL
           AND NOT (
             JSON_TYPE(JSON_EXTRACT(payload, '$.options')) = 'ARRAY'
             AND JSON_LENGTH(JSON_EXTRACT(payload, '$.options')) > 0
           )
           AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.allowCreate')), 'false')) NOT IN ('true', '1')`
      ),
      baseInfoCategoriesWithParent: await queryOne(
        connection,
        `SELECT COUNT(*) AS count
         FROM base_info_categories
         WHERE COALESCE(
           NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.parentId')), ''),
           NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.parent_id')), '')
         ) IS NOT NULL`
      ),
      baseInfoCategoriesMissingTopLevelScope: await queryOne(
        connection,
        `SELECT COUNT(*) AS count
         FROM base_info_categories
         WHERE NULLIF(scope, '') IS NULL
           AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.scope')), '') IS NOT NULL`
      )
    }

    if (Number(driftChecks.traitObservationNoSourceRecord.count || 0) > 0) {
      addFinding('medium', 'missing_external_traceability', 'trait_observation rows still have no stable source_record_id', {
        count: Number(driftChecks.traitObservationNoSourceRecord.count || 0)
      })
    }
    if (Number(driftChecks.traitObservationPotentiallyAmbiguousTraceability.count || 0) > 0) {
      addFinding('medium', 'ambiguous_traceability', 'trait_observation rows have non-self fallback traceability that should be reviewed', {
        count: Number(driftChecks.traitObservationPotentiallyAmbiguousTraceability.count || 0)
      })
    }
    if (Number(driftChecks.customFieldsMissingOptionSource.count || 0) > 0) {
      addFinding('medium', 'custom_fields_missing_option_source', 'custom_fields rows are missing optionSource', {
        count: Number(driftChecks.customFieldsMissingOptionSource.count || 0)
      })
    }
    if (Number(driftChecks.baseInfoCategoriesWithParent.count || 0) === 0) {
      addFinding('medium', 'base_info_categories_no_parent_links', 'base_info_categories has no parentId links; second-level categories cannot be verified from data alone')
    }
    if (Number(driftChecks.baseInfoCategoriesMissingTopLevelScope.count || 0) > 0) {
      addFinding('medium', 'base_info_categories_missing_top_level_scope', 'base_info_categories rows keep scope only in payload; readers must normalize or data should be backfilled', {
        count: Number(driftChecks.baseInfoCategoriesMissingTopLevelScope.count || 0)
      })
    }

    const collationRows = await queryAll(
      connection,
      `SELECT table_name, column_name, collation_name
       FROM information_schema.columns
       WHERE table_schema = ?
         AND table_name IN ('animal','cows','farm_unit','pens','animal_pen_assignment','animal_event','trait_observation','milk_measurement')
         AND data_type IN ('varchar','char','text','longtext','mediumtext')
       ORDER BY table_name, column_name`,
      [dbConfig.database]
    )
    const collationGroups = new Map()
    for (const row of collationRows) {
      const collation = row.COLLATION_NAME || row.collation_name || ''
      if (!collation) continue
      if (!collationGroups.has(collation)) collationGroups.set(collation, [])
      collationGroups.get(collation).push(`${row.TABLE_NAME || row.table_name}.${row.COLUMN_NAME || row.column_name}`)
    }
    if (collationGroups.size > 1) {
      addFinding('medium', 'mixed_collations', 'Critical tables use mixed collations; joins can fail or require explicit COLLATE', {
        collations: Object.fromEntries(Array.from(collationGroups.entries()).map(([key, value]) => [key, value.slice(0, 20)]))
      })
    }

    const legacyTables = new Set([
      'cow_events',
      'milk_records',
      'phenotype_records',
      'entry_events',
      'transfer_events',
      'exit_events',
      'breeding_events',
      'veterinary_events'
    ])
    const directLegacyConsumers = frontendRefs.filter((ref) => legacyTables.has(ref.table))
    const directLegacyPageConsumers = directLegacyConsumers
      .map((ref) => ({
        ...ref,
        files: ref.readFiles.filter(
          (file) =>
            file.startsWith('src/views/') &&
            ![
              'src/views/data-export/information/index.vue',
              'src/views/data-export/cow-events/index.vue',
              'src/views/data-export/phenotype/index.vue',
              'src/views/data-import/information/index.vue'
            ].includes(file)
        )
      }))
      .filter((ref) => ref.files.length)

    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      database: { host: dbConfig.host, port: dbConfig.port, database: dbConfig.database, user: dbConfig.user },
      summary: {
        dbTableCount: dbTables.length,
        frontendReferencedTableCount: frontendRefs.length,
        findingCount: findings.length,
        highFindingCount: findings.filter((item) => item.severity === 'high').length,
        mediumFindingCount: findings.filter((item) => item.severity === 'medium').length
      },
      rowCounts,
      pairCounts,
      orphanChecks: Object.fromEntries(Object.entries(orphanChecks).map(([key, row]) => [key, Number(row.count || 0)])),
      driftChecks: Object.fromEntries(Object.entries(driftChecks).map(([key, row]) => [key, Number(row.count || 0)])),
      mirrorDrift,
      directLegacyConsumers,
      directLegacyPageConsumers,
      findings,
      frontendRefs
    }

    const outDir = path.join(projectRoot, 'artifacts', 'audits')
    fs.mkdirSync(outDir, { recursive: true })
    const stamp = startedAt.replace(/[:.]/g, '-')
    const jsonPath = path.join(outDir, `frontend-db-contract-${stamp}.json`)
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8')

    const latestPath = path.join(outDir, 'frontend-db-contract-latest.json')
    fs.writeFileSync(latestPath, JSON.stringify(report, null, 2), 'utf8')

    console.log(JSON.stringify({
      summary: report.summary,
      rowCounts,
      pairCounts,
      orphanChecks: report.orphanChecks,
      driftChecks: report.driftChecks,
      mirrorDrift,
      directLegacyConsumerCount: directLegacyConsumers.length,
      directLegacyPageConsumerCount: directLegacyPageConsumers.length,
      report: path.relative(projectRoot, jsonPath).replace(/\\/g, '/'),
      latest: path.relative(projectRoot, latestPath).replace(/\\/g, '/'),
      findings: findings.slice(0, 12)
    }, null, 2))
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
