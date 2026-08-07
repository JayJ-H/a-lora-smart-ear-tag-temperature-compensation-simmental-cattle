import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'

const rootDir = process.cwd()

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
      })
  )
}

const env = {
  ...readEnvFile(path.join(rootDir, '.env')),
  ...readEnvFile(path.join(rootDir, '运维', '生产配置', '.env.prod')),
  ...process.env
}

const baseUrl = String(env.ACCEPTANCE_BASE_URL || env.PRODUCTION_BASE_URL || 'http://127.0.0.1:9191').replace(/\/+$/, '')
const userName = String(env.PRODUCTION_ADMIN_USER || env.ADMIN_USER || 'admin')
const password = String(env.PRODUCTION_ADMIN_PASSWORD || env.ADMIN_PASSWORD || '')
const runStamp = new Date().toISOString().replace(/[:.]/g, '-')
const artifactDir = path.join(rootDir, 'artifacts', `e2e-${runStamp}`)

const checks = []

function addCheck(name, ok, details = {}) {
  const item = { name, ok: Boolean(ok), details }
  checks.push(item)
  if (!ok) {
    const message = typeof details === 'string' ? details : JSON.stringify(details)
    throw new Error(`${name}: ${message}`)
  }
  return item
}

function softCheck(name, ok, details = {}) {
  checks.push({ name, ok: Boolean(ok), details })
}

function assert(condition, message, details = undefined) {
  if (!condition) {
    const error = new Error(message)
    error.details = details
    throw error
  }
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let body = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Keep plain text for diagnostics.
  }
  if (!response.ok) {
    const error = new Error(`${options.method || 'GET'} ${pathname} HTTP ${response.status}`)
    error.details = body
    throw error
  }
  return body
}

function unwrapApi(body, label) {
  if (!body || typeof body !== 'object') return body
  if ('code' in body) {
    assert(Number(body.code) === 0 || Number(body.code) === 200, `${label} failed`, body)
    return unwrapApi(body.data, label)
  }
  return body
}

async function postJson(pathname, headers, data) {
  return unwrapApi(
    await request(pathname, {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    }),
    pathname
  )
}

function field(row, ...names) {
  for (const name of names) {
    const value = row?.[name]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function parseJsonLike(value, fallback = {}) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value
  const parsed = parseJsonLike(value, [])
  return Array.isArray(parsed) ? parsed : []
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      asArray(values)
        .flat()
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  )
}

function tableId(row) {
  return String(field(row, 'id') || '').trim()
}

function statusOf(row) {
  return String(field(row, 'status') || '').toLowerCase()
}

function cowIdsOf(row) {
  return uniqueStrings(field(row, 'cowIds', 'cow_ids'))
}

function jsonObjectField(row, ...names) {
  for (const name of names) {
    const value = field(row, name)
    const parsed = parseJsonLike(value, {})
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  }
  return {}
}

function idsFromSource(row, key) {
  const source = jsonObjectField(row, 'sourceRecordIds', 'source_record_ids')
  return uniqueStrings(source[key] || [])
}

function findById(rows, id) {
  return rows.find((row) => tableId(row) === String(id))
}

async function rpc(headers, method, payload = {}) {
  return postJson('/api/db/rpc', headers, { method, ...payload })
}

async function getTableRows(headers, tableName) {
  const rows = await rpc(headers, 'getTableData', { tableName })
  return Array.isArray(rows) ? rows : []
}

async function cowApi(headers, scope, method, args = []) {
  return postJson(`/api/cow/${scope}/${method}`, headers, { args })
}

function pickRows(rows, count) {
  return rows.slice(0, Math.max(1, count))
}

function selectAcceptanceCows(baselineRows, count = 5) {
  const eventCowNumbers = new Set(
    [...baselineRows.entryEvents, ...baselineRows.transferEvents, ...baselineRows.exitEvents]
      .map((row) => String(field(row, 'cowNumber', 'cow_number') || '').trim())
      .filter(Boolean)
  )
  const linkedCows = baselineRows.cows.filter((cow) => eventCowNumbers.has(String(field(cow, 'cowNumber', 'cow_number') || '').trim()))
  const activeCows = baselineRows.cows.filter((cow) => {
    const id = String(field(cow, 'id') || '')
    const status = String(field(cow, 'status') || '')
    const pen = String(field(cow, 'currentPen', 'current_pen') || '')
    return !id.startsWith('pedigree-') && !/外部系谱|系谱档案/.test(`${status} ${pen}`)
  })
  return pickRows(linkedCows.length >= 2 ? linkedCows : activeCows.length >= 2 ? activeCows : baselineRows.cows, count)
}

function cowTrace(row, knownCowIds) {
  return cowIdsOf(row).filter((id) => knownCowIds.has(String(id)))
}

function hasLinkedCowNumber(event, cowNumbers, cowIds) {
  const eventCowNumber = String(field(event, 'cowNumber', 'cow_number') || '')
  const eventCowIds = uniqueStrings(field(event, 'cowIds', 'cow_ids'))
  return cowNumbers.has(eventCowNumber) || eventCowIds.some((id) => cowIds.has(String(id)))
}

function validateEventLinkage({ cows, entryEvents, transferEvents, exitEvents }) {
  const cowIds = new Set(cows.map((cow) => String(field(cow, 'id') || '')).filter(Boolean))
  const cowNumbers = new Set(cows.map((cow) => String(field(cow, 'cowNumber', 'cow_number') || '')).filter(Boolean))
  const linkedEntries = entryEvents.filter((row) => hasLinkedCowNumber(row, cowNumbers, cowIds))
  const linkedTransfers = transferEvents.filter((row) => hasLinkedCowNumber(row, cowNumbers, cowIds))
  const linkedExits = exitEvents.filter((row) => hasLinkedCowNumber(row, cowNumbers, cowIds))
  addCheck('场内入场事件关联牛只', linkedEntries.length > 0, { linkedEntries: linkedEntries.length })
  addCheck('场内转群事件关联牛只', linkedTransfers.length > 0, { linkedTransfers: linkedTransfers.length })
  addCheck('场内离场事件关联牛只', linkedExits.length > 0, { linkedExits: linkedExits.length })
  addCheck('场内事件具备记录人', [...entryEvents, ...transferEvents, ...exitEvents].every((row) => Boolean(field(row, 'recorder'))), {
    entryEvents: entryEvents.length,
    transferEvents: transferEvents.length,
    exitEvents: exitEvents.length
  })
  return { linkedEntries: linkedEntries.length, linkedTransfers: linkedTransfers.length, linkedExits: linkedExits.length }
}

function validateExportRow(row, knownCowIds) {
  return (
    row &&
    statusOf(row) === 'completed' &&
    Boolean(field(row, 'operator')) &&
    Boolean(field(row, 'fileHash', 'file_hash')) &&
    Number(field(row, 'rowCount', 'row_count') || 0) > 0 &&
    cowTrace(row, knownCowIds).length > 0
  )
}

function parseXlsxRows(base64) {
  assert(base64, 'export response returned no XLSX content')
  const buffer = Buffer.from(base64, 'base64')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const firstSheet = workbook.SheetNames[0]
  assert(firstSheet, 'export workbook has no sheet')
  return {
    hash: createHash('sha256').update(buffer).digest('hex'),
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '' })
  }
}

function validateExportContent(apiResult, auditRow, requiredColumns = []) {
  const parsed = parseXlsxRows(apiResult?.fileContentBase64)
  const auditHash = String(field(auditRow, 'fileHash', 'file_hash') || '')
  const auditRowCount = Number(field(auditRow, 'rowCount', 'row_count') || 0)
  const columns = parsed.rows.length ? Object.keys(parsed.rows[0]) : []
  return {
    ok:
      parsed.rows.length === Number(apiResult?.rowCount || 0) &&
      parsed.rows.length === auditRowCount &&
      parsed.hash === String(apiResult?.fileHash || '') &&
      parsed.hash === auditHash &&
      requiredColumns.every((column) => columns.includes(column)),
    rowCount: parsed.rows.length,
    hash: parsed.hash,
    auditHash,
    columns
  }
}

function validateDecisionRow(row, expectedType, knownCowIds) {
  const parameters = jsonObjectField(row, 'parametersJson', 'parameters_json')
  const result = jsonObjectField(row, 'resultSnapshot', 'result_snapshot')
  return (
    row &&
    statusOf(row) === 'completed' &&
    String(field(row, 'runType', 'run_type')) === expectedType &&
    Boolean(field(row, 'operator')) &&
    parameters.computedBy === 'mysql-backend' &&
    Object.keys(parameters).length > 0 &&
    Object.keys(result).length > 0 &&
    cowTrace(row, knownCowIds).length > 0 &&
    Number(field(row, 'durationMs', 'duration_ms') || 0) >= 0
  )
}

function decisionCowNumbers(row) {
  const result = jsonObjectField(row, 'resultSnapshot', 'result_snapshot')
  const rankingNumbers = asArray(result.rankings || result.top).map((item) => item.cowNumber)
  const pairingNumbers = asArray(result.pairings).flatMap((item) => [item.femaleCowNumber, item.bullCowNumber])
  return uniqueStrings([...rankingNumbers, ...pairingNumbers])
}

function validateHardwareRow(row, knownCowIds) {
  return (
    row &&
    ['acknowledged', 'completed', 'executed', 'sent'].includes(statusOf(row)) &&
    Boolean(field(row, 'deviceId', 'device_id')) &&
    Boolean(field(row, 'commandType', 'command_type')) &&
    Boolean(field(row, 'operator')) &&
    cowTrace(row, knownCowIds).length > 0
  )
}

function validateOperationAuditRows(rows, targetIds, hardwareCommandId) {
  const matchedTargets = targetIds.filter((id) =>
    rows.some((row) => String(field(row, 'targetId', 'target_id')) === String(id) && statusOf(row) === 'completed')
  )
  const hardwareSource = rows.some((row) => idsFromSource(row, 'hardware_command_logs').includes(String(hardwareCommandId)))
  addCheck('操作审计覆盖导出与育种决策记录', matchedTargets.length === targetIds.length, {
    expectedTargets: targetIds,
    matchedTargets
  })
  addCheck('操作审计覆盖硬件命令源记录', hardwareSource, { hardwareCommandId })
}

function buildDecisionRequest(runType, title, runId) {
  return {
    runType,
    title,
    operator: 'acceptance-admin',
    status: 'completed',
    computeFromDatabase: true,
    parameters: {
      acceptanceRunId: runId,
      primaryTrait: 'score',
      primaryDirection: 'desc',
      secondaryTrait: runType === 'mating_plan' ? 'pedigreeScore' : 'genomicScore',
      secondaryDirection: 'desc',
      minReliability: 0.68,
      excludeCloseKinship: true
    }
  }
}

async function runProductionActions(headers, baselineRows) {
  const cows = baselineRows.cows
  const selectedCows = selectAcceptanceCows(baselineRows, 5)
  const cowIds = selectedCows.map((cow) => field(cow, 'id')).filter(Boolean)
  const cowNumbers = selectedCows.map((cow) => field(cow, 'cowNumber', 'cow_number')).filter(Boolean)
  const runId = `acceptance-${Date.now()}`
  const device =
    baselineRows.hardwareDevices.find((row) => String(field(row, 'status') || '').toLowerCase() === 'online') ||
    baselineRows.hardwareDevices[0]
  const syncIds = pickRows(baselineRows.dataSynchronizations, 3).map(tableId).filter(Boolean)
  const sensorStatusIds = pickRows(baselineRows.sensorStatus, 3).map(tableId).filter(Boolean)

  addCheck('验收动作存在可用牛只', cowIds.length >= 2, { cowIds, cowNumbers })
  addCheck('验收动作存在硬件设备', Boolean(device), { hardwareDevices: baselineRows.hardwareDevices.length })

  const cowInfoExport = await cowApi(headers, 'export', 'exportCowInfo', [
    {
      format: 'xlsx',
      fileName: `acceptance-cow-info-${runId}.xlsx`,
      cowIds,
      columns: ['cow_number', 'breed', 'gender', 'current_pen', 'status'],
      acceptanceRunId: runId
    }
  ])
  const cowEventsExport = await cowApi(headers, 'export', 'exportCowEvents', [
    {
      format: 'xlsx',
      fileName: `acceptance-cow-events-${runId}.xlsx`,
      cowIds,
      cowNumbers,
      acceptanceRunId: runId
    }
  ])
  const hardwareCommand = await cowApi(headers, '硬件', 'sendDeviceCommand', [
    field(device, 'id'),
    {
      commandId: `acceptance-hw-${runId}`,
      type: 'parlor_sync',
      priority: 'high',
      cowIds,
      synchronizationIds: syncIds,
      sensorStatusIds,
      parameters: {
        acceptanceRunId: runId,
        action: 'sync_milking_meter',
        source: 'production_acceptance'
      }
    }
  ])
  const decisionTypes = [
    ['bull_ranking', '候选公牛排行榜验收运行'],
    ['female_ranking', '候选母牛排行榜验收运行'],
    ['mating_plan', '选配方案排行榜验收运行']
  ]
  const decisions = []
  for (const [runType, title] of decisionTypes) {
    decisions.push(
      await cowApi(headers, 'breedingDecision', 'runBreedingDecision', [
        buildDecisionRequest(runType, title, runId)
      ])
    )
  }

  return {
    runId,
    cowIds,
    cowNumbers,
    cowInfoExport,
    cowEventsExport,
    hardwareCommand,
    decisions
  }
}

async function validateOmics(headers) {
  const health = unwrapApi(await request('/api/omics/health', { headers }), 'omics health')
  addCheck('组学服务健康', health?.status === 'ok' && health?.upstream?.status === 'ok', health)
  const catalog = unwrapApi(await request('/api/omics/modules/catalog', { headers }), 'omics catalog')
  addCheck('组学模块目录完整', Array.isArray(catalog) && catalog.length === 22, { catalogCount: catalog?.length })
  const pcaModule = catalog.find((item) => item.id === 'pca')
  addCheck('PCA 参数 schema 可见', Array.isArray(pcaModule?.parameterSchema) && pcaModule.parameterSchema.length >= 5, {
    parameterCount: pcaModule?.parameterSchema?.length || 0
  })

  const moduleRun = await postJson('/api/omics/modules/run', headers, {
    moduleId: 'pca',
    trait: '泌乳量',
    repositoryId: 'omics-datasets',
    groupBy: 'phenotype_group',
    parameters: {
      nComponents: 3,
      svdSolver: 'randomized',
      iteratedPower: 5,
      whiten: false,
      randomState: 20260531,
      acceptanceRun: true,
      parameterSchemaSnapshot: pcaModule.parameterSchema
    }
  })
  addCheck('组学模块真实运行成功', moduleRun?.status === '已完成' && Array.isArray(moduleRun.metrics) && moduleRun.metrics.length > 0, {
    id: moduleRun?.id,
    status: moduleRun?.status,
    metrics: moduleRun?.metrics?.length || 0,
    artifacts: moduleRun?.artifacts?.length || 0,
    operator: moduleRun?.operator,
    durationMs: moduleRun?.durationMs
  })
  addCheck('组学模块参数进入执行层', Number(moduleRun?.parameters?.effectiveParameters?.nComponents) === 3, {
    effectiveParameters: moduleRun?.parameters?.effectiveParameters
  })

  const workflowRun = await postJson('/api/omics/workflows/run', headers, {
    workflowId: 'acceptance-omics-workflow',
    workflowName: '验收三步组学工作流',
    trait: '泌乳量',
    repositoryIds: ['omics-datasets'],
    moduleIds: ['pca', 'random-forest', 'kegg'],
    steps: [
      { moduleId: 'pca', order: 1, parameters: { nComponents: 3, svdSolver: 'randomized', iteratedPower: 5, randomState: 20260531 } },
      { moduleId: 'random-forest', order: 2, parameters: { nEstimators: 80, maxDepth: 6, maxFeatures: 'sqrt', oobScore: true, randomState: 20260531 } },
      { moduleId: 'kegg', order: 3, parameters: { topN: 12, minOverlap: 1, fdrCutoff: 0.2 } }
    ],
    parameters: {
      groupBy: 'phenotype_group',
      acceptanceRun: true
    }
  })
  addCheck('组学工作流真实运行成功', workflowRun?.status === '已完成' && workflowRun?.moduleRunIds?.length === 3, {
    id: workflowRun?.id,
    moduleRunIds: workflowRun?.moduleRunIds,
    artifacts: workflowRun?.artifacts?.length || 0,
    durationMs: workflowRun?.durationMs
  })

  const moduleResults = unwrapApi(await request('/api/omics/modules/results?limit=10', { headers }), 'module results')
  const workflowResults = unwrapApi(await request('/api/omics/workflows/results?limit=10', { headers }), 'workflow results')
  addCheck('组学模块结果可回看', Array.isArray(moduleResults) && moduleResults.some((row) => row.id === moduleRun.id), {
    moduleRunId: moduleRun.id,
    returned: moduleResults?.length || 0
  })
  addCheck('组学工作流结果可回看', Array.isArray(workflowResults) && workflowResults.some((row) => row.id === workflowRun.id), {
    workflowRunId: workflowRun.id,
    returned: workflowResults?.length || 0
  })

  return { health, catalogCount: catalog.length, moduleRun, workflowRun }
}

function writeReports(summary) {
  fs.mkdirSync(artifactDir, { recursive: true })
  const jsonPath = path.join(artifactDir, 'production-acceptance.json')
  const mdPath = path.join(artifactDir, 'production-acceptance.md')
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8')
  const lines = [
    '# 牛只健康管理系统生产验收报告',
    '',
    `- Base URL: ${summary.baseUrl}`,
    `- 运行时间: ${summary.generatedAt}`,
    `- 结论: ${summary.ok ? '通过' : '未通过'}`,
    `- 检查项: ${summary.checks.filter((item) => item.ok).length}/${summary.checks.length}`,
    '',
    '## 检查明细',
    '',
    ...summary.checks.map((item) => `- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}: \`${JSON.stringify(item.details)}\``),
    '',
    '## 关键输出',
    '',
    `- 导出审计: ${summary.actions?.cowInfoExport?.auditId || '-'}, ${summary.actions?.cowEventsExport?.auditId || '-'}`,
    `- 硬件命令: ${summary.actions?.hardwareCommand?.commandId || '-'}`,
    `- 智能育种运行: ${(summary.actions?.decisions || []).map((item) => item.id).join(', ') || '-'}`,
    `- 组学模块: ${summary.omics?.moduleRun?.id || '-'}`,
    `- 组学工作流: ${summary.omics?.workflowRun?.id || '-'}`
  ]
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8')
  return { jsonPath, mdPath }
}

async function main() {
  assert(password, 'ADMIN_PASSWORD is required. Set it in 运维/生产配置/.env.prod or environment.')

  const health = unwrapApi(await request('/api/health'), 'health')
  addCheck('后端健康接口可用', health?.status === 'ok', health)
  const systemStatus = unwrapApi(await request('/api/system/status'), 'system status')
  addCheck('系统状态可用', Boolean(systemStatus?.backend?.ok && systemStatus?.database?.ok), {
    backend: systemStatus?.backend,
    database: systemStatus?.database,
    readiness: systemStatus?.readiness
  })

  const login = unwrapApi(
    await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ userName, password })
    }),
    'login'
  )
  assert(login?.token, 'login returned no token')
  const headers = { authorization: `Bearer ${login.token}` }
  const userInfo = unwrapApi(await request('/api/user/info', { headers }), 'user info')
  addCheck('管理员登录可追溯', Boolean(userInfo?.userName), { userName: userInfo?.userName, roles: userInfo?.roles })

  const baselineRows = {
    cows: await getTableRows(headers, 'cows'),
    entryEvents: await getTableRows(headers, 'entry_events'),
    transferEvents: await getTableRows(headers, 'transfer_events'),
    exitEvents: await getTableRows(headers, 'exit_events'),
    hardwareDevices: await getTableRows(headers, 'hardware_devices'),
    dataSynchronizations: await getTableRows(headers, 'data_synchronizations'),
    sensorStatus: await getTableRows(headers, 'sensor_status')
  }
  addCheck('基础牛只数据存在', baselineRows.cows.length > 0, { cows: baselineRows.cows.length })
  const eventLinkage = validateEventLinkage(baselineRows)
  const actions = await runProductionActions(headers, baselineRows)
  addCheck('导出/硬件/育种动作接口均返回业务编号', Boolean(actions.cowInfoExport?.auditId && actions.cowEventsExport?.auditId && actions.hardwareCommand?.commandId && actions.decisions.length === 3), actions)

  const [exportAuditLogs, hardwareCommandLogs, breedingDecisionRuns, operationAuditLogs] = await Promise.all([
    getTableRows(headers, 'export_audit_logs'),
    getTableRows(headers, 'hardware_command_logs'),
    getTableRows(headers, 'breeding_decision_runs'),
    getTableRows(headers, 'operation_audit_logs')
  ])
  const knownCowIds = new Set(baselineRows.cows.map((cow) => String(field(cow, 'id') || '')).filter(Boolean))
  const cowInfoExportRow = findById(exportAuditLogs, actions.cowInfoExport.auditId)
  const cowEventsExportRow = findById(exportAuditLogs, actions.cowEventsExport.auditId)
  const hardwareRow = findById(hardwareCommandLogs, actions.hardwareCommand.commandId)
  const decisionRows = actions.decisions.map((item) => findById(breedingDecisionRuns, item.id))

  addCheck('牛只信息导出审计落库', validateExportRow(cowInfoExportRow, knownCowIds), cowInfoExportRow)
  addCheck('牛只事件导出审计落库', validateExportRow(cowEventsExportRow, knownCowIds), cowEventsExportRow)
  addCheck('牛只信息导出 XLSX 内容可解析', validateExportContent(actions.cowInfoExport, cowInfoExportRow, ['cow_number', 'breed', 'gender']).ok, validateExportContent(actions.cowInfoExport, cowInfoExportRow, ['cow_number', 'breed', 'gender']))
  addCheck('牛只事件导出 XLSX 内容可解析', validateExportContent(actions.cowEventsExport, cowEventsExportRow, ['event_table', 'cow_number']).ok, validateExportContent(actions.cowEventsExport, cowEventsExportRow, ['event_table', 'cow_number']))
  addCheck('奶厅硬件命令审计落库', validateHardwareRow(hardwareRow, knownCowIds), hardwareRow)
  for (const expectedType of ['bull_ranking', 'female_ranking', 'mating_plan']) {
    const row = decisionRows.find((item) => String(field(item, 'runType', 'run_type')) === expectedType)
    addCheck(`智能育种 ${expectedType} 决策落库`, validateDecisionRow(row, expectedType, knownCowIds), row)
    if (expectedType === 'female_ranking') {
      const numbers = decisionCowNumbers(row)
      addCheck('候选母牛排行榜未混入公牛编号', numbers.length > 0 && numbers.every((value) => !String(value).startsWith('BULL-')), { numbers })
    }
    if (expectedType === 'bull_ranking') {
      const numbers = decisionCowNumbers(row)
      addCheck('候选公牛排行榜仅输出公牛编号', numbers.length > 0 && numbers.every((value) => String(value).startsWith('BULL-')), { numbers })
    }
  }
  validateOperationAuditRows(
    operationAuditLogs,
    [actions.cowInfoExport.auditId, actions.cowEventsExport.auditId, ...actions.decisions.map((item) => item.id)],
    actions.hardwareCommand.commandId
  )

  const omics = await validateOmics(headers)
  const stats = await rpc(headers, 'getDataStats')
  softCheck('数据库统计可读取', Boolean(stats && typeof stats === 'object'), stats)

  return {
    ok: checks.every((item) => item.ok),
    baseUrl,
    generatedAt: new Date().toISOString(),
    userName,
    health,
    systemStatus: {
      readiness: systemStatus?.readiness,
      database: systemStatus?.database,
      dataFreshness: systemStatus?.dataFreshness,
      alerts: systemStatus?.alerts
    },
    eventLinkage,
    actions,
    omics,
    stats,
    checks
  }
}

main()
  .then((summary) => {
    const paths = writeReports(summary)
    console.log(JSON.stringify({ ...summary, artifacts: paths }, null, 2))
    if (!summary.ok) process.exitCode = 1
  })
  .catch((error) => {
    const summary = {
      ok: false,
      baseUrl,
      generatedAt: new Date().toISOString(),
      error: error.message,
      details: error.details,
      checks
    }
    const paths = writeReports(summary)
    console.error(JSON.stringify({ ...summary, artifacts: paths }, null, 2))
    process.exitCode = 1
  })
