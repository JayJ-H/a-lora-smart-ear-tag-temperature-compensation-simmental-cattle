export const CATTLE_SPECIES_NAME: '牛'
export const DEFAULT_CATTLE_BREED: '西门塔尔牛'
export const SUPPORTED_CATTLE_BREEDS: readonly ['西门塔尔牛', '华西牛']

export interface RequireSupportedCattleBreedOptions {
  allowEmpty?: boolean
  field?: string
}

export function normalizeCattleBreed(value: unknown): string
export function isSupportedCattleBreed(value: unknown): boolean
export function requireSupportedCattleBreed(
  value: unknown,
  options?: RequireSupportedCattleBreedOptions
): string
export function normalizeCattleBreedOrDefault(value: unknown, fallback?: unknown): string

