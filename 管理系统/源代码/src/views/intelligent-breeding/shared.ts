import type { CowBasic } from '@/types/cow'
import {
  groupTraitOptions,
  loadDictionaryTraitOptions,
  systemBreedingTraitOptions,
  traitSelectLabel,
  type DictionaryTraitOption,
  type TraitDirection
} from '@/services/trait-dictionary'
import type { CandidateScoreRow } from '@/views/breeding-platform/platform-data'
import {
  buildPedigreeRiskAssessment,
  type AlgorithmType,
  type PedigreeRiskAssessment
} from './algorithm-metadata'

export type TraitKey = string
export type SortDirection = TraitDirection
export type TraitOption = DictionaryTraitOption

const BASELINE_ALGORITHM_TYPE: AlgorithmType = 'baseline'
const RULE_BASED_ALGORITHM_TYPE: AlgorithmType = 'rule_based'

export interface RankedCandidate {
  row: CandidateScoreRow
  algorithmType: AlgorithmType
  breedingValue: number
  primaryValue: number
  secondaryValue: number
  rank: number
  mate: MateRecommendation | null
}

export interface MateRecommendation {
  row: CandidateScoreRow
  algorithmType: AlgorithmType
  compatibility: number
  inbreedingRisk: boolean
  riskAssessment: PedigreeRiskAssessment
  methodologyNote: string
  reason: string
}

export interface MatingDirection {
  key: string
  name: string
  description: string
  primaryTrait: TraitKey
  primaryDirection: SortDirection
  secondaryTrait: TraitKey
  secondaryDirection: SortDirection
}

export interface MatingRanking {
  female: CandidateScoreRow
  bull: CandidateScoreRow | null
  algorithmType: AlgorithmType
  breedingValue: number
  compatibility: number
  inbreedingRisk: boolean
  riskAssessment: PedigreeRiskAssessment | null
  methodologyNote: string
  rank: number
  reason: string
}

export const traitOptions: TraitOption[] = systemBreedingTraitOptions

export const matingDirections: MatingDirection[] = [
  {
    key: 'milk-yield',
    name: '高泌乳量方向',
    description: '优先提高泌乳基线指数，同时控制近交风险。',
    primaryTrait: 'milk_yield',
    primaryDirection: 'desc',
    secondaryTrait: 'pedigreeScore',
    secondaryDirection: 'desc'
  },
  {
    key: 'genomic',
    name: '组学证据方向',
    description: '优先选择组学证据分高且系谱完整的配对。',
    primaryTrait: 'genomicScore',
    primaryDirection: 'desc',
    secondaryTrait: 'pedigreeScore',
    secondaryDirection: 'desc'
  },
  {
    key: 'health',
    name: '健康稳定方向',
    description: '优先提高健康稳定性，适合生产群扩繁。',
    primaryTrait: 'healthScore',
    primaryDirection: 'desc',
    secondaryTrait: 'daily_steps',
    secondaryDirection: 'desc'
  },
  {
    key: 'low-risk',
    name: '低近交风险方向',
    description: '优先选择系谱差异更大的配对，兼顾综合基线指数。',
    primaryTrait: 'pedigreeScore',
    primaryDirection: 'desc',
    secondaryTrait: 'score',
    secondaryDirection: 'desc'
  }
]

export async function loadBreedingTraitOptions() {
  return loadDictionaryTraitOptions({
    includeSystemBreedingTraits: true,
    includeDefaultProductionTraits: true
  })
}

export function groupBreedingTraitOptions(options: TraitOption[]) {
  return groupTraitOptions(options)
}

export function getTraitLabel(trait: TraitKey, options: TraitOption[] = traitOptions): string {
  return options.find((item) => item.value === trait || item.key === trait)?.label || trait
}

export function getTraitUnit(trait: TraitKey, options: TraitOption[] = traitOptions): string {
  return options.find((item) => item.value === trait || item.key === trait)?.unit || ''
}

export function getTraitSelectLabel(option: TraitOption) {
  return traitSelectLabel(option)
}

export function traitValue(row: CandidateScoreRow, trait: TraitKey): number {
  const dynamic = Number(row.traitValues?.[trait])
  if (Number.isFinite(dynamic)) return dynamic
  const raw = Number((row as unknown as Record<string, unknown>)[trait])
  return Number.isFinite(raw) ? raw : 0
}

function normalizedTraitValue(
  row: CandidateScoreRow,
  trait: TraitKey,
  direction: SortDirection
): number {
  const value = traitValue(row, trait)
  const bounded = trait === 'breedingEvents' ? Math.min(100, value * 12) : Math.min(100, value)
  return direction === 'desc' ? bounded : 100 - bounded
}

function pedigreeTokens(cow: CowBasic): string[] {
  return [cow.fatherNumber, cow.motherNumber, cow.grandfatherNumber, cow.grandmotherNumber]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

export function hasInbreedingRisk(left: CowBasic, right: CowBasic): boolean {
  const leftTokens = new Set(pedigreeTokens(left))
  return pedigreeTokens(right).some((token) => leftTokens.has(token))
}

export function candidateBreedingValue(
  row: CandidateScoreRow,
  primaryTrait: TraitKey,
  primaryDirection: SortDirection,
  secondaryTrait: TraitKey,
  secondaryDirection: SortDirection
): number {
  const primary = normalizedTraitValue(row, primaryTrait, primaryDirection)
  const secondary = normalizedTraitValue(row, secondaryTrait, secondaryDirection)
  return Math.round(primary * 0.62 + secondary * 0.28 + row.genomicScore * 0.1)
}

export function pairCompatibility(
  female: CandidateScoreRow,
  bull: CandidateScoreRow,
  breedingValue: number
): number {
  const risk = hasInbreedingRisk(female.cow, bull.cow)
  const score = breedingValue * 0.44 + female.score * 0.24 + bull.score * 0.24 + (risk ? -18 : 8)
  return Math.max(45, Math.min(98, Math.round(score)))
}

export function recommendMate(
  target: CandidateScoreRow,
  candidates: CandidateScoreRow[],
  primaryTrait: TraitKey,
  primaryDirection: SortDirection,
  secondaryTrait: TraitKey,
  secondaryDirection: SortDirection
): MateRecommendation | null {
  const ranked = candidates
    .filter((item) => item.cow.id !== target.cow.id)
    .map((item) => {
      const value = candidateBreedingValue(
        item,
        primaryTrait,
        primaryDirection,
        secondaryTrait,
        secondaryDirection
      )
      const riskAssessment = buildPedigreeRiskAssessment(target, item)
      return {
        row: item,
        breedingValue: value,
        inbreedingRisk: riskAssessment.risk,
        riskAssessment,
        compatibility: Math.max(
          45,
          Math.min(
            98,
            Math.round((target.score + item.score + value) / 3 + (riskAssessment.risk ? -16 : 7))
          )
        )
      }
    })
    .sort((left, right) => {
      if (left.inbreedingRisk !== right.inbreedingRisk) return left.inbreedingRisk ? 1 : -1
      return right.compatibility - left.compatibility
    })

  const best = ranked[0]
  if (!best) return null

  return {
    row: best.row,
    algorithmType: RULE_BASED_ALGORITHM_TYPE,
    compatibility: best.compatibility,
    inbreedingRisk: best.inbreedingRisk,
    riskAssessment: best.riskAssessment,
    methodologyNote: best.riskAssessment.methodologyNote,
    reason: best.inbreedingRisk
      ? '谱系编号存在重叠；当前为基线估算，需育种审核后使用。'
      : '父母代和祖代未发现重叠；当前仍为基线估算，需补充亲缘矩阵。'
  }
}

export function rankCandidates(
  rows: CandidateScoreRow[],
  mateRows: CandidateScoreRow[],
  primaryTrait: TraitKey,
  primaryDirection: SortDirection,
  secondaryTrait: TraitKey,
  secondaryDirection: SortDirection,
  onlyLowRisk: boolean
): RankedCandidate[] {
  return rows
    .map((row) => {
      const mate = recommendMate(
        row,
        mateRows,
        primaryTrait,
        primaryDirection,
        secondaryTrait,
        secondaryDirection
      )
      return {
        row,
        algorithmType: BASELINE_ALGORITHM_TYPE,
        breedingValue: candidateBreedingValue(
          row,
          primaryTrait,
          primaryDirection,
          secondaryTrait,
          secondaryDirection
        ),
        primaryValue: traitValue(row, primaryTrait),
        secondaryValue: traitValue(row, secondaryTrait),
        rank: 0,
        mate
      }
    })
    .filter((item) => !onlyLowRisk || !item.mate?.inbreedingRisk)
    .sort((left, right) => right.breedingValue - left.breedingValue)
    .map((item, index) => ({ ...item, rank: index + 1 }))
}

export function buildMatingRankings(
  females: CandidateScoreRow[],
  bulls: CandidateScoreRow[],
  direction: MatingDirection,
  onlyLowRisk: boolean
): MatingRanking[] {
  return females
    .flatMap((female) =>
      bulls.map((bull) => {
        const femaleValue = candidateBreedingValue(
          female,
          direction.primaryTrait,
          direction.primaryDirection,
          direction.secondaryTrait,
          direction.secondaryDirection
        )
        const bullValue = candidateBreedingValue(
          bull,
          direction.primaryTrait,
          direction.primaryDirection,
          direction.secondaryTrait,
          direction.secondaryDirection
        )
        const breedingValue = Math.round(femaleValue * 0.46 + bullValue * 0.54)
        const riskAssessment = buildPedigreeRiskAssessment(female, bull)
        return {
          female,
          bull,
          algorithmType: RULE_BASED_ALGORITHM_TYPE,
          breedingValue,
          compatibility: pairCompatibility(female, bull, breedingValue),
          inbreedingRisk: riskAssessment.risk,
          riskAssessment,
          methodologyNote: riskAssessment.methodologyNote,
          rank: 0,
          reason: riskAssessment.risk
            ? '谱系编号提示近交风险，进入人工复核队列。'
            : '谱系编号未发现重叠，性状目标匹配，可进入选配候选。'
        }
      })
    )
    .filter((item) => !onlyLowRisk || !item.inbreedingRisk)
    .sort((left, right) => {
      if (left.inbreedingRisk !== right.inbreedingRisk) return left.inbreedingRisk ? 1 : -1
      return right.compatibility - left.compatibility || right.breedingValue - left.breedingValue
    })
    .slice(0, 12)
    .map((item, index) => ({ ...item, rank: index + 1 }))
}

export function formatTraitValue(
  value: number,
  trait: TraitKey,
  options: TraitOption[] = traitOptions
): string {
  const unit = getTraitUnit(trait, options)
  const display =
    Math.abs(value) >= 100 || Number.isInteger(value)
      ? Math.round(value).toString()
      : value.toFixed(2)
  return `${display}${unit}`
}
