import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import { webcrypto } from 'node:crypto'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const fixtureRoot = path.resolve(process.env.SHIFT_MILK_FIXTURE_DIR || 'test-fixtures/shift-milk')
const files = [
  {
    id: 'animal-profile',
    templateCode: 'animal-profile',
    path: path.join(fixtureRoot, '测试数据_个体档案_极简导入版.xlsx')
  },
  {
    id: 'pedigree',
    templateCode: 'pedigree',
    path: path.join(fixtureRoot, '测试数据_系谱关系_极简导入版.xlsx')
  },
  {
    id: 'milk-measurement',
    templateCode: 'milk-measurement',
    path: path.join(fixtureRoot, '测试数据_奶厅测量_极简导入版.xlsx')
  }
]

function readRows(file) {
  const wb = XLSX.readFile(file, { cellDates: true })
  const sheetName = wb.SheetNames.includes('数据填写') ? '数据填写' : wb.SheetNames[0]
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
}

function text(value) {
  return String(value ?? '').trim()
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function setupBrowserMocks(memoryDb) {
  const location = {
    href: 'http://127.0.0.1:9191/#/',
    origin: 'http://127.0.0.1:9191',
    pathname: '/',
    search: '',
    hash: '#/'
  }
  globalThis.__MINIMAL_IMPORT_MEMORY_DB__ = memoryDb
  Object.defineProperty(globalThis, 'location', { value: location, configurable: true })
  Object.defineProperty(globalThis, 'history', {
    value: { state: null, pushState() {}, replaceState() {} },
    configurable: true
  })
  Object.defineProperty(globalThis, 'window', {
    value: {
      crypto: webcrypto,
      location,
      history: globalThis.history,
      addEventListener() {},
      removeEventListener() {},
      navigator: { userAgent: 'node' }
    },
    configurable: true
  })
  Object.defineProperty(globalThis, 'document', {
    value: {
      documentElement: {
        style: { setProperty() {} },
        classList: { contains() { return false }, add() {}, remove() {} }
      },
      body: {},
      title: '',
      addEventListener() {},
      removeEventListener() {},
      createElement() {
        return { style: {}, click() {}, setAttribute() {}, appendChild() {}, remove() {} }
      }
    },
    configurable: true
  })
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), configurable: true })
  Object.defineProperty(globalThis, 'sessionStorage', { value: makeStorage(), configurable: true })
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

function makeStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
    clear() { values.clear() },
    key(index) { return Array.from(values.keys())[index] || null },
    get length() { return values.size }
  }
}

function collectRows() {
  const byId = new Map(files.map((item) => [item.id, readRows(item.path)]))
  return byId
}

function createMemoryDatabase(rowsById) {
  const profileRows = rowsById.get('animal-profile') || []
  const milkRows = rowsById.get('milk-measurement') || []
  const people = new Set(['minimal-import-user'])
  const units = new Set()
  const shifts = new Set(['早班', '晚班'])
  const stages = new Set(['泌乳', '干奶', '犊牛', '育成', '公牛'])
  const statuses = new Set(['在群'])
  const quality = new Set(['正常', '复核', '异常', '剔除'])
  for (const row of milkRows) {
    const unit = text(row['当前圈舍单元'])
    if (unit) units.add(unit)
  }
  for (const row of profileRows) {
    const stage = text(row['生产阶段'])
    const status = text(row['状态'])
    if (stage) stages.add(stage)
    if (status) statuses.add(status)
  }
  for (const row of milkRows) {
    const operatorName = text(row['操作人'])
    const shift = text(row['班次名称'])
    const q = text(row['质量标记'])
    if (operatorName) people.add(operatorName)
    if (shift) shifts.add(shift)
    if (q) quality.add(q)
  }
  return {
    tables: {
      animal: [],
      cows: [],
      animal_identifier: [],
      animal_parentage: [],
      persons: [...people].map((name, index) => ({ id: `person-${index + 1}`, name, status: '启用' })),
      farm_unit: [...units].map((name, index) => ({
        id: name,
        unitId: name,
        unit_id: name,
        unitName: name,
        unit_name: name,
        status: '启用',
        sortOrder: index + 1
      })),
      pens: [...units].map((name, index) => ({
        id: name,
        name,
        penName: name,
        pen_name: name,
        status: '启用',
        sortOrder: index + 1
      })),
      'base-info-categories': [
        ...[...shifts].map((name, index) => ({
          id: `shift-${index + 1}`,
          scope: 'milk:shifts',
          code: name,
          value: name,
          name,
          label: name,
          status: '启用',
          sortOrder: index + 1
        })),
        ...[...quality].map((name, index) => ({
          id: `quality-${index + 1}`,
          scope: 'milk:quality-flags',
          code: name,
          value: name,
          name,
          label: name,
          status: '启用',
          sortOrder: index + 1
        })),
        ...[...stages].map((name, index) => ({
          id: `stage-${index + 1}`,
          scope: 'animal:stage',
          code: name,
          value: name,
          name,
          label: name,
          status: '启用',
          sortOrder: index + 1
        })),
        ...[...statuses].map((name, index) => ({
          id: `status-${index + 1}`,
          scope: 'animal:status',
          code: name,
          value: name,
          name,
          label: name,
          status: '启用',
          sortOrder: index + 1
        }))
      ],
      'breed-types': [],
      'custom-fields': [],
      import_configs: [],
      'import-configs': [],
      'operation-audit-logs': [],
      operation_audit_log: [],
      parity_episode: [],
      lactation_episode: [],
      fact_lactation_305: [],
      milking_session: [],
      milking_visit: [],
      milk_measurement: [],
      'milk-records': []
    }
  }
}

async function createValidationServer() {
  return createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true, entries: [] },
    plugins: [
      {
        name: 'minimal-current-import-validation-mocks',
        enforce: 'pre',
        resolveId(id) {
          const normalized = String(id).replace(/\\/g, '/')
          if (
            id === '@/services/database' ||
            normalized.endsWith('/src/services/database.ts') ||
            normalized.endsWith('/src/services/database')
          ) {
            return '\0mock-database'
          }
          if (id === '@/utils/http' || normalized.endsWith('/src/utils/http/index.ts') || normalized.endsWith('/src/utils/http')) {
            return '\0mock-http'
          }
          if (/\.(css|scss|sass|less|png|jpg|jpeg|gif|svg|webp)$/.test(id) || id.startsWith('@imgs') || id.startsWith('@styles') || id.startsWith('@icons')) {
            return '\0mock-asset'
          }
          return null
        },
        load(id) {
          if (id === '\0mock-asset') return 'export default ""'
          if (id === '\0mock-http') return 'export default { get: async () => ({ data: null }), post: async () => ({ data: null }) }'
          if (id === '\0mock-database') {
            return `
              const clone = (value) => JSON.parse(JSON.stringify(value ?? null))
              function rowsOf(tableName) {
                const db = globalThis.__MINIMAL_IMPORT_MEMORY_DB__
                if (!db.tables[tableName]) db.tables[tableName] = []
                return db.tables[tableName]
              }
              function merge(existing, rows) {
                const next = [...existing]
                for (const row of rows) {
                  const id = String(row?.id || '')
                  const idx = id ? next.findIndex((item) => String(item?.id || '') === id) : -1
                  if (idx >= 0) next[idx] = { ...next[idx], ...clone(row) }
                  else next.push(clone(row))
                }
                return next
              }
              export async function getTableDataAsync(tableName) { return clone(rowsOf(tableName)) }
              export function getTableData(tableName) { return clone(rowsOf(tableName)) }
              export async function addTableDataAsync(tableName, data) {
                const rows = Array.isArray(data) ? data : [data]
                globalThis.__MINIMAL_IMPORT_MEMORY_DB__.tables[tableName] = merge(rowsOf(tableName), rows)
              }
              export async function addTableDataFastAsync(tableName, data) { await addTableDataAsync(tableName, data) }
              export async function upsertTableDataAsync(tableName, record) { await addTableDataAsync(tableName, record) }
              export function beginTableDataBulkWrite() { return { active: true } }
              export async function flushTableDataBulkWrite(context, onProgress) {
                onProgress?.({ currentTable: 0, totalTables: 0, currentRows: 0, totalRows: 0, tableName: '' })
              }
              export function endTableDataBulkWrite() {}
              export async function updateTableRecordAsync(tableName, id, patch) {
                const rows = rowsOf(tableName)
                const idx = rows.findIndex((row) => String(row?.id || '') === String(id))
                if (idx >= 0) rows[idx] = { ...rows[idx], ...clone(patch), id: rows[idx].id }
              }
              export async function updateTableDataAsync(tableName, data) { globalThis.__MINIMAL_IMPORT_MEMORY_DB__.tables[tableName] = clone(data || []) }
              export async function deleteTableRecordAsync(tableName, id) {
                globalThis.__MINIMAL_IMPORT_MEMORY_DB__.tables[tableName] = rowsOf(tableName).filter((row) => String(row?.id || '') !== String(id))
              }
              export async function runBackendRpcAsync(method) { throw new Error('dry-run blocks backend RPC: ' + method) }
              export async function addCowEvent(eventData) {
                await addTableDataAsync('animal_event', eventData)
                if (['entry', 'transfer'].includes(String(eventData.eventCode || eventData.eventType || ''))) {
                  const target = eventData.details?.to_unit_id || eventData.details?.toUnitId || eventData.details?.unit_id || ''
                  const rows = rowsOf('animal')
                  for (const row of rows) {
                    if (String(row.id || row.cowId || row.animalId || '') === String(eventData.cowId || '') || String(row.cowNumber || row.animalNumber || '') === String(eventData.cowNumber || '')) {
                      row.currentUnitId = target
                      row.current_unit_id = target
                      row.currentPenId = target
                      row.current_pen_id = target
                    }
                  }
                }
                return { animalEvent: eventData, event: eventData }
              }
            `
          }
          return null
        }
      }
    ]
  })
}

function pick(result) {
  return {
    templateCode: result.templateCode,
    totalRows: result.totalRows,
    validRows: result.validRows,
    errorRows: result.errorRows,
    duplicateRows: result.duplicateRows,
    committedRows: result.committedRows,
    skippedRows: result.skippedRows,
    errors: result.errors.slice(0, 10).map((error) => ({
      rowIndex: error.rowIndex,
      column: error.column,
      code: error.code,
      level: error.level,
      message: error.message,
      suggestion: error.suggestion
    })),
    previewRows: result.previewRows.slice(0, 2)
  }
}

function assertNoForbiddenHeaders(rowsById) {
  const forbidden = new Set(['备注', '记录人', '数据来源', '汇总来源', '挤奶批次编号', '产奶天数', '泌乳月', '305天产奶量', '平均日产奶', '胎次产量', '月龄', '牛只ID', '耳号', '胎次', '本胎产犊时间'])
  const issues = []
  for (const [id, rows] of rowsById) {
    const headers = Object.keys(rows[0] || {})
    for (const header of headers) {
      if (forbidden.has(header)) issues.push(`${id}:${header}`)
    }
    if (id === 'animal-profile' && headers.includes('当前圈舍单元')) {
      issues.push(`${id}:当前圈舍单元`)
    }
  }
  if (issues.length) throw new Error(`导入表仍包含不应手填字段：${issues.join(', ')}`)
}

async function main() {
  const missing = files.map((item) => item.path).filter((file) => !fs.existsSync(file))
  if (missing.length) throw new Error(`文件缺失：${missing.join(', ')}`)
  const rowsById = collectRows()
  assertNoForbiddenHeaders(rowsById)
  const memoryDb = createMemoryDatabase(rowsById)
  setupBrowserMocks(memoryDb)
  const server = await createValidationServer()
  const results = []
  try {
    const adapter = await server.ssrLoadModule('/src/services/import-adapter.ts')
    for (const file of files) {
      const rows = rowsById.get(file.id)
      const dryRun = await adapter.dryRunImportRows({
        mode: 'batch',
        templateCode: file.templateCode,
        rows,
        operatorName: 'minimal-import-user'
      })
      results.push({ id: `${file.id}:dry-run`, file: file.path, ...pick(dryRun) })
      if (dryRun.errorRows === 0) {
        const commit = await adapter.commitImportRows({
          mode: 'batch',
          templateCode: file.templateCode,
          rows,
          operatorName: 'minimal-import-user'
        })
        results.push({ id: `${file.id}:memory-commit`, file: file.path, ...pick(commit) })
      }
    }
  } finally {
    await server.close()
  }
  const summary = {
    ok: results.every((item) => item.errorRows === 0),
    files: Object.fromEntries(files.map((item) => [item.id, item.path])),
    counts: {
      animal: memoryDb.tables.animal.length,
      cows: memoryDb.tables.cows.length,
      pedigree: memoryDb.tables.animal_parentage.length,
      movementEvents: memoryDb.tables.animal_event.filter((row) => ['entry', 'transfer'].includes(String(row.eventCode || row.eventType || ''))).length,
      milkMeasurement: memoryDb.tables.milk_measurement.length,
      milkRecords: memoryDb.tables['milk-records'].length
    },
    results,
    generatedAt: new Date().toISOString()
  }
  console.log(JSON.stringify(summary, null, 2))
  if (!summary.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

