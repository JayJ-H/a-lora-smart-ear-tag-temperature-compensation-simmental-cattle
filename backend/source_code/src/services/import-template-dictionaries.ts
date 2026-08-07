import * as XLSX from 'xlsx'
import * as databaseService from '@/services/database'
import {
  DEFAULT_MILK_SHIFT_VALUES,
  INFORMATION_ENTRY_SEVERITY_SCOPE,
  INFORMATION_ENTRY_STATUS_SCOPE,
  MILK_SHIFT_SCOPE,
  baseInfoOptions,
  ensureBreedDictionary,
  ensureInformationEntryEventDictionary,
  ensureInformationEntryOptionDictionaries,
  ensureTransferReasonDictionary,
  isEnabledStatus,
  normalizeTransferReasonOption,
  textValue,
  toSelectOptions,
  uniqueOptions,
  type SelectOption
} from '@/services/platform-dictionary'
import {
  getTemplateStaticValueOptions,
  type ImportOptionSource,
  type ImportTemplate,
  type ImportTemplateColumn,
  type ImportTemplateValueOption
} from './import-templates'
import { normalizeCattleBreed } from '@/utils/cattle-breeds'

const MEDICINE_ROUTE_OPTIONS = ['肌肉注射', '皮下注射', '口服', '外用', '静脉注射']

export async function downloadImportTemplateWithDictionaries(template: ImportTemplate) {
  const valueOptions = await getTemplateDictionaryValueOptions(template)
  const workbook = await generateImportTemplateWorkbookWithDictionaries(template, valueOptions)
  XLSX.writeFile(workbook, `${template.name}_导入模板.xlsx`)
}

export async function generateImportTemplateWorkbookWithDictionaries(
  template: ImportTemplate,
  valueOptions?: ImportTemplateValueOption[]
) {
  const { generateTemplateWorkbook } = await import('./import-templates')
  return generateTemplateWorkbook(
    template,
    valueOptions || (await getTemplateDictionaryValueOptions(template))
  )
}

export async function getTemplateDictionaryValueOptions(template: ImportTemplate) {
  const sourceOptions = await loadImportDictionarySources(template)
  const staticOptions = getTemplateStaticValueOptions(template)
  const staticByField = groupValueOptions(staticOptions)

  return template.columns.flatMap((column) => {
    const source = column.optionSource
    const dynamicOptions = source ? sourceOptions[source] || [] : []
    const fallbackOptions = staticByField.get(fieldIdentity(column)) || []
    const merged = uniqueOptions([
      ...dynamicOptions,
      ...fallbackOptions.map((item) => ({
        label: item.label,
        value: item.value,
        name: item.label,
        meta: { aliases: item.aliases || [], description: item.description || '' }
      }))
    ])
    return merged.map((option, index) => ({
      fieldKey: column.key,
      fieldLabel: column.label,
      targetField: column.targetField,
      fieldSection: column.section || '',
      source: source || 'static',
      number: String(index + 1),
      value: textValue(option.value),
      label: textValue(option.label || option.name || option.value),
      aliases: optionAliases(option),
      description: textValue(option.meta?.description)
    }))
  })
}

export function resolveTemplateDictionaryValue(
  column: ImportTemplateColumn,
  value: unknown,
  options: ImportTemplateValueOption[]
) {
  const raw = textValue(value)
  const fieldOptions = options.filter(
    (option) => option.targetField === column.targetField || option.fieldKey === column.key
  )
  if (!raw || !fieldOptions.length) {
    if (raw && column.optionSource) {
      return {
        value: raw,
        hasOptions: true,
        resolved: false,
        error: true,
        suggestion: `【${column.label}】没有可用字典值，请先在平台管理维护该字段字典后再导入`
      }
    }
    return { value: raw, hasOptions: fieldOptions.length > 0, resolved: false, error: false }
  }

  const byNumber = fieldOptions.find((option) => option.number === raw)
  if (byNumber) return { value: byNumber.value, hasOptions: true, resolved: true, error: false }

  const normalized = normalizeOptionText(raw)
  const byValue = fieldOptions.find((option) =>
    [option.value, option.label, ...(option.aliases || [])].some(
      (candidate) => normalizeOptionText(candidate) === normalized
    )
  )
  if (byValue) return { value: byValue.value, hasOptions: true, resolved: true, error: false }

  return {
    value: raw,
    hasOptions: true,
    resolved: false,
    error: true,
    suggestion: `请在“字典值”工作表中为【${column.label}】选择编号，例如：${fieldOptions
      .slice(0, 8)
      .map((option) => `${option.number}=${option.label}`)
      .join('、')}`
  }
}

async function loadImportDictionarySources(template: ImportTemplate) {
  const sources = new Set(template.columns.map((column) => column.optionSource).filter(Boolean))
  const result: Partial<Record<ImportOptionSource, SelectOption[]>> = {}
  if (!sources.size) return result

  const [
    persons,
    pens,
    farmUnits,
    breeds,
    transferReasons,
    diseases,
    medicines,
    medicineRows,
    medicineBatches,
    traitRows,
    v2TraitRows,
    baseInfoRows
  ] = await Promise.all([
    needs(sources, 'operator')
      ? databaseService.getTableDataAsync('persons', { silent: true }).catch(() => [])
      : [],
    needs(sources, 'pen') ? readDictionaryRows('pens').catch(() => []) : [],
    needs(sources, 'pen') ? readDictionaryRows('farm_unit').catch(() => []) : [],
    needs(sources, 'breed') ? readDictionaryRows('breed-types', 'breed_types').catch(() => []) : [],
    needs(sources, 'transferReason')
      ? readDictionaryRows('transfer-reasons', 'transfer_reasons').catch(() => [])
      : [],
    needs(sources, 'disease')
      ? databaseService.getTableDataAsync('diseases', { silent: true }).catch(() => [])
      : [],
    needs(sources, 'medicine', 'medicineUnit', 'vaccine')
      ? databaseService.getTableDataAsync('medicines', { silent: true }).catch(() => [])
      : [],
    needs(sources, 'medicine', 'medicineUnit', 'vaccine')
      ? databaseService.getTableDataAsync('medicine', { silent: true }).catch(() => [])
      : [],
    needs(sources, 'medicineBatch')
      ? databaseService.getTableDataAsync('medicine_batch', { silent: true }).catch(() => [])
      : [],
    needs(sources, 'trait')
      ? databaseService
          .getTableDataAsync('phenotype-trait-definitions', { silent: true })
          .catch(() => [])
      : [],
    needs(sources, 'trait')
      ? readDictionaryRows('trait_definition', 'phenotype_trait_definitions').catch(() => [])
      : [],
    needs(sources, 'severity', 'eventStatus', 'milkShift', 'event')
      ? readDictionaryRows('base-info-categories', 'base_info_categories').catch(() => [])
      : []
  ])

  const baseRows = needs(sources, 'severity', 'eventStatus', 'milkShift', 'event')
    ? await ensureInformationEntryOptionDictionaries(baseInfoRows || [])
    : []

  if (sources.has('operator')) result.operator = buildOperatorOptions(persons || [])
  if (sources.has('pen')) result.pen = buildPenOptions(pens || [], farmUnits || [])
  if (sources.has('breed'))
    result.breed = buildBreedOptions(await ensureBreedDictionary(breeds || []))
  if (sources.has('transferReason')) {
    result.transferReason = buildTransferReasonOptions(
      await ensureTransferReasonDictionary(transferReasons || [])
    )
  }
  if (sources.has('disease')) result.disease = buildDiseaseOptions(diseases || [])
  if (sources.has('medicine'))
    result.medicine = buildMedicineOptions(medicines || [], medicineRows || [])
  if (sources.has('medicineBatch'))
    result.medicineBatch = buildMedicineBatchOptions(medicineBatches || [])
  if (sources.has('medicineUnit'))
    result.medicineUnit = buildMedicineUnitOptions(medicines || [], medicineRows || [])
  if (sources.has('vaccine'))
    result.vaccine = buildVaccineOptions(medicines || [], medicineRows || [])
  if (sources.has('trait')) result.trait = buildTraitOptions(traitRows || [], v2TraitRows || [])
  if (sources.has('event'))
    result.event = (await ensureInformationEntryEventDictionary(baseRows || [])).map((event) => ({
      label: `${event.label} / ${event.group}`,
      value: event.code,
      name: event.label
    }))
  if (sources.has('severity'))
    result.severity = baseInfoOptions(baseRows, INFORMATION_ENTRY_SEVERITY_SCOPE)
  if (sources.has('eventStatus'))
    result.eventStatus = baseInfoOptions(baseRows, INFORMATION_ENTRY_STATUS_SCOPE)
  if (sources.has('milkShift')) {
    const rows = baseInfoOptions(baseRows, MILK_SHIFT_SCOPE)
    result.milkShift = rows.length ? rows : toSelectOptions(DEFAULT_MILK_SHIFT_VALUES)
  }
  if (sources.has('medicineRoute')) result.medicineRoute = toSelectOptions(MEDICINE_ROUTE_OPTIONS)

  return result
}

async function readDictionaryRows(...tableNames: string[]) {
  const groups = await Promise.all(
    tableNames.map((tableName) =>
      databaseService.getTableDataAsync(tableName, { silent: true }).catch(() => [])
    )
  )
  return uniqueRowsByIdentity(groups.flat())
}

function uniqueRowsByIdentity(rows: any[]) {
  const seen = new Set<string>()
  const result: any[] = []
  ;(rows || []).forEach((row) => {
    const key = textValue(
      row?.id ||
        row?.code ||
        row?.value ||
        row?.name ||
        row?.label ||
        row?.reason ||
        JSON.stringify(row || {})
    )
    if (seen.has(key)) return
    seen.add(key)
    result.push(row)
  })
  return result
}

function buildOperatorOptions(rows: any[]) {
  return uniqueOptions(
    (rows || []).map((row: any) => {
      const status = textValue(row.status)
      if (status && !isEnabledStatus(status)) return null
      const name = textValue(
        row.name || row.realName || row.real_name || row.nickname || row.username
      )
      const role = textValue(row.role || row.department)
      const id = textValue(row.id || row.personId || row.person_id || row.username || name)
      return name
        ? {
            label: role ? `${name} / ${role}` : name,
            value: name,
            name,
            meta: { id, aliases: [id, row.username, row.realName, row.real_name].map(textValue) }
          }
        : null
    })
  )
}

function buildPenOptions(penRows: any[], farmUnits: any[]) {
  const penLookup = new Map<string, any>()
  ;(penRows || []).forEach((row: any) => {
    penIdentityKeys(row).forEach((key) => {
      if (key && !penLookup.has(key)) penLookup.set(key, row)
    })
  })
  const farmUnitKeys = new Set((farmUnits || []).flatMap((row: any) => penIdentityKeys(row)))
  const unitOptions = (farmUnits || []).map((row: any) => {
    const status = textValue(row.status)
    if (status && !isEnabledStatus(status)) return null
    const value = canonicalFarmUnitValue(row)
    if (!value) return null
    const matchedPen = penIdentityKeys(row)
      .map((key) => penLookup.get(key))
      .find(Boolean)
    const name = textValue(
      row.name ||
        row.unitName ||
        row.unit_name ||
        matchedPen?.name ||
        matchedPen?.penName ||
        row.code ||
        value
    )
    const category = textValue(
      row.category ||
        row.categoryName ||
        row.type ||
        row.unitType ||
        row.unit_type ||
        matchedPen?.category ||
        matchedPen?.type
    )
    return {
      label: category ? `${name} / ${category}` : name,
      value,
      name,
      meta: { aliases: penIdentityKeys(row) }
    }
  })
  const penOnlyOptions = (penRows || []).map((row: any) => {
    const status = textValue(row.status)
    if (status && !isEnabledStatus(status)) return null
    if (penIdentityKeys(row).some((key) => farmUnitKeys.has(key))) return null
    const value = canonicalFarmUnitValue(row)
    if (!value) return null
    const name = textValue(row.name || row.penName || row.pen_name || row.code || value)
    const category = textValue(
      row.category ||
        row.categoryName ||
        row.category_name ||
        row.type ||
        row.unitType ||
        row.unit_type
    )
    return {
      label: category ? `${name} / ${category}` : name,
      value,
      name,
      meta: { aliases: penIdentityKeys(row) }
    }
  })
  return uniqueOptions([...unitOptions, ...penOnlyOptions])
}

function buildBreedOptions(rows: any[]) {
  return uniqueOptions(
    (rows || []).map((row: any) => {
      const status = textValue(row.status)
      if (status && !isEnabledStatus(status)) return null
      const value = normalizeCattleBreed(
        row.name || row.breedName || row.breed_name || row.code || row.value
      )
      const category = textValue(row.category || row.origin)
      return value
        ? { label: category ? `${value} / ${category}` : value, value, name: value }
        : null
    })
  )
}

function buildTransferReasonOptions(rows: any[]) {
  return uniqueOptions((rows || []).map((row: any) => normalizeTransferReasonOption(row)))
}

function buildDiseaseOptions(rows: any[]) {
  return uniqueOptions(
    (rows || []).map((row: any) => {
      const status = textValue(row.status)
      if (status && !isEnabledStatus(status)) return null
      const name = textValue(row.name || row.diseaseName || row.disease_name || row.diagnosis)
      const category = textValue(row.category || row.categoryName || row.type || row.diseaseType)
      return name ? { label: category ? `${name} / ${category}` : name, value: name, name } : null
    })
  )
}

function buildMedicineOptions(medicines: any[], medicineRows: any[]) {
  return uniqueOptions(
    [...(medicines || []), ...(medicineRows || [])].map((row: any) => {
      const status = textValue(row.status)
      if (status && !isEnabledStatus(status)) return null
      const value = textValue(
        row.code || row.medicineCode || row.medicine_code || row.name || row.id
      )
      const name = textValue(
        row.name || row.medicineName || row.medicine_name || row.code || row.id
      )
      const category = textValue(row.category || row.categoryName || row.type || row.medicineType)
      return value
        ? {
            label: category ? `${name} / ${category}` : name,
            value,
            name,
            meta: { aliases: [name, row.id, row.medicineCode, row.medicine_code].map(textValue) }
          }
        : null
    })
  )
}

function buildMedicineBatchOptions(rows: any[]) {
  return uniqueOptions(
    (rows || []).map((row: any) => {
      const value = textValue(
        row.batchNo || row.batch_no || row.batchCode || row.batch_code || row.code || row.id
      )
      const name = textValue(row.name || row.batchName || row.batch_name || value)
      const medicine = textValue(
        row.medicineName || row.medicine_name || row.medicineCode || row.medicine_code
      )
      return value
        ? {
            label: medicine ? `${name} / ${medicine}` : name,
            value,
            name,
            meta: { aliases: [name, row.id, row.batchNo, row.batch_no].map(textValue) }
          }
        : null
    })
  )
}

function buildMedicineUnitOptions(medicines: any[], medicineRows: any[]) {
  return uniqueOptions(
    [...(medicines || []), ...(medicineRows || [])].map((row: any) => {
      const status = textValue(row.status)
      if (status && !isEnabledStatus(status)) return null
      const value = textValue(row.unit || row.doseUnit || row.dose_unit)
      return value ? { label: value, value, name: value } : null
    })
  )
}

function buildVaccineOptions(medicines: any[], medicineRows: any[]) {
  return uniqueOptions(
    [...(medicines || []), ...(medicineRows || [])].map((row: any) => {
      const status = textValue(row.status)
      if (status && !isEnabledStatus(status)) return null
      const category = textValue(row.category || row.categoryName || row.type || row.medicineType)
      if (category && !category.includes('疫苗')) return null
      const value = textValue(
        row.code || row.medicineCode || row.medicine_code || row.name || row.id
      )
      const name = textValue(
        row.name || row.medicineName || row.medicine_name || row.code || row.id
      )
      return value ? { label: category ? `${name} / ${category}` : name, value, name } : null
    })
  )
}

function buildTraitOptions(rows: any[], v2Rows: any[]) {
  return uniqueOptions(
    [...(rows || []), ...(v2Rows || [])].map((row: any) => {
      const status = textValue(row.status)
      if (status && !isEnabledStatus(status)) return null
      const value = textValue(row.code || row.traitCode || row.trait_code || row.id)
      const name = textValue(row.name || row.traitName || row.trait_name || value)
      const category = textValue(row.category || row.categoryName || row.group || row.type)
      return value
        ? {
            label: category ? `${name} / ${category}` : name,
            value,
            name,
            meta: { aliases: [name, row.id].map(textValue) }
          }
        : null
    })
  )
}

function canonicalFarmUnitValue(row: Record<string, any>) {
  return textValue(
    row.id ||
      row.unitId ||
      row.unit_id ||
      row.code ||
      row.unitCode ||
      row.unit_code ||
      row.penCode ||
      row.pen_code ||
      row.name ||
      row.penName ||
      row.pen_name
  )
}

function penIdentityKeys(row: Record<string, any> | undefined) {
  if (!row) return []
  return [
    row.id,
    row.unitId,
    row.unit_id,
    row.code,
    row.unitCode,
    row.unit_code,
    row.penCode,
    row.pen_code,
    row.name,
    row.penName,
    row.pen_name,
    row.unitName,
    row.unit_name
  ]
    .map(textValue)
    .filter(Boolean)
}

function optionAliases(option: SelectOption) {
  const metaAliases = Array.isArray(option.meta?.aliases)
    ? option.meta.aliases.map(textValue).filter(Boolean)
    : []
  return uniqueText([option.value, option.label, option.name, ...metaAliases])
}

function groupValueOptions(options: ImportTemplateValueOption[]) {
  const map = new Map<string, ImportTemplateValueOption[]>()
  options.forEach((option) => {
    const key = `${option.fieldKey}::${option.targetField}`
    map.set(key, [...(map.get(key) || []), option])
  })
  return map
}

function fieldIdentity(column: ImportTemplateColumn) {
  return `${column.key}::${column.targetField}`
}

function needs(sources: Set<ImportOptionSource | undefined>, ...items: ImportOptionSource[]) {
  return items.some((item) => sources.has(item))
}

function uniqueText(values: unknown[]) {
  return Array.from(new Set(values.map(textValue).filter(Boolean)))
}

function normalizeOptionText(value: unknown) {
  return textValue(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}
