import * as databaseService from '@/services/database'
import type { CandidateScoreRow } from '@/views/breeding-platform/platform-data'
import type { MatingRanking, RankedCandidate, TraitKey, SortDirection } from './shared'
import {
  BREEDING_BASELINE_ALGORITHM,
  MATING_RULE_ALGORITHM,
  type AlgorithmMetadata
} from './algorithm-metadata'

export type BreedingDecisionRunType = 'bull_ranking' | 'female_ranking' | 'mating_plan'

interface PersistBreedingDecisionRunInput {
  runType: BreedingDecisionRunType
  title: string
  operator?: string
  algorithmMetadata?: AlgorithmMetadata
  parameters: Record<string, unknown>
  resultSnapshot: Record<string, unknown>
  cowIds: string[]
  sourceRecordIds?: Record<string, string[]>
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .flat()
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  )
}

function nowIso() {
  return new Date().toISOString()
}

export function rankedCandidateSnapshot(rows: RankedCandidate[]) {
  return rows.map((item) => ({
    rank: item.rank,
    algorithmType: item.algorithmType,
    cowId: item.row.cow.id,
    cowNumber: item.row.cow.cowNumber,
    breedingValue: item.breedingValue,
    score: item.row.score,
    primaryValue: item.primaryValue,
    secondaryValue: item.secondaryValue,
    genomicScore: item.row.genomicScore,
    pedigreeScore: item.row.pedigreeScore,
    milkScore: item.row.milkScore,
    healthScore: item.row.healthScore,
    candidateTag: item.row.candidateTag,
    supportEvidence: item.row.supportEvidence,
    mate: item.mate
      ? {
          cowId: item.mate.row.cow.id,
          cowNumber: item.mate.row.cow.cowNumber,
          algorithmType: item.mate.algorithmType,
          compatibility: item.mate.compatibility,
          inbreedingRisk: item.mate.inbreedingRisk,
          riskAssessment: item.mate.riskAssessment,
          methodologyNote: item.mate.methodologyNote,
          reason: item.mate.reason
        }
      : null
  }))
}

export function matingRankingSnapshot(rows: MatingRanking[]) {
  return rows.map((item) => ({
    rank: item.rank,
    algorithmType: item.algorithmType,
    female: serializeCandidateScore(item.female),
    bull: item.bull ? serializeCandidateScore(item.bull) : null,
    breedingValue: item.breedingValue,
    compatibility: item.compatibility,
    inbreedingRisk: item.inbreedingRisk,
    riskAssessment: item.riskAssessment,
    methodologyNote: item.methodologyNote,
    reason: item.reason
  }))
}

export function candidateCowIds(rows: RankedCandidate[]) {
  return uniqueStrings(rows.flatMap((item) => [item.row.cow.id, item.mate?.row.cow.id]))
}

export function matingCowIds(rows: MatingRanking[]) {
  return uniqueStrings(rows.flatMap((item) => [item.female.cow.id, item.bull?.cow.id]))
}

export function traitParameterSnapshot(
  primaryTrait: TraitKey,
  primaryDirection: SortDirection,
  secondaryTrait: TraitKey,
  secondaryDirection: SortDirection,
  onlyLowRisk: boolean
) {
  return {
    primaryTrait,
    primaryDirection,
    secondaryTrait,
    secondaryDirection,
    onlyLowRisk
  }
}

export async function persistBreedingDecisionRun(input: PersistBreedingDecisionRunInput) {
  const startedAt = nowIso()
  const finishedAt = nowIso()
  const runId = `breeding-decision-${input.runType}-${Date.now()}`
  const operator = input.operator || '育种技术员'
  const cowIds = uniqueStrings(input.cowIds)
  const algorithmMetadata =
    input.algorithmMetadata ||
    (input.runType === 'mating_plan' ? MATING_RULE_ALGORITHM : BREEDING_BASELINE_ALGORITHM)
  const parameters = {
    ...input.parameters,
    algorithmType: algorithmMetadata.algorithmType,
    algorithmMetadata
  }
  const resultSnapshot = {
    algorithmType: algorithmMetadata.algorithmType,
    algorithmMetadata,
    ...input.resultSnapshot
  }
  const sourceRecordIds = {
    cows: cowIds,
    ...(input.sourceRecordIds || {})
  }
  const relationScope = {
    domain: 'intelligent_breeding',
    runType: input.runType,
    algorithmType: algorithmMetadata.algorithmType,
    algorithmMetadata,
    cowIds,
    sourceRecordIds
  }

  await databaseService.addTableDataAsync('breeding-decision-runs', {
    id: runId,
    run_type: input.runType,
    title: input.title,
    operator,
    status: 'completed',
    parameters_json: parameters,
    result_snapshot: resultSnapshot,
    cow_ids: cowIds,
    relation_scope: relationScope,
    source_record_ids: sourceRecordIds,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Math.max(1, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
    created_at: startedAt,
    updated_at: finishedAt
  })

  await databaseService.addTableDataAsync('operation-audit-logs', {
    id: `op-audit-${runId}`,
    action_type: `breeding_decision_${input.runType}`,
    target_type: 'breeding_decision_runs',
    target_id: runId,
    operator,
    status: 'completed',
    request_payload: parameters,
    result_payload: resultSnapshot,
    cow_ids: cowIds,
    relation_scope: relationScope,
    source_record_ids: {
      ...sourceRecordIds,
      breeding_decision_runs: [runId]
    },
    created_at: startedAt,
    updated_at: finishedAt
  })

  return runId
}

function serializeCandidateScore(row: CandidateScoreRow) {
  return {
    algorithmType: BREEDING_BASELINE_ALGORITHM.algorithmType,
    cowId: row.cow.id,
    cowNumber: row.cow.cowNumber,
    score: row.score,
    genomicScore: row.genomicScore,
    pedigreeScore: row.pedigreeScore,
    milkScore: row.milkScore,
    healthScore: row.healthScore,
    activityScore: row.activityScore,
    averageMilk: row.averageMilk,
    breedingEvents: row.breedingEvents,
    candidateTag: row.candidateTag,
    methodologyNote: BREEDING_BASELINE_ALGORITHM.methodologyNote
  }
}
