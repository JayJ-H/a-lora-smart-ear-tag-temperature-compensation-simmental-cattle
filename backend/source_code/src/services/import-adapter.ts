import * as XLSX from 'xlsx'
import * as databaseService from '@/services/database'
import { buildCowReferenceContext, resolveCowRef, sourceRecordKey } from '@/utils/cow-reference'
import {
  CATTLE_SPECIES_NAME,
  DEFAULT_CATTLE_BREED,
  requireSupportedCattleBreed
} from '@/utils/cattle-breeds'
import { DEFAULT_PHENOTYPE_TRAITS } from '@/views/germplasm/phenotype/trait-definitions'
import {
  getColumnLookup,
  getImportTemplate,
  normalizeColumnName,
  resolveTemplateSystemField,
  type ImportAction,
  type ImportMode,
  type ImportTarget,
  type ImportTemplate,
  type ImportTemplateColumn,
  type ImportTemplateValueOption
} from './import-templates'
import {
  getTemplateDictionaryValueOptions,
  resolveTemplateDictionaryValue
} from './import-template-dictionaries'
import { createImportJobId, hashFile, recordImportAudit, type ImportRowError } from './import-audit'
import { scheduleProductionFactRebuild } from './production-facts'
import {
  ensureAnimalForV2Fk,
  ensureDeviceForSensorFk,
  ensureTraitDefinitionForObservation,
  ensureTraitObservationBatch
} from './v2-canonical-guards'

export interface ParsedImportRow {
  rowIndex: number
  rawRow: Record<string, any>
  mappedRow: Record<string, any>
  resolvedCow: ReturnType<typeof resolveCowRef>
  duplicate: boolean
  duplicateSource?: 'existing' | 'batch'
  mergeMode?: 'insert' | 'append' | 'supplement' | 'update' | 'skip'
  mergeMessage?: string
  existingTargets?: Record<string, any>[]
  skipCommit?: boolean
  errors: ImportRowError[]
}

export interface ImportDryRunResult {
  jobId: string
  mode: ImportMode
  action: ImportAction
  templateCode: string
  target: ImportTarget
  totalRows: number
  validRows: number
  errorRows: number
  duplicateRows: number
  committedRows: number
  skippedRows: number
  targetRecordIds: string[]
  sourceRecordIds: string[]
  cowIds: string[]
  cowNumbers: string[]
  previewRows: Record<string, any>[]
  parsedRows: ParsedImportRow[]
  errors: ImportRowError[]
  startedAt: string
  finishedAt: string
  fileName?: string
  fileHash?: string
}

export interface ImportCommitResult extends ImportDryRunResult {
  committedRows: number
  skippedRows: number
  targetRecordIds: string[]
}

export interface ImportProgressEvent {
  stage:
    | 'read_file'
    | 'prepare'
    | 'parse'
    | 'validate'
    | 'commit'
    | 'flush'
    | 'audit'
    | 'done'
    | 'error'
  message: string
  percent?: number
  current?: number
  total?: number
  tableName?: string
}

type ImportProgressReporter = (event: ImportProgressEvent) => void

interface ImportRunOptions {
  mode: ImportMode
  action?: ImportAction
  templateCode: string
  configId?: string
  inlineAdapterConfig?: Partial<ImportAdapterConfig> | null
  rows: Record<string, any>[]
  file?: File | null
  operatorId?: string
  operatorName?: string
  onProgress?: ImportProgressReporter
}

type ExistingRecordMap = Map<string, Set<string>>
type ExistingRecordIndex = Map<string, Record<string, any>[]>

interface ExistingRecordContext {
  keyMap: ExistingRecordMap
  index: ExistingRecordIndex
  dateOnlyFields: Set<string>
}

const FALLBACK_IMPORT_OPERATOR = '当前用户'

function isPlaceholderOperator(value: unknown) {
  return /导入操作员|批量导入|batch_import|import_operator/i.test(text(value))
}

interface ImportAdapterConfig {
  id: string
  name: string
  scope: string
  templateCode?: string
  fieldMapping?: Record<string, string>
  defaultValues?: Record<string, any>
  skipDuplicates?: boolean
  duplicateKey?: string
  conflictStrategy?: ImportTemplate['conflictStrategy']
  dateFormat?: string
  numberFormat?: string
}

interface ParsedImportFile {
  rows: Record<string, any>[]
  adapterConfig?: Partial<ImportAdapterConfig> | null
}

const targetTableMap: Record<ImportTarget, string[]> = {
  animal_profile: ['animal', 'cows'],
  pedigree: ['animal_parentage', 'cows'],
  trait_observation: ['trait_observation', 'phenotype-records'],
  milk_measurement: [
    'milking_session',
    'milking_visit',
    'milk_measurement',
    'milk-records',
    'animal_event',
    'cow-events',
    'event_movement_detail'
  ],
  milk_summary: ['animal', 'lactation_episode', 'parity_episode', 'fact_lactation_305'],
  animal_event: ['animal_event', 'cow-events'],
  reproduction_event: ['animal_event', 'event_reproduction_detail', 'breeding-events'],
  health_medicine: [
    'animal_event',
    'event_health_detail',
    'event_medicine_detail',
    'veterinary-events'
  ],
  omics_sample: ['omics_samples'],
  omics_dataset: ['omics_datasets', 'omics_dataset_sample', 'omics_markers', 'omics_trait_link'],
  device_sensor: ['device', 'animal_device_assignment', 'sensor_reading', 'sensor-readings']
}

export async function parseImportFile(
  file: File,
  templateCode = '',
  onProgress?: ImportProgressReporter
): Promise<ParsedImportFile> {
  onProgress?.({ stage: 'read_file', message: '读取表格文件', percent: 2 })
  const data = new Uint8Array(await file.arrayBuffer())
  onProgress?.({ stage: 'read_file', message: '解析工作表', percent: 5 })
  const workbook = XLSX.read(data, { type: 'array', cellDates: true })
  const ignoredSheets = new Set([
    '字段映射',
    '系统字段编号',
    '字段说明',
    '字典值',
    '示例行',
    '错误示例'
  ])
  const dataSheetName = workbook.SheetNames.includes('数据填写')
    ? '数据填写'
    : workbook.SheetNames.find((name) => !ignoredSheets.has(name))
  if (!dataSheetName) throw new Error('未找到可导入的数据工作表，请使用模板中的“数据填写”工作表')
  if (ignoredSheets.has(dataSheetName))
    throw new Error('当前工作表不是数据填写页，请上传包含业务数据的表格')
  const sheet = workbook.Sheets[dataSheetName]
  const template = templateCode ? getImportTemplate(templateCode) : null
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' })
  onProgress?.({
    stage: 'read_file',
    message: `读取完成：${rows.length} 行`,
    percent: 8,
    current: rows.length,
    total: rows.length
  })
  return {
    rows,
    adapterConfig: parseWorkbookFieldMapping(workbook, template)
  }
}

export async function dryRunImportFile(
  file: File,
  templateCode: string,
  operatorName = FALLBACK_IMPORT_OPERATOR,
  configId = '',
  onProgress?: ImportProgressReporter
) {
  const parsed = await parseImportFile(file, templateCode, onProgress)
  return dryRunImportRows({
    mode: 'batch',
    templateCode,
    configId,
    inlineAdapterConfig: parsed.adapterConfig,
    rows: parsed.rows,
    file,
    operatorName,
    onProgress
  })
}

export async function commitImportFile(
  file: File,
  templateCode: string,
  operatorName = FALLBACK_IMPORT_OPERATOR,
  configId = '',
  onProgress?: ImportProgressReporter
) {
  const parsed = await parseImportFile(file, templateCode, onProgress)
  return commitImportRows({
    mode: 'batch',
    templateCode,
    configId,
    inlineAdapterConfig: parsed.adapterConfig,
    rows: parsed.rows,
    file,
    operatorName,
    onProgress
  })
}

export async function dryRunImportRows(options: ImportRunOptions): Promise<ImportDryRunResult> {
  return runImport({ ...options, action: 'dry_run' })
}

export async function commitImportRows(options: ImportRunOptions): Promise<ImportCommitResult> {
  return runImport({ ...options, action: 'commit' }) as Promise<ImportCommitResult>
}

async function runImport(options: ImportRunOptions): Promise<ImportCommitResult> {
  const startedAt = new Date().toISOString()
  reportImportProgress(options, {
    stage: 'prepare',
    message: '加载导入模板与字典',
    percent: options.action === 'commit' ? 10 : 12
  })
  const template = getImportTemplate(options.templateCode)
  const adapterConfig = await loadAdapterConfig(
    options.configId,
    template,
    options.inlineAdapterConfig
  )
  const duplicateKeys = duplicateKeysFor(template, adapterConfig)
  const conflictStrategy = conflictStrategyFor(template, adapterConfig)
  reportImportProgress(options, {
    stage: 'prepare',
    message: '读取牛只索引与历史记录',
    percent: options.action === 'commit' ? 14 : 18
  })
  const cowContext = await buildImportCowContext()
  const existingRecordContext = await buildExistingRecordContext(template, duplicateKeys)
  const traitCodes = await loadTraitCodes()
  const dictionaryValueOptions = withRuntimeOperatorOptions(
    template,
    options,
    await getTemplateDictionaryValueOptions(template)
  )
  const parsedRows: ParsedImportRow[] = []
  for (let index = 0; index < options.rows.length; index += 1) {
    parsedRows.push(
      parseRow({
        template,
        adapterConfig,
        duplicateKeys,
        conflictStrategy,
        rawRow: options.rows[index],
        rowIndex: index + 2,
        cowContext,
        existingRecordContext,
        traitCodes,
        dictionaryValueOptions
      })
    )
    if ((index + 1) % 200 === 0 || index + 1 === options.rows.length) {
      reportImportProgress(options, {
        stage: 'parse',
        message: '解析并映射表格行',
        percent: scaledPercent(index + 1, options.rows.length, 20, 42),
        current: index + 1,
        total: options.rows.length
      })
      await yieldToBrowser()
    }
  }
  reportImportProgress(options, {
    stage: 'validate',
    message: '校验重复记录与业务规则',
    percent: options.action === 'commit' ? 44 : 74,
    current: parsedRows.length,
    total: parsedRows.length
  })
  parsedRows.forEach((row) => applyImportOperatorDefaults(row, options))
  markBatchDuplicates(
    parsedRows,
    duplicateKeys,
    conflictStrategy,
    existingRecordContext.dateOnlyFields
  )
  const errors = parsedRows.flatMap((row) => row.errors)
  const validParsedRows = parsedRows.filter(
    (row) => !row.errors.some((error) => error.level === 'error')
  )
  const duplicateRows = parsedRows.filter((row) => row.duplicate).length
  const wouldSkipRows = validParsedRows.filter(
    (row) => row.skipCommit || (row.duplicate && conflictStrategy === 'skip')
  ).length
  const targetRecordIds: string[] = []
  let skippedRows = options.action === 'commit' ? 0 : wouldSkipRows
  let committedRows = 0
  const jobId = createImportJobId()
  reportImportProgress(options, {
    stage: 'prepare',
    message: '计算导入批次指纹',
    percent: options.action === 'commit' ? 46 : 82
  })
  const fileHash = await hashFile(options.file)

  try {
    if (options.action === 'commit') {
      const commitRows = validParsedRows.filter(
        (row) => !(row.skipCommit || (row.duplicate && conflictStrategy === 'skip'))
      )
      skippedRows += validParsedRows.length - commitRows.length
      const ids = await commitRowsWithBulkWrite(
        template,
        commitRows,
        options.mode,
        options.onProgress
      )
      targetRecordIds.push(...ids)
      committedRows += commitRows.length
      if (committedRows && affectsProductionFacts(template.target)) {
        if (options.mode === 'single') {
          void triggerProductionFactsRebuild(template, options.mode)
        } else {
          await triggerProductionFactsRebuild(template, options.mode)
        }
      }
    }

    const finishedAt = new Date().toISOString()
    const previewRows = parsedRows
      .slice(0, 20)
      .map((row) =>
        buildPreviewRow(
          template,
          row,
          row.errors.some((error) => error.level === 'error')
            ? '需修正'
            : row.duplicate
              ? row.mergeMessage || '重复'
              : '可导入',
          row.mergeMessage || mergeModeText(row.mergeMode)
        )
      )
    const cowIds = unique(parsedRows.map((row) => row.resolvedCow.cowId).filter(Boolean))
    const cowNumbers = unique(
      parsedRows
        .map(
          (row) =>
            row.resolvedCow.cowNumber || row.mappedRow.animal_number || row.mappedRow.cow_number
        )
        .filter(Boolean)
    )
    const sourceRecordIds = unique(parsedRows.map((row) => sourceRecordKey(row.mappedRow)))
    const resultParsedRows =
      options.action === 'commit' ? parsedRows.map((row) => compactParsedRow(row)) : parsedRows
    const result: ImportCommitResult = {
      jobId,
      mode: options.mode,
      action: options.action || 'dry_run',
      templateCode: template.code,
      target: template.target,
      totalRows: parsedRows.length,
      validRows: validParsedRows.length,
      errorRows: parsedRows.filter((row) => row.errors.some((error) => error.level === 'error'))
        .length,
      duplicateRows,
      committedRows,
      skippedRows,
      targetRecordIds,
      sourceRecordIds,
      cowIds,
      cowNumbers,
      previewRows,
      parsedRows: resultParsedRows,
      errors,
      startedAt,
      finishedAt,
      fileName: options.file?.name,
      fileHash
    }

    reportImportProgress(options, {
      stage: 'audit',
      message: '写入导入审计',
      percent: options.action === 'commit' ? 98 : 94
    })

    await recordImportAudit({
      jobId: result.jobId,
      mode: result.mode,
      action: result.action,
      templateCode: result.templateCode,
      templateVersion: adapterConfig ? `config:${adapterConfig.id}` : 'builtin-v1',
      target: result.target,
      fileName: result.fileName,
      fileHash: result.fileHash,
      operatorId: options.operatorId,
      operatorName: resolvedOperatorName(options),
      startedAt,
      finishedAt,
      totalRows: result.totalRows,
      validRows: result.validRows,
      committedRows: result.committedRows,
      skippedRows: result.skippedRows,
      errorRows: result.errorRows,
      duplicateRows: result.duplicateRows,
      status: result.errorRows ? 'completed_with_errors' : 'completed',
      configSnapshot: buildConfigSnapshot(adapterConfig, duplicateKeys, conflictStrategy),
      targetTables: template.targetTables,
      targetRecordIds: result.targetRecordIds,
      sourceRecordIds: result.sourceRecordIds,
      cowIds: result.cowIds,
      cowNumbers: result.cowNumbers,
      errors: result.errors,
      previewRows: result.previewRows
    })
    reportImportProgress(options, {
      stage: 'done',
      message: options.action === 'commit' ? '提交完成' : '预检完成',
      percent: 100,
      current: committedRows || validParsedRows.length,
      total:
        options.action === 'commit' ? committedRows || validParsedRows.length : parsedRows.length
    })

    return result
  } catch (error) {
    const finishedAt = new Date().toISOString()
    await recordImportAudit({
      jobId,
      mode: options.mode,
      action: options.action || 'dry_run',
      templateCode: template.code,
      templateVersion: adapterConfig ? `config:${adapterConfig.id}` : 'builtin-v1',
      target: template.target,
      fileName: options.file?.name,
      fileHash,
      operatorId: options.operatorId,
      operatorName: resolvedOperatorName(options),
      startedAt,
      finishedAt,
      totalRows: parsedRows.length,
      validRows: validParsedRows.length,
      committedRows,
      skippedRows,
      errorRows: errors.length,
      duplicateRows,
      status: committedRows ? 'partial_failed' : 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      configSnapshot: buildConfigSnapshot(adapterConfig, duplicateKeys, conflictStrategy),
      targetTables: template.targetTables,
      targetRecordIds,
      sourceRecordIds: unique(parsedRows.map((row) => sourceRecordKey(row.mappedRow))),
      cowIds: unique(parsedRows.map((row) => row.resolvedCow.cowId).filter(Boolean)),
      cowNumbers: unique(
        parsedRows
          .map(
            (row) =>
              row.resolvedCow.cowNumber || row.mappedRow.animal_number || row.mappedRow.cow_number
          )
          .filter(Boolean)
      ),
      errors,
      previewRows: parsedRows.slice(0, 20).map((row) => buildPreviewRow(template, row, '写入失败'))
    })
    reportImportProgress(options, {
      stage: 'error',
      message: error instanceof Error ? error.message : String(error),
      percent: 100
    })
    throw error
  }
}

function reportImportProgress(
  options: Pick<ImportRunOptions, 'onProgress'>,
  event: ImportProgressEvent
) {
  options.onProgress?.({
    ...event,
    percent: clampPercent(event.percent)
  })
}

function scaledPercent(current: number, total: number, start: number, end: number) {
  if (!total) return start
  return start + (Math.min(current, total) / total) * (end - start)
}

function clampPercent(value: unknown) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return undefined
  return Math.max(0, Math.min(100, Math.round(numberValue)))
}

function buildPreviewRow(
  template: ImportTemplate,
  row: ParsedImportRow,
  status: string,
  writeMode?: string
) {
  const preview: Record<string, any> = {
    行号: row.rowIndex,
    牛号:
      row.resolvedCow.cowNumber || row.mappedRow.animal_number || row.mappedRow.cow_number || '',
    目标: template.name,
    状态: status
  }
  if (writeMode) preview.写入方式 = writeMode

  for (const column of template.columns) {
    const label = column.label || column.key
    if (!label || preview[label] !== undefined) continue
    const value = firstPresentValue(row.mappedRow, [
      column.targetField,
      column.key,
      ...(column.aliases || [])
    ])
    if (value !== undefined && value !== null && value !== '') preview[label] = value
  }
  const mappedFields = template.columns
    .map((column) => column.targetField)
    .filter((field) => field && !isEmpty(row.mappedRow[field]))
  if (mappedFields.length) preview.系统字段 = unique(mappedFields).join(', ')

  return preview
}

function parseRow(input: {
  template: ImportTemplate
  adapterConfig?: ImportAdapterConfig | null
  duplicateKeys: string[]
  conflictStrategy: ImportTemplate['conflictStrategy']
  rawRow: Record<string, any>
  rowIndex: number
  cowContext: ReturnType<typeof buildCowReferenceContext>
  existingRecordContext: ExistingRecordContext
  traitCodes: Set<string>
  dictionaryValueOptions: ImportTemplateValueOption[]
}): ParsedImportRow {
  const mappedRow = mapRawRow(input.template, input.rawRow, input.adapterConfig)
  const resolvedCow = resolveCowRef(mappedRow, input.cowContext)
  const errors: ImportRowError[] = []

  errors.push(
    ...validateAdapterFieldMapping(
      input.template,
      input.adapterConfig,
      input.rowIndex,
      input.rawRow
    )
  )
  errors.push(
    ...resolveDictionaryValues(
      input.template,
      mappedRow,
      input.dictionaryValueOptions,
      input.rowIndex,
      input.rawRow
    )
  )

  input.template.columns.forEach((column) => {
    if (!column.required) return
    if (isEmpty(mappedRow[column.targetField]) && isEmpty(mappedRow[column.key])) {
      errors.push(
        rowError(input.rowIndex, column, 'REQUIRED', `${column.label}不能为空`, input.rawRow)
      )
    }
  })

  input.template.columns.forEach((column) => {
    const value = mappedRow[column.targetField]
    if (isEmpty(value)) return
    const converted = convertValue(value, column, input.adapterConfig)
    if (converted.error) {
      errors.push(
        rowError(
          input.rowIndex,
          column,
          'TYPE_INVALID',
          `${column.label}格式不正确`,
          input.rawRow,
          converted.suggestion
        )
      )
      return
    }
    mappedRow[column.targetField] = converted.value
    if (
      !column.optionSource &&
      column.options?.length &&
      !column.options.map((option) => text(option)).includes(text(converted.value))
    ) {
      errors.push(
        rowError(
          input.rowIndex,
          column,
          'DICT_INVALID',
          `${column.label}不在允许值范围内`,
          input.rawRow,
          `可选：${column.options.slice(0, 12).join('、')}`
        )
      )
    }
  })

  const eventCode =
    input.template.target === 'animal_event' ||
    input.template.target === 'reproduction_event' ||
    input.template.target === 'health_medicine'
      ? normalizeImportEventCode(
          mappedRow.event_type ||
            mappedRow.eventCode ||
            mappedRow.eventType ||
            mappedRow.reproduction_action
        )
      : ''
  const allowsNewAnimalByEntry = input.template.target === 'animal_event' && eventCode === 'entry'
  const allowsNewAnimalByPedigree = input.template.target === 'pedigree'
  if (allowsNewAnimalByEntry && resolvedCow.resolved) {
    errors.push({
      rowIndex: input.rowIndex,
      column: '牛号',
      targetField: 'cow',
      level: 'error',
      code: 'ENTRY_COW_ALREADY_EXISTS',
      message: '入群是新牛建档，牛号已存在；已在群牛只请使用转群或离群',
      suggestion: '换用未占用的新牛号，或改为转群事件',
      rawRow: input.rawRow
    })
  }
  if (
    needsCow(input.template.target) &&
    !resolvedCow.resolved &&
    !allowsNewAnimalByEntry &&
    !allowsNewAnimalByPedigree
  ) {
    errors.push({
      rowIndex: input.rowIndex,
      column: '牛号',
      targetField: 'cow',
      level: input.template.target === 'animal_profile' ? 'warning' : 'error',
      code: 'COW_NOT_FOUND',
      message:
        input.template.target === 'animal_profile'
          ? '未匹配到现有牛只，将作为新牛只档案导入'
          : '未匹配到现有牛只，请先导入个体档案或修正牛号',
      suggestion: '检查牛号；新牛只先导入个体档案',
      rawRow: input.rawRow
    })
  }

  if (
    input.template.target === 'trait_observation' &&
    !input.traitCodes.has(String(mappedRow.trait_code || '').trim())
  ) {
    errors.push({
      rowIndex: input.rowIndex,
      column: '性状编码',
      targetField: 'trait_code',
      level: 'error',
      code: 'TRAIT_NOT_FOUND',
      message: '性状编码未在性状词典中启用',
      suggestion: '请先在平台管理 / 性状词典维护该性状编码',
      rawRow: input.rawRow
    })
  }

  errors.push(
    ...normalizeSystemControlledFields(
      input.template,
      mappedRow,
      resolvedCow,
      input.rowIndex,
      input.rawRow
    )
  )
  fillCowFields(mappedRow, resolvedCow)
  errors.push(
    ...validateBusinessRules(input.template, mappedRow, resolvedCow, input.rowIndex, input.rawRow)
  )
  const existingTargets = findExistingTargets(
    input.duplicateKeys,
    mappedRow,
    input.existingRecordContext
  )
  const duplicate = existingTargets.length > 0
  if (duplicate && input.conflictStrategy === 'reject') {
    errors.push({
      rowIndex: input.rowIndex,
      column: '重复记录',
      targetField: input.duplicateKeys.join(','),
      level: 'error',
      code: 'DUPLICATE',
      message: '该记录与数据库已有记录重复',
      suggestion: '修改去重字段或调整模板冲突策略',
      rawRow: input.rawRow
    })
  }

  const mergeMode = classifyImportMergeMode(input.template, mappedRow, existingTargets, duplicate)
  return {
    rowIndex: input.rowIndex,
    rawRow: input.rawRow,
    mappedRow,
    resolvedCow,
    duplicate,
    duplicateSource: duplicate ? 'existing' : undefined,
    mergeMode,
    mergeMessage: mergeModeMessage(mergeMode),
    existingTargets,
    errors
  }
}

function resolveDictionaryValues(
  template: ImportTemplate,
  mappedRow: Record<string, any>,
  dictionaryValueOptions: ImportTemplateValueOption[],
  rowIndex: number,
  rawRow: Record<string, any>
): ImportRowError[] {
  const errors: ImportRowError[] = []
  template.columns.forEach((column) => {
    const keys = unique([
      column.targetField,
      column.key,
      toSnake(column.targetField),
      toCamel(column.targetField)
    ])
    const keyWithValue = keys.find((key) => !isEmpty(mappedRow[key]))
    if (!keyWithValue) return
    const resolved = resolveTemplateDictionaryValue(
      column,
      mappedRow[keyWithValue],
      dictionaryValueOptions
    )
    if (!resolved.hasOptions) return
    if (resolved.error) {
      if (column.optionSource === 'operator') return
      errors.push(
        rowError(
          rowIndex,
          column,
          'DICT_VALUE_INVALID',
          `${column.label}不在允许值范围内`,
          rawRow,
          resolved.suggestion
        )
      )
      return
    }
    keys.forEach((key) => {
      if (mappedRow[key] !== undefined && mappedRow[key] !== null && text(mappedRow[key]) !== '') {
        mappedRow[key] = resolved.value
      }
    })
    mappedRow[column.targetField] = resolved.value
    mappedRow[column.key] = resolved.value
    mappedRow[toSnake(column.targetField)] = resolved.value
    mappedRow[toCamel(column.targetField)] = resolved.value
  })
  return errors
}

function withRuntimeOperatorOptions(
  template: ImportTemplate,
  options: ImportRunOptions,
  dictionaryValueOptions: ImportTemplateValueOption[]
) {
  const operatorName = resolvedOperatorName(options)
  const operatorId = text(options.operatorId)
  if (!operatorName || isPlaceholderOperator(operatorName)) return dictionaryValueOptions

  const existingKeys = new Set(
    dictionaryValueOptions.map((option) =>
      [option.fieldKey, option.targetField, option.number, option.value, ...(option.aliases || [])]
        .map(text)
        .join('::')
    )
  )
  const nextOptions = [...dictionaryValueOptions]
  template.columns
    .filter((column) => column.optionSource === 'operator')
    .forEach((column) => {
      const fieldOptions = nextOptions.filter(
        (option) => option.targetField === column.targetField || option.fieldKey === column.key
      )
      const alreadyPresent = fieldOptions.some((option) =>
        [option.value, option.label, ...(option.aliases || [])].some(
          (candidate) =>
            text(candidate) === operatorName || (operatorId && text(candidate) === operatorId)
        )
      )
      if (alreadyPresent) return
      const option: ImportTemplateValueOption = {
        fieldKey: column.key,
        fieldLabel: column.label,
        targetField: column.targetField,
        fieldSection: column.section || '',
        source: 'operator',
        number: String(fieldOptions.length + 1),
        value: operatorName,
        label: operatorName,
        aliases: unique([operatorId, operatorName]),
        description: 'runtime operator'
      }
      const key = [
        option.fieldKey,
        option.targetField,
        option.number,
        option.value,
        ...(option.aliases || [])
      ]
        .map(text)
        .join('::')
      if (!existingKeys.has(key)) {
        nextOptions.push(option)
        existingKeys.add(key)
      }
    })
  return nextOptions
}

function mapRawRow(
  template: ImportTemplate,
  rawRow: Record<string, any>,
  adapterConfig?: ImportAdapterConfig | null
) {
  const lookup = getColumnLookup(template)
  const mapped: Record<string, any> = {}
  Object.entries(rawRow || {}).forEach(([key, value]) => {
    const column = lookup.get(normalizeColumnName(key))
    if (!column) {
      mapped[key] = value
      return
    }
    mapped[column.targetField] = value
    mapped[column.key] = value
  })
  Object.entries(adapterConfig?.fieldMapping || {}).forEach(([externalColumn, targetField]) => {
    const resolvedTargetField = resolveTemplateSystemField(template, targetField)
    if (!resolvedTargetField) return
    const sourceValue =
      rawRow[externalColumn] ??
      rawRow[normalizeColumnName(externalColumn)] ??
      mapped[externalColumn]
    if (sourceValue !== undefined && sourceValue !== null && sourceValue !== '') {
      mapped[resolvedTargetField] = sourceValue
      mapped[toSnake(resolvedTargetField)] = sourceValue
      mapped[toCamel(resolvedTargetField)] = sourceValue
    }
  })
  Object.entries(adapterConfig?.defaultValues || {}).forEach(([field, value]) => {
    if (mapped[field] === undefined || mapped[field] === null || mapped[field] === '') {
      mapped[field] = value
      mapped[toSnake(field)] = value
      mapped[toCamel(field)] = value
    }
  })
  return mapped
}

const systemDerivedImportFields = [
  'age_months',
  'ageMonths',
  'reported_age_months',
  'reportedAgeMonths',
  'parity',
  'parity_no',
  'parityNo',
  'reported_parity_no',
  'reportedParityNo',
  'parity_calving_date',
  'parityCalvingDate',
  'calving_date',
  'calvingDate',
  'latestCalvingDate',
  'lactation_start_date',
  'lactationStartDate',
  'startMilkingDate',
  'lactation_end_date',
  'lactationEndDate',
  'dryOffDate',
  'days_in_milk',
  'daysInMilk',
  'DIM',
  'dim',
  'reported_days_in_milk',
  'reportedDaysInMilk',
  'lactation_month',
  'lactationMonth',
  'reported_lactation_month',
  'reportedLactationMonth',
  'parity_yield',
  'parityYield',
  'reported_parity_yield',
  'reportedParityYield',
  'milk_yield_305',
  'milkYield305',
  'milk305',
  'milk_305',
  'reported_milk_305',
  'reportedMilk305',
  'avg_daily_milk',
  'avgDailyMilk',
  'reported_avg_daily_milk',
  'reportedAvgDailyMilk'
]

const milkImportUnitState = new Map<string, string>()
const milkImportUnitEventState = new Set<string>()
const importAnimalFkCache = new Map<string, ReturnType<typeof ensureAnimalForV2Fk>>()
const IMPORT_COMMIT_GROUP_CONCURRENCY = 8

interface ImportPeriodResolution {
  parityNo: number | undefined
  daysInMilk: number | undefined
  source: string
}

let importPeriodRowsCache: {
  lactationRows: any[]
  parityRows: any[]
  animalEvents: any[]
  cowEvents: any[]
  breedingEvents: any[]
} | null = null
const importPeriodWindowCache = new Map<string, { lactationWindows: any[]; parityWindows: any[] }>()
const importCalvingEventsCache = new Map<
  string,
  { eventCode: string; time: number; eventDate: string; parityNo: number }[]
>()
const importPeriodResultCache = new Map<string, ImportPeriodResolution>()

function resetImportDerivedCaches() {
  milkImportUnitState.clear()
  milkImportUnitEventState.clear()
  importAnimalFkCache.clear()
  importPeriodRowsCache = null
  importPeriodWindowCache.clear()
  importCalvingEventsCache.clear()
  importPeriodResultCache.clear()
}

async function ensureAnimalForImport(row: ParsedImportRow) {
  const key =
    row.resolvedCow.cowId ||
    row.resolvedCow.cowNumber ||
    row.resolvedCow.sourceKey ||
    text(row.mappedRow.animal_number || row.mappedRow.cow_number)
  if (key && importAnimalFkCache.has(key)) return importAnimalFkCache.get(key)!
  const animalPromise = ensureAnimalForV2Fk(row.resolvedCow, row.mappedRow).catch((error) => {
    if (key) importAnimalFkCache.delete(key)
    throw error
  })
  if (key) importAnimalFkCache.set(key, animalPromise)
  return animalPromise
}

function stripSystemDerivedImportFields(
  template: ImportTemplate,
  row: Record<string, any>,
  rowIndex: number,
  rawRow: Record<string, any>
): ImportRowError[] {
  if (
    !['animal_profile', 'trait_observation', 'milk_measurement', 'milk_summary'].includes(
      template.target
    )
  )
    return []
  const ignored = stripFields(row, systemDerivedImportFields)
  if (!ignored.length) return []
  return [
    warning(
      rowIndex,
      '系统计算字段',
      'SYSTEM_DERIVED_FIELD_IGNORED',
      '导入表只接收原始事实；生产周期和统计指标由系统按事件与测量明细自动计算，已忽略上传的派生值',
      rawRow,
      `${ignored.length} 个派生字段`
    )
  ]
}

function firstPresentValue(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    if (!key) continue
    if (!isEmpty(row[key])) return row[key]
  }
  return undefined
}

function validateAdapterFieldMapping(
  template: ImportTemplate,
  adapterConfig: ImportAdapterConfig | null | undefined,
  rowIndex: number,
  rawRow: Record<string, any>
): ImportRowError[] {
  const errors: ImportRowError[] = []
  Object.entries(adapterConfig?.fieldMapping || {}).forEach(([externalColumn, targetField]) => {
    if (!targetField) return
    const resolved = resolveTemplateSystemField(template, targetField)
    if (resolved) return
    errors.push({
      rowIndex,
      column: externalColumn,
      targetField: String(targetField),
      level: 'error',
      code: 'SYSTEM_FIELD_INVALID',
      message: `系统内字段不存在：${targetField}`,
      suggestion: '请在模板“系统字段编号”工作表中选择编号，例如 1、2、3',
      rawRow
    })
  })
  return errors
}

function convertValue(
  value: unknown,
  column: ImportTemplateColumn,
  adapterConfig?: ImportAdapterConfig | null
): { value: unknown; error?: boolean; suggestion?: string } {
  if (column.type === 'number') {
    const numberValue = Number(normalizeNumberText(value, adapterConfig?.numberFormat))
    if (!Number.isFinite(numberValue))
      return { value, error: true, suggestion: '填写数字，例如 12.5' }
    return { value: numberValue }
  }
  if (column.type === 'date' || column.type === 'datetime') {
    const date =
      value instanceof Date ? value : parseDateWithFormat(value, adapterConfig?.dateFormat)
    if (!Number.isFinite(date.getTime()))
      return { value, error: true, suggestion: '填写日期，例如 2026-06-04' }
    return { value: column.type === 'date' ? formatLocalDate(date) : formatLocalDateTime(date) }
  }
  if (column.type === 'json') {
    if (typeof value === 'object') return { value }
    try {
      return { value: JSON.parse(String(value)) }
    } catch {
      return { value, error: true, suggestion: '填写合法 JSON' }
    }
  }
  return { value: String(value ?? '').trim() }
}

function normalizeNumberText(value: unknown, numberFormat?: string) {
  const raw = String(value ?? '').trim()
  if (!raw) return raw
  if (numberFormat === 'comma_decimal') return raw.replace(/\./g, '').replace(',', '.')
  return raw.replace(/,/g, '')
}

function parseDateWithFormat(value: unknown, dateFormat?: string) {
  const raw = String(value ?? '').trim()
  if (!raw) return new Date(Number.NaN)
  if (dateFormat === 'DD/MM/YYYY' || dateFormat === 'DD-MM-YYYY') {
    const [day, month, year] = raw.split(/[/-]/).map((item) => Number(item))
    if (year && month && day) return new Date(Date.UTC(year, month - 1, day))
  }
  if (dateFormat === 'MM/DD/YYYY' || dateFormat === 'MM-DD-YYYY') {
    const [month, day, year] = raw.split(/[/-]/).map((item) => Number(item))
    if (year && month && day) return new Date(Date.UTC(year, month - 1, day))
  }
  if (dateFormat === 'YYYY/MM/DD' || dateFormat === 'YYYY-MM-DD') {
    const [year, month, day] = raw.split(/[/-]/).map((item) => Number(item))
    if (year && month && day) return new Date(Date.UTC(year, month - 1, day))
  }
  return new Date(raw)
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatLocalDateTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${formatLocalDate(date)} ${hours}:${minutes}:${seconds}`
}

async function buildExistingRecordContext(
  template: ImportTemplate,
  duplicateKeys: string[]
): Promise<ExistingRecordContext> {
  const keyMap: ExistingRecordMap = new Map()
  const index: ExistingRecordIndex = new Map()
  const dateOnlyFields = duplicateDateOnlyFieldsFor(template)
  if (template.target === 'milk_measurement') {
    duplicateKeys.forEach((key) => {
      const normalized = text(key)
      if (!normalized) return
      dateOnlyFields.add(normalized)
      dateOnlyFields.add(toCamel(normalized))
      dateOnlyFields.add(toSnake(normalized))
      ;(duplicateKeyAliases[normalized] || []).forEach((alias) => {
        dateOnlyFields.add(alias)
        dateOnlyFields.add(toCamel(alias))
        dateOnlyFields.add(toSnake(alias))
      })
    })
    ;[
      'measured_at',
      'measuredAt',
      'milking_time',
      'milkingTime',
      'production_date',
      'productionDate'
    ].forEach((field) => dateOnlyFields.add(field))
  }
  const tables = targetTableMap[template.target] || template.targetTables
  await Promise.all(
    tables.map(async (table) => {
      const rows = await databaseService.getTableDataAsync(table, { silent: true }).catch(() => [])
      const keys = new Set<string>()
      rows.forEach((row: any) => {
        const normalizedRow = normalizeDuplicateSourceRow(table, row)
        const duplicateKey = duplicateKeyOf(duplicateKeys, normalizedRow, dateOnlyFields)
        if (duplicateKey) keys.add(duplicateKey)
        if (duplicateKey) {
          const existing = index.get(duplicateKey) || []
          existing.push({ ...normalizedRow, __table: table })
          index.set(duplicateKey, existing)
        }
      })
      keyMap.set(table, keys)
    })
  )
  return { keyMap, index, dateOnlyFields }
}

async function buildImportCowContext() {
  const [cows, animals, identifiers] = await Promise.all([
    databaseService.getTableDataAsync('cows', { silent: true }).catch(() => []),
    databaseService.getTableDataAsync('animal', { silent: true }).catch(() => []),
    databaseService.getTableDataAsync('animal_identifier', { silent: true }).catch(() => [])
  ])
  return buildCowReferenceContext([...(cows || []), ...(animals || [])], identifiers || [])
}

function isDuplicate(
  duplicateKeys: string[],
  mappedRow: Record<string, any>,
  context: ExistingRecordContext
) {
  const duplicateKey = duplicateKeyOf(duplicateKeys, mappedRow, context.dateOnlyFields)
  if (!duplicateKey) return false
  return Array.from(context.keyMap.values()).some((keys) => keys.has(duplicateKey))
}

function findExistingTargets(
  duplicateKeys: string[],
  mappedRow: Record<string, any>,
  context: ExistingRecordContext
) {
  const duplicateKey = duplicateKeyOf(duplicateKeys, mappedRow, context.dateOnlyFields)
  if (!duplicateKey) return []
  return context.index.get(duplicateKey) || []
}

function classifyImportMergeMode(
  template: ImportTemplate,
  mappedRow: Record<string, any>,
  existingTargets: Record<string, any>[],
  duplicate: boolean
): ParsedImportRow['mergeMode'] {
  if (!duplicate) return template.target === 'pedigree' ? 'append' : 'insert'
  if (!existingTargets.length) return 'update'
  if (template.target === 'pedigree') return classifyPedigreeMergeMode(mappedRow, existingTargets)
  if (template.target === 'milk_measurement')
    return classifyFieldSupplementMergeMode(mappedRow, existingTargets, [
      'fat_percent',
      'protein_percent',
      'lactose_percent',
      'somatic_cell_count',
      'milk_flow_avg',
      'milk_flow_peak',
      'conductivity',
      'recorded_at',
      'work_operator_name',
      'operator_name'
    ])
  return classifyFieldSupplementMergeMode(mappedRow, existingTargets, Object.keys(mappedRow))
}

function classifyPedigreeMergeMode(
  mappedRow: Record<string, any>,
  existingTargets: Record<string, any>[]
): ParsedImportRow['mergeMode'] {
  const wantsSire = text(mappedRow.sire_number)
  const wantsDam = text(mappedRow.dam_number)
  const hasSire = existingTargets.some(
    (row) =>
      text(row.parent_role || row.parentRole) === 'sire' || text(row.sire_number || row.sireNumber)
  )
  const hasDam = existingTargets.some(
    (row) =>
      text(row.parent_role || row.parentRole) === 'dam' || text(row.dam_number || row.damNumber)
  )
  if ((wantsSire && !hasSire) || (wantsDam && !hasDam)) return 'supplement'
  return 'update'
}

function classifyFieldSupplementMergeMode(
  mappedRow: Record<string, any>,
  existingTargets: Record<string, any>[],
  fields: string[]
): ParsedImportRow['mergeMode'] {
  const hasSupplement = fields.some(
    (field) =>
      !isEmpty(mappedRow[field]) &&
      existingTargets.some((row) => isEmpty(duplicateValue(row, field)))
  )
  if (hasSupplement) return 'supplement'
  const hasConflict = fields.some((field) => {
    const next = text(mappedRow[field])
    if (!next) return false
    return existingTargets.some((row) => {
      const current = text(duplicateValue(row, field))
      return current && current !== next
    })
  })
  return hasConflict ? 'update' : 'update'
}

function mergeModeMessage(mode: ParsedImportRow['mergeMode']) {
  if (mode === 'insert') return '新增记录'
  if (mode === 'append') return '追加关系'
  if (mode === 'supplement') return '补充字段'
  if (mode === 'update') return '更新已有'
  if (mode === 'skip') return '跳过重复'
  return ''
}

function mergeModeText(mode: ParsedImportRow['mergeMode']) {
  return mergeModeMessage(mode)
}

function markBatchDuplicates(
  rows: ParsedImportRow[],
  duplicateKeys: string[],
  conflictStrategy: ImportTemplate['conflictStrategy'],
  dateOnlyFields = new Set<string>()
) {
  const groups = new Map<string, ParsedImportRow[]>()
  rows.forEach((row) => {
    const key = duplicateKeyOf(duplicateKeys, row.mappedRow, dateOnlyFields)
    if (!key) return
    groups.set(key, [...(groups.get(key) || []), row])
  })

  groups.forEach((items) => {
    if (items.length < 2) return
    items.forEach((row, index) => {
      row.duplicate = true
      row.duplicateSource = 'batch'
      if (conflictStrategy === 'reject') {
        row.errors.push({
          rowIndex: row.rowIndex,
          column: '重复记录',
          targetField: duplicateKeys.join(','),
          level: 'error',
          code: 'BATCH_DUPLICATE',
          message: '同一导入文件内存在重复记录',
          suggestion: `请保留一条，或将冲突策略调整为跳过/更新。重复字段：${duplicateKeys.join('、')}`,
          rawRow: row.rawRow
        })
      } else if (conflictStrategy === 'skip' && index > 0) {
        row.skipCommit = true
      } else if (conflictStrategy === 'update' && index < items.length - 1) {
        row.skipCommit = true
      }
    })
  })
}

function duplicateKeyOf(
  duplicateKeys: string[],
  row: Record<string, any>,
  dateOnlyFields = new Set<string>()
) {
  const parts = duplicateKeys.map((key) =>
    normalizeDuplicateKeyValue(key, duplicateValue(row, key), dateOnlyFields)
  )
  if (!parts.length || parts.some((part) => !part)) return ''
  return parts.join('|')
}

function duplicateDateOnlyFieldsFor(template: ImportTemplate) {
  const fields = new Set<string>()
  template.columns.forEach((column) => {
    if (column.type !== 'date') return
    const aliases = [
      column.key,
      column.targetField,
      toCamel(column.key),
      toCamel(column.targetField),
      toSnake(column.key),
      toSnake(column.targetField),
      ...(column.aliases || [])
    ]
    aliases.forEach((alias) => {
      const normalized = text(alias)
      if (!normalized) return
      fields.add(normalized)
      fields.add(toCamel(normalized))
      fields.add(toSnake(normalized))
    })
  })
  return fields
}

function normalizeDuplicateKeyValue(
  key: string,
  value: unknown,
  dateOnlyFields = new Set<string>()
) {
  const raw = text(value)
  if (!raw) return ''
  const keyCandidates = unique([
    key,
    toCamel(key),
    toSnake(key),
    ...(duplicateKeyAliases[key] || [])
  ])
  if (!keyCandidates.some((candidate) => dateOnlyFields.has(candidate))) return raw
  const parsed = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (parsed) {
    const [, year, month, day] = parsed
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  const date = new Date(raw)
  if (!Number.isNaN(date.getTime())) return formatLocalDate(date)
  return raw
}

const duplicateKeyAliases: Record<string, string[]> = {
  animal_number: [
    'animalNumber',
    'animal_number',
    'cowNumber',
    'cow_number',
    'number',
    'earTagNumber',
    'ear_tag_number'
  ],
  cow_number: ['cowNumber', 'cow_number', 'animalNumber', 'animal_number', 'number'],
  animal_id: ['animalId', 'animal_id', 'cowId', 'cow_id'],
  cow_id: ['cowId', 'cow_id', 'animalId', 'animal_id'],
  observed_at: [
    'observedAt',
    'observed_at',
    'collectionDate',
    'collection_date',
    'measuredAt',
    'measured_at'
  ],
  measured_at: [
    'measuredAt',
    'measured_at',
    'milkingTime',
    'milking_time',
    'productionDate',
    'production_date'
  ],
  occurred_at: [
    'occurredAt',
    'occurred_at',
    'eventTime',
    'event_time',
    'eventDate',
    'event_date',
    'createdAt',
    'created_at'
  ],
  event_type: [
    'eventType',
    'event_type',
    'eventCode',
    'event_code',
    'reproductionAction',
    'reproduction_action'
  ],
  event_code: [
    'eventCode',
    'event_code',
    'eventType',
    'event_type',
    'reproductionAction',
    'reproduction_action'
  ],
  reproduction_action: [
    'reproductionAction',
    'reproduction_action',
    'eventType',
    'event_type',
    'eventCode',
    'event_code'
  ],
  shift_name: [
    'shiftName',
    'shift_name',
    'shiftId',
    'shift_id',
    'shift',
    'sessionCode',
    'session_code'
  ],
  trait_code: ['traitCode', 'trait_code', 'code'],
  sire_number: [
    'sireNumber',
    'sire_number',
    'fatherNumber',
    'father_number',
    'parentNumber',
    'parent_number'
  ],
  dam_number: [
    'damNumber',
    'dam_number',
    'motherNumber',
    'mother_number',
    'parentNumber',
    'parent_number'
  ],
  fat_percent: ['fatPercent', 'fat_percent', 'fat'],
  protein_percent: ['proteinPercent', 'protein_percent', 'protein'],
  lactose_percent: ['lactosePercent', 'lactose_percent', 'lactose'],
  somatic_cell_count: ['somaticCellCount', 'somatic_cell_count', 'scc'],
  milk_flow_avg: ['milkFlowAvg', 'milk_flow_avg'],
  milk_flow_peak: ['milkFlowPeak', 'milk_flow_peak'],
  conductivity: ['conductivity'],
  sample_code: ['sampleCode', 'sample_code', 'sampleId', 'sample_id'],
  dataset_code: ['datasetCode', 'dataset_code', 'datasetId', 'dataset_id'],
  marker_code: ['markerCode', 'marker_code', 'markerId', 'marker_id'],
  device_code: ['deviceCode', 'device_code', 'deviceId', 'device_id'],
  metric_code: ['metricCode', 'metric_code', 'metric', 'type']
}

function addMinutesToDateTime(value: string, minutes: unknown) {
  const minuteValue = Number(minutes)
  if (!value || !Number.isFinite(minuteValue) || minuteValue <= 0) return ''
  const base = Date.parse(value)
  if (!Number.isFinite(base)) return ''
  const date = new Date(base + minuteValue * 60000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function duplicateValue(row: Record<string, any>, key: string) {
  const aliases = [
    key,
    toCamel(key),
    toSnake(key),
    ...(duplicateKeyAliases[key] || []),
    ...(duplicateKeyAliases[toSnake(key)] || [])
  ]
  for (const alias of unique(aliases)) {
    const value = row[alias]
    if (value !== undefined && value !== null && text(value)) return value
  }
  return ''
}

function normalizeDuplicateSourceRow(table: string, row: Record<string, any>) {
  const payload = parseJsonObject(row.payload || row.customValues || row.custom_values)
  return {
    ...payload,
    ...row,
    animal_number:
      row.animal_number ||
      row.animalNumber ||
      row.cow_number ||
      row.cowNumber ||
      payload.animal_number ||
      payload.animalNumber ||
      payload.cow_number ||
      payload.cowNumber,
    observed_at:
      row.observed_at ||
      row.observedAt ||
      row.collection_date ||
      row.collectionDate ||
      payload.observed_at ||
      payload.observedAt ||
      payload.collection_date ||
      payload.collectionDate,
    measured_at:
      row.measured_at ||
      row.measuredAt ||
      row.milking_time ||
      row.milkingTime ||
      payload.measured_at ||
      payload.measuredAt ||
      payload.milking_time ||
      payload.milkingTime,
    occurred_at:
      row.occurred_at ||
      row.occurredAt ||
      row.event_time ||
      row.eventTime ||
      row.event_date ||
      row.eventDate ||
      payload.occurred_at ||
      payload.occurredAt ||
      payload.event_time ||
      payload.eventTime ||
      payload.event_date ||
      payload.eventDate,
    event_type:
      row.event_type ||
      row.eventType ||
      row.event_code ||
      row.eventCode ||
      payload.event_type ||
      payload.eventType ||
      payload.event_code ||
      payload.eventCode,
    shift_name:
      row.shift_name ||
      row.shiftName ||
      row.shift_id ||
      row.shiftId ||
      payload.shift_name ||
      payload.shiftName ||
      payload.shift_id ||
      payload.shiftId,
    sourceTable: row.sourceTable || row.source_table || table
  }
}

async function loadAdapterConfig(
  configId: string | undefined,
  template: ImportTemplate,
  inlineConfig?: Partial<ImportAdapterConfig> | null
): Promise<ImportAdapterConfig | null> {
  if (!configId) {
    if (!inlineConfig?.fieldMapping || !Object.keys(inlineConfig.fieldMapping).length) return null
    return {
      id: 'xlsx-field-mapping',
      name: 'XLSX字段映射',
      scope: templateScopeOf(template.code),
      templateCode: template.code,
      fieldMapping: inlineConfig.fieldMapping,
      defaultValues: inlineConfig.defaultValues || {},
      skipDuplicates: false,
      duplicateKey: template.duplicateKeys.join(','),
      conflictStrategy: template.conflictStrategy,
      dateFormat: inlineConfig.dateFormat,
      numberFormat: inlineConfig.numberFormat
    }
  }
  const rows = await databaseService
    .getTableDataAsync('import-configs', { silent: true })
    .catch(() => [])
  const config = rows.find((row: any) => text(row.id) === text(configId)) || null
  if (!config) return null
  const configTemplate = text(config.templateCode)
  if (configTemplate && configTemplate !== template.code) {
    throw new Error(
      `适配规则“${config.name || config.id}”绑定的是 ${configTemplate}，不能用于 ${template.code}`
    )
  }
  const configScope = text(config.scope)
  if (
    configScope &&
    configScope !== templateScopeOf(template.code) &&
    !(configScope === 'cow' && template.code === 'animal-profile')
  ) {
    throw new Error(`适配规则“${config.name || config.id}”分类与当前模板不一致`)
  }
  return config
}

function parseWorkbookFieldMapping(
  workbook: XLSX.WorkBook,
  template?: ImportTemplate | null
): Partial<ImportAdapterConfig> | null {
  const sheet = workbook.Sheets['字段映射']
  if (!sheet) return null
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' })
  const fieldMapping: Record<string, string> = {}
  rows.forEach((row) => {
    const enabled = text(row['是否启用'] ?? row.enabled ?? row.Enable ?? '是')
    if (/^(否|no|false|0|停用)$/i.test(enabled)) return
    const externalColumn = text(
      row['外部列名'] ??
        row['模板列名'] ??
        row.excelCol ??
        row.excel_col ??
        row.sourceColumn ??
        row.source_column
    )
    const rawSystemField =
      row['系统字段说明'] ??
      row['系统内字段'] ??
      row['目标字段'] ??
      row.dbField ??
      row.db_field ??
      row.targetField ??
      row.target_field ??
      row['系统字段编号'] ??
      row['目标字段编号']
    const systemField = template
      ? firstResolvableTemplateSystemField(template, [
          row['系统字段说明'],
          row['系统内字段'],
          row['目标字段'],
          row.dbField,
          row.db_field,
          row.targetField,
          row.target_field,
          row['系统字段编号'],
          row['目标字段编号']
        ])
      : text(rawSystemField)
    if (externalColumn && systemField) fieldMapping[externalColumn] = systemField
  })
  return Object.keys(fieldMapping).length ? { fieldMapping } : null
}

function firstResolvableTemplateSystemField(template: ImportTemplate, values: unknown[]) {
  for (const value of values) {
    const raw = text(value)
    if (!raw) continue
    const direct = resolveTemplateSystemField(template, raw)
    if (direct) return direct
    const parts = raw
      .split(/[\/|｜,，;；\s]+/)
      .map(text)
      .filter(Boolean)
    for (const part of parts) {
      const resolved = resolveTemplateSystemField(template, part)
      if (resolved) return resolved
    }
  }
  return ''
}

function duplicateKeysFor(template: ImportTemplate, adapterConfig?: ImportAdapterConfig | null) {
  const configured = text(adapterConfig?.duplicateKey)
  if (configured)
    return configured
      .split(/[，,;；]/)
      .map((item) => text(item))
      .filter(Boolean)
  return template.duplicateKeys
}

function conflictStrategyFor(
  template: ImportTemplate,
  adapterConfig?: ImportAdapterConfig | null
): ImportTemplate['conflictStrategy'] {
  const configured = text(adapterConfig?.conflictStrategy)
  if (['skip', 'update', 'reject'].includes(configured))
    return configured as ImportTemplate['conflictStrategy']
  if (!adapterConfig) return template.conflictStrategy
  return adapterConfig.skipDuplicates ? 'skip' : 'update'
}

function templateScopeOf(templateCode: string) {
  const map: Record<string, string> = {
    'animal-profile': 'animal',
    pedigree: 'animal',
    'animal-event': 'event',
    'reproduction-event': 'event',
    'health-medicine': 'event',
    'trait-observation': 'phenotype',
    'milk-measurement': 'milk',
    'milk-summary': 'milk',
    'omics-sample': 'omics',
    'omics-dataset': 'omics',
    'device-sensor': 'device'
  }
  return map[templateCode] || 'event'
}

function buildConfigSnapshot(
  adapterConfig: ImportAdapterConfig | null,
  duplicateKeys: string[],
  conflictStrategy: ImportTemplate['conflictStrategy']
) {
  return {
    id: adapterConfig?.id || '',
    name: adapterConfig?.name || '',
    scope: adapterConfig?.scope || '',
    templateCode: adapterConfig?.templateCode || '',
    fieldMapping: adapterConfig?.fieldMapping || {},
    defaultValues: adapterConfig?.defaultValues || {},
    duplicateKeys,
    conflictStrategy,
    dateFormat: adapterConfig?.dateFormat || '',
    numberFormat: adapterConfig?.numberFormat || '',
    updatedAt: (adapterConfig as any)?.updatedAt || ''
  }
}

function resolvedOperatorName(options: Pick<ImportRunOptions, 'operatorName'>) {
  const operatorName = text(options.operatorName)
  return operatorName && !isPlaceholderOperator(operatorName)
    ? operatorName
    : FALLBACK_IMPORT_OPERATOR
}

function applyImportOperatorDefaults(row: ParsedImportRow, options: ImportRunOptions) {
  const rowOperator = text(row.mappedRow.operator_name || row.mappedRow.operatorName)
  if (rowOperator && isPlaceholderOperator(rowOperator)) {
    row.mappedRow.original_operator_name = rowOperator
    row.mappedRow.originalOperatorName = rowOperator
    delete row.mappedRow.operator_name
    delete row.mappedRow.operatorName
  }
  const candidateOperator = text(
    row.mappedRow.operator_name || row.mappedRow.operatorName || options.operatorName
  )
  const operatorName =
    candidateOperator && !(options.mode === 'single' && isPlaceholderOperator(candidateOperator))
      ? candidateOperator
      : FALLBACK_IMPORT_OPERATOR
  const operatorId = text(
    row.mappedRow.operator_id || row.mappedRow.operatorId || options.operatorId
  )
  row.mappedRow.operator_name = operatorName
  row.mappedRow.operatorName = operatorName
  if (operatorId) {
    row.mappedRow.operator_id = operatorId
    row.mappedRow.operatorId = operatorId
  }
  if (options.mode === 'single') {
    row.mappedRow.importMode = 'single'
    row.mappedRow.import_mode = 'single'
    row.mappedRow.sourceType = 'single_entry'
    row.mappedRow.source_type = 'single_entry'
  }
}

function rowOperatorName(row: ParsedImportRow) {
  const operatorName = text(row.mappedRow.operator_name || row.mappedRow.operatorName)
  return operatorName && !isPlaceholderOperator(operatorName)
    ? operatorName
    : FALLBACK_IMPORT_OPERATOR
}

function rowCollectorName(row: ParsedImportRow) {
  return mappedText(row.mappedRow, [
    'work_operator_name',
    'workOperatorName',
    'work_operator',
    'workOperator',
    'field_operator_name',
    'fieldOperatorName',
    'field_operator',
    'fieldOperator',
    '操作人',
    '现场操作人',
    '执行人',
    '兽医',
    '育种员',
    'collector',
    'collector_name',
    'collectorName',
    'sampler',
    'milker',
    'milker_id',
    'milkerId',
    '采集人',
    '采样人',
    '测定人',
    '挤奶员'
  ])
}

function rowWorkOperatorName(row: ParsedImportRow) {
  return rowCollectorName(row)
}

async function writeImportDataQualityIssue(
  row: ParsedImportRow,
  issue: {
    issueCode: string
    issueType: string
    issueLevel: string
    issueStatus: string
    message: string
    detail?: Record<string, any>
  }
) {
  const now = new Date().toISOString()
  const id = stableId(
    'data-quality-issue',
    issue.issueCode,
    row.resolvedCow.cowId || row.resolvedCow.cowNumber || row.resolvedCow.sourceKey,
    row.rowIndex,
    JSON.stringify(issue.detail || {})
  )
  await upsertLike('data_quality_issue', {
    id,
    domain: 'information_import',
    tableName: 'information-import',
    table_name: 'information-import',
    recordId: `pedigree:${row.rowIndex}`,
    record_id: `pedigree:${row.rowIndex}`,
    animalId: row.resolvedCow.cowId,
    animal_id: row.resolvedCow.cowId,
    cowId: row.resolvedCow.cowId,
    cow_id: row.resolvedCow.cowId,
    animalNumber: row.resolvedCow.cowNumber,
    animal_number: row.resolvedCow.cowNumber,
    cowNumber: row.resolvedCow.cowNumber,
    cow_number: row.resolvedCow.cowNumber,
    issueCode: issue.issueCode,
    issue_code: issue.issueCode,
    issueType: issue.issueType,
    issue_type: issue.issueType,
    severity: issue.issueLevel || 'medium',
    issueLevel: issue.issueLevel,
    issue_level: issue.issueLevel,
    issueStatus: issue.issueStatus,
    issue_status: issue.issueStatus,
    status: issue.issueStatus,
    message: issue.message,
    description: issue.message,
    sourceTable: 'information-import',
    source_table: 'information-import',
    sourceRecordId: `pedigree:${row.rowIndex}`,
    source_record_id: `pedigree:${row.rowIndex}`,
    operatorName: rowOperatorName(row),
    operator_name: rowOperatorName(row),
    detail: issue.detail || {},
    detectedAt: now,
    detected_at: now,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
}

async function triggerProductionFactsRebuild(template: ImportTemplate, _mode: ImportMode) {
  scheduleProductionFactRebuild(`information_import:${template.code}`)
}

function affectsProductionFacts(target: ImportTarget) {
  return [
    'trait_observation',
    'milk_measurement',
    'milk_summary',
    'animal_event',
    'reproduction_event',
    'health_medicine'
  ].includes(target)
}

function compactParsedRow(row: ParsedImportRow): ParsedImportRow {
  return {
    rowIndex: row.rowIndex,
    rawRow: row.rawRow,
    mappedRow: row.mappedRow,
    resolvedCow: {
      cowId: row.resolvedCow.cowId,
      cowNumber: row.resolvedCow.cowNumber,
      cowName: row.resolvedCow.cowName,
      resolved: row.resolvedCow.resolved,
      sourceKey: row.resolvedCow.sourceKey,
      originalCowId: row.resolvedCow.originalCowId,
      originalCowNumber: row.resolvedCow.originalCowNumber,
      resolvedBy: row.resolvedCow.resolvedBy,
      identifierType: row.resolvedCow.identifierType
    },
    duplicate: row.duplicate,
    duplicateSource: row.duplicateSource,
    skipCommit: row.skipCommit,
    errors: row.errors
  }
}

async function loadTraitCodes() {
  const [v2Traits, storedTraits] = await Promise.all([
    databaseService.getTableDataAsync('trait_definition', { silent: true }).catch(() => []),
    databaseService
      .getTableDataAsync('phenotype-trait-definitions', { silent: true })
      .catch(() => [])
  ])
  const values = [...DEFAULT_PHENOTYPE_TRAITS, ...v2Traits, ...storedTraits]
  return new Set(
    values.map((item: any) => String(item.code || item.trait_code || '').trim()).filter(Boolean)
  )
}

function normalizeSystemControlledFields(
  template: ImportTemplate,
  mappedRow: Record<string, any>,
  resolvedCow: ReturnType<typeof resolveCowRef>,
  rowIndex: number,
  rawRow: Record<string, any>
): ImportRowError[] {
  const warnings: ImportRowError[] = []
  warnings.push(...stripSystemDerivedImportFields(template, mappedRow, rowIndex, rawRow))
  if (
    [
      'trait_observation',
      'milk_measurement',
      'animal_event',
      'reproduction_event',
      'health_medicine'
    ].includes(template.target)
  ) {
    const ignored = stripFields(mappedRow, [
      'parity',
      'parityNo',
      'parity_no',
      'daysInMilk',
      'days_in_milk',
      'DIM',
      'dim'
    ])
    if (ignored.length) {
      warnings.push(
        warning(
          rowIndex,
          '系统胎次/DIM',
          'SYSTEM_PERIOD_IGNORED',
          '胎次和泌乳天数由系统按产犊周期计算，导入表中的对应字段已忽略',
          rawRow,
          ignored.join('、')
        )
      )
    }
  }

  if (template.target === 'animal_profile') {
    const currentUnit = movementTargetUnit(mappedRow)
    if (currentUnit) {
      stripFields(mappedRow, [
        'current_unit_id',
        'currentUnitId',
        'current_pen_id',
        'currentPenId',
        'unit_id',
        'unitId',
        'pen'
      ])
      warnings.push(
        warning(
          rowIndex,
          '当前圈舍单元',
          'TIMELESS_CURRENT_UNIT_IGNORED',
          '个体档案不再接收无日期的当前圈舍；请用统一事件模板导入入群/转群，或在奶厅测量中随挤奶日期带圈舍',
          rawRow,
          '需要圈舍变更时提供发生日期和目标圈舍'
        )
      )
    }
  }

  if (template.target === 'animal_event') {
    normalizeEventResultFields(mappedRow)
    normalizeCombinedBullAndSemen(mappedRow)
    const eventCode = normalizeImportEventCode(
      mappedRow.event_type ||
        mappedRow.eventCode ||
        mappedRow.eventType ||
        mappedRow.event_result ||
        mappedRow.eventResult
    )
    mappedRow.event_type = eventCode
    mappedRow.eventCode = eventCode
    if (['entry', 'transfer'].includes(eventCode)) {
      const targetUnit = movementTargetUnit(mappedRow)
      mappedRow.to_unit_code = targetUnit
      mappedRow.toUnitCode = targetUnit
      mappedRow.to_unit_id = targetUnit
      mappedRow.toUnitId = targetUnit
      mappedRow.unit_code = targetUnit
      mappedRow.unitCode = targetUnit
      mappedRow.unit_id = targetUnit
      mappedRow.unitId = targetUnit
    } else if (eventCode === 'exit') {
      mappedRow.to_unit_code = ''
      mappedRow.toUnitCode = ''
      mappedRow.to_unit_id = ''
      mappedRow.toUnitId = ''
      mappedRow.unit_code = ''
      mappedRow.unitCode = ''
      mappedRow.unit_id = ''
      mappedRow.unitId = ''
    } else {
      stripFields(mappedRow, ['from_unit_code', 'fromUnitCode', 'to_unit_code', 'toUnitCode'])
    }
    const ignoredFrom = stripFields(mappedRow, [
      'from_unit_code',
      'fromUnitCode',
      'fromPen',
      'from_pen',
      'sourcePen',
      'source_pen'
    ])
    if (ignoredFrom.length) {
      warnings.push(
        warning(
          rowIndex,
          '原圈舍',
          'SOURCE_PEN_IGNORED',
          '原圈舍由牛只当前圈舍自动读取，导入表中的原圈舍字段已忽略',
          rawRow,
          ignoredFrom.join('、')
        )
      )
    }
    if (resolvedCow.resolved && ['entry', 'transfer', 'exit'].includes(eventCode)) {
      mappedRow.current_pen_snapshot = currentPenOf(resolvedCow.cow)
      mappedRow.currentPenSnapshot = mappedRow.current_pen_snapshot
    }
  }

  if (
    template.target === 'reproduction_event' ||
    ['animal_event', 'health_medicine'].includes(template.target)
  ) {
    const eventCode = normalizeImportEventCode(
      mappedRow.event_type ||
        mappedRow.eventCode ||
        mappedRow.eventType ||
        mappedRow.reproduction_action
    )
    if (eventCode === 'insemination') {
      const ignored = stripFields(mappedRow, [
        'insemination_no',
        'inseminationNo',
        'insemination_count',
        'inseminationCount',
        '本胎输精次数'
      ])
      if (ignored.length) {
        warnings.push(
          warning(
            rowIndex,
            '本胎输精次数',
            'SYSTEM_INSEMINATION_COUNT_IGNORED',
            '本胎输精次数由系统按胎次内输精事件统计，导入值已忽略',
            rawRow,
            ignored.join('、')
          )
        )
      }
    }
  }

  return warnings
}

function validateBusinessRules(
  template: ImportTemplate,
  mappedRow: Record<string, any>,
  resolvedCow: ReturnType<typeof resolveCowRef>,
  rowIndex: number,
  rawRow: Record<string, any>
): ImportRowError[] {
  if (!['animal_event', 'reproduction_event', 'health_medicine'].includes(template.target))
    return []
  const eventCode = normalizeImportEventCode(
    mappedRow.event_type ||
      mappedRow.eventCode ||
      mappedRow.eventType ||
      mappedRow.reproduction_action
  )
  const errors: ImportRowError[] = []
  if (eventCode === 'pregnancy_check') {
    const result = text(
      mappedRow.pregnancy_result || mappedRow.pregnancyResult || mappedRow['妊检结果']
    )
    if (result && !['阴性', '阳性'].includes(result)) {
      errors.push(
        simpleError(
          rowIndex,
          '妊检结果',
          'PREGNANCY_RESULT_INVALID',
          '妊检结果只能选择阴性或阳性',
          rawRow,
          '可选：阴性、阳性'
        )
      )
    }
  }
  if (!['entry', 'transfer', 'exit'].includes(eventCode)) return errors

  const currentPen = currentPenOf(resolvedCow.cow)
  const targetUnit = movementTargetUnit(mappedRow)
  if (eventCode === 'entry') {
    if (!targetUnit)
      errors.push(
        simpleError(
          rowIndex,
          '目标圈舍',
          'MOVEMENT_TARGET_REQUIRED',
          '入群事件必须填写目标圈舍',
          rawRow,
          '选择入群后的圈舍单元'
        )
      )
    if (currentPen)
      errors.push(
        simpleError(
          rowIndex,
          '当前圈舍',
          'ENTRY_REQUIRES_EMPTY_PEN',
          '该牛已有当前圈舍，不能按入群写入，请改用转群事件',
          rawRow,
          `当前圈舍：${currentPen}`
        )
      )
  }
  if (eventCode === 'transfer') {
    if (!currentPen)
      errors.push(
        simpleError(
          rowIndex,
          '当前圈舍',
          'TRANSFER_REQUIRES_CURRENT_PEN',
          '转群事件必须先有当前圈舍',
          rawRow,
          '先补入群事件或核对牛只当前圈舍'
        )
      )
    if (!targetUnit)
      errors.push(
        simpleError(
          rowIndex,
          '目标圈舍',
          'MOVEMENT_TARGET_REQUIRED',
          '转群事件必须填写目标圈舍',
          rawRow,
          '选择转入圈舍'
        )
      )
    if (currentPen && targetUnit && currentPen === targetUnit)
      errors.push(
        simpleError(
          rowIndex,
          '目标圈舍',
          'MOVEMENT_TARGET_SAME_AS_CURRENT',
          '目标圈舍不能与当前圈舍相同',
          rawRow,
          `当前圈舍：${currentPen}`
        )
      )
  }
  if ((eventCode === 'exit' || eventCode === 'death') && !currentPen) {
    errors.push(
      simpleError(
        rowIndex,
        '当前圈舍',
        'EXIT_REQUIRES_CURRENT_PEN',
        '离群事件必须先有当前圈舍',
        rawRow,
        '先核对牛只入群或转群记录'
      )
    )
  }
  return errors
}

function stripFields(row: Record<string, any>, fields: string[]) {
  const removed: string[] = []
  fields.forEach((field) => {
    if (row[field] !== undefined && row[field] !== null && row[field] !== '') {
      removed.push(field)
    }
    delete row[field]
  })
  return removed
}

function normalizeImportEventCode(value: unknown): string {
  const raw = text(value)
  const lower = raw.toLowerCase()
  const map: Record<string, string> = {
    妊检阳性: 'pregnancy_check',
    妊检阴性: 'pregnancy_check',
    milking: 'milking',
    泌乳: 'milking',
    milking_session: 'milking_session',
    采奶: 'milking_session',
    milk_quality: 'milk_quality',
    奶质检测: 'milk_quality',
    dhi_test: 'dhi_test',
    dhi: 'dhi_test',
    DHI: 'dhi_test',
    feeding: 'feeding',
    饲喂: 'feeding',
    feed_delivery: 'feed_delivery',
    投料: 'feed_delivery',
    feed_adjustment: 'feed_adjustment',
    日粮调整: 'feed_adjustment',
    weighing: 'weighing',
    称重: 'weighing',
    body_measurement: 'body_measurement',
    体尺测定: 'body_measurement',
    dry_off: 'dry_off',
    停产: 'dry_off',
    干奶: 'dry_off',
    heat: 'heat',
    发情: 'heat',
    入群: 'entry',
    entry: 'entry',
    转群: 'transfer',
    transfer: 'transfer',
    离群: 'exit',
    '离群/淘汰': 'exit',
    出群: 'exit',
    淘汰: 'exit',
    exit: 'exit',
    配种: 'insemination',
    '输精/配种': 'insemination',
    人工授精: 'insemination',
    breeding: 'insemination',
    insemination: 'insemination',
    妊检: 'pregnancy_check',
    妊娠检查: 'pregnancy_check',
    pregnancy_check: 'pregnancy_check',
    产犊: 'calving',
    calving: 'calving',
    delivery: 'calving',
    流产: 'abortion',
    abortion: 'abortion',
    postpartum_check: 'postpartum_check',
    产后检查: 'postpartum_check',
    embryo_transfer: 'embryo_transfer',
    胚胎移植: 'embryo_transfer',
    diagnosis: 'diagnosis',
    诊断: 'diagnosis',
    发病: 'diagnosis',
    treatment: 'treatment',
    治疗: 'treatment',
    medication: 'medication',
    用药: 'medication',
    vaccination: 'vaccination',
    疫苗: 'vaccination',
    免疫: 'vaccination',
    deworming: 'deworming',
    驱虫: 'deworming',
    quarantine: 'quarantine',
    隔离: 'quarantine',
    disinfection: 'disinfection',
    消毒: 'disinfection',
    lab_test: 'lab_test',
    实验室检测: 'lab_test',
    hoof_trim: 'hoof_trim',
    修蹄: 'hoof_trim',
    mastitis_check: 'mastitis_check',
    乳房炎检查: 'mastitis_check',
    死亡: 'death',
    death: 'death',
    sample_collection: 'sample_collection',
    样本采集: 'sample_collection',
    血液: 'sample_collection',
    乳样: 'sample_collection',
    sensor_alert: 'sensor_alert',
    传感器告警: 'sensor_alert',
    device_maintenance: 'device_maintenance',
    设备维护: 'device_maintenance',
    device_assignment: 'device_assignment',
    设备绑定: 'device_assignment',
    device_unassignment: 'device_unassignment',
    设备解绑: 'device_unassignment',
    mating_plan: 'mating_plan',
    选配方案: 'mating_plan',
    semen_check: 'semen_check',
    精液检查: 'semen_check',
    genotyping: 'genotyping',
    基因分型: 'genotyping',
    sequencing: 'sequencing',
    测序: 'sequencing',
    omics_assay: 'omics_assay',
    组学检测: 'omics_assay',
    breeding_value_run: 'breeding_value_run',
    育种值计算: 'breeding_value_run',
    selection_index_update: 'selection_index_update',
    选择指数更新: 'selection_index_update'
  }
  return map[raw] || map[lower] || raw || 'general_event'
}

function normalizeEventResultFields(mappedRow: Record<string, any>) {
  const eventResult = text(
    mappedRow.event_result ||
      mappedRow.eventResult ||
      mappedRow.result ||
      mappedRow.check_result ||
      mappedRow.checkResult ||
      mappedRow.diagnosis_name ||
      mappedRow.diagnosisName
  )
  if (!eventResult) return
  if (/妊检/.test(eventResult) || ['阳性', '阴性'].includes(eventResult)) {
    const pregnancyResult = eventResult.includes('阴性')
      ? '阴性'
      : eventResult.includes('阳性')
        ? '阳性'
        : eventResult
    mappedRow.pregnancy_result = mappedRow.pregnancy_result || pregnancyResult
    mappedRow.pregnancyResult = mappedRow.pregnancyResult || pregnancyResult
  }
  if (
    !mappedRow.diagnosis_name &&
    !mappedRow.diagnosisName &&
    !['阳性', '阴性'].includes(eventResult) &&
    !/妊检/.test(eventResult)
  ) {
    mappedRow.diagnosis_name = eventResult
    mappedRow.diagnosisName = eventResult
  }
  mappedRow.result = mappedRow.result || eventResult
  mappedRow.check_result = mappedRow.check_result || eventResult
  mappedRow.checkResult = mappedRow.checkResult || eventResult
}

function normalizeCombinedBullAndSemen(mappedRow: Record<string, any>) {
  const combined = text(
    mappedRow.bull_or_semen_ref ||
      mappedRow.bullOrSemenRef ||
      mappedRow.bull_number ||
      mappedRow.bullNumber
  )
  if (!combined) return
  if (/精液|semen|批/i.test(combined) && !mappedRow.semen_batch && !mappedRow.semenBatch) {
    mappedRow.semen_batch = combined
    mappedRow.semenBatch = combined
    mappedRow.bull_number = ''
    mappedRow.bullNumber = ''
    return
  }
  mappedRow.bull_number = mappedRow.bull_number || combined
  mappedRow.bullNumber = mappedRow.bullNumber || combined
}

function reproductionLegacyName(eventCode: string) {
  const map: Record<string, string> = {
    heat: '发情',
    insemination: '配种',
    pregnancy_check: '妊娠检查',
    calving: '产犊',
    abortion: '流产',
    postpartum_check: '产后检查',
    embryo_transfer: '胚胎移植'
  }
  return map[eventCode] || eventCode
}

function healthLegacyName(eventCode: string) {
  const map: Record<string, string> = {
    diagnosis: '发病',
    treatment: '治疗',
    medication: '用药',
    vaccination: '免疫',
    deworming: '驱虫',
    quarantine: '隔离',
    disinfection: '消毒',
    lab_test: '实验室检测',
    hoof_trim: '修蹄',
    mastitis_check: '乳房炎检查',
    death: '死亡'
  }
  return map[eventCode] || eventCode
}

function currentPenOf(cow?: Record<string, any>) {
  return text(
    cow?.currentPen ||
      cow?.current_pen ||
      cow?.current_pen_code ||
      cow?.currentPenCode ||
      cow?.current_unit_id ||
      cow?.currentUnitId ||
      cow?.current_unit_code ||
      cow?.currentUnitCode ||
      cow?.unit_id ||
      cow?.unitId ||
      cow?.pen ||
      cow?.penCode ||
      cow?.pen_code
  )
}

function movementTargetUnit(row: Record<string, any>) {
  return text(
    row.to_unit_code ||
      row.toUnitCode ||
      row.to_unit_id ||
      row.toUnitId ||
      row.target_unit_code ||
      row.targetUnitCode ||
      row.target_unit_id ||
      row.targetUnitId ||
      row.unit_code ||
      row.unitCode ||
      row.unit_id ||
      row.unitId ||
      row.targetPen ||
      row.toPen ||
      row.pen
  )
}

function warning(
  rowIndex: number,
  column: string,
  code: string,
  message: string,
  rawRow: Record<string, any>,
  suggestion = ''
): ImportRowError {
  return { rowIndex, column, level: 'warning', code, message, suggestion, rawRow }
}

function simpleError(
  rowIndex: number,
  column: string,
  code: string,
  message: string,
  rawRow: Record<string, any>,
  suggestion = ''
): ImportRowError {
  return { rowIndex, column, level: 'error', code, message, suggestion, rawRow }
}

async function commitMappedRow(template: ImportTemplate, row: ParsedImportRow): Promise<string[]> {
  switch (template.target) {
    case 'animal_profile':
      return commitAnimalProfile(row)
    case 'pedigree':
      return commitPedigree(row)
    case 'trait_observation':
      return commitTraitObservation(row)
    case 'milk_measurement':
      return commitMilkMeasurement(row)
    case 'milk_summary':
      return commitMilkSummary(row)
    case 'animal_event':
    case 'reproduction_event':
    case 'health_medicine':
      return commitEvent(template, row)
    case 'omics_sample':
      return commitOmicsSample(row)
    case 'omics_dataset':
      return commitOmicsDataset(row)
    case 'device_sensor':
      return commitDeviceSensor(row)
    default:
      return []
  }
}

async function commitRowsWithBulkWrite(
  template: ImportTemplate,
  rows: ParsedImportRow[],
  mode: ImportMode,
  onProgress?: ImportProgressReporter
) {
  if (!rows.length) return []
  resetImportDerivedCaches()
  if (mode !== 'batch' || rows.length === 1) {
    const ids: string[] = []
    try {
      for (let index = 0; index < rows.length; index += 1) {
        ids.push(...(await commitMappedRow(template, rows[index])))
        onProgress?.({
          stage: 'commit',
          message: '提交记录',
          percent: scaledPercent(index + 1, rows.length, 50, 82),
          current: index + 1,
          total: rows.length
        })
      }
    } finally {
      resetImportDerivedCaches()
    }
    return ids
  }

  const ids: string[] = []
  const bulkContext = beginImportBulkWrite()
  const tableBulkContext = databaseService.beginTableDataBulkWrite()
  try {
    ids.push(...(await commitMappedRowsGrouped(template, rows, onProgress)))
    await databaseService.flushTableDataBulkWrite(tableBulkContext, (progress) => {
      onProgress?.({
        stage: 'flush',
        message: `写入关联表 ${progress.currentTable}/${progress.totalTables}`,
        percent: scaledPercent(progress.currentTable, progress.totalTables, 78, 84),
        current: progress.currentRows,
        total: progress.totalRows,
        tableName: progress.tableName
      })
    })
    await flushImportBulkWrite(bulkContext, onProgress)
    return ids
  } finally {
    databaseService.endTableDataBulkWrite(tableBulkContext)
    endImportBulkWrite(bulkContext)
    resetImportDerivedCaches()
  }
}

async function commitMappedRowsGrouped(
  template: ImportTemplate,
  rows: ParsedImportRow[],
  onProgress?: ImportProgressReporter
) {
  const groups = groupRowsForCommit(template, rows)
  const ids: string[] = []
  let completedRows = 0
  let lastReportedRows = 0
  let nextGroupIndex = 0
  const workerCount = Math.min(IMPORT_COMMIT_GROUP_CONCURRENCY, groups.length)

  async function report(force = false) {
    if (!force && completedRows - lastReportedRows < 50 && completedRows < rows.length) return
    lastReportedRows = completedRows
    onProgress?.({
      stage: 'commit',
      message: '生成入库记录',
      percent: scaledPercent(completedRows, rows.length, 50, 78),
      current: completedRows,
      total: rows.length
    })
    await yieldToBrowser()
  }

  async function worker() {
    while (nextGroupIndex < groups.length) {
      const group = groups[nextGroupIndex]
      nextGroupIndex += 1
      for (const row of group.rows) {
        ids.push(...(await commitMappedRow(template, row)))
        completedRows += 1
      }
      await report()
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  await report(true)
  return ids
}

function groupRowsForCommit(template: ImportTemplate, rows: ParsedImportRow[]) {
  if (requiresOrderedCowCommit(template)) {
    const groups = new Map<string, ParsedImportRow[]>()
    rows.forEach((row) => {
      const key = commitCowKey(row)
      const groupRows = groups.get(key) || []
      groupRows.push(row)
      groups.set(key, groupRows)
    })
    return Array.from(groups.entries())
      .map(([key, groupRows]) => ({ key, rows: sortRowsForCowCommit(template, groupRows) }))
      .sort((left, right) => right.rows.length - left.rows.length)
  }
  return rows.map((row) => ({ key: String(row.rowIndex), rows: [row] }))
}

function requiresOrderedCowCommit(template: ImportTemplate) {
  return [
    'milk_measurement',
    'trait_observation',
    'animal_event',
    'reproduction_event',
    'health_medicine'
  ].includes(template.target)
}

function commitCowKey(row: ParsedImportRow) {
  return (
    row.resolvedCow.cowId ||
    row.resolvedCow.cowNumber ||
    row.resolvedCow.sourceKey ||
    text(
      row.mappedRow.animal_id ||
        row.mappedRow.animal_number ||
        row.mappedRow.cow_id ||
        row.mappedRow.cow_number
    ) ||
    `row-${row.rowIndex}`
  )
}

function sortRowsForCowCommit(template: ImportTemplate, rows: ParsedImportRow[]) {
  if (template.target !== 'milk_measurement') return rows
  return [...rows].sort((left, right) => {
    const leftTime = parseImportDate(
      left.mappedRow.measured_at || left.mappedRow.milkingTime || left.mappedRow.production_date
    )
    const rightTime = parseImportDate(
      right.mappedRow.measured_at || right.mappedRow.milkingTime || right.mappedRow.production_date
    )
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime)
      return leftTime - rightTime
    return left.rowIndex - right.rowIndex
  })
}

async function addFast(
  tableName: string,
  rows: Record<string, any>[],
  onChunk?: (writtenRows: number, totalRows: number) => void
) {
  const cleanRows = rows.filter(Boolean)
  const chunkSize = 350
  for (let index = 0; index < cleanRows.length; index += chunkSize) {
    await databaseService.addTableDataFastAsync(
      tableName,
      cleanRows.slice(index, index + chunkSize)
    )
    onChunk?.(Math.min(index + chunkSize, cleanRows.length), cleanRows.length)
    await yieldToBrowser()
  }
}

interface ImportBulkWriteContext {
  previous: ImportBulkWriteContext | null
  tables: Map<string, Map<string, Record<string, any>>>
  unkeyed: Map<string, Record<string, any>[]>
}

let activeImportBulkWriteContext: ImportBulkWriteContext | null = null

function beginImportBulkWrite(): ImportBulkWriteContext {
  const context: ImportBulkWriteContext = {
    previous: activeImportBulkWriteContext,
    tables: new Map(),
    unkeyed: new Map()
  }
  activeImportBulkWriteContext = context
  return context
}

function endImportBulkWrite(context: ImportBulkWriteContext) {
  if (activeImportBulkWriteContext === context) {
    activeImportBulkWriteContext = context.previous
  }
}

function enqueueImportBulkWrite(table: string, row: Record<string, any>) {
  const context = activeImportBulkWriteContext
  if (!context) return false
  const id = text(row.id)
  if (!id) {
    const rows = context.unkeyed.get(table) || []
    rows.push(row)
    context.unkeyed.set(table, rows)
    return true
  }

  const rows = context.tables.get(table) || new Map<string, Record<string, any>>()
  const existing = rows.get(id)
  rows.set(id, existing ? mergeImportPatch(existing, row) : row)
  context.tables.set(table, rows)
  return true
}

async function flushImportBulkWrite(
  context: ImportBulkWriteContext,
  onProgress?: ImportProgressReporter
) {
  const tables = unique([...context.tables.keys(), ...context.unkeyed.keys()])
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
    const table = tables[tableIndex]
    const keyedRows = Array.from(context.tables.get(table)?.values() || [])
    const unkeyedRows = context.unkeyed.get(table) || []
    const rows = [...keyedRows, ...unkeyedRows]
    if (!rows.length) continue
    try {
      await addFast(table, rows, (writtenRows, totalRows) => {
        onProgress?.({
          stage: 'flush',
          message: `写入目标表 ${tableIndex + 1}/${tables.length}`,
          percent: scaledPercent(
            tableIndex + writtenRows / Math.max(1, totalRows),
            tables.length,
            84,
            97
          ),
          current: writtenRows,
          total: totalRows,
          tableName: table
        })
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`批量写入 ${table} 失败：${message}`)
    }
  }
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function importAnimalId(row: ParsedImportRow) {
  const resolvedId = text(row.resolvedCow.cowId)
  if (resolvedId && row.resolvedCow.resolved) return resolvedId
  const mappedId = text(row.mappedRow.animal_id || row.mappedRow.cow_id)
  if (mappedId && !text(row.mappedRow.animal_number || row.mappedRow.cow_number)) return mappedId
  return stableId(
    'animal',
    mappedId ||
      row.mappedRow.animal_number ||
      row.mappedRow.cow_number ||
      row.resolvedCow.sourceKey ||
      Date.now()
  )
}

async function commitAnimalProfile(row: ParsedImportRow) {
  const id = importAnimalId(row)
  const now = new Date().toISOString()
  const animalNumber = text(row.mappedRow.animal_number || row.mappedRow.cow_number)
  const entryDate = text(row.mappedRow.entry_date)
  const entryUnit = text(
    row.mappedRow.entry_unit_id ||
      row.mappedRow.entryUnitId ||
      row.mappedRow.to_unit_code ||
      row.mappedRow.toUnitCode ||
      row.mappedRow.to_unit_id ||
      row.mappedRow.toUnitId ||
      row.mappedRow.unit_id ||
      row.mappedRow.unitId
  )
  const entryType = text(
    row.mappedRow.entry_type ||
      row.mappedRow.entryType ||
      row.mappedRow.movement_reason ||
      row.mappedRow.movementReason ||
      '入群'
  )
  const animal = {
    id,
    animalId: id,
    animal_id: id,
    animalNumber,
    animal_number: animalNumber,
    cowId: id,
    cow_id: id,
    cowNumber: animalNumber,
    cow_number: animalNumber,
    earTagNumber: text(row.mappedRow.ear_tag_number),
    ear_tag_number: text(row.mappedRow.ear_tag_number),
    name: text(row.mappedRow.name),
    breed: text(row.mappedRow.breed),
    calfBreed: text(row.mappedRow.calf_breed),
    calf_breed: text(row.mappedRow.calf_breed),
    sex: text(row.mappedRow.sex),
    gender: text(row.mappedRow.sex),
    birthDate: text(row.mappedRow.birth_date),
    birth_date: text(row.mappedRow.birth_date),
    entryDate: text(row.mappedRow.entry_date),
    entry_date: text(row.mappedRow.entry_date),
    currentStageCode: text(row.mappedRow.current_stage_code),
    current_stage_code: text(row.mappedRow.current_stage_code),
    currentGroupCode: text(row.mappedRow.current_group_code),
    current_group_code: text(row.mappedRow.current_group_code),
    status: text(row.mappedRow.status || '在群'),
    geneticLine: text(row.mappedRow.genetic_line),
    genetic_line: text(row.mappedRow.genetic_line),
    productionPurpose: text(row.mappedRow.production_purpose),
    production_purpose: text(row.mappedRow.production_purpose),
    sourceFarm: text(row.mappedRow.source_farm || row.mappedRow.sourceFarm),
    source_farm: text(row.mappedRow.source_farm || row.mappedRow.sourceFarm),
    notes: text(row.mappedRow.notes),
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }
  await upsertLike('animal', animal)
  await upsertLike('cows', {
    id,
    cowNumber: animalNumber,
    cow_number: animalNumber,
    animalNumber,
    animal_number: animalNumber,
    status: animal.status,
    createdAt: now,
    updatedAt: now
  })
  const ids = [id]
  if (entryDate && entryUnit) {
    const entryId = stableId('event', 'profile-entry', animalNumber, entryDate, entryUnit)
    const operatorName = rowOperatorName(row)
    const eventRecord = {
      id: entryId,
      animalId: id,
      animal_id: id,
      cowId: id,
      cow_id: id,
      animalNumber,
      animal_number: animalNumber,
      cowNumber: animalNumber,
      cow_number: animalNumber,
      eventType: 'entry',
      event_type: 'entry',
      eventCode: 'entry',
      event_code: 'entry',
      eventName: '入群',
      event_name: '入群',
      occurredAt: entryDate,
      occurred_at: entryDate,
      eventTime: entryDate,
      event_time: entryDate,
      unitId: entryUnit,
      unit_id: entryUnit,
      operatorName,
      operator_name: operatorName,
      sourceType: 'batch_import',
      source_type: 'batch_import',
      sourceTable: 'information-import',
      source_table: 'information-import',
      sourceRecordId: `animal-profile:${row.rowIndex}`,
      source_record_id: `animal-profile:${row.rowIndex}`,
      details: JSON.stringify({
        to_unit_id: entryUnit,
        toUnitId: entryUnit,
        unit_id: entryUnit,
        unitId: entryUnit,
        movement_reason: entryType,
        movementReason: entryType,
        importTemplateCode: 'animal-profile',
        importRowIndex: row.rowIndex
      }),
      notes: '个体建档导入同步入群事件',
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    }
    await upsertLike('animal_event', eventRecord)
    await upsertLike('cow-events', eventRecord)
    await upsertLike('event_movement_detail', {
      id: stableId('movement-detail', entryId),
      eventId: entryId,
      event_id: entryId,
      animalId: id,
      animal_id: id,
      cowNumber: animalNumber,
      cow_number: animalNumber,
      eventType: 'entry',
      event_type: 'entry',
      occurredAt: entryDate,
      occurred_at: entryDate,
      fromUnitId: '',
      from_unit_id: '',
      toUnitId: entryUnit,
      to_unit_id: entryUnit,
      unitId: entryUnit,
      unit_id: entryUnit,
      movementReason: entryType,
      movement_reason: entryType,
      approvalStatus: 'recorded',
      approval_status: 'recorded',
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    })
    await upsertLike('entry-events', {
      id: entryId,
      cowNumber: animalNumber,
      cow_number: animalNumber,
      animalId: id,
      animal_id: id,
      reason: entryType,
      pen: entryUnit,
      recorder: operatorName,
      entryTime: entryDate,
      sourceTable: 'animal_event',
      source_table: 'animal_event',
      sourceRecordId: entryId,
      source_record_id: entryId,
      createdAt: now
    })
    ids.push(entryId)
  }
  return ids
}

async function commitAnimalProfileLactationFacts(
  animalId: string,
  animal: Record<string, any>,
  mappedRow: Record<string, any>,
  now: string
) {
  const parityCalvingDate = text(
    mappedRow.parity_calving_date ||
      mappedRow.parityCalvingDate ||
      mappedRow.calving_date ||
      mappedRow.calvingDate
  )
  const lactationStartDate = text(mappedRow.lactation_start_date || parityCalvingDate)
  const parityNo = positiveInt(mappedRow.reported_parity_no) || 1
  if (!lactationStartDate) return []
  const lactationEndDate = text(mappedRow.lactation_end_date)
  const lactationId = stableId('lactation_episode', animalId, parityNo)
  const parityId = stableId('parity_episode', animalId, parityNo)
  const factId = stableId('fact_lactation_305', animalId, parityNo)
  const ids = [parityId, lactationId]
  await upsertLike('parity_episode', {
    id: parityId,
    animalId,
    animal_id: animalId,
    animalNumber: animal.animalNumber,
    animal_number: animal.animalNumber,
    cowNumber: animal.cowNumber,
    cow_number: animal.cowNumber,
    parityNo,
    parity_no: parityNo,
    startDate: lactationStartDate,
    start_date: lactationStartDate,
    calvingDate: parityCalvingDate || lactationStartDate,
    calving_date: parityCalvingDate || lactationStartDate,
    startEventDate: parityCalvingDate || lactationStartDate,
    start_event_date: parityCalvingDate || lactationStartDate,
    endDate: lactationEndDate || null,
    end_date: lactationEndDate || null,
    parityStatus: lactationEndDate ? 'closed' : 'open',
    parity_status: lactationEndDate ? 'closed' : 'open',
    notes: text(mappedRow.notes),
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
  await upsertLike('lactation_episode', {
    id: lactationId,
    animalId,
    animal_id: animalId,
    animalNumber: animal.animalNumber,
    animal_number: animal.animalNumber,
    cowNumber: animal.cowNumber,
    cow_number: animal.cowNumber,
    lactationNo: parityNo,
    lactation_no: parityNo,
    parityNo,
    parity_no: parityNo,
    startDate: lactationStartDate,
    start_date: lactationStartDate,
    calvingDate: parityCalvingDate || lactationStartDate,
    calving_date: parityCalvingDate || lactationStartDate,
    dryOffDate: lactationEndDate || null,
    dry_off_date: lactationEndDate || null,
    endDate: lactationEndDate || null,
    end_date: lactationEndDate || null,
    daysInMilk: mappedRow.reported_days_in_milk,
    days_in_milk: mappedRow.reported_days_in_milk,
    status: lactationEndDate ? 'closed' : 'open',
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
  if (
    mappedRow.reported_milk_305 ||
    mappedRow.reported_parity_yield ||
    mappedRow.reported_avg_daily_milk
  ) {
    await upsertLike('fact_lactation_305', {
      id: factId,
      animalId,
      animal_id: animalId,
      animalNumber: animal.animalNumber,
      animal_number: animal.animalNumber,
      cowNumber: animal.cowNumber,
      cow_number: animal.cowNumber,
      lactationId,
      lactation_id: lactationId,
      parityNo,
      parity_no: parityNo,
      lactationNo: parityNo,
      lactation_no: parityNo,
      startDate: lactationStartDate,
      start_date: lactationStartDate,
      calvingDate: parityCalvingDate || lactationStartDate,
      calving_date: parityCalvingDate || lactationStartDate,
      endDate: lactationEndDate || null,
      end_date: lactationEndDate || null,
      milkYield305: mappedRow.reported_milk_305,
      milk_yield_305: mappedRow.reported_milk_305,
      milk305: mappedRow.reported_milk_305,
      milk_305: mappedRow.reported_milk_305,
      recordCount: mappedRow.reported_days_in_milk,
      record_count: mappedRow.reported_days_in_milk,
      recordDays: mappedRow.reported_days_in_milk,
      record_days: mappedRow.reported_days_in_milk,
      coverageDays: mappedRow.reported_days_in_milk,
      coverage_days: mappedRow.reported_days_in_milk,
      missingDays: mappedRow.reported_days_in_milk
        ? Math.max(0, 305 - Number(mappedRow.reported_days_in_milk))
        : null,
      missing_days: mappedRow.reported_days_in_milk
        ? Math.max(0, 305 - Number(mappedRow.reported_days_in_milk))
        : null,
      methodCode: 'uploaded_profile_summary',
      method_code: 'uploaded_profile_summary',
      sourceTable: text(mappedRow.summary_source_table || 'information-import'),
      source_table: text(mappedRow.summary_source_table || 'information-import'),
      sourceRecordIds: [
        text(
          mappedRow.summary_source_record_id || `animal-profile:${animal.animalNumber || animalId}`
        )
      ],
      source_record_ids: [
        text(
          mappedRow.summary_source_record_id || `animal-profile:${animal.animalNumber || animalId}`
        )
      ],
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    })
    ids.push(factId)
  }
  return ids
}

async function commitMilkSummary(row: ParsedImportRow) {
  const animal = await ensureAnimalForV2Fk(row.resolvedCow, row.mappedRow)
  row.resolvedCow.cowId = animal.id
  row.resolvedCow.cowNumber = animal.number || row.resolvedCow.cowNumber
  const now = new Date().toISOString()
  const summarySource = text(row.mappedRow.summary_source || '泌乳汇总导入')
  const summaryRow = {
    ...row.mappedRow,
    animal_number: row.resolvedCow.cowNumber,
    cow_number: row.resolvedCow.cowNumber,
    summary_source_table: 'information-import',
    summary_source_record_id: `milk-summary:${row.rowIndex}`,
    notes: text(row.mappedRow.notes || summarySource)
  }
  const patch = {
    lactationStartDate: text(row.mappedRow.lactation_start_date),
    lactation_start_date: text(row.mappedRow.lactation_start_date),
    lactationEndDate: text(row.mappedRow.lactation_end_date),
    lactation_end_date: text(row.mappedRow.lactation_end_date),
    reportedAgeMonths: row.mappedRow.reported_age_months,
    reported_age_months: row.mappedRow.reported_age_months,
    reportedParityNo: row.mappedRow.reported_parity_no,
    reported_parity_no: row.mappedRow.reported_parity_no,
    reportedDaysInMilk: row.mappedRow.reported_days_in_milk,
    reported_days_in_milk: row.mappedRow.reported_days_in_milk,
    reportedLactationMonth: row.mappedRow.reported_lactation_month,
    reported_lactation_month: row.mappedRow.reported_lactation_month,
    reportedParityYield: row.mappedRow.reported_parity_yield,
    reported_parity_yield: row.mappedRow.reported_parity_yield,
    reportedMilk305: row.mappedRow.reported_milk_305,
    reported_milk_305: row.mappedRow.reported_milk_305,
    reportedAvgDailyMilk: row.mappedRow.reported_avg_daily_milk,
    reported_avg_daily_milk: row.mappedRow.reported_avg_daily_milk,
    calfBreed: text(row.mappedRow.calf_breed),
    calf_breed: text(row.mappedRow.calf_breed),
    sourceType: 'milk_summary_import',
    source_type: 'milk_summary_import',
    updatedAt: now,
    updated_at: now
  }
  await upsertLike('animal', {
    ...animal.row,
    id: animal.id,
    animalId: animal.id,
    animal_id: animal.id,
    cowId: animal.id,
    cow_id: animal.id,
    animalNumber: animal.number,
    animal_number: animal.number,
    cowNumber: animal.number,
    cow_number: animal.number,
    ...patch
  })
  await upsertLike('cows', {
    id: animal.id,
    cowNumber: animal.number,
    calfBreed: patch.calfBreed,
    status: animal.row.status || '在群',
    updatedAt: now
  })
  const ids = await commitAnimalProfileLactationFacts(
    animal.id,
    {
      ...animal.row,
      animalNumber: animal.number,
      cowNumber: animal.number
    },
    summaryRow,
    now
  )
  return [animal.id, ...ids]
}

async function commitPedigree(row: ParsedImportRow) {
  const animal = await ensureAnimalForV2Fk(row.resolvedCow, row.mappedRow)
  row.resolvedCow.cowId = animal.id
  row.resolvedCow.cowNumber = animal.number || row.resolvedCow.cowNumber
  const ids: string[] = []
  const now = new Date().toISOString()
  const common = {
    animalId: row.resolvedCow.cowId,
    animal_id: row.resolvedCow.cowId,
    animalNumber: row.resolvedCow.cowNumber,
    animal_number: row.resolvedCow.cowNumber,
    sireNumber: text(row.mappedRow.sire_number),
    sire_number: text(row.mappedRow.sire_number),
    damNumber: text(row.mappedRow.dam_number),
    dam_number: text(row.mappedRow.dam_number),
    parityNo: positiveInt(row.mappedRow.parity_no || row.mappedRow.parityNo) || undefined,
    parity_no: positiveInt(row.mappedRow.parity_no || row.mappedRow.parityNo) || undefined,
    sourceType: text(row.mappedRow.source_type || '导入'),
    source_type: text(row.mappedRow.source_type || '导入'),
    verificationMethod: text(row.mappedRow.verification_method),
    verification_method: text(row.mappedRow.verification_method),
    confidence: row.mappedRow.confidence || 0,
    effectiveDate: text(row.mappedRow.effective_date),
    effective_date: text(row.mappedRow.effective_date),
    notes: text(row.mappedRow.notes),
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }
  const breed = text(row.mappedRow.breed)
  const sex = text(row.mappedRow.sex)
  const reportedParityNo = positiveInt(row.mappedRow.parity_no || row.mappedRow.parityNo)
  const parityCalvingDate = text(
    row.mappedRow.parity_calving_date ||
      row.mappedRow.parityCalvingDate ||
      row.mappedRow.calving_date ||
      row.mappedRow.calvingDate
  ).slice(0, 10)
  const importedBirthDate = text(row.mappedRow.birth_date).slice(0, 10)
  const existingBirthDate = text(
    row.resolvedCow.cow?.birthDate ||
      row.resolvedCow.cow?.birth_date ||
      animal.row?.birthDate ||
      animal.row?.birth_date
  ).slice(0, 10)
  const birthDate =
    importedBirthDate && existingBirthDate && importedBirthDate !== existingBirthDate
      ? existingBirthDate
      : importedBirthDate || existingBirthDate
  if (importedBirthDate && existingBirthDate && importedBirthDate !== existingBirthDate) {
    await writeImportDataQualityIssue(row, {
      issueCode: 'BIRTH_DATE_CONFLICT',
      issueType: 'pedigree_birth_date_conflict',
      issueLevel: 'warning',
      issueStatus: 'pending',
      message: `导入出生日期 ${importedBirthDate} 与已有出生/产犊日期 ${existingBirthDate} 不一致，已保留已有日期。`,
      detail: {
        importedBirthDate,
        existingBirthDate,
        policy: 'preserve_existing_birth_date',
        source: 'pedigree_import'
      }
    })
  }
  if (breed || sex || birthDate || reportedParityNo || parityCalvingDate) {
    await upsertLike('animal', {
      id: row.resolvedCow.cowId,
      animalId: row.resolvedCow.cowId,
      animal_id: row.resolvedCow.cowId,
      cowId: row.resolvedCow.cowId,
      cow_id: row.resolvedCow.cowId,
      animalNumber: row.resolvedCow.cowNumber,
      animal_number: row.resolvedCow.cowNumber,
      cowNumber: row.resolvedCow.cowNumber,
      cow_number: row.resolvedCow.cowNumber,
      breed,
      sex,
      gender: sex,
      birthDate,
      birth_date: birthDate,
      reportedParityNo: reportedParityNo || undefined,
      reported_parity_no: reportedParityNo || undefined,
      lactationStartDate: parityCalvingDate || undefined,
      lactation_start_date: parityCalvingDate || undefined,
      updatedAt: now,
      updated_at: now
    })
    await upsertLike('cows', {
      id: row.resolvedCow.cowId,
      cowNumber: row.resolvedCow.cowNumber,
      cow_number: row.resolvedCow.cowNumber,
      animalNumber: row.resolvedCow.cowNumber,
      animal_number: row.resolvedCow.cowNumber,
      breed,
      gender: sex,
      sex,
      birthDate,
      birth_date: birthDate,
      parity: reportedParityNo || undefined,
      updatedAt: now
    })
    if (reportedParityNo && parityCalvingDate) {
      ids.push(
        ...(await commitAnimalProfileLactationFacts(
          row.resolvedCow.cowId,
          {
            animalNumber: row.resolvedCow.cowNumber,
            cowNumber: row.resolvedCow.cowNumber
          },
          {
            ...row.mappedRow,
            animal_id: row.resolvedCow.cowId,
            animal_number: row.resolvedCow.cowNumber,
            cow_number: row.resolvedCow.cowNumber,
            reported_parity_no: reportedParityNo,
            lactation_start_date: parityCalvingDate,
            parity_calving_date: parityCalvingDate
          },
          now
        ))
      )
    }
  }
  const sireNumber = text(row.mappedRow.sire_number)
  if (sireNumber) {
    const sireId = stableId('parentage', row.resolvedCow.sourceKey, 'sire', sireNumber)
    const sireBreed = text(row.mappedRow.sire_breed || row.mappedRow.sireBreed)
    await upsertLike('animal_parentage', {
      ...common,
      id: sireId,
      parentNumber: sireNumber,
      parent_number: sireNumber,
      parentRole: 'sire',
      parent_role: 'sire',
      parentBreed: sireBreed,
      parent_breed: sireBreed,
      parentBreedRole: 'sire_breed',
      parent_breed_role: 'sire_breed'
    })
    ids.push(sireId)
  }
  const damNumber = text(row.mappedRow.dam_number)
  if (damNumber) {
    const damId = stableId('parentage', row.resolvedCow.sourceKey, 'dam', damNumber)
    const damBreed = text(row.mappedRow.dam_breed || row.mappedRow.damBreed)
    await upsertLike('animal_parentage', {
      ...common,
      id: damId,
      parentNumber: damNumber,
      parent_number: damNumber,
      parentRole: 'dam',
      parent_role: 'dam',
      parentBreed: damBreed,
      parent_breed: damBreed,
      parentBreedRole: 'dam_breed',
      parent_breed_role: 'dam_breed'
    })
    ids.push(damId)
  }
  if (row.resolvedCow.cowId) {
    await databaseService
      .updateTableRecordAsync('cows', row.resolvedCow.cowId, {
        fatherNumber: sireNumber,
        motherNumber: damNumber,
        updatedAt: now
      })
      .catch(() => undefined)
  }
  ids.push(...(await commitPedigreeCalvingEvent(row)))
  return ids
}

async function commitPedigreeCalvingEvent(row: ParsedImportRow) {
  const calvingDate = text(
    row.mappedRow.parity_calving_date ||
      row.mappedRow.parityCalvingDate ||
      row.mappedRow.calving_date ||
      row.mappedRow.calvingDate
  ).slice(0, 10)
  const calfNumbers = splitCalfNumbers(
    row.mappedRow.calf_number || row.mappedRow.calfNumber || row.mappedRow['犊牛号']
  )
  if (!calvingDate || !calfNumbers.length) return []

  const template = getImportTemplate('reproduction-event')
  const calfSex = text(row.mappedRow.calf_sex || row.mappedRow.calfSex)
  const calfBreed = text(row.mappedRow.calf_breed || row.mappedRow.calfBreed)
  const calves = calfNumbers.map((cowNumber, index) => ({
    cowNumber,
    cow_number: cowNumber,
    calfNumber: cowNumber,
    calf_number: cowNumber,
    sex: calfSex,
    gender: calfSex,
    calfSex,
    calf_sex: calfSex,
    breed: calfBreed,
    calfBreed,
    calf_breed: calfBreed,
    remark: calfNumbers.length > 1 ? `同胎犊牛 ${index + 1}` : ''
  }))
  const parityNo = positiveInt(row.mappedRow.parity_no || row.mappedRow.parityNo)
  const mappedRow = {
    ...row.mappedRow,
    reproduction_action: 'calving',
    event_type: 'calving',
    event_name: '产犊',
    occurred_at: calvingDate,
    eventTime: calvingDate,
    parity_calving_date: calvingDate,
    parityCalvingDate: calvingDate,
    calving_result: text(row.mappedRow.calving_result || row.mappedRow.calvingResult) || '正常',
    calvingResult: text(row.mappedRow.calving_result || row.mappedRow.calvingResult) || '正常',
    parity_no: parityNo || row.mappedRow.parity_no,
    parityNo: parityNo || row.mappedRow.parityNo,
    calf_number: calfNumbers.join(','),
    calfNumber: calfNumbers.join(','),
    calf_sex: calfSex,
    calfSex,
    calf_breed: calfBreed,
    calfBreed,
    calf_count: calfNumbers.length,
    calfCount: calfNumbers.length,
    calves,
    calfRows: calves,
    source_type: text(row.mappedRow.source_type || row.mappedRow.sourceType || 'pedigree_import'),
    sourceType: text(row.mappedRow.source_type || row.mappedRow.sourceType || 'pedigree_import'),
    notes: text(row.mappedRow.notes) || `系谱导入同步产犊事件；犊牛号：${calfNumbers.join(',')}`
  }
  const eventRow: ParsedImportRow = {
    ...row,
    mappedRow,
    duplicate: false,
    duplicateSource: undefined,
    mergeMode: 'insert',
    mergeMessage: '',
    existingTargets: [],
    skipCommit: false,
    errors: []
  }
  return commitEvent(template, eventRow)
}

function splitCalfNumbers(value: unknown) {
  return unique(
    text(value)
      .split(/[,\s，、;；/]+/)
      .map((item) => text(item))
      .filter(Boolean)
  )
}

async function deriveImportPeriod(row: ParsedImportRow, dateValue: unknown) {
  const eventTime = parseImportDate(dateValue)
  if (!Number.isFinite(eventTime) || (!row.resolvedCow.cowId && !row.resolvedCow.cowNumber)) {
    return {
      parityNo: undefined as number | undefined,
      daysInMilk: undefined as number | undefined,
      source: ''
    }
  }

  const cowKey = importCowPeriodKey(row)
  const eventDate = formatLocalDate(new Date(eventTime))
  const resultKey = `${cowKey}|${eventDate}`
  const cached = importPeriodResultCache.get(resultKey)
  if (cached) return cached

  const { lactationRows, parityRows } = await loadImportPeriodRows()
  const windowKey = cowKey
  let windows = importPeriodWindowCache.get(windowKey)
  if (!windows) {
    windows = {
      lactationWindows: buildImportPeriodWindows(lactationRows, row, 'lactation_episode'),
      parityWindows: buildImportPeriodWindows(parityRows, row, 'parity_episode')
    }
    importPeriodWindowCache.set(windowKey, windows)
  }
  const { lactationWindows, parityWindows } = windows
  const factWindow = [...lactationWindows, ...parityWindows]
    .sort(
      (left: any, right: any) =>
        sourceRankForImportPeriod(left.source) - sourceRankForImportPeriod(right.source)
    )
    .find((item: any) => eventTime >= item.startTime && eventTime <= item.endTime)
  if (factWindow) {
    const result = {
      parityNo: factWindow.parityNo,
      daysInMilk: importDaysBetween(factWindow.startTime, eventTime),
      source: `system_derived_from_${factWindow.source}`
    }
    importPeriodResultCache.set(resultKey, result)
    return result
  }

  const calvings = await calvingEventsForImportRow(row)
  let previousIndex = -1
  calvings.forEach((item, index) => {
    if (item.time <= eventTime) previousIndex = index
  })
  if (previousIndex === -1) {
    const result = {
      parityNo: undefined as number | undefined,
      daysInMilk: undefined as number | undefined,
      source: ''
    }
    importPeriodResultCache.set(resultKey, result)
    return result
  }
  const next = calvings[previousIndex + 1]
  if (next && eventTime >= next.time) {
    const result = {
      parityNo: undefined as number | undefined,
      daysInMilk: undefined as number | undefined,
      source: ''
    }
    importPeriodResultCache.set(resultKey, result)
    return result
  }
  const result = {
    parityNo: calvings[previousIndex].parityNo || previousIndex + 1,
    daysInMilk: importDaysBetween(calvings[previousIndex].time, eventTime),
    source: 'system_derived_from_calving_events'
  }
  importPeriodResultCache.set(resultKey, result)
  return result
}

async function loadImportPeriodRows() {
  if (!importPeriodRowsCache) {
    const [lactationRows, parityRows, animalEvents, cowEvents, breedingEvents] = await Promise.all([
      databaseService.getTableDataAsync('lactation_episode', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('parity_episode', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('animal_event', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('cow-events', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('breeding-events', { silent: true }).catch(() => [])
    ])
    importPeriodRowsCache = {
      lactationRows,
      parityRows,
      animalEvents,
      cowEvents,
      breedingEvents
    }
  }
  return importPeriodRowsCache
}

function buildImportPeriodWindows(
  rows: any[],
  row: ParsedImportRow,
  source: 'lactation_episode' | 'parity_episode'
) {
  return rows
    .filter((item: any) => rowMatchesResolvedCow(item, row.resolvedCow))
    .map((item: any) => {
      const startTime = parseImportDate(item.startDate || item.start_date)
      const calvingTime = parseImportDate(
        item.calvingDate || item.calving_date || item.startEventDate || item.start_event_date
      )
      const endValue = text(item.endDate || item.end_date || item.dryOffDate || item.dry_off_date)
      return {
        parityNo: positiveInt(
          item.parityNo ?? item.parity_no ?? item.lactationNo ?? item.lactation_no
        ),
        startTime: Number.isFinite(calvingTime) ? calvingTime : startTime,
        endTime: endValue ? endOfImportDay(parseImportDate(endValue)) : Number.POSITIVE_INFINITY,
        source
      }
    })
    .filter((item: any) => item.parityNo && Number.isFinite(item.startTime))
    .sort((left: any, right: any) => left.startTime - right.startTime)
}

function sourceRankForImportPeriod(source: string) {
  return source === 'lactation_episode' ? 0 : 1
}

async function calvingEventsForImportRow(row: ParsedImportRow) {
  const cowKey = importCowPeriodKey(row)
  const cached = importCalvingEventsCache.get(cowKey)
  if (cached) return cached
  const { animalEvents, cowEvents, breedingEvents } = await loadImportPeriodRows()
  const byDate = new Map<
    string,
    { eventCode: string; time: number; eventDate: string; parityNo: number }
  >()
  ;[...animalEvents, ...cowEvents, ...breedingEvents]
    .filter((item: any) => rowMatchesResolvedCow(item, row.resolvedCow))
    .forEach((item: any) => {
      const details = parseJsonObject(item.details || item.customValues || item.custom_values)
      const eventCode = normalizeImportEventCode(
        item.eventCode ||
          item.event_code ||
          item.eventType ||
          item.event_type ||
          item.eventName ||
          item.event_name ||
          details.eventType
      )
      const time = parseImportDate(
        item.occurredAt ||
          item.occurred_at ||
          item.eventTime ||
          item.event_time ||
          item.eventDate ||
          item.event_date ||
          item.createdAt ||
          item.created_at
      )
      const parityNo = positiveInt(
        item.parityNo ?? item.parity_no ?? details.parityNo ?? details.parity_no
      )
      const eventDate = Number.isFinite(time) ? formatLocalDate(new Date(time)) : ''
      if (eventCode !== 'calving' || !Number.isFinite(time) || !eventDate) return
      const previous = byDate.get(eventDate)
      if (!previous || (!previous.parityNo && parityNo)) {
        byDate.set(eventDate, { eventCode, time, eventDate, parityNo })
      }
    })
  const result = Array.from(byDate.values()).sort((left, right) => left.time - right.time)
  importCalvingEventsCache.set(cowKey, result)
  return result
}

function importCowPeriodKey(row: ParsedImportRow) {
  return (
    row.resolvedCow.cowId ||
    row.resolvedCow.cowNumber ||
    row.resolvedCow.sourceKey ||
    text(
      row.mappedRow.animal_id ||
        row.mappedRow.animal_number ||
        row.mappedRow.cow_id ||
        row.mappedRow.cow_number
    ) ||
    `row-${row.rowIndex}`
  )
}

function rowMatchesResolvedCow(
  item: Record<string, any>,
  resolvedCow: ReturnType<typeof resolveCowRef>
) {
  const itemId = text(item.cowId || item.cow_id || item.animalId || item.animal_id || item.id)
  const itemNumber = text(
    item.cowNumber || item.cow_number || item.animalNumber || item.animal_number || item.number
  )
  return (
    (!!resolvedCow.cowId && itemId === resolvedCow.cowId) ||
    (!!resolvedCow.cowNumber && itemNumber === resolvedCow.cowNumber)
  )
}

function parseJsonObject(value: unknown) {
  if (!value) return {}
  if (typeof value === 'object') return value as Record<string, any>
  try {
    return JSON.parse(String(value))
  } catch {
    return {}
  }
}

function parseImportDate(value: unknown) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return Number.NaN
    const date = new Date(value)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  const raw = text(value)
  if (!raw) return Number.NaN
  const time = Date.parse(raw)
  if (!Number.isFinite(time)) return Number.NaN
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function endOfImportDay(time: number) {
  const date = new Date(time)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

function importDaysBetween(startTime: number, endTime: number) {
  return Math.max(
    1,
    Math.floor((parseImportDate(endTime) - parseImportDate(startTime)) / 86400000) + 1
  )
}

function positiveInt(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.trunc(numberValue) : 0
}

async function commitTraitObservation(row: ParsedImportRow) {
  const animal = await ensureAnimalForImport(row)
  row.resolvedCow.cowId = animal.id
  row.resolvedCow.cowNumber = animal.number || row.resolvedCow.cowNumber
  const now = new Date().toISOString()
  const observedAt = text(row.mappedRow.observed_at)
  const batchDate = observedAt.slice(0, 10)
  const shiftName = explicitMilkShift(row.mappedRow)
  const batchId = stableId('trait-observation-batch', batchDate, rowOperatorName(row))
  const id = stableId(
    'trait-observation',
    row.resolvedCow.sourceKey,
    text(row.mappedRow.trait_code),
    observedAt
  )
  const traitCode = text(row.mappedRow.trait_code)
  const trait = await ensureTraitDefinitionForObservation(traitCode, row.mappedRow)
  const period = await deriveImportPeriod(row, observedAt)
  const workOperatorName = rowWorkOperatorName(row) || rowOperatorName(row)
  await ensureTraitObservationBatch(batchId, {
    ...row.mappedRow,
    batchName: `表型导入 ${batchDate || now.slice(0, 10)}`,
    sourceType: text(row.mappedRow.source_type || 'batch_import'),
    operatorName: rowOperatorName(row),
    workOperatorName,
    workOperator: workOperatorName,
    work_operator_name: workOperatorName,
    collector: workOperatorName,
    collectedAt: text(observedAt || now)
  })
  const record = {
    id,
    batchId,
    batch_id: batchId,
    animalId: row.resolvedCow.cowId,
    animal_id: row.resolvedCow.cowId,
    cowId: row.resolvedCow.cowId,
    cow_id: row.resolvedCow.cowId,
    animalNumber: row.resolvedCow.cowNumber,
    animal_number: row.resolvedCow.cowNumber,
    cowNumber: row.resolvedCow.cowNumber,
    cow_number: row.resolvedCow.cowNumber,
    traitId: trait.id,
    trait_id: trait.id,
    traitCode,
    trait_code: traitCode,
    traitName: text(row.mappedRow.trait_name || trait.name || traitCode),
    trait_name: text(row.mappedRow.trait_name || trait.name || traitCode),
    observedAt,
    observed_at: observedAt,
    collectionDate: observedAt.slice(0, 10),
    collection_date: observedAt.slice(0, 10),
    milkingShift: shiftName,
    milking_shift: shiftName,
    shiftName,
    shift_name: shiftName,
    shiftId: shiftName,
    shift_id: shiftName,
    parityNo: period.parityNo,
    parity_no: period.parityNo,
    daysInMilk: period.daysInMilk,
    days_in_milk: period.daysInMilk,
    periodSource: period.source,
    period_source: period.source,
    numericValue: row.mappedRow.numeric_value,
    numeric_value: row.mappedRow.numeric_value,
    value: row.mappedRow.numeric_value ?? row.mappedRow.text_value,
    textValue: row.mappedRow.text_value,
    text_value: row.mappedRow.text_value,
    unit: text(row.mappedRow.unit || trait.unit),
    source: text(row.mappedRow.source_type || '批量导入'),
    sourceType: text(row.mappedRow.source_type || 'batch_import'),
    source_type: text(row.mappedRow.source_type || 'batch_import'),
    qualityFlag: text(row.mappedRow.quality_flag || '正常'),
    quality_flag: text(row.mappedRow.quality_flag || '正常'),
    workOperatorName,
    work_operator_name: workOperatorName,
    collector: workOperatorName,
    operatorName: rowOperatorName(row),
    operator_name: rowOperatorName(row),
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }
  await upsertLike('trait_observation', record)
  await upsertLike('phenotype-records', record)
  return [batchId, id]
}

async function commitMilkMeasurement(row: ParsedImportRow) {
  const animal = await ensureAnimalForImport(row)
  row.resolvedCow.cowId = animal.id
  row.resolvedCow.cowNumber = animal.number || row.resolvedCow.cowNumber
  const now = new Date().toISOString()
  const measuredAt = text(row.mappedRow.measured_at)
  const productionDate = measuredAt.slice(0, 10)
  const period = await deriveImportPeriod(row, measuredAt)
  const shiftName = explicitMilkShift(row.mappedRow) || inferMilkShiftFromTime(measuredAt)
  const sessionCode = `${productionDate}-${shiftName}`
  const sessionId = stableId('milking-session', sessionCode)
  const visitId = stableId('milking-visit', sessionCode, row.resolvedCow.sourceKey, measuredAt)
  const id =
    existingImportTargetId(row, 'milk_measurement') ||
    stableId('milk', sessionCode, row.resolvedCow.sourceKey, measuredAt, shiftName)
  const operatorName = rowOperatorName(row)
  const workOperatorName = rowWorkOperatorName(row) || operatorName
  const recordedAt = text(
    row.mappedRow.recorded_at ||
      row.mappedRow.recordedAt ||
      row.mappedRow.record_time ||
      row.mappedRow.recordTime ||
      row.mappedRow.source_recorded_at ||
      row.mappedRow.sourceRecordedAt ||
      row.mappedRow.source_created_at ||
      row.mappedRow.sourceCreatedAt
  )
  const workOperatorId = stableId('person', workOperatorName)
  const milkingUnitId = text(
    row.mappedRow.unit_id ||
      row.mappedRow.unitId ||
      row.mappedRow.milking_hall ||
      row.mappedRow.milkingHall ||
      row.mappedRow.hall
  )
  const stallNo = text(
    row.mappedRow.stall_no ||
      row.mappedRow.stallNo ||
      row.mappedRow.milking_position ||
      row.mappedRow.milkingPosition
  )
  const durationMinutes = row.mappedRow.milking_duration_minutes
  const endedAt = addMinutesToDateTime(measuredAt, durationMinutes)
  const sourceType = text(row.mappedRow.source_type || row.mappedRow.sourceType || 'batch_import')
  if (workOperatorName) {
    await upsertLike('persons', {
      id: workOperatorId,
      name: workOperatorName,
      role: /兽医/.test(workOperatorName)
        ? '兽医'
        : /育种|繁殖|配种/.test(workOperatorName)
          ? '育种员'
          : '饲养员',
      status: '正常',
      sourceType,
      source_type: sourceType,
      sourceTable: 'information-import',
      source_table: 'information-import',
      sourceRecordId: `milk-measurement:${row.rowIndex}`,
      source_record_id: `milk-measurement:${row.rowIndex}`,
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    })
  }
  const traceNotes = [
    text(row.mappedRow.notes),
    workOperatorName ? `操作人:${workOperatorName}` : '',
    recordedAt ? `记录时间:${recordedAt}` : ''
  ]
    .filter(Boolean)
    .join('; ')
  const record = {
    id,
    sessionId,
    session_id: sessionId,
    visitId,
    visit_id: visitId,
    animalId: row.resolvedCow.cowId,
    animal_id: row.resolvedCow.cowId,
    cowId: row.resolvedCow.cowId,
    cow_id: row.resolvedCow.cowId,
    animalNumber: row.resolvedCow.cowNumber,
    animal_number: row.resolvedCow.cowNumber,
    cowNumber: row.resolvedCow.cowNumber,
    cow_number: row.resolvedCow.cowNumber,
    sessionCode,
    session_code: sessionCode,
    measuredAt,
    measured_at: measuredAt,
    milkingTime: measuredAt,
    productionDate,
    production_date: productionDate,
    shiftId: shiftName,
    shift_id: shiftName,
    unitId: milkingUnitId,
    unit_id: milkingUnitId,
    stallNo,
    stall_no: stallNo,
    parityNo: period.parityNo,
    parity_no: period.parityNo,
    daysInMilk: period.daysInMilk,
    days_in_milk: period.daysInMilk,
    periodSource: period.source,
    period_source: period.source,
    milkYield: row.mappedRow.milk_yield,
    milk_yield: row.mappedRow.milk_yield,
    volume: row.mappedRow.milk_yield,
    milkFlowAvg: row.mappedRow.milk_flow_avg,
    milk_flow_avg: row.mappedRow.milk_flow_avg,
    milkFlowPeak: row.mappedRow.milk_flow_peak,
    milk_flow_peak: row.mappedRow.milk_flow_peak,
    conductivity: row.mappedRow.conductivity,
    fat: row.mappedRow.fat_percent,
    fatPercent: row.mappedRow.fat_percent,
    fat_percent: row.mappedRow.fat_percent,
    protein: row.mappedRow.protein_percent,
    proteinPercent: row.mappedRow.protein_percent,
    protein_percent: row.mappedRow.protein_percent,
    lactose: row.mappedRow.lactose_percent,
    lactosePercent: row.mappedRow.lactose_percent,
    lactose_percent: row.mappedRow.lactose_percent,
    scc: row.mappedRow.somatic_cell_count,
    somaticCellCount: row.mappedRow.somatic_cell_count,
    somatic_cell_count: row.mappedRow.somatic_cell_count,
    milkQuality: {
      grade: text(row.mappedRow.quality_flag || 'A'),
      fat: row.mappedRow.fat_percent,
      protein: row.mappedRow.protein_percent,
      lactose: row.mappedRow.lactose_percent,
      scc: row.mappedRow.somatic_cell_count
    },
    source: sourceType,
    sourceType,
    source_type: sourceType,
    sourceTable: 'information-import',
    source_table: 'information-import',
    sourceRecordId: `milk-measurement:${row.rowIndex}`,
    source_record_id: `milk-measurement:${row.rowIndex}`,
    recordedAt,
    recorded_at: recordedAt,
    workOperatorId,
    work_operator_id: workOperatorId,
    workOperatorName,
    work_operator_name: workOperatorName,
    milkerId: workOperatorId,
    milker_id: workOperatorId,
    collector: workOperatorName,
    collectorName: workOperatorName,
    collector_name: workOperatorName,
    operatorName,
    operator_name: operatorName,
    notes: traceNotes,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }
  await upsertLike('milking_session', {
    id: sessionId,
    sessionId,
    session_id: sessionId,
    sessionCode,
    session_code: sessionCode,
    productionDate,
    production_date: productionDate,
    startedAt: measuredAt,
    started_at: measuredAt,
    endedAt,
    ended_at: endedAt,
    unitId: milkingUnitId,
    unit_id: milkingUnitId,
    shiftId: shiftName,
    shift_id: shiftName,
    sourceType,
    source_type: sourceType,
    sourceTable: 'information-import',
    source_table: 'information-import',
    sourceRecordId: `milk-measurement:${row.rowIndex}`,
    source_record_id: `milk-measurement:${row.rowIndex}`,
    recordedAt,
    recorded_at: recordedAt,
    workOperatorId,
    work_operator_id: workOperatorId,
    workOperatorName,
    work_operator_name: workOperatorName,
    collector: workOperatorName,
    collectorName: workOperatorName,
    collector_name: workOperatorName,
    operatorName,
    operator_name: operatorName,
    status: 'recorded',
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
  await upsertLike('milking_visit', {
    id: visitId,
    sessionId,
    session_id: sessionId,
    sessionCode,
    session_code: sessionCode,
    animalId: row.resolvedCow.cowId,
    animal_id: row.resolvedCow.cowId,
    cowId: row.resolvedCow.cowId,
    cow_id: row.resolvedCow.cowId,
    animalNumber: row.resolvedCow.cowNumber,
    animal_number: row.resolvedCow.cowNumber,
    cowNumber: row.resolvedCow.cowNumber,
    cow_number: row.resolvedCow.cowNumber,
    enteredAt: measuredAt,
    entered_at: measuredAt,
    measuredAt,
    measured_at: measuredAt,
    productionDate,
    production_date: productionDate,
    unitId: milkingUnitId,
    unit_id: milkingUnitId,
    stallNo,
    stall_no: stallNo,
    shiftId: shiftName,
    shift_id: shiftName,
    parityNo: period.parityNo,
    parity_no: period.parityNo,
    daysInMilk: period.daysInMilk,
    days_in_milk: period.daysInMilk,
    periodSource: period.source,
    period_source: period.source,
    milkYield: row.mappedRow.milk_yield,
    milk_yield: row.mappedRow.milk_yield,
    startedAt: measuredAt,
    started_at: measuredAt,
    endedAt,
    ended_at: endedAt,
    qualityFlag: text(row.mappedRow.quality_flag || '正常'),
    quality_flag: text(row.mappedRow.quality_flag || '正常'),
    sourceType,
    source_type: sourceType,
    sourceTable: 'information-import',
    source_table: 'information-import',
    sourceRecordId: `milk-measurement:${row.rowIndex}`,
    source_record_id: `milk-measurement:${row.rowIndex}`,
    recordedAt,
    recorded_at: recordedAt,
    workOperatorId,
    work_operator_id: workOperatorId,
    workOperatorName,
    work_operator_name: workOperatorName,
    collector: workOperatorName,
    collectorName: workOperatorName,
    collector_name: workOperatorName,
    operatorName,
    operator_name: operatorName,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
  const movementId = await commitMilkMeasurementUnitEvent(row, milkingUnitId, measuredAt)
  await upsertLike('milk_measurement', record, row)
  await upsertLike('milk-records', record, row)
  return [sessionId, visitId, id, movementId].filter(Boolean)
}

async function commitMilkMeasurementUnitEvent(
  row: ParsedImportRow,
  targetUnit: string,
  measuredAt: string
) {
  const toUnit = text(targetUnit)
  const eventDate = text(measuredAt).slice(0, 10)
  if (!toUnit || !eventDate || (!row.resolvedCow.cowId && !row.resolvedCow.cowNumber)) return ''
  const cowKey =
    row.resolvedCow.cowId ||
    row.resolvedCow.cowNumber ||
    row.resolvedCow.sourceKey ||
    text(row.mappedRow.animal_number || row.mappedRow.cow_number)
  const currentUnit = milkImportUnitState.has(cowKey)
    ? milkImportUnitState.get(cowKey) || ''
    : currentPenOf(row.resolvedCow.cow || {})
  if (!currentUnit) {
    const entryStateKey = `${cowKey}|entry|${toUnit}`
    if (!milkImportUnitEventState.has(entryStateKey)) {
      milkImportUnitEventState.add(entryStateKey)
      const entryId = await writeMilkMeasurementUnitMovement(row, {
        eventType: 'entry',
        eventName: '入群',
        fromUnit: '',
        toUnit,
        eventDate,
        reason: '奶厅测量导入首次携带圈舍单元'
      })
      milkImportUnitState.set(cowKey, toUnit)
      return entryId
    }
    milkImportUnitState.set(cowKey, toUnit)
    return stableId('event', 'milk-unit', row.resolvedCow.sourceKey || cowKey, 'entry', toUnit)
  }
  if (currentUnit === toUnit) {
    milkImportUnitState.set(cowKey, toUnit)
    return ''
  }
  const eventStateKey = `${cowKey}|${eventDate}|${currentUnit}|${toUnit}`
  if (milkImportUnitEventState.has(eventStateKey)) {
    milkImportUnitState.set(cowKey, toUnit)
    return stableId('event', 'milk-unit', row.resolvedCow.sourceKey || cowKey, eventDate, toUnit)
  }
  milkImportUnitEventState.add(eventStateKey)
  const eventId = await writeMilkMeasurementUnitMovement(row, {
    eventType: 'transfer',
    eventName: '转群',
    fromUnit: currentUnit,
    toUnit,
    eventDate,
    reason: '奶厅测量导入携带圈舍单元'
  })
  milkImportUnitState.set(cowKey, toUnit)
  return eventId
}

async function writeMilkMeasurementUnitMovement(
  row: ParsedImportRow,
  input: {
    eventType: 'entry' | 'transfer'
    eventName: string
    fromUnit: string
    toUnit: string
    eventDate: string
    reason: string
  }
) {
  const { eventType, eventName, fromUnit, toUnit, eventDate, reason } = input
  const eventId = stableId(
    'event',
    'milk-unit',
    row.resolvedCow.sourceKey,
    eventType,
    eventDate,
    toUnit
  )
  const operatorName = rowOperatorName(row)
  const workOperatorName = rowWorkOperatorName(row) || operatorName
  const now = new Date().toISOString()
  const details = {
    from_unit_id: fromUnit,
    fromUnitId: fromUnit,
    to_unit_id: toUnit,
    toUnitId: toUnit,
    unit_id: toUnit,
    unitId: toUnit,
    movement_reason: reason,
    movementReason: reason,
    importTemplateCode: 'milk-measurement',
    importRowIndex: row.rowIndex,
    sourceType: 'batch_import',
    source_type: 'batch_import',
    sourceTable: 'information-import',
    source_table: 'information-import',
    sourceRecordId: `milk-measurement-unit:${row.rowIndex}`,
    source_record_id: `milk-measurement-unit:${row.rowIndex}`,
    operatorName,
    operator_name: operatorName,
    workOperatorName,
    work_operator_name: workOperatorName,
    eventTime: eventDate,
    event_time: eventDate
  }
  const eventRecord = {
    id: eventId,
    animalId: row.resolvedCow.cowId,
    animal_id: row.resolvedCow.cowId,
    cowId: row.resolvedCow.cowId,
    cow_id: row.resolvedCow.cowId,
    animalNumber:
      row.resolvedCow.cowNumber || row.mappedRow.animal_number || row.mappedRow.cow_number,
    animal_number:
      row.resolvedCow.cowNumber || row.mappedRow.animal_number || row.mappedRow.cow_number,
    cowNumber: row.resolvedCow.cowNumber || row.mappedRow.animal_number || row.mappedRow.cow_number,
    cow_number:
      row.resolvedCow.cowNumber || row.mappedRow.animal_number || row.mappedRow.cow_number,
    eventGroup: 'movement',
    event_group: 'movement',
    eventType,
    event_type: eventType,
    eventCode: eventType,
    event_code: eventType,
    eventName,
    event_name: eventName,
    occurredAt: eventDate,
    occurred_at: eventDate,
    eventTime: eventDate,
    event_time: eventDate,
    productionDate: eventDate,
    production_date: eventDate,
    operatorName,
    operator_name: operatorName,
    workOperatorName,
    work_operator_name: workOperatorName,
    sourceTable: 'information-import',
    source_table: 'information-import',
    sourceRecordId: `milk-measurement-unit:${row.rowIndex}`,
    source_record_id: `milk-measurement-unit:${row.rowIndex}`,
    sourceType: 'batch_import',
    source_type: 'batch_import',
    importMode: 'batch',
    import_mode: 'batch',
    details,
    customValues: details,
    custom_values: details,
    status: 'recorded',
    eventStatus: 'recorded',
    event_status: 'recorded',
    notes: `奶厅测量导入自动生成${eventName}事件`,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }
  await upsertLike('animal_event', eventRecord)
  await upsertLike('cow-events', {
    ...eventRecord,
    details,
    eventName,
    eventTime: eventDate,
    createdAt: now
  })
  await writeMovementDetail(
    {
      id: eventId,
      animalId: row.resolvedCow.cowId,
      animal_id: row.resolvedCow.cowId,
      cowNumber: row.resolvedCow.cowNumber,
      cow_number: row.resolvedCow.cowNumber,
      eventId,
      event_id: eventId,
      eventType,
      event_type: eventType,
      occurredAt: eventDate,
      occurred_at: eventDate,
      detail: jsonDetail(details),
      details,
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    },
    {
      ...row,
      mappedRow: {
        ...row.mappedRow,
        from_unit_id: fromUnit,
        to_unit_id: toUnit,
        unit_id: toUnit,
        movement_reason: reason
      }
    },
    eventType
  )
  row.resolvedCow.cow = {
    ...(row.resolvedCow.cow || {}),
    currentUnitId: toUnit,
    current_unit_id: toUnit,
    currentPenId: toUnit,
    current_pen_id: toUnit
  }
  return eventId
}

function normalizeMilkShift(value: unknown) {
  const raw = text(value)
  return raw || '早班'
}

function normalizeOptionalMilkShift(value: unknown) {
  const raw = text(value)
  return raw
}

function inferMilkShiftFromTime(value: unknown) {
  const raw = text(value)
  const hourMatch = raw.match(/(?:T|\s)(\d{1,2}):\d{2}/) || raw.match(/^(\d{1,2}):\d{2}/)
  const hour = hourMatch ? Number(hourMatch[1]) : Number.NaN
  if (Number.isFinite(hour)) {
    if (hour >= 4 && hour < 11) return '早班'
    if (hour >= 11 && hour < 16) return '中班'
    if (hour >= 16 || hour < 4) return '晚班'
  }
  return '早班'
}

function explicitMilkShift(row: Record<string, any>) {
  return normalizeOptionalMilkShift(
    row.shift_name ||
      row.shiftName ||
      row.shift_id ||
      row.shiftId ||
      row.shift ||
      row['班次'] ||
      row['班次名称'] ||
      row['采奶班次'] ||
      row['挤奶班次'] ||
      row['事件班次']
  )
}

async function commitEvent(template: ImportTemplate, row: ParsedImportRow) {
  const eventCode = normalizeImportEventCode(
    row.mappedRow.event_type || row.mappedRow.reproduction_action || 'general_event'
  )
  let eventTime = text(row.mappedRow.occurred_at)
  if (eventCode === 'dry_off') {
    const dryOffDate = text(
      row.mappedRow.dry_off_date ||
        row.mappedRow.dryOffDate ||
        row.mappedRow.lactation_end_date ||
        row.mappedRow.lactationEndDate ||
        eventTime
    ).slice(0, 10)
    if (dryOffDate) {
      eventTime = dryOffDate
      row.mappedRow.dry_off_date = dryOffDate
      row.mappedRow.dryOffDate = dryOffDate
      row.mappedRow.lactation_end_date = dryOffDate
      row.mappedRow.lactationEndDate = dryOffDate
    }
    const dryReason = text(
      row.mappedRow.dry_reason || row.mappedRow.dryReason || row.mappedRow.reason
    )
    if (dryReason) {
      row.mappedRow.dry_reason = dryReason
      row.mappedRow.dryReason = dryReason
      row.mappedRow.reason = dryReason
    }
    row.mappedRow.target_stage =
      text(row.mappedRow.target_stage || row.mappedRow.targetStage) || '干奶'
    row.mappedRow.targetStage = row.mappedRow.target_stage
  }
  const sourceType = text(row.mappedRow.source_type || row.mappedRow.sourceType || 'batch_import')
  const id = stableId('event', template.code, row.resolvedCow.sourceKey, eventCode, eventTime)
  const operatorName = rowOperatorName(row)
  const workOperatorName = rowWorkOperatorName(row)
  const recordedAt = text(
    row.mappedRow.recorded_at ||
      row.mappedRow.recordedAt ||
      row.mappedRow.record_time ||
      row.mappedRow.recordTime ||
      row.mappedRow.source_recorded_at ||
      row.mappedRow.sourceRecordedAt ||
      row.mappedRow.source_created_at ||
      row.mappedRow.sourceCreatedAt ||
      eventTime
  )
  const eventResult = await databaseService.addCowEvent({
    id,
    cowId: row.resolvedCow.cowId,
    cowNumber: row.resolvedCow.cowNumber || row.mappedRow.animal_number || row.mappedRow.cow_number,
    eventType: eventCode,
    eventCode,
    eventName: text(row.mappedRow.event_name || row.mappedRow.reproduction_action || eventCode),
    eventTime,
    operatorId: text(row.mappedRow.operator_id || row.mappedRow.operatorId),
    operatorName,
    workOperatorId: text(row.mappedRow.work_operator_id || row.mappedRow.workOperatorId),
    workOperatorName,
    recordedAt,
    sourceType,
    source_type: sourceType,
    sourceTable: 'information-import',
    sourceRecordId: `${template.code}:${row.rowIndex}`,
    severity: text(row.mappedRow.severity),
    eventStatus: normalizeEventStatus(
      row.mappedRow.event_status || row.mappedRow.eventStatus || row.mappedRow.status
    ),
    event_status: normalizeEventStatus(
      row.mappedRow.event_status || row.mappedRow.eventStatus || row.mappedRow.status
    ),
    details: {
      ...row.mappedRow,
      importTemplateCode: template.code,
      importRowIndex: row.rowIndex
    },
    notes: text(row.mappedRow.notes)
  })
  const writtenEvent = eventResult.animalEvent || eventResult.event || {}
  const writtenCowId = text(
    writtenEvent.animalId || writtenEvent.animal_id || writtenEvent.cowId || writtenEvent.cow_id
  )
  const writtenCowNumber = text(
    writtenEvent.animalNumber ||
      writtenEvent.animal_number ||
      writtenEvent.cowNumber ||
      writtenEvent.cow_number
  )
  const writtenEventId = text(writtenEvent.id) || id
  if (writtenCowId || writtenCowNumber) {
    row.resolvedCow.cowId = writtenCowId || row.resolvedCow.cowId
    row.resolvedCow.cowNumber = writtenCowNumber || row.resolvedCow.cowNumber
    row.resolvedCow.sourceKey = row.resolvedCow.cowId || row.resolvedCow.cowNumber
    row.resolvedCow.resolved = true
    row.mappedRow.cow_id = row.mappedRow.cow_id || row.resolvedCow.cowId
    row.mappedRow.cowId = row.mappedRow.cowId || row.resolvedCow.cowId
    row.mappedRow.animal_id = row.mappedRow.animal_id || row.resolvedCow.cowId
    row.mappedRow.animalId = row.mappedRow.animalId || row.resolvedCow.cowId
    row.mappedRow.cow_number = row.mappedRow.cow_number || row.resolvedCow.cowNumber
    row.mappedRow.cowNumber = row.mappedRow.cowNumber || row.resolvedCow.cowNumber
    row.mappedRow.animal_number = row.mappedRow.animal_number || row.resolvedCow.cowNumber
    row.mappedRow.animalNumber = row.mappedRow.animalNumber || row.resolvedCow.cowNumber
  }
  const traitIds =
    eventCode === 'body_measurement'
      ? await writeBodyMeasurementTraitObservations(writtenEventId, row, eventTime)
      : []
  await writeLegacyEvent(template, writtenEventId, row, eventCode, eventTime)
  const ids = [writtenEventId]
  ids.push(...traitIds)
  ids.push(
    ...(await writeMilkMeasurementFromProductionEvent(writtenEventId, row, eventCode, eventTime))
  )
  return ids
}

async function writeMilkMeasurementFromProductionEvent(
  eventId: string,
  row: ParsedImportRow,
  eventCode: string,
  eventTime: string
) {
  if (!isMilkProductionEvent(row, eventCode)) return []
  const milkYield = milkYieldFromEventRow(row.mappedRow)
  if (milkYield === null) return []
  const animal = await ensureAnimalForV2Fk(row.resolvedCow, row.mappedRow)
  row.resolvedCow.cowId = animal.id
  row.resolvedCow.cowNumber = animal.number || row.resolvedCow.cowNumber
  const measuredAt = text(
    row.mappedRow.measured_at || row.mappedRow.milkingTime || row.mappedRow.occurred_at || eventTime
  )
  const shiftName = explicitMilkShift(row.mappedRow) || inferMilkShiftFromTime(measuredAt)
  const sessionCode = text(
    row.mappedRow.session_code ||
      row.mappedRow.sessionCode ||
      `${measuredAt.slice(0, 10)}-${shiftName}-${row.resolvedCow.cowNumber || row.resolvedCow.sourceKey}`
  )
  const sessionId = stableId('milking-session', sessionCode)
  const visitId = stableId('milking-visit', sessionCode, row.resolvedCow.sourceKey, measuredAt)
  const measurementId = stableId(
    'milk',
    sessionCode,
    row.resolvedCow.sourceKey,
    measuredAt,
    eventId
  )
  const productionDate = measuredAt.slice(0, 10)
  const period = await deriveImportPeriod(row, measuredAt)
  const now = new Date().toISOString()
  const operatorName = rowOperatorName(row)
  const workOperatorName = rowWorkOperatorName(row) || operatorName
  const recordedAt = text(
    row.mappedRow.recorded_at ||
      row.mappedRow.recordedAt ||
      row.mappedRow.record_time ||
      row.mappedRow.recordTime ||
      row.mappedRow.source_recorded_at ||
      row.mappedRow.sourceRecordedAt
  )
  const common = {
    id: measurementId,
    sessionId,
    session_id: sessionId,
    visitId,
    visit_id: visitId,
    animalId: row.resolvedCow.cowId,
    animal_id: row.resolvedCow.cowId,
    cowId: row.resolvedCow.cowId,
    cow_id: row.resolvedCow.cowId,
    animalNumber: row.resolvedCow.cowNumber,
    animal_number: row.resolvedCow.cowNumber,
    cowNumber: row.resolvedCow.cowNumber,
    cow_number: row.resolvedCow.cowNumber,
    sessionCode,
    session_code: sessionCode,
    measuredAt,
    measured_at: measuredAt,
    milkingTime: measuredAt,
    milking_time: measuredAt,
    productionDate,
    production_date: productionDate,
    shiftId: shiftName,
    shift_id: shiftName,
    parityNo: period.parityNo,
    parity_no: period.parityNo,
    daysInMilk: period.daysInMilk,
    days_in_milk: period.daysInMilk,
    periodSource: period.source,
    period_source: period.source,
    milkYield,
    milk_yield: milkYield,
    volume: milkYield,
    qualityFlag: text(row.mappedRow.quality_flag || row.mappedRow['质量标记'] || '正常'),
    quality_flag: text(row.mappedRow.quality_flag || row.mappedRow['质量标记'] || '正常'),
    sourceType: 'single_entry',
    source_type: 'single_entry',
    sourceTable: 'animal_event',
    source_table: 'animal_event',
    sourceRecordId: eventId,
    source_record_id: eventId,
    recordedAt,
    recorded_at: recordedAt,
    workOperatorName,
    work_operator_name: workOperatorName,
    collector: workOperatorName,
    collectorName: workOperatorName,
    collector_name: workOperatorName,
    operatorName,
    operator_name: operatorName,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }
  await upsertLike('milking_session', {
    id: sessionId,
    sessionId,
    session_id: sessionId,
    sessionCode,
    session_code: sessionCode,
    productionDate,
    production_date: productionDate,
    startedAt: measuredAt,
    started_at: measuredAt,
    shiftId: shiftName,
    shift_id: shiftName,
    sourceType: 'single_entry',
    source_type: 'single_entry',
    sourceTable: 'animal_event',
    source_table: 'animal_event',
    sourceRecordId: eventId,
    source_record_id: eventId,
    recordedAt,
    recorded_at: recordedAt,
    workOperatorName,
    work_operator_name: workOperatorName,
    collector: workOperatorName,
    collectorName: workOperatorName,
    collector_name: workOperatorName,
    operatorName,
    operator_name: operatorName,
    status: 'recorded',
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
  await upsertLike('milking_visit', {
    ...common,
    id: visitId,
    enteredAt: measuredAt,
    entered_at: measuredAt
  })
  await upsertLike('milk_measurement', common)
  await upsertLike('milk-records', common)
  return [sessionId, visitId, measurementId]
}

function isMilkProductionEvent(row: ParsedImportRow, eventCode: string) {
  const eventText = [
    eventCode,
    row.mappedRow.event_name,
    row.mappedRow.eventName,
    row.mappedRow.rawEventName,
    row.mappedRow.raw_event_name,
    row.mappedRow['事件名称']
  ]
    .map(text)
    .join(' ')
  return ['milking', 'milking_session'].includes(eventCode) || /采奶|挤奶|产奶/.test(eventText)
}

function milkYieldFromEventRow(row: Record<string, any>) {
  const value = firstMappedValue(row, [
    'milk_yield',
    'milkYield',
    'volume',
    'milkVolume',
    'trait__milk_yield',
    '产奶量',
    '产奶量 kg',
    '单次产奶量',
    '单次产奶量 kg'
  ])
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function firstMappedValue(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key]
    if (value !== undefined && value !== null && text(value) !== '') return value
  }
  return ''
}

async function writeEventDetails(
  template: ImportTemplate,
  id: string,
  row: ParsedImportRow,
  eventCode: string,
  eventTime: string
) {
  const now = new Date().toISOString()
  const base = {
    id,
    animalId: row.resolvedCow.cowId,
    animal_id: row.resolvedCow.cowId,
    cowNumber: row.resolvedCow.cowNumber,
    cow_number: row.resolvedCow.cowNumber,
    eventId: id,
    event_id: id,
    eventType: eventCode,
    event_type: eventCode,
    occurredAt: eventTime,
    occurred_at: eventTime,
    detail: jsonDetail(row.mappedRow),
    details: row.mappedRow,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }
  if (
    template.target === 'reproduction_event' ||
    ['insemination', 'pregnancy_check', 'calving', 'abortion', 'heat'].includes(eventCode)
  ) {
    const bullNumber = mappedText(row.mappedRow, [
      'bull_number',
      'bullNumber',
      'father_number',
      'fatherNumber',
      '公牛号',
      '父号/公牛号',
      '父号'
    ])
    const semenBatch = mappedText(row.mappedRow, ['semen_batch', 'semenBatch', '精液批号'])
    const pregnancyResult = mappedText(row.mappedRow, [
      'pregnancy_result',
      'pregnancyResult',
      '妊检结果',
      '结果'
    ])
    const calvingResult = mappedText(row.mappedRow, [
      'calving_result',
      'calvingResult',
      '产犊结果',
      '结果'
    ])
    const reproductionStatusSnapshot = mappedText(row.mappedRow, [
      'reproduction_status_snapshot',
      'reproductionStatusSnapshot',
      'reproduction_status',
      'reproductionStatus',
      '繁殖状态快照',
      '繁殖状态'
    ])
    await upsertLike('event_reproduction_detail', {
      ...base,
      reproductionAction: eventCode,
      reproduction_action: eventCode,
      reproductionStatusSnapshot,
      reproduction_status_snapshot: reproductionStatusSnapshot,
      bullAnimalId: null,
      bull_animal_id: null,
      bullNumber,
      bull_number: bullNumber,
      semenBatch,
      semen_batch: semenBatch,
      pregnancyResult,
      pregnancy_result: pregnancyResult,
      calvingResult,
      calving_result: calvingResult,
      calfAnimalId: null,
      calf_animal_id: null
    })
  } else if (
    template.target === 'health_medicine' ||
    ['diagnosis', 'treatment', 'medication', 'vaccination', 'death'].includes(eventCode)
  ) {
    await upsertLike('event_health_detail', {
      ...base,
      diagnosisCode: text(row.mappedRow.diagnosis_code || row.mappedRow.diagnosisCode),
      diagnosis_code: text(row.mappedRow.diagnosis_code || row.mappedRow.diagnosisCode),
      diagnosisName: text(row.mappedRow.diagnosis_name || row.mappedRow.diagnosisName),
      diagnosis_name: text(row.mappedRow.diagnosis_name || row.mappedRow.diagnosisName),
      symptomSummary: text(row.mappedRow.symptom_summary || row.mappedRow.symptomSummary),
      symptom_summary: text(row.mappedRow.symptom_summary || row.mappedRow.symptomSummary),
      veterinarian: text(row.mappedRow.veterinarian) || rowOperatorName(row),
      treatmentPlan: text(row.mappedRow.treatment_plan || row.mappedRow.treatmentPlan),
      treatment_plan: text(row.mappedRow.treatment_plan || row.mappedRow.treatmentPlan),
      detail: jsonDetail(row.mappedRow)
    })
    if (row.mappedRow.medicine_code) {
      await upsertLike('event_medicine_detail', {
        ...base,
        medicineId: text(row.mappedRow.medicine_id || row.mappedRow.medicine_code),
        medicine_id: text(row.mappedRow.medicine_id || row.mappedRow.medicine_code),
        medicineBatchId: text(row.mappedRow.medicine_batch_id || row.mappedRow.medicine_batch_no),
        medicine_batch_id: text(row.mappedRow.medicine_batch_id || row.mappedRow.medicine_batch_no),
        dose: row.mappedRow.dose,
        doseUnit: text(row.mappedRow.dose_unit || row.mappedRow.doseUnit),
        dose_unit: text(row.mappedRow.dose_unit || row.mappedRow.doseUnit),
        route: text(row.mappedRow.route),
        withdrawalDays: row.mappedRow.withdrawal_days,
        withdrawal_days: row.mappedRow.withdrawal_days,
        detail: jsonDetail(row.mappedRow)
      })
    }
    if (eventCode === 'death') await writeMovementDetail(base, row, eventCode)
  } else if (['entry', 'transfer', 'exit', 'death'].includes(eventCode)) {
    await writeMovementDetail(base, row, eventCode)
  } else if (
    [
      'milking',
      'milking_session',
      'milk_quality',
      'dhi_test',
      'feeding',
      'feed_delivery',
      'feed_adjustment',
      'weighing',
      'body_measurement',
      'dry_off'
    ].includes(eventCode)
  ) {
    const dryOffDate =
      eventCode === 'dry_off'
        ? text(
            row.mappedRow.dry_off_date ||
              row.mappedRow.dryOffDate ||
              row.mappedRow.lactation_end_date ||
              row.mappedRow.lactationEndDate ||
              eventTime
          ).slice(0, 10)
        : ''
    const dryReason =
      eventCode === 'dry_off'
        ? text(row.mappedRow.dry_reason || row.mappedRow.dryReason || row.mappedRow.reason)
        : ''
    const productionDate =
      dryOffDate ||
      text(row.mappedRow.production_date || row.mappedRow.productionDate || eventTime).slice(0, 10)
    await upsertLike('event_production_detail', {
      ...base,
      operationType: eventCode,
      operation_type: eventCode,
      productionDate,
      production_date: productionDate,
      workUnitId: text(row.mappedRow.unit_code || row.mappedRow.to_unit_code),
      work_unit_id: text(row.mappedRow.unit_code || row.mappedRow.to_unit_code),
      resultSummary: text(
        dryReason || row.mappedRow.check_result || row.mappedRow.quality_flag || row.mappedRow.notes
      ),
      result_summary: text(
        dryReason || row.mappedRow.check_result || row.mappedRow.quality_flag || row.mappedRow.notes
      )
    })
    if (eventCode === 'body_measurement') {
      await writeBodyMeasurementTraitObservations(id, row, eventTime)
    }
  }
}

function normalizeEventStatus(value: unknown) {
  const raw = text(value)
  const map: Record<string, string> = {
    已记录: 'recorded',
    待复核: 'pending_review',
    已确认: 'confirmed',
    已作废: 'voided',
    recorded: 'recorded',
    pending_review: 'pending_review',
    confirmed: 'confirmed',
    voided: 'voided'
  }
  return map[raw] || raw || 'recorded'
}

function compactAnimalRecordId(value: unknown) {
  const cleaned = text(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (cleaned && cleaned.length <= 64) return cleaned
  return stableId('animal', value)
}

async function writeMovementDetail(
  base: Record<string, any>,
  row: ParsedImportRow,
  eventCode: string
) {
  const fromUnit = text(
    row.mappedRow.from_unit_id ||
      row.mappedRow.fromUnitId ||
      row.mappedRow.from_unit_code ||
      row.mappedRow.fromUnitCode ||
      row.mappedRow.current_pen_snapshot ||
      row.mappedRow.currentPenSnapshot
  )
  const toUnit =
    eventCode === 'death' || eventCode === 'exit'
      ? ''
      : text(
          row.mappedRow.to_unit_id ||
            row.mappedRow.toUnitId ||
            row.mappedRow.to_unit_code ||
            row.mappedRow.toUnitCode ||
            row.mappedRow.unit_id ||
            row.mappedRow.unitId ||
            row.mappedRow.unit_code ||
            row.mappedRow.unitCode
        )
  const reason =
    eventCode === 'death'
      ? '死亡离群'
      : text(
          row.mappedRow.movement_reason ||
            row.mappedRow.movementReason ||
            row.mappedRow.entry_reason ||
            row.mappedRow.transfer_reason ||
            row.mappedRow.exit_reason
        )
  await upsertLike('event_movement_detail', {
    ...base,
    fromUnitId: fromUnit,
    from_unit_id: fromUnit,
    fromUnitCode: fromUnit,
    from_unit_code: fromUnit,
    toUnitId: toUnit,
    to_unit_id: toUnit,
    toUnitCode: toUnit,
    to_unit_code: toUnit,
    unitId: toUnit,
    unit_id: toUnit,
    unitCode: toUnit,
    unit_code: toUnit,
    movementReason: reason,
    movement_reason: reason,
    approvalStatus: 'recorded',
    approval_status: 'recorded'
  })
}

async function writeBodyMeasurementTraitObservations(
  eventId: string,
  row: ParsedImportRow,
  eventTime: string
) {
  const animal = await ensureAnimalForV2Fk(row.resolvedCow, row.mappedRow)
  row.resolvedCow.cowId = animal.id
  row.resolvedCow.cowNumber = animal.number || row.resolvedCow.cowNumber
  const rawItems = Array.isArray(row.mappedRow.trait_observations)
    ? row.mappedRow.trait_observations
    : Array.isArray(row.mappedRow.traitValues)
      ? row.mappedRow.traitValues
      : []
  const [storedTraits, v2Traits] = await Promise.all([
    databaseService
      .getTableDataAsync('phenotype-trait-definitions', { silent: true })
      .catch(() => []),
    databaseService.getTableDataAsync('trait_definition', { silent: true }).catch(() => [])
  ])
  const traitMap = new Map(
    [...DEFAULT_PHENOTYPE_TRAITS, ...(storedTraits || []), ...(v2Traits || [])]
      .map((trait: any) => ({
        code: text(trait.code || trait.traitCode || trait.trait_code),
        name: text(trait.name || trait.traitName || trait.trait_name),
        unit: text(trait.unit),
        status: text(trait.status || '启用')
      }))
      .filter((trait) => trait.code && trait.status !== '停用')
      .map((trait) => [trait.code, trait])
  )
  const now = new Date().toISOString()
  const ids: string[] = []
  const batchId = stableId(
    'trait-observation-batch',
    'single-entry',
    eventTime.slice(0, 10),
    rowOperatorName(row)
  )
  const collectorName = rowCollectorName(row) || rowOperatorName(row)
  await ensureTraitObservationBatch(batchId, {
    ...row.mappedRow,
    batchName: `现场体尺测定 ${eventTime.slice(0, 10)}`,
    sourceType: 'single_entry',
    operatorName: rowOperatorName(row),
    collector: collectorName,
    collectedAt: eventTime
  })
  const eventShift = explicitMilkShift(row.mappedRow)
  const eventParityCalvingDate = text(
    row.mappedRow.parity_calving_date ||
      row.mappedRow.parityCalvingDate ||
      row.mappedRow.calving_date ||
      row.mappedRow.calvingDate
  )
  for (const item of rawItems) {
    const traitCode = text(item?.traitCode || item?.trait_code)
    if (!traitCode || !traitMap.has(traitCode)) continue
    const value = Number(item?.value ?? item?.numericValue ?? item?.numeric_value)
    if (!Number.isFinite(value)) continue
    const trait = traitMap.get(traitCode)
    const canonicalTrait = await ensureTraitDefinitionForObservation(traitCode, {
      ...item,
      traitName: item?.traitName || item?.trait_name || trait?.name,
      unit: item?.unit || trait?.unit
    })
    const observedAt = text(
      item?.observedAt ||
        item?.observed_at ||
        item?.collectionDate ||
        item?.collection_date ||
        eventTime
    )
    const shiftName = normalizeOptionalMilkShift(
      item?.shiftName ||
        item?.shift_name ||
        item?.shiftId ||
        item?.shift_id ||
        item?.shift ||
        eventShift
    )
    const parityCalvingDate = text(
      item?.parityCalvingDate ||
        item?.parity_calving_date ||
        item?.calvingDate ||
        item?.calving_date ||
        eventParityCalvingDate
    )
    const id = stableId(
      'trait-observation',
      row.resolvedCow.sourceKey,
      traitCode,
      observedAt,
      eventId
    )
    const record = {
      id,
      batchId,
      batch_id: batchId,
      cowId: row.resolvedCow.cowId,
      cow_id: row.resolvedCow.cowId,
      animalId: row.resolvedCow.cowId,
      animal_id: row.resolvedCow.cowId,
      cowNumber: row.resolvedCow.cowNumber,
      cow_number: row.resolvedCow.cowNumber,
      animalNumber: row.resolvedCow.cowNumber,
      animal_number: row.resolvedCow.cowNumber,
      traitCode,
      trait_code: traitCode,
      traitId: canonicalTrait.id,
      trait_id: canonicalTrait.id,
      traitName: text(item?.traitName || item?.trait_name || canonicalTrait.name || trait?.name),
      trait_name: text(item?.traitName || item?.trait_name || canonicalTrait.name || trait?.name),
      value,
      numericValue: value,
      numeric_value: value,
      unit: text(item?.unit || canonicalTrait.unit || trait?.unit),
      collectionDate: observedAt,
      collection_date: observedAt,
      observedAt,
      observed_at: observedAt,
      milkingShift: shiftName,
      milking_shift: shiftName,
      shiftName,
      shift_name: shiftName,
      shiftId: shiftName,
      shift_id: shiftName,
      parityNo:
        item?.parityNo || item?.parity_no || row.mappedRow.parityNo || row.mappedRow.parity_no,
      parity_no:
        item?.parityNo || item?.parity_no || row.mappedRow.parityNo || row.mappedRow.parity_no,
      parityCalvingDate,
      parity_calving_date: parityCalvingDate,
      calvingDate: parityCalvingDate,
      calving_date: parityCalvingDate,
      dataSource: '现场录入',
      data_source: '现场录入',
      sourceType: 'single_entry',
      source_type: 'single_entry',
      sourceTable: 'animal_event',
      source_table: 'animal_event',
      sourceRecordId: eventId,
      source_record_id: eventId,
      qualityFlag: text(row.mappedRow.quality_flag || '正常'),
      quality_flag: text(row.mappedRow.quality_flag || '正常'),
      collector: text(item?.collector || item?.collector_name || collectorName),
      operatorName: rowOperatorName(row),
      operator_name: rowOperatorName(row),
      notes: text(row.mappedRow.notes),
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    }
    await upsertLike('trait_observation', record)
    await upsertLike('phenotype-records', record)
    ids.push(id)
  }
  return ids
}

async function writeLegacyEvent(
  template: ImportTemplate,
  id: string,
  row: ParsedImportRow,
  eventCode: string,
  eventTime: string
) {
  const now = new Date().toISOString()
  const cowNumber = row.resolvedCow.cowNumber || text(row.mappedRow.animal_number)
  const currentPen = currentPenOf(row.resolvedCow.cow) || text(row.mappedRow.current_pen_snapshot)
  const targetUnit = movementTargetUnit(row.mappedRow)
  const operatorName = rowOperatorName(row)
  const workOperatorName = rowWorkOperatorName(row)
  const recordedAt = text(row.mappedRow.recorded_at || row.mappedRow.recordedAt || eventTime)
  const standardTrace = {
    animalId: row.resolvedCow.cowId,
    animal_id: row.resolvedCow.cowId,
    animalNumber: cowNumber,
    animal_number: cowNumber,
    operatorName,
    operator_name: operatorName,
    workOperatorName,
    work_operator_name: workOperatorName,
    recordedAt,
    recorded_at: recordedAt,
    sourceTable: 'animal_event',
    source_table: 'animal_event',
    sourceRecordId: id,
    source_record_id: id
  }
  if (eventCode === 'entry') {
    await upsertLike('entry-events', {
      ...standardTrace,
      id,
      cowNumber,
      reason: text(
        row.mappedRow.movement_reason ||
          row.mappedRow.entry_reason ||
          row.mappedRow.event_name ||
          row.mappedRow.notes ||
          '入群'
      ),
      pen: targetUnit,
      recorder: operatorName,
      entryTime: eventTime,
      notes: text(row.mappedRow.notes),
      createdAt: now
    })
  } else if (eventCode === 'transfer') {
    await upsertLike('transfer-events', {
      ...standardTrace,
      id,
      cowNumber,
      reason: text(
        row.mappedRow.movement_reason ||
          row.mappedRow.transfer_reason ||
          row.mappedRow.event_name ||
          row.mappedRow.notes ||
          '转群'
      ),
      fromPen: currentPen,
      fromUnitId: currentPen,
      from_unit_id: currentPen,
      currentPen,
      current_pen: currentPen,
      toPen: targetUnit,
      toUnitId: targetUnit,
      to_unit_id: targetUnit,
      recorder: operatorName,
      transferTime: eventTime,
      notes: text(row.mappedRow.notes),
      createdAt: now
    })
  } else if (eventCode === 'exit') {
    await upsertLike('exit-events', {
      ...standardTrace,
      id,
      cowNumber,
      reason: text(
        row.mappedRow.movement_reason ||
          row.mappedRow.exit_reason ||
          row.mappedRow.event_name ||
          row.mappedRow.notes ||
          '离群'
      ),
      fromPen: currentPen,
      fromUnitId: currentPen,
      from_unit_id: currentPen,
      currentPen,
      current_pen: currentPen,
      recorder: operatorName,
      exitTime: eventTime,
      notes: text(row.mappedRow.notes),
      createdAt: now
    })
  } else if (
    template.target === 'reproduction_event' ||
    [
      'heat',
      'insemination',
      'pregnancy_check',
      'calving',
      'abortion',
      'postpartum_check',
      'embryo_transfer'
    ].includes(eventCode)
  ) {
    const pregnancyResult = mappedText(row.mappedRow, [
      'pregnancy_result',
      'pregnancyResult',
      '妊检结果',
      '结果'
    ])
    const calvingResult = mappedText(row.mappedRow, [
      'calving_result',
      'calvingResult',
      '产犊结果',
      '结果'
    ])
    await upsertLike('breeding-events', {
      ...standardTrace,
      id,
      cowNumber,
      eventType: reproductionLegacyName(eventCode),
      eventTime,
      eventDate: eventTime.slice(0, 10),
      person: workOperatorName || operatorName,
      bullNumber: mappedText(row.mappedRow, ['bull_number', 'bullNumber', '公牛号']),
      semenNumber: mappedText(row.mappedRow, ['semen_batch', 'semenBatch', '精液批号']),
      pregnancyResult,
      calvingResult,
      notes: text(row.mappedRow.notes),
      createdAt: now
    })
  } else if (
    template.target === 'health_medicine' ||
    [
      'diagnosis',
      'treatment',
      'medication',
      'vaccination',
      'deworming',
      'quarantine',
      'disinfection',
      'lab_test',
      'hoof_trim',
      'mastitis_check',
      'death'
    ].includes(eventCode)
  ) {
    await upsertLike('veterinary-events', {
      ...standardTrace,
      id,
      cowNumber,
      eventType: healthLegacyName(eventCode),
      eventTime,
      eventDate: eventTime.slice(0, 10),
      person: workOperatorName || operatorName,
      disease: text(row.mappedRow.diagnosis_name),
      medicine: text(row.mappedRow.medicine_code),
      dosage: row.mappedRow.dose,
      notes: text(row.mappedRow.notes),
      createdAt: now
    })
  }
}

async function commitOmicsSample(row: ParsedImportRow) {
  const animal = await ensureAnimalForV2Fk(row.resolvedCow, row.mappedRow)
  row.resolvedCow.cowId = animal.id
  row.resolvedCow.cowNumber = animal.number || row.resolvedCow.cowNumber
  const now = new Date().toISOString()
  const id = text(row.mappedRow.sample_code)
  const operatorName = rowOperatorName(row)
  const workOperatorName = rowWorkOperatorName(row) || operatorName
  const collectedAt = text(
    row.mappedRow.collected_at || row.mappedRow.collection_date || now.slice(0, 10)
  )
  const record = {
    id,
    sampleCode: id,
    sample_code: id,
    cowId: row.resolvedCow.cowId,
    cow_id: row.resolvedCow.cowId,
    cowNumber: row.resolvedCow.cowNumber,
    cow_number: row.resolvedCow.cowNumber,
    animalId: row.resolvedCow.cowId,
    animal_id: row.resolvedCow.cowId,
    animalNumber: row.resolvedCow.cowNumber,
    animal_number: row.resolvedCow.cowNumber,
    sampleType: text(row.mappedRow.sample_type),
    sample_type: text(row.mappedRow.sample_type),
    collectedAt,
    collected_at: collectedAt,
    collectionDate: collectedAt,
    collection_date: collectedAt,
    sourceTissue: text(row.mappedRow.source_tissue),
    source_tissue: text(row.mappedRow.source_tissue),
    storageLocation: text(row.mappedRow.storage_location),
    storage_location: text(row.mappedRow.storage_location),
    qualityScore: row.mappedRow.quality_score,
    quality_score: row.mappedRow.quality_score,
    status: text(row.mappedRow.status || '已入库'),
    operatorName,
    operator_name: operatorName,
    workOperatorName,
    work_operator_name: workOperatorName,
    collector: workOperatorName,
    recordedAt: text(row.mappedRow.recorded_at || row.mappedRow.recordedAt || collectedAt),
    recorded_at: text(row.mappedRow.recorded_at || row.mappedRow.recordedAt || collectedAt),
    sourceTable: 'information-import',
    source_table: 'information-import',
    sourceRecordId: `omics-sample:${row.rowIndex}`,
    source_record_id: `omics-sample:${row.rowIndex}`,
    notes: text(row.mappedRow.notes),
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }
  await upsertLike('omics_samples', record)
  return [id]
}

async function commitOmicsDataset(row: ParsedImportRow) {
  const now = new Date().toISOString()
  const datasetId = text(row.mappedRow.dataset_code)
  const ids = [datasetId]
  await upsertLike('omics_datasets', {
    id: datasetId,
    datasetCode: datasetId,
    dataset_code: datasetId,
    name: text(row.mappedRow.dataset_name || datasetId),
    dataType: text(row.mappedRow.data_type),
    data_type: text(row.mappedRow.data_type),
    platform: text(row.mappedRow.platform),
    status: '已导入',
    generatedAt: now,
    generated_at: now,
    updatedAt: now,
    updated_at: now
  })
  const sampleCode = text(row.mappedRow.sample_code)
  if (sampleCode) {
    const sampleLinkId = stableId('omics-dataset-sample', datasetId, sampleCode)
    const sampleRow = await findOmicsSampleByCode(sampleCode)
    await upsertLike('omics_dataset_sample', {
      id: sampleLinkId,
      datasetId,
      dataset_id: datasetId,
      datasetCode: datasetId,
      dataset_code: datasetId,
      sampleId: text(sampleRow?.id || sampleCode),
      sample_id: text(sampleRow?.id || sampleCode),
      sampleCode,
      sample_code: sampleCode,
      animalId: text(
        sampleRow?.cowId || sampleRow?.cow_id || sampleRow?.animalId || sampleRow?.animal_id
      ),
      animal_id: text(
        sampleRow?.cowId || sampleRow?.cow_id || sampleRow?.animalId || sampleRow?.animal_id
      ),
      groupLabel: text(row.mappedRow.group_label || row.mappedRow.groupLabel),
      group_label: text(row.mappedRow.group_label || row.mappedRow.groupLabel),
      includedFlag: 1,
      included_flag: 1,
      status: 'linked',
      sourceType: 'batch_import',
      source_type: 'batch_import',
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    })
    ids.push(sampleLinkId)
  }
  const markerCode = text(row.mappedRow.marker_code)
  const markerId = markerCode ? stableId('omics-marker', datasetId, markerCode) : ''
  const featureId = markerCode ? stableId('omics-feature', datasetId, markerCode) : ''
  if (markerCode) {
    await upsertLike('omics_markers', {
      id: markerId,
      datasetId,
      dataset_id: datasetId,
      markerCode,
      marker_code: markerCode,
      markerType: text(row.mappedRow.marker_type),
      marker_type: text(row.mappedRow.marker_type),
      geneSymbol: text(row.mappedRow.gene_symbol),
      gene_symbol: text(row.mappedRow.gene_symbol),
      trait: text(row.mappedRow.trait_code),
      pValue: row.mappedRow.p_value,
      p_value: row.mappedRow.p_value,
      effectSize: row.mappedRow.effect_size,
      effect_size: row.mappedRow.effect_size,
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    })
    await upsertLike('omics_feature', {
      id: featureId,
      datasetId,
      dataset_id: datasetId,
      featureCode: markerCode,
      feature_code: markerCode,
      featureName: markerCode,
      feature_name: markerCode,
      featureType: text(row.mappedRow.marker_type || 'marker'),
      feature_type: text(row.mappedRow.marker_type || 'marker'),
      geneSymbol: text(row.mappedRow.gene_symbol),
      gene_symbol: text(row.mappedRow.gene_symbol),
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    })
    ids.push(markerId)
    ids.push(featureId)
  }
  const traitCode = text(row.mappedRow.trait_code)
  if (traitCode) {
    const trait = await ensureTraitDefinitionForObservation(traitCode, row.mappedRow)
    const traitLinkId = stableId('omics-trait-link', datasetId, markerCode || 'dataset', traitCode)
    await upsertLike('omics_trait_link', {
      id: traitLinkId,
      featureId,
      feature_id: featureId || null,
      traitId: trait.id,
      trait_id: trait.id,
      datasetId,
      dataset_id: datasetId,
      datasetCode: datasetId,
      dataset_code: datasetId,
      markerId,
      marker_id: markerId,
      markerCode,
      marker_code: markerCode,
      traitCode,
      trait_code: traitCode,
      linkType: markerCode ? 'marker_trait' : 'dataset_trait',
      link_type: markerCode ? 'marker_trait' : 'dataset_trait',
      pValue: row.mappedRow.p_value,
      p_value: row.mappedRow.p_value,
      effectSize: row.mappedRow.effect_size,
      effect_size: row.mappedRow.effect_size,
      sourceTable: 'information-import',
      source_table: 'information-import',
      status: 'linked',
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    })
    ids.push(traitLinkId)
  }
  return ids
}

async function findOmicsSampleByCode(sampleCode: string) {
  if (!sampleCode) return null
  const rows = await databaseService
    .getTableDataAsync('omics_samples', { silent: true })
    .catch(() => [])
  return (
    (rows || []).find(
      (row: any) =>
        text(row.id) === sampleCode || text(row.sampleCode || row.sample_code) === sampleCode
    ) || null
  )
}

async function commitDeviceSensor(row: ParsedImportRow) {
  const animal = row.resolvedCow.resolved
    ? await ensureAnimalForV2Fk(row.resolvedCow, row.mappedRow)
    : null
  if (animal) {
    row.resolvedCow.cowId = animal.id
    row.resolvedCow.cowNumber = animal.number || row.resolvedCow.cowNumber
  }
  const now = new Date().toISOString()
  const device = await ensureDeviceForSensorFk(text(row.mappedRow.device_code), row.mappedRow)
  const deviceId = device.id
  const measuredAt = text(row.mappedRow.measured_at)
  const rawReading = text(
    row.mappedRow.reading_value ??
      row.mappedRow.readingValue ??
      row.mappedRow.reading_text ??
      row.mappedRow.readingText
  )
  const numericReading = Number(rawReading)
  const hasNumericReading = rawReading !== '' && Number.isFinite(numericReading)
  const assignedAt = text(row.mappedRow.assigned_at || measuredAt || now)
  const readingId = stableId(
    'reading',
    deviceId,
    row.resolvedCow.sourceKey,
    text(row.mappedRow.metric_code),
    measuredAt
  )
  const ids = [readingId]
  if (row.resolvedCow.cowId || row.resolvedCow.cowNumber) {
    const assignmentId = stableId('animal-device-assignment', deviceId, row.resolvedCow.sourceKey)
    await upsertLike('animal_device_assignment', {
      id: assignmentId,
      deviceId,
      device_id: deviceId,
      animalId: row.resolvedCow.cowId,
      animal_id: row.resolvedCow.cowId,
      cowId: row.resolvedCow.cowId,
      cow_id: row.resolvedCow.cowId,
      cowNumber: row.resolvedCow.cowNumber,
      cow_number: row.resolvedCow.cowNumber,
      assignedAt,
      assigned_at: assignedAt,
      assignmentReason: 'batch_import',
      assignment_reason: 'batch_import',
      status: 'active',
      sourceType: 'batch_import',
      source_type: 'batch_import',
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now
    })
    ids.push(assignmentId)
  }
  await upsertLike('sensor_reading', {
    id: readingId,
    deviceId,
    device_id: deviceId,
    animalId: row.resolvedCow.cowId,
    animal_id: row.resolvedCow.cowId,
    cowId: row.resolvedCow.cowId,
    cow_id: row.resolvedCow.cowId,
    cowNumber: row.resolvedCow.cowNumber,
    cow_number: row.resolvedCow.cowNumber,
    metricCode: text(row.mappedRow.metric_code),
    metric_code: text(row.mappedRow.metric_code),
    timestamp: measuredAt,
    measuredAt,
    measured_at: measuredAt,
    value: hasNumericReading ? numericReading : rawReading,
    readingValue: hasNumericReading ? numericReading : null,
    reading_value: hasNumericReading ? numericReading : null,
    readingText: hasNumericReading ? '' : rawReading,
    reading_text: hasNumericReading ? '' : rawReading,
    unit: text(row.mappedRow.unit),
    quality: text(row.mappedRow.quality_flag || '正常'),
    quality_flag: text(row.mappedRow.quality_flag || '正常'),
    createdAt: now,
    created_at: now
  })
  await upsertLike('sensor-readings', {
    id: readingId,
    cowId: row.resolvedCow.cowId,
    cowNumber: row.resolvedCow.cowNumber,
    timestamp: measuredAt,
    metric: text(row.mappedRow.metric_code),
    value: hasNumericReading ? numericReading : rawReading,
    unit: text(row.mappedRow.unit),
    quality: text(row.mappedRow.quality_flag || '正常'),
    createdAt: now
  })
  return ids
}

async function upsertLike(table: string, row: Record<string, any>, importRow?: ParsedImportRow) {
  const baseRow = existingImportTargetForTable(importRow, table)
  const mergedRow = baseRow ? mergeImportPatch(baseRow, row) : row
  const normalizedRow = sanitizeBlankDateFields(sanitizeRpcRecord(mergedRow))
  if (enqueueImportBulkWrite(table, normalizedRow)) return
  try {
    await databaseService.upsertTableDataAsync(table, normalizedRow)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`写入 ${table} 失败：${message}`)
  }
}

function existingImportTargetForTable(importRow: ParsedImportRow | undefined, table: string) {
  if (!importRow?.existingTargets?.length) return null
  const normalizedTable = table.replace(/_/g, '-')
  return (
    importRow.existingTargets.find((row) => {
      const sourceTable = text(row.__table || row.sourceTable || row.source_table)
      return sourceTable === table || sourceTable === normalizedTable
    }) || null
  )
}

function existingImportTargetId(importRow: ParsedImportRow, table: string) {
  return text(existingImportTargetForTable(importRow, table)?.id)
}

function mergeImportPatch(existing: Record<string, any>, patch: Record<string, any>) {
  const merged = { ...existing }
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (key === '__table') return
    if (isBlankPatchValue(value)) return
    merged[key] = value
  })
  return merged
}

function isBlankPatchValue(value: unknown) {
  if (value === undefined || value === null) return true
  if (typeof value === 'string' && value.trim() === '') return true
  if (Array.isArray(value)) return false
  if (typeof value === 'object') return false
  return false
}

function sanitizeRpcRecord(row: Record<string, any>) {
  const normalized: Record<string, any> = {}
  Object.entries(row || {}).forEach(([key, value]) => {
    if (/^(cow|resolvedCow|cowContext|context|rawRow|parsedRows|errors)$/i.test(key)) return
    normalized[key] = sanitizeRpcValue(value, 3)
  })
  return normalized
}

function sanitizeRpcValue(value: any, depth: number): any {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value.toISOString()
  if (['string', 'number', 'boolean'].includes(typeof value)) return value
  if (Array.isArray(value)) {
    if (depth <= 0) return '[array]'
    return value.slice(0, 100).map((item) => sanitizeRpcValue(item, depth - 1))
  }
  if (typeof value !== 'object') return String(value)
  if (depth <= 0) return '[object]'
  const result: Record<string, any> = {}
  Object.entries(value)
    .slice(0, 120)
    .forEach(([key, item]) => {
      if (/^(cow|resolvedCow|cowContext|context|rawRow|parsedRows|errors)$/i.test(key)) return
      result[key] = sanitizeRpcValue(item, depth - 1)
    })
  const serialized = JSON.stringify(result)
  return serialized.length > 50000 ? '[large-object-omitted]' : result
}

function sanitizeBlankDateFields(row: Record<string, any>) {
  const normalized = { ...row }
  Object.keys(normalized).forEach((key) => {
    if (normalized[key] !== '') return
    if (/(^|_)(date|time|at)$|Date$|Time$|At$/.test(key)) {
      normalized[key] = null
    }
  })
  return normalized
}

function fillCowFields(row: Record<string, any>, resolved: ReturnType<typeof resolveCowRef>) {
  row.cowId = resolved.cowId || row.cowId || row.cow_id
  row.cow_id = resolved.cowId || row.cow_id || row.cowId
  row.animalId = resolved.cowId || row.animalId || row.animal_id
  row.animal_id = resolved.cowId || row.animal_id || row.animalId
  row.cowNumber = resolved.cowNumber || row.cowNumber || row.cow_number || row.animal_number
  row.cow_number = resolved.cowNumber || row.cow_number || row.cowNumber || row.animal_number
  row.animalNumber = resolved.cowNumber || row.animalNumber || row.animal_number || row.cow_number
  row.animal_number = resolved.cowNumber || row.animal_number || row.animalNumber || row.cow_number
}

function needsCow(target: ImportTarget) {
  return target !== 'omics_dataset'
}

function rowError(
  rowIndex: number,
  column: ImportTemplateColumn,
  code: string,
  message: string,
  rawRow: Record<string, any>,
  suggestion = ''
): ImportRowError {
  return {
    rowIndex,
    column: column.label,
    targetField: column.targetField,
    level: 'error',
    code,
    message,
    suggestion,
    rawRow
  }
}

function isEmpty(value: unknown) {
  return value === undefined || value === null || String(value).trim() === ''
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function jsonDetail(value: unknown) {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ value: text(value) })
  }
}

function mappedText(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    if (!key) continue
    const value = row[key]
    if (value !== undefined && value !== null && text(value)) return text(value)
    const camel = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    if (row[camel] !== undefined && row[camel] !== null && text(row[camel])) {
      return text(row[camel])
    }
    const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    if (row[snake] !== undefined && row[snake] !== null && text(row[snake])) {
      return text(row[snake])
    }
  }
  return ''
}

function stableId(prefix: string, ...parts: unknown[]) {
  const raw = parts.map(text).filter(Boolean).join('-')
  const body = parts
    .map(text)
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const cleanPrefix =
    text(prefix)
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 18) || 'row'
  const hash = hashText(raw || `${cleanPrefix}-${Date.now()}-${Math.random()}`)
  const maxBodyLength = Math.max(0, 64 - cleanPrefix.length - hash.length - 2)
  const shortBody = body.slice(0, maxBodyLength).replace(/-$/g, '')
  return [cleanPrefix, shortBody, hash].filter(Boolean).join('-').slice(0, 64)
}

function hashText(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((item) => text(item)).filter(Boolean)))
}

function toCamel(value: string) {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function toSnake(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}
