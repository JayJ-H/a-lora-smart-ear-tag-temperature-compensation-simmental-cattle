/**
 * 通用导出工具 - 支持所有数据库表的导出
 * 支持：Excel/CSV 格式、嵌套对象自动扁平化、自定义列选择
 */

import * as databaseService from '@/services/数据库'
import { estimatePayloadSize, recordV2ExportRun } from '@/services/v2-export'
import * as XLSX from 'xlsx'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/store/modules/user'

interface ExportConfig {
  tableName: string
  format: 'xlsx' | 'csv'
  columns?: string[] // 自定义列，默认导出所有
  filters?: Record<string, any> // 过滤条件
  fileName?: string
  operatorName?: string
}

export const PERIOD_EXPORT_FIELD_SCHEMA = [
  { key: 'period', label: '统计周期', aliases: ['period_key', 'periodKey'] },
  { key: 'collectionDate', label: '采集日期', aliases: ['collection_date'] },
  { key: 'eventDate', label: '事件日期', aliases: ['event_date'] },
  {
    key: 'milkingShift',
    label: '班次',
    aliases: ['milking_shift', 'shiftName', 'shift_name', 'shiftId', 'shift_id']
  },
  {
    key: 'parity',
    label: '胎次',
    aliases: ['parityNo', 'parity_no', 'lactationNo', 'lactation_no']
  },
  {
    key: 'currentParity',
    label: '当前胎次',
    aliases: ['current_parity', 'currentParityNo', 'current_parity_no']
  },
  {
    key: 'parityCalvingDate',
    label: '本胎产犊时间',
    aliases: ['parity_calving_date', 'calvingDate', 'calving_date']
  },
  { key: 'lactationStartDate', label: '开产时间', aliases: ['lactation_start_date'] },
  {
    key: 'lactationEndDate',
    label: '停产日期',
    aliases: ['lactation_end_date', 'dryOffDate', 'dry_off_date']
  },
  { key: 'daysInMilk', label: '泌乳天数', aliases: ['days_in_milk', 'DIM', 'dim'] },
  {
    key: 'daysInMilkRange',
    label: '泌乳天数范围',
    aliases: ['days_in_milk_range', 'dimRange', 'dim_range']
  },
  { key: 'periodSource', label: '周期字段来源', aliases: ['period_source'] },
  {
    key: 'reproductionCycle',
    label: '繁殖周期',
    aliases: ['reproduction_cycle', 'reproductionCycleNo', 'reproduction_cycle_no']
  },
  { key: 'pregnancyStage', label: '妊娠期', aliases: ['pregnancy_stage'] },
  { key: 'dryPeriod', label: '干奶期', aliases: ['dry_period'] },
  { key: 'productionStage', label: '生产阶段', aliases: ['production_stage'] },
  { key: 'herdGroup', label: '牛群', aliases: ['herd_group', 'currentGroup', 'current_group'] },
  {
    key: 'currentPen',
    label: '当前圈舍',
    aliases: [
      'current_pen',
      'currentPenCode',
      'current_pen_code',
      'currentUnitId',
      'current_unit_id',
      'currentUnitCode',
      'current_unit_code'
    ]
  },
  { key: 'equipmentId', label: '设备ID', aliases: ['equipment_id', 'deviceId', 'device_id'] },
  { key: 'collector', label: '采集人', aliases: ['collectorName', 'collector_name'] },
  { key: 'operatorName', label: '操作人', aliases: ['operator_name', 'operator'] }
] as const

export const PERIOD_EXPORT_FIELD_LABELS: Record<string, string> = PERIOD_EXPORT_FIELD_SCHEMA.reduce(
  (labels, field) => {
    labels[field.key] = field.label
    field.aliases.forEach((alias) => {
      labels[alias] = field.label
    })
    return labels
  },
  {} as Record<string, string>
)

/**
 * 将嵌套对象扁平化为单层结构（用于导出）
 * { milkQuality: { fat: 3.5 } } → { 'milkQuality.fat': 3.5 }
 */
export function flattenObject(obj: any, prefix = '', maxDepth = 3): Record<string, any> {
  if (obj === null || obj === undefined) return { [prefix]: '' }
  if (typeof obj !== 'object') return { [prefix]: obj }
  if (Array.isArray(obj)) return { [prefix]: JSON.stringify(obj) }

  const result: Record<string, any> = {}

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      prefix.split('.').length < maxDepth
    ) {
      Object.assign(result, flattenObject(value, fullKey, maxDepth))
    } else if (Array.isArray(value)) {
      result[fullKey] = JSON.stringify(value)
    } else {
      result[fullKey] = value
    }
  }

  return result
}

/**
 * 从数据库表获取数据（自动合并新旧表）
 */
export async function getTableExportData(tableName: string): Promise<any[]> {
  // 统一事件表特殊处理
  if (tableName === 'cow-events') {
    return databaseService.getTableDataAsync('cow-events', { silent: true })
  }

  // 传感器长表特殊处理
  if (tableName === 'sensor-readings') {
    return databaseService.getTableDataAsync('sensor-readings', { silent: true })
  }

  // 默认：直接查询
  return databaseService.getTableDataAsync(tableName, { silent: true })
}

/**
 * 将数据转换为导出格式
 */
export function prepareExportData(rows: any[], columns?: string[]): Record<string, any>[] {
  const flattenedRows = rows.map((row) => flattenObject(row))

  // 获取所有列名
  const requestedColumns = columns?.length
    ? columns
    : Array.from(new Set(flattenedRows.flatMap(Object.keys)))
  const allColumns = requestedColumns.filter(isDefaultUserExportColumn)

  // 按指定列顺序输出，过滤不存在的列
  return flattenedRows.map((row) => {
    const output: Record<string, any> = {}
    for (const col of allColumns) {
      output[col] = row[col] ?? ''
    }
    return output
  })
}

const DEFAULT_HIDDEN_EXPORT_COLUMN_PATTERNS = [
  /(^|\.)(id|uuid)$/i,
  /(^|\.)(cowId|animalId|cow_id|animal_id)$/i,
  /(^|\.)(earTagNumber|ear_tag_number|electronicTag|electronic_tag)$/i,
  /(^|\.)(recordType|record_type)$/i,
  /(^|\.)(currentParity|current_parity|aggregation)$/i,
  /(^|\.)(sourceTable|source_table|sourceRecordId|source_record_id|sourceRecordIds|source_record_ids)$/i,
  /(^|\.)(relationScope|relation_scope|cowIds|cow_ids|cowNumbers|cow_numbers)$/i,
  /(^|\.)(payload|rawPayload|raw_payload|metadata|meta)$/i,
  /(^|\.)(qualityFlag|quality_flag|qcStatus|qc_status)$/i,
  /(^|\.)(notes|remark|remarks|comment|comments)$/i,
  /(^|\.)(createdBy|created_by|updatedBy|updated_by|deletedAt|deleted_at)$/i
]

export function isDefaultUserExportColumn(column: string): boolean {
  const key = String(column || '').trim()
  if (!key) return false
  return !DEFAULT_HIDDEN_EXPORT_COLUMN_PATTERNS.some((pattern) => pattern.test(key))
}

function getOperatorName() {
  try {
    const info = useUserStore().getUserInfo || {}
    return String(info.userName || info.userId || '当前登录账号')
  } catch {
    return '当前登录账号'
  }
}

function getExportTableLabel(tableName: string) {
  return EXPORTABLE_TABLES.find((item) => item.name === tableName)?.label || tableName
}

function isFilterMatched(row: any, filters?: Record<string, any>) {
  if (!filters || Object.keys(filters).length === 0) return true
  return Object.entries(filters).every(([field, expected]) => {
    if (expected === undefined || expected === null || expected === '') return true
    const actual = getNestedValue(row, field)
    if (Array.isArray(expected)) {
      return expected.length === 0 || expected.map(String).includes(String(actual))
    }
    return String(actual ?? '') === String(expected)
  })
}

function getNestedValue(row: any, field: string) {
  return field.includes('.') ? field.split('.').reduce((acc, key) => acc?.[key], row) : row?.[field]
}

async function hashText(value: string) {
  const encoded = new TextEncoder().encode(value)
  if (window.crypto?.subtle) {
    const buffer = await window.crypto.subtle.digest('SHA-256', encoded)
    return Array.from(new Uint8Array(buffer))
      .map((item) => item.toString(16).padStart(2, '0'))
      .join('')
  }
  let hash = 0
  encoded.forEach((byte) => {
    hash = (Math.imul(31, hash) + byte) | 0
  })
  return `fallback-${Math.abs(hash).toString(16)}`
}

function collectCowIds(rows: any[]) {
  return Array.from(
    new Set(
      rows
        .map((row) => row.animalId || row.animal_id || row.cowId || row.cow_id || row.id)
        .filter(Boolean)
        .map(String)
    )
  )
}

function collectCowNumbers(rows: any[]) {
  return Array.from(
    new Set(
      rows
        .map((row) => row.cowNumber || row.cow_number || row.earTagNumber || row.ear_tag_number)
        .filter(Boolean)
        .map(String)
    )
  )
}

function collectSourceRecordIds(tableName: string, rows: any[]) {
  return rows.reduce<Record<string, string[]>>((result, row) => {
    const id = String(row.sourceRecordId || row.source_record_id || row.id || '')
    if (!id) return result
    result[tableName] = Array.from(new Set([...(result[tableName] || []), id]))
    return result
  }, {})
}

async function writeGenericExportAudit(
  config: ExportConfig,
  fileName: string,
  sourceRows: any[],
  exportedRows: Record<string, any>[],
  startedAt: string,
  finishedAt: string,
  checksum: string
) {
  const operatorName = config.operatorName || getOperatorName()
  const auditId = `export-generic-${config.tableName}-${Date.now()}`
  const cowIds = collectCowIds(sourceRows)
  const cowNumbers = collectCowNumbers(sourceRows)
  const sourceRecordIds = collectSourceRecordIds(config.tableName, sourceRows)
  const parameters = {
    tableName: config.tableName,
    format: config.format,
    columns: config.columns || null,
    filters: config.filters || {}
  }
  const resultSnapshot = {
    rowCount: sourceRows.length,
    fileName,
    fileHash: checksum,
    exportedColumns: config.columns || null,
    previewRows: exportedRows.slice(0, 5)
  }
  const relationScope = {
    domain: 'generic_table_export',
    table: config.tableName,
    cowIds,
    cowNumbers,
    sourceRecordIds
  }

  await databaseService.addTableDataAsync('export-audit-logs', {
    id: auditId,
    operator: operatorName,
    action_type: 'export_table_data',
    status: 'completed',
    file_name: fileName,
    file_hash: checksum,
    file_format: config.format,
    row_count: sourceRows.length,
    filters_json: parameters,
    parameters_json: parameters,
    result_snapshot: resultSnapshot,
    cow_ids: cowIds,
    relation_scope: relationScope,
    source_record_ids: sourceRecordIds,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Math.max(1, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
    created_at: startedAt,
    updated_at: finishedAt
  })

  await databaseService.addTableDataAsync('operation-audit-logs', {
    id: `op-audit-${auditId}`,
    action_type: 'export_table_data',
    target_type: 'export_audit_logs',
    target_id: auditId,
    operator: operatorName,
    status: 'completed',
    request_payload: parameters,
    result_payload: resultSnapshot,
    cow_ids: cowIds,
    relation_scope: relationScope,
    source_record_ids: {
      ...sourceRecordIds,
      export_audit_logs: [auditId]
    },
    created_at: startedAt,
    updated_at: finishedAt
  })

  await recordV2ExportRun({
    scopeCode: `generic_${config.tableName}_export`,
    scopeName: `${getExportTableLabel(config.tableName)}导出`,
    scopeDomain: config.tableName,
    sourceType: 'generic_table_export',
    fileName,
    fileFormat: config.format,
    rowCount: sourceRows.length,
    checksum,
    fileSize: estimatePayloadSize(exportedRows),
    operatorName,
    startedAt,
    finishedAt,
    parameters,
    resultSnapshot,
    periods: [{ periodType: 'all' }],
    scopes: [
      { scopeType: 'source_table', scopeValue: config.tableName },
      ...cowIds.slice(0, 200).map((cowId) => ({ scopeType: 'cow_id', scopeValue: cowId })),
      ...cowNumbers
        .slice(0, 200)
        .map((cowNumber) => ({ scopeType: 'cow_number', scopeValue: cowNumber })),
      ...(config.columns || Object.keys(exportedRows[0] || {}))
        .slice(0, 200)
        .map((field) => ({ scopeType: 'field', scopeValue: field }))
    ],
    selectableFilters: config.filters || {},
    selectableVariables: config.columns || Object.keys(exportedRows[0] || {}),
    defaultPeriods: [{ periodType: 'all' }]
  })
}

/**
 * 中文列名映射（扩展覆盖 29 张表的主要字段）
 */
const COLUMN_LABELS: Record<string, string> = {
  ...PERIOD_EXPORT_FIELD_LABELS,
  // 牛只基础
  cowNumber: '牛号',
  earTagNumber: '耳标号',
  breed: '品种',
  gender: '性别',
  birthDate: '出生日期',
  type: '类型',
  currentPen: '当前圈舍',
  status: '状态',
  pregnancy: '是否预产',
  parity: '胎次',
  fatherNumber: '父号',
  motherNumber: '母号',
  grandfatherNumber: '外祖父号',
  grandmotherNumber: '外祖母号',
  sireId: '父牛ID',
  damId: '母牛ID',
  // 事件
  eventType: '事件类型',
  eventTime: '事件时间',
  eventDate: '事件日期',
  operatorName: '操作人',
  operatorId: '操作人ID',
  person: '人员',
  // 传感器
  metric: '指标',
  value: '数值',
  quality: '质量',
  unit: '单位',
  timestamp: '时间戳',
  batteryLevel: '电池电量',
  signalStrength: '信号强度',
  // 产奶
  milkingTime: '挤奶时间',
  volume: '产量(kg)',
  lactationNumber: '泌乳胎次',
  daysInMilk: '泌乳天数',
  fat: '乳脂(%)',
  protein: '乳蛋白(%)',
  lactose: '乳糖(%)',
  scc: '体细胞数',
  urea: '尿素',
  freezingPoint: '冰点',
  milkQuality: '奶质',
  // 繁殖
  inseminationDate: '配种日期',
  pregnancyCheckDate: '妊检日期',
  actualCalvingDate: '实际产犊日期',
  cycleResult: '周期结果',
  cycleNumber: '周期序号',
  cycleStartDate: '周期开始',
  cycleLength: '周期长度',
  inseminationCount: '配种次数',
  heatDetectedDate: '发情检测日',
  expectedCalvingDate: '预产期',
  // 种公牛
  bullNumber: '公牛号',
  geneticMerit: '遗传评价值',
  totalInseminations: '总配种次数',
  conceptionRate: '受胎率',
  // 繁殖KPI
  heatDetectionRate: '发情检测率',
  avgHeatInterval: '平均发情间隔',
  firstServiceConceptionRate: '一次受胎率',
  pregnancyRate: '妊娠率',
  abortionRate: '流产率',
  calvingInterval: '分娩间隔',
  calfSurvivalRate: '犊牛成活率',
  // 饲料
  feedTime: '饲喂时间',
  plannedAmount: '计划投喂量',
  actualAmount: '实际投喂量',
  formulaId: '配方ID',
  feederId: '饲喂员ID',
  currentStock: '当前库存',
  minimumStock: '最低库存',
  unitCost: '单价',
  targetGroup: '目标群体',
  nutritionalContent: '营养成分',
  ingredients: '配方成分',
  totalCost: '总成本',
  // 人员
  name: '姓名',
  department: '部门',
  role: '角色',
  phone: '电话',
  email: '邮箱',
  hireDate: '入职日期',
  // 圈舍
  penName: '圈舍名称',
  category: '类别',
  capacity: '容量',
  currentCount: '当前数量',
  // 疾病/药品
  disease: '疾病',
  medicine: '药品',
  diagnosis: '诊断',
  symptoms: '症状',
  treatment: '治疗方案',
  treatmentResult: '治疗结果',
  dosage: '剂量',
  vaccineName: '疫苗名称',
  // 经济
  amount: '金额',
  date: '日期',
  costCategory: '成本分类',
  quantity: '数量',
  unitPrice: '单价',
  description: '描述',
  // 组学
  sampleCode: '样本编号',
  sampleType: '样本类型',
  datasetCode: '数据集编号',
  markerCode: '标记编号',
  markerType: '标记类型',
  chromosome: '染色体',
  positionBp: '位置(bp)',
  geneSymbol: '基因符号',
  // 预测
  predictedValue: '预测值',
  confidenceInterval: '置信区间',
  accuracy: '准确率',
  // 工作流
  workflowId: '工作流ID',
  templateId: '模板ID',
  triggerType: '触发类型',
  triggerCondition: '触发条件',
  // 硬件
  deviceId: '设备ID',
  deviceType: '设备类型',
  brand: '品牌',
  model: '型号',
  firmwareVersion: '固件版本',
  lastSeen: '最后在线',
  // 通用
  createdAt: '创建时间',
  updatedAt: '更新时间',
  notes: '备注',
  cost: '费用',
  id: 'ID',
  isActive: '是否启用',
  isPublic: '是否公开',
  createdBy: '创建人',
  fromPen: '原圈舍',
  toPen: '目标圈舍',
  recorder: '记录人',
  exitReason: '离场原因',
  reason: '原因',
  result: '结果',
  method: '方法',
  bullId: '公牛ID',
  details: '详情',
  calfCount: '犊牛数量',
  calfDetails: '犊牛详情',
  deliveryMethod: '分娩方式',
  gestationDays: '妊娠天数',
  checkMethod: '检查方法',
  calfGender: '犊牛性别',
  calvingResult: '产犊结果',
  offspringCount: '牛数量',
  offspringGender: '犊牛性别',
  offspringStatus: '犊牛状态',
  abortionReason: '流产原因',
  entryReason: '入场原因',
  transferReason: '转群原因',
  fromPenId: '原圈舍ID',
  toPenId: '目标圈舍ID',
  semenBatch: '精液批号',
  checkType: '检查类型',
  findings: '发现',
  recommendations: '建议',
  destination: '去向',
  entryWeight: '入场体重',
  exitWeight: '离场体重',
  sourceFarm: '来源牧场',
  weight: '体重',
  bodyScore: '体况评分'
}

/**
 * 执行导出
 */
export async function exportTableData(config: ExportConfig): Promise<void> {
  try {
    const startedAt = new Date().toISOString()
    const allRows = await getTableExportData(config.tableName)
    const rows = allRows.filter((row) => isFilterMatched(row, config.filters))
    if (!rows || rows.length === 0) {
      ElMessage.warning('没有可导出的数据')
      return
    }

    // 准备数据
    const exportData = prepareExportData(rows, config.columns)

    // 添加中文列名
    const labeledData = exportData.map((row) => {
      const labeled: Record<string, any> = {}
      for (const [key, value] of Object.entries(row)) {
        labeled[COLUMN_LABELS[key] || key] = value
      }
      return labeled
    })

    // 生成文件名
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const fileName = config.fileName || `${config.tableName}_${timestamp}.${config.format}`
    const checksum = await hashText(JSON.stringify({ config, rows, labeledData }))

    if (config.format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(labeledData)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, config.tableName)
      XLSX.writeFile(wb, fileName)
    } else {
      // RFC 4180 兼容的 CSV 编码
      const encodeCsvValue = (val: any): string => {
        const str = String(val ?? '')
        // 如果值包含逗号、双引号或换行，需要用双引号包裹
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }

      const headers = Object.keys(labeledData[0] || {})
      const csvContent = [
        headers.join(','),
        ...labeledData.map((row) => headers.map((h) => encodeCsvValue(row[h])).join(','))
      ].join('\r\n')

      // 添加 UTF-8 BOM 防止 Excel 乱码
      const bom = '﻿'
      const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = fileName
      link.click()
    }

    const finishedAt = new Date().toISOString()
    await writeGenericExportAudit(
      config,
      fileName,
      rows,
      labeledData,
      startedAt,
      finishedAt,
      checksum
    )

    ElMessage.success(`导出成功，共 ${rows.length} 条记录`)
  } catch (error) {
    console.error(`导出表 ${config.tableName} 失败:`, error)
    ElMessage.error('导出失败: ' + (error instanceof Error ? error.message : String(error)))
  }
}

/**
 * 获取表的所有可导出列
 */
export async function getTableColumns(tableName: string): Promise<string[]> {
  const rows = await getTableExportData(tableName)
  if (!rows || rows.length === 0) return []

  const columns = new Set<string>()
  for (const row of rows) {
    const flat = flattenObject(row)
    Object.keys(flat)
      .filter(isDefaultUserExportColumn)
      .forEach((key) => columns.add(key))
  }

  return Array.from(columns)
}

/**
 * 可用的导出表列表
 */
export const EXPORTABLE_TABLES = [
  { name: 'cows', label: '牛只信息' },
  { name: 'cow-events', label: '牛只事件（统一）' },
  { name: 'sensor-readings', label: '传感器数据（长表）' },
  { name: 'milk-records', label: '产奶记录' },
  { name: 'feed-records', label: '饲料记录' },
  { name: 'breeding-records', label: '繁殖记录' },
  { name: 'reproduction-cycles', label: '繁殖周期' },
  { name: 'breeding-bulls', label: '种公牛' },
  { name: 'health-scores', label: '健康评分' },
  { name: 'health-alerts', label: '健康预警' },
  { name: 'cost-items', label: '成本记录' },
  { name: 'revenue-items', label: '收入记录' },
  { name: 'persons', label: '人员信息' },
  { name: 'pens', label: '圈舍信息' },
  { name: 'diseases', label: '疾病字典' },
  { name: 'medicines', label: '药品字典' },
  { name: 'breed-types', label: '品种字典' },
  { name: 'feed-formulas', label: '饲料配方' },
  { name: 'feed-inventory', label: '饲料库存' },
  { name: 'predictive-models', label: '预测模型' },
  { name: 'omics-samples', label: '组学样本' },
  { name: 'omics-datasets', label: '组学数据集' },
  { name: 'breeding-analyses', label: '育种分析' },
  { name: 'phenotype-records', label: '表型记录' },
  { name: 'phenotype-trait-definitions', label: '表型性状定义' },
  { name: 'workflow-templates', label: '工作流模板' },
  { name: 'hardware-devices', label: '硬件设备' },
  { name: 'data-synchronizations', label: '数据同步' }
] as const
