import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const packageDir =
  process.env.TWO_TABLE_TEMPLATE_IMPORT_PACKAGE_DIR ||
  path.resolve('test-fixtures/shift-milk/two-table-template-package')
const files = {
  'animal-profile': path.join(packageDir, '01_个体档案_animal-profile_系统模板.xlsx'),
  'milk-measurement': path.join(packageDir, '02_泌乳奶厅测量_milk-measurement_系统模板.xlsx')
}
const forbiddenTerms = [
  '牛只ID',
  '耳号',
  '月龄',
  '本胎产犊时间',
  '开产时间',
  '停产日期',
  '产奶天数',
  '胎次产量',
  '泌乳月',
  '305天产奶量',
  '平均日产奶',
  '挤奶批次编号',
  '记录人',
  '备注',
  '数据来源',
  '汇总来源',
  'reported_',
  'milk-summary',
  '泌乳汇总',
  'DIM',
  '305天',
  '305 天',
  '采集人',
  '户主'
]

function readRows(file, sheetName = '数据填写') {
  const workbook = XLSX.readFile(file, { cellDates: true })
  const sheet = workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[0]]
  return {
    workbook,
    rows: XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  }
}

function scanWorkbook(file) {
  const workbook = XLSX.readFile(file, { cellDates: true })
  const findings = []
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' })
    rows.forEach((row, rowIndex) => {
      ;(row || []).forEach((cell, columnIndex) => {
        const value = String(cell ?? '')
        const lowerValue = value.toLowerCase()
        for (const term of forbiddenTerms) {
          if (lowerValue.includes(String(term).toLowerCase())) {
            findings.push({
              file,
              sheet: sheetName,
              row: rowIndex + 1,
              column: columnIndex + 1,
              term,
              value
            })
          }
        }
      })
    })
  }
  return findings
}

async function main() {
  const { getImportTemplate } = await import(
    pathToFileURL(path.join(projectRoot, 'src/services/import-templates.ts')).href
  )
  const checks = []
  const findings = []

  for (const [code, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) {
      checks.push({ name: `${code} 文件存在`, ok: false, file })
      continue
    }
    const template = getImportTemplate(code)
    const expectedHeaders = template.columns.map((column) => column.label)
    const { rows } = readRows(file)
    const actualHeaders = (rows[0] || []).map((value) => String(value ?? '').trim())
    checks.push({
      name: `${code} 数据填写列头等于系统模板`,
      ok: JSON.stringify(actualHeaders) === JSON.stringify(expectedHeaders),
      actualHeaders,
      expectedHeaders
    })
    const dataRows = Math.max(0, rows.length - 1)
    checks.push({ name: `${code} 有数据行`, ok: dataRows > 0, dataRows })
    findings.push(...scanWorkbook(file))
  }

  checks.push({ name: '两张导表无禁止字段残留', ok: findings.length === 0, findings: findings.slice(0, 20) })
  const ok = checks.every((check) => check.ok)
  console.log(JSON.stringify({ ok, packageDir, files, checks, forbiddenFindingCount: findings.length }, null, 2))
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
