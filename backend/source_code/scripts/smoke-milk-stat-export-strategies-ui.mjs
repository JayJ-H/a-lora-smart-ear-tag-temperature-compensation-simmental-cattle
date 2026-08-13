import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'
import XLSX from 'xlsx'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve('ops/production/.env.prod'), override: true, quiet: true })

const apiBaseUrl = process.env.SMOKE_API_BASE_URL || process.env.PRODUCTION_API_BASE_URL || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:9192'
let baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:9191'
const userName = process.env.SMOKE_USER || process.env.ADMIN_USER || 'admin'
const password = process.env.SMOKE_PASSWORD || process.env.ADMIN_PASSWORD || ''
const version = process.env.SMOKE_STORAGE_VERSION || '3.0.1'
const browserPath =
  process.env.SMOKE_BROWSER_PATH ||
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
const outDir = path.resolve('artifacts/milk-stat-export-strategies-ui')
const reportPath = path.join(outDir, 'report.json')
const removedStrategyPrefix = ['领导', '验收'].join('')
const forbiddenUserHeaders = [
  '记录类型',
  '牛号集合',
  '牛只ID',
  '耳标号',
  '耳标/名称',
  '当前胎次',
  '来源表',
  '来源记录ID',
  '来源记录ID集合',
  '统计口径'
]

const strategies = [
  {
    name: '自建-班次产奶明细',
    requiredHeaders: ['牛号', '采集日期', '胎次', '本胎产犊时间', '泌乳天数', '班次', '单次产奶量'],
    assert: assertShiftDetail
  },
  {
    name: '自建-日产奶量汇总',
    requiredHeaders: ['统计日期', '牛号', '胎次', '本胎产犊时间', '记录次数', '日产奶量'],
    assert: assertDailySummary
  },
  {
    name: '自建-缺失复核与补偿建议',
    requiredHeaders: ['牛号', '缺失日期', '胎次', '缺失班次', '缺失类型', '推荐补偿产奶量', '推荐方法', '复核状态'],
    assert: assertMissingReview
  },
  {
    name: '自建-牛只胎次周期指标',
    requiredHeaders: ['牛号', '品种', '性别', '出生日期', '胎次', '本胎产犊时间', '开产日期', '胎次产奶量', '305天产奶量', '平均日产奶'],
    assert: assertCowPeriodProfile
  },
  {
    name: '自建-305天产奶量',
    requiredHeaders: ['305天窗口', '牛号', '胎次', '本胎产犊时间', 'DIM范围', '305天产奶量'],
    assert: assert305Yield
  },
  {
    name: '自建-胎次产奶量归属',
    requiredHeaders: ['牛号', '胎次', '本胎产犊时间', '胎次产奶量'],
    assert: assertParityYield
  },
  {
    name: '自建-年度产奶带胎次',
    requiredHeaders: ['统计年份', '牛号', '胎次', '本胎产犊时间', '年度产奶量'],
    assert: assertYearWithParity
  },
  {
    name: '自建-平均日产奶量',
    requiredHeaders: ['牛号', '记录次数', '平均日产奶量'],
    assert: assertAverageDaily
  }
]

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const [key, inlineValue] = arg.slice(2).split('=', 2)
    const next = argv[i + 1]
    if (inlineValue !== undefined) args[key] = inlineValue
    else if (next && !next.startsWith('--')) {
      args[key] = next
      i += 1
    } else args[key] = true
  }
  return args
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  }
  return map[ext] || 'application/octet-stream'
}

function safeDistPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '')
  const resolved = path.resolve('dist', cleanPath || 'index.html')
  const distRoot = path.resolve('dist')
  return resolved.startsWith(distRoot) ? resolved : path.join(distRoot, 'index.html')
}

function startDistServer(preferredPort = 4195) {
  const distIndex = path.resolve('dist', 'index.html')
  if (!fsSync.existsSync(distIndex)) throw new Error('dist/index.html is missing. Run npm run build first.')
  const apiOrigin = new URL(apiBaseUrl)
  const server = http.createServer((req, res) => {
    const requestUrl = req.url || '/'
    if (requestUrl.startsWith('/api/')) {
      const proxyReq = http.request(
        {
          hostname: apiOrigin.hostname,
          port: apiOrigin.port || 80,
          path: requestUrl,
          method: req.method,
          headers: { ...req.headers, host: apiOrigin.host }
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
          proxyRes.pipe(res)
        }
      )
      proxyReq.on('error', (error) => {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ code: 502, message: error.message }))
      })
      req.pipe(proxyReq)
      return
    }

    const filePath = safeDistPath(requestUrl)
    const target = fsSync.existsSync(filePath) && fsSync.statSync(filePath).isFile() ? filePath : distIndex
    res.writeHead(200, {
      'content-type': contentTypeFor(target),
      'cache-control': 'no-store'
    })
    fsSync.createReadStream(target).pipe(res)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(preferredPort, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : preferredPort
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` })
    })
  })
}

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

function readWorkbookHeaders(filePath) {
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' })
  return (rows[0] || []).map((value) => String(value || '').trim()).filter(Boolean)
}

function hasHeaders(rows, required) {
  const headers = Object.keys(rows[0] || {})
  return required.every((key) => headers.includes(key))
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

function placeholderBreedRows(rows) {
  return rows
    .filter((row) => {
      const value = text(row['品种'])
      return /^(待补全|待补|未登记|未填|未知|无|none|null|undefined|-|--|n\/a)$/i.test(value)
    })
    .slice(0, 5)
}

function text(value) {
  return String(value ?? '').trim()
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function assertShiftDetail(rows) {
  return rows.some((row) => text(row['班次']) && num(row['单次产奶量']) !== null)
}

function assertDailySummary(rows) {
  return rows.some(
    (row) =>
      text(row['统计日期']) &&
      num(row['记录次数']) !== null &&
      num(row['记录次数']) >= 1 &&
      num(row['日产奶量']) !== null
  )
}

function assertMissingReview(rows) {
  if (!rows.length) return false
  return rows.every((row) => !['在群', '离群', '死亡'].includes(text(row['复核状态']))) &&
    rows.some((row) => text(row['缺失类型']) || text(row['推荐方法']) || text(row['复核状态']))
}

function assertCowPeriodProfile(rows) {
  return rows.some(
    (row) =>
      text(row['牛号']) &&
      (num(row['胎次产奶量']) !== null ||
        num(row['305天产奶量']) !== null ||
        num(row['平均日产奶']) !== null)
  )
}

function assert305Yield(rows) {
  return rows.some(
    (row) =>
      /305/.test(text(row['305天窗口'])) &&
      text(row['DIM范围']) &&
      num(row['305天产奶量']) !== null
  )
}

function assertParityYield(rows) {
  return rows.some(
    (row) =>
      num(row['胎次']) !== null &&
      num(row['胎次产奶量']) !== null
  )
}

function assertYearWithParity(rows) {
  return rows.some(
    (row) =>
      /^\d{4}/.test(text(row['统计年份'])) &&
      num(row['胎次']) !== null &&
      num(row['年度产奶量']) !== null
  )
}

function assertAverageDaily(rows) {
  return rows.some(
    (row) =>
      num(row['平均日产奶量']) !== null &&
      num(row['记录次数']) !== null
  )
}

async function chooseStrategy(page, name) {
  const openedDrawer = page.locator('.information-config-drawer').first()
  if (await openedDrawer.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {})
    await openedDrawer.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  }
  const scope = page.locator('.el-segmented__item', { hasText: '自建' }).first()
  await scope.click({ timeout: 10000 })
  const search = page.locator('.strategy-toolbar .el-input__inner').first()
  await search.waitFor({ state: 'visible', timeout: 10000 })
  await search.fill(name)
  await page.waitForTimeout(500)
  const card = page.locator('.information-strategy-card', { hasText: name }).first()
  await card.scrollIntoViewIfNeeded({ timeout: 10000 })
  await card.click({ timeout: 10000 })
  await page.locator('.information-config-drawer').waitFor({ state: 'visible', timeout: 10000 })
}

async function assertSelfBuiltStrategiesVisible(page) {
  const scope = page.locator('.el-segmented__item', { hasText: '自建' }).first()
  await scope.click({ timeout: 10000 })
  const search = page.locator('.strategy-toolbar .el-input__inner').first()
  await search.waitFor({ state: 'visible', timeout: 10000 })
  const visible = []
  const bodyText = text(await page.locator('body').textContent().catch(() => ''))
  if (bodyText.includes(removedStrategyPrefix)) {
    throw new Error('信息导出页面仍出现旧策略文案')
  }
  for (const strategy of strategies) {
    await search.fill(strategy.name)
    const card = page.locator('.information-strategy-card', { hasText: strategy.name }).first()
    await card.waitFor({ state: 'visible', timeout: 10000 })
    visible.push({
      name: strategy.name,
      text: text(await card.textContent().catch(() => ''))
    })
  }
  await search.fill('')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(outDir, '01-self-built-strategies-visible.png'), fullPage: true })
  return visible
}

async function previewAndExport(page, strategy) {
  await chooseStrategy(page, strategy.name)
  const drawer = page.locator('.information-config-drawer').first()
  const previousRowsText = await drawer.locator('.preview-panel .el-tag').first().textContent().catch(() => '')
  await drawer.getByRole('button', { name: '生成预览' }).click()
  await page.waitForFunction(
    (previous) => {
      const text = document.body.innerText || ''
      const match = text.match(/总计\s*([1-9]\d*)\s*行/)
      return Boolean(match && match[0] !== previous)
    },
    previousRowsText,
    { timeout: 120000 }
  )
  await page.waitForTimeout(300)
  const exportButton = drawer.getByRole('button', { name: /^导出$/ }).last()
  await exportButton.waitFor({ state: 'visible', timeout: 10000 })
  const buttonState = await exportButton.evaluate((button) => ({
    text: button.textContent,
    disabled:
      button.hasAttribute('disabled') ||
      button.getAttribute('aria-disabled') === 'true' ||
      button.classList.contains('is-disabled')
  }))
  if (buttonState.disabled) {
    throw new Error(`${strategy.name} export button disabled: ${JSON.stringify(buttonState)}`)
  }
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 })
  await exportButton.click({ timeout: 10000 })
  const download = await downloadPromise
  const safeName = strategy.name.replace(/[\\/:*?"<>|]/g, '_')
  const target = path.join(outDir, `${safeName}-${download.suggestedFilename()}`)
  await download.saveAs(target)
  const rows = readWorkbookRows(target)
  const headers = readWorkbookHeaders(target)
  const forbidden = forbiddenHeaders(headers)
  const duplicates = duplicateHeaders(headers)
  const convergenceFindings = auditWorkbookConvergence(headers, rows)
  const placeholderBreeds = headers.includes('品种') ? placeholderBreedRows(rows) : []
  await page.keyboard.press('Escape').catch(() => {})
  return {
    name: strategy.name,
    file: target,
    rowCount: rows.length,
    headers,
    duplicateHeaders: duplicates,
    forbiddenHeaders: forbidden,
    convergenceFindings,
    placeholderBreedRows: placeholderBreeds,
    requiredHeaders: strategy.requiredHeaders,
    ok:
      rows.length > 0 &&
      forbidden.length === 0 &&
      duplicates.length === 0 &&
      convergenceFindings.length === 0 &&
      placeholderBreeds.length === 0 &&
      hasHeaders(rows, strategy.requiredHeaders) &&
      (!strategy.assert || strategy.assert(rows)),
    sample: rows.slice(0, 2)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const distServer = args.dist ? await startDistServer(Number(args.port || 4195)) : null
  if (distServer) baseUrl = distServer.baseUrl
  const selectedStrategies = args.strategy
    ? strategies.filter((strategy) => strategy.name.includes(String(args.strategy)))
    : strategies
  if (!selectedStrategies.length) throw new Error(`No strategy matched: ${args.strategy}`)
  await fs.mkdir(outDir, { recursive: true })
  if (!fsSync.existsSync(browserPath)) throw new Error(`browser not found: ${browserPath}`)
  let browser
  let context
  try {
    const session = await loginSession()
    browser = await chromium.launch({ executablePath: browserPath, headless: true })
    context = await browser.newContext({
      storageState: storageState(session),
      viewport: { width: 1440, height: 980 },
      deviceScaleFactor: 1,
      acceptDownloads: true
    })
    const page = await context.newPage()
    const exports = []
    let visibleStrategies = []
    await page.goto(`${baseUrl}/#/data-and-devices/information-export`, {
      waitUntil: 'networkidle',
      timeout: 60000
    })
    await page.screenshot({ path: path.join(outDir, '01-self-built-strategies.png'), fullPage: true })
    visibleStrategies = await assertSelfBuiltStrategiesVisible(page)
    for (const strategy of selectedStrategies) {
      exports.push(await previewAndExport(page, strategy))
    }
    await page.screenshot({ path: path.join(outDir, '02-after-export-all.png'), fullPage: true })

    const report = {
      ok: exports.every((item) => item.ok),
      generatedAt: new Date().toISOString(),
      baseUrl,
      apiBaseUrl,
      outDir,
      visibleStrategies,
      exports
    }
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(report, null, 2))
    if (!report.ok) process.exitCode = 1
  } finally {
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
    if (distServer) await new Promise((resolve) => distServer.server.close(resolve))
  }
}

main().catch(async (error) => {
  const browserArtifacts = []
  const report = {
    ok: false,
    generatedAt: new Date().toISOString(),
    error: error?.stack || error?.message || String(error),
    browserArtifacts
  }
  await fs.mkdir(outDir, { recursive: true }).catch(() => {})
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {})
  console.error(error)
  process.exitCode = 1
})

