import * as databaseService from '@/services/database'
import { buildCowReferenceContext, resolveCowRef } from '@/utils/cow-reference'

type AnyRow = Record<string, any>

export interface UnifiedDataContext {
  cows: AnyRow[]
  animals: AnyRow[]
  identifiers: AnyRow[]
  cowContext: ReturnType<typeof buildCowReferenceContext>
}

export async function buildUnifiedDataContext(): Promise<UnifiedDataContext> {
  const [cows, animals, identifiers] = await Promise.all([
    readTable('cows'),
    readTable('animal'),
    readTable('animal_identifier')
  ])
  const mergedCows = mergeCowRows(cows, animals)
  return {
    cows: mergedCows,
    animals,
    identifiers,
    cowContext: buildCowReferenceContext(mergedCows, identifiers)
  }
}

export async function loadUnifiedPhenotypeRecords(
  traits: AnyRow[] = [],
  context?: UnifiedDataContext,
  options: { limit?: number; pageSize?: number; timeout?: number } = {}
) {
  const ctx = context || (await buildUnifiedDataContext())
  const limit = Number(options.limit || 50000)
  const pageSize = Number(options.pageSize || limit)
  const backendRows = await databaseService
    .runBackendRpcAsync<AnyRow[]>(
      'getUnifiedPhenotypeRows',
      {
        limit,
        pageSize,
        cows: ctx.cows
      },
      { timeout: options.timeout || 60000, showErrorLog: false }
    )
    .catch(() => null)
  if (Array.isArray(backendRows) && backendRows.length) return backendRows

  const [traitObservations, phenotypeRecords, milkMeasurements, milkRecords, v2Traits] =
    await Promise.all([
      readTable('trait_observation'),
      readTable('phenotype-records'),
      readTable('milk_measurement'),
      readTable('milk-records'),
      readTable('trait_definition')
    ])
  const traitRows = [...traits, ...v2Traits]
  const traitMap = new Map<string, AnyRow>(
    traitRows
      .map((trait) => [text(trait.code || trait.traitCode || trait.trait_code), trait] as const)
      .filter(([key]) => key)
  )
  const traitByIdMap = new Map<string, AnyRow>(
    traitRows
      .map((trait) => [text(trait.id || trait.traitId || trait.trait_id), trait] as const)
      .filter(([key]) => key)
  )
  const rows: AnyRow[] = []

  traitObservations.forEach((row) =>
    rows.push(normalizeTraitRecord(row, 'trait_observation', ctx, traitMap, traitByIdMap))
  )
  phenotypeRecords.forEach((row) =>
    rows.push(normalizeTraitRecord(row, 'phenotype-records', ctx, traitMap, traitByIdMap))
  )
  milkMeasurements.forEach((row) =>
    rows.push(...normalizeMilkAsTraitRecords(row, 'milk_measurement', ctx, traitMap, traitByIdMap))
  )
  milkRecords.forEach((row) =>
    rows.push(...normalizeMilkAsTraitRecords(row, 'milk-records', ctx, traitMap, traitByIdMap))
  )

  return dedupeByBusinessKey(rows, [
    'trait_observation',
    'milk_measurement',
    'phenotype-records',
    'milk-records'
  ])
}

export async function loadUnifiedMilkRecords(context?: UnifiedDataContext) {
  const ctx = context || (await buildUnifiedDataContext())
  const backendRows = await databaseService
    .runBackendRpcAsync<AnyRow[]>(
      'getUnifiedMilkRows',
      {
        limit: 50000,
        pageSize: 50000,
        cows: ctx.cows
      },
      { timeout: 60000, showErrorLog: false }
    )
    .catch(() => null)
  if (Array.isArray(backendRows) && backendRows.length) return backendRows

  const [milkMeasurements, milkRecords] = await Promise.all([
    readTable('milk_measurement'),
    readTable('milk-records')
  ])
  const rows = [
    ...milkMeasurements.map((row) => normalizeMilkRecord(row, 'milk_measurement', ctx)),
    ...milkRecords.map((row) => normalizeMilkRecord(row, 'milk-records', ctx))
  ]
  return dedupeByBusinessKey(rows, ['milk_measurement', 'milk-records'])
}

export async function loadUnifiedReproductionEvents(context?: UnifiedDataContext) {
  const ctx = context || (await buildUnifiedDataContext())
  const [animalEvents, cowEvents, breedingEvents, breedingRecords, cycles] = await Promise.all([
    readTable('animal_event'),
    readTable('cow-events'),
    readTable('breeding-events'),
    readTable('breeding-records'),
    readTable('reproduction-cycles')
  ])
  const rows = [
    ...animalEvents.map((row) => normalizeReproductionEvent(row, 'animal_event', ctx)),
    ...cowEvents.map((row) =>
      normalizeReproductionEvent(
        row,
        canonicalSourceTable(row.sourceTable || row.source_table || 'cow-events'),
        ctx
      )
    ),
    ...breedingEvents.map((row) => normalizeReproductionEvent(row, 'breeding-events', ctx)),
    ...breedingRecords.map((row) => normalizeReproductionEvent(row, 'breeding-records', ctx))
  ].filter((row) => isReproductionType(row.eventType))

  return {
    events: dedupeByBusinessKey(rows, [
      'animal_event',
      'cow-events',
      'breeding-events',
      'breeding-records'
    ]),
    cycles
  }
}

const LARGE_FACT_TABLES = new Set([
  'trait_observation',
  'phenotype-records',
  'milk_measurement',
  'milk-records',
  'animal_event',
  'cow-events',
  'breeding-events',
  'breeding-records',
  'sensor_reading',
  'sensor-readings',
  'sensors',
  'alerts'
])

async function readTable(tableName: string) {
  const options = LARGE_FACT_TABLES.has(tableName)
    ? { silent: true, limit: 50000, pageSize: 50000, timeout: 60000 }
    : { silent: true }
  return databaseService.getTableDataAsync(tableName, options).catch(() => [])
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
    const existing = map.get(key) || {}
    map.set(key, normalizeCowRow({
      ...existing,
      ...row,
      id: id || existing.id,
      cowId: id || existing.cowId,
      cowNumber: number || existing.cowNumber
    }))
  })
  return Array.from(map.values())
}

function normalizeCowRow(row: AnyRow) {
  const id = text(row.id || row.cowId || row.cow_id || row.animalId || row.animal_id)
  const number = text(
    row.cowNumber || row.cow_number || row.animalNumber || row.animal_number || row.number
  )
  const gender = text(row.gender || row.sex || row.animalSex || row.animal_sex)
  const type = text(
    row.type || row.cowType || row.cow_type || row.currentStageId || row.current_stage_id
  )
  const currentPen = text(
    row.currentPen ||
      row.current_pen ||
      row.currentPenName ||
      row.current_pen_name ||
      row.currentUnitName ||
      row.current_unit_name ||
      row.currentUnitId ||
      row.current_unit_id ||
      row.currentPenId ||
      row.current_pen_id
  )
  const parity = numeric(row.parity ?? row.parityNo ?? row.parity_no ?? row.reportedParityNo ?? row.reported_parity_no)
  return {
    ...row,
    id,
    cowId: id,
    cow_id: id,
    animalId: id,
    animal_id: id,
    cowNumber: number,
    cow_number: number,
    animalNumber: number,
    animal_number: number,
    earTagNumber: text(row.earTagNumber || row.ear_tag_number || row.earTag || row.ear_tag),
    fatherNumber: text(row.fatherNumber || row.father_number || row.sireNumber || row.sire_number),
    motherNumber: text(row.motherNumber || row.mother_number || row.damNumber || row.dam_number),
    grandfatherNumber: text(row.grandfatherNumber || row.grandfather_number),
    grandmotherNumber: text(row.grandmotherNumber || row.grandmother_number),
    gender,
    sex: text(row.sex || gender),
    type,
    cowType: text(row.cowType || row.cow_type || type),
    currentPen,
    current_pen: currentPen,
    status: text(row.status || row.state || '在群'),
    parity: parity ?? 0,
    birthDate: text(row.birthDate || row.birth_date),
    birth_date: text(row.birth_date || row.birthDate),
    createdAt: text(row.createdAt || row.created_at),
    updatedAt: text(row.updatedAt || row.updated_at)
  }
}

function normalizeTraitRecord(
  row: AnyRow,
  sourceTable: string,
  context: UnifiedDataContext,
  traitMap: Map<string, AnyRow>,
  traitByIdMap: Map<string, AnyRow> = new Map()
) {
  const cow = resolveCowRef(row, context.cowContext)
  const traitId = text(row.traitId || row.trait_id)
  const traitFromId = traitByIdMap.get(traitId) || {}
  const traitCode = text(row.traitCode || row.trait_code || traitFromId.code || traitFromId.trait_code)
  const trait = traitMap.get(traitCode) || traitFromId || {}
  const date = text(
    row.observedAt ||
      row.observed_at ||
      row.collectionDate ||
      row.collection_date ||
      row.createdAt ||
      row.created_at
  )
  const value =
    row.numericValue ?? row.numeric_value ?? row.value ?? row.textValue ?? row.text_value
  return {
    ...row,
    id: text(row.id) || stableId(sourceTable, cow.sourceKey, traitCode, date),
    cowId: cow.cowId,
    cow_id: cow.cowId,
    cowNumber:
      cow.cowNumber ||
      text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
    cow_number:
      cow.cowNumber ||
      text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
    traitId,
    trait_id: traitId,
    traitCode,
    trait_code: traitCode,
    traitName: text(row.traitName || row.trait_name || trait.name || trait.trait_name || traitCode),
    trait_name: text(
      row.traitName || row.trait_name || trait.name || trait.trait_name || traitCode
    ),
    category: text(row.category || trait.category || trait.trait_category || '表型性状'),
    collectionDate: date.slice(0, 10),
    collection_date: date.slice(0, 10),
    value,
    numericValue:
      row.numericValue ??
      row.numeric_value ??
      (Number.isFinite(Number(value)) ? Number(value) : undefined),
    numeric_value:
      row.numericValue ??
      row.numeric_value ??
      (Number.isFinite(Number(value)) ? Number(value) : undefined),
    unit: text(row.unit || trait.unit),
    source: text(row.source || row.sourceType || row.source_type || '业务入库'),
    collector: text(
      row.collector || row.operatorName || row.operator_name || row.operator || '系统'
    ),
    parity: row.parity ?? row.parityNo ?? row.parity_no,
    daysInMilk: row.daysInMilk ?? row.days_in_milk,
    sourceTable,
    source_table: sourceTable,
    sourceRecordId: text(row.sourceRecordId || row.source_record_id || row.id),
    source_record_id: text(row.sourceRecordId || row.source_record_id || row.id)
  }
}

function normalizeMilkAsTraitRecords(
  row: AnyRow,
  sourceTable: string,
  context: UnifiedDataContext,
  traitMap: Map<string, AnyRow>,
  traitByIdMap: Map<string, AnyRow> = new Map()
) {
  const base = {
    date:
      row.measuredAt ||
      row.measured_at ||
      row.milkingTime ||
      row.milking_time ||
      row.collectionDate ||
      row.collection_date ||
      row.createdAt ||
      row.created_at,
    parity: row.parityNo ?? row.parity_no ?? row.parity,
    daysInMilk: row.daysInMilk ?? row.days_in_milk
  }
  return [
    [
      'milk_yield',
      '单次产奶量',
      row.milkYield ?? row.milk_yield ?? row.volume ?? row.milkVolume,
      'kg'
    ],
    [
      'milk_fat',
      '乳脂率',
      row.fatPercent ??
        row.fat_percent ??
        row.fatRate ??
        row.fat_rate ??
        row.fat ??
        row.milkQuality?.fat,
      '%'
    ],
    [
      'milk_protein',
      '乳蛋白率',
      row.proteinPercent ??
        row.protein_percent ??
        row.proteinRate ??
        row.protein_rate ??
        row.protein ??
        row.milkQuality?.protein,
      '%'
    ],
    [
      'milk_lactose',
      '乳糖率',
      row.lactosePercent ??
        row.lactose_percent ??
        row.lactoseRate ??
        row.lactose_rate ??
        row.lactose ??
        row.milkQuality?.lactose,
      '%'
    ],
    [
      'somatic_cell_count',
      '体细胞数',
      row.somaticCellCount ?? row.somatic_cell_count ?? row.scc ?? row.milkQuality?.scc,
      'cells/mL'
    ]
  ]
    .filter(([, , value]) => value !== undefined && value !== null && value !== '')
    .map(([traitCode, traitName, value, unit]) =>
      normalizeTraitRecord(
        {
          ...row,
          traitCode,
          trait_code: traitCode,
          traitName,
          trait_name: traitName,
          category: traitMap.get(String(traitCode))?.category || '泌乳性能',
          value,
          numericValue: value,
          numeric_value: value,
          unit,
          collectionDate: base.date,
          collection_date: base.date,
          parity: base.parity,
          daysInMilk: base.daysInMilk
        },
        sourceTable,
        context,
        traitMap,
        traitByIdMap
      )
    )
}

function normalizeMilkRecord(row: AnyRow, sourceTable: string, context: UnifiedDataContext) {
  const cow = resolveCowRef(row, context.cowContext)
  const milkingTime = text(
    row.measuredAt ||
      row.measured_at ||
      row.milkingTime ||
      row.milking_time ||
      row.createdAt ||
      row.created_at
  )
  const milkQuality = row.milkQuality || row.milk_quality || {}
  return {
    ...row,
    id: text(row.id) || stableId(sourceTable, cow.sourceKey, milkingTime),
    cowId: cow.cowId,
    cow_id: cow.cowId,
    cowNumber:
      cow.cowNumber ||
      text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
    cow_number:
      cow.cowNumber ||
      text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
    milkingTime,
    measuredAt: milkingTime,
    volume: numeric(row.volume ?? row.milkVolume ?? row.milkYield ?? row.milk_yield),
    milkYield: numeric(row.milkYield ?? row.milk_yield ?? row.volume ?? row.milkVolume),
    milkingMethod: text(
      row.milkingMethod || row.milking_method || row.sourceType || row.source_type
    ).includes('manual')
      ? 'manual'
      : 'automatic',
    milkQuality: {
      grade: text(
        milkQuality.grade ||
          row.grade ||
          row.qualityGrade ||
          row.quality_grade ||
          row.qualityFlag ||
          row.quality_flag ||
          'A'
      ),
      fat: numeric(milkQuality.fat ?? row.fat ?? row.fatPercent ?? row.fat_percent),
      protein: numeric(
        milkQuality.protein ?? row.protein ?? row.proteinPercent ?? row.protein_percent
      ),
      lactose: numeric(
        milkQuality.lactose ?? row.lactose ?? row.lactosePercent ?? row.lactose_percent
      ),
      scc: numeric(milkQuality.scc ?? row.scc ?? row.somaticCellCount ?? row.somatic_cell_count)
    },
    equipmentId: text(
      row.equipmentId ||
        row.equipment_id ||
        row.deviceId ||
        row.device_id ||
        row.sessionCode ||
        row.session_code
    ),
    milkerId: text(row.milkerId || row.milker_id || row.operatorId || row.operator_id),
    sourceTable,
    sourceRecordId: text(row.sourceRecordId || row.source_record_id || row.id)
  }
}

function normalizeReproductionEvent(row: AnyRow, sourceTable: string, context: UnifiedDataContext) {
  const details = parseObject(row.details || row.customValues || row.custom_values)
  const cow = resolveCowRef({ ...details, ...row }, context.cowContext)
  const eventType = normalizeReproductionType(
    row.eventType ||
      row.event_type ||
      row.eventCode ||
      row.event_code ||
      row.type ||
      row.eventName ||
      row.event_name ||
      details.eventType
  )
  const eventTime = text(
    row.occurredAt ||
      row.occurred_at ||
      row.eventTime ||
      row.event_time ||
      row.eventDate ||
      row.event_date ||
      row.breedingDate ||
      row.breeding_date ||
      row.createdAt ||
      row.created_at
  )
  return {
    ...row,
    id: text(row.id) || stableId(sourceTable, cow.sourceKey, eventType, eventTime),
    cowId: cow.cowId,
    cow_id: cow.cowId,
    cowNumber:
      cow.cowNumber ||
      text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
    cow_number:
      cow.cowNumber ||
      text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
    eventType,
    event_type: eventType,
    eventTime,
    event_time: eventTime,
    eventDate: eventTime.slice(0, 10),
    event_date: eventTime.slice(0, 10),
    result: text(
      row.result ||
        row.pregnancyResult ||
        row.pregnancy_result ||
        row.calvingResult ||
        row.calving_result ||
        details.result
    ),
    parity: row.parity ?? row.parityNo ?? row.parity_no ?? details.parity,
    operator: text(
      row.operator ||
        row.operatorName ||
        row.operator_name ||
        row.person ||
        row.technician ||
        details.operatorName
    ),
    nextAction: text(
      row.nextAction || row.next_action || row.notes || details.nextAction || details.notes
    ),
    bullNumber: text(row.bullNumber || row.bull_number || details.bullNumber),
    semenNumber: text(
      row.semenNumber || row.semen_number || row.semenBatch || row.semen_batch || details.semenBatch
    ),
    dueDate: text(
      row.dueDate ||
        row.due_date ||
        row.expectedDueDate ||
        row.expected_due_date ||
        details.expectedDueDate
    ),
    sourceTable,
    sourceRecordId: text(row.sourceRecordId || row.source_record_id || row.id)
  }
}

function dedupeByBusinessKey(rows: AnyRow[], priority: string[]) {
  const sourcePriority = (source: string) => {
    const index = priority.indexOf(canonicalSourceTable(source))
    return index === -1 ? priority.length : index
  }
  const seen = new Set<string>()
  return rows
    .sort(
      (left, right) =>
        sourcePriority(text(left.sourceTable || left.source_table)) -
        sourcePriority(text(right.sourceTable || right.source_table))
    )
    .filter((row) => {
      const keys = unique([
        row.sourceRecordId ? `record:${row.cowId || row.cowNumber}|${row.sourceRecordId}` : '',
        row.id ? `id:${row.cowId || row.cowNumber}|${row.id}` : '',
        row.traitCode
          ? `trait:${row.cowId || row.cowNumber}|${row.traitCode}|${row.collectionDate}|${row.value}`
          : '',
        row.eventType
          ? `event:${row.cowId || row.cowNumber}|${row.eventType}|${row.eventTime || row.eventDate}`
          : '',
        row.milkingTime ? `milk:${row.cowId || row.cowNumber}|${row.milkingTime}|${row.volume}` : ''
      ])
      if (keys.some((key) => seen.has(key))) return false
      keys.forEach((key) => seen.add(key))
      return true
    })
}

function canonicalSourceTable(source: unknown) {
  const value = text(source)
  return value === 'cow-events' ? 'animal_event' : value
}

function normalizeReproductionType(value: unknown) {
  const raw = text(value).toLowerCase()
  if (raw.includes('heat') || raw.includes('发情')) return 'heat'
  if (
    raw.includes('insemination') ||
    raw.includes('breeding') ||
    raw.includes('配种') ||
    raw.includes('输精') ||
    raw.includes('人工授精')
  )
    return 'insemination'
  if (raw.includes('pregnancy') || raw.includes('妊检') || raw.includes('妊娠检查'))
    return 'pregnancy_check'
  if (raw.includes('calving') || raw.includes('产犊') || raw.includes('分娩')) return 'calving'
  if (raw.includes('abortion') || raw.includes('流产')) return 'abortion'
  if (raw.includes('embryo') || raw.includes('胚胎')) return 'embryo_transfer'
  return raw || 'reproduction'
}

function isReproductionType(value: unknown) {
  return [
    'heat',
    'insemination',
    'pregnancy_check',
    'calving',
    'abortion',
    'postpartum_check',
    'embryo_transfer',
    'breeding',
    'reproduction'
  ].includes(text(value))
}

function parseObject(value: unknown): AnyRow {
  if (!value) return {}
  if (typeof value === 'object') return value as AnyRow
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function stableId(...parts: unknown[]) {
  return parts
    .map((part) => text(part))
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 180)
}

function numeric(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function text(value: unknown) {
  return String(value ?? '').trim()
}
