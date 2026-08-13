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

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
const finding = (severity, code, message, evidence = '') => ({ severity, code, message, evidence })

async function tableCount(connection, table) {
  const [existsRows] = await connection.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
    [dbConfig.database, table]
  )
  if (!Number(existsRows?.[0]?.count || 0)) return null
  const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\``)
  return Number(rows?.[0]?.count || 0)
}

function auditSourceContracts() {
  const issues = []
  const databaseTs = read('src/services/database.ts')
  const backend = read('脚本/mysql-backend-server.mjs')
  const informationImport = read('src/views/data-import/information/index.vue')

  if (!databaseTs.includes("dbRpc<TablePageData<any>>(\n      'getTablePageData'")) {
    issues.push(
      finding(
        'high',
        'FRONTEND_NOT_USING_PAGE_RPC',
        '前端 getTableDataAsync 未使用 getTablePageData，默认读表仍可能截断。'
      )
    )
  }

  if (/dataCacheMeta\[tableName\]\s*=\s*getReadCacheMeta\(\)/.test(databaseTs)) {
    issues.push(
      finding(
        'high',
        'DEFAULT_READ_MARKED_AS_FULL_OR_UNKNOWN',
        'getTableData() 异步回调仍覆盖分页元数据，可能把默认 5000 行截断结果当成全量缓存。'
      )
    )
  }

  if (!/full:\s*!pageData\?\.hasMore/.test(databaseTs)) {
    issues.push(
      finding(
        'medium',
        'CACHE_META_HAS_MORE_NOT_USED',
        '前端缓存元数据未使用后端 hasMore 标记区分 partial/full。'
      )
    )
  }

  if (!/case 'getTablePageData'/.test(backend) || !/function getTablePageRows/.test(backend)) {
    issues.push(finding('high', 'BACKEND_PAGE_RPC_MISSING', '后端缺少 getTablePageData RPC 或分页实现。'))
  }

  if (!/COUNT\(1\) AS total/.test(backend) || !/hasMore:\s*offset \+ rows\.length < total/.test(backend)) {
    issues.push(
      finding('high', 'BACKEND_PAGE_TOTAL_MISSING', 'getTablePageData 未返回可验证 total/hasMore。')
    )
  }

  if (!/error\?\.status \|\| error\?\.statusCode/.test(backend)) {
    issues.push(
      finding('high', 'STATUS_CODE_IGNORED', '后端 apiFail/sendApiError 未识别 statusCode，update/delete miss 会退化成 500 或假成功。')
    )
  }

  if (!/case 'updateTableRecord'[\s\S]*statusCode\s*=\s*404/.test(backend)) {
    issues.push(finding('high', 'UPDATE_MISS_NOT_404', 'updateTableRecord 未对未命中记录返回 404。'))
  }

  if (!/case 'deleteTableRecord'[\s\S]*statusCode\s*=\s*404/.test(backend)) {
    issues.push(finding('high', 'DELETE_MISS_NOT_404', 'deleteTableRecord 未对未命中记录返回 404。'))
  }

  const queryFunction = backend.match(/async function queryRowsByDateRange[\s\S]*?\n}\n\nfunction normalizeUnifiedMilkRow/)
  if (!queryFunction || !/cowIds/.test(queryFunction[0]) || !/cowNumbers/.test(queryFunction[0]) || !/IN \(\$\{cowIds/.test(queryFunction[0])) {
    issues.push(
      finding(
        'high',
        'MILK_COW_FILTER_NOT_PUSHED_DOWN',
        'queryRowsByDateRange 未把 cowId/cowNumber 条件下推 SQL，单牛产奶仍可能被全场 LIMIT 截断。'
      )
    )
  }

  const getMilkRecords = backend.match(/if \(scope === 'milk' && method === 'getMilkRecords'\)[\s\S]*?\n  }\n/)
  if (getMilkRecords && /getUnifiedMilkRows\(\{[\s\S]*limit:\s*Math\.max\(page \* pageSize/.test(getMilkRecords[0]) && (!queryFunction || !/cowIds/.test(queryFunction[0]))) {
    issues.push(
      finding(
        'high',
        'GET_MILK_RECORDS_LIMIT_BEFORE_FILTER',
        '/api/cow/milk/getMilkRecords 仍可能先全场 LIMIT 再筛牛。'
      )
    )
  }

  if (/commitSingleMilkMeasurement|mergeSingleCommitResults|singleMilkMeasurementRow/.test(informationImport)) {
    issues.push(
      finding(
        'high',
        'SINGLE_MILK_EVENT_DOUBLE_WRITE',
        '信息录入采奶事件仍存在 UI 额外提交 milk-measurement 的代码，可能与 animal-event 派生重复。'
      )
    )
  }

  return issues
}

async function auditDatabaseCounts() {
  const issues = []
  let connection
  try {
    connection = await mysql.createConnection(dbConfig)
    const counts = {}
    for (const table of ['milk_measurement', 'milk_records', 'trait_observation', 'phenotype_records', 'animal_event', 'cow_events']) {
      counts[table] = await tableCount(connection, table)
    }
    const largeTables = Object.entries(counts)
      .filter(([, count]) => Number(count || 0) > 5000)
      .map(([table, count]) => `${table}:${count}`)
    if (largeTables.length) {
      issues.push(
        finding(
          'info',
          'HIGH_VOLUME_TABLES_REQUIRE_PAGE_RPC',
          '存在 5000+ 行核心表，页面/导出必须走分页或明确 full/partial 缓存。',
          largeTables.join(', ')
        )
      )
    }
  } catch (error) {
    issues.push(
      finding(
        'warning',
        'DB_CONNECT_SKIPPED',
        `数据库连接失败，已跳过行数审计：${error?.message || String(error)}`
      )
    )
  } finally {
    await connection?.end().catch(() => undefined)
  }
  return issues
}

const sourceIssues = auditSourceContracts()
const dbIssues = await auditDatabaseCounts()
const issues = [...sourceIssues, ...dbIssues]
const blocking = issues.filter((item) => ['high'].includes(item.severity))

console.log(
  JSON.stringify(
    {
      ok: blocking.length === 0,
      blockingCount: blocking.length,
      issues
    },
    null,
    2
  )
)

if (blocking.length) process.exitCode = 1
