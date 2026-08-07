import type { CandidateScoreRow } from '@/views/breeding-platform/platform-data'
import type {
  MatingDirection,
  MatingRanking,
  RankedCandidate,
  SortDirection,
  TraitKey
} from './shared'

export type AlgorithmType = 'baseline' | 'rule_based' | 'statistical_model' | 'genomic_model'

export interface AlgorithmMetadata {
  algorithmType: AlgorithmType
  algorithmVersion: string
  label: string
  summary: string
  methodologyNote: string
  methodologyNotes: string[]
}

export interface PedigreeRiskAssessment {
  risk: boolean
  algorithmType: AlgorithmType
  label: string
  methodologyNote: string
  pedigreeCompleteness: {
    left: number
    right: number
    minimum: number
  }
  evidence: string[]
}

export const BREEDING_BASELINE_ALGORITHM: AlgorithmMetadata = {
  algorithmType: 'baseline',
  algorithmVersion: 'breeding-baseline-index-v1',
  label: 'baseline 基线指数',
  summary: '由表型、泌乳、健康、系谱完整度和本地组学证据分加权得到的基线排序指数。',
  methodologyNote: '采用表型、泌乳、健康、系谱完整度和本地组学证据分进行候选筛查与人工复核。',
  methodologyNotes: [
    '候选排序采用基线指数。',
    '组学字段用于汇总本地样本和候选标记证据分。',
    '系谱风险依据父母代及祖代编号重叠进行标记。'
  ]
}

export const MATING_RULE_ALGORITHM: AlgorithmMetadata = {
  algorithmType: 'rule_based',
  algorithmVersion: 'mating-rule-ranking-v1',
  label: 'rule_based 规则选配',
  summary: '按方向权重、双亲基线指数、兼容度规则和谱系重叠惩罚生成选配排行。',
  methodologyNote: '采用方向权重、双亲基线指数、兼容度规则和系谱重叠惩罚生成配对排序。',
  methodologyNotes: [
    '配对得分由方向权重和双亲基线指数组成。',
    '兼容度采用启发式加权和风险惩罚。',
    '谱系风险按谱系编号重叠与完整度进行基线评分。'
  ]
}

const BREEDING_WEIGHTS = {
  primaryTrait: 0.62,
  secondaryTrait: 0.28,
  genomicEvidence: 0.1
} as const

const MATING_WEIGHTS = {
  femaleBaselineIndex: 0.46,
  bullBaselineIndex: 0.54,
  compatibilityBreedingValue: 0.44,
  compatibilityFemaleScore: 0.24,
  compatibilityBullScore: 0.24,
  lowRiskBonus: 8,
  pedigreeOverlapPenalty: -18
} as const

function candidateSetSummary(rows: CandidateScoreRow[]) {
  return {
    count: rows.length,
    cowIds: rows.map((row) => row.cow.id).filter(Boolean),
    cowNumbers: rows.map((row) => row.cow.cowNumber).filter(Boolean)
  }
}

function directionLabel(direction: SortDirection) {
  return direction === 'desc' ? '高值优先' : '低值优先'
}

function pedigreeTokens(row: CandidateScoreRow): string[] {
  return [
    row.cow.fatherNumber,
    row.cow.motherNumber,
    row.cow.grandfatherNumber,
    row.cow.grandmotherNumber
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function sharedPedigreeTokens(left: CandidateScoreRow, right: CandidateScoreRow): string[] {
  const leftTokens = new Set(pedigreeTokens(left))
  return pedigreeTokens(right).filter((token) => leftTokens.has(token))
}

export function pedigreeCompletenessLabel(score: number) {
  return score >= 75 ? '谱系相对完整' : '谱系完整度不足'
}

export function buildPedigreeRiskAssessment(
  left: CandidateScoreRow,
  right: CandidateScoreRow
): PedigreeRiskAssessment {
  const shared = sharedPedigreeTokens(left, right)
  const minimum = Math.min(left.pedigreeScore, right.pedigreeScore)
  return {
    risk: shared.length > 0,
    algorithmType: 'baseline',
    label: '谱系完整度不足/基线估算',
    methodologyNote: '当前按父母代和祖代编号重叠计算谱系风险标记。',
    pedigreeCompleteness: {
      left: left.pedigreeScore,
      right: right.pedigreeScore,
      minimum
    },
    evidence: shared.length
      ? [`发现重叠谱系编号：${shared.join('、')}`]
      : [
          `${left.cow.cowNumber} ${pedigreeCompletenessLabel(left.pedigreeScore)}`,
          `${right.cow.cowNumber} ${pedigreeCompletenessLabel(right.pedigreeScore)}`
        ]
  }
}

export function buildCandidateTraceSummary(input: {
  rows: RankedCandidate[]
  candidateRows: CandidateScoreRow[]
  mateRows: CandidateScoreRow[]
  primaryTrait: TraitKey
  primaryDirection: SortDirection
  secondaryTrait: TraitKey
  secondaryDirection: SortDirection
  onlyLowRisk: boolean
}) {
  return {
    algorithm: BREEDING_BASELINE_ALGORITHM,
    inputSnapshot: {
      candidateSet: candidateSetSummary(input.candidateRows),
      mateCandidateSet: candidateSetSummary(input.mateRows),
      outputCount: input.rows.length
    },
    weights: BREEDING_WEIGHTS,
    filterThresholds: {
      onlyLowRisk: input.onlyLowRisk,
      primaryDirection: directionLabel(input.primaryDirection),
      secondaryDirection: directionLabel(input.secondaryDirection)
    },
    rankingDetail: input.rows.slice(0, 12).map((item) => ({
      rank: item.rank,
      cowId: item.row.cow.id,
      cowNumber: item.row.cow.cowNumber,
      baselineIndex: item.breedingValue,
      primaryTrait: input.primaryTrait,
      primaryValue: item.primaryValue,
      secondaryTrait: input.secondaryTrait,
      secondaryValue: item.secondaryValue,
      genomicEvidenceScore: item.row.genomicScore,
      scoreComponents: {
        platformScore: item.row.score,
        pedigreeScore: item.row.pedigreeScore,
        milkScore: item.row.milkScore,
        healthScore: item.row.healthScore
      },
      mateRisk: item.mate ? buildPedigreeRiskAssessment(item.row, item.mate.row) : null
    }))
  }
}

export function buildMatingTraceSummary(input: {
  rows: MatingRanking[]
  femaleRows: CandidateScoreRow[]
  bullRows: CandidateScoreRow[]
  direction: MatingDirection
  onlyLowRisk: boolean
}) {
  return {
    algorithm: MATING_RULE_ALGORITHM,
    inputSnapshot: {
      femaleCandidateSet: candidateSetSummary(input.femaleRows),
      bullCandidateSet: candidateSetSummary(input.bullRows),
      pairSearchSpace: input.femaleRows.length * input.bullRows.length,
      outputCount: input.rows.length
    },
    weights: MATING_WEIGHTS,
    filterThresholds: {
      onlyLowRisk: input.onlyLowRisk,
      primaryTrait: input.direction.primaryTrait,
      primaryDirection: directionLabel(input.direction.primaryDirection),
      secondaryTrait: input.direction.secondaryTrait,
      secondaryDirection: directionLabel(input.direction.secondaryDirection)
    },
    rankingDetail: input.rows.slice(0, 12).map((item) => ({
      rank: item.rank,
      femaleCowId: item.female.cow.id,
      femaleCowNumber: item.female.cow.cowNumber,
      bullCowId: item.bull?.cow.id || '',
      bullCowNumber: item.bull?.cow.cowNumber || '',
      baselinePairIndex: item.breedingValue,
      compatibility: item.compatibility,
      riskAssessment: item.bull ? buildPedigreeRiskAssessment(item.female, item.bull) : null,
      reason: item.reason
    }))
  }
}
