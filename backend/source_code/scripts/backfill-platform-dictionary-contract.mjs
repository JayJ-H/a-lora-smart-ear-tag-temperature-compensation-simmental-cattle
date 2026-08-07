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

const text = (value) => String(value ?? '').trim()
const nowIso = () => new Date().toISOString()

const STATIC_OPTION_SOURCE_BY_FIELD = [
  [/cow|animal|牛号|个体/i, 'cow'],
  [/pen|unit|圈舍|舍|栏/i, 'pen'],
  [/medicine|drug|药品|用药/i, 'medicine'],
  [/batch|批号/i, 'medicineBatch'],
  [/reason|原因|去向/i, 'transferReason'],
  [/disease|diagnosis|疾病|诊断/i, 'disease'],
  [/dose_unit|unit|单位/i, 'medicineUnit'],
  [/vaccine|疫苗/i, 'vaccine'],
  [/operator|collector|recorder|person|人员|记录人|采集人/i, 'operator'],
  [/breed|品种/i, 'breed'],
  [/trait|性状/i, 'trait']
]

const OPTION_SOURCE_BY_SCOPE = [
  [/medication|treatment|diagnosis|vaccination|deworming|mastitis|lab_test/i, 'disease'],
  [/body_measurement|weighing|milk|dhi|feed/i, 'trait'],
  [/sample|omics|genotyping|sequencing|breeding_value/i, 'trait']
]

const EXACT_OPTION_SOURCE_BY_FIELD = new Map([
  ['bull_number', 'cow'],
  ['donor_number', 'cow'],
  ['father_number', 'cow'],
  ['mother_number', 'cow'],
  ['to_unit_code', 'pen'],
  ['target_unit_code', 'pen'],
  ['breed', 'breed'],
  ['movement_reason', 'transferReason'],
  ['exit_reason', 'transferReason'],
  ['diagnosis_name', 'disease'],
  ['medicine_code', 'medicine'],
  ['medicine_batch_no', 'medicineBatch'],
  ['dose_unit', 'medicineUnit'],
  ['vaccine_name', 'vaccine']
])

function parsePayload(row) {
  if (!row?.payload) return {}
  if (typeof row.payload === 'object') return row.payload
  try {
    return JSON.parse(row.payload)
  } catch {
    return {}
  }
}

function inferOptionSource(payload) {
  if (payload.optionSource) return payload.optionSource
  const type = text(payload.type).toLowerCase()
  if (!['select', 'multi-select', 'radio', 'checkbox'].includes(type)) return ''
  const fieldName = text(payload.fieldName || payload.name)
  if (EXACT_OPTION_SOURCE_BY_FIELD.has(fieldName)) return EXACT_OPTION_SOURCE_BY_FIELD.get(fieldName)
  if (Array.isArray(payload.options) && payload.options.length) return 'static'
  const fieldText = [payload.fieldName, payload.label, payload.name, payload.scope, payload.eventCode]
    .map(text)
    .join(' ')
  for (const [pattern, source] of STATIC_OPTION_SOURCE_BY_FIELD) {
    if (pattern.test(fieldText)) return source
  }
  for (const [pattern, source] of OPTION_SOURCE_BY_SCOPE) {
    if (pattern.test(fieldText)) return source
  }
  return ''
}

function normalizeCustomField(row) {
  const payload = parsePayload(row)
  const scope = text(payload.scope)
  const eventCode = text(payload.eventCode || (scope.startsWith('information-entry:') ? scope.split(':')[1] : ''))
  const next = {
    ...payload,
    scope,
    eventCode: eventCode || payload.eventCode,
    eventGroup: payload.eventGroup || payload.group || '',
    fieldName: text(payload.fieldName || payload.name || row.id),
    label: text(payload.label || payload.name || payload.fieldName || row.id),
    type: text(payload.type || (Array.isArray(payload.options) && payload.options.length ? 'select' : 'text')),
    required: payload.required === true,
    allowCreate: payload.allowCreate === true,
    isActive: payload.isActive !== false,
    sortOrder: Number(payload.sortOrder || 0) || 0,
    updatedAt: text(payload.updatedAt || payload.updated_at || row.updatedAt || row.updated_at)
  }
  const optionSource = inferOptionSource(next)
  if (optionSource) next.optionSource = optionSource
  return next
}

function normalizeCategory(row) {
  const payload = parsePayload(row)
  const scope = text(payload.scope)
  const parentId = text(payload.parentId || payload.parent_id)
  const name = text(payload.name || payload.label || payload.value || row.id)
  return {
    ...payload,
    scope,
    name,
    label: text(payload.label || name),
    value: text(payload.value || payload.code || name),
    code: text(payload.code || payload.value || name),
    level: Number(payload.level || (parentId ? 2 : 1)) || 1,
    parentId,
    parentName: text(payload.parentName || payload.parent_name),
    sortOrder: Number(payload.sortOrder || payload.sort_order || 0) || 0,
    status: text(payload.status || '启用'),
    isActive: payload.isActive !== false,
    updatedAt: text(payload.updatedAt || payload.updated_at || row.updatedAt || row.updated_at)
  }
}

async function updatePayload(connection, table, id, payload) {
  await connection.query(
    `UPDATE \`${table}\`
     SET payload = ?, updated_at = NOW()
     WHERE id = ?`,
    [JSON.stringify(payload), id]
  )
}

async function updateCategoryPayload(connection, id, payload) {
  await connection.query(
    `UPDATE base_info_categories
     SET payload = ?,
         scope = ?,
         code = ?,
         value = ?,
         name = ?,
         label = ?,
         category = ?,
         status = ?,
         is_active = ?,
         sort_order = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [
      JSON.stringify(payload),
      payload.scope || null,
      payload.code || null,
      payload.value || null,
      payload.name || null,
      payload.label || null,
      payload.category || null,
      payload.status || null,
      payload.isActive === false ? 0 : 1,
      Number(payload.sortOrder || 0) || 0,
      id
    ]
  )
}

async function main() {
  const connection = await mysql.createConnection(dbConfig)
  try {
    await connection.query('SET NAMES utf8mb4')
    const [customRows] = await connection.query(`SELECT id, payload, updated_at FROM custom_fields ORDER BY id`)
    const [categoryRows] = await connection.query(`SELECT id, payload, updated_at FROM base_info_categories ORDER BY id`)

    const customUpdates = []
    for (const row of customRows) {
      const before = parsePayload(row)
      const after = normalizeCustomField(row)
      const needsUpdate =
        JSON.stringify(before) !== JSON.stringify(after) ||
        !before.scope ||
        !before.fieldName ||
        !before.label ||
        !before.type ||
        (['select', 'multi-select', 'radio', 'checkbox'].includes(text(after.type).toLowerCase()) && !before.optionSource && after.optionSource)
      if (needsUpdate) customUpdates.push({ id: row.id, before, after })
    }

    const categoryUpdates = []
    for (const row of categoryRows) {
      const before = parsePayload(row)
      const after = normalizeCategory(row)
      const needsUpdate =
        JSON.stringify(before) !== JSON.stringify(after) ||
        before.level === undefined ||
        before.parentId === undefined ||
        before.status === undefined ||
        before.isActive === undefined
      if (needsUpdate) categoryUpdates.push({ id: row.id, before, after })
    }

    if (apply) {
      await connection.beginTransaction()
      for (const item of customUpdates) await updatePayload(connection, 'custom_fields', item.id, { ...item.after, updatedAt: nowIso() })
      for (const item of categoryUpdates) await updateCategoryPayload(connection, item.id, { ...item.after, updatedAt: nowIso() })
      await connection.commit()
    }

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      customFieldRows: customRows.length,
      categoryRows: categoryRows.length,
      customUpdates: customUpdates.length,
      categoryUpdates: categoryUpdates.length,
      missingOptionSourceAfter: customUpdates
        .map((item) => item.after)
        .filter((item) => ['select', 'multi-select', 'radio', 'checkbox'].includes(text(item.type).toLowerCase()) && !item.optionSource).length,
      sampleCustomUpdates: customUpdates.slice(0, 8).map((item) => ({
        id: item.id,
        fieldName: item.after.fieldName,
        scope: item.after.scope,
        type: item.after.type,
        optionSource: item.after.optionSource || ''
      })),
      sampleCategoryUpdates: categoryUpdates.slice(0, 8).map((item) => ({
        id: item.id,
        scope: item.after.scope,
        name: item.after.name,
        level: item.after.level,
        parentId: item.after.parentId || ''
      }))
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
