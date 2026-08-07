import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function fail(message) {
  console.error(`[period-fields] ${message}`)
  process.exitCode = 1
}

function assertContains(source, pattern, message) {
  const matched = pattern instanceof RegExp ? pattern.test(source) : source.includes(pattern)
  if (!matched) fail(message)
}

function assertNotContains(source, pattern, message) {
  const matched = pattern instanceof RegExp ? pattern.test(source) : source.includes(pattern)
  if (matched) fail(message)
}

function assertTemplateColumn(source, templateCode, columnKey) {
  const templateIndex = source.indexOf(`code: '${templateCode}'`)
  if (templateIndex < 0) {
    fail(`missing import template: ${templateCode}`)
    return
  }
  const nextTemplateMatch = /\btemplate\s*\(/g
  nextTemplateMatch.lastIndex = templateIndex + 1
  const nextTemplate = nextTemplateMatch.exec(source)
  const nextTemplateIndex = nextTemplate?.index ?? -1
  const block = source.slice(templateIndex, nextTemplateIndex < 0 ? source.length : nextTemplateIndex)
  const columnPattern = new RegExp(`\\bcolumn\\s*\\(\\s*['"]${columnKey}['"]`)
  if (!columnPattern.test(block)) {
    fail(`template ${templateCode} is missing column ${columnKey}`)
  }
}

const templates = read('src/services/import-templates.ts')
const adapter = read('src/services/import-adapter.ts')
const exportUtils = read('src/utils/export.ts')
const exportPage = read('src/views/data-export/information/index.vue')
const legacyPhenotypeExportPage = read('src/views/data-export/phenotype/index.vue')
const legacyCowInfoExportPage = read('src/views/data-export/cow-info/index.vue')
const legacyCowEventsExportPage = read('src/views/data-export/cow-events/index.vue')
const milkStatStrategySeed = read('scripts/seed-milk-stat-export-strategies.mjs')
const importPage = read('src/views/data-import/information/index.vue')
const importConfigPage = read('src/views/platform-management/import-configs/index.vue')

function assertNoVisibleExportField(source, fieldKey, label, pageName) {
  assertNotContains(
    source,
    new RegExp(`<ElCheckbox\\s+label=["']${fieldKey}["'][\\s\\S]*?>\\s*${label}\\s*</ElCheckbox>`),
    `${pageName} must not expose ${label} checkbox`
  )
  const fieldOptionsIndex = source.indexOf('const fieldOptions = [')
  if (fieldOptionsIndex >= 0) {
    const fieldOptionsEnd = source.indexOf(']\n', fieldOptionsIndex)
    const fieldOptionsBlock = source.slice(
      fieldOptionsIndex,
      fieldOptionsEnd > fieldOptionsIndex ? fieldOptionsEnd : source.length
    )
    assertNotContains(
      fieldOptionsBlock,
      new RegExp(`\\{\\s*key:\\s*['"]${fieldKey}['"],\\s*label:\\s*['"]${label}['"]`),
      `${pageName} must not expose ${label} field option`
    )
  }
}

assertContains(templates, 'section?: string', 'import template columns must keep section metadata')
assertContains(templates, 'function groupedTemplateColumns', 'template workbook must group fields by section')
assertContains(templates, 'groupedTemplateColumns(template.columns)', 'template workbook must render grouped field instructions')
assertContains(templates, 'sectionDescription(group.section)', 'template workbook must render section descriptions')

assertTemplateColumn(templates, 'milk-measurement', 'shift_name')
for (const code of ['trait-observation', 'animal-event']) {
  const blockStart = templates.indexOf(`code: '${code}'`)
  const nextTemplate = templates.indexOf('template({', blockStart + 1)
  const block = templates.slice(blockStart, nextTemplate < 0 ? templates.length : nextTemplate)
  assertNotContains(block, "column('shift_name'", `template ${code} must not expose milk shift`)
}
assertTemplateColumn(templates, 'pedigree', 'parity_calving_date')
assertNotContains(templates, "code: 'milk-summary'", 'milk-summary import template must be absent')
for (const forbiddenColumn of [
  'age_months',
  'lactation_start_date',
  'lactation_end_date',
  'days_in_milk',
  'lactation_month',
  'parity_yield',
  'milk_yield_305',
  'avg_daily_milk',
  'session_code',
  'recorded_at',
  'source_type',
  'summary_source'
]) {
  assertNotContains(templates, `column('${forbiddenColumn}'`, `import templates must not expose ${forbiddenColumn}`)
}

assertContains(adapter, 'normalizeOptionalMilkShift', 'trait/event imports must preserve optional shift without forcing a milk default')
assertContains(adapter, 'explicitMilkShift', 'milk imports must use explicit shift from the milk template')
assertContains(adapter, /parityCalvingDate[\s\S]*parity_calving_date[\s\S]*calvingDate[\s\S]*calving_date/, 'imports must persist parity calving date aliases')
assertContains(adapter, /upsertLike\('trait_observation'[\s\S]*upsertLike\('phenotype-records'/, 'trait imports must write standard and legacy tables')
assertContains(adapter, /upsertLike\('milk_measurement'[\s\S]*upsertLike\('milk-records'/, 'milk imports must write standard and legacy tables')

assertContains(exportUtils, 'PERIOD_EXPORT_FIELD_SCHEMA', 'generic export utility must define unified period field schema')
assertContains(exportUtils, /key:\s*'milkingShift'[\s\S]*key:\s*'parityCalvingDate'[\s\S]*key:\s*'daysInMilk'/, 'unified period field schema must include shift, parity calving date, and DIM fields')
assertContains(exportUtils, 'PERIOD_EXPORT_FIELD_LABELS', 'generic export labels must be derived from unified period field schema')
assertContains(exportPage, 'function groupFieldDefinitions', 'information export must group field selectors')
assertContains(exportPage, 'PERIOD_EXPORT_FIELD_SCHEMA', 'information export must import unified period field schema')
assertContains(exportPage, 'userPeriodExportFieldKeys', 'information export production-period group must be schema-driven through user-visible period keys')
assertContains(exportPage, 'milkingShift', 'information export must expose shift fields')
assertContains(exportPage, 'parityCalvingDate', 'information export must expose parity calving date fields')
assertContains(exportPage, 'function parityCalvingDateOf', 'information export must normalize parity calving date aliases')
assertContains(exportPage, 'function explicitMilkingShiftValue', 'information export must read explicit shift aliases')
assertContains(exportPage, '这里选择牛号、日期、班次、胎次和本胎产犊时间等维度列', 'trait export drawer must explain dimension field selection')
assertContains(exportPage, '本胎产犊时间用于系统推导胎次与泌乳天数', 'period dimension group must explain parity calving date business meaning')
assertContains(exportPage, /keys:\s*\[[\s\S]*\.\.\.userPeriodExportFieldKeys/, 'production-period group must use unified user-visible period field keys')
assertContains(exportPage, /trait_observation[\s\S]*parityCalvingDate[\s\S]*explicitMilkingShiftValue/, 'standard trait rows must export parity calving date and shift')
assertContains(exportPage, /milk_measurement[\s\S]*parityCalvingDate[\s\S]*milkingShiftValue/, 'standard milk rows must export parity calving date and shift')
assertContains(exportPage, /phenotype-records[\s\S]*parityCalvingDate[\s\S]*explicitMilkingShiftValue/, 'legacy phenotype rows must export parity calving date and shift')
assertContains(exportPage, /milk-records[\s\S]*parityCalvingDate[\s\S]*milkingShiftValue/, 'legacy milk rows must export parity calving date and shift')

assertContains(legacyPhenotypeExportPage, 'const fieldGroups = computed', 'legacy phenotype export must group field selectors')
assertContains(legacyPhenotypeExportPage, '生产周期维度', 'legacy phenotype export must separate production period dimensions')
assertContains(legacyPhenotypeExportPage, "key: 'milkingShift'", 'legacy phenotype export must expose shift field')
assertContains(legacyPhenotypeExportPage, "key: 'parityCalvingDate'", 'legacy phenotype export must expose parity calving date field')
assertContains(legacyPhenotypeExportPage, 'function milkingShiftOf', 'legacy phenotype export must normalize shift aliases')
assertContains(legacyPhenotypeExportPage, 'function parityCalvingDateOf', 'legacy phenotype export must normalize parity calving date aliases')
assertContains(legacyPhenotypeExportPage, /trait_observation[\s\S]*milkingShift:\s*milkingShiftOf\(row\)[\s\S]*parityCalvingDate:\s*parityCalvingDateOf\(row\)/, 'legacy phenotype export standard trait rows must include shift and parity calving date')
assertContains(legacyPhenotypeExportPage, /milk_measurement[\s\S]*milkingShift:\s*milkingShiftOf\(row\)[\s\S]*parityCalvingDate:\s*parityCalvingDateOf\(row\)/, 'legacy phenotype export milk rows must include shift and parity calving date')

for (const [pageName, source] of [
  ['information export page', exportPage],
  ['legacy phenotype export page', legacyPhenotypeExportPage],
  ['legacy cow info export page', legacyCowInfoExportPage],
  ['legacy cow events export page', legacyCowEventsExportPage]
]) {
  for (const [fieldKey, label] of [
    ['recordType', '记录类型'],
    ['cowNumbers', '牛号集合'],
    ['cowId', '牛只ID'],
    ['animalId', '牛只ID'],
    ['earTagNumber', '耳标号'],
    ['cowName', '耳标号'],
    ['cowName', '耳标/名称'],
    ['currentParity', '当前胎次'],
    ['sourceTable', '来源表'],
    ['sourceRecordId', '来源记录ID'],
    ['sourceRecordIds', '来源记录ID集合'],
    ['sourceRecordIds', '记录编号'],
    ['aggregation', '统计口径'],
    ['aggregation', '聚合算法'],
    ['periodSource', '周期字段来源']
  ]) {
    assertNoVisibleExportField(source, fieldKey, label, pageName)
  }
}

for (const forbiddenSeedField of [
  'recordType',
  'cowNumbers',
  'cowId',
  'animalId',
  'earTagNumber',
  'currentParity',
  'sourceTable',
  'sourceRecordId',
  'sourceRecordIds',
  'aggregation'
]) {
  assertNotContains(
    milkStatStrategySeed,
    new RegExp(`['"]${forbiddenSeedField}['"]`),
    `leader milk export strategy seed must not persist hidden user field ${forbiddenSeedField}`
  )
}

for (const [name, source] of [
  ['information import page', importPage],
  ['import config page', importConfigPage]
]) {
  assertContains(source, 'function previewTemplateFieldGroups', `${name} must preview template field groups`)
  assertContains(source, '样本与组学', `${name} must include omics field group`)
  assertContains(source, '设备与传感器', `${name} must include device field group`)
  assertContains(source, '其他字段', `${name} must include fallback field group`)
  assertContains(source, 'max-height: 192px', `${name} field group preview must stay compact`)
  assertContains(source, 'overflow: auto', `${name} field group preview must scroll instead of truncating dimensions`)
  if (/\.slice\(0,\s*3\)/.test(source)) {
    fail(`${name} must not truncate template field groups to the first three dimensions`)
  }
}

if (!process.exitCode) {
  console.log('[period-fields] import templates, import persistence, and information export field grouping are aligned')
}
