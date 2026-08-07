import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:9191'
const userName = process.env.SMOKE_USER || process.env.ADMIN_USER || 'admin'
const password = process.env.SMOKE_PASSWORD || process.env.ADMIN_PASSWORD || ''
const browserPath =
  process.env.SMOKE_BROWSER_PATH ||
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
const packageDir =
  process.env.TWO_TABLE_SHIFT_MILK_IMPORT_PACKAGE_DIR ||
  path.resolve('test-fixtures/shift-milk/two-table-import-package')
const screenshotDir = path.resolve('artifacts/two-table-shift-milk-import-ui')
const version = process.env.SMOKE_STORAGE_VERSION || '3.0.1'

const cases = [
  {
    id: 'animal-profile-cow-number-only',
    template: 'animal-profile',
    file: '01_个体档案_仅牛号_animal-profile_先导入.xlsx',
    expectedText: ['265 行可入库']
  },
  {
    id: 'milk-measurement',
    template: 'milk-measurement',
    file: '02_泌乳奶厅测量_milk-measurement.xlsx',
    acceptedText: ['7182 行可入库', '未匹配到现有牛只']
  }
]

function assertFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在：${filePath}`)
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
  if (!token) throw new Error('Login returned no token.')
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

async function runCase(page, item) {
  const filePath = path.join(packageDir, item.file)
  assertFile(filePath)
  const url = `${baseUrl}/#/data-import/information?template=${encodeURIComponent(item.template)}&tab=batch`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.upload-box', { timeout: 30000 })
  await page.locator('input[type="file"]').setInputFiles(filePath)
  await page.waitForFunction(
    (name) => document.body.innerText.includes(name),
    path.basename(filePath),
    { timeout: 15000 }
  )
  await page.getByRole('button', { name: /预检表格/ }).click()
  await page.waitForFunction(() => /预检通过|行可入库|需修正|表格预检失败/.test(document.body.innerText), {
    timeout: 90000
  })
  const text = await page.locator('body').innerText()
  const screenshotPath = path.join(screenshotDir, `${item.id}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  const expectedTokens = item.expectedText || []
  const acceptedTokens = item.acceptedText || expectedTokens
  const missing = expectedTokens.filter((token) => !text.includes(token))
  const accepted = acceptedTokens.some((token) => text.includes(token))
  return {
    id: item.id,
    template: item.template,
    file: filePath,
    ok: accepted && !/表格预检失败|提交失败/.test(text),
    missing,
    accepted,
    summary: (text.match(/(\d+ 行可入库|\d+ 行需修正|预检通过|表格预检失败[^\n]*|未匹配到现有牛只)/g) || []).slice(0, 12),
    screenshotPath
  }
}

async function main() {
  fs.mkdirSync(screenshotDir, { recursive: true })
  for (const item of cases) assertFile(path.join(packageDir, item.file))
  const session = await loginSession()
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true
  })
  const context = await browser.newContext({
    storageState: storageState(session),
    viewport: { width: 1440, height: 980 },
    deviceScaleFactor: 1
  })
  const page = await context.newPage()
  try {
    const results = []
    for (const item of cases) results.push(await runCase(page, item))
    const report = {
      ok: results.every((item) => item.ok),
      baseUrl,
      packageDir,
      screenshotDir,
      results
    }
    console.log(JSON.stringify(report, null, 2))
    if (!report.ok) process.exitCode = 1
  } finally {
    await context.close().catch(() => {})
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

