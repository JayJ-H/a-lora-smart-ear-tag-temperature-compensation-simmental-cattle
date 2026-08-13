import path from 'node:path'
import { createServer } from 'vite'
import { webcrypto } from 'node:crypto'

const RUN_ID = `LPP_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
const OPERATOR = '周期闭环审计'
const MS_DAY = 86400000

const results = []

async function main() {
  setupBrowserMocks()
  globalThis.__LPP_MEMORY_DB__ = createMemoryDatabase()
  const server = await createAuditServer()
  try {
    const adapter = await server.ssrLoadModule('/src/services/import-adapter.ts')
    const facts = await server.ssrLoadModule('/src/services/production-facts.ts')
    const ctx = { adapter, facts, db: globalThis.__LPP_MEMORY_DB__ }
    await seedReferenceData(ctx)
    await runScenario(ctx)
    await facts.rebuildProductionFacts({ reason: 'lactation_pedigree_period_audit' })
    await runAssertions(ctx)
  } finally {
    await server.close()
  }
  printResults()
  if (results.some((item) => item.status === 'FAIL')) process.exitCode = 1
}

async function runScenario(ctx) {
  await commitRows(ctx, 'pedigree', [
    {
      牛号: `${RUN_ID}_DAM`,
      性别: '母',
      品种: '摩拉水牛',
      出生日期: '2021-01-01',
      父号: `${RUN_ID}_SIRE_EXT`,
      父号品种: '尼里-拉菲水牛',
      母号: `${RUN_ID}_DAM_EXT`,
      母号品种: '摩拉水牛',
      胎次: 1,
      产犊日期: '2025-01-10',
      犊牛号: `${RUN_ID}_CALF_A1`,
      犊牛性别: '母',
      犊牛品种: '摩拉水牛'
    },
    {
      牛号: `${RUN_ID}_DAM`,
      性别: '母',
      品种: '摩拉水牛',
      胎次: 2,
      产犊日期: '2026-01-05',
      犊牛号: `${RUN_ID}_CALF_B1,${RUN_ID}_CALF_B2`,
      犊牛性别: '母',
      犊牛品种: '摩拉水牛'
    }
  ])

  await commitRows(ctx, 'pedigree', [
    {
      牛号: `${RUN_ID}_CALF_A1`,
      性别: '母',
      品种: '摩拉水牛',
      出生日期: '2025-01-10',
      父号: `${RUN_ID}_SIRE_EXT`,
      母号: `${RUN_ID}_DAM`
    },
    {
      牛号: `${RUN_ID}_CALF_B1`,
      性别: '母',
      品种: '摩拉水牛',
      出生日期: '2026-01-05',
      父号: `${RUN_ID}_SIRE_EXT`,
      母号: `${RUN_ID}_DAM`
    }
  ])

  await commitRows(ctx, 'animal-event', [
    {
      牛号: `${RUN_ID}_DAM`,
      事件类型: 'dry_off',
      事件名称: '停产',
      发生日期: '2025-11-01',
      停产原因: '预产期前停产'
    }
  ])

  await commitRows(ctx, 'milk-measurement', [
    {
      牛号: `${RUN_ID}_DAM`,
      挤奶日期: '2025-01-11',
      班次: '早班',
      产奶量: 10,
      当前圈舍单元: `${RUN_ID}_PEN_A`,
      操作人: '李挤奶'
    },
    {
      牛号: `${RUN_ID}_DAM`,
      挤奶日期: '2025-01-11',
      班次: '晚班',
      产奶量: 12,
      当前圈舍单元: `${RUN_ID}_PEN_A`,
      乳脂率: 4.1,
      操作人: '李挤奶'
    },
    {
      牛号: `${RUN_ID}_DAM`,
      挤奶日期: '2025-11-02',
      班次: '早班',
      产奶量: 8,
      当前圈舍单元: `${RUN_ID}_PEN_A`,
      操作人: '李挤奶'
    },
    {
      牛号: `${RUN_ID}_DAM`,
      挤奶日期: '2026-01-06',
      班次: '早班',
      产奶量: 15,
      当前圈舍单元: `${RUN_ID}_PEN_B`,
      操作人: '李挤奶'
    },
    {
      牛号: `${RUN_ID}_DAM`,
      挤奶日期: '2026-11-08',
      班次: '早班',
      产奶量: 9,
      当前圈舍单元: `${RUN_ID}_PEN_B`,
      操作人: '李挤奶'
    }
  ])

  await commitRows(ctx, 'milk-measurement', [
    {
      牛号: `${RUN_ID}_DAM`,
      挤奶日期: '2025-01-11',
      班次: '晚班',
      乳蛋白率: 3.2,
      当前圈舍单元: `${RUN_ID}_PEN_A`,
      操作人: '李挤奶'
    }
  ])
}

async function commitRows(ctx, templateCode, rows) {
  const dryRun = await ctx.adapter.dryRunImportRows({
    mode: 'batch',
    templateCode,
    rows,
    operatorName: OPERATOR
  })
  if (dryRun.errorRows) {
    throw new Error(`${templateCode} dry-run failed: ${JSON.stringify(dryRun.errors.slice(0, 5))}`)
  }
  const commit = await ctx.adapter.commitImportRows({
    mode: 'batch',
    templateCode,
    rows,
    operatorName: OPERATOR
  })
  if (commit.errorRows) {
    throw new Error(`${templateCode} commit failed: ${JSON.stringify(commit.errors.slice(0, 5))}`)
  }
  return commit
}

async function runAssertions(ctx) {
  const t = ctx.db.tables
  const rows = (name) => t[name] || []
  const animal = rows('animal')
  const parentage = rows('animal_parentage')
  const events = rows('animal_event')
  const eventDetails = rows('event_reproduction_detail')
  const movementEvents = rows('event_movement_detail')
  const milk = rows('milk_measurement')
  const parity = rows('parity_episode')
  const lactation = rows('lactation_episode')
  const facts305 = rows('fact_lactation_305')
  const timeIndex = rows('animal_time_index')
  if (process.argv.includes('--debug')) {
    console.log('DEBUG animal_event', events.filter(isDam).map((row) => ({
      id: row.id,
      type: eventType(row),
      date: dateOnly(row.occurredAt || row.occurred_at || row.eventTime || row.event_time),
      parity: row.parityNo ?? row.parity_no,
      cowId: row.cowId || row.cow_id,
      cowNumber: row.cowNumber || row.cow_number
    })))
    console.log('DEBUG milk', milk.filter(isDam).map((row) => ({
      id: row.id,
      date: dateOnly(row.measuredAt || row.measured_at),
      shift: row.shiftId || row.shift_id,
      yield: row.milkYield ?? row.milk_yield,
      parity: row.parityNo ?? row.parity_no,
      dim: row.daysInMilk ?? row.days_in_milk,
      periodSource: row.periodSource || row.period_source
    })))
    console.log('DEBUG parity', parity.filter(isDam).map((row) => ({
      id: row.id,
      parity: row.parityNo ?? row.parity_no,
      start: row.startDate || row.start_date,
      end: row.endDate || row.end_date
    })))
    console.log('DEBUG timeIndex around dry', timeIndex.filter((row) => isDam(row) && dateOnly(row.date || row.productionDate || row.production_date).startsWith('2025-11')).slice(0, 5))
  }

  assertCase('pedigree_parentage_sire_dam', () => {
    const roles = parentage
      .filter((row) => str(row.animalNumber || row.animal_number) === `${RUN_ID}_DAM`)
      .map((row) => str(row.parentRole || row.parent_role))
    return roles.includes('sire') && roles.includes('dam')
  }, '系谱导入应保存父号和母号。')

  assertCase('pedigree_calving_event_written', () => {
    return events.filter((row) => isDam(row) && eventType(row) === 'calving').length === 2
  }, '母牛两次产犊应同步为两条产犊事件。')

  assertCase('pedigree_calving_detail_multi_calf', () => {
    return eventDetails.some((row) =>
      isDam(row) &&
      (num(row.calfCount ?? row.calf_count) === 2 ||
        str(row.calfNumber || row.calf_number).includes(`${RUN_ID}_CALF_B2`) ||
        JSON.stringify(row).includes(`${RUN_ID}_CALF_B2`))
    )
  }, '双胎产犊应在繁殖明细中保留两个犊牛号或 calf_count=2。')

  assertCase('calf_minimal_archive_created', () => {
    return [`${RUN_ID}_CALF_A1`, `${RUN_ID}_CALF_B1`, `${RUN_ID}_CALF_B2`].every((number) =>
      animal.some((row) => animalNumber(row) === number)
    )
  }, '产犊同步应为犊牛创建最小 animal 档案。')

  assertCase('calf_birth_date_from_calving_date', () => {
    const calf = animal.find((row) => animalNumber(row) === `${RUN_ID}_CALF_A1`)
    return dateOnly(calf?.birthDate || calf?.birth_date) === '2025-01-10'
  }, '犊牛出生日期应等于产犊日期。')

  assertCase('no_duplicate_calving_after_child_parentage_supplement', () => {
    return events.filter((row) => eventType(row) === 'calving' && str(row.cowNumber || row.cow_number).includes(`${RUN_ID}_CALF`)).length === 0
  }, '补录犊牛自己的父母关系不应反向生成犊牛产犊事件。')

  assertCase('parity_accumulates_by_calving_date', () => {
    const list = parity.filter(isDam).sort((a, b) => str(a.startDate || a.start_date).localeCompare(str(b.startDate || b.start_date)))
    return list.length === 2 && num(list[0].parityNo ?? list[0].parity_no) === 1 && num(list[1].parityNo ?? list[1].parity_no) === 2
  }, '多次产犊应生成递增胎次。')

  assertCase('first_parity_closes_before_second', () => {
    const first = parity.find((row) => isDam(row) && num(row.parityNo ?? row.parity_no) === 1)
    return dateOnly(first?.endDate || first?.end_date) === '2026-01-04'
  }, '第二次产犊应闭合上一胎次到前一日。')

  assertCase('lactation_stops_at_dry_off', () => {
    const first = lactation.find((row) => isDam(row) && num(row.parityNo ?? row.parity_no) === 1)
    return dateOnly(first?.endDate || first?.end_date) === '2025-11-01'
  }, '停产事件应闭合本胎泌乳窗口。')

  assertCase('milk_before_second_calving_stays_parity_1', () => {
    const row = milk.find((item) => isDam(item) && dateOnly(item.measuredAt || item.measured_at) === '2025-11-02')
    return num(row?.parityNo ?? row?.parity_no) === 1
  }, '第二次产犊前奶量应仍归一胎。')

  assertCase('milk_after_second_calving_is_parity_2', () => {
    const row = milk.find((item) => isDam(item) && dateOnly(item.measuredAt || item.measured_at) === '2026-01-06')
    return num(row?.parityNo ?? row?.parity_no) === 2 && num(row?.daysInMilk ?? row?.days_in_milk) === 2
  }, '第二次产犊后奶量应归二胎且 DIM 正确。')

  assertCase('milk_after_305_excluded_from_305_fact', () => {
    const fact = facts305.find((row) => isDam(row) && num(row.parityNo ?? row.parity_no) === 2)
    return fact && num(fact.milkYield305 ?? fact.milk_yield_305 ?? fact.milk305 ?? fact.milk_305) === 15
  }, 'DIM>305 的奶量不能进入 305 天产量。')

  assertCase('two_shift_same_day_not_double_coverage_days', () => {
    const fact = facts305.find((row) => isDam(row) && num(row.parityNo ?? row.parity_no) === 1)
    return fact && num(fact.coverageDays ?? fact.coverage_days ?? fact.recordDays ?? fact.record_days) === 2
  }, '同一天多个班次只能计一个覆盖日，但产量应按班次求和。')

  assertCase('same_slot_supplement_merge_not_duplicate', () => {
    const rowsAtSlot = milk.filter(
      (row) =>
        isDam(row) &&
        dateOnly(row.measuredAt || row.measured_at) === '2025-01-11' &&
        str(row.shiftId || row.shift_id) === '晚班'
    )
    return rowsAtSlot.length === 1 && num(rowsAtSlot[0].milkYield ?? rowsAtSlot[0].milk_yield) === 12 && num(rowsAtSlot[0].proteinPercent ?? rowsAtSlot[0].protein_percent) === 3.2
  }, '同牛同日同班次二次导入应补字段，不应新增重复奶量。')

  assertCase('unit_change_from_milk_import_creates_single_transfer', () => {
    const transfers = movementEvents.filter((row) => isDam(row) && str(row.toUnitId || row.to_unit_id) === `${RUN_ID}_PEN_B`)
    return transfers.length === 1
  }, '奶厅导入携带圈舍变化时应生成一次转群事实，不应每条奶量重复生成。')

  assertCase('annual_export_can_include_multi_parity_rows', () => {
    const annualRows = milk
      .filter((row) => isDam(row) && dateOnly(row.measuredAt || row.measured_at).startsWith('2026'))
      .map((row) => ({ date: dateOnly(row.measuredAt || row.measured_at), parityNo: num(row.parityNo ?? row.parity_no), milk: num(row.milkYield ?? row.milk_yield) }))
    return annualRows.length === 2 && annualRows.every((row) => row.parityNo === 2)
  }, '按年度取奶量时应按日期取数，同时保留该日所属胎次。')

  assertCase('cross_month_boundary_can_be_split_by_daily_parity', () => {
    const janRows = milk.filter((row) => isDam(row) && dateOnly(row.measuredAt || row.measured_at).slice(0, 7) === '2026-01')
    return janRows.length === 1 && num(janRows[0].parityNo ?? janRows[0].parity_no) === 2
  }, '月度数据应按日记录保留胎次，不能把整月硬归旧胎次。')

  assertCase('dry_off_marks_later_days_as_dry_period', () => {
    const row = timeIndex.find((item) => isDam(item) && dateOnly(item.date || item.productionDate || item.production_date) === '2025-11-20' && num(item.parityNo ?? item.parity_no) === 1)
    return row && str(row.productionStage || row.production_stage) === '干奶期'
  }, '停产后日期可以保留在时间索引，但必须标记为干奶期，供缺失复核排除。')

  assertCase('305_fact_has_source_record_ids', () => {
    const fact = facts305.find((row) => isDam(row) && num(row.parityNo ?? row.parity_no) === 1)
    return Boolean(fact?.sourceRecordIds || fact?.source_record_ids || fact?.sourceTable || fact?.source_table)
  }, '305 天事实应保留来源记录追溯。')

  assertCase('import_audit_written', () => {
    return rows('operation-audit-logs').length + rows('import_audit_log').length + rows('import-audit-logs').length > 0
  }, '导入应写入审计记录。')
}

async function seedReferenceData(ctx) {
  const now = new Date().toISOString()
  await add('persons', { id: `${RUN_ID}_OP`, name: OPERATOR, realName: OPERATOR, real_name: OPERATOR, status: '启用', createdAt: now, updatedAt: now })
  await add('persons', { id: 'person-li', name: '李挤奶', realName: '李挤奶', real_name: '李挤奶', status: '启用', createdAt: now, updatedAt: now })
  await add('farm_unit', [
    { id: `${RUN_ID}_PEN_A`, code: `${RUN_ID}_PEN_A`, name: '审计圈舍A', status: 'active', createdAt: now, updatedAt: now },
    { id: `${RUN_ID}_PEN_B`, code: `${RUN_ID}_PEN_B`, name: '审计圈舍B', status: 'active', createdAt: now, updatedAt: now }
  ])
  await add('trait_category', { id: `${RUN_ID}_CAT_LACT`, code: `${RUN_ID}_CAT_LACT`, name: '泌乳性能', status: 'active', createdAt: now, updatedAt: now })
  await add('trait_definition', [
    { id: 'trait-milk_yield', code: 'milk_yield', name: '产奶量', traitType: 'lactation', trait_type: 'lactation', dataType: 'number', data_type: 'number', unit: 'kg', status: 'active', createdAt: now, updatedAt: now },
    { id: 'trait-milk_fat', code: 'milk_fat', name: '乳脂率', traitType: 'lactation', trait_type: 'lactation', dataType: 'number', data_type: 'number', unit: '%', status: 'active', createdAt: now, updatedAt: now },
    { id: 'trait-milk_protein', code: 'milk_protein', name: '乳蛋白率', traitType: 'lactation', trait_type: 'lactation', dataType: 'number', data_type: 'number', unit: '%', status: 'active', createdAt: now, updatedAt: now }
  ])
}

async function add(tableName, data) {
  const rows = Array.isArray(data) ? data : [data]
  const table = rowsOf(tableName)
  globalThis.__LPP_MEMORY_DB__.tables[tableName] = mergeRowsById(table, rows)
}

function assertCase(id, predicate, message) {
  try {
    const ok = Boolean(predicate())
    results.push({ id, status: ok ? 'PASS' : 'FAIL', message })
  } catch (error) {
    results.push({ id, status: 'FAIL', message: `${message} ${error?.message || error}` })
  }
}

function printResults() {
  const pass = results.filter((item) => item.status === 'PASS').length
  const fail = results.length - pass
  for (const item of results) {
    console.log(`[${item.status}] ${item.id} - ${item.message}`)
  }
  const summary = {
    runId: RUN_ID,
    passed: pass,
    failed: fail,
    total: results.length,
    failedItems: results.filter((item) => item.status === 'FAIL')
  }
  console.log(JSON.stringify(summary, null, 2))
}

function setupBrowserMocks() {
  const storage = makeStorage()
  const location = {
    href: 'http://127.0.0.1/#/',
    origin: 'http://127.0.0.1',
    pathname: '/',
    search: '',
    hash: '#/'
  }
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
      documentElement: { style: { setProperty() {} }, classList: { contains() { return false }, add() {}, remove() {} } },
      body: {},
      title: '',
      addEventListener() {},
      removeEventListener() {},
      createElement() { return { style: {}, click() {}, setAttribute() {}, appendChild() {}, remove() {} } }
    },
    configurable: true
  })
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

function createMemoryDatabase() {
  return { tables: Object.create(null) }
}

async function createAuditServer() {
  const mockPlugin = {
    name: 'lactation-pedigree-period-audit-mocks',
    enforce: 'pre',
    resolveId(id) {
      const normalized = String(id).replace(/\\/g, '/')
      if (id === '@/services/数据库' || normalized.endsWith('/src/services/database.ts') || normalized.endsWith('/src/services/数据库')) return '\0mock-database'
      if (id === '@/utils/http' || normalized.endsWith('/src/utils/http/index.ts') || normalized.endsWith('/src/utils/http')) return '\0mock-http'
      if (/\.(css|scss|sass|less|png|jpg|jpeg|gif|svg|webp)$/.test(id) || id.startsWith('@imgs') || id.startsWith('@styles') || id.startsWith('@icons')) return '\0mock-asset'
      return null
    },
    load(id) {
      if (id === '\0mock-asset') return 'export default ""'
      if (id === '\0mock-http') return 'export default { get: async () => ({ data: null }), post: async () => ({ data: null }) }'
      if (id === '\0mock-database') {
        return `
          const clone = (value) => JSON.parse(JSON.stringify(value ?? null))
          function text(value) { return value === undefined || value === null ? '' : String(value).trim() }
          function stableId(...parts) {
            return parts.map((part) => text(part).replace(/[^a-zA-Z0-9_-]+/g, '-')).filter(Boolean).join('-').slice(0, 96) || 'id'
          }
          function rowsOf(tableName) {
            const db = globalThis.__LPP_MEMORY_DB__
            if (!db.tables[tableName]) db.tables[tableName] = []
            return db.tables[tableName]
          }
          function mergeById(existing, rows) {
            const next = [...existing]
            for (const row of rows) {
              const id = text(row?.id)
              const index = id ? next.findIndex((item) => text(item?.id) === id) : -1
              if (index >= 0) next[index] = { ...next[index], ...clone(row) }
              else next.push(clone(row))
            }
            return next
          }
          function eventCodeOf(eventData) {
            const raw = text(eventData.eventCode || eventData.event_code || eventData.eventType || eventData.event_type || eventData.eventName || eventData.event_name).toLowerCase()
            if (raw.includes('calving') || raw.includes('产犊') || raw.includes('分娩')) return 'calving'
            if (raw.includes('dry_off') || raw.includes('停产') || raw.includes('干奶')) return 'dry_off'
            if (raw.includes('transfer') || raw.includes('转群')) return 'transfer'
            if (raw.includes('entry') || raw.includes('入群')) return 'entry'
            return raw || 'general_event'
          }
          export async function getTableDataAsync(tableName) { return clone(rowsOf(tableName)) }
          export function getTableData(tableName) { return clone(rowsOf(tableName)) }
          export async function addTableDataAsync(tableName, data) {
            const rows = Array.isArray(data) ? data : [data]
            globalThis.__LPP_MEMORY_DB__.tables[tableName] = mergeById(rowsOf(tableName), rows)
          }
          export async function addTableDataFastAsync(tableName, data) { await addTableDataAsync(tableName, data) }
          export async function upsertTableDataAsync(tableName, record) { await addTableDataAsync(tableName, record) }
          export async function updateTableDataAsync(tableName, data) { globalThis.__LPP_MEMORY_DB__.tables[tableName] = clone(data || []) }
          export async function updateTableRecordAsync(tableName, id, patch) {
            const rows = rowsOf(tableName)
            const index = rows.findIndex((row) => text(row?.id) === text(id))
            if (index >= 0) rows[index] = { ...rows[index], ...clone(patch), id: rows[index].id }
          }
          export async function deleteTableRecordAsync(tableName, id) {
            globalThis.__LPP_MEMORY_DB__.tables[tableName] = rowsOf(tableName).filter((row) => text(row?.id) !== text(id))
          }
          export function beginTableDataBulkWrite() { return { active: true } }
          export async function flushTableDataBulkWrite(context, onProgress) { onProgress?.({ current: 0, total: 0 }) }
          export function endTableDataBulkWrite() {}
          export async function runBackendRpcAsync(method) { throw new Error('audit blocks backend RPC: ' + method) }
          export function setDataUpdateCallback() {}
          export async function addCowEvent(eventData) {
            const now = new Date().toISOString()
            const eventCode = eventCodeOf(eventData)
            const eventId = text(eventData.id) || stableId('event', eventCode, eventData.cowId || eventData.cowNumber, eventData.eventTime || eventData.occurredAt)
            const occurredAt = text(eventData.eventTime || eventData.occurredAt || eventData.occurred_at || now).slice(0, 10)
            const details = eventData.details || {}
            const row = {
              id: eventId,
              animalId: eventData.cowId || eventData.animalId || details.animal_id,
              animal_id: eventData.cowId || eventData.animalId || details.animal_id,
              cowId: eventData.cowId || eventData.animalId || details.animal_id,
              cow_id: eventData.cowId || eventData.animalId || details.animal_id,
              animalNumber: eventData.cowNumber || eventData.animalNumber || details.animal_number,
              animal_number: eventData.cowNumber || eventData.animalNumber || details.animal_number,
              cowNumber: eventData.cowNumber || eventData.animalNumber || details.animal_number,
              cow_number: eventData.cowNumber || eventData.animalNumber || details.animal_number,
              eventType: eventCode,
              event_type: eventCode,
              eventCode,
              event_code: eventCode,
              eventName: eventData.eventName || eventData.event_name || eventCode,
              event_name: eventData.eventName || eventData.event_name || eventCode,
              occurredAt,
              occurred_at: occurredAt,
              eventTime: occurredAt,
              event_time: occurredAt,
              parityNo: details.parity_no || details.parityNo,
              parity_no: details.parity_no || details.parityNo,
              sourceRecordId: eventData.sourceRecordId || eventData.source_record_id || eventId,
              source_record_id: eventData.sourceRecordId || eventData.source_record_id || eventId,
              customValues: details,
              custom_values: details,
              details,
              notes: eventData.notes || '',
              createdAt: now,
              created_at: now,
              updatedAt: now,
              updated_at: now
            }
            await upsertTableDataAsync('animal_event', row)
            await upsertTableDataAsync('cow-events', row)
            if (eventCode === 'calving') {
              await upsertTableDataAsync('event_reproduction_detail', {
                id: eventId,
                eventId,
                event_id: eventId,
                animalId: row.animalId,
                animal_id: row.animalId,
                cowNumber: row.cowNumber,
                cow_number: row.cowNumber,
                reproductionAction: 'calving',
                reproduction_action: 'calving',
                parityNo: details.parity_no || details.parityNo,
                parity_no: details.parity_no || details.parityNo,
                calvingDate: occurredAt,
                calving_date: occurredAt,
                calfNumber: details.calf_number || details.calfNumber,
                calf_number: details.calf_number || details.calfNumber,
                calfCount: details.calf_count || details.calfCount,
                calf_count: details.calf_count || details.calfCount,
                calves: details.calves || details.calfRows || []
              })
              const calves = Array.isArray(details.calves) ? details.calves : []
              for (const calf of calves) {
                const number = text(calf.cowNumber || calf.cow_number || calf.calfNumber || calf.calf_number)
                if (!number) continue
                const id = stableId('animal', number)
                await upsertTableDataAsync('animal', {
                  id,
                  animalId: id,
                  animal_id: id,
                  animalNumber: number,
                  animal_number: number,
                  cowNumber: number,
                  cow_number: number,
                  sex: calf.sex || calf.gender || calf.calfSex,
                  breed: calf.breed || calf.calfBreed,
                  birthDate: occurredAt,
                  birth_date: occurredAt,
                  sourceTable: 'animal_event',
                  source_table: 'animal_event',
                  sourceRecordId: eventId,
                  source_record_id: eventId
                })
              }
            }
            if (eventCode === 'entry' || eventCode === 'transfer') {
              await upsertTableDataAsync('event_movement_detail', {
                id: eventId,
                eventId,
                event_id: eventId,
                animalId: row.animalId,
                animal_id: row.animalId,
                cowNumber: row.cowNumber,
                cow_number: row.cowNumber,
                fromUnitId: details.from_unit_id || details.fromUnitId || '',
                from_unit_id: details.from_unit_id || details.fromUnitId || '',
                toUnitId: details.to_unit_id || details.toUnitId || details.unit_id || details.unitId,
                to_unit_id: details.to_unit_id || details.toUnitId || details.unit_id || details.unitId,
                movementReason: details.movement_reason || details.movementReason || '',
                movement_reason: details.movement_reason || details.movementReason || ''
              })
            }
            return { animalEvent: row, event: row }
          }
        `
      }
      return null
    }
  }
  return createServer({
    configFile: false,
    mode: 'test',
    envDir: process.cwd(),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
    resolve: {
      alias: {
        '@': path.resolve('src'),
        '@imgs': path.resolve('src/assets/images'),
        '@icons': path.resolve('src/assets/icons'),
        '@styles': path.resolve('src/assets/styles')
      }
    },
    define: {
      __APP_VERSION__: JSON.stringify('audit'),
      'import.meta.env.VITE_ACCESS_MODE': JSON.stringify('frontend')
    },
    optimizeDeps: { noDiscovery: true, entries: [] },
    plugins: [mockPlugin]
  })
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

function rowsOf(tableName) {
  const db = globalThis.__LPP_MEMORY_DB__
  if (!db.tables[tableName]) db.tables[tableName] = []
  return db.tables[tableName]
}

function mergeRowsById(existing, rows) {
  const next = [...existing]
  for (const row of rows) {
    const id = str(row?.id)
    const index = id ? next.findIndex((item) => str(item?.id) === id) : -1
    if (index >= 0) next[index] = { ...next[index], ...clone(row) }
    else next.push(clone(row))
  }
  return next
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function isDam(row) {
  return [row?.animalNumber, row?.animal_number, row?.cowNumber, row?.cow_number].map(str).includes(`${RUN_ID}_DAM`)
}

function animalNumber(row) {
  return str(row?.animalNumber || row?.animal_number || row?.cowNumber || row?.cow_number)
}

function eventType(row) {
  return str(row?.eventType || row?.event_type || row?.eventCode || row?.event_code).toLowerCase()
}

function str(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function dateOnly(value) {
  const raw = str(value)
  if (!raw) return ''
  const time = Date.parse(raw)
  if (Number.isFinite(time)) return new Date(time).toISOString().slice(0, 10)
  return raw.slice(0, 10)
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})

