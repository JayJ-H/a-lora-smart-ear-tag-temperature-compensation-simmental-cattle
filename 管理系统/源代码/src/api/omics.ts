import api from '@/utils/http'

export interface OmicsRunPayload {
  moduleId: string
  trait: string
  repositoryId?: string
  groupBy?: string
  parameters?: Record<string, unknown>
}

export interface OmicsParameterSchemaItem {
  key: string
  label: string
  type: 'number' | 'text' | 'select' | 'slider' | 'boolean'
  default?: unknown
  min?: number
  max?: number
  step?: number
  unit?: string
  required?: boolean
  group?: string
  description?: string
  algorithm?: string
  backendParam?: string
  advanced?: boolean
  implemented?: boolean
  options?: Array<{ label: string; value: string | number }>
}

export interface OmicsCatalogModule {
  id: string
  name: string
  category: string
  description: string
  inputs: string[]
  output: string
  runtime: string
  tone: string
  tagType: string
  parameterSchema?: OmicsParameterSchemaItem[]
}

export type OmicsAlgorithmType = 'baseline' | 'rule_based' | 'statistical_model' | 'genomic_model'

export interface OmicsSourceComposition {
  dataSource?: string
  matrixProvided?: boolean
  sampleCount?: number
  featureCount?: number
  groupCount?: number
  realFeatureCount?: number
  generatedFeatureCount?: number
  omicsSampleCount?: number
  omicsDatasetCount?: number
  omicsMarkerCount?: number
  associationCount?: number
  sourceSummary?: Record<string, unknown>
}

export interface OmicsDataProvenance {
  source?: string
  repositoryId?: string
  repositoryTitle?: string
  matrixHash?: string
  matrixProvided?: boolean
  sourceComposition?: OmicsSourceComposition
  methodologyNote?: string
}

export interface OmicsRunResult {
  id?: string
  moduleId?: string
  workflowId?: string
  trait?: string
  status?: string
  dataSource?: string
  metrics?: Array<Record<string, unknown>>
  tables?: Record<string, unknown>
  charts?: Record<string, unknown>
  methodNotes?: string[]
  parameters?: Record<string, unknown>
  effectiveParameters?: Record<string, unknown>
  inputSummary?: Record<string, unknown>
  artifacts?: Array<Record<string, unknown>>
  algorithmType?: OmicsAlgorithmType
  algorithmVersion?: string
  dataProvenance?: OmicsDataProvenance
  sourceComposition?: OmicsSourceComposition
  sampleCount?: number
  filterThresholds?: Record<string, unknown>
}

export interface OmicsWorkflowPayload {
  workflowId: string
  workflowName: string
  trait: string
  repositoryIds: string[]
  moduleIds: string[]
  steps?: Array<{
    moduleId: string
    order: number
    parameters?: Record<string, unknown>
  }>
  parameters?: Record<string, unknown>
}

export function getOmicsHealth() {
  const isBackendMode = import.meta.env.VITE_ACCESS_MODE === 'backend'
  if (!isBackendMode) {
    return Promise.resolve({
      status: 'unavailable',
      message: 'Omics backend not available in frontend mode'
    })
  }
  return api.get<Record<string, unknown>>({
    url: '/api/omics/health',
    showErrorMessage: false
  })
}

export function getOmicsModuleCatalog() {
  return api.get<OmicsCatalogModule[]>({
    url: '/api/omics/modules/catalog'
  })
}

export function runOmicsModule(payload: OmicsRunPayload) {
  return api.post<OmicsRunResult>({
    url: '/api/omics/modules/run',
    data: payload,
    timeout: 20000
  })
}

export function getOmicsModuleResults(limit = 50) {
  return api.get<OmicsRunResult[]>({
    url: '/api/omics/modules/results',
    params: { limit }
  })
}

export function runOmicsWorkflow(payload: OmicsWorkflowPayload) {
  return api.post<OmicsRunResult>({
    url: '/api/omics/workflows/run',
    data: payload,
    timeout: 60000
  })
}

export function getOmicsWorkflowResults(limit = 50) {
  return api.get<OmicsRunResult[]>({
    url: '/api/omics/workflows/results',
    params: { limit }
  })
}
