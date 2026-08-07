-- Schema version metadata table for read-only deployment consistency checks.
-- This migration is intentionally idempotent and non-destructive.
-- Do not auto-run it in production; apply only during an approved migration window.

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

INSERT IGNORE INTO schema_version_metadata (
  version,
  migration_name,
  sha256,
  hash_algorithm,
  source,
  notes
) VALUES (
  '031_schema_version_metadata',
  '031_schema_version_metadata.sql',
  NULL,
  'sha256',
  'manual-migration',
  'Metadata table bootstrap row; sha256 is optional and may be populated in a reviewed migration window.'
);
