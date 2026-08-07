import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const inputFile =
  process.argv[2] || path.resolve('test-fixtures/shift-milk/source-workbook.xlsx')
const outputFile = process.argv[3] || inputFile

const renameMap = new Map([
  ['外部' + '报告月龄', '月龄'],
  ['外部' + '报告胎次', '胎次'],
  ['外部' + '报告产奶天数', '产奶天数'],
  ['外部' + '报告泌乳月', '泌乳月'],
  ['外部' + '报告胎次产量', '胎次产量'],
  ['外部' + '报告305天产奶量', '305天产奶量'],
  ['外部' + '报告平均日产奶', '平均日产奶']
])

function text(value) {
  return String(value ?? '').trim()
}

function normalizeRow(row) {
  const next = { ...row }
  for (const [legacy, canonical] of renameMap.entries()) {
    if (!(legacy in next)) continue
    if (!(canonical in next) || text(next[canonical]) === '') {
      next[canonical] = next[legacy]
    }
    delete next[legacy]
  }
  return next
}

function main() {
  if (!fs.existsSync(inputFile)) throw new Error(`文件不存在：${inputFile}`)
  fs.mkdirSync(path.dirname(outputFile), { recursive: true })

  const workbook = XLSX.readFile(inputFile, { cellDates: true })
  const output = XLSX.utils.book_new()
  const summary = []

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' })
    const beforeHeaders = Object.keys(rows[0] || {})
    const nextRows = rows.map(normalizeRow)
    const afterHeaders = Object.keys(nextRows[0] || {})
    XLSX.utils.book_append_sheet(output, XLSX.utils.json_to_sheet(nextRows), sheetName)
    summary.push({
      sheetName,
      rows: nextRows.length,
      renamed: beforeHeaders.filter((header) => renameMap.has(header)).length,
      headers: afterHeaders
    })
  }

  XLSX.writeFile(output, outputFile)
  console.log(JSON.stringify({ ok: true, inputFile, outputFile, summary }, null, 2))
}

main()
