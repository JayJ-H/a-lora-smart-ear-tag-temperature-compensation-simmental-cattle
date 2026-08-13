-- Model convergence dry-run checks for NZH-control.
-- This file is intentionally read-only by default.
-- It contains SELECT-based diagnostics and textual migration/view suggestions only.
-- Review DATA_DICTIONARY.md before using any suggested migration in a real change window.

SELECT
  '00_context' AS check_name,
  DATABASE() AS database_name,
  @@version AS mysql_version,
  @@character_set_database AS database_charset,
  @@collation_database AS database_collation;

-- 01. Confirm table presence for canonical and compatibility tracks.
SELECT
  '01_table_presence' AS check_name,
  expected.table_name,
  expected.role,
  CASE WHEN t.table_name IS NULL THEN 'missing' ELSE 'present' END AS status,
  t.table_rows AS estimated_rows,
  t.table_collation
FROM (
  SELECT 'animal' AS table_name, 'canonical animal master' AS role UNION ALL
  SELECT 'cows', 'compat readonly animal projection' UNION ALL
  SELECT 'milk_measurement', 'canonical milk fact' UNION ALL
  SELECT 'milk_records', 'compat milk projection' UNION ALL
  SELECT 'sensor_reading', 'canonical sensor fact' UNION ALL
  SELECT 'sensor_readings', 'compat sensor projection' UNION ALL
  SELECT 'operation_audit_log', 'canonical operation audit fact' UNION ALL
  SELECT 'operation_audit_logs', 'compat operation audit projection'
) expected
LEFT JOIN information_schema.tables t
  ON t.table_schema = DATABASE()
 AND t.table_name = expected.table_name
ORDER BY expected.table_name;

-- 02. Confirm required canonical and compatibility columns.
SELECT
  '02_column_presence' AS check_name,
  required.table_name,
  required.column_name,
  required.role,
  CASE WHEN c.column_name IS NULL THEN 'missing' ELSE 'present' END AS status,
  c.column_type,
  c.is_nullable,
  c.column_key,
  c.collation_name
FROM (
  SELECT 'animal' AS table_name, 'id' AS column_name, 'animal primary key' AS role UNION ALL
  SELECT 'animal', 'animal_number', 'animal business number' UNION ALL
  SELECT 'animal', 'sex', 'standard sex field' UNION ALL
  SELECT 'cows', 'id', 'compat animal primary key' UNION ALL
  SELECT 'cows', 'cow_number', 'compat animal number' UNION ALL
  SELECT 'cows', 'gender', 'compat sex field' UNION ALL
  SELECT 'milk_measurement', 'animal_id', 'canonical animal reference' UNION ALL
  SELECT 'milk_measurement', 'measured_at', 'canonical measurement time' UNION ALL
  SELECT 'milk_measurement', 'milk_yield', 'canonical milk amount' UNION ALL
  SELECT 'milk_records', 'cow_id', 'compat animal reference' UNION ALL
  SELECT 'milk_records', 'milking_time', 'compat measurement time' UNION ALL
  SELECT 'milk_records', 'volume', 'compat milk amount' UNION ALL
  SELECT 'sensor_reading', 'animal_id', 'canonical animal reference' UNION ALL
  SELECT 'sensor_reading', 'metric_code', 'canonical metric code' UNION ALL
  SELECT 'sensor_reading', 'measured_at', 'canonical reading time' UNION ALL
  SELECT 'sensor_readings', 'cow_id', 'compat animal reference' UNION ALL
  SELECT 'operation_audit_log', 'animal_id', 'canonical animal reference' UNION ALL
  SELECT 'operation_audit_log', 'operated_at', 'canonical operation time' UNION ALL
  SELECT 'operation_audit_logs', 'target_type', 'compat audit target type' UNION ALL
  SELECT 'operation_audit_logs', 'target_id', 'compat audit target id'
) required
LEFT JOIN information_schema.columns c
  ON c.table_schema = DATABASE()
 AND c.table_name = required.table_name
 AND c.column_name = required.column_name
ORDER BY required.table_name, required.column_name;

-- 03. Detect collation drift on join-related text columns.
SELECT
  '03_join_column_collation' AS check_name,
  c.table_name,
  c.column_name,
  c.column_type,
  c.collation_name,
  CASE
    WHEN c.collation_name IS NULL THEN 'not_text'
    WHEN c.collation_name = @@collation_database THEN 'matches_database'
    ELSE 'differs_from_database'
  END AS status
FROM information_schema.columns c
WHERE c.table_schema = DATABASE()
  AND c.table_name IN (
    'animal',
    'cows',
    'milk_measurement',
    'milk_records',
    'sensor_reading',
    'sensor_readings',
    'operation_audit_log',
    'operation_audit_logs'
  )
  AND c.column_name IN (
    'id',
    'animal_id',
    'cow_id',
    'animal_number',
    'cow_number',
    'target_type',
    'target_id',
    'metric_code',
    'device_id'
  )
ORDER BY c.table_name, c.column_name;

-- 04. Animal master duplicate and mapping checks.
-- Run these SELECTs only after section 01 confirms both tables exist.
SELECT
  '04_animal_duplicate_number' AS check_name,
  animal_number,
  COUNT(*) AS row_count
FROM animal
GROUP BY animal_number
HAVING COUNT(*) > 1;

SELECT
  '04_cows_duplicate_number' AS check_name,
  cow_number,
  COUNT(*) AS row_count
FROM cows
GROUP BY cow_number
HAVING COUNT(*) > 1;

SELECT
  '04_cows_without_animal_match' AS check_name,
  c.id AS cow_id,
  c.cow_number
FROM cows c
LEFT JOIN animal a
  ON a.id = c.id
  OR a.animal_number = c.cow_number
WHERE a.id IS NULL
ORDER BY c.cow_number
LIMIT 200;

SELECT
  '04_animal_cows_number_conflict_same_id' AS check_name,
  a.id,
  a.animal_number,
  c.cow_number
FROM animal a
JOIN cows c
  ON c.id = a.id
WHERE COALESCE(a.animal_number, '') <> COALESCE(c.cow_number, '')
ORDER BY a.id
LIMIT 200;

-- 05. Milk dual-track coverage checks.
-- Natural key candidate: animal/cow reference + measurement time + milk amount + source id.
SELECT
  '05_milk_records_without_animal' AS check_name,
  r.id,
  r.cow_id,
  r.milking_time,
  r.volume
FROM milk_records r
LEFT JOIN animal a
  ON a.id = r.cow_id
LEFT JOIN cows c
  ON c.id = r.cow_id
WHERE a.id IS NULL
  AND c.id IS NULL
ORDER BY r.milking_time
LIMIT 200;

SELECT
  '05_milk_measurement_without_animal' AS check_name,
  m.id,
  m.animal_id,
  m.measured_at,
  m.milk_yield
FROM milk_measurement m
LEFT JOIN animal a
  ON a.id = m.animal_id
WHERE a.id IS NULL
ORDER BY m.measured_at
LIMIT 200;

SELECT
  '05_milk_compat_not_covered_by_canonical' AS check_name,
  r.id AS milk_records_id,
  r.cow_id,
  r.milking_time,
  r.volume
FROM milk_records r
LEFT JOIN animal a
  ON a.id = r.cow_id
LEFT JOIN milk_measurement m
  ON m.animal_id = COALESCE(a.id, r.cow_id)
 AND m.measured_at = r.milking_time
 AND COALESCE(m.milk_yield, -1) = COALESCE(r.volume, -1)
WHERE m.id IS NULL
ORDER BY r.milking_time
LIMIT 200;

-- 06. Sensor dual-track coverage checks.
-- Natural key candidate: animal/cow reference + device + metric + measured time.
SELECT
  '06_sensor_reading_without_animal' AS check_name,
  s.id,
  s.animal_id,
  s.device_id,
  s.metric_code,
  s.measured_at
FROM sensor_reading s
LEFT JOIN animal a
  ON a.id = s.animal_id
WHERE s.animal_id IS NOT NULL
  AND a.id IS NULL
ORDER BY s.measured_at
LIMIT 200;

SELECT
  '06_sensor_compat_not_covered_by_canonical' AS check_name,
  sr.id AS sensor_readings_id,
  sr.cow_id,
  sr.device_id
FROM sensor_readings sr
LEFT JOIN animal a
  ON a.id = sr.cow_id
LEFT JOIN sensor_reading s
  ON s.animal_id = COALESCE(a.id, sr.cow_id)
 AND COALESCE(s.device_id, '') = COALESCE(sr.device_id, '')
WHERE s.id IS NULL
ORDER BY sr.id
LIMIT 200;

-- 07. Operation audit dual-track coverage checks.
SELECT
  '07_audit_log_without_animal' AS check_name,
  l.id,
  l.animal_id,
  l.target_type,
  l.target_id,
  l.operated_at
FROM operation_audit_log l
LEFT JOIN animal a
  ON a.id = l.animal_id
WHERE l.animal_id IS NOT NULL
  AND a.id IS NULL
ORDER BY l.operated_at
LIMIT 200;

SELECT
  '07_audit_compat_not_covered_by_canonical' AS check_name,
  logs.id AS operation_audit_logs_id,
  logs.action_type,
  logs.target_type,
  logs.target_id
FROM operation_audit_logs logs
LEFT JOIN operation_audit_log log1
  ON log1.id = logs.id
  OR (
    COALESCE(log1.action_type, '') = COALESCE(logs.action_type, '')
    AND COALESCE(log1.target_type, '') = COALESCE(logs.target_type, '')
    AND COALESCE(log1.target_id, '') = COALESCE(logs.target_id, '')
  )
WHERE log1.id IS NULL
ORDER BY logs.created_at
LIMIT 200;

-- 08. Suggested compatibility views and real migration steps.
-- These are returned as text for review; they are not executed by this file.
SELECT
  '08_suggested_view' AS item_type,
  'cows compatibility projection' AS item_name,
  'create or replace view cows_compat_v as select a.id, a.animal_number as cow_number, a.ear_tag_number, a.breed, a.sex as gender, a.birth_date, a.status, a.created_at, a.updated_at from animal a' AS suggested_sql;

SELECT
  '08_suggested_view' AS item_type,
  'milk_records compatibility projection' AS item_name,
  'create or replace view milk_records_compat_v as select m.id, m.animal_id as cow_id, m.measured_at as milking_time, m.milk_yield as volume, m.created_at from milk_measurement m' AS suggested_sql;

SELECT
  '08_suggested_view' AS item_type,
  'sensor_readings compatibility projection' AS item_name,
  'create or replace view sensor_readings_compat_v as select s.id, s.animal_id as cow_id, s.device_id, s.metric_code, s.reading_value, s.reading_text, s.unit, s.measured_at, s.raw_payload from sensor_reading s' AS suggested_sql;

SELECT
  '08_suggested_view' AS item_type,
  'operation_audit_logs compatibility projection' AS item_name,
  'create or replace view operation_audit_logs_compat_v as select l.id, l.action_type, l.target_type, l.target_id, l.animal_id as cow_id, l.operator_name, l.operated_at as created_at, l.request_payload, l.result_payload, l.status from operation_audit_log l' AS suggested_sql;

SELECT
  '09_authorization_required' AS item_type,
  'real migration gate' AS item_name,
  'after blockers are zero: take backup, freeze writes, run reviewed idempotent insert/select migration, switch reads to compatibility views, keep rollback scripts ready' AS suggested_step;
