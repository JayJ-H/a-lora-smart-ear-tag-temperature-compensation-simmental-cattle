import * as databaseService from '@/services/database'

type AnyRow = Record<string, any>

export type TraitDirection = 'desc' | 'asc'

export interface DictionaryTraitOption {
  key: string
  label: string
  value: string
  unit: string
  direction: TraitDirection
  note: string
  categoryId: string
  categoryLevel1: string
  categoryLevel2: string
  categoryPath: string
  source: 'v2' | 'legacy' | 'system'
  traitType: string
}

export interface TraitOptionGroup<T extends DictionaryTraitOption = DictionaryTraitOption> {
  label: string
  options: T[]
}

interface LoadTraitOptionsInput {
  includeSystemBreedingTraits?: boolean
  includeDefaultProductionTraits?: boolean
}

export const defaultProductionTraitOptions: DictionaryTraitOption[] = [
  systemTrait('milk_yield', '单次产奶量', 'kg', '泌乳与奶质', '泌乳性能', '奶厅生产表型。'),
  systemTrait('milk_fat', '乳脂率', '%', '泌乳与奶质', '奶质性状', '牛奶质量性状。'),
  systemTrait(
    'milk_protein',
    '乳蛋白率',
    '%',
    '泌乳与奶质',
    '奶质性状',
    '乳品质和加工价值核心指标。'
  ),
  systemTrait('milk_lactose', '乳糖率', '%', '泌乳与奶质', '奶质性状', '乳糖质量性状。'),
  systemTrait(
    'somatic_cell_count',
    '体细胞数',
    'cells/mL',
    '泌乳与奶质',
    '健康质量',
    '乳房健康性状，越低越优。',
    'asc'
  ),
  systemTrait('body_weight', '体重', 'kg', '生长与体尺', '体重测定', '某一测定时间点的体重观测。')
]

export const systemBreedingTraitOptions: DictionaryTraitOption[] = [
  systemTrait(
    'score',
    '综合育种值',
    '分',
    '育种指数',
    '综合评分',
    '综合表型、系谱、组学和繁殖证据。'
  ),
  systemTrait('milkScore', '泌乳育种值', '分', '育种指数', '泌乳评分', '由产奶和奶质记录折算。'),
  systemTrait(
    'genomicScore',
    '组学育种值',
    '分',
    '育种指数',
    '组学评分',
    '来自组学样本和候选标记证据。'
  ),
  systemTrait(
    'pedigreeScore',
    '系谱指数',
    '分',
    '育种指数',
    '系谱完整度',
    '用于传统育种和近交风险复核。'
  ),
  systemTrait(
    'healthScore',
    '健康稳定性',
    '分',
    '育种指数',
    '健康评分',
    '来自健康评分和异常记录。'
  ),
  systemTrait(
    'activityScore',
    '活动体况',
    '分',
    '育种指数',
    '行为评分',
    '由活动量和传感器记录折算。'
  ),
  systemTrait(
    'breedingEvents',
    '繁殖/后裔记录',
    '条',
    '育种指数',
    '繁殖证据',
    '胎次、配种、妊检、产犊等繁殖事件数量。'
  ),
  systemTrait(
    'averageMilk',
    '平均泌乳量',
    'kg',
    '育种指数',
    '泌乳汇总',
    '按单牛奶厅明细折算的平均日产奶。'
  )
]

export async function loadDictionaryTraitOptions(
  input: LoadTraitOptionsInput = {}
): Promise<DictionaryTraitOption[]> {
  const [v2Traits, v2Categories, legacyTraits] = await Promise.all([
    readTable('trait_definition'),
    readTable('trait_category'),
    readTable('phenotype-trait-definitions')
  ])
  return buildDictionaryTraitOptions({
    v2Traits,
    v2Categories,
    legacyTraits,
    includeSystemBreedingTraits: Boolean(input.includeSystemBreedingTraits),
    includeDefaultProductionTraits: input.includeDefaultProductionTraits !== false
  })
}

export function buildDictionaryTraitOptions(input: {
  v2Traits?: AnyRow[]
  v2Categories?: AnyRow[]
  legacyTraits?: AnyRow[]
  includeSystemBreedingTraits?: boolean
  includeDefaultProductionTraits?: boolean
}) {
  const merged = new Map<string, DictionaryTraitOption>()
  const put = (trait: DictionaryTraitOption) => {
    if (!trait.key) return
    merged.set(trait.key, trait)
  }

  if (input.includeSystemBreedingTraits) systemBreedingTraitOptions.forEach(put)
  if (input.includeDefaultProductionTraits !== false) defaultProductionTraitOptions.forEach(put)

  const categories = buildCategoryResolver(input.v2Categories || [])
  ;(input.legacyTraits || []).forEach((row) => {
    const trait = normalizeLegacyTrait(row)
    if (trait) put(trait)
  })
  ;(input.v2Traits || []).forEach((row) => {
    const trait = normalizeV2Trait(row, categories)
    if (trait) put(trait)
  })

  return Array.from(merged.values())
    .filter((trait) => trait.key && trait.label)
    .sort((left, right) => {
      const category = left.categoryPath.localeCompare(right.categoryPath, 'zh-CN')
      if (category) return category
      return left.label.localeCompare(right.label, 'zh-CN')
    })
}

export function groupTraitOptions<T extends DictionaryTraitOption>(options: T[]) {
  const groups = new Map<string, T[]>()
  options.forEach((option) => {
    const label = option.categoryLevel1 || option.categoryPath || '未分类'
    groups.set(label, [...(groups.get(label) || []), option])
  })
  return Array.from(groups.entries()).map<TraitOptionGroup<T>>(([label, rows]) => ({
    label,
    options: rows
  }))
}

export function traitSelectLabel(
  option: Pick<DictionaryTraitOption, 'label' | 'unit' | 'categoryLevel2'>
) {
  const unit = option.unit ? ` (${option.unit})` : ''
  return option.categoryLevel2
    ? `${option.categoryLevel2} / ${option.label}${unit}`
    : `${option.label}${unit}`
}

export function inferTraitDirection(code: string, label: string): TraitDirection {
  const text = `${code} ${label}`.toLowerCase()
  return /scc|somatic|cell_count|体细胞|疾病|缺陷|风险|死亡|淘汰|异常/.test(text) ? 'asc' : 'desc'
}

function systemTrait(
  key: string,
  label: string,
  unit: string,
  categoryLevel1: string,
  categoryLevel2: string,
  note: string,
  direction: TraitDirection = inferTraitDirection(key, label)
): DictionaryTraitOption {
  return {
    key,
    value: key,
    label,
    unit,
    direction,
    note,
    categoryId: '',
    categoryLevel1,
    categoryLevel2,
    categoryPath: categoryLevel2 ? `${categoryLevel1} / ${categoryLevel2}` : categoryLevel1,
    source: 'system',
    traitType: 'system'
  }
}

async function readTable(tableName: string) {
  return databaseService.getTableDataAsync(tableName, { silent: true }).catch(() => [])
}

function normalizeV2Trait(
  row: AnyRow,
  categories: ReturnType<typeof buildCategoryResolver>
): DictionaryTraitOption | null {
  const key = text(row.code || row.traitCode || row.trait_code || row.key)
  if (!key || !isActive(row.status)) return null
  const label = text(row.name || row.traitName || row.trait_name || row.label || key)
  const categoryId = text(row.categoryId || row.category_id)
  const category = categories.resolve(
    categoryId,
    text(row.category || row.traitCategory || row.trait_category || row.traitType || row.trait_type)
  )
  return {
    key,
    value: key,
    label,
    unit: text(row.unit),
    direction: inferTraitDirection(key, label),
    note:
      text(row.description || row.note || row.defaultAggregation || row.default_aggregation) ||
      `${label} 来自性状词典。`,
    categoryId,
    categoryLevel1: category.level1,
    categoryLevel2: category.level2,
    categoryPath: category.path,
    source: 'v2',
    traitType: text(row.traitType || row.trait_type || row.dataType || row.data_type)
  }
}

function normalizeLegacyTrait(row: AnyRow): DictionaryTraitOption | null {
  const key = text(row.code || row.traitCode || row.trait_code || row.key)
  if (!key || !isActive(row.status)) return null
  const label = text(row.name || row.traitName || row.trait_name || row.label || key)
  const category = splitCategory(
    text(row.category || row.traitCategory || row.trait_category || '表型性状')
  )
  return {
    key,
    value: key,
    label,
    unit: text(row.unit),
    direction: inferTraitDirection(key, label),
    note: text(row.description || row.note) || `${label} 来自旧性状词典。`,
    categoryId: '',
    categoryLevel1: category.level1,
    categoryLevel2: category.level2,
    categoryPath: category.path,
    source: 'legacy',
    traitType: text(row.dataType || row.data_type || row.source)
  }
}

function buildCategoryResolver(rows: AnyRow[]) {
  const byId = new Map<string, AnyRow>()
  rows.forEach((row) => {
    const id = text(row.id || row.categoryId || row.category_id || row.code)
    if (id) byId.set(id, row)
  })

  const categoryName = (row: AnyRow | undefined) =>
    text(row?.name || row?.categoryName || row?.category_name || row?.label || row?.code)

  return {
    resolve(categoryId: string, fallback: string) {
      const row = byId.get(categoryId)
      const parentId = text(
        row?.parentId || row?.parent_id || row?.parentCategoryId || row?.parent_category_id
      )
      const parent = byId.get(parentId)
      if (row && parent) {
        const level1 = categoryName(parent) || '性状词典'
        const level2 = categoryName(row)
        return {
          level1,
          level2,
          path: level2 ? `${level1} / ${level2}` : level1
        }
      }
      if (row) {
        const level1 = categoryName(row) || fallback || '未分类'
        return { level1, level2: '', path: level1 }
      }
      return splitCategory(fallback || '未分类')
    }
  }
}

function splitCategory(value: string) {
  const parts = value
    .split(/[/>|｜、]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
  const level1 = parts[0] || '未分类'
  const level2 = parts[1] || ''
  return {
    level1,
    level2,
    path: level2 ? `${level1} / ${level2}` : level1
  }
}

function isActive(value: unknown) {
  const status = text(value).toLowerCase()
  return !['disabled', 'inactive', 'deleted', '停用', '禁用', '删除'].includes(status)
}

function text(value: unknown) {
  return String(value ?? '').trim()
}
