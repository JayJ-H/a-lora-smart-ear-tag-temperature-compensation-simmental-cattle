import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function fail(message) {
  console.error(`[export-field-convergence] ${message}`)
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

const genericExport = read('src/utils/export.ts')
const informationExport = read('src/views/data-export/information/index.vue')
const milkStatSeed = read('scripts/seed-milk-stat-export-strategies.mjs')
const smoke = read('scripts/smoke-milk-stat-export-strategies-ui.mjs')

assertContains(
  genericExport,
  'isDefaultUserExportColumn',
  'generic table export must filter default user-visible columns'
)
for (const key of [
  'sourceRecordIds',
  'source_record_ids',
  'currentParity',
  'earTagNumber',
  'recordType',
  'qualityFlag'
]) {
  assertContains(
    genericExport,
    key,
    `generic table export hidden-column guard must cover ${key}`
  )
}
assertContains(
  genericExport,
  /requestedColumns[\s\S]*filter\(isDefaultUserExportColumn\)/,
  'generic table export must filter explicit and implicit columns before writing files'
)
assertContains(
  genericExport,
  /Object\.keys\(flat\)[\s\S]*filter\(isDefaultUserExportColumn\)/,
  'generic table export column discovery must hide internal fields'
)

assertContains(
  informationExport,
  /hiddenUserExportFieldKeys[\s\S]*'sourceRecordIds'[\s\S]*'aggregation'/,
  'information export must hide source tracing and aggregation technical fields'
)
assertContains(
  informationExport,
  /function normalizeExportFieldKeys[\s\S]*seen\.has\(key\)/,
  'information export must de-duplicate selected field keys'
)

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
    milkStatSeed,
    new RegExp(`['"]${forbiddenSeedField}['"]`),
    `leader milk strategy seed must not persist hidden field ${forbiddenSeedField}`
  )
}

assertContains(smoke, 'duplicateHeaders', 'milk strategy smoke must report duplicate Excel headers')
assertContains(
  smoke,
  /duplicates\.length === 0/,
  'milk strategy smoke must fail when Excel headers repeat'
)

if (!process.exitCode) console.log('[export-field-convergence] user export fields are converged')
