import * as XLSX from 'xlsx'
import * as databaseService from '@/services/database'
import type { ImportAction, ImportMode, ImportTarget } from './import-templates'

export interface ImportRowError {
  rowIndex: number
  column: string
  targetField?: string
  level: 'error' | 'warning'
  code: string
  message: string
  suggestion?: string
  rawRow?: Record<string, any>
}

export interface ImportAuditPayload {
  jobId: string
  mode: ImportMode
  action: ImportAction
  templateCode: string
  templateVersion?: string
  target: ImportTarget
  fileName?: string
  fileHash?: string
  operatorId?: string
  operatorName?: string
  startedAt: string
  finishedAt: string
  totalRows: number
  validRows: number
  committedRows: number
  skippedRows: number
  errorRows: number
  duplicateRows: number
  status?: 'completed' | 'completed_with_errors' | 'failed' | 'partial_failed'
  errorMessage?: string
  configSnapshot?: Record<string, any>
  targetTables: string[]
  targetRecordIds: string[]
  sourceRecordIds: string[]
  cowIds: string[]
  cowNumbers: string[]
  errors: ImportRowError[]
  previewRows: Record<string, any>[]
}

export function createImportJobId() {
  return `import-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

export async function hashFile(file: File | null | undefined) {
  if (!file) return ''
  const buffer = await file.arrayBuffer()
  if (window.crypto?.subtle) {
    const digest = await window.crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest))
      .map((item) => item.toString(16).padStart(2, '0'))
      .join('')
  }
  let hash = 0
  new Uint8Array(buffer).forEach((byte) => {
    hash = (Math.imul(31, hash) + byte) | 0
  })
  return `fallback-${Math.abs(hash).toString(16)}`
}

export async function recordImportAudit(payload: ImportAuditPayload) {
  const now = new Date().toISOString()
  const operatorName = payload.operatorName || '当前用户'
  const previewRows = slimPreviewRows(payload.previewRows)
  const errors = slimImportErrors(payload.errors)
  try {
    await databaseService.addTableDataFastAsync('operation-audit-logs', {
      id: payload.jobId,
      action_type: `import_${payload.action}`,
      actionType: `import_${payload.action}`,
      target_type: payload.target,
      targetType: payload.target,
      target_id: payload.templateCode,
      targetId: payload.templateCode,
      operator: operatorName,
      operator_id: payload.operatorId || '',
      operatorId: payload.operatorId || '',
      operator_name: operatorName,
      operatorName,
      status: payload.status || (payload.errorRows ? 'completed_with_errors' : 'completed'),
      request_payload: {
        mode: payload.mode,
        action: payload.action,
        templateCode: payload.templateCode,
        templateVersion: payload.templateVersion || 'builtin-v1',
        fileName: payload.fileName || '',
        fileHash: payload.fileHash || '',
        targetTables: payload.targetTables,
        configSnapshot: payload.configSnapshot || {},
        errorMessage: payload.errorMessage || ''
      },
      requestPayload: {
        mode: payload.mode,
        action: payload.action,
        templateCode: payload.templateCode,
        templateVersion: payload.templateVersion || 'builtin-v1',
        fileName: payload.fileName || '',
        fileHash: payload.fileHash || '',
        targetTables: payload.targetTables,
        configSnapshot: payload.configSnapshot || {}
      },
      result_payload: {
        totalRows: payload.totalRows,
        validRows: payload.validRows,
        committedRows: payload.committedRows,
        skippedRows: payload.skippedRows,
        errorRows: payload.errorRows,
        duplicateRows: payload.duplicateRows,
        status: payload.status || (payload.errorRows ? 'completed_with_errors' : 'completed'),
        errorMessage: payload.errorMessage || '',
        targetRecordIds: payload.targetRecordIds,
        errors,
        previewRows
      },
      resultPayload: {
        totalRows: payload.totalRows,
        validRows: payload.validRows,
        committedRows: payload.committedRows,
        skippedRows: payload.skippedRows,
        errorRows: payload.errorRows,
        duplicateRows: payload.duplicateRows,
        status: payload.status || (payload.errorRows ? 'completed_with_errors' : 'completed'),
        errorMessage: payload.errorMessage || '',
        targetRecordIds: payload.targetRecordIds,
        errors,
        previewRows
      },
      cow_ids: payload.cowIds,
      cowIds: payload.cowIds,
      cow_numbers: payload.cowNumbers,
      cowNumbers: payload.cowNumbers,
      relation_scope: {
        cowIds: payload.cowIds,
        cowNumbers: payload.cowNumbers,
        templateCode: payload.templateCode,
        target: payload.target
      },
      relationScope: {
        cowIds: payload.cowIds,
        cowNumbers: payload.cowNumbers,
        templateCode: payload.templateCode,
        target: payload.target
      },
      source_record_ids: payload.sourceRecordIds,
      sourceRecordIds: payload.sourceRecordIds,
      created_at: payload.startedAt,
      createdAt: payload.startedAt,
      updated_at: payload.finishedAt || now,
      updatedAt: payload.finishedAt || now
    })
  } catch (error) {
    console.warn('导入审计写入失败，已保留导入主流程结果:', error)
  }
}

function slimPreviewRows(rows: Record<string, any>[] = []) {
  return rows.slice(0, 20).map((row) => sanitizeAuditObject(row, 2))
}

function slimImportErrors(errors: ImportRowError[] = []) {
  return errors.slice(0, 100).map((error) => ({
    rowIndex: error.rowIndex,
    column: error.column,
    targetField: error.targetField || '',
    level: error.level,
    code: error.code,
    message: error.message,
    suggestion: error.suggestion || ''
  }))
}

function sanitizeAuditObject(value: any, depth = 2): any {
  if (value === null || value === undefined) return value
  if (['string', 'number', 'boolean'].includes(typeof value)) return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeAuditObject(item, depth - 1))
  if (typeof value !== 'object') return String(value)
  if (depth <= 0) return '[object]'
  const result: Record<string, any> = {}
  Object.entries(value)
    .slice(0, 80)
    .forEach(([key, item]) => {
      if (/cowContext|context|rawRow|parsedRows|row\.cow|resolvedCow\.cow/i.test(key)) return
      result[key] = sanitizeAuditObject(item, depth - 1)
    })
  return result
}

export async function getImportAudits() {
  const rows = await databaseService.getTableDataAsync('operation-audit-logs', {
    silent: true,
    page: 1,
    pageSize: 100,
    limit: 100,
    orderBy: 'id',
    orderDir: 'desc'
  })
  return rows
    .filter((row: any) => String(row.action_type || row.actionType || '').startsWith('import_'))
    .sort(
      (left: any, right: any) =>
        new Date(right.created_at || right.createdAt || 0).getTime() -
        new Date(left.created_at || left.createdAt || 0).getTime()
    )
}

export function downloadImportErrorReport(
  errors: ImportRowError[],
  fileName = '导入错误报告.xlsx'
) {
  const rows = errors.map((error) => ({
    原始行号: error.rowIndex,
    模板列: error.column,
    目标字段: error.targetField || '',
    错误级别: error.level,
    错误码: error.code,
    错误说明: error.message,
    建议修正值: error.suggestion || '',
    原始行快照: JSON.stringify(error.rawRow || {})
  }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '错误明细')
  XLSX.writeFile(workbook, fileName)
}
