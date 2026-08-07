-- Restrict active cattle data to the two breeds supported by release 1.0.1.
-- The migration is idempotent: aliases are normalized and all legacy values
-- deterministically converge to the default supported breed.

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

UPDATE animal
SET
  species = '牛',
  breed = CASE TRIM(COALESCE(breed, ''))
    WHEN '华西' THEN '华西牛'
    WHEN '华西牛' THEN '华西牛'
    WHEN '西门塔尔' THEN '西门塔尔牛'
    WHEN '西门塔尔牛' THEN '西门塔尔牛'
    ELSE '西门塔尔牛'
  END
WHERE species <> '牛'
   OR breed IS NULL
   OR TRIM(breed) NOT IN ('西门塔尔牛', '华西牛');

UPDATE cows
SET breed = CASE TRIM(COALESCE(breed, ''))
  WHEN '华西' THEN '华西牛'
  WHEN '华西牛' THEN '华西牛'
  WHEN '西门塔尔' THEN '西门塔尔牛'
  WHEN '西门塔尔牛' THEN '西门塔尔牛'
  ELSE '西门塔尔牛'
END
WHERE breed IS NULL OR TRIM(breed) NOT IN ('西门塔尔牛', '华西牛');

UPDATE entry_events
SET breed = CASE TRIM(COALESCE(breed, ''))
  WHEN '华西' THEN '华西牛'
  WHEN '华西牛' THEN '华西牛'
  WHEN '西门塔尔' THEN '西门塔尔牛'
  WHEN '西门塔尔牛' THEN '西门塔尔牛'
  ELSE '西门塔尔牛'
END
WHERE breed IS NULL OR TRIM(breed) NOT IN ('西门塔尔牛', '华西牛');

INSERT INTO breed_types
  (id, name, category, origin, description, is_active, created_at, updated_at)
VALUES
  ('breed-simmental', '西门塔尔牛', '牛', '瑞士', '犇牛智能健康预警系统支持品种。', 1, NOW(3), NOW(3)),
  ('breed-huaxi', '华西牛', '牛', '中国', '犇牛智能健康预警系统支持品种。', 1, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  category = VALUES(category),
  origin = VALUES(origin),
  description = VALUES(description),
  is_active = 1,
  updated_at = NOW(3);

DELETE FROM breed_types
WHERE name NOT IN ('西门塔尔牛', '华西牛');

ALTER TABLE animal ALTER COLUMN species SET DEFAULT '牛';

INSERT IGNORE INTO schema_version_metadata (
  version,
  migration_name,
  sha256,
  hash_algorithm,
  source,
  notes
) VALUES (
  '033_restrict_cattle_breed_scope',
  '033_restrict_cattle_breed_scope.sql',
  NULL,
  'sha256',
  'release-1.0.1',
  'Normalized cattle species and restricted active breed data to 西门塔尔牛 and 华西牛.'
);
