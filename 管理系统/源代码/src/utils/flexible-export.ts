/**
 * 灵活导出/导入/自定义字段系统
 * 多维统计 + 自定义字段 + 可配置导出导入
 */

import * as databaseService from '@/services/database'
import {
  estimatePayloadSize,
  recordV2ExportRun,
  upsertExportScopeDefinition
} from '@/services/v2-export'
import { PERIOD_EXPORT_FIELD_SCHEMA } from '@/utils/export'
import * as XLSX from 'xlsx'
import { ElMessage } from 'element-plus'

// ====== 可配置导出系统 ======

/** 导出配置 */
export interface ExportConfig {
  id: string
  name: string // 配置名称
  scope: string // 适用范围：cow/events/milk/feed/reproduction
  targetType: string // 目标类型：all/lactating/dry/bulls 等
  dateRange?: { start: string; end: string } // 时间范围
  groupBy: 'day' | 'month' | 'year' | 'parity' | 'pen' | 'breed' | 'none' // 分组维度
  aggregations: Aggregation[] // 聚合函数
  columns: ExportColumn[] // 导出列配置
  filters?: Record<string, any> // 过滤条件
  format: 'xlsx' | 'csv'
  createdAt: string
  updatedAt?: string
}

/** 聚合函数配置 */
export interface Aggregation {
  field: string // 要聚合的字段
  functions: ('count' | 'sum' | 'avg' | 'min' | 'max' | 'median')[] // 聚合函数
  label?: string // 显示名称
}

/** 导出列配置 */
export interface ExportColumn {
  field: string // 字段名（支持点号嵌套：details.diagnosis）
  label: string // 列标题（中文）
  visible: boolean // 是否显示
  width?: number // 列宽
  format?: 'date' | 'number' | 'currency' | 'percent' | 'text' // 格式化类型
}

/**
 * 按维度聚合数据
 */
export function groupByDimension(
  data: any[],
  dimension: string,
  timeField: string = 'createdAt'
): Record<string, any[]> {
  if (dimension === 'none') return { 全部: data }

  const groups: Record<string, any[]> = {}

  for (const item of data) {
    let key: string

    switch (dimension) {
      case 'day':
        key = new Date(item[timeField]).toLocaleDateString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        })
        break
      case 'month':
        key = new Date(item[timeField]).toLocaleDateString('zh-CN', {
          year: 'numeric',
          month: '2-digit'
        })
        break
      case 'year':
        key = new Date(item[timeField]).getFullYear().toString()
        break
      case 'parity':
        key = item.parity !== undefined ? `第${item.parity}胎` : '未知胎次'
        break
      case 'pen':
        key = item.currentPen || item.pen || '未分配'
        break
      case 'breed':
        key = item.breed || '未知品种'
        break
      default:
        key = '全部'
    }

    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  }

  return groups
}

/**
 * 执行聚合计算
 */
export function aggregateValues(values: any[], functions: string[]): Record<string, number> {
  const nums = values.filter((v) => typeof v === 'number' || !isNaN(Number(v))).map(Number)

  if (nums.length === 0) {
    return {
      count: values.length,
      sum: 0,
      avg: 0,
      min: 0,
      max: 0,
      median: 0
    }
  }

  const result: Record<string, number> = {
    count: values.length,
    sum: nums.reduce((a, b) => a + b, 0),
    avg: nums.reduce((a, b) => a + b, 0) / nums.length,
    min: Math.min(...nums),
    max: Math.max(...nums)
  }

  // 中位数
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  result.median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2

  // 只返回请求的函数
  const filtered: Record<string, number> = {}
  for (const fn of functions) {
    if (result[fn] !== undefined) filtered[fn] = result[fn]
  }

  return filtered
}

/**
 * 获取字段值（支持点号嵌套）
 */
export function getFieldValue(obj: any, field: string): any {
  if (!field.includes('.')) return obj?.[field]
  return field.split('.').reduce((acc, key) => acc?.[key], obj)
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

function stableHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function asciiToken(value: string, fallback: string) {
  return (
    String(value || '')
      .trim()
      .replace(/[^\w-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || fallback
  )
}

function scopeCodeOf(config: Pick<ExportConfig, 'scope' | 'name'>) {
  const raw = `flex_${config.scope}_${config.name}`
  const suffix = `h${stableHash(raw)}`
  const prefix = asciiToken(`flex_${config.scope}_${config.name}`, `flex_${config.scope}`)
  return `${prefix.slice(0, Math.max(1, 63 - suffix.length))}_${suffix}`.slice(0, 64)
}

function sourceTableOfScope(scope: string) {
  return getTableNameByScope(scope).replace(/-/g, '_')
}

async function syncV2ExportScope(config: ExportConfig) {
  const now = new Date().toISOString()
  await upsertExportScopeDefinition(
    {
      scopeCode: scopeCodeOf(config),
      scopeName: config.name,
      scopeDomain: config.scope,
      selectableFilters: {
        targetType: config.targetType,
        dateRange: config.dateRange || null,
        filters: config.filters || {}
      },
      selectableVariables: config.columns || [],
      defaultPeriods: config.dateRange
        ? [
            {
              periodType: 'date_range',
              startAt: config.dateRange.start,
              endAt: config.dateRange.end
            }
          ]
        : [{ periodType: config.groupBy || 'all' }],
      parameters: {
        id: config.id,
        scope: config.scope,
        targetType: config.targetType,
        dateRange: config.dateRange || null,
        groupBy: config.groupBy,
        aggregations: config.aggregations,
        columns: config.columns,
        filters: config.filters || {}
      }
    },
    now
  )
}

/**
 * 执行完整导出
 */
export async function executeExport(config: ExportConfig): Promise<void> {
  try {
    const startedAt = new Date().toISOString()
    // 1. 获取数据源
    const tableName = getTableNameByScope(config.scope)
    const rawData = await databaseService.getTableDataAsync(tableName, { silent: true })
    if (!rawData || rawData.length === 0) {
      ElMessage.warning('没有可导出的数据')
      return
    }

    // 2. 按 targetType 过滤
    let data = filterByTargetType(rawData, config.targetType)

    // 3. 按日期范围过滤
    if (config.dateRange) {
      data = data.filter((item) => {
        const date = new Date(item.createdAt || item.eventTime || item.milkingTime || item.feedTime)
        return date >= new Date(config.dateRange!.start) && date <= new Date(config.dateRange!.end)
      })
    }

    // 4. 应用自定义过滤器
    if (config.filters) {
      for (const [key, value] of Object.entries(config.filters)) {
        data = data.filter((item) => item[key] === value)
      }
    }

    if (!data.length) {
      ElMessage.warning('当前筛选条件下没有可导出的数据')
      return
    }

    // 5. 分组聚合
    const groups = groupByDimension(data, config.groupBy, getTimeField(config.scope))

    // 6. 构建导出行
    const exportRows: Record<string, any>[] = []

    for (const [groupName, groupData] of Object.entries(groups)) {
      const row: Record<string, any> = {}

      // 分组维度列
      if (config.groupBy !== 'none') {
        row['分组维度'] = groupName
      }

      // 记录数
      row['记录数'] = groupData.length

      // 基础字段
      for (const col of config.columns.filter((c) => c.visible)) {
        const values = groupData.map((item) => getFieldValue(item, col.field))
        if (col.field === 'cowNumber') {
          row[col.label || col.field] = Array.from(new Set(values)).join(', ')
        } else {
          const nonEmpty = values.filter((v) => v !== undefined && v !== null && v !== '')
          row[col.label || col.field] = nonEmpty.length > 0 ? nonEmpty[0] : ''
        }
      }

      // 聚合字段
      for (const agg of config.aggregations) {
        const values = groupData.map((item) => getFieldValue(item, agg.field))
        const results = aggregateValues(values, agg.functions)

        for (const [fn, value] of Object.entries(results)) {
          const fnLabel = getAggregationLabel(fn)
          const colLabel = agg.label || agg.field
          row[`${colLabel}(${fnLabel})`] = fn === 'count' ? value : parseFloat(value.toFixed(2))
        }
      }

      exportRows.push(row)
    }

    // 7. 导出文件
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const fileName = `${config.name}_${timestamp}.${config.format}`
    const fileHash = await hashText(JSON.stringify({ config, exportRows }))

    if (config.format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(exportRows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, config.name)
      XLSX.writeFile(wb, fileName)
    } else {
      const bom = '﻿'
      const headers = Object.keys(exportRows[0] || {})
      const csvContent = [
        headers.join(','),
        ...exportRows.map((row) =>
          headers
            .map((h) => {
              const val = String(row[h] ?? '')
              if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                return `"${val.replace(/"/g, '""')}"`
              }
              return val
            })
            .join(',')
        )
      ].join('\r\n')

      const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = fileName
      link.click()
    }

    await syncV2ExportScope(config)
    await recordV2ExportRun({
      scopeCode: scopeCodeOf(config),
      scopeName: config.name,
      scopeDomain: config.scope,
      sourceType: `flexible_${config.scope}`,
      fileName,
      fileFormat: config.format,
      rowCount: data.length,
      checksum: fileHash,
      fileSize: estimatePayloadSize(exportRows),
      operatorName: '导出配置管理',
      startedAt,
      finishedAt: new Date().toISOString(),
      parameters: {
        id: config.id,
        scope: config.scope,
        targetType: config.targetType,
        dateRange: config.dateRange || null,
        groupBy: config.groupBy,
        aggregations: config.aggregations,
        columns: config.columns,
        filters: config.filters || {}
      },
      resultSnapshot: {
        rowCount: data.length,
        groupCount: exportRows.length,
        fileName,
        fileHash,
        sourceTable: sourceTableOfScope(config.scope),
        previewRows: exportRows.slice(0, 5)
      },
      periods: config.dateRange
        ? [
            {
              periodType: 'date_range',
              startAt: config.dateRange.start,
              endAt: config.dateRange.end
            }
          ]
        : [{ periodType: config.groupBy || 'all' }],
      scopes: [
        { scopeType: 'source_table', scopeValue: sourceTableOfScope(config.scope) },
        { scopeType: 'scope', scopeValue: config.scope },
        { scopeType: 'target_type', scopeValue: config.targetType || 'all' },
        { scopeType: 'group_by', scopeValue: config.groupBy || 'none' },
        ...config.columns
          .filter((column) => column.visible)
          .map((column) => ({ scopeType: 'field', scopeValue: column.field })),
        ...config.aggregations.map((aggregation) => ({
          scopeType: 'aggregation',
          scopeValue: aggregation.field
        }))
      ],
      selectableFilters: {
        targetType: config.targetType,
        groupBy: config.groupBy,
        filters: config.filters || {}
      },
      selectableVariables: config.columns,
      defaultPeriods: config.dateRange
        ? [
            {
              periodType: 'date_range',
              startAt: config.dateRange.start,
              endAt: config.dateRange.end
            }
          ]
        : [{ periodType: config.groupBy || 'all' }]
    })

    ElMessage.success(`导出成功，共 ${data.length} 条记录`)
  } catch (error) {
    console.error('导出失败:', error)
    ElMessage.error('导出失败: ' + (error instanceof Error ? error.message : String(error)))
  }
}

// ====== 辅助函数 ======

function getTableNameByScope(scope: string): string {
  const map: Record<string, string> = {
    cow: 'cows',
    cows: 'cows',
    events: 'cow-events',
    milk: 'milk-records',
    feed: 'feed-records',
    reproduction: 'breeding-events',
    breeding: 'breeding-events',
    health: 'health-scores',
    sensor: 'sensor-readings',
    sensors: 'sensor-readings'
  }
  return map[scope] || 'cows'
}

function getTimeField(scope: string): string {
  const map: Record<string, string> = {
    cow: 'createdAt',
    events: 'eventTime',
    milk: 'milkingTime',
    feed: 'feedTime',
    reproduction: 'eventTime',
    breeding: 'eventTime',
    health: 'timestamp',
    sensor: 'timestamp'
  }
  return map[scope] || 'createdAt'
}

function filterByTargetType(data: any[], targetType: string): any[] {
  switch (targetType) {
    case 'lactating':
      return data.filter((c) => c.type === '成母牛' || c.type === '青年牛')
    case 'dry':
      return data.filter((c) => c.type === '干奶牛')
    case 'bulls':
      return data.filter((c) => c.type === '种公牛')
    case 'calves':
      return data.filter((c) => c.type === '犊牛')
    case 'heifers':
      return data.filter((c) => c.type === '小育成' || c.type === '大育成')
    case 'pregnant':
      return data.filter((c) => c.pregnancy === true || c.status === '预产')
    default:
      return data
  }
}

function getAggregationLabel(fn: string): string {
  const map: Record<string, string> = {
    count: '次数',
    sum: '合计',
    avg: '平均',
    min: '最小',
    max: '最大',
    median: '中位数'
  }
  return map[fn] || fn
}

// ====== 自定义字段系统 ======

/** 自定义字段定义 */
export interface CustomField {
  id: string
  fieldName: string // 字段名
  label: string // 显示名称
  scope: string // 适用范围：cow/events/milk/health
  type: 'text' | 'number' | 'date' | 'datetime' | 'select' | 'boolean' // 字段类型
  options?: string[] // select 类型的选项
  optionsText?: string // 编辑时用，逗号分隔
  optionSource?: string // 动态选项来源：cow/pen/medicine 等
  defaultValue?: any // 默认值
  min?: number // 数字最小值
  step?: number // 数字步长
  placeholder?: string // 输入提示
  allowCreate?: boolean // select 是否允许创建
  eventCode?: string // 信息录入事件编码
  eventGroup?: string // 信息录入事件分组
  traitCode?: string // 关联性状编码
  traitName?: string // 关联性状名称
  unit?: string // 计量单位
  required: boolean // 是否必填
  isActive: boolean // 是否启用
  sortOrder: number // 显示顺序
  description?: string // 字段描述
  createdAt: string
  updatedAt: string
}

/** 自定义字段值 */
export interface CustomFieldValue {
  cowId: string
  fieldName: string
  value: any
  updatedAt: string
}

const SYSTEM_CONTROLLED_CUSTOM_FIELDS = new Set(
  [
    ...PERIOD_EXPORT_FIELD_SCHEMA.flatMap((field) => [field.key, ...field.aliases]),
    'insemination_no',
    'inseminationno',
    'insemination_count',
    'inseminationcount',
    '本胎输精次数',
    '系统胎次',
    '泌乳天数',
    '本胎产犊时间',
    '周期字段来源',
    '当前圈舍',
    '胎次'
  ].map((value) => String(value).trim().replace(/\s+/g, '').toLowerCase())
)

export function isSystemControlledCustomField(value: unknown): boolean {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase()
  return SYSTEM_CONTROLLED_CUSTOM_FIELDS.has(normalized)
}

/** 保存自定义字段定义 */
export async function saveCustomField(field: CustomField): Promise<void> {
  if (
    isSystemControlledCustomField(field.fieldName) ||
    isSystemControlledCustomField(field.label)
  ) {
    throw new Error(
      '胎次、当前圈舍、DIM、本胎输精次数等字段由系统按事件和周期自动计算，不能作为自定义字段保存'
    )
  }
  const payload = {
    ...field,
    updatedAt: new Date().toISOString()
  }
  const rows = await databaseService
    .getTableDataAsync('custom-fields', { silent: true })
    .catch(() => [])
  if ((rows || []).some((row: any) => row.id === field.id)) {
    await databaseService.updateTableRecordAsync('custom-fields', field.id, payload)
    return
  }
  await databaseService.addTableDataAsync('custom-fields', payload)
}

/** 获取指定范围的所有自定义字段 */
export async function getCustomFields(scope: string): Promise<CustomField[]> {
  const all = await databaseService.getTableDataAsync('custom-fields', { silent: true })
  return (all || [])
    .filter((f: any) => f.scope === scope && f.isActive)
    .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0))
}

/** 删除自定义字段 */
export async function deleteCustomField(id: string): Promise<void> {
  await databaseService.deleteTableRecordAsync('custom-fields', id)
}

// ====== 可配置导入系统 ======

/** 导入配置 */
export interface ImportConfig {
  id: string
  name: string
  scope: string // 导入目标：cow/events/milk
  templateCode?: string // 绑定的导入模板
  fieldMapping: Record<string, string> // Excel列名 → 数据库字段名
  mappings?: Array<{ excelCol: string; dbField: string }> // 编辑用映射数组
  dateFormat?: string // 日期格式：YYYY-MM-DD / DD/MM/YYYY
  numberFormat?: string // 数字格式
  defaultValues?: Record<string, any> // 默认值
  skipDuplicates: boolean // 跳过重复记录
  duplicateKey: string // 重复判断字段（如 cowNumber）
  conflictStrategy?: 'skip' | 'update' | 'reject'
  createdAt: string
}

/** 保存导入配置 */
export async function saveImportConfig(config: ImportConfig): Promise<void> {
  const rows = await databaseService.getTableDataAsync('import-configs', { silent: true })
  const payload = {
    ...config,
    updatedAt: new Date().toISOString()
  }
  if (rows.some((row: any) => String(row.id) === String(config.id))) {
    await databaseService.updateTableRecordAsync('import-configs', config.id, payload)
    return
  }
  await databaseService.addTableDataAsync('import-configs', payload)
}

/** 获取导入配置列表 */
export async function getImportConfigs(scope: string): Promise<ImportConfig[]> {
  const all = await databaseService.getTableDataAsync('import-configs', { silent: true })
  return (all || []).filter((c: any) => c.scope === scope)
}

/** 删除导入配置 */
export async function deleteImportConfig(id: string): Promise<void> {
  await databaseService.deleteTableRecordAsync('import-configs', id)
}

/** 执行导入 */
export async function executeImport(
  file: File,
  config: ImportConfig
): Promise<{ success: number; skipped: number; errors: string[] }> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName])

        const result = { success: 0, skipped: 0, errors: [] as string[] }
        const tableName = getTableNameByScope(config.scope)
        const existingRecords = await databaseService.getTableDataAsync(tableName, { silent: true })

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i] as Record<string, any>
          const mappedRow: Record<string, any> = {}

          // 字段映射
          for (const [excelCol, dbField] of Object.entries(config.fieldMapping)) {
            let value = row[excelCol]

            // 日期转换
            if (config.dateFormat && value instanceof Date) {
              value = value.toISOString().split('T')[0]
            }

            mappedRow[dbField] = value
          }

          // 填充默认值
          if (config.defaultValues) {
            for (const [key, value] of Object.entries(config.defaultValues)) {
              if (!mappedRow[key]) mappedRow[key] = value
            }
          }

          // 检查重复
          if (config.skipDuplicates && config.duplicateKey) {
            const duplicateValue = mappedRow[config.duplicateKey]
            if (
              duplicateValue &&
              existingRecords.some((r: any) => r[config.duplicateKey] === duplicateValue)
            ) {
              result.skipped++
              continue
            }
          }

          // 写入数据库
          await databaseService.addTableDataAsync(tableName, {
            id: `${config.scope}-${Date.now()}-${i}`,
            ...mappedRow,
            createdAt: new Date().toISOString()
          })
          result.success++
        }

        resolve(result)
      } catch (error) {
        resolve({
          success: 0,
          skipped: 0,
          errors: ['导入失败: ' + (error instanceof Error ? error.message : String(error))]
        })
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

// ====== 预设导出模板 ======

export const PRESET_EXPORT_TEMPLATES: Partial<ExportConfig>[] = [
  {
    name: '按胎次配种统计',
    scope: 'breeding',
    targetType: 'all',
    groupBy: 'parity',
    aggregations: [{ field: 'id', functions: ['count'], label: '配种' }],
    columns: [
      { field: 'cowNumber', label: '牛号', visible: true },
      { field: 'breed', label: '品种', visible: true }
    ],
    format: 'xlsx'
  },
  // 按月份产奶量统计
  {
    name: '按月产奶量统计',
    scope: 'milk',
    targetType: 'all',
    groupBy: 'month',
    aggregations: [{ field: 'volume', functions: ['sum', 'avg', 'min', 'max'], label: '产奶量' }],
    columns: [],
    format: 'xlsx'
  },
  // 按年份繁殖效率
  {
    name: '按年繁殖效率',
    scope: 'breeding',
    targetType: 'all',
    groupBy: 'year',
    aggregations: [
      { field: 'id', functions: ['count'], label: '配种次数' },
      { field: 'pregnancyResult', functions: ['count'], label: '妊检次数' }
    ],
    columns: [],
    format: 'xlsx'
  },
  // 牛群状态统计
  {
    name: '牛群状态统计',
    scope: 'cow',
    targetType: 'all',
    groupBy: 'none',
    aggregations: [],
    columns: [
      { field: 'status', label: '状态', visible: true },
      { field: 'parity', label: '胎次', visible: true },
      { field: 'currentPen', label: '圈舍', visible: true }
    ],
    format: 'xlsx'
  }
]

/** 保存导出配置 */
export async function saveExportConfig(config: ExportConfig): Promise<void> {
  await databaseService.addTableDataAsync('export-configs', {
    ...config,
    updatedAt: new Date().toISOString()
  })
  await syncV2ExportScope(config)
}

/** 获取导出配置列表 */
export async function getExportConfigs(scope?: string): Promise<ExportConfig[]> {
  let all = await databaseService.getTableDataAsync('export-configs', { silent: true })
  if (scope) {
    all = (all || []).filter((c: any) => c.scope === scope)
  }
  return all || []
}

/** 删除导出配置 */
export async function deleteExportConfig(id: string): Promise<void> {
  await databaseService.deleteTableRecordAsync('export-configs', id)
}
