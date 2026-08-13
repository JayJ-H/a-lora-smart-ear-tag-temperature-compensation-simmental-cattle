/**
 * 数据库服务
 * 统一管理所有业务数据，支持 管理系统/frontend 两种模式：
 * - backend: 通过 /api/db/rpc 访问后端数据库
 * - frontend: 使用 IndexedDB + Dexie
 */

import type {
  CowBasic,
  Person,
  Pen,
  Disease,
  Medicine,
  TransferReason,
  BreedType,
  MilkRecord,
  FeedRecord,
  BreedingRecord,
  MilkQualityStandard,
  FeedFormula,
  FeedInventory,
  ReproductionCycle,
  HealthAlert,
  LactationCurve,
  WorkflowTemplate,
  WorkflowInstance,
  AutomatedAction,
  SmartTransferRule,
  ReminderRule,
  KPIDashboard,
  KPIDashboardData,
  EconomicAnalysis,
  CostItem,
  RevenueItem,
  BudgetPlan,
  OmicsSample,
  OmicsDataset,
  OmicsMarker,
  MultiOmicsAssociation,
  BreedingAnalysis,
  PredictiveModel,
  PredictionResult,
  ForecastScenario,
  PredictiveAlert,
  SensorStatus,
  DataQualityCheck,
  SensorCalibration,
  HardwareDevice,
  IntegrationProtocol,
  DataSynchronization,
  HardwareAlert,
  DeviceMaintenance,
  IntegrationDashboard,
  EntryEvent,
  TransferEvent,
  ExitEvent,
  BreedingEvent,
  VeterinaryEvent
} from '@/types'
import api from '@/utils/http'
import {
  CATTLE_SPECIES_NAME,
  DEFAULT_CATTLE_BREED,
  requireSupportedCattleBreed
} from '@/utils/cattle-breeds'
import { buildCowReferenceContext, resolveCowRef } from '@/utils/cow-reference'
import {
  normalizeDiseaseCategory,
  normalizeBaseInfoStatus,
  normalizeMedicineCategory,
  normalizePenCategory,
  normalizePersonRole
} from '@/utils/base-info-normalizers'
import { db } from './database-model'
import { V2_DATABASE_TABLES } from './v2-database-tables'

interface DatabaseData {
  [tableName: string]: any[]
  cows: CowBasic[]
  sensors: any[]
  'sensor-readings': any[]
  events: any[]
  persons: Person[]
  pens: Pen[]
  diseases: Disease[]
  medicines: Medicine[]
  'transfer-reasons': TransferReason[]
  'breed-types': BreedType[]
  'milk-records': MilkRecord[]
  'milk-quality-standards': MilkQualityStandard[]
  'lactation-curves': LactationCurve[]
  'feed-records': FeedRecord[]
  'feed-formulas': FeedFormula[]
  'feed-inventory': FeedInventory[]
  'breeding-records': BreedingRecord[]
  'reproduction-cycles': ReproductionCycle[]
  'breeding-bulls': any[]
  'reproduction-kpis': any[]
  alerts: HealthAlert[]
  'workflow-templates': WorkflowTemplate[]
  'workflow-instances': WorkflowInstance[]
  'automated-actions': AutomatedAction[]
  'smart-transfer-rules': SmartTransferRule[]
  'reminder-rules': ReminderRule[]
  'kpi-dashboards': KPIDashboard[]
  'kpi-dashboard-data': KPIDashboardData[]
  'economic-analysis': EconomicAnalysis[]
  'cost-items': CostItem[]
  'revenue-items': RevenueItem[]
  'budget-plans': BudgetPlan[]
  'omics-samples': OmicsSample[]
  'omics-datasets': OmicsDataset[]
  'omics-markers': OmicsMarker[]
  'multi-omics-associations': MultiOmicsAssociation[]
  'breeding-analyses': BreedingAnalysis[]
  'phenotype-trait-definitions': any[]
  'phenotype-records': any[]
  'phenotype-export-methods': any[]
  'logical-trait-rules': any[]
  'base-info-categories': any[]
  'predictive-models': PredictiveModel[]
  'prediction-results': PredictionResult[]
  'forecast-scenarios': ForecastScenario[]
  'predictive-alerts': PredictiveAlert[]
  'sensor-status': SensorStatus[]
  'data-quality-checks': DataQualityCheck[]
  'sensor-calibrations': SensorCalibration[]
  'hardware-devices': HardwareDevice[]
  'integration-protocols': IntegrationProtocol[]
  'data-synchronizations': DataSynchronization[]
  'hardware-alerts': HardwareAlert[]
  'device-maintenance': DeviceMaintenance[]
  'integration-dashboards': IntegrationDashboard[]
  'entry-events': EntryEvent[]
  'transfer-events': TransferEvent[]
  'exit-events': ExitEvent[]
  'breeding-events': BreedingEvent[]
  'veterinary-events': VeterinaryEvent[]
  'cow-events': any[]
  // 灵活导出/导入/自定义字段系统
  'export-configs': any[]
  'custom-fields': any[]
  'import-configs': any[]
  'export-audit-logs': any[]
  'hardware-command-logs': any[]
  'mqtt-message-logs': any[]
  'breeding-decision-runs': any[]
  'operation-audit-logs': any[]
  devices: any[]
}

const tableNameMap: Record<string, string> = {
  'transfer-reasons': 'transfer-reasons',
  'breed-types': 'breed-types',
  'milk-records': 'milk-records',
  'milk-quality-standards': 'milk-quality-standards',
  'lactation-curves': 'lactation-curves',
  'feed-records': 'feed-records',
  'feed-formulas': 'feed-formulas',
  'feed-inventory': 'feed-inventory',
  'breeding-records': 'breeding-records',
  'reproduction-cycles': 'reproduction-cycles',
  'breeding-bulls': 'breeding-bulls',
  'reproduction-kpis': 'reproduction-kpis',
  'health-scores': 'health-scores',
  // 灵活导出/导入/自定义字段系统
  'export-configs': 'export-configs',
  'custom-fields': 'custom-fields',
  'import-configs': 'import-configs',
  'workflow-templates': 'workflow-templates',
  'workflow-instances': 'workflow-instances',
  'automated-actions': 'automated-actions',
  'smart-transfer-rules': 'smart-transfer-rules',
  'reminder-rules': 'reminder-rules',
  'kpi-dashboards': 'kpi-dashboards',
  'kpi-dashboard-data': 'kpi-dashboard-data',
  'economic-analysis': 'economic-analysis',
  'cost-items': 'cost-items',
  'revenue-items': 'revenue-items',
  'budget-plans': 'budget-plans',
  'omics-samples': 'omics-samples',
  'omics-datasets': 'omics-datasets',
  'omics-markers': 'omics-markers',
  'multi-omics-associations': 'multi-omics-associations',
  'breeding-analyses': 'breeding-analyses',
  'phenotype-trait-definitions': 'phenotype-trait-definitions',
  'phenotype-records': 'phenotype-records',
  'phenotype-export-methods': 'phenotype-export-methods',
  'logical-trait-rules': 'logical-trait-rules',
  'base-info-categories': 'base-info-categories',
  'predictive-models': 'predictive-models',
  'prediction-results': 'prediction-results',
  'forecast-scenarios': 'forecast-scenarios',
  'predictive-alerts': 'predictive-alerts',
  'sensor-status': 'sensor-status',
  'data-quality-checks': 'data-quality-checks',
  'sensor-calibrations': 'sensor-calibrations',
  'hardware-devices': 'hardware-devices',
  'integration-protocols': 'integration-protocols',
  'data-synchronizations': 'data-synchronizations',
  'hardware-alerts': 'hardware-alerts',
  'device-maintenance': 'device-maintenance',
  'integration-dashboards': 'integration-dashboards',
  'entry-events': 'entry-events',
  'transfer-events': 'transfer-events',
  'exit-events': 'exit-events',
  'breeding-events': 'breeding-events',
  'veterinary-events': 'veterinary-events',
  'export-audit-logs': 'export-audit-logs',
  'hardware-command-logs': 'hardware-command-logs',
  'mqtt-message-logs': 'mqtt-message-logs',
  'breeding-decision-runs': 'breeding-decision-runs',
  'operation-audit-logs': 'operation-audit-logs'
}

for (const table of V2_DATABASE_TABLES) {
  tableNameMap[table.key] = table.key
}

const isBackendMode = import.meta.env.VITE_ACCESS_MODE === '管理系统'

const DEFAULT_TABLES = Array.from(
  new Set(
    Object.keys(tableNameMap).concat([
      'cows',
      'sensors',
      'sensor-readings',
      'persons',
      'pens',
      'diseases',
      'medicines',
      'alerts',
      'cow-events',
      'breeding-bulls',
      'reproduction-kpis',
      'export-configs',
      'custom-fields',
      'import-configs',
      'devices'
    ])
  )
)

const dataCache: Record<string, any[]> = {}
const loadingPromises: Partial<Record<string, Promise<any[]>>> = {}
const loadingPromiseMeta: Record<
  string,
  { limit: number; page: number; orderBy: string; orderDir: string; full: boolean }
> = {}
const dataCacheMeta: Record<
  string,
  { limit: number; page: number; orderBy: string; orderDir: string; full: boolean }
> = {}
let onDataUpdate: ((table: string, data: any[]) => void) | null = null
let isInitialized = false

const FAST_APPEND_TABLES = new Set(['operation-audit-log', 'operation-audit-logs'])

export interface TablePageData<T = any> {
  rows: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

function getReadCacheMeta(options: GetTableDataOptions = {}) {
  return {
    limit: Number(options.limit || options.pageSize || 5000),
    page: Number(options.page || 1),
    orderBy: String(options.orderBy || ''),
    orderDir: String(options.orderDir || 'desc').toLowerCase(),
    full: false
  }
}

function canUseCachedRows(tableName: string, options: GetTableDataOptions = {}) {
  const cached = dataCache[tableName]
  if (!cached) return false
  const requested = getReadCacheMeta(options)
  const existing = dataCacheMeta[tableName]
  if (!existing) return false
  if (!existing.full && !options.limit && !options.pageSize) return false
  return (
    existing.page === requested.page &&
    existing.orderBy === requested.orderBy &&
    existing.orderDir === requested.orderDir &&
    existing.limit >= requested.limit &&
    (existing.full || Boolean(options.limit || options.pageSize))
  )
}

function isFastAppendTable(tableName: string) {
  return FAST_APPEND_TABLES.has(tableName.replace(/_/g, '-'))
}

function mergeRowsById(baseRows: any[], newRows: any[]) {
  const merged = [...baseRows]
  const indexById = new Map<string, number>()

  merged.forEach((row, index) => {
    const id = row?.id
    if (id !== undefined && id !== null && id !== '') {
      indexById.set(String(id), index)
    }
  })

  for (const row of newRows) {
    const id = row?.id
    if (id !== undefined && id !== null && id !== '') {
      const key = String(id)
      const existIndex = indexById.get(key)
      if (existIndex !== undefined) {
        merged[existIndex] = { ...merged[existIndex], ...row }
        continue
      }
      indexById.set(key, merged.length)
    }
    merged.push(row)
  }

  return merged
}

function firstNonBlankText(...values: unknown[]): string {
  return values.map((value) => String(value ?? '').trim()).find(Boolean) || ''
}

function parsePayloadObject(row: any): Record<string, any> {
  if (!row?.payload) return {}
  if (typeof row.payload === 'object') return row.payload
  try {
    return JSON.parse(row.payload)
  } catch {
    return {}
  }
}

function normalizeBaseInfoCategoryLikeRow(row: Record<string, any>): Record<string, any> {
  const payload = parsePayloadObject(row)
  const parentId = firstNonBlankText(
    row.parentId,
    row.parent_id,
    payload.parentId,
    payload.parent_id
  )
  const name = firstNonBlankText(
    row.name,
    payload.name,
    row.label,
    payload.label,
    row.value,
    payload.value,
    row.code,
    payload.code
  )
  const code = firstNonBlankText(row.code, payload.code, row.value, payload.value, name)
  const label = firstNonBlankText(row.label, payload.label, row.name, payload.name, name, code)
  return {
    ...payload,
    ...row,
    scope: firstNonBlankText(row.scope, payload.scope),
    code,
    value: firstNonBlankText(row.value, payload.value, code, name),
    name,
    label,
    category: firstNonBlankText(row.category, payload.category, row.group, payload.group),
    group: firstNonBlankText(row.group, payload.group, row.category, payload.category),
    status: firstNonBlankText(row.status, payload.status, row.state, payload.state, '启用'),
    isActive: row.isActive ?? row.is_active ?? payload.isActive ?? payload.is_active ?? true,
    is_active: row.is_active ?? row.isActive ?? payload.is_active ?? payload.isActive ?? true,
    sortOrder:
      Number(row.sortOrder ?? row.sort_order ?? payload.sortOrder ?? payload.sort_order ?? 0) || 0,
    sort_order:
      Number(row.sort_order ?? row.sortOrder ?? payload.sort_order ?? payload.sortOrder ?? 0) || 0,
    parentId,
    parent_id: firstNonBlankText(row.parent_id, row.parentId, payload.parent_id, payload.parentId),
    parentName: firstNonBlankText(
      row.parentName,
      row.parent_name,
      payload.parentName,
      payload.parent_name
    ),
    parent_name: firstNonBlankText(
      row.parent_name,
      row.parentName,
      payload.parent_name,
      payload.parentName
    ),
    level: Number(row.level ?? payload.level ?? (parentId ? 2 : 1)) || (parentId ? 2 : 1)
  }
}

function normalizeCustomFieldLikeRow(row: Record<string, any>): Record<string, any> {
  const payload = parsePayloadObject(row)
  const scope = firstNonBlankText(row.scope, payload.scope)
  const fieldName = firstNonBlankText(
    row.fieldName,
    row.field_name,
    payload.fieldName,
    payload.field_name,
    payload.name,
    row.id
  )
  return {
    ...payload,
    ...row,
    scope,
    eventCode: firstNonBlankText(
      row.eventCode,
      row.event_code,
      payload.eventCode,
      payload.event_code,
      scope.startsWith('information-entry:') ? scope.split(':')[1] : ''
    ),
    eventGroup: firstNonBlankText(
      row.eventGroup,
      row.event_group,
      payload.eventGroup,
      payload.event_group,
      payload.group
    ),
    fieldName,
    field_name: firstNonBlankText(
      row.field_name,
      row.fieldName,
      payload.field_name,
      payload.fieldName,
      fieldName
    ),
    label: firstNonBlankText(row.label, payload.label, row.name, payload.name, fieldName),
    type: firstNonBlankText(
      row.type,
      payload.type,
      Array.isArray(payload.options) && payload.options.length ? 'select' : 'text'
    ),
    optionSource: firstNonBlankText(
      row.optionSource,
      row.option_source,
      payload.optionSource,
      payload.option_source
    ),
    option_source: firstNonBlankText(
      row.option_source,
      row.optionSource,
      payload.option_source,
      payload.optionSource
    ),
    options: row.options ?? payload.options ?? [],
    allowCreate:
      row.allowCreate ?? row.allow_create ?? payload.allowCreate ?? payload.allow_create ?? false,
    required: row.required ?? payload.required ?? false,
    isActive: row.isActive ?? row.is_active ?? payload.isActive ?? payload.is_active ?? true,
    is_active: row.is_active ?? row.isActive ?? payload.is_active ?? payload.isActive ?? true,
    sortOrder:
      Number(row.sortOrder ?? row.sort_order ?? payload.sortOrder ?? payload.sort_order ?? 0) || 0,
    sort_order:
      Number(row.sort_order ?? row.sortOrder ?? payload.sort_order ?? payload.sortOrder ?? 0) || 0
  }
}

function knownBaseInfoCategory(tableName: string, value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const scope = tableName.replace(/_/g, '-')
  const rows = Array.isArray(dataCache['base-info-categories'])
    ? dataCache['base-info-categories']
    : []
  const matched = rows.map(normalizeBaseInfoCategoryLikeRow).find(
    (row: any) =>
      String(row?.scope || '').trim() === scope &&
      String(row?.name || '')
        .trim()
        .toLowerCase() === raw.toLowerCase()
  )
  return matched ? String(matched.name || '').trim() : ''
}

const GENERIC_BASE_INFO_CATEGORY_RE =
  /^(general|other|others|unknown|uncategorized|未分类|其他|其它)$/i

function categoryValueOrNormalized(
  tableName: string,
  value: unknown,
  normalize: () => string
): string {
  const raw = String(value ?? '').trim()
  if (!raw) return normalize()
  const known = knownBaseInfoCategory(tableName, raw)
  if (known) return known
  return GENERIC_BASE_INFO_CATEGORY_RE.test(raw) ? normalize() : raw
}

function normalizeTransferReasonLikeRow(row: Record<string, any>): Record<string, any> {
  const normalized = { ...row }
  const name = firstNonBlankText(
    normalized.name,
    normalized.reason,
    normalized.reasonName,
    normalized.reason_name,
    normalized.title,
    normalized.label
  )
  if (name) {
    normalized.name = name
    normalized.reason = normalized.reason ?? name
  }
  const explicitCategory = firstNonBlankText(
    normalized.category,
    normalized.categoryName,
    normalized.category_name,
    normalized.reasonType,
    normalized.reason_type,
    normalized.type
  )
  normalized.category = categoryValueOrNormalized('transfer-reasons', explicitCategory, () =>
    normalizeTransferReasonCategory(
      explicitCategory,
      name,
      firstNonBlankText(normalized.description, normalized.remark, normalized.notes)
    )
  )
  normalized.categoryName = normalized.categoryName ?? normalized.category
  normalized.frequency = normalizeTransferReasonFrequency(
    firstNonBlankText(
      normalized.frequency,
      normalized.usageFrequency,
      normalized.usage_frequency,
      normalized.useFrequency,
      normalized.use_frequency
    ),
    name,
    normalized.category
  )
  if (
    normalized.status === undefined ||
    normalized.status === null ||
    String(normalized.status).trim() === ''
  ) {
    normalized.status =
      normalized.isActive === false || normalized.is_active === false ? '停用' : '启用'
  } else if (/^(停用|禁用|inactive|disabled)$/i.test(String(normalized.status).trim())) {
    normalized.status = '停用'
  } else {
    normalized.status = '启用'
  }
  normalized.isActive = normalized.status !== '停用'
  return normalized
}

function normalizePenLikeRow(row: Record<string, any>): Record<string, any> {
  const normalized = { ...row }
  const name = firstNonBlankText(
    normalized.name,
    normalized.penName,
    normalized.pen_name,
    normalized.unitName,
    normalized.unit_name,
    normalized.code,
    normalized.penCode,
    normalized.pen_code,
    normalized.unitCode,
    normalized.unit_code
  )
  if (name) normalized.name = name
  const explicitCategory = firstNonBlankText(
    normalized.category,
    normalized.categoryName,
    normalized.category_name,
    normalized.type,
    normalized.unitType,
    normalized.unit_type
  )
  normalized.category = categoryValueOrNormalized('pens', explicitCategory, () =>
    normalizePenCategory(explicitCategory, name)
  )
  normalized.categoryName = normalized.categoryName ?? normalized.category
  normalized.status =
    normalizeBaseInfoStatus(firstNonBlankText(normalized.status, normalized.state), [
      '正常',
      '维护中',
      '停用'
    ]) || '正常'
  normalized.isActive = normalized.status !== '停用'
  return normalized
}

function normalizePersonLikeRow(row: Record<string, any>): Record<string, any> {
  const normalized = { ...row }
  const name = firstNonBlankText(
    normalized.name,
    normalized.personName,
    normalized.person_name,
    normalized.realName,
    normalized.real_name,
    normalized.nickname,
    normalized.username
  )
  if (name) normalized.name = name
  const department = firstNonBlankText(
    normalized.department,
    normalized.departmentName,
    normalized.department_name,
    normalized.dept
  )
  if (department) normalized.department = department
  const explicitRole = firstNonBlankText(
    normalized.role,
    normalized.roleName,
    normalized.role_name,
    normalized.position,
    normalized.title,
    normalized.category,
    normalized.categoryName,
    normalized.category_name
  )
  normalized.role = categoryValueOrNormalized('persons', explicitRole, () =>
    normalizePersonRole(explicitRole, firstNonBlankText(normalized.department, normalized.name))
  )
  normalized.status =
    normalizeBaseInfoStatus(firstNonBlankText(normalized.status, normalized.state), [
      '正常',
      '停用',
      '离职'
    ]) || '正常'
  normalized.isActive = normalized.status !== '停用' && normalized.status !== '离职'
  return normalized
}

function normalizeDiseaseLikeRow(row: Record<string, any>): Record<string, any> {
  const normalized = { ...row }
  const name = firstNonBlankText(
    normalized.name,
    normalized.diseaseName,
    normalized.disease_name,
    normalized.diagnosis
  )
  if (name) normalized.name = name
  const explicitCategory = firstNonBlankText(
    normalized.category,
    normalized.categoryName,
    normalized.category_name,
    normalized.type,
    normalized.diseaseType,
    normalized.disease_type
  )
  normalized.category = categoryValueOrNormalized('diseases', explicitCategory, () =>
    normalizeDiseaseCategory(
      explicitCategory,
      firstNonBlankText(name, normalized.symptoms, normalized.treatment)
    )
  )
  normalized.categoryName = normalized.categoryName ?? normalized.category
  normalized.status =
    normalizeBaseInfoStatus(firstNonBlankText(normalized.status, normalized.state), [
      '启用',
      '停用'
    ]) || '启用'
  normalized.isActive = normalized.status !== '停用'
  return normalized
}

function normalizeMedicineLikeRow(row: Record<string, any>): Record<string, any> {
  const normalized = { ...row }
  const name = firstNonBlankText(
    normalized.name,
    normalized.medicineName,
    normalized.medicine_name,
    normalized.code,
    normalized.medicineCode,
    normalized.medicine_code
  )
  if (name) normalized.name = name
  const explicitCategory = firstNonBlankText(
    normalized.category,
    normalized.categoryName,
    normalized.category_name,
    normalized.type,
    normalized.medicineType,
    normalized.medicine_type
  )
  normalized.category = categoryValueOrNormalized('medicines', explicitCategory, () =>
    normalizeMedicineCategory(
      explicitCategory,
      firstNonBlankText(name, normalized.usage, normalized.usageText, normalized.usage_text)
    )
  )
  normalized.categoryName = normalized.categoryName ?? normalized.category
  normalized.status =
    normalizeBaseInfoStatus(firstNonBlankText(normalized.status, normalized.state), [
      '启用',
      '停用'
    ]) || '启用'
  normalized.isActive = normalized.status !== '停用'
  return normalized
}

function normalizeTransferReasonCategory(category: string, name: string, description = '') {
  const text = `${category} ${name} ${description}`
  if (/疾病|隔离|治疗|疫苗|康复|防疫|检疫|乳房炎|蹄|伤|死亡|病/.test(text)) return '健康管理'
  if (
    /出生|购入|入群|转入|新购|引种|泌乳|干奶|妊娠|配种|分娩|产犊|断奶|阶段|品种|繁殖|生产|犊牛|育成|公牛|待产/.test(
      text
    )
  )
    return '生产管理'
  if (/饲|料|日粮|营养|体况|采食|膘情|育肥/.test(text)) return '饲养管理'
  if (['生产管理', '健康管理', '饲养管理', '其他'].includes(category)) return category
  return '其他'
}

function normalizeTransferReasonFrequency(frequency: string, name: string, category: string) {
  if (['高频', '中频', '低频', '临时'].includes(frequency)) return frequency
  const text = `${name} ${category}`
  if (/管理调整|临时/.test(text)) return '临时'
  if (/维修|场地|出售|淘汰|死亡|临时|管理调整/.test(text)) return '低频'
  if (/泌乳|断奶|出生|入群|阶段/.test(text)) return '高频'
  if (/疾病|隔离|康复|干奶|疫苗|品种|饲|分娩|妊娠|配种|体重|转群/.test(text)) return '中频'
  return '中频'
}

function normalizeBackendRows(tableName: string, rows: any[]): any[] {
  const nowIso = () => new Date().toISOString()
  const normalizedTableName = tableName.replace(/_/g, '-')

  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row
    const normalized = { ...row }

    switch (normalizedTableName) {
      case 'animal':
        normalized.cowId =
          normalized.cowId ??
          normalized.cow_id ??
          normalized.animalId ??
          normalized.animal_id ??
          normalized.id
        normalized.cow_id = normalized.cow_id ?? normalized.cowId
        normalized.animalId = normalized.animalId ?? normalized.animal_id ?? normalized.cowId
        normalized.animal_id = normalized.animal_id ?? normalized.animalId
        normalized.cowNumber =
          normalized.cowNumber ??
          normalized.cow_number ??
          normalized.animalNumber ??
          normalized.animal_number ??
          normalized.number
        normalized.cow_number = normalized.cow_number ?? normalized.cowNumber
        normalized.animalNumber =
          normalized.animalNumber ?? normalized.animal_number ?? normalized.cowNumber
        normalized.animal_number = normalized.animal_number ?? normalized.animalNumber
        normalized.gender = normalized.gender ?? normalized.sex
        normalized.type =
          normalized.type ??
          normalized.cowType ??
          normalized.cow_type ??
          normalized.currentStageId ??
          normalized.current_stage_id
        normalized.cowType = normalized.cowType ?? normalized.type
        normalized.currentPen =
          normalized.currentPen ??
          normalized.current_pen ??
          normalized.currentPenName ??
          normalized.current_pen_name ??
          normalized.currentUnitName ??
          normalized.current_unit_name ??
          normalized.currentUnitId ??
          normalized.current_unit_id ??
          normalized.currentPenId ??
          normalized.current_pen_id
        normalized.parity =
          normalized.parity ??
          normalized.parityNo ??
          normalized.parity_no ??
          normalized.reportedParityNo ??
          normalized.reported_parity_no ??
          0
        break
      case 'cows':
        normalized.type = normalized.type ?? normalized.cowType ?? normalized.cow_type
        normalized.cowType = normalized.cowType ?? normalized.type
        normalized.cowId = normalized.cowId ?? normalized.cow_id ?? normalized.id
        normalized.cow_id = normalized.cow_id ?? normalized.cowId
        normalized.animalId = normalized.animalId ?? normalized.animal_id ?? normalized.cowId
        normalized.animal_id = normalized.animal_id ?? normalized.animalId
        normalized.cowNumber =
          normalized.cowNumber ??
          normalized.cow_number ??
          normalized.animalNumber ??
          normalized.animal_number
        normalized.cow_number = normalized.cow_number ?? normalized.cowNumber
        normalized.animalNumber =
          normalized.animalNumber ?? normalized.animal_number ?? normalized.cowNumber
        normalized.animal_number = normalized.animal_number ?? normalized.animalNumber
        normalized.gender = normalized.gender ?? normalized.sex
        normalized.sex = normalized.sex ?? normalized.gender
        normalized.currentPen =
          normalized.currentPen ??
          normalized.current_pen ??
          normalized.currentPenName ??
          normalized.current_pen_name
        normalized.parity = normalized.parity ?? normalized.parityNo ?? normalized.parity_no ?? 0
        break
      case 'persons':
        Object.assign(normalized, normalizePersonLikeRow(normalized))
        break
      case 'pens':
        Object.assign(normalized, normalizePenLikeRow(normalized))
        break
      case 'diseases':
        Object.assign(normalized, normalizeDiseaseLikeRow(normalized))
        break
      case 'medicines':
        Object.assign(normalized, normalizeMedicineLikeRow(normalized))
        break
      case 'transfer-reasons':
        Object.assign(normalized, normalizeTransferReasonLikeRow(normalized))
        break
      case 'base-info-categories':
        Object.assign(normalized, normalizeBaseInfoCategoryLikeRow(normalized))
        break
      case 'custom-fields':
        Object.assign(normalized, normalizeCustomFieldLikeRow(normalized))
        break
      case 'breeding-records': {
        const eventTime =
          normalized.event_time ??
          normalized.eventTime ??
          normalized.breedingDate ??
          normalized.createdAt ??
          nowIso()
        normalized.event_time = eventTime
        normalized.eventTime = normalized.eventTime ?? eventTime
        break
      }
      case 'kpi-dashboard-data':
      case 'prediction-results':
        normalized.ts =
          normalized.ts ??
          normalized.timestamp ??
          normalized.predictionDate ??
          normalized.createdAt ??
          nowIso()
        break
      case 'feed-records':
        normalized.feedingTime =
          normalized.feedingTime ??
          normalized.feedTime ??
          normalized.feed_time ??
          normalized.createdAt ??
          nowIso()
        break
      case 'cost-items':
      case 'revenue-items':
        normalized.date = normalized.date ?? normalized.itemDate ?? normalized.item_date
        break
      case 'kpi-dashboards':
        normalized.layout = normalized.layout ?? normalized.layoutJson ?? normalized.layout_json
        break
      case 'omics-samples':
        normalized.sampleCode = normalized.sampleCode ?? normalized.sample_id ?? normalized.sampleId
        normalized.collectionDate =
          normalized.collectionDate ??
          normalized.collection_date ??
          normalized.createdAt ??
          nowIso()
        normalized.updatedAt =
          normalized.updatedAt ?? normalized.updated_at ?? normalized.createdAt ?? nowIso()
        break
      case 'omics-datasets':
        normalized.datasetCode =
          normalized.datasetCode ?? normalized.dataset_id ?? normalized.datasetId
        normalized.generatedAt =
          normalized.generatedAt ?? normalized.generated_at ?? normalized.createdAt ?? nowIso()
        normalized.updatedAt =
          normalized.updatedAt ?? normalized.updated_at ?? normalized.createdAt ?? nowIso()
        break
      case 'omics-markers':
      case 'multi-omics-associations':
      case 'breeding-analyses':
      case 'phenotype-trait-definitions':
      case 'phenotype-records':
      case 'phenotype-export-methods':
      case 'logical-trait-rules':
        normalized.updatedAt =
          normalized.updatedAt ?? normalized.updated_at ?? normalized.createdAt ?? nowIso()
        if (normalizedTableName === 'phenotype-records') {
          normalized.collectionDate =
            normalized.collectionDate ??
            normalized.collection_date ??
            normalized.createdAt ??
            nowIso()
          normalized.traitCode = normalized.traitCode ?? normalized.trait_code
          normalized.traitName = normalized.traitName ?? normalized.trait_name
          normalized.cowId = normalized.cowId ?? normalized.cow_id
          normalized.cowNumber = normalized.cowNumber ?? normalized.cow_number
          normalized.dataSource = normalized.dataSource ?? normalized.data_source
          normalized.pedigreeLinked = normalized.pedigreeLinked ?? normalized.pedigree_linked
          normalized.omicsLinked = normalized.omicsLinked ?? normalized.omics_linked
        }
        if (tableName === 'phenotype-trait-definitions') {
          normalized.dataType = normalized.dataType ?? normalized.data_type ?? '数值'
          normalized.sourceTable = normalized.sourceTable ?? normalized.source_table
          normalized.sourceAnimalField =
            normalized.sourceAnimalField ?? normalized.source_animal_field
          normalized.sourceTraitField = normalized.sourceTraitField ?? normalized.source_trait_field
          normalized.sourceValueField = normalized.sourceValueField ?? normalized.source_value_field
          normalized.sourceDateField = normalized.sourceDateField ?? normalized.source_date_field
          normalized.sourceParityField =
            normalized.sourceParityField ?? normalized.source_parity_field
          normalized.sourceDimField = normalized.sourceDimField ?? normalized.source_dim_field
          normalized.requiredFields = normalized.requiredFields ?? normalized.required_fields
          normalized.linkedDomains = normalized.linkedDomains ?? normalized.linked_domains
        }
        if (tableName === 'phenotype-export-methods') {
          normalized.groupBy = normalized.groupBy ?? normalized.group_by ?? 'raw'
          normalized.timeGranularity =
            normalized.timeGranularity ?? normalized.time_granularity ?? ''
          normalized.lactationWindowDays =
            normalized.lactationWindowDays ?? normalized.lactation_window_days ?? 305
          normalized.requiredFields = normalized.requiredFields ?? normalized.required_fields
          normalized.status = normalized.status ?? '启用'
        }
        if (tableName === 'logical-trait-rules') {
          normalized.sourceTable =
            normalized.sourceTable ?? normalized.source_table ?? 'animal_event'
          normalized.ruleType = normalized.ruleType ?? normalized.rule_type ?? 'event_interval'
          normalized.sourceTraitCodes =
            normalized.sourceTraitCodes ??
            normalized.source_trait_codes ??
            normalized.sourceTraitCode ??
            normalized.source_trait_code ??
            []
          normalized.sourceValueField =
            normalized.sourceValueField ?? normalized.source_value_field ?? 'value'
          normalized.sourceDateField =
            normalized.sourceDateField ?? normalized.source_date_field ?? 'collectionDate'
          normalized.startEventTypes =
            normalized.startEventTypes ?? normalized.start_event_types ?? []
          normalized.endEventTypes = normalized.endEventTypes ?? normalized.end_event_types ?? []
          normalized.periodScope = normalized.periodScope ?? normalized.period_scope ?? 'parity'
          normalized.parityMode = normalized.parityMode ?? normalized.parity_mode ?? 'current'
          normalized.matchMode =
            normalized.matchMode ?? normalized.match_mode ?? 'latest_before_end'
          normalized.aggregation = normalized.aggregation ?? 'raw'
          normalized.outputTraitCode =
            normalized.outputTraitCode ?? normalized.output_trait_code ?? normalized.code
          normalized.requiredFields = normalized.requiredFields ?? normalized.required_fields
          normalized.linkedDomains = normalized.linkedDomains ?? normalized.linked_domains
          normalized.status = normalized.status ?? '启用'
        }
        break
      case 'export-audit-logs':
        normalized.action_type = normalized.action_type ?? normalized.actionType ?? 'export'
        normalized.file_name = normalized.file_name ?? normalized.fileName
        normalized.file_url = normalized.file_url ?? normalized.fileUrl
        normalized.file_hash = normalized.file_hash ?? normalized.fileHash
        normalized.file_format = normalized.file_format ?? normalized.fileFormat
        normalized.row_count = normalized.row_count ?? normalized.rowCount
        normalized.filters_json = normalized.filters_json ?? normalized.filtersJson
        normalized.parameters_json = normalized.parameters_json ?? normalized.parametersJson
        normalized.result_snapshot = normalized.result_snapshot ?? normalized.resultSnapshot
        normalized.cow_ids = normalized.cow_ids ?? normalized.cowIds ?? []
        normalized.relation_scope = normalized.relation_scope ?? normalized.relationScope
        normalized.source_record_ids = normalized.source_record_ids ?? normalized.sourceRecordIds
        normalized.started_at =
          normalized.started_at ??
          normalized.startedAt ??
          normalized.created_at ??
          normalized.createdAt ??
          nowIso()
        normalized.finished_at =
          normalized.finished_at ?? normalized.finishedAt ?? normalized.started_at
        normalized.duration_ms = normalized.duration_ms ?? normalized.durationMs ?? 0
        normalized.created_at =
          normalized.created_at ?? normalized.createdAt ?? normalized.started_at
        normalized.updated_at =
          normalized.updated_at ?? normalized.updatedAt ?? normalized.finished_at
        break
      case 'hardware-command-logs':
        normalized.device_id = normalized.device_id ?? normalized.deviceId
        normalized.command_type = normalized.command_type ?? normalized.commandType ?? 'control'
        normalized.command_payload = normalized.command_payload ?? normalized.commandPayload
        normalized.ack_payload = normalized.ack_payload ?? normalized.ackPayload
        normalized.cow_ids = normalized.cow_ids ?? normalized.cowIds ?? []
        normalized.relation_scope = normalized.relation_scope ?? normalized.relationScope
        normalized.source_record_ids = normalized.source_record_ids ?? normalized.sourceRecordIds
        normalized.requested_at =
          normalized.requested_at ??
          normalized.requestedAt ??
          normalized.created_at ??
          normalized.createdAt ??
          nowIso()
        normalized.acknowledged_at =
          normalized.acknowledged_at ?? normalized.acknowledgedAt ?? normalized.requested_at
        normalized.created_at =
          normalized.created_at ?? normalized.createdAt ?? normalized.requested_at
        normalized.updated_at =
          normalized.updated_at ?? normalized.updatedAt ?? normalized.acknowledged_at
        break
      case 'mqtt-message-logs':
        normalized.direction = normalized.direction ?? 'uplink'
        normalized.topic = normalized.topic ?? ''
        normalized.qos = normalized.qos ?? 0
        normalized.device_id = normalized.device_id ?? normalized.deviceId
        normalized.cow_id = normalized.cow_id ?? normalized.cowId
        normalized.cow_number = normalized.cow_number ?? normalized.cowNumber
        normalized.command_type = normalized.command_type ?? normalized.commandType
        normalized.source_message_id = normalized.source_message_id ?? normalized.sourceMessageId
        normalized.payload_json = normalized.payload_json ?? normalized.payloadJson
        normalized.parsed_payload = normalized.parsed_payload ?? normalized.parsedPayload
        normalized.relation_scope = normalized.relation_scope ?? normalized.relationScope
        normalized.source_record_ids = normalized.source_record_ids ?? normalized.sourceRecordIds
        normalized.published_at =
          normalized.published_at ??
          normalized.publishedAt ??
          normalized.timestamp ??
          normalized.created_at ??
          normalized.createdAt
        normalized.received_at =
          normalized.received_at ??
          normalized.receivedAt ??
          normalized.created_at ??
          normalized.createdAt
        normalized.created_at =
          normalized.created_at ??
          normalized.createdAt ??
          normalized.received_at ??
          normalized.published_at ??
          nowIso()
        normalized.updated_at =
          normalized.updated_at ?? normalized.updatedAt ?? normalized.created_at
        break
      case 'breeding-decision-runs':
        normalized.run_type = normalized.run_type ?? normalized.runType ?? 'breeding_decision'
        normalized.parameters_json = normalized.parameters_json ?? normalized.parametersJson
        normalized.result_snapshot = normalized.result_snapshot ?? normalized.resultSnapshot
        normalized.cow_ids = normalized.cow_ids ?? normalized.cowIds ?? []
        normalized.relation_scope = normalized.relation_scope ?? normalized.relationScope
        normalized.source_record_ids = normalized.source_record_ids ?? normalized.sourceRecordIds
        normalized.started_at =
          normalized.started_at ??
          normalized.startedAt ??
          normalized.created_at ??
          normalized.createdAt ??
          nowIso()
        normalized.finished_at =
          normalized.finished_at ?? normalized.finishedAt ?? normalized.started_at
        normalized.duration_ms = normalized.duration_ms ?? normalized.durationMs ?? 0
        normalized.created_at =
          normalized.created_at ?? normalized.createdAt ?? normalized.started_at
        normalized.updated_at =
          normalized.updated_at ?? normalized.updatedAt ?? normalized.finished_at
        break
      case 'operation-audit-logs':
        normalized.action_type = normalized.action_type ?? normalized.actionType ?? 'operation'
        normalized.target_type = normalized.target_type ?? normalized.targetType
        normalized.target_id = normalized.target_id ?? normalized.targetId
        normalized.request_payload = normalized.request_payload ?? normalized.requestPayload
        normalized.result_payload = normalized.result_payload ?? normalized.resultPayload
        normalized.cow_ids = normalized.cow_ids ?? normalized.cowIds ?? []
        normalized.relation_scope = normalized.relation_scope ?? normalized.relationScope
        normalized.source_record_ids = normalized.source_record_ids ?? normalized.sourceRecordIds
        normalized.created_at = normalized.created_at ?? normalized.createdAt ?? nowIso()
        normalized.updated_at =
          normalized.updated_at ?? normalized.updatedAt ?? normalized.created_at
        break
      case 'operation-audit-log':
        normalized.action_type = normalized.action_type ?? normalized.actionType ?? 'operation'
        normalized.target_type = normalized.target_type ?? normalized.targetType
        normalized.target_id = normalized.target_id ?? normalized.targetId
        normalized.animal_id =
          normalized.animal_id ?? normalized.animalId ?? normalized.cow_id ?? normalized.cowId
        normalized.operator_name =
          normalized.operator_name ??
          normalized.operatorName ??
          normalized.operator ??
          normalized.userName
        normalized.operated_at =
          normalized.operated_at ??
          normalized.operatedAt ??
          normalized.created_at ??
          normalized.createdAt ??
          nowIso()
        normalized.request_payload = normalized.request_payload ?? normalized.requestPayload
        normalized.result_payload = normalized.result_payload ?? normalized.resultPayload
        normalized.created_at =
          normalized.created_at ?? normalized.createdAt ?? normalized.operated_at
        normalized.updated_at =
          normalized.updated_at ?? normalized.updatedAt ?? normalized.created_at
        break
      case 'sensor-reading':
      case 'sensor-readings': {
        const measuredAt =
          normalized.measured_at ??
          normalized.measuredAt ??
          normalized.timestamp ??
          normalized.read_at ??
          normalized.readAt ??
          normalized.ts ??
          nowIso()
        const metricCode =
          normalized.metric_code ??
          normalized.metricCode ??
          normalized.metric ??
          normalized.indicator
        const readingValue =
          normalized.reading_value ??
          normalized.readingValue ??
          normalized.value ??
          normalized.temperature ??
          normalized.body_temperature ??
          normalized.steps ??
          normalized.activity
        normalized.animal_id =
          normalized.animal_id ?? normalized.animalId ?? normalized.cow_id ?? normalized.cowId
        normalized.cow_id = normalized.cow_id ?? normalized.cowId ?? normalized.animal_id
        normalized.cowId = normalized.cowId ?? normalized.cow_id
        normalized.animalId = normalized.animalId ?? normalized.animal_id
        normalized.cowNumber =
          normalized.cowNumber ?? normalized.cow_number ?? normalized.animalNumber
        normalized.cow_number = normalized.cow_number ?? normalized.cowNumber
        normalized.measured_at = measuredAt
        normalized.measuredAt = normalized.measuredAt ?? measuredAt
        normalized.timestamp = normalized.timestamp ?? measuredAt
        normalized.read_at = normalized.read_at ?? measuredAt
        normalized.readAt = normalized.readAt ?? measuredAt
        normalized.metric_code = metricCode
        normalized.metricCode = normalized.metricCode ?? metricCode
        normalized.metric = normalized.metric ?? metricCode
        normalized.reading_value = readingValue
        normalized.readingValue = normalized.readingValue ?? readingValue
        normalized.value = normalized.value ?? readingValue
        normalized.quality_flag =
          normalized.quality_flag ?? normalized.qualityFlag ?? normalized.quality ?? 'valid'
        normalized.qualityFlag = normalized.qualityFlag ?? normalized.quality_flag
        normalized.created_at = normalized.created_at ?? normalized.createdAt ?? nowIso()
        normalized.updated_at =
          normalized.updated_at ?? normalized.updatedAt ?? normalized.created_at
        break
      }
      default:
        break
    }

    return normalized
  })
}

function normalizeBackendRecord(tableName: string, row: any): any {
  return normalizeBackendRows(tableName, [row])[0]
}

function getTable(tableName: string) {
  const normalizedKey = tableName.replace(/_/g, '-')
  const mappedName = tableNameMap[tableName] || tableNameMap[normalizedKey] || normalizedKey
  return (db as any)[mappedName] as any
}

interface DbRpcOptions {
  showErrorMessage?: boolean
  showErrorLog?: boolean
  timeout?: number
}

interface GetTableDataOptions {
  silent?: boolean
  limit?: number
  page?: number
  pageSize?: number
  orderBy?: string
  orderDir?: 'asc' | 'desc' | 'ASC' | 'DESC'
  timeout?: number
}

async function dbRpc<T = any>(
  method: string,
  payload: Record<string, any> = {},
  options: DbRpcOptions = {}
): Promise<T> {
  return api.post<T>({
    url: '/api/db/rpc',
    data: {
      method,
      ...payload
    },
    timeout: options.timeout,
    showErrorMessage: options.showErrorMessage ?? false,
    showErrorLog: options.showErrorLog ?? true
  })
}

export async function runBackendRpcAsync<T = any>(
  method: string,
  payload: Record<string, any> = {},
  options: DbRpcOptions = {}
): Promise<T> {
  return dbRpc<T>(method, payload, options)
}

async function checkBackendHealth(): Promise<boolean> {
  try {
    await api.get({
      url: '/api/health',
      timeout: 3000,
      showErrorMessage: false,
      showErrorLog: false
    })
    return true
  } catch {
    return false
  }
}

export function setDataUpdateCallback(callback: (table: string, data: any[]) => void) {
  onDataUpdate = callback
}

export function getAllData(): DatabaseData {
  const result: any = {}
  for (const tableName of DEFAULT_TABLES) {
    result[tableName] = getTableData(tableName)
  }
  return result as DatabaseData
}

export function getTableData(tableName: string): any[] {
  if (canUseCachedRows(tableName)) return [...dataCache[tableName]]
  if (loadingPromises[tableName]) return []

  const promise = getTableDataAsync(tableName)
    .then((data) => {
      dataCache[tableName] = data
      return data
    })
    .catch((err) => {
      console.error(`获取表 ${tableName} 数据失败:`, err)
      delete dataCache[tableName]
      delete dataCacheMeta[tableName]
      return []
    })
    .finally(() => {
      if (loadingPromises[tableName] === promise) {
        delete loadingPromises[tableName]
        delete loadingPromiseMeta[tableName]
      }
    })
  loadingPromises[tableName] = promise
  loadingPromiseMeta[tableName] = getReadCacheMeta()

  return []
}

export async function getTableDataAsync(
  tableName: string,
  options: GetTableDataOptions = {}
): Promise<any[]> {
  if (canUseCachedRows(tableName, options)) return [...dataCache[tableName]]
  const requestedMeta = getReadCacheMeta(options)
  const loadingMeta = loadingPromiseMeta[tableName]
  if (
    loadingPromises[tableName] &&
    loadingMeta &&
    loadingMeta.page === requestedMeta.page &&
    loadingMeta.orderBy === requestedMeta.orderBy &&
    loadingMeta.orderDir === requestedMeta.orderDir &&
    loadingMeta.limit >= requestedMeta.limit
  ) {
    return loadingPromises[tableName] as Promise<any[]>
  }

  if (isBackendMode) {
    const backendPromise = dbRpc<TablePageData<any>>(
      'getTablePageData',
      {
        tableName,
        limit: options.limit,
        page: options.page,
        pageSize: options.pageSize,
        orderBy: options.orderBy,
        orderDir: options.orderDir
      },
      { showErrorLog: !options.silent, timeout: options.timeout }
    )
      .then((pageData) => {
        const rows = Array.isArray(pageData?.rows) ? pageData.rows : []
        const safeData = normalizeBackendRows(tableName, rows)
        dataCache[tableName] = safeData
        dataCacheMeta[tableName] = {
          ...requestedMeta,
          limit: Number(pageData?.pageSize || requestedMeta.limit),
          page: Number(pageData?.page || requestedMeta.page),
          full: !pageData?.hasMore
        }
        return safeData
      })
      .finally(() => {
        if (loadingPromises[tableName] === backendPromise) {
          delete loadingPromises[tableName]
          delete loadingPromiseMeta[tableName]
        }
      })

    loadingPromises[tableName] = backendPromise
    loadingPromiseMeta[tableName] = requestedMeta
    return backendPromise
  }

  const table = getTable(tableName)
  if (!table) return []

  const localPromise = table
    .toArray()
    .then((data: any[]) => {
      const normalizedData = normalizeBackendRows(tableName, data)
      dataCache[tableName] = normalizedData
      dataCacheMeta[tableName] = { ...requestedMeta, limit: Number.MAX_SAFE_INTEGER, full: true }
      return normalizedData
    })
    .finally(() => {
      if (loadingPromises[tableName] === localPromise) {
        delete loadingPromises[tableName]
        delete loadingPromiseMeta[tableName]
      }
    })

  loadingPromises[tableName] = localPromise
  loadingPromiseMeta[tableName] = { ...requestedMeta, limit: Number.MAX_SAFE_INTEGER, full: true }
  return localPromise
}

export async function getTableRecordByIdAsync(
  tableName: string,
  id: string,
  options: { silent?: boolean; timeout?: number } = {}
): Promise<any | null> {
  const safeId = stringValue(id)
  if (!safeId) return null
  if (isBackendMode) {
    try {
      const row = await dbRpc<any>(
        'getTableRecordById',
        { tableName, id: safeId },
        { showErrorLog: !options.silent, timeout: options.timeout || 8000 }
      )
      return row ? normalizeBackendRecord(tableName, row) : null
    } catch (error) {
      if (!options.silent)
        console.warn(`后端按 ID 读取 ${tableName}/${safeId} 失败，降级为本地读取:`, error)
    }
  }
  const rows = await getTableDataAsync(tableName, { silent: true }).catch(() => [])
  return (rows || []).find((row: any) => stringValue(row.id) === safeId) || null
}

export function updateTableData(tableName: string, data: any[]): void {
  dataCache[tableName] = [...data]
  onDataUpdate?.(tableName, data)

  if (isBackendMode) {
    const normalizedData = normalizeBackendRows(tableName, data)
    dbRpc('updateTableData', { tableName, data: normalizedData }).catch((error) => {
      console.error(`更新表 ${tableName} 失败:`, error)
    })
    return
  }

  const table = getTable(tableName)
  if (table) {
    db.transaction('rw', table, async () => {
      await table.clear()
      if (data.length > 0) await table.bulkAdd(data)
    }).catch((error: any) => {
      console.error(`更新表 ${tableName} 失败:`, error)
    })
  }
}

export async function updateTableDataAsync(tableName: string, data: any[]): Promise<void> {
  const normalizedData = normalizeBackendRows(tableName, data)
  if (isBackendMode) {
    await dbRpc('updateTableData', { tableName, data: normalizedData })
    dataCache[tableName] = [...normalizedData]
    onDataUpdate?.(tableName, normalizedData)
    return
  }

  const table = getTable(tableName)
  if (!table) {
    console.warn(`表 ${tableName} 不存在`)
    return
  }

  await db.transaction('rw', table, async () => {
    await table.clear()
    if (normalizedData.length > 0) await table.bulkAdd(normalizedData)
  })
  dataCache[tableName] = [...normalizedData]
  onDataUpdate?.(tableName, normalizedData)
}

export function addTableData(tableName: string, newData: any | any[]): void {
  const dataToAdd = normalizeBackendRows(tableName, Array.isArray(newData) ? newData : [newData])
  const currentData = getTableData(tableName)
  const updatedData = mergeRowsById(currentData, dataToAdd)

  dataCache[tableName] = updatedData
  onDataUpdate?.(tableName, updatedData)

  if (isBackendMode) {
    dbRpc('addTableData', { tableName, data: dataToAdd }).catch((error) => {
      console.error(`添加数据到表 ${tableName} 失败:`, error)
    })
    return
  }

  const table = getTable(tableName)
  if (table) {
    table.bulkAdd(dataToAdd).catch((error: any) => {
      console.error(`添加数据到表 ${tableName} 失败:`, error)
    })
  }
}

export async function addTableDataAsync(tableName: string, newData: any | any[]): Promise<void> {
  const dataToAdd = normalizeBackendRows(tableName, Array.isArray(newData) ? newData : [newData])

  if (isBackendMode) {
    await dbRpc('addTableData', { tableName, data: dataToAdd })
    delete dataCache[tableName]
    if (isFastAppendTable(tableName)) return
    const next = await getTableDataAsync(tableName)
    dataCache[tableName] = [...next]
    onDataUpdate?.(tableName, next)
    return
  }

  const table = getTable(tableName)
  if (!table) {
    console.warn(`表 ${tableName} 不存在`)
    return
  }

  await table.bulkAdd(dataToAdd)
  const currentData = normalizeBackendRows(tableName, await table.toArray())
  dataCache[tableName] = currentData
  onDataUpdate?.(tableName, currentData)
}

export async function addTableDataFastAsync(
  tableName: string,
  newData: any | any[]
): Promise<void> {
  const dataToAdd = normalizeBackendRows(tableName, Array.isArray(newData) ? newData : [newData])
  if (!dataToAdd.length) return

  if (isBackendMode) {
    await dbRpc('addTableData', { tableName, data: dataToAdd }, { timeout: 120000 })
    delete dataCache[tableName]
    return
  }

  await addTableDataAsync(tableName, dataToAdd)
}

export interface TableDataBulkFlushProgress {
  tableName: string
  currentRows: number
  totalRows: number
  currentTable: number
  totalTables: number
}

interface TableDataBulkWriteContext {
  previous: TableDataBulkWriteContext | null
  tables: Map<string, Map<string, any>>
  unkeyed: Map<string, any[]>
}

let activeTableDataBulkWriteContext: TableDataBulkWriteContext | null = null

export function beginTableDataBulkWrite(): TableDataBulkWriteContext {
  const context: TableDataBulkWriteContext = {
    previous: activeTableDataBulkWriteContext,
    tables: new Map(),
    unkeyed: new Map()
  }
  activeTableDataBulkWriteContext = context
  return context
}

export function endTableDataBulkWrite(context: TableDataBulkWriteContext): void {
  if (activeTableDataBulkWriteContext === context) {
    activeTableDataBulkWriteContext = context.previous
  }
}

export async function flushTableDataBulkWrite(
  context: TableDataBulkWriteContext,
  onProgress?: (progress: TableDataBulkFlushProgress) => void
): Promise<void> {
  const tableNames = uniqueStrings([...context.tables.keys(), ...context.unkeyed.keys()])
  for (let tableIndex = 0; tableIndex < tableNames.length; tableIndex += 1) {
    const tableName = tableNames[tableIndex]
    const keyedRows = Array.from(context.tables.get(tableName)?.values() || [])
    const unkeyedRows = context.unkeyed.get(tableName) || []
    const rows = [...keyedRows, ...unkeyedRows]
    if (!rows.length) continue
    const chunkSize = 100
    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize)
      await addTableDataFastAsync(tableName, chunk)
      onProgress?.({
        tableName,
        currentRows: Math.min(index + chunk.length, rows.length),
        totalRows: rows.length,
        currentTable: tableIndex + 1,
        totalTables: tableNames.length
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
}

function enqueueTableDataBulkWrite(tableName: string, row: any): boolean {
  const context = activeTableDataBulkWriteContext
  if (!context) return false
  const id = stringValue(row?.id)
  if (!id) {
    const rows = context.unkeyed.get(tableName) || []
    rows.push(row)
    context.unkeyed.set(tableName, rows)
    return true
  }

  const rows = context.tables.get(tableName) || new Map<string, any>()
  rows.set(id, { ...(rows.get(id) || {}), ...row, id })
  context.tables.set(tableName, rows)
  return true
}

export function updateTableRecord(tableName: string, id: string, updatedRecord: any): void {
  const normalizedRecord = normalizeBackendRecord(tableName, updatedRecord)
  const currentData = getTableData(tableName)
  const index = currentData.findIndex((item: any) => item.id === id)
  if (index === -1) return

  const updatedData = [...currentData]
  updatedData[index] = { ...updatedData[index], ...normalizedRecord }
  dataCache[tableName] = updatedData
  onDataUpdate?.(tableName, updatedData)

  if (isBackendMode) {
    dbRpc('updateTableRecord', { tableName, id, updatedRecord: normalizedRecord }).catch(
      (error) => {
        console.error(`更新表 ${tableName} 记录 ${id} 失败:`, error)
      }
    )
    return
  }

  const table = getTable(tableName)
  if (table) {
    db.transaction('rw', table, async () => {
      await table.update(id, normalizedRecord)
    }).catch((error: any) => {
      console.error(`更新表 ${tableName} 记录 ${id} 失败:`, error)
    })
  }
}

export async function updateTableRecordAsync(
  tableName: string,
  id: string,
  updatedRecord: any
): Promise<void> {
  const normalizedRecord = normalizeBackendRecord(tableName, updatedRecord)
  if (isBackendMode) {
    const updated = await dbRpc<boolean>('updateTableRecord', {
      tableName,
      id,
      updatedRecord: normalizedRecord
    })
    if (updated !== true) throw new Error(`记录不存在或未更新: ${tableName}/${id}`)
    delete dataCache[tableName]
    const next = await getTableDataAsync(tableName)
    dataCache[tableName] = [...next]
    onDataUpdate?.(tableName, next)
    return
  }

  const table = getTable(tableName)
  if (!table) {
    console.warn(`表 ${tableName} 不存在`)
    return
  }

  await table.update(id, normalizedRecord)
  const currentData = normalizeBackendRows(tableName, await table.toArray())
  dataCache[tableName] = currentData
  onDataUpdate?.(tableName, currentData)
}

export function deleteTableRecord(tableName: string, id: string): void {
  const currentData = getTableData(tableName)
  const filteredData = currentData.filter((item: any) => item.id !== id)

  dataCache[tableName] = filteredData
  onDataUpdate?.(tableName, filteredData)

  if (isBackendMode) {
    dbRpc('deleteTableRecord', { tableName, id }).catch((error) => {
      console.error(`删除表 ${tableName} 记录 ${id} 失败:`, error)
    })
    return
  }

  const table = getTable(tableName)
  if (table) {
    db.transaction('rw', table, async () => {
      await table.delete(id)
    }).catch((error: any) => {
      console.error(`删除表 ${tableName} 记录 ${id} 失败:`, error)
    })
  }
}

export async function deleteTableRecordAsync(tableName: string, id: string): Promise<void> {
  if (isBackendMode) {
    const deleted = await dbRpc<boolean>('deleteTableRecord', { tableName, id })
    if (deleted !== true) throw new Error(`记录不存在或未删除: ${tableName}/${id}`)
    delete dataCache[tableName]
    const next = await getTableDataAsync(tableName)
    dataCache[tableName] = [...next]
    onDataUpdate?.(tableName, next)
    return
  }

  const table = getTable(tableName)
  if (!table) {
    console.warn(`表 ${tableName} 不存在`)
    return
  }

  await table.delete(id)
  const currentData = await table.toArray()
  dataCache[tableName] = currentData
  onDataUpdate?.(tableName, currentData)
}

export interface EditableCowEvent {
  id: string
  cowId: string
  cowNumber: string
  eventCode: string
  eventType: string
  eventGroup: string
  eventName: string
  occurredAt: string
  operatorName: string
  workOperatorName: string
  status: string
  sourceTable: string
  sourceRecordId: string
  details: Record<string, any>
  raw: Record<string, any>
  sortTime: number
}

export interface EditablePedigree {
  cowId: string
  cowNumber: string
  fatherNumber: string
  motherNumber: string
  paternalGrandfatherNumber: string
  paternalGrandmotherNumber: string
  maternalGrandfatherNumber: string
  maternalGrandmotherNumber: string
  parentageRows: any[]
  cowRow: any | null
  animalRow: any | null
}

export interface CowEditAuditContext {
  operatorId?: string
  operatorName?: string
  reason?: string
}

export interface CowSearchSuggestion {
  value: string
  cowId: string
  cowNumber: string
  cowName: string
  earTagNumber: string
  status: string
  currentPen: string
  aliases: string[]
  aliasSummary: string
  searchText: string
  summary: string
}

export async function searchCowSuggestions(
  query = '',
  options: { limit?: number; silent?: boolean } = {}
): Promise<CowSearchSuggestion[]> {
  const limit = Math.max(1, Math.min(100, Number(options.limit || 30)))
  if (isBackendMode) {
    try {
      const rows = await dbRpc<CowSearchSuggestion[]>(
        'searchCowSuggestions',
        { query, limit },
        { showErrorLog: !options.silent, timeout: 10000 }
      )
      return Array.isArray(rows)
        ? rows.map(normalizeCowSearchSuggestion).filter((item) => item.cowNumber)
        : []
    } catch (error) {
      if (!options.silent) console.warn('后端牛号搜索失败，降级为本地搜索:', error)
    }
  }
  return searchCowSuggestionsLocal(query, limit)
}

export async function getEditableCowEvents(
  cowRefInput:
    | { cowId?: string; cowNumber?: string; animalId?: string; animalNumber?: string }
    | string,
  options: { eventGroup?: string; eventType?: string; limit?: number } = {}
): Promise<EditableCowEvent[]> {
  if (isBackendMode) {
    const backendCowRef = editableCowRefPayload(cowRefInput)
    if (!backendCowRef.cowId && !backendCowRef.cowNumber) return []
    try {
      const rows = await dbRpc<EditableCowEvent[]>(
        'getEditableCowEvents',
        {
          cowId: backendCowRef.cowId,
          cowNumber: backendCowRef.cowNumber,
          eventGroup: options.eventGroup,
          eventType: options.eventType,
          limit: options.limit || 20
        },
        { showErrorLog: false, timeout: 10000 }
      )
      return (Array.isArray(rows) ? rows : [])
        .map((row: any) => normalizeEditableCowEvent(row))
        .sort((left, right) => right.sortTime - left.sortTime)
        .slice(0, Math.max(1, Number(options.limit || 20)))
    } catch (error) {
      console.warn('后端事件修改查询失败，降级为本地过滤:', error)
    }
  }
  const cowRef = await resolveEditableCowRef(cowRefInput)
  if (!cowRef.cowId && !cowRef.cowNumber) return []
  const rows = await getUnifiedCowEventRowsAsync().catch(() => [])
  const eventGroup = stringValue(options.eventGroup)
  const eventType = normalizeEventCode(options.eventType || '')
  const limit = Math.max(1, Number(options.limit || 20))
  return rows
    .map((row: any) => normalizeEditableCowEvent(row))
    .filter((row) => rowMatchesEditableCow(row, cowRef))
    .filter((row) => !eventGroup || eventGroupMatches(row.eventGroup, eventGroup))
    .filter((row) => !eventType || row.eventCode === eventType)
    .sort((left, right) => right.sortTime - left.sortTime)
    .slice(0, limit)
}

export async function updateCowEvent(
  eventId: string,
  payload: {
    occurredAt?: string
    eventStatus?: string
    severity?: string
    notes?: string
    details?: Record<string, any>
    customValues?: Record<string, any>
    eventName?: string
  },
  auditContext: CowEditAuditContext = {}
): Promise<EditableCowEvent> {
  const id = stringValue(eventId)
  if (!id) throw new Error('缺少事件ID')
  const { beforeAnimalEvent, beforeCowEvent } = await getEditableCowEventPair(id)
  const source = beforeAnimalEvent || beforeCowEvent
  if (!source) throw new Error(`未找到事件记录：${id}`)

  const eventCode = normalizeEventCode(
    source.eventCode || source.event_code || source.eventType || source.event_type
  )
  const now = new Date().toISOString()
  const oldDetails = parseDetails(source.details || source.customValues || source.custom_values)
  const nextDetails = {
    ...oldDetails,
    ...(payload.details || {}),
    ...(payload.customValues || {})
  }
  const occurredAt =
    stringValue(payload.occurredAt) ||
    stringValue(source.occurredAt || source.occurred_at || source.eventTime || source.event_time)
  if (occurredAt) {
    nextDetails.eventTime = occurredAt
    nextDetails.event_time = occurredAt
  }
  const status = normalizeEventStatus(
    payload.eventStatus || source.eventStatus || source.event_status || source.status
  )
  const eventName =
    stringValue(payload.eventName || source.eventName || source.event_name) ||
    eventDisplayName(eventCode)
  const animalPatch = normalizeBackendRecord('animal_event', {
    eventName,
    event_name: eventName,
    occurredAt,
    occurred_at: occurredAt,
    eventTime: occurredAt,
    event_time: occurredAt,
    productionDate: occurredAt ? occurredAt.slice(0, 10) : undefined,
    production_date: occurredAt ? occurredAt.slice(0, 10) : undefined,
    severity: payload.severity ?? source.severity,
    notes: payload.notes ?? source.notes ?? '',
    details: nextDetails,
    customValues: nextDetails,
    custom_values: nextDetails,
    status,
    eventStatus: status,
    event_status: status,
    updatedAt: now,
    updated_at: now
  })
  const cowEventPatch = normalizeBackendRecord('cow-events', {
    eventName,
    eventTime: occurredAt,
    occurredAt,
    occurred_at: occurredAt,
    eventStatus: status,
    event_status: status,
    status,
    details: nextDetails,
    notes: payload.notes ?? source.notes ?? '',
    updatedAt: now,
    updated_at: now
  })

  if (beforeAnimalEvent) await updateTableRecordAsync('animal_event', id, animalPatch)
  else {
    const normalized = normalizeEditableEventToAnimalEvent(source, nextDetails, {
      eventName,
      occurredAt,
      status,
      now,
      notes: payload.notes
    })
    await upsertTableDataAsync('animal_event', normalized)
  }

  if (beforeCowEvent) await updateTableRecordAsync('cow-events', id, cowEventPatch)
  else {
    const normalized = normalizeEditableEventToCowEvent(source, nextDetails, {
      eventName,
      occurredAt,
      status,
      now,
      notes: payload.notes
    })
    await upsertTableDataAsync('cow-events', normalized)
  }

  const nextAnimal = {
    ...(beforeAnimalEvent ||
      normalizeEditableEventToAnimalEvent(source, nextDetails, {
        eventName,
        occurredAt,
        status,
        now,
        notes: payload.notes
      })),
    ...animalPatch,
    id
  }
  await writeCowEventDetailTables(nextAnimal, eventCode, nextDetails)
  await scheduleEditableEventRecompute(nextAnimal, eventCode)
  await writeEditAudit(
    'information_event_update',
    'animal_event',
    id,
    nextAnimal,
    beforeAnimalEvent || beforeCowEvent,
    auditContext
  )
  return normalizeEditableCowEvent(nextAnimal)
}

export async function getEditablePedigree(
  cowRefInput:
    | { cowId?: string; cowNumber?: string; animalId?: string; animalNumber?: string }
    | string
): Promise<EditablePedigree> {
  if (isBackendMode) {
    const backendCowRef = editableCowRefPayload(cowRefInput)
    try {
      const row = await dbRpc<EditablePedigree>(
        'getEditablePedigree',
        {
          cowId: backendCowRef.cowId,
          cowNumber: backendCowRef.cowNumber
        },
        { showErrorLog: false, timeout: 10000 }
      )
      if (row && (row.cowId || row.cowNumber)) return normalizeEditablePedigree(row)
    } catch (error) {
      console.warn('后端系谱修改查询失败，降级为本地过滤:', error)
    }
  }
  const cowRef = await resolveEditableCowRef(cowRefInput)
  const [cows, animals, parentRows] = await Promise.all([
    getTableDataAsync('cows', { silent: true }).catch(() => []),
    getTableDataAsync('animal', { silent: true }).catch(() => []),
    getTableDataAsync('animal_parentage', { silent: true }).catch(() => [])
  ])
  const cowRow = (cows || []).find((row: any) => rowMatchesCow(row, cowRef)) || null
  const animalRow = (animals || []).find((row: any) => rowMatchesCow(row, cowRef)) || null
  const cowId = cowRef.cowId || stringValue(cowRow?.id || animalRow?.id)
  const cowNumber =
    cowRef.cowNumber ||
    stringValue(
      cowRow?.cowNumber || cowRow?.cow_number || animalRow?.animalNumber || animalRow?.animal_number
    )
  const matchedParentRows = (parentRows || []).filter((row: any) => {
    const rowAnimalId = stringValue(row.animalId || row.animal_id || row.cowId || row.cow_id)
    const rowAnimalNumber = stringValue(
      row.animalNumber || row.animal_number || row.cowNumber || row.cow_number
    )
    return (!!cowId && rowAnimalId === cowId) || (!!cowNumber && rowAnimalNumber === cowNumber)
  })
  const byRole = (role: string) =>
    matchedParentRows.find(
      (row: any) => stringValue(row.parentRole || row.parent_role).toLowerCase() === role
    )
  return {
    cowId,
    cowNumber,
    fatherNumber: firstText(
      byRole('sire')?.parentNumber,
      byRole('sire')?.parent_number,
      cowRow?.fatherNumber,
      cowRow?.father_number,
      animalRow?.fatherNumber,
      animalRow?.father_number
    ),
    motherNumber: firstText(
      byRole('dam')?.parentNumber,
      byRole('dam')?.parent_number,
      cowRow?.motherNumber,
      cowRow?.mother_number,
      animalRow?.motherNumber,
      animalRow?.mother_number
    ),
    paternalGrandfatherNumber: firstText(
      cowRow?.grandfatherNumber,
      cowRow?.grandfather_number,
      animalRow?.grandfatherNumber,
      animalRow?.grandfather_number
    ),
    paternalGrandmotherNumber: firstText(
      cowRow?.grandmotherNumber,
      cowRow?.grandmother_number,
      animalRow?.grandmotherNumber,
      animalRow?.grandmother_number
    ),
    maternalGrandfatherNumber: firstText(
      cowRow?.maternalGrandfatherNumber,
      cowRow?.maternal_grandfather_number,
      animalRow?.maternalGrandfatherNumber,
      animalRow?.maternal_grandfather_number
    ),
    maternalGrandmotherNumber: firstText(
      cowRow?.maternalGrandmotherNumber,
      cowRow?.maternal_grandmother_number,
      animalRow?.maternalGrandmotherNumber,
      animalRow?.maternal_grandmother_number
    ),
    parentageRows: matchedParentRows,
    cowRow,
    animalRow
  }
}

export async function updateCowPedigree(
  cowRefInput:
    | { cowId?: string; cowNumber?: string; animalId?: string; animalNumber?: string }
    | string,
  payload: Partial<EditablePedigree>,
  auditContext: CowEditAuditContext = {}
): Promise<EditablePedigree> {
  const before = await getEditablePedigree(cowRefInput)
  if (!before.cowId && !before.cowNumber) throw new Error('未找到牛只，无法修改系谱')
  const now = new Date().toISOString()
  const next = {
    fatherNumber: stringValue(payload.fatherNumber),
    motherNumber: stringValue(payload.motherNumber),
    paternalGrandfatherNumber: stringValue(payload.paternalGrandfatherNumber),
    paternalGrandmotherNumber: stringValue(payload.paternalGrandmotherNumber),
    maternalGrandfatherNumber: stringValue(payload.maternalGrandfatherNumber),
    maternalGrandmotherNumber: stringValue(payload.maternalGrandmotherNumber)
  }
  const patch = {
    fatherNumber: next.fatherNumber,
    father_number: next.fatherNumber,
    motherNumber: next.motherNumber,
    mother_number: next.motherNumber,
    grandfatherNumber: next.paternalGrandfatherNumber,
    grandfather_number: next.paternalGrandfatherNumber,
    grandmotherNumber: next.paternalGrandmotherNumber,
    grandmother_number: next.paternalGrandmotherNumber,
    maternalGrandfatherNumber: next.maternalGrandfatherNumber,
    maternal_grandfather_number: next.maternalGrandfatherNumber,
    maternalGrandmotherNumber: next.maternalGrandmotherNumber,
    maternal_grandmother_number: next.maternalGrandmotherNumber,
    updatedAt: now,
    updated_at: now
  }
  await Promise.all([
    before.cowRow?.id
      ? updateTableRecordAsync('cows', stringValue(before.cowRow.id), patch).catch(() => undefined)
      : Promise.resolve(),
    before.animalRow?.id
      ? updateTableRecordAsync('animal', stringValue(before.animalRow.id), patch).catch(
          () => undefined
        )
      : Promise.resolve()
  ])
  await upsertParentageRole(before, 'sire', next.fatherNumber, now)
  await upsertParentageRole(before, 'dam', next.motherNumber, now)
  await writeEditAudit(
    'pedigree_update',
    'animal_parentage',
    before.cowId || before.cowNumber,
    { ...before, ...next },
    before,
    auditContext
  )
  return getEditablePedigree(cowRefInput)
}

async function resolveEditableCowRef(
  input: { cowId?: string; cowNumber?: string; animalId?: string; animalNumber?: string } | string
) {
  const [cows, animals, identifiers] = await Promise.all([
    getTableDataAsync('cows', { silent: true }).catch(() => []),
    getTableDataAsync('animal', { silent: true }).catch(() => []),
    getTableDataAsync('animal_identifier', { silent: true }).catch(() => [])
  ])
  const row =
    typeof input === 'string'
      ? { cowNumber: input, animalNumber: input, identifier: input }
      : {
          cowId: input.cowId || input.animalId,
          animalId: input.animalId || input.cowId,
          cowNumber: input.cowNumber || input.animalNumber,
          animalNumber: input.animalNumber || input.cowNumber
        }
  return resolveCowRef(
    row,
    buildCowReferenceContext([...(cows || []), ...(animals || [])], identifiers || [])
  )
}

function normalizeEditableCowEvent(row: Record<string, any>): EditableCowEvent {
  const details = parseDetails(row.details || row.customValues || row.custom_values)
  const eventCode = normalizeEventCode(
    row.eventCode ||
      row.event_code ||
      row.eventType ||
      row.event_type ||
      details.eventCode ||
      details.event_type
  )
  const occurredAt = stringValue(
    row.occurredAt ||
      row.occurred_at ||
      row.eventTime ||
      row.event_time ||
      details.occurredAt ||
      details.occurred_at ||
      row.createdAt ||
      row.created_at
  )
  const sourceTable = canonicalEventSourceTable(
    row.sourceTable || row.source_table || 'animal_event'
  )
  return {
    id: stringValue(row.id || row.eventId || row.event_id),
    cowId: stringValue(
      row.cowId || row.cow_id || row.animalId || row.animal_id || details.cowId || details.animal_id
    ),
    cowNumber: stringValue(
      row.cowNumber ||
        row.cow_number ||
        row.animalNumber ||
        row.animal_number ||
        details.cowNumber ||
        details.animal_number
    ),
    eventCode,
    eventType: eventCode,
    eventGroup: stringValue(
      row.eventGroup ||
        row.event_group ||
        details.eventGroup ||
        details.event_group ||
        eventGroupOf(eventCode)
    ),
    eventName: stringValue(
      row.eventName ||
        row.event_name ||
        details.eventName ||
        details.event_name ||
        eventDisplayName(eventCode)
    ),
    occurredAt,
    operatorName: stringValue(
      row.operatorName || row.operator_name || details.operatorName || details.operator_name
    ),
    workOperatorName: stringValue(
      row.workOperatorName ||
        row.work_operator_name ||
        details.workOperatorName ||
        details.work_operator_name
    ),
    status: normalizeEventStatus(
      row.eventStatus ||
        row.event_status ||
        row.status ||
        details.eventStatus ||
        details.event_status
    ),
    sourceTable,
    sourceRecordId: stringValue(
      row.sourceRecordId ||
        row.source_record_id ||
        details.sourceRecordId ||
        details.source_record_id ||
        row.id
    ),
    details,
    raw: row,
    sortTime: parseTimeMs(
      row.updatedAt || row.updated_at || occurredAt || row.createdAt || row.created_at
    )
  }
}

function rowMatchesEditableCow(row: EditableCowEvent, cowRef: ReturnType<typeof resolveCowRef>) {
  return (
    (!!cowRef.cowId && row.cowId === cowRef.cowId) ||
    (!!cowRef.cowNumber && row.cowNumber === cowRef.cowNumber)
  )
}

function eventGroupMatches(value: string, expected: string) {
  const map: Record<string, string> = {
    生产: '生产配置',
    production: '生产配置',
    繁殖: 'reproduction',
    reproduction: 'reproduction',
    健康: 'health',
    health: 'health',
    转群: 'movement',
    movement: 'movement',
    采样: 'sample',
    sample: 'sample',
    sampling: 'sample',
    设备: 'device',
    device: 'device',
    育种科研: 'breeding_research',
    breeding_research: 'breeding_research',
    research: 'breeding_research'
  }
  return (map[value] || value) === (map[expected] || expected)
}

function editableCowRefPayload(
  input: { cowId?: string; cowNumber?: string; animalId?: string; animalNumber?: string } | string
) {
  if (typeof input === 'string') {
    return {
      cowId: '',
      animalId: '',
      cowNumber: stringValue(input),
      animalNumber: stringValue(input)
    }
  }
  return {
    cowId: stringValue(input.cowId || input.animalId),
    animalId: stringValue(input.animalId || input.cowId),
    cowNumber: stringValue(input.cowNumber || input.animalNumber),
    animalNumber: stringValue(input.animalNumber || input.cowNumber)
  }
}

async function getEditableCowEventPair(id: string) {
  const [beforeAnimalEvent, beforeCowEvent] = await Promise.all([
    getTableRecordByIdAsync('animal_event', id, { silent: true }).catch(() => null),
    getTableRecordByIdAsync('cow-events', id, { silent: true }).catch(() => null)
  ])
  return { beforeAnimalEvent, beforeCowEvent }
}

async function searchCowSuggestionsLocal(
  query: string,
  limit: number
): Promise<CowSearchSuggestion[]> {
  const [cowRows, animalRows, identifierRows, assignmentRows] = await Promise.all([
    getTableDataAsync('cows', { silent: true }).catch(() => []),
    getTableDataAsync('animal', { silent: true }).catch(() => []),
    getTableDataAsync('animal_identifier', { silent: true }).catch(() => []),
    getTableDataAsync('animal_device_assignment', { silent: true }).catch(() => [])
  ])
  const aliases = buildCowSuggestionAliasMap(identifierRows || [], assignmentRows || [])
  const key = stringValue(query).toLowerCase()
  return uniqueCowSearchSuggestions(
    [...(cowRows || []), ...(animalRows || [])]
      .map((row) =>
        normalizeCowSearchSuggestion({
          ...row,
          aliases: aliases.get(cowSuggestionAliasKey(row)) || []
        })
      )
      .filter((item) => item.cowNumber)
  )
    .filter((item) => !key || item.searchText.includes(key))
    .sort(
      (left, right) => scoreCowSearchSuggestion(right, key) - scoreCowSearchSuggestion(left, key)
    )
    .slice(0, limit)
}

function normalizeCowSearchSuggestion(row: Record<string, any>): CowSearchSuggestion {
  const cowId = stringValue(row.cowId || row.cow_id || row.animalId || row.animal_id || row.id)
  const cowNumber = stringValue(
    row.cowNumber ||
      row.cow_number ||
      row.animalNumber ||
      row.animal_number ||
      row.number ||
      row.value
  )
  const cowName = stringValue(
    row.cowName || row.cow_name || row.name || row.nickName || row.nickname
  )
  const earTagNumber = stringValue(
    row.earTagNumber || row.ear_tag_number || row.earTag || row.ear_tag
  )
  const status = stringValue(row.status || row.productionStage || row.production_stage)
  const currentPen = stringValue(
    row.currentPen ||
      row.current_pen ||
      row.currentPenName ||
      row.current_pen_name ||
      row.currentUnitId ||
      row.current_unit_id ||
      row.currentPenId ||
      row.current_pen_id
  )
  const aliases = uniqueStrings([
    cowId,
    cowNumber,
    earTagNumber,
    cowName,
    stringValue(row.electronicTag || row.electronic_tag),
    stringValue(row.rfid || row.rfidCode || row.rfid_code),
    ...(Array.isArray(row.aliases) ? row.aliases : [])
  ])
  const aliasSummary =
    stringValue(row.aliasSummary || row.alias_summary) ||
    aliases
      .filter(
        (item) => ![cowId, cowNumber, earTagNumber, cowName, status, currentPen].includes(item)
      )
      .slice(0, 4)
      .join(' / ')
  const summary =
    stringValue(row.summary) ||
    [
      earTagNumber ? `耳号 ${earTagNumber}` : '',
      aliasSummary ? `标识 ${aliasSummary.split(' / ')[0]}` : '',
      status,
      currentPen ? `圈舍 ${currentPen}` : ''
    ]
      .filter(Boolean)
      .join(' / ')
  return {
    value: cowNumber,
    cowId,
    cowNumber,
    cowName,
    earTagNumber,
    status,
    currentPen,
    aliases,
    aliasSummary,
    searchText: uniqueStrings([
      cowId,
      cowNumber,
      cowName,
      earTagNumber,
      status,
      currentPen,
      ...aliases
    ])
      .join(' ')
      .toLowerCase(),
    summary
  }
}

function normalizeEditablePedigree(row: EditablePedigree): EditablePedigree {
  return {
    cowId: stringValue(row.cowId || (row as any).cow_id),
    cowNumber: stringValue(row.cowNumber || (row as any).cow_number),
    fatherNumber: stringValue(row.fatherNumber || (row as any).father_number),
    motherNumber: stringValue(row.motherNumber || (row as any).mother_number),
    paternalGrandfatherNumber: stringValue(
      row.paternalGrandfatherNumber || (row as any).paternal_grandfather_number
    ),
    paternalGrandmotherNumber: stringValue(
      row.paternalGrandmotherNumber || (row as any).paternal_grandmother_number
    ),
    maternalGrandfatherNumber: stringValue(
      row.maternalGrandfatherNumber || (row as any).maternal_grandfather_number
    ),
    maternalGrandmotherNumber: stringValue(
      row.maternalGrandmotherNumber || (row as any).maternal_grandmother_number
    ),
    parentageRows: Array.isArray(row.parentageRows) ? row.parentageRows : [],
    cowRow: row.cowRow || null,
    animalRow: row.animalRow || null
  }
}

function buildCowSuggestionAliasMap(identifierRows: any[], assignmentRows: any[]) {
  const map = new Map<string, string[]>()
  const add = (key: unknown, value: unknown) => {
    const normalizedKey = stringValue(key)
    const normalizedValue = stringValue(value)
    if (!normalizedKey || !normalizedValue) return
    map.set(normalizedKey, uniqueStrings([...(map.get(normalizedKey) || []), normalizedValue]))
  }
  identifierRows.forEach((row) => {
    const keys = [
      row.animalId,
      row.animal_id,
      row.cowId,
      row.cow_id,
      row.animalNumber,
      row.animal_number,
      row.cowNumber,
      row.cow_number
    ]
    const values = [
      row.identifierValue,
      row.identifier_value,
      row.value,
      row.number,
      row.rfid,
      row.rfidCode,
      row.rfid_code,
      row.earTagNumber,
      row.ear_tag_number
    ]
    keys.forEach((key) => values.forEach((value) => add(key, value)))
  })
  assignmentRows.forEach((row) => {
    const keys = [
      row.animalId,
      row.animal_id,
      row.cowId,
      row.cow_id,
      row.animalNumber,
      row.cowNumber
    ]
    const values = [row.deviceId, row.device_id, row.rfid, row.rfidCode, row.rfid_code]
    keys.forEach((key) => values.forEach((value) => add(key, value)))
  })
  return map
}

function cowSuggestionAliasKey(row: Record<string, any>) {
  return stringValue(row.id || row.cowId || row.cow_id || row.animalId || row.animal_id)
}

function uniqueCowSearchSuggestions(rows: CowSearchSuggestion[]) {
  const byKey = new Map<string, CowSearchSuggestion>()
  rows.forEach((row) => {
    const key = row.cowId || row.cowNumber || row.earTagNumber
    if (!key) return
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, row)
      return
    }
    const aliases = uniqueStrings([...existing.aliases, ...row.aliases])
    byKey.set(key, {
      ...existing,
      cowNumber: existing.cowNumber || row.cowNumber,
      cowName: existing.cowName || row.cowName,
      earTagNumber: existing.earTagNumber || row.earTagNumber,
      status: existing.status || row.status,
      currentPen: existing.currentPen || row.currentPen,
      aliases,
      aliasSummary: uniqueStrings([existing.aliasSummary, row.aliasSummary])
        .join(' / ')
        .split(' / ')
        .filter(Boolean)
        .slice(0, 4)
        .join(' / '),
      searchText: uniqueStrings([
        existing.searchText,
        row.searchText,
        existing.cowNumber || row.cowNumber,
        existing.earTagNumber || row.earTagNumber,
        existing.cowName || row.cowName,
        existing.currentPen || row.currentPen,
        ...aliases
      ])
        .join(' ')
        .toLowerCase()
    })
  })
  return Array.from(byKey.values()).sort((left, right) =>
    left.cowNumber.localeCompare(right.cowNumber, 'zh-CN', { numeric: true })
  )
}

function scoreCowSearchSuggestion(item: CowSearchSuggestion, key: string) {
  if (!key) return 0
  if (item.cowNumber.toLowerCase() === key) return 100
  if (item.cowNumber.toLowerCase().startsWith(key)) return 80
  if (item.earTagNumber.toLowerCase().startsWith(key)) return 70
  if (item.aliases.some((alias) => alias.toLowerCase() === key)) return 65
  if (item.searchText.includes(key)) return 30
  return 0
}

function normalizeEditableEventToAnimalEvent(
  source: Record<string, any>,
  details: Record<string, any>,
  meta: { eventName: string; occurredAt: string; status: string; now: string; notes?: string }
) {
  const eventCode = normalizeEventCode(
    source.eventCode || source.event_code || source.eventType || source.event_type
  )
  return normalizeBackendRecord('animal_event', {
    ...source,
    id: source.id,
    animalId: source.animalId || source.animal_id || source.cowId || source.cow_id,
    animal_id: source.animal_id || source.animalId || source.cow_id || source.cowId,
    cowId: source.cowId || source.cow_id || source.animalId || source.animal_id,
    cow_id: source.cow_id || source.cowId || source.animal_id || source.animalId,
    animalNumber:
      source.animalNumber || source.animal_number || source.cowNumber || source.cow_number,
    animal_number:
      source.animal_number || source.animalNumber || source.cow_number || source.cowNumber,
    cowNumber: source.cowNumber || source.cow_number || source.animalNumber || source.animal_number,
    cow_number:
      source.cow_number || source.cowNumber || source.animal_number || source.animalNumber,
    eventType: eventCode,
    event_type: eventCode,
    eventCode,
    event_code: eventCode,
    eventGroup: source.eventGroup || source.event_group || eventGroupOf(eventCode),
    event_group: source.event_group || source.eventGroup || eventGroupOf(eventCode),
    eventName: meta.eventName,
    event_name: meta.eventName,
    occurredAt: meta.occurredAt,
    occurred_at: meta.occurredAt,
    eventTime: meta.occurredAt,
    event_time: meta.occurredAt,
    productionDate: meta.occurredAt ? meta.occurredAt.slice(0, 10) : undefined,
    production_date: meta.occurredAt ? meta.occurredAt.slice(0, 10) : undefined,
    details,
    customValues: details,
    custom_values: details,
    status: meta.status,
    eventStatus: meta.status,
    event_status: meta.status,
    notes: meta.notes ?? source.notes ?? '',
    updatedAt: meta.now,
    updated_at: meta.now
  })
}

function normalizeEditableEventToCowEvent(
  source: Record<string, any>,
  details: Record<string, any>,
  meta: { eventName: string; occurredAt: string; status: string; now: string; notes?: string }
) {
  const eventCode = normalizeEventCode(
    source.eventCode || source.event_code || source.eventType || source.event_type
  )
  return normalizeBackendRecord('cow-events', {
    ...source,
    id: source.id,
    cowId: source.cowId || source.cow_id || source.animalId || source.animal_id,
    cowNumber: source.cowNumber || source.cow_number || source.animalNumber || source.animal_number,
    eventType: eventCode,
    eventCode,
    eventGroup: source.eventGroup || source.event_group || eventGroupOf(eventCode),
    eventName: meta.eventName,
    eventTime: meta.occurredAt,
    occurredAt: meta.occurredAt,
    occurred_at: meta.occurredAt,
    details,
    status: meta.status,
    eventStatus: meta.status,
    event_status: meta.status,
    notes: meta.notes ?? source.notes ?? '',
    updatedAt: meta.now,
    updated_at: meta.now
  })
}

async function scheduleEditableEventRecompute(animalEvent: Record<string, any>, eventCode: string) {
  if (
    ![
      'calving',
      'abortion',
      'insemination',
      'pregnancy_check',
      'dry_off',
      'entry',
      'transfer',
      'exit',
      'death'
    ].includes(eventCode)
  )
    return
  const now = new Date().toISOString()
  const eventId = stringValue(animalEvent.id)
  const recomputeId = compactRecordId('recompute', eventId, 'edit')
  const targets = ['parity_episode', 'lactation_episode', 'animal_time_index', 'fact_lactation_305']
  await upsertTableDataAsync('derivation_recompute_job', {
    id: recomputeId,
    jobCode: recomputeId,
    job_code: recomputeId,
    derivationDomain: 'production_cycle',
    derivation_domain: 'production_cycle',
    targetTable: targets.join(','),
    target_table: targets.join(','),
    animalId: animalEvent.animalId || animalEvent.animal_id,
    animal_id: animalEvent.animalId || animalEvent.animal_id,
    cowNumber: animalEvent.cowNumber || animalEvent.cow_number,
    cow_number: animalEvent.cowNumber || animalEvent.cow_number,
    triggerType: 'manual_edit',
    trigger_type: 'manual_edit',
    triggerSource: 'animal_event',
    trigger_source: 'animal_event',
    sourceTable: 'animal_event',
    source_table: 'animal_event',
    sourceRecordId: eventId,
    source_record_id: eventId,
    triggerRecordId: eventId,
    trigger_record_id: eventId,
    targets,
    periodType: eventCode === 'calving' ? 'parity' : 'event',
    period_type: eventCode === 'calving' ? 'parity' : 'event',
    status: 'pending',
    jobStatus: 'pending',
    job_status: 'pending',
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
  import('./production-facts')
    .then(({ scheduleProductionFactRebuild }) =>
      scheduleProductionFactRebuild(`animal_event:${eventId}:edit`)
    )
    .catch(() => undefined)
}

async function upsertParentageRole(
  before: EditablePedigree,
  role: 'sire' | 'dam',
  parentNumber: string,
  now: string
) {
  const existing = before.parentageRows.find(
    (row) => stringValue(row.parentRole || row.parent_role).toLowerCase() === role
  )
  const id =
    stringValue(existing?.id) ||
    compactRecordId('parentage', before.cowId || before.cowNumber, role)
  await upsertTableDataAsync('animal_parentage', {
    ...(existing || {}),
    id,
    animalId: before.cowId,
    animal_id: before.cowId,
    animalNumber: before.cowNumber,
    animal_number: before.cowNumber,
    cowId: before.cowId,
    cow_id: before.cowId,
    cowNumber: before.cowNumber,
    cow_number: before.cowNumber,
    parentNumber,
    parent_number: parentNumber,
    parentRole: role,
    parent_role: role,
    sourceType: existing?.sourceType || existing?.source_type || 'manual_edit',
    source_type: existing?.source_type || existing?.sourceType || 'manual_edit',
    updatedAt: now,
    updated_at: now,
    createdAt: existing?.createdAt || existing?.created_at || now,
    created_at: existing?.created_at || existing?.createdAt || now
  })
}

async function writeEditAudit(
  actionType: string,
  targetType: string,
  targetId: string,
  after: unknown,
  before: unknown,
  auditContext: CowEditAuditContext
) {
  const now = new Date().toISOString()
  const operatorName = stringValue(auditContext.operatorName) || '当前用户'
  const operatorId = stringValue(auditContext.operatorId) || operatorName
  const cowId = stringValue(
    (after as any)?.cowId ||
      (after as any)?.cow_id ||
      (after as any)?.animalId ||
      (after as any)?.animal_id
  )
  const cowNumber = stringValue(
    (after as any)?.cowNumber ||
      (after as any)?.cow_number ||
      (after as any)?.animalNumber ||
      (after as any)?.animal_number
  )
  const auditId = compactRecordId('op_audit', actionType, targetType, targetId, now)
  const requestPayload = {
    reason: stringValue(auditContext.reason),
    before: safeAuditSnapshot(before),
    after: safeAuditSnapshot(after)
  }
  const common = {
    id: auditId,
    actionType,
    action_type: actionType,
    targetType,
    target_type: targetType,
    targetId,
    target_id: targetId,
    animalId: cowId,
    animal_id: cowId,
    operatorId,
    operator_id: operatorId,
    operatorName,
    operator_name: operatorName,
    operator: operatorName,
    operatedAt: now,
    operated_at: now,
    status: 'completed',
    requestPayload,
    request_payload: requestPayload,
    resultPayload: { ok: true, cowId, cowNumber },
    result_payload: { ok: true, cowId, cowNumber },
    cowIds: [cowId || cowNumber].filter(Boolean),
    cow_ids: [cowId || cowNumber].filter(Boolean),
    sourceRecordIds: { [targetType]: [targetId] },
    source_record_ids: { [targetType]: [targetId] },
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }
  await Promise.all([
    addTableDataAsync('operation_audit_log', common).catch(() => undefined),
    addTableDataAsync('operation-audit-logs', common).catch(() => undefined)
  ])
}

function safeAuditSnapshot(value: unknown) {
  if (value === null || value === undefined) return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

function parseTimeMs(value: unknown) {
  const time = Date.parse(stringValue(value))
  return Number.isFinite(time) ? time : 0
}

function normalizeEventCode(value: unknown): string {
  const text = String(value ?? '').trim()
  const lower = text.toLowerCase()
  const map: Record<string, string> = {
    heat: 'heat',
    发情: 'heat',
    breeding: 'insemination',
    配种: 'insemination',
    人工授精: 'insemination',
    insemination: 'insemination',
    pregnancy_check: 'pregnancy_check',
    妊检: 'pregnancy_check',
    妊娠检查: 'pregnancy_check',
    calving: 'calving',
    产犊: 'calving',
    delivery: 'calving',
    abortion: 'abortion',
    流产: 'abortion',
    postpartum_check: 'postpartum_check',
    产后检查: 'postpartum_check',
    embryo_transfer: 'embryo_transfer',
    胚胎移植: 'embryo_transfer',
    entry: 'entry',
    入群: 'entry',
    transfer: 'transfer',
    转群: 'transfer',
    exit: 'exit',
    离群: 'exit',
    '离群/淘汰': 'exit',
    出群: 'exit',
    淘汰: 'exit',
    treatment: 'treatment',
    治疗: 'treatment',
    medication: 'medication',
    用药: 'medication',
    vaccination: 'vaccination',
    免疫: 'vaccination',
    diagnosis: 'diagnosis',
    发病: 'diagnosis',
    疾病诊断: 'diagnosis',
    death: 'death',
    死亡: 'death',
    veterinary: 'veterinary',
    surgery: 'surgery',
    手术: 'surgery',
    health_check: 'health_check',
    检查: 'health_check',
    deworming: 'deworming',
    驱虫: 'deworming',
    quarantine: 'quarantine',
    隔离: 'quarantine',
    disinfection: 'disinfection',
    消毒: 'disinfection',
    lab_test: 'lab_test',
    实验室检测: 'lab_test',
    hoof_trim: 'hoof_trim',
    修蹄: 'hoof_trim',
    mastitis_check: 'mastitis_check',
    乳房炎检查: 'mastitis_check',
    milking: 'milking',
    泌乳: 'milking',
    milking_session: 'milking_session',
    采奶: 'milking_session',
    milk_quality: 'milk_quality',
    奶质检测: 'milk_quality',
    dhi_test: 'dhi_test',
    dhi: 'dhi_test',
    feeding: 'feeding',
    饲喂: 'feeding',
    feed_delivery: 'feed_delivery',
    投料: 'feed_delivery',
    feed_adjustment: 'feed_adjustment',
    日粮调整: 'feed_adjustment',
    weighing: 'weighing',
    称重: 'weighing',
    body_measurement: 'body_measurement',
    体尺测定: 'body_measurement',
    dry_off: 'dry_off',
    停产: 'dry_off',
    干奶: 'dry_off',
    sample_collection: 'sample_collection',
    样本采集: 'sample_collection',
    sensor_alert: 'sensor_alert',
    传感器告警: 'sensor_alert',
    device_maintenance: 'device_maintenance',
    设备维护: 'device_maintenance',
    device_assignment: 'device_assignment',
    设备绑定: 'device_assignment',
    device_unassignment: 'device_unassignment',
    设备解绑: 'device_unassignment',
    mating_plan: 'mating_plan',
    选配方案: 'mating_plan',
    semen_check: 'semen_check',
    精液检查: 'semen_check',
    genotyping: 'genotyping',
    基因分型: 'genotyping',
    sequencing: 'sequencing',
    测序: 'sequencing',
    omics_assay: 'omics_assay',
    组学检测: 'omics_assay',
    breeding_value_run: 'breeding_value_run',
    育种值计算: 'breeding_value_run',
    selection_index_update: 'selection_index_update',
    选择指数更新: 'selection_index_update'
  }
  return map[text] || map[lower] || text || 'general_event'
}

function eventGroupOf(eventCode: string): string {
  if (
    [
      'heat',
      'insemination',
      'pregnancy_check',
      'calving',
      'abortion',
      'postpartum_check',
      'embryo_transfer'
    ].includes(eventCode)
  )
    return 'reproduction'
  if (
    [
      'diagnosis',
      'treatment',
      'medication',
      'vaccination',
      'deworming',
      'quarantine',
      'disinfection',
      'lab_test',
      'hoof_trim',
      'mastitis_check',
      'health_check',
      'death',
      'veterinary',
      'surgery'
    ].includes(eventCode)
  )
    return 'health'
  if (['entry', 'transfer', 'exit'].includes(eventCode)) return 'movement'
  if (
    [
      'milking',
      'milking_session',
      'milk_quality',
      'dhi_test',
      'feeding',
      'feed_delivery',
      'feed_adjustment',
      'feed_intake',
      'water_intake',
      'weighing',
      'body_measurement',
      'dry_off'
    ].includes(eventCode)
  )
    return '生产配置'
  if (['sample_collection'].includes(eventCode)) return 'sample'
  if (
    ['sensor_alert', 'device_maintenance', 'device_assignment', 'device_unassignment'].includes(
      eventCode
    )
  )
    return 'device'
  if (
    [
      'mating_plan',
      'semen_check',
      'genotyping',
      'sequencing',
      'omics_assay',
      'breeding_value_run',
      'selection_index_update'
    ].includes(eventCode)
  )
    return 'breeding_research'
  return 'general'
}

function eventDisplayName(eventCode: string): string {
  const map: Record<string, string> = {
    heat: '发情',
    insemination: '输精/配种',
    pregnancy_check: '妊检',
    calving: '产犊',
    abortion: '流产',
    postpartum_check: '产后检查',
    embryo_transfer: '胚胎移植',
    entry: '入群',
    transfer: '转群',
    exit: '离群',
    diagnosis: '诊断',
    treatment: '治疗',
    medication: '用药',
    vaccination: '疫苗',
    deworming: '驱虫',
    quarantine: '隔离',
    disinfection: '消毒',
    lab_test: '实验室检测',
    hoof_trim: '修蹄',
    mastitis_check: '乳房炎检查',
    health_check: '健康检查',
    death: '死亡',
    milking: '采奶',
    milk_quality: '奶质检测',
    dhi_test: 'DHI',
    feeding: '饲喂',
    feed_delivery: '投料',
    feed_adjustment: '日粮调整',
    weighing: '称重',
    body_measurement: '体尺测定',
    dry_off: '停产',
    sample_collection: '采样',
    sensor_alert: '传感器告警',
    device_maintenance: '设备维护',
    device_assignment: '设备绑定',
    device_unassignment: '设备解绑',
    mating_plan: '选配方案',
    semen_check: '精液检查',
    genotyping: '基因分型',
    sequencing: '测序',
    omics_assay: '组学检测',
    breeding_value_run: '育种值计算',
    selection_index_update: '选择指数更新'
  }
  return map[eventCode] || eventCode || '通用事件'
}

function firstText(...values: unknown[]) {
  return values.map((value) => stringValue(value)).find(Boolean) || ''
}

function optionalForeignAnimalId(...values: unknown[]) {
  const value = firstText(...values)
  if (!value) return null
  return /^animal[-_]/i.test(value) ? value : null
}

function jsonDetail(value: unknown) {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ value: stringValue(value) })
  }
}

function stableHash(value: unknown) {
  const source = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function compactRecordId(prefix: string, ...parts: unknown[]) {
  const cleanPrefix =
    stringValue(prefix)
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 18) || 'row'
  const raw = parts
    .map((part) => stringValue(part))
    .filter(Boolean)
    .join('-')
  const cleaned = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (cleaned && cleaned.length <= 64) return cleaned
  const hash = stableHash(raw || `${cleanPrefix}-${Date.now()}-${Math.random()}`)
  const headLength = Math.max(0, 64 - cleanPrefix.length - hash.length - 2)
  const head = cleaned.slice(0, headLength).replace(/-$/g, '')
  return [cleanPrefix, head, hash].filter(Boolean).join('-').slice(0, 64)
}

function limitedText(value: unknown, length = 64) {
  return stringValue(value).slice(0, length)
}

function nullableLimitedText(value: unknown, length = 64) {
  const result = limitedText(value, length)
  return result || null
}

function normalizeAnimalSex(value: unknown) {
  const raw = stringValue(value)
  if (['公', '雄', 'male', 'm', 'bull'].includes(raw.toLowerCase())) return '公'
  if (['母', '雌', 'female', 'f', 'cow'].includes(raw.toLowerCase())) return '母'
  return raw || '母'
}

function findAnimalRow(
  rows: any[] = [],
  cowRef: ReturnType<typeof resolveCowRef>,
  cowNumber = '',
  earTagNumber = ''
) {
  const id = stringValue(cowRef.cowId)
  const number = stringValue(cowNumber || cowRef.cowNumber)
  const earTag = stringValue(earTagNumber)
  return (
    rows.find((row: any) => {
      const rowId = stringValue(row.id || row.cowId || row.cow_id || row.animalId || row.animal_id)
      const rowNumber = stringValue(
        row.animalNumber || row.animal_number || row.cowNumber || row.cow_number || row.number
      )
      const rowEarTag = stringValue(
        row.earTagNumber || row.ear_tag_number || row.earTag || row.ear_tag
      )
      return (
        (!!id && rowId === id) ||
        (!!number && rowNumber === number) ||
        (!!earTag && rowEarTag === earTag)
      )
    }) || null
  )
}

function findAnimalByNumber(rows: any[] = [], parentNumber = '') {
  const target = stringValue(parentNumber)
  if (!target) return null
  return (
    rows.find((row: any) => {
      const rowNumber = stringValue(
        row.animalNumber || row.animal_number || row.cowNumber || row.cow_number || row.number
      )
      const rowEarTag = stringValue(
        row.earTagNumber || row.ear_tag_number || row.earTag || row.ear_tag
      )
      const rowId = stringValue(row.id || row.cowId || row.cow_id || row.animalId || row.animal_id)
      return rowNumber === target || rowEarTag === target || rowId === target
    }) || null
  )
}

function targetUnitFromDetails(details: Record<string, any>) {
  return firstText(
    details.to_unit_code,
    details.toUnitCode,
    details.to_unit_id,
    details.toUnitId,
    details.toPenId,
    details.to_pen_id,
    details.toPen,
    details.to_pen,
    details.targetPen,
    details.target_pen,
    details.pen,
    details.unit_code,
    details.unitCode,
    details.unit_id,
    details.unitId,
    details['目标圈舍']
  )
}

function farmUnitMatches(row: Record<string, any>, target: string) {
  const value = stringValue(target)
  if (!value) return false
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
    row.unitName,
    row.unit_name
  ].some((item) => stringValue(item) === value)
}

function penMatches(row: Record<string, any>, target: string) {
  const value = stringValue(target)
  if (!value) return false
  return [
    row.id,
    row.penId,
    row.pen_id,
    row.code,
    row.penCode,
    row.pen_code,
    row.unitId,
    row.unit_id,
    row.unitCode,
    row.unit_code,
    row.name,
    row.penName,
    row.pen_name,
    row.unitName,
    row.unit_name
  ].some((item) => stringValue(item) === value)
}

async function ensureFarmUnitForAssignment(unitId: string, details: Record<string, any>) {
  const target = limitedText(unitId)
  if (!target) return ''

  const farmUnits = await getTableDataAsync('farm_unit', { silent: true }).catch(() => [])
  const existing = farmUnits.find((row: any) => farmUnitMatches(row, target))
  if (existing) {
    return limitedText(
      existing.id || existing.unitId || existing.unit_id || existing.code || target
    )
  }

  const pens = await getTableDataAsync('pens', { silent: true }).catch(() => [])
  const matchedPen = pens.find((row: any) => penMatches(row, target)) || {}
  const canonicalUnitId = limitedText(
    firstText(
      matchedPen.id,
      matchedPen.unitId,
      matchedPen.unit_id,
      matchedPen.code,
      matchedPen.unitCode,
      matchedPen.unit_code,
      matchedPen.penCode,
      matchedPen.pen_code,
      target
    )
  )
  const now = new Date().toISOString()
  const name = limitedText(
    firstText(
      details.unitName,
      details.unit_name,
      details.toUnitName,
      details.to_unit_name,
      details.targetPenName,
      details.target_pen_name,
      details['目标圈舍名称'],
      matchedPen.name,
      matchedPen.penName,
      matchedPen.pen_name,
      matchedPen.unitName,
      matchedPen.unit_name,
      target
    ),
    128
  )
  const category = limitedText(
    firstText(
      matchedPen.category,
      matchedPen.categoryName,
      matchedPen.category_name,
      matchedPen.type,
      matchedPen.unitType,
      matchedPen.unit_type,
      details.unitCategory,
      details.unit_category,
      details.penCategory,
      details.pen_category
    ),
    64
  )
  const capacityText = firstText(matchedPen.capacity, details.capacity)
  const capacity = Number(capacityText)

  await upsertTableDataAsync('farm_unit', {
    id: canonicalUnitId,
    code: canonicalUnitId,
    unitId: canonicalUnitId,
    unit_id: canonicalUnitId,
    unitCode: canonicalUnitId,
    unit_code: canonicalUnitId,
    unitName: name,
    unit_name: name,
    name,
    unitType: 'pen',
    unit_type: 'pen',
    category,
    categoryName: category,
    capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : undefined,
    status: 'active',
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
  return canonicalUnitId
}

function animalNumberFromPayload(
  eventData: any,
  details: Record<string, any>,
  cowRef?: ReturnType<typeof resolveCowRef>
) {
  return firstText(
    eventData.cowNumber,
    eventData.cow_number,
    eventData.animalNumber,
    eventData.animal_number,
    eventData.number,
    eventData['牛号'],
    details.cowNumber,
    details.cow_number,
    details.animalNumber,
    details.animal_number,
    details.number,
    details['牛号'],
    cowRef?.cowNumber
  )
}

function animalIdFromPayload(
  eventData: any,
  details: Record<string, any>,
  cowRef?: ReturnType<typeof resolveCowRef>
) {
  return firstText(
    eventData.cowId,
    eventData.cow_id,
    eventData.animalId,
    eventData.animal_id,
    eventData['牛只ID'],
    details.cowId,
    details.cow_id,
    details.animalId,
    details.animal_id,
    details['牛只ID'],
    cowRef?.cowId
  )
}

async function writeAnimalIdentifier(
  animalId: string,
  identifierType: string,
  identifierValue: string,
  isPrimary = false
) {
  if (!animalId || !identifierValue) return
  const now = new Date().toISOString()
  await upsertTableDataAsync('animal_identifier', {
    id: compactRecordId('identifier', animalId, identifierType, identifierValue),
    animalId,
    animal_id: animalId,
    identifierType,
    identifier_type: identifierType,
    identifierValue,
    identifier_value: identifierValue,
    validFrom: now,
    valid_from: now,
    isPrimary,
    is_primary: isPrimary,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
}

async function writeAnimalParentage(
  animalId: string,
  parentNumber: string,
  parentRole: 'sire' | 'dam',
  animals: any[],
  sourceType: string,
  effectiveDate: string,
  notes = ''
) {
  if (!animalId || !parentNumber) return
  const now = new Date().toISOString()
  const parent = findAnimalByNumber(animals, parentNumber)
  const parentAnimalId = parent
    ? stringValue(parent.id || parent.animalId || parent.animal_id || parent.cowId || parent.cow_id)
    : ''
  await upsertTableDataAsync('animal_parentage', {
    id: compactRecordId('parentage', animalId, parentRole),
    animalId,
    animal_id: animalId,
    parentAnimalId,
    parent_animal_id: parentAnimalId || null,
    parentNumber: limitedText(parentNumber),
    parent_number: limitedText(parentNumber),
    parentRole,
    parent_role: parentRole,
    sourceType,
    source_type: sourceType,
    verificationMethod: parentAnimalId ? 'matched_local_animal' : 'external_or_unknown_number',
    verification_method: parentAnimalId ? 'matched_local_animal' : 'external_or_unknown_number',
    confidence: parentAnimalId ? 0.9 : 0.5,
    effectiveDate,
    effective_date: effectiveDate,
    notes,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
}

async function ensureAnimalRecordForEvent(input: {
  eventData: any
  eventCode: string
  eventTime: string
  details: Record<string, any>
  cowRef: ReturnType<typeof resolveCowRef>
  cows: any[]
  animals: any[]
}): Promise<ReturnType<typeof resolveCowRef>> {
  const { eventData, eventCode, eventTime, details, cowRef, cows, animals } = input
  const eventName = eventDisplayName(eventCode)
  const cowNumber = animalNumberFromPayload(eventData, details, cowRef)
  const earTagNumber = firstText(
    eventData.earTagNumber,
    eventData.ear_tag_number,
    details.ear_tag_number,
    details.earTagNumber,
    details['耳号']
  )
  const entryExistingAnimal =
    eventCode === 'entry'
      ? findAnimalRow(animals, { ...cowRef, cowId: '', cowNumber: '' }, cowNumber, earTagNumber)
      : null
  const entryExistingLegacy =
    eventCode === 'entry'
      ? findAnimalRow(cows, { ...cowRef, cowId: '', cowNumber: '' }, cowNumber, earTagNumber)
      : null
  if (eventCode === 'entry' && (entryExistingAnimal || entryExistingLegacy)) {
    throw new Error(`入群是新牛建档，牛号或耳号已存在：${cowNumber || earTagNumber}`)
  }

  const existingAnimal =
    eventCode === 'entry' ? null : findAnimalRow(animals, cowRef, cowNumber, earTagNumber)
  if (existingAnimal) {
    return resolveCowRef(existingAnimal, buildCowReferenceContext([existingAnimal], []))
  }

  const existingLegacy =
    eventCode === 'entry' ? null : findAnimalRow(cows, cowRef, cowNumber, earTagNumber)
  if (!existingLegacy && eventCode !== 'entry') {
    throw new Error(`${eventName}需要选择已在系统中的牛只；入群前的新牛请走“入群”录入。`)
  }
  if (!cowNumber && !existingLegacy) {
    throw new Error('入群需要填写新牛号或个体编号。')
  }

  const now = new Date().toISOString()
  const sourceCow = existingLegacy || {}
  const normalizedEarTagNumber = nullableLimitedText(
    earTagNumber || sourceCow.earTagNumber || sourceCow.ear_tag_number || sourceCow.earTag
  )
  const animalId = limitedText(
    animalIdFromPayload(eventData, details, cowRef) ||
      stringValue(sourceCow.id || sourceCow.cowId || sourceCow.cow_id) ||
      compactRecordId('animal', cowNumber || earTagNumber || eventTime)
  )
  const animalNumber = limitedText(
    cowNumber ||
      stringValue(
        sourceCow.cowNumber ||
          sourceCow.cow_number ||
          sourceCow.animalNumber ||
          sourceCow.animal_number ||
          sourceCow.number
      )
  )
  const entryDate = String(eventTime || now).slice(0, 10)
  const targetUnit = targetUnitFromDetails(details)
  const sex = normalizeAnimalSex(
    firstText(
      eventData.sex,
      eventData.gender,
      details.sex,
      details.gender,
      details['性别'],
      sourceCow.gender,
      sourceCow.sex
    )
  )
  const breed = requireSupportedCattleBreed(
    firstText(eventData.breed, details.breed, details['品种'], sourceCow.breed) ||
      DEFAULT_CATTLE_BREED
  )
  const birthDate = firstText(
    eventData.birthDate,
    eventData.birth_date,
    details.birth_date,
    details.birthDate,
    details['出生日期'],
    sourceCow.birthDate,
    sourceCow.birth_date
  )
  const stage =
    firstText(
      details.target_stage,
      details.targetStage,
      details.current_stage_code,
      details.currentStageCode,
      sourceCow.currentStageCode,
      sourceCow.cowType,
      sourceCow.type
    ) || '犊牛'
  const fatherNumber = firstText(
    eventData.fatherNumber,
    eventData.father_number,
    eventData.sireNumber,
    eventData.sire_number,
    details.father_number,
    details.fatherNumber,
    details.sire_number,
    details.sireNumber,
    details['父号']
  )
  const motherNumber = firstText(
    eventData.motherNumber,
    eventData.mother_number,
    eventData.damNumber,
    eventData.dam_number,
    details.mother_number,
    details.motherNumber,
    details.dam_number,
    details.damNumber,
    details['母号']
  )

  if (!animalNumber) throw new Error('入群需要填写新牛号或个体编号。')

  await upsertTableDataAsync('animal', {
    id: animalId,
    animalId,
    animal_id: animalId,
    cowId: animalId,
    cow_id: animalId,
    animalNumber,
    animal_number: animalNumber,
    cowNumber: animalNumber,
    cow_number: animalNumber,
    earTagNumber: normalizedEarTagNumber,
    ear_tag_number: normalizedEarTagNumber,
    name: firstText(
      eventData.name,
      details.name,
      details['名称'],
      sourceCow.name,
      sourceCow.cowName
    ),
    species: CATTLE_SPECIES_NAME,
    breed,
    sex,
    birthDate: birthDate || null,
    birth_date: birthDate || null,
    entryDate,
    entry_date: entryDate,
    currentStageId: stage,
    current_stage_id: stage,
    currentUnitId: targetUnit,
    current_unit_id: targetUnit,
    currentPenId: targetUnit,
    current_pen_id: targetUnit,
    status: eventCode === 'entry' ? '在群' : firstText(sourceCow.status) || '在群',
    notes: firstText(details.notes, eventData.notes),
    createdAt: firstText(sourceCow.createdAt, sourceCow.created_at) || now,
    created_at: firstText(sourceCow.createdAt, sourceCow.created_at) || now,
    updatedAt: now,
    updated_at: now
  })

  await upsertTableDataAsync('cows', {
    id: animalId,
    cowId: animalId,
    cow_id: animalId,
    animalId,
    animal_id: animalId,
    cowNumber: animalNumber,
    cow_number: animalNumber,
    animalNumber,
    animal_number: animalNumber,
    earTagNumber: normalizedEarTagNumber,
    ear_tag_number: normalizedEarTagNumber,
    fatherNumber: limitedText(fatherNumber || sourceCow.fatherNumber || sourceCow.father_number),
    father_number: limitedText(fatherNumber || sourceCow.fatherNumber || sourceCow.father_number),
    motherNumber: limitedText(motherNumber || sourceCow.motherNumber || sourceCow.mother_number),
    mother_number: limitedText(motherNumber || sourceCow.motherNumber || sourceCow.mother_number),
    breed,
    gender: sex,
    sex,
    birthDate: birthDate || null,
    birth_date: birthDate || null,
    type: stage,
    cowType: stage,
    cow_type: stage,
    currentPen: targetUnit,
    current_pen: targetUnit,
    currentPenId: targetUnit,
    current_pen_id: targetUnit,
    currentPenCode: targetUnit,
    current_pen_code: targetUnit,
    currentUnitId: targetUnit,
    current_unit_id: targetUnit,
    status: eventCode === 'entry' ? '在群' : firstText(sourceCow.status) || '在群',
    pregnancy: sourceCow.pregnancy ?? false,
    parity: Number(sourceCow.parity || sourceCow.parityNo || sourceCow.parity_no || 0),
    createdAt: firstText(sourceCow.createdAt, sourceCow.created_at) || now,
    created_at: firstText(sourceCow.createdAt, sourceCow.created_at) || now,
    updatedAt: now,
    updated_at: now
  })

  await writeAnimalIdentifier(animalId, 'animal_number', animalNumber, true)
  if (earTagNumber) await writeAnimalIdentifier(animalId, '耳标', earTagNumber)
  await writeAnimalParentage(
    animalId,
    fatherNumber,
    'sire',
    animals,
    eventCode === 'entry' ? 'entry_record' : 'legacy_mirror',
    entryDate,
    '父号可为本场牛号、外部公牛号或未知来源编号'
  )
  await writeAnimalParentage(
    animalId,
    motherNumber,
    'dam',
    animals,
    eventCode === 'entry' ? 'entry_record' : 'legacy_mirror',
    entryDate,
    '母号可为本场牛号、外部母牛号或未知来源编号'
  )

  return {
    cowId: animalId,
    cowNumber: animalNumber,
    cowName: firstText(eventData.name, details.name, sourceCow.name, sourceCow.cowName),
    cow: {
      ...sourceCow,
      id: animalId,
      cowId: animalId,
      animalId,
      cowNumber: animalNumber,
      animalNumber,
      earTagNumber: normalizedEarTagNumber || ''
    },
    resolved: true,
    sourceKey: animalId,
    originalCowId: cowRef.originalCowId,
    originalCowNumber: cowRef.originalCowNumber || animalNumber,
    resolvedBy: existingLegacy ? 'legacyCowMirror' : 'entryCreate',
    identifierType: 'animal_number'
  }
}

function normalizeCalfRows(details: Record<string, any>) {
  const rawRows = Array.isArray(details.calves)
    ? details.calves
    : Array.isArray(details.calfRows)
      ? details.calfRows
      : []
  const rows = rawRows.map((row: any) => ({
    cowNumber: firstText(
      row.cowNumber,
      row.cow_number,
      row.animalNumber,
      row.animal_number,
      row.calfNumber,
      row.calf_number
    ),
    earTagNumber: firstText(row.earTagNumber, row.ear_tag_number, row.earTag, row.ear_tag),
    sex: normalizeAnimalSex(firstText(row.sex, row.gender, row.calfSex, row.calf_sex)),
    birthWeight: firstText(row.birthWeight, row.birth_weight),
    remark: firstText(row.remark, row.notes, row.note)
  }))
  const singleCalfNumber = firstText(details.calf_number, details.calfNumber, details['犊牛号'])
  if (!rows.length && singleCalfNumber) {
    rows.push({
      cowNumber: singleCalfNumber,
      earTagNumber: firstText(details.calf_ear_tag_number, details.calfEarTagNumber),
      sex: normalizeAnimalSex(firstText(details.calf_sex, details.calfSex)),
      birthWeight: firstText(details.birth_weight, details.birthWeight),
      remark: firstText(details.calf_remark, details.calfRemark)
    })
  }
  return rows
}

async function inferLatestSireNumberForCalving(
  damRef: ReturnType<typeof resolveCowRef>,
  eventTime: string,
  cowContext: ReturnType<typeof buildCowReferenceContext>
) {
  const eventMs = parseEventTime(eventTime)
  if (!Number.isFinite(eventMs)) return ''
  const [animalEvents, cowEvents, breedingEvents] = await Promise.all([
    getTableDataAsync('animal_event', { silent: true }).catch(() => []),
    getTableDataAsync('cow-events', { silent: true }).catch(() => []),
    getTableDataAsync('breeding-events', { silent: true }).catch(() => [])
  ])
  return (
    [
      ...animalEvents.map((row: any) => ({ row, source: 'animal_event' })),
      ...cowEvents.map((row: any) => ({ row, source: 'cow-events' })),
      ...breedingEvents.map((row: any) => ({ row, source: 'breeding-events' }))
    ]
      .map(({ row }) => {
        const details = parseDetails(row.details || row.customValues || row.custom_values)
        const resolved = resolveCowRef({ ...details, ...row }, cowContext)
        const eventCode = normalizeEventCode(
          row.eventCode ||
            row.event_code ||
            row.eventType ||
            row.event_type ||
            row.eventName ||
            row.event_name ||
            details.eventType ||
            details.reproduction_action
        )
        const timeValue =
          row.occurredAt ||
          row.occurred_at ||
          row.eventTime ||
          row.event_time ||
          row.eventDate ||
          row.event_date
        return {
          eventCode,
          time: parseEventTime(timeValue),
          cowId: resolved.cowId,
          cowNumber: resolved.cowNumber,
          bullNumber: firstText(
            details.bull_number,
            details.bullNumber,
            details.sire_number,
            details.sireNumber,
            row.bullNumber,
            row.bull_number,
            row.sireNumber,
            row.sire_number
          )
        }
      })
      .filter(
        (row) =>
          row.eventCode === 'insemination' &&
          Number.isFinite(row.time) &&
          row.time <= eventMs &&
          ((damRef.cowId && row.cowId === damRef.cowId) ||
            (damRef.cowNumber && row.cowNumber === damRef.cowNumber))
      )
      .sort((left, right) => right.time - left.time)[0]?.bullNumber || ''
  )
}

async function ensureCalvesForCalving(input: {
  damRef: ReturnType<typeof resolveCowRef>
  eventId: string
  eventTime: string
  details: Record<string, any>
  animals: any[]
  cowContext: ReturnType<typeof buildCowReferenceContext>
}) {
  const { damRef, eventId, eventTime, details, animals, cowContext } = input
  const calfRows = normalizeCalfRows(details).filter((row) => row.cowNumber)
  if (!calfRows.length) return []
  const now = new Date().toISOString()
  const birthDate = String(eventTime || now).slice(0, 10)
  const inferredSire = firstText(
    details.father_number,
    details.fatherNumber,
    details.sire_number,
    details.sireNumber,
    details.bull_number,
    details.bullNumber,
    await inferLatestSireNumberForCalving(damRef, eventTime, cowContext)
  )
  const damNumber = damRef.cowNumber
  const created: any[] = []

  for (const [index, calf] of calfRows.entries()) {
    const calfNumber = limitedText(calf.cowNumber)
    const calfEarTagNumber = nullableLimitedText(calf.earTagNumber)
    const existing = findAnimalByNumber(animals, calfNumber)
    const calfId = limitedText(
      stringValue(
        existing?.id ||
          existing?.animalId ||
          existing?.animal_id ||
          existing?.cowId ||
          existing?.cow_id
      ) || compactRecordId('animal', calfNumber)
    )
    const sex = normalizeAnimalSex(calf.sex)
    await upsertTableDataAsync('animal', {
      id: calfId,
      animalId: calfId,
      animal_id: calfId,
      cowId: calfId,
      cow_id: calfId,
      animalNumber: calfNumber,
      animal_number: calfNumber,
      cowNumber: calfNumber,
      cow_number: calfNumber,
      earTagNumber: calfEarTagNumber,
      ear_tag_number: calfEarTagNumber,
      species: CATTLE_SPECIES_NAME,
      breed: requireSupportedCattleBreed(
        firstText(details.calf_breed, details.breed) || DEFAULT_CATTLE_BREED
      ),
      sex,
      birthDate,
      birth_date: birthDate,
      entryDate: birthDate,
      entry_date: birthDate,
      currentStageId: '犊牛',
      current_stage_id: '犊牛',
      status: '在群',
      notes: calf.remark,
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    })
    await upsertTableDataAsync('cows', {
      id: calfId,
      cowId: calfId,
      cow_id: calfId,
      animalId: calfId,
      animal_id: calfId,
      cowNumber: calfNumber,
      cow_number: calfNumber,
      animalNumber: calfNumber,
      animal_number: calfNumber,
      earTagNumber: calfEarTagNumber,
      ear_tag_number: calfEarTagNumber,
      fatherNumber: limitedText(inferredSire),
      father_number: limitedText(inferredSire),
      motherNumber: limitedText(damNumber),
      mother_number: limitedText(damNumber),
      breed: requireSupportedCattleBreed(
        firstText(details.calf_breed, details.breed) || DEFAULT_CATTLE_BREED
      ),
      gender: sex,
      sex,
      birthDate,
      birth_date: birthDate,
      type: '犊牛',
      cowType: '犊牛',
      cow_type: '犊牛',
      status: '在群',
      pregnancy: false,
      parity: 0,
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    })
    await writeAnimalIdentifier(calfId, 'animal_number', calfNumber, true)
    if (calf.earTagNumber) await writeAnimalIdentifier(calfId, '耳标', calf.earTagNumber)
    await writeAnimalParentage(
      calfId,
      inferredSire,
      'sire',
      animals,
      'calving_event',
      birthDate,
      `由产犊事件 ${eventId} 推导`
    )
    await writeAnimalParentage(
      calfId,
      damNumber,
      'dam',
      animals,
      'calving_event',
      birthDate,
      `由产犊事件 ${eventId} 推导`
    )
    created.push({
      index: index + 1,
      animalId: calfId,
      cowId: calfId,
      cowNumber: calfNumber,
      earTagNumber: calfEarTagNumber || '',
      sex,
      birthDate,
      fatherNumber: inferredSire,
      motherNumber: damNumber,
      remark: calf.remark
    })
  }
  return created
}

async function writeCowEventDetailTables(
  animalEvent: Record<string, any>,
  eventCode: string,
  details: Record<string, any>
) {
  const now = animalEvent.createdAt || animalEvent.created_at || new Date().toISOString()
  const base = {
    id: compactRecordId('detail', animalEvent.id, eventCode),
    eventId: animalEvent.id,
    event_id: animalEvent.id,
    animalId: animalEvent.animalId || animalEvent.animal_id,
    animal_id: animalEvent.animalId || animalEvent.animal_id,
    cowNumber: animalEvent.cowNumber || animalEvent.cow_number || animalEvent.animalNumber,
    cow_number: animalEvent.cowNumber || animalEvent.cow_number || animalEvent.animalNumber,
    eventType: eventCode,
    event_type: eventCode,
    occurredAt: animalEvent.occurredAt || animalEvent.occurred_at,
    occurred_at: animalEvent.occurredAt || animalEvent.occurred_at,
    recordedAt:
      animalEvent.recordedAt ||
      animalEvent.recorded_at ||
      animalEvent.occurredAt ||
      animalEvent.occurred_at,
    recorded_at:
      animalEvent.recordedAt ||
      animalEvent.recorded_at ||
      animalEvent.occurredAt ||
      animalEvent.occurred_at,
    operatorId: animalEvent.operatorId || animalEvent.operator_id || null,
    operator_id: animalEvent.operatorId || animalEvent.operator_id || null,
    operatorName: animalEvent.operatorName || animalEvent.operator_name || '',
    operator_name: animalEvent.operatorName || animalEvent.operator_name || '',
    workOperatorId: animalEvent.workOperatorId || animalEvent.work_operator_id || null,
    work_operator_id: animalEvent.workOperatorId || animalEvent.work_operator_id || null,
    workOperatorName: animalEvent.workOperatorName || animalEvent.work_operator_name || '',
    work_operator_name: animalEvent.workOperatorName || animalEvent.work_operator_name || '',
    sourceTable: animalEvent.sourceTable || animalEvent.source_table || 'animal_event',
    source_table: animalEvent.sourceTable || animalEvent.source_table || 'animal_event',
    sourceRecordId: animalEvent.sourceRecordId || animalEvent.source_record_id || animalEvent.id,
    source_record_id: animalEvent.sourceRecordId || animalEvent.source_record_id || animalEvent.id,
    detail: jsonDetail(details),
    details,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }

  if (['insemination', 'pregnancy_check', 'calving', 'abortion', 'heat'].includes(eventCode)) {
    const calfAnimalId =
      optionalForeignAnimalId(details.calf_animal_id, details.calfAnimalId) ||
      optionalForeignAnimalId(
        ...(Array.isArray(details.calves)
          ? [details.calves[0]?.animalId, details.calves[0]?.cowId]
          : [])
      )
    const bullAnimalId = optionalForeignAnimalId(details.bull_animal_id, details.bullAnimalId)
    await upsertTableDataAsync('event_reproduction_detail', {
      ...base,
      reproductionAction: eventCode,
      reproduction_action: eventCode,
      bullAnimalId,
      bull_animal_id: bullAnimalId,
      bullNumber: firstText(
        details.bull_number,
        details.bullNumber,
        details.father_number,
        details.fatherNumber
      ),
      bull_number: firstText(
        details.bull_number,
        details.bullNumber,
        details.father_number,
        details.fatherNumber
      ),
      semenBatch: firstText(details.semen_batch, details.semenBatch),
      semen_batch: firstText(details.semen_batch, details.semenBatch),
      inseminationNo: positiveInteger(details.insemination_no ?? details.inseminationNo) || null,
      insemination_no: positiveInteger(details.insemination_no ?? details.inseminationNo) || null,
      pregnancyResult: firstText(details.pregnancy_result, details.pregnancyResult, details.result),
      pregnancy_result: firstText(
        details.pregnancy_result,
        details.pregnancyResult,
        details.result
      ),
      calvingResult: firstText(details.calving_result, details.calvingResult, details.result),
      calving_result: firstText(details.calving_result, details.calvingResult, details.result),
      calfAnimalId,
      calf_animal_id: calfAnimalId,
      technician: firstText(details.technician, details.operatorName, animalEvent.operatorName)
    })
  }

  if (['entry', 'transfer', 'exit', 'death'].includes(eventCode)) {
    const fromUnit = firstText(
      details.from_unit_id,
      details.fromUnitId,
      details.from_unit_code,
      details.current_pen_snapshot,
      details.currentPenSnapshot
    )
    const toUnit =
      eventCode === 'exit' || eventCode === 'death'
        ? ''
        : firstText(
            details.to_unit_id,
            details.toUnitId,
            details.to_unit_code,
            details.unit_id,
            details.unitId
          )
    const reason = firstText(
      details.movement_reason,
      details.movementReason,
      details.entry_reason,
      details.transfer_reason,
      details.exit_reason,
      details.reason
    )
    await upsertTableDataAsync('event_movement_detail', {
      ...base,
      fromUnitId: fromUnit,
      from_unit_id: fromUnit,
      fromUnitCode: fromUnit,
      from_unit_code: fromUnit,
      toUnitId: toUnit,
      to_unit_id: toUnit,
      toUnitCode: toUnit,
      to_unit_code: toUnit,
      unitId: toUnit,
      unit_id: toUnit,
      unitCode: toUnit,
      unit_code: toUnit,
      movementReason: reason,
      movement_reason: reason,
      movementType: eventCode,
      movement_type: eventCode
    })
  }

  if (['diagnosis', 'treatment', 'medication', 'vaccination', 'death'].includes(eventCode)) {
    await upsertTableDataAsync('event_health_detail', {
      ...base,
      diagnosisCode: firstText(details.diagnosis_code, details.diagnosisCode, details.disease_code),
      diagnosis_code: firstText(
        details.diagnosis_code,
        details.diagnosisCode,
        details.disease_code
      ),
      diagnosisName: firstText(details.diagnosis_name, details.diagnosisName, details.disease_name),
      diagnosis_name: firstText(
        details.diagnosis_name,
        details.diagnosisName,
        details.disease_name
      ),
      symptomSummary: firstText(details.symptom_summary, details.symptomSummary, details.symptoms),
      symptom_summary: firstText(details.symptom_summary, details.symptomSummary, details.symptoms),
      bodyTemperature: finiteNumber(
        details.body_temperature,
        details.bodyTemperature,
        details.temperature
      ),
      body_temperature: finiteNumber(
        details.body_temperature,
        details.bodyTemperature,
        details.temperature
      ),
      veterinarian: firstText(details.veterinarian, details.doctor, animalEvent.operatorName),
      treatmentPlan: firstText(details.treatment_plan, details.treatmentPlan),
      treatment_plan: firstText(details.treatment_plan, details.treatmentPlan),
      recoveryStatus: firstText(details.recovery_status, details.recoveryStatus),
      recovery_status: firstText(details.recovery_status, details.recoveryStatus)
    })
  }

  if (
    ['medication', 'vaccination'].includes(eventCode) ||
    firstText(details.medicine_code, details.medicine_id, details.medicine_name)
  ) {
    await upsertTableDataAsync('event_medicine_detail', {
      ...base,
      medicineId: firstText(details.medicine_id, details.medicine_code),
      medicine_id: firstText(details.medicine_id, details.medicine_code),
      medicineBatchId: firstText(
        details.medicine_batch_id,
        details.medicine_batch_no,
        details.batch_no
      ),
      medicine_batch_id: firstText(
        details.medicine_batch_id,
        details.medicine_batch_no,
        details.batch_no
      ),
      dose: finiteNumber(details.dose, details.dosage),
      doseUnit: firstText(details.dose_unit, details.doseUnit, details.unit),
      dose_unit: firstText(details.dose_unit, details.doseUnit, details.unit),
      route: firstText(details.route),
      withdrawalDays: positiveInteger(details.withdrawal_days ?? details.withdrawalDays) || null,
      withdrawal_days: positiveInteger(details.withdrawal_days ?? details.withdrawalDays) || null
    })
  }

  if (
    [
      'milking',
      'milking_session',
      'milk_quality',
      'dhi_test',
      'feeding',
      'feed_delivery',
      'feed_adjustment',
      'weighing',
      'body_measurement',
      'dry_off'
    ].includes(eventCode)
  ) {
    const productionDate =
      eventCode === 'dry_off'
        ? firstText(
            details.dry_off_date,
            details.dryOffDate,
            details.lactation_end_date,
            details.lactationEndDate,
            animalEvent.occurredAt,
            animalEvent.occurred_at
          ).slice(0, 10)
        : firstText(
            details.production_date,
            details.productionDate,
            animalEvent.occurredAt,
            animalEvent.occurred_at
          ).slice(0, 10)
    const dryReason =
      eventCode === 'dry_off'
        ? firstText(details.dry_reason, details.dryReason, details.reason)
        : ''
    await upsertTableDataAsync('event_production_detail', {
      ...base,
      operationType: eventCode,
      operation_type: eventCode,
      productionDate,
      production_date: productionDate,
      workUnitId: firstText(details.unit_id, details.unitId, details.to_unit_id, details.toUnitId),
      work_unit_id: firstText(
        details.unit_id,
        details.unitId,
        details.to_unit_id,
        details.toUnitId
      ),
      resultSummary: firstText(
        dryReason,
        details.check_result,
        details.quality_flag,
        details.result,
        details.notes
      ),
      result_summary: firstText(
        dryReason,
        details.check_result,
        details.quality_flag,
        details.result,
        details.notes
      )
    })
  }
}

/** 添加统一事件（写入 animal_event + cow-events 表） */
export async function addCowEvent(eventData: any): Promise<{ animalEvent: any; event: any }> {
  const [cows, animals, identifiers] = await Promise.all([
    getTableDataAsync('cows', { silent: true }).catch(() => []),
    getTableDataAsync('animal', { silent: true }).catch(() => []),
    getTableDataAsync('animal_identifier', { silent: true }).catch(() => [])
  ])
  let cowContext = buildCowReferenceContext(
    [...(cows || []), ...(animals || [])],
    identifiers || []
  )
  const rawCowRef = resolveCowRef(eventData, cowContext)
  const originalMismatch =
    rawCowRef.resolved &&
    ((rawCowRef.originalCowId && rawCowRef.originalCowId !== rawCowRef.cowId) ||
      (rawCowRef.originalCowNumber && rawCowRef.originalCowNumber !== rawCowRef.cowNumber))
  const details = {
    ...(eventData.details || {}),
    ...(originalMismatch
      ? {
          originalCowRef: {
            cowId: rawCowRef.originalCowId,
            cowNumber: rawCowRef.originalCowNumber
          }
        }
      : {})
  }
  const requestedEventId = stringValue(eventData.id)
  const eventId = compactRecordId(
    'evt',
    requestedEventId || eventData.sourceRecordId || eventData.source_record_id || Date.now()
  )
  if (requestedEventId && requestedEventId !== eventId) {
    details.originalEventId = requestedEventId
    details.original_event_id = requestedEventId
  }
  let eventTime =
    eventData.eventTime || eventData.occurredAt || eventData.occurred_at || new Date().toISOString()
  const eventCode = normalizeEventCode(
    eventData.eventCode || eventData.event_code || eventData.eventType
  )
  if (eventCode === 'dry_off') {
    const dryOffDate = firstText(
      eventData.dry_off_date,
      eventData.dryOffDate,
      eventData.lactation_end_date,
      eventData.lactationEndDate,
      details.dry_off_date,
      details.dryOffDate,
      details.lactation_end_date,
      details.lactationEndDate,
      eventTime
    ).slice(0, 10)
    if (dryOffDate) {
      eventTime = dryOffDate
      details.dry_off_date = dryOffDate
      details.dryOffDate = dryOffDate
      details.lactation_end_date = dryOffDate
      details.lactationEndDate = dryOffDate
    }
    const dryReason = firstText(
      eventData.dry_reason,
      eventData.dryReason,
      details.dry_reason,
      details.dryReason,
      details.reason
    )
    if (dryReason) {
      details.dry_reason = dryReason
      details.dryReason = dryReason
      details.reason = dryReason
    }
    details.target_stage = firstText(details.target_stage, details.targetStage) || '干奶'
    details.targetStage = details.target_stage
  }
  const eventGroup = eventData.eventGroup || eventData.event_group || eventGroupOf(eventCode)
  const eventStatus = normalizeEventStatus(
    eventData.eventStatus || eventData.event_status || eventData.status
  )
  const sourceTable = eventData.sourceTable || eventData.source_table || 'animal_event'
  const requestedSourceType = stringValue(eventData.sourceType || eventData.source_type)
  const requestedImportMode = stringValue(
    eventData.importMode ||
      eventData.import_mode ||
      eventData.details?.importMode ||
      eventData.details?.import_mode
  )
  const sourceType =
    requestedSourceType ||
    (requestedImportMode === 'batch' || sourceTable !== 'animal_event' ? 'manual' : 'single_entry')
  const importMode = requestedImportMode || (sourceType === 'single_entry' ? 'single' : '')
  const rawSourceRecordId = stringValue(
    eventData.sourceRecordId || eventData.source_record_id || eventId
  )
  const sourceRecordId = compactRecordId('src', rawSourceRecordId || eventId)
  if (rawSourceRecordId && rawSourceRecordId !== sourceRecordId) {
    details.originalSourceRecordId = rawSourceRecordId
    details.original_source_record_id = rawSourceRecordId
  }
  const operatorId = firstText(eventData.operatorId, eventData.operator_id) || null
  const operatorName = firstText(
    eventData.operatorName,
    eventData.operator_name,
    eventData.operator,
    eventData.userName,
    eventData.user_name
  )
  const workOperatorId =
    firstText(
      eventData.workOperatorId,
      eventData.work_operator_id,
      details.workOperatorId,
      details.work_operator_id
    ) || null
  const workOperatorName = firstText(
    eventData.workOperatorName,
    eventData.work_operator_name,
    details.workOperatorName,
    details.work_operator_name,
    details.technician,
    details.veterinarian,
    details.collector
  )
  const recordedAt = firstText(
    eventData.recordedAt,
    eventData.recorded_at,
    details.recordedAt,
    details.recorded_at,
    details.recordTime,
    details.record_time,
    eventTime
  )
  const rawEventName = stringValue(
    eventData.eventName || eventData.event_name || details.eventName || details.event_name
  )
  const canonicalEventName = eventDisplayName(eventCode)
  if (rawEventName && rawEventName !== canonicalEventName) {
    details.rawEventName = rawEventName
    details.raw_event_name = rawEventName
  }
  delete details.eventName
  delete details.event_name

  const cowRef = await ensureAnimalRecordForEvent({
    eventData,
    eventCode,
    eventTime,
    details,
    cowRef: rawCowRef,
    cows: cows || [],
    animals: animals || []
  })
  cowContext = buildCowReferenceContext(
    [...(cows || []), ...(animals || []), cowRef.cow || {}].filter(Boolean),
    identifiers || []
  )
  details.eventTime = eventTime
  details.event_time = eventTime
  details.sourceType = sourceType
  details.source_type = sourceType
  details.sourceTable = sourceTable
  details.source_table = sourceTable
  details.sourceRecordId = sourceRecordId
  details.source_record_id = sourceRecordId
  details.operatorId = operatorId
  details.operator_id = operatorId
  details.operatorName = operatorName
  details.operator_name = operatorName
  details.workOperatorId = workOperatorId
  details.work_operator_id = workOperatorId
  details.workOperatorName = workOperatorName
  details.work_operator_name = workOperatorName
  details.recordedAt = recordedAt
  details.recorded_at = recordedAt
  if (importMode) {
    details.importMode = importMode
    details.import_mode = importMode
  }

  if (eventCode === 'calving') {
    const createdCalves = await ensureCalvesForCalving({
      damRef: cowRef,
      eventId,
      eventTime,
      details,
      animals: animals || [],
      cowContext
    })
    if (createdCalves.length) {
      details.calves = createdCalves
      details.calfRows = createdCalves
      details.calf_count = Math.max(
        positiveInteger(details.calf_count ?? details.calfCount),
        createdCalves.length
      )
      details.calfCount = details.calf_count
    }
  }

  const systemParityNo = await deriveEventParityNo(
    cowRef,
    eventTime,
    eventCode,
    eventId,
    cowContext
  )
  if (systemParityNo) {
    details.parityNo = systemParityNo
    details.parity_no = systemParityNo
    details.paritySource = 'system_derived_from_calving'
    details.parity_source = 'system_derived_from_calving'
  } else {
    delete details.parityNo
    delete details.parity_no
    delete details.parity
    delete details.lactationNo
    delete details.lactation_no
  }
  const event = {
    id: eventId,
    cowId: cowRef.cowId,
    cowNumber: cowRef.cowNumber || eventData.cowNumber || '',
    eventType: eventData.eventType || eventCode,
    eventCode,
    eventGroup,
    eventName: canonicalEventName,
    eventTime,
    operatorId,
    operatorName,
    workOperatorId,
    work_operator_id: workOperatorId,
    workOperatorName,
    work_operator_name: workOperatorName,
    details,
    cost: eventData.cost || 0,
    notes: eventData.notes || '',
    sourceTable,
    source_table: sourceTable,
    sourceRecordId,
    source_record_id: sourceRecordId,
    sourceType,
    source_type: sourceType,
    recordedAt,
    recorded_at: recordedAt,
    importMode,
    import_mode: importMode,
    createdAt: new Date().toISOString()
  }

  const animalEvent = {
    id: eventId,
    animalId: cowRef.cowId,
    animal_id: cowRef.cowId,
    cowId: cowRef.cowId,
    cow_id: cowRef.cowId,
    animalNumber: cowRef.cowNumber || eventData.cowNumber || '',
    animal_number: cowRef.cowNumber || eventData.cowNumber || '',
    cowNumber: cowRef.cowNumber || eventData.cowNumber || '',
    cow_number: cowRef.cowNumber || eventData.cowNumber || '',
    eventGroup,
    event_group: eventGroup,
    eventType: eventCode,
    event_type: eventCode,
    eventCode,
    event_code: eventCode,
    eventName: event.eventName,
    event_name: event.eventName,
    occurredAt: eventTime,
    occurred_at: eventTime,
    eventTime,
    event_time: eventTime,
    productionDate: String(eventTime).slice(0, 10),
    production_date: String(eventTime).slice(0, 10),
    parityNo: systemParityNo,
    parity_no: systemParityNo,
    lactationNo: systemParityNo,
    lactation_no: systemParityNo,
    operatorId,
    operator_id: operatorId,
    operatorName,
    operator_name: operatorName,
    workOperatorId,
    work_operator_id: workOperatorId,
    workOperatorName,
    work_operator_name: workOperatorName,
    sourceType,
    source_type: sourceType,
    importMode,
    import_mode: importMode,
    sourceTable,
    source_table: sourceTable,
    sourceRecordId,
    source_record_id: sourceRecordId,
    recordedAt,
    recorded_at: recordedAt,
    severity:
      stringValue(eventData.severity || eventData.level || details.severity || details.level) ||
      null,
    details,
    customValues: { ...details, ...(eventData.customValues || eventData.custom_values || {}) },
    custom_values: { ...details, ...(eventData.customValues || eventData.custom_values || {}) },
    notes: eventData.notes || '',
    status: eventStatus,
    eventStatus,
    event_status: eventStatus,
    createdAt: event.createdAt,
    created_at: event.createdAt,
    updatedAt: event.createdAt,
    updated_at: event.createdAt
  }

  await upsertTableDataAsync('animal_event', animalEvent)
  await upsertTableDataAsync('cow-events', event)
  await writeCowEventDetailTables(animalEvent, eventCode, details)
  await applyMovementEventState(cowRef, eventCode, details)
  await applyDerivedCowState(cowRef, eventCode, details, systemParityNo)

  if (
    [
      'calving',
      'abortion',
      'insemination',
      'pregnancy_check',
      'dry_off',
      'entry',
      'transfer',
      'exit',
      'death'
    ].includes(eventCode)
  ) {
    const now = new Date().toISOString()
    const recomputeId = compactRecordId('recompute', eventId)
    const recomputeTargets = [
      'parity_episode',
      'lactation_episode',
      'animal_time_index',
      'fact_lactation_305'
    ]
    const recomputeTargetTable = recomputeTargets.join(',')
    await upsertTableDataAsync('derivation_recompute_job', {
      id: recomputeId,
      jobCode: recomputeId,
      job_code: recomputeId,
      derivationDomain: 'production_cycle',
      derivation_domain: 'production_cycle',
      targetTable: recomputeTargetTable,
      target_table: recomputeTargetTable,
      animalId: cowRef.cowId,
      animal_id: cowRef.cowId,
      cowNumber: cowRef.cowNumber || eventData.cowNumber || '',
      cow_number: cowRef.cowNumber || eventData.cowNumber || '',
      triggerType: sourceType || 'manual_entry',
      trigger_type: sourceType || 'manual_entry',
      triggerSource: 'animal_event',
      trigger_source: 'animal_event',
      sourceTable: 'animal_event',
      source_table: 'animal_event',
      sourceRecordId: eventId,
      source_record_id: eventId,
      triggerRecordId: eventId,
      trigger_record_id: eventId,
      targets: recomputeTargets,
      periodType: eventCode === 'calving' ? 'parity' : 'event',
      period_type: eventCode === 'calving' ? 'parity' : 'event',
      status: 'pending',
      jobStatus: 'pending',
      job_status: 'pending',
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    })
    import('./production-facts')
      .then(({ scheduleProductionFactRebuild }) =>
        scheduleProductionFactRebuild(`animal_event:${eventId}`)
      )
      .catch((error) => console.error('调度生产周期事实重算失败:', error))
  }
  return { animalEvent, event }
}

type UnifiedCowEventSourceTable =
  | 'animal_event'
  | 'cow-events'
  | 'entry-events'
  | 'transfer-events'
  | 'exit-events'
  | 'breeding-events'
  | 'veterinary-events'

export async function getUnifiedCowEventRowsAsync(): Promise<any[]> {
  const [
    animalEvents,
    cowEvents,
    entryEvents,
    transferEvents,
    exitEvents,
    breedingEvents,
    veterinaryEvents
  ] = await Promise.all([
    getTableDataAsync('animal_event', { silent: true }).catch(() => []),
    getTableDataAsync('cow-events', { silent: true }).catch(() => []),
    getTableDataAsync('entry-events', { silent: true }).catch(() => []),
    getTableDataAsync('transfer-events', { silent: true }).catch(() => []),
    getTableDataAsync('exit-events', { silent: true }).catch(() => []),
    getTableDataAsync('breeding-events', { silent: true }).catch(() => []),
    getTableDataAsync('veterinary-events', { silent: true }).catch(() => [])
  ])
  const seen = new Set<string>()
  return [
    ...(animalEvents || []).map((row: any) => normalizeUnifiedCowEventRow(row, 'animal_event')),
    ...(cowEvents || []).map((row: any) => normalizeUnifiedCowEventRow(row, 'cow-events')),
    ...(entryEvents || []).map((row: any) => normalizeUnifiedCowEventRow(row, 'entry-events')),
    ...(transferEvents || []).map((row: any) =>
      normalizeUnifiedCowEventRow(row, 'transfer-events')
    ),
    ...(exitEvents || []).map((row: any) => normalizeUnifiedCowEventRow(row, 'exit-events')),
    ...(breedingEvents || []).map((row: any) =>
      normalizeUnifiedCowEventRow(row, 'breeding-events')
    ),
    ...(veterinaryEvents || []).map((row: any) =>
      normalizeUnifiedCowEventRow(row, 'veterinary-events')
    )
  ]
    .sort((left, right) => {
      const priority =
        eventSourcePriority(left.sourceTable) - eventSourcePriority(right.sourceTable)
      if (priority) return priority
      return (
        parseEventTime(right.eventTime || right.occurredAt || right.createdAt) -
        parseEventTime(left.eventTime || left.occurredAt || left.createdAt)
      )
    })
    .filter((row) => {
      const details = parseDetails(row.details || row.customValues || row.custom_values)
      const eventCode = normalizeEventCode(
        row.eventCode ||
          row.event_code ||
          row.eventType ||
          row.event_type ||
          details.eventCode ||
          details.event_type
      )
      const eventTime = eventMomentKey(
        row.eventTime ||
          row.event_time ||
          row.occurredAt ||
          row.occurred_at ||
          row.eventDate ||
          row.event_date ||
          row.createdAt ||
          row.created_at
      )
      const cowKey = stringValue(
        row.cowId ||
          row.cow_id ||
          row.animalId ||
          row.animal_id ||
          row.cowNumber ||
          row.cow_number ||
          row.animalNumber ||
          row.animal_number
      )
      const sourceRecordId = stringValue(row.sourceRecordId || row.source_record_id || row.id)
      const keys = uniqueStrings([
        sourceRecordId ? `record:${cowKey}|${eventCode}|${sourceRecordId}` : '',
        row.id ? `id:${cowKey}|${eventCode}|${row.id}` : '',
        eventTime ? `business:${cowKey}|${eventCode}|${eventTime}` : ''
      ])
      if (keys.some((key) => seen.has(key))) return false
      keys.forEach((key) => seen.add(key))
      return true
    })
}

function normalizeUnifiedCowEventRow(row: any, sourceTable: UnifiedCowEventSourceTable) {
  const details = parseDetails(row.details || row.customValues || row.custom_values)
  const eventCode = normalizeEventCode(
    row.eventCode ||
      row.event_code ||
      row.eventType ||
      row.event_type ||
      row.type ||
      row.entryType ||
      row.entry_type ||
      row.transferType ||
      row.transfer_type ||
      row.exitType ||
      row.exit_type ||
      row.breedingType ||
      row.breeding_type ||
      row.veterinaryType ||
      row.veterinary_type ||
      row.eventName ||
      row.event_name ||
      details.eventCode ||
      details.event_code ||
      details.eventType ||
      details.event_type ||
      fallbackEventCodeForLegacySource(sourceTable)
  )
  const eventTime = stringValue(
    row.eventTime ||
      row.event_time ||
      row.occurredAt ||
      row.occurred_at ||
      row.eventDate ||
      row.event_date ||
      row.entryTime ||
      row.entry_time ||
      row.transferTime ||
      row.transfer_time ||
      row.exitTime ||
      row.exit_time ||
      row.breedingDate ||
      row.breeding_date ||
      row.inseminationDate ||
      row.insemination_date ||
      row.pregnancyCheckDate ||
      row.pregnancy_check_date ||
      row.calvingDate ||
      row.calving_date ||
      row.veterinaryTime ||
      row.veterinary_time ||
      row.treatmentTime ||
      row.treatment_time ||
      row.createdAt ||
      row.created_at
  )
  return {
    ...row,
    id: stringValue(row.id),
    cowId: row.cowId || row.cow_id || row.animalId || row.animal_id,
    animalId: row.animalId || row.animal_id || row.cowId || row.cow_id,
    animal_id: row.animal_id || row.animalId || row.cow_id || row.cowId,
    cowNumber:
      row.cowNumber ||
      row.cow_number ||
      row.animalNumber ||
      row.animal_number ||
      row.earTagNumber ||
      row.ear_tag_number,
    animalNumber: row.animalNumber || row.animal_number || row.cowNumber || row.cow_number,
    animal_number: row.animal_number || row.animalNumber || row.cow_number || row.cowNumber,
    eventType: eventCode,
    event_type: eventCode,
    eventCode,
    event_code: eventCode,
    eventGroup: row.eventGroup || row.event_group || eventGroupOf(eventCode),
    event_group: row.event_group || row.eventGroup || eventGroupOf(eventCode),
    eventName: row.eventName || row.event_name || row.eventType || eventDisplayName(eventCode),
    event_name: row.event_name || row.eventName || row.eventType || eventDisplayName(eventCode),
    eventTime,
    event_time: eventTime,
    occurredAt: row.occurredAt || row.occurred_at || eventTime,
    occurred_at: row.occurred_at || row.occurredAt || eventTime,
    operatorName:
      row.operatorName ||
      row.operator_name ||
      row.operator ||
      row.recorder ||
      row.veterinarian ||
      details.operatorName ||
      details.operator_name ||
      details.recorder,
    operator_name:
      row.operator_name ||
      row.operatorName ||
      row.operator ||
      row.recorder ||
      row.veterinarian ||
      details.operatorName ||
      details.operator_name ||
      details.recorder,
    eventStatus: row.eventStatus || row.event_status || row.status,
    event_status: row.event_status || row.eventStatus || row.status,
    details: { ...row, ...details, sourceTable, source_table: sourceTable },
    sourceTable,
    source_table: sourceTable,
    sourceRecordId: row.sourceRecordId || row.source_record_id || row.id,
    source_record_id: row.source_record_id || row.sourceRecordId || row.id
  }
}

function fallbackEventCodeForLegacySource(sourceTable: UnifiedCowEventSourceTable) {
  if (sourceTable === 'entry-events') return 'entry'
  if (sourceTable === 'transfer-events') return 'transfer'
  if (sourceTable === 'exit-events') return 'exit'
  if (sourceTable === 'breeding-events') return 'breeding'
  if (sourceTable === 'veterinary-events') return 'veterinary'
  return ''
}

function normalizeEventStatus(value: unknown): string {
  const raw = stringValue(value)
  const map: Record<string, string> = {
    已记录: 'recorded',
    待复核: 'pending_review',
    已确认: 'confirmed',
    已作废: 'voided',
    recorded: 'recorded',
    pending_review: 'pending_review',
    confirmed: 'confirmed',
    voided: 'voided'
  }
  return map[raw] || raw || 'recorded'
}

async function deriveEventParityNo(
  cowRef: ReturnType<typeof resolveCowRef>,
  eventTime: string,
  eventCode: string,
  eventId: string,
  cowContext: ReturnType<typeof buildCowReferenceContext>
) {
  const eventMs = parseEventTime(eventTime)
  if (!Number.isFinite(eventMs) || (!cowRef.cowId && !cowRef.cowNumber)) return undefined
  const parityRows = await getTableDataAsync('parity_episode', { silent: true }).catch(() => [])
  const windows = parityRows
    .filter((row: any) => rowMatchesCow(row, cowRef))
    .map((row: any) => {
      const startTime = parseEventTime(row.startDate || row.start_date)
      const endValue = stringValue(row.endDate || row.end_date)
      return {
        parityNo: positiveInteger(row.parityNo ?? row.parity_no),
        startTime,
        endTime: endValue ? endOfDay(startTimeOfDate(endValue)) : Number.POSITIVE_INFINITY
      }
    })
    .filter((row: any) => row.parityNo > 0 && Number.isFinite(row.startTime))
    .sort((left: any, right: any) => left.startTime - right.startTime)

  if (eventCode === 'calving') {
    const exact = windows.find((row: any) => sameDate(row.startTime, eventMs))
    if (exact) return exact.parityNo
    const beforeFromFacts = windows.filter(
      (row: any) => row.startTime < startOfDayMs(eventMs)
    ).length
    const beforeFromEvents = (await calvingEventsForCow(cowRef, cowContext, eventId)).filter(
      (row) => row.time < startOfDayMs(eventMs)
    ).length
    return Math.max(beforeFromFacts, beforeFromEvents) + 1
  }

  const matched = windows.find((row: any) => eventMs >= row.startTime && eventMs <= row.endTime)
  if (matched) return matched.parityNo

  const calvings = await calvingEventsForCow(cowRef, cowContext, eventId)
  let previousIndex = -1
  calvings.forEach((row, index) => {
    if (row.time <= eventMs) previousIndex = index
  })
  if (previousIndex === -1) return undefined
  const next = calvings[previousIndex + 1]
  if (next && eventMs >= next.time) return undefined
  return previousIndex + 1
}

async function calvingEventsForCow(
  cowRef: ReturnType<typeof resolveCowRef>,
  cowContext: ReturnType<typeof buildCowReferenceContext>,
  excludeEventId = ''
) {
  const [animalEvents, cowEvents, breedingEvents] = await Promise.all([
    getTableDataAsync('animal_event', { silent: true }).catch(() => []),
    getTableDataAsync('cow-events', { silent: true }).catch(() => []),
    getTableDataAsync('breeding-events', { silent: true }).catch(() => [])
  ])
  const normalized = [
    ...animalEvents.map((row: any) => ({ row, sourceTable: 'animal_event' })),
    ...cowEvents.map((row: any) => ({
      row,
      sourceTable: stringValue(row.sourceTable || row.source_table || 'cow-events')
    })),
    ...breedingEvents.map((row: any) => ({ row, sourceTable: 'breeding-events' }))
  ]
    .map((row: any) => {
      const details = parseDetails(row.row.details || row.row.customValues || row.row.custom_values)
      const resolved = resolveCowRef({ ...details, ...row.row }, cowContext)
      const eventType = normalizeEventCode(
        row.row.eventCode ||
          row.row.event_code ||
          row.row.eventType ||
          row.row.event_type ||
          row.row.eventName ||
          row.row.event_name ||
          details.eventType
      )
      const eventTimeValue =
        row.row.occurredAt ||
        row.row.occurred_at ||
        row.row.eventTime ||
        row.row.event_time ||
        row.row.eventDate ||
        row.row.event_date ||
        row.row.createdAt ||
        row.row.created_at
      const time = parseEventTime(eventTimeValue)
      return {
        id: stringValue(row.row.id),
        cowId: resolved.cowId,
        cowNumber: resolved.cowNumber,
        eventType,
        time,
        eventMoment: eventMomentKey(eventTimeValue),
        sourceTable: canonicalEventSourceTable(row.sourceTable),
        sourceRecordId: stringValue(
          row.row.sourceRecordId || row.row.source_record_id || row.row.id
        )
      }
    })
    .filter(
      (row) =>
        row.id !== excludeEventId &&
        row.eventType === 'calving' &&
        Number.isFinite(row.time) &&
        ((cowRef.cowId && row.cowId === cowRef.cowId) ||
          (cowRef.cowNumber && row.cowNumber === cowRef.cowNumber))
    )
    .sort(
      (left, right) =>
        eventSourcePriority(left.sourceTable) - eventSourcePriority(right.sourceTable) ||
        left.time - right.time
    )
  const seen = new Set<string>()
  return normalized
    .filter((row) => {
      const keys = uniqueStrings([
        row.sourceRecordId
          ? `record:${row.cowId || row.cowNumber}|${row.eventType}|${row.sourceRecordId}`
          : '',
        row.id ? `id:${row.cowId || row.cowNumber}|${row.eventType}|${row.id}` : '',
        row.eventMoment
          ? `business:${row.cowId || row.cowNumber}|${row.eventType}|${row.eventMoment}`
          : ''
      ])
      if (keys.some((key) => seen.has(key))) return false
      keys.forEach((key) => seen.add(key))
      return true
    })
    .sort((left, right) => left.time - right.time)
}

async function applyMovementEventState(
  cowRef: ReturnType<typeof resolveCowRef>,
  eventCode: string,
  details: Record<string, any>
) {
  if (
    !['entry', 'transfer', 'exit', 'death'].includes(eventCode) ||
    (!cowRef.cowId && !cowRef.cowNumber)
  )
    return
  const isLeaving = eventCode === 'exit' || eventCode === 'death'
  const rawTargetUnit = isLeaving
    ? ''
    : stringValue(
        details.to_unit_code ||
          details.toUnitCode ||
          details.to_unit_id ||
          details.toUnitId ||
          details.toPenId ||
          details.to_pen_id ||
          details.toPen ||
          details.to_pen ||
          details.targetPen ||
          details.target_pen ||
          details.pen ||
          details.unit_code ||
          details.unitCode ||
          details.unit_id ||
          details.unitId ||
          details['目标圈舍']
      )
  const targetUnit = isLeaving ? '' : await ensureFarmUnitForAssignment(rawTargetUnit, details)
  const status = isLeaving ? (eventCode === 'death' ? '死亡' : '离群') : '在群'
  const update = {
    currentPen: targetUnit,
    current_pen: targetUnit,
    currentPenId: targetUnit,
    current_pen_id: targetUnit,
    currentPenCode: targetUnit,
    current_pen_code: targetUnit,
    currentUnitId: targetUnit,
    current_unit_id: targetUnit,
    currentUnitCode: targetUnit,
    current_unit_code: targetUnit,
    status,
    updatedAt: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
  await Promise.all([
    updateCowCurrentLocation('cows', cowRef, update),
    updateCowCurrentLocation('animal', cowRef, update)
  ])
  await writePenAssignmentHistory(cowRef, eventCode, details, targetUnit)
}

async function applyDerivedCowState(
  cowRef: ReturnType<typeof resolveCowRef>,
  eventCode: string,
  details: Record<string, any>,
  systemParityNo?: number
) {
  if (!cowRef.cowId && !cowRef.cowNumber) return
  const now = new Date().toISOString()
  const update: Record<string, any> = {}

  if (eventCode === 'pregnancy_check') {
    const result = stringValue(
      details.result || details.pregnancyResult || details.pregnancy_result
    )
    if (['阳性', '妊娠', '怀孕', 'positive', 'pregnant'].includes(result)) {
      update.pregnancy = true
      update.status = '妊娠'
    } else if (['阴性', '未孕', '未妊娠', 'negative', 'not_pregnant'].includes(result)) {
      update.pregnancy = false
      update.status = '空怀'
    }
  }

  if (eventCode === 'calving') {
    update.pregnancy = false
    update.status = '健康'
    if (systemParityNo) {
      update.parity = systemParityNo
      update.parityNo = systemParityNo
      update.parity_no = systemParityNo
    }
  }

  if (eventCode === 'abortion') {
    update.pregnancy = false
    update.status = '待观察'
  }

  if (eventCode === 'death') {
    update.pregnancy = false
    update.status = '死亡'
    update.currentPen = ''
    update.current_pen = ''
    update.currentPenId = ''
    update.current_pen_id = ''
    update.currentPenCode = ''
    update.current_pen_code = ''
    update.currentUnitId = ''
    update.current_unit_id = ''
    update.currentUnitCode = ''
    update.current_unit_code = ''
  }

  if (['diagnosis', 'surgery'].includes(eventCode)) {
    update.status = '待观察'
  }

  if (eventCode === 'treatment') {
    const result = stringValue(
      details.result || details.treatmentResult || details.treatment_result
    )
    update.status = result === '痊愈' ? '健康' : '待观察'
  }

  if (eventCode === 'health_check') {
    const result = stringValue(
      details.findings || details.examinationResult || details.examination_result || details.result
    )
    update.status = result === '正常' ? '健康' : '待观察'
  }

  if (!Object.keys(update).length) return
  update.updatedAt = now
  update.updated_at = now
  await Promise.all([
    updateCowCurrentLocation('cows', cowRef, update),
    updateCowCurrentLocation('animal', cowRef, update)
  ])
}

async function updateCowCurrentLocation(
  tableName: string,
  cowRef: ReturnType<typeof resolveCowRef>,
  update: Record<string, any>
) {
  const rows = await getTableDataAsync(tableName, { silent: true }).catch(() => [])
  await Promise.all(
    rows
      .filter((row: any) => rowMatchesCow(row, cowRef))
      .map((row: any) => {
        const id = stringValue(row.id || row.cowId || row.cow_id || row.animalId || row.animal_id)
        return id
          ? updateTableRecordAsync(tableName, id, update).catch(() => undefined)
          : Promise.resolve()
      })
  )
}

async function writePenAssignmentHistory(
  cowRef: ReturnType<typeof resolveCowRef>,
  eventCode: string,
  details: Record<string, any>,
  targetUnit: string
) {
  const now = new Date().toISOString()
  const date = stringValue(
    details.occurred_at || details.occurredAt || details.event_time || details.eventTime || now
  ).slice(0, 10)
  const rows = await getTableDataAsync('animal_pen_assignment', { silent: true }).catch(() => [])
  await Promise.all(
    rows
      .filter((row: any) => rowMatchesCow(row, cowRef) && !stringValue(row.endDate || row.end_date))
      .map((row: any) =>
        stringValue(row.id)
          ? updateTableRecordAsync('animal_pen_assignment', stringValue(row.id), {
              endDate: date,
              end_date: date,
              endReason: eventCode,
              end_reason: eventCode,
              updatedAt: now,
              updated_at: now
            }).catch(() => undefined)
          : Promise.resolve()
      )
  )

  if (eventCode === 'exit' || !targetUnit) return
  const assignmentUnit = await ensureFarmUnitForAssignment(targetUnit, details)
  if (!assignmentUnit) return
  await upsertTableDataAsync('animal_pen_assignment', {
    id: compactRecordId('pen_assignment', cowRef.cowId || cowRef.cowNumber, assignmentUnit, date),
    animalId: cowRef.cowId,
    animal_id: cowRef.cowId,
    cowId: cowRef.cowId,
    cow_id: cowRef.cowId,
    animalNumber: cowRef.cowNumber,
    animal_number: cowRef.cowNumber,
    cowNumber: cowRef.cowNumber,
    cow_number: cowRef.cowNumber,
    unitId: assignmentUnit,
    unit_id: assignmentUnit,
    unitCode: assignmentUnit,
    unit_code: assignmentUnit,
    penCode: assignmentUnit,
    pen_code: assignmentUnit,
    startDate: date,
    start_date: date,
    assignedAt: `${date} 00:00:00`,
    assigned_at: `${date} 00:00:00`,
    startReason: eventCode,
    start_reason: eventCode,
    assignmentReason: eventCode,
    assignment_reason: eventCode,
    sourceType: 'animal_event',
    source_type: 'animal_event',
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
}

function rowMatchesCow(row: Record<string, any>, cowRef: ReturnType<typeof resolveCowRef>) {
  const rowId = stringValue(row.cowId || row.cow_id || row.animalId || row.animal_id || row.id)
  const rowNumber = stringValue(
    row.cowNumber || row.cow_number || row.animalNumber || row.animal_number || row.number
  )
  return (
    (!!cowRef.cowId && rowId === cowRef.cowId) ||
    (!!cowRef.cowNumber && rowNumber === cowRef.cowNumber)
  )
}

function parseDetails(value: unknown) {
  if (!value) return {}
  if (typeof value === 'object') return value as Record<string, any>
  try {
    return JSON.parse(String(value))
  } catch {
    return {}
  }
}

function parseEventTime(value: unknown) {
  const raw = stringValue(value)
  if (!raw) return Number.NaN
  return new Date(raw).getTime()
}

function stringValue(value: unknown) {
  return String(value ?? '').trim()
}

function positiveInteger(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0
}

function finiteNumber(...values: unknown[]) {
  for (const value of values) {
    const numberValue = Number(value)
    if (Number.isFinite(numberValue)) return numberValue
  }
  return undefined
}

function sensorMetricName(row: Record<string, any>, details: Record<string, any>) {
  return stringValue(
    row.metric ||
      row.metricCode ||
      row.metric_code ||
      row.traitCode ||
      row.trait_code ||
      row.indicator ||
      row.indicatorCode ||
      details.metric ||
      details.metricCode ||
      details.metric_code ||
      details.traitCode ||
      details.trait_code
  ).toLowerCase()
}

function isTemperatureSensorMetric(metric: string) {
  return /temp|temperature|body_temperature|ear_temperature|rectal_temperature|体温|耳温|温度/.test(
    metric
  )
}

function isStepsSensorMetric(metric: string) {
  return /step|steps|pedometer|walk|步数|步/.test(metric)
}

function isActivitySensorMetric(metric: string) {
  return /activity|active|motion|activity_index|活动|运动/.test(metric)
}

function sensorValue(row: Record<string, any>, details: Record<string, any>) {
  return finiteNumber(
    row.value,
    row.readingValue,
    row.reading_value,
    row.numericValue,
    row.numeric_value,
    row.measureValue,
    row.measure_value,
    details.value,
    details.readingValue,
    details.reading_value,
    details.numericValue,
    details.numeric_value
  )
}

function normalizeSensorRow(row: Record<string, any>, sourceTable: string) {
  const details = parseDetails(row.payload || row.details || row.extra || row.raw)
  const metric = sensorMetricName(row, details)
  const value = sensorValue(row, details)
  const cowId = stringValue(
    row.cowId ||
      row.cow_id ||
      row.animalId ||
      row.animal_id ||
      row.animalNumber ||
      row.animal_number
  )
  const cowNumber = stringValue(
    row.cowNumber ||
      row.cow_number ||
      row.animalNumber ||
      row.animal_number ||
      row.earTagNumber ||
      row.ear_tag_number
  )
  const timestamp = stringValue(
    row.timestamp ||
      row.ts ||
      row.readAt ||
      row.read_at ||
      row.measuredAt ||
      row.measured_at ||
      row.recordedAt ||
      row.recorded_at ||
      row.createdAt ||
      row.created_at ||
      row.updatedAt ||
      row.updated_at
  )
  const normalized: Record<string, any> = {
    ...row,
    cowId,
    cowNumber,
    timestamp,
    sourceTable,
    source_table: sourceTable,
    metric: row.metric || row.metricCode || row.metric_code || metric
  }
  const temperature = finiteNumber(
    row.temperature,
    row.body_temperature,
    row.bodyTemperature,
    row.ear_temperature,
    row.earTemperature,
    row.rectal_temperature,
    row.rectalTemperature,
    details.temperature,
    details.body_temperature,
    details.bodyTemperature,
    isTemperatureSensorMetric(metric) ? value : undefined
  )
  const steps = finiteNumber(
    row.steps,
    row.stepCount,
    row.step_count,
    row.activity_steps,
    row.activitySteps,
    details.steps,
    details.stepCount,
    details.step_count,
    isStepsSensorMetric(metric) ? value : undefined
  )
  const activity = finiteNumber(
    row.activity,
    row.activityIndex,
    row.activity_index,
    row.activityAmount,
    row.activity_amount,
    details.activity,
    details.activityIndex,
    details.activity_index,
    isActivitySensorMetric(metric) ? value : undefined
  )
  if (temperature !== undefined) normalized.temperature = temperature
  if (steps !== undefined) {
    normalized.steps = steps
    normalized.stepCount = steps
    normalized.step_count = steps
  }
  if (activity !== undefined) {
    normalized.activity = activity
    normalized.activityIndex = activity
    normalized.activity_index = activity
  }
  if (normalized.steps === undefined && normalized.activity !== undefined) {
    normalized.steps = normalized.activity
  }
  return normalized
}

function getUnifiedSensorSnapshots(
  groups: Array<{ sourceTable: string; rows: Record<string, any>[] }>
) {
  const priority: Record<string, number> = {
    sensor_reading: 0,
    'sensor-readings': 1,
    sensors: 2
  }
  const byFactKey = new Map<string, Record<string, any>>()
  ;[...groups]
    .sort((left, right) => (priority[left.sourceTable] ?? 9) - (priority[right.sourceTable] ?? 9))
    .forEach((group) => {
      ;(group.rows || []).forEach((row, index) => {
        const normalized = normalizeSensorRow(row || {}, group.sourceTable)
        if (!normalized.cowId && !normalized.cowNumber) return
        if (
          normalized.temperature === undefined &&
          normalized.steps === undefined &&
          normalized.activity === undefined &&
          normalized.ambientTemp === undefined &&
          normalized.ambient_temp === undefined
        ) {
          return
        }
        const keyParts = [
          normalized.cowId,
          normalized.cowNumber,
          normalized.timestamp,
          normalized.metric,
          normalized.value ??
            normalized.temperature ??
            normalized.steps ??
            normalized.activity ??
            index
        ]
        const key = keyParts.map(stringValue).join('|')
        if (!byFactKey.has(key)) byFactKey.set(key, normalized)
      })
    })
  return Array.from(byFactKey.values())
}

export function getUnifiedSensorData(cowIds: string[] = []): Record<string, any>[] {
  const targetCowSet = cowIds.length > 0 ? new Set(cowIds.map(String)) : null
  const rows = getUnifiedSensorSnapshots([
    { sourceTable: 'sensors', rows: getTableData('sensors') },
    { sourceTable: 'sensor_reading', rows: getTableData('sensor_reading') },
    { sourceTable: 'sensor-readings', rows: getTableData('sensor-readings') }
  ])
  if (!targetCowSet) return rows
  return rows.filter(
    (row) =>
      targetCowSet.has(String(row.cowId || '')) || targetCowSet.has(String(row.cowNumber || ''))
  )
}

export async function getUnifiedSensorDataAsync(
  cowIds: string[] = [],
  options: {
    limit?: number
    page?: number
    pageSize?: number
    orderBy?: string
    orderDir?: 'asc' | 'desc' | 'ASC' | 'DESC'
  } = {}
): Promise<Record<string, any>[]> {
  const [sensors, v2Readings, legacyReadings] = await Promise.all([
    getTableDataAsync('sensors', { silent: true, ...options }),
    getTableDataAsync('sensor_reading', { silent: true, ...options }),
    getTableDataAsync('sensor-readings', { silent: true, ...options })
  ])
  const targetCowSet = cowIds.length > 0 ? new Set(cowIds.map(String)) : null
  const rows = getUnifiedSensorSnapshots([
    { sourceTable: 'sensors', rows: sensors },
    { sourceTable: 'sensor_reading', rows: v2Readings },
    { sourceTable: 'sensor-readings', rows: legacyReadings }
  ])
  if (!targetCowSet) return rows
  return rows.filter(
    (row) =>
      targetCowSet.has(String(row.cowId || '')) || targetCowSet.has(String(row.cowNumber || ''))
  )
}

function startTimeOfDate(value: unknown) {
  return startOfDayMs(parseEventTime(value))
}

function startOfDayMs(time: number) {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function endOfDay(time: number) {
  const date = new Date(time)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

function sameDate(left: number, right: number) {
  return startOfDayMs(left) === startOfDayMs(right)
}

function eventMomentKey(value: unknown) {
  const raw = stringValue(value)
  if (!raw) return ''
  const time = parseEventTime(raw)
  return Number.isFinite(time) ? new Date(time).toISOString() : raw.slice(0, 10)
}

function canonicalEventSourceTable(value: unknown) {
  const source = stringValue(value)
  return source === 'cow-events' ? 'animal_event' : source
}

function eventSourcePriority(value: unknown) {
  const source = canonicalEventSourceTable(value)
  if (source === 'animal_event') return 0
  if (source === 'breeding-events') return 1
  return 2
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

export async function upsertTableDataAsync(
  tableName: string,
  record: Record<string, any>
): Promise<void> {
  const id = String(record.id || '').trim()
  const normalizedRecord = normalizeBackendRecord(tableName, record)
  if (enqueueTableDataBulkWrite(tableName, normalizedRecord)) return

  if (!id) {
    await addTableDataAsync(tableName, normalizedRecord)
    return
  }

  if (isBackendMode) {
    await dbRpc('addTableData', { tableName, data: [normalizedRecord] })
    delete dataCache[tableName]
    return
  }

  const table = getTable(tableName)
  if (!table) {
    console.warn(`表 ${tableName} 不存在`)
    return
  }

  await table.put(normalizedRecord)
  const cached = dataCache[tableName]
  if (cached) {
    const index = cached.findIndex((row: any) => String(row.id || '') === id)
    const next = [...cached]
    if (index >= 0) next[index] = { ...next[index], ...normalizedRecord }
    else next.push(normalizedRecord)
    dataCache[tableName] = next
    onDataUpdate?.(tableName, next)
  }
}

/** 添加传感器读数（同时写入 v2 与兼容长表） */
export async function addSensorReading(reading: {
  cowId: string
  cowNumber?: string
  deviceId?: string
  channelId?: string
  timestamp: string
  metric: string
  value: number
  unit?: string
  quality?: string
  rawPayload?: Record<string, any>
}): Promise<void> {
  const productionDate = reading.timestamp ? String(reading.timestamp).slice(0, 10) : ''
  const record = {
    id: reading.cowId + '_' + reading.timestamp + '_' + reading.metric,
    cowId: reading.cowId,
    cow_id: reading.cowId,
    cowNumber: reading.cowNumber || '',
    cow_number: reading.cowNumber || '',
    animalId: reading.cowId,
    animal_id: reading.cowId,
    animalNumber: reading.cowNumber || '',
    animal_number: reading.cowNumber || '',
    deviceId: reading.deviceId || '',
    device_id: reading.deviceId || '',
    channelId: reading.channelId || '',
    channel_id: reading.channelId || '',
    timestamp: reading.timestamp,
    measuredAt: reading.timestamp,
    measured_at: reading.timestamp,
    readAt: reading.timestamp,
    read_at: reading.timestamp,
    metric: reading.metric,
    metricCode: reading.metric,
    metric_code: reading.metric,
    value: reading.value,
    readingValue: reading.value,
    reading_value: reading.value,
    unit: reading.unit || '',
    quality: reading.quality || 'good',
    qualityFlag: reading.quality || 'valid',
    quality_flag: reading.quality || 'valid',
    productionDate,
    production_date: productionDate,
    rawPayload: reading.rawPayload || {},
    raw_payload: reading.rawPayload || {},
    createdAt: new Date().toISOString()
  }

  await Promise.all([
    upsertTableDataAsync('sensor_reading', {
      ...record,
      sourceTable: 'sensor_reading',
      source_table: 'sensor_reading'
    }),
    upsertTableDataAsync('sensor-readings', record)
  ])
}

/** 按指标查询传感器数据（利用长表索引） */
export async function getSensorReadingsByMetric(
  cowId: string,
  metric: string,
  from?: string,
  to?: string
): Promise<any[]> {
  const table = getTable('sensor-readings')
  if (!table) return []

  const query = table
    .where('[cowId+metric+timestamp]')
    .between([cowId, metric, from || ''], [cowId, metric, to || '￿'], true, true)

  return query.toArray()
}

export function clearTableData(tableName: string): void {
  dataCache[tableName] = []
  onDataUpdate?.(tableName, [])

  if (isBackendMode) {
    dbRpc('clearTableData', { tableName }).catch((error) => {
      console.error(`清空表 ${tableName} 失败:`, error)
    })
    return
  }

  const table = getTable(tableName)
  if (table) {
    table.clear().catch((error: any) => {
      console.error(`清空表 ${tableName} 失败:`, error)
    })
  }
}

export async function clearTableDataAsync(tableName: string): Promise<void> {
  if (isBackendMode) {
    await dbRpc('clearTableData', { tableName })
    dataCache[tableName] = []
    onDataUpdate?.(tableName, [])
    return
  }

  const table = getTable(tableName)
  if (!table) {
    console.warn(`表 ${tableName} 不存在`)
    return
  }

  await table.clear()
  dataCache[tableName] = []
  onDataUpdate?.(tableName, [])
}

export function getDataStats(): Record<string, number> {
  const stats: Record<string, number> = {}
  for (const tableName of DEFAULT_TABLES) {
    const data = getTableData(tableName)
    stats[tableName] = data.length
  }
  return stats
}

export function getLatestSensorDataMap(cowIds: string[] = []): Record<string, any> {
  const latestSensorByCow: Record<string, any> = {}
  const latestTimestampByCow: Record<string, number> = {}
  const targetCowSet = cowIds.length > 0 ? new Set(cowIds.map(String)) : null
  const allSensors = getUnifiedSensorData(cowIds)

  for (const sensor of allSensors) {
    const sensorKeys = uniqueStrings([stringValue(sensor?.cowId), stringValue(sensor?.cowNumber)])
    if (!sensorKeys.length) continue
    if (targetCowSet && !sensorKeys.some((key) => targetCowSet.has(key))) continue

    const timeValue = sensor.timestamp || sensor.ts || sensor.createdAt || sensor.updatedAt
    const timestamp = new Date(timeValue).getTime()
    const safeTimestamp = Number.isFinite(timestamp) ? timestamp : 0
    const primaryKey = sensorKeys[0]

    if (
      latestTimestampByCow[primaryKey] === undefined ||
      safeTimestamp >= latestTimestampByCow[primaryKey]
    ) {
      const normalized = {
        ...sensor,
        steps: Number(
          sensor.steps ??
            sensor.stepCount ??
            sensor.step_count ??
            sensor.activityIndex ??
            sensor.activity_index ??
            sensor.activity ??
            0
        )
      }
      sensorKeys.forEach((key) => {
        latestTimestampByCow[key] = safeTimestamp
        latestSensorByCow[key] = normalized
      })
    }
  }

  return latestSensorByCow
}

export async function getLatestSensorDataMapAsync(
  cowIds: string[] = []
): Promise<Record<string, any>> {
  const latestSensorByCow: Record<string, any> = {}
  const latestTimestampByCow: Record<string, number> = {}
  const targetCowSet = cowIds.length > 0 ? new Set(cowIds.map(String)) : null
  const allSensors = await getUnifiedSensorDataAsync(cowIds)

  for (const sensor of allSensors) {
    const sensorKeys = uniqueStrings([stringValue(sensor?.cowId), stringValue(sensor?.cowNumber)])
    if (!sensorKeys.length) continue
    if (targetCowSet && !sensorKeys.some((key) => targetCowSet.has(key))) continue

    const timeValue = sensor.timestamp || sensor.ts || sensor.createdAt || sensor.updatedAt
    const timestamp = new Date(timeValue).getTime()
    const safeTimestamp = Number.isFinite(timestamp) ? timestamp : 0
    const primaryKey = sensorKeys[0]

    if (
      latestTimestampByCow[primaryKey] === undefined ||
      safeTimestamp >= latestTimestampByCow[primaryKey]
    ) {
      const normalized = {
        ...sensor,
        steps: Number(
          sensor.steps ??
            sensor.stepCount ??
            sensor.step_count ??
            sensor.activityIndex ??
            sensor.activity_index ??
            sensor.activity ??
            0
        )
      }
      sensorKeys.forEach((key) => {
        latestTimestampByCow[key] = safeTimestamp
        latestSensorByCow[key] = normalized
      })
    }
  }

  return latestSensorByCow
}

export async function getSensorSeriesByCowAsync(
  cowId: string,
  metric: 'temperature' | 'steps' | 'ambientTemp' = 'temperature',
  limit = 24
): Promise<Array<{ time: string; value: number; raw: any }>> {
  if (!cowId) return []

  const allSensors = await getUnifiedSensorDataAsync([cowId])

  return allSensors
    .filter((sensor: any) => String(sensor?.cowId || sensor?.cowNumber || '') === String(cowId))
    .map((sensor: any) => {
      const timeValue = sensor.timestamp || sensor.ts || sensor.createdAt || sensor.updatedAt
      const timestamp = new Date(timeValue).getTime()
      const value = Number(sensor?.[metric])
      return {
        time: timeValue || '',
        timestamp: Number.isFinite(timestamp) ? timestamp : 0,
        value,
        raw: sensor
      }
    })
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-Math.max(1, limit))
    .map(({ timestamp: _timestamp, ...item }) => item)
}

export async function getDataStatsAsync(): Promise<Record<string, number>> {
  if (isBackendMode) {
    return dbRpc<Record<string, number>>('getDataStats')
  }

  const stats: Record<string, number> = {}
  for (const tableName of DEFAULT_TABLES) {
    try {
      const table = getTable(tableName)
      stats[tableName] = table ? await table.count() : 0
    } catch {
      stats[tableName] = 0
    }
  }
  return stats
}

export async function initDatabaseService() {
  if (isInitialized) return

  if (isBackendMode) {
    try {
      const backendReady = await checkBackendHealth()
      if (!backendReady) {
        isInitialized = true
        console.warn('⚠️ Backend 当前不可用，已跳过初始化预加载（后续访问会自动重试）')
        return
      }

      const failedTables: string[] = []
      await Promise.all(
        DEFAULT_TABLES.map(async (tableName) => {
          try {
            await getTableDataAsync(tableName, { silent: true })
          } catch {
            delete dataCache[tableName]
            failedTables.push(tableName)
          }
        })
      )
      isInitialized = true
      if (failedTables.length === 0) {
        console.log('✅ Backend 数据服务初始化成功')
      } else {
        console.warn(
          `⚠️ Backend 数据服务初始化完成，${failedTables.length} 个表加载失败（已在后续访问时自动重试）`,
          failedTables
        )
      }
      return
    } catch (error) {
      console.error('❌ Backend 数据服务初始化失败:', error)
      throw error
    }
  }

  try {
    await db.open()

    for (const tableName of DEFAULT_TABLES) {
      const table = getTable(tableName)
      if (table) {
        try {
          dataCache[tableName] = await table.toArray()
        } catch {
          dataCache[tableName] = []
        }
      }
    }

    isInitialized = true
    console.log('✅ IndexedDB 数据库服务初始化成功')

    // 初始化基础字典：为空表时插入最小可用业务字典
    await seedDatabaseIfEmpty()
  } catch (error) {
    console.error('❌ 数据库初始化失败:', error)
    throw error
  }
}

/** 种子数据初始化：为空表插入演示数据 */
async function seedDatabaseIfEmpty() {
  const seedPromises: Promise<void>[] = []

  // 人员数据
  if ((dataCache['persons'] || []).length === 0) {
    seedPromises.push(
      db
        .transaction('rw', db.persons, async () => {
          await db.persons.bulkAdd([
            {
              id: 'seed-person-1',
              name: '王牧',
              department: '生产管理',
              role: '管理员',
              phone: '',
              email: '',
              status: '正常',
              hireDate: '2024-01-01',
              notes: '平台管理员',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-person-2',
              name: '李医',
              department: '健康管理',
              role: '兽医',
              phone: '',
              email: '',
              status: '正常',
              hireDate: '2024-01-01',
              notes: '健康事件记录',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-person-3',
              name: '张饲',
              department: '生产管理',
              role: '饲养员',
              phone: '',
              email: '',
              status: '正常',
              hireDate: '2024-01-01',
              notes: '生产事件记录',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ] as any[])
        })
        .then(() => {
          dataCache['persons'] = db.persons.toArray() as any
        })
    )
  }

  // 圈舍数据
  if ((dataCache['pens'] || []).length === 0) {
    seedPromises.push(
      db
        .transaction('rw', db.pens, async () => {
          await db.pens.bulkAdd([
            {
              id: 'seed-pen-1',
              name: 'A01 育成舍',
              category: '育成舍',
              capacity: 50,
              area: 200,
              manager: '张饲',
              status: '正常',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-pen-2',
              name: 'B01 配种舍',
              category: '配种舍',
              capacity: 32,
              area: 150,
              manager: '张饲',
              status: '正常',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-pen-3',
              name: 'D01 产房',
              category: '产房',
              capacity: 18,
              area: 96,
              manager: '李医',
              status: '正常',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-pen-4',
              name: 'F01 备用舍',
              category: '备用舍',
              capacity: 20,
              area: 120,
              manager: '张饲',
              status: '正常',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ])
        })
        .then(() => {
          dataCache['pens'] = db.pens.toArray() as any
        })
    )
  }

  // 疾病数据
  if ((dataCache['diseases'] || []).length === 0) {
    seedPromises.push(
      db
        .transaction('rw', db.diseases, async () => {
          await db.diseases.bulkAdd([
            {
              id: 'seed-disease-1',
              name: '牛结节性皮肤病',
              category: '传染病',
              severity: '重度',
              contagious: true,
              symptoms: '发热、皮肤结节、淋巴结肿大',
              treatment: '隔离观察，执行免疫与消毒流程',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-disease-2',
              name: '瘤胃积食',
              category: '代谢病',
              severity: '中度',
              contagious: false,
              symptoms: '采食下降、瘤胃胀满、反刍减少',
              treatment: '调整日粮，必要时进行瘤胃处理',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ])
        })
        .then(() => {
          dataCache['diseases'] = db.diseases.toArray() as any
        })
    )
  }

  // 药品数据
  if ((dataCache['medicines'] || []).length === 0) {
    seedPromises.push(
      db
        .transaction('rw', db.medicines, async () => {
          await db.medicines.bulkAdd([
            {
              id: 'seed-medicine-1',
              name: '阿莫西林注射液',
              category: '抗生素',
              dosage: '按体重核算',
              unit: 'mL',
              usage: '遵医嘱用于呼吸道和软组织感染',
              storage: '阴凉干燥处保存',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-medicine-2',
              name: '伊维菌素',
              category: '驱虫药',
              dosage: '按体重核算',
              unit: 'mL',
              usage: '用于体内外寄生虫防治',
              storage: '避光常温保存',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-medicine-3',
              name: '口蹄疫疫苗',
              category: '疫苗',
              dosage: '按说明书',
              unit: '头份',
              usage: '按免疫程序接种',
              storage: '2-8 摄氏度冷藏',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ])
        })
        .then(() => {
          dataCache['medicines'] = db.medicines.toArray() as any
        })
    )
  }

  // 转群原因
  if ((dataCache['transfer-reasons'] || []).length === 0) {
    seedPromises.push(
      db
        .transaction('rw', db['transfer-reasons'], async () => {
          await db['transfer-reasons'].bulkAdd([
            {
              id: 'seed-reason-0b',
              name: '购入入群',
              category: '生产管理',
              frequency: '低频',
              description: '外购或引种牛只入群',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-reason-0c',
              name: '胚胎移植入群',
              category: '生产管理',
              frequency: '低频',
              description: '胚胎移植来源个体进入本场管理',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-reason-1',
              name: '断奶转群',
              category: '生产管理',
              frequency: '高频',
              description: '犊牛达到断奶条件后转入育成舍',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-reason-2',
              name: '妊娠转群',
              category: '生产管理',
              frequency: '中频',
              description: '确认妊娠后转入妊娠舍',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-reason-3',
              name: '疾病隔离',
              category: '健康管理',
              frequency: '中频',
              description: '异常牛只进入隔离舍观察和处置',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-reason-14',
              name: '淘汰离群',
              category: '其他',
              frequency: '低频',
              description: '生产或健康原因淘汰离群',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-reason-15',
              name: '出售离群',
              category: '其他',
              frequency: '低频',
              description: '牛只出售后离群',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-reason-16',
              name: '死亡离群',
              category: '健康管理',
              frequency: '低频',
              description: '死亡事件形成离群记录',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-reason-17',
              name: '转场离群',
              category: '其他',
              frequency: '临时',
              description: '跨牧场调拨或外转',
              status: '启用',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ])
        })
        .then(() => {
          dataCache['transfer-reasons'] = db['transfer-reasons'].toArray() as any
        })
    )
  }

  // 品种类型
  if ((dataCache['breed-types'] || []).length === 0) {
    seedPromises.push(
      db
        .transaction('rw', db['breed-types'], async () => {
          await db['breed-types'].bulkAdd([
            {
              id: 'seed-breed-simmental',
              name: '西门塔尔牛',
              category: '肉乳兼用',
              isActive: true,
              createdAt: new Date().toISOString()
            },
            {
              id: 'seed-breed-huaxi',
              name: '华西牛',
              category: '肉用',
              isActive: true,
              createdAt: new Date().toISOString()
            }
          ])
        })
        .then(() => {
          dataCache['breed-types'] = db['breed-types'].toArray() as any
        })
    )
  }

  // 奶质标准
  if ((dataCache['milk-quality-standards'] || []).length === 0) {
    seedPromises.push(
      db
        .transaction('rw', db['milk-quality-standards'], async () => {
          await db['milk-quality-standards'].bulkAdd([
            {
              id: 'seed-standard-a',
              name: '欧盟A级标准',
              fat: { min: 4.0, max: 6.0 },
              protein: { min: 3.2, max: 4.0 },
              lactose: { min: 4.4, max: 5.0 },
              scc: { max: 400000 },
              urea: { max: 50 },
              freezingPoint: { min: -0.515, max: -0.53 },
              description: '欧盟优质奶标准',
              isActive: true
            },
            {
              id: 'seed-standard-b',
              name: '国内B级标准',
              fat: { min: 3.5, max: 5.5 },
              protein: { min: 2.9, max: 3.8 },
              lactose: { min: 4.2, max: 4.9 },
              scc: { max: 500000 },
              urea: { max: 60 },
              freezingPoint: { min: -0.51, max: -0.535 },
              description: '国内合格奶标准',
              isActive: true
            }
          ])
        })
        .then(() => {
          dataCache['milk-quality-standards'] = db['milk-quality-standards'].toArray() as any
        })
    )
  }

  // 饲料配方
  if ((dataCache['feed-formulas'] || []).length === 0) {
    seedPromises.push(
      db
        .transaction('rw', db['feed-formulas'], async () => {
          await db['feed-formulas'].bulkAdd([
            {
              id: 'seed-formula-1',
              name: '泌乳牛TMR配方',
              description: '适合泌乳期奶牛的完全混合日粮',
              targetGroup: 'lactating',
              nutritionalContent: {
                energy: 1.75,
                protein: 16.5,
                fiber: 18.0,
                calcium: 0.85,
                phosphorus: 0.45,
                vitamins: { A: 80000, D3: 20000, E: 600 },
                minerals: { sodium: 0.18, magnesium: 0.25, zinc: 55, copper: 15 }
              },
              totalCost: 2.85,
              expectedProduction: 15,
              isActive: true,
              createdAt: new Date().toISOString()
            },
            {
              id: 'seed-formula-2',
              name: '干奶期配方',
              description: '适合干奶期的低能量配方',
              targetGroup: 'dry',
              nutritionalContent: {
                energy: 1.45,
                protein: 12.0,
                fiber: 25.0,
                calcium: 0.7,
                phosphorus: 0.35,
                vitamins: { A: 60000, D3: 15000, E: 400 },
                minerals: { sodium: 0.15, magnesium: 0.2, zinc: 45, copper: 12 }
              },
              totalCost: 2.1,
              expectedProduction: 0,
              isActive: true,
              createdAt: new Date().toISOString()
            },
            {
              id: 'seed-formula-3',
              name: '育成牛配方',
              description: '适合育成期牛只的生长配方',
              targetGroup: 'heifer',
              nutritionalContent: {
                energy: 1.55,
                protein: 14.0,
                fiber: 20.0,
                calcium: 0.75,
                phosphorus: 0.4,
                vitamins: { A: 70000, D3: 18000, E: 500 },
                minerals: { sodium: 0.16, magnesium: 0.22, zinc: 50, copper: 14 }
              },
              totalCost: 2.4,
              expectedProduction: 0,
              isActive: true,
              createdAt: new Date().toISOString()
            }
          ] as any[])
        })
        .then(() => {
          dataCache['feed-formulas'] = db['feed-formulas'].toArray() as any
        })
    )
  }

  // 饲料库存
  if ((dataCache['feed-inventory'] || []).length === 0) {
    seedPromises.push(
      db
        .transaction('rw', db['feed-inventory'], async () => {
          await db['feed-inventory'].bulkAdd([
            {
              id: 'seed-inv-1',
              feedId: 'corn-silage',
              feedName: '玉米青贮',
              currentStock: 50000,
              minimumStock: 10000,
              unitCost: 0.8,
              supplier: 'XX农场',
              expiryDate: '2026-12-31',
              qualityGrade: 'A',
              lastUpdated: new Date().toISOString()
            },
            {
              id: 'seed-inv-2',
              feedId: 'alfalfa-hay',
              feedName: '苜蓿草',
              currentStock: 20000,
              minimumStock: 5000,
              unitCost: 2.5,
              supplier: 'XX草业',
              expiryDate: '2026-09-30',
              qualityGrade: 'A',
              lastUpdated: new Date().toISOString()
            },
            {
              id: 'seed-inv-3',
              feedId: 'corn-grain',
              feedName: '玉米粒',
              currentStock: 30000,
              minimumStock: 8000,
              unitCost: 2.2,
              supplier: 'XX粮贸',
              expiryDate: '2027-03-31',
              qualityGrade: 'A',
              lastUpdated: new Date().toISOString()
            },
            {
              id: 'seed-inv-4',
              feedId: 'soybean-meal',
              feedName: '豆粕',
              currentStock: 15000,
              minimumStock: 3000,
              unitCost: 3.5,
              supplier: 'XX油脂',
              expiryDate: '2026-08-31',
              qualityGrade: 'A',
              lastUpdated: new Date().toISOString()
            },
            {
              id: 'seed-inv-5',
              feedId: 'cottonseed-meal',
              feedName: '棉籽粕',
              currentStock: 8000,
              minimumStock: 2000,
              unitCost: 2.8,
              supplier: 'XX棉业',
              expiryDate: '2026-10-31',
              qualityGrade: 'B',
              lastUpdated: new Date().toISOString()
            }
          ] as any[])
        })
        .then(() => {
          dataCache['feed-inventory'] = db['feed-inventory'].toArray() as any
        })
    )
  }

  // 工作流模板
  if ((dataCache['workflow-templates'] || []).length === 0) {
    seedPromises.push(
      db
        .transaction('rw', db['workflow-templates'], async () => {
          await db['workflow-templates'].bulkAdd([
            {
              id: 'seed-wf-1',
              name: '自动温度预警',
              description: '当体温超过阈值时自动创建预警',
              category: 'health',
              triggerType: 'condition',
              triggerCondition: { condition: 'sensor.temperature > 39.5' },
              steps: [
                {
                  id: 'step1',
                  name: '创建预警',
                  description: '创建健康预警',
                  stepType: 'notification',
                  config: {
                    notification: {
                      recipients: ['兽医'],
                      message: '体温异常',
                      urgency: 'high',
                      channels: ['app']
                    }
                  },
                  dependencies: [],
                  timeout: 30,
                  retryCount: 2,
                  onFailure: 'retry'
                }
              ],
              isActive: true,
              priority: 'high',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: 'seed-wf-2',
              name: '产奶量异常检测',
              description: '产奶量连续3天下降超过10%时触发',
              category: '生产配置',
              triggerType: 'condition',
              triggerCondition: { condition: 'milk.decline > 10% for 3 days' },
              steps: [
                {
                  id: 'step1',
                  name: '通知管理员',
                  description: '发送产奶量下降通知',
                  stepType: 'notification',
                  config: {
                    notification: {
                      recipients: ['管理员'],
                      message: '产奶量异常',
                      urgency: 'medium',
                      channels: ['app']
                    }
                  },
                  dependencies: [],
                  timeout: 30,
                  retryCount: 2,
                  onFailure: 'retry'
                }
              ],
              isActive: true,
              priority: 'medium',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ])
        })
        .then(() => {
          dataCache['workflow-templates'] = db['workflow-templates'].toArray() as any
        })
    )
  }

  // 自动化动作
  if ((dataCache['automated-actions'] || []).length === 0) {
    seedPromises.push(
      db
        .transaction('rw', db['automated-actions'], async () => {
          await db['automated-actions'].bulkAdd([
            {
              id: 'seed-action-1',
              name: '高温自动预警',
              description: '体温超过39.5度时自动创建预警',
              actionType: 'notification',
              triggerCondition: {
                sensorThreshold: { metric: 'temperature', operator: '>', value: 39.5, duration: 10 }
              },
              targetConfig: {
                notification: { recipients: ['兽医'], template: '体温异常预警', priority: 'high' }
              },
              isActive: true,
              priority: 'high',
              cooldown: 60,
              executionCount: 0,
              successRate: 1,
              createdAt: new Date().toISOString()
            },
            {
              id: 'seed-action-2',
              name: '自动转群-产前',
              description: '预产前7天自动转入待产区',
              actionType: 'transfer',
              triggerCondition: { customCondition: 'pregnancy_days >= 273' },
              targetConfig: {
                transfer: { targetPen: '待产区', reason: '产前准备', autoConfirm: true }
              },
              isActive: true,
              priority: 'medium',
              cooldown: 1440,
              executionCount: 0,
              successRate: 1,
              createdAt: new Date().toISOString()
            },
            {
              id: 'seed-action-3',
              name: '自动转群-产后',
              description: '产后自动转入泌乳区',
              actionType: 'transfer',
              triggerCondition: { customCondition: 'days_since_calving >= 1' },
              targetConfig: {
                transfer: { targetPen: '泌乳区', reason: '产后恢复', autoConfirm: true }
              },
              isActive: true,
              priority: 'medium',
              cooldown: 1440,
              executionCount: 0,
              successRate: 1,
              createdAt: new Date().toISOString()
            }
          ])
        })
        .then(() => {
          dataCache['automated-actions'] = db['automated-actions'].toArray() as any
        })
    )
  }

  // 智能转群规则
  if ((dataCache['smart-transfer-rules'] || []).length === 0) {
    seedPromises.push(
      db
        .transaction('rw', db['smart-transfer-rules'], async () => {
          await db['smart-transfer-rules'].bulkAdd([
            {
              id: 'seed-rule-1',
              name: '断奶转群',
              description: '犊牛满180天自动转入育成区',
              triggerCondition: { eventType: 'calving_due', parameters: { ageDays: 180 } },
              sourcePens: ['犊牛区'],
              targetPen: '育成区',
              transferReason: '断奶',
              autoExecute: false,
              requiresApproval: true,
              priority: 'medium',
              isActive: true,
              executionCount: 0,
              createdAt: new Date().toISOString()
            },
            {
              id: 'seed-rule-2',
              name: '妊娠转群',
              description: '妊娠确认后自动转入待产区',
              triggerCondition: { eventType: 'pregnancy_confirmed' },
              sourcePens: ['泌乳区', '育成区'],
              targetPen: '待产区',
              transferReason: '待产',
              autoExecute: false,
              requiresApproval: true,
              priority: 'high',
              isActive: true,
              executionCount: 0,
              createdAt: new Date().toISOString()
            },
            {
              id: 'seed-rule-3',
              name: '疾病隔离',
              description: '健康异常自动转入隔离区',
              triggerCondition: { eventType: 'health_alert' },
              sourcePens: [],
              targetPen: '隔离区',
              transferReason: '健康异常',
              autoExecute: true,
              requiresApproval: false,
              priority: 'high',
              isActive: true,
              executionCount: 0,
              createdAt: new Date().toISOString()
            }
          ])
        })
        .then(() => {
          dataCache['smart-transfer-rules'] = db['smart-transfer-rules'].toArray() as any
        })
    )
  }

  // 提醒规则
  if ((dataCache['reminder-rules'] || []).length === 0) {
    seedPromises.push(
      db
        .transaction('rw', db['reminder-rules'], async () => {
          await db['reminder-rules'].bulkAdd([
            {
              id: 'seed-reminder-1',
              name: '疫苗到期提醒',
              description: '疫苗接种到期前7天提醒',
              reminderType: 'vaccination',
              targetCondition: { cowType: ['成母牛', '青年牛'] },
              schedule: { type: 'relative', relativeTo: 'last_vaccination', offset: 365 - 7 },
              notification: {
                recipients: ['兽医'],
                message: '疫苗接种即将到期',
                priority: 'high',
                channels: ['app'],
                advanceNotice: 7
              },
              actions: { autoCreateTask: true, assignTo: '兽医', deadline: 7 },
              isActive: true,
              lastTriggered: undefined,
              triggerCount: 0,
              createdAt: new Date().toISOString()
            },
            {
              id: 'seed-reminder-2',
              name: '配种计划提醒',
              description: '配种计划前3天提醒',
              reminderType: 'pregnancy_check',
              targetCondition: { pregnancyStatus: ['待妊检'] },
              schedule: { type: 'conditional', offset: 3 },
              notification: {
                recipients: ['育种员'],
                message: '妊检计划即将到期',
                priority: 'medium',
                channels: ['app'],
                advanceNotice: 3
              },
              actions: { autoCreateTask: true, assignTo: '育种员', deadline: 3 },
              isActive: true,
              lastTriggered: undefined,
              triggerCount: 0,
              createdAt: new Date().toISOString()
            },
            {
              id: 'seed-reminder-3',
              name: '饲料库存预警',
              description: '饲料库存低于安全线时提醒',
              reminderType: 'inspection',
              targetCondition: {},
              schedule: { type: 'fixed', offset: 0 },
              notification: {
                recipients: ['管理员'],
                message: '饲料库存不足',
                priority: 'high',
                channels: ['app'],
                advanceNotice: 1
              },
              actions: { autoCreateTask: true, assignTo: '管理员', deadline: 1 },
              isActive: true,
              lastTriggered: undefined,
              triggerCount: 0,
              createdAt: new Date().toISOString()
            }
          ])
        })
        .then(() => {
          dataCache['reminder-rules'] = db['reminder-rules'].toArray() as any
        })
    )
  }

  if (seedPromises.length > 0) {
    await Promise.all(seedPromises)
    console.log(`✅ 种子数据初始化完成，共 ${seedPromises.length} 个表`)
  }
}

export function resetDatabase(): void {
  Object.keys(dataCache).forEach((key) => {
    dataCache[key] = []
  })

  if (isBackendMode) {
    dbRpc('resetDatabase').catch((error) => {
      console.error('重置数据库失败:', error)
    })
    return
  }

  db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear()
    }
  }).catch((error) => {
    console.error('重置数据库失败:', error)
  })
}

export async function resetDatabaseAsync(): Promise<void> {
  if (isBackendMode) {
    await dbRpc('resetDatabase')
    Object.keys(dataCache).forEach((key) => {
      dataCache[key] = []
    })
    return
  }

  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear()
    }
  })

  Object.keys(dataCache).forEach((key) => {
    dataCache[key] = []
  })
}
