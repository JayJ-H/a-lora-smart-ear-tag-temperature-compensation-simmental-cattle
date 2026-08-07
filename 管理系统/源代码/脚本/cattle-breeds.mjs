export const CATTLE_SPECIES_NAME = '牛'
export const DEFAULT_CATTLE_BREED = '西门塔尔牛'
export const SUPPORTED_CATTLE_BREEDS = Object.freeze(['西门塔尔牛', '华西牛'])

const BREED_ALIASES = new Map([
  ['西门塔尔', '西门塔尔牛'],
  ['西门塔尔牛', '西门塔尔牛'],
  ['simmental', '西门塔尔牛'],
  ['华西', '华西牛'],
  ['华西牛', '华西牛'],
  ['huaxi', '华西牛']
])

function aliasKey(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase()
}

export function normalizeCattleBreed(value) {
  return BREED_ALIASES.get(aliasKey(value)) || ''
}

export function isSupportedCattleBreed(value) {
  return Boolean(normalizeCattleBreed(value))
}

export function requireSupportedCattleBreed(value, { allowEmpty = false, field = '品种' } = {}) {
  const source = String(value ?? '').trim()
  if (!source && allowEmpty) return ''

  const normalized = normalizeCattleBreed(source)
  if (normalized) return normalized

  const error = new Error(`${field}仅支持：${SUPPORTED_CATTLE_BREEDS.join('、')}`)
  error.code = 'UNSUPPORTED_CATTLE_BREED'
  error.value = source
  throw error
}

export function normalizeCattleBreedOrDefault(value, fallback = DEFAULT_CATTLE_BREED) {
  return normalizeCattleBreed(value) || requireSupportedCattleBreed(fallback)
}
