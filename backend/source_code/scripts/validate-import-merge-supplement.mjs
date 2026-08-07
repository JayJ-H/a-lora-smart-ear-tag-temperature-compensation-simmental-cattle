import { createServer } from 'vite'
import { webcrypto } from 'node:crypto'

function setupBrowserMocks(memoryDb) {
  const storage = makeStorage()
  const location = { href: 'http://127.0.0.1:9191/#/', origin: 'http://127.0.0.1:9191', pathname: '/', search: '', hash: '#/' }
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
  globalThis.__IMPORT_MERGE_MEMORY_DB__ = memoryDb
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
        name: 'import-merge-validation-mocks',
        enforce: 'pre',
        resolveId(id) {
          const normalized = String(id).replace(/\\/g, '/')
          if (id === '@/services/database' || normalized.endsWith('/src/services/database.ts') || normalized.endsWith('/src/services/database')) {
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
                const db = globalThis.__IMPORT_MERGE_MEMORY_DB__
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
                globalThis.__IMPORT_MERGE_MEMORY_DB__.tables[tableName] = merge(rowsOf(tableName), rows)
              }
              export async function addTableDataFastAsync(tableName, data) { await addTableDataAsync(tableName, data) }
              export async function upsertTableDataAsync(tableName, record) { await addTableDataAsync(tableName, record) }
              export async function updateTableRecordAsync(tableName, id, patch) {
                const rows = rowsOf(tableName)
                const idx = rows.findIndex((row) => String(row?.id || '') === String(id))
                if (idx >= 0) rows[idx] = { ...rows[idx], ...clone(patch), id: rows[idx].id }
              }
              export async function updateTableDataAsync(tableName, data) { globalThis.__IMPORT_MERGE_MEMORY_DB__.tables[tableName] = clone(data || []) }
              export async function deleteTableRecordAsync(tableName, id) {
                globalThis.__IMPORT_MERGE_MEMORY_DB__.tables[tableName] = rowsOf(tableName).filter((row) => String(row?.id || '') !== String(id))
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

function memoryDatabase() {
  return {
    tables: {
      animal: [
        { id: 'animal-MERGE-001', animal_number: 'MERGE-001', animalNumber: 'MERGE-001', cow_number: 'MERGE-001', cowNumber: 'MERGE-001', status: '在群' }
      ],
      cows: [
        { id: 'animal-MERGE-001', cowNumber: 'MERGE-001', animalNumber: 'MERGE-001', status: '在群' }
      ],
      animal_identifier: [],
      animal_parentage: [],
      milk_measurement: [
        {
          id: 'milk-merge-existing',
          animal_id: 'animal-MERGE-001',
          animal_number: 'MERGE-001',
          cow_number: 'MERGE-001',
          measured_at: '2026-06-10 06:00:00',
          shift_name: '早班',
          shift_id: '早班',
          milk_yield: 12.3,
          fat_percent: null,
          protein_percent: null
        }
      ],
      'milk-records': [],
      milking_session: [],
      milking_visit: [],
      persons: [{ id: 'person-test', name: '测试员', status: '启用' }],
      'base-info-categories': [
        { id: 'milk-shift-morning', scope: 'milk:shifts', code: '早班', value: '早班', name: '早班', label: '早班', status: '启用' },
        { id: 'source-batch', scope: 'information-entry:source', code: 'batch_import', value: 'batch_import', name: '批量导入', label: '批量导入', status: '启用' },
        { id: 'source-manual', scope: 'information-entry:source', code: 'manual', value: 'manual', name: '手工录入', label: '手工录入', status: '启用' }
      ],
      trait_definition: []
    }
  }
}

async function main() {
  const db = memoryDatabase()
  setupBrowserMocks(db)
  const server = await createValidationServer()
  await server.pluginContainer.buildStart({})
  try {
    const mod = await server.ssrLoadModule('/src/services/import-adapter.ts')
    const pedigree = await mod.dryRunImportRows({
      mode: 'batch',
      templateCode: 'pedigree',
      rows: [
        {
          '牛号': 'MERGE-001',
          '父号': 'SIRE-001',
          '母号': 'DAM-001',
          '来源类型': 'manual',
          '记录人': '测试员'
        }
      ],
      operatorName: '测试员'
    })
    const milk = await mod.dryRunImportRows({
      mode: 'batch',
      templateCode: 'milk-measurement',
      rows: [
        {
          '牛号': 'MERGE-001',
          '班次': '早班',
          '挤奶日期': '2026-06-10',
          '乳脂率': 4.2,
          '乳蛋白率': 3.4,
          '记录人': '测试员'
        }
      ],
      operatorName: '测试员'
    })
    const milkCommit = await mod.commitImportRows({
      mode: 'batch',
      templateCode: 'milk-measurement',
      rows: [
        {
          '牛号': 'MERGE-001',
          '班次': '早班',
          '挤奶日期': '2026-06-10',
          '乳脂率': 4.2,
          '乳蛋白率': 3.4,
          '记录人': '测试员'
        }
      ],
      operatorName: '测试员'
    })
    const pedigreeCommit = await mod.commitImportRows({
      mode: 'batch',
      templateCode: 'pedigree',
      rows: [
        {
          '牛号': 'MERGE-001',
          '父号': 'SIRE-001',
          '母号': 'DAM-001',
          '来源类型': 'manual',
          '记录人': '测试员'
        }
      ],
      operatorName: '测试员'
    })

    const pedigreeRow = pedigree.parsedRows[0]
    const milkRow = milk.parsedRows[0]
    const milkRows = db.tables.milk_measurement
    const mergedMilk = milkRows.find((row) => row.id === 'milk-merge-existing') || {}
    const cows = db.tables.cows
    const mergedCow = cows.find((row) => row.id === 'animal-MERGE-001') || {}
    const parentageRows = db.tables.animal_parentage
    const ok =
      milkRow.mergeMode === 'supplement' &&
      milk.previewRows[0]?.['写入方式'] === '补充字段' &&
      milkRows.length === 1 &&
      Number(mergedMilk.milk_yield) === 12.3 &&
      Number(mergedMilk.fat_percent) === 4.2 &&
      Number(mergedMilk.protein_percent) === 3.4 &&
      parentageRows.length === 2 &&
      mergedCow.fatherNumber === 'SIRE-001' &&
      mergedCow.motherNumber === 'DAM-001'
    const summary = {
      ok,
      pedigree: {
        duplicate: pedigreeRow.duplicate,
        mergeMode: pedigreeRow.mergeMode,
        previewStatus: pedigree.previewRows[0]?.['状态'],
        writeMode: pedigree.previewRows[0]?.['写入方式'],
        committedRows: pedigreeCommit.committedRows,
        parentageRows: parentageRows.length,
        cowFather: mergedCow.fatherNumber,
        cowMother: mergedCow.motherNumber
      },
      milk: {
        duplicate: milkRow.duplicate,
        mergeMode: milkRow.mergeMode,
        previewStatus: milk.previewRows[0]?.['状态'],
        writeMode: milk.previewRows[0]?.['写入方式'],
        committedRows: milkCommit.committedRows,
        rowCount: milkRows.length,
        milkYield: mergedMilk.milk_yield,
        fatPercent: mergedMilk.fat_percent,
        proteinPercent: mergedMilk.protein_percent
      }
    }
    console.log(JSON.stringify(summary, null, 2))
    if (!ok) process.exitCode = 1
  } finally {
    await server.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

