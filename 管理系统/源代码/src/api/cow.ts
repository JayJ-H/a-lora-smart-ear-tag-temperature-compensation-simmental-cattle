// Production-only management-system API facade.

import type {
  ApiResponse,
  AutomationApi,
  BaseDataApi,
  CowApi,
  EconomicApi,
  EventApi,
  ExportApi,
  HardwareApi,
  KPIApi,
  PaginatedResponse,
  PredictiveApi,
  SensorApi,
  StatisticsApi
} from '@/types/api/cow'
import http from '@/utils/http'

const accessMode = String(import.meta.env.VITE_ACCESS_MODE || '管理系统').toLowerCase()
const isBackendMode = accessMode === '管理系统'

export type FrontendDataSource = 'real' | 'empty' | 'error'

export const cowApiDataSource: FrontendDataSource = isBackendMode ? 'real' : 'empty'
export const getCowApiDataSource = () => cowApiDataSource

type DynamicApi = Record<string, (...args: any[]) => Promise<any>>

function createBackendApiProxy<T extends object>(scope: string): T {
  return new Proxy({} as T, {
    get(_target, propKey) {
      if (typeof propKey !== 'string') return undefined
      return (...args: unknown[]) =>
        http.post<any>({
          url: `/api/cow/${scope}/${propKey}`,
          data: { args }
        })
    }
  })
}

function getPageArgs(args: unknown[]) {
  const first = args[0]
  if (!first || typeof first !== 'object') return { page: 1, pageSize: 20 }
  const params = first as { page?: number; pageSize?: number }
  return {
    page: Number(params.page || 1),
    pageSize: Number(params.pageSize || 20)
  }
}

function createEmptyResponse(method: string, args: unknown[]) {
  if (method === 'getStatistics') {
    return {
      code: 200,
      message: 'No production backend is connected.',
      data: {
        totalCows: 0,
        healthyCows: 0,
        abnormalCows: 0,
        heatCows: 0,
        pregnantCows: 0,
        mixedCows: 0,
        leftCows: 0
      },
      dataSource: 'empty',
      source: 'empty'
    }
  }

  if (method === 'getCowHourlyData') {
    return {
      code: 200,
      message: 'No production backend is connected.',
      data: { temperature: [], steps: [] },
      dataSource: 'empty',
      source: 'empty'
    }
  }

  if (/^(create|update|delete|upload|import|calibrate|mark|train|run|test|trigger|start|execute)/i.test(method)) {
    return {
      code: 503,
      message: 'A production backend is required for write operations.',
      data: null,
      dataSource: 'error',
      source: 'error'
    }
  }

  const { page, pageSize } = getPageArgs(args)
  const response: PaginatedResponse<any> & { dataSource: FrontendDataSource; source: FrontendDataSource } = {
    code: 200,
    message: 'No production backend is connected.',
    data: [],
    total: 0,
    page,
    pageSize,
    dataSource: 'empty',
    source: 'empty'
  }
  return response
}

function createUnavailableApiProxy<T extends object>(scope: string): T {
  return new Proxy({} as T, {
    get(_target, propKey) {
      if (typeof propKey !== 'string') return undefined
      return (...args: unknown[]) => {
        console.warn(`[cow-api:${scope}] ${propKey} requires VITE_ACCESS_MODE=backend.`)
        return Promise.resolve(createEmptyResponse(propKey, args) as ApiResponse<any>)
      }
    }
  })
}

function selectProductionApi<T extends object>(scope: string): T {
  return isBackendMode ? createBackendApiProxy<T>(scope) : createUnavailableApiProxy<T>(scope)
}

export const cowApi: CowApi = selectProductionApi<CowApi>('cow')
export const sensorApi: SensorApi = selectProductionApi<SensorApi>('sensor')
export const eventApi: EventApi = selectProductionApi<EventApi>('event')
export const baseDataApi: BaseDataApi = selectProductionApi<BaseDataApi>('baseData')
export const statisticsApi: StatisticsApi = selectProductionApi<StatisticsApi>('statistics')
export const exportApi: ExportApi = selectProductionApi<ExportApi>('export')
export const economicApi: EconomicApi = selectProductionApi<EconomicApi>('economic')
export const predictiveApi: PredictiveApi = selectProductionApi<PredictiveApi>('predictive')
export const hardwareApi: HardwareApi = selectProductionApi<HardwareApi>('硬件')
export const kpiApi: KPIApi = selectProductionApi<KPIApi>('kpi')
export const automationApi: AutomationApi = selectProductionApi<AutomationApi>('automation')

export const milkApi: DynamicApi = selectProductionApi<DynamicApi>('milk')
export const feedApi: DynamicApi = selectProductionApi<DynamicApi>('feed')
export const reproductionApi: DynamicApi = selectProductionApi<DynamicApi>('reproduction')
export const healthApi: DynamicApi = selectProductionApi<DynamicApi>('health')
