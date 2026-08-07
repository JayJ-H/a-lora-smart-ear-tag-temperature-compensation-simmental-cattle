import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
dotenv.config({ path: path.join(projectRoot, '运维/生产配置/.env.prod'), override: true, quiet: true })

const apply = process.argv.includes('--apply')

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

const text = (value) => String(value ?? '').trim()
const hash = (value) => createHash('sha1').update(String(value)).digest('hex').slice(0, 16)
const nowIso = () => new Date().toISOString()

const GROUPABLE_SCOPES = new Set([
  'information-entry-events',
  'phenotype-trait-definitions',
  'phenotype-export-methods',
  'logical-trait-rules',
  'transfer-reasons'
])

function parsePayload(row) {
  if (row?.payload && typeof row.payload === 'object') return row.payload
  try {
    return row?.payload ? JSON.parse(row.payload) : {}
  } catch {
    return {}
  }
}

function categoryName(payload) {
  return text(payload.name || payload.label || payload.value || payload.code)
}

function parentLabelFor(payload) {
  if (text(payload.parentId || payload.parent_id) || payload.isGroupParent === true) return ''
  const name = categoryName(payload)
  const scope = text(payload.scope)
  const candidates = [
    text(payload.parentName || payload.parent_name),
    text(payload.group),
    GROUPABLE_SCOPES.has(scope) ? text(payload.category) : ''
  ].filter(Boolean)
  const unique = Array.from(new Set(candidates.filter((item) => item !== name)))
  return unique.length === 1 ? unique[0] : ''
}

function parentIdFor(scope, label) {
  return `base-parent-${hash(`${scope}|${label}`)}`
}

function isReusableParent(row) {
  const payload = row.payload || {}
  return payload.isGroupParent === true || String(row.id || '').startsWith('base-parent-')
}

function parentPayload(scope, label) {
  return {
    code: label,
    name: label,
    label,
    level: 1,
    scope,
    value: label,
    status: '启用',
    isActive: true,
    parentId: '',
    parentName: '',
    sortOrder: 0,
    isGroupParent: true,
    updatedAt: nowIso()
  }
}

async function upsertParent(connection, row) {
  await connection.query(
    `INSERT INTO base_info_categories
       (id, payload, created_at, updated_at, scope, code, value, name, label, category, status, is_active, sort_order)
     VALUES (?, CAST(? AS JSON), NOW(), NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       payload = VALUES(payload),
       scope = VALUES(scope),
       code = VALUES(code),
       value = VALUES(value),
       name = VALUES(name),
       label = VALUES(label),
       category = VALUES(category),
       status = VALUES(status),
       is_active = VALUES(is_active),
       sort_order = VALUES(sort_order),
       updated_at = NOW()`,
    [
      row.id,
      JSON.stringify(row.payload),
      row.payload.scope || null,
      row.payload.code || null,
      row.payload.value || null,
      row.payload.name || null,
      row.payload.label || null,
      row.payload.category || null,
      row.payload.status || null,
      row.payload.isActive === false ? 0 : 1,
      Number(row.payload.sortOrder || 0) || 0
    ]
  )
}

async function updatePayload(connection, id, payload) {
  await connection.query(
    `UPDATE base_info_categories
     SET payload = CAST(? AS JSON),
         scope = ?,
         code = ?,
         value = ?,
         name = ?,
         label = ?,
         category = ?,
         status = ?,
         is_active = ?,
         sort_order = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [
      JSON.stringify(payload),
      payload.scope || null,
      payload.code || null,
      payload.value || null,
      payload.name || null,
      payload.label || null,
      payload.category || null,
      payload.status || null,
      payload.isActive === false ? 0 : 1,
      Number(payload.sortOrder || 0) || 0,
      id
    ]
  )
}

async function main() {
  const connection = await mysql.createConnection(dbConfig)
  try {
    await connection.query('SET NAMES utf8mb4')
    const [rows] = await connection.query(
      `SELECT id, payload FROM base_info_categories ORDER BY id`
    )
    const parsed = rows.map((row) => ({ ...row, payload: parsePayload(row) }))
    const existingByScopeName = new Map()
    parsed.forEach((row) => {
      const scope = text(row.payload.scope)
      const names = [
        categoryName(row.payload),
        text(row.payload.code),
        text(row.payload.value),
        text(row.payload.label)
      ].filter(Boolean)
      names.forEach((name) => {
        const key = `${scope}|${name}`
        if (!existingByScopeName.has(key)) existingByScopeName.set(key, [])
        existingByScopeName.get(key).push(row)
      })
    })

    const parentRowsById = new Map()
    const childUpdates = []
    const ambiguous = []

    parsed.forEach((row) => {
      const scope = text(row.payload.scope)
      const parentLabel = parentLabelFor(row.payload)
      if (!scope || !parentLabel) return
      const key = `${scope}|${parentLabel}`
      const existingParents = Array.from(
        new Map(
          (existingByScopeName.get(key) || [])
            .filter((item) => item.id !== row.id && isReusableParent(item))
            .map((item) => [item.id, item])
        ).values()
      )
      let parentId = ''
      let parentName = parentLabel
      if (existingParents.length === 1) {
        parentId = existingParents[0].id
        parentName = categoryName(existingParents[0].payload) || parentLabel
      } else if (existingParents.length > 1) {
        ambiguous.push({
          id: row.id,
          scope,
          parentLabel,
          candidates: existingParents.map((item) => item.id)
        })
        return
      } else {
        parentId = parentIdFor(scope, parentLabel)
        if (!parentRowsById.has(parentId)) {
          parentRowsById.set(parentId, { id: parentId, payload: parentPayload(scope, parentLabel) })
        }
      }
      childUpdates.push({
        id: row.id,
        beforeParentId: text(row.payload.parentId || row.payload.parent_id),
        afterParentId: parentId,
        afterParentName: parentName,
        payload: {
          ...row.payload,
          level: 2,
          parentId,
          parentName,
          updatedAt: nowIso()
        }
      })
    })

    if (apply) {
      await connection.beginTransaction()
      for (const parent of parentRowsById.values()) await upsertParent(connection, parent)
      for (const item of childUpdates) await updatePayload(connection, item.id, item.payload)
      await connection.commit()
    }

    const [[afterRow]] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM base_info_categories
       WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.parentId')), '') IS NOT NULL`
    )

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      categoryRows: rows.length,
      parentRowsToCreate: parentRowsById.size,
      childRowsToUpdate: childUpdates.length,
      ambiguousRows: ambiguous.length,
      parentLinksAfter: Number(afterRow.count || 0),
      samples: {
        parents: Array.from(parentRowsById.values()).slice(0, 8),
        children: childUpdates.slice(0, 8).map((item) => ({
          id: item.id,
          beforeParentId: item.beforeParentId,
          afterParentId: item.afterParentId,
          afterParentName: item.afterParentName
        })),
        ambiguous: ambiguous.slice(0, 8)
      }
    }, null, 2))
  } catch (error) {
    try {
      await connection.rollback()
    } catch {
      // ignore
    }
    throw error
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
