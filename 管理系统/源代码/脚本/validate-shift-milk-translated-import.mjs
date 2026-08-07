import path from 'node:path'
import fs from 'node:fs'
import { createServer } from 'vite'
import { webcrypto } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const TASK_DIR = 'reports/20260610-shift-milk-import-translation'
const OPERATOR = 'shift-milk-dry-run'
const packageDir =
  process.env.SHIFT_MILK_IMPORT_PACKAGE_DIR || path.resolve('test-fixtures/shift-milk/system-import-package')
const files = [
  {
    id: 'animal-profile',
    templateCode: 'animal-profile',
    requiredImport: true,
    path: path.join(packageDir, '01_\u4e2a\u4f53\u6863\u6848_animal-profile_\u5148\u5bfc\u5165.xlsx')
  },
  {
    id: 'milk-measurement',
    templateCode: 'milk-measurement',
    requiredImport: true,
    path: path.join(packageDir, '03_\u6ccc\u4e73\u5976\u5385\u6d4b\u91cf_milk-measurement.xlsx')
  }
]

const sourceCandidates = [
  process.env.SHIFT_MILK_SOURCE_FILE,
  path.resolve('test-fixtures/shift-milk/source-workbook.xlsx'),
  path.resolve('test-fixtures/shift-milk/source-workbook-reversed.xlsx'),
  path.resolve('test-fixtures/shift-milk/source-workbook-numbered.xlsx')
].filter(Boolean)

const sourceFile = sourceCandidates.find((file) => fs.existsSync(file)) || sourceCandidates[0]
const sourceKeys = {
  workOperator: '\u5907\u6ce8',
  operator: '\u521b\u5efa\u4eba',
  pen: '\u5708\u820d',
  hall: '\u5976\u5385'
}

function requiredInputFiles() {
  return [sourceFile, ...files.map((item) => item.path)]
}

async function writeSkippedSummary(missingFiles) {
  const summary = {
    ok: true,
    skipped: true,
    reason: 'external source or translated workbook files are not available in this workspace',
    missingFiles,
    requiredImports: files.map((item) => item.id),
    note:
      'This script validates the user-provided shift milk workbook only when the workbook files are present. Generic import template dry-runs are covered by validate-information-import.mjs.',
    generatedAt: new Date().toISOString()
  }
  await fs.promises.mkdir(path.join(TASK_DIR, 'raw'), { recursive: true })
  await fs.promises.writeFile(
    path.join(TASK_DIR, 'raw/dry-run-results.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8'
  )
  console.log(JSON.stringify(summary, null, 2))
}

function readRows(file) {
  const wb = XLSX.readFile(file, { cellDates: true })
  const sheetName = wb.SheetNames.includes('\u6570\u636e\u586b\u5199')
    ? '\u6570\u636e\u586b\u5199'
    : wb.SheetNames[0]
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
}

function parseRemark(value) {
  const result = {}
  String(value ?? '')
    .split(/[;\uff1b]/)
    .forEach((part) => {
      const match = part.match(/^\s*([^:\uff1a]+)[:\uff1a](.*)$/)
      if (match) result[String(match[1]).trim()] = String(match[2] ?? '').trim()
    })
  return result
}

function assertMilkMeasurementHeaders(file) {
  const rows = readRows(file)
  const headers = Object.keys(rows[0] || {})
  const required = ['\u6324\u5976\u6279\u6b21\u7f16\u53f7', '\u64cd\u4f5c\u4eba', '\u8bb0\u5f55\u4eba', '\u8bb0\u5f55\u65f6\u95f4']
  const forbidden = ['\u73ed\u6b21\u7f16\u53f7', '\u91c7\u96c6\u4eba', '\u6e90\u521b\u5efa\u65f6\u95f4']
  const missing = required.filter((header) => !headers.includes(header))
  const leaked = forbidden.filter((header) => headers.includes(header))
  if (missing.length || leaked.length) {
    throw new Error(
      `奶厅测量表头口径错误：缺少 ${missing.join(',') || '无'}；不应出现 ${leaked.join(',') || '无'}`
    )
  }
}

function sourcePeople() {
  const wb = XLSX.readFile(sourceFile, { cellDates: true })
  const sheetName = wb.SheetNames.includes('\u73ed\u6b21\u5976\u91cf')
    ? '\u73ed\u6b21\u5976\u91cf'
    : wb.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
  const names = new Set(['\u6c34\u7814\u6240', OPERATOR])
  for (const row of rows) {
    const remark = parseRemark(row[sourceKeys.workOperator])
    const workOperator = String(remark['\u539f\u5907\u6ce8'] || row['\u64cd\u4f5c\u4eba'] || row['\u91c7\u96c6\u4eba'] || '').trim()
    const operator = String(row[sourceKeys.operator] ?? '').trim()
    if (workOperator) names.add(workOperator)
    if (operator) names.add(operator)
  }
  return [...names].map((name, index) => ({ id: `p${index + 1}`, name, status: '\u542f\u7528' }))
}

function safeCode(value) {
  const raw = String(value ?? '').trim()
  const fixed = raw
    .replace(/栋/g, 'dong')
    .replace(/挤奶厅|奶厅/g, 'milking-hall')
    .replace(/新/g, 'xin')
    .replace(/北/g, 'bei')
    .replace(/南/g, 'nan')
    .replace(/东/g, 'dong')
    .replace(/西/g, 'xi')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return fixed || Buffer.from(raw).toString('hex').slice(0, 16)
}

function stableUnitId(value) {
  return `src-unit-${safeCode(value)}`
}

function sourceFarmUnits() {
  const wb = XLSX.readFile(sourceFile, { cellDates: true })
  const sheetName = wb.SheetNames.includes('\u73ed\u6b21\u5976\u91cf')
    ? '\u73ed\u6b21\u5976\u91cf'
    : wb.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
  const names = new Set()
  for (const row of rows) {
    const pen = String(row[sourceKeys.pen] ?? '').trim()
    const hall = String(row[sourceKeys.hall] ?? '').trim()
    if (pen) names.add(pen)
    if (hall) names.add(hall)
  }
  return [...names].sort().map((name, index) => ({
    id: stableUnitId(name),
    code: stableUnitId(name),
    unit_id: stableUnitId(name),
    unit_code: stableUnitId(name),
    name,
    unit_name: name,
    unit_type: /奶厅|挤奶/.test(name) ? 'milking_parlor' : 'pen',
    category: /奶厅|挤奶/.test(name) ? '挤奶厅' : '生产圈舍',
    status: 'active',
    sortOrder: index + 1
  }))
}

function createMemoryDatabase() {
  return {
    tables: {
      animal: [],
      cows: [],
      persons: sourcePeople(),
      farm_unit: sourceFarmUnits(),
      'base-info-categories': [
        {
          id: 'milk-shift-1',
          scope: 'milk:shifts',
          name: '1',
          value: '1',
          label: '1',
          code: '1',
          status: '\u542f\u7528',
          sortOrder: 1
        },
        {
          id: 'milk-shift-2',
          scope: 'milk:shifts',
          name: '2',
          value: '2',
          label: '2',
          code: '2',
          status: '\u542f\u7528',
          sortOrder: 2
        },
        {
          id: 'repro-status-snapshot',
          scope: 'information-entry-events',
          name: '繁殖状态快照',
          value: 'reproduction_status_snapshot',
          label: '繁殖状态快照',
          code: 'reproduction_status_snapshot',
          status: '\u542f\u7528',
          sortOrder: 99
        }
      ],
      'breed-types': [],
      pens: [],
      'transfer-reasons': [],
      diseases: [],
      medicines: [],
      medicine: [],
      medicine_batch: [],
      'phenotype-trait-definitions': [],
      trait_definition: [
        { id: 'trait-milk-yield', code: 'milk_yield', name: '\u5355\u6b21\u4ea7\u5976\u91cf', unit: 'kg', status: '\u542f\u7528' },
        { id: 'trait-milk-first-2min-yield', code: 'milk_first_2min_yield', name: '\u59342\u5206\u949f\u4ea7\u91cf', unit: 'kg', status: '\u542f\u7528' },
        { id: 'trait-milk-flow-0-15s', code: 'milk_flow_0_15s', name: '0-15\u79d2\u6d41\u91cf', unit: 'kg/min', status: '\u542f\u7528' },
        { id: 'trait-milk-flow-15-30s', code: 'milk_flow_15_30s', name: '15-30\u79d2\u6d41\u91cf', unit: 'kg/min', status: '\u542f\u7528' },
        { id: 'trait-milk-flow-30-60s', code: 'milk_flow_30_60s', name: '30-60\u79d2\u6d41\u91cf', unit: 'kg/min', status: '\u542f\u7528' },
        { id: 'trait-milk-flow-60-120s', code: 'milk_flow_60_120s', name: '60-120\u79d2\u6d41\u91cf', unit: 'kg/min', status: '\u542f\u7528' },
        { id: 'trait-milk-detach-flow', code: 'milk_detach_flow', name: '\u8131\u676f\u6d41\u91cf', unit: 'kg/min', status: '\u542f\u7528' },
        { id: 'trait-milk-flow-peak', code: 'milk_flow_peak', name: '\u5cf0\u503c\u5976\u6d41\u901f', unit: 'kg/min', status: '\u542f\u7528' },
        { id: 'trait-milking-duration', code: 'milking_duration', name: '\u6324\u5976\u6301\u7eed\u65f6\u95f4', unit: 'min', status: '\u542f\u7528' },
        { id: 'trait-milk-conductivity', code: 'milk_conductivity', name: '\u7535\u5bfc\u7387', unit: '', status: '\u542f\u7528' },
        { id: 'trait-milk-fat-protein-ratio', code: 'milk_fat_protein_ratio', name: '\u8102\u86cb\u6bd4', unit: '', status: '\u542f\u7528' },
        { id: 'trait-milk-urea-nitrogen', code: 'milk_urea_nitrogen', name: '\u5c3f\u7d20\u6c2e', unit: '', status: '\u542f\u7528' },
        { id: 'trait-milk-total-solids', code: 'milk_total_solids', name: '\u5168\u8102\u4e73\u56fa\u4f53', unit: '%', status: '\u542f\u7528' }
      ],
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

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function setupBrowserMocks(memoryDb) {
  const storage = makeStorage()
  const location = { href: 'http://127.0.0.1:9191/#/', origin: 'http://127.0.0.1:9191', pathname: '/', search: '', hash: '#/' }
  globalThis.__SHIFT_MILK_MEMORY_DB__ = memoryDb
  Object.defineProperty(globalThis, 'location', { value: location, configurable: true })
  Object.defineProperty(globalThis, 'history', { value: { state: null, pushState() {}, replaceState() {} }, configurable: true })
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

async function createValidationServer() {
  return createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true, entries: [] },
    plugins: [
      {
        name: 'shift-milk-import-validation-mocks',
        enforce: 'pre',
        resolveId(id) {
          const normalized = String(id).replace(/\\/g, '/')
          if (id === '@/services/数据库' || normalized.endsWith('/src/services/database.ts') || normalized.endsWith('/src/services/数据库')) {
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
                const db = globalThis.__SHIFT_MILK_MEMORY_DB__
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
                globalThis.__SHIFT_MILK_MEMORY_DB__.tables[tableName] = merge(rowsOf(tableName), rows)
              }
              export async function addTableDataFastAsync(tableName, data) { await addTableDataAsync(tableName, data) }
              export async function upsertTableDataAsync(tableName, record) { await addTableDataAsync(tableName, record) }
              export async function updateTableRecordAsync(tableName, id, patch) {
                const rows = rowsOf(tableName)
                const idx = rows.findIndex((row) => String(row?.id || '') === String(id))
                if (idx >= 0) rows[idx] = { ...rows[idx], ...clone(patch), id: rows[idx].id }
              }
              export async function updateTableDataAsync(tableName, data) { globalThis.__SHIFT_MILK_MEMORY_DB__.tables[tableName] = clone(data || []) }
              export async function deleteTableRecordAsync(tableName, id) {
                globalThis.__SHIFT_MILK_MEMORY_DB__.tables[tableName] = rowsOf(tableName).filter((row) => String(row?.id || '') !== String(id))
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
    }))
  }
}

async function main() {
  const missingFiles = requiredInputFiles().filter((file) => !fs.existsSync(file))
  if (missingFiles.length) {
    await writeSkippedSummary(missingFiles)
    return
  }

  const memoryDb = createMemoryDatabase()
  assertMilkMeasurementHeaders(files.find((item) => item.id === 'milk-measurement').path)
  setupBrowserMocks(memoryDb)
  const server = await createValidationServer()
  const results = []
  try {
    const adapter = await server.ssrLoadModule('/src/services/import-adapter.ts')
    for (const item of files) {
      const rows = readRows(item.path)
      const modeResult = await adapter.dryRunImportRows({
        mode: 'batch',
        templateCode: item.templateCode,
        rows,
        operatorName: OPERATOR
      })
      results.push({ id: item.id, file: item.path, requiredImport: item.requiredImport, ...pick(modeResult) })
      if (item.templateCode === 'animal-profile' && modeResult.errorRows === 0) {
        const commitResult = await adapter.commitImportRows({
          mode: 'batch',
          templateCode: item.templateCode,
          rows,
          operatorName: OPERATOR
        })
        results[results.length - 1].memoryCommit = pick(commitResult)
      }
    }
  } finally {
    await server.close()
  }
  const summary = {
    ok: results.every((item) => item.errorRows === 0),
    requiredImports: results.map((item) => item.id),
    referenceOnly: ['milk-summary', 'reproduction-snapshot', 'initial-pen-event', 'platform-dictionary', 'pedigree-check', 'trait-supplement'],
    results,
    generatedAt: new Date().toISOString()
  }
  await fs.promises.mkdir(path.join(TASK_DIR, 'raw'), { recursive: true })
  await fs.promises.writeFile(
    path.join(TASK_DIR, 'raw/dry-run-results.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8'
  )
  console.log(JSON.stringify(summary, null, 2))
  if (!summary.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

