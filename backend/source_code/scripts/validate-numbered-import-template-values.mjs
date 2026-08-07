import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import {
  buildTemplateValueOptions,
  codebookFor,
  loadDbDictionaries,
  optionsFor,
  text,
  valueForNumber
} from './import-numbered-template-utils.mjs'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const packageDir = process.argv[2] || path.resolve('test-fixtures/shift-milk/three-table-numbered-package')
const files = {
  'animal-profile': path.join(packageDir, '01_个体建档入群_animal-profile_编号版.xlsx'),
  pedigree: path.join(packageDir, '02_系谱出生产犊_pedigree_编号版.xlsx'),
  'milk-measurement': path.join(packageDir, '03_泌乳奶厅测量_milk-measurement_编号版.xlsx')
}

function readSheetRows(file, sheetName) {
  const workbook = XLSX.readFile(file, { cellDates: true })
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
}

function normalizeDateCell(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  }
  return text(value)
}

async function main() {
  const { getImportTemplate } = await import(pathToFileURL(path.join(projectRoot, 'src/services/import-templates.ts')).href)
  const db = await loadDbDictionaries(projectRoot)
  const findings = []
  const rowCounts = {}
  const dictionaryCounts = {}
  const selectUsage = {}

  for (const [templateCode, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) {
      findings.push({ severity: 'high', code: 'FILE_MISSING', templateCode, file })
      continue
    }
    const template = getImportTemplate(templateCode)
    const codebook = codebookFor(buildTemplateValueOptions(template, db))
    const rows = readSheetRows(file, '数据填写')
    const dictionaryRows = readSheetRows(file, '字典值')
    rowCounts[templateCode] = rows.length
    dictionaryCounts[templateCode] = dictionaryRows.length

    const selectColumns = template.columns.filter((column) => column.type === 'select')
    selectUsage[templateCode] = Object.fromEntries(
      selectColumns.map((column) => [column.label, { options: optionsFor(codebook, column.targetField).length, used: 0 }])
    )

    for (const column of selectColumns) {
      const options = optionsFor(codebook, column.targetField)
      if (!options.length) {
        findings.push({
          severity: 'high',
          code: 'SELECT_FIELD_WITHOUT_OPTIONS',
          templateCode,
          field: column.label,
          targetField: column.targetField
        })
      }
      const sheetOptions = dictionaryRows.filter((row) => text(row['字段']) === column.label)
      const runtimeKeys = new Set(options.map((option) => `${option.number}::${option.value}`))
      const sheetKeys = new Set(sheetOptions.map((row) => `${text(row['填写编号'])}::${text(row['实际值'])}`))
      for (const key of runtimeKeys) {
        if (!sheetKeys.has(key)) {
          findings.push({
            severity: 'high',
            code: 'DICTIONARY_SHEET_RUNTIME_MISMATCH',
            templateCode,
            field: column.label,
            missing: key
          })
          break
        }
      }

      rows.forEach((row, index) => {
        const raw = normalizeDateCell(row[column.label])
        if (!raw) return
        selectUsage[templateCode][column.label].used += 1
        if (!/^\d+$/.test(raw)) {
          findings.push({
            severity: 'high',
            code: 'SELECT_VALUE_NOT_NUMERIC',
            templateCode,
            row: index + 2,
            field: column.label,
            value: raw
          })
          return
        }
        const actualValue = valueForNumber(codebook, column.targetField, raw)
        if (!actualValue) {
          findings.push({
            severity: 'high',
            code: 'SELECT_NUMBER_INVALID',
            templateCode,
            row: index + 2,
            field: column.label,
            value: raw
          })
        }
      })
    }
  }

  const result = {
    ok: findings.length === 0,
    packageDir,
    rowCounts,
    dictionaryCounts,
    selectUsage,
    findings: findings.slice(0, 80)
  }
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
