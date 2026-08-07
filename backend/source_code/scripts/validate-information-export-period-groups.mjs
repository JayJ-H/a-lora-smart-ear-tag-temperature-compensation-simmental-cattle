import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

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
    await loadEnvFile(path.join(projectRoot, 'ops', 'production', '.env.prod')),
    process.env
  )
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
      const proxyReq = http.request({
        hostname: apiOrigin.hostname,
        port: apiOrigin.port || 80,
        path: requestUrl,
        method: req.method,
        headers: { ...req.headers, host: apiOrigin.host }
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
        proxyRes.pipe(res)
      })
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

async function findBrowserExecutable() {
  const candidates = [
    process.env.SMOKE_BROWSER_PATH,
    process.env.SCREENSHOT_BROWSER_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Keep looking.
    }
  }
  throw new Error('No Chromium-compatible browser found. Set SMOKE_BROWSER_PATH.')
}

const forbiddenDrawerLabels = [
  '记录类型',
  '牛号集合',
  '牛只ID',
  '耳标号',
  '耳标/名称',
  '当前胎次',
  '来源表',
  '来源记录ID',
  '来源记录ID集合',
  '统计口径',
  '周期字段来源'
]

async function readFieldSections(page) {
  await page.locator('.information-config-drawer').evaluate((drawer) => {
    Array.from(drawer.querySelectorAll('.field-check-section.is-collapsed .field-section-head'))
      .forEach((button) => button instanceof HTMLElement && button.click())
  })
  await page.waitForTimeout(200)
  return page.locator('.information-config-drawer .field-check-section').evaluateAll(
    (sections, forbiddenLabels) =>
      sections.map((section) => {
      const title = section.querySelector('.field-section-head strong')?.textContent?.trim() || ''
      const labels = Array.from(section.querySelectorAll('.el-checkbox__label'))
        .map((node) => node.textContent?.trim() || '')
        .filter(Boolean)
      const counts = labels.reduce((result, label) => {
        result[label] = (result[label] || 0) + 1
        return result
      }, {})
      const duplicates = Object.entries(counts)
        .filter(([, count]) => count > 1)
        .map(([label, count]) => ({ label, count }))
      const forbidden = labels.filter((label) => forbiddenLabels.includes(label))
      return { title, labels, duplicates, forbidden }
    }),
    forbiddenDrawerLabels
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = await loadEnv()
  const apiBaseUrl = normalizeBaseUrl(args.api || env.SMOKE_API_BASE_URL || env.PRODUCTION_API_BASE_URL || 'http://127.0.0.1:9192')
  const distServer = await startDistServer(apiBaseUrl, Number(args.port || 4194))
  const version = String(args.version || env.VITE_VERSION || '3.0.1')
  const userName = String(args.user || env.SMOKE_USER || env.ADMIN_USER || 'admin')
  const password = String(args.password || env.SMOKE_PASSWORD || env.ADMIN_PASSWORD || '')
  const outPath = path.resolve(projectRoot, args.out || path.join('artifacts', 'information-export-period-groups.json'))
  if (!password) throw new Error('Missing password. Set SMOKE_PASSWORD or ADMIN_PASSWORD.')

  const session = await login(distServer.baseUrl, userName, password)
  const browser = await chromium.launch({
    executablePath: await findBrowserExecutable(),
    headless: !args.headed,
    args: ['--disable-gpu', '--no-sandbox']
  })

  let report
  try {
    const context = await browser.newContext({
      storageState: storageState(distServer.baseUrl, version, session),
      viewport: { width: 1440, height: 980 },
      deviceScaleFactor: 1
    })
    const page = await context.newPage()
    await page.goto(`${distServer.baseUrl}/#/data-and-devices/information-export?strategy=phenotype-lactation`, {
      waitUntil: 'networkidle',
      timeout: 45000
    })
    await page.waitForTimeout(1000)
    if (!await page.locator('.information-config-drawer').isVisible().catch(() => false)) {
      const phenotypeCard = page.locator('.information-strategy-card', { hasText: '表型与泌乳导出' }).first()
      await phenotypeCard.scrollIntoViewIfNeeded({ timeout: 10000 })
      await phenotypeCard.click({ timeout: 10000 })
    }
    await page.locator('.information-config-drawer').waitFor({ state: 'visible', timeout: 10000 })
    const drawerText = await page.locator('.information-config-drawer').innerText({ timeout: 10000 })
    const fieldSections = await readFieldSections(page)
    const duplicatedFieldLabels = fieldSections.flatMap((section) =>
      section.duplicates.map((item) => ({ section: section.title, ...item }))
    )
    const forbiddenFieldLabels = fieldSections.flatMap((section) =>
      section.forbidden.map((label) => ({ section: section.title, label }))
    )
    const productionPeriod = fieldSections.find((section) => section.title === '生产周期维度')
    const groupBySelect = page.locator('.information-config-drawer .el-select', { hasText: '原始记录' }).first()
    await groupBySelect.scrollIntoViewIfNeeded({ timeout: 10000 })
    await groupBySelect.click({ timeout: 10000 })
    await page.waitForTimeout(300)
    const bodyText = await page.locator('body').innerText({ timeout: 10000 })
    const checks = {
      drawerOpened: drawerText.includes('导出配置'),
      hasProductionPeriodGroup: drawerText.includes('生产周期维度'),
      hasParityCalvingDateField: drawerText.includes('本胎产犊时间'),
      hasShiftField: drawerText.includes('班次'),
      noDuplicateFieldLabels: duplicatedFieldLabels.length === 0,
      noForbiddenFieldLabels: forbiddenFieldLabels.length === 0,
      productionPeriodHasOneCalvingDate:
        (productionPeriod?.labels || []).filter((label) => label === '本胎产犊时间').length === 1,
      productionPeriodHasOneShift:
        (productionPeriod?.labels || []).filter((label) => label === '班次').length === 1,
      productionPeriodHasOneParity:
        (productionPeriod?.labels || []).filter((label) => label === '胎次').length === 1,
      hasParityLactationOptionGroup: bodyText.includes('胎次与泌乳'),
      hasCollectionOptionGroup: bodyText.includes('采集与操作'),
      hasParityCalvingDateOption: bodyText.includes('按本胎产犊时间'),
      hasShiftOption: bodyText.includes('按班次')
    }
    report = {
      ok: Object.values(checks).every(Boolean),
      generatedAt: new Date().toISOString(),
      baseUrl: distServer.baseUrl,
      checks,
      fieldSections,
      duplicatedFieldLabels,
      forbiddenFieldLabels,
      drawerPreview: drawerText.replace(/\s+/g, ' ').trim().slice(0, 500),
      textPreview: bodyText.replace(/\s+/g, ' ').trim().slice(0, 500)
    }
    await context.close()
  } finally {
    await browser.close()
    await new Promise((resolve) => distServer.server.close(resolve))
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(`[information-export-period-groups] ${error.message || String(error)}`)
  process.exitCode = 1
})

