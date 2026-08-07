import api from '@/utils/http'
import type {
  ConfirmMilkFillOptions,
  ConfirmMilkFillResult,
  MilkMissingReviewResult,
  MilkReviewPeriod
} from '@/services/milk-production-statistics'

export interface MilkMissingReviewQuery {
  startDate?: string
  endDate?: string
  period?: MilkReviewPeriod
  expectedShifts?: string[]
}

export function getMilkMissingReview(query: MilkMissingReviewQuery) {
  const params: Record<string, unknown> = { ...query }
  if (query.expectedShifts?.length) {
    params.expectedShifts = query.expectedShifts.join(',')
  } else {
    delete params.expectedShifts
  }
  return api.get<MilkMissingReviewResult>({
    url: '/api/milk/missing-review',
    params,
    timeout: 30000
  })
}

export function confirmMilkMissingReview(payload: ConfirmMilkFillOptions) {
  return api.post<ConfirmMilkFillResult>({
    url: '/api/milk/missing-review/confirm',
    data: payload,
    timeout: 60000
  })
}
