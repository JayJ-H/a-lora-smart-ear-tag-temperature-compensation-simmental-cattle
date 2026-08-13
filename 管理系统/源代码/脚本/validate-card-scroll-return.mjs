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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/microsoft-edge'
].filter(Boolean)

const DEFAULT_ROUTES = [
  '/germplasm-resources/individual-query',
  '/germplasm-resources/individual-filter',
  '/germplasm-resources/phenotype-records',
  '/germplasm-resources/lactation-missing-review',
  '/germplasm-resources/pedigree-management',
  '/germplasm-resources/breeding-records',
  '/germplasm-resources/germplasm-evaluation',
  '/data-and-devices/information-import',
  '/platform-management/import-configs'
]

const SCROLL_CONTAINER_SELECTOR = [
  '.cow-card-lazy-scroll',
  '.cow-card-scroll',
  '.review-cow-card-viewport',
  '.template-grid-scroll',
  '.lazy-list-scroll',
  '.record-list',
  '.config-table-shell',
  '.table-lazy-scroll',
  '.lazy-table-scroll'
].join(',')

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
      // Continue.
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

function startDistServer(apiBaseUrl, preferredPort = 4173) {
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

function routeUrl(baseUrl, routePath) {
  return `${baseUrl}/#${routePath.startsWith('/') ? routePath : `/${routePath}`}`
}

async function waitForPageReady(page) {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(
    () => {
      const text = document.body?.innerText || ''
      return text.trim().length > 20 && !/欢迎回来|请输入用户名|请输入密码/.test(text)
    },
    undefined,
    { timeout: 15000 }
  )
  await page.waitForTimeout(650)
}

async function validateRouteScroll(page, baseUrl, routePath) {
  await page.goto(routeUrl(baseUrl, routePath), {
    waitUntil: 'domcontentloaded',
    timeout: 12000
  })
  await waitForPageReady(page)
  return page.evaluate(async (selector) => {
    const containers = Array.from(document.querySelectorAll(selector))
      .filter((element) => element instanceof HTMLElement)
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => element.scrollHeight > element.clientHeight + 4)
      .slice(0, 8)
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const results = []
    for (const { element, index } of containers) {
      const firstChild =
        element.querySelector(
          '.cow-query-card, .cow-card, .review-cow-card, .record-card, .template-card, .art-card, .el-table__row'
        ) || element.firstElementChild
      const before = {
        scrollTop: element.scrollTop,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight
      }
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
      await sleep(120)
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: 900, bubbles: true }))
      await sleep(120)
      for (let attempt = 0; attempt < 30; attempt += 1) {
        element.scrollTop = 0
        element.dispatchEvent(new Event('scroll', { bubbles: true }))
        await sleep(80)
        element.dispatchEvent(new WheelEvent('wheel', { deltaY: -900, bubbles: true }))
        await sleep(80)
        if (element.scrollTop <= 1) break
      }
      element.scrollTop = 0
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
      await sleep(120)
      const containerRect = element.getBoundingClientRect()
      const childRect = firstChild?.getBoundingClientRect()
      const finalScrollTop = element.scrollTop
      const clippedTop =
        childRect && childRect.height > 0 ? childRect.top < containerRect.top - 2 : false
      const isTableContainer = element.matches('.table-lazy-scroll, .lazy-table-scroll')
      const allowedTopGap = isTableContainer ? 72 : 32
      const hasTopGap =
        childRect && childRect.height > 0
          ? childRect.top - containerRect.top > allowedTopGap
          : false
      results.push({
        index,
        className: element.className,
        before,
        finalScrollTop,
        firstChildTop: childRect ? Math.round(childRect.top) : null,
        containerTop: Math.round(containerRect.top),
        clippedTop,
        hasTopGap,
        ok: finalScrollTop <= 1 && !clippedTop && !hasTopGap
      })
    }
    return results
  }, SCROLL_CONTAINER_SELECTOR)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = await loadEnv()
  const apiBaseUrl = normalizeBaseUrl(
    args.api || args['api-url'] || env.SMOKE_API_BASE_URL || env.PRODUCTION_API_BASE_URL || 'http://127.0.0.1:9192'
  )
  const distServer = args['serve-dist']
    ? await startDistServer(apiBaseUrl, Number(args.port || 4173))
    : null
  const baseUrl = distServer?.baseUrl || normalizeBaseUrl(args.url || apiBaseUrl)
  const version = String(args.version || env.VITE_VERSION || '3.0.1')
  const userName = String(args.user || env.SMOKE_USER || env.ADMIN_USER || 'admin')
  const password = String(args.password || env.SMOKE_PASSWORD || env.ADMIN_PASSWORD || '')
  const outPath = path.resolve(projectRoot, args.out || path.join('artifacts', 'card-scroll-return.json'))
  const routes = String(args.routes || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const routeList = routes.length ? routes : DEFAULT_ROUTES
  if (!password) throw new Error('Missing password. Set SMOKE_PASSWORD or ADMIN_PASSWORD.')

  const browserPath = await findBrowserExecutable()
  const session = await login(baseUrl, userName, password)
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: !args.headed,
    args: ['--disable-gpu', '--no-sandbox']
  })
  const report = {
    ok: false,
    generatedAt: new Date().toISOString(),
    baseUrl,
    browserPath,
    routes: []
  }
  try {
    const context = await browser.newContext({
      storageState: storageState(baseUrl, version, session),
      viewport: { width: Number(args.width || 1920), height: Number(args.height || 1080) },
      deviceScaleFactor: 1
    })
    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    for (const routePath of routeList) {
      const routeResult = { routePath, ok: false, containers: [], error: '' }
      try {
        routeResult.containers = await validateRouteScroll(page, baseUrl, routePath)
        routeResult.ok =
          routeResult.containers.length === 0 ||
          routeResult.containers.every((container) => container.ok)
      } catch (error) {
        routeResult.error = error?.message || String(error)
      }
      report.routes.push(routeResult)
    }
    await context.close()
  } finally {
    await browser.close()
    if (distServer) await new Promise((resolve) => distServer.server.close(resolve))
  }
  report.ok = report.routes.every((route) => route.ok)
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

