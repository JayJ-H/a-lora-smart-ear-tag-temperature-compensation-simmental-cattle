import fs from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()
const envPath = path.join(rootDir, '运维', '生产配置', '.env.prod')

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
      })
  )
}

const env = { ...readEnvFile(envPath), ...process.env }
const baseUrl = String(env.OMICS_VALIDATE_BASE_URL || 'http://127.0.0.1:9191').replace(/\/+$/, '')
const userName = String(env.ADMIN_USER || 'admin')
const password = String(env.ADMIN_PASSWORD || '')

function assert(condition, message, details = undefined) {
  if (!condition) {
    const error = new Error(message)
    error.details = details
    throw error
  }
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  assert(response.ok, `${options.method || 'GET'} ${pathname} HTTP ${response.status}`, body)
  return body
}

function assertApiOk(body, name) {
  assert(body && (body.code === 0 || body.code === 200), `${name} failed`, body)
  return body.data
}

function parameterObject(run) {
  return run?.parameters && typeof run.parameters === 'object' ? run.parameters : {}
}

function effectiveParameterObject(run) {
  const parameters = parameterObject(run)
  return parameters.effectiveParameters && typeof parameters.effectiveParameters === 'object'
    ? parameters.effectiveParameters
    : run?.effectiveParameters && typeof run.effectiveParameters === 'object'
      ? run.effectiveParameters
      : {}
}

function inputSummaryObject(run) {
  return run?.inputSummary && typeof run.inputSummary === 'object' ? run.inputSummary : {}
}

function assertOmicsMetadata(run, name) {
  const inputSummary = inputSummaryObject(run)
  const effective = effectiveParameterObject(run)
  const provenance = run.dataProvenance || inputSummary.dataProvenance || effective.dataProvenance
  const sourceComposition = run.sourceComposition || inputSummary.sourceComposition || provenance?.sourceComposition
  const filterThresholds = run.filterThresholds || inputSummary.filterThresholds || effective.filterThresholds
  const algorithmVersion = run.algorithmVersion || inputSummary.algorithmVersion || effective.algorithmVersion
  const algorithmType = run.algorithmType || inputSummary.algorithmType || effective.algorithmType
  const sampleCount = Number(run.sampleCount || inputSummary.sampleCount || sourceComposition?.sampleCount || 0)

  assert(['baseline', 'rule_based', 'statistical_model', 'genomic_model'].includes(String(algorithmType)), `${name} algorithmType missing or invalid`, { algorithmType, run })
  assert(String(algorithmVersion || '').length > 0, `${name} algorithmVersion missing`, run)
  assert(provenance && typeof provenance === 'object', `${name} dataProvenance missing`, run)
  assert(sourceComposition && typeof sourceComposition === 'object', `${name} sourceComposition missing`, run)
  assert(sampleCount > 0, `${name} sampleCount missing`, { sampleCount, inputSummary, sourceComposition })
  assert(filterThresholds && typeof filterThresholds === 'object', `${name} filterThresholds missing`, run)
  assert(Number(filterThresholds.sampleCount || sampleCount) > 0, `${name} filterThresholds sample count invalid`, filterThresholds)
  return { algorithmType, algorithmVersion, sampleCount }
}

async function main() {
  assert(password, 'ADMIN_PASSWORD is required. Set it in 运维/生产配置/.env.prod or environment.')

  const login = assertApiOk(await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userName, password })
  }), 'login')
  const headers = { authorization: `Bearer ${login.token}` }

  const health = assertApiOk(await request('/api/omics/health', { headers }), 'omics health')
  assert(health.status === 'ok', 'omics proxy is not ok', health)
  assert(health.upstream?.status === 'ok', 'omics upstream is not ok', health)

  const catalog = assertApiOk(await request('/api/omics/modules/catalog', { headers }), 'module catalog')
  assert(Array.isArray(catalog) && catalog.length === 22, 'catalog must contain 22 modules', catalog?.length)
  for (const id of ['svm', 'pca', 'random-forest', 'kegg']) {
    const module = catalog.find((item) => item.id === id)
    assert(module, `missing catalog module ${id}`)
    assert(Array.isArray(module.parameterSchema) && module.parameterSchema.length > 0, `${id} has no parameter schema`)
  }
  const svmSchema = catalog.find((item) => item.id === 'svm').parameterSchema

  const allModuleRuns = []
  for (const module of catalog) {
    const run = assertApiOk(await request('/api/omics/modules/run', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        moduleId: module.id,
        trait: '泌乳量',
        repositoryId: 'omics-datasets',
        groupBy: 'phenotype_group',
        parameters: {
          parameterSchemaSnapshot: module.parameterSchema,
          clientSubmittedAt: new Date().toISOString(),
          inputRepositories: ['组学数据矩阵'],
          moduleInputs: module.inputs || [],
          moduleOutput: module.output || ''
        }
      })
    }), `${module.id} run`)
    assert(run.status === '已完成', `${module.id} did not complete`, run)
    assert(Array.isArray(run.metrics) && run.metrics.length > 0, `${module.id} metrics missing`, run)
    assert(run.parameters?.effectiveParameters, `${module.id} effective parameters missing`, run.parameters)
    assert(Array.isArray(run.artifacts), `${module.id} artifacts summary missing`, run)
    assertOmicsMetadata(run, `${module.id} run`)
    allModuleRuns.push(run)
  }

  const svmRun = assertApiOk(await request('/api/omics/modules/run', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      moduleId: 'svm',
      trait: '泌乳量',
      repositoryId: 'omics-datasets',
      groupBy: 'phenotype_group',
      parameters: {
        kernel: 'linear',
        C: 2,
        gamma: 'auto',
        cvFold: 3,
        permutationRepeats: 3,
        probability: true,
        shrinking: true,
        parameterSchemaSnapshot: svmSchema,
        clientSubmittedAt: new Date().toISOString(),
        inputRepositories: ['组学数据矩阵'],
        moduleInputs: ['组学矩阵', '分组标签'],
        moduleOutput: '候选特征和分类性能'
      }
    })
  }), 'svm run')
  const svmParameters = parameterObject(svmRun)
  assert(svmRun.status === '已完成', 'svm run did not complete', svmRun)
  assert(svmParameters.effectiveParameters?.kernel === 'linear', 'svm custom kernel did not reach compute layer', svmParameters)
  assert(Number(svmParameters.effectiveParameters?.C) === 2, 'svm custom C did not reach compute layer', svmParameters)
  assert(Array.isArray(svmRun.artifacts) && svmRun.artifacts.length >= 1, 'svm artifacts missing', svmRun)
  assert(svmRun.operator && svmRun.operator !== 'system', 'svm operator not traced', svmRun)
  assert(Number(svmRun.durationMs || 0) > 0, 'svm duration not traced', svmRun)
  const svmMetadata = assertOmicsMetadata(svmRun, 'svm custom run')

  const workflowRun = assertApiOk(await request('/api/omics/workflows/run', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workflowId: 'production-omics-3step',
      workflowName: '三步组学分析工作流',
      trait: '泌乳量',
      repositoryIds: ['omics-datasets'],
      moduleIds: ['pca', 'random-forest', 'kegg'],
      steps: [
        { moduleId: 'pca', order: 1, parameters: { nComponents: 3, svdSolver: 'randomized', iteratedPower: 5, randomState: 2026 } },
        { moduleId: 'random-forest', order: 2, parameters: { nEstimators: 80, maxDepth: 6, maxFeatures: 'sqrt', cvFold: 3, bootstrap: true, oobScore: true, randomState: 2026 } },
        { moduleId: 'kegg', order: 3, parameters: { topN: 12, minOverlap: 1, fdrCutoff: 0.2 } }
      ],
      parameters: {
        groupBy: 'phenotype_group',
        repositoryTitles: ['组学数据矩阵']
      }
    })
  }), 'workflow run')
  assert(workflowRun.status === '已完成', 'workflow did not complete', workflowRun)
  assert(Array.isArray(workflowRun.moduleRunIds) && workflowRun.moduleRunIds.length === 3, 'workflow module run ids missing', workflowRun)
  assert(workflowRun.operator && workflowRun.operator !== 'system', 'workflow operator not traced', workflowRun)
  assert(Number(workflowRun.durationMs || 0) > 0, 'workflow duration not traced', workflowRun)
  assert(workflowRun.parameters?.effectiveParameters?.steps?.length === 3, 'workflow effective step parameters missing', workflowRun.parameters)
  assert(workflowRun.inputSummary?.sampleCount > 0, 'workflow input summary missing sample count', workflowRun.inputSummary)
  assert(Array.isArray(workflowRun.artifacts) && workflowRun.artifacts.length >= 1, 'workflow artifacts missing', workflowRun)

  const moduleResults = assertApiOk(await request('/api/omics/modules/results?limit=5', { headers }), 'module results')
  const workflowResults = assertApiOk(await request('/api/omics/workflows/results?limit=3', { headers }), 'workflow results')
  assert(Array.isArray(moduleResults) && moduleResults.some((item) => item.id === svmRun.id), 'svm run not found in module results')
  assert(Array.isArray(workflowResults) && workflowResults.some((item) => item.id === workflowRun.id), 'workflow run not found in workflow results')

  const summary = {
    baseUrl,
    health: health.status,
    upstream: health.upstream?.status,
    catalogCount: catalog.length,
    allModuleRuns: allModuleRuns.length,
    svmRunId: svmRun.id,
    svmKernel: svmParameters.effectiveParameters.kernel,
    svmAlgorithmType: svmMetadata.algorithmType,
    svmAlgorithmVersion: svmMetadata.algorithmVersion,
    svmArtifacts: svmRun.artifacts.length,
    workflowRunId: workflowRun.id,
    workflowModuleRuns: workflowRun.moduleRunIds.length,
    workflowArtifacts: workflowRun.artifacts.length,
    workflowOperator: workflowRun.operator,
    workflowDurationMs: workflowRun.durationMs
  }
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error.message)
  if (error.details !== undefined) console.error(JSON.stringify(error.details, null, 2))
  process.exit(1)
})

