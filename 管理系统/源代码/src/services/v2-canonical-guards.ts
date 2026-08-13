import * as databaseService from '@/services/数据库'
import {
  CATTLE_SPECIES_NAME,
  DEFAULT_CATTLE_BREED,
  requireSupportedCattleBreed
} from '@/utils/cattle-breeds'
import type { ResolvedCowReference } from '@/utils/cow-reference'

type AnyRow = Record<string, any>

export interface CanonicalAnimalResult {
  id: string
  number: string
  row: AnyRow
}

export interface CanonicalTraitResult {
  id: string
  code: string
  name: string
  unit: string
}

export interface CanonicalBatchResult {
  id: string
}

export interface CanonicalDeviceResult {
  id: string
}

export async function ensureAnimalForV2Fk(
  resolvedCow: ResolvedCowReference,
  fallback: AnyRow = {}
): Promise<CanonicalAnimalResult> {
  const animalId = text(
    resolvedCow.cowId ||
      fallback.animalId ||
      fallback.animal_id ||
      fallback.cowId ||
      fallback.cow_id ||
      fallback.id
  )
  const animalNumber =
    text(
      resolvedCow.cowNumber ||
        fallback.animalNumber ||
        fallback.animal_number ||
        fallback.cowNumber ||
        fallback.cow_number ||
        fallback.number
    ) || animalId
  if (!animalId && !animalNumber) throw new Error('写入 v2 事实表前无法解析牛只 ID 或牛号')

  const animals = await databaseService
    .getTableDataAsync('animal', { silent: true })
    .catch(() => [])
  const existing = (animals || []).find(
    (row: AnyRow) =>
      (animalId &&
        text(row.id || row.animalId || row.animal_id || row.cowId || row.cow_id) === animalId) ||
      (animalNumber &&
        text(
          row.animalNumber || row.animal_number || row.cowNumber || row.cow_number || row.number
        ) === animalNumber)
  )
  if (existing) {
    const id = text(
      existing.id ||
        existing.animalId ||
        existing.animal_id ||
        existing.cowId ||
        existing.cow_id ||
        animalId
    )
    return {
      id,
      number: text(
        existing.animalNumber ||
          existing.animal_number ||
          existing.cowNumber ||
          existing.cow_number ||
          existing.number ||
          animalNumber
      ),
      row: existing
    }
  }

  const source = resolvedCow.cow || fallback
  const id = animalId || stableId('animal', animalNumber)
  const now = new Date().toISOString()
  const row = {
    id,
    animalId: id,
    animal_id: id,
    cowId: id,
    cow_id: id,
    animalNumber,
    animal_number: animalNumber,
    cowNumber: animalNumber,
    cow_number: animalNumber,
    earTagNumber: nullableText(
      firstText(
        source.earTagNumber,
        source.ear_tag_number,
        source.earTag,
        source.ear_tag,
        fallback.ear_tag_number
      )
    ),
    ear_tag_number: nullableText(
      firstText(
        source.earTagNumber,
        source.ear_tag_number,
        source.earTag,
        source.ear_tag,
        fallback.ear_tag_number
      )
    ),
    name: firstText(source.name, source.cowName, source.cow_name, fallback.name),
    species: CATTLE_SPECIES_NAME,
    breed: requireSupportedCattleBreed(
      firstText(source.breed, fallback.breed) || DEFAULT_CATTLE_BREED
    ),
    sex: normalizeSex(firstText(source.sex, source.gender, fallback.sex, fallback.gender)),
    birthDate: nullableText(firstText(source.birthDate, source.birth_date, fallback.birth_date)),
    birth_date: nullableText(firstText(source.birthDate, source.birth_date, fallback.birth_date)),
    entryDate: nullableText(firstText(source.entryDate, source.entry_date, fallback.entry_date)),
    entry_date: nullableText(firstText(source.entryDate, source.entry_date, fallback.entry_date)),
    currentStageId: firstText(
      source.currentStageId,
      source.current_stage_id,
      source.type,
      source.cowType,
      source.cow_type,
      fallback.current_stage_id
    ),
    current_stage_id: firstText(
      source.currentStageId,
      source.current_stage_id,
      source.type,
      source.cowType,
      source.cow_type,
      fallback.current_stage_id
    ),
    currentGroupId: firstText(
      source.currentGroupId,
      source.current_group_id,
      fallback.current_group_id
    ),
    current_group_id: firstText(
      source.currentGroupId,
      source.current_group_id,
      fallback.current_group_id
    ),
    currentUnitId: firstText(
      source.currentUnitId,
      source.current_unit_id,
      source.currentPenId,
      source.current_pen_id,
      source.currentPen,
      source.current_pen,
      fallback.current_unit_id
    ),
    current_unit_id: firstText(
      source.currentUnitId,
      source.current_unit_id,
      source.currentPenId,
      source.current_pen_id,
      source.currentPen,
      source.current_pen,
      fallback.current_unit_id
    ),
    currentPenId: firstText(
      source.currentPenId,
      source.current_pen_id,
      source.currentUnitId,
      source.current_unit_id,
      source.currentPen,
      source.current_pen,
      fallback.current_pen_id
    ),
    current_pen_id: firstText(
      source.currentPenId,
      source.current_pen_id,
      source.currentUnitId,
      source.current_unit_id,
      source.currentPen,
      source.current_pen,
      fallback.current_pen_id
    ),
    status: firstText(source.status, fallback.status) || '在群',
    sourceFarm: firstText(
      source.sourceFarm,
      source.source_farm,
      fallback.sourceFarm,
      fallback.source_farm
    ),
    source_farm: firstText(
      source.sourceFarm,
      source.source_farm,
      fallback.sourceFarm,
      fallback.source_farm
    ),
    notes: firstText(source.notes, fallback.notes),
    createdAt: firstText(source.createdAt, source.created_at) || now,
    created_at: firstText(source.createdAt, source.created_at) || now,
    updatedAt: now,
    updated_at: now
  }
  await upsertLike('animal', row)
  return { id, number: animalNumber, row }
}

export async function ensureTraitDefinitionForObservation(
  traitCode: string,
  source: AnyRow = {}
): Promise<CanonicalTraitResult> {
  const code = text(traitCode || source.traitCode || source.trait_code || source.code)
  if (!code) throw new Error('写入表型观测前缺少性状编码')

  const [v2Traits, legacyTraits] = await Promise.all([
    databaseService.getTableDataAsync('trait_definition', { silent: true }).catch(() => []),
    databaseService
      .getTableDataAsync('phenotype-trait-definitions', { silent: true })
      .catch(() => [])
  ])
  const v2 = (v2Traits || []).find(
    (row: AnyRow) => text(row.code || row.traitCode || row.trait_code) === code
  )
  if (v2) {
    return {
      id: text(v2.id || v2.traitId || v2.trait_id),
      code,
      name: text(
        v2.name || v2.traitName || v2.trait_name || source.traitName || source.trait_name || code
      ),
      unit: text(v2.unit || source.unit)
    }
  }

  const legacy = (legacyTraits || []).find(
    (row: AnyRow) => text(row.code || row.traitCode || row.trait_code) === code
  )
  const id = stableId('trait', code)
  const now = new Date().toISOString()
  const name = text(
    source.traitName ||
      source.trait_name ||
      source.name ||
      legacy?.name ||
      legacy?.traitName ||
      legacy?.trait_name ||
      code
  )
  const unit = text(source.unit || legacy?.unit)
  await upsertLike('trait_definition', {
    id,
    code,
    name,
    traitType: text(
      source.traitType ||
        source.trait_type ||
        legacy?.traitType ||
        legacy?.trait_type ||
        inferTraitType(code)
    ),
    trait_type: text(
      source.traitType ||
        source.trait_type ||
        legacy?.traitType ||
        legacy?.trait_type ||
        inferTraitType(code)
    ),
    dataType: text(
      source.dataType || source.data_type || legacy?.dataType || legacy?.data_type || 'number'
    ),
    data_type: text(
      source.dataType || source.data_type || legacy?.dataType || legacy?.data_type || 'number'
    ),
    unit,
    status: 'active',
    exportEnabled: 1,
    export_enabled: 1,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
  return { id, code, name, unit }
}

export async function ensureTraitObservationBatch(
  batchId: string,
  source: AnyRow = {}
): Promise<CanonicalBatchResult> {
  const id = text(batchId || source.batchId || source.batch_id)
  if (!id) throw new Error('写入表型观测前缺少批次 ID')
  const rows = await databaseService
    .getTableDataAsync('trait_observation_batch', { silent: true })
    .catch(() => [])
  const existing = (rows || []).find(
    (row: AnyRow) =>
      text(row.id || row.batchId || row.batch_id || row.batchCode || row.batch_code) === id
  )
  if (existing) return { id: text(existing.id || id) }

  const now = new Date().toISOString()
  const collectedAt = text(
    source.collectedAt ||
      source.collected_at ||
      source.observedAt ||
      source.observed_at ||
      source.collectionDate ||
      source.collection_date ||
      now
  )
  await upsertLike('trait_observation_batch', {
    id,
    batchId: id,
    batch_id: id,
    batchCode: id,
    batch_code: id,
    batchName: text(
      source.batchName || source.batch_name || `表型采集 ${collectedAt.slice(0, 10)}`
    ),
    batch_name: text(
      source.batchName || source.batch_name || `表型采集 ${collectedAt.slice(0, 10)}`
    ),
    sourceType: text(source.sourceType || source.source_type || 'manual'),
    source_type: text(source.sourceType || source.source_type || 'manual'),
    operatorName: text(source.operatorName || source.operator_name || source.collector || '育种员'),
    operator_name: text(
      source.operatorName || source.operator_name || source.collector || '育种员'
    ),
    collectedAt,
    collected_at: collectedAt,
    status: 'recorded',
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
  return { id }
}

export async function ensureDeviceForSensorFk(
  deviceCode: string,
  source: AnyRow = {}
): Promise<CanonicalDeviceResult> {
  const candidate = text(
    deviceCode ||
      source.deviceCode ||
      source.device_code ||
      source.deviceId ||
      source.device_id ||
      source.id
  )
  const name = text(source.deviceName || source.device_name || source.name)
  const metric = text(source.metricCode || source.metric_code || source.metric)
  const measuredAt = text(source.measuredAt || source.measured_at || source.timestamp)
  const id = candidate || stableId('device', name || metric || 'sensor', measuredAt || Date.now())

  const rows = await databaseService.getTableDataAsync('device', { silent: true }).catch(() => [])
  const existing = (rows || []).find(
    (row: AnyRow) =>
      text(
        row.id || row.deviceId || row.device_id || row.code || row.deviceCode || row.device_code
      ) === id ||
      (!!candidate && text(row.code || row.deviceCode || row.device_code) === candidate)
  )
  if (existing) return { id: text(existing.id || existing.deviceId || existing.device_id || id) }

  const now = new Date().toISOString()
  await upsertLike('device', {
    id,
    code: candidate || id,
    deviceCode: candidate || id,
    device_code: candidate || id,
    name: name || candidate || id,
    deviceName: name || candidate || id,
    device_name: name || candidate || id,
    type: text(source.deviceType || source.device_type || 'sensor'),
    deviceType: text(source.deviceType || source.device_type || 'sensor'),
    device_type: text(source.deviceType || source.device_type || 'sensor'),
    status: '在线',
    notes: firstText(source.notes, source.remark, source['备注']),
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
  return { id }
}

async function upsertLike(table: string, row: AnyRow) {
  const id = text(row.id)
  const rows = await databaseService.getTableDataAsync(table, { silent: true }).catch(() => [])
  if (id && rows.some((item: AnyRow) => text(item.id) === id)) {
    await databaseService.updateTableRecordAsync(table, id, row)
  } else {
    await databaseService.addTableDataAsync(table, row)
  }
}

function inferTraitType(code: string) {
  return code === 'milk_yield' || code.startsWith('milk_') || code === 'somatic_cell_count'
    ? 'lactation'
    : 'phenotype'
}

function normalizeSex(value: string) {
  const raw = text(value)
  if (['公', '雄', 'male', 'M'].includes(raw)) return '公'
  if (['母', '雌', 'female', 'F'].includes(raw)) return '母'
  return raw || '母'
}

function firstText(...values: unknown[]) {
  return values.map(text).find(Boolean) || ''
}

function nullableText(value: unknown) {
  return text(value) || null
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function stableId(prefix: string, ...parts: unknown[]) {
  const raw = parts.map(text).filter(Boolean).join('-')
  const body = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const cleanPrefix =
    text(prefix)
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 18) || 'row'
  const hash = hashText(raw || `${cleanPrefix}-${Date.now()}-${Math.random()}`)
  const maxBodyLength = Math.max(0, 64 - cleanPrefix.length - hash.length - 2)
  const shortBody = body.slice(0, maxBodyLength).replace(/-$/g, '')
  return [cleanPrefix, shortBody, hash].filter(Boolean).join('-').slice(0, 64)
}

function hashText(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
