import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
if (process.env.AUDIT_SKIP_PRODUCTION_ENV !== '1') {
  dotenv.config({ path: path.join(projectRoot, 'ops/production/.env.prod'), override: true, quiet: true })
}

const apply = process.argv.includes('--apply')

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

const text = (value) => String(value ?? '').trim()
const quote = (name) => `\`${String(name).replace(/`/g, '``')}\``

function parseJson(value) {
  if (!value) return {}
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function stableCode(value) {
  return text(value)
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function stableId(prefix, value) {
  return `${prefix}-${stableCode(value) || Math.random().toString(36).slice(2, 10)}`
}

function isActiveStatus(value, activeValue) {
  const status = text(value).toLowerCase()
  if (['停用', '禁用', 'inactive', 'disabled', 'false', '0'].includes(status)) return false
  if (activeValue !== undefined && activeValue !== null && activeValue !== '') {
    return !['0', 'false', '停用', '禁用', 'inactive', 'disabled'].includes(text(activeValue).toLowerCase())
  }
  return true
}

function normalizeMedicineCategory(value) {
  const raw = text(value)
  if (!raw) return '未分类'
  if (/疫苗/.test(raw)) return '疫苗'
  if (/驱虫/.test(raw)) return '驱虫药'
  if (/维生素|营养/.test(raw)) return '维生素'
  if (/消毒/.test(raw)) return '消毒剂'
  if (/解热|镇痛|抗炎/.test(raw)) return '解热镇痛药'
  if (/钙|磷/.test(raw)) return '钙磷补充剂'
  if (/激素|繁殖|缩宫|孕酮/.test(raw)) return '激素类'
  if (/抗生素|头孢|阿莫西林|青霉素/.test(raw)) return '抗生素'
  return raw
}

function traitDataType(value) {
  const raw = text(value).toLowerCase()
  if (/数值|number|numeric|decimal|float|int/.test(raw)) return 'number'
  if (/日期|date/.test(raw)) return 'date'
  if (/枚举|select|category/.test(raw)) return 'category'
  return 'text'
}

function traitType(category, name) {
  const raw = `${category} ${name}`.toLowerCase()
  if (/奶|泌乳|milk|lactation/.test(raw)) return 'lactation'
  if (/体温|步数|活动|sensor|传感/.test(raw)) return 'sensor'
  if (/繁殖|胎次|配种|妊娠/.test(raw)) return 'reproduction'
  return 'phenotype'
}

function shiftWindow(code, name, sequenceNo) {
  const raw = `${code} ${name}`.toLowerCase()
  if (/早|am|morning/.test(raw) || String(code) === '1') return ['05:00:00', '09:00:00']
  if (/中|mid|noon/.test(raw) || String(code) === '3') return ['11:00:00', '15:00:00']
  if (/晚|pm|evening/.test(raw) || String(code) === '2') return ['17:00:00', '21:00:00']
  if (/夜|半夜|night/.test(raw) || String(code) === '4') return ['23:00:00', '03:00:00']
  const windows = [
    ['05:00:00', '09:00:00'],
    ['17:00:00', '21:00:00'],
    ['11:00:00', '15:00:00'],
    ['23:00:00', '03:00:00']
  ]
  return windows[Math.max(0, Number(sequenceNo || 1) - 1) % windows.length]
}

async function queryAll(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params)
  return rows || []
}

async function tableExists(connection, table) {
  const rows = await queryAll(
    connection,
    `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
    [dbConfig.database, table]
  )
  return Number(rows[0]?.count || 0) > 0
}

async function columnSet(connection, table) {
  const rows = await queryAll(
    connection,
    `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`,
    [dbConfig.database, table]
  )
  return new Set(rows.map((row) => row.COLUMN_NAME || row.column_name))
}

async function countWhere(connection, table, where, params = []) {
  if (!(await tableExists(connection, table))) return 0
  const rows = await queryAll(connection, `SELECT COUNT(*) AS count FROM ${quote(table)} WHERE ${where}`, params)
  return Number(rows[0]?.count || 0)
}

async function deleteWhere(connection, table, where, params = []) {
  const count = await countWhere(connection, table, where, params)
  if (apply && count > 0) await connection.query(`DELETE FROM ${quote(table)} WHERE ${where}`, params)
  return count
}

async function deleteSeedishByColumns(connection, table, columns, extraWhere = '') {
  if (!(await tableExists(connection, table))) return 0
  const existingColumns = await columnSet(connection, table)
  const activeColumns = columns.filter((column) => existingColumns.has(column))
  const parts = []
  const patterns = [
    'vis-%',
    'VIS-%',
    '%visual%',
    '%可视化%',
    '%验收%',
    '%acceptance%',
    '%milk_stat%',
    '%MILK-STAT%',
    '%validate-milk-production-statistics%',
    '%validation%',
    '%链路验证%',
    'TEST%',
    'test%'
  ]
  for (const column of activeColumns) {
    for (const pattern of patterns) {
      parts.push(`${quote(column)} LIKE ${mysql.escape(pattern)}`)
    }
  }
  if (extraWhere) parts.push(`(${extraWhere})`)
  if (!parts.length) return 0
  return deleteWhere(connection, table, parts.join(' OR '))
}

async function upsert(connection, table, row, skipUpdate = ['id', 'created_at']) {
  const columns = await columnSet(connection, table)
  const keys = Object.keys(row).filter((key) => columns.has(key))
  if (!keys.length) return false
  const updates = keys
    .filter((key) => !skipUpdate.includes(key))
    .map((key) => `${quote(key)} = VALUES(${quote(key)})`)
    .join(', ')
  const sql = `INSERT INTO ${quote(table)} (${keys.map(quote).join(', ')})
    VALUES (${keys.map(() => '?').join(', ')})
    ON DUPLICATE KEY UPDATE ${updates || `${quote(keys[0])} = ${quote(keys[0])}`}`
  if (apply) await connection.query(sql, keys.map((key) => row[key]))
  return true
}

async function cleanupVisualResidue(connection) {
  const result = {}
  result.device_channel = await deleteSeedishByColumns(connection, 'device_channel', ['id', 'device_id', 'code', 'name'])
  result.animal_device_assignment = await deleteSeedishByColumns(connection, 'animal_device_assignment', ['id', 'device_id', 'animal_id', 'animal_number'])
  result.sensor_status = await deleteSeedishByColumns(connection, 'sensor_status', ['id', 'device_id', 'animal_id', 'animal_number'])
  result.sensor_reading = await deleteSeedishByColumns(connection, 'sensor_reading', ['id', 'device_id', 'animal_id', 'animal_number', 'source_record_id'])
  result.sensor_readings = await deleteSeedishByColumns(connection, 'sensor_readings', ['id', 'device_id', 'animal_id', 'animal_number', 'cow_number'])
  result.sensors = await deleteSeedishByColumns(connection, 'sensors', ['id', 'device_id', 'animal_id', 'animal_number', 'cow_number'])
  result.device = await deleteSeedishByColumns(
    connection,
    'device',
    ['id', 'code', 'name', 'manufacturer', 'model', 'serial_no'],
    "JSON_EXTRACT(configuration, '$.sourceType') = 'visual_week_seed'"
  )
  result.hardware_devices = await deleteSeedishByColumns(
    connection,
    'hardware_devices',
    ['id', 'name', 'brand', 'model', 'serial_number'],
    "JSON_EXTRACT(configuration_json, '$.sourceType') = 'visual_week_seed' OR JSON_EXTRACT(relation_scope, '$.orphanCowIds') IS NOT NULL"
  )
  result.medicines = await deleteSeedishByColumns(connection, 'medicines', ['id', 'name', 'category'])
  result.diseases = await deleteSeedishByColumns(connection, 'diseases', ['id', 'name', 'category'])
  result.trait_observation = await deleteSeedishByColumns(connection, 'trait_observation', ['id', 'trait_id', 'trait_code', 'source_record_id'])
  result.trait_definition = await deleteSeedishByColumns(connection, 'trait_definition', ['id', 'code', 'name', 'category_id'])
  result.trait_category = await deleteSeedishByColumns(connection, 'trait_category', ['id', 'code', 'name'])
  return result
}

async function cleanupValidationResidue(connection) {
  const result = {}
  const sources = [
    'alert_case',
    'animal_device_assignment',
    'animal_group_membership',
    'animal_identifier',
    'animal_parentage',
    'animal_pen_assignment',
    'animal_time_index',
    'breeding_value',
    'correction_request',
    'custom_field_value',
    'data_quality_issue',
    'derivation_recompute_job',
    'dry_period_episode',
    'event_health_detail',
    'event_medicine_detail',
    'event_movement_detail',
    'event_production_detail',
    'event_reproduction_detail',
    'fact_cow_trait_day',
    'fact_cow_trait_lactation',
    'fact_cow_trait_month',
    'fact_cow_trait_parity',
    'fact_cow_trait_year',
    'fact_event_count_cycle',
    'fact_event_count_day',
    'fact_event_count_lactation',
    'fact_event_count_month',
    'fact_event_count_parity',
    'fact_event_count_year',
    'fact_lactation_305',
    'gestation_episode',
    'group_transfer_request',
    'lactation_episode',
    'mating_recommendation',
    'medication_administration',
    'medication_order',
    'milk_measurement',
    'milking_visit',
    'milking_session',
    'milk_records',
    'parity_episode',
    'reproduction_cycle',
    'residue_test',
    'sensor_reading',
    'time_period',
    'trait_observation',
    'withdrawal_tracking',
    'work_order',
    'animal_event',
    'cow_events',
    'entry_events',
    'transfer_events',
    'exit_events',
    'breeding_events',
    'veterinary_events',
    'animal',
    'cows'
  ]
  for (const table of sources) {
    result[table] = await deleteSeedishByColumns(connection, table, [
      'id',
      'animal_id',
      'animal_number',
      'cow_id',
      'cow_number',
      'source_table',
      'source_type',
      'source_record_id',
      'operator_name',
      'name'
    ])
  }
  return result
}

async function ensureSystemPersons(connection) {
  if (!(await tableExists(connection, 'persons'))) return { upserts: 0 }
  const rows = [
    {
      id: 'system-admin',
      name: 'admin',
      department: '系统',
      role: '管理员',
      phone: '',
      email: '',
      status: '正常',
      hire_date: null,
      notes: '系统管理员账号',
      is_active: 1,
      created_at: new Date(),
      updated_at: new Date()
    }
  ]
  let upserts = 0
  for (const row of rows) {
    const ok = await upsert(connection, 'persons', row)
    if (ok) upserts += 1
  }
  return { upserts }
}

async function mirrorMedicines(connection) {
  if (!(await tableExists(connection, 'medicines')) || !(await tableExists(connection, 'medicine'))) return { candidates: 0, upserts: 0 }
  const rows = await queryAll(
    connection,
    `SELECT *
     FROM medicines
     WHERE id NOT LIKE 'vis-%'
       AND name IS NOT NULL
       AND name <> ''`
  )
  let upserts = 0
  for (const row of rows) {
    const id = text(row.id) || stableId('med', row.name)
    const ok = await upsert(connection, 'medicine', {
      id,
      code: text(row.code || row.id || row.name),
      name: text(row.name),
      category: normalizeMedicineCategory(row.category),
      active_ingredient: null,
      specification: text(row.dosage || row.specification),
      unit: text(row.unit),
      manufacturer: text(row.manufacturer),
      default_withdrawal_milk_days: null,
      default_withdrawal_meat_days: null,
      status: isActiveStatus(row.status, row.is_active) ? 'active' : 'inactive',
      created_at: row.created_at || new Date(),
      updated_at: new Date()
    })
    if (ok) upserts += 1
  }
  return { candidates: rows.length, upserts }
}

async function mirrorMilkShifts(connection) {
  if (!(await tableExists(connection, 'base_info_categories')) || !(await tableExists(connection, 'production_shift'))) return { candidates: 0, upserts: 0 }
  const rows = await queryAll(connection, `SELECT * FROM base_info_categories WHERE scope = 'milk:shifts'`)
  let upserts = 0
  for (const row of rows) {
    const payload = parseJson(row.payload)
    const code = text(row.code || row.value || payload.code || payload.value || row.name || payload.name)
    if (!code) continue
    const name = text(row.name || row.label || payload.name || payload.label || code)
    const sequenceNo = Number(row.sort_order ?? payload.sortOrder ?? payload.sort_order ?? 0) || 0
    const [startTime, endTime] = shiftWindow(code, name, sequenceNo)
    const ok = await upsert(connection, 'production_shift', {
      id: text(row.id) || stableId('milk-shift', code),
      code,
      name,
      shift_type: text(row.category || payload.category || payload.categoryName || '自定义'),
      start_time: startTime,
      end_time: endTime,
      sequence_no: sequenceNo,
      status: isActiveStatus(row.status || payload.status, row.is_active ?? payload.isActive) ? 'active' : 'inactive',
      created_at: row.created_at || new Date(),
      updated_at: new Date()
    })
    if (ok) upserts += 1
  }
  return { candidates: rows.length, upserts }
}

async function mirrorTraitDefinitions(connection) {
  if (!(await tableExists(connection, 'phenotype_trait_definitions')) || !(await tableExists(connection, 'trait_definition'))) {
    return { candidates: 0, categories: 0, upserts: 0 }
  }
  const rows = await queryAll(connection, `SELECT * FROM phenotype_trait_definitions ORDER BY code, id`)
  const categories = new Map()
  for (const row of rows) {
    const payload = parseJson(row.payload)
    const category = text(payload.category || row.category || '通用性状')
    categories.set(category, stableId('trait-category', category))
  }
  let categoryUpserts = 0
  for (const [category, id] of categories.entries()) {
    const ok = await upsert(connection, 'trait_category', {
      id,
      code: stableCode(category),
      name: category,
      parent_id: null,
      sort_order: 0,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    })
    if (ok) categoryUpserts += 1
  }

  let upserts = 0
  for (const row of rows) {
    const payload = parseJson(row.payload)
    const code = text(row.code || payload.code || row.id)
    const name = text(payload.name || row.name || code)
    if (!code || !name) continue
    const category = text(payload.category || row.category || '通用性状')
    const ok = await upsert(connection, 'trait_definition', {
      id: text(row.id) || stableId('trait', code),
      code,
      name,
      category_id: categories.get(category),
      trait_type: traitType(category, name),
      data_type: traitDataType(payload.data_type || payload.dataType),
      unit: text(payload.unit),
      value_min: null,
      value_max: null,
      is_quality_trait: /奶质|质量|quality/i.test(`${category} ${name}`) ? 1 : 0,
      applicable_stage_ids: JSON.stringify(['all']),
      default_aggregation: 'avg',
      export_enabled: 1,
      status: isActiveStatus(payload.status || row.status) ? 'active' : 'inactive',
      created_at: row.created_at || new Date(),
      updated_at: new Date()
    })
    if (ok) upserts += 1
  }
  return { candidates: rows.length, categories: categoryUpserts, upserts }
}

async function main() {
  const connection = await mysql.createConnection(dbConfig)
  const result = { mode: apply ? 'apply' : 'dry-run' }
  try {
    await connection.query('SET NAMES utf8mb4')
    if (apply) await connection.beginTransaction()

    result.visualResidue = await cleanupVisualResidue(connection)
    result.validationResidue = await cleanupValidationResidue(connection)
    result.systemPersons = await ensureSystemPersons(connection)
    result.medicineMirror = await mirrorMedicines(connection)
    result.milkShiftMirror = await mirrorMilkShifts(connection)
    result.traitDefinitionMirror = await mirrorTraitDefinitions(connection)

    if (apply) await connection.commit()
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    if (apply) {
      try {
        await connection.rollback()
      } catch {
        // ignore rollback errors
      }
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
