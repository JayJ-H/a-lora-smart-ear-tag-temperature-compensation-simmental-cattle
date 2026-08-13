import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'

export const DEFAULT_MILK_SHIFT_VALUES = ['早班', '中班', '晚班', '夜班', '半夜班', '1', '2', '3', '4']

const INFORMATION_ENTRY_OPTION_SEEDS = {
  'information-entry:severity': ['正常', '提示', '关注', '严重'],
  'information-entry:event-status': ['已记录', '待复核', '已确认'],
  'milk:shifts': DEFAULT_MILK_SHIFT_VALUES
}

const REQUIRED_TRANSFER_REASONS = [
  ['购入入群', '生产管理', '低频'],
  ['转入入群', '生产管理', '低频'],
  ['胚胎移植入群', '生产管理', '低频'],
  ['断奶转群', '生产管理', '高频'],
  ['妊娠转群', '生产管理', '中频'],
  ['疾病隔离', '健康管理', '中频'],
  ['淘汰离群', '其他', '低频'],
  ['出售离群', '其他', '低频'],
  ['死亡离群', '健康管理', '低频'],
  ['转场离群', '其他', '临时']
]

const REQUIRED_BREEDS = [
  ['摩拉水牛', '乳用', '引进'],
  ['尼里-拉菲水牛', '乳用', '引进'],
  ['本地水牛', '兼用', '本地'],
  ['广西水牛', '乳用', '广西']
]

const MEDICINE_ROUTE_OPTIONS = ['肌肉注射', '皮下注射', '口服', '外用', '静脉注射']

export function text(value) {
  return String(value ?? '').trim()
}

export function normalizeOptionText(value) {
  return text(value).toLowerCase().replace(/[\s_-]+/g, '')
}

export function readEnvFiles(projectRoot) {
  const merged = {}
  for (const file of [path.join(projectRoot, '.env'), path.join(projectRoot, '运维/生产配置/.env.prod')]) {
    if (!fs.existsSync(file)) continue
    const content = fs.readFileSync(file, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match) continue
      const [, key, rawValue] = match
      merged[key] = rawValue.replace(/^['"]|['"]$/g, '').trim()
    }
  }
  return { ...merged, ...process.env }
}

export function mysqlConfigFromEnv(projectRoot) {
  const env = readEnvFiles(projectRoot)
  return {
    host: env.MYSQL_AUDIT_HOST || env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_AUDIT_PORT || env.MYSQL_HOST_PORT || env.MYSQL_PORT || 9193),
    user: env.MYSQL_AUDIT_USER || env.MYSQL_USER || 'cattle_user',
    password: env.MYSQL_AUDIT_PASSWORD || env.MYSQL_PASSWORD || '',
    database: env.MYSQL_AUDIT_DATABASE || env.MYSQL_DATABASE || 'cattle_management'
  }
}

export async function loadDbDictionaries(projectRoot) {
  const pool = mysql.createPool(mysqlConfigFromEnv(projectRoot))
  try {
    await pool.query('SELECT 1')
    const [persons, farmUnits, pens, breeds, transferReasons, diseases, medicines, medicineRows, medicineBatches, traitRows, v2TraitRows, baseInfoRows] =
      await Promise.all([
        queryAll(pool, 'persons'),
        queryAll(pool, 'farm_unit'),
        queryAll(pool, 'pens'),
        queryAll(pool, 'breed_types'),
        queryAll(pool, 'transfer_reasons'),
        queryAll(pool, 'diseases'),
        queryAll(pool, 'medicines'),
        queryAll(pool, 'medicine'),
        queryAll(pool, 'medicine_batch'),
        queryAll(pool, 'phenotype_trait_definitions'),
        queryAll(pool, 'trait_definition'),
        queryAll(pool, 'base_info_categories')
      ])
    return {
      persons,
      farmUnits,
      pens,
      breeds,
      transferReasons,
      diseases,
      medicines,
      medicineRows,
      medicineBatches,
      traitRows,
      v2TraitRows,
      baseInfoRows
    }
  } finally {
    await pool.end()
  }
}

async function queryAll(pool, tableName) {
  try {
    const [columns] = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ?
      `,
      [tableName]
    )
    if (!columns.length) return []
    const names = new Set(columns.map((row) => row.column_name || row.COLUMN_NAME).filter(Boolean))
    const order = names.has('created_at') ? 'created_at DESC' : names.has('id') ? 'id DESC' : names.values().next().value
    const [rows] = await pool.query(`SELECT * FROM \`${tableName}\` ORDER BY ${order}`)
    return rows
  } catch {
    return []
  }
}

export function buildTemplateValueOptions(template, db) {
  const sourceOptions = loadImportDictionarySources(template, db)
  return template.columns.flatMap((column) => {
    if (column.type !== 'select') return []
    const source = column.optionSource || 'static'
    const dynamicOptions = sourceOptions[source] || []
    const staticOptions = (column.options || []).map((value) => ({ label: String(value), value: String(value), name: String(value) }))
    const merged = uniqueOptions([...dynamicOptions, ...staticOptions])
    return merged.map((option, index) => ({
      fieldKey: column.key,
      fieldLabel: column.label,
      targetField: column.targetField,
      fieldSection: column.section || '',
      source,
      number: String(index + 1),
      value: text(option.value),
      label: text(option.label || option.name || option.value),
      aliases: optionAliases(option),
      description: text(option.meta?.description)
    }))
  })
}

function loadImportDictionarySources(template, db) {
  const sources = new Set(template.columns.map((column) => column.optionSource).filter(Boolean))
  const result = {}
  const baseRows = ensureInformationEntryOptionDictionaries(db.baseInfoRows || [])

  if (sources.has('operator')) result.operator = buildOperatorOptions(db.persons || [])
  if (sources.has('pen')) result.pen = buildPenOptions(db.pens || [], db.farmUnits || [])
  if (sources.has('breed')) result.breed = buildBreedOptions(ensureBreedDictionary(db.breeds || []))
  if (sources.has('transferReason')) result.transferReason = buildTransferReasonOptions(ensureTransferReasonDictionary(db.transferReasons || []))
  if (sources.has('disease')) result.disease = buildDiseaseOptions(db.diseases || [])
  if (sources.has('medicine')) result.medicine = buildMedicineOptions(db.medicines || [], db.medicineRows || [])
  if (sources.has('medicineBatch')) result.medicineBatch = buildMedicineBatchOptions(db.medicineBatches || [])
  if (sources.has('medicineUnit')) result.medicineUnit = buildMedicineUnitOptions(db.medicines || [], db.medicineRows || [])
  if (sources.has('vaccine')) result.vaccine = buildVaccineOptions(db.medicines || [], db.medicineRows || [])
  if (sources.has('trait')) result.trait = buildTraitOptions(db.traitRows || [], db.v2TraitRows || [])
  if (sources.has('event')) result.event = buildEventOptions(baseRows)
  if (sources.has('severity')) result.severity = baseInfoOptions(baseRows, 'information-entry:severity')
  if (sources.has('eventStatus')) result.eventStatus = baseInfoOptions(baseRows, 'information-entry:event-status')
  if (sources.has('milkShift')) {
    const rows = baseInfoOptions(baseRows, 'milk:shifts')
    result.milkShift = rows.length ? rows : toSelectOptions(DEFAULT_MILK_SHIFT_VALUES)
  }
  if (sources.has('medicineRoute')) result.medicineRoute = toSelectOptions(MEDICINE_ROUTE_OPTIONS)
  return result
}

function buildOperatorOptions(rows) {
  return uniqueOptions(
    (rows || []).map((row) => {
      const status = text(row.status)
      if (status && !isEnabledStatus(status)) return null
      const name = text(row.name || row.realName || row.real_name || row.nickname || row.username)
      const role = text(row.role || row.department)
      const id = text(row.id || row.personId || row.person_id || row.username || name)
      return name
        ? {
            label: role ? `${name} / ${role}` : name,
            value: name,
            name,
            meta: { id, aliases: [id, row.username, row.realName, row.real_name].map(text) }
          }
        : null
    })
  )
}

function buildPenOptions(penRows, farmUnits) {
  const penLookup = new Map()
  ;(penRows || []).forEach((row) => {
    penIdentityKeys(row).forEach((key) => {
      if (key && !penLookup.has(key)) penLookup.set(key, row)
    })
  })
  const farmUnitKeys = new Set((farmUnits || []).flatMap((row) => penIdentityKeys(row)))
  const unitOptions = (farmUnits || []).map((row) => {
    const status = text(row.status)
    if (status && !isEnabledStatus(status)) return null
    const value = canonicalFarmUnitValue(row)
    if (!value) return null
    const matchedPen = penIdentityKeys(row).map((key) => penLookup.get(key)).find(Boolean)
    const name = text(row.name || row.unitName || row.unit_name || matchedPen?.name || matchedPen?.penName || row.code || value)
    const category = text(row.category || row.categoryName || row.type || row.unitType || row.unit_type || matchedPen?.category || matchedPen?.type)
    return {
      label: category ? `${name} / ${category}` : name,
      value,
      name,
      meta: { aliases: penIdentityKeys(row) }
    }
  })
  const penOnlyOptions = (penRows || []).map((row) => {
    const status = text(row.status)
    if (status && !isEnabledStatus(status)) return null
    if (penIdentityKeys(row).some((key) => farmUnitKeys.has(key))) return null
    const value = canonicalFarmUnitValue(row)
    if (!value) return null
    const name = text(row.name || row.penName || row.pen_name || row.code || value)
    const category = text(row.category || row.categoryName || row.category_name || row.type || row.unitType || row.unit_type)
    return {
      label: category ? `${name} / ${category}` : name,
      value,
      name,
      meta: { aliases: penIdentityKeys(row) }
    }
  })
  return uniqueOptions([...unitOptions, ...penOnlyOptions])
}

function buildBreedOptions(rows) {
  return uniqueOptions(
    (rows || []).map((row) => {
      const status = text(row.status)
      const active = row.isActive ?? row.is_active
      if (status && !isEnabledStatus(status)) return null
      if (!status && active !== undefined && active !== null && ['0', 'false', '停用', '禁用'].includes(text(active).toLowerCase())) return null
      const value = text(row.name || row.breedName || row.breed_name || row.code || row.id)
      const category = text(row.category || row.origin)
      return value ? { label: category ? `${value} / ${category}` : value, value, name: value } : null
    })
  )
}

function buildTransferReasonOptions(rows) {
  return uniqueOptions((rows || []).map((row) => normalizeTransferReasonOption(row)))
}

function buildDiseaseOptions(rows) {
  return uniqueOptions(
    (rows || []).map((row) => {
      const status = text(row.status)
      if (status && !isEnabledStatus(status)) return null
      const name = text(row.name || row.diseaseName || row.disease_name || row.diagnosis)
      const category = text(row.category || row.categoryName || row.type || row.diseaseType)
      return name ? { label: category ? `${name} / ${category}` : name, value: name, name } : null
    })
  )
}

function buildMedicineOptions(medicines, medicineRows) {
  return uniqueOptions(
    [...(medicines || []), ...(medicineRows || [])].map((row) => {
      const status = text(row.status)
      if (status && !isEnabledStatus(status)) return null
      const value = text(row.code || row.medicineCode || row.medicine_code || row.name || row.id)
      const name = text(row.name || row.medicineName || row.medicine_name || row.code || row.id)
      const category = text(row.category || row.categoryName || row.type || row.medicineType)
      return value
        ? {
            label: category ? `${name} / ${category}` : name,
            value,
            name,
            meta: { aliases: [name, row.id, row.medicineCode, row.medicine_code].map(text) }
          }
        : null
    })
  )
}

function buildMedicineBatchOptions(rows) {
  return uniqueOptions(
    (rows || []).map((row) => {
      const value = text(row.batchNo || row.batch_no || row.batchCode || row.batch_code || row.code || row.id)
      const name = text(row.name || row.batchName || row.batch_name || value)
      const medicine = text(row.medicineName || row.medicine_name || row.medicineCode || row.medicine_code)
      return value
        ? {
            label: medicine ? `${name} / ${medicine}` : name,
            value,
            name,
            meta: { aliases: [name, row.id, row.batchNo, row.batch_no].map(text) }
          }
        : null
    })
  )
}

function buildMedicineUnitOptions(medicines, medicineRows) {
  return uniqueOptions(
    [...(medicines || []), ...(medicineRows || [])].map((row) => {
      const status = text(row.status)
      if (status && !isEnabledStatus(status)) return null
      const value = text(row.unit || row.doseUnit || row.dose_unit)
      return value ? { label: value, value, name: value } : null
    })
  )
}

function buildVaccineOptions(medicines, medicineRows) {
  return uniqueOptions(
    [...(medicines || []), ...(medicineRows || [])].map((row) => {
      const status = text(row.status)
      if (status && !isEnabledStatus(status)) return null
      const category = text(row.category || row.categoryName || row.type || row.medicineType)
      if (category && !category.includes('疫苗')) return null
      const value = text(row.code || row.medicineCode || row.medicine_code || row.name || row.id)
      const name = text(row.name || row.medicineName || row.medicine_name || row.code || row.id)
      return value ? { label: category ? `${name} / ${category}` : name, value, name } : null
    })
  )
}

function buildTraitOptions(rows, v2Rows) {
  return uniqueOptions(
    [...(rows || []), ...(v2Rows || [])].map((row) => {
      const status = text(row.status)
      if (status && !isEnabledStatus(status)) return null
      const value = text(row.code || row.traitCode || row.trait_code || row.id)
      const name = text(row.name || row.traitName || row.trait_name || value)
      const category = text(row.category || row.categoryName || row.group || row.type)
      return value
        ? {
            label: category ? `${name} / ${category}` : name,
            value,
            name,
            meta: { aliases: [name, row.id].map(text) }
          }
        : null
    })
  )
}

function buildEventOptions(baseRows) {
  return uniqueOptions(
    (baseRows || [])
      .map(normalizeBaseInfoCategoryRow)
      .filter((row) => row.scope === 'information-entry-events')
      .filter((row) => row.parentId || row.parent_id || !row.isGroupParent)
      .sort((left, right) => (Number(left.sortOrder || left.sort_order || 0) || 999) - (Number(right.sortOrder || right.sort_order || 0) || 999))
      .map((row) => {
        const status = normalizeDictionaryStatus(row.status ?? row.state, row.isActive ?? row.is_active)
        if (!isEnabledStatus(status)) return null
        const code = text(row.code || row.value || row.eventType || row.event_type)
        const label = text(row.name || row.label || row.title || code)
        const group = text(row.group || row.category || row.categoryName || row.category_name)
        return code && label ? { label: group ? `${label} / ${group}` : label, value: code, name: label } : null
      })
  )
}

function baseInfoOptions(categoryRows, scope) {
  return uniqueOptions(
    (categoryRows || [])
      .map(normalizeBaseInfoCategoryRow)
      .filter((row) => row.scope === scope)
      .sort((left, right) => (Number(left.sortOrder || left.sort_order || 0) || 0) - (Number(right.sortOrder || right.sort_order || 0) || 0))
      .map((row) => {
        const status = normalizeDictionaryStatus(row.status ?? row.state, row.isActive ?? row.is_active)
        if (!isEnabledStatus(status)) return null
        const value = text(row.value || row.code || row.name || row.label)
        const label = text(row.label || row.name || row.value || row.code)
        return value ? { label: label || value, value, name: label || value } : null
      })
  )
}

function ensureInformationEntryOptionDictionaries(rows) {
  const normalized = [...(rows || [])].map(normalizeBaseInfoCategoryRow)
  const existingKeys = new Set(
    normalized.map((row) => `${text(row.scope)}:${text(row.code || row.value || row.name || row.label)}`)
  )
  const seedRows = Object.entries(INFORMATION_ENTRY_OPTION_SEEDS).flatMap(([scope, values]) =>
    values
      .filter((value) => !existingKeys.has(`${scope}:${value}`))
      .map((value, index) => ({
        id: `${scope}-${index + 1}`,
        scope,
        code: value,
        value,
        name: value,
        label: value,
        category: '信息录入',
        sortOrder: index + 1,
        sort_order: index + 1,
        status: '启用',
        isActive: true,
        is_active: 1
      }))
  )
  return [...normalized, ...seedRows]
}

function ensureBreedDictionary(rows) {
  const existing = new Set((rows || []).map((row) => text(row.name || row.breedName || row.breed_name || row.code)).filter(Boolean))
  const seedRows = REQUIRED_BREEDS.filter(([value]) => !existing.has(value)).map(([name, category, origin], index) => ({
    id: `seed-breed-${index + 1}`,
    name,
    category,
    origin,
    status: '启用',
    is_active: 1
  }))
  return [...(rows || []), ...seedRows]
}

function ensureTransferReasonDictionary(rows) {
  const existing = new Set((rows || []).map((row) => text(row.name || row.reason || row.reasonName || row.reason_name || row.value)).filter(Boolean))
  const seedRows = REQUIRED_TRANSFER_REASONS.filter(([name]) => !existing.has(name)).map(([name, category, frequency], index) => ({
    id: `seed-transfer-reason-${index + 1}`,
    name,
    reason: name,
    category,
    frequency,
    status: '启用',
    is_active: 1
  }))
  return [...(rows || []), ...seedRows]
}

function normalizeTransferReasonOption(row) {
  const name = text(row.name || row.reason || row.reasonName || row.reason_name || row.title || row.label)
  if (!name) return null
  const category = inferTransferReasonCategory(row)
  const frequency = inferTransferReasonFrequency(row, category)
  const status = normalizeDictionaryStatus(row.status ?? row.state, row.isActive ?? row.is_active)
  if (!isEnabledStatus(status)) return null
  return {
    label: [name, category, frequency].filter(Boolean).join(' / '),
    value: name,
    name,
    meta: {
      category,
      frequency,
      status,
      id: text(row.id),
      description: text(row.description || row.remark || row.notes)
    }
  }
}

function inferTransferReasonCategory(row) {
  const explicit = text(row.category || row.categoryName || row.category_name || row.reasonType || row.reason_type || row.type)
  const fullText = [explicit, row.name, row.reason, row.reasonName, row.reason_name, row.description, row.remark, row.notes].map(text).join(' ')
  if (/疾病|隔离|治疗|疫苗|康复|防疫|检疫|乳房炎|蹄|伤|死亡|病/.test(fullText)) return '健康管理'
  if (/出生|购入|入群|转入|新购|引种|泌乳|干奶|妊娠|配种|分娩|产犊|断奶|阶段|品种|繁殖|生产|犊牛|育成|公牛|待产/.test(fullText)) return '生产管理'
  if (/饲|料|日粮|营养|体况|采食|膘情|育肥/.test(fullText)) return '饲养管理'
  if (['生产管理', '健康管理', '饲养管理', '其他'].includes(explicit)) return explicit
  return '其他'
}

function inferTransferReasonFrequency(row, category) {
  const explicit = text(row.frequency || row.usageFrequency || row.usage_frequency || row.useFrequency || row.use_frequency)
  if (['高频', '中频', '低频', '临时'].includes(explicit)) return explicit
  const fullText = [row.name, row.reason, row.description, category].map(text).join(' ')
  if (/管理调整|临时/.test(fullText)) return '临时'
  if (/维修|场地|出售|淘汰|死亡|临时|管理调整/.test(fullText)) return '低频'
  if (/泌乳|断奶|出生|入群|阶段/.test(fullText)) return '高频'
  if (/疾病|隔离|康复|干奶|疫苗|品种|饲|分娩|妊娠|配种|体重|转群/.test(fullText)) return '中频'
  return '中频'
}

function normalizeBaseInfoCategoryRow(row) {
  const payload = parsePayload(row?.payload)
  const normalized = { ...payload, ...(row || {}) }
  const parentId = firstText(row?.parentId, row?.parent_id, payload.parentId, payload.parent_id)
  const name = firstText(row?.name, payload.name, row?.label, payload.label, row?.value, payload.value, row?.code, payload.code)
  const code = firstText(row?.code, payload.code, row?.value, payload.value, name)
  const label = firstText(row?.label, payload.label, row?.name, payload.name, name, code)
  return {
    ...normalized,
    scope: firstText(row?.scope, payload.scope),
    code,
    value: firstText(row?.value, payload.value, code, name),
    name,
    label,
    group: firstText(row?.group, payload.group, row?.category, payload.category),
    category: firstText(row?.category, payload.category, row?.group, payload.group),
    status: firstText(row?.status, payload.status, row?.state, payload.state),
    isActive: row?.isActive ?? row?.is_active ?? payload.isActive ?? payload.is_active,
    is_active: row?.is_active ?? row?.isActive ?? payload.is_active ?? payload.isActive,
    sortOrder: Number(row?.sortOrder ?? row?.sort_order ?? payload.sortOrder ?? payload.sort_order ?? 0) || 0,
    sort_order: Number(row?.sort_order ?? row?.sortOrder ?? payload.sort_order ?? payload.sortOrder ?? 0) || 0,
    parentId,
    parent_id: firstText(row?.parent_id, row?.parentId, payload.parent_id, payload.parentId),
    parentName: firstText(row?.parentName, row?.parent_name, payload.parentName, payload.parent_name),
    parent_name: firstText(row?.parent_name, row?.parentName, payload.parent_name, payload.parentName),
    isGroupParent: row?.isGroupParent ?? row?.is_group_parent ?? payload.isGroupParent ?? payload.is_group_parent
  }
}

function parsePayload(value) {
  if (!value) return {}
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return {}
  }
}

function normalizeDictionaryStatus(statusValue, activeValue) {
  const status = text(statusValue)
  if (status) {
    if (/^(停用|禁用|inactive|disabled)$/i.test(status)) return '停用'
    return '启用'
  }
  if (activeValue !== undefined && activeValue !== null && activeValue !== '') {
    return ['false', '0', '停用', '禁用', 'inactive', 'disabled'].includes(String(activeValue).trim().toLowerCase()) ? '停用' : '启用'
  }
  return '启用'
}

function isEnabledStatus(status) {
  const normalized = text(status).toLowerCase()
  return ['在职', 'active', '启用', '正常', 'enabled'].some((item) => normalized === item.toLowerCase())
}

function canonicalFarmUnitValue(row) {
  return text(row.id || row.unitId || row.unit_id || row.code || row.unitCode || row.unit_code || row.penCode || row.pen_code || row.name || row.penName || row.pen_name)
}

function penIdentityKeys(row) {
  if (!row) return []
  return [
    row.id,
    row.unitId,
    row.unit_id,
    row.code,
    row.unitCode,
    row.unit_code,
    row.penCode,
    row.pen_code,
    row.name,
    row.penName,
    row.pen_name,
    row.unitName,
    row.unit_name,
    row.locationLabel,
    row.location_label
  ].map(text).filter(Boolean)
}

function optionAliases(option) {
  const metaAliases = Array.isArray(option.meta?.aliases) ? option.meta.aliases.map(text).filter(Boolean) : []
  return uniqueText([option.value, option.label, option.name, ...metaAliases])
}

function firstText(...values) {
  return values.map(text).find(Boolean) || ''
}

function toSelectOptions(values) {
  return values.map((value) => ({ label: value, value, name: value }))
}

function uniqueOptions(items) {
  const map = new Map()
  ;(items || []).forEach((item) => {
    if (!item?.value || map.has(item.value)) return
    map.set(item.value, item)
  })
  return Array.from(map.values())
}

function uniqueText(values) {
  return Array.from(new Set(values.map(text).filter(Boolean)))
}

export function codebookFor(options) {
  const byField = new Map()
  for (const option of options) {
    const keys = [`target:${option.targetField}`, `key:${option.fieldKey}`, `label:${option.fieldLabel}`]
    for (const key of keys) {
      if (!byField.has(key)) byField.set(key, [])
      byField.get(key).push(option)
    }
  }
  return { options, byField }
}

export function optionsFor(codebook, identity) {
  return codebook.byField.get(`target:${identity}`) || codebook.byField.get(`key:${identity}`) || codebook.byField.get(`label:${identity}`) || []
}

export function numberFor(codebook, identity, value) {
  const raw = text(value)
  if (!raw) return ''
  const normalized = normalizeOptionText(raw)
  const hit = optionsFor(codebook, identity).find((option) =>
    [option.value, option.label, ...(option.aliases || [])].some((candidate) => normalizeOptionText(candidate) === normalized)
  )
  return hit?.number || ''
}

export function valueForNumber(codebook, identity, number) {
  return optionsFor(codebook, identity).find((option) => option.number === String(number))?.value || ''
}

export function unresolvedSelectValue(issues, templateCode, fieldLabel, rawValue, rowKey) {
  const raw = text(rawValue)
  if (!raw) return ''
  issues.push({ templateCode, fieldLabel, rawValue: raw, rowKey: text(rowKey) })
  return ''
}

