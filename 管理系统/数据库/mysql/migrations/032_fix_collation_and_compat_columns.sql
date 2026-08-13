-- Minimal production DB convergence migration for NZH-control.
-- This migration is intentionally idempotent and non-destructive.
-- Scope:
--   1. Ensure schema_version_metadata exists for deployment consistency checks.
--   2. Normalize compatibility join-column collations through table conversion.
--   3. Add the sensor_readings.cow_id compatibility column if it is missing.
--
-- No business data is updated, deleted, truncated, or dropped.

CREATE TABLE IF NOT EXISTS schema_version_metadata (
  version VARCHAR(128) NOT NULL,
  migration_name VARCHAR(255) NOT NULL,
  sha256 CHAR(64) NULL,
  hash_algorithm VARCHAR(64) NOT NULL DEFAULT 'sha256',
  applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  source VARCHAR(64) NOT NULL DEFAULT 'manual-migration',
  notes VARCHAR(512) NULL,
  PRIMARY KEY (version),
  UNIQUE KEY uk_schema_version_metadata_migration_name (migration_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE cows CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE milk_records CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @sensor_readings_cow_id_missing := (
  SELECT COUNT(*) = 0
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'sensor_readings'
    AND column_name = 'cow_id'
);

SET @sensor_readings_cow_id_ddl := IF(
  @sensor_readings_cow_id_missing,
  'ALTER TABLE `sensor_readings` ADD COLUMN `cow_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL',
  'SELECT ''sensor_readings.cow_id already exists'' AS migration_skip'
);

PREPARE sensor_readings_cow_id_stmt FROM @sensor_readings_cow_id_ddl;
EXECUTE sensor_readings_cow_id_stmt;
DEALLOCATE PREPARE sensor_readings_cow_id_stmt;

INSERT IGNORE INTO schema_version_metadata (
  version,
  migration_name,
  sha256,
  hash_algorithm,
  source,
  notes
) VALUES (
  '032_fix_collation_and_compat_columns',
  '032_fix_collation_and_compat_columns.sql',
  NULL,
  'sha256',
  'manual-migration',
  'Normalized compatibility collations and added nullable sensor_readings.cow_id without business data backfill.'
);
