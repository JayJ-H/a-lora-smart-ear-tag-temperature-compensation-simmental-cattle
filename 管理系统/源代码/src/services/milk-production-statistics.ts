import * as databaseService from '@/services/database'
import { buildCowReferenceContext, resolveCowRef } from '@/utils/cow-reference'
import { rebuildProductionFacts } from './production-facts'

type AnyRow = Record<string, any>

export type MilkReviewPeriod = 'day' | 'month' | 'year'

export interface MilkMissingReviewItem {
  id: string
  cowId: string
  cowNumber: string
  cowName: string
  breed: string
  parityNo: number
  lactationId: string
  lactationStartDate: string
  lactationEndDate: string
  date: string
  dim: number
  expectedShift: string
  missingKind: 'day' | 'shift' | 'empty_value' | 'summary_only'
  existingShiftCount: number
  existingDailyMilk: number
  recommendedMilk: number
  recommendationMethod:
    | 'lactation_305_curve'
    | 'curve_interpolation'
    | 'recent_average'
    | 'neighbor_average'
    | 'summary_profile'
    | 'cow_average'
    | 'manual_required'
  recommendationText: string
  confidence: 'high' | 'medium' | 'low'
  status: 'pending' | 'confirmed' | 'ignored'
  sourceRecordIds: string[]
  monthKey: string
  yearKey: string
  summaryDays?: number
  summaryTotalMilk?: number
  summaryDailyMilk?: number
  sourceSummaryId?: string
  previousDays?: Array<{
    date: string
    value: number | null
    valueText: string
  }>
}

export interface MilkMissingReviewSummary {
  totalMissingDays: number
  totalMissingShifts: number
  totalEmptyValues: number
  totalSummaryOnly: number
  pendingCount: number
  confirmedCount: number
  cowCount: number
  monthCount: number
  yearCount: number
  avgRecommendedMilk: number
}

export interface MilkMissingReviewResult {
  items: MilkMissingReviewItem[]
  summary: MilkMissingReviewSummary
  generatedAt: string
}

export interface ConfirmMilkFillOptions {
  itemIds: string[]
  operatorName?: string
  values?: Record<string, number>
  startDate?: string
  endDate?: string
  expectedShifts?: string[]
}

export interface ConfirmMilkFillResult {
  confirmed: number
  measurementIds: string[]
}

const EXPECTED_SHIFTS = ['早班', '中班', '晚班', '夜班', '半夜班', '1', '2', '3', '4']
const DAY_MS = 86400000
const MAX_RECOMMENDABLE_MISSING_RUN_DAYS = 3
const WOOD_305_CURVE_B = 0.18
const WOOD_305_CURVE_C = 0.0035

export async function buildMilkMissingReview(
  options: {
    startDate?: string
    endDate?: string
    period?: MilkReviewPeriod
    expectedShifts?: string[]
    includeFuture?: boolean
  } = {}
): Promise<MilkMissingReviewResult> {
  const generatedAt = new Date().toISOString()
  const expectedShifts = normalizeExpectedShifts(options.expectedShifts)
  const context = await loadMilkContext()
  const reviewState = await loadReviewState()
  const milkRows = normalizeMilkRows(context)
  const emptyValueRows = normalizeEmptyMilkRows(context)
  const emptyValueBySlot = new Map(
    emptyValueRows.map((row) => [`${row.cowKey}|${row.date}|${row.shift || '全天'}`, row])
  )
  const lactationRows = normalizeLactationRows(context, milkRows)
  const todayKey = dateKey(Date.now())
  const rangeStart = parseDay(options.startDate)
  const rangeEnd = parseDay(options.endDate)
  const items: MilkMissingReviewItem[] = []

  lactationRows.forEach((episode) => {
    const rows = milkRows
      .filter((row) => row.cowKey === episode.cowKey)
      .filter((row) => !episode.parityNo || !row.parityNo || row.parityNo === episode.parityNo)
      .filter(
        (row) => row.time >= episode.startTime && (!episode.endTime || row.time <= episode.endTime)
      )
      .sort((left, right) => left.time - right.time)
    const byDate = groupMilkByDate(rows)
    const start = Math.max(episode.startTime, rangeStart ?? episode.startTime)
    const summaryDays = positiveInt(
      episode.reportedDaysInMilk ?? episode.coverageDays ?? episode.recordCount
    )
    const summaryEnd = summaryDays ? episode.startTime + (summaryDays - 1) * DAY_MS : Number.NaN
    const lastRowTime = rows.at(-1)?.time
    const rawEnd =
      episode.endTime ??
      (Number.isFinite(summaryEnd)
        ? Math.max(lastRowTime ?? summaryEnd, summaryEnd)
        : (lastRowTime ?? Date.now()))
    const end = Math.min(
      rawEnd,
      rangeEnd ?? rawEnd,
      options.includeFuture ? rawEnd : parseDay(todayKey)
    )
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return

    if (!rows.length && hasMilkSummary(episode)) {
      const itemDate = episode.startDate
      const dim = daysBetween(episode.startTime, start)
      const itemId = stableId(
        'milk-summary-only',
        episode.cowKey,
        episode.parityNo,
        episode.lactationId,
        summaryDays || itemDate
      )
      const state = reviewState.get(itemId)
      if (state?.status !== 'confirmed') {
        const recommendation = recommendSummaryProfileValue(episode, expectedShifts.length)
        items.push({
          id: itemId,
          cowId: episode.cowId,
          cowNumber: episode.cowNumber,
          cowName: episode.cowName,
          breed: episode.breed,
          parityNo: episode.parityNo,
          lactationId: episode.lactationId,
          lactationStartDate: episode.startDate,
          lactationEndDate: episode.endDate || '',
          date: itemDate,
          dim,
          expectedShift: '日汇总',
          missingKind: 'summary_only',
          existingShiftCount: 0,
          existingDailyMilk: 0,
          recommendedMilk: state?.recommendedMilk || recommendation.value,
          recommendationMethod: 'summary_profile',
          recommendationText: recommendation.text,
          confidence: recommendation.confidence,
          status: (state?.status as MilkMissingReviewItem['status']) || 'pending',
          sourceRecordIds: sourceSummaryRecordIds(episode),
          monthKey: itemDate.slice(0, 7),
          yearKey: itemDate.slice(0, 4),
          summaryDays: recommendation.days,
          summaryTotalMilk: recommendation.totalMilk,
          summaryDailyMilk: recommendation.value,
          sourceSummaryId: episode.summaryId,
          previousDays: buildPreviousMilkDays(rows, episode.startTime)
        })
      }
      return
    }

    for (let time = startOfDay(start); time <= startOfDay(end); time += DAY_MS) {
      const currentDate = dateKey(time)
      const dayRows = byDate.get(currentDate) || []
      const dim = daysBetween(episode.startTime, time)
      const existingDailyMilk = round(dayRows.reduce((sum, row) => sum + row.milkYield, 0))
      const presentShifts = new Set(dayRows.map((row) => row.shift).filter(Boolean))
      if (presentShifts.has('日汇总')) continue
      const missingShifts = expectedShifts.filter((shift) => !presentShifts.has(shift))
      if (dayRows.length && !missingShifts.length) continue
      const targetShifts = dayRows.length
        ? missingShifts
        : expectedShifts.length
          ? expectedShifts
          : ['全天']
      const splitCount = Math.max(1, expectedShifts.length || targetShifts.length)
      targetShifts.forEach((shift) => {
        const emptySlot = emptyValueBySlot.get(`${episode.cowKey}|${currentDate}|${shift}`)
        const itemId = emptySlot
          ? stableId(
              'milk-empty-value',
              emptySlot.cowKey,
              emptySlot.date,
              shift,
              emptySlot.sourceTable,
              emptySlot.sourceRecordId || emptySlot.id
            )
          : stableId('milk-missing', episode.cowKey, episode.parityNo, currentDate, shift)
        const state = reviewState.get(itemId)
        if (state?.status === 'confirmed') return
        const recommendation = getMilkRecommendation(rows, time, dim, splitCount)
        if (!recommendation) return
        const sourceRecordIds = emptySlot
          ? [`${emptySlot.sourceTable}:${emptySlot.sourceRecordId || emptySlot.id}`]
          : dayRows.map((row) => `${row.sourceTable}:${row.sourceRecordId}`)
        items.push({
          id: itemId,
          cowId: episode.cowId,
          cowNumber: episode.cowNumber,
          cowName: episode.cowName,
          breed: episode.breed,
          parityNo: episode.parityNo,
          lactationId: episode.lactationId,
          lactationStartDate: episode.startDate,
          lactationEndDate: episode.endDate || '',
          date: currentDate,
          dim,
          expectedShift: shift,
          missingKind: emptySlot ? 'empty_value' : dayRows.length ? 'shift' : 'day',
          existingShiftCount: dayRows.length,
          existingDailyMilk,
          recommendedMilk: state?.recommendedMilk || recommendation.value,
          recommendationMethod: recommendation.method,
          recommendationText: recommendation.text,
          confidence: recommendation.confidence,
          status: (state?.status as MilkMissingReviewItem['status']) || 'pending',
          sourceRecordIds,
          monthKey: currentDate.slice(0, 7),
          yearKey: currentDate.slice(0, 4),
          previousDays: buildPreviousMilkDays(rows, time)
        })
      })
    }
  })

  return {
    items,
    summary: summarizeReviewItems(items, reviewState),
    generatedAt
  }
}

export async function confirmMilkMissingRecommendations(
  options: ConfirmMilkFillOptions
): Promise<ConfirmMilkFillResult> {
  const review = await buildMilkMissingReview({
    includeFuture: false,
    startDate: options.startDate,
    endDate: options.endDate,
    expectedShifts: options.expectedShifts
  })
  const selectedIds = new Set(options.itemIds)
  const selectedItems = review.items.filter((item) => selectedIds.has(item.id))
  const operatorName = text(options.operatorName) || '泌乳复核员'
  const now = new Date().toISOString()
  const measurementIds: string[] = []

  for (const item of selectedItems) {
    const milkYield = round(options.values?.[item.id] ?? item.recommendedMilk)
    if (!Number.isFinite(milkYield) || milkYield <= 0) continue
    if (item.missingKind === 'summary_only') {
      const ids = await confirmSummaryOnlyItem(item, milkYield, operatorName, now)
      measurementIds.push(...ids)
      continue
    }
    const measuredAt = shiftTime(item.date, item.expectedShift)
    const sessionCode = `补录-${item.date}-${item.expectedShift}`
    const sessionId = stableId('milking-session', sessionCode)
    const visitId = stableId('milking-visit', sessionCode, item.cowId || item.cowNumber, measuredAt)
    const measurementId = stableId('milk-fill', item.id)
    const common = {
      id: measurementId,
      sessionId,
      session_id: sessionId,
      visitId,
      visit_id: visitId,
      animalId: item.cowId,
      animal_id: item.cowId,
      cowId: item.cowId,
      cow_id: item.cowId,
      animalNumber: item.cowNumber,
      animal_number: item.cowNumber,
      cowNumber: item.cowNumber,
      cow_number: item.cowNumber,
      measuredAt,
      measured_at: measuredAt,
      milkingTime: measuredAt,
      productionDate: item.date,
      production_date: item.date,
      shiftId: item.expectedShift,
      shift_id: item.expectedShift,
      sessionCode,
      session_code: sessionCode,
      parityNo: item.parityNo,
      parity_no: item.parityNo,
      lactationId: item.lactationId,
      lactation_id: item.lactationId,
      daysInMilk: item.dim,
      days_in_milk: item.dim,
      periodSource: 'system_derived_from_milk_missing_review',
      period_source: 'system_derived_from_milk_missing_review',
      milkYield: milkYield,
      milk_yield: milkYield,
      volume: milkYield,
      sourceType: 'operator_confirmed_imputation',
      source_type: 'operator_confirmed_imputation',
      sourceTable: 'milk_missing_review',
      source_table: 'milk_missing_review',
      sourceRecordId: item.id,
      source_record_id: item.id,
      qualityFlag: 'estimated_confirmed',
      quality_flag: 'estimated_confirmed',
      operatorName,
      operator_name: operatorName,
      notes: `${item.date} ${item.expectedShift} 缺失产奶记录，经人工确认按${methodLabel(item.recommendationMethod)}填补。`,
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    }

    await upsert('milking_session', {
      id: sessionId,
      sessionCode,
      session_code: sessionCode,
      productionDate: item.date,
      production_date: item.date,
      startedAt: measuredAt,
      started_at: measuredAt,
      shiftId: item.expectedShift,
      shift_id: item.expectedShift,
      sourceType: 'operator_confirmed_imputation',
      source_type: 'operator_confirmed_imputation',
      operatorName,
      operator_name: operatorName,
      status: 'recorded',
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    })
    await upsert('milking_visit', {
      ...common,
      id: visitId,
      enteredAt: measuredAt,
      entered_at: measuredAt,
      qualityFlag: 'estimated_confirmed',
      quality_flag: 'estimated_confirmed'
    })
    await upsert('milk_measurement', common)
    await upsert('milk-records', {
      ...common,
      id: measurementId,
      milkQuality: { grade: '补录', source: '人工确认填补' },
      milk_quality: { grade: '补录', source: '人工确认填补' },
      milkVolume: milkYield,
      milkingMethod: 'manual_confirmed_imputation'
    })
    await upsert(
      'data_quality_issue',
      buildReviewIssueRow(item, 'confirmed', milkYield, operatorName, now, measurementId)
    )
    await databaseService.addTableDataAsync('operation-audit-logs', {
      id: stableId('audit', measurementId),
      action_type: 'confirm_milk_missing_fill',
      target_type: 'milk_measurement',
      target_id: measurementId,
      operator: operatorName,
      operator_name: operatorName,
      status: 'completed',
      request_payload: { item, confirmedValue: milkYield },
      result_payload: { measurementId, sessionId, visitId },
      cow_ids: [item.cowId].filter(Boolean),
      source_record_ids: [item.id],
      created_at: now,
      updated_at: now
    })
    measurementIds.push(measurementId)
  }

  if (measurementIds.length) {
    await rebuildProductionFacts({ reason: 'milk_missing_confirmed_fill' }).catch((error) => {
      console.error('确认填补后重算生产周期事实失败:', error)
    })
  }

  return { confirmed: measurementIds.length, measurementIds }
}

async function loadMilkContext() {
  const [
    cows,
    animals,
    identifiers,
    lactations,
    parityRows,
    factLactation305,
    milkMeasurements,
    milkRecords,
    qualityIssues
  ] = await Promise.all([
    readTable('cows'),
    readTable('animal'),
    readTable('animal_identifier'),
    readTable('lactation_episode'),
    readTable('parity_episode'),
    readTable('fact_lactation_305'),
    readTable('milk_measurement'),
    readTable('milk-records'),
    readTable('data_quality_issue')
  ])
  const mergedCows = mergeCowRows(cows, animals)
  const cowContext = buildCowReferenceContext(mergedCows, identifiers)
  return {
    cows: mergedCows,
    lactations,
    parityRows,
    factLactation305,
    milkMeasurements,
    milkRecords,
    qualityIssues,
    cowContext
  }
}

async function loadReviewState() {
  const rows = await readTable('data_quality_issue')
  const map = new Map<string, AnyRow>()
  rows
    .filter((row) => text(row.issueType || row.issue_type) === 'milk_missing_production')
    .forEach((row) => {
      const detail = parseObject(row.detail || row.detail_json || row.payload)
      const id = text(row.sourceRecordId || row.source_record_id || detail.reviewItemId || row.id)
      if (!id) return
      map.set(id, {
        status: text(row.issueStatus || row.issue_status || row.status),
        recommendedMilk: numeric(detail.recommendedMilk)
      })
    })
  return map
}

function normalizeMilkRows(context: Awaited<ReturnType<typeof loadMilkContext>>) {
  const rows = dedupeMilkRows([...context.milkMeasurements, ...context.milkRecords], context)
  return rows
    .map((row) => {
      const cow = resolveCowRef(row, context.cowContext)
      const timeText = text(
        row.measuredAt ||
          row.measured_at ||
          row.milkingTime ||
          row.milking_time ||
          row.createdAt ||
          row.created_at
      )
      const time = parseDayTime(timeText)
      const milkYield = numeric(row.milkYield ?? row.milk_yield ?? row.volume ?? row.milkVolume)
      if (!cow.sourceKey || !Number.isFinite(time) || milkYield === null) return null
      return {
        ...row,
        cowKey: cow.sourceKey,
        cowId: cow.cowId,
        cowNumber:
          cow.cowNumber ||
          text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
        time,
        date: dateKey(time),
        shift: normalizeShift(row.shiftId || row.shift_id || row.sessionCode || row.session_code, timeText),
        parityNo: positiveInt(row.parityNo ?? row.parity_no),
        daysInMilk: positiveInt(row.daysInMilk ?? row.days_in_milk),
        milkYield,
        sourceTable: text(
          row.sourceTable ||
            row.source_table ||
            (row.measured_at ? 'milk_measurement' : 'milk-records')
        ),
        sourceRecordId: text(row.sourceRecordId || row.source_record_id || row.id)
      }
    })
    .filter(Boolean) as Array<
    AnyRow & { cowKey: string; time: number; date: string; milkYield: number; parityNo: number }
  >
}

function normalizeEmptyMilkRows(context: Awaited<ReturnType<typeof loadMilkContext>>) {
  const rows = dedupeMilkRows([...context.milkMeasurements, ...context.milkRecords], context)
  return rows
    .map((row) => {
      const milkYield = numeric(row.milkYield ?? row.milk_yield ?? row.volume ?? row.milkVolume)
      if (milkYield !== null) return null
      const cow = resolveCowRef(row, context.cowContext)
      const timeText = text(
        row.measuredAt ||
          row.measured_at ||
          row.milkingTime ||
          row.milking_time ||
          row.createdAt ||
          row.created_at
      )
      const time = parseDayTime(timeText)
      if (!cow.sourceKey || !Number.isFinite(time)) return null
      return {
        ...row,
        id: text(row.id),
        cowKey: cow.sourceKey,
        cowId: cow.cowId,
        cowNumber:
          cow.cowNumber ||
          text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
        time,
        date: dateKey(time),
        shift: normalizeShift(row.shiftId || row.shift_id || row.sessionCode || row.session_code, timeText),
        parityNo: positiveInt(row.parityNo ?? row.parity_no),
        daysInMilk: positiveInt(row.daysInMilk ?? row.days_in_milk),
        sourceTable: text(
          row.sourceTable ||
            row.source_table ||
            (row.measured_at ? 'milk_measurement' : 'milk-records')
        ),
        sourceRecordId: text(row.sourceRecordId || row.source_record_id || row.id)
      }
    })
    .filter(Boolean) as Array<
    AnyRow & { cowKey: string; time: number; date: string; parityNo: number }
  >
}

function dedupeMilkRows(rows: AnyRow[], context: Awaited<ReturnType<typeof loadMilkContext>>) {
  const map = new Map<string, AnyRow>()
  rows.forEach((row) => {
    const cow = resolveCowRef(row, context.cowContext)
    const timeText = text(
      row.measuredAt ||
        row.measured_at ||
        row.milkingTime ||
        row.milking_time ||
        row.createdAt ||
        row.created_at
    )
    const time = parseDayTime(timeText)
    const date = Number.isFinite(time)
      ? dateKey(time)
      : text(row.productionDate || row.production_date)
    const shift = normalizeShift(row.shiftId || row.shift_id || row.sessionCode || row.session_code, timeText)
    const sourceRank =
      text(row.sourceTable || row.source_table || '').includes('milk_measurement') ||
      row.measured_at
        ? 0
        : 1
    const key = [
      cow.sourceKey ||
        cow.cowNumber ||
        text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
      date,
      shift,
      round(Number(row.milkYield ?? row.milk_yield ?? row.volume ?? row.milkVolume))
    ].join('|')
    const previous = map.get(key)
    if (!previous || sourceRank < Number(previous.__sourceRank || 9)) {
      map.set(key, { ...row, __sourceRank: sourceRank })
    }
  })
  return Array.from(map.values())
}

function normalizeLactationRows(
  context: Awaited<ReturnType<typeof loadMilkContext>>,
  milkRows: ReturnType<typeof normalizeMilkRows>
) {
  const lactations = context.lactations.length ? context.lactations : context.parityRows
  const rows = lactations
    .map((row) => {
      const cow = resolveCowRef(row, context.cowContext)
      const start = parseDay(row.startDate || row.start_date)
      const endText = text(row.endDate || row.end_date || row.dryOffDate || row.dry_off_date)
      if (!cow.sourceKey || !Number.isFinite(start)) return null
      const cowRow = cow.cow || {}
      const parityNo = positiveInt(
        row.parityNo ?? row.parity_no ?? row.lactationNo ?? row.lactation_no
      )
      return {
        cowKey: cow.sourceKey,
        cowId: cow.cowId,
        cowNumber:
          cow.cowNumber ||
          text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
        cowName: text(cowRow.cowName || cowRow.name),
        breed: text(cowRow.breed),
        parityNo,
        lactationId: text(row.id || stableId('lactation_episode', cow.sourceKey, parityNo)),
        startTime: startOfDay(start),
        endTime: endText ? startOfDay(parseDay(endText)) : null,
        startDate: dateKey(start),
        endDate: endText ? dateKey(parseDay(endText)) : '',
        reportedDaysInMilk: positiveInt(
          row.daysInMilk ?? row.days_in_milk ?? row.daysInMilkMax ?? row.days_in_milk_max
        ),
        coverageDays: positiveInt(row.coverageDays ?? row.coverage_days),
        recordCount: positiveInt(row.recordCount ?? row.record_count),
        reportedMilk305: numeric(
          row.reportedMilk305 ??
            row.reported_milk_305 ??
            row.milkYield305 ??
            row.milk_yield_305 ??
            row.milk305 ??
            row.milk_305
        ),
        reportedParityYield: numeric(
          row.reportedParityYield ??
            row.reported_parity_yield ??
            row.parityYield ??
            row.parity_yield
        ),
        reportedAvgDailyMilk: numeric(
          row.reportedAvgDailyMilk ??
            row.reported_avg_daily_milk ??
            row.avgDailyMilk ??
            row.avg_daily_milk
        ),
        summaryId: text(row.id),
        summarySourceTable: context.lactations.length ? 'lactation_episode' : 'parity_episode'
      }
    })
    .filter(Boolean) as AnyRow[]

  const summaryRows = normalizeSummaryProfileRows(context)
  const mergedRows = mergeLactationRows(rows, summaryRows)
  if (mergedRows.length) return mergedRows

  const grouped = groupBy(milkRows, (row) => `${row.cowKey}|${row.parityNo || 1}`)
  return Array.from(grouped.entries()).map(([key, group]) => {
    const first = group.slice().sort((left, right) => left.time - right.time)[0]
    const last = group.slice().sort((left, right) => right.time - left.time)[0]
    const [cowKey, parityText] = key.split('|')
    return {
      cowKey,
      cowId: first.cowId,
      cowNumber: first.cowNumber,
      cowName: '',
      breed: '',
      parityNo: positiveInt(parityText) || 1,
      lactationId: stableId('lactation_episode', cowKey, parityText),
      startTime: first.daysInMilk ? first.time - (first.daysInMilk - 1) * DAY_MS : first.time,
      endTime: last.time,
      startDate: dateKey(
        first.daysInMilk ? first.time - (first.daysInMilk - 1) * DAY_MS : first.time
      ),
      endDate: dateKey(last.time)
    }
  })
}

function recommendMilkValue(rows: AnyRow[], targetTime: number, dim: number, splitCount: number) {
  const dailyRows = Array.from(groupMilkByDate(rows).entries())
    .map(([date, group]) => ({
      date,
      time: parseDay(date),
      dim:
        rows.find((row) => row.date === date)?.daysInMilk ||
        daysBetween(rows[0]?.time || targetTime, parseDay(date)),
      value: group.reduce((sum, row) => sum + row.milkYield, 0)
    }))
    .sort((left, right) => left.time - right.time)
  const allValues = dailyRows.map((row) => row.value).filter((value) => value > 0)
  if (allValues.length < 2) {
    return {
      value: 0,
      method: 'manual_required' as const,
      confidence: 'low' as const,
      text: '有效产奶记录少于 2 次，系统不生成自动补偿值，需要人工核对。'
    }
  }
  const missingLength = missingRunLength(dailyRows, targetTime)
  if (missingLength > MAX_RECOMMENDABLE_MISSING_RUN_DAYS) {
    return {
      value: 0,
      method: 'manual_required' as const,
      confidence: 'low' as const,
      text: `连续缺失 ${missingLength} 天，超过 3 天自动补偿上限，需要人工核对。`
    }
  }

  if (dim >= 1 && dim <= 305) {
    return (
      recommend305CurveDailyValue(dailyRows, dim, splitCount) || {
        value: 0,
        method: 'manual_required' as const,
        confidence: 'low' as const,
        text: '305 天曲线可用观测点不足，系统不生成自动补偿值，需要人工核对。'
      }
    )
  }

  if (dim > 305) {
    const recent7 = dailyRows.filter((row) => row.time < targetTime).slice(-7)
    const recent14 = dailyRows.filter((row) => row.time < targetTime).slice(-14)
    const recent = recent7.length >= 3 ? recent7 : recent14
    if (recent.length >= 3) {
      const value = average(recent.map((row) => row.value))
      const days = recent7.length >= 3 ? 7 : 14
      return {
        value: round(value / Math.max(1, splitCount)),
        method: 'recent_average' as const,
        confidence: recent.length >= 5 ? ('medium' as const) : ('low' as const),
        text: `DIM ${dim} 已超过 305 天，按该牛近 ${days} 天可用产奶记录均值。`
      }
    }
  }

  const recent = nearestDailyRows(dailyRows, targetTime, 14)
  if (recent.length >= 2) {
    const value = average(recent.map((row) => row.value))
    return {
      value: round(value / Math.max(1, splitCount)),
      method: 'cow_average' as const,
      confidence: recent.length >= 5 ? ('medium' as const) : ('low' as const),
      text: `当前 DIM 周边记录不足，按该牛最近 ${recent.length} 个可用日记录均值兜底。`
    }
  }
  return {
    value: round(average(allValues) / Math.max(1, splitCount)),
    method: 'cow_average' as const,
    confidence: 'low' as const,
    text: '当前个体邻近记录不足，按该牛可用记录均值兜底。'
  }
}

function getMilkRecommendation(
  rows: AnyRow[],
  targetTime: number,
  dim: number,
  splitCount: number
) {
  return recommendMilkValue(rows, targetTime, dim, splitCount)
}

function missingRunLength(
  dailyRows: Array<{ time: number; value: number }>,
  targetTime: number
) {
  const presentTimes = new Set(
    dailyRows.filter((row) => row.value > 0).map((row) => startOfDay(row.time))
  )
  const target = startOfDay(targetTime)
  if (presentTimes.has(target)) return 0
  const bounds = Array.from(presentTimes.values()).filter((time) => Number.isFinite(time))
  if (!bounds.length) return Number.POSITIVE_INFINITY
  const minTime = Math.min(...bounds)
  const maxTime = Math.max(...bounds)
  if (target < minTime) return Math.max(1, Math.floor((minTime - target) / DAY_MS))
  if (target > maxTime) return Math.max(1, Math.floor((target - maxTime) / DAY_MS))
  let length = 1
  for (let time = target - DAY_MS; time >= minTime && !presentTimes.has(time); time -= DAY_MS) {
    length += 1
  }
  for (let time = target + DAY_MS; time <= maxTime && !presentTimes.has(time); time += DAY_MS) {
    length += 1
  }
  return length
}

function recommend305CurveDailyValue(
  dailyRows: Array<{ time: number; dim: number; value: number }>,
  dim: number,
  splitCount: number
) {
  const observed = dailyRows
    .filter((row) => row.value > 0 && row.dim >= 1 && row.dim <= 305)
    .map((row) => {
      const shape = wood305CurveShape(row.dim)
      return {
        ...row,
        shape,
        scale: shape > 0 ? row.value / shape : 0,
        distance: Math.abs(row.dim - dim)
      }
    })
    .filter((row) => row.scale > 0 && Number.isFinite(row.scale))
  if (observed.length < 2) return null

  const targetShape = wood305CurveShape(dim)
  const weightedScale =
    observed.reduce((sum, row) => sum + row.scale * curvePointWeight(row.distance), 0) /
    observed.reduce((sum, row) => sum + curvePointWeight(row.distance), 0)
  const rawValue = targetShape * weightedScale
  const observedValues = observed.map((row) => row.value)
  const boundedValue = clamp(rawValue, Math.min(...observedValues) * 0.6, Math.max(...observedValues) * 1.5)
  const nearestDistance = Math.min(...observed.map((row) => row.distance))
  const confidence =
    observed.length >= 5 && nearestDistance <= 30
      ? ('high' as const)
      : observed.length >= 3 && nearestDistance <= 45
        ? ('medium' as const)
        : ('low' as const)
  return {
    value: round(boundedValue / Math.max(1, splitCount)),
    method: 'lactation_305_curve' as const,
    confidence,
    text: `DIM ${dim} 位于胎次后 305 天内，按 Wood 型 305 天泌乳曲线并用同牛 ${observed.length} 个观测 DIM 点缩放推荐。`
  }
}

function wood305CurveShape(dim: number) {
  const safeDim = Math.max(1, Math.min(305, Math.trunc(dim || 1)))
  return Math.pow(safeDim, WOOD_305_CURVE_B) * Math.exp(-WOOD_305_CURVE_C * safeDim)
}

function curvePointWeight(distance: number) {
  return 1 / (1 + Math.max(0, distance) / 21)
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, min), max)
}

function nearestDailyRows(
  rows: Array<{ time: number; value: number }>,
  targetTime: number,
  limit: number
) {
  return rows
    .filter((row) => row.time !== targetTime && row.value > 0)
    .map((row) => ({ ...row, distance: Math.abs(row.time - targetTime) }))
    .sort((left, right) => left.distance - right.distance || left.time - right.time)
    .slice(0, Math.max(1, limit))
}

function buildPreviousMilkDays(
  rows: AnyRow[],
  targetTime: number
): NonNullable<MilkMissingReviewItem['previousDays']> {
  const dailyMilk = new Map<string, number>()
  groupMilkByDate(rows).forEach((group, date) => {
    dailyMilk.set(date, round(group.reduce((sum, row) => sum + row.milkYield, 0)))
  })
  return Array.from({ length: 5 }, (_, index) => {
    const time = startOfDay(targetTime) - (5 - index) * DAY_MS
    const date = dateKey(time)
    const value = dailyMilk.get(date)
    return {
      date,
      value: value ?? null,
      valueText: value === undefined ? '缺记录' : `${value.toFixed(1)} kg`
    }
  })
}

function summarizeReviewItems(
  items: MilkMissingReviewItem[],
  reviewState: Map<string, AnyRow>
): MilkMissingReviewSummary {
  const pending = items.filter((item) => item.status === 'pending')
  return {
    totalMissingDays: items.filter((item) => item.missingKind === 'day').length,
    totalMissingShifts: items.filter((item) => item.missingKind === 'shift').length,
    totalEmptyValues: items.filter((item) => item.missingKind === 'empty_value').length,
    totalSummaryOnly: items.filter((item) => item.missingKind === 'summary_only').length,
    pendingCount: pending.length,
    confirmedCount: Array.from(reviewState.values()).filter((row) => row.status === 'confirmed')
      .length,
    cowCount: new Set(items.map((item) => item.cowId || item.cowNumber)).size,
    monthCount: new Set(items.map((item) => item.monthKey)).size,
    yearCount: new Set(items.map((item) => item.yearKey)).size,
    avgRecommendedMilk: round(average(pending.map((item) => item.recommendedMilk)))
  }
}

function buildReviewIssueRow(
  item: MilkMissingReviewItem,
  status: 'pending' | 'confirmed' | 'ignored',
  confirmedMilk: number,
  operatorName: string,
  now: string,
  measurementId: string
) {
  return {
    id: item.id,
    animalId: item.cowId,
    animal_id: item.cowId,
    sourceTable: 'milk_missing_review',
    source_table: 'milk_missing_review',
    sourceRecordId: item.id,
    source_record_id: item.id,
    issueType: 'milk_missing_production',
    issue_type: 'milk_missing_production',
    issueLevel: item.confidence === 'low' ? 'warning' : 'info',
    issue_level: item.confidence === 'low' ? 'warning' : 'info',
    issueStatus: status,
    issue_status: status,
    detectedAt: now,
    detected_at: now,
    resolvedAt: status === 'confirmed' ? now : null,
    resolved_at: status === 'confirmed' ? now : null,
    detail: {
      reviewItemId: item.id,
      cowNumber: item.cowNumber,
      date: item.date,
      shift: item.expectedShift,
      parityNo: item.parityNo,
      dim: item.dim,
      missingKind: item.missingKind,
      summaryDays: item.summaryDays,
      summaryTotalMilk: item.summaryTotalMilk,
      sourceSummaryId: item.sourceSummaryId,
      recommendedMilk: item.recommendedMilk,
      confirmedMilk,
      recommendationMethod: item.recommendationMethod,
      measurementId,
      operatorName
    },
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }
}

async function confirmSummaryOnlyItem(
  item: MilkMissingReviewItem,
  dailyMilk: number,
  operatorName: string,
  now: string
) {
  const days = positiveInt(item.summaryDays) || 1
  const ids: string[] = []
  for (let offset = 0; offset < days; offset += 1) {
    const time = parseDay(item.lactationStartDate) + offset * DAY_MS
    const date = dateKey(time)
    const dim = offset + 1
    const measuredAt = shiftTime(date, '日汇总')
    const sessionCode = `汇总拆分-${date}-日汇总`
    const sessionId = stableId('milking-session', sessionCode)
    const visitId = stableId('milking-visit', sessionCode, item.cowId || item.cowNumber, measuredAt)
    const measurementId = stableId('milk-summary-fill', item.id, date)
    const common = {
      id: measurementId,
      sessionId,
      session_id: sessionId,
      visitId,
      visit_id: visitId,
      animalId: item.cowId,
      animal_id: item.cowId,
      cowId: item.cowId,
      cow_id: item.cowId,
      animalNumber: item.cowNumber,
      animal_number: item.cowNumber,
      cowNumber: item.cowNumber,
      cow_number: item.cowNumber,
      measuredAt,
      measured_at: measuredAt,
      milkingTime: measuredAt,
      productionDate: date,
      production_date: date,
      shiftId: '日汇总',
      shift_id: '日汇总',
      sessionCode,
      session_code: sessionCode,
      parityNo: item.parityNo,
      parity_no: item.parityNo,
      lactationId: item.lactationId,
      lactation_id: item.lactationId,
      daysInMilk: dim,
      days_in_milk: dim,
      periodSource: 'system_derived_from_summary_profile',
      period_source: 'system_derived_from_summary_profile',
      milkYield: dailyMilk,
      milk_yield: dailyMilk,
      volume: dailyMilk,
      sourceType: 'operator_confirmed_summary_split',
      source_type: 'operator_confirmed_summary_split',
      sourceTable: 'milk_summary_profile',
      source_table: 'milk_summary_profile',
      sourceRecordId: item.id,
      source_record_id: item.id,
      qualityFlag: 'summary_split_confirmed',
      quality_flag: 'summary_split_confirmed',
      operatorName,
      operator_name: operatorName,
      notes: `${item.cowNumber} 第${item.parityNo}胎汇总泌乳资料经人工确认拆分为日明细。原始来源：${item.sourceRecordIds.join('、')}`,
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    }
    await upsert('milking_session', {
      id: sessionId,
      sessionCode,
      session_code: sessionCode,
      productionDate: date,
      production_date: date,
      startedAt: measuredAt,
      started_at: measuredAt,
      shiftId: '日汇总',
      shift_id: '日汇总',
      sourceType: 'operator_confirmed_summary_split',
      source_type: 'operator_confirmed_summary_split',
      operatorName,
      operator_name: operatorName,
      status: 'recorded',
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    })
    await upsert('milking_visit', {
      ...common,
      id: visitId,
      enteredAt: measuredAt,
      entered_at: measuredAt
    })
    await upsert('milk_measurement', common)
    await upsert('milk-records', {
      ...common,
      id: measurementId,
      milkQuality: { grade: '汇总拆分', source: '人工确认汇总拆分' },
      milk_quality: { grade: '汇总拆分', source: '人工确认汇总拆分' },
      milkVolume: dailyMilk,
      milkingMethod: 'manual_confirmed_summary_split'
    })
    ids.push(measurementId)
  }

  await upsert(
    'data_quality_issue',
    buildReviewIssueRow(item, 'confirmed', dailyMilk, operatorName, now, ids[0] || item.id)
  )
  await databaseService.addTableDataAsync('operation-audit-logs', {
    id: stableId('audit', item.id, 'summary-split'),
    action_type: 'confirm_milk_summary_split',
    target_type: 'milk_measurement',
    target_id: item.id,
    operator: operatorName,
    operator_name: operatorName,
    status: 'completed',
    request_payload: { item, confirmedDailyMilk: dailyMilk },
    result_payload: { measurementIds: ids, generatedDays: days },
    cow_ids: [item.cowId].filter(Boolean),
    source_record_ids: [item.id, ...item.sourceRecordIds],
    created_at: now,
    updated_at: now
  })
  return ids
}

function normalizeSummaryProfileRows(context: Awaited<ReturnType<typeof loadMilkContext>>) {
  const rows: AnyRow[] = []
  context.cows.forEach((row) => {
    const cow = resolveCowRef(row, context.cowContext)
    const start = parseDay(row.lactationStartDate || row.lactation_start_date)
    if (!cow.sourceKey || !Number.isFinite(start)) return
    const summary = summarizeProfile(row)
    if (!summary.hasSummary) return
    const parityNo =
      positiveInt(
        row.reportedParityNo ?? row.reported_parity_no ?? row.parityNo ?? row.parity_no
      ) || 1
    const endText = text(row.lactationEndDate || row.lactation_end_date)
    rows.push({
      cowKey: cow.sourceKey,
      cowId: cow.cowId,
      cowNumber:
        cow.cowNumber ||
        text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
      cowName: text(row.cowName || row.name),
      breed: text(row.breed),
      parityNo,
      lactationId: stableId('lactation_episode', cow.sourceKey, parityNo),
      startTime: startOfDay(start),
      endTime: endText ? startOfDay(parseDay(endText)) : null,
      startDate: dateKey(start),
      endDate: endText ? dateKey(parseDay(endText)) : '',
      reportedDaysInMilk: summary.days,
      coverageDays: summary.days,
      recordCount: summary.days,
      reportedMilk305: summary.milk305,
      reportedParityYield: summary.parityYield,
      reportedAvgDailyMilk: summary.avgDailyMilk,
      summaryId: text(row.id || cow.cowId || cow.cowNumber),
      summarySourceTable: 'animal'
    })
  })

  const facts = (context as AnyRow).factLactation305 || []
  facts.forEach((row: AnyRow) => {
    const cow = resolveCowRef(row, context.cowContext)
    const start = parseDay(row.startDate || row.start_date)
    if (!cow.sourceKey || !Number.isFinite(start)) return
    const summary = summarizeProfile(row)
    if (!summary.hasSummary) return
    const parityNo =
      positiveInt(row.parityNo ?? row.parity_no ?? row.lactationNo ?? row.lactation_no) || 1
    const endText = text(row.endDate || row.end_date)
    rows.push({
      cowKey: cow.sourceKey,
      cowId: cow.cowId,
      cowNumber:
        cow.cowNumber ||
        text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
      cowName: text(cow.cow?.cowName || cow.cow?.name),
      breed: text(cow.cow?.breed),
      parityNo,
      lactationId: text(
        row.lactationId ||
          row.lactation_id ||
          stableId('lactation_episode', cow.sourceKey, parityNo)
      ),
      startTime: startOfDay(start),
      endTime: endText ? startOfDay(parseDay(endText)) : null,
      startDate: dateKey(start),
      endDate: endText ? dateKey(parseDay(endText)) : '',
      reportedDaysInMilk: summary.days,
      coverageDays: summary.days,
      recordCount: summary.days,
      reportedMilk305: summary.milk305,
      reportedParityYield: summary.parityYield,
      reportedAvgDailyMilk: summary.avgDailyMilk,
      summaryId: text(row.id),
      summarySourceTable: 'fact_lactation_305'
    })
  })
  return rows
}

function mergeLactationRows(rows: AnyRow[], summaryRows: AnyRow[]) {
  const map = new Map<string, AnyRow>()
  ;[...rows, ...summaryRows].forEach((row) => {
    const key = `${row.cowKey}|${row.parityNo || 1}|${row.startDate}`
    const previous = map.get(key)
    map.set(key, { ...(previous || {}), ...row })
  })
  return Array.from(map.values())
}

function summarizeProfile(row: AnyRow) {
  const days = positiveInt(
    row.reportedDaysInMilk ??
      row.reported_days_in_milk ??
      row.recordCount ??
      row.record_count ??
      row.coverageDays ??
      row.coverage_days
  )
  const parityYield = numeric(
    row.reportedParityYield ?? row.reported_parity_yield ?? row.parityYield ?? row.parity_yield
  )
  const milk305 = numeric(
    row.reportedMilk305 ??
      row.reported_milk_305 ??
      row.milkYield305 ??
      row.milk_yield_305 ??
      row.milk305 ??
      row.milk_305
  )
  const avgDailyMilk = numeric(
    row.reportedAvgDailyMilk ??
      row.reported_avg_daily_milk ??
      row.avgDailyMilk ??
      row.avg_daily_milk
  )
  return {
    days,
    parityYield,
    milk305,
    avgDailyMilk,
    hasSummary: !!days && (!!parityYield || !!milk305 || !!avgDailyMilk)
  }
}

function hasMilkSummary(episode: AnyRow) {
  return (
    !!positiveInt(episode.reportedDaysInMilk ?? episode.coverageDays ?? episode.recordCount) &&
    [episode.reportedAvgDailyMilk, episode.reportedParityYield, episode.reportedMilk305].some(
      (value) => numeric(value) !== null
    )
  )
}

function recommendSummaryProfileValue(episode: AnyRow, expectedShiftCount: number) {
  const days =
    positiveInt(episode.reportedDaysInMilk ?? episode.coverageDays ?? episode.recordCount) || 1
  const avg = numeric(episode.reportedAvgDailyMilk)
  const parityYield = numeric(episode.reportedParityYield)
  const milk305 = numeric(episode.reportedMilk305)
  const totalMilk = parityYield ?? milk305 ?? (avg !== null ? avg * days : null)
  const daily =
    avg ?? (parityYield !== null ? parityYield / days : milk305 !== null ? milk305 / 305 : 0)
  const shiftText = expectedShiftCount > 1 ? `；若要拆到班次，可先确认日总量后再按班次细分` : ''
  return {
    value: round(daily || 0),
    days,
    totalMilk: round(totalMilk || daily * days),
    confidence: avg !== null ? ('medium' as const) : ('low' as const),
    text: `该牛只有泌乳汇总资料，系统按 ${days} 天和${avg !== null ? '平均日产奶' : '汇总总产奶量'}生成待确认日序列建议${shiftText}。`
  }
}

function sourceSummaryRecordIds(episode: AnyRow) {
  return [
    `${episode.summarySourceTable || 'lactation_summary'}:${episode.summaryId || episode.lactationId}`
  ]
}

async function upsert(tableName: string, row: AnyRow) {
  const id = text(row.id)
  const rows = await databaseService.getTableDataAsync(tableName, { silent: true }).catch(() => [])
  if (id && rows.some((item) => text(item.id) === id)) {
    await databaseService.updateTableRecordAsync(tableName, id, row)
    return
  }
  await databaseService.addTableDataAsync(tableName, row)
}

async function readTable(tableName: string) {
  return databaseService.getTableDataAsync(tableName, { silent: true }).catch(() => [])
}

function mergeCowRows(cows: AnyRow[], animals: AnyRow[]) {
  const map = new Map<string, AnyRow>()
  ;[...animals, ...cows].forEach((row) => {
    const id = text(row.id || row.cowId || row.cow_id || row.animalId || row.animal_id)
    const number = text(
      row.cowNumber || row.cow_number || row.animalNumber || row.animal_number || row.number
    )
    const key = id || number
    if (!key) return
    map.set(key, {
      ...(map.get(key) || {}),
      ...row,
      id: id || row.id,
      cowId: id || row.cowId,
      cowNumber: number || row.cowNumber
    })
  })
  return Array.from(map.values())
}

function groupMilkByDate(rows: AnyRow[]) {
  return groupBy(rows, (row) => row.date)
}

function groupBy<T>(rows: T[], getKey: (row: T) => string) {
  const map = new Map<string, T[]>()
  rows.forEach((row) => {
    const key = getKey(row)
    if (!key) return
    map.set(key, [...(map.get(key) || []), row])
  })
  return map
}

function normalizeExpectedShifts(input?: string[]) {
  const values = (input || EXPECTED_SHIFTS).map(text).filter(Boolean)
  return values.length ? values : EXPECTED_SHIFTS
}

function normalizeShift(value: unknown, fallbackTime: unknown = '') {
  const raw = text(value)
  if (raw) return raw
  const timeText = text(fallbackTime)
  const match = timeText.match(/(?:T|\s)(\d{1,2}):\d{2}/)
  const hour = match ? Number(match[1]) : Number.NaN
  if (Number.isFinite(hour)) {
    if (hour >= 4 && hour < 11) return '早班'
    if (hour >= 11 && hour < 16) return '中班'
    if (hour >= 16 || hour < 4) return '晚班'
  }
  return '早班'
}

function shiftTime(date: string, shift: string) {
  const hour =
    shift === '早班'
      ? '06:00:00'
      : shift === '中班'
        ? '12:00:00'
        : shift === '晚班'
          ? '18:00:00'
          : '09:00:00'
  return `${date} ${hour}`
}

function methodLabel(method: MilkMissingReviewItem['recommendationMethod']) {
  const map: Record<MilkMissingReviewItem['recommendationMethod'], string> = {
    lactation_305_curve: '305天泌乳曲线',
    curve_interpolation: '同牛曲线插值',
    recent_average: '近期平均数',
    neighbor_average: '邻近均值',
    summary_profile: '汇总资料拆分',
    cow_average: '个体均值',
    manual_required: '人工核对'
  }
  return map[method]
}

function parseObject(value: unknown): AnyRow {
  if (!value) return {}
  if (typeof value === 'object') return value as AnyRow
  try {
    return JSON.parse(String(value))
  } catch {
    return {}
  }
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function numeric(value: unknown): number | null {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function positiveInt(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.trunc(numberValue) : 0
}

function parseDay(value: unknown) {
  const raw = text(value)
  if (!raw) return Number.NaN
  const time = Date.parse(raw)
  return Number.isFinite(time) ? startOfDay(time) : Number.NaN
}

function parseDayTime(value: unknown) {
  const raw = text(value)
  if (!raw) return Number.NaN
  const time = Date.parse(raw)
  return Number.isFinite(time) ? time : Number.NaN
}

function startOfDay(time: number) {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function dateKey(time: number) {
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function daysBetween(startTime: number, targetTime: number) {
  return Math.max(1, Math.floor((startOfDay(targetTime) - startOfDay(startTime)) / DAY_MS) + 1)
}

function average(values: number[]) {
  const usable = values.filter((value) => Number.isFinite(value))
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0
}

function round(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 10) / 10
}

function stableId(...parts: unknown[]) {
  let hash = 2166136261
  const textValue = parts.map((part) => text(part)).join('|')
  for (let index = 0; index < textValue.length; index += 1) {
    hash ^= textValue.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `milk_${(hash >>> 0).toString(36)}`
}
