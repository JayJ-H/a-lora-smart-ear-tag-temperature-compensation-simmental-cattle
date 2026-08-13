import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { validateDeploymentConsistency } from './validate-deployment-consistency.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env') })
dotenv.config({ path: path.join(projectRoot, 'ops/production/.env.prod') })

const baseUrl = (
  process.env.PRODUCTION_BASE_URL ||
  `http://127.0.0.1:${process.env.WEB_PORT || 9191}`
).replace(/\/$/, '')
const adminUser = process.env.PRODUCTION_ADMIN_USER || process.env.ADMIN_USER || ''
const adminPassword = process.env.PRODUCTION_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || ''

const PRODUCTION_BASELINE_DOMAINS = [
  {
    domain: '奶厅与泌乳性能',
    tables: ['milk_records', 'milk_quality_standards', 'lactation_curves']
  },
  {
    domain: '泌乳传感器与硬件集成',
    tables: [
      'sensor_status',
      'sensor_calibrations',
      'hardware_devices',
      'integration_protocols',
      'data_synchronizations'
    ]
  },
  {
    domain: '繁殖育种',
    tables: ['breeding_records', 'reproduction_cycles', 'breeding_events']
  },
  {
    domain: '组学闭环',
    tables: [
      'omics_samples',
      'omics_datasets',
      'omics_markers',
      'multi_omics_associations',
      'breeding_analyses'
    ]
  },
  {
    domain: '生产经营闭环',
    tables: [
      'feed_formulas',
      'feed_records',
      'feed_inventory',
      'cost_items',
      'revenue_items',
      'economic_analysis',
      'budget_plans',
      'kpi_dashboards',
      'kpi_dashboard_data',
      'device_maintenance'
    ]
  },
  {
    domain: '场内事件闭环',
    tables: ['entry_events', 'transfer_events', 'exit_events']
  },
  {
    domain: '操作审计闭环',
    tables: ['export_audit_logs', 'hardware_command_logs', 'breeding_decision_runs', 'operation_audit_logs']
  }
]

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let body = text
  try {
    body = JSON.parse(text)
  } catch {
    // Keep plain text body.
  }
  if (!response.ok || body?.code >= 400) {
    throw new Error(`${path} failed: HTTP ${response.status} ${text.slice(0, 200)}`)
  }
  return body
}

function unwrapApiData(body, label) {
  if (body && typeof body === 'object' && 'code' in body) {
    if (body.code >= 400) throw new Error(`${label} returned API code ${body.code}: ${body.msg || 'unknown error'}`)
    return body.data
  }
  return body
}

function validateSystemStatus(status) {
  if (!status || typeof status !== 'object') throw new Error('System status payload is empty')
  if (!status.backend?.ok) throw new Error('System status reports backend offline')
  if (!status.database?.ok) throw new Error(`System status reports database error: ${status.database?.error || 'unknown'}`)
  if (!status.dataFreshness) throw new Error('System status missing dataFreshness')
  if (!status.alerts) throw new Error('System status missing alerts')
  if (!status.readiness?.items?.length) throw new Error('System status missing readiness items')

  return {
    generatedAt: status.generatedAt,
    environment: status.environment,
    readiness: {
      level: status.readiness.level,
      percent: status.readiness.percent,
      risks: (status.readiness.risks || []).map((item) => item.label)
    },
    dataFreshness: {
      state: status.dataFreshness.state,
      totalCount: status.dataFreshness.totalCount,
      last24hCount: status.dataFreshness.last24hCount,
      ageMinutes: status.dataFreshness.ageMinutes,
      latest: status.dataFreshness.latest
    },
    alerts: {
      total: status.alerts.total,
      active: status.alerts.active,
      bySeverity: status.alerts.bySeverity,
      latest: status.alerts.latest
    }
  }
}

function statCount(statsData, tableName) {
  const stats = statsData?.data || statsData
  const dashed = tableName.replace(/_/g, '-')
  const value = stats?.[tableName] ?? stats?.[dashed]
  const count = Number(value)
  return Number.isFinite(count) ? count : 0
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function textIncludesAny(row, tokens) {
  const text = JSON.stringify(row || {}).toLowerCase()
  return tokens.some((token) => text.includes(String(token).toLowerCase()))
}

function rowId(row) {
  return String(row?.id ?? row?.rowId ?? '').trim()
}

function field(row, ...names) {
  for (const name of names) {
    const value = row?.[name]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function parseJsonLike(value, fallback = {}) {
  if (!value) return fallback
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function idSet(rows, selectors) {
  const values = new Set()
  for (const row of rows) {
    for (const selector of selectors) {
      const value = field(row, selector)
      if (value !== undefined && value !== null && value !== '') values.add(String(value))
    }
  }
  return values
}

function hasAny(set, values) {
  return values.some((value) => value !== undefined && value !== null && value !== '' && set.has(String(value)))
}

async function getTableRows(authHeaders, tableName) {
  const response = await requestJson('/api/db/rpc', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      method: 'getTableData',
      tableName
    })
  })
  return asArray(unwrapApiData(response, tableName))
}

function validateProductionBaselineTables(statsData) {
  const domains = PRODUCTION_BASELINE_DOMAINS.map((domain) => {
    const tables = domain.tables.map((table) => ({
      table,
      count: statCount(statsData, table),
      ok: statCount(statsData, table) > 0
    }))
    return {
      domain: domain.domain,
      ok: tables.every((item) => item.ok),
      tables
    }
  })

  const failedDomains = domains.filter((domain) => !domain.ok)
  if (failedDomains.length > 0) {
    const detail = failedDomains
      .map((domain) => {
        const emptyTables = domain.tables
          .filter((item) => !item.ok)
          .map((item) => `${item.table}=${item.count}`)
          .join(', ')
        return `${domain.domain}: ${emptyTables}`
      })
      .join('; ')
    throw new Error(`Production baseline data is incomplete. ${detail}`)
  }

  return domains
}

function getSyncConfiguration(sync) {
  return parseJsonLike(sync.configuration || sync.configurationJson || sync.configuration_json, {})
}

function getMapping(sync) {
  return getSyncConfiguration(sync).mapping || {}
}

function validateMilkingSynchronization(syncs) {
  const milkingSyncs = syncs.filter((sync) => {
    const configuration = getSyncConfiguration(sync)
    const text = `${sync.id} ${sync.sourceDevice} ${sync.targetSystem} ${sync.dataType} ${JSON.stringify(configuration)}`.toLowerCase()
    return text.includes('milk') || text.includes('milking') || text.includes('奶') || text.includes('泌乳')
  })
  if (!milkingSyncs.length) {
    throw new Error('No milking/parlor synchronization is visible in data_synchronizations')
  }

  const requiredFields = ['milk_volume', 'cow_id', 'timestamp']
  const acceptedMapping = milkingSyncs.find((sync) => {
    const mapping = getMapping(sync)
    const mappingText = JSON.stringify(mapping).toLowerCase()
    return requiredFields.every((field) => mappingText.includes(field))
  })
  if (!acceptedMapping) {
    throw new Error('Milking synchronization mapping must include milk_volume, cow_id and timestamp')
  }

  return {
    total: milkingSyncs.length,
    acceptedMappingId: acceptedMapping.id,
    mapping: getMapping(acceptedMapping)
  }
}

function assertCondition(ok, message) {
  if (!ok) throw new Error(message)
}

function validateMilkingChain({ cows, milkRecords, sensorStatus, sensorCalibrations, hardwareDevices, integrationProtocols, dataSynchronizations }) {
  const cowIds = idSet(cows, ['id'])
  const milkCowIds = idSet(milkRecords, ['cowId', 'cow_id'])
  const deviceIds = idSet(hardwareDevices, ['id'])
  const protocolIds = idSet(integrationProtocols, ['id'])
  const onlineDevices = hardwareDevices.filter(
    (device) =>
      ['online', 'active', 'running', 'connected'].includes(String(field(device, 'status') || '').toLowerCase()) &&
      textIncludesAny(device, ['milking', 'milk_volume', 'milk-meter', '奶厅', '挤奶', '奶量'])
  )
  const onlineDeviceIds = idSet(onlineDevices, ['id'])
  const milkingSyncs = dataSynchronizations.filter((sync) => textIncludesAny(sync, ['milk', 'milking', '奶', '泌乳']))
  const acceptedMapping = validateMilkingSynchronization(dataSynchronizations)
  const linkedMilkRecords = milkRecords.filter(
    (record) =>
      Number(field(record, 'volume', 'milkVolume', 'milk_volume') || 0) > 0 &&
      hasAny(cowIds, [field(record, 'cowId', 'cow_id')]) &&
      hasAny(onlineDeviceIds, [field(record, 'equipmentId', 'equipment_id')])
  )
  const linkedSensors = sensorStatus.filter(
    (sensor) =>
      hasAny(onlineDeviceIds, [field(sensor, 'deviceId', 'device_id')]) &&
      hasAny(cowIds, [field(sensor, 'cowId', 'cow_id')]) &&
      ['online', 'active', 'running', 'connected'].includes(String(field(sensor, 'status') || '').toLowerCase())
  )
  const linkedCalibrations = sensorCalibrations.filter((calibration) =>
    hasAny(onlineDeviceIds, [field(calibration, 'deviceId', 'device_id')])
  )
  const linkedSyncs = milkingSyncs.filter(
    (sync) =>
      hasAny(protocolIds, [field(sync, 'protocolId', 'protocol_id')]) &&
      hasAny(onlineDeviceIds, [field(sync, 'sourceDevice', 'source_device')]) &&
      ['active', 'ready', 'running', 'completed', 'success', 'idle', 'scheduled'].includes(
        String(field(sync, 'status') || '').toLowerCase()
      )
  )

  assertCondition(onlineDevices.length > 0, 'Milking chain requires at least one online parlor/milking device')
  assertCondition(linkedSyncs.length > 0, 'Milking chain requires synchronization linked to an online parlor device and protocol')
  assertCondition(linkedMilkRecords.length > 0, 'Milking chain requires milk_records linked to real cows and online parlor equipment')
  assertCondition(linkedSensors.length > 0, 'Milking chain requires online sensor_status linked to real cows and online parlor equipment')
  assertCondition(linkedCalibrations.length > 0, 'Milking chain requires sensor calibration records linked to parlor equipment')

  return {
    onlineParlorDevices: onlineDevices.length,
    linkedSyncs: linkedSyncs.length,
    linkedMilkRecords: linkedMilkRecords.length,
    linkedSensors: linkedSensors.length,
    linkedCalibrations: linkedCalibrations.length,
    acceptedMapping
  }
}

function validateOmicsBreedingChain({ cows, omicsSamples, omicsDatasets, omicsMarkers, multiOmicsAssociations, breedingAnalyses }) {
  const cowIds = idSet(cows, ['id'])
  const cowNumbers = idSet(cows, ['cowNumber', 'cow_number'])
  const sampleIds = idSet(omicsSamples, ['id'])
  const datasetIds = idSet(omicsDatasets, ['id'])
  const markerCodes = idSet(omicsMarkers, ['markerCode', 'marker_code'])
  const linkedSamples = omicsSamples.filter((sample) =>
    hasAny(cowIds, [field(sample, 'cowId', 'cow_id')]) || hasAny(cowNumbers, [field(sample, 'cowNumber', 'cow_number')])
  )
  const linkedDatasets = omicsDatasets.filter((dataset) => {
    const sampleIdsValue = asArray(parseJsonLike(field(dataset, 'sampleIds', 'sample_ids'), []))
    return sampleIdsValue.some((sampleId) => sampleIds.has(String(sampleId)))
  })
  const linkedDatasetIds = idSet(linkedDatasets, ['id'])
  const linkedMarkers = omicsMarkers.filter((marker) => hasAny(linkedDatasetIds, [field(marker, 'datasetId', 'dataset_id')]))
  const linkedAssociations = multiOmicsAssociations.filter((association) => {
    const candidateMarkers = asArray(parseJsonLike(field(association, 'candidateMarkers', 'candidate_markers'), []))
    const primaryOk = hasAny(linkedDatasetIds, [field(association, 'primaryDatasetId', 'primary_dataset_id')])
    const secondary = field(association, 'secondaryDatasetId', 'secondary_dataset_id')
    const secondaryOk = !secondary || hasAny(linkedDatasetIds, [secondary])
    const markerOk = !candidateMarkers.length || candidateMarkers.some((markerCode) => markerCodes.has(String(markerCode)))
    return primaryOk && secondaryOk && markerOk
  })
  const linkedAnalyses = breedingAnalyses.filter((analysis) => {
    const datasetIdsValue = asArray(parseJsonLike(field(analysis, 'datasetIds', 'dataset_ids'), []))
    const topCandidates = asArray(parseJsonLike(field(analysis, 'topCandidates', 'top_candidates'), []))
    const datasetOk = datasetIdsValue.some((datasetId) => linkedDatasetIds.has(String(datasetId)))
    const candidateOk = topCandidates.some(
      (candidate) =>
        hasAny(cowIds, [field(candidate, 'cowId', 'cow_id')]) ||
        hasAny(cowNumbers, [field(candidate, 'cowNumber', 'cow_number')])
    )
    return datasetOk && candidateOk && String(field(analysis, 'status') || '').toLowerCase() === 'completed'
  })

  assertCondition(linkedSamples.length > 0, 'Omics chain requires samples linked to real cows')
  assertCondition(linkedDatasets.length > 0, 'Omics chain requires datasets whose sample_ids reference real omics samples')
  assertCondition(linkedMarkers.length > 0, 'Omics chain requires markers linked to accepted datasets')
  assertCondition(linkedAssociations.length > 0, 'Omics chain requires associations linked to accepted datasets/markers')
  assertCondition(linkedAnalyses.length > 0, 'Omics chain requires completed breeding analyses linked to datasets and real candidates')

  return {
    linkedSamples: linkedSamples.length,
    linkedDatasets: linkedDatasets.length,
    linkedMarkers: linkedMarkers.length,
    linkedAssociations: linkedAssociations.length,
    linkedAnalyses: linkedAnalyses.length
  }
}

function validateReproductionChain({ cows, breedingRecords, reproductionCycles, breedingEvents }) {
  const cowIds = idSet(cows, ['id'])
  const cowNumbers = idSet(cows, ['cowNumber', 'cow_number'])
  const cowNumberById = new Map(cows.map((cow) => [String(field(cow, 'id')), String(field(cow, 'cowNumber', 'cow_number') || '')]))
  const linkedRecords = breedingRecords.filter((record) => hasAny(cowIds, [field(record, 'cowId', 'cow_id')]))
  const linkedCycles = reproductionCycles.filter((cycle) => hasAny(cowIds, [field(cycle, 'cowId', 'cow_id')]))
  const linkedEvents = breedingEvents.filter((event) => hasAny(cowNumbers, [field(event, 'cowNumber', 'cow_number')]))
  const eventTypes = new Set(linkedEvents.map((event) => String(field(event, 'eventType', 'event_type') || '').toLowerCase()))
  const cowsWithRecord = new Set(linkedRecords.map((record) => String(field(record, 'cowId', 'cow_id'))))
  const cowsWithCycle = new Set(linkedCycles.map((cycle) => String(field(cycle, 'cowId', 'cow_id'))))
  const cowsWithEvent = new Set(
    linkedEvents
      .map((event) => String(field(event, 'cowNumber', 'cow_number') || ''))
      .flatMap((cowNumber) =>
        cows
          .filter((cow) => String(field(cow, 'cowNumber', 'cow_number') || '') === cowNumber)
          .map((cow) => String(field(cow, 'id')))
      )
  )
  const closedCowIds = [...cowsWithRecord].filter((cowId) => cowsWithCycle.has(cowId) && cowsWithEvent.has(cowId))
  const hasBreedingEvent = [...eventTypes].some((type) => type.includes('配种') || type.includes('insemination'))
  const hasPregnancyOrCalvingEvent = [...eventTypes].some(
    (type) => type.includes('妊娠') || type.includes('pregnancy') || type.includes('产犊') || type.includes('calving')
  )

  assertCondition(linkedRecords.length > 0, 'Reproduction chain requires breeding_records linked to real cows')
  assertCondition(linkedCycles.length > 0, 'Reproduction chain requires reproduction_cycles linked to real cows')
  assertCondition(linkedEvents.length > 0, 'Reproduction chain requires breeding_events linked by cow_number')
  assertCondition(closedCowIds.length > 0, 'Reproduction chain requires at least one cow across records, cycles and events')
  assertCondition(hasBreedingEvent && hasPregnancyOrCalvingEvent, 'Reproduction chain requires breeding plus pregnancy/calving evidence')

  return {
    linkedRecords: linkedRecords.length,
    linkedCycles: linkedCycles.length,
    linkedEvents: linkedEvents.length,
    closedCowNumbers: closedCowIds.map((cowId) => cowNumberById.get(cowId)).filter(Boolean)
  }
}

function validateProductionOperationsChain({
  cows,
  hardwareDevices,
  feedFormulas,
  feedRecords,
  feedInventory,
  costItems,
  revenueItems,
  economicAnalyses,
  budgetPlans,
  kpiDashboards,
  kpiDashboardData,
  deviceMaintenance
}) {
  const cowIds = idSet(cows, ['id'])
  const deviceIds = idSet(hardwareDevices, ['id'])
  const formulaIds = idSet(feedFormulas, ['id'])
  const dashboardIds = idSet(kpiDashboards, ['id'])
  const activeFormulas = feedFormulas.filter((formula) => {
    const value = field(formula, 'isActive', 'is_active')
    return value === undefined || value === null || value === '' || Boolean(Number(value)) || value === true
  })
  const linkedFeedRecords = feedRecords.filter((record) => {
    const amount = Number(field(record, 'actualAmount', 'actual_amount') || 0)
    const formulaId = field(record, 'formulaId', 'formula_id')
    const cowId = field(record, 'cowId', 'cow_id')
    const penId = field(record, 'penId', 'pen_id')
    return amount > 0 && hasAny(formulaIds, [formulaId]) && (hasAny(cowIds, [cowId]) || Boolean(penId))
  })
  const totalActualFeed = linkedFeedRecords.reduce(
    (sum, record) => sum + Number(field(record, 'actualAmount', 'actual_amount') || 0),
    0
  )
  const inventoryStock = feedInventory.reduce(
    (sum, item) => sum + Number(field(item, 'currentStock', 'current_stock') || 0),
    0
  )
  const inventoryMinimum = feedInventory.reduce(
    (sum, item) => sum + Number(field(item, 'minimumStock', 'minimum_stock') || 0),
    0
  )
  const safeInventoryItems = feedInventory.filter(
    (item) => Number(field(item, 'currentStock', 'current_stock') || 0) > Number(field(item, 'minimumStock', 'minimum_stock') || 0)
  )
  const feedCosts = costItems.filter((item) => {
    const amount = Number(field(item, 'amount') || 0)
    return amount > 0 && textIncludesAny(item, ['feed', '饲料', 'tmr'])
  })
  const maintenanceCosts = costItems.filter((item) => {
    const amount = Number(field(item, 'amount') || 0)
    return amount > 0 && textIncludesAny(item, ['equipment', 'maintenance', '设备', '维护'])
  })
  const milkRevenue = revenueItems.filter((item) => {
    const amount = Number(field(item, 'amount') || 0)
    return amount > 0 && textIncludesAny(item, ['milk_sales', 'milk', '鲜奶', '水牛奶'])
  })
  const profitableAnalyses = economicAnalyses.filter((analysis) => {
    const summary = parseJsonLike(field(analysis, 'summary'), {})
    return Number(summary.totalRevenue || 0) > 0 && Number(summary.totalCost || 0) > 0
  })
  const activeBudgets = budgetPlans.filter((plan) => {
    const totalPlanned = Number(field(plan, 'totalPlanned', 'total_planned') || 0)
    const totalActual = Number(field(plan, 'totalActual', 'total_actual') || 0)
    return totalPlanned > 0 && totalActual > 0 && ['active', 'approved', 'completed'].includes(String(field(plan, 'status') || '').toLowerCase())
  })
  const linkedKpiData = kpiDashboardData.filter((row) => hasAny(dashboardIds, [field(row, 'dashboardId', 'dashboard_id')]))
  const linkedMaintenance = deviceMaintenance.filter((item) => hasAny(deviceIds, [field(item, 'deviceId', 'device_id')]))
  const openMaintenance = linkedMaintenance.filter(
    (item) => !['completed', 'cancelled'].includes(String(field(item, 'status') || '').toLowerCase())
  )
  const feedSyncs = linkedFeedRecords.filter((record) => textIncludesAny(record, ['production-seed', 'TMR', '库存', '成本']))
  const inventorySafetyDays = totalActualFeed > 0 ? Math.round(inventoryStock / totalActualFeed) : 0

  assertCondition(activeFormulas.length > 0, 'Production operations require active feed formulas')
  assertCondition(linkedFeedRecords.length > 0, 'Production operations require feed_records linked to formulas and cows or pens')
  assertCondition(safeInventoryItems.length > 0, 'Production operations require feed_inventory above minimum stock')
  assertCondition(feedCosts.length > 0, 'Production operations require feed cost_items')
  assertCondition(maintenanceCosts.length > 0, 'Production operations require equipment maintenance cost_items')
  assertCondition(milkRevenue.length > 0, 'Production operations require milk_sales revenue_items')
  assertCondition(profitableAnalyses.length > 0, 'Production operations require economic_analysis with total revenue and cost')
  assertCondition(activeBudgets.length > 0, 'Production operations require an active budget_plan with planned and actual totals')
  assertCondition(kpiDashboards.length > 0 && linkedKpiData.length > 0, 'Production operations require KPI dashboard and data linked by dashboard_id')
  assertCondition(linkedMaintenance.length > 0, 'Production operations require device_maintenance linked to hardware devices')
  assertCondition(feedSyncs.length > 0, 'Production operations require feed records with production source and inventory/cost notes')

  return {
    activeFormulas: activeFormulas.length,
    linkedFeedRecords: linkedFeedRecords.length,
    inventoryItems: feedInventory.length,
    safeInventoryItems: safeInventoryItems.length,
    inventorySafetyDays,
    feedCosts: feedCosts.length,
    maintenanceCosts: maintenanceCosts.length,
    milkRevenue: milkRevenue.length,
    profitableAnalyses: profitableAnalyses.length,
    activeBudgets: activeBudgets.length,
    linkedKpiData: linkedKpiData.length,
    linkedMaintenance: linkedMaintenance.length,
    openMaintenance: openMaintenance.length
  }
}

function jsonArrayField(row, ...names) {
  for (const name of names) {
    const value = field(row, name)
    const parsed = parseJsonLike(value, [])
    if (Array.isArray(parsed)) return parsed
  }
  return []
}

function validateProductionEventChain({ cows, entryEvents, transferEvents, exitEvents }) {
  const cowIds = idSet(cows, ['id'])
  const cowNumbers = idSet(cows, ['cowNumber', 'cow_number'])
  const linkedEntries = entryEvents.filter((event) => hasAny(cowNumbers, [field(event, 'cowNumber', 'cow_number')]) || jsonArrayField(event, 'cowIds', 'cow_ids').some((id) => cowIds.has(String(id))))
  const linkedTransfers = transferEvents.filter((event) => hasAny(cowNumbers, [field(event, 'cowNumber', 'cow_number')]) || jsonArrayField(event, 'cowIds', 'cow_ids').some((id) => cowIds.has(String(id))))
  const linkedExits = exitEvents.filter((event) => hasAny(cowNumbers, [field(event, 'cowNumber', 'cow_number')]) || jsonArrayField(event, 'cowIds', 'cow_ids').some((id) => cowIds.has(String(id))))
  const eventCowNumbers = new Set([
    ...linkedEntries.map((event) => String(field(event, 'cowNumber', 'cow_number') || '')),
    ...linkedTransfers.map((event) => String(field(event, 'cowNumber', 'cow_number') || '')),
    ...linkedExits.map((event) => String(field(event, 'cowNumber', 'cow_number') || ''))
  ].filter(Boolean))
  const hasOperator = [...entryEvents, ...transferEvents, ...exitEvents].every((event) => Boolean(field(event, 'recorder')))

  assertCondition(linkedEntries.length > 0, 'Production events require entry_events linked to real cows')
  assertCondition(linkedTransfers.length > 0, 'Production events require transfer_events linked to real cows')
  assertCondition(linkedExits.length > 0, 'Production events require exit_events linked to real cows')
  assertCondition(eventCowNumbers.size >= 2, 'Production events should cover multiple real cows, not a single isolated example')
  assertCondition(hasOperator, 'Production events require recorder/operator evidence')

  return {
    linkedEntries: linkedEntries.length,
    linkedTransfers: linkedTransfers.length,
    linkedExits: linkedExits.length,
    cowNumbers: [...eventCowNumbers]
  }
}

function validateOperationAuditChain({ cows, exportAuditLogs, hardwareCommandLogs, breedingDecisionRuns, operationAuditLogs }) {
  const cowIds = idSet(cows, ['id'])
  const hasCowTrace = (row) => jsonArrayField(row, 'cowIds', 'cow_ids').some((id) => cowIds.has(String(id)))
  const completedExports = exportAuditLogs.filter((row) =>
    String(field(row, 'status') || '').toLowerCase() === 'completed' &&
    Boolean(field(row, 'operator')) &&
    Boolean(field(row, 'fileHash', 'file_hash')) &&
    Number(field(row, 'rowCount', 'row_count') || 0) > 0 &&
    hasCowTrace(row)
  )
  const acknowledgedCommands = hardwareCommandLogs.filter((row) =>
    ['acknowledged', 'completed', 'executed', 'sent'].includes(String(field(row, 'status') || '').toLowerCase()) &&
    Boolean(field(row, 'operator')) &&
    Boolean(field(row, 'deviceId', 'device_id')) &&
    Boolean(field(row, 'commandType', 'command_type')) &&
    hasCowTrace(row)
  )
  const completedDecisions = breedingDecisionRuns.filter((row) =>
    String(field(row, 'status') || '').toLowerCase() === 'completed' &&
    Boolean(field(row, 'operator')) &&
    Boolean(field(row, 'runType', 'run_type')) &&
    Object.keys(parseJsonLike(field(row, 'parametersJson', 'parameters_json'), {})).length > 0 &&
    Object.keys(parseJsonLike(field(row, 'resultSnapshot', 'result_snapshot'), {})).length > 0 &&
    hasCowTrace(row)
  )
  const completedOperationAudits = operationAuditLogs.filter((row) =>
    String(field(row, 'status') || '').toLowerCase() === 'completed' &&
    Boolean(field(row, 'operator')) &&
    Boolean(field(row, 'actionType', 'action_type')) &&
    Boolean(field(row, 'targetType', 'target_type')) &&
    Boolean(field(row, 'targetId', 'target_id')) &&
    hasCowTrace(row)
  )

  assertCondition(completedExports.length >= 2, 'Operation audit requires cow info and cow events export audit logs')
  assertCondition(acknowledgedCommands.length > 0, 'Operation audit requires acknowledged hardware command logs')
  assertCondition(completedDecisions.length >= 3, 'Operation audit requires bull, female and mating breeding decision runs')
  assertCondition(completedOperationAudits.length > 0, 'Operation audit requires operation_audit_logs linked to target records and cows')

  return {
    completedExports: completedExports.length,
    acknowledgedCommands: acknowledgedCommands.length,
    completedDecisions: completedDecisions.length,
    completedOperationAudits: completedOperationAudits.length,
    operators: [...new Set([...completedExports, ...acknowledgedCommands, ...completedDecisions, ...completedOperationAudits].map((row) => String(field(row, 'operator') || '')).filter(Boolean))]
  }
}

function validateProductionBaselineManifest(manifests) {
  const requiredDomains = ['种质资源与系谱', '奶厅与泌乳性能', '泌乳传感器与硬件集成', '生产经营闭环', '场内事件闭环', '操作审计闭环', '繁殖育种', '组学闭环']
  const rows = manifests.filter(
    (row) =>
      String(field(row, 'sourceType', 'source_type') || '') === 'deterministic_production_seed' &&
      String(field(row, 'deterministicSeed', 'deterministic_seed') || '') === 'water-buffalo-production-v1'
  )
  const domains = new Set(rows.map((row) => String(field(row, 'domain') || '')))
  const missingDomains = requiredDomains.filter((domain) => !domains.has(domain))
  assertCondition(rows.length >= requiredDomains.length, 'Production baseline manifest requires deterministic seed rows')
  assertCondition(!missingDomains.length, `Production baseline manifest missing domains: ${missingDomains.join(', ')}`)
  return {
    rows: rows.length,
    sourceType: 'deterministic_production_seed',
    deterministicSeed: 'water-buffalo-production-v1',
    domains: [...domains],
    missingDomains
  }
}

async function validateProductionBaselineChains(authHeaders) {
  const [
    cows,
    productionBaselineManifests,
    milkRecords,
    sensorStatus,
    sensorCalibrations,
    hardwareDevices,
    integrationProtocols,
    dataSynchronizations,
    omicsSamples,
    omicsDatasets,
    omicsMarkers,
    multiOmicsAssociations,
    breedingAnalyses,
    breedingRecords,
    reproductionCycles,
    breedingEvents,
    feedFormulas,
    feedRecords,
    feedInventory,
    costItems,
    revenueItems,
    economicAnalyses,
    budgetPlans,
    kpiDashboards,
    kpiDashboardData,
    deviceMaintenance,
    entryEvents,
    transferEvents,
    exitEvents,
    exportAuditLogs,
    hardwareCommandLogs,
    breedingDecisionRuns,
    operationAuditLogs
  ] = await Promise.all([
    getTableRows(authHeaders, 'cows'),
    getTableRows(authHeaders, 'production_baseline_manifest'),
    getTableRows(authHeaders, 'milk_records'),
    getTableRows(authHeaders, 'sensor_status'),
    getTableRows(authHeaders, 'sensor_calibrations'),
    getTableRows(authHeaders, 'hardware_devices'),
    getTableRows(authHeaders, 'integration_protocols'),
    getTableRows(authHeaders, 'data_synchronizations'),
    getTableRows(authHeaders, 'omics_samples'),
    getTableRows(authHeaders, 'omics_datasets'),
    getTableRows(authHeaders, 'omics_markers'),
    getTableRows(authHeaders, 'multi_omics_associations'),
    getTableRows(authHeaders, 'breeding_analyses'),
    getTableRows(authHeaders, 'breeding_records'),
    getTableRows(authHeaders, 'reproduction_cycles'),
    getTableRows(authHeaders, 'breeding_events'),
    getTableRows(authHeaders, 'feed_formulas'),
    getTableRows(authHeaders, 'feed_records'),
    getTableRows(authHeaders, 'feed_inventory'),
    getTableRows(authHeaders, 'cost_items'),
    getTableRows(authHeaders, 'revenue_items'),
    getTableRows(authHeaders, 'economic_analysis'),
    getTableRows(authHeaders, 'budget_plans'),
    getTableRows(authHeaders, 'kpi_dashboards'),
    getTableRows(authHeaders, 'kpi_dashboard_data'),
    getTableRows(authHeaders, 'device_maintenance'),
    getTableRows(authHeaders, 'entry_events'),
    getTableRows(authHeaders, 'transfer_events'),
    getTableRows(authHeaders, 'exit_events'),
    getTableRows(authHeaders, 'export_audit_logs'),
    getTableRows(authHeaders, 'hardware_command_logs'),
    getTableRows(authHeaders, 'breeding_decision_runs'),
    getTableRows(authHeaders, 'operation_audit_logs')
  ])

  return {
    manifest: validateProductionBaselineManifest(productionBaselineManifests),
    milking: validateMilkingChain({
      cows,
      milkRecords,
      sensorStatus,
      sensorCalibrations,
      hardwareDevices,
      integrationProtocols,
      dataSynchronizations
    }),
    omicsBreeding: validateOmicsBreedingChain({
      cows,
      omicsSamples,
      omicsDatasets,
      omicsMarkers,
      multiOmicsAssociations,
      breedingAnalyses
    }),
    reproduction: validateReproductionChain({
      cows,
      breedingRecords,
      reproductionCycles,
      breedingEvents
    }),
    productionOperations: validateProductionOperationsChain({
      cows,
      hardwareDevices,
      feedFormulas,
      feedRecords,
      feedInventory,
      costItems,
      revenueItems,
      economicAnalyses,
      budgetPlans,
      kpiDashboards,
      kpiDashboardData,
      deviceMaintenance
    }),
    productionEvents: validateProductionEventChain({
      cows,
      entryEvents,
      transferEvents,
      exitEvents
    }),
    operationAudit: validateOperationAuditChain({
      cows,
      exportAuditLogs,
      hardwareCommandLogs,
      breedingDecisionRuns,
      operationAuditLogs
    })
  }
}

async function main() {
  const health = await requestJson('/api/health')
  const preAuthSystemStatus = unwrapApiData(await requestJson('/api/system/status'), 'system status')
  let token = ''
  const authMode = String(preAuthSystemStatus?.environment?.authMode || (adminUser && adminPassword ? 'strict' : '')).toLowerCase()

  if (authMode === 'strict' && (!adminUser || !adminPassword)) {
    throw new Error(
      'Production backend is in strict auth mode but no admin credentials were provided. Set PRODUCTION_ADMIN_USER/PRODUCTION_ADMIN_PASSWORD or configure ops/production/.env.prod.'
    )
  }

  if (adminUser && adminPassword) {
    const login = await requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ userName: adminUser, password: adminPassword })
    })
    token = login?.data?.token || ''
    if (!token) throw new Error('Login returned no token')
  }

  const authHeaders = token ? { Authorization: token } : {}
  const bearerHeaders = token ? { Authorization: `Bearer ${token}` } : {}
  let effectiveAuthHeaders = authHeaders
  let userInfo = null
  if (token) {
    try {
      userInfo = await requestJson('/api/user/info', { headers: authHeaders })
    } catch {
      userInfo = await requestJson('/api/user/info', { headers: bearerHeaders })
      effectiveAuthHeaders = bearerHeaders
    }
  }
  const stats = await requestJson('/api/db/rpc', {
      method: 'POST',
      headers: effectiveAuthHeaders,
      body: JSON.stringify({ method: 'getDataStats' })
    })
  const productionBaselineDomains = validateProductionBaselineTables(stats)
  const productionBaselineChains = await validateProductionBaselineChains(effectiveAuthHeaders)
  let systemStatusBody = await requestJson('/api/system/status', { headers: effectiveAuthHeaders }).catch(() => null)
  if (systemStatusBody?.data?.backend?.ok !== true && token) {
    systemStatusBody = await requestJson('/api/system/status', { headers: bearerHeaders }).catch(() => systemStatusBody)
    if (systemStatusBody?.data?.backend?.ok === true) effectiveAuthHeaders = bearerHeaders
  }
  const systemStatus = validateSystemStatus(unwrapApiData(systemStatusBody || await requestJson('/api/system/status'), 'system status'))
  const deploymentConsistency = await validateDeploymentConsistency({ baseUrl })

  console.log(JSON.stringify({ ok: true, baseUrl, health, systemStatus, userInfo, stats, productionBaselineDomains, productionBaselineChains, deploymentConsistency }, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, baseUrl, error: error.message }, null, 2))
  process.exitCode = 1
})
