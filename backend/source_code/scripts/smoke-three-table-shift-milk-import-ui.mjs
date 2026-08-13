import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import XLSX from 'xlsx'

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:9191'
const userName = process.env.SMOKE_USER || process.env.ADMIN_USER || 'admin'
const password = process.env.SMOKE_PASSWORD || process.env.ADMIN_PASSWORD || ''
const browserPath =
  process.env.SMOKE_BROWSER_PATH ||
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
const packageDir =
  process.env.THREE_TABLE_TEMPLATE_IMPORT_PACKAGE_DIR ||
  path.resolve('test-fixtures/shift-milk/three-table-template-package')
const screenshotDir = path.resolve('artifacts/three-table-shift-milk-import-ui')
const reportPath = path.join(screenshotDir, 'report.json')
const version = process.env.SMOKE_STORAGE_VERSION || '3.0.1'

dotenv.config({ path: path.resolve('ops/production/.env.prod'), override: true, quiet: true })

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 9193),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

const cases = [
  {
    id: '01-animal-profile',
    template: 'animal-profile',
    file: '01_个体建档入群_animal-profile_系统模板.xlsx',
    timeoutMs: 120000,
    assertions: [{ table: 'animal', minDelta: 265 }, { table: 'cows', minDelta: 265 }],
    existence: 'animal-profile'
  },
  {
    id: '02-pedigree',
    template: 'pedigree',
    file: '02_系谱出生产犊_pedigree_系统模板.xlsx',
    timeoutMs: 120000,
    assertions: [
      { table: 'parity_episode', minDelta: 265 },
      { table: 'lactation_episode', minDelta: 265 }
    ],
    existence: 'pedigree'
  },
  {
    id: '03-milk-measurement',
    template: 'milk-measurement',
    file: '03_泌乳奶厅测量_milk-measurement_系统模板.xlsx',
    timeoutMs: 900000,
    assertions: [
      { table: 'milk_measurement', minDelta: 7182 },
      { table: 'milk_records', minDelta: 7182 },
      { table: 'milking_visit', minDelta: 7182 }
    ],
    existence: 'milk-measurement'
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

function importSummary(text) {
  const matches =
    text.match(
      /(预检完成：[^\n]+|提交完成[^\n]+|\d+ 行可入库|\d+ 行需修正|表格预检失败[^\n]*|提交失败[^\n]*|服务器内部错误[^\n]*|未匹配到现有牛只[^\n]*)/g
    ) || []
  return [...new Set(matches)].slice(0, 24)
}

function parseCommitStats(text) {
  const match = text.match(/提交完成[^\n]*写入\s*(\d+)\s*行[^\n]*跳过\s*(\d+)\s*行/)
  return {
    committedRows: match ? Number(match[1]) : null,
    skippedRows: match ? Number(match[2]) : null
  }
}

function readWorkbookRows(filePath) {
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' })
}

function text(value) {
  return String(value ?? '').trim()
}

function excelDateOnly(value) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const raw = text(value)
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(raw)) {
    const [year, month, day] = raw.split(/[ T/.-]/).filter(Boolean)
    return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw)
    if (Number.isFinite(serial) && serial > 20000) {
      const date = new Date(Math.round((serial - 25569) * 86400 * 1000))
      return date.toISOString().slice(0, 10)
    }
  }
  return raw.slice(0, 10)
}

async function getTableCounts(tables) {
  const connection = await mysql.createConnection(dbConfig)
  try {
    const result = {}
    for (const table of tables) {
      const [rows] = await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\``)
      result[table] = Number(rows?.[0]?.n || 0)
    }
    return result
  } finally {
    await connection.end()
  }
}

function tableAssertionsFor(item) {
  return item.assertions || []
}

function assertDbDeltas(item, beforeCounts, afterCounts) {
  const assertions = tableAssertionsFor(item)
  return assertions.map((assertion) => {
    const before = Number(beforeCounts[assertion.table] || 0)
    const after = Number(afterCounts[assertion.table] || 0)
    const delta = after - before
    return {
      table: assertion.table,
      before,
      after,
      delta,
      minDelta: assertion.minDelta,
      ok: delta >= assertion.minDelta
    }
  })
}

async function queryOne(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params)
  return rows?.[0] || {}
}

async function resolveAnimalId(connection, cowNumber) {
  const row = await queryOne(
    connection,
    'SELECT id FROM animal WHERE animal_number = ? LIMIT 1',
    [cowNumber]
  )
  return text(row.id)
}

async function checkExistingRows(item, filePath) {
  const rows = readWorkbookRows(filePath)
  const connection = await mysql.createConnection(dbConfig)
  try {
    if (item.existence === 'animal-profile') {
      const cowNumbers = [...new Set(rows.map((row) => text(row['牛号'])).filter(Boolean))]
      const sample = cowNumbers.slice(0, 30)
      const placeholders = sample.map(() => '?').join(',')
      const animal = sample.length
        ? await queryOne(
            connection,
            `SELECT COUNT(DISTINCT animal_number) AS n FROM animal WHERE animal_number IN (${placeholders})`,
            sample
          )
        : { n: 0 }
      const cows = sample.length
        ? await queryOne(
            connection,
            `SELECT COUNT(DISTINCT cow_number) AS n FROM cows WHERE cow_number IN (${placeholders})`,
            sample
          )
        : { n: 0 }
      return {
        type: item.existence,
        sampleSize: sample.length,
        ok: sample.length > 0 && Number(animal.n || 0) === sample.length && Number(cows.n || 0) === sample.length,
        details: { animalMatches: Number(animal.n || 0), cowMatches: Number(cows.n || 0), sample: sample.slice(0, 5) }
      }
    }

    if (item.existence === 'pedigree') {
      const sample = rows
        .map((row) => ({ cow: text(row['牛号']), parity: Number(row['胎次'] || 0), calvingDate: excelDateOnly(row['产犊日期']) }))
        .filter((row) => row.cow && row.parity > 0 && row.calvingDate)
        .slice(0, 30)
      let matches = 0
      for (const row of sample) {
        const animalId = await resolveAnimalId(connection, row.cow)
        if (!animalId) continue
        const hit = await queryOne(
          connection,
          `SELECT COUNT(*) AS n
             FROM parity_episode
            WHERE animal_id = ? AND parity_no = ? AND DATE(start_date) = ?`,
          [animalId, row.parity, row.calvingDate]
        )
        if (Number(hit.n || 0) > 0) matches += 1
      }
      return {
        type: item.existence,
        sampleSize: sample.length,
        ok: sample.length > 0 && matches === sample.length,
        details: { matches, sample: sample.slice(0, 5) }
      }
    }

    if (item.existence === 'milk-measurement') {
      const sample = rows
        .map((row) => ({
          cow: text(row['牛号']),
          date: excelDateOnly(row['挤奶日期']),
          shift: text(row['班次']),
          milk: Number(row['产奶量'] || 0)
        }))
        .filter((row) => row.cow && row.date && row.shift && row.milk > 0)
        .slice(0, 50)
      let matches = 0
      let duplicateSlots = 0
      for (const row of sample) {
        const animalId = await resolveAnimalId(connection, row.cow)
        if (!animalId) continue
        const hit = await queryOne(
          connection,
          `SELECT COUNT(*) AS n
             FROM milk_measurement
            WHERE animal_id = ? AND DATE(measured_at) = ? AND shift_id = ?`,
          [animalId, row.date, row.shift]
        )
        const count = Number(hit.n || 0)
        if (count > 0) matches += 1
        if (count > 1) duplicateSlots += 1
      }
      return {
        type: item.existence,
        sampleSize: sample.length,
        ok: sample.length > 0 && matches === sample.length && duplicateSlots === 0,
        details: { matches, duplicateSlots, sample: sample.slice(0, 5) }
      }
    }

    return { type: item.existence || 'none', sampleSize: 0, ok: true, details: {} }
  } finally {
    await connection.end()
  }
}

async function waitForImportState(page, pattern, timeoutMs) {
  await page.waitForFunction((source) => new RegExp(source).test(document.body.innerText), pattern.source, {
    timeout: timeoutMs
  })
}

async function runCase(page, item) {
  const filePath = path.join(packageDir, item.file)
  assertFile(filePath)
  const assertionTables = tableAssertionsFor(item).map((assertion) => assertion.table)
  const beforeCounts = assertionTables.length ? await getTableCounts(assertionTables) : {}
  const url = `${baseUrl}/#/data-import/information?template=${encodeURIComponent(item.template)}&tab=batch`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.upload-box', { timeout: 30000 })
  await page.locator('input[type="file"]').setInputFiles(filePath)
  await page.waitForFunction(
    (name) => document.body.innerText.includes(name),
    path.basename(filePath),
    { timeout: 30000 }
  )

  await page.getByRole('button', { name: /预检表格/ }).click()
  await waitForImportState(page, /预检完成|预检通过|行可入库|行需修正|表格预检失败|服务器内部错误/, item.timeoutMs)
  let text = await page.locator('body').innerText()
  const dryRunScreenshot = path.join(screenshotDir, `${item.id}-dry-run.png`)
  await page.screenshot({ path: dryRunScreenshot, fullPage: true })
  const dryRunOk = /预检完成|预检通过|行可入库/.test(text) && !/表格预检失败|服务器内部错误/.test(text)

  let commitScreenshot = ''
  let commitOk = false
  if (dryRunOk) {
    const beforeCommitText = await page.locator('body').innerText()
    await page.getByRole('button', { name: /提交入库/ }).click()
    await page.waitForFunction(
      (previousText) => {
        const progressCards = Array.from(document.querySelectorAll('.import-progress-card'))
        const progressText = progressCards.map((item) => item.textContent || '').join('\n')
        const bodyText = document.body.innerText || ''
        if (/失败|提交失败|服务器内部错误|网络连接异常/.test(progressText) || /提交失败|服务器内部错误|网络连接异常/.test(bodyText)) {
          return true
        }
        if (/完成/.test(progressText) && /100%/.test(progressText)) return true
        const changedText = bodyText !== previousText
        return changedText && /提交完成：写入\s*\d+\s*行/.test(progressText)
      },
      beforeCommitText,
      { timeout: item.timeoutMs }
    )
    text = await page.locator('body').innerText()
    commitScreenshot = path.join(screenshotDir, `${item.id}-commit.png`)
    await page.screenshot({ path: commitScreenshot, fullPage: true })
    const stats = parseCommitStats(text)
    commitOk =
      stats.committedRows !== null &&
      stats.committedRows > 0 &&
      /完成/.test(text) &&
      !/提交失败|服务器内部错误|网络连接异常/.test(text)
  }

  const afterCounts = assertionTables.length ? await getTableCounts(assertionTables) : {}
  const deltaAssertions = assertDbDeltas(item, beforeCounts, afterCounts)
  const existenceAssertion = await checkExistingRows(item, filePath)
  const dbAssertions = deltaAssertions.map((assertion) => ({
    ...assertion,
    ok: assertion.ok || existenceAssertion.ok,
    mode: assertion.ok ? 'delta' : (existenceAssertion.ok ? 'idempotent-exists' : 'failed')
  }))
  const dbOk = dbAssertions.every((assertion) => assertion.ok) && existenceAssertion.ok

  return {
    id: item.id,
    template: item.template,
    file: filePath,
    dryRunOk,
    commitOk,
    dbOk,
    dbAssertions,
    existenceAssertion,
    ok: dryRunOk && commitOk && dbOk,
    summary: importSummary(text),
    dryRunScreenshot,
    commitScreenshot
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
    deviceScaleFactor: 1,
    acceptDownloads: true
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
      results,
      generatedAt: new Date().toISOString()
    }
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
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


