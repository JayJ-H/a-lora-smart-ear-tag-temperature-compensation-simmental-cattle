import * as databaseService from '@/services/database'
import { buildCowReferenceContext, resolveCowRef } from '@/utils/cow-reference'

interface FactRecord {
  [key: string]: any
}

interface ParityWindow {
  id: string
  cowKey: string
  cowId: string
  cowNumber: string
  parityNo: number
  startTime: number
  endTime: number | null
  startDate: string
  endDate: string | null
  lactationEndTime: number | null
  lactationEndDate: string | null
  startEventId: string
  endEventId: string
}

let pendingTimer: ReturnType<typeof setTimeout> | null = null
let rebuildRunning = false
let pendingReason = ''

export function scheduleProductionFactRebuild(reason = 'data_change') {
  if ((globalThis as any).__SKIP_PRODUCTION_FACT_REBUILD__) return
  if (isBackendAccessMode()) return
  pendingReason = reason
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    void runScheduledProductionFactRebuild()
  }, 5000)
  ;(pendingTimer as any)?.unref?.()
}

async function runScheduledProductionFactRebuild() {
  if (rebuildRunning) {
    scheduleProductionFactRebuild(pendingReason || 'data_change')
    return
  }
  const reason = pendingReason || 'data_change'
  pendingReason = ''
  rebuildRunning = true
  try {
    await rebuildProductionFacts({ reason })
  } catch (error) {
    console.error('重算生产周期事实失败:', error)
  } finally {
    rebuildRunning = false
    if (pendingReason) scheduleProductionFactRebuild(pendingReason)
  }
}

export async function rebuildProductionFacts(options: { reason?: string } = {}) {
  if (isBackendAccessMode()) {
    console.warn(
      `生产事实重算已在后端模式下跳过：${options.reason || 'manual'}；请由后端任务消费 derivation_recompute_job`
    )
    return {
      parityEpisodes: 0,
      lactationEpisodes: 0,
      animalTimeIndexRows: 0,
      lactation305Facts: 0,
      traitParityFacts: 0
    }
  }
  const [
    cows,
    animals,
    identifiers,
    animalEvents,
    cowEvents,
    breedingEvents,
    traitObservations,
    phenotypeRecords,
    milkMeasurements,
    milkRecords,
    existingParityEpisodes,
    existingLactationEpisodes,
    existingLactation305Facts
  ] = await Promise.all([
    readTable('cows'),
    readTable('animal'),
    readTable('animal_identifier'),
    readTable('animal_event'),
    readTable('cow-events'),
    readTable('breeding-events'),
    readTable('trait_observation'),
    readTable('phenotype-records'),
    readTable('milk_measurement'),
    readTable('milk-records'),
    readTable('parity_episode'),
    readTable('lactation_episode'),
    readTable('fact_lactation_305')
  ])

  const cowContext = buildCowReferenceContext(
    [...(cows || []), ...(animals || [])],
    identifiers || []
  )
  const validAnimalIds = new Set(
    (animals || [])
      .map((row: any) => text(row.id || row.animalId || row.animal_id || row.cowId || row.cow_id))
      .filter(Boolean)
  )
  const traitDefinitions = await readTable('trait_definition')
  const validTraitIds = new Set(
    (traitDefinitions || [])
      .map((row: any) => text(row.id || row.traitId || row.trait_id))
      .filter(Boolean)
  )
  const traitIdByCode = new Map(
    (traitDefinitions || [])
      .map(
        (row: any) =>
          [
            text(row.code || row.traitCode || row.trait_code),
            text(row.id || row.traitId || row.trait_id)
          ] as [string, string]
      )
      .filter(([code, id]) => code && id)
  )
  const events = normalizeEvents({ animalEvents, cowEvents, breedingEvents }, cowContext).filter(
    (row) => row.cowId && validAnimalIds.has(row.cowId)
  )
  const parityWindows = buildParityWindows(events)
  const parityRows = parityWindows.map((window, index, all) => {
    const isCurrent = window.endTime === null
    return {
      id: window.id,
      animalId: window.cowId,
      animal_id: window.cowId,
      cowId: window.cowId,
      cow_id: window.cowId,
      animalNumber: window.cowNumber,
      animal_number: window.cowNumber,
      cowNumber: window.cowNumber,
      cow_number: window.cowNumber,
      parityNo: window.parityNo,
      parity_no: window.parityNo,
      startDate: window.startDate,
      start_date: window.startDate,
      endDate: window.endDate || null,
      end_date: window.endDate || null,
      startEventId: window.startEventId,
      start_event_id: window.startEventId,
      endEventId: window.endEventId,
      end_event_id: window.endEventId,
      parityStatus: isCurrent ? 'current' : 'closed',
      parity_status: isCurrent ? 'current' : 'closed',
      isCurrent,
      is_current: isCurrent,
      sourceType: 'derived_from_calving_events',
      source_type: 'derived_from_calving_events',
      createdAt: nowIso(),
      created_at: nowIso(),
      updatedAt: nowIso(),
      updated_at: nowIso(),
      sequenceInCow:
        all
          .filter((item) => item.cowKey === window.cowKey)
          .findIndex((item) => item.id === window.id) + 1,
      sequence_in_cow:
        all
          .filter((item) => item.cowKey === window.cowKey)
          .findIndex((item) => item.id === window.id) + 1
    }
  })

  const lactationRows = parityWindows.map((window) => ({
    id: stableId('lactation_episode', window.cowKey, window.parityNo),
    animalId: window.cowId,
    animal_id: window.cowId,
    cowId: window.cowId,
    cow_id: window.cowId,
    animalNumber: window.cowNumber,
    animal_number: window.cowNumber,
    cowNumber: window.cowNumber,
    cow_number: window.cowNumber,
    lactationNo: window.parityNo,
    lactation_no: window.parityNo,
    parityNo: window.parityNo,
    parity_no: window.parityNo,
    startDate: window.startDate,
    start_date: window.startDate,
    endDate: window.lactationEndDate || null,
    end_date: window.lactationEndDate || null,
    parityEndDate: window.endDate || null,
    parity_end_date: window.endDate || null,
    daysInMilkMax: daysBetween(window.startTime, window.lactationEndTime || Date.now()),
    days_in_milk_max: daysBetween(window.startTime, window.lactationEndTime || Date.now()),
    status: window.lactationEndTime === null ? 'current' : 'closed',
    sourceType: 'derived_from_parity_episode',
    source_type: 'derived_from_parity_episode',
    createdAt: nowIso(),
    created_at: nowIso(),
    updatedAt: nowIso(),
    updated_at: nowIso()
  }))

  await ensureDailyTimePeriods(parityWindows)

  const updatedMilkMeasurements = applyMilkPeriodFields(
    milkMeasurements,
    'milk_measurement',
    cowContext,
    parityWindows
  )
  const updatedMilkRecords = applyMilkPeriodFields(
    milkRecords,
    'milk-records',
    cowContext,
    parityWindows
  )

  const allTraitRows = normalizeTraitRows(
    {
      traitObservations,
      phenotypeRecords,
      milkMeasurements: updatedMilkMeasurements,
      milkRecords: updatedMilkRecords
    },
    cowContext,
    parityWindows
  ).filter((row) => row.cowId && validAnimalIds.has(row.cowId))
  await ensureFactTraitDefinitions(allTraitRows, validTraitIds, traitIdByCode)
  const timeIndexRows = buildAnimalTimeIndex(parityWindows)
  const retainedSummaryLactation305Rows = retainUploadedSummaryRows(
    existingLactation305Facts,
    cowContext,
    validAnimalIds
  )
  const retainedSummaryKeys = new Set(
    retainedSummaryLactation305Rows.map(summaryFactKey).filter(Boolean)
  )
  const retainedSummaryParityRows = retainUploadedSummaryRows(
    existingParityEpisodes,
    cowContext,
    validAnimalIds,
    retainedSummaryKeys
  )
  const retainedSummaryLactationRows = retainUploadedSummaryRows(
    existingLactationEpisodes,
    cowContext,
    validAnimalIds,
    retainedSummaryKeys
  )
  const lactation305Rows = mergeFactRows(
    buildLactation305Facts(allTraitRows, parityWindows),
    retainedSummaryLactation305Rows
  )
  const traitParityRows = buildTraitParityFacts(
    allTraitRows.filter((row) => row.traitId && validTraitIds.has(row.traitId)),
    parityWindows
  )

  await Promise.all([
    replaceFactTable('parity_episode', mergeFactRows(parityRows, retainedSummaryParityRows)),
    replaceFactTable(
      'lactation_episode',
      mergeFactRows(lactationRows, retainedSummaryLactationRows)
    ),
    replaceFactTable('animal_time_index', timeIndexRows),
    replaceFactTable('fact_lactation_305', lactation305Rows),
    replaceFactTable('fact_cow_trait_parity', traitParityRows),
    replaceFactTable('milk_measurement', updatedMilkMeasurements),
    replaceFactTable('milk-records', updatedMilkRecords)
  ])

  await databaseService.addTableDataAsync('operation-audit-logs', {
    id: `facts-rebuild-${Date.now()}`,
    action_type: 'rebuild_production_facts',
    target_type: 'production_facts',
    target_id: options.reason || 'manual',
    operator: 'system',
    operator_name: 'system',
    status: 'completed',
    request_payload: { reason: options.reason || 'manual' },
    result_payload: {
      parityEpisodes: parityRows.length,
      lactationEpisodes: lactationRows.length,
      animalTimeIndexRows: timeIndexRows.length,
      lactation305Facts: lactation305Rows.length,
      traitParityFacts: traitParityRows.length,
      milkPeriodRows: updatedMilkMeasurements.length
    },
    created_at: nowIso(),
    updated_at: nowIso()
  })

  return {
    parityEpisodes: parityRows.length,
    lactationEpisodes: lactationRows.length,
    animalTimeIndexRows: timeIndexRows.length,
    lactation305Facts: lactation305Rows.length,
    traitParityFacts: traitParityRows.length,
    milkPeriodRows: updatedMilkMeasurements.length
  }
}

function isBackendAccessMode() {
  return import.meta.env.VITE_ACCESS_MODE === 'backend'
}

async function readTable(tableName: string) {
  return databaseService.getTableDataAsync(tableName, { silent: true }).catch(() => [])
}

async function replaceFactTable(tableName: string, rows: any[]) {
  try {
    await databaseService.updateTableDataAsync(tableName, rows)
    return
  } catch (error) {
    if (!isPayloadTooLarge(error)) throw error
  }
  await databaseService.updateTableDataAsync(tableName, [])
  const chunkSize = tableName === 'animal_time_index' ? 500 : 1000
  for (let index = 0; index < rows.length; index += chunkSize) {
    await databaseService.addTableDataFastAsync(tableName, rows.slice(index, index + chunkSize))
  }
}

function applyMilkPeriodFields(
  rows: any[],
  sourceTable: string,
  cowContext: ReturnType<typeof buildCowReferenceContext>,
  windows: ParityWindow[]
) {
  return (rows || []).map((row) => {
    const date =
      row.measuredAt ||
      row.measured_at ||
      row.milkingTime ||
      row.milking_time ||
      row.productionDate ||
      row.production_date ||
      row.createdAt ||
      row.created_at
    const time = parseTime(date)
    const resolved = resolveCowRef(row, cowContext)
    const window =
      resolveWindow(windows, resolved.sourceKey, time) ||
      resolveWindowByCow(row, cowContext, windows, time)
    if (!window) return row
    const dim = daysBetween(window.startTime, time)
    return {
      ...row,
      animalId: resolved.cowId || row.animalId || row.animal_id || row.cowId || row.cow_id,
      animal_id: resolved.cowId || row.animal_id || row.animalId || row.cow_id || row.cowId,
      cowId: resolved.cowId || row.cowId || row.cow_id || row.animalId || row.animal_id,
      cow_id: resolved.cowId || row.cow_id || row.cowId || row.animal_id || row.animalId,
      animalNumber:
        resolved.cowNumber ||
        row.animalNumber ||
        row.animal_number ||
        row.cowNumber ||
        row.cow_number,
      animal_number:
        resolved.cowNumber ||
        row.animal_number ||
        row.animalNumber ||
        row.cow_number ||
        row.cowNumber,
      cowNumber:
        resolved.cowNumber ||
        row.cowNumber ||
        row.cow_number ||
        row.animalNumber ||
        row.animal_number,
      cow_number:
        resolved.cowNumber ||
        row.cow_number ||
        row.cowNumber ||
        row.animal_number ||
        row.animalNumber,
      parityNo: window.parityNo,
      parity_no: window.parityNo,
      lactationNo: window.parityNo,
      lactation_no: window.parityNo,
      lactationId: stableId('lactation_episode', window.cowKey, window.parityNo),
      lactation_id: stableId('lactation_episode', window.cowKey, window.parityNo),
      daysInMilk: dim,
      days_in_milk: dim,
      lactationStartDate: window.startDate,
      lactation_start_date: window.startDate,
      lactationEndDate: window.lactationEndDate || null,
      lactation_end_date: window.lactationEndDate || null,
      periodSource: 'system_derived_from_calving_events',
      period_source: 'system_derived_from_calving_events',
      periodUpdatedAt: nowIso(),
      period_updated_at: nowIso(),
      sourceTable: row.sourceTable || row.source_table || sourceTable,
      source_table: row.source_table || row.sourceTable || sourceTable,
      updatedAt: nowIso(),
      updated_at: nowIso()
    }
  })
}

function isPayloadTooLarge(error: unknown) {
  const message = String(error instanceof Error ? error.message : error)
  return /Request Entity Too Large|Payload Too Large|413/i.test(message)
}

function retainUploadedSummaryRows(
  rows: any[],
  cowContext: ReturnType<typeof buildCowReferenceContext>,
  validAnimalIds: Set<string>,
  acceptedKeys: Set<string> = new Set()
) {
  return (rows || [])
    .map((row) => {
      const resolved = resolveCowRef(row, cowContext)
      if (!resolved.cowId || !validAnimalIds.has(resolved.cowId)) return null
      const normalized = {
        ...row,
        animalId: resolved.cowId,
        animal_id: resolved.cowId,
        cowId: resolved.cowId,
        cow_id: resolved.cowId,
        animalNumber:
          resolved.cowNumber ||
          text(row.animalNumber || row.animal_number || row.cowNumber || row.cow_number),
        animal_number:
          resolved.cowNumber ||
          text(row.animalNumber || row.animal_number || row.cowNumber || row.cow_number),
        cowNumber:
          resolved.cowNumber ||
          text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
        cow_number:
          resolved.cowNumber ||
          text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number)
      }
      const key = summaryFactKey(normalized)
      if (!isUploadedSummaryFact(normalized) && (!key || !acceptedKeys.has(key))) return null
      return {
        ...normalized,
        sourceType: text(
          normalized.sourceType || normalized.source_type || 'uploaded_summary_retained'
        ),
        source_type: text(
          normalized.source_type || normalized.sourceType || 'uploaded_summary_retained'
        ),
        updatedAt: nowIso(),
        updated_at: nowIso()
      }
    })
    .filter(Boolean) as FactRecord[]
}

function mergeFactRows(primary: FactRecord[], retained: FactRecord[]) {
  const map = new Map<string, FactRecord>()
  retained.forEach((row) => {
    const key = factMergeKey(row)
    if (key) map.set(key, row)
  })
  primary.forEach((row) => {
    const key = factMergeKey(row)
    if (key) map.set(key, row)
  })
  return Array.from(map.values())
}

function factMergeKey(row: FactRecord) {
  return summaryFactKey(row) || text(row.id)
}

function summaryFactKey(row: FactRecord) {
  const cow = text(
    row.cowId ||
      row.cow_id ||
      row.animalId ||
      row.animal_id ||
      row.cowNumber ||
      row.cow_number ||
      row.animalNumber ||
      row.animal_number
  )
  const parityNo = positiveInteger(
    row.parityNo ?? row.parity_no ?? row.lactationNo ?? row.lactation_no
  )
  const startDate = dateKey(
    row.startDate || row.start_date || row.lactationStartDate || row.lactation_start_date
  )
  return cow && parityNo && startDate ? `${cow}|${parityNo}|${startDate}` : ''
}

function isUploadedSummaryFact(row: FactRecord) {
  const textValue = [
    row.sourceType,
    row.source_type,
    row.sourceTable,
    row.source_table,
    row.methodCode,
    row.method_code,
    row.notes
  ]
    .map(text)
    .join(' ')
  return /milk_summary|uploaded_profile_summary|uploaded_summary|information-import|泌乳汇总|汇总导入/.test(
    textValue
  )
}

function normalizeEvents(
  input: { animalEvents: any[]; cowEvents: any[]; breedingEvents: any[] },
  cowContext: ReturnType<typeof buildCowReferenceContext>
) {
  const rows: FactRecord[] = []
  input.animalEvents.forEach((row) => rows.push(normalizeEventRow(row, 'animal_event', cowContext)))
  input.cowEvents.forEach((row) =>
    rows.push(
      normalizeEventRow(
        row,
        canonicalEventSourceTable(row.sourceTable || row.source_table || 'cow-events'),
        cowContext
      )
    )
  )
  input.breedingEvents.forEach((row) =>
    rows.push(normalizeEventRow(row, 'breeding-events', cowContext))
  )
  const sortedRows = rows.sort(
    (left, right) => sourcePriority(left.sourceTable) - sourcePriority(right.sourceTable)
  )
  const seen = new Set<string>()
  return sortedRows.filter((row) => {
    if (!row.cowKey || !row.eventType || !Number.isFinite(row.eventTime)) return false
    const keys = eventDedupKeys(row)
    if (keys.some((key) => seen.has(key))) return false
    keys.forEach((key) => seen.add(key))
    return true
  })
}

function normalizeEventRow(
  row: any,
  sourceTable: string,
  cowContext: ReturnType<typeof buildCowReferenceContext>
) {
  const details = parseObject(row.details || row.customValues || row.custom_values)
  const resolved = resolveCowRef({ ...details, ...row }, cowContext)
  const eventDate = text(
    row.occurredAt ||
      row.occurred_at ||
      row.eventTime ||
      row.event_time ||
      row.eventDate ||
      row.event_date ||
      row.productionDate ||
      row.production_date ||
      row.createdAt ||
      row.created_at
  )
  return {
    id: text(row.id),
    cowId: resolved.cowId,
    cowNumber:
      resolved.cowNumber ||
      text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
    cowKey: resolved.sourceKey,
    eventType: normalizeEventType(
      row.eventType ||
        row.event_type ||
        row.eventCode ||
        row.event_code ||
        row.eventName ||
        row.event_name
    ),
    eventDate: dateKey(eventDate),
    eventTime: parseTime(eventDate),
    eventMoment: exactTimeKey(eventDate),
    parityNo: positiveInteger(
      row.parityNo ??
        row.parity_no ??
        row.parity ??
        details.parityNo ??
        details.parity_no ??
        details.parity
    ),
    sourceTable,
    sourceRecordId: text(row.sourceRecordId || row.source_record_id || row.id)
  }
}

function buildParityWindows(events: FactRecord[]): ParityWindow[] {
  const grouped = new Map<string, FactRecord[]>()
  events
    .filter((row) => row.eventType === 'calving')
    .sort((left, right) => left.eventTime - right.eventTime)
    .forEach((row) => {
      grouped.set(row.cowKey, [...(grouped.get(row.cowKey) || []), row])
    })

  const windows: ParityWindow[] = []
  grouped.forEach((rows, cowKey) => {
    let inferredParity = 0
    rows.forEach((row, index) => {
      const next = rows[index + 1]
      const anchoredParity = positiveInteger(row.parityNo)
      const parityNo = anchoredParity || inferredParity + 1
      inferredParity = parityNo
      const endTime = next ? next.eventTime : null
      const parityEndDate = next ? dateKey(endTime! - 86400000) : null
      const dryOff = events
        .filter(
          (item) =>
            item.cowKey === cowKey &&
            item.eventType === 'dry_off' &&
            item.eventTime > row.eventTime &&
            (!next || item.eventTime < next.eventTime)
        )
        .sort((left, right) => left.eventTime - right.eventTime)[0]
      windows.push({
        id: stableId('parity_episode', cowKey, parityNo),
        cowKey,
        cowId: row.cowId,
        cowNumber: row.cowNumber,
        parityNo,
        startTime: row.eventTime,
        endTime,
        startDate: row.eventDate,
        endDate: parityEndDate,
        lactationEndTime: dryOff?.eventTime || endTime,
        lactationEndDate: dryOff?.eventDate || parityEndDate,
        startEventId: row.sourceRecordId || row.id,
        endEventId: next?.sourceRecordId || next?.id || ''
      })
    })
  })
  return windows
}

function normalizeTraitRows(
  input: {
    traitObservations: any[]
    phenotypeRecords: any[]
    milkMeasurements: any[]
    milkRecords: any[]
  },
  cowContext: ReturnType<typeof buildCowReferenceContext>,
  windows: ParityWindow[]
) {
  const rows: FactRecord[] = []
  input.traitObservations.forEach((row) =>
    pushTraitRow(rows, row, 'trait_observation', cowContext, windows, {
      traitCode: row.traitCode || row.trait_code,
      traitName: row.traitName || row.trait_name,
      traitId: row.traitId || row.trait_id,
      value: row.numericValue ?? row.numeric_value ?? row.value,
      unit: row.unit,
      date:
        row.observedAt ||
        row.observed_at ||
        row.collectionDate ||
        row.collection_date ||
        row.createdAt ||
        row.created_at
    })
  )
  input.phenotypeRecords.forEach((row) =>
    pushTraitRow(rows, row, 'phenotype-records', cowContext, windows, {
      traitCode: row.traitCode || row.trait_code,
      traitName: row.traitName || row.trait_name,
      traitId: row.traitId || row.trait_id,
      value: row.numericValue ?? row.numeric_value ?? row.value,
      unit: row.unit,
      date:
        row.collectionDate ||
        row.collection_date ||
        row.observedAt ||
        row.observed_at ||
        row.createdAt ||
        row.created_at
    })
  )
  input.milkMeasurements.forEach((row) => {
    const base = {
      date:
        row.measuredAt ||
        row.measured_at ||
        row.milkingTime ||
        row.milking_time ||
        row.createdAt ||
        row.created_at,
      parityNo: row.parityNo ?? row.parity_no,
      daysInMilk: row.daysInMilk ?? row.days_in_milk
    }
    ;[
      ['milk_yield', '产奶量', row.milkYield ?? row.milk_yield ?? row.volume, 'kg'],
      ['milk_fat', '乳脂率', row.fatPercent ?? row.fat_percent ?? row.fat, '%'],
      ['milk_protein', '乳蛋白率', row.proteinPercent ?? row.protein_percent ?? row.protein, '%'],
      ['milk_lactose', '乳糖率', row.lactosePercent ?? row.lactose_percent ?? row.lactose, '%'],
      [
        'somatic_cell_count',
        '体细胞数',
        row.somaticCellCount ?? row.somatic_cell_count ?? row.scc,
        'cells/mL'
      ]
    ].forEach(([traitCode, traitName, value, unit]) =>
      pushTraitRow(rows, row, 'milk_measurement', cowContext, windows, {
        ...base,
        traitCode,
        traitName,
        value,
        unit
      })
    )
  })
  input.milkRecords.forEach((row) => {
    const base = {
      date:
        row.milkingTime ||
        row.milking_time ||
        row.measuredAt ||
        row.measured_at ||
        row.createdAt ||
        row.created_at,
      parityNo: row.parityNo ?? row.parity_no,
      daysInMilk: row.daysInMilk ?? row.days_in_milk
    }
    ;[
      [
        'milk_yield',
        '产奶量',
        row.milkYield ?? row.milk_yield ?? row.yield ?? row.volume ?? row.milkVolume,
        'kg'
      ],
      [
        'milk_fat',
        '乳脂率',
        row.fatRate ?? row.fat_rate ?? row.fatPercent ?? row.fat_percent ?? row.fat,
        '%'
      ],
      [
        'milk_protein',
        '乳蛋白率',
        row.proteinRate ??
          row.protein_rate ??
          row.proteinPercent ??
          row.protein_percent ??
          row.protein,
        '%'
      ],
      [
        'milk_lactose',
        '乳糖率',
        row.lactoseRate ??
          row.lactose_rate ??
          row.lactosePercent ??
          row.lactose_percent ??
          row.lactose,
        '%'
      ],
      [
        'somatic_cell_count',
        '体细胞数',
        row.somaticCellCount ?? row.somatic_cell_count ?? row.scc,
        'cells/mL'
      ]
    ].forEach(([traitCode, traitName, value, unit]) =>
      pushTraitRow(rows, row, 'milk-records', cowContext, windows, {
        ...base,
        traitCode,
        traitName,
        value,
        unit
      })
    )
  })
  return dedupeTraitRows(rows)
}

function pushTraitRow(
  rows: FactRecord[],
  record: any,
  sourceTable: string,
  cowContext: ReturnType<typeof buildCowReferenceContext>,
  windows: ParityWindow[],
  input: Record<string, any>
) {
  const value = numeric(input.value)
  if (value === null) return
  const date = dateKey(input.date)
  const time = parseTime(date)
  if (!Number.isFinite(time)) return
  const resolved = resolveCowRef(record, cowContext)
  const window = resolveWindow(windows, resolved.sourceKey, time)
  const rawParityNo = positiveInteger(input.parityNo)
  const rawDim = positiveInteger(input.daysInMilk)
  const parityNo = window?.parityNo || rawParityNo || null
  const dim = window ? daysBetween(window.startTime, time) : rawDim || null
  rows.push({
    id: text(record.id),
    cowId: resolved.cowId,
    cowNumber:
      resolved.cowNumber ||
      text(record.cowNumber || record.cow_number || record.animalNumber || record.animal_number),
    cowKey: resolved.sourceKey,
    traitCode: text(input.traitCode),
    traitId: text(input.traitId || record.traitId || record.trait_id),
    traitName: text(input.traitName || input.traitCode),
    value,
    unit: text(input.unit),
    date,
    time,
    moment: exactTimeKey(input.date),
    parityNo,
    daysInMilk: dim,
    rawParityNo,
    rawDaysInMilk: rawDim,
    paritySource: window
      ? 'system_derived_from_calving_events'
      : rawParityNo
        ? 'raw_record_fallback'
        : '',
    parityConflict: !!(window && rawParityNo && rawParityNo !== window.parityNo),
    daysInMilkSource: window
      ? 'system_derived_from_calving_events'
      : rawDim
        ? 'raw_record_fallback'
        : '',
    daysInMilkConflict: !!(window && rawDim && rawDim !== dim),
    sourceTable,
    sourceRecordId: text(record.id)
  })
}

function buildAnimalTimeIndex(windows: ParityWindow[]) {
  const today = startOfDay(Date.now())
  const rows: FactRecord[] = []
  windows.forEach((window) => {
    const rawEnd =
      window.endTime === null
        ? Math.min(today, window.startTime + 450 * 86400000)
        : window.endTime - 86400000
    const end = Math.max(window.startTime, rawEnd)
    for (let time = startOfDay(window.startTime); time <= startOfDay(end); time += 86400000) {
      const dim = daysBetween(window.startTime, time)
      rows.push({
        id: stableId('animal_time_index', window.cowKey, dateKey(time)),
        animalId: window.cowId,
        animal_id: window.cowId,
        cowId: window.cowId,
        cow_id: window.cowId,
        animalNumber: window.cowNumber,
        animal_number: window.cowNumber,
        cowNumber: window.cowNumber,
        cow_number: window.cowNumber,
        date: dateKey(time),
        productionDate: dateKey(time),
        production_date: dateKey(time),
        periodId: stableId('time_day', dateKey(time)),
        period_id: stableId('time_day', dateKey(time)),
        periodType: 'day',
        period_type: 'day',
        periodKey: dateKey(time),
        period_key: dateKey(time),
        parityNo: window.parityNo,
        parity_no: window.parityNo,
        lactationNo: window.parityNo,
        lactation_no: window.parityNo,
        daysInMilk: dim,
        days_in_milk: dim,
        productionStage:
          window.lactationEndTime && time > window.lactationEndTime
            ? '干奶期'
            : dim <= 305
              ? '泌乳期'
              : '泌乳后期',
        production_stage:
          window.lactationEndTime && time > window.lactationEndTime
            ? '干奶期'
            : dim <= 305
              ? '泌乳期'
              : '泌乳后期',
        sourceType: 'derived_from_parity_episode',
        source_type: 'derived_from_parity_episode',
        createdAt: nowIso(),
        created_at: nowIso(),
        updatedAt: nowIso(),
        updated_at: nowIso()
      })
    }
  })
  return rows
}

async function ensureDailyTimePeriods(windows: ParityWindow[]) {
  const existingRows = await readTable('time_period')
  const existingIds = new Set((existingRows || []).map((row: any) => text(row.id)).filter(Boolean))
  const today = startOfDay(Date.now())
  const rows: FactRecord[] = []
  windows.forEach((window) => {
    const rawEnd =
      window.endTime === null
        ? Math.min(today, window.startTime + 450 * 86400000)
        : window.endTime - 86400000
    const end = Math.max(window.startTime, rawEnd)
    for (let time = startOfDay(window.startTime); time <= startOfDay(end); time += 86400000) {
      const key = dateKey(time)
      const id = stableId('time_day', key)
      if (existingIds.has(id)) continue
      existingIds.add(id)
      rows.push({
        id,
        periodType: 'day',
        period_type: 'day',
        periodKey: key,
        period_key: key,
        startAt: `${key} 00:00:00`,
        start_at: `${key} 00:00:00`,
        endAt: `${key} 23:59:59`,
        end_at: `${key} 23:59:59`,
        label: key,
        sourceEntityType: 'production_fact_rebuild',
        source_entity_type: 'production_fact_rebuild',
        sourceEntityId: 'system',
        source_entity_id: 'system',
        createdAt: nowIso(),
        created_at: nowIso(),
        updatedAt: nowIso(),
        updated_at: nowIso()
      })
    }
  })
  if (rows.length) await databaseService.addTableDataAsync('time_period', rows)
}

async function ensureFactTraitDefinitions(
  traitRows: FactRecord[],
  validTraitIds: Set<string>,
  traitIdByCode: Map<string, string>
) {
  const byCode = new Map<string, FactRecord>()
  traitRows.forEach((row) => {
    const code = text(row.traitCode)
    if (!code) return
    const existingId = traitIdByCode.get(code)
    if (existingId) {
      row.traitId = existingId
      return
    }
    const explicitId = text(row.traitId)
    if (explicitId && validTraitIds.has(explicitId)) {
      traitIdByCode.set(code, explicitId)
      return
    }
    const generatedId = explicitId || `trait-${code}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64)
    row.traitId = generatedId
    byCode.set(code, row)
  })
  if (!byCode.size) return
  const now = nowIso()
  const rows = Array.from(byCode.values()).map((row) => ({
    id: row.traitId,
    code: row.traitCode,
    name: row.traitName || row.traitCode,
    traitType:
      row.traitCode === 'milk_yield' ||
      String(row.traitCode || '').startsWith('milk_') ||
      row.traitCode === 'somatic_cell_count'
        ? 'lactation'
        : 'phenotype',
    trait_type:
      row.traitCode === 'milk_yield' ||
      String(row.traitCode || '').startsWith('milk_') ||
      row.traitCode === 'somatic_cell_count'
        ? 'lactation'
        : 'phenotype',
    dataType: 'number',
    data_type: 'number',
    unit: row.unit,
    status: 'active',
    exportEnabled: 1,
    export_enabled: 1,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }))
  await databaseService.addTableDataAsync('trait_definition', rows)
  rows.forEach((row) => {
    validTraitIds.add(text(row.id))
    traitIdByCode.set(text(row.code), text(row.id))
  })
}

function buildLactation305Facts(traitRows: FactRecord[], windows: ParityWindow[]) {
  const milkRows = traitRows.filter(
    (row) =>
      row.traitCode === 'milk_yield' && row.parityNo && row.daysInMilk >= 1 && row.daysInMilk <= 305
  )
  const dedupedMilkRows = Array.from(
    groupBy(
      milkRows,
      (row) => `${row.cowKey}|${row.parityNo}|${row.date || row.daysInMilk}`
    ).values()
  ).flatMap((rows) => {
    const shiftRows = rows.filter((row) => !isDailyMilkSummary(row))
    return shiftRows.length ? shiftRows : rows
  })
  const grouped = groupBy(dedupedMilkRows, (row) => `${row.cowKey}|${row.parityNo}`)
  return Array.from(grouped.entries()).map(([key, rows]) => {
    const first = rows.slice().sort((left, right) => left.time - right.time)[0]
    const window = windows.find((item) => `${item.cowKey}|${item.parityNo}` === key)
    const values = rows.map((row) => row.value)
    const coverageDays = new Set(rows.map((row) => row.daysInMilk)).size
    return {
      id: stableId('fact_lactation_305', first.cowKey, first.parityNo),
      animalId: first.cowId,
      animal_id: first.cowId,
      lactationId: stableId('lactation_episode', first.cowKey, first.parityNo),
      lactation_id: stableId('lactation_episode', first.cowKey, first.parityNo),
      cowId: first.cowId,
      cow_id: first.cowId,
      animalNumber: first.cowNumber,
      animal_number: first.cowNumber,
      cowNumber: first.cowNumber,
      cow_number: first.cowNumber,
      parityNo: first.parityNo,
      parity_no: first.parityNo,
      lactationNo: first.parityNo,
      lactation_no: first.parityNo,
      milkYield305: round(values.reduce((sum, value) => sum + value, 0)),
      milk_yield_305: round(values.reduce((sum, value) => sum + value, 0)),
      milk305: round(values.reduce((sum, value) => sum + value, 0)),
      milk_305: round(values.reduce((sum, value) => sum + value, 0)),
      recordCount: rows.length,
      record_count: rows.length,
      recordDays: coverageDays,
      record_days: coverageDays,
      estimatedFlag: coverageDays < 305 ? 1 : 0,
      estimated_flag: coverageDays < 305 ? 1 : 0,
      methodCode: 'sum_observed_dim_1_305',
      method_code: 'sum_observed_dim_1_305',
      coverageDays,
      coverage_days: coverageDays,
      missingDays: Math.max(0, 305 - coverageDays),
      missing_days: Math.max(0, 305 - coverageDays),
      startDate: window?.startDate || first.date,
      start_date: window?.startDate || first.date,
      endDate:
        rows
          .map((row) => row.date)
          .sort()
          .at(-1) || null,
      end_date:
        rows
          .map((row) => row.date)
          .sort()
          .at(-1) || null,
      recomputedAt: nowIso(),
      recomputed_at: nowIso(),
      sourceTable: unique(rows.map((row) => row.sourceTable)).join(','),
      source_table: unique(rows.map((row) => row.sourceTable)).join(','),
      sourceRecordIds: unique(rows.map((row) => `${row.sourceTable}:${row.sourceRecordId}`)),
      source_record_ids: unique(rows.map((row) => `${row.sourceTable}:${row.sourceRecordId}`)),
      createdAt: nowIso(),
      created_at: nowIso(),
      updatedAt: nowIso(),
      updated_at: nowIso()
    }
  })
}

function buildTraitParityFacts(traitRows: FactRecord[], windows: ParityWindow[]) {
  const grouped = groupBy(
    traitRows.filter((row) => row.traitCode && row.parityNo),
    (row) => `${row.cowKey}|${row.parityNo}|${row.traitCode}`
  )
  const rows: FactRecord[] = []
  grouped.forEach((group, key) => {
    const first = group.slice().sort((left, right) => left.time - right.time)[0]
    const values = group.map((row) => row.value)
    const sorted = values.slice().sort((left, right) => left - right)
    const mid = Math.floor(sorted.length / 2)
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    const window = windows.find(
      (item) => item.cowKey === first.cowKey && item.parityNo === first.parityNo
    )
    const latest = group.slice().sort((left, right) => right.time - left.time)[0].value
    rows.push({
      id: stableId('fact_cow_trait_parity', key),
      animalId: first.cowId,
      animal_id: first.cowId,
      cowId: first.cowId,
      cow_id: first.cowId,
      animalNumber: first.cowNumber,
      animal_number: first.cowNumber,
      cowNumber: first.cowNumber,
      cow_number: first.cowNumber,
      traitCode: first.traitCode,
      trait_code: first.traitCode,
      traitId: first.traitId,
      trait_id: first.traitId,
      traitName: first.traitName,
      trait_name: first.traitName,
      parityNo: first.parityNo,
      parity_no: first.parityNo,
      aggregation: 'summary',
      value: latest,
      latestValue: latest,
      latest_value: latest,
      medianValue: round(median),
      median_value: round(median),
      unit: first.unit,
      recordCount: group.length,
      record_count: group.length,
      sampleCount: group.length,
      sample_count: group.length,
      minValue: Math.min(...values),
      min_value: Math.min(...values),
      maxValue: Math.max(...values),
      max_value: Math.max(...values),
      avgValue: round(values.reduce((sum, item) => sum + item, 0) / values.length),
      avg_value: round(values.reduce((sum, item) => sum + item, 0) / values.length),
      sumValue: round(values.reduce((sum, item) => sum + item, 0)),
      sum_value: round(values.reduce((sum, item) => sum + item, 0)),
      startDate: window?.startDate || group.map((row) => row.date).sort()[0],
      start_date: window?.startDate || group.map((row) => row.date).sort()[0],
      endDate:
        window?.endDate ||
        group
          .map((row) => row.date)
          .sort()
          .at(-1) ||
        null,
      end_date:
        window?.endDate ||
        group
          .map((row) => row.date)
          .sort()
          .at(-1) ||
        null,
      recomputedAt: nowIso(),
      recomputed_at: nowIso(),
      sourceTable: unique(group.map((row) => row.sourceTable)).join(','),
      source_table: unique(group.map((row) => row.sourceTable)).join(','),
      sourceRecordIds: unique(group.map((row) => `${row.sourceTable}:${row.sourceRecordId}`)),
      source_record_ids: unique(group.map((row) => `${row.sourceTable}:${row.sourceRecordId}`)),
      createdAt: nowIso(),
      created_at: nowIso(),
      updatedAt: nowIso(),
      updated_at: nowIso()
    })
  })
  return rows
}

function resolveWindow(windows: ParityWindow[], cowKey: string, time: number) {
  return windows.find(
    (window) =>
      window.cowKey === cowKey &&
      time >= window.startTime &&
      (window.endTime === null || time < window.endTime)
  )
}

function resolveWindowByCow(
  row: any,
  cowContext: ReturnType<typeof buildCowReferenceContext>,
  windows: ParityWindow[],
  time: number
) {
  const resolved = resolveCowRef(row, cowContext)
  return windows.find(
    (window) =>
      ((resolved.cowId && window.cowId === resolved.cowId) ||
        (resolved.cowNumber && window.cowNumber === resolved.cowNumber)) &&
      time >= window.startTime &&
      (window.endTime === null || time < window.endTime)
  )
}

function groupBy<T>(rows: T[], keyFn: (row: T) => string) {
  const map = new Map<string, T[]>()
  rows.forEach((row) => {
    const key = keyFn(row)
    map.set(key, [...(map.get(key) || []), row])
  })
  return map
}

function normalizeEventType(value: unknown) {
  const raw = text(value).toLowerCase()
  if (
    raw.includes('calving') ||
    raw.includes('delivery') ||
    raw.includes('产犊') ||
    raw.includes('分娩')
  )
    return 'calving'
  if (
    raw.includes('insemination') ||
    raw.includes('breeding') ||
    raw.includes('semen') ||
    raw.includes('配种') ||
    raw.includes('输精') ||
    raw.includes('人工授精')
  )
    return 'insemination'
  if (raw.includes('pregnancy') || raw.includes('妊检') || raw.includes('妊娠检查'))
    return 'pregnancy_check'
  if (raw.includes('abortion') || raw.includes('流产')) return 'abortion'
  if (raw.includes('dry_off') || raw.includes('dry off') || raw.includes('干奶') || raw.includes('停产')) return 'dry_off'
  return raw || 'general_event'
}

function eventDedupKeys(row: FactRecord) {
  return unique([
    row.sourceRecordId ? `record:${row.cowKey}|${row.eventType}|${row.sourceRecordId}` : '',
    row.id ? `id:${row.cowKey}|${row.eventType}|${row.id}` : '',
    row.eventMoment
      ? `business:${row.cowKey}|${row.eventType}|${row.eventMoment}|${row.parityNo || ''}`
      : ''
  ])
}

function dedupeTraitRows(rows: FactRecord[]) {
  const seen = new Set<string>()
  return rows
    .sort((left, right) => sourcePriority(left.sourceTable) - sourcePriority(right.sourceTable))
    .filter((row) => {
      const keys = unique([
        row.sourceRecordId ? `record:${row.cowKey}|${row.traitCode}|${row.sourceRecordId}` : '',
        row.id ? `id:${row.cowKey}|${row.traitCode}|${row.id}` : '',
        row.moment ? `business:${row.cowKey}|${row.traitCode}|${row.moment}|${row.value}` : ''
      ])
      if (keys.some((key) => seen.has(key))) return false
      keys.forEach((key) => seen.add(key))
      return true
    })
}

function sourcePriority(sourceTable: unknown) {
  const source = canonicalEventSourceTable(sourceTable)
  if (source === 'animal_event' || source === 'trait_observation' || source === 'milk_measurement')
    return 0
  if (source === 'cow-events' || source === 'phenotype-records' || source === 'milk-records')
    return 1
  return 2
}

function canonicalEventSourceTable(sourceTable: unknown) {
  const source = text(sourceTable)
  return source === 'cow-events' ? 'animal_event' : source
}

function positiveInteger(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : 0
}

function exactTimeKey(value: unknown) {
  const raw = text(value)
  if (!raw) return ''
  const time = value instanceof Date ? value.getTime() : Date.parse(raw)
  if (!Number.isFinite(time)) return dateKey(raw)
  return new Date(time).toISOString()
}

function parseObject(value: unknown): Record<string, any> {
  if (!value) return {}
  if (typeof value === 'object') return value as Record<string, any>
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function stableId(...parts: unknown[]) {
  const raw = parts
    .map((part) => text(part))
    .filter(Boolean)
    .join('|')
  let hash = 0x811c9dc5
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${text(parts[0]) || 'id'}-${hash.toString(16).padStart(8, '0')}`
}

function parseTime(value: unknown) {
  const time = value instanceof Date ? value.getTime() : Date.parse(text(value))
  return Number.isFinite(time) ? startOfDay(time) : Number.NaN
}

function dateKey(value: unknown) {
  const time = typeof value === 'number' ? value : parseTime(value)
  if (!Number.isFinite(time)) return ''
  return localDateKey(startOfDay(time))
}

function startOfDay(time: number) {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function localDateKey(time: number) {
  const date = new Date(time)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function isDailyMilkSummary(row: FactRecord) {
  return (
    text(row.shiftId).includes('日汇总') ||
    text(row.sourceRecordId).includes('summary') ||
    text(row.sourceTable).includes('summary')
  )
}

function daysBetween(startTime: number, endTime: number) {
  return Math.max(1, Math.floor((startOfDay(endTime) - startOfDay(startTime)) / 86400000) + 1)
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function round(value: number) {
  return Math.round(value * 10000) / 10000
}

function unique(values: unknown[]) {
  return Array.from(new Set(values.map((value) => text(value)).filter(Boolean)))
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function nowIso() {
  return new Date().toISOString()
}
