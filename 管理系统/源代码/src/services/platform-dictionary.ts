import * as databaseService from '@/services/database'
import { EVENT_OPTIONS } from '@/services/import-templates'
import type { CustomField } from '@/utils/flexible-export'
import { SUPPORTED_CATTLE_BREEDS, normalizeCattleBreed } from '@/utils/cattle-breeds'

export interface SelectOption {
  label: string
  value: string
  name?: string
  meta?: Record<string, unknown>
}

export interface InformationEntryEventOption {
  group: string
  code: string
  label: string
  sortOrder?: number
  status?: string
}

export const INFORMATION_ENTRY_EVENT_SCOPE = 'information-entry-events'
export const INFORMATION_ENTRY_SEVERITY_SCOPE = 'information-entry:severity'
export const INFORMATION_ENTRY_STATUS_SCOPE = 'information-entry:event-status'
export const INFORMATION_ENTRY_CALF_SEX_SCOPE = 'information-entry:calf-sex'
export const MILK_SHIFT_SCOPE = 'milk:shifts'

export const DEFAULT_MILK_SHIFT_VALUES = [
  '早班',
  '中班',
  '晚班',
  '夜班',
  '半夜班',
  '1',
  '2',
  '3',
  '4'
]

export const INFORMATION_ENTRY_OPTION_SEEDS: Record<string, string[]> = {
  [INFORMATION_ENTRY_SEVERITY_SCOPE]: ['正常', '提示', '关注', '严重'],
  [INFORMATION_ENTRY_STATUS_SCOPE]: ['已记录', '待复核', '已确认'],
  [INFORMATION_ENTRY_CALF_SEX_SCOPE]: ['母', '公'],
  [MILK_SHIFT_SCOPE]: DEFAULT_MILK_SHIFT_VALUES
}

export const INFORMATION_ENTRY_OPTION_SOURCE_OPTIONS = [
  { label: '牛只字典', value: 'cow' },
  { label: '圈舍字典', value: 'pen' },
  { label: '品种字典', value: 'breed' },
  { label: '药品字典', value: 'medicine' },
  { label: '药品批号', value: 'medicineBatch' },
  { label: '转群/入群/离群原因', value: 'transferReason' },
  { label: '疾病字典', value: 'disease' },
  { label: '剂量单位', value: 'medicineUnit' },
  { label: '疫苗字典', value: 'vaccine' },
  { label: '人员字典', value: 'operator' },
  { label: '性状词典', value: 'trait' }
] as const

export const REQUIRED_TRANSFER_REASONS: Record<string, SelectOption[]> = {
  entry: [
    {
      label: '购入入群 / 生产管理 / 低频',
      value: '购入入群',
      name: '购入入群',
      meta: { category: '生产管理', frequency: '低频', status: '启用' }
    },
    {
      label: '转入入群 / 生产管理 / 低频',
      value: '转入入群',
      name: '转入入群',
      meta: { category: '生产管理', frequency: '低频', status: '启用' }
    },
    {
      label: '胚胎移植入群 / 生产管理 / 低频',
      value: '胚胎移植入群',
      name: '胚胎移植入群',
      meta: { category: '生产管理', frequency: '低频', status: '启用' }
    }
  ],
  transfer: [
    {
      label: '断奶转群 / 生产管理 / 高频',
      value: '断奶转群',
      name: '断奶转群',
      meta: { category: '生产管理', frequency: '高频', status: '启用' }
    },
    {
      label: '妊娠转群 / 生产管理 / 中频',
      value: '妊娠转群',
      name: '妊娠转群',
      meta: { category: '生产管理', frequency: '中频', status: '启用' }
    },
    {
      label: '疾病隔离 / 健康管理 / 中频',
      value: '疾病隔离',
      name: '疾病隔离',
      meta: { category: '健康管理', frequency: '中频', status: '启用' }
    }
  ],
  exit: [
    {
      label: '淘汰离群 / 其他 / 低频',
      value: '淘汰离群',
      name: '淘汰离群',
      meta: { category: '其他', frequency: '低频', status: '启用' }
    },
    {
      label: '出售离群 / 其他 / 低频',
      value: '出售离群',
      name: '出售离群',
      meta: { category: '其他', frequency: '低频', status: '启用' }
    },
    {
      label: '死亡离群 / 健康管理 / 低频',
      value: '死亡离群',
      name: '死亡离群',
      meta: { category: '健康管理', frequency: '低频', status: '启用' }
    },
    {
      label: '转场离群 / 其他 / 临时',
      value: '转场离群',
      name: '转场离群',
      meta: { category: '其他', frequency: '临时', status: '启用' }
    }
  ]
}

export function entryFieldScope(eventType: string) {
  return `information-entry:${textValue(eventType) || 'general'}`
}

export function dictionaryRowId(prefix: string, value: string, index: number) {
  const safe = `${prefix}-${value}`.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe ? `${safe}-${index + 1}` : `${prefix}-${index + 1}`
}

export function textValue(value: unknown) {
  return String(value ?? '').trim()
}

function firstTextValue(...values: unknown[]) {
  return values.map(textValue).find(Boolean) || ''
}

function parseRowPayload(row: any): Record<string, any> {
  if (!row?.payload) return {}
  if (typeof row.payload === 'object') return row.payload
  try {
    return JSON.parse(row.payload)
  } catch {
    return {}
  }
}

export function normalizeBaseInfoCategoryRow(row: any): Record<string, any> {
  const payload = parseRowPayload(row)
  const normalized = { ...payload, ...(row || {}) }
  const parentId = firstTextValue(
    row?.parentId,
    row?.parent_id,
    payload.parentId,
    payload.parent_id
  )
  const name = firstTextValue(
    row?.name,
    payload.name,
    row?.label,
    payload.label,
    row?.value,
    payload.value,
    row?.code,
    payload.code
  )
  const code = firstTextValue(row?.code, payload.code, row?.value, payload.value, name)
  const label = firstTextValue(row?.label, payload.label, row?.name, payload.name, name, code)

  return {
    ...normalized,
    scope: firstTextValue(row?.scope, payload.scope),
    code,
    value: firstTextValue(row?.value, payload.value, code, name),
    name,
    label,
    group: firstTextValue(row?.group, payload.group, row?.category, payload.category),
    category: firstTextValue(row?.category, payload.category, row?.group, payload.group),
    status: firstTextValue(row?.status, payload.status, row?.state, payload.state),
    isActive: row?.isActive ?? row?.is_active ?? payload.isActive ?? payload.is_active,
    is_active: row?.is_active ?? row?.isActive ?? payload.is_active ?? payload.isActive,
    sortOrder:
      Number(row?.sortOrder ?? row?.sort_order ?? payload.sortOrder ?? payload.sort_order ?? 0) ||
      0,
    sort_order:
      Number(row?.sort_order ?? row?.sortOrder ?? payload.sort_order ?? payload.sortOrder ?? 0) ||
      0,
    parentId,
    parent_id: firstTextValue(row?.parent_id, row?.parentId, payload.parent_id, payload.parentId),
    parentName: firstTextValue(
      row?.parentName,
      row?.parent_name,
      payload.parentName,
      payload.parent_name
    ),
    parent_name: firstTextValue(
      row?.parent_name,
      row?.parentName,
      payload.parent_name,
      payload.parentName
    ),
    level: Number(row?.level ?? payload.level ?? (parentId ? 2 : 1)) || (parentId ? 2 : 1)
  }
}

export function normalizeDictionaryStatus(statusValue: unknown, activeValue?: unknown) {
  const status = textValue(statusValue)
  if (status) {
    if (/^(停用|禁用|inactive|disabled)$/i.test(status)) return '停用'
    return '启用'
  }
  if (activeValue !== undefined && activeValue !== null && activeValue !== '') {
    return ['false', '0', '停用', '禁用', 'inactive', 'disabled'].includes(
      String(activeValue).trim().toLowerCase()
    )
      ? '停用'
      : '启用'
  }
  return '启用'
}

export function isEnabledStatus(status: string) {
  const normalized = textValue(status).toLowerCase()
  return ['在职', 'active', '启用', '正常', 'enabled'].some(
    (item) => normalized === item.toLowerCase()
  )
}

export function uniqueOptions(items: Array<SelectOption | null | undefined>): SelectOption[] {
  const map = new Map<string, SelectOption>()
  items.forEach((item) => {
    if (!item?.value || map.has(item.value)) return
    map.set(item.value, item)
  })
  return Array.from(map.values())
}

export function baseInfoOptions(categoryRows: any[], scope: string) {
  return uniqueOptions(
    (categoryRows || [])
      .map(normalizeBaseInfoCategoryRow)
      .filter((row) => row.scope === scope)
      .sort(
        (left, right) =>
          (Number(left.sortOrder || left.sort_order || 0) || 0) -
          (Number(right.sortOrder || right.sort_order || 0) || 0)
      )
      .map((row) => {
        const status = normalizeDictionaryStatus(
          row.status ?? row.state,
          row.isActive ?? row.is_active
        )
        if (!isEnabledStatus(status)) return null
        const value = textValue(row.value || row.code || row.name || row.label)
        const label = textValue(row.label || row.name || row.value || row.code)
        return value ? { label: label || value, value, name: label || value } : null
      })
  )
}

export async function ensureInformationEntryOptionDictionaries(categoryRows: any[]) {
  const rows = [...(categoryRows || [])].map(normalizeBaseInfoCategoryRow)
  const existingKeys = new Set(
    rows.map((row) => {
      const scope = textValue(row.scope)
      const value = textValue(row.code || row.value || row.name || row.label)
      return `${scope}:${value}`
    })
  )
  const seedRows: any[] = []
  Object.entries(INFORMATION_ENTRY_OPTION_SEEDS).forEach(([scope, values]) => {
    values.forEach((value, index) => {
      const key = `${scope}:${value}`
      if (existingKeys.has(key)) return
      seedRows.push({
        id: dictionaryRowId(scope, value, index),
        scope,
        code: value,
        value,
        name: value,
        label: value,
        category: '信息录入',
        sortOrder: index + 1,
        status: '启用',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    })
  })
  if (seedRows.length) {
    await databaseService.addTableDataAsync('base-info-categories', seedRows)
    return databaseService
      .getTableDataAsync('base-info-categories', { silent: true })
      .catch(() => [...rows, ...seedRows])
  }
  return rows
}

export async function getMilkShiftOptions() {
  const baseRows = await databaseService
    .getTableDataAsync('base-info-categories', { silent: true })
    .catch(() => [])
  const rows = await ensureInformationEntryOptionDictionaries(baseRows || [])
  const options = baseInfoOptions(rows || [], MILK_SHIFT_SCOPE)
  return options.length ? options : toSelectOptions(DEFAULT_MILK_SHIFT_VALUES)
}

export function toSelectOptions(values: string[]): SelectOption[] {
  return values.map((value) => ({ label: value, value, name: value }))
}

export async function ensureInformationEntryEventDictionary(categoryRows: any[]) {
  const scoped = (categoryRows || [])
    .map(normalizeBaseInfoCategoryRow)
    .filter((row) => row.scope === INFORMATION_ENTRY_EVENT_SCOPE)
  const existingCodes = new Set(
    scoped
      .map((row) => textValue(row.code || row.value || row.eventType || row.event_type))
      .filter(Boolean)
  )
  const missing = EVENT_OPTIONS.filter((event) => !existingCodes.has(event.code)).map(
    (event, index) => ({
      id: `${INFORMATION_ENTRY_EVENT_SCOPE}-${event.code}`,
      scope: INFORMATION_ENTRY_EVENT_SCOPE,
      code: event.code,
      value: event.code,
      name: event.label,
      label: event.label,
      group: event.group,
      category: event.group,
      sortOrder: index + 1,
      status: '启用',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  )
  let rows = scoped
  if (missing.length) {
    await databaseService.addTableDataAsync('base-info-categories', missing)
    rows = (
      await databaseService
        .getTableDataAsync('base-info-categories', { silent: true })
        .catch(() => categoryRows)
    )
      .map(normalizeBaseInfoCategoryRow)
      .filter((row: any) => row.scope === INFORMATION_ENTRY_EVENT_SCOPE)
  }
  const normalized = rows
    .map((row: any) => ({
      code: textValue(row.code || row.value || row.eventType || row.event_type),
      label: textValue(row.name || row.label || row.title),
      group: textValue(row.group || row.category || row.categoryName || row.category_name),
      sortOrder: Number(row.sortOrder || row.sort_order || 0),
      status: textValue(row.status || '启用')
    }))
    .filter((row) => row.code && row.label && row.group && row.status !== '停用')
    .sort((left, right) => (left.sortOrder || 999) - (right.sortOrder || 999))
  return normalized.length ? normalized : EVENT_OPTIONS.map((item) => ({ ...item }))
}

export async function ensureTransferReasonDictionary(rows: any[]) {
  const existing = new Set(
    (rows || [])
      .map((row) =>
        textValue(row.name || row.reason || row.reasonName || row.reason_name || row.value)
      )
      .filter(Boolean)
  )
  const seedRows = Object.entries(REQUIRED_TRANSFER_REASONS)
    .flatMap(([, reasons]) => reasons)
    .filter((reason) => !existing.has(textValue(reason.name || reason.value)))
    .map((reason, index) => ({
      id: dictionaryRowId('seed-transfer-reason', textValue(reason.name || reason.value), index),
      name: textValue(reason.name || reason.value),
      category: textValue(reason.meta?.category) || '其他',
      frequency: textValue(reason.meta?.frequency) || '中频',
      description: '信息录入原因字典初始化项，可在平台管理中调整。',
      status: '启用',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))
  if (seedRows.length) {
    await databaseService.addTableDataAsync('transfer-reasons', seedRows)
    return databaseService
      .getTableDataAsync('transfer-reasons', { silent: true })
      .catch(() => [...(rows || []), ...seedRows])
  }
  return rows || []
}

export async function ensureBreedDictionary(rows: any[]) {
  const normalizeRows = (sourceRows: any[]) =>
    (sourceRows || [])
      .map((row) => {
        const name = normalizeCattleBreed(
          row?.name || row?.breedName || row?.breed_name || row?.code || row?.value
        )
        return name ? { ...row, name, breedName: name, breed_name: name } : null
      })
      .filter(Boolean)

  const normalizedRows = normalizeRows(rows)
  const existing = new Set(normalizedRows.map((row) => textValue(row.name)).filter(Boolean))
  const seedRows = SUPPORTED_CATTLE_BREEDS.filter((value) => !existing.has(value)).map(
    (value, index) => ({
      id: dictionaryRowId('seed-breed', value, index),
      name: value,
      category: value === '华西牛' ? '肉用' : '兼用',
      purpose: value === '华西牛' ? '肉用' : '肉乳兼用',
      status: '启用',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  )
  if (seedRows.length) {
    await databaseService.addTableDataAsync('breed-types', seedRows)
    const persistedRows = await databaseService
      .getTableDataAsync('breed-types', { silent: true })
      .catch(() => [...normalizedRows, ...seedRows])
    return normalizeRows(persistedRows)
  }
  return normalizedRows
}

export function normalizeTransferReasonOption(row: Record<string, any>): SelectOption | null {
  const name = textValue(
    row.name || row.reason || row.reasonName || row.reason_name || row.title || row.label
  )
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
      id: textValue(row.id),
      description: textValue(row.description || row.remark || row.notes)
    }
  }
}

export function inferTransferReasonCategory(row: Record<string, any>) {
  const explicit = textValue(
    row.category ||
      row.categoryName ||
      row.category_name ||
      row.reasonType ||
      row.reason_type ||
      row.type
  )
  const fullText = [
    explicit,
    row.name,
    row.reason,
    row.reasonName,
    row.reason_name,
    row.description,
    row.remark,
    row.notes
  ]
    .map(textValue)
    .join(' ')
  if (/疾病|隔离|治疗|疫苗|康复|防疫|检疫|乳房炎|蹄|伤|死亡|病/.test(fullText)) return '健康管理'
  if (
    /出生|购入|入群|转入|新购|引种|泌乳|干奶|妊娠|配种|分娩|产犊|断奶|阶段|品种|繁殖|生产|犊牛|育成|公牛|待产/.test(
      fullText
    )
  )
    return '生产管理'
  if (/饲|料|日粮|营养|体况|采食|膘情|育肥/.test(fullText)) return '饲养管理'
  if (['生产管理', '健康管理', '饲养管理', '其他'].includes(explicit)) return explicit
  return '其他'
}

export function inferTransferReasonFrequency(row: Record<string, any>, category: string) {
  const explicit = textValue(
    row.frequency ||
      row.usageFrequency ||
      row.usage_frequency ||
      row.useFrequency ||
      row.use_frequency
  )
  if (['高频', '中频', '低频', '临时'].includes(explicit)) return explicit
  const fullText = [row.name, row.reason, row.description, category].map(textValue).join(' ')
  if (/管理调整|临时/.test(fullText)) return '临时'
  if (/维修|场地|出售|淘汰|死亡|临时|管理调整/.test(fullText)) return '低频'
  if (/泌乳|断奶|出生|入群|阶段/.test(fullText)) return '高频'
  if (/疾病|隔离|康复|干奶|疫苗|品种|饲|分娩|妊娠|配种|体重|转群/.test(fullText)) return '中频'
  return '中频'
}

export function normalizeCustomFieldRow(
  row: CustomField,
  event?: InformationEntryEventOption
): CustomField {
  const scope = textValue(row.scope)
  const eventCode = textValue(
    row.eventCode || (scope.startsWith('information-entry:') ? scope.split(':')[1] : '')
  )
  return {
    ...row,
    scope,
    eventCode: eventCode || undefined,
    eventGroup: textValue(row.eventGroup || event?.group) || undefined,
    options: Array.isArray(row.options)
      ? row.options.map(textValue).filter(Boolean)
      : textValue(row.optionsText)
          .split(/[，,;；]/)
          .map(textValue)
          .filter(Boolean),
    isActive: row.isActive !== false,
    sortOrder: Number(row.sortOrder || 0)
  }
}

export async function getInformationEntryEvents() {
  const baseRows = await databaseService
    .getTableDataAsync('base-info-categories', { silent: true })
    .catch(() => [])
  const withOptionSeeds = await ensureInformationEntryOptionDictionaries(baseRows || [])
  return ensureInformationEntryEventDictionary(withOptionSeeds || [])
}

export async function getCustomFieldsByScope(scope: string) {
  const rows = await databaseService
    .getTableDataAsync('custom-fields', { silent: true })
    .catch(() => [])
  return (rows || [])
    .filter((field: CustomField) => field.scope === scope)
    .map((field: CustomField) => normalizeCustomFieldRow(field))
    .sort((left: CustomField, right: CustomField) => (left.sortOrder || 0) - (right.sortOrder || 0))
}
