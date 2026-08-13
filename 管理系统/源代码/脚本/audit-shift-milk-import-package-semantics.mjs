import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const packageDir = process.argv[2] || path.resolve('test-fixtures/shift-milk/system-import-package')

const files = {
  profile: path.join(packageDir, '01_个体档案_animal-profile_先导入.xlsx'),
  pedigree: path.join(packageDir, '02_系谱关系_pedigree_可选.xlsx'),
  milk: path.join(packageDir, '03_泌乳奶厅测量_milk-measurement.xlsx'),
  dictionary: path.join(packageDir, '09_平台管理字典补全_参考.xlsx'),
  mapping: path.join(packageDir, '00_字段承接决策表.xlsx'),
  importConfig: path.join(packageDir, '11_平台管理导入映射规则_建议.xlsx')
}

const legacyFiles = [
  '02_系谱缺失说明_源表无父母号_不导入.xlsx',
  '04_泌乳汇总_milk-summary.xlsx',
  '05_入群圈舍定位_animal-event.xlsx',
  '06_繁殖产犊事件_reproduction-event_可选.xlsx',
  '07_表型观测_trait-observation_可选.xlsx',
  '10_繁殖状态快照_可选.xlsx'
].map((name) => path.join(packageDir, name))

const forbiddenDataHeaders = new Set([
  '牛只ID',
  '耳号',
  '月龄',
  '胎次',
  '本胎产犊时间',
  '开产时间',
  '停产日期',
  '产奶天数',
  '胎次产量',
  '泌乳月',
  '305天产奶量',
  '平均日产奶',
  '挤奶批次编号',
  '数据来源',
  '汇总来源',
  '记录人',
  '备注'
])

function text(value) {
  return String(value ?? '').trim()
}

function readRows(file, preferredSheet = '数据填写') {
  const workbook = XLSX.readFile(file, { cellDates: true })
  const sheetName = workbook.SheetNames.includes(preferredSheet) ? preferredSheet : workbook.SheetNames[0]
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' })
}

function headers(rows) {
  return Object.keys(rows[0] || {})
}

function includesAll(list, expected) {
  return expected.filter((item) => !list.includes(item))
}

function auditWorkbookCells(issues, file) {
  const workbook = XLSX.readFile(file, { cellDates: true })
  const forbidden = [/外部报告/, /reported_/i, /reported[A-Z]/, /milk-summary/, /泌乳汇总/]
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    for (const [cell, item] of Object.entries(sheet)) {
      if (cell.startsWith('!')) continue
      const value = text(item?.v)
      if (!value) continue
      if (forbidden.some((pattern) => pattern.test(value))) {
        issues.push({
          severity: 'high',
          file,
          message: `导入包泄漏旧派生口径：${sheetName}!${cell}=${value}`
        })
      }
    }
  }
}

function auditDataHeaders(issues, id, file, expectedHeaders) {
  const rows = readRows(file)
  const actual = headers(rows)
  for (const header of actual) {
    if (forbiddenDataHeaders.has(header)) {
      issues.push({ severity: 'high', file, message: `${id} 数据填写表不应出现字段：${header}` })
    }
  }
  const missing = includesAll(actual, expectedHeaders)
  if (missing.length) {
    issues.push({ severity: 'high', file, message: `${id} 缺少必要字段：${missing.join(', ')}` })
  }
  if (id !== 'milk' && actual.includes('当前圈舍单元')) {
    issues.push({ severity: 'high', file, message: `${id} 不能出现无业务日期锚点的当前圈舍单元` })
  }
}

function main() {
  const issues = []

  for (const [id, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) {
      issues.push({ severity: 'high', file, message: `导入包缺少文件：${id}` })
    }
  }

  for (const file of legacyFiles) {
    if (fs.existsSync(file)) {
      issues.push({ severity: 'high', file, message: '旧派生/重复导入文件仍然存在，应由生成脚本清理' })
    }
  }

  if (!issues.some((item) => item.message.includes('缺少文件'))) {
    auditDataHeaders(issues, 'profile', files.profile, ['牛号', '生产阶段', '状态'])
    auditDataHeaders(issues, 'pedigree', files.pedigree, ['牛号', '父号', '母号', '产犊日期', '犊牛号', '产犊结果'])
    auditDataHeaders(issues, 'milk', files.milk, [
      '牛号',
      '班次名称',
      '挤奶日期',
      '当前圈舍单元',
      '产奶量',
      '操作人'
    ])

    const milkHeaders = headers(readRows(files.milk))
    if (milkHeaders.includes('当前圈舍单元') && !milkHeaders.includes('挤奶日期')) {
      issues.push({
        severity: 'high',
        file: files.milk,
        message: '奶厅当前圈舍单元必须和挤奶日期一起出现，不能成为无日期快照'
      })
    }

    const importConfigRows = readRows(files.importConfig, '平台导入配置')
    for (const row of importConfigRows) {
      const label = text(row['外部列名'])
      const target = text(row['系统字段'])
      if (forbiddenDataHeaders.has(label) || ['operator_name', 'notes', 'source_type', 'summary_source'].includes(target)) {
        issues.push({
          severity: 'high',
          file: files.importConfig,
          message: `平台导入配置建议不应暴露字段：${label || target}`
        })
      }
    }
    const requiredConfig = [
      ['animal-profile', '牛号', 'animal_number'],
      ['pedigree', '产犊日期', 'parity_calving_date'],
      ['milk-measurement', '当前圈舍单元', 'unit_id'],
      ['milk-measurement', '操作人', 'work_operator_name']
    ]
    for (const [templateCode, label, target] of requiredConfig) {
      const exists = importConfigRows.some(
        (row) =>
          text(row['绑定模板']) === templateCode &&
          text(row['外部列名']) === label &&
          text(row['系统字段']) === target
      )
      if (!exists) {
        issues.push({
          severity: 'high',
          file: files.importConfig,
          message: `平台导入配置缺少必要映射：${templateCode} ${label} -> ${target}`
        })
      }
    }

    for (const file of Object.values(files)) auditWorkbookCells(issues, file)
  }

  const result = {
    ok: !issues.some((issue) => issue.severity === 'high'),
    packageDir,
    high: issues.filter((issue) => issue.severity === 'high').length,
    issues
  }
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

main()
