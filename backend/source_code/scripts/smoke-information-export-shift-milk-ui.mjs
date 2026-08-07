import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import XLSX from 'xlsx'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve('ops/production/.env.prod'), override: true, quiet: true })

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:9191'
const userName = process.env.SMOKE_USER || process.env.ADMIN_USER || 'admin'
const password = process.env.SMOKE_PASSWORD || process.env.ADMIN_PASSWORD || ''
const version = process.env.SMOKE_STORAGE_VERSION || '3.0.1'
const browserPath =
  process.env.SMOKE_BROWSER_PATH ||
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
const outDir = path.resolve('artifacts/shift-milk-information-export-ui')
const reportPath = path.join(outDir, 'report.json')
const forbiddenUserHeaders = [
  '记录类型',
  '牛号集合',
  '牛只ID',
  '耳标号',
  '来源表',
  '来源记录ID',
  '来源记录ID集合',
  '统计口径',
  '当前胎次',
  '质量标记',
  '备注',
  '记录人'
]

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || Number(body?.code || 0) >= 400) {
    throw new Error(`${pathname} failed: HTTP ${response.status} ${JSON.stringify(body)}`)
  }
  return body?.data ?? body
}

async function loginSession() {
  const loginBody = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userName, password })
  })
  const token = loginBody?.token
  if (!token) throw new Error('login returned no token')
  const userInfo = await requestJson('/api/user/info', {
    headers: { Authorization: token }
  })
  return { token, refreshToken: loginBody?.refreshToken || '', userInfo }
}

function storageState(session) {
  const origin = new URL(baseUrl).origin
  return {
    cookies: [],
    origins: [
      {
        origin,
        localStorage: [
          {
            name: `sys-v${version}-user`,
            value: JSON.stringify({
              language: 'zh',
              isLogin: true,
              isLock: false,
              lockPassword: '',
              info: session.userInfo || {},
              searchHistory: [],
              accessToken: session.token,
              refreshToken: session.refreshToken || ''
            })
          },
          { name: 'sys-version', value: version },
          { name: 'sys-theme', value: 'light' }
        ]
      }
    ]
  }
}

function readWorkbookRows(filePath) {
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' })
}

function hasHeaders(rows, required) {
  const headers = Object.keys(rows[0] || {})
  return required.every((key) => headers.includes(key))
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim())
}

function text(value) {
  return String(value ?? '').trim()
}

function forbiddenHeaders(headers) {
  return forbiddenUserHeaders.filter((header) => headers.includes(header))
}

function duplicateHeaders(headers) {
  const counts = new Map()
  for (const header of headers) counts.set(header, (counts.get(header) || 0) + 1)
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([header, count]) => ({ header, count }))
}

function auditWorkbookConvergence(headers, rows) {
  const findings = []
  const forbiddenMilkUnitPattern = /(^|[^a-z])(?:l|liter|litre)(?:$|[^a-z])|升/i
  const timestampPattern = /\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}|(?:^|[^\d])\d{1,2}:\d{2}(?::\d{2})?(?:[^\d]|$)/
  const internalUnitPattern = /^(?:src-pen-|src-unit-|VALIMP_|unit-|pen-)/i
  const dateLikeHeader = /日期|时间|日$|^日|窗口|开始|结束|产犊|开产|停产|出生|采集|统计/
  const penLikeHeader = /圈舍|牛舍|栏舍|单元/
  const unitLikeHeader = /单位/

  for (const header of headers) {
    const headerText = text(header)
    if (/产奶|奶量|泌乳|单位|产量/.test(headerText) && forbiddenMilkUnitPattern.test(headerText)) {
      findings.push({ type: 'forbidden-milk-unit-header', header: headerText })
    }
  }

  rows.forEach((row, rowIndex) => {
    for (const header of headers) {
      const headerText = text(header)
      const valueText = text(row[header])
      if (!valueText) continue
      if (dateLikeHeader.test(headerText) && timestampPattern.test(valueText)) {
        findings.push({ type: 'time-not-date-only', row: rowIndex + 2, header: headerText, value: valueText })
      }
      if (penLikeHeader.test(headerText) && internalUnitPattern.test(valueText)) {
        findings.push({ type: 'internal-farm-unit-id', row: rowIndex + 2, header: headerText, value: valueText })
      }
      if (
        (unitLikeHeader.test(headerText) || /产奶|奶量|泌乳|产量/.test(headerText)) &&
        forbiddenMilkUnitPattern.test(valueText)
      ) {
        findings.push({ type: 'forbidden-milk-unit-value', row: rowIndex + 2, header: headerText, value: valueText })
      }
    }
  })

  return findings.slice(0, 50)
}

async function chooseStrategy(page, name) {
  const openedDrawer = page.locator('.information-config-drawer').first()
  if (await openedDrawer.isVisible().catch(() => false)) {
    const text = await openedDrawer.innerText({ timeout: 10000 })
    if (text.includes(name)) return
    await page.keyboard.press('Escape').catch(() => {})
    await openedDrawer.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  }
  const search = page.locator('.strategy-toolbar .el-input__inner').first()
  await search.waitFor({ state: 'visible', timeout: 10000 })
  await search.fill(name)
  await page.waitForTimeout(500)
  const card = page.locator('.information-strategy-card', { hasText: name }).first()
  await card.scrollIntoViewIfNeeded({ timeout: 10000 })
  await card.click({ timeout: 10000 })
  await page.locator('.information-config-drawer').waitFor({ state: 'visible', timeout: 10000 })
}

async function exportOpenStrategy(page, name, fileHint) {
  await chooseStrategy(page, name)
  await page.getByRole('button', { name: '生成预览' }).click()
  await page.waitForFunction(
    () => /已生成\s*\d+\s*行预览数据/.test(document.body.innerText || '') || /总计\s*[1-9]\d*\s*行/.test(document.body.innerText || ''),
    null,
    { timeout: 120000 }
  )
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 })
  await page.getByRole('button', { name: /^导出$/ }).click()
  const download = await downloadPromise
  const suggested = download.suggestedFilename()
  const target = path.join(outDir, `${fileHint}-${suggested}`)
  await download.saveAs(target)
  const rows = readWorkbookRows(target)
  await page.keyboard.press('Escape').catch(() => {})
  return { file: target, suggested, rows, rowCount: rows.length, headers: Object.keys(rows[0] || {}) }
}

async function exportTrait305(page) {
  await chooseStrategy(page, '305天产奶量')
  const drawer = page.locator('.information-config-drawer')
  const text = await drawer.innerText({ timeout: 10000 })
  if (!text.includes('305天') || !text.includes('产奶量')) {
    throw new Error('305 strategy drawer did not expose expected labels')
  }
  await page.getByRole('button', { name: '生成预览' }).click()
  await page.waitForFunction(
    () => /已生成\s*\d+\s*行预览数据/.test(document.body.innerText || '') || /总计\s*[1-9]\d*\s*行/.test(document.body.innerText || ''),
    null,
    { timeout: 120000 }
  )
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 })
  await page.getByRole('button', { name: /^导出$/ }).click()
  const download = await downloadPromise
  const target = path.join(outDir, `305-${download.suggestedFilename()}`)
  await download.saveAs(target)
  const rows = readWorkbookRows(target)
  await page.keyboard.press('Escape').catch(() => {})
  return { file: target, suggested: download.suggestedFilename(), rows, rowCount: rows.length, headers: Object.keys(rows[0] || {}) }
}

async function main() {
  await fs.mkdir(outDir, { recursive: true })
  if (!fsSync.existsSync(browserPath)) throw new Error(`browser not found: ${browserPath}`)
  const session = await loginSession()
  const browser = await chromium.launch({ executablePath: browserPath, headless: true })
  const context = await browser.newContext({
    storageState: storageState(session),
    viewport: { width: 1440, height: 980 },
    deviceScaleFactor: 1,
    acceptDownloads: true
  })
  const page = await context.newPage()
  const exports = []
  try {
    await page.goto(`${baseUrl}/#/data-and-devices/information-export?strategy=phenotype-lactation`, {
      waitUntil: 'networkidle',
      timeout: 60000
    })
    await page.screenshot({ path: path.join(outDir, '01-export-home.png'), fullPage: true })
    exports.push(await exportOpenStrategy(page, '表型与泌乳导出', 'raw'))
    await page.screenshot({ path: path.join(outDir, '02-after-raw-export.png'), fullPage: true })
    exports.push(await exportTrait305(page))
    await page.screenshot({ path: path.join(outDir, '03-after-305-export.png'), fullPage: true })
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  const raw = exports[0]
  const fact305 = exports[1]
  const rawRequired = [
    '牛号',
    '采集日期',
    '胎次',
    '本胎产犊时间',
    '泌乳天数',
    '班次',
    '记录来源',
    '单次产奶量'
  ]
  const factRequiredAny = [
    '305天窗口',
    '牛号',
    '胎次',
    '本胎产犊时间',
    'DIM范围',
    '记录次数',
    '305天产奶量'
  ]
  const rawMilkRows = raw.rows.filter((row) => Number(row['单次产奶量'] || 0) > 0)
  const fact305Rows = fact305.rows.filter((row) => Number(row['305天产奶量'] || 0) > 0)
  const rawForbidden = forbiddenHeaders(raw.headers)
  const factForbidden = forbiddenHeaders(fact305.headers)
  const rawDuplicates = duplicateHeaders(raw.headers)
  const factDuplicates = duplicateHeaders(fact305.headers)
  const rawConvergenceFindings = auditWorkbookConvergence(raw.headers, raw.rows)
  const factConvergenceFindings = auditWorkbookConvergence(fact305.headers, fact305.rows)
  const checks = [
    {
      name: 'raw_export_downloaded',
      ok: raw.rowCount > 0,
      details: { file: raw.file, rowCount: raw.rowCount, headers: raw.headers }
    },
    {
      name: 'raw_export_has_period_fields',
      ok: hasHeaders(raw.rows, rawRequired),
      details: { required: rawRequired, headers: raw.headers }
    },
    {
      name: 'raw_export_has_milk_rows_with_dim_and_shift',
      ok: rawMilkRows.some(
        (row) =>
          row['牛号'] &&
          row['采集日期'] &&
          row['胎次'] &&
          row['本胎产犊时间'] &&
          row['泌乳天数'] &&
          row['班次']
      ),
      details: { sample: rawMilkRows.slice(0, 3) }
    },
    {
      name: 'raw_export_milk_rows_have_parity_calving_date',
      ok: rawMilkRows.length > 0 && rawMilkRows.every((row) => String(row['本胎产犊时间'] || '').trim()),
      details: {
        milkRows: rawMilkRows.length,
        missingSamples: rawMilkRows
          .filter((row) => !String(row['本胎产犊时间'] || '').trim())
          .slice(0, 5)
      }
    },
    {
      name: 'fact305_export_downloaded',
      ok: fact305.rowCount > 0,
      details: { file: fact305.file, rowCount: fact305.rowCount, headers: fact305.headers }
    },
    {
      name: 'fact305_export_has_summary_fields',
      ok: factRequiredAny.every((header) => fact305.headers.includes(header)),
      details: { required: factRequiredAny, headers: fact305.headers }
    },
    {
      name: 'fact305_export_has_milk305_values_and_parity_dates',
      ok:
        fact305Rows.length > 0 &&
        fact305Rows.every(
          (row) =>
            String(row['牛号'] || '').trim() &&
            String(row['胎次'] || '').trim() &&
            String(row['本胎产犊时间'] || '').trim() &&
            Number(row['305天产奶量'] || 0) > 0
        ),
      details: {
        factRows: fact305Rows.length,
        sample: fact305Rows.slice(0, 3)
      }
    },
    {
      name: 'export_dates_are_day_precision',
      ok:
        rawMilkRows.every((row) => isDateOnly(row['采集日期']) && isDateOnly(row['本胎产犊时间'])) &&
        fact305Rows.every(
          (row) =>
            isDateOnly(row['开始日期']) &&
            isDateOnly(row['结束日期']) &&
            isDateOnly(row['本胎产犊时间'])
        ),
      details: {
        rawSample: rawMilkRows.slice(0, 2).map((row) => ({
          采集日期: row['采集日期'],
          本胎产犊时间: row['本胎产犊时间']
        })),
        fact305Sample: fact305Rows.slice(0, 2).map((row) => ({
          开始日期: row['开始日期'],
          结束日期: row['结束日期'],
          本胎产犊时间: row['本胎产犊时间']
        }))
      }
    },
    {
      name: 'export_headers_do_not_expose_forbidden_user_fields',
      ok: rawForbidden.length === 0 && factForbidden.length === 0,
      details: { forbiddenUserHeaders, rawForbidden, factForbidden }
    },
    {
      name: 'export_headers_are_not_duplicated',
      ok: rawDuplicates.length === 0 && factDuplicates.length === 0,
      details: { rawDuplicates, factDuplicates }
    },
    {
      name: 'export_values_use_date_only_chinese_units_and_user_facing_units',
      ok: rawConvergenceFindings.length === 0 && factConvergenceFindings.length === 0,
      details: { rawConvergenceFindings, factConvergenceFindings }
    }
  ]
  const report = {
    ok: checks.every((item) => item.ok),
    generatedAt: new Date().toISOString(),
    baseUrl,
    outDir,
    exports: exports.map((item) => ({ file: item.file, rowCount: item.rowCount, headers: item.headers })),
    checks
  }
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

main().catch(async (error) => {
  const report = { ok: false, generatedAt: new Date().toISOString(), error: error?.stack || error?.message || String(error) }
  await fs.mkdir(outDir, { recursive: true }).catch(() => {})
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {})
  console.error(error)
  process.exitCode = 1
})

