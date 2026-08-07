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
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management',
  charset: 'utf8mb4'
}

const TARGET_SCOPES = new Set(['milk:shifts', 'milk:shift-groups'])
const ENABLED_IDS = new Set(['milk-shift-1', 'milk-shift-2'])

const SHIFT_GROUP_CANONICAL = new Map([
  [
    'milk-shift-groups-category-two-shift',
    {
      code: 'two-shift',
      value: '两班制',
      name: '两班制',
      label: '两班制',
      description: '一天两个挤奶班次',
      status: '启用',
      isActive: true,
      sortOrder: 1
    }
  ],
  [
    'milk-shift-groups-category-three-shift',
    {
      code: 'three-shift',
      value: '三班制',
      name: '三班制',
      label: '三班制',
      description: '一天三个挤奶班次',
      status: '启用',
      isActive: true,
      sortOrder: 2
    }
  ],
  [
    'milk-shift-groups-category-four-shift',
    {
      code: 'four-shift',
      value: '四班制',
      name: '四班制',
      label: '四班制',
      description: '一天四个挤奶班次',
      status: '启用',
      isActive: true,
      sortOrder: 3
    }
  ],
  [
    'milk-shift-groups-category-custom',
    {
      code: 'custom',
      value: '自定义',
      name: '自定义',
      label: '自定义',
      description: '按场内实际名称维护',
      status: '启用',
      isActive: true,
      sortOrder: 4
    }
  ]
])

const SHIFT_CANONICAL = new Map([
  [
    'milk-shift-1',
    {
      code: '1',
      value: '1',
      name: '1',
      label: '1',
      category: '两班制',
      status: '启用',
      isActive: true,
      sortOrder: 1
    }
  ],
  [
    'milk-shift-2',
    {
      code: '2',
      value: '2',
      name: '2',
      label: '2',
      category: '两班制',
      status: '启用',
      isActive: true,
      sortOrder: 2
    }
  ],
  [
    'milk-shift-3',
    {
      code: '3',
      value: '3',
      name: '3',
      label: '3',
      category: '三班制',
      status: '停用',
      isActive: false,
      sortOrder: 3
    }
  ],
  [
    'milk-shift-4',
    {
      code: '4',
      value: '4',
      name: '4',
      label: '4',
      category: '四班制',
      status: '停用',
      isActive: false,
      sortOrder: 4
    }
  ]
])

const CHINESE_HINT = /[\u4e00-\u9fff]/
const MOJIBAKE_HINT = /[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßà-ÿ]/u

const text = (value) => String(value ?? '').trim()

function parsePayload(row) {
  if (!row?.payload) return {}
  if (typeof row.payload === 'object') return row.payload
  try {
    return JSON.parse(row.payload)
  } catch {
    return {}
  }
}

function maybeRepairMojibake(value) {
  const source = text(value)
  if (!source) return source
  if (CHINESE_HINT.test(source)) return source
  if (!MOJIBAKE_HINT.test(source)) return source
  try {
    const repaired = Buffer.from(source, 'latin1').toString('utf8').trim()
    return CHINESE_HINT.test(repaired) || /^(启用|停用|两班制|三班制|四班制|自定义)$/.test(repaired)
      ? repaired
      : source
  } catch {
    return source
  }
}

function inferShiftCategory(marker) {
  const value = text(marker)
  if (value === '1' || value === '2') return '两班制'
  if (value === '3') return '三班制'
  if (value === '4') return '四班制'
  return '自定义'
}

function payloadBase(scope, currentPayload) {
  return {
    ...(currentPayload || {}),
    scope,
    updatedAt: new Date().toISOString()
  }
}

function normalizeShiftGroupRow(row, payload) {
  const canonical = SHIFT_GROUP_CANONICAL.get(row.id)
  if (!canonical) return null
  const nextPayload = {
    ...payloadBase('milk:shift-groups', payload),
    code: canonical.code,
    value: canonical.value,
    name: canonical.name,
    label: canonical.label,
    description: canonical.description,
    level: 1,
    parentId: '',
    parentName: '',
    sortOrder: canonical.sortOrder,
    status: canonical.status,
    isActive: canonical.isActive
  }
  return {
    scope: 'milk:shift-groups',
    code: canonical.code,
    value: canonical.value,
    name: canonical.name,
    label: canonical.label,
    category: '',
    status: canonical.status,
    isActive: canonical.isActive,
    sortOrder: canonical.sortOrder,
    payload: nextPayload
  }
}

function normalizeShiftRow(row, payload) {
  const explicit = SHIFT_CANONICAL.get(row.id)
  const currentName = text(row.name || payload.name || row.label || payload.label || row.value || payload.value || row.code || payload.code)
  const currentCode = text(row.code || payload.code || currentName)
  const currentValue = text(row.value || payload.value || currentCode || currentName)
  const marker = text(explicit?.value || currentValue || currentCode || currentName)
  const category = explicit?.category || inferShiftCategory(marker)
  const enabled = explicit ? explicit.isActive : ENABLED_IDS.has(row.id)
  const status = enabled ? '启用' : '停用'
  const nextPayload = {
    ...payloadBase('milk:shifts', payload),
    code: explicit?.code || currentCode,
    value: explicit?.value || currentValue,
    name: explicit?.name || currentName,
    label: explicit?.label || currentName || currentValue || currentCode,
    category,
    sortOrder: explicit?.sortOrder ?? (Number(row.sort_order || payload.sortOrder || 0) || undefined),
    status,
    isActive: enabled
  }
  const sortOrder = Number(nextPayload.sortOrder || 0) || undefined
  if (sortOrder !== undefined) nextPayload.sortOrder = sortOrder
  return {
    scope: 'milk:shifts',
    code: nextPayload.code,
    value: nextPayload.value,
    name: nextPayload.name,
    label: nextPayload.label,
    category,
    status,
    isActive: enabled,
    sortOrder,
    payload: nextPayload
  }
}

function repairRow(row) {
  const payload = parsePayload(row)
  const scope = text(row.scope || payload.scope)
  if (!TARGET_SCOPES.has(scope)) return null

  const repairedPayload = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      typeof value === 'string' ? maybeRepairMojibake(value) : value
    ])
  )

  if (scope === 'milk:shift-groups') {
    return normalizeShiftGroupRow(row, repairedPayload)
  }
  return normalizeShiftRow(
    {
      ...row,
      code: maybeRepairMojibake(row.code),
      value: maybeRepairMojibake(row.value),
      name: maybeRepairMojibake(row.name),
      label: maybeRepairMojibake(row.label),
      category: maybeRepairMojibake(row.category),
      status: maybeRepairMojibake(row.status)
    },
    repairedPayload
  )
}

function buildComparable(row, repaired) {
  return JSON.stringify({
    scope: text(row.scope),
    code: text(row.code),
    value: text(row.value),
    name: text(row.name),
    label: text(row.label),
    category: text(row.category),
    status: text(row.status),
    isActive: Number(row.is_active ?? 0),
    sortOrder: Number(row.sort_order || 0),
    payload: repaired ? repaired.payload : parsePayload(row)
  })
}

async function main() {
  const connection = await mysql.createConnection(dbConfig)
  try {
    await connection.query('SET NAMES utf8mb4')
    const [rows] = await connection.query(
      `
        SELECT id, scope, code, value, name, label, category, status, is_active, sort_order, payload
        FROM base_info_categories
        WHERE scope IN ('milk:shifts', 'milk:shift-groups')
        ORDER BY scope, sort_order, id
      `
    )

    const updates = rows
      .map((row) => ({ row, repaired: repairRow(row) }))
      .filter((item) => item.repaired)
      .filter((item) => buildComparable(item.row) !== buildComparable({
        ...item.row,
        scope: item.repaired.scope,
        code: item.repaired.code,
        value: item.repaired.value,
        name: item.repaired.name,
        label: item.repaired.label,
        category: item.repaired.category,
        status: item.repaired.status,
        is_active: item.repaired.isActive ? 1 : 0,
        sort_order: item.repaired.sortOrder,
        payload: item.repaired.payload
      }, item.repaired))

    if (apply && updates.length) {
      await connection.beginTransaction()
      for (const { row, repaired } of updates) {
        await connection.query(
          `
            UPDATE base_info_categories
            SET scope = ?,
                code = ?,
                value = ?,
                name = ?,
                label = ?,
                category = ?,
                status = ?,
                is_active = ?,
                sort_order = ?,
                payload = CAST(? AS JSON),
                updated_at = NOW()
            WHERE id = ?
          `,
          [
            repaired.scope,
            repaired.code || null,
            repaired.value || null,
            repaired.name || null,
            repaired.label || null,
            repaired.category || null,
            repaired.status || null,
            repaired.isActive ? 1 : 0,
            repaired.sortOrder ?? null,
            JSON.stringify(repaired.payload),
            row.id
          ]
        )
      }
      await connection.commit()
    }

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          scanned: rows.length,
          updates: updates.length,
          sample: updates.slice(0, 12).map(({ row, repaired }) => ({
            id: row.id,
            scope: repaired.scope,
            before: {
              name: text(row.name),
              category: text(row.category),
              status: text(row.status)
            },
            after: {
              name: repaired.name,
              category: repaired.category,
              status: repaired.status
            }
          }))
        },
        null,
        2
      )
    )
  } catch (error) {
    try {
      await connection.rollback()
    } catch {
      // ignore rollback failure
    }
    throw error
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
