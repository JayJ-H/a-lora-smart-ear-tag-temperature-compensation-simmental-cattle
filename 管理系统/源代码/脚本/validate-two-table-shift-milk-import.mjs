import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import { webcrypto } from 'node:crypto'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const packageDir =
  process.env.TWO_TABLE_SHIFT_MILK_IMPORT_PACKAGE_DIR ||
  path.resolve('test-fixtures/shift-milk/two-table-template-package')
const files = [
  {
    id: 'animal-profile',
    templateCode: 'animal-profile',
    path: path.join(packageDir, '01_个体档案_animal-profile_系统模板.xlsx')
  },
  {
    id: 'milk-measurement',
    templateCode: 'milk-measurement',
    path: path.join(packageDir, '02_泌乳奶厅测量_milk-measurement_系统模板.xlsx')
  }
]
const OPERATOR = 'two-table-dry-run'

function readRows(file) {
  const wb = XLSX.readFile(file, { cellDates: true })
  const sheetName = wb.SheetNames.includes('数据填写') ? '数据填写' : wb.SheetNames[0]
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function setupBrowserMocks(memoryDb) {
  const storage = makeStorage()
  const location = {
    href: 'http://127.0.0.1:9191/#/',
    origin: 'http://127.0.0.1:9191',
    pathname: '/',
    search: '',
    hash: '#/'
  }
  globalThis.__TWO_TABLE_IMPORT_MEMORY_DB__ = memoryDb
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
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
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

function text(value) {
  return String(value ?? '').trim()
}

function sourcePeople(rows) {
  const names = new Set(['two-table-dry-run', '水研所'])
  for (const row of rows || []) {
    const operatorName = text(row['记录人'] || row.operator_name)
    const workOperatorName = text(row['操作人'] || row.work_operator_name)
    if (operatorName) names.add(operatorName)
    if (workOperatorName) names.add(workOperatorName)
  }
  return [...names].map((name, index) => ({
    id: `two-table-person-${index + 1}`,
    name,
    status: '启用'
  }))
}

function sourceMilkShiftRows(rows) {
  const values = new Set(['早班', '晚班'])
  for (const row of rows || []) {
    const value = text(row['班次名称'] || row.shift_name)
    if (value) values.add(value)
  }
  return [...values].map((value, index) => ({
    id: `two-table-milk-shift-${index + 1}`,
    scope: 'milk:shifts',
    code: value,
    value,
    name: value,
    label: value,
    status: '启用',
    sortOrder: index + 1
  }))
}

function sourceQualityRows(rows) {
  const values = new Set(['正常'])
  for (const row of rows || []) {
    const value = text(row['质量标记'] || row.quality_flag)
    if (!value) continue
    if (value === '1') values.add('正常')
    else values.add(value)
  }
  return [...values].map((value, index) => ({
    id: `two-table-quality-${index + 1}`,
    scope: 'milk:quality-flags',
    code: value,
    value,
    name: value,
    label: value,
    status: '启用',
    sortOrder: index + 1
  }))
}

function sourceAnimalDictionaryRows(profileRows) {
  const stages = new Set(['泌乳', '干奶', '犊牛', '育成', '公牛'])
  const statuses = new Set(['在群'])
  for (const row of profileRows || []) {
    const stage = text(row['生产阶段'])
    const status = text(row['状态'])
    if (stage) stages.add(stage)
    if (status) statuses.add(status)
  }
  return [
    ...[...stages].map((value, index) => ({
      id: `two-table-stage-${index + 1}`,
      scope: 'animal:stage',
      code: value,
      value,
      name: value,
      label: value,
      status: '启用',
      sortOrder: index + 1
    })),
    ...[...statuses].map((value, index) => ({
      id: `two-table-status-${index + 1}`,
      scope: 'animal:status',
      code: value,
      value,
      name: value,
      label: value,
      status: '启用',
      sortOrder: index + 1
    }))
  ]
}

function sourceFarmUnits(milkRows) {
  const values = new Set()
  for (const row of milkRows || []) {
    const value = text(row['当前圈舍单元'] || row.unit_id)
    if (value) values.add(value)
  }
  return [...values].map((value, index) => ({
    id: value,
    unitId: value,
    unit_id: value,
    unitName: value,
    unit_name: value,
    name: value,
    status: '启用',
    sortOrder: index + 1
  }))
}

function createMemoryDatabase(profileRows, milkRows) {
  const farmUnits = sourceFarmUnits(milkRows)
  return {
    tables: {
      animal: [],
      cows: [],
      animal_identifier: [],
      persons: sourcePeople(milkRows),
      farm_unit: farmUnits,
      pens: farmUnits.map((unit) => ({ ...unit, penName: unit.name, pen_name: unit.name })),
      'base-info-categories': [
        ...sourceMilkShiftRows(milkRows),
        ...sourceQualityRows(milkRows),
        ...sourceAnimalDictionaryRows(profileRows)
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
      'milk-records': [],
      animal_parentage: []
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
        name: 'two-table-import-validation-mocks',
        enforce: 'pre',
        resolveId(id) {
          const normalized = String(id).replace(/\\/g, '/')
          if (
            id === '@/services/数据库' ||
            normalized.endsWith('/src/services/database.ts') ||
            normalized.endsWith('/src/services/数据库')
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
                const db = globalThis.__TWO_TABLE_IMPORT_MEMORY_DB__
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
                globalThis.__TWO_TABLE_IMPORT_MEMORY_DB__.tables[tableName] = merge(rowsOf(tableName), rows)
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
              export async function updateTableDataAsync(tableName, data) { globalThis.__TWO_TABLE_IMPORT_MEMORY_DB__.tables[tableName] = clone(data || []) }
              export async function deleteTableRecordAsync(tableName, id) {
                globalThis.__TWO_TABLE_IMPORT_MEMORY_DB__.tables[tableName] = rowsOf(tableName).filter((row) => String(row?.id || '') !== String(id))
              }
              export async function runBackendRpcAsync(method) { throw new Error('dry-run blocks backend RPC: ' + method) }
              export async function addCowEvent(eventData) { await addTableDataAsync('animal_event', eventData); return eventData }
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
    previewRows: result.previewRows.slice(0, 3)
  }
}

function assertPackageFiles() {
  const missing = files.map((item) => item.path).filter((file) => !fs.existsSync(file))
  if (missing.length) throw new Error(`两表导入包文件缺失：${missing.join(', ')}`)
}

async function main() {
  assertPackageFiles()
  const profileRows = readRows(files[0].path)
  const milkRows = readRows(files[1].path)
  const memoryDb = createMemoryDatabase(profileRows, milkRows)
  setupBrowserMocks(memoryDb)
  const server = await createValidationServer()
  const results = []
  try {
    const adapter = await server.ssrLoadModule('/src/services/import-adapter.ts')
    const profileDryRun = await adapter.dryRunImportRows({
      mode: 'batch',
      templateCode: 'animal-profile',
      rows: profileRows,
      operatorName: OPERATOR
    })
    results.push({ id: 'animal-profile:dry-run', file: files[0].path, ...pick(profileDryRun) })
    if (profileDryRun.errorRows === 0) {
      const profileCommit = await adapter.commitImportRows({
        mode: 'batch',
        templateCode: 'animal-profile',
        rows: profileRows,
        operatorName: OPERATOR
      })
      results.push({ id: 'animal-profile:memory-commit', file: files[0].path, ...pick(profileCommit) })
    }

    const milkDryRun = await adapter.dryRunImportRows({
      mode: 'batch',
      templateCode: 'milk-measurement',
      rows: milkRows,
      operatorName: OPERATOR
    })
    results.push({ id: 'milk-measurement:dry-run-after-profile', file: files[1].path, ...pick(milkDryRun) })
    if (milkDryRun.errorRows === 0) {
      const milkCommit = await adapter.commitImportRows({
        mode: 'batch',
        templateCode: 'milk-measurement',
        rows: milkRows,
        operatorName: OPERATOR
      })
      results.push({ id: 'milk-measurement:memory-commit', file: files[1].path, ...pick(milkCommit) })
    }
  } finally {
    await server.close()
  }

  const summary = {
    ok: results.every((item) => item.errorRows === 0),
    packageDir,
    counts: {
      memoryAnimalRows: memoryDb.tables.animal.length,
      memoryCowRows: memoryDb.tables.cows.length,
      memoryMilkRows: memoryDb.tables.milk_measurement.length
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

