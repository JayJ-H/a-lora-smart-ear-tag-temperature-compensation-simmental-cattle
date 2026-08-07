import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const [key, inlineValue] = arg.slice(2).split('=', 2)
    const next = argv[index + 1]
    if (inlineValue !== undefined) args[key] = inlineValue
    else if (next && !next.startsWith('--')) {
      args[key] = next
      index += 1
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

function normalizeBaseUrl(value) {
  return String(value || 'http://127.0.0.1:9191').replace(/\/+$/, '')
}

function dateKey(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dateAddKey(key, days) {
  const [year, month, day] = String(key).split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

function text(value) {
  return String(value ?? '').trim()
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function sameTextSql(left, right) {
  return `CAST(${left} AS CHAR) COLLATE utf8mb4_unicode_ci = CAST(${right} AS CHAR) COLLATE utf8mb4_unicode_ci`
}

function rowsByKey(rows, key) {
  return Object.fromEntries(rows.map((row) => [text(row[key]), row]))
}

async function queryAll(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params)
  return rows || []
}

async function queryOne(connection, sql, params = []) {
  const rows = await queryAll(connection, sql, params)
  return rows[0] || {}
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
  if (!password) return null
  const data = await requestJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userName, password })
  })
  return data?.token || null
}

function addCheck(checks, name, ok, details = {}) {
  checks.push({ name, ok: Boolean(ok), details })
}

function summarizeChecks(checks) {
  const failed = checks.filter((check) => !check.ok)
  return {
    ok: failed.length === 0,
    total: checks.length,
    failed: failed.length,
    failedChecks: failed.map((check) => ({ name: check.name, details: check.details }))
  }
}

async function validateDatabase(connection, window) {
  const checks = []
  const statusRows = await queryAll(
    connection,
    `SELECT status, COUNT(*) AS count
     FROM animal
     WHERE animal_number LIKE 'ACPT-%'
     GROUP BY status`
  )
  const statusCounts = rowsByKey(statusRows, 'status')
  const animalCount = statusRows.reduce((sum, row) => sum + number(row.count), 0)
  addCheck(checks, 'ACPT 牛档数量为 100', animalCount === 100, { animalCount, statusRows })
  for (const [status, minCount] of Object.entries({ 泌乳: 30, 干奶: 1, 妊娠: 1, 离群: 1 })) {
    addCheck(checks, `ACPT 状态覆盖 ${status}`, number(statusCounts[status]?.count) >= minCount, {
      count: number(statusCounts[status]?.count)
    })
  }

  const mirrorCounts = await queryOne(
    connection,
    `SELECT
       (SELECT COUNT(*) FROM animal WHERE animal_number LIKE 'ACPT-%') AS animal_count,
       (SELECT COUNT(*) FROM cows WHERE cow_number LIKE 'ACPT-%') AS cows_count,
       (SELECT COUNT(*) FROM trait_observation t JOIN animal a ON ${sameTextSql('a.id', 't.animal_id')} WHERE a.animal_number LIKE 'ACPT-%') AS trait_count,
       (SELECT COUNT(*) FROM phenotype_records WHERE cow_number LIKE 'ACPT-%') AS phenotype_count,
       (SELECT COUNT(*) FROM milk_measurement m JOIN animal a ON ${sameTextSql('a.id', 'm.animal_id')} WHERE a.animal_number LIKE 'ACPT-%') AS milk_count,
       (SELECT COUNT(*) FROM milk_records r JOIN animal a ON ${sameTextSql('a.id', 'r.cow_id')} WHERE a.animal_number LIKE 'ACPT-%') AS milk_legacy_count,
       (SELECT COUNT(*) FROM animal_event e JOIN animal a ON ${sameTextSql('a.id', 'e.animal_id')} WHERE a.animal_number LIKE 'ACPT-%') AS event_count,
       (SELECT COUNT(*) FROM cow_events c JOIN animal_event e ON ${sameTextSql('e.id', 'c.id')} JOIN animal a ON ${sameTextSql('a.id', 'e.animal_id')} WHERE a.animal_number LIKE 'ACPT-%') AS event_legacy_count`
  )
  addCheck(checks, '牛档标准表/兼容表一致', number(mirrorCounts.animal_count) === 100 && number(mirrorCounts.cows_count) === 100, mirrorCounts)
  addCheck(checks, '表型标准表/兼容表一致', number(mirrorCounts.trait_count) > 1000 && number(mirrorCounts.trait_count) === number(mirrorCounts.phenotype_count), mirrorCounts)
  addCheck(checks, '泌乳标准表/兼容表一致', number(mirrorCounts.milk_count) > 1800 && number(mirrorCounts.milk_count) === number(mirrorCounts.milk_legacy_count), mirrorCounts)
  addCheck(checks, '事件标准表/兼容表一致', number(mirrorCounts.event_count) >= 170 && number(mirrorCounts.event_count) === number(mirrorCounts.event_legacy_count), mirrorCounts)

  const milkWindow = await queryOne(
    connection,
    `SELECT COUNT(*) AS count, COUNT(DISTINCT m.animal_id) AS cow_count,
            MIN(m.production_date) AS min_date, MAX(m.production_date) AS max_date
     FROM milk_measurement m
     JOIN animal a ON ${sameTextSql('a.id', 'm.animal_id')}
     WHERE a.animal_number LIKE 'ACPT-%'
       AND m.source_type = 'production_acceptance_seed'`
  )
  addCheck(checks, '近 30 天产奶窗口存在', number(milkWindow.count) >= 1800 && String(milkWindow.min_date).slice(0, 10) === window.start30 && String(milkWindow.max_date).slice(0, 10) === window.yesterday, milkWindow)

  const targetMilkRows = await queryAll(
    connection,
    `SELECT a.animal_number, COUNT(m.id) AS row_count, COUNT(DISTINCT m.production_date) AS day_count,
            SUM(CASE WHEN m.shift_id = '早班' THEN 1 ELSE 0 END) AS morning_count,
            SUM(CASE WHEN m.shift_id = '晚班' THEN 1 ELSE 0 END) AS evening_count
     FROM animal a
     LEFT JOIN milk_measurement m ON ${sameTextSql('m.animal_id', 'a.id')} AND m.source_type = 'production_acceptance_seed'
     WHERE a.animal_number IN ('ACPT-0039','ACPT-0040','ACPT-0041','ACPT-0042','ACPT-0043')
     GROUP BY a.animal_number
     ORDER BY a.animal_number`
  )
  const targetMilk = rowsByKey(targetMilkRows, 'animal_number')
  addCheck(checks, '汇总无日明细场景存在', number(targetMilk['ACPT-0039']?.row_count) === 0, targetMilk['ACPT-0039'])
  addCheck(checks, '缺整日场景存在', number(targetMilk['ACPT-0040']?.day_count) === 28 && number(targetMilk['ACPT-0040']?.row_count) === 56, targetMilk['ACPT-0040'])
  addCheck(checks, '缺班次场景存在', number(targetMilk['ACPT-0041']?.day_count) === 30 && number(targetMilk['ACPT-0041']?.row_count) === 59, targetMilk['ACPT-0041'])
  addCheck(checks, '连续 7 天无产值场景存在', number(targetMilk['ACPT-0042']?.day_count) === 23, targetMilk['ACPT-0042'])
  addCheck(checks, '少于 2 次产值场景存在', number(targetMilk['ACPT-0043']?.row_count) === 1, targetMilk['ACPT-0043'])

  const sensors = await queryOne(
    connection,
    `SELECT COUNT(*) AS count, COUNT(DISTINCT s.cow_id) AS cow_count,
            SUM(CASE WHEN s.temperature < 34 OR s.steps < 80 THEN 1 ELSE 0 END) AS tag_suspect_count,
            SUM(CASE WHEN s.temperature >= 39.5 AND s.steps < 3500 THEN 1 ELSE 0 END) AS health_risk_count
     FROM sensors s
     JOIN animal a ON ${sameTextSql('a.id', 's.cow_id')}
     WHERE a.animal_number LIKE 'ACPT-%'`
  )
  addCheck(checks, '传感器覆盖 ACPT 牛', number(sensors.count) >= 100 && number(sensors.cow_count) === 100, sensors)
  addCheck(checks, '耳标疑似脱落和健康风险场景存在', number(sensors.tag_suspect_count) >= 4 && number(sensors.health_risk_count) >= 3, sensors)

  const sensorReadings = await queryOne(
    connection,
    `SELECT
       (SELECT COUNT(*)
        FROM sensor_reading sr
        JOIN animal a ON ${sameTextSql('a.id', 'sr.animal_id')}
        WHERE a.animal_number LIKE 'ACPT-%') AS v2_count,
       (SELECT COUNT(DISTINCT sr.animal_id)
        FROM sensor_reading sr
        JOIN animal a ON ${sameTextSql('a.id', 'sr.animal_id')}
        WHERE a.animal_number LIKE 'ACPT-%') AS v2_cow_count,
       (SELECT COUNT(*)
        FROM sensor_readings sr
        JOIN animal a ON ${sameTextSql('a.id', 'sr.cow_id')}
        WHERE a.animal_number LIKE 'ACPT-%') AS legacy_count,
       (SELECT COUNT(DISTINCT sr.cow_id)
        FROM sensor_readings sr
        JOIN animal a ON ${sameTextSql('a.id', 'sr.cow_id')}
        WHERE a.animal_number LIKE 'ACPT-%') AS legacy_cow_count,
       (SELECT COUNT(DISTINCT sr.metric_code)
        FROM sensor_reading sr
        JOIN animal a ON ${sameTextSql('a.id', 'sr.animal_id')}
        WHERE a.animal_number LIKE 'ACPT-%') AS metric_count`
  )
  addCheck(
    checks,
    '传感器标准读数/旧镜像覆盖 ACPT 牛',
    number(sensorReadings.v2_count) >= 1600 &&
      number(sensorReadings.legacy_count) >= 1600 &&
      number(sensorReadings.v2_cow_count) === 100 &&
      number(sensorReadings.legacy_cow_count) === 100 &&
      number(sensorReadings.metric_count) >= 2,
    sensorReadings
  )

  const alerts = await queryAll(
    connection,
    `SELECT
       al.alert_type,
       COUNT(*) AS count,
       GROUP_CONCAT(DISTINCT al.title ORDER BY al.title SEPARATOR '|') AS titles,
       GROUP_CONCAT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(al.payload, '$.kind')) ORDER BY JSON_UNQUOTE(JSON_EXTRACT(al.payload, '$.kind')) SEPARATOR '|') AS kinds,
       GROUP_CONCAT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(al.payload, '$.ruleCode')) ORDER BY JSON_UNQUOTE(JSON_EXTRACT(al.payload, '$.ruleCode')) SEPARATOR '|') AS rule_codes
     FROM alerts al
     JOIN animal a ON ${sameTextSql('a.id', 'al.cow_id')}
     WHERE a.animal_number LIKE 'ACPT-%'
     GROUP BY al.alert_type
     ORDER BY al.alert_type`
  )
  const alertCounts = rowsByKey(alerts, 'alert_type')
  const alertText = JSON.stringify(alerts)
  const alertScenarios = {
    '健康预警': /health|体温异常|temperature_high_steps_down/.test(alertText),
    '发情预测': /发情预测|temperature_activity_rise_dim_gt_305/.test(alertText),
    '待产预测': /妊娠末期待产|late_gestation_10_days/.test(alertText),
    '耳标异常': /疑似耳标脱落|tag_drop_suspected/.test(alertText)
  }
  for (const [label, ok] of Object.entries(alertScenarios)) {
    addCheck(checks, `预警场景存在 ${label}`, ok, { alerts })
  }

  const eventRows = await queryAll(
    connection,
    `SELECT event_type, COUNT(*) AS count
     FROM animal_event e
     JOIN animal a ON ${sameTextSql('a.id', 'e.animal_id')}
     WHERE a.animal_number LIKE 'ACPT-%'
     GROUP BY event_type`
  )
  const eventCounts = rowsByKey(eventRows, 'event_type')
  for (const eventType of ['entry', 'heat', 'insemination', 'pregnancy_check', 'treatment', 'transfer', 'exit']) {
    addCheck(checks, `事件场景存在 ${eventType}`, number(eventCounts[eventType]?.count) > 0, { eventRows })
  }

  const detailCounts = await queryOne(
    connection,
    `SELECT
       (SELECT COUNT(*)
        FROM event_movement_detail d
        JOIN animal_event e ON ${sameTextSql('e.id', 'd.event_id')}
        JOIN animal a ON ${sameTextSql('a.id', 'e.animal_id')}
        WHERE a.animal_number LIKE 'ACPT-%') AS movement_count,
       (SELECT COUNT(*)
        FROM event_reproduction_detail d
        JOIN animal_event e ON ${sameTextSql('e.id', 'd.event_id')}
        JOIN animal a ON ${sameTextSql('a.id', 'e.animal_id')}
        WHERE a.animal_number LIKE 'ACPT-%') AS reproduction_count,
       (SELECT COUNT(*)
        FROM event_health_detail d
        JOIN animal_event e ON ${sameTextSql('e.id', 'd.event_id')}
        JOIN animal a ON ${sameTextSql('a.id', 'e.animal_id')}
        WHERE a.animal_number LIKE 'ACPT-%') AS health_count,
       (SELECT COUNT(*)
        FROM event_medicine_detail d
        JOIN animal_event e ON ${sameTextSql('e.id', 'd.event_id')}
        JOIN animal a ON ${sameTextSql('a.id', 'e.animal_id')}
        WHERE a.animal_number LIKE 'ACPT-%') AS medicine_count`
  )
  addCheck(
    checks,
    '事件 v2 明细表覆盖移动/繁殖/健康/用药',
    number(detailCounts.movement_count) >= 100 &&
      number(detailCounts.reproduction_count) >= 60 &&
      number(detailCounts.health_count) >= 8 &&
      number(detailCounts.medicine_count) >= 8,
    detailCounts
  )

  const trace = await queryOne(
    connection,
    `SELECT
       (SELECT COUNT(*)
        FROM trait_observation t
        JOIN animal a ON ${sameTextSql('t.animal_id', 'a.id')}
        WHERE a.animal_number LIKE 'ACPT-%'
          AND (t.source_record_id IS NULL OR t.source_record_id = '')) AS trait_missing_source,
       (SELECT COUNT(*)
        FROM milk_measurement m
        JOIN animal a ON ${sameTextSql('m.animal_id', 'a.id')}
        WHERE a.animal_number LIKE 'ACPT-%'
          AND (m.source_record_id IS NULL OR m.source_record_id = '')) AS milk_missing_source`
  )
  addCheck(checks, '表型/泌乳追溯字段完整', number(trace.trait_missing_source) === 0 && number(trace.milk_missing_source) === 0, trace)

  const breeding = await queryOne(
    connection,
    `SELECT
       (SELECT COUNT(*) FROM omics_samples WHERE cow_number LIKE 'ACPT-%') AS omics_samples,
       (SELECT COUNT(*) FROM breeding_value_run WHERE id = 'acceptance-bv-run-001') AS bv_runs,
       (SELECT COUNT(*) FROM breeding_value WHERE run_id = 'acceptance-bv-run-001') AS bv_values`
  )
  addCheck(checks, '组学/育种最小数据存在', number(breeding.omics_samples) >= 18 && number(breeding.bv_runs) === 1 && number(breeding.bv_values) >= 18, breeding)

  return { checks, statusRows, mirrorCounts, milkWindow, targetMilkRows, sensors, sensorReadings, alerts, eventRows, detailCounts, breeding }
}

async function validateMissingReviewApi(baseUrl, token, window) {
  const checks = []
  if (!token) {
    addCheck(checks, '泌乳复核 API 登录', false, { message: 'Missing admin password/token' })
    return { checks, items: [], summary: {} }
  }
  const params = new URLSearchParams({
    startDate: window.start30,
    endDate: window.yesterday,
    expectedShifts: '早班,晚班'
  })
  const data = await requestJson(baseUrl, `/api/milk/missing-review?${params.toString()}`, {
    headers: { Authorization: token }
  })
  const items = Array.isArray(data?.items) ? data.items : []
  const byCow = new Map()
  for (const item of items) {
    const cowNumber = text(item.cowNumber)
    if (!byCow.has(cowNumber)) byCow.set(cowNumber, [])
    byCow.get(cowNumber).push(item)
  }
  const cow39 = byCow.get('ACPT-0039') || []
  const cow40 = byCow.get('ACPT-0040') || []
  const cow41 = byCow.get('ACPT-0041') || []
  const cow42 = byCow.get('ACPT-0042') || []
  const cow43 = byCow.get('ACPT-0043') || []
  addCheck(checks, '泌乳复核 API 返回缺失项', items.length > 0, { total: items.length, summary: data?.summary })
  addCheck(checks, '汇总待拆分进入复核', cow39.some((item) => item.missingKind === 'summary_only'), { cow39 })
  addCheck(checks, '缺整日进入复核且含前 5 天参考', cow40.filter((item) => item.missingKind === 'day').length >= 4 && cow40.every((item) => Array.isArray(item.previousDays) && item.previousDays.length === 5), { cow40 })
  addCheck(checks, '缺班次进入复核且含来源记录', cow41.some((item) => item.missingKind === 'shift' && item.expectedShift === '晚班' && item.sourceRecordIds?.length), { cow41 })
  addCheck(checks, '连续 7 天无产值不推荐', cow42.length === 0, { cow42 })
  addCheck(checks, '少于 2 次产值不推荐', cow43.length === 0, { cow43 })
  return { checks, items, summary: data?.summary || {} }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = await loadEnv()
  const today = dateKey(new Date())
  const yesterday = dateAddKey(today, -1)
  const start30 = dateAddKey(yesterday, -29)
  const window = { today, yesterday, start30 }
  const baseUrl = normalizeBaseUrl(args.url || env.PRODUCTION_BASE_URL || 'http://127.0.0.1:9191')
  const userName = String(args.user || env.SMOKE_USER || env.ADMIN_USER || 'admin')
  const password = String(args.password || env.SMOKE_PASSWORD || env.ADMIN_PASSWORD || '')
  const dbConfig = {
    host: env.MYSQL_AUDIT_HOST || env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_AUDIT_PORT || env.MYSQL_HOST_PORT || env.MYSQL_PORT || 9193),
    user: env.MYSQL_AUDIT_USER || env.MYSQL_USER || 'cattle_user',
    password: env.MYSQL_AUDIT_PASSWORD || env.MYSQL_PASSWORD || '',
    database: env.MYSQL_AUDIT_DATABASE || env.MYSQL_DATABASE || 'cattle_management',
    dateStrings: true
  }

  const connection = await mysql.createConnection(dbConfig)
  let dbResult
  try {
    dbResult = await validateDatabase(connection, window)
  } finally {
    await connection.end()
  }

  let apiResult = { checks: [], items: [], summary: {} }
  try {
    const token = await login(baseUrl, userName, password)
    apiResult = await validateMissingReviewApi(baseUrl, token, window)
  } catch (error) {
    addCheck(apiResult.checks, '泌乳复核 API 可访问', false, { message: error.message })
  }

  const checks = [...dbResult.checks, ...apiResult.checks]
  const summary = summarizeChecks(checks)
  const report = {
    ok: summary.ok,
    generatedAt: new Date().toISOString(),
    baseUrl,
    database: {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database
    },
    window,
    summary,
    databaseChecks: dbResult,
    missingReviewApi: {
      summary: apiResult.summary,
      itemCount: apiResult.items.length,
      targetCounts: {
        ACPT0039: apiResult.items.filter((item) => item.cowNumber === 'ACPT-0039').length,
        ACPT0040: apiResult.items.filter((item) => item.cowNumber === 'ACPT-0040').length,
        ACPT0041: apiResult.items.filter((item) => item.cowNumber === 'ACPT-0041').length,
        ACPT0042: apiResult.items.filter((item) => item.cowNumber === 'ACPT-0042').length,
        ACPT0043: apiResult.items.filter((item) => item.cowNumber === 'ACPT-0043').length
      }
    }
  }

  const outPath = path.resolve(projectRoot, args.out || path.join('artifacts', 'production-data-closure-report.json'))
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
  if (!summary.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

