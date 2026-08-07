import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const checks = []
const add = (ok, code, message) => checks.push({ ok, code, message })

const router = read('src/router/modules/cow.ts')
const routeIndex = read('src/router/modules/index.ts')
const service = read('src/services/database.ts')
const backend = read('脚本/mysql-backend-server.mjs')
const autocomplete = read('src/components/business/cow/CowNumberAutocomplete.vue')
const pagePath = path.join(root, 'src/views/data-edit/information/index.vue')
const page = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : ''

add(router.includes("path: '/information-edit'"), 'ROUTE_ROOT', 'information-edit root route exists')
for (const child of ['生产配置', 'reproduction', 'health', 'movement', 'sampling', 'device', 'research', 'pedigree']) {
  add(router.includes(`path: '${child}'`) && router.includes(`/information-edit/${child}`), `ROUTE_${child.toUpperCase()}`, `${child} edit route exists`)
}
add(routeIndex.includes('informationEditRoutes'), 'ROUTE_INDEX', 'informationEditRoutes is registered')
add(fs.existsSync(pagePath), 'PAGE_EXISTS', 'information edit page exists')
add(page.includes('CowNumberAutocomplete'), 'PAGE_COW_SEARCH', 'page uses shared cow autocomplete')
add(page.includes('useLazyRenderWindow'), 'PAGE_LAZY_WINDOW', 'page uses lazy render window')
add(page.includes('updateCowEvent('), 'PAGE_EVENT_SAVE', 'page calls event update service')
add(page.includes('updateCowPedigree('), 'PAGE_PEDIGREE_SAVE', 'page calls pedigree update service')
for (const fn of ['getEditableCowEvents', 'updateCowEvent', 'getEditablePedigree', 'updateCowPedigree']) {
  add(service.includes(`export async function ${fn}`), `SERVICE_${fn}`, `${fn} exported`)
}
add(service.includes('export async function searchCowSuggestions'), 'SERVICE_COW_SEARCH', 'shared cow search service exported')
add(service.includes("'searchCowSuggestions'") && service.includes("'getEditableCowEvents'") && service.includes("'getEditablePedigree'"), 'SERVICE_BACKEND_FIRST', 'edit/search services call backend RPC before local fallback')
add(service.includes('editableCowRefPayload') && service.indexOf("dbRpc<EditableCowEvent[]>") < service.indexOf('const cowRef = await resolveEditableCowRef(cowRefInput)', service.indexOf('export async function getEditableCowEvents')), 'SERVICE_NO_PREFETCH_RESOLVE', 'backend edit queries avoid full-table cow resolve before RPC')
add(service.includes('getTableRecordByIdAsync') && service.includes('getEditableCowEventPair'), 'SERVICE_UPDATE_RECORD_BY_ID', 'event save reads target records by id instead of full event tables')
add(backend.includes("case 'searchCowSuggestions'") && backend.includes("case 'getEditableCowEvents'") && backend.includes("case 'getEditablePedigree'"), 'BACKEND_RPC_ROUTES', 'backend exposes pushed-down edit/search RPC')
add(backend.includes("case 'getTableRecordById'"), 'BACKEND_RECORD_BY_ID', 'backend exposes single record read RPC')
add(backend.includes('queryEditableEventTable') && backend.includes('resolveEditableCowRefRpc'), 'BACKEND_PUSHED_DOWN_QUERY', 'backend filters cow event/pedigree queries by cow reference')
add(!autocomplete.includes('onMounted(loadCows)') && autocomplete.includes('searchCowSuggestions'), 'AUTOCOMPLETE_REMOTE_LIMITED', 'cow autocomplete uses limited remote search instead of mount-time full load')
add(service.includes("upsertTableDataAsync('cow-events'") || service.includes("updateTableRecordAsync('cow-events'"), 'SERVICE_LEGACY_EVENT', 'event edit syncs cow-events mirror')
add(service.includes("writeCowEventDetailTables(nextAnimal"), 'SERVICE_DETAIL_SYNC', 'event edit rewrites detail tables')
add(service.includes("upsertTableDataAsync('derivation_recompute_job'"), 'SERVICE_RECOMPUTE', 'event edit schedules recompute job')
add(service.includes("addTableDataAsync('operation_audit_log'") && service.includes("addTableDataAsync('operation-audit-logs'"), 'SERVICE_AUDIT', 'edit audit writes canonical and legacy tables')
add(service.includes("upsertTableDataAsync('animal_parentage'"), 'SERVICE_PEDIGREE', 'pedigree edit writes animal_parentage')

const failed = checks.filter((item) => !item.ok)
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.code} ${item.message}`)
}

if (failed.length) {
  console.error(`information edit closure failed: ${failed.length}`)
  process.exit(1)
}

console.log(`information edit closure passed: ${checks.length}`)
