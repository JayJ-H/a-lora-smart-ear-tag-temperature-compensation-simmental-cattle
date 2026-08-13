-- Relationship blocker repair dry-run diagnostics for NZH-control.
-- Non-schema diagnostic script: excluded from deployment schema_version_metadata checks.
-- Read-only by default: this file executes SELECT statements only.
-- Do not run generated INSERT/UPDATE text without backup and main-controller approval.
-- No DELETE/TRUNCATE/DROP statements are used.

SELECT
  '00_context' AS check_name,
  DATABASE() AS database_name,
  @@version AS mysql_version,
  @@collation_database AS database_collation;

SELECT
  '01_missing_seed_device_readiness_gateway' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END AS estimated_insert_rows,
  'hardware_devices' AS target_table,
  'seed-device-readiness-gateway' AS target_id
FROM hardware_devices
WHERE id = 'seed-device-readiness-gateway';

SELECT
  '02_missing_person_breeding_tech' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END AS estimated_insert_rows,
  'persons' AS target_table,
  'person-breeding-tech' AS target_id
FROM persons
WHERE id = 'person-breeding-tech';

SELECT
  '03_omics_marker_refs_resolve_via_dataset_samples' AS check_name,
  COUNT(DISTINCT m.id) AS resolved_marker_rows
FROM omics_markers m
JOIN omics_datasets d
  ON d.id = m.dataset_id
JOIN JSON_TABLE(d.sample_ids, '$[*]' COLUMNS(sample_id VARCHAR(128) PATH '$')) js
JOIN omics_samples s
  ON s.id = js.sample_id
JOIN cows c
  ON c.id = s.cow_id
WHERE m.id IN (
  'marker-dgat1-buf',
  'marker-prlr-buf',
  'omics-marker_WB-GENOMIC-2025_WB-SNP-001_WB-0001_e7d5aa768d'
);

SELECT
  '04_legacy_import_audit_rows_with_cow_tokens' AS check_name,
  COUNT(*) AS rows_reclassified_by_audit_parser
FROM operation_audit_logs
WHERE CAST(source_record_ids AS CHAR) LIKE '%unresolved:%'
  AND CAST(source_record_ids AS CHAR) REGEXP 'cow_id|cow_number|animal_number';

SELECT
  '05_cost_revenue_rows_with_json_cow_scope' AS check_name,
  COUNT(*) AS rows_reclassified_by_complex_trace
FROM (
  SELECT id FROM cost_items WHERE JSON_LENGTH(COALESCE(cow_ids, JSON_ARRAY())) > 0
  UNION ALL
  SELECT id FROM revenue_items WHERE JSON_LENGTH(COALESCE(cow_ids, JSON_ARRAY())) > 0
) scoped_rows;

SELECT
  '06_authorization_required' AS item_type,
  'Run scripts/repair-data-relationship-blockers.mjs --dry-run first; only run generated relationship-repair-authorized.sql after backup and main-controller approval.' AS instruction;
