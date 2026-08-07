import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import ts from 'typescript'

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

const SAFE_CLICK_SELECTORS = [
  '.review-cow-card',
  '.cow-card',
  '.cow-repro-card',
  '.rank-card',
  '.breeding-card',
  '.quality-card',
  '.candidate-card',
  '.pair-card',
  '.analysis-module-card',
  '.result-card',
  '.workflow-result-card',
  '.device-card',
  '.table-card',
  '.focus-card',
  '.queue-item',
  '.dashboard-widget',
  '.overview-card',
  '.chart-card',
  '.strategy-card',
  '.information-strategy-card',
  '[role="button"]:not(button)'
]

const UNSAFE_TEXT =
  /(提交|保存|删除|确认|取消|导出|下载|生成|运行|发送|控制|执行|新增|创建|重置|清空|解绑|换绑|刷新|查询|登录|退出)/
const CARD_CLICK_SELECTORS = new Set([
  '.review-cow-card',
  '.cow-card',
  '.cow-repro-card',
  '.rank-card',
  '.breeding-card',
  '.quality-card',
  '.candidate-card',
  '.pair-card',
  '.analysis-module-card',
  '.result-card',
  '.workflow-result-card',
  '.device-card',
  '.table-card',
  '.focus-card',
  '.queue-item',
  '.dashboard-widget',
  '.overview-card',
  '.chart-card',
  '.strategy-card',
  '.information-strategy-card'
])
const LEGACY_PRODUCT_NAME = '\u6c34\u725b\u80b2\u79cd\u5e73\u53f0'
const AUTH_REQUIRED_STATUS = 'SKIP_AUTH_REQUIRED'
const AUTH_REQUIRED_PROBLEMS = new Set(['redirected-to-login', 'login-form-visible'])
const DEFAULT_TOTAL_TIMEOUT_MS = 170000
const DEFAULT_ROUTE_TIMEOUT_MS = 10000
const DEFAULT_NAVIGATION_TIMEOUT_MS = 7000
const DEFAULT_ACTION_TIMEOUT_MS = 2500
const DEFAULT_ROUTE_READY_TIMEOUT_MS = 12000
const DEFAULT_CONCURRENCY = 4
const DEFAULT_REQUEST_TIMEOUT_MS = 10000
const DEFAULT_AUTH_FAILED_EXIT_CODE = 3
const DEFAULT_CONTEXT_MODE = 'isolated'
const DEFAULT_AUTH_RETRY_COUNT = 1
const BUSINESS_COW_SEARCH_ROUTE_PATTERNS = [
  /\/cow-info\/query$/,
  /\/cow-info\/filter$/,
  /\/germplasm-resources\/individual-profile$/,
  /\/germplasm-resources\/individual-query$/,
  /\/germplasm-resources\/individual-filter$/,
  /\/germplasm-resources\/pedigree-management$/,
  /\/germplasm-resources\/phenotype-records$/,
  /\/germplasm-resources\/lactation-missing-review$/,
  /\/cow-status\/healthy$/,
  /\/生产配置\/smart-alert$/,
  /\/information-entry\/(breeding|device|exit|health|production|reproduction|research|sampling|transfer|veterinary)$/,
  /\/event-entry\/(breeding|exit|transfer|veterinary)$/
]
const COW_CARD_ROUTE_PATTERNS = [
  /\/cow-info\/query$/,
  /\/cow-info\/filter$/,
  /\/germplasm-resources\/individual-query$/,
  /\/germplasm-resources\/individual-filter$/,
  /\/germplasm-resources\/pedigree-management$/,
  /\/germplasm-resources\/phenotype-records$/,
  /\/germplasm-resources\/lactation-missing-review$/,
  /\/germplasm-resources\/breeding-records$/,
  /\/germplasm-resources\/germplasm-evaluation$/,
  /\/生产配置\/reproduction-tracking$/,
  /\/生产配置\/smart-alert$/,
  /\/intelligent-breeding\/(candidate-bull-selection|candidate-cow-selection|mating-plan)$/
]
const DATA_TABLE_ROUTE_PATTERNS = [
  /\/data-and-devices\//,
  /\/data-device\//,
  /\/data-import\//,
  /\/data-export\//,
  /\/database$/,
  /\/platform-management\//,
  /\/base-info\//,
  /\/statistics\//,
  /\/operation\//,
  /\/生产配置\//,
  /\/germplasm-resources\//,
  /\/omics-analysis\//
]

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    const key = rawKey.trim()
    const next = argv[i + 1]
    if (inlineValue !== undefined) args[key] = inlineValue
    else if (next && !next.startsWith('--')) {
      args[key] = next
      i += 1
    } else args[key] = true
  }
  return args
}

async function readText(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), 'utf8')
}

async function loadEnvFile(filePath) {
  const env = {}
  try {
    const text = await fs.readFile(filePath, 'utf8')
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#') || !line.includes('=')) continue
      const index = line.indexOf('=')
      env[line.slice(0, index).trim()] = line
        .slice(index + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '')
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
  throw new Error(
    'No Chromium-compatible browser found. Set SMOKE_BROWSER_PATH or SCREENSHOT_BROWSER_PATH.'
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

function startDistServer(apiBaseUrl, preferredPort = 4173) {
  const distIndex = path.join(projectRoot, 'dist', 'index.html')
  if (!fsSync.existsSync(distIndex))
    throw new Error('dist/index.html is missing. Run npm run build first.')
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
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`
      })
    })
  })
}

function routeUrl(baseUrl, routePath) {
  return `${baseUrl}/#${routePath.startsWith('/') ? routePath : `/${routePath}`}`
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

async function requestJson(baseUrl, pathname, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS)
  const { timeoutMs: _timeoutMs, ...fetchOptions } = options
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(fetchOptions.headers || {})
      }
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${options.method || 'GET'} ${pathname} timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok || Number(body?.code || 0) >= 400) {
    throw new Error(
      `${options.method || 'GET'} ${pathname} failed: HTTP ${response.status} ${JSON.stringify(body)}`
    )
  }
  return body?.data ?? body
}

function syntheticSession(userName) {
  const safeUserName = String(userName || 'admin')
  return {
    token: `local-session-${safeUserName}-${Date.now()}`,
    refreshToken: `local-refresh-${safeUserName}-${Date.now()}`,
    userInfo: {
      userId: 2,
      userName: safeUserName,
      roles: ['R_ADMIN'],
      buttons: ['view', 'export'],
      avatar: ''
    },
    synthetic: true
  }
}

async function login(baseUrl, userName, password) {
  const loginBody = await requestJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userName, password }),
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS
  })
  const token = loginBody?.token
  if (!token) throw new Error('Login returned no token.')
  const userInfo = await requestJson(baseUrl, '/api/user/info', {
    headers: { Authorization: token },
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS
  })
  return { token, refreshToken: loginBody?.refreshToken || '', userInfo, synthetic: false }
}

async function collectVisibleRoutes(options = {}) {
  const files = ['src/router/modules/dashboard.ts', 'src/router/modules/cow.ts']
  const routes = []
  for (const relativePath of files) {
    const topLevelRoutes = parseRouteModule(await readText(relativePath), relativePath)
    topLevelRoutes.forEach((route) =>
      collectRouteLeafRoutes(route, '', relativePath, routes, options)
    )
  }
  return routes.sort((left, right) => left.path.localeCompare(right.path))
}

function parseRouteModule(source, relativePath) {
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true)
  const routes = []
  sourceFile.statements.forEach((statement) => {
    if (!ts.isVariableStatement(statement)) return
    statement.declarationList.declarations.forEach((declaration) => {
      if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) return
      const route = evalObjectLiteral(declaration.initializer)
      if (route?.path && route?.name) routes.push(route)
    })
  })
  return routes
}

function evalNode(node) {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(evalNode)
  if (ts.isObjectLiteralExpression(node)) return evalObjectLiteral(node)
  return undefined
}

function evalObjectLiteral(node) {
  const output = {}
  node.properties.forEach((property) => {
    if (!ts.isPropertyAssignment(property)) return
    const key = propertyName(property.name)
    if (!key) return
    output[key] = evalNode(property.initializer)
  })
  return output
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text
  return ''
}

function collectRouteLeafRoutes(route, parentPath, source, output, options = {}) {
  const fullPath = normalizeRoutePath(parentPath, String(route.path || ''))
  const children = Array.isArray(route.children) ? route.children : []
  const meta = route.meta && typeof route.meta === 'object' ? route.meta : {}
  const component = String(route.component || '')
  const hidden = meta.isHide === true
  const isLayout = component.includes('/index/index') || component.includes('/index/route-view')

  if (
    (!hidden || options.includeHidden) &&
    component &&
    !isLayout &&
    !fullPath.includes(':') &&
    !output.some((item) => item.path === fullPath)
  ) {
    output.push({
      name: String(route.name || fullPath),
      path: fullPath,
      source,
      hidden,
      alias: false
    })
  }

  if (
    options.includeAliases &&
    (!hidden || options.includeHidden) &&
    component &&
    !isLayout &&
    !fullPath.includes(':')
  ) {
    const aliases = Array.isArray(route.alias) ? route.alias : route.alias ? [route.alias] : []
    aliases
      .map((alias) => normalizeAliasPath(parentPath, String(alias || '')))
      .filter((aliasPath) => aliasPath && !aliasPath.includes(':'))
      .forEach((aliasPath) => {
        if (output.some((item) => item.path === aliasPath)) return
        output.push({
          name: `${String(route.name || fullPath)}Alias`,
          path: aliasPath,
          source,
          hidden,
          alias: true,
          aliasOf: fullPath
        })
      })
  }

  children.forEach((child) => collectRouteLeafRoutes(child, fullPath, source, output, options))
}

function normalizeRoutePath(parentPath, childPath) {
  if (childPath.startsWith('/')) return childPath
  const parent = parentPath.endsWith('/') ? parentPath.slice(0, -1) : parentPath
  return `${parent}/${childPath}`.replace(/\/+/g, '/')
}

function normalizeAliasPath(parentPath, aliasPath) {
  if (!aliasPath) return ''
  if (aliasPath.startsWith('/')) return aliasPath
  return normalizeRoutePath(parentPath, aliasPath)
}

async function safeClickCandidates(page) {
  const clicked = []
  const clickedBoxes = []
  for (const selector of SAFE_CLICK_SELECTORS) {
    const count = Math.min(
      await page
        .locator(selector)
        .count()
        .catch(() => 0),
      2
    )
    for (let i = 0; i < count; i += 1) {
      const target = page.locator(selector).nth(i)
      if (!(await target.isVisible().catch(() => false))) continue
      const text = ((await target.innerText({ timeout: 1000 }).catch(() => '')) || '')
        .replace(/\s+/g, ' ')
        .trim()
      const isCardContainer = CARD_CLICK_SELECTORS.has(selector)
      if (!text || (!isCardContainer && UNSAFE_TEXT.test(text))) continue
      try {
        await target.scrollIntoViewIfNeeded({ timeout: 3000 })
        const box = await target.boundingBox().catch(() => null)
        if (
          box &&
          clickedBoxes.some(
            (item) =>
              Math.abs(item.x - box.x) < 3 &&
              Math.abs(item.y - box.y) < 3 &&
              Math.abs(item.width - box.width) < 3 &&
              Math.abs(item.height - box.height) < 3
          )
        ) {
          continue
        }
        await target.click({ timeout: 3000 })
        if (box) clickedBoxes.push(box)
        await page.waitForTimeout(350)
        await page.keyboard.press('Escape').catch(() => {})
        await page.waitForTimeout(120)
        clicked.push({ selector, index: i, text: text.slice(0, 80) })
      } catch (error) {
        clicked.push({ selector, index: i, error: error.message })
        await page.keyboard.press('Escape').catch(() => {})
      }
    }
  }
  return clicked
}

function timeoutFailure(route, baseUrl, error, durationMs, stage = 'route') {
  return {
    ...route,
    url: routeUrl(baseUrl, route.path),
    ok: false,
    problems: [`${stage}-failed`],
    pageErrors: [],
    consoleErrors: [],
    clicked: [],
    textPreview: '',
    durationMs,
    error: error?.message || String(error)
  }
}

async function waitForRouteDomReady(page, routePath, aliasOf, timeoutMs) {
  await page.waitForFunction(
    ({ expectedRoutePath, canonicalRoutePath }) => {
      const app = document.querySelector('#app')
      const hashPath = window.location.hash.replace(/^#/, '').split(/[?#]/)[0]
      if (!app) return false
      return (
        hashPath === expectedRoutePath ||
        (canonicalRoutePath && hashPath === canonicalRoutePath) ||
        hashPath === '/auth/login'
      )
    },
    { expectedRoutePath: routePath, canonicalRoutePath: aliasOf || '' },
    { timeout: timeoutMs }
  )
}

async function waitForBodyText(page, timeoutMs) {
  await page
    .waitForFunction(
      () => Boolean(document.body?.innerText?.replace(/\s+/g, ' ').trim()),
      null,
      { timeout: timeoutMs }
    )
    .catch(() => undefined)
}

function failureSummary(result) {
  const reasons = [
    ...(result.problems || []),
    ...(result.uiProblems || []).map((item) => `ui:${item.code}:${item.detail || item.selector}`),
    ...(result.pageErrors || []).map((item) => `pageerror:${item}`),
    ...(result.consoleErrors || []).map((item) => `console:${item}`),
    result.error ? `error:${result.error}` : ''
  ].filter(Boolean)
  return reasons.join(' | ') || 'unknown'
}

function safeFileName(value) {
  return String(value || 'route')
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

function routeMatches(routePath, patterns) {
  return patterns.some((pattern) => pattern.test(routePath))
}

function collectBusinessExpectations(route, uiDiagnostics) {
  const problems = []
  const pathName = route.path || ''
  const counts = uiDiagnostics?.counts || {}
  const layout = uiDiagnostics?.layout || {}
  const add = (code, selector, detail, severity = 'layout') =>
    problems.push({ code, selector, detail, severity })

  if (
    routeMatches(pathName, BUSINESS_COW_SEARCH_ROUTE_PATTERNS) &&
    Number(counts.cowSearchInputs || 0) < 1
  ) {
    add('expected-cow-autocomplete-missing', '.cow-number-autocomplete', pathName, 'layout')
  }

  if (
    routeMatches(pathName, COW_CARD_ROUTE_PATTERNS) &&
    Number(counts.visibleCowCards || 0) > 8
  ) {
    add(
      'expected-two-row-cow-card-window-violated',
      '.cow-card',
      `${counts.visibleCowCards} visible cow cards`,
      'performance'
    )
  }

  if (
    routeMatches(pathName, DATA_TABLE_ROUTE_PATTERNS) &&
    Number(counts.visibleTableRows || 0) > 10
  ) {
    add(
      'expected-ten-row-table-window-violated',
      '.el-table',
      `${counts.visibleTableRows} visible table rows`,
      'performance'
    )
  }

  if (pathName === '/dashboard') {
    const columns = Number(layout.dashboardColumns || 0)
    const viewportWidth = Number(uiDiagnostics?.viewport?.width || 0)
    if (viewportWidth < 2160 && columns > 2) {
      add('dashboard-too-many-columns', '.chart-grid', `${columns} columns at ${viewportWidth}px`)
    }
    if (viewportWidth >= 1180 && viewportWidth < 2160 && columns !== 2) {
      add('dashboard-not-two-columns', '.chart-grid', `${columns} columns at ${viewportWidth}px`)
    }
    if (viewportWidth >= 2160 && columns > 3) {
      add('dashboard-too-many-wide-columns', '.chart-grid', `${columns} columns at ${viewportWidth}px`)
    }
  }

  return problems
}

async function collectUiDiagnostics(page) {
  return page
    .evaluate(() => {
      const textOf = (element) => (element.textContent || '').replace(/\s+/g, ' ').trim()
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 0
      const scrollWidth = Math.max(
        document.documentElement.scrollWidth || 0,
        document.body?.scrollWidth || 0
      )
      const bodyText = document.body?.innerText || ''
      const problems = []
      const add = (code, selector, detail, severity = 'layout') =>
        problems.push({ code, selector, detail, severity })

      const cardSelector = [
        '.fc-panel',
        '.chart-panel',
        '.surface-card',
        '.review-cow-card',
        '.cow-card',
        '.cow-repro-card',
        '.candidate-card',
        '.result-summary-card',
        '.result-empty-card',
        '.missing-review-block',
        '.dashboard-widget',
        '.overview-card',
        '.device-card',
        '.table-card'
      ].join(',')
      const tableSelector = '.el-table, table'
      const searchSelector = '.cow-number-autocomplete input, .el-autocomplete input'
      const dashboardGrid = document.querySelector('.chart-grid')
      const dashboardColumns = dashboardGrid
        ? window.getComputedStyle(dashboardGrid).gridTemplateColumns.split(' ').filter(Boolean).length
        : 0

      if (scrollWidth > viewportWidth + 8) {
        add('page-horizontal-overflow', 'document', `${scrollWidth}px > ${viewportWidth}px`, 'layout')
      }

      const coreSelectors = [
        '.fc-panel-header h2',
        '.fc-panel-header p',
        '.panel-header h2',
        '.panel-header p',
        '.board-header h1',
        '.board-header p',
        '.cow-autocomplete-option',
        '.result-summary-card',
        '.missing-review-block',
        '.review-cow-card',
        '.cow-card',
        '.surface-card'
      ]
      coreSelectors.forEach((selector) => {
        Array.from(document.querySelectorAll(selector))
          .slice(0, 40)
          .forEach((element) => {
            const rect = element.getBoundingClientRect()
            if (!rect.width || !rect.height) return
            if (element.scrollWidth > element.clientWidth + 3) {
              add(
                'text-horizontal-overflow',
                selector,
                `${Math.round(element.scrollWidth)}px > ${Math.round(element.clientWidth)}px: ${textOf(element).slice(0, 80)}`,
                'layout'
              )
            }
            if (element.scrollHeight > element.clientHeight + 8) {
              add(
                'text-vertical-overflow',
                selector,
                `${Math.round(element.scrollHeight)}px > ${Math.round(element.clientHeight)}px: ${textOf(element).slice(0, 80)}`,
                'layout'
              )
            }
          })
      })

      Array.from(document.querySelectorAll(cardSelector))
        .slice(0, 80)
        .forEach((element) => {
          const rect = element.getBoundingClientRect()
          if (rect.width > viewportWidth + 2) {
            add('card-over-viewport', cardSelector, `${Math.round(rect.width)}px`, 'layout')
          }
          if (rect.height > viewportHeight * 1.8 && !element.matches('.el-table')) {
            add('oversized-card', cardSelector, `${Math.round(rect.height)}px`, 'performance')
          }
        })

      const visibleRows = Array.from(document.querySelectorAll('.el-table__body-wrapper tbody tr'))
        .filter((row) => {
          const rect = row.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        }).length
      if (visibleRows > 14) {
        add('table-too-many-rendered-rows', '.el-table', `${visibleRows} visible rows`, 'performance')
      }

      const visibleCowCards = Array.from(
        document.querySelectorAll('.cow-card, .review-cow-card, .cow-repro-card, .candidate-card')
      ).filter((card) => {
        const rect = card.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }).length
      if (visibleCowCards > 8) {
        add('cow-card-too-many-rendered', '.cow-card', `${visibleCowCards} visible cards`, 'performance')
      }

      const hasMainCards = document.querySelectorAll(cardSelector).length > 0
      const hasTables = document.querySelectorAll(tableSelector).length > 0
      const hasCharts = document.querySelectorAll('canvas, svg').length > 0
      const emptyState = /暂无|无数据|没有可统计|未接入|等待/.test(bodyText)
      if (!hasMainCards && !hasTables && !hasCharts && !emptyState && bodyText.trim().length > 40) {
        add('no-recognized-main-surface', 'body', textOf(document.body).slice(0, 120), 'visual')
      }

      return {
        viewport: { width: viewportWidth, height: viewportHeight, scrollWidth },
        counts: {
          cards: document.querySelectorAll(cardSelector).length,
          tables: document.querySelectorAll(tableSelector).length,
          cowSearchInputs: document.querySelectorAll(searchSelector).length,
          charts: document.querySelectorAll('canvas, svg').length,
          visibleTableRows: visibleRows,
          visibleCowCards
        },
        layout: {
          dashboardColumns
        },
        problems: problems.slice(0, 40)
      }
    })
    .catch((error) => ({
      viewport: {},
      counts: {},
      problems: [{ code: 'ui-diagnostics-failed', selector: 'document', detail: error.message }]
    }))
}

function isAuthRequiredOnly(result) {
  const problems = result.problems || []
  return (
    !result.ok &&
    problems.length > 0 &&
    problems.every((problem) => AUTH_REQUIRED_PROBLEMS.has(problem)) &&
    !(result.pageErrors || []).length &&
    !(result.consoleErrors || []).length &&
    !result.error
  )
}

function shouldRetryAuthRedirect(result, session) {
  return !session?.synthetic && isAuthRequiredOnly(result)
}

function classifyResult(result, session) {
  if (result.ok) return 'pass'
  if (session?.synthetic && isAuthRequiredOnly(result)) return 'auth-required'
  return 'fail'
}

function statusForResult(result, session) {
  const classification = classifyResult(result, session)
  if (classification === 'pass') return 'PASS'
  if (classification === 'auth-required') return AUTH_REQUIRED_STATUS
  return 'FAIL'
}

async function smokeRoute(context, baseUrl, route, options = {}) {
  const startedAt = Date.now()
  let page = null
  let timedOut = false
  let timeout
  const run = (async () => {
    page = await context.newPage()
    if (timedOut) {
      await page.close({ runBeforeUnload: false }).catch(() => {})
      return timeoutFailure(
        route,
        baseUrl,
        new Error(`route timed out after ${options.routeTimeoutMs || DEFAULT_ROUTE_TIMEOUT_MS}ms`),
        Date.now() - startedAt
      )
    }

    page.setDefaultTimeout(options.actionTimeoutMs || DEFAULT_ACTION_TIMEOUT_MS)
    page.setDefaultNavigationTimeout(options.navigationTimeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS)
    const pageErrors = []
    const consoleErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message || String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await page.goto(routeUrl(baseUrl, route.path), {
      waitUntil: 'domcontentloaded',
      timeout: options.navigationTimeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS
    })
    await waitForRouteDomReady(
      page,
      route.path,
      route.aliasOf,
      options.readyTimeoutMs || DEFAULT_ROUTE_READY_TIMEOUT_MS
    )
    await waitForBodyText(page, options.readyTimeoutMs || DEFAULT_ROUTE_READY_TIMEOUT_MS)
    await page.waitForTimeout(options.settleDelayMs || 250)
    const bodyText = await page
      .locator('body')
      .innerText({ timeout: 10000 })
      .catch(() => '')
    const hashPath = new URL(page.url()).hash.replace(/^#/, '').split(/[?#]/)[0]
    const routeProblems = []
    if (!bodyText.trim()) routeProblems.push('blank-page')
    if (hashPath === '/auth/login' || page.url().includes('/auth/login'))
      routeProblems.push('redirected-to-login')
    if (
      /请输入用户名|请输入密码|欢迎回来|按住滑块拖动|未授权访问/.test(bodyText) &&
      route.path !== '/auth/login'
    )
      routeProblems.push('login-form-visible')
    if (bodyText.includes(LEGACY_PRODUCT_NAME)) routeProblems.push('legacy-product-name-visible')
    const fatalConsoleErrors = consoleErrors.filter(
      (line) => !/favicon|ResizeObserver|Failed to load resource/i.test(line)
    )
    const clicked = options.clicks ? await safeClickCandidates(page) : []
    if (options.clicks) await page.waitForTimeout(300)
    const postClickText = options.clicks
      ? await page
          .locator('body')
          .innerText({ timeout: 10000 })
          .catch(() => '')
      : bodyText
    if (!postClickText.trim()) routeProblems.push('blank-after-click')
    const uiDiagnostics = await collectUiDiagnostics(page)
    const uiProblems = [
      ...(uiDiagnostics.problems || []),
      ...collectBusinessExpectations(route, uiDiagnostics)
    ]
    let screenshotPath = ''
    if (options.screenshotDir) {
      await fs.mkdir(options.screenshotDir, { recursive: true })
      screenshotPath = path.join(
        options.screenshotDir,
        `${String(options.routeIndex ?? 0).padStart(3, '0')}-${safeFileName(route.path || route.name)}.png`
      )
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
        uiProblems.push({
          code: 'screenshot-failed',
          selector: 'page',
          detail: error.message,
          severity: 'visual'
        })
      })
    }
    return {
      ...route,
      url: page.url(),
      ok:
        !routeProblems.length &&
        !uiProblems.some((problem) => problem.severity !== 'visual') &&
        !pageErrors.length &&
        !fatalConsoleErrors.length,
      problems: routeProblems,
      uiDiagnostics,
      uiProblems,
      screenshotPath,
      pageErrors,
      consoleErrors: fatalConsoleErrors.slice(0, 5),
      clicked,
      durationMs: Date.now() - startedAt,
      textPreview: postClickText.replace(/\s+/g, ' ').trim().slice(0, 260)
    }
  })()

  try {
    return await Promise.race([
      run,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `route timed out after ${options.routeTimeoutMs || DEFAULT_ROUTE_TIMEOUT_MS}ms`
            )
          )
        }, options.routeTimeoutMs || DEFAULT_ROUTE_TIMEOUT_MS)
      })
    ])
  } catch (error) {
    timedOut = true
    return timeoutFailure(route, baseUrl, error, Date.now() - startedAt)
  } finally {
    clearTimeout(timeout)
    if (page) await page.close({ runBeforeUnload: false }).catch(() => {})
  }
}

async function runRoutePool(routes, worker, options) {
  const results = new Array(routes.length)
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(options.concurrency, routes.length))
  async function runWorker() {
    while (nextIndex < routes.length) {
      const index = nextIndex
      nextIndex += 1
      const route = routes[index]
      const remainingMs = options.deadline - Date.now()
      if (remainingMs <= 1000) {
        results[index] = timeoutFailure(
          route,
          options.baseUrl,
          new Error(`global smoke budget exhausted after ${options.totalTimeoutMs}ms`),
          0,
          'global-budget'
        )
        continue
      }
      results[index] = await worker(
        route,
        index,
        Math.min(options.routeTimeoutMs, remainingMs - 500)
      )
      const result = results[index]
      const status = statusForResult(result, options.session)
      console.error(
        `[livestock-ui-routes] ${status} ${index + 1}/${routes.length} ${route.path} (${result.durationMs || 0}ms)${result.ok ? '' : ` - ${failureSummary(result)}`}`
      )
    }
  }
  await Promise.all(Array.from({ length: workerCount }, runWorker))
  return results
}

function buildReport({
  results,
  routes,
  baseUrl,
  browserPath,
  screenshotDir,
  totalTimeoutMs,
  routeTimeoutMs,
  navigationTimeoutMs,
  actionTimeoutMs,
  readyTimeoutMs,
  concurrency,
  clicks,
  auth,
  exitCode
}) {
  const session = auth.session || null
  const classifiedResults = results.map((item) => ({
    ...item,
    status: statusForResult(item, session),
    classification: classifyResult(item, session)
  }))
  const passed = classifiedResults.filter((item) => item.classification === 'pass').length
  const failed = classifiedResults.filter((item) => item.classification === 'fail').length
  const authRequiredRoutes = classifiedResults.filter(
    (item) => item.classification === 'auth-required'
  )
  const uiProblemRows = classifiedResults.flatMap((item) =>
    (item.uiProblems || []).map((problem) => ({
      route: item.path,
      name: item.name,
      status: item.status,
      severity: problem.severity || 'layout',
      code: problem.code,
      selector: problem.selector,
      detail: problem.detail,
      screenshotPath: item.screenshotPath || ''
    }))
  )
  const uiSummary = uiProblemRows.reduce(
    (acc, item) => {
      acc.total += 1
      acc.bySeverity[item.severity] = (acc.bySeverity[item.severity] || 0) + 1
      acc.byCode[item.code] = (acc.byCode[item.code] || 0) + 1
      return acc
    },
    { total: 0, bySeverity: {}, byCode: {} }
  )
  const authRequired = authRequiredRoutes.length
  const skipped = authRequired
  const authCoverage = session?.synthetic ? (authRequired > 0 ? 'skipped' : 'synthetic') : 'verified'
  const status =
    auth.status !== 'ok'
      ? auth.status
      : failed
        ? 'failed'
        : skipped
          ? passed
            ? 'passed_with_auth_skips'
            : 'auth_skipped'
          : 'passed'
  const { session: _session, ...reportAuth } = auth

  return {
    ok: auth.status === 'ok' && failed === 0,
    status,
    exitCode,
    generatedAt: new Date().toISOString(),
    baseUrl,
    browserPath,
    screenshotDir,
    routeCount: routes.length,
    totalTimeoutMs,
    routeTimeoutMs,
    navigationTimeoutMs,
    actionTimeoutMs,
    readyTimeoutMs,
    concurrency,
    clicks,
    authMode: session?.synthetic ? 'synthetic-local-session' : 'login',
    authCoverage,
    auth: {
      ...reportAuth,
      authCoverage
    },
    summary: {
      status,
      routeCount: routes.length,
      passed,
      failed,
      skipped,
      authRequired,
      uiProblems: uiSummary
    },
    passed,
    failed,
    skipped,
    authRequired,
    failures: classifiedResults
      .filter((item) => item.classification === 'fail')
      .map((item) => ({
        name: item.name,
        path: item.path,
        url: item.url,
        durationMs: item.durationMs || 0,
        reason: failureSummary(item)
      })),
    authRequiredRoutes: authRequiredRoutes.map((item) => ({
      name: item.name,
      path: item.path,
      url: item.url,
      durationMs: item.durationMs || 0,
      reason: failureSummary(item)
    })),
    uiProblems: uiProblemRows,
    results: classifiedResults
  }
}

async function writeReport(outPath, report) {
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = await loadEnv()
  let baseUrl = normalizeBaseUrl(
    args.url || env.SMOKE_BASE_URL || env.PRODUCTION_BASE_URL || 'http://127.0.0.1:9191'
  )
  let distServer = null
  if (args['serve-dist']) {
    const apiBaseUrl = normalizeBaseUrl(
      args.api ||
        args['api-url'] ||
        env.SMOKE_API_BASE_URL ||
        env.PRODUCTION_BASE_URL ||
        'http://127.0.0.1:9191'
    )
    distServer = await startDistServer(apiBaseUrl, Number(args.port || 4173))
    baseUrl = distServer.baseUrl
  }
  const version = String(args.version || env.VITE_VERSION || '3.0.1')
  const userName = String(args.user || env.SMOKE_USER || env.ADMIN_USER || 'admin')
  const password = String(args.password || env.SMOKE_PASSWORD || env.ADMIN_PASSWORD || '')
  const outPath = path.resolve(
    projectRoot,
    args.out || path.join('artifacts', 'livestock-ui-route-smoke.json')
  )
  const screenshotDir = path.resolve(
    projectRoot,
    args['screenshot-dir'] ||
      path.join(path.dirname(path.relative(projectRoot, outPath)), 'livestock-ui-route-screenshots')
  )
  const limit = args.limit ? Number(args.limit) : Infinity
  const totalTimeoutMs = Number(args['total-timeout-ms'] || DEFAULT_TOTAL_TIMEOUT_MS)
  const routeTimeoutMs = Number(args['route-timeout-ms'] || DEFAULT_ROUTE_TIMEOUT_MS)
  const navigationTimeoutMs = Number(args['navigation-timeout-ms'] || DEFAULT_NAVIGATION_TIMEOUT_MS)
  const actionTimeoutMs = Number(args['action-timeout-ms'] || DEFAULT_ACTION_TIMEOUT_MS)
  const readyTimeoutMs = Number(args['ready-timeout-ms'] || DEFAULT_ROUTE_READY_TIMEOUT_MS)
  const settleDelayMs = Number(args['settle-delay-ms'] || 250)
  const concurrency = Number(args.concurrency || DEFAULT_CONCURRENCY)
  const contextMode = String(args['context-mode'] || DEFAULT_CONTEXT_MODE).trim().toLowerCase()
  if (!['isolated', 'shared'].includes(contextMode)) {
    throw new Error('--context-mode must be isolated or shared')
  }
  const authRetryCount = Math.max(0, Number(args['auth-retry-count'] || DEFAULT_AUTH_RETRY_COUNT))
  const clicks = args.clicks === true || args.clicks === 'true'
  const authFailedExitCode = Number(args['auth-failed-exit-code'] || DEFAULT_AUTH_FAILED_EXIT_CODE)

  const routeFilter = String(args.route || '').trim()
  const routePattern = String(args['route-pattern'] || '').trim()
  const routeRegex = routePattern ? new RegExp(routePattern) : null
  const includeHidden = args['include-hidden'] === true || args['include-hidden'] === 'true'
  const includeAliases = args['include-aliases'] === true || args['include-aliases'] === 'true'
  const routes = (await collectVisibleRoutes({ includeHidden, includeAliases }))
    .filter(
      (route) =>
        !routeFilter ||
        route.path === routeFilter ||
        route.path.includes(routeFilter) ||
        route.name.includes(routeFilter)
    )
    .filter((route) => !routeRegex || routeRegex.test(route.path) || routeRegex.test(route.name))
    .slice(0, Number.isFinite(limit) ? limit : undefined)
  if (!routes.length) throw new Error('No visible production routes parsed.')

  const browserPath = await findBrowserExecutable()
  let session
  if (password) {
    try {
      session = await login(baseUrl, userName, password)
    } catch (error) {
      const report = buildReport({
        results: [],
        routes,
        baseUrl,
        browserPath,
        screenshotDir,
        totalTimeoutMs,
        routeTimeoutMs,
        navigationTimeoutMs,
        actionTimeoutMs,
        readyTimeoutMs,
        concurrency,
        clicks,
        auth: {
          status: 'auth_failed',
          credentials: 'provided',
          acceptedEnv: ['SMOKE_PASSWORD', 'ADMIN_PASSWORD'],
          productionEnvRead: false,
          pageFatalEvaluation: 'not_started',
          error: error?.message || String(error),
          session: null
        },
        exitCode: authFailedExitCode
      })
      await writeReport(outPath, report)
      process.exitCode = authFailedExitCode
      return
    }
  } else {
    console.error(
      '[livestock-ui-routes] No SMOKE_PASSWORD/ADMIN_PASSWORD found. Using a synthetic read-only session; strict auth redirects will be counted as SKIP_AUTH_REQUIRED.'
    )
    session = syntheticSession(userName)
  }
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: !args.headed,
    args: ['--disable-gpu', '--no-sandbox']
  })
  const results = []
  try {
    const deadline = Date.now() + totalTimeoutMs
    if (contextMode === 'shared') {
      const context = await browser.newContext({
        storageState: storageState(baseUrl, version, session),
        viewport: { width: 1440, height: 980 },
        deviceScaleFactor: 1
      })
      try {
        results.push(
          ...(await runRoutePool(
            routes,
            (route, index, remainingRouteTimeoutMs) =>
              smokeRoute(context, baseUrl, route, {
                routeTimeoutMs: remainingRouteTimeoutMs,
                navigationTimeoutMs,
                actionTimeoutMs,
                readyTimeoutMs,
                settleDelayMs,
                clicks,
                routeIndex: index,
                screenshotDir
              }),
            {
              baseUrl,
              totalTimeoutMs,
              routeTimeoutMs,
              concurrency,
              deadline,
              session
            }
          ))
        )
      } finally {
        await context.close()
      }
    } else {
      const routeStorageState = storageState(baseUrl, version, session)
      const newRouteContext = () =>
        browser.newContext({
          storageState: routeStorageState,
          viewport: { width: 1440, height: 980 },
          deviceScaleFactor: 1
        })

      results.push(
        ...(await runRoutePool(
          routes,
          async (route, index, remainingRouteTimeoutMs) => {
            let attemptSession = session
            for (let attempt = 0; attempt <= authRetryCount; attempt += 1) {
              const context = await browser.newContext({
                storageState: storageState(baseUrl, version, attemptSession),
                viewport: { width: 1440, height: 980 },
                deviceScaleFactor: 1
              })
              try {
                const result = await smokeRoute(context, baseUrl, route, {
                  routeTimeoutMs: remainingRouteTimeoutMs,
                  navigationTimeoutMs,
                  actionTimeoutMs,
                  readyTimeoutMs,
                  settleDelayMs,
                  clicks,
                  routeIndex: index,
                  screenshotDir
                })
                if (!shouldRetryAuthRedirect(result, attemptSession) || attempt >= authRetryCount) {
                  return attempt > 0 ? { ...result, authRetryAttempts: attempt } : result
                }
              } finally {
                await context.close().catch(() => {})
              }
              attemptSession = await login(baseUrl, userName, password)
            }
            return timeoutFailure(
              route,
              baseUrl,
              new Error('auth retry exhausted without route result'),
              Date.now(),
              'auth-retry'
            )
          },
          {
            baseUrl,
            totalTimeoutMs,
            routeTimeoutMs,
            concurrency,
            deadline,
            session
          }
        ))
      )
    }
  } finally {
    await browser.close()
    if (distServer) {
      await new Promise((resolve) => distServer.server.close(resolve))
    }
  }

  const fatalFailures = results.filter((item) => classifyResult(item, session) === 'fail')
  const report = buildReport({
    results,
    routes,
    baseUrl,
    browserPath,
    screenshotDir,
    totalTimeoutMs,
    routeTimeoutMs,
    navigationTimeoutMs,
    actionTimeoutMs,
    readyTimeoutMs,
    settleDelayMs,
    concurrency,
    clicks,
    auth: {
      status: 'ok',
      credentials: session.synthetic ? 'missing' : 'provided',
      acceptedEnv: ['SMOKE_PASSWORD', 'ADMIN_PASSWORD'],
      productionEnvRead: false,
      pageFatalEvaluation: 'enabled',
      session
    },
    exitCode: fatalFailures.length ? 1 : 0
  })
  await writeReport(outPath, report)
  if (!report.ok) process.exitCode = report.exitCode
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

