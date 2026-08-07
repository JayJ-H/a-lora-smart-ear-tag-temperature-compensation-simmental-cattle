import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
dotenv.config({
  path: path.join(projectRoot, 'ops/production/.env.prod'),
  override: true,
  quiet: true
})

const mysqlConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(
    process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306
  ),
  user: process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'cattle_management',
  multipleStatements: false
}

const DEFAULT_MIGRATIONS = [
  'database/mysql/migrations/031_schema_version_metadata.sql',
  'database/mysql/migrations/032_fix_collation_and_compat_columns.sql',
  'database/mysql/migrations/033_restrict_cattle_breed_scope.sql'
]

const DENIED_SQL =
  /\b(?:DROP|TRUNCATE|DELETE|UPDATE|REPLACE|RENAME|GRANT|REVOKE|LOAD\s+DATA|CREATE\s+DATABASE|ALTER\s+DATABASE)\b/i

const ALLOWED_DYNAMIC_SQL = new Set([
  'ALTER TABLE `sensor_readings` ADD COLUMN `cow_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL',
  "SELECT 'sensor_readings.cow_id already exists' AS migration_skip"
])

function parseArgs(argv) {
  const migrations = []
  let dryRun = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--migration') {
      migrations.push(argv[index + 1])
      index += 1
    } else if (arg.startsWith('--migration=')) {
      migrations.push(arg.slice('--migration='.length))
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return {
    dryRun,
    migrations: (migrations.length ? migrations : DEFAULT_MIGRATIONS).map((item) =>
      path.resolve(projectRoot, item)
    )
  }
}

function stripComments(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
}

function splitStatements(sql) {
  const statements = []
  let current = ''
  let quote = null
  let escaped = false

  for (const char of sql) {
    current += char

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }

    if (char === ';') {
      const statement = current.slice(0, -1).trim()
      if (statement) statements.push(statement)
      current = ''
    }
  }

  const trailing = current.trim()
  if (trailing) statements.push(trailing)
  return statements
}

function extractSingleQuotedStrings(statement) {
  const values = []
  const re = /'((?:''|\\'|[^'])*)'/g
  for (const match of statement.matchAll(re)) {
    values.push(match[1].replace(/''/g, "'").replace(/\\'/g, "'"))
  }
  return values
}

function normalizeStatement(statement) {
  return statement.replace(/\s+/g, ' ').trim()
}

function isAllowedStatement(statement) {
  const normalized = normalizeStatement(statement)

  if (
    /^UPDATE animal SET species = '牛', breed = CASE .+ END WHERE species <> '牛' OR breed IS NULL OR TRIM\(breed\) NOT IN \('西门塔尔牛', '华西牛'\)$/i.test(
      normalized
    )
  ) {
    return true
  }
  if (
    /^UPDATE (?:cows|entry_events) SET breed = CASE .+ END WHERE breed IS NULL OR TRIM\(breed\) NOT IN \('西门塔尔牛', '华西牛'\)$/i.test(
      normalized
    )
  ) {
    return true
  }
  if (
    /^INSERT INTO breed_types \(id, name, category, origin, description, is_active, created_at, updated_at\) VALUES .+ ON DUPLICATE KEY UPDATE category = VALUES\(category\), origin = VALUES\(origin\), description = VALUES\(description\), is_active = 1, updated_at = NOW\(3\)$/i.test(
      normalized
    )
  ) {
    return true
  }
  if (/^DELETE FROM breed_types WHERE name NOT IN \('西门塔尔牛', '华西牛'\)$/i.test(normalized)) {
    return true
  }
  if (/^ALTER TABLE animal ALTER COLUMN species SET DEFAULT '牛'$/i.test(normalized)) return true

  if (DENIED_SQL.test(normalized)) return false

  if (/^CREATE TABLE IF NOT EXISTS `?schema_version_metadata`?\s*\(/i.test(normalized)) return true
  if (/^INSERT IGNORE INTO `?schema_version_metadata`?\s*\(/i.test(normalized)) return true
  if (
    /^ALTER TABLE `?(?:cows|milk_records)`? CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci$/i.test(
      normalized
    )
  ) {
    return true
  }
  if (/^SET @sensor_readings_cow_id_missing := \(/i.test(normalized)) return true
  if (/^SET @sensor_readings_cow_id_ddl := IF\(/i.test(normalized)) {
    return extractSingleQuotedStrings(statement)
      .filter((value) => /^(?:ALTER|SELECT)\b/i.test(value))
      .every((value) => ALLOWED_DYNAMIC_SQL.has(value))
  }
  if (/^PREPARE sensor_readings_cow_id_stmt FROM @sensor_readings_cow_id_ddl$/i.test(normalized))
    return true
  if (/^EXECUTE sensor_readings_cow_id_stmt$/i.test(normalized)) return true
  if (/^DEALLOCATE PREPARE sensor_readings_cow_id_stmt$/i.test(normalized)) return true

  return false
}

async function loadMigration(filePath) {
  const sql = await fs.readFile(filePath, 'utf8')
  const statements = splitStatements(stripComments(sql))
  if (!statements.length) throw new Error(`Migration has no SQL statements: ${filePath}`)

  const rejected = statements.filter((statement) => !isAllowedStatement(statement))
  if (rejected.length) {
    throw new Error(
      [
        `Migration contains statements outside the safe DB migration whitelist: ${path.relative(projectRoot, filePath)}`,
        ...rejected.map((statement) => `- ${normalizeStatement(statement).slice(0, 240)}`)
      ].join('\n')
    )
  }

  return statements
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const batches = []

  for (const migration of args.migrations) {
    const statements = await loadMigration(migration)
    batches.push({ migration, statements })
  }

  console.log(
    JSON.stringify(
      {
        dryRun: args.dryRun,
        database: {
          host: mysqlConfig.host,
          port: mysqlConfig.port,
          user: mysqlConfig.user,
          database: mysqlConfig.database
        },
        migrations: batches.map((batch) => ({
          file: path.relative(projectRoot, batch.migration).replace(/\\/g, '/'),
          statements: batch.statements.length
        }))
      },
      null,
      2
    )
  )

  if (args.dryRun) return

  const connection = await mysql.createConnection(mysqlConfig)
  try {
    for (const batch of batches) {
      console.log(`Applying ${path.relative(projectRoot, batch.migration).replace(/\\/g, '/')}`)
      for (const statement of batch.statements) {
        await connection.query(statement)
      }
    }
  } finally {
    await connection.end()
  }

  console.log('Safe DB migration completed.')
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2))
  process.exitCode = 1
})
