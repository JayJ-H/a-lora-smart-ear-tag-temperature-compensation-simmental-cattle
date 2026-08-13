import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const BROWSER_CANDIDATES = [
  process.env.SMOKE_BROWSER_PATH,
  process.env.SCREENSHOT_BROWSER_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean)

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
    } else {
      args[key] = true
    }
  }
  return args
}

async function loadEnvFile(filePath) {
  const env = {}
  try {
    const text = await fs.readFile(filePath, 'utf8')
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#') || !line.includes('=')) continue
      const index = line.indexOf('=')
      env[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return env
}

async function loadEnv() {
  return Object.assign(
    {},
    await loadEnvFile(path.join(projectRoot, '.env')),
    await loadEnvFile(path.join(projectRoot, '.env.production')),
    await loadEnvFile(path.join(projectRoot, '运维', '生产配置', '.env.prod')),
    process.env
  )
}

async function findBrowserExecutable() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Keep looking.
    }
  }
  throw new Error('No Chromium-compatible browser found. Set SMOKE_BROWSER_PATH.')
}

function normalizeBaseUrl(value) {
  return String(value || 'http://127.0.0.1:9191').replace(/\/+$/, '')
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
  const resolved = path.resolve(projectRoot, 'dist', cleanPath || 'index.html')
  const distRoot = path.resolve(projectRoot, 'dist')
  return resolved.startsWith(distRoot) ? resolved : path.join(distRoot, 'index.html')
}

function startDistServer(apiBaseUrl, preferredPort) {
  const distIndex = path.join(projectRoot, 'dist', 'index.html')
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
    const target =
      fsSync.existsSync(filePath) && fsSync.statSync(filePath).isFile() ? filePath : distIndex
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

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || Number(body?.code || 0) >= 400) {
    throw new Error(`${options.method || 'GET'} ${pathname} failed: HTTP ${response.status} ${JSON.stringify(body)}`)
  }
  return body?.data ?? body
}

async function login(baseUrl, userName, password) {
  const loginBody = await requestJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userName, password })
  })
  const token = loginBody?.token
  if (!token) throw new Error('Login returned no token.')
  const userInfo = await requestJson(baseUrl, '/api/user/info', {
    headers: { Authorization: token }
  })
  return { token, refreshToken: loginBody?.refreshToken || '', userInfo }
}

function storageState(baseUrl, version, session) {
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

function hashUrl(baseUrl, routePath) {
  return `${baseUrl}/#${routePath}`
}

async function textOf(page) {
  return (await page.locator('body').innerText({ timeout: 10000 })).replace(/\s+/g, ' ').trim()
}

function parseMetricAfterLabel(text, label) {
  const index = text.indexOf(label)
  if (index < 0) return null
  const tail = text.slice(index + label.length, index + label.length + 40)
  const match = tail.match(/\d+/)
  return match ? Number(match[0]) : null
}

function parseFirstNumberAfter(text, label, span = 80) {
  const index = text.indexOf(label)
  if (index < 0) return null
  const tail = text.slice(index + label.length, index + label.length + span)
  const match = tail.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

async function readMetricTileNumber(page, label) {
  return page
    .evaluate((metricLabel) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
      const candidates = Array.from(document.querySelectorAll('.fc-metric-tile'))
      const tile = candidates.find((item) => {
        const label = normalize(item.querySelector('.fc-metric-top')?.textContent)
        return label.includes(metricLabel)
      })
      if (!tile) return null
      const text = normalize(tile.querySelector('.fc-metric-value')?.textContent)
      const match = text.match(/-?\d+(?:\.\d+)?/)
      return match ? Number(match[0]) : null
    }, label)
    .catch(() => null)
}

async function waitForText(page, predicate, timeout = 15000) {
  await page
    .waitForFunction(
      (predicateBody) => {
        const text = document.body?.innerText?.replace(/\s+/g, ' ').trim() || ''
        return Function('text', `return (${predicateBody})(text)`)(text)
      },
      String(predicate),
      { timeout }
    )
    .catch(() => undefined)
}

async function validateDashboardPage(context, baseUrl) {
  const page = await context.newPage()
  const rpcResponses = []
  page.on('response', async (response) => {
    if (!response.url().includes('/api/db/rpc')) return
    rpcResponses.push({ status: response.status(), url: response.url() })
  })
  try {
    await page.goto(hashUrl(baseUrl, '/dashboard'), { waitUntil: 'domcontentloaded', timeout: 45000 })
    await waitForText(page, (text) => /生产数据已接入|生产数据读取失败/.test(text), 15000)
    const text = await textOf(page)
    const herdTotal = parseFirstNumberAfter(text, '全群日产总量')
    const cowCount = parseFirstNumberAfter(text, '今日牛群状态')
    const sensorCount = parseFirstNumberAfter(text, '耳标与传感状态')
    return {
      ok:
        /生产数据已接入/.test(text) &&
        Number(herdTotal) > 0 &&
        Number(cowCount) >= 100 &&
        Number(sensorCount) >= 100,
      herdTotal,
      cowCount,
      sensorCount,
      dbRpcResponses: rpcResponses.length,
      textPreview: text.slice(0, 220)
    }
  } finally {
    await page.close()
  }
}

async function validatePhenotypePage(context, baseUrl) {
  const page = await context.newPage()
  try {
    await page.goto(hashUrl(baseUrl, '/germplasm-resources/phenotype-records'), {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    })
    await page
      .waitForFunction(
        () =>
          document.querySelectorAll('.cow-card').length > 0 &&
          document.querySelectorAll('.record-table-scroll .el-table__body-wrapper tbody tr')
            .length > 0,
        null,
        { timeout: 25000 }
      )
      .catch(() => undefined)
    const text = await textOf(page)
    const recordCount =
      (await readMetricTileNumber(page, '表型记录')) ?? parseFirstNumberAfter(text, '表型记录')
    const cowCount =
      (await readMetricTileNumber(page, '覆盖个体')) ?? parseFirstNumberAfter(text, '覆盖个体')
    const tableRows = await page.locator('.record-table-scroll .el-table__body-wrapper tbody tr').count()
    const cardCount = await page.locator('.cow-card').count()
    return {
      ok: Number(recordCount) > 0 && Number(cowCount) > 0 && tableRows > 0 && cardCount > 0,
      recordCount,
      cowCount,
      tableRows,
      cardCount,
      textPreview: text.slice(0, 220)
    }
  } finally {
    await page.close()
  }
}

async function validateReproductionPage(context, baseUrl) {
  const page = await context.newPage()
  try {
    await page.goto(hashUrl(baseUrl, '/germplasm-resources/breeding-records'), {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    })
    await waitForText(page, (text) => /繁殖与育种事件记录\s+[1-9]\d*\s+条/.test(text), 20000)
    const text = await textOf(page)
    const recordCount = parseFirstNumberAfter(text, '繁殖与育种事件记录')
    const cowCardCount = parseFirstNumberAfter(text, '单牛繁育档案')
    const tableRows = await page.locator('.reproduction-table .el-table__body-wrapper tbody tr').count()
    const visibleCards = await page.locator('.cow-repro-card').count()
    return {
      ok: Number(recordCount) > 0 && Number(cowCardCount) > 0 && tableRows > 0 && visibleCards > 0,
      recordCount,
      cowCardCount,
      tableRows,
      visibleCards,
      textPreview: text.slice(0, 220)
    }
  } finally {
    await page.close()
  }
}

async function validateAlertPage(context, baseUrl) {
  const page = await context.newPage()
  try {
    await page.goto(hashUrl(baseUrl, '/生产配置/smart-alert'), {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    })
    await waitForText(page, (text) => /预警命中\s+[1-9]\d*|健康异常\s+[1-9]\d*|耳标\/RFID\s+[1-9]\d*/.test(text), 20000)
    const text = await textOf(page)
    const hitCount = parseFirstNumberAfter(text, '预警命中')
    const healthCount = parseFirstNumberAfter(text, '健康异常')
    const breedingCount = parseFirstNumberAfter(text, '发情/预产')
    const rfidCount = parseFirstNumberAfter(text, '耳标/RFID')
    const cardCount = await page.locator('.cow-worklist .cow-card').count()
    return {
      ok:
        Number(hitCount) > 0 &&
        (Number(healthCount) > 0 || Number(breedingCount) > 0 || Number(rfidCount) > 0) &&
        cardCount > 0,
      hitCount,
      healthCount,
      breedingCount,
      rfidCount,
      cardCount,
      textPreview: text.slice(0, 220)
    }
  } finally {
    await page.close()
  }
}

async function validateArchivePage(context, baseUrl) {
  const page = await context.newPage()
  const responseCounts = {}
  page.on('response', (response) => {
    const url = response.url()
    if (url.includes('/api/db/rpc')) responseCounts.dbRpc = (responseCounts.dbRpc || 0) + 1
  })
  try {
    await page.goto(hashUrl(baseUrl, '/germplasm-resources/individual-profile'), {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    })
    await page.waitForTimeout(1800)
    const earlyText = await textOf(page)
    const earlyCount = parseMetricAfterLabel(earlyText, '档案总数')
    await page
      .waitForFunction(
        () => {
          const text = document.body?.innerText?.replace(/\s+/g, ' ').trim() || ''
          return /泌乳覆盖\s+[1-9]\d*%|实时覆盖\s+[1-9]\d*%/.test(text)
        },
        null,
        { timeout: 15000 }
      )
      .catch(() => undefined)
    const lateText = await textOf(page)
    const lateCount = parseMetricAfterLabel(lateText, '档案总数')
    const milkCoverage = parseFirstNumberAfter(lateText, '泌乳覆盖')
    const sensorCoverage = parseFirstNumberAfter(lateText, '实时覆盖')
    const rowCount = await page.locator('.archive-table .el-table__body-wrapper tbody tr').count()
    return {
      ok:
        Number(earlyCount) > 0 &&
        Number(lateCount) > 0 &&
        Number(milkCoverage) > 0 &&
        Number(sensorCoverage) > 0 &&
        rowCount > 0,
      earlyCount,
      lateCount,
      milkCoverage,
      sensorCoverage,
      rowCount,
      dbRpcResponses: responseCounts.dbRpc || 0,
      textPreview: lateText.slice(0, 220)
    }
  } finally {
    await page.close()
  }
}

async function validateLactationReviewPage(context, baseUrl) {
  const page = await context.newPage()
  try {
    await page.goto(hashUrl(baseUrl, '/germplasm-resources/lactation-missing-review'), {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    })
    await page
      .waitForFunction(
        () =>
          document.querySelectorAll('.review-cow-card').length > 0 ||
          /当前范围没有返回缺失记录|当前筛选没有待复核牛卡/.test(document.body.innerText),
        null,
        { timeout: 20000 }
      )
      .catch(() => undefined)
    const cardCount = await page.locator('.review-cow-card').count()
    if (cardCount > 0) {
      await page.locator('.review-cow-card').first().click({ timeout: 5000 })
      await page
        .waitForFunction(
          () =>
            document.querySelectorAll('.missing-review-block').length > 0 ||
            /请选择牛卡|当前牛号/.test(document.body.innerText),
          null,
          { timeout: 8000 }
        )
        .catch(() => undefined)
    }
    const blockCount = await page.locator('.missing-review-block').count()
    const summaryOnlyCount = await page.locator('.summary-split-note').count()
    const text = await textOf(page)
    return {
      ok: cardCount > 0 && blockCount > 0,
      cardCount,
      blockCount,
      summaryOnlyCount,
      textPreview: text.slice(0, 220)
    }
  } finally {
    await page.close()
  }
}

async function validateInformationEntryPage(context, baseUrl) {
  const page = await context.newPage()
  try {
    await page.goto(hashUrl(baseUrl, '/information-entry/entry'), {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    })
    await page.waitForTimeout(2500)
    const recentPanel = await page.locator('.recent-entry-panel').count()
    const recentRows = await page.locator('.recent-entry-item').count()
    const batchTabs = await page.locator('.el-tabs__item').filter({ hasText: '批量' }).count()
    const text = await textOf(page)
    return {
      ok: recentPanel > 0 && batchTabs === 0,
      recentPanel,
      recentRows,
      batchTabs,
      textPreview: text.slice(0, 220)
    }
  } finally {
    await page.close()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = await loadEnv()
  const apiBaseUrl = normalizeBaseUrl(args.api || args['api-url'] || env.SMOKE_API_BASE_URL || env.PRODUCTION_API_BASE_URL || 'http://127.0.0.1:9192')
  const distServer = args['serve-dist']
    ? await startDistServer(apiBaseUrl, Number(args.port || 4173))
    : null
  const baseUrl = distServer?.baseUrl || normalizeBaseUrl(args.url || apiBaseUrl)
  const version = String(args.version || env.VITE_VERSION || '3.0.1')
  const userName = String(args.user || env.SMOKE_USER || env.ADMIN_USER || 'admin')
  const password = String(args.password || env.SMOKE_PASSWORD || env.ADMIN_PASSWORD || '')
  const outPath = path.resolve(projectRoot, args.out || path.join('artifacts', 'livestock-production-pages.json'))
  if (!password) throw new Error('Missing password. Set SMOKE_PASSWORD or ADMIN_PASSWORD.')

  const browserPath = await findBrowserExecutable()
  const session = await login(baseUrl, userName, password)
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: !args.headed,
    args: ['--disable-gpu', '--no-sandbox']
  })
  let report
  try {
    const context = await browser.newContext({
      storageState: storageState(baseUrl, version, session),
      viewport: { width: 1440, height: 980 },
      deviceScaleFactor: 1
    })
    const checks = {
      dashboard: await validateDashboardPage(context, baseUrl),
      archive: await validateArchivePage(context, baseUrl),
      phenotype: await validatePhenotypePage(context, baseUrl),
      lactationReview: await validateLactationReviewPage(context, baseUrl),
      reproduction: await validateReproductionPage(context, baseUrl),
      alert: await validateAlertPage(context, baseUrl),
      informationEntry: await validateInformationEntryPage(context, baseUrl)
    }
    await context.close()
    report = {
      ok: Object.values(checks).every((check) => check.ok),
      generatedAt: new Date().toISOString(),
      baseUrl,
      browserPath,
      checks
    }
  } finally {
    await browser.close()
    if (distServer) await new Promise((resolve) => distServer.server.close(resolve))
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

