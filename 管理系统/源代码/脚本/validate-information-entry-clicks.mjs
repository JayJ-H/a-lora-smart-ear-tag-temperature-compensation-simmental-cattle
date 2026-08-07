import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const args = parseArgs(process.argv.slice(2))
const DEFAULT_BASE_URL = process.env.ENTRY_CLICK_BASE_URL || 'http://127.0.0.1:9191'
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PASSWORD_ENV_NAMES = ['TEST_ADMIN_PASSWORD', 'SECURITY_ADMIN_PASSWORD', 'ADMIN_PASSWORD']
const DESTRUCTIVE_TEST_CONFIRM_ENV = 'ALLOW_DESTRUCTIVE_TEST'
const VERSION = process.env.VITE_VERSION || '3.0.1'
const RUN_ID = `UITEST_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
const OPERATOR = '页面点击回归'
const ASSERT_TIMEOUT_MS = Number(args['assert-timeout'] || 15000)
const keepData = Boolean(args['keep-data'])
const skipCleanup = Boolean(args['skip-cleanup'])
const headed = Boolean(args.headed)
const outDir = path.join(projectRoot, 'artifacts', 'information-entry-clicks', RUN_ID)
let BASE_URL = DEFAULT_BASE_URL
let distServer = null

const browserCandidates = [
  process.env.ENTRY_CLICK_BROWSER_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean)

const clickCases = [
  {
    id: 'entry',
    title: '入群新牛建档',
    route: '/#/information-entry/entry',
    run: async (page, refs) => {
      await fillInputByLabel(page, '新牛号', refs.entryCow)
      await chooseSelectByLabel(page, '目标圈舍', refs.penAName)
      await chooseSelectByLabel(page, '入群原因', '购入入群')
      await clickDryRunAndCommit(page)
    },
    verify: async (refs) => {
      await expectAny('animal', (row) => field(row, 'animal_number') === refs.entryCow, '入群后 animal 应创建新牛')
      const event = await expectAny('animal_event', (row) => animalRefOf(row).includes(refs.entryCow) && eventCodeOf(row) === 'entry', '入群后 animal_event 应写 entry')
      await expectAny('event_movement_detail', (row) => linkedEventIdOf(row) === event.id, '入群后 movement detail 应写入')
      await expectAny('entry-events', (row) => cowNumberOf(row) === refs.entryCow, '入群后 legacy entry-events 应可见')
    }
  },
  {
    id: 'transfer',
    title: '转群',
    route: '/#/information-entry/transfer',
    run: async (page, refs) => {
      await fillCowAutocomplete(page, refs.transferCow)
      await chooseSelectByLabel(page, '目标圈舍', refs.penBName)
      await chooseSelectByLabel(page, '转群原因', '断奶转群')
      await clickDryRunAndCommit(page)
    },
    verify: async (refs) => {
      const event = await expectAny('animal_event', (row) => cowNumberOf(row) === refs.transferCow && eventCodeOf(row) === 'transfer', '转群后 animal_event 应写 transfer')
      await expectAny('event_movement_detail', (row) => linkedEventIdOf(row) === event.id, '转群后 movement detail 应写入')
      await expectAny('cows', (row) => cowNumberOf(row) === refs.transferCow && currentPenOf(row) === refs.penB, '转群后 cows 当前圈舍应更新为目标圈舍')
      await expectAny('farm_unit', (row) => field(row, 'id', 'unit_id', 'code') === refs.penB, '转群目标仅存在于 pens 时应自动补齐 farm_unit')
      await expectAny('animal_pen_assignment', (row) => field(row, 'animal_id', 'animalId').includes(refs.transferCow) && field(row, 'unit_id', 'unitId') === refs.penB, '转群后圈舍历史应引用已补齐的 farm_unit')
    }
  },
  {
    id: 'exit',
    title: '离群',
    route: '/#/information-entry/exit',
    run: async (page, refs) => {
      await fillCowAutocomplete(page, refs.exitCow)
      await chooseSelectByLabel(page, '离群原因', '淘汰离群')
      await chooseSelectByLabel(page, '离群去向', '淘汰')
      await clickDryRunAndCommit(page)
    },
    verify: async (refs) => {
      const event = await expectAny('animal_event', (row) => cowNumberOf(row) === refs.exitCow && eventCodeOf(row) === 'exit', '离群后 animal_event 应写 exit')
      await expectAny('event_movement_detail', (row) => linkedEventIdOf(row) === event.id && !toUnitOf(row), '离群后 movement detail 目标圈舍应为空')
      await expectAny('exit-events', (row) => cowNumberOf(row) === refs.exitCow, '离群后 legacy exit-events 应可见')
      await expectAny('cows', (row) => cowNumberOf(row) === refs.exitCow && /离群|淘汰/.test(field(row, 'status')) && !currentPenOf(row), '离群后 cows 应更新为离群且清空圈舍')
    }
  },
  {
    id: 'insemination',
    title: '输精/配种',
    route: '/#/information-entry/breeding',
    run: async (page, refs) => {
      await fillCowAutocomplete(page, refs.inseminationCow)
      await chooseOrCreateSelectByLabel(page, '公牛号', `${RUN_ID}_BULL_EXT`)
      await clickDryRunAndCommit(page)
    },
    verify: async (refs) => {
      const event = await expectAny('animal_event', (row) => cowNumberOf(row) === refs.inseminationCow && eventCodeOf(row) === 'insemination', '输精后 animal_event 应写 insemination')
      await expectAny('event_reproduction_detail', (row) => linkedEventIdOf(row) === event.id && field(row, 'reproduction_action') === 'insemination', '输精后 reproduction detail 应写入')
    }
  },
  {
    id: 'pregnancy-check',
    title: '妊检',
    route: '/#/information-entry/reproduction',
    eventName: '妊检',
    run: async (page, refs) => {
      await chooseEventName(page, '妊检')
      await fillCowAutocomplete(page, refs.pregnancyCow)
      await chooseSelectByLabel(page, '妊检结果', '阳性')
      await clickDryRunAndCommit(page)
    },
    verify: async (refs) => {
      const event = await expectAny('animal_event', (row) => cowNumberOf(row) === refs.pregnancyCow && eventCodeOf(row) === 'pregnancy_check', '妊检后 animal_event 应写 pregnancy_check')
      await expectAny('event_reproduction_detail', (row) => linkedEventIdOf(row) === event.id && field(row, 'pregnancy_result') === '阳性', '妊检结果应进入 reproduction detail')
      await expectAny('cows', (row) => cowNumberOf(row) === refs.pregnancyCow && String(row.pregnancy || row.pregnancyStatus || '').match(/1|true/i), '妊检阳性后 cows 妊娠状态应更新')
    }
  },
  {
    id: 'calving-multi-calf',
    title: '产犊多胎',
    route: '/#/information-entry/reproduction',
    eventName: '产犊',
    run: async (page, refs) => {
      await chooseEventName(page, '产犊')
      await fillCowAutocomplete(page, refs.calvingCow)
      await chooseSelectByLabel(page, '产犊结果', '顺产')
      await fillInputByLabel(page, '犊牛数', '2')
      await fillInputByLabel(page, '犊牛1号', `${RUN_ID}_CALF_1`)
      await fillInputByLabel(page, '犊牛2号', `${RUN_ID}_CALF_2`)
      await clickDryRunAndCommit(page)
    },
    verify: async (refs) => {
      await expectAny('animal_event', (row) => animalRefOf(row).includes(refs.calvingCow) && eventCodeOf(row) === 'calving', '产犊后 animal_event 应写 calving')
      await expectAny('animal', (row) => field(row, 'animal_number') === `${RUN_ID}_CALF_1`, '产犊后应创建第一头犊牛')
      await expectAny('animal', (row) => field(row, 'animal_number') === `${RUN_ID}_CALF_2`, '产犊后应创建第二头犊牛')
      await expectAny('cows', (row) => cowNumberOf(row) === `${RUN_ID}_CALF_1`, '产犊后第一头犊牛应写入 cows 兼容表')
      await expectAny('cows', (row) => cowNumberOf(row) === `${RUN_ID}_CALF_2`, '产犊后第二头犊牛应写入 cows 兼容表')
      await expectAny('animal_parentage', (row) => field(row, 'parent_number') === refs.calvingCow && field(row, 'parent_role') === 'dam', '产犊后犊牛应关联母号')
    }
  },
  {
    id: 'body-measurement',
    title: '生产/表型体尺体重',
    route: '/#/information-entry/生产配置',
    run: async (page, refs) => {
      await chooseEventName(page, '体尺测定')
      await fillCowAutocomplete(page, refs.productionCow)
      await fillFirstNumberField(page, 612.5)
      await chooseSelectByLabel(page, '测定方式', '人工测定')
      await clickDryRunAndCommit(page)
    },
    verify: async (refs) => {
      const event = await expectAny('animal_event', (row) => cowNumberOf(row) === refs.productionCow && eventCodeOf(row) === 'body_measurement', '体尺测定后 animal_event 应写 body_measurement')
      await expectAny('event_production_detail', (row) => linkedEventIdOf(row) === event.id && field(row, 'operation_type') === 'body_measurement', '体尺测定后 production detail 应写入')
      await expectAny('trait_observation', (row) => animalRefOf(row).includes(refs.productionCow) && Number(valueOf(row)) === 612.5, '体尺/体重应写 trait_observation')
      await expectAny('phenotype-records', (row) => animalRefOf(row).includes(refs.productionCow) && Number(valueOf(row)) === 612.5, '体尺/体重应写 phenotype-records 旧镜像')
    }
  },
  {
    id: 'milk-measurement',
    title: '生产/泌乳单条产奶',
    route: '/#/information-entry/生产配置',
    run: async (page, refs) => {
      await chooseEventName(page, '采奶')
      await fillCowAutocomplete(page, refs.productionCow)
      await chooseSelectByLabel(page, '采奶班次', '晚班')
      await fillNumberByLabel(page, '产奶量', 9.6)
      await chooseSelectByLabel(page, '质量标记', '正常')
      await clickDryRunAndCommit(page)
    },
    verify: async (refs) => {
      const event = await expectAny('animal_event', (row) => cowNumberOf(row) === refs.productionCow && ['milking', 'milking_session'].includes(eventCodeOf(row)), '产奶单条录入应先写生产事件')
      await expectAny('event_production_detail', (row) => linkedEventIdOf(row) === event.id && ['milking', 'milking_session'].includes(field(row, 'operation_type')), '产奶单条录入应写 production detail')
      await expectAny('milk_measurement', (row) => animalRefOf(row).includes(refs.productionCow) && Number(valueOf(row)) === 9.6, '产奶单条录入应写 milk_measurement')
      await expectAny('milk-records', (row) => animalRefOf(row).includes(refs.productionCow) && Number(valueOf(row)) === 9.6, '产奶单条录入应写 milk-records 旧镜像')
    }
  }
]

async function main() {
  requireDestructiveTestAllowed('信息录入点击验证')
  if (args['serve-dist']) {
    distServer = await startDistServer(
      normalizeBaseUrl(args.api || DEFAULT_BASE_URL),
      Number(args.port || 4173)
    )
    BASE_URL = distServer.baseUrl
  } else {
    BASE_URL = normalizeBaseUrl(args.url || DEFAULT_BASE_URL)
  }
  await fs.mkdir(outDir, { recursive: true })
  const token = await login()
  globalThis.__ENTRY_CLICK_TOKEN__ = token
  await cleanupClickData(RUN_ID).catch(() => undefined)
  const refs = await seedReferenceData()
  const browserPath = await findBrowser()
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: !headed,
    args: ['--disable-gpu', '--no-sandbox']
  })
  const results = []
  try {
    const context = await browser.newContext({
      storageState: makeStorageState(token),
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1
    })
    const selectedCases = filterCases(clickCases)
    for (const item of selectedCases) {
      const result = await runClickCase(context, item, refs)
      results.push(result)
      console.log(formatResult(result))
    }
  } finally {
    await browser.close()
    if (!keepData && !skipCleanup) await cleanupClickData(RUN_ID).catch((error) => console.error(`清理点击测试数据失败：${error.message || error}`))
    if (distServer) await new Promise((resolve) => distServer.server.close(resolve))
  }

  const failed = results.filter((item) => item.status !== 'PASS')
  console.log('\n信息录入逐个点击验证结果')
  console.log(`RunId: ${RUN_ID}`)
  console.log(`截图目录: ${outDir}`)
  console.log(`通过: ${results.length - failed.length}/${results.length}`)
  console.log(`失败: ${failed.length}/${results.length}`)
  if (failed.length) process.exitCode = 1
}

function filterCases(cases) {
  const only = text(args.only)
  if (!only) return cases
  const wanted = new Set(only.split(',').map((item) => item.trim()).filter(Boolean))
  return cases.filter((item) => wanted.has(item.id))
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    if (inlineValue !== undefined) parsed[rawKey] = inlineValue
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      parsed[rawKey] = argv[index + 1]
      index += 1
    } else {
      parsed[rawKey] = true
    }
  }
  return parsed
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
      fsSync.existsSync(filePath) && fsSync.statSync(filePath).isFile()
        ? filePath
        : distIndex
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

async function runClickCase(context, item, refs) {
  const page = await context.newPage()
  const pageErrors = []
  const consoleErrors = []
  const rpcTraces = []
  if (args['trace-rpc-size']) {
    page.on('request', (request) => {
      const url = request.url()
      if (!url.includes('/api/')) return
      const body = request.postData() || ''
      let method = ''
      let tableName = ''
      try {
        const payload = JSON.parse(body)
        method = payload.method || ''
        tableName = payload.tableName || ''
      } catch {
        // keep raw size trace when payload is not JSON
      }
      rpcTraces.push({
        method,
        tableName,
        bytes: Buffer.byteLength(body),
        url,
        status: '',
        body: args['trace-rpc-payload'] ? sanitizeRpcBody(body) : ''
      })
    })
    page.on('response', (response) => {
      const url = response.url()
      if (!url.includes('/api/')) return
      const match = rpcTraces
        .slice()
        .reverse()
        .find((trace) => trace.url === url && !trace.status)
      if (match) match.status = String(response.status())
    })
  }
  page.on('pageerror', (error) => pageErrors.push(error.message || String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  const startedAt = Date.now()
  const result = { id: item.id, title: item.title, status: 'PASS', errors: [], durationMs: 0, screenshot: '' }
  try {
    await Promise.race([
      (async () => {
        await page.goto(new URL(item.route, BASE_URL).toString(), { waitUntil: 'domcontentloaded', timeout: 30000 })
        await waitForEntryPage(page)
        await item.run(page, refs)
        await item.verify(refs)
      })(),
      timeoutAfter(Number(args['case-timeout'] || 45000), `${item.id} 用例超时`)
    ])
    if (pageErrors.length || consoleErrors.length) {
      result.errors.push(...pageErrors.map((value) => `pageerror: ${value}`), ...consoleErrors.map((value) => `console: ${value}`))
    }
  } catch (error) {
    result.status = 'FAIL'
    result.errors.push(error?.stack || error?.message || String(error))
  } finally {
    result.durationMs = Date.now() - startedAt
    result.screenshot = path.join(outDir, `${item.id}.png`)
    if (args['trace-rpc-size'] && rpcTraces.length) {
      const top = rpcTraces
        .sort((left, right) => right.bytes - left.bytes)
        .slice(0, 8)
        .map(
          (trace) =>
            `${trace.status || '?'}:${trace.method || '?'}:${trace.tableName || '-'}:${trace.bytes}:${new URL(trace.url).pathname}`
        )
        .join(', ')
      console.log(`[RPC-SIZE | ${item.id}] ${top}`)
      const failedPayloads = rpcTraces
        .filter((trace) => /^5|^4/.test(trace.status || '') && trace.body)
        .slice(0, 5)
      for (const trace of failedPayloads) {
        console.log(
          `[RPC-PAYLOAD | ${item.id}] ${trace.status}:${trace.method || '?'}:${trace.tableName || '-'} ${trace.body}`
        )
      }
    }
    await page.screenshot({ path: result.screenshot, fullPage: true }).catch(() => undefined)
    await page.close()
  }
  return result
}

function sanitizeRpcBody(body) {
  try {
    const payload = JSON.parse(body)
    const data = Array.isArray(payload.data) ? payload.data.slice(0, 1) : payload.data
    return JSON.stringify({
      method: payload.method,
      tableName: payload.tableName,
      data
    }).slice(0, 4000)
  } catch {
    return String(body || '').slice(0, 1000)
  }
}

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
}

async function waitForEntryPage(page) {
  await page.locator('.information-import-page').waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('button', { name: '预检' }).waitFor({ state: 'visible', timeout: 30000 })
}

async function chooseEventName(page, textValue) {
  const eventButton = page.locator('.entry-event-button').filter({ hasText: textValue }).first()
  if (await eventButton.count().catch(() => 0)) {
    await eventButton.scrollIntoViewIfNeeded().catch(() => undefined)
    await eventButton.click()
  } else {
    await chooseSelectByLabel(page, '事件名称', textValue)
  }
  await page.waitForTimeout(300)
}

async function fillCowAutocomplete(page, cowNumber) {
  const item = formItem(page, '牛号')
  const input = item.locator('input').first()
  await input.click()
  await input.fill(cowNumber)
  const suggestion = page.locator('.el-autocomplete-suggestion li').filter({ hasText: cowNumber }).first()
  try {
    await suggestion.waitFor({ state: 'visible', timeout: 2500 })
    await suggestion.click()
  } catch {
    await page.keyboard.press('Escape').catch(() => undefined)
    await page.waitForTimeout(500)
    const currentValue = await input.inputValue().catch(() => '')
    if (!currentValue.includes(cowNumber)) {
      throw new Error(`牛号输入后未保留：期望 ${cowNumber}，实际 ${currentValue}`)
    }
  }
  await page.keyboard.press('Escape').catch(() => undefined)
  await page.waitForTimeout(150)
}

async function fillInputByLabel(page, label, value) {
  const input = formItem(page, label).locator('input, textarea').first()
  await input.waitFor({ state: 'visible', timeout: 10000 })
  await input.click()
  await input.fill(String(value))
  await input.press('Tab').catch(() => undefined)
  await page.waitForTimeout(120)
}

async function fillNumberByLabel(page, label, value) {
  const item = formItem(page, label)
  const input = item.locator('input').first()
  await input.waitFor({ state: 'visible', timeout: 10000 })
  await input.click()
  await input.fill(String(value))
  await input.press('Tab').catch(() => undefined)
  await page.waitForTimeout(120)
}

async function fillFirstNumberField(page, value) {
  const inputs = page.locator('.form-section:has-text("业务字段") .el-input-number input')
  const count = await inputs.count().catch(() => 0)
  if (!count) throw new Error('未找到体尺/体重数值输入框')
  const input = inputs.first()
  await input.scrollIntoViewIfNeeded().catch(() => undefined)
  await input.click()
  await input.fill(String(value))
  await input.press('Tab').catch(() => undefined)
  await page.waitForTimeout(120)
}

async function chooseSelectByLabel(page, label, optionText) {
  console.log(`[ENTRY-CLICK] select ${label} -> ${optionText}`)
  await page.keyboard.press('Escape').catch(() => undefined)
  await page.waitForTimeout(100)
  const item = formItem(page, label)
  const select = item.locator('.el-select').first()
  await select.waitFor({ state: 'visible', timeout: 10000 })
  await clickSelectControl(select)
  await selectOptionFromOpenedDropdown(page, item, optionText)
}

async function chooseOrCreateSelectByLabel(page, label, value) {
  console.log(`[ENTRY-CLICK] select/create ${label} -> ${value}`)
  await page.keyboard.press('Escape').catch(() => undefined)
  await page.waitForTimeout(100)
  const item = formItem(page, label)
  const select = item.locator('.el-select').first()
  await select.waitFor({ state: 'visible', timeout: 10000 })
  await clickSelectControl(select)
  const selected = await selectOptionFromOpenedDropdown(page, item, value, { allowCreate: true })
  if (!selected) throw new Error(`未能创建或选择下拉值：${label}=${value}`)
}

async function clickSelectControl(select) {
  const input = select.locator('input').first()
  try {
    await input.click({ timeout: 5000 })
  } catch {
    await input.click({ force: true, timeout: 5000 })
  }
}

async function selectOptionFromOpenedDropdown(page, formItemLocator, optionText, options = {}) {
  const value = String(optionText)
  await page.waitForTimeout(150)
  if (await clickVisibleDropdownItem(page, value)) return true

  const input = formItemLocator.locator('input').first()
  await input.click()
  await input.fill('')
  await input.fill(value)
  await page.waitForTimeout(250)
  if (await clickVisibleDropdownItem(page, value)) return true

  if (options.allowCreate) {
    await input.press('Enter')
    await page.waitForTimeout(300)
    const inputValue = await input.inputValue().catch(() => '')
    const selectedText = await formItemLocator.innerText().catch(() => '')
    return inputValue.includes(value) || selectedText.includes(value)
  }

  const visibleOptions = await page
    .locator('.el-select-dropdown:visible .el-select-dropdown__item:not(.is-disabled)')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean))
    .catch(() => [])
  throw new Error(`未找到下拉选项：${value}；可见选项：${visibleOptions.slice(0, 20).join(' | ')}`)
}

async function clickVisibleDropdownItem(page, optionText) {
  const dropdownItems = page.locator(
    '.el-select-dropdown:visible .el-select-dropdown__item:not(.is-disabled)'
  )
  const count = await dropdownItems.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const item = dropdownItems.nth(index)
    const text = (await item.innerText().catch(() => '')).trim()
    if (text && text.includes(optionText)) {
      await item.scrollIntoViewIfNeeded().catch(() => undefined)
      await item.click()
      await page.waitForTimeout(200)
      return true
    }
  }
  return false
}

function formItem(page, label) {
  return page.locator(`xpath=//div[contains(@class,"el-form-item")][.//*[contains(@class,"el-form-item__label") and contains(normalize-space(.), "${label}")]]`).first()
}

async function clickDryRunAndCommit(page) {
  const dryRunButton = page.getByRole('button', { name: '预检' })
  await dryRunButton.click()
  await waitForSuccessOrFailure(page, '预检', 8000)
  const commitButton = page.getByRole('button', { name: '提交入库' })
  await commitButton.click()
  await waitForSuccessOrFailure(page, '提交', 12000)
}

async function waitForSuccessOrFailure(page, action, timeout = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const messages = await page
      .locator('.el-message:visible')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          text: node.textContent?.trim() || '',
          className: node.getAttribute('class') || ''
        }))
      )
      .catch(() => [])
    const error = messages.find((item) => item.className.includes('error'))
    if (error) throw new Error(`${action}失败：${error.text}`)
    const successMessage = messages.some(
      (item) =>
        item.className.includes('success') &&
        (/预检完成|提交完成|写入\s*\d+\s*行/.test(item.text) || item.text.includes('完成'))
    )
    if (successMessage && (action !== '提交' || !(await isButtonLoading(page, '提交入库'))))
      return
    const resultText = await page.locator('.result-card').innerText().catch(() => '')
    if (action === '预检' && /总行数\s*1/.test(resultText) && /错误行\s*0/.test(resultText))
      return
    if (
      action === '提交' &&
      /写入行\s*\d+/.test(resultText) &&
      /错误行\s*0/.test(resultText) &&
      !(await isButtonLoading(page, '提交入库'))
    )
      return
    await page.waitForTimeout(250)
  }
  throw new Error(`${action}等待超时`)
}

async function isButtonLoading(page, name) {
  const button = page.getByRole('button', { name }).first()
  const className = await button.getAttribute('class').catch(() => '')
  const disabled = await button.isDisabled().catch(() => false)
  return className.includes('is-loading') || disabled
}

function makeStorageState(token) {
  const userStore = {
    language: 'zh',
    isLogin: true,
    isLock: false,
    lockPassword: '',
    info: {
      userId: 1,
      username: ADMIN_USER,
      userName: ADMIN_USER,
      realName: OPERATOR,
      roles: ['R_ADMIN']
    },
    searchHistory: [],
    accessToken: token,
    refreshToken: ''
  }
  return {
    cookies: [],
    origins: [
      {
        origin: new URL(BASE_URL).origin,
        localStorage: [
          { name: `sys-v${VERSION}-user`, value: JSON.stringify(userStore) },
          { name: 'sys-version', value: VERSION },
          { name: 'sys-theme', value: 'light' }
        ]
      }
    ]
  }
}

async function seedReferenceData() {
  const now = new Date().toISOString()
  const penA = `${RUN_ID}_PEN_A`
  const penB = `${RUN_ID}_PEN_B`
  await ensureFarmUnit(penA, `${RUN_ID} 验证圈舍A`)
  await ensurePenOnly(penB, `${RUN_ID} 验证圈舍B`)
  const seeded = {
    transferCow: `${RUN_ID}_TRANSFER`,
    exitCow: `${RUN_ID}_EXIT`,
    inseminationCow: `${RUN_ID}_INSEM`,
    pregnancyCow: `${RUN_ID}_PREG`,
    calvingCow: `${RUN_ID}_CALVING`,
    productionCow: `${RUN_ID}_PROD`
  }
  for (const cowNumber of Object.values(seeded)) {
    await seedCow(cowNumber, penA, now)
  }
  await seedLactationWindow(seeded.productionCow, now)
  return {
    entryCow: `${RUN_ID}_ENTRY`,
    ...seeded,
    penA,
    penB,
    penAName: `${RUN_ID} 验证圈舍A`,
    penBName: `${RUN_ID} 验证圈舍B`
  }
}

async function seedCow(cowNumber, penId, now) {
  const cowId = `animal-${cowNumber}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64)
  const earTagNumber = `${cowNumber}_E`
  await rpc('addTableData', {
    tableName: 'animal',
    data: [{
      id: cowId,
      animalId: cowId,
      animal_id: cowId,
      cowId,
      cow_id: cowId,
      animalNumber: cowNumber,
      animal_number: cowNumber,
      cowNumber,
      cow_number: cowNumber,
      earTagNumber,
      ear_tag_number: earTagNumber,
      species: '牛',
      breed: '西门塔尔牛',
      sex: '母',
      birthDate: '2022-01-02',
      birth_date: '2022-01-02',
      entryDate: '2024-01-01',
      entry_date: '2024-01-01',
      currentPenId: penId,
      current_pen_id: penId,
      currentUnitId: penId,
      current_unit_id: penId,
      currentPen: penId,
      current_pen: penId,
      status: '在群',
      createdAt: now,
      updatedAt: now
    }]
  })
  await rpc('addTableData', {
    tableName: 'cows',
    data: [{
      id: cowId,
      cowId,
      cow_id: cowId,
      animalId: cowId,
      animal_id: cowId,
      cowNumber,
      cow_number: cowNumber,
      animalNumber: cowNumber,
      animal_number: cowNumber,
      earTagNumber,
      ear_tag_number: earTagNumber,
      breed: '西门塔尔牛',
      gender: '母',
      sex: '母',
      birthDate: '2022-01-02',
      birth_date: '2022-01-02',
      type: '泌乳',
      cowType: '泌乳',
      cow_type: '泌乳',
      currentPen: penId,
      current_pen: penId,
      currentPenId: penId,
      current_pen_id: penId,
      currentUnitId: penId,
      current_unit_id: penId,
      status: '在群',
      pregnancy: false,
      parity: 1,
      notes: RUN_ID,
      createdAt: now,
      updatedAt: now
    }]
  })
  await rpc('addTableData', {
    tableName: 'animal_identifier',
    data: [{
      id: `identifier-${cowId}`,
      animalId: cowId,
      animal_id: cowId,
      identifierType: 'animal_number',
      identifier_type: 'animal_number',
      identifierValue: cowNumber,
      identifier_value: cowNumber,
      isPrimary: true,
      is_primary: true,
      createdAt: now,
      updatedAt: now
    }]
  })
  return { cowId, cowNumber }
}

async function seedLactationWindow(cowNumber, now) {
  const cowId = `animal-${cowNumber}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64)
  const calvingDate = dateOnly(new Date(Date.now() - 35 * 86400000))
  const eventId = `event-${cowNumber}-calving-1`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 96)
  await rpc('addTableData', {
    tableName: 'animal_event',
    data: [{
      id: eventId,
      animalId: cowId,
      animal_id: cowId,
      cowId,
      cow_id: cowId,
      animalNumber: cowNumber,
      animal_number: cowNumber,
      cowNumber,
      cow_number: cowNumber,
      eventType: 'calving',
      event_type: 'calving',
      eventCode: 'calving',
      event_code: 'calving',
      eventName: '产犊',
      event_name: '产犊',
      occurredAt: calvingDate,
      occurred_at: calvingDate,
      eventTime: calvingDate,
      event_time: calvingDate,
      productionDate: calvingDate,
      production_date: calvingDate,
      parityNo: 1,
      parity_no: 1,
      sourceType: 'entry_click_seed',
      source_type: 'entry_click_seed',
      sourceTable: 'validate-information-entry-clicks',
      source_table: 'validate-information-entry-clicks',
      sourceRecordId: eventId,
      source_record_id: eventId,
      operatorName: OPERATOR,
      operator_name: OPERATOR,
      details: { parity_no: 1, calving_date: calvingDate },
      customValues: { parity_no: 1, calving_date: calvingDate },
      custom_values: { parity_no: 1, calving_date: calvingDate },
      status: 'recorded',
      eventStatus: 'recorded',
      event_status: 'recorded',
      notes: RUN_ID,
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    }]
  })
  await rpc('addTableData', {
    tableName: 'parity_episode',
    data: [{
      id: `parity-${cowNumber}-1`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 96),
      animalId: cowId,
      animal_id: cowId,
      cowId,
      cow_id: cowId,
      animalNumber: cowNumber,
      animal_number: cowNumber,
      cowNumber,
      cow_number: cowNumber,
      parityNo: 1,
      parity_no: 1,
      startDate: calvingDate,
      start_date: calvingDate,
      startEventId: eventId,
      start_event_id: eventId,
      parityStatus: 'current',
      parity_status: 'current',
      isCurrent: true,
      is_current: true,
      sourceType: 'entry_click_seed',
      source_type: 'entry_click_seed',
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    }]
  })
  await rpc('addTableData', {
    tableName: 'lactation_episode',
    data: [{
      id: `lactation-${cowNumber}-1`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 96),
      animalId: cowId,
      animal_id: cowId,
      cowId,
      cow_id: cowId,
      animalNumber: cowNumber,
      animal_number: cowNumber,
      cowNumber,
      cow_number: cowNumber,
      lactationNo: 1,
      lactation_no: 1,
      parityNo: 1,
      parity_no: 1,
      startDate: calvingDate,
      start_date: calvingDate,
      status: 'current',
      sourceType: 'entry_click_seed',
      source_type: 'entry_click_seed',
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    }]
  })
}

function dateOnly(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

async function ensureFarmUnit(id, name) {
  const now = new Date().toISOString()
  await rpc('addTableData', {
    tableName: 'farm_unit',
    data: [{
      id,
      code: id,
      unitId: id,
      unit_id: id,
      name,
      unitName: name,
      unit_name: name,
      unitType: 'pen',
      unit_type: 'pen',
      capacity: 100,
      status: 'active',
      notes: RUN_ID,
      createdAt: now,
      updatedAt: now
    }]
  })
}

async function ensurePenOnly(id, name) {
  const now = new Date().toISOString()
  await rpc('addTableData', {
    tableName: 'pens',
    data: [{
      id,
      code: id,
      penCode: id,
      pen_code: id,
      name,
      penName: name,
      pen_name: name,
      category: '妊娠舍',
      categoryName: '妊娠舍',
      capacity: 100,
      status: '正常',
      isActive: true,
      is_active: true,
      notes: RUN_ID,
      createdAt: now,
      updatedAt: now
    }]
  })
}

async function cleanupClickData(prefix = RUN_ID) {
  const tables = [
    'operation-audit-logs',
    'derivation_recompute_job',
    'event_movement_detail',
    'event_reproduction_detail',
    'event_production_detail',
    'entry-events',
    'transfer-events',
    'exit-events',
    'breeding-events',
    'cow-events',
    'animal_event',
    'phenotype-records',
    'trait_observation',
    'milk-records',
    'milk_measurement',
    'milking_visit',
    'milking_session',
    'animal_pen_assignment',
    'farm_unit',
    'animal_parentage',
    'animal_identifier',
    'cows',
    'animal',
    'pens'
  ]
  for (const table of tables) {
    const rows = await rpc('getTableData', { tableName: table }).catch(() => [])
    for (const row of rows) {
      if (rowHasRunId(row, prefix)) {
        const id = text(row.id)
        if (id) await rpc('deleteTableRecord', { tableName: table, id }).catch(() => undefined)
      }
    }
  }
}

async function expectAny(tableName, predicate, message) {
  const started = Date.now()
  let sample = []
  while (Date.now() - started < ASSERT_TIMEOUT_MS) {
    const rows = await rpc('getTableData', { tableName })
    const matched = rows.find((row) => rowHasRunId(row) && predicate(row))
    if (matched) return matched
    sample = rows
      .filter((row) => rowHasRunId(row))
      .slice(0, 5)
      .map((row) => ({
        id: row.id,
        computedCowNumber: cowNumberOf(row),
        computedAnimalRef: animalRefOf(row),
        computedEventCode: eventCodeOf(row),
        ...row
      }))
    await sleep(500)
  }
  throw new Error(`${message}；表 ${tableName} 未匹配。样例：${JSON.stringify(sample)}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function login() {
  const res = await fetch(new URL('/api/auth/login', BASE_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: ADMIN_USER, password: getRequiredAdminPassword() })
  })
  const payload = await res.json()
  if (!res.ok || payload.code !== 200) throw new Error(`登录失败：${payload.msg || res.statusText}`)
  return payload.data.token
}

function getRequiredAdminPassword() {
  for (const name of ADMIN_PASSWORD_ENV_NAMES) {
    const value = process.env[name]
    if (value) return value
  }
  throw new Error(`缺少管理员密码环境变量：请设置 ${ADMIN_PASSWORD_ENV_NAMES.join(' 或 ')}`)
}

function requireDestructiveTestAllowed(action) {
  if (process.env[DESTRUCTIVE_TEST_CONFIRM_ENV] !== '1') {
    throw new Error(`${action} 会写入或删除验证数据；请设置 ${DESTRUCTIVE_TEST_CONFIRM_ENV}=1 后再运行`)
  }
}

async function rpc(method, payload = {}) {
  const res = await fetch(new URL('/api/db/rpc', BASE_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: globalThis.__ENTRY_CLICK_TOKEN__ || ''
    },
    body: JSON.stringify({ method, ...payload })
  })
  const data = await res.json()
  if (!res.ok || data.code !== 200) throw new Error(`RPC ${method}(${payload.tableName || ''}) 失败：${data.msg || res.statusText}`)
  return data.data
}

async function findBrowser() {
  for (const item of browserCandidates) {
    try {
      await fs.access(item)
      return item
    } catch {}
  }
  throw new Error('未找到 Chrome/Edge 可执行文件')
}

function rowHasRunId(row, prefix = RUN_ID) {
  return JSON.stringify(row || {}).includes(prefix)
}

function field(row, ...keys) {
  for (const key of keys) {
    if (!key) continue
    const direct = row?.[key]
    if (direct !== undefined && direct !== null && direct !== '') return String(direct).trim()
    const camel = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase())
    const camelValue = row?.[camel]
    if (camelValue !== undefined && camelValue !== null && camelValue !== '') return String(camelValue).trim()
    const snake = key.replace(/([A-Z])/g, '_$1').replace(/-/g, '_').toLowerCase()
    const snakeValue = row?.[snake]
    if (snakeValue !== undefined && snakeValue !== null && snakeValue !== '') return String(snakeValue).trim()
  }
  return ''
}

function detailsOf(row) {
  for (const value of [row?.details, row?.customValues, row?.custom_values]) {
    const parsed = parseObjectLike(value)
    if (parsed && Object.keys(parsed).length) return parsed
  }
  return {}
}

function parseObjectLike(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function cowNumberOf(row) {
  const details = detailsOf(row)
  return field(row, 'cowNumber', 'cow_number', 'animalNumber', 'animal_number') ||
    field(details, 'cowNumber', 'cow_number', 'animalNumber', 'animal_number', '牛号')
}

function animalRefOf(row) {
  return [
    cowNumberOf(row),
    field(row, 'animalId', 'animal_id', 'cowId', 'cow_id', 'id')
  ]
    .filter(Boolean)
    .join(' ')
}

function eventCodeOf(row) {
  const details = detailsOf(row)
  return field(row, 'eventType', 'event_type', 'eventCode', 'event_code') ||
    field(details, 'eventType', 'event_type', 'eventCode', 'event_code', '事件类型编码')
}

function linkedEventIdOf(row) {
  return field(row, 'eventId', 'event_id', 'id')
}

function toUnitOf(row) {
  return field(row, 'toUnitId', 'to_unit_id', 'toUnitCode', 'to_unit_code', 'unitId', 'unit_id', 'toPen', 'pen')
}

function currentPenOf(row) {
  return field(row, 'currentPen', 'current_pen', 'currentPenId', 'current_pen_id', 'currentUnitId', 'current_unit_id')
}

function valueOf(row) {
  return field(row, 'numericValue', 'numeric_value', 'value', 'milkYield', 'milk_yield', 'volume')
}

function text(value) {
  return String(value ?? '').trim()
}

function formatResult(result) {
  const errors = result.errors.length ? `\n  ${result.errors.map((line) => firstErrorLine(line)).join('\n  ')}` : ''
  return `[${result.status} | ${result.id} | ${result.durationMs}ms] ${result.title} screenshot=${result.screenshot}${errors}`
}

function firstErrorLine(value = '') {
  return String(value).split('\n').slice(0, 6).join('\n  ')
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
