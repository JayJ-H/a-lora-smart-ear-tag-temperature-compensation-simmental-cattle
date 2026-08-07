import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const DIST_HASH_ALGORITHM = 'sha256-dist-tree-v1'
const API_HASH_ALGORITHM = 'sha256-api-runtime-inputs-v1'
const DEFAULT_BASE_URL = 'http://127.0.0.1:19191'
const DIST_HASH_EXCLUDES = ['version.json', '*.gz']
const NON_SCHEMA_MIGRATION_PATTERNS = [
  /(?:^|[_-])dry[_-]?run(?:[_-]|\.|$)/i,
  /(?:^|[_-])diagnostic(?:s)?(?:[_-]|\.|$)/i,
  /(?:^|[_-])authorized(?:[_-]|\.|$)/i
]

function readEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) return {}
  return Object.fromEntries(
    fsSync
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        const key = line.slice(0, index).trim()
        let value = line.slice(index + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        return [key, value]
      })
  )
}

function loadEnv() {
  return {
    ...readEnvFile(path.join(projectRoot, '.env')),
    ...readEnvFile(path.join(projectRoot, '.env.production')),
    ...readEnvFile(path.join(projectRoot, 'ops', 'production', '.env.prod')),
    ...process.env
  }
}

function isSchemaMigrationFile(fileName) {
  return (
    fileName.endsWith('.sql') &&
    !NON_SCHEMA_MIGRATION_PATTERNS.some((pattern) => pattern.test(fileName))
  )
}

function parseArgs(argv, env) {
  const args = {
    baseUrl:
      env.DEPLOYMENT_BASE_URL ||
      env.PRODUCTION_BASE_URL ||
      `http://127.0.0.1:${env.WEB_HOST_PORT || env.WEB_PORT || 19191}`,
    distDir: path.join(projectRoot, 'dist'),
    timeoutMs: Number(env.QA_HTTP_TIMEOUT_MS || env.DEPLOYMENT_HTTP_TIMEOUT_MS || 5000),
    json: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') {
      args.json = true
    } else if (arg === '--base-url') {
      args.baseUrl = argv[index + 1] || args.baseUrl
      index += 1
    } else if (arg.startsWith('--base-url=')) {
      args.baseUrl = arg.slice('--base-url='.length)
    } else if (arg === '--dist') {
      args.distDir = path.resolve(argv[index + 1] || args.distDir)
      index += 1
    } else if (arg.startsWith('--dist=')) {
      args.distDir = path.resolve(arg.slice('--dist='.length))
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = Number(argv[index + 1] || args.timeoutMs)
      index += 1
    } else if (arg.startsWith('--timeout-ms=')) {
      args.timeoutMs = Number(arg.slice('--timeout-ms='.length))
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) args.timeoutMs = 5000
  args.baseUrl = String(args.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  return args
}

function makeCheck(id, status, message, details = {}) {
  return { id, status, message, details }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function listFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

async function hashDirectory(rootDir, excludedRelativePaths = new Set()) {
  const files = (await listFiles(rootDir))
    .map((filePath) => ({
      filePath,
      relativePath: path.relative(rootDir, filePath).split(path.sep).join('/')
    }))
    .filter(
      (item) => !excludedRelativePaths.has(item.relativePath) && !item.relativePath.endsWith('.gz')
    )
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  const treeHash = createHash('sha256')
  let bytes = 0

  for (const item of files) {
    const content = await fs.readFile(item.filePath)
    const fileStat = await fs.stat(item.filePath)
    const fileHash = sha256(content)
    bytes += fileStat.size
    treeHash.update(`${item.relativePath}\0${fileHash}\0${fileStat.size}\n`)
  }

  return {
    hash: treeHash.digest('hex'),
    hashAlgorithm: DIST_HASH_ALGORITHM,
    hashExcludes: DIST_HASH_EXCLUDES,
    files: files.length,
    bytes
  }
}

async function hashFile(filePath) {
  return sha256(await fs.readFile(filePath))
}

async function fetchBytes(baseUrl, pathname, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(new URL(pathname, baseUrl), {
      headers: {
        'cache-control': 'no-cache',
        pragma: 'no-cache'
      },
      signal: controller.signal
    })
    const buffer = Buffer.from(await response.arrayBuffer())
    const text = buffer.toString('utf8')
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // Non-JSON response.
    }
    return {
      ok: response.ok,
      httpStatus: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      buffer,
      text,
      json
    }
  } catch (error) {
    return {
      ok: false,
      httpStatus: 0,
      headers: {},
      buffer: Buffer.alloc(0),
      text: '',
      json: null,
      error: error?.message || String(error)
    }
  } finally {
    clearTimeout(timer)
  }
}

function unwrapApiPayload(payload) {
  if (payload && typeof payload === 'object' && 'code' in payload) return payload.data
  return payload
}

function extractBuildInfo(payload) {
  const data = unwrapApiPayload(payload)
  const candidates = [
    data?.deployment,
    data?.buildInfo,
    data?.serviceVersion,
    data,
    data?.build,
    data?.version
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    if (typeof candidate === 'string') return { version: candidate }
    if (typeof candidate !== 'object') continue
    const name = candidate.name || candidate.serviceName || candidate.appName
    const version = candidate.version || candidate.appVersion || candidate.buildVersion
    const hash = candidate.hash || candidate.distHash || candidate.apiHash || candidate.buildHash
    const ref = candidate.ref || candidate.buildRef || candidate.commit || candidate.commitSha
    const builtAt = candidate.builtAt || candidate.createdAt || candidate.build?.createdAt
    const hashAlgorithm = candidate.hashAlgorithm || candidate.algorithm
    if (name || version || hash || ref || builtAt || hashAlgorithm) {
      return { name, version, hash, ref, builtAt, hashAlgorithm, raw: candidate }
    }
  }

  return null
}

function extractAssetUrls(indexHtml) {
  const urls = new Set()
  const patterns = [
    /\bsrc=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi,
    /\bhref=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi
  ]
  for (const pattern of patterns) {
    for (const match of indexHtml.matchAll(pattern)) urls.add(match[1])
  }
  return [...urls]
}

function missingWebVersionFields(body) {
  const missing = []
  if (!body || typeof body !== 'object') return ['version', 'build', 'hash', 'hashAlgorithm']
  if (!String(body.version || '').trim()) missing.push('version')
  if (!body.build || typeof body.build !== 'object') missing.push('build')
  if (!String(body.hash || body.distHash || body.buildHash || '').trim()) missing.push('hash')
  if (!String(body.hashAlgorithm || '').trim()) missing.push('hashAlgorithm')
  return missing
}

function missingApiVersionFields(buildInfo) {
  const missing = []
  if (!buildInfo || typeof buildInfo !== 'object')
    return ['name', 'version', 'buildHash', 'builtAt', 'hashAlgorithm']
  if (!String(buildInfo.name || '').trim()) missing.push('name')
  if (!String(buildInfo.version || '').trim()) missing.push('version')
  if (!String(buildInfo.hash || '').trim()) missing.push('buildHash')
  if (!String(buildInfo.builtAt || '').trim()) missing.push('builtAt')
  if (!String(buildInfo.hashAlgorithm || '').trim()) missing.push('hashAlgorithm')
  return missing
}

async function getLocalDist(distDir) {
  if (!(await pathExists(distDir))) {
    return {
      metadata: null,
      check: makeCheck('local.distHash', 'FAIL', `local dist directory is missing: ${distDir}`)
    }
  }

  const indexPath = path.join(distDir, 'index.html')
  if (!(await pathExists(indexPath))) {
    return {
      metadata: null,
      check: makeCheck('local.distHash', 'FAIL', `local dist index.html is missing: ${indexPath}`)
    }
  }

  const metadata = await hashDirectory(distDir, new Set(['version.json']))
  return {
    metadata,
    check: makeCheck('local.distHash', 'PASS', 'local dist hash calculated', {
      distDir,
      hash: metadata.hash,
      hashAlgorithm: metadata.hashAlgorithm,
      hashExcludes: metadata.hashExcludes,
      files: metadata.files,
      bytes: metadata.bytes
    })
  }
}

async function getLocalSchema() {
  const migrationsDir = path.join(projectRoot, 'database/mysql/migrations')
  if (!(await pathExists(migrationsDir))) {
    return {
      latestMigration: null,
      check: makeCheck(
        'local.dbSchemaHash',
        'FAIL',
        `migration directory is missing: ${migrationsDir}`
      )
    }
  }

  const sqlFiles = (await fs.readdir(migrationsDir))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()
  const migrationFiles = sqlFiles.filter(isSchemaMigrationFile)
  const ignoredSqlFiles = sqlFiles.filter((fileName) => !isSchemaMigrationFile(fileName))
  if (!migrationFiles.length) {
    return {
      latestMigration: null,
      check: makeCheck('local.dbSchemaHash', 'FAIL', 'no production schema migration files found', {
        ignoredSqlFiles
      })
    }
  }

  const latest = migrationFiles.at(-1)
  const filePath = path.join(migrationsDir, latest)
  const fileStat = await fs.stat(filePath)
  const latestMigration = {
    file: latest,
    sha256: await hashFile(filePath),
    bytes: fileStat.size
  }
  return {
    latestMigration,
    check: makeCheck('local.dbSchemaHash', 'PASS', 'local latest DB migration hash calculated', {
      ...latestMigration,
      ignoredSqlFiles
    })
  }
}

async function getRuntimeWebVersion(baseUrl, localDist, timeoutMs) {
  const response = await fetchBytes(baseUrl, '/version.json', timeoutMs)
  if (!response.ok) {
    return makeCheck('runtime.webVersion', 'FAIL', `cannot read ${baseUrl}/version.json`, {
      httpStatus: response.httpStatus,
      error: response.error || response.text.slice(0, 160)
    })
  }

  const body = response.json
  if (!body || typeof body !== 'object') {
    return makeCheck('runtime.webVersion', 'FAIL', '/version.json is reachable but is not JSON', {
      httpStatus: response.httpStatus,
      bodyHash: response.buffer.length ? sha256(response.buffer) : ''
    })
  }

  const runtimeHash = String(body.hash || body.distHash || body.buildHash || '')
  const missingFields = missingWebVersionFields(body)
  if (missingFields.length) {
    return makeCheck(
      'runtime.webVersion',
      'FAIL',
      '/version.json is reachable but lacks required build/version/hash fields',
      {
        keys: Object.keys(body),
        missingFields,
        version: body.version || null,
        hash: runtimeHash || null,
        hashAlgorithm: body.hashAlgorithm || null
      }
    )
  }

  const hashMatches = localDist?.hash ? runtimeHash === localDist.hash : null
  return makeCheck(
    'runtime.webVersion',
    'PASS',
    'runtime Web /version.json is valid JSON with build metadata',
    {
      version: body.version || null,
      runtimeHash,
      localHash: localDist?.hash || null,
      localHashMatches: hashMatches,
      hashAlgorithm: body.hashAlgorithm || null,
      hashExcludes: body.hashExcludes || []
    }
  )
}

async function getRuntimeServedBundleHash(baseUrl, timeoutMs) {
  const indexResponse = await fetchBytes(baseUrl, '/', timeoutMs)
  if (!indexResponse.ok) {
    return makeCheck('runtime.webServedBundleHash', 'FAIL', 'runtime Web index is unavailable', {
      httpStatus: indexResponse.httpStatus,
      error: indexResponse.error || indexResponse.text.slice(0, 160)
    })
  }

  const assetUrls = extractAssetUrls(indexResponse.text)
  const assetHashes = []
  for (const assetUrl of assetUrls) {
    const response = await fetchBytes(baseUrl, assetUrl, timeoutMs)
    if (!response.ok) {
      return makeCheck(
        'runtime.webServedBundleHash',
        'FAIL',
        'runtime Web asset referenced by index is unavailable',
        {
          assetUrl,
          httpStatus: response.httpStatus,
          error: response.error || response.text.slice(0, 160)
        }
      )
    }
    assetHashes.push([
      new URL(assetUrl, baseUrl).pathname,
      sha256(response.buffer),
      response.buffer.length
    ])
  }

  const runtimeBundleHash = sha256(
    Buffer.from(JSON.stringify(assetHashes.sort((a, b) => a[0].localeCompare(b[0]))))
  )
  return makeCheck(
    'runtime.webServedBundleHash',
    'PASS',
    'runtime served JS/CSS bundle hash calculated',
    {
      indexSha256: sha256(indexResponse.buffer),
      assetCount: assetHashes.length,
      runtimeBundleHash
    }
  )
}

async function getApiEndpointVersion(baseUrl, webVersion, timeoutMs) {
  const apiPath = '/api/version'
  const response = await fetchBytes(baseUrl, apiPath, timeoutMs)
  if (!response.ok) {
    return makeCheck('runtime.apiVersion', 'FAIL', `cannot read ${baseUrl}${apiPath}`, {
      apiPath,
      httpStatus: response.httpStatus,
      error: response.error || response.text.slice(0, 160)
    })
  }

  const buildInfo = extractBuildInfo(response.json)
  const missingFields = missingApiVersionFields(buildInfo)
  if (missingFields.length) {
    return makeCheck(
      'runtime.apiVersion',
      'FAIL',
      '/api/version is reachable but lacks required API build fields',
      {
        apiPath,
        httpStatus: response.httpStatus,
        keys: buildInfo?.raw ? Object.keys(buildInfo.raw) : [],
        missingFields
      }
    )
  }

  const expectedVersion = webVersion || ''
  const versionMatches = !expectedVersion || String(buildInfo.version) === String(expectedVersion)
  return makeCheck(
    'runtime.apiVersion',
    versionMatches ? 'PASS' : 'FAIL',
    versionMatches
      ? 'API build info exposed by /api/version'
      : 'API version exposed by /api/version differs from Web version',
    {
      apiPath,
      apiName: buildInfo.name || null,
      apiVersion: buildInfo.version || null,
      apiHash: buildInfo.hash || null,
      apiRef: buildInfo.ref || null,
      apiBuiltAt: buildInfo.builtAt || null,
      apiHashAlgorithm: buildInfo.hashAlgorithm || null,
      webVersion: webVersion || null
    }
  )
}

async function getApiImageMetadata(containerName = 'benniu-api') {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'exec',
        containerName,
        'sh',
        '-c',
        'if [ -n "$APP_BUILD_INFO_FILE" ] && [ -f "$APP_BUILD_INFO_FILE" ]; then cat "$APP_BUILD_INFO_FILE"; elif [ -f /app/build-info.json ]; then cat /app/build-info.json; else exit 64; fi'
      ],
      { timeout: 5000, maxBuffer: 1024 * 1024 }
    )
    const metadata = JSON.parse(stdout)
    return makeCheck(
      'runtime.apiImageMetadata',
      'PASS',
      'API container build-info.json is readable',
      {
        version: metadata.version || null,
        hash: metadata.hash || null,
        hashAlgorithm: metadata.hashAlgorithm || API_HASH_ALGORITHM,
        ref: metadata.build?.ref || null
      }
    )
  } catch (error) {
    if (error.code === 'ENOENT') {
      return makeCheck(
        'runtime.apiImageMetadata',
        'SKIP',
        'docker CLI is not available; API image metadata cannot be read'
      )
    }
    return makeCheck(
      'runtime.apiImageMetadata',
      'SKIP',
      `API container build-info.json is not readable: ${error.message || error}`
    )
  }
}

function pickColumn(columns, candidates) {
  const byLower = new Map(
    columns.map((column) => {
      const name = readRowField(column, 'column_name')
      return [String(name).toLowerCase(), name]
    })
  )
  return candidates.find((candidate) => byLower.has(candidate))
    ? byLower.get(candidates.find((candidate) => byLower.has(candidate)))
    : null
}

function readRowField(row, fieldName) {
  if (!row || typeof row !== 'object') return undefined
  if (fieldName in row) return row[fieldName]
  const requested = String(fieldName).toLowerCase()
  const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === requested)
  return key ? row[key] : undefined
}

function quoteIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, '``')}\``
}

async function getDbSchemaRuntime(env, localMigration) {
  let mysql
  try {
    const mysqlModule = await import('mysql2/promise')
    mysql = mysqlModule.default || mysqlModule
  } catch (error) {
    return makeCheck('runtime.dbSchemaVersion', 'SKIP', `mysql2 is not available: ${error.message}`)
  }

  const connectionConfig = {
    host: env.DEPLOYMENT_DB_HOST || '127.0.0.1',
    port: Number(env.DEPLOYMENT_DB_PORT || env.MYSQL_HOST_PORT || env.MYSQL_PORT || 9193),
    user: env.MYSQL_USER || 'cattle_user',
    password: env.MYSQL_PASSWORD || '',
    database: env.MYSQL_DATABASE || 'cattle_management',
    connectTimeout: 5000
  }

  if (!connectionConfig.password) {
    return makeCheck(
      'runtime.dbSchemaVersion',
      'SKIP',
      'MYSQL_PASSWORD is not configured; DB schema version cannot be read'
    )
  }

  let connection
  try {
    connection = await mysql.createConnection(connectionConfig)
    const [tables] = await connection.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN ('schema_version_metadata', 'schema_migrations', 'schema_version', 'migrations')
        ORDER BY FIELD(table_name, 'schema_version_metadata', 'schema_migrations', 'schema_version', 'migrations')
      `
    )

    if (!tables.length) {
      const [coreTables] = await connection.query(
        `
          SELECT COUNT(*) AS count
          FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name IN ('animal', 'animal_event', 'production_baseline_manifest', 'cows', 'milk_records')
        `
      )
      return makeCheck(
        'runtime.dbSchemaVersion',
        'SKIP',
        'no DB schema version table is present; runtime schema version cannot be compared',
        {
          database: connectionConfig.database,
          observedCoreTables: Number(readRowField(coreTables?.[0], 'count') || 0),
          localLatestMigration: localMigration?.file || null,
          localMigrationHash: localMigration?.sha256 || null
        }
      )
    }

    const tableName = readRowField(tables[0], 'table_name')
    const [columns] = await connection.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
      `,
      [tableName]
    )
    const versionColumn = pickColumn(columns, [
      'version',
      'migration',
      'migration_name',
      'name',
      'id'
    ])
    const hashColumn = pickColumn(columns, ['hash', 'checksum', 'sha256'])
    const orderColumn =
      pickColumn(columns, ['applied_at', 'created_at', 'updated_at', 'installed_at']) ||
      versionColumn

    if (!versionColumn) {
      return makeCheck(
        'runtime.dbSchemaVersion',
        'SKIP',
        `${tableName} exists but has no recognizable version column`,
        {
          tableName,
          columns: columns.map((column) => readRowField(column, 'column_name'))
        }
      )
    }

    const [rows] = await connection.query(
      `SELECT * FROM ${quoteIdentifier(tableName)} ORDER BY ${quoteIdentifier(orderColumn)} DESC LIMIT 1`
    )
    const latest = rows?.[0]
    if (!latest) {
      return makeCheck(
        'runtime.dbSchemaVersion',
        'FAIL',
        `${tableName} exists but contains no schema version rows`,
        { tableName }
      )
    }

    const runtimeVersion = String(readRowField(latest, versionColumn) || '')
    const runtimeHash = hashColumn ? String(readRowField(latest, hashColumn) || '') : ''
    const expectedVersionPrefix = String(localMigration?.file || '').replace(/\.sql$/, '')
    const versionMatches = expectedVersionPrefix
      ? runtimeVersion.includes(expectedVersionPrefix)
      : true
    const hashMatches =
      runtimeHash && localMigration?.sha256 ? runtimeHash === localMigration.sha256 : true
    return makeCheck(
      'runtime.dbSchemaVersion',
      versionMatches && hashMatches ? 'PASS' : 'FAIL',
      versionMatches && hashMatches
        ? 'runtime DB schema version matches local migration metadata'
        : 'runtime DB schema version differs from local migration metadata',
      {
        tableName,
        runtimeVersion,
        runtimeHash: runtimeHash || null,
        localLatestMigration: localMigration?.file || null,
        localMigrationHash: localMigration?.sha256 || null
      }
    )
  } catch (error) {
    return makeCheck(
      'runtime.dbSchemaVersion',
      'SKIP',
      `DB schema version cannot be read: ${error.message}`,
      {
        host: connectionConfig.host,
        port: connectionConfig.port,
        database: connectionConfig.database
      }
    )
  } finally {
    if (connection) await connection.end()
  }
}

export async function validateDeploymentConsistency(options = {}) {
  const env = loadEnv()
  const args = {
    baseUrl: String(
      options.baseUrl ||
        env.DEPLOYMENT_BASE_URL ||
        env.PRODUCTION_BASE_URL ||
        `http://127.0.0.1:${env.WEB_HOST_PORT || env.WEB_PORT || 19191}`
    ).replace(/\/+$/, ''),
    distDir: path.resolve(options.distDir || path.join(projectRoot, 'dist')),
    timeoutMs: Number(
      options.timeoutMs || env.QA_HTTP_TIMEOUT_MS || env.DEPLOYMENT_HTTP_TIMEOUT_MS || 5000
    )
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) args.timeoutMs = 5000

  const checks = []
  const localDist = await getLocalDist(args.distDir)
  checks.push(localDist.check)

  const localSchema = await getLocalSchema()
  checks.push(localSchema.check)

  const runtimeWeb = await getRuntimeWebVersion(args.baseUrl, localDist.metadata, args.timeoutMs)
  checks.push(runtimeWeb)
  checks.push(await getRuntimeServedBundleHash(args.baseUrl, args.timeoutMs))

  const webVersion = runtimeWeb.details?.version || null
  checks.push(await getApiEndpointVersion(args.baseUrl, webVersion, args.timeoutMs))
  checks.push(await getApiImageMetadata(env.API_CONTAINER_NAME || 'benniu-api'))
  checks.push(await getDbSchemaRuntime(env, localSchema.latestMigration))

  const summary = checks.reduce(
    (acc, item) => {
      acc[item.status.toLowerCase()] += 1
      return acc
    },
    { pass: 0, fail: 0, skip: 0 }
  )

  return {
    ok: summary.fail === 0,
    readonly: true,
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    distDir: args.distDir,
    hashRules: {
      web: DIST_HASH_ALGORITHM,
      webExcludes: DIST_HASH_EXCLUDES,
      api: API_HASH_ALGORITHM
    },
    summary,
    checks
  }
}

export function printDeploymentConsistencyReport(report) {
  console.log(`Deployment consistency validation @ ${report.baseUrl}`)
  for (const item of report.checks) {
    console.log(`[${item.status}] ${item.id}: ${item.message}`)
    if (item.details?.hash) console.log(`  hash: ${item.details.hash}`)
    if (item.details?.runtimeHash || item.details?.localHash) {
      console.log(`  runtimeHash: ${item.details.runtimeHash || 'n/a'}`)
      console.log(`  localHash: ${item.details.localHash || 'n/a'}`)
    }
    if (item.details?.runtimeBundleHash)
      console.log(`  runtimeBundleHash: ${item.details.runtimeBundleHash}`)
    if (item.details?.apiVersion || item.details?.apiHash) {
      console.log(`  apiVersion: ${item.details.apiVersion || 'n/a'}`)
      console.log(`  apiHash: ${item.details.apiHash || 'n/a'}`)
    }
    if (item.details?.localLatestMigration)
      console.log(`  localLatestMigration: ${item.details.localLatestMigration}`)
  }
  console.log(
    `Summary: PASS=${report.summary.pass} FAIL=${report.summary.fail} SKIP=${report.summary.skip}`
  )
}

async function main() {
  const env = loadEnv()
  const args = parseArgs(process.argv.slice(2), env)
  const report = await validateDeploymentConsistency(args)
  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printDeploymentConsistencyReport(report)
  }
  if (!report.ok) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2))
    process.exitCode = 1
  })
}
