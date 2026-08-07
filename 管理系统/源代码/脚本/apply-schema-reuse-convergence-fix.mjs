import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
if (process.env.AUDIT_SKIP_PRODUCTION_ENV !== '1') {
  dotenv.config({ path: path.join(projectRoot, '运维/生产配置/.env.prod'), override: true, quiet: true })
}

const apply = process.argv.includes('--apply')
const reportDir = path.join(projectRoot, 'reports', '20260610-schema-reuse-convergence')
const reportPath = path.join(reportDir, apply ? 'schema-reuse-fix-apply.json' : 'schema-reuse-fix-dry-run.json')

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

const TARGET_CHARSET = 'utf8mb4'
const TARGET_COLLATION = 'utf8mb4_unicode_ci'

function textDefinition(definition) {
  const raw = String(definition || '').trim()
  if (/character\s+set|collate/i.test(raw)) return raw
  const match = raw.match(/^(VARCHAR\([^)]+\)|CHAR\([^)]+\)|TEXT|MEDIUMTEXT|LONGTEXT)(.*)$/i)
  if (!match) return raw
  return `${match[1]} CHARACTER SET ${TARGET_CHARSET} COLLATE ${TARGET_COLLATION}${match[2] || ''}`
}

const COLUMN_FIXES = [
  ['cows', 'animal_id', 'VARCHAR(64) NULL'],
  ['cows', 'animal_number', 'VARCHAR(64) NULL'],
  ['cows', 'current_unit_id', 'VARCHAR(64) NULL'],
  ['cows', 'current_pen_id', 'VARCHAR(64) NULL'],
  ['cows', 'source_table', 'VARCHAR(128) NULL'],
  ['cows', 'source_record_id', 'VARCHAR(128) NULL'],

  ['animal_event', 'source_table', 'VARCHAR(128) NULL'],
  ['animal_event', 'recorded_at', 'DATETIME(3) NULL'],
  ['animal_event', 'work_operator_id', 'VARCHAR(64) NULL'],
  ['animal_event', 'work_operator_name', 'VARCHAR(128) NULL'],

  ['operation_audit_log', 'operator_id', 'VARCHAR(64) NULL'],
  ['operation_audit_logs', 'operator_id', 'VARCHAR(64) NULL'],
  ['operation_audit_logs', 'operator_name', 'VARCHAR(128) NULL'],

  ['sensor_reading', 'operator_name', 'VARCHAR(128) NULL'],
  ['sensor_readings', 'operator_name', 'VARCHAR(128) NULL'],

  ['milking_session', 'recorded_at', 'DATETIME(3) NULL'],
  ['milking_session', 'work_operator_id', 'VARCHAR(64) NULL'],
  ['milking_session', 'work_operator_name', 'VARCHAR(128) NULL'],
  ['milking_visit', 'recorded_at', 'DATETIME(3) NULL'],
  ['milking_visit', 'work_operator_id', 'VARCHAR(64) NULL'],
  ['milking_visit', 'work_operator_name', 'VARCHAR(128) NULL'],
  ['milk_measurement', 'recorded_at', 'DATETIME(3) NULL'],
  ['milk_measurement', 'work_operator_id', 'VARCHAR(64) NULL'],
  ['milk_measurement', 'work_operator_name', 'VARCHAR(128) NULL'],
  ['milk_records', 'animal_id', 'VARCHAR(64) NULL'],
  ['milk_records', 'animal_number', 'VARCHAR(64) NULL'],
  ['milk_records', 'measured_at', 'DATETIME(3) NULL'],
  ['milk_records', 'recorded_at', 'DATETIME(3) NULL'],
  ['milk_records', 'work_operator_id', 'VARCHAR(64) NULL'],
  ['milk_records', 'work_operator_name', 'VARCHAR(128) NULL'],

  ['trait_observation', 'source_table', 'VARCHAR(128) NULL'],
  ['trait_observation', 'operator_id', 'VARCHAR(64) NULL'],
  ['trait_observation', 'operator_name', 'VARCHAR(128) NULL'],
  ['trait_observation', 'work_operator_id', 'VARCHAR(64) NULL'],
  ['trait_observation', 'work_operator_name', 'VARCHAR(128) NULL'],
  ['trait_observation', 'recorded_at', 'DATETIME(3) NULL'],

  ['trait_observation_batch', 'operator_id', 'VARCHAR(64) NULL'],
  ['trait_observation_batch', 'operator_name', 'VARCHAR(128) NULL'],
  ['trait_observation_batch', 'work_operator_id', 'VARCHAR(64) NULL'],
  ['trait_observation_batch', 'work_operator_name', 'VARCHAR(128) NULL'],
  ['trait_observation_batch', 'recorded_at', 'DATETIME(3) NULL'],

  ['phenotype_records', 'observed_at', 'DATETIME(3) NULL'],
  ['phenotype_records', 'animal_id', 'VARCHAR(64) NULL'],
  ['phenotype_records', 'animal_number', 'VARCHAR(64) NULL'],
  ['phenotype_records', 'trait_id', 'VARCHAR(64) NULL'],
  ['phenotype_records', 'operator_id', 'VARCHAR(64) NULL'],
  ['phenotype_records', 'operator_name', 'VARCHAR(128) NULL'],
  ['phenotype_records', 'work_operator_id', 'VARCHAR(64) NULL'],
  ['phenotype_records', 'work_operator_name', 'VARCHAR(128) NULL'],
  ['phenotype_records', 'source_table', 'VARCHAR(128) NULL'],
  ['phenotype_records', 'source_record_id', 'VARCHAR(128) NULL'],
  ['phenotype_records', 'recorded_at', 'DATETIME(3) NULL'],

  ['omics_samples', 'operator_id', 'VARCHAR(64) NULL'],
  ['omics_samples', 'operator_name', 'VARCHAR(128) NULL'],
  ['omics_samples', 'animal_id', 'VARCHAR(64) NULL'],
  ['omics_samples', 'animal_number', 'VARCHAR(64) NULL'],
  ['omics_samples', 'work_operator_id', 'VARCHAR(64) NULL'],
  ['omics_samples', 'work_operator_name', 'VARCHAR(128) NULL'],
  ['omics_samples', 'source_table', 'VARCHAR(128) NULL'],
  ['omics_samples', 'source_record_id', 'VARCHAR(128) NULL'],
  ['omics_samples', 'collected_at', 'DATETIME(3) NULL'],
  ['omics_samples', 'recorded_at', 'DATETIME(3) NULL']
]

for (const table of ['entry_events', 'transfer_events', 'exit_events']) {
  COLUMN_FIXES.push(
    [table, 'animal_id', 'VARCHAR(64) NULL'],
    [table, 'animal_number', 'VARCHAR(64) NULL'],
    [table, 'occurred_at', 'DATETIME(3) NULL'],
    [table, 'recorded_at', 'DATETIME(3) NULL'],
    [table, 'operator_id', 'VARCHAR(64) NULL'],
    [table, 'operator_name', 'VARCHAR(128) NULL'],
    [table, 'work_operator_id', 'VARCHAR(64) NULL'],
    [table, 'work_operator_name', 'VARCHAR(128) NULL'],
    [table, 'source_table', 'VARCHAR(128) NULL'],
    [table, 'source_record_id', 'VARCHAR(128) NULL']
  )
}

for (const table of ['entry_events', 'exit_events']) {
  COLUMN_FIXES.push([table, 'unit_id', 'VARCHAR(64) NULL'])
}

for (const table of ['transfer_events', 'exit_events']) {
  COLUMN_FIXES.push([table, 'from_unit_id', 'VARCHAR(64) NULL'])
}

COLUMN_FIXES.push(['transfer_events', 'to_unit_id', 'VARCHAR(64) NULL'])

for (const table of ['breeding_events', 'veterinary_events']) {
  COLUMN_FIXES.push(
    [table, 'animal_id', 'VARCHAR(64) NULL'],
    [table, 'animal_number', 'VARCHAR(64) NULL'],
    [table, 'occurred_at', 'DATETIME(3) NULL'],
    [table, 'recorded_at', 'DATETIME(3) NULL'],
    [table, 'operator_id', 'VARCHAR(64) NULL'],
    [table, 'operator_name', 'VARCHAR(128) NULL'],
    [table, 'work_operator_id', 'VARCHAR(64) NULL'],
    [table, 'work_operator_name', 'VARCHAR(128) NULL'],
    [table, 'source_table', 'VARCHAR(128) NULL'],
    [table, 'source_record_id', 'VARCHAR(128) NULL']
  )
}

for (const table of ['cow_events']) {
  COLUMN_FIXES.push(
    [table, 'animal_id', 'VARCHAR(64) NULL'],
    [table, 'animal_number', 'VARCHAR(64) NULL'],
    [table, 'event_type', 'VARCHAR(64) NULL'],
    [table, 'event_code', 'VARCHAR(64) NULL'],
    [table, 'occurred_at', 'DATETIME(3) NULL'],
    [table, 'operator_id', 'VARCHAR(64) NULL'],
    [table, 'operator_name', 'VARCHAR(128) NULL'],
    [table, 'work_operator_id', 'VARCHAR(64) NULL'],
    [table, 'work_operator_name', 'VARCHAR(128) NULL'],
    [table, 'source_table', 'VARCHAR(128) NULL'],
    [table, 'source_record_id', 'VARCHAR(128) NULL'],
    [table, 'recorded_at', 'DATETIME(3) NULL']
  )
}

for (const table of [
  'event_reproduction_detail',
  'event_health_detail',
  'event_production_detail',
  'event_medicine_detail',
  'event_movement_detail'
]) {
  COLUMN_FIXES.push(
    [table, 'animal_id', 'VARCHAR(64) NULL'],
    [table, 'animal_number', 'VARCHAR(64) NULL'],
    [table, 'cow_number', 'VARCHAR(64) NULL'],
    [table, 'event_type', 'VARCHAR(64) NULL'],
    [table, 'occurred_at', 'DATETIME(3) NULL'],
    [table, 'operator_id', 'VARCHAR(64) NULL'],
    [table, 'operator_name', 'VARCHAR(128) NULL'],
    [table, 'work_operator_id', 'VARCHAR(64) NULL'],
    [table, 'work_operator_name', 'VARCHAR(128) NULL'],
    [table, 'source_table', 'VARCHAR(128) NULL'],
    [table, 'source_record_id', 'VARCHAR(128) NULL'],
    [table, 'recorded_at', 'DATETIME(3) NULL']
  )
}

for (const table of ['sensor_reading', 'sensor_readings']) {
  COLUMN_FIXES.push(
    [table, 'animal_number', 'VARCHAR(64) NULL']
  )
}

const BACKFILLS = [
  {
    table: 'cows',
    sql: `
      UPDATE cows c
      LEFT JOIN animal a
        ON CONVERT(a.animal_number USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.cow_number USING utf8mb4) COLLATE utf8mb4_unicode_ci
        OR CONVERT(a.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
         SET c.animal_id = COALESCE(NULLIF(c.animal_id, ''), a.id, c.id),
             c.animal_number = COALESCE(NULLIF(c.animal_number, ''), a.animal_number, c.cow_number),
             c.current_unit_id = COALESCE(NULLIF(c.current_unit_id, ''), NULLIF(c.current_pen_id, ''), NULLIF(c.current_pen, ''), a.current_unit_id, a.current_pen_id),
             c.current_pen_id = COALESCE(NULLIF(c.current_pen_id, ''), NULLIF(c.current_unit_id, ''), NULLIF(c.current_pen, ''), a.current_pen_id, a.current_unit_id),
             c.source_table = COALESCE(NULLIF(c.source_table, ''), 'animal'),
             c.source_record_id = COALESCE(NULLIF(c.source_record_id, ''), a.id, c.id)
       WHERE c.animal_id IS NULL OR c.animal_id = ''
          OR c.animal_number IS NULL OR c.animal_number = ''
          OR c.current_unit_id IS NULL OR c.current_unit_id = ''
          OR c.current_pen_id IS NULL OR c.current_pen_id = ''
          OR c.source_table IS NULL OR c.source_table = ''
          OR c.source_record_id IS NULL OR c.source_record_id = ''
    `
  },
  {
    table: 'entry_events',
    sql: `
      UPDATE entry_events e
      LEFT JOIN animal a
        ON CONVERT(a.animal_number USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(e.cow_number USING utf8mb4) COLLATE utf8mb4_unicode_ci
         SET e.animal_id = COALESCE(NULLIF(e.animal_id, ''), a.id),
             e.animal_number = COALESCE(NULLIF(e.animal_number, ''), a.animal_number, e.cow_number),
             e.occurred_at = COALESCE(e.occurred_at, e.entry_time, e.created_at),
             e.recorded_at = COALESCE(e.recorded_at, e.entry_time, e.created_at),
             e.operator_name = COALESCE(NULLIF(e.operator_name, ''), NULLIF(e.recorder, ''), 'system'),
             e.work_operator_name = COALESCE(NULLIF(e.work_operator_name, ''), NULLIF(e.operator_name, ''), NULLIF(e.recorder, '')),
             e.unit_id = COALESCE(NULLIF(e.unit_id, ''), NULLIF(e.pen, ''), a.current_unit_id, a.current_pen_id),
             e.source_table = COALESCE(NULLIF(e.source_table, ''), 'entry_events'),
             e.source_record_id = COALESCE(NULLIF(e.source_record_id, ''), e.id)
       WHERE e.animal_id IS NULL OR e.animal_id = ''
          OR e.animal_number IS NULL OR e.animal_number = ''
          OR e.occurred_at IS NULL
          OR e.recorded_at IS NULL
          OR e.operator_name IS NULL OR e.operator_name = ''
          OR e.work_operator_name IS NULL OR e.work_operator_name = ''
          OR e.unit_id IS NULL OR e.unit_id = ''
          OR e.source_table IS NULL OR e.source_table = ''
          OR e.source_record_id IS NULL OR e.source_record_id = ''
    `
  },
  {
    table: 'transfer_events',
    sql: `
      UPDATE transfer_events e
      LEFT JOIN animal a
        ON CONVERT(a.animal_number USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(e.cow_number USING utf8mb4) COLLATE utf8mb4_unicode_ci
         SET e.animal_id = COALESCE(NULLIF(e.animal_id, ''), a.id),
             e.animal_number = COALESCE(NULLIF(e.animal_number, ''), a.animal_number, e.cow_number),
             e.occurred_at = COALESCE(e.occurred_at, e.transfer_time, e.created_at),
             e.recorded_at = COALESCE(e.recorded_at, e.transfer_time, e.created_at),
             e.operator_name = COALESCE(NULLIF(e.operator_name, ''), NULLIF(e.recorder, ''), 'system'),
             e.work_operator_name = COALESCE(NULLIF(e.work_operator_name, ''), NULLIF(e.operator_name, ''), NULLIF(e.recorder, '')),
             e.from_unit_id = COALESCE(NULLIF(e.from_unit_id, ''), NULLIF(e.from_pen, '')),
             e.to_unit_id = COALESCE(NULLIF(e.to_unit_id, ''), NULLIF(e.to_pen, '')),
             e.source_table = COALESCE(NULLIF(e.source_table, ''), 'transfer_events'),
             e.source_record_id = COALESCE(NULLIF(e.source_record_id, ''), e.id)
       WHERE e.animal_id IS NULL OR e.animal_id = ''
          OR e.animal_number IS NULL OR e.animal_number = ''
          OR e.occurred_at IS NULL
          OR e.recorded_at IS NULL
          OR e.operator_name IS NULL OR e.operator_name = ''
          OR e.work_operator_name IS NULL OR e.work_operator_name = ''
          OR e.source_table IS NULL OR e.source_table = ''
          OR e.source_record_id IS NULL OR e.source_record_id = ''
    `
  },
  {
    table: 'exit_events',
    sql: `
      UPDATE exit_events e
      LEFT JOIN animal a
        ON CONVERT(a.animal_number USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(e.cow_number USING utf8mb4) COLLATE utf8mb4_unicode_ci
         SET e.animal_id = COALESCE(NULLIF(e.animal_id, ''), a.id),
             e.animal_number = COALESCE(NULLIF(e.animal_number, ''), a.animal_number, e.cow_number),
             e.occurred_at = COALESCE(e.occurred_at, e.exit_time, e.created_at),
             e.recorded_at = COALESCE(e.recorded_at, e.exit_time, e.created_at),
             e.operator_name = COALESCE(NULLIF(e.operator_name, ''), NULLIF(e.recorder, ''), 'system'),
             e.work_operator_name = COALESCE(NULLIF(e.work_operator_name, ''), NULLIF(e.operator_name, ''), NULLIF(e.recorder, '')),
             e.from_unit_id = COALESCE(NULLIF(e.from_unit_id, ''), a.current_unit_id, a.current_pen_id),
             e.unit_id = COALESCE(NULLIF(e.unit_id, ''), NULLIF(e.from_unit_id, ''), a.current_unit_id, a.current_pen_id),
             e.source_table = COALESCE(NULLIF(e.source_table, ''), 'exit_events'),
             e.source_record_id = COALESCE(NULLIF(e.source_record_id, ''), e.id)
       WHERE e.animal_id IS NULL OR e.animal_id = ''
          OR e.animal_number IS NULL OR e.animal_number = ''
          OR e.occurred_at IS NULL
          OR e.recorded_at IS NULL
          OR e.operator_name IS NULL OR e.operator_name = ''
          OR e.work_operator_name IS NULL OR e.work_operator_name = ''
          OR e.source_table IS NULL OR e.source_table = ''
          OR e.source_record_id IS NULL OR e.source_record_id = ''
    `
  },
  {
    table: 'breeding_events',
    sql: `
      UPDATE breeding_events e
      LEFT JOIN animal a
        ON CONVERT(a.animal_number USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(e.cow_number USING utf8mb4) COLLATE utf8mb4_unicode_ci
         SET e.animal_id = COALESCE(NULLIF(e.animal_id, ''), a.id),
             e.animal_number = COALESCE(NULLIF(e.animal_number, ''), a.animal_number, e.cow_number),
             e.occurred_at = COALESCE(e.occurred_at, e.event_time, e.event_date, e.created_at),
             e.recorded_at = COALESCE(e.recorded_at, e.event_time, e.event_date, e.created_at),
             e.operator_name = COALESCE(NULLIF(e.operator_name, ''), 'system'),
             e.work_operator_name = COALESCE(NULLIF(e.work_operator_name, ''), NULLIF(e.person, ''), NULLIF(e.operator_name, '')),
             e.source_table = COALESCE(NULLIF(e.source_table, ''), 'breeding_events'),
             e.source_record_id = COALESCE(NULLIF(e.source_record_id, ''), e.id)
       WHERE e.animal_id IS NULL OR e.animal_id = ''
          OR e.animal_number IS NULL OR e.animal_number = ''
          OR e.occurred_at IS NULL
          OR e.recorded_at IS NULL
          OR e.operator_name IS NULL OR e.operator_name = ''
          OR e.work_operator_name IS NULL OR e.work_operator_name = ''
          OR e.source_table IS NULL OR e.source_table = ''
          OR e.source_record_id IS NULL OR e.source_record_id = ''
    `
  },
  {
    table: 'veterinary_events',
    sql: `
      UPDATE veterinary_events e
      LEFT JOIN animal a
        ON CONVERT(a.animal_number USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(e.cow_number USING utf8mb4) COLLATE utf8mb4_unicode_ci
         SET e.animal_id = COALESCE(NULLIF(e.animal_id, ''), a.id),
             e.animal_number = COALESCE(NULLIF(e.animal_number, ''), a.animal_number, e.cow_number),
             e.occurred_at = COALESCE(e.occurred_at, e.event_time, e.event_date, e.created_at),
             e.recorded_at = COALESCE(e.recorded_at, e.event_time, e.event_date, e.created_at),
             e.operator_name = COALESCE(NULLIF(e.operator_name, ''), 'system'),
             e.work_operator_name = COALESCE(NULLIF(e.work_operator_name, ''), NULLIF(e.person, ''), NULLIF(e.operator_name, '')),
             e.source_table = COALESCE(NULLIF(e.source_table, ''), 'veterinary_events'),
             e.source_record_id = COALESCE(NULLIF(e.source_record_id, ''), e.id)
       WHERE e.animal_id IS NULL OR e.animal_id = ''
          OR e.animal_number IS NULL OR e.animal_number = ''
          OR e.occurred_at IS NULL
          OR e.recorded_at IS NULL
          OR e.operator_name IS NULL OR e.operator_name = ''
          OR e.work_operator_name IS NULL OR e.work_operator_name = ''
          OR e.source_table IS NULL OR e.source_table = ''
          OR e.source_record_id IS NULL OR e.source_record_id = ''
    `
  },
  {
    table: 'cow_events',
    sql: `
      UPDATE cow_events ce
      LEFT JOIN animal_event ae
        ON CONVERT(ae.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(ce.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
      LEFT JOIN animal a
        ON CONVERT(a.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(ae.animal_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
         SET ce.animal_id = COALESCE(NULLIF(ce.animal_id, ''), ae.animal_id),
             ce.animal_number = COALESCE(NULLIF(ce.animal_number, ''), a.animal_number, JSON_UNQUOTE(JSON_EXTRACT(ce.payload, '$.cowNumber')), JSON_UNQUOTE(JSON_EXTRACT(ce.payload, '$.cow_number'))),
             ce.event_type = COALESCE(NULLIF(ce.event_type, ''), ae.event_type, JSON_UNQUOTE(JSON_EXTRACT(ce.payload, '$.eventType')), JSON_UNQUOTE(JSON_EXTRACT(ce.payload, '$.event_type'))),
             ce.event_code = COALESCE(NULLIF(ce.event_code, ''), ae.event_code, ce.event_type),
             ce.occurred_at = COALESCE(ce.occurred_at, ae.occurred_at, ce.created_at),
             ce.recorded_at = COALESCE(ce.recorded_at, ae.recorded_at, ae.occurred_at, ce.created_at),
             ce.operator_name = COALESCE(NULLIF(ce.operator_name, ''), NULLIF(ae.operator_name, ''), JSON_UNQUOTE(JSON_EXTRACT(ce.payload, '$.operatorName')), JSON_UNQUOTE(JSON_EXTRACT(ce.payload, '$.operator_name')), 'system'),
             ce.work_operator_name = COALESCE(NULLIF(ce.work_operator_name, ''), NULLIF(ae.work_operator_name, ''), NULLIF(ce.operator_name, '')),
             ce.source_table = COALESCE(NULLIF(ce.source_table, ''), 'animal_event'),
             ce.source_record_id = COALESCE(NULLIF(ce.source_record_id, ''), ae.id, ce.id)
       WHERE ce.animal_id IS NULL OR ce.animal_id = ''
          OR ce.animal_number IS NULL OR ce.animal_number = ''
          OR ce.event_type IS NULL OR ce.event_type = ''
          OR ce.occurred_at IS NULL
          OR ce.recorded_at IS NULL
          OR ce.operator_name IS NULL OR ce.operator_name = ''
          OR ce.work_operator_name IS NULL OR ce.work_operator_name = ''
          OR ce.source_table IS NULL OR ce.source_table = ''
          OR ce.source_record_id IS NULL OR ce.source_record_id = ''
    `
  },
  {
    table: 'animal_event',
    sql: `
      UPDATE animal_event
         SET source_table = COALESCE(NULLIF(source_table, ''), 'animal_event'),
             recorded_at = COALESCE(recorded_at, occurred_at, created_at),
             work_operator_name = COALESCE(NULLIF(work_operator_name, ''), NULLIF(operator_name, ''))
       WHERE source_table IS NULL
          OR source_table = ''
          OR recorded_at IS NULL
          OR work_operator_name IS NULL
          OR work_operator_name = ''
    `
  },
  {
    table: 'event_reproduction_detail',
    sql: `
      UPDATE event_reproduction_detail d
      LEFT JOIN animal_event e ON e.id = d.event_id
      LEFT JOIN animal a ON a.id = e.animal_id
         SET d.animal_id = COALESCE(NULLIF(d.animal_id, ''), e.animal_id),
             d.animal_number = COALESCE(NULLIF(d.animal_number, ''), a.animal_number, NULLIF(d.cow_number, ''), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cowNumber')), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cow_number'))),
             d.cow_number = COALESCE(NULLIF(d.cow_number, ''), a.animal_number, JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cowNumber')), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cow_number'))),
             d.event_type = COALESCE(NULLIF(d.event_type, ''), e.event_code, e.event_type, d.reproduction_action),
             d.occurred_at = COALESCE(d.occurred_at, e.occurred_at),
             d.operator_name = COALESCE(NULLIF(d.operator_name, ''), NULLIF(e.operator_name, '')),
             d.work_operator_name = COALESCE(NULLIF(d.work_operator_name, ''), NULLIF(d.technician, ''), NULLIF(e.work_operator_name, ''), NULLIF(e.operator_name, '')),
             d.source_table = COALESCE(NULLIF(d.source_table, ''), 'animal_event'),
             d.source_record_id = COALESCE(NULLIF(d.source_record_id, ''), d.event_id),
             d.recorded_at = COALESCE(d.recorded_at, e.recorded_at, e.occurred_at, d.created_at)
       WHERE d.animal_id IS NULL OR d.animal_id = ''
          OR d.animal_number IS NULL OR d.animal_number = ''
          OR d.cow_number IS NULL OR d.cow_number = ''
          OR d.event_type IS NULL OR d.event_type = ''
          OR d.occurred_at IS NULL
          OR d.operator_name IS NULL OR d.operator_name = ''
          OR d.source_table IS NULL OR d.source_table = ''
          OR d.source_record_id IS NULL OR d.source_record_id = ''
          OR d.work_operator_name IS NULL OR d.work_operator_name = ''
          OR d.recorded_at IS NULL
    `
  },
  {
    table: 'event_health_detail',
    sql: `
      UPDATE event_health_detail d
      LEFT JOIN animal_event e ON e.id = d.event_id
      LEFT JOIN animal a ON a.id = e.animal_id
         SET d.animal_id = COALESCE(NULLIF(d.animal_id, ''), e.animal_id),
             d.animal_number = COALESCE(NULLIF(d.animal_number, ''), a.animal_number, NULLIF(d.cow_number, ''), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cowNumber')), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cow_number'))),
             d.cow_number = COALESCE(NULLIF(d.cow_number, ''), a.animal_number, JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cowNumber')), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cow_number'))),
             d.event_type = COALESCE(NULLIF(d.event_type, ''), e.event_code, e.event_type),
             d.occurred_at = COALESCE(d.occurred_at, e.occurred_at),
             d.operator_name = COALESCE(NULLIF(d.operator_name, ''), NULLIF(e.operator_name, '')),
             d.work_operator_name = COALESCE(NULLIF(d.work_operator_name, ''), NULLIF(d.veterinarian, ''), NULLIF(e.work_operator_name, ''), NULLIF(e.operator_name, '')),
             d.source_table = COALESCE(NULLIF(d.source_table, ''), 'animal_event'),
             d.source_record_id = COALESCE(NULLIF(d.source_record_id, ''), d.event_id),
             d.recorded_at = COALESCE(d.recorded_at, e.recorded_at, e.occurred_at, d.created_at)
       WHERE d.animal_id IS NULL OR d.animal_id = ''
          OR d.animal_number IS NULL OR d.animal_number = ''
          OR d.cow_number IS NULL OR d.cow_number = ''
          OR d.event_type IS NULL OR d.event_type = ''
          OR d.occurred_at IS NULL
          OR d.operator_name IS NULL OR d.operator_name = ''
          OR d.source_table IS NULL OR d.source_table = ''
          OR d.source_record_id IS NULL OR d.source_record_id = ''
          OR d.work_operator_name IS NULL OR d.work_operator_name = ''
          OR d.recorded_at IS NULL
    `
  },
  {
    table: 'event_production_detail',
    sql: `
      UPDATE event_production_detail d
      LEFT JOIN animal_event e ON e.id = d.event_id
      LEFT JOIN animal a ON a.id = e.animal_id
         SET d.animal_id = COALESCE(NULLIF(d.animal_id, ''), e.animal_id),
             d.animal_number = COALESCE(NULLIF(d.animal_number, ''), a.animal_number, NULLIF(d.cow_number, ''), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cowNumber')), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cow_number'))),
             d.cow_number = COALESCE(NULLIF(d.cow_number, ''), a.animal_number, JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cowNumber')), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cow_number'))),
             d.event_type = COALESCE(NULLIF(d.event_type, ''), e.event_code, e.event_type, d.operation_type),
             d.occurred_at = COALESCE(d.occurred_at, e.occurred_at),
             d.operator_name = COALESCE(NULLIF(d.operator_name, ''), NULLIF(e.operator_name, '')),
             d.work_operator_name = COALESCE(NULLIF(d.work_operator_name, ''), NULLIF(e.work_operator_name, ''), NULLIF(e.operator_name, '')),
             d.source_table = COALESCE(NULLIF(d.source_table, ''), 'animal_event'),
             d.source_record_id = COALESCE(NULLIF(d.source_record_id, ''), d.event_id),
             d.recorded_at = COALESCE(d.recorded_at, e.recorded_at, e.occurred_at, d.created_at)
       WHERE d.animal_id IS NULL OR d.animal_id = ''
          OR d.animal_number IS NULL OR d.animal_number = ''
          OR d.cow_number IS NULL OR d.cow_number = ''
          OR d.event_type IS NULL OR d.event_type = ''
          OR d.occurred_at IS NULL
          OR d.operator_name IS NULL OR d.operator_name = ''
          OR d.source_table IS NULL OR d.source_table = ''
          OR d.source_record_id IS NULL OR d.source_record_id = ''
          OR d.work_operator_name IS NULL OR d.work_operator_name = ''
          OR d.recorded_at IS NULL
    `
  },
  {
    table: 'event_medicine_detail',
    sql: `
      UPDATE event_medicine_detail d
      LEFT JOIN animal_event e ON e.id = d.event_id
      LEFT JOIN animal a ON a.id = e.animal_id
         SET d.animal_id = COALESCE(NULLIF(d.animal_id, ''), e.animal_id),
             d.animal_number = COALESCE(NULLIF(d.animal_number, ''), a.animal_number, NULLIF(d.cow_number, ''), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cowNumber')), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cow_number'))),
             d.cow_number = COALESCE(NULLIF(d.cow_number, ''), a.animal_number, JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cowNumber')), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cow_number'))),
             d.event_type = COALESCE(NULLIF(d.event_type, ''), e.event_code, e.event_type, 'medicine'),
             d.occurred_at = COALESCE(d.occurred_at, e.occurred_at),
             d.operator_name = COALESCE(NULLIF(d.operator_name, ''), NULLIF(e.operator_name, '')),
             d.work_operator_name = COALESCE(NULLIF(d.work_operator_name, ''), NULLIF(e.work_operator_name, ''), NULLIF(e.operator_name, '')),
             d.source_table = COALESCE(NULLIF(d.source_table, ''), 'animal_event'),
             d.source_record_id = COALESCE(NULLIF(d.source_record_id, ''), d.event_id),
             d.recorded_at = COALESCE(d.recorded_at, e.recorded_at, e.occurred_at, d.created_at)
       WHERE d.animal_id IS NULL OR d.animal_id = ''
          OR d.animal_number IS NULL OR d.animal_number = ''
          OR d.cow_number IS NULL OR d.cow_number = ''
          OR d.event_type IS NULL OR d.event_type = ''
          OR d.occurred_at IS NULL
          OR d.operator_name IS NULL OR d.operator_name = ''
          OR d.source_table IS NULL OR d.source_table = ''
          OR d.source_record_id IS NULL OR d.source_record_id = ''
          OR d.work_operator_name IS NULL OR d.work_operator_name = ''
          OR d.recorded_at IS NULL
    `
  },
  {
    table: 'event_movement_detail',
    sql: `
      UPDATE event_movement_detail d
      LEFT JOIN animal_event e ON e.id = d.event_id
      LEFT JOIN animal a ON a.id = e.animal_id
         SET d.animal_id = COALESCE(NULLIF(d.animal_id, ''), e.animal_id),
             d.animal_number = COALESCE(NULLIF(d.animal_number, ''), a.animal_number, NULLIF(d.cow_number, ''), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cowNumber')), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cow_number'))),
             d.cow_number = COALESCE(NULLIF(d.cow_number, ''), a.animal_number, JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cowNumber')), JSON_UNQUOTE(JSON_EXTRACT(e.custom_values, '$.cow_number'))),
             d.event_type = COALESCE(NULLIF(d.event_type, ''), e.event_code, e.event_type, 'movement'),
             d.occurred_at = COALESCE(d.occurred_at, e.occurred_at),
             d.operator_name = COALESCE(NULLIF(d.operator_name, ''), NULLIF(e.operator_name, '')),
             d.work_operator_name = COALESCE(NULLIF(d.work_operator_name, ''), NULLIF(e.work_operator_name, ''), NULLIF(e.operator_name, '')),
             d.source_table = COALESCE(NULLIF(d.source_table, ''), 'animal_event'),
             d.source_record_id = COALESCE(NULLIF(d.source_record_id, ''), d.event_id),
             d.recorded_at = COALESCE(d.recorded_at, e.recorded_at, e.occurred_at, d.created_at)
       WHERE d.animal_id IS NULL OR d.animal_id = ''
          OR d.animal_number IS NULL OR d.animal_number = ''
          OR d.cow_number IS NULL OR d.cow_number = ''
          OR d.event_type IS NULL OR d.event_type = ''
          OR d.occurred_at IS NULL
          OR d.operator_name IS NULL OR d.operator_name = ''
          OR d.source_table IS NULL OR d.source_table = ''
          OR d.source_record_id IS NULL OR d.source_record_id = ''
          OR d.work_operator_name IS NULL OR d.work_operator_name = ''
          OR d.recorded_at IS NULL
    `
  },
  {
    table: 'milking_session',
    sql: `
      UPDATE milking_session
         SET recorded_at = COALESCE(recorded_at, started_at, created_at),
             work_operator_name = COALESCE(NULLIF(work_operator_name, ''), NULLIF(operator_name, ''))
       WHERE recorded_at IS NULL OR work_operator_name IS NULL OR work_operator_name = ''
    `
  },
  {
    table: 'milking_visit',
    sql: `
      UPDATE milking_visit
         SET recorded_at = COALESCE(recorded_at, measured_at, started_at, entered_at, created_at),
             work_operator_name = COALESCE(NULLIF(work_operator_name, ''), NULLIF(operator_name, ''))
       WHERE recorded_at IS NULL OR work_operator_name IS NULL OR work_operator_name = ''
    `
  },
  {
    table: 'milk_measurement',
    sql: `
      UPDATE milk_measurement
         SET recorded_at = COALESCE(recorded_at, measured_at, created_at),
             work_operator_name = COALESCE(NULLIF(work_operator_name, ''), NULLIF(operator_name, ''))
       WHERE recorded_at IS NULL OR work_operator_name IS NULL OR work_operator_name = ''
    `
  },
  {
    table: 'milk_records',
    sql: `
      UPDATE milk_records r
      LEFT JOIN animal a
        ON CONVERT(a.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(r.cow_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
         SET r.animal_id = COALESCE(NULLIF(r.animal_id, ''), a.id, NULLIF(r.cow_id, '')),
             r.animal_number = COALESCE(NULLIF(r.animal_number, ''), a.animal_number),
             r.measured_at = COALESCE(r.measured_at, r.milking_time),
             r.recorded_at = COALESCE(r.recorded_at, r.milking_time, r.created_at),
             work_operator_name = COALESCE(NULLIF(work_operator_name, ''), NULLIF(operator_name, ''), NULLIF(milker_id, ''))
       WHERE r.animal_id IS NULL OR r.animal_id = ''
          OR r.animal_number IS NULL OR r.animal_number = ''
          OR r.measured_at IS NULL
          OR r.recorded_at IS NULL
          OR r.work_operator_name IS NULL OR r.work_operator_name = ''
    `
  },
  {
    table: 'trait_observation',
    sql: `
      UPDATE trait_observation
         SET source_table = COALESCE(NULLIF(source_table, ''), NULLIF(source_type, ''), 'trait_observation'),
             operator_name = COALESCE(NULLIF(operator_name, ''), 'system'),
             work_operator_name = COALESCE(NULLIF(work_operator_name, ''), NULLIF(collector, ''), NULLIF(operator_name, '')),
             recorded_at = COALESCE(recorded_at, observed_at, created_at)
       WHERE source_table IS NULL OR source_table = '' OR operator_name IS NULL OR operator_name = '' OR work_operator_name IS NULL OR work_operator_name = '' OR recorded_at IS NULL
    `
  },
  {
    table: 'phenotype_records',
    sql: `
      UPDATE phenotype_records p
      LEFT JOIN animal a
        ON CONVERT(a.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.cow_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        OR CONVERT(a.animal_number USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.cow_number USING utf8mb4) COLLATE utf8mb4_unicode_ci
      LEFT JOIN trait_definition td
        ON CONVERT(td.code USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.trait_code USING utf8mb4) COLLATE utf8mb4_unicode_ci
         SET p.animal_id = COALESCE(NULLIF(p.animal_id, ''), a.id, NULLIF(p.cow_id, '')),
             p.animal_number = COALESCE(NULLIF(p.animal_number, ''), a.animal_number, NULLIF(p.cow_number, '')),
             p.trait_id = COALESCE(NULLIF(p.trait_id, ''), td.id),
             p.observed_at = COALESCE(p.observed_at, p.collection_date),
             p.source_table = COALESCE(NULLIF(p.source_table, ''), NULLIF(p.source, ''), NULLIF(p.data_source, ''), 'phenotype_records'),
             p.source_record_id = COALESCE(NULLIF(p.source_record_id, ''), p.id),
             p.operator_name = COALESCE(NULLIF(p.operator_name, ''), 'system'),
             p.work_operator_name = COALESCE(NULLIF(p.work_operator_name, ''), NULLIF(p.collector, ''), NULLIF(p.operator_name, '')),
             p.recorded_at = COALESCE(p.recorded_at, p.collection_date, p.created_at)
       WHERE p.animal_id IS NULL OR p.animal_id = ''
          OR p.animal_number IS NULL OR p.animal_number = ''
          OR p.trait_id IS NULL OR p.trait_id = ''
          OR p.source_table IS NULL OR p.source_table = ''
          OR p.source_record_id IS NULL OR p.source_record_id = ''
          OR p.operator_name IS NULL OR p.operator_name = ''
          OR p.work_operator_name IS NULL OR p.work_operator_name = ''
          OR p.recorded_at IS NULL
          OR p.observed_at IS NULL
    `
  },
  {
    table: 'omics_samples',
    sql: `
      UPDATE omics_samples s
      LEFT JOIN animal a
        ON CONVERT(a.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(s.cow_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        OR CONVERT(a.animal_number USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(s.cow_number USING utf8mb4) COLLATE utf8mb4_unicode_ci
         SET s.animal_id = COALESCE(NULLIF(s.animal_id, ''), a.id, NULLIF(s.cow_id, '')),
             s.animal_number = COALESCE(NULLIF(s.animal_number, ''), a.animal_number, NULLIF(s.cow_number, '')),
             s.collected_at = COALESCE(s.collected_at, s.collection_date),
             s.source_table = COALESCE(NULLIF(s.source_table, ''), 'omics_samples'),
             s.source_record_id = COALESCE(NULLIF(s.source_record_id, ''), s.id),
             s.operator_name = COALESCE(NULLIF(s.operator_name, ''), 'system'),
             s.work_operator_name = COALESCE(NULLIF(s.work_operator_name, ''), NULLIF(s.collector, ''), NULLIF(s.operator_name, '')),
             s.recorded_at = COALESCE(s.recorded_at, s.collection_date, s.created_at)
      WHERE s.animal_id IS NULL OR s.animal_id = ''
          OR s.animal_number IS NULL OR s.animal_number = ''
          OR s.collected_at IS NULL
          OR s.source_table IS NULL OR s.source_table = ''
          OR s.source_record_id IS NULL OR s.source_record_id = ''
          OR s.operator_name IS NULL OR s.operator_name = ''
          OR s.work_operator_name IS NULL OR s.work_operator_name = ''
          OR s.recorded_at IS NULL
    `
  },
  {
    table: 'sensor_reading',
    sql: `
      UPDATE sensor_reading s
      LEFT JOIN animal a
        ON CONVERT(a.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(s.animal_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        OR CONVERT(a.animal_number USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(s.cow_number USING utf8mb4) COLLATE utf8mb4_unicode_ci
         SET s.animal_number = COALESCE(NULLIF(s.animal_number, ''), a.animal_number, NULLIF(s.cow_number, ''))
       WHERE s.animal_number IS NULL OR s.animal_number = ''
    `
  },
  {
    table: 'sensor_readings',
    sql: `
      UPDATE sensor_readings s
      LEFT JOIN animal a
        ON CONVERT(a.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(COALESCE(s.animal_id, s.cow_id) USING utf8mb4) COLLATE utf8mb4_unicode_ci
        OR CONVERT(a.animal_number USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(s.cow_number USING utf8mb4) COLLATE utf8mb4_unicode_ci
         SET s.animal_id = COALESCE(NULLIF(s.animal_id, ''), a.id, NULLIF(s.cow_id, '')),
             s.animal_number = COALESCE(NULLIF(s.animal_number, ''), a.animal_number, NULLIF(s.cow_number, ''))
       WHERE s.animal_id IS NULL OR s.animal_id = ''
          OR s.animal_number IS NULL OR s.animal_number = ''
    `
  },
  {
    table: 'operation_audit_logs',
    sql: `
      UPDATE operation_audit_logs
         SET operator_name = COALESCE(NULLIF(operator_name, ''), NULLIF(operator, ''))
       WHERE operator_name IS NULL OR operator_name = ''
    `
  }
]

function ident(value) {
  const normalized = String(value || '').trim()
  if (!/^[A-Za-z0-9_]+$/.test(normalized)) throw new Error(`Unsafe SQL identifier: ${value}`)
  return normalized
}

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ? LIMIT 1`,
    [dbConfig.database, table]
  )
  return rows.length > 0
}

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ? LIMIT 1`,
    [dbConfig.database, table, column]
  )
  return rows.length > 0
}

async function loadCollationFixes(connection) {
  const [rows] = await connection.query(
    `
      SELECT c.table_name,
             COUNT(*) AS mismatch_count,
             GROUP_CONCAT(c.column_name ORDER BY c.ordinal_position SEPARATOR ', ') AS columns
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema
         AND t.table_name = c.table_name
       WHERE c.table_schema = ?
         AND t.table_type = 'BASE TABLE'
         AND c.character_set_name IS NOT NULL
         AND (c.character_set_name <> ? OR c.collation_name <> ?)
       GROUP BY c.table_name
       ORDER BY c.table_name
    `,
    [dbConfig.database, TARGET_CHARSET, TARGET_COLLATION]
  )
  return rows.map((row) => ({
    table: row.table_name ?? row.TABLE_NAME,
    mismatchCount: Number(row.mismatch_count ?? row.MISMATCH_COUNT ?? 0),
    columns: String(row.columns ?? row.COLUMNS ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }))
}

async function countRows(connection, table) {
  const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${ident(table)}\``)
  return Number(rows[0]?.count || 0)
}

async function main() {
  fs.mkdirSync(reportDir, { recursive: true })
  const connection = await mysql.createConnection(dbConfig)
  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    database: { host: dbConfig.host, port: dbConfig.port, database: dbConfig.database },
    columns: [],
    collations: [],
    backfills: []
  }

  try {
    for (const [table, column, definition] of COLUMN_FIXES) {
      if (!(await tableExists(connection, table))) {
        report.columns.push({ table, column, action: 'skip_missing_table' })
        continue
      }
      if (await columnExists(connection, table, column)) {
        report.columns.push({ table, column, action: 'exists' })
        continue
      }
      const sql = `ALTER TABLE \`${ident(table)}\` ADD COLUMN \`${ident(column)}\` ${textDefinition(definition)}`
      if (apply) await connection.query(sql)
      report.columns.push({ table, column, action: apply ? 'added' : 'would_add', sql })
    }

    const collationFixes = await loadCollationFixes(connection)
    for (const item of collationFixes) {
      const sql = `ALTER TABLE \`${ident(item.table)}\` CONVERT TO CHARACTER SET ${TARGET_CHARSET} COLLATE ${TARGET_COLLATION}`
      if (apply) {
        try {
          await connection.query(sql)
          report.collations.push({ ...item, action: 'converted', sql })
        } catch (error) {
          report.collations.push({ ...item, action: 'failed', sql, error: error.message })
        }
      } else {
        report.collations.push({ ...item, action: 'would_convert', sql })
      }
    }

    for (const item of BACKFILLS) {
      if (!(await tableExists(connection, item.table))) {
        report.backfills.push({ table: item.table, action: 'skip_missing_table' })
        continue
      }
      const beforeCount = await countRows(connection, item.table)
      let changedRows = null
      if (apply) {
        const [result] = await connection.query(item.sql)
        changedRows = result.affectedRows ?? null
      }
      report.backfills.push({
        table: item.table,
        action: apply ? 'updated' : 'would_update',
        rowCount: beforeCount,
        affectedRows: changedRows,
        sql: item.sql.trim().replace(/\s+/g, ' ')
      })
    }
  } finally {
    await connection.end()
  }

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  const added = report.columns.filter((item) => item.action === 'added' || item.action === 'would_add').length
  const skipped = report.columns.filter((item) => item.action === 'skip_missing_table').length
  const exists = report.columns.filter((item) => item.action === 'exists').length
  const converted = report.collations.filter((item) => item.action === 'converted' || item.action === 'would_convert').length
  const failedCollations = report.collations.filter((item) => item.action === 'failed').length
  console.log(`schema reuse convergence fix ${report.mode}`)
  console.log(`columns add/would_add=${added} exists=${exists} skipped=${skipped}`)
  console.log(`collations convert/would_convert=${converted} failed=${failedCollations}`)
  console.log(`backfills=${report.backfills.length}`)
  console.log(`report=${path.relative(projectRoot, reportPath)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
