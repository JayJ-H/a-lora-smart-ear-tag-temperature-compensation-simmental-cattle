import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
if (process.env.AUDIT_SKIP_PRODUCTION_ENV !== '1') {
  dotenv.config({ path: path.join(projectRoot, 'ops/production/.env.prod'), override: true, quiet: true })
}

const apply = process.argv.includes('--apply')
const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
    [dbConfig.database, table]
  )
  return Number(rows?.[0]?.count || 0) > 0
}

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [dbConfig.database, table, column]
  )
  return Number(rows?.[0]?.count || 0) > 0
}

async function addColumnIfMissing(connection, table, column, definition, changes) {
  if (!(await tableExists(connection, table))) {
    changes.push({ action: 'skip_missing_table', table, column })
    return
  }
  if (await columnExists(connection, table, column)) {
    changes.push({ action: 'exists', table, column })
    return
  }
  changes.push({ action: apply ? 'add_column' : 'would_add_column', table, column, definition })
  if (apply) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
}

async function repairSensorReadingsColumns(connection, changes) {
  await addColumnIfMissing(connection, 'sensor_readings', 'animal_id', 'VARCHAR(64) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'cow_id', 'VARCHAR(64) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'cow_number', 'VARCHAR(64) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'device_id', 'VARCHAR(128) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'channel_id', 'VARCHAR(128) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'metric_code', 'VARCHAR(64) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'metric', 'VARCHAR(64) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'measured_at', 'DATETIME(3) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'timestamp', 'DATETIME(3) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'reading_value', 'DECIMAL(18,6) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'value', 'DECIMAL(18,6) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'reading_text', 'VARCHAR(256) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'unit', 'VARCHAR(32) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'production_date', 'DATE NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'quality_flag', 'VARCHAR(32) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'raw_payload', 'JSON NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'source_table', 'VARCHAR(128) NULL', changes)
  await addColumnIfMissing(connection, 'sensor_readings', 'source_record_id', 'VARCHAR(128) NULL', changes)
}

async function repairOperationAuditColumns(connection, changes) {
  await addColumnIfMissing(connection, 'operation_audit_log', 'cow_ids', 'JSON NULL', changes)
  await addColumnIfMissing(connection, 'operation_audit_log', 'relation_scope', 'JSON NULL', changes)
  await addColumnIfMissing(connection, 'operation_audit_log', 'source_record_ids', 'JSON NULL', changes)
}

async function repairMilkReviewLactationOrphans(connection, changes) {
  if (!(await tableExists(connection, 'milk_measurement')) || !(await tableExists(connection, 'lactation_episode'))) return
  const [orphans] = await connection.query(`
    SELECT m.id, m.animal_id, m.parity_no, m.lactation_id, m.production_date, m.measured_at, m.days_in_milk
    FROM milk_measurement m
    LEFT JOIN lactation_episode l ON l.id = m.lactation_id
    WHERE m.source_table = 'milk_missing_review'
      AND m.lactation_id IS NOT NULL
      AND l.id IS NULL
    LIMIT 200
  `)
  for (const row of orphans) {
    const [episodes] = await connection.query(
      `
        SELECT id
        FROM lactation_episode
        WHERE animal_id = ?
          AND (? IS NULL OR parity_no = ?)
          AND (start_date IS NULL OR start_date <= DATE(?))
          AND (end_date IS NULL OR end_date >= DATE(?))
        ORDER BY start_date DESC
        LIMIT 1
      `,
      [row.animal_id, row.parity_no, row.parity_no, row.measured_at || row.production_date, row.measured_at || row.production_date]
    )
    if (!episodes[0]?.id) {
      changes.push({ action: 'manual_review', table: 'milk_measurement', id: row.id, reason: 'no_matching_lactation_episode' })
      continue
    }
    changes.push({
      action: apply ? 'update_lactation_id' : 'would_update_lactation_id',
      table: 'milk_measurement',
      id: row.id,
      from: row.lactation_id,
      to: episodes[0].id
    })
    if (apply) {
      await connection.query(
        `UPDATE milk_measurement SET lactation_id = ?, updated_at = NOW(3) WHERE id = ?`,
        [episodes[0].id, row.id]
      )
    }
  }
}

function jsonValue(value) {
  if (value === undefined) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value ?? null)
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return value
  if (Buffer.isBuffer(value)) value = value.toString('utf8')
  if (typeof value !== 'string') return fallback
  const text = value.trim()
  if (!text) return fallback
  if (!['{', '['].includes(text[0])) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function unique(values) {
  return [
    ...new Set(
      (values || [])
        .flat()
        .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
        .map((value) => String(value).trim())
    )
  ]
}

function keyName(value) {
  return String(value || '').replace(/[\s-]/g, '_').toLowerCase()
}

function valuesFromMaybeArray(value) {
  if (Array.isArray(value)) return value.flatMap(valuesFromMaybeArray)
  if (value && typeof value === 'object') return []
  return value === undefined || value === null || value === '' ? [] : [String(value)]
}

const COW_ID_KEYS = new Set(['cowid', 'cow_id', 'animalid', 'animal_id', 'sourcecowid', 'source_cow_id', 'targetcowid', 'target_cow_id'])
const COW_IDS_KEYS = new Set(['cowids', 'cow_ids', 'animalids', 'animal_ids', 'sourcecowids', 'source_cow_ids', 'targetcowids', 'target_cow_ids'])
const COW_NUMBER_KEYS = new Set(['cownumber', 'cow_number', 'animalnumber', 'animal_number', 'sourcecownumber', 'source_cow_number', 'targetcownumber', 'target_cow_number'])
const COW_NUMBERS_KEYS = new Set(['cownumbers', 'cow_numbers', 'animalnumbers', 'animal_numbers', 'sourcecownumbers', 'source_cow_numbers', 'targetcownumbers', 'target_cow_numbers'])

function collectCowTokens(value, output = { ids: [], numbers: [] }, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return output
  const parsed = typeof value === 'string' ? parseJson(value, value) : value
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectCowTokens(item, output, depth + 1)
    return output
  }
  if (parsed && typeof parsed === 'object') {
    for (const [rawKey, rawValue] of Object.entries(parsed)) {
      const key = keyName(rawKey)
      if (COW_ID_KEYS.has(key) || COW_IDS_KEYS.has(key)) output.ids.push(...valuesFromMaybeArray(rawValue))
      else if (COW_NUMBER_KEYS.has(key) || COW_NUMBERS_KEYS.has(key)) output.numbers.push(...valuesFromMaybeArray(rawValue))
      collectCowTokens(rawValue, output, depth + 1)
    }
  }
  return output
}

function normalizeTableName(name) {
  return String(name || '')
    .trim()
    .replace(/-/g, '_')
    .replace(/[^\w]/g, '')
    .toLowerCase()
}

function sourceIdsFromAuditRow(row) {
  const request = parseJson(row.request_payload, row.request_payload) || {}
  const result = parseJson(row.result_payload, row.result_payload) || {}
  const table = normalizeTableName(row.target_type || request.tableName || request.table_name)
  if (!table) return {}
  const ids = unique([
    request.id,
    request.recordId,
    request.record_id,
    request.updatedRecord?.id,
    request.data?.id,
    result.id,
    result.insertedId,
    result.targetId
  ])
  if (Array.isArray(request.data)) ids.push(...unique(request.data.map((item) => item?.id || item?.recordId || item?.record_id)))
  return { [table]: unique(ids) }
}

function hasNonEmptySourceRecordIds(value) {
  const parsed = parseJson(value, value)
  if (!parsed) return false
  if (Array.isArray(parsed)) return parsed.length > 0
  if (typeof parsed === 'object') {
    return Object.values(parsed).some((ids) => (Array.isArray(ids) ? ids.length > 0 : ids !== undefined && ids !== null && ids !== ''))
  }
  return String(parsed).trim() !== ''
}

async function resolveCowIds(connection, tokens) {
  const cowIds = new Set()
  const ids = unique(tokens.ids)
  const numbers = unique(tokens.numbers)
  if (ids.length) {
    const [rows] = await connection.query(
      `SELECT id, cow_number FROM cows WHERE id IN (${ids.map(() => '?').join(',')}) OR cow_number IN (${ids.map(() => '?').join(',')})`,
      [...ids, ...ids]
    )
    for (const row of rows) cowIds.add(String(row.id))
  }
  if (numbers.length) {
    const [rows] = await connection.query(
      `SELECT id, cow_number FROM cows WHERE cow_number IN (${numbers.map(() => '?').join(',')}) OR id IN (${numbers.map(() => '?').join(',')})`,
      [...numbers, ...numbers]
    )
    for (const row of rows) cowIds.add(String(row.id))
  }
  return [...cowIds]
}

async function resolveCowIdsFromSourceRecords(connection, sourceRecordIds) {
  const cowIds = new Set()
  for (const [table, ids] of Object.entries(sourceRecordIds || {})) {
    const normalizedTable = normalizeTableName(table)
    const recordIds = unique(ids)
    if (!recordIds.length) continue
    if (!(await tableExists(connection, normalizedTable)) || !(await columnExists(connection, normalizedTable, 'id'))) continue
    const hasAnimalId = await columnExists(connection, normalizedTable, 'animal_id')
    const hasCowId = await columnExists(connection, normalizedTable, 'cow_id')
    const hasCowNumber = await columnExists(connection, normalizedTable, 'cow_number')
    if (!hasAnimalId && !hasCowId && !hasCowNumber && !['animal', 'cows'].includes(normalizedTable)) continue
    const selected = ['id']
    if (hasAnimalId) selected.push('animal_id')
    if (hasCowId) selected.push('cow_id')
    if (hasCowNumber) selected.push('cow_number')
    if (normalizedTable === 'animal') selected.push('animal_number')
    if (normalizedTable === 'cows') selected.push('cow_number')
    const [rows] = await connection.query(
      `SELECT ${selected.map((column) => `\`${column}\``).join(', ')} FROM \`${normalizedTable}\` WHERE id IN (${recordIds.map(() => '?').join(',')})`,
      recordIds
    )
    for (const row of rows) {
      const tokens = collectCowTokens(row)
      if (normalizedTable === 'animal' || normalizedTable === 'cows') tokens.ids.push(row.id)
      const resolved = await resolveCowIds(connection, tokens)
      for (const id of resolved) cowIds.add(id)
    }
  }
  return [...cowIds]
}

async function backfillSensorReadingsMirror(connection, changes) {
  if (!(await tableExists(connection, 'sensor_reading')) || !(await tableExists(connection, 'sensor_readings'))) return
  const [rows] = await connection.query(`
    SELECT sr.*
    FROM sensor_reading sr
    LEFT JOIN sensor_readings legacy ON legacy.id = sr.id
    WHERE legacy.id IS NULL
    LIMIT 5000
  `)
  changes.push({ action: apply ? 'mirror_sensor_readings' : 'would_mirror_sensor_readings', count: rows.length })
  if (!apply || !rows.length) return
  for (const row of rows) {
    await connection.query(
      `
        INSERT INTO sensor_readings (
          id, animal_id, cow_id, cow_number, device_id, channel_id, metric_code, metric,
          reading_value, value, reading_text, unit, measured_at, timestamp, production_date,
          quality_flag, raw_payload, source_table, source_record_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          animal_id = VALUES(animal_id),
          cow_id = VALUES(cow_id),
          cow_number = VALUES(cow_number),
          device_id = VALUES(device_id),
          channel_id = VALUES(channel_id),
          metric_code = VALUES(metric_code),
          metric = VALUES(metric),
          reading_value = VALUES(reading_value),
          value = VALUES(value),
          reading_text = VALUES(reading_text),
          unit = VALUES(unit),
          measured_at = VALUES(measured_at),
          timestamp = VALUES(timestamp),
          production_date = VALUES(production_date),
          quality_flag = VALUES(quality_flag),
          raw_payload = VALUES(raw_payload),
          source_table = VALUES(source_table),
          source_record_id = VALUES(source_record_id),
          updated_at = VALUES(updated_at)
      `,
      [
        row.id,
        row.animal_id,
        row.cow_id || row.animal_id,
        row.cow_number || null,
        row.device_id,
        row.channel_id,
        row.metric_code,
        row.metric_code,
        row.reading_value,
        row.reading_value,
        row.reading_text,
        row.unit,
        row.measured_at,
        row.measured_at,
        row.production_date,
        row.quality_flag,
        jsonValue(row.raw_payload),
        row.source_table || 'sensor_reading',
        row.source_record_id || row.id,
        row.created_at,
        row.updated_at || row.created_at
      ]
    )
  }
}

async function backfillEventDetails(connection, changes) {
  if (!(await tableExists(connection, 'animal_event')) || !(await tableExists(connection, 'event_reproduction_detail'))) return
  const [reproRows] = await connection.query(`
    SELECT ae.*
    FROM animal_event ae
    LEFT JOIN event_reproduction_detail rd ON rd.event_id = ae.id
    WHERE ae.event_type IN ('insemination','pregnancy_check','calving','abortion','heat')
      AND rd.id IS NULL
    LIMIT 500
  `)
  changes.push({ action: apply ? 'backfill_event_reproduction_detail' : 'would_backfill_event_reproduction_detail', count: reproRows.length })
  if (apply) {
    for (const row of reproRows) {
      let detail = row.custom_values
      if (typeof detail === 'string') {
        try {
          detail = JSON.parse(detail)
        } catch {
          detail = {}
        }
      }
      detail = detail && typeof detail === 'object' ? detail : {}
      const calfAnimalId = Array.isArray(detail.calves)
        ? (detail.calves[0]?.animalId || detail.calves[0]?.cowId || null)
        : (detail.calfAnimalId || detail.calf_animal_id || null)
      await connection.query(
        `
          INSERT INTO event_reproduction_detail (
            id, event_id, reproduction_action, bull_number, semen_batch,
            insemination_no, pregnancy_result, calving_result, calf_animal_id,
            technician, detail, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?)
          ON DUPLICATE KEY UPDATE
            reproduction_action = VALUES(reproduction_action),
            bull_number = VALUES(bull_number),
            semen_batch = VALUES(semen_batch),
            pregnancy_result = VALUES(pregnancy_result),
            calving_result = VALUES(calving_result),
            calf_animal_id = VALUES(calf_animal_id),
            technician = VALUES(technician),
            detail = VALUES(detail),
            updated_at = VALUES(updated_at)
        `,
        [
          `detail-${row.id}`.slice(0, 64),
          row.id,
          row.event_type,
          detail.bull_number || detail.bullNumber || detail.father_number || detail.fatherNumber || null,
          detail.semen_batch || detail.semenBatch || null,
          Number(detail.insemination_no || detail.inseminationNo) || null,
          detail.pregnancy_result || detail.pregnancyResult || detail.result || null,
          detail.calving_result || detail.calvingResult || detail.result || null,
          calfAnimalId,
          detail.technician || row.operator_name || null,
          jsonValue(detail),
          row.created_at,
          row.updated_at || row.created_at
        ]
      )
    }
  }
}

async function ensureRelationshipSeedRows(connection, changes) {
  const now = '2026-06-08 00:00:00.000'
  if (await tableExists(connection, 'hardware_devices')) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM hardware_devices WHERE id = 'seed-device-readiness-gateway'`)
    if (!Number(rows?.[0]?.count || 0)) {
      changes.push({ action: apply ? 'insert_seed_device' : 'would_insert_seed_device', id: 'seed-device-readiness-gateway' })
      if (apply) {
        await connection.query(
          `
            INSERT INTO hardware_devices (
              id, name, device_type, status, brand, model, serial_number,
              location_json, last_seen, firmware_version, capabilities,
              configuration_json, installed_at, maintenance_schedule,
              cow_ids, relation_scope, source_record_ids
            ) VALUES (
              'seed-device-readiness-gateway', 'Seed Device Readiness Gateway', 'gateway', 'online',
              'GXLab', 'Readiness-GW', 'GX-SEED-READINESS-GW',
              CAST(? AS JSON), ?, '1.0.0', CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS JSON),
              CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON)
            )
          `,
          [
            JSON.stringify({ area: 'production-baseline', station: 'relationship-audit-readiness' }),
            now,
            JSON.stringify(['relationship_audit_trace', 'device_readiness', 'baseline_gateway']),
            JSON.stringify({ source: 'scripts/repair-database-bug-closure-blockers.mjs', nonDestructiveRepair: true }),
            now,
            JSON.stringify({ intervalDays: 30 }),
            JSON.stringify([]),
            JSON.stringify({ scope: 'system', domain: 'hardware_readiness', cowIds: [], tracePolicy: 'seed device restored for relationship integrity' }),
            JSON.stringify({})
          ]
        )
      }
    }
  }
  if (await tableExists(connection, 'persons')) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM persons WHERE id = 'person-breeding-tech'`)
    if (!Number(rows?.[0]?.count || 0)) {
      changes.push({ action: apply ? 'insert_seed_person' : 'would_insert_seed_person', id: 'person-breeding-tech' })
      if (apply) {
        await connection.query(
          `
            INSERT INTO persons (
              id, name, department, role, phone, email, status, hire_date, notes,
              created_at, updated_at, is_active
            ) VALUES (
              'person-breeding-tech', '育种技术员', '育种室', '育种技术员',
              '', '', 'active', '2024-01-01',
              '生产核验种子人员，关系审计回填。', ?, ?, 1
            )
          `,
          [now, now]
        )
      }
    }
  }
}

async function backfillAcceptanceOmicsDatasetSamples(connection, changes) {
  if (!(await tableExists(connection, 'omics_datasets')) || !(await tableExists(connection, 'omics_samples'))) return
  const [datasets] = await connection.query(`
    SELECT id, sample_ids, sample_count
    FROM omics_datasets
    WHERE id = 'acceptance-omics-dataset-001'
      AND (sample_ids IS NULL OR JSON_LENGTH(sample_ids) = 0)
    LIMIT 1
  `)
  if (!datasets.length) return
  const [samples] = await connection.query(`
    SELECT id
    FROM omics_samples
    WHERE sample_code LIKE 'S-ACPT-%'
      AND cow_id IS NOT NULL
      AND cow_id <> ''
    ORDER BY sample_code
    LIMIT 500
  `)
  const sampleIds = samples.map((row) => row.id)
  changes.push({
    action: apply ? 'backfill_acceptance_omics_dataset_sample_ids' : 'would_backfill_acceptance_omics_dataset_sample_ids',
    id: datasets[0].id,
    count: sampleIds.length
  })
  if (apply && sampleIds.length) {
    await connection.query(
      `
        UPDATE omics_datasets
        SET sample_ids = CAST(? AS JSON),
            sample_count = ?,
            updated_at = NOW()
        WHERE id = ?
      `,
      [JSON.stringify(sampleIds), sampleIds.length, datasets[0].id]
    )
  }
}

async function normalizeSeedHardwareDeviceScope(connection, changes) {
  if (!(await tableExists(connection, 'hardware_devices'))) return
  const [rows] = await connection.query(`
    SELECT id, device_type, cow_ids, relation_scope
    FROM hardware_devices
    WHERE id = 'seed-device-readiness-gateway'
    LIMIT 1
  `)
  if (!rows.length) return
  const scope = parseJson(rows[0].relation_scope, {}) || {}
  if (scope.scope === 'system' && scope.domain === 'hardware_readiness') return
  changes.push({
    action: apply ? 'normalize_seed_hardware_device_system_scope' : 'would_normalize_seed_hardware_device_system_scope',
    id: rows[0].id
  })
  if (apply) {
    await connection.query(
      `
        UPDATE hardware_devices
        SET cow_ids = CAST(? AS JSON),
            relation_scope = CAST(? AS JSON),
            source_record_ids = CAST(? AS JSON)
        WHERE id = ?
      `,
      [
        JSON.stringify([]),
        JSON.stringify({
          scope: 'system',
          domain: 'hardware_readiness',
          cowIds: [],
          tracePolicy: 'system gateway is infrastructure and not a cow assignment'
        }),
        JSON.stringify({}),
        rows[0].id
      ]
    )
  }
}

async function backfillOperationAuditTrace(connection, changes) {
  if (!(await tableExists(connection, 'operation_audit_logs'))) return
  const [rows] = await connection.query(`
    SELECT id, action_type, target_type, target_id, request_payload, result_payload, cow_ids, source_record_ids, relation_scope
    FROM operation_audit_logs
    WHERE cow_ids IS NULL
       OR JSON_LENGTH(cow_ids) = 0
       OR source_record_ids IS NULL
       OR JSON_LENGTH(source_record_ids) = 0
    LIMIT 5000
  `)
  let updateCount = 0
  for (const row of rows) {
    const request = parseJson(row.request_payload, row.request_payload) || {}
    const result = parseJson(row.result_payload, row.result_payload) || {}
    const tokens = collectCowTokens({ row, request, result })
    const targetTable = normalizeTableName(row.target_type || request.tableName || request.table_name)
    const requestId = request.id || request.recordId || request.record_id
    if (['animal', 'cows'].includes(targetTable) && requestId) tokens.ids.push(String(requestId))
    const sourceRecordIds = sourceIdsFromAuditRow(row)
    const cowIds = unique([...(await resolveCowIds(connection, tokens)), ...(await resolveCowIdsFromSourceRecords(connection, sourceRecordIds))])
    const hasSource = Object.values(sourceRecordIds).some((ids) => Array.isArray(ids) && ids.length)
    if (!cowIds.length && !hasSource) continue
    updateCount += 1
    if (!apply) continue
    const relationScope = {
      scope: 'cow_group',
      domain: 'operation_audit',
      cowIds,
      cowNumbers: unique(tokens.numbers),
      table: normalizeTableName(row.target_type || request.tableName || request.table_name),
      method: request.method || null,
      tracePolicy: 'backfilled from operation audit request/result payload'
    }
    await connection.query(
      `
        UPDATE operation_audit_logs
        SET cow_ids = IF(JSON_LENGTH(COALESCE(cow_ids, JSON_ARRAY())) = 0, CAST(? AS JSON), cow_ids),
            relation_scope = CAST(? AS JSON),
            source_record_ids = CAST(? AS JSON),
            updated_at = NOW(3)
        WHERE id = ?
      `,
      [JSON.stringify(cowIds), JSON.stringify(relationScope), JSON.stringify(sourceRecordIds), row.id]
    )
    if (await tableExists(connection, 'operation_audit_log')) {
      await connection.query(
        `
          UPDATE operation_audit_log
          SET cow_ids = IF(JSON_LENGTH(COALESCE(cow_ids, JSON_ARRAY())) = 0, CAST(? AS JSON), cow_ids),
              relation_scope = CAST(? AS JSON),
              source_record_ids = CAST(? AS JSON),
              updated_at = NOW(3)
          WHERE id = ?
        `,
        [JSON.stringify(cowIds), JSON.stringify(relationScope), JSON.stringify(sourceRecordIds), row.id]
      )
    }
  }
  changes.push({
    action: apply ? 'backfill_operation_audit_trace' : 'would_backfill_operation_audit_trace',
    scanned: rows.length,
    updateCount
  })
}

async function removeDuplicateMilkInformationImportFacts(connection, changes) {
  if (!(await tableExists(connection, 'milk_measurement')) || !(await tableExists(connection, 'milk_records'))) return
  const [standardRows] = await connection.query(`
    SELECT dup.id
    FROM milk_measurement dup
    JOIN milk_measurement keep
      ON keep.animal_id = dup.animal_id
     AND keep.measured_at = dup.measured_at
     AND COALESCE(keep.shift_id, '') = COALESCE(dup.shift_id, '')
     AND ROUND(COALESCE(keep.milk_yield, 0), 2) = ROUND(COALESCE(dup.milk_yield, 0), 2)
     AND keep.source_table = 'animal_event'
    WHERE dup.source_table = 'information-import'
      AND dup.id <> keep.id
  `)
  const [legacyRows] = await connection.query(`
    SELECT dup.id
    FROM milk_records dup
    JOIN milk_records keep
      ON keep.cow_id = dup.cow_id
     AND keep.milking_time = dup.milking_time
     AND COALESCE(keep.shift_id, '') = COALESCE(dup.shift_id, '')
     AND ROUND(COALESCE(keep.volume, 0), 2) = ROUND(COALESCE(dup.volume, 0), 2)
     AND keep.source_table = 'animal_event'
    WHERE dup.source_table = 'information-import'
      AND dup.id <> keep.id
  `)
  const standardIds = unique(standardRows.map((row) => row.id))
  const legacyIds = unique(legacyRows.map((row) => row.id))
  changes.push({
    action: apply ? 'remove_duplicate_information_import_milk_facts' : 'would_remove_duplicate_information_import_milk_facts',
    milkMeasurement: standardIds.length,
    milkRecords: legacyIds.length,
    sampleMilkMeasurement: standardIds.slice(0, 5),
    sampleMilkRecords: legacyIds.slice(0, 5)
  })
  if (!apply) return
  for (const ids of [standardIds, legacyIds]) {
    for (let index = 0; index < ids.length; index += 500) {
      const chunk = ids.slice(index, index + 500)
      if (!chunk.length) continue
      const table = ids === standardIds ? 'milk_measurement' : 'milk_records'
      await connection.query(`DELETE FROM \`${table}\` WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk)
    }
  }
}

async function backfillCanonicalOperationAudit(connection, changes) {
  if (!(await tableExists(connection, 'operation_audit_logs')) || !(await tableExists(connection, 'operation_audit_log'))) return
  const [rows] = await connection.query(`
    SELECT logs.*
    FROM operation_audit_logs logs
    LEFT JOIN operation_audit_log log1 ON log1.id = logs.id
    WHERE log1.id IS NULL
    LIMIT 10000
  `)
  changes.push({ action: apply ? 'backfill_operation_audit_log' : 'would_backfill_operation_audit_log', count: rows.length })
  if (!apply) return
  for (const row of rows) {
    await connection.query(
      `
        INSERT INTO operation_audit_log (
          id, action_type, target_type, target_id, animal_id, operator_name, operated_at,
          request_payload, result_payload, status, created_at, updated_at,
          cow_ids, relation_scope, source_record_ids
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))
        ON DUPLICATE KEY UPDATE
          action_type = VALUES(action_type),
          target_type = VALUES(target_type),
          target_id = VALUES(target_id),
          operator_name = VALUES(operator_name),
          operated_at = VALUES(operated_at),
          request_payload = VALUES(request_payload),
          result_payload = VALUES(result_payload),
          status = VALUES(status),
          updated_at = VALUES(updated_at),
          cow_ids = VALUES(cow_ids),
          relation_scope = VALUES(relation_scope),
          source_record_ids = VALUES(source_record_ids)
      `,
      [
        row.id,
        row.action_type || 'operation',
        row.target_type || 'system',
        row.target_id || null,
        row.operator || 'system',
        row.created_at || row.updated_at || new Date(),
        jsonValue(row.request_payload || {}),
        jsonValue(row.result_payload || {}),
        row.status || 'completed',
        row.created_at || new Date(),
        row.updated_at || row.created_at || new Date(),
        jsonValue(row.cow_ids || []),
        jsonValue(row.relation_scope || {}),
        jsonValue(row.source_record_ids || {})
      ]
    )
  }
}

const connection = await mysql.createConnection(dbConfig)
const changes = []
try {
  await repairSensorReadingsColumns(connection, changes)
  await repairOperationAuditColumns(connection, changes)
  await repairMilkReviewLactationOrphans(connection, changes)
  await backfillSensorReadingsMirror(connection, changes)
  await backfillEventDetails(connection, changes)
  await ensureRelationshipSeedRows(connection, changes)
  await backfillCanonicalOperationAudit(connection, changes)
  await backfillAcceptanceOmicsDatasetSamples(connection, changes)
  await normalizeSeedHardwareDeviceScope(connection, changes)
  await backfillOperationAuditTrace(connection, changes)
  await removeDuplicateMilkInformationImportFacts(connection, changes)
} finally {
  await connection.end().catch(() => undefined)
}

console.log(JSON.stringify({ ok: true, apply, changes }, null, 2))
