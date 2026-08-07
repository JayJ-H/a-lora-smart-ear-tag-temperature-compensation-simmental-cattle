import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const failures = []

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

function fail(message) {
  failures.push(message)
}

function assertIncludes(source, needle, message) {
  if (!source.includes(needle)) fail(message)
}

function assertNotIncludes(source, needle, message) {
  if (source.includes(needle)) fail(message)
}

function blockAfter(source, marker, nextMarkers = []) {
  const start = source.indexOf(marker)
  if (start < 0) return ''
  const candidates = nextMarkers
    .map((next) => source.indexOf(next, start + marker.length))
    .filter((index) => index > start)
  const end = candidates.length ? Math.min(...candidates) : source.length
  return source.slice(start, end)
}

function assertRouteVisible(routerSource, routeName, titleKey) {
  const block = blockAfter(routerSource, `name: '${routeName}'`, ["\n    {\n      path:", '\n  ]'])
  if (!block) {
    fail(`route ${routeName} must exist`)
    return
  }
  assertIncludes(block, `title: '${titleKey}'`, `route ${routeName} must use ${titleKey}`)
  assertNotIncludes(block, 'isHide: true', `route ${routeName} must be visible in the production menu`)
}

function assertRouteHiddenRedirect(routerSource, routeName, redirectTarget) {
  const block = blockAfter(routerSource, `name: '${routeName}'`, ["\n    {\n      path:", '\n  ]'])
  if (!block) {
    fail(`legacy route ${routeName} must exist`)
    return
  }
  assertIncludes(block, `redirect: '${redirectTarget}'`, `legacy route ${routeName} must redirect to the unified page`)
  assertIncludes(block, 'isHide: true', `legacy route ${routeName} must stay hidden from the production menu`)
}

const router = read('src/router/modules/cow.ts')
assertRouteVisible(router, 'InformationImport', 'menus.dataDevice.informationImport')
assertRouteVisible(router, 'InformationExport', 'menus.dataDevice.informationExport')
assertRouteVisible(router, 'LactationMissingReview', 'menus.germplasmResources.lactationMissingReview')
assertRouteHiddenRedirect(
  router,
  'CowInfoExport',
  '/data-and-devices/information-export?strategy=animal-profile'
)
assertRouteHiddenRedirect(
  router,
  'CowEventsExport',
  '/data-and-devices/information-export?strategy=animal-events'
)
assertRouteHiddenRedirect(
  router,
  'PhenotypeDataExport',
  '/data-and-devices/information-export?strategy=phenotype-lactation'
)
const flexibleBlock = blockAfter(router, "name: 'FlexibleAnalysis'", ["\n    {\n      path:", '\n  ]'])
assertIncludes(flexibleBlock, 'isHide: true', 'flexible analysis must stay hidden from the production menu')

const informationExport = read('src/views/data-export/information/index.vue')
assertIncludes(
  informationExport,
  'useLazyRenderWindow(fullPreviewRows',
  'information export preview must use lazy table rendering'
)
assertIncludes(informationExport, 'initialCount: 10', 'information export preview must initially render 10 rows')
assertIncludes(informationExport, 'batchSize: 10', 'information export preview must load rows in batches of 10')
assertIncludes(informationExport, 'preview-table-shell', 'information export preview must use a scroll container')
assertIncludes(informationExport, 'overflow: auto;', 'information export preview scroll container must support overflow')
assertIncludes(informationExport, '.information-strategy-card:hover', 'information export cards must keep hover feedback')
assertIncludes(informationExport, 'transform: translate3d(0, -3px, 0);', 'information export cards must lift on hover')
assertIncludes(informationExport, '生产周期维度', 'information export must keep production-period field grouping')
assertIncludes(
  informationExport,
  '这里选择牛号、日期、班次、胎次和本胎产犊时间等维度列',
  'information export trait drawer must explain dimension fields by production meaning'
)
assertIncludes(
  informationExport,
  '本胎产犊时间用于系统推导胎次与泌乳天数',
  'information export period group must explain parity calving date'
)
assertIncludes(informationExport, 'milkingShift', 'information export must expose milking shift')
assertIncludes(informationExport, 'parityCalvingDate', 'information export must expose parity calving date')

const informationImport = read('src/views/data-import/information/index.vue')
assertIncludes(
  informationImport,
  'template.columns.length',
  'information import template cards must show all template columns'
)
assertNotIncludes(
  informationImport,
  'template.columns.slice(0, 3)',
  'information import template cards must not hide fields by slicing to 3 columns'
)
assertIncludes(informationImport, 'max-height: 192px;', 'information import template fields must stay scrollable')
assertIncludes(informationImport, 'overflow: auto;', 'information import template fields must support overflow')
assertIncludes(
  informationImport,
  'visibleRecentSingleRecords',
  'single-entry pages must show recent successful records'
)
assertIncludes(
  informationImport,
  'recentSingleRenderCount.value += RECENT_SINGLE_ENTRY_PAGE_SIZE',
  'recent successful records must load progressively'
)
assertIncludes(
  informationImport,
  'useLazyRenderWindow(previewSourceRows',
  'information import preview table must use lazy rendering'
)
assertIncludes(
  informationImport,
  'useLazyRenderWindow(errorRows',
  'information import error rows must use lazy rendering'
)

const cowQuery = read('src/views/cow-info/query/index.vue')
assertNotIncludes(
  cowQuery,
  "'成年母牛'",
  'cow query default type filters must use production-stage vocabulary instead of static adult labels'
)

const cowCardPages = [
  ['src/views/germplasm/lactation-review/index.vue', 'reviewCowCards', '.review-cow-card:hover'],
  ['src/views/germplasm/phenotype/index.vue', 'filteredCowRows', 'cow-card'],
  ['src/views/cow-info/query/index.vue', 'cowList', 'rowCount: 2'],
  ['src/views/cow-info/filter/index.vue', 'filteredCowList', '.cow-card:hover'],
  ['src/views/germplasm/pedigree/index.vue', 'filteredRows', '.cow-card:hover'],
  ['src/views/reproduction-tracking/index.vue', 'filteredCowCards', 'rowCount: 2'],
  ['src/views/statistics/healthy/index.vue', 'healthyCows', 'hover:-translate-y-1'],
  ['src/views/statistics/abnormal/index.vue', 'abnormalCows', 'hover:-translate-y-1'],
  ['src/views/statistics/heat/index.vue', 'heatCows', 'hover:-translate-y-1'],
  ['src/views/statistics/pregnant/index.vue', 'pregnantCows', 'hover:-translate-y-1'],
  ['src/views/statistics/mixed/index.vue', 'mixedCows', 'hover:-translate-y-1'],
  ['src/views/statistics/left/index.vue', 'leftCows', 'hover:-translate-y-1'],
  ['src/views/statistics/data-analysis/index.vue', 'linkedCowCards', 'rowCount: 2'],
  ['src/views/germplasm/evaluation/index.vue', 'phenotypeRanks', '.rank-card:hover'],
  ['src/views/intelligent-breeding/bull-candidates/index.vue', 'rankedRows', '.candidate-card:hover'],
  ['src/views/intelligent-breeding/female-candidates/index.vue', 'rankedRows', '.candidate-card:hover'],
  ['src/views/intelligent-breeding/mating-plan/index.vue', 'rankedPairs', '.pair-card:hover']
]

for (const [relativePath, listName, hoverNeedle] of cowCardPages) {
  const source = read(relativePath)
  assertIncludes(source, `useLazyGridRenderWindow(${listName}`, `${relativePath} must lazy-render card grids`)
  assertIncludes(source, 'rowCount: 2', `${relativePath} must render only two card rows initially`)
  assertIncludes(source, hoverNeedle, `${relativePath} must keep card hover feedback`)
}

const lazyGridAllowList = new Set([
  'src/views/automation-engine/index.vue',
  'src/views/cow-info/query/index.vue',
  'src/views/cow-info/filter/index.vue',
  'src/views/data-import/information/index.vue',
  'src/views/数据库/index.vue',
  'src/views/feed-management/index.vue',
  'src/views/hardware-integration/index.vue',
  'src/views/platform-management/custom-fields/index.vue',
  'src/views/platform-management/import-configs/index.vue',
  'src/views/predictive-analytics/index.vue',
  'src/views/statistics/data-analysis/index.vue',
  'src/views/statistics/abnormal/index.vue',
  'src/views/statistics/pregnant/index.vue',
  'src/views/statistics/mixed/index.vue',
  'src/views/statistics/left/index.vue',
  'src/views/statistics/heat/index.vue',
  'src/views/statistics/healthy/index.vue',
  'src/views/reproduction-tracking/index.vue',
  'src/views/intelligent-breeding/bull-candidates/index.vue',
  'src/views/intelligent-breeding/female-candidates/index.vue',
  'src/views/intelligent-breeding/mating-plan/index.vue',
  'src/views/germplasm/evaluation/index.vue',
  'src/views/germplasm/pedigree/index.vue',
  'src/views/germplasm/phenotype/index.vue',
  'src/views/germplasm/lactation-review/index.vue'
])

function listVueFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(dir, entry.name).replace(/\\/g, '/')
    if (entry.isDirectory()) return listVueFiles(relativePath)
    return entry.isFile() && entry.name.endsWith('.vue') ? [relativePath] : []
  })
}

function callSnippets(source, functionName, maxLength = 600) {
  const snippets = []
  const pattern = new RegExp(`${functionName}(?:<[^>]+>)?\\(`, 'g')
  let match
  while ((match = pattern.exec(source))) {
    snippets.push(source.slice(match.index, match.index + maxLength))
  }
  return snippets
}

for (const relativePath of listVueFiles('src/views')) {
  const source = read(relativePath)
  if (!source.includes('useLazyGridRenderWindow(')) continue
  if (!lazyGridAllowList.has(relativePath)) {
    fail(`${relativePath} uses card-grid lazy rendering but is not covered by the livestock UI contract`)
    continue
  }
  const calls = source.split('useLazyGridRenderWindow(').slice(1)
  calls.forEach((call, index) => {
    const snippet = call.slice(0, 500)
    assertIncludes(snippet, 'rowCount: 2', `${relativePath} lazy card grid #${index + 1} must render two rows initially`)
  })
}

for (const relativePath of listVueFiles('src/views')) {
  const source = read(relativePath)
  callSnippets(source, 'useLazyRenderWindow').forEach((snippet, index) => {
    assertIncludes(snippet, 'initialCount: 10', `${relativePath} lazy table/list window #${index + 1} must initially render 10 rows`)
    assertIncludes(snippet, 'batchSize: 10', `${relativePath} lazy table/list window #${index + 1} must load 10 rows per batch`)
  })
}

const tablePreviewPages = [
  ['src/views/germplasm/lactation-review/index.vue', 'filteredItems'],
  ['src/views/germplasm/phenotype/index.vue', 'filteredRecords'],
  ['src/views/cow-info/query/index.vue', 'cowEvents'],
  ['src/views/cow-info/filter/index.vue', 'cowEvents'],
  ['src/views/reproduction-tracking/index.vue', 'filteredRecords'],
  ['src/views/germplasm/evaluation/index.vue', 'weightedDetailRows'],
  ['src/views/germplasm/evaluation/index.vue', 'dmuImportedRows']
]

for (const [relativePath, listName] of tablePreviewPages) {
  const source = read(relativePath)
  const snippet = blockAfter(source, `useLazyRenderWindow(${listName}`, ['})'])
  assertIncludes(snippet, 'initialCount: 10', `${relativePath} must initially render 10 table rows for ${listName}`)
}

if (failures.length) {
  for (const failure of failures) console.error(`[livestock-ui] ${failure}`)
  process.exit(1)
}

console.log('[livestock-ui] production livestock UI contracts are aligned')
