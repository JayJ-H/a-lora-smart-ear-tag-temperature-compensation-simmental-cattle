import * as databaseService from '@/services/数据库'
import type { CowBasic, ExtendedSensorData, MilkRecord } from '@/types/cow'
import {
  buildUnifiedDataContext,
  loadUnifiedMilkRecords,
  loadUnifiedPhenotypeRecords,
  loadUnifiedReproductionEvents
} from '@/services/unified-records'
import { buildCowReferenceContext, resolveCowRef } from '@/utils/cow-reference'
import { formatDateOnly } from '@/utils/date-display'
import { normalizeCattleBreedOrDefault } from '@/utils/cattle-breeds'

export interface PlatformSnapshot {
  cows: CowBasic[]
  sensors: ExtendedSensorData[]
  milkRecords: MilkRecord[]
  entryEvents?: Record<string, any>[]
  transferEvents?: Record<string, any>[]
  exitEvents?: Record<string, any>[]
  breedingRecords: Record<string, any>[]
  reproductionCycles?: Record<string, any>[]
  breedingEvents?: Record<string, any>[]
  veterinaryEvents?: Record<string, any>[]
  alerts: Record<string, any>[]
  healthScores: Record<string, any>[]
  sensorStatus?: Record<string, any>[]
  sensorCalibrations?: Record<string, any>[]
  phenotypeRecords?: Record<string, any>[]
  hardwareDevices?: Record<string, any>[]
  integrationProtocols?: Record<string, any>[]
  dataSynchronizations?: Record<string, any>[]
  omicsSamples?: Record<string, any>[]
  omicsAssociations?: Record<string, any>[]
  breedingAnalyses?: Record<string, any>[]
  feedFormulas?: Record<string, any>[]
  feedRecords?: Record<string, any>[]
  feedInventory?: Record<string, any>[]
  costItems?: Record<string, any>[]
  revenueItems?: Record<string, any>[]
  economicAnalyses?: Record<string, any>[]
  budgetPlans?: Record<string, any>[]
  kpiDashboards?: Record<string, any>[]
  kpiDashboardData?: Record<string, any>[]
  deviceMaintenance?: Record<string, any>[]
}

export interface MilkingParlorSnapshot {
  todayTotalMilk: number
  todayRecordCount: number
  parlorDeviceCount: number
  onlineParlorDeviceCount: number
  lactationSensorCount: number
  onlineLactationSensorCount: number
  sensorOnlineRate: number
  milkQualityPassRate: number
  syncTaskCount: number
  activeSyncTaskCount: number
  latestSyncText: string
  chainReady: boolean
}

export interface ReproductionBreedingSnapshot {
  recordCount: number
  eventCount: number
  cycleCount: number
  conceptionRate: number
  firstServiceRate: number
  dueSoonCount: number
  openRiskCount: number
  averageCalvingInterval: number
  latestEventText: string
}

export interface ProductionOperationsSnapshot {
  activeFormulaCount: number
  todayFeedRecordCount: number
  todayActualFeed: number
  inventoryItemCount: number
  lowStockItemCount: number
  inventorySafetyDays: number
  feedCostAmount: number
  milkRevenueAmount: number
  netProfit: number
  costPerKgMilk: number
  openMaintenanceCount: number
  kpiReady: boolean
}

export interface CandidateScoreRow {
  cow: CowBasic
  score: number
  genomicScore: number
  candidateTag: string
  decisionSummary: string
  supportEvidence: string[]
  pedigreeScore: number
  milkScore: number
  healthScore: number
  activityScore: number
  averageMilk: number
  latestTemperature: number | null
  latestSteps: number | null
  breedingEvents: number
  traitValues: Record<string, number>
  traitRecordCounts: Record<string, number>
}

async function safeRows<T>(tableName: string): Promise<T[]> {
  try {
    const rows = await databaseService.getTableDataAsync(tableName, {
      silent: true,
      limit: 50000,
      pageSize: 50000,
      timeout: 60000
    })
    return Array.isArray(rows) ? (rows as T[]) : []
  } catch {
    return []
  }
}

function normalizeSnapshotCows(cows: CowBasic[]): CowBasic[] {
  return (cows || []).map((cow) => ({
    ...cow,
    breed: normalizeCattleBreedOrDefault((cow as any).breed || (cow as any).breedType)
  }))
}

async function safeMergedRows<T>(...tableNames: string[]): Promise<T[]> {
  const groups = await Promise.all(tableNames.map((tableName) => safeRows<T>(tableName)))
  const seen = new Set<string>()
  const rows: T[] = []
  groups.flat().forEach((row: any) => {
    const key =
      text(row?.id) ||
      text(row?.code) ||
      text(row?.deviceId ?? row?.device_id) ||
      text(row?.recordId ?? row?.record_id)
    const dedupeKey = key || JSON.stringify(row)
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    rows.push(row)
  })
  return rows
}

async function loadHealthScores(): Promise<Record<string, any>[]> {
  const primary = await safeMergedRows<Record<string, any>>('health_scores', 'health-scores')
  if (primary.length > 0) return primary
  return []
}

type AnyRow = Record<string, any>
type SensorMetricKey = 'temperature' | 'steps' | 'activityIndex'
type SensorDataContext = {
  cowContext: ReturnType<typeof buildCowReferenceContext>
}

const SENSOR_TEMPERATURE_FIELDS = [
  'body_temperature',
  'bodyTemperature',
  'temperature',
  'temp',
  'ear_temperature',
  'earTemperature',
  'rectal_temperature',
  'rectalTemperature'
]
const SENSOR_STEPS_FIELDS = ['steps', 'step_count', 'stepCount', 'activity_steps', 'activitySteps']
const SENSOR_ACTIVITY_FIELDS = [
  'activityIndex',
  'activity_index',
  'activityAmount',
  'activity_amount',
  'activity'
]
const SENSOR_VALUE_FIELDS = [
  'value',
  'readingValue',
  'reading_value',
  'numericValue',
  'numeric_value'
]

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function parseDetails(value: unknown): AnyRow {
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value as AnyRow
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function eventCodeOf(row: AnyRow): string {
  const details = parseDetails(row.details || row.customValues || row.custom_values)
  return text(
    row.eventCode ||
      row.event_code ||
      row.eventType ||
      row.event_type ||
      row.type ||
      row.eventName ||
      row.event_name ||
      details.eventCode ||
      details.event_code ||
      details.eventType ||
      details.event_type ||
      details.eventName ||
      details.event_name
  )
}

function eventGroupOf(row: AnyRow): string {
  const details = parseDetails(row.details || row.customValues || row.custom_values)
  return text(row.eventGroup || row.event_group || details.eventGroup || details.event_group)
}

function eventBusinessKey(row: AnyRow, fallback: string) {
  return (
    [
      text(row.sourceRecordId || row.source_record_id || row.id),
      text(
        row.cowId ||
          row.cow_id ||
          row.cowNumber ||
          row.cow_number ||
          row.animalNumber ||
          row.animal_number
      ),
      eventCodeOf(row),
      text(
        row.occurredAt ||
          row.occurred_at ||
          row.eventTime ||
          row.event_time ||
          row.eventDate ||
          row.event_date
      )
    ]
      .filter(Boolean)
      .join('|') || fallback
  )
}

function dedupeEvents(rows: AnyRow[]) {
  const seen = new Set<string>()
  const output: AnyRow[] = []
  rows.forEach((row, index) => {
    const key = eventBusinessKey(row, `event:${index}`)
    if (seen.has(key)) return
    seen.add(key)
    output.push(row)
  })
  return output
}

function isEventInCategory(row: AnyRow, category: 'entry' | 'transfer' | 'exit' | 'veterinary') {
  const code = eventCodeOf(row).toLowerCase()
  const group = eventGroupOf(row)
  if (category === 'entry') return ['entry', '入群'].includes(code) || /入群/.test(code)
  if (category === 'transfer') return ['transfer', '转群'].includes(code) || /转群/.test(code)
  if (category === 'exit') {
    return (
      ['exit', 'death', '离群', '死亡', '淘汰'].includes(code) ||
      /离群|死亡|淘汰|出售|转场/.test(code)
    )
  }
  return (
    /健康|兽医/.test(group) ||
    [
      'diagnosis',
      'treatment',
      'medication',
      'vaccination',
      'deworming',
      'quarantine',
      'disinfection',
      'lab_test',
      'hoof_trim',
      'mastitis_check'
    ].includes(code)
  )
}

function asRow(value: unknown): AnyRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRow) : {}
}

function firstText(row: AnyRow, fields: string[]): string {
  return fields.map((field) => text(row?.[field])).find(Boolean) || ''
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numberValue = Number(value)
    if (Number.isFinite(numberValue)) return numberValue
  }
  return null
}

function finiteOrNaN(...values: unknown[]): number {
  const value = firstFiniteNumber(...values)
  return value === null ? Number.NaN : value
}

function finiteOrDefault(defaultValue: number, ...values: unknown[]): number {
  const value = firstFiniteNumber(...values)
  return value === null ? defaultValue : value
}

function firstFiniteField(row: AnyRow, fields: string[]): number | null {
  return firstFiniteNumber(...fields.map((field) => row?.[field]))
}

function getSensorTimeValue(row: AnyRow): string {
  return firstText(row, [
    'timestamp',
    'ts',
    'measuredAt',
    'measured_at',
    'recordTime',
    'record_time',
    'createdAt',
    'created_at',
    'updatedAt',
    'updated_at'
  ])
}

function getSensorTimestamp(row: AnyRow): number {
  const timestamp = new Date(getSensorTimeValue(row)).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function normalizeSensorMetric(metric: unknown): SensorMetricKey | null {
  const key = text(metric)
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (
    [
      'body_temperature',
      'temperature',
      'temp',
      'ear_temperature',
      'rectal_temperature',
      '体温'
    ].includes(key)
  ) {
    return 'temperature'
  }
  if (['steps', 'step_count', 'activity_steps', '步数'].includes(key)) return 'steps'
  if (['activity', 'activity_index', 'activity_amount', '活动量', '活动指数'].includes(key))
    return 'activityIndex'
  return null
}

function getLongMetricValue(row: AnyRow): number | null {
  return firstFiniteField(row, SENSOR_VALUE_FIELDS)
}

function buildRumination(row: AnyRow) {
  const source = asRow(row.rumination || row.rumination_data)
  return {
    count: finiteOrDefault(0, source.count, row.ruminationCount, row.rumination_count),
    duration: finiteOrDefault(
      0,
      source.duration,
      source.minutes,
      row.ruminationDuration,
      row.rumination_duration
    ),
    efficiency: finiteOrDefault(
      0,
      source.efficiency,
      row.ruminationEfficiency,
      row.rumination_efficiency
    )
  }
}

function buildActivity(row: AnyRow, activityIndex: number | null) {
  const source = asRow(row.activity || row.activity_data)
  return {
    lyingTime: finiteOrDefault(
      0,
      source.lyingTime,
      source.lying_time,
      row.lyingTime,
      row.lying_time
    ),
    standingTime: finiteOrDefault(
      0,
      source.standingTime,
      source.standing_time,
      row.standingTime,
      row.standing_time
    ),
    walkingDistance: finiteOrDefault(
      0,
      source.walkingDistance,
      source.walking_distance,
      row.walkingDistance,
      row.walking_distance
    ),
    activeTime: finiteOrDefault(
      0,
      source.activeTime,
      source.active_time,
      row.activeTime,
      row.active_time,
      row.activityMinutes,
      row.activity_minutes,
      activityIndex
    )
  }
}

function buildFeeding(row: AnyRow) {
  const source = asRow(row.feeding || row.feeding_data)
  return {
    eatingTime: finiteOrDefault(
      0,
      source.eatingTime,
      source.eating_time,
      row.eatingTime,
      row.eating_time
    ),
    estimatedIntake: finiteOrDefault(
      0,
      source.estimatedIntake,
      source.estimated_intake,
      row.estimatedIntake,
      row.estimated_intake
    ),
    feedingEfficiency: finiteOrDefault(
      0,
      source.feedingEfficiency,
      source.feeding_efficiency,
      row.feedingEfficiency,
      row.feeding_efficiency
    )
  }
}

function buildVitalSigns(row: AnyRow) {
  const source = asRow(row.vitalSigns || row.vital_signs)
  return {
    respiratoryRate: finiteOrDefault(
      0,
      source.respiratoryRate,
      source.respiratory_rate,
      row.respiratoryRate,
      row.respiratory_rate
    ),
    heartRate: finiteOrDefault(
      0,
      source.heartRate,
      source.heart_rate,
      row.heartRate,
      row.heart_rate
    ),
    bodyScore: finiteOrDefault(
      0,
      source.bodyScore,
      source.body_score,
      row.bodyScore,
      row.body_score
    )
  }
}

function buildEnvironment(row: AnyRow) {
  const source = asRow(row.environment || row.environment_data)
  return {
    ambientTemp: finiteOrDefault(
      0,
      source.ambientTemp,
      source.ambient_temp,
      row.ambientTemp,
      row.ambient_temp
    ),
    humidity: finiteOrDefault(0, source.humidity, row.humidity),
    ammonia: finiteOrDefault(0, source.ammonia, row.ammonia),
    lightLevel: finiteOrDefault(
      0,
      source.lightLevel,
      source.light_level,
      row.lightLevel,
      row.light_level
    )
  }
}

function applySensorMetric(
  sensor: ExtendedSensorData,
  metric: SensorMetricKey,
  value: number | null
) {
  if (value === null) return
  if (metric === 'temperature') {
    sensor.temperature = value
    ;(sensor as AnyRow).body_temperature = value
    return
  }
  if (metric === 'steps') {
    sensor.steps = value
    ;(sensor as AnyRow).step_count = value
    return
  }
  ;(sensor as AnyRow).activityIndex = value
  ;(sensor as AnyRow).activity_index = value
  sensor.activity = {
    ...sensor.activity,
    activeTime: finiteOrDefault(value, sensor.activity?.activeTime)
  }
}

function getNormalizedMetricValue(
  sensor: ExtendedSensorData,
  metric: SensorMetricKey
): number | null {
  if (metric === 'temperature') return firstFiniteField(sensor as AnyRow, SENSOR_TEMPERATURE_FIELDS)
  if (metric === 'steps') return firstFiniteField(sensor as AnyRow, SENSOR_STEPS_FIELDS)
  return firstFiniteField(sensor as AnyRow, SENSOR_ACTIVITY_FIELDS)
}

function shapeSensorData(
  row: AnyRow,
  cowId: string,
  cowNumber: string,
  timestamp: string,
  sourceTable: string
): ExtendedSensorData {
  const activityIndex = firstFiniteField(row, SENSOR_ACTIVITY_FIELDS)
  const sensor = {
    ...row,
    id: text(row.id) || `sensor-${cowId || cowNumber || 'unknown'}-${timestamp || sourceTable}`,
    cowId,
    cow_id: cowId,
    cowNumber,
    cow_number: cowNumber,
    animalId: cowId,
    animal_id: cowId,
    timestamp,
    temperature: finiteOrNaN(...SENSOR_TEMPERATURE_FIELDS.map((field) => row?.[field])),
    steps: finiteOrNaN(...SENSOR_STEPS_FIELDS.map((field) => row?.[field])),
    rumination: buildRumination(row),
    activity: buildActivity(row, activityIndex),
    feeding: buildFeeding(row),
    vitalSigns: buildVitalSigns(row),
    environment: buildEnvironment(row),
    createdAt: firstText(row, ['createdAt', 'created_at']) || timestamp,
    sourceTable,
    source_table: sourceTable,
    sourceRecordId: text(row.sourceRecordId ?? row.source_record_id ?? row.id),
    source_record_id: text(row.sourceRecordId ?? row.source_record_id ?? row.id)
  } as ExtendedSensorData

  if (activityIndex !== null) applySensorMetric(sensor, 'activityIndex', activityIndex)
  const longMetric = normalizeSensorMetric(
    row.metric ?? row.metricCode ?? row.metric_code ?? row.dataType ?? row.data_type
  )
  if (longMetric) applySensorMetric(sensor, longMetric, getLongMetricValue(row))

  return sensor
}

function normalizeSensorRow(
  row: AnyRow,
  sourceTable: string,
  context: SensorDataContext
): ExtendedSensorData | null {
  const resolvedCow = resolveCowRef(row, context.cowContext)
  const cowId = resolvedCow.cowId || firstText(row, ['cowId', 'cow_id', 'animalId', 'animal_id'])
  const cowNumber =
    resolvedCow.cowNumber ||
    firstText(row, ['cowNumber', 'cow_number', 'animalNumber', 'animal_number', 'number'])
  const timestamp = getSensorTimeValue(row)
  if (!cowId && !cowNumber) return null
  return shapeSensorData(row, cowId || cowNumber, cowNumber, timestamp, sourceTable)
}

function dedupeSensors(rows: ExtendedSensorData[]): ExtendedSensorData[] {
  const map = new Map<string, ExtendedSensorData>()
  rows.forEach((row) => {
    const metricKey = [
      getNormalizedMetricValue(row, 'temperature'),
      getNormalizedMetricValue(row, 'steps'),
      getNormalizedMetricValue(row, 'activityIndex')
    ]
      .map((value) => (value === null ? '' : String(value)))
      .join(':')
    const key =
      text((row as AnyRow).sourceRecordId ?? (row as AnyRow).source_record_id ?? row.id) ||
      [row.cowId, row.timestamp, metricKey].join('|')
    if (!map.has(key)) map.set(key, row)
  })
  return Array.from(map.values())
}

function mergeSensorShapes(base: ExtendedSensorData, next: ExtendedSensorData): ExtendedSensorData {
  const baseTime = getSensorTimestamp(base as AnyRow)
  const nextTime = getSensorTimestamp(next as AnyRow)
  const newer = nextTime >= baseTime ? next : base
  const older = nextTime >= baseTime ? base : next
  const activityIndex = firstFiniteNumber(
    (newer as AnyRow).activityIndex,
    (older as AnyRow).activityIndex
  )
  const merged = {
    ...older,
    ...newer,
    temperature: finiteOrNaN(newer.temperature, older.temperature),
    steps: finiteOrNaN(newer.steps, older.steps),
    rumination: {
      ...older.rumination,
      ...newer.rumination
    },
    activity: {
      ...older.activity,
      ...newer.activity,
      activeTime: finiteOrDefault(
        0,
        newer.activity?.activeTime,
        older.activity?.activeTime,
        activityIndex
      )
    },
    feeding: {
      ...older.feeding,
      ...newer.feeding
    },
    vitalSigns: {
      ...older.vitalSigns,
      ...newer.vitalSigns
    },
    environment: {
      ...older.environment,
      ...newer.environment
    }
  } as ExtendedSensorData

  if (activityIndex !== null) applySensorMetric(merged, 'activityIndex', activityIndex)
  return merged
}

function normalizeSensorRows(
  sources: Array<{ sourceTable: string; rows: AnyRow[] }>,
  context: SensorDataContext
): ExtendedSensorData[] {
  const normalized = sources.flatMap((source) =>
    source.rows
      .map((row) => normalizeSensorRow(row, source.sourceTable, context))
      .filter((row): row is ExtendedSensorData => Boolean(row))
  )
  return dedupeSensors(normalized)
}

async function loadUnifiedSensorDataFromContext(
  context: SensorDataContext
): Promise<ExtendedSensorData[]> {
  const [wideSensors, v2SensorReadings, legacySensorReadings] = await Promise.all([
    safeRows<AnyRow>('sensors'),
    safeRows<AnyRow>('sensor_reading'),
    safeRows<AnyRow>('sensor-readings')
  ])

  return normalizeSensorRows(
    [
      { sourceTable: 'sensors', rows: wideSensors },
      { sourceTable: 'sensor_reading', rows: v2SensorReadings },
      { sourceTable: 'sensor-readings', rows: legacySensorReadings }
    ],
    context
  )
}

export async function loadUnifiedSensorData(cows?: CowBasic[]): Promise<ExtendedSensorData[]> {
  if (cows) {
    const identifiers = await safeRows<AnyRow>('animal_identifier')
    return loadUnifiedSensorDataFromContext({
      cowContext: buildCowReferenceContext(cows as unknown as AnyRow[], identifiers)
    })
  }

  const unifiedContext = await buildUnifiedDataContext()
  return loadUnifiedSensorDataFromContext(unifiedContext)
}

export async function loadPlatformSnapshot(): Promise<PlatformSnapshot> {
  const unifiedContext = await buildUnifiedDataContext()
  const [
    unifiedMilkRecords,
    unifiedPhenotypeRecords,
    unifiedReproduction,
    sensors,
    animalEvents,
    cowEvents,
    entryEvents,
    transferEvents,
    exitEvents,
    veterinaryEvents,
    alerts,
    healthScores,
    sensorStatus,
    sensorCalibrations,
    hardwareDevices,
    integrationProtocols,
    dataSynchronizations,
    omicsSamples,
    omicsAssociations,
    breedingAnalyses,
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
  ] = await Promise.all([
    loadUnifiedMilkRecords(unifiedContext),
    loadUnifiedPhenotypeRecords([], unifiedContext),
    loadUnifiedReproductionEvents(unifiedContext),
    loadUnifiedSensorDataFromContext(unifiedContext),
    safeRows<Record<string, any>>('animal_event'),
    safeRows<Record<string, any>>('cow-events'),
    safeRows<Record<string, any>>('entry-events'),
    safeRows<Record<string, any>>('transfer-events'),
    safeRows<Record<string, any>>('exit-events'),
    safeRows<Record<string, any>>('veterinary-events'),
    safeRows<Record<string, any>>('alerts'),
    loadHealthScores(),
    safeMergedRows<Record<string, any>>('sensor-status', 'sensor_status'),
    safeMergedRows<Record<string, any>>('sensor-calibrations', 'sensor_calibrations'),
    safeMergedRows<Record<string, any>>('hardware-devices', 'hardware_devices', 'device'),
    safeMergedRows<Record<string, any>>('integration-protocols', 'integration_protocols'),
    safeMergedRows<Record<string, any>>('data-synchronizations', 'data_synchronizations'),
    safeMergedRows<Record<string, any>>('omics-samples', 'omics_samples'),
    safeMergedRows<Record<string, any>>('multi-omics-associations', 'multi_omics_associations'),
    safeMergedRows<Record<string, any>>('breeding-analyses', 'breeding_analyses'),
    safeMergedRows<Record<string, any>>('feed-formulas', 'feed_formulas'),
    safeMergedRows<Record<string, any>>('feed-records', 'feed_records'),
    safeMergedRows<Record<string, any>>('feed-inventory', 'feed_inventory'),
    safeMergedRows<Record<string, any>>('cost-items', 'cost_items'),
    safeMergedRows<Record<string, any>>('revenue-items', 'revenue_items'),
    safeMergedRows<Record<string, any>>('economic-analysis', 'economic_analysis'),
    safeMergedRows<Record<string, any>>('budget-plans', 'budget_plans'),
    safeMergedRows<Record<string, any>>('kpi-dashboards', 'kpi_dashboards'),
    safeMergedRows<Record<string, any>>('kpi-dashboard-data', 'kpi_dashboard_data'),
    safeMergedRows<Record<string, any>>('device-maintenance', 'device_maintenance')
  ])

  const unifiedEvents = dedupeEvents([...(animalEvents || []), ...(cowEvents || [])])
  const mergedEntryEvents = dedupeEvents([
    ...unifiedEvents.filter((row) => isEventInCategory(row, 'entry')),
    ...(entryEvents || [])
  ])
  const mergedTransferEvents = dedupeEvents([
    ...unifiedEvents.filter((row) => isEventInCategory(row, 'transfer')),
    ...(transferEvents || [])
  ])
  const mergedExitEvents = dedupeEvents([
    ...unifiedEvents.filter((row) => isEventInCategory(row, 'exit')),
    ...(exitEvents || [])
  ])
  const mergedVeterinaryEvents = dedupeEvents([
    ...unifiedEvents.filter((row) => isEventInCategory(row, 'veterinary')),
    ...(veterinaryEvents || [])
  ])

  return {
    cows: normalizeSnapshotCows(unifiedContext.cows as CowBasic[]),
    sensors,
    milkRecords: unifiedMilkRecords as MilkRecord[],
    entryEvents: mergedEntryEvents,
    transferEvents: mergedTransferEvents,
    exitEvents: mergedExitEvents,
    breedingRecords: unifiedReproduction.events,
    reproductionCycles: unifiedReproduction.cycles,
    breedingEvents: unifiedReproduction.events,
    veterinaryEvents: mergedVeterinaryEvents,
    alerts,
    healthScores,
    sensorStatus,
    sensorCalibrations,
    phenotypeRecords: unifiedPhenotypeRecords,
    hardwareDevices,
    integrationProtocols,
    dataSynchronizations,
    omicsSamples,
    omicsAssociations,
    breedingAnalyses,
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
  }
}

export async function loadBreedingDecisionSnapshot(): Promise<PlatformSnapshot> {
  const unifiedContext = await buildUnifiedDataContext()
  const [
    unifiedMilkRecords,
    unifiedPhenotypeRecords,
    unifiedReproduction,
    sensors,
    healthScores,
    omicsSamples,
    omicsAssociations,
    breedingAnalyses,
    alerts
  ] = await Promise.all([
    loadUnifiedMilkRecords(unifiedContext),
    loadUnifiedPhenotypeRecords([], unifiedContext),
    loadUnifiedReproductionEvents(unifiedContext),
    loadUnifiedSensorDataFromContext(unifiedContext),
    loadHealthScores(),
    safeMergedRows<Record<string, any>>('omics-samples', 'omics_samples'),
    safeMergedRows<Record<string, any>>('multi-omics-associations', 'multi_omics_associations'),
    safeMergedRows<Record<string, any>>('breeding-analyses', 'breeding_analyses'),
    safeRows<Record<string, any>>('alerts')
  ])

  return {
    cows: normalizeSnapshotCows(unifiedContext.cows as CowBasic[]),
    sensors,
    milkRecords: unifiedMilkRecords as MilkRecord[],
    breedingRecords: unifiedReproduction.events,
    reproductionCycles: unifiedReproduction.cycles,
    breedingEvents: unifiedReproduction.events,
    alerts,
    healthScores,
    phenotypeRecords: unifiedPhenotypeRecords,
    omicsSamples,
    omicsAssociations,
    breedingAnalyses
  }
}

export function toFiniteNumber(value: unknown): number | null {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

export function average(values: number[]): number {
  const valid = values.filter((item) => Number.isFinite(item))
  if (!valid.length) return 0
  return Number((valid.reduce((sum, item) => sum + item, 0) / valid.length).toFixed(2))
}

export function formatDate(value: string | Date | null | undefined): string {
  return formatDateOnly(value, '-')
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return formatDateOnly(value, '-')
}

export function formatRelativeMinutes(value: string | Date | null | undefined): string {
  if (!value) return '暂无'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '暂无'
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round((minutes / 60) * 10) / 10
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

export function normalizeStatus(status: unknown): string {
  const text = String(status || '').trim()
  if (!text) return '在群'
  const map: Record<string, string> = {
    healthy: '健康',
    normal: '健康',
    abnormal: '异常',
    warning: '异常',
    heat: '发情',
    pregnant: '预产',
    mixed: '混群',
    left: '离群',
    in_pen: '在群',
    active: '在群'
  }
  return map[text.toLowerCase()] || text
}

export function getPedigreeCompleteness(cow: Partial<CowBasic>): number {
  const fields = [cow.fatherNumber, cow.motherNumber, cow.grandfatherNumber, cow.grandmotherNumber]
  const filled = fields.filter((item) => String(item || '').trim()).length
  return Math.round((filled / fields.length) * 100)
}

export function getLatestSensorMap(
  sensors: ExtendedSensorData[]
): Record<string, ExtendedSensorData> {
  const latest: Record<string, ExtendedSensorData> = {}
  const latestTimestamp: Record<string, number> = {}

  sensors.forEach((sensor) => {
    const row = sensor as AnyRow
    const cowId = firstText(row, [
      'cowId',
      'cow_id',
      'animalId',
      'animal_id',
      'cowNumber',
      'cow_number'
    ])
    if (!cowId) return
    const safeTimestamp = getSensorTimestamp(row)
    if (latestTimestamp[cowId] === undefined || safeTimestamp >= latestTimestamp[cowId]) {
      latestTimestamp[cowId] = safeTimestamp
    }
    latest[cowId] = latest[cowId] ? mergeSensorShapes(latest[cowId], sensor) : sensor

    const cowNumber = firstText(row, ['cowNumber', 'cow_number'])
    if (cowNumber && cowNumber !== cowId) {
      latest[cowNumber] = latest[cowId]
    }
  })

  return latest
}

export function getMilkStatsMap(
  milkRecords: MilkRecord[]
): Record<string, { average: number; total: number; count: number }> {
  const grouped = new Map<string, number[]>()

  milkRecords.forEach((record) => {
    const keys = [
      (record as any)?.cowId,
      (record as any)?.cow_id,
      (record as any)?.animalId,
      (record as any)?.animal_id,
      (record as any)?.cowNumber,
      (record as any)?.cow_number,
      (record as any)?.animalNumber,
      (record as any)?.animal_number
    ]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
    if (!keys.length) return
    const volume = toFiniteNumber(
      (record as any)?.volume ??
        (record as any)?.milkVolume ??
        (record as any)?.milk_volume ??
        (record as any)?.milkYield ??
        (record as any)?.milk_yield ??
        (record as any)?.value ??
        (record as any)?.numericValue ??
        (record as any)?.numeric_value
    )
    if (volume === null) return
    keys.forEach((key) => {
      const items = grouped.get(key) || []
      items.push(volume)
      grouped.set(key, items)
    })
  })

  return Array.from(grouped.entries()).reduce<
    Record<string, { average: number; total: number; count: number }>
  >((result, [cowId, values]) => {
    result[cowId] = {
      average: average(values),
      total: Number(values.reduce((sum, item) => sum + item, 0).toFixed(2)),
      count: values.length
    }
    return result
  }, {})
}

export function getBreedingCountMap(rows: Record<string, any>[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((result, row) => {
    const cowId = String(row?.cowId ?? row?.cow_id ?? '')
    if (!cowId) return result
    result[cowId] = (result[cowId] || 0) + 1
    return result
  }, {})
}

function getHealthScoreForCow(map: Record<string, number>, cow: CowBasic): number | null {
  const byId = map[cow.id]
  if (byId !== undefined) return byId
  const byNumber = map[cow.cowNumber]
  if (byNumber !== undefined) return byNumber
  return null
}

function includesAnyText(row: Record<string, any>, tokens: string[]): boolean {
  const text = JSON.stringify(row || {}).toLowerCase()
  return tokens.some((token) => text.includes(token.toLowerCase()))
}

function getDateMs(value: unknown): number | null {
  if (!value) return null
  const timestamp = new Date(String(value)).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function getLocalDateKey(value: unknown): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(String(value))
  if (!Number.isFinite(date.getTime())) return ''
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function getRowDateKey(row: Record<string, any>, fields: string[]): string {
  const timestamp = fields.map((field) => getDateMs(row?.[field])).find((item) => item !== null)
  return timestamp === undefined || timestamp === null ? '' : getLocalDateKey(new Date(timestamp))
}

function getLatestDateText(rows: Record<string, any>[], fields: string[]): string {
  const latest = rows
    .flatMap((row) =>
      fields.map((field) => getDateMs(row?.[field])).filter((item): item is number => item !== null)
    )
    .sort((left, right) => right - left)[0]
  return latest ? formatDateTime(new Date(latest)) : '-'
}

export function getMilkingParlorSnapshot(snapshot: PlatformSnapshot): MilkingParlorSnapshot {
  const todayKey = getLocalDateKey(new Date())
  const milkRows = snapshot.milkRecords as Record<string, any>[]
  const todayRecords = milkRows.filter(
    (row) =>
      getRowDateKey(row, ['milkingTime', 'milking_time', 'createdAt', 'created_at']) === todayKey
  )
  const parlorDevices = (snapshot.hardwareDevices || []).filter((device) =>
    includesAnyText(device, ['milking', 'milk_volume', 'milk-meter', '奶厅', '挤奶', '奶量'])
  )
  const lactationSensors = (snapshot.sensorStatus || []).filter((sensor) => {
    const cowHasMilk = milkRows.some(
      (record) => String(record.cowId ?? record.cow_id) === String(sensor.cowId ?? sensor.cow_id)
    )
    return cowHasMilk || includesAnyText(sensor, ['milk', 'lactation', 'milking', '泌乳', '奶量'])
  })
  const qualityRows = milkRows.filter((row) => row.milkQuality || row.milk_quality)
  const qualityPass = qualityRows.filter((row) => {
    const quality = (row.milkQuality ?? row.milk_quality ?? {}) as Record<string, any>
    const grade = String(quality.grade || row.grade || '').toUpperCase()
    const scc = toFiniteNumber(quality.scc ?? row.scc)
    return grade !== 'C' && (scc === null || scc <= 500000)
  }).length
  const syncTasks = snapshot.dataSynchronizations || []
  const activeSyncTasks = syncTasks.filter((item) =>
    ['active', 'ready', 'running', 'completed', 'success', 'idle', 'scheduled'].includes(
      String(item.status || '').toLowerCase()
    )
  )
  const onlineParlorDevices = parlorDevices.filter((item) =>
    ['online', 'active', 'running', 'connected'].includes(String(item.status || '').toLowerCase())
  )
  const onlineLactationSensors = lactationSensors.filter((item) =>
    ['online', 'active', 'running', 'connected'].includes(String(item.status || '').toLowerCase())
  )

  return {
    todayTotalMilk: Number(
      todayRecords
        .reduce((sum, row) => sum + Number(row.volume ?? row.milkVolume ?? 0), 0)
        .toFixed(1)
    ),
    todayRecordCount: todayRecords.length,
    parlorDeviceCount: parlorDevices.length,
    onlineParlorDeviceCount: onlineParlorDevices.length,
    lactationSensorCount: lactationSensors.length,
    onlineLactationSensorCount: onlineLactationSensors.length,
    sensorOnlineRate: lactationSensors.length
      ? Math.round((onlineLactationSensors.length / lactationSensors.length) * 100)
      : 0,
    milkQualityPassRate: qualityRows.length
      ? Math.round((qualityPass / qualityRows.length) * 100)
      : 0,
    syncTaskCount: syncTasks.length,
    activeSyncTaskCount: activeSyncTasks.length,
    latestSyncText: getLatestDateText(syncTasks, [
      'lastSync',
      'last_sync',
      'syncTime',
      'sync_time'
    ]),
    chainReady: Boolean(
      todayRecords.length &&
      onlineParlorDevices.length &&
      onlineLactationSensors.length &&
      activeSyncTasks.length
    )
  }
}

export function getReproductionBreedingSnapshot(
  snapshot: PlatformSnapshot
): ReproductionBreedingSnapshot {
  const rows = (snapshot.breedingRecords || []) as Record<string, any>[]
  const events = (snapshot.breedingEvents || []) as Record<string, any>[]
  const cycles = (snapshot.reproductionCycles || []) as Record<string, any>[]
  const breedingRows = rows
    .concat(events)
    .filter((row) => includesAnyText(row, ['insemination', 'breeding', '配种', '人工授精']))
  const pregnantRows = rows
    .concat(events)
    .filter((row) => includesAnyText(row, ['pregnant', 'positive', '妊娠', '阳性', '已受胎']))
  const firstServicePregnant = cycles.filter((row) => {
    const count = Number(row.inseminationCount ?? row.insemination_count ?? 1)
    return count <= 1 && includesAnyText(row, ['pregnant', '妊娠'])
  }).length
  const dueSoonCount = cycles.filter((row) => {
    const due = getDateMs(
      row.expectedCalvingDate ?? row.expected_calving_date ?? row.dueDate ?? row.due_date
    )
    if (due === null) return false
    const days = Math.round((due - Date.now()) / 86400000)
    return days >= 0 && days <= 60
  }).length
  const openRiskCount = cycles.filter((row) => {
    const start = getDateMs(
      row.cycleStartDate ?? row.cycle_start ?? row.cycleStart ?? row.createdAt
    )
    if (start === null) return false
    const days = Math.round((Date.now() - start) / 86400000)
    return days > 150 && !includesAnyText(row, ['pregnant', '妊娠'])
  }).length
  const calvingIntervals = cycles
    .map((row) =>
      toFiniteNumber(
        row.calvingInterval ?? row.calving_interval ?? row.cycleLength ?? row.cycle_length
      )
    )
    .filter((item): item is number => item !== null && item > 0)

  return {
    recordCount: rows.length,
    eventCount: events.length,
    cycleCount: cycles.length,
    conceptionRate: breedingRows.length
      ? Math.round((pregnantRows.length / breedingRows.length) * 100)
      : 0,
    firstServiceRate: cycles.length ? Math.round((firstServicePregnant / cycles.length) * 100) : 0,
    dueSoonCount,
    openRiskCount,
    averageCalvingInterval: average(calvingIntervals),
    latestEventText: getLatestDateText(rows.concat(events), [
      'eventTime',
      'event_time',
      'eventDate',
      'event_date',
      'createdAt'
    ])
  }
}

export function getProductionOperationsSnapshot(
  snapshot: PlatformSnapshot
): ProductionOperationsSnapshot {
  const todayKey = getLocalDateKey(new Date())
  const feedRows = (snapshot.feedRecords || []) as Record<string, any>[]
  const formulaRows = (snapshot.feedFormulas || []) as Record<string, any>[]
  const inventoryRows = (snapshot.feedInventory || []) as Record<string, any>[]
  const costRows = (snapshot.costItems || []) as Record<string, any>[]
  const revenueRows = (snapshot.revenueItems || []) as Record<string, any>[]
  const economicRows = (snapshot.economicAnalyses || []) as Record<string, any>[]
  const milkRows = (snapshot.milkRecords || []) as unknown as Record<string, any>[]
  const todayFeedRows = feedRows.filter(
    (row) =>
      getRowDateKey(row, ['feedingTime', 'feedTime', 'feed_time', 'createdAt', 'created_at']) ===
      todayKey
  )
  const todayMilkRows = milkRows.filter(
    (row) =>
      getRowDateKey(row, ['milkingTime', 'milking_time', 'createdAt', 'created_at']) === todayKey
  )
  const todayMilkVolume = todayMilkRows.reduce(
    (sum: number, row: Record<string, any>) => sum + Number(row.volume ?? row.milkVolume ?? 0),
    0
  )
  const todayActualFeed = todayFeedRows.reduce(
    (sum, row) => sum + Number(row.actualAmount ?? row.actual_amount ?? 0),
    0
  )
  const formulaCostMap = new Map(
    formulaRows.map((row) => [String(row.id), Number(row.totalCost ?? row.total_cost ?? 0)])
  )
  const todayCalculatedFeedCost = todayFeedRows.reduce((sum, row) => {
    const formulaId = String(row.formulaId ?? row.formula_id ?? '')
    const unitCost = formulaCostMap.get(formulaId) || 0
    return sum + Number(row.actualAmount ?? row.actual_amount ?? 0) * unitCost
  }, 0)
  const totalStock = inventoryRows.reduce(
    (sum, row) => sum + Number(row.currentStock ?? row.current_stock ?? 0),
    0
  )
  const lowStockItemCount = inventoryRows.filter(
    (row) =>
      Number(row.currentStock ?? row.current_stock ?? 0) <=
      Number(row.minimumStock ?? row.minimum_stock ?? 0)
  ).length
  const todayCostRows = costRows.filter(
    (row) =>
      getRowDateKey(row, ['itemDate', 'item_date', 'date', 'createdAt', 'created_at']) === todayKey
  )
  const fallbackFeedCostAmount = todayCostRows
    .filter(
      (row) =>
        ['feed', 'feed_cost', 'tmr'].includes(String(row.category ?? '').toLowerCase()) ||
        /饲料|tmr/i.test(String(row.name ?? row.description ?? ''))
    )
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const feedCostAmount =
    todayCalculatedFeedCost > 0 ? todayCalculatedFeedCost : fallbackFeedCostAmount
  const milkRevenueAmount = revenueRows
    .filter(
      (row) =>
        getRowDateKey(row, ['itemDate', 'item_date', 'date', 'createdAt', 'created_at']) ===
        todayKey
    )
    .filter(
      (row) =>
        String(row.category ?? '').toLowerCase() === 'milk_sales' ||
        /milk|鲜奶|牛奶/i.test(String(row.name ?? row.description ?? ''))
    )
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const analysisSummary = (economicRows[0]?.summary ??
    economicRows[0]?.payload?.summary ??
    {}) as Record<string, any>
  const netProfit = Number(
    analysisSummary.netProfit ??
      milkRevenueAmount - costRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  )
  const activeFormulaCount = (snapshot.feedFormulas || []).filter((row) => {
    const value = row.isActive ?? row.is_active
    return (
      value === undefined ||
      value === null ||
      value === '' ||
      Boolean(Number(value)) ||
      value === true
    )
  }).length
  const openMaintenanceCount = (snapshot.deviceMaintenance || []).filter(
    (row) => !['completed', 'cancelled'].includes(String(row.status || '').toLowerCase())
  ).length

  return {
    activeFormulaCount,
    todayFeedRecordCount: todayFeedRows.length,
    todayActualFeed: Number(todayActualFeed.toFixed(1)),
    inventoryItemCount: inventoryRows.length,
    lowStockItemCount,
    inventorySafetyDays: todayActualFeed > 0 ? Math.round(totalStock / todayActualFeed) : 0,
    feedCostAmount: Number(feedCostAmount.toFixed(2)),
    milkRevenueAmount: Number(milkRevenueAmount.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    costPerKgMilk: todayMilkVolume > 0 ? Number((feedCostAmount / todayMilkVolume).toFixed(2)) : 0,
    openMaintenanceCount,
    kpiReady: Boolean(
      (snapshot.kpiDashboards || []).length && (snapshot.kpiDashboardData || []).length
    )
  }
}

export function getHealthScoreMap(rows: Record<string, any>[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((result, row) => {
    const cowId = String(row?.cowId ?? row?.cow_id ?? '')
    const score = toFiniteNumber(
      row?.overallScore ?? row?.overall_score ?? row?.score ?? row?.healthScore
    )
    if (!cowId || score === null) return result
    result[cowId] = score
    return result
  }, {})
}

function buildCandidateTag(score: number): string {
  if (score >= 85) return '核心候选'
  if (score >= 75) return '重点跟踪'
  if (score >= 65) return '备选观察'
  return '数据待补齐'
}

function buildEvidenceItem(
  label: string,
  value: string | number | null | undefined,
  fallback = '待补齐'
): string {
  const text = value === null || value === undefined || value === '' ? fallback : value
  return `${label}: ${text}`
}

function normalizeCowKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function matchesCowReference(row: Record<string, any>, cow: CowBasic): boolean {
  const rowKeys = [
    row.cowId,
    row.cow_id,
    row.cowNumber,
    row.cow_number,
    row.number,
    row.animalNumber
  ].map(normalizeCowKey)
  const cowKeys = [cow.id, cow.cowNumber, (cow as Record<string, any>).number].map(normalizeCowKey)
  return rowKeys.some((key) => key && cowKeys.includes(key))
}

function getAveragePhenotypeValue(
  snapshot: PlatformSnapshot,
  cow: CowBasic,
  traitCodes: string[]
): number | null {
  const codeSet = new Set(traitCodes)
  const values = (snapshot.phenotypeRecords || [])
    .filter((record) => matchesCowReference(record, cow))
    .filter((record) => codeSet.has(String(record.traitCode || record.trait_code || '')))
    .map((record) => toFiniteNumber(record.value))
    .filter((value): value is number => value !== null)
  return values.length ? average(values) : null
}

function getCowTraitStats(snapshot: PlatformSnapshot, cow: CowBasic) {
  const valuesByCode = new Map<string, number[]>()
  ;(snapshot.phenotypeRecords || []).forEach((record) => {
    if (!matchesCowReference(record, cow)) return
    const code = text(record.traitCode || record.trait_code || record.code)
    if (!code) return
    const value = toFiniteNumber(
      record.value ??
        record.numericValue ??
        record.numeric_value ??
        record.observedValue ??
        record.observed_value
    )
    if (value === null) return
    valuesByCode.set(code, [...(valuesByCode.get(code) || []), value])
  })

  const traitValues: Record<string, number> = {}
  const traitRecordCounts: Record<string, number> = {}
  valuesByCode.forEach((values, code) => {
    traitValues[code] = average(values)
    traitRecordCounts[code] = values.length
  })
  return { traitValues, traitRecordCounts }
}

function buildOmicsEvidence(cow: CowBasic, snapshot: PlatformSnapshot) {
  const matchedSamples = (snapshot.omicsSamples || []).filter((sample) =>
    matchesCowReference(sample, cow)
  )
  const topRanks = (snapshot.breedingAnalyses || []).flatMap((analysis) =>
    Array.isArray(analysis.topCandidates)
      ? analysis.topCandidates
          .filter((candidate: Record<string, any>) => matchesCowReference(candidate, cow))
          .map((candidate: Record<string, any>) => ({
            analysis,
            candidate
          }))
      : []
  )
  const associations = snapshot.omicsAssociations || []
  const candidateGenes = Array.from(
    new Set(
      associations.flatMap((item) =>
        Array.isArray(item.candidateGenes) ? item.candidateGenes : []
      )
    )
  )
  const candidateMarkers = Array.from(
    new Set(
      associations.flatMap((item) =>
        Array.isArray(item.candidateMarkers) ? item.candidateMarkers : []
      )
    )
  )

  const bestRank = topRanks.reduce<number | null>((result, item) => {
    const rank = toFiniteNumber(item.candidate.rank)
    if (rank === null) return result
    return result === null ? rank : Math.min(result, rank)
  }, null)
  const bestComposite = topRanks.reduce<number | null>((result, item) => {
    const score = toFiniteNumber(item.candidate.compositeScore)
    if (score === null) return result
    return result === null ? score : Math.max(result, score)
  }, null)
  const bestGenomicEstimate = topRanks.reduce<number | null>((result, item) => {
    const score = toFiniteNumber(item.candidate.genomicEstimate)
    if (score === null) return result
    return result === null ? score : Math.max(result, score)
  }, null)

  const sampleScore = matchedSamples.length ? Math.min(25, 12 + matchedSamples.length * 6) : 0
  const rankScore =
    bestRank === null ? 0 : bestRank <= 1 ? 42 : bestRank <= 3 ? 34 : bestRank <= 10 ? 24 : 14
  const associationScore =
    topRanks.length && associations.length
      ? 18
      : matchedSamples.length && associations.length
        ? 10
        : 0
  const compositeScore =
    bestComposite === null ? 0 : Math.min(15, Math.max(0, Math.round(bestComposite / 7)))
  const score = Math.min(100, sampleScore + rankScore + associationScore + compositeScore)

  const traitNames = Array.from(
    new Set(topRanks.map((item) => item.analysis?.targetTrait).filter(Boolean))
  )

  return {
    score,
    sampleCount: matchedSamples.length,
    bestRank,
    bestComposite,
    bestGenomicEstimate,
    traitNames,
    candidateGenes: candidateGenes.slice(0, 4),
    candidateMarkers: candidateMarkers.slice(0, 4),
    evidenceText:
      score >= 70
        ? '已进入组学育种分析 Top 候选，具备明确分子证据支撑。'
        : score >= 35
          ? '已有组学样本或候选标记证据，建议结合表型继续复核。'
          : '组学证据待补齐，当前主要依据表型和系谱判断。'
  }
}

export function buildFemaleCandidateRows(snapshot: PlatformSnapshot): CandidateScoreRow[] {
  const latestSensorMap = getLatestSensorMap(snapshot.sensors)
  const milkStatsMap = getMilkStatsMap(snapshot.milkRecords)
  const breedingCountMap = getBreedingCountMap(snapshot.breedingRecords)
  const healthScoreMap = getHealthScoreMap(snapshot.healthScores)

  return snapshot.cows
    .filter((cow) => String(cow.gender || '').includes('母'))
    .map((cow) => {
      const latestSensor = latestSensorMap[cow.id]
      const averageMilk = milkStatsMap[cow.id]?.average || 0
      const latestTemperature = toFiniteNumber((latestSensor as any)?.temperature)
      const latestSteps = toFiniteNumber((latestSensor as any)?.steps)
      const pedigreeScore = getPedigreeCompleteness(cow)
      const milkScore = Math.min(100, Math.round((averageMilk / 12) * 100))
      const healthScore = Math.round(getHealthScoreForCow(healthScoreMap, cow) ?? 0)
      const activityScore = Math.min(100, Math.round(((latestSteps ?? 0) / 8000) * 100))
      const parityScore = Math.min(100, Math.round((Number(cow.parity || 0) / 4) * 100))
      const omicsEvidence = buildOmicsEvidence(cow, snapshot)
      const traitStats = getCowTraitStats(snapshot, cow)
      const statusBonus =
        normalizeStatus(cow.status) === '异常'
          ? 0
          : ['发情', '预产', '健康', '在群'].includes(normalizeStatus(cow.status))
            ? 90
            : 0

      const score = Math.round(
        pedigreeScore * 0.18 +
          milkScore * 0.24 +
          healthScore * 0.18 +
          activityScore * 0.08 +
          parityScore * 0.08 +
          statusBonus * 0.08 +
          omicsEvidence.score * 0.16
      )
      const traitValues = {
        ...traitStats.traitValues,
        score,
        milkScore,
        genomicScore: omicsEvidence.score,
        pedigreeScore,
        healthScore,
        activityScore,
        averageMilk,
        breedingEvents: breedingCountMap[cow.id] || 0,
        milk_yield: traitStats.traitValues.milk_yield ?? averageMilk,
        daily_steps: traitStats.traitValues.daily_steps ?? latestSteps ?? 0
      }

      return {
        cow,
        score,
        genomicScore: omicsEvidence.score,
        candidateTag: buildCandidateTag(score),
        decisionSummary:
          omicsEvidence.score >= 70 && score >= 85
            ? '表型表现和组学证据同时靠前，可作为高优先级候选母牛进入选配。'
            : score >= 85
              ? '系谱、泌乳与健康表现均衡，可进入高优先级候选母牛池。'
              : score >= 75
                ? '综合表现达到育种筛选阈值，建议结合组学关联结果继续复核。'
                : '可作为备选个体，优先补齐泌乳、健康、系谱或组学证据。',
        supportEvidence: [
          buildEvidenceItem('系谱完整度', `${pedigreeScore}%`),
          buildEvidenceItem('平均泌乳量', averageMilk ? `${averageMilk} kg` : null),
          buildEvidenceItem('健康评分', healthScore || null),
          buildEvidenceItem('繁殖记录', `${breedingCountMap[cow.id] || 0} 条`),
          buildEvidenceItem('组学证据分', omicsEvidence.score),
          buildEvidenceItem(
            '候选基因/标记',
            omicsEvidence.candidateGenes.concat(omicsEvidence.candidateMarkers).join('、') || null
          ),
          omicsEvidence.evidenceText
        ],
        pedigreeScore,
        milkScore,
        healthScore,
        activityScore,
        averageMilk,
        latestTemperature,
        latestSteps,
        breedingEvents: breedingCountMap[cow.id] || 0,
        traitValues: {
          ...traitValues,
          score
        },
        traitRecordCounts: traitStats.traitRecordCounts
      }
    })
    .sort((left, right) => right.score - left.score)
}

export function buildBullCandidateRows(snapshot: PlatformSnapshot): CandidateScoreRow[] {
  const latestSensorMap = getLatestSensorMap(snapshot.sensors)
  const breedingCountMap = getBreedingCountMap(snapshot.breedingRecords)
  const healthScoreMap = getHealthScoreMap(snapshot.healthScores)

  return snapshot.cows
    .filter(
      (cow) => String(cow.gender || '').includes('公') || String(cow.type || '').includes('种公')
    )
    .map((cow) => {
      const latestSensor = latestSensorMap[cow.id]
      const latestTemperature = toFiniteNumber((latestSensor as any)?.temperature)
      const latestSteps = toFiniteNumber((latestSensor as any)?.steps)
      const pedigreeScore = getPedigreeCompleteness(cow)
      const progenyMilk = getAveragePhenotypeValue(snapshot, cow, [
        'progeny_milk_yield',
        'daughter_milk_yield',
        'milk_yield'
      ])
      const milkScore =
        progenyMilk === null ? 0 : Math.min(100, Math.round((progenyMilk / 12) * 100))
      const healthScore = Math.round(getHealthScoreForCow(healthScoreMap, cow) ?? 0)
      const activityScore = Math.min(100, Math.round(((latestSteps ?? 0) / 9000) * 100))
      const omicsEvidence = buildOmicsEvidence(cow, snapshot)
      const statusBonus = normalizeStatus(cow.status) === '异常' ? 0 : 92
      const traitStats = getCowTraitStats(snapshot, cow)

      const score = Math.round(
        pedigreeScore * 0.26 +
          milkScore * 0.12 +
          healthScore * 0.24 +
          activityScore * 0.08 +
          statusBonus * 0.12 +
          omicsEvidence.score * 0.18
      )
      const traitValues = {
        ...traitStats.traitValues,
        score,
        milkScore,
        genomicScore: omicsEvidence.score,
        pedigreeScore,
        healthScore,
        activityScore,
        averageMilk: progenyMilk ?? 0,
        breedingEvents: breedingCountMap[cow.id] || 0,
        milk_yield: traitStats.traitValues.milk_yield ?? progenyMilk ?? 0,
        daily_steps: traitStats.traitValues.daily_steps ?? latestSteps ?? 0
      }

      return {
        cow,
        score,
        genomicScore: omicsEvidence.score,
        candidateTag: buildCandidateTag(score),
        decisionSummary:
          omicsEvidence.score >= 70 && score >= 85
            ? '组学证据和健康系谱表现均较强，适合作为重点种公牛进入育种审核。'
            : score >= 85
              ? '适合作为优先选配种公牛，支撑高产与健康性状改良。'
              : score >= 75
                ? '具备选配价值，建议专家结合近交风险与后裔记录复核。'
                : '证据仍需补齐，暂作为备选种公牛管理。',
        supportEvidence: [
          buildEvidenceItem('系谱完整度', `${pedigreeScore}%`),
          buildEvidenceItem('后裔/繁殖记录', `${breedingCountMap[cow.id] || 0} 条`),
          buildEvidenceItem('健康评分', healthScore || null),
          buildEvidenceItem('活动评分', activityScore || null),
          buildEvidenceItem('组学证据分', omicsEvidence.score),
          buildEvidenceItem(
            '候选基因/标记',
            omicsEvidence.candidateGenes.concat(omicsEvidence.candidateMarkers).join('、') || null
          ),
          omicsEvidence.evidenceText
        ],
        pedigreeScore,
        milkScore,
        healthScore,
        activityScore,
        averageMilk: 0,
        latestTemperature,
        latestSteps,
        breedingEvents: breedingCountMap[cow.id] || 0,
        traitValues,
        traitRecordCounts: traitStats.traitRecordCounts
      }
    })
    .sort((left, right) => right.score - left.score)
}

export function buildMatingRecommendations(snapshot: PlatformSnapshot) {
  const females = buildFemaleCandidateRows(snapshot).slice(0, 8)
  const bulls = buildBullCandidateRows(snapshot).slice(0, 5)

  return females.slice(0, 6).map((female, index) => {
    const preferredBull =
      bulls.find(
        (bull) => bull.cow.fatherNumber && bull.cow.fatherNumber !== female.cow.fatherNumber
      ) || bulls[index % Math.max(1, bulls.length)]

    const inbreedingRisk =
      preferredBull &&
      [preferredBull.cow.fatherNumber, preferredBull.cow.motherNumber].some(
        (item) => item && [female.cow.fatherNumber, female.cow.motherNumber].includes(item)
      )

    const compatibility = Math.max(
      55,
      Math.min(
        97,
        Math.round((female.score + (preferredBull?.score || 60)) / 2 + (inbreedingRisk ? -18 : 6))
      )
    )

    return {
      female,
      bull: preferredBull || null,
      compatibility,
      inbreedingRisk: Boolean(inbreedingRisk),
      recommendation: inbreedingRisk
        ? '建议更换父系，避免近交风险后再生成选配。'
        : compatibility >= 85
          ? '推荐进入优先选配批次，可用于高产与高繁双目标。'
          : '适合保守配对，建议结合繁殖窗口再次确认。'
    }
  })
}
