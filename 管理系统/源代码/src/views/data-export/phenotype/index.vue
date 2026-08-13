<template>
  <div class="p-5">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">表型数据导出</h1>
        <p class="text-gray-600 dark:text-gray-300 mt-1"
          >按性状字典和导出口径导出牛只表型、泌乳、DHI、体尺体重和质量性状</p
        >
      </div>
      <ElTag type="success"
        >性状字典 {{ activeTraits.length }} 项 / 导出口径 {{ activeMethods.length }} 项</ElTag
      >
    </div>

    <div class="bg-white p-6 rounded-lg border border-gray-200 shadow-sm mb-6">
      <h2 class="text-lg font-semibold mb-4 text-gray-900 dark:text-white">导出配置</h2>

      <ElForm
        ref="formRef"
        :model="exportConfig"
        :rules="formRules"
        label-width="120px"
        class="max-w-6xl"
      >
        <ElRow :gutter="20">
          <ElCol :span="8">
            <ElFormItem label="导出格式" prop="format">
              <ElSelect v-model="exportConfig.format" placeholder="选择导出格式">
                <ElOption label="Excel (.xlsx)" value="xlsx" />
                <ElOption label="CSV (.csv)" value="csv" />
              </ElSelect>
            </ElFormItem>
          </ElCol>
          <ElCol :span="8">
            <ElFormItem label="导出口径" prop="methodCode">
              <ElSelect v-model="exportConfig.methodCode" filterable placeholder="选择导出口径">
                <ElOption
                  v-for="method in activeMethods"
                  :key="method.code"
                  :label="`${method.name} · ${method.category}`"
                  :value="method.code"
                />
              </ElSelect>
            </ElFormItem>
          </ElCol>
          <ElCol :span="8">
            <ElFormItem label="性状大类">
              <ElSelect
                v-model="exportConfig.categories"
                multiple
                collapse-tags
                collapse-tags-tooltip
                clearable
                placeholder="全部大类"
                @change="syncTraitSelection"
              >
                <ElOption
                  v-for="category in categoryOptions"
                  :key="category"
                  :label="category"
                  :value="category"
                />
              </ElSelect>
            </ElFormItem>
          </ElCol>
        </ElRow>

        <ElRow :gutter="20">
          <ElCol :span="12">
            <ElFormItem label="性状选择" prop="traitCodes">
              <ElSelect
                v-model="exportConfig.traitCodes"
                multiple
                filterable
                collapse-tags
                collapse-tags-tooltip
                placeholder="选择要导出的性状"
              >
                <ElOption
                  v-for="trait in filteredTraitOptions"
                  :key="trait.code"
                  :label="`${trait.name} (${trait.category})`"
                  :value="trait.code"
                />
              </ElSelect>
            </ElFormItem>
          </ElCol>
          <ElCol :span="6">
            <ElFormItem label="开始日期">
              <ElDatePicker
                v-model="exportConfig.startDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="开始日期"
              />
            </ElFormItem>
          </ElCol>
          <ElCol :span="6">
            <ElFormItem label="结束日期">
              <ElDatePicker
                v-model="exportConfig.endDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="结束日期"
              />
            </ElFormItem>
          </ElCol>
        </ElRow>

        <ElRow :gutter="20">
          <ElCol :span="8">
            <ElFormItem label="牛号">
              <ElInput v-model="exportConfig.cowNumber" clearable placeholder="按牛号或耳标筛选" />
            </ElFormItem>
          </ElCol>
          <ElCol :span="8">
            <ElFormItem label="胎次">
              <ElSelect
                v-model="exportConfig.parities"
                multiple
                clearable
                collapse-tags
                collapse-tags-tooltip
                placeholder="全部胎次"
              >
                <ElOption
                  v-for="parity in parityOptions"
                  :key="parity"
                  :label="`第 ${parity} 胎`"
                  :value="parity"
                />
              </ElSelect>
            </ElFormItem>
          </ElCol>
          <ElCol :span="8">
            <ElFormItem label="泌乳天数">
              <div class="inline-range">
                <ElInputNumber
                  v-model="exportConfig.daysInMilkStart"
                  :min="0"
                  :max="999"
                  placeholder="起"
                />
                <span>至</span>
                <ElInputNumber
                  v-model="exportConfig.daysInMilkEnd"
                  :min="0"
                  :max="999"
                  placeholder="止"
                />
              </div>
            </ElFormItem>
          </ElCol>
        </ElRow>

        <ElFormItem label="导出字段" prop="fields">
          <ElCheckboxGroup v-model="exportConfig.fields" class="phenotype-field-groups">
            <section
              v-for="group in fieldGroups"
              :key="group.section"
              class="phenotype-field-group"
            >
              <div class="phenotype-field-group__head">
                <div>
                  <strong>{{ group.section }}</strong>
                  <span>{{ group.description }}</span>
                </div>
                <em>{{ group.fields.length }} 项</em>
              </div>
              <div class="phenotype-field-grid">
                <ElCheckbox v-for="field in group.fields" :key="field.key" :label="field.key">
                  {{ field.label }}
                </ElCheckbox>
              </div>
            </section>
          </ElCheckboxGroup>
        </ElFormItem>

        <ElFormItem>
          <ElButton
            type="primary"
            :loading="exportLoading"
            :disabled="!exportConfig.fields.length"
            @click="handleExport"
          >
            <ArtSvgIcon icon="ri:download-line" class="mr-2" />
            开始导出
          </ElButton>
          <ElButton :disabled="!exportConfig.fields.length" @click="handlePreview">
            <ArtSvgIcon icon="ri:eye-line" class="mr-2" />
            预览数据
          </ElButton>
          <ElButton @click="selectAllTraits">全选当前性状</ElButton>
          <ElButton @click="resetConfig">重置配置</ElButton>
        </ElFormItem>
      </ElForm>
    </div>

    <div class="export-summary-grid mb-6">
      <div class="summary-card">
        <span>当前口径</span>
        <strong>{{ selectedMethod?.name || '-' }}</strong>
        <small>{{ selectedMethod?.description || '请选择导出口径' }}</small>
      </div>
      <div class="summary-card">
        <span>已选性状</span>
        <strong>{{ exportConfig.traitCodes.length }}</strong>
        <small>{{ selectedTraitNames.slice(0, 4).join('、') || '未选择' }}</small>
      </div>
      <div class="summary-card">
        <span>原始观测</span>
        <strong>{{ observationCount }}</strong>
        <small>表型采集、奶厅、DHI 和传感器记录</small>
      </div>
      <div class="summary-card">
        <span>导出结果</span>
        <strong>{{ totalRecords }}</strong>
        <small>按当前口径聚合后的记录</small>
      </div>
    </div>

    <div class="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">数据预览</h2>
        <ElTag type="info">共 {{ totalRecords }} 条记录，预览前 {{ previewData.length }} 条</ElTag>
      </div>

      <div
        class="preview-table-scroll"
        @scroll.passive="onPreviewScroll"
        @wheel.passive="onPreviewWheel"
      >
        <ElTable
          :data="previewData"
          :loading="previewLoading"
          empty-text="暂无可导出的表型记录"
          max-height="460"
          table-layout="auto"
          style="width: 100%"
        >
          <ElTableColumn
            v-for="field in exportConfig.fields"
            :key="field"
            :prop="field"
            :label="getFieldLabel(field)"
            min-width="130"
          >
            <template #default="{ row }">
              {{ formatPreviewCell(row[field]) }}
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import type { FormInstance, FormRules } from 'element-plus'
  import * as XLSX from 'xlsx'
  import * as databaseService from '@/services/数据库'
  import { estimatePayloadSize, recordV2ExportRun } from '@/services/v2-export'
  import { useLazyRenderWindow } from '@/hooks'
  import { useUserStore } from '@/store/modules/user'
  import { formatDateOnly } from '@/utils/date-display'
  import { normalizeCattleBreedOrDefault } from '@/utils/cattle-breeds'
  import {
    DEFAULT_PHENOTYPE_TRAITS,
    type PhenotypeTraitDefinition
  } from '@/views/germplasm/phenotype/trait-definitions'
  import {
    DEFAULT_PHENOTYPE_EXPORT_METHODS,
    type PhenotypeExportMethodDefinition
  } from '@/views/germplasm/phenotype/export-method-definitions'

  type ExportRow = Record<string, string | number | boolean | null | undefined>

  interface Observation {
    id: string
    recordType: string
    cowId: string
    cowNumber: string
    cowName: string
    breed: string
    currentPen: string
    category: string
    traitCode: string
    traitName: string
    collectionDate: string
    dateKey: string
    monthKey: string
    yearKey: string
    milkingShift: string
    parityCalvingDate: string
    value: number
    unit: string
    parity: number | ''
    daysInMilk: number | ''
    source: string
    equipmentId: string
    collector: string
    notes: string
    sourceTable: string
    sourceRecordId: string
  }

  type ObservationInput = Omit<Partial<Observation>, 'value'> & {
    value?: unknown
  }

  const METHOD_TABLE = 'phenotype-export-methods'
  const TRAIT_TABLE = 'phenotype-trait-definitions'

  const formRef = ref<FormInstance>()
  const exportLoading = ref(false)
  const previewLoading = ref(false)
  const allExportRows = ref<ExportRow[]>([])
  const observationCount = ref(0)
  const totalRecords = ref(0)
  const traitRows = ref<PhenotypeTraitDefinition[]>([])
  const methodRows = ref<PhenotypeExportMethodDefinition[]>([])
  const parityValues = ref<number[]>([])
  const userStore = useUserStore()
  const {
    visibleItems: previewData,
    resetVisibleCount: resetPreviewData,
    handleScroll: onPreviewScroll,
    handleWheel: onPreviewWheel
  } = useLazyRenderWindow(allExportRows, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const exportConfig = reactive({
    format: 'xlsx',
    methodCode: 'raw',
    categories: [] as string[],
    traitCodes: [] as string[],
    startDate: '',
    endDate: '',
    cowNumber: '',
    parities: [] as number[],
    daysInMilkStart: 0,
    daysInMilkEnd: 305,
    fields: [
      'exportMethod',
      'cowNumber',
      'category',
      'traitName',
      'collectionDate',
      'milkingShift',
      'parity',
      'parityCalvingDate',
      'value',
      'unit',
      'recordCount',
      'firstDate',
      'lastDate',
      'daysInMilkRange',
      'source'
    ] as string[]
  })

  const formRules: FormRules = {
    format: [{ required: true, message: '请选择导出格式', trigger: 'change' }],
    methodCode: [{ required: true, message: '请选择导出口径', trigger: 'change' }],
    traitCodes: [
      { type: 'array', required: true, message: '请选择至少一个性状', trigger: 'change' }
    ],
    fields: [
      { type: 'array', required: true, message: '请至少选择一个导出字段', trigger: 'change' }
    ]
  }

  const fieldOptions = [
    { key: 'exportMethod', label: '导出口径', section: '导出口径' },
    { key: 'cowNumber', label: '牛号', section: '牛只身份' },
    { key: 'breed', label: '品种', section: '牛只身份' },
    { key: 'currentPen', label: '当前圈舍', section: '牛只身份' },
    { key: 'category', label: '性状大类', section: '性状与数值' },
    { key: 'traitCode', label: '性状编码', section: '性状与数值' },
    { key: 'traitName', label: '性状名称', section: '性状与数值' },
    { key: 'value', label: '导出值', section: '性状与数值' },
    { key: 'unit', label: '单位', section: '性状与数值' },
    { key: 'collectionDate', label: '采集日期', section: '生产周期维度' },
    { key: 'firstDate', label: '起始日期', section: '生产周期维度' },
    { key: 'lastDate', label: '结束日期', section: '生产周期维度' },
    { key: 'milkingShift', label: '班次', section: '生产周期维度' },
    { key: 'parity', label: '胎次', section: '生产周期维度' },
    { key: 'parityCalvingDate', label: '本胎产犊时间', section: '生产周期维度' },
    { key: 'daysInMilkRange', label: '泌乳天数范围', section: '生产周期维度' },
    { key: 'recordCount', label: '记录数', section: '统计结果' },
    { key: 'source', label: '记录来源', section: '采集与追溯' },
    { key: 'equipmentId', label: '设备编号', section: '采集与追溯' },
    { key: 'collector', label: '采集人/操作员', section: '采集与追溯' },
    { key: 'notes', label: '备注', section: '采集与追溯' }
  ]

  const fieldLabels = Object.fromEntries(fieldOptions.map((item) => [item.key, item.label]))
  const fieldGroupDescriptions: Record<string, string> = {
    导出口径: '模板、明细/汇总类型和当前导出口径。',
    牛只身份: '用于确认记录最终归属到哪一头牛。',
    性状与数值: '性状字典、测定值和单位。',
    生产周期维度: '日期、班次、胎次、本胎产犊时间和 DIM 范围。',
    统计结果: '记录次数和汇总结果。',
    采集与追溯: '来源、设备、采集人和备注。'
  }
  const fieldGroups = computed(() => {
    const order = ['导出口径', '牛只身份', '性状与数值', '生产周期维度', '统计结果', '采集与追溯']
    return order
      .map((section) => ({
        section,
        description: fieldGroupDescriptions[section],
        fields: fieldOptions.filter((field) => field.section === section)
      }))
      .filter((group) => group.fields.length)
  })
  const activeTraits = computed(() => traitRows.value.filter((trait) => trait.status === '启用'))
  const activeMethods = computed(() =>
    methodRows.value.filter((method) => method.status === '启用')
  )
  const selectedMethod = computed(() =>
    activeMethods.value.find((method) => method.code === exportConfig.methodCode)
  )
  const categoryOptions = computed(() =>
    Array.from(
      new Set(activeTraits.value.map((row) => String(row.category || '').trim()).filter(Boolean))
    )
  )
  const filteredTraitOptions = computed(() => {
    if (!exportConfig.categories.length) return activeTraits.value
    return activeTraits.value.filter((trait) => exportConfig.categories.includes(trait.category))
  })
  const selectedTraitNames = computed(() =>
    activeTraits.value
      .filter((trait) => exportConfig.traitCodes.includes(trait.code))
      .map((trait) => trait.name)
  )
  const parityOptions = computed(() => parityValues.value)

  function getFieldLabel(field: string) {
    return fieldLabels[field] || field
  }

  function formatDate(value: unknown, mode: 'date' | 'datetime' = 'datetime') {
    const text = String(value || '').trim()
    if (!text) return ''
    const date = new Date(text)
    if (!Number.isFinite(date.getTime())) return text
    return formatDateOnly(date, '')
  }

  function dateKeys(value: unknown) {
    const dateText = formatDate(value, 'date')
    return {
      dateKey: dateText,
      monthKey: dateText ? dateText.slice(0, 7) : '',
      yearKey: dateText ? dateText.slice(0, 4) : ''
    }
  }

  function numberOrBlank(value: unknown, digits = 4) {
    const num = Number(value)
    return Number.isFinite(num) ? Number(num.toFixed(digits)) : ''
  }

  function numericValue(value: unknown) {
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  }

  function canonicalObservationPriority(item: Observation) {
    if (item.sourceTable === 'trait_observation' || item.sourceTable === 'milk_measurement')
      return 1
    if (item.sourceTable === 'phenotype_records' || item.sourceTable === 'milk_records') return 2
    return 9
  }

  function observationBusinessKey(item: Observation) {
    const cowKey = item.cowId || item.cowNumber
    const valueKey = Number.isFinite(Number(item.value)) ? Number(item.value).toFixed(4) : ''
    return [
      cowKey,
      item.traitCode,
      String(item.collectionDate || item.dateKey || '').slice(0, 19),
      valueKey,
      String(item.unit || '')
        .trim()
        .toLowerCase()
    ].join('|')
  }

  function dedupeObservations(items: Observation[]) {
    const byKey = new Map<string, Observation>()
    items.forEach((item) => {
      const key = observationBusinessKey(item)
      const existing = byKey.get(key)
      if (
        !existing ||
        canonicalObservationPriority(item) < canonicalObservationPriority(existing)
      ) {
        byKey.set(key, item)
      }
    })
    return Array.from(byKey.values())
  }

  function numberOrEmpty(value: unknown): number | '' {
    const num = Number(value)
    return Number.isFinite(num) && num > 0 ? num : ''
  }

  function parseQuality(row: any) {
    const raw = row?.milkQuality ?? row?.milk_quality ?? row?.quality ?? {}
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw)
      } catch {
        return {}
      }
    }
    return raw && typeof raw === 'object' ? raw : {}
  }

  function cowIdOf(row: any) {
    return String(row?.cowId ?? row?.cow_id ?? '')
  }

  function cowNumberOf(row: any) {
    return String(row?.cowNumber ?? row?.cow_number ?? '')
  }

  function dateOf(row: any) {
    return String(
      row?.collectionDate ??
        row?.collection_date ??
        row?.observedAt ??
        row?.observed_at ??
        row?.measuredAt ??
        row?.measured_at ??
        row?.productionDate ??
        row?.production_date ??
        row?.milkingTime ??
        row?.milking_time ??
        row?.createdAt ??
        row?.created_at ??
        ''
    )
  }

  function milkingShiftOf(row: any) {
    return String(
      row?.milkingShift ??
        row?.milking_shift ??
        row?.shiftName ??
        row?.shift_name ??
        row?.shiftId ??
        row?.shift_id ??
        row?.shift ??
        row?.sessionCode ??
        row?.session_code ??
        ''
    )
  }

  function parityCalvingDateOf(row: any) {
    return formatDate(
      row?.parityCalvingDate ??
        row?.parity_calving_date ??
        row?.calvingDate ??
        row?.calving_date ??
        row?.latestCalvingDate ??
        row?.latest_calving_date ??
        row?.lactationStartDate ??
        row?.lactation_start_date ??
        '',
      'date'
    )
  }

  function traitByCode(code: string) {
    return activeTraits.value.find((trait) => trait.code === code)
  }

  function traitById(id: string) {
    return activeTraits.value.find((trait) => trait.id === id)
  }

  function getOperator() {
    const info = userStore.info || {}
    return String(info.userName || info.userId || '当前登录账号')
  }

  async function readTableSafe(tableName: string) {
    try {
      return await databaseService.getTableDataAsync(tableName, { silent: true })
    } catch {
      return []
    }
  }

  function normalizeTraitStatus(value: unknown) {
    const text = String(value || '').toLowerCase()
    return text === 'inactive' || text === 'disabled' || text === '停用' || text === '禁用'
      ? '禁用'
      : '启用'
  }

  function normalizeTraitDataType(value: unknown): PhenotypeTraitDefinition['dataType'] {
    const text = String(value || '').toLowerCase()
    if (text.includes('date') || text.includes('日期')) return '文本'
    if (text.includes('text') || text.includes('string') || text.includes('文本')) return '文本'
    if (text.includes('bool') || text.includes('quality') || text.includes('质量')) return '等级'
    return '数值'
  }

  function normalizeCowContext(row: any) {
    return {
      id: String(row.id || ''),
      cowNumber: String(
        row.animalNumber || row.animal_number || row.cowNumber || row.cow_number || ''
      ),
      cowName: String(row.earTagNumber || row.ear_tag_number || row.name || ''),
      breed: normalizeCattleBreedOrDefault(row.breed || row.breedName || row.breed_name),
      currentPen: String(
        row.currentPen ||
          row.current_pen ||
          row.currentPenId ||
          row.current_pen_id ||
          row.currentUnitId ||
          row.current_unit_id ||
          ''
      ),
      parity: row.parity
    }
  }

  function buildCowContext(cows: any[], animals: any[]) {
    const byId = new Map<string, ReturnType<typeof normalizeCowContext>>()
    const byNumber = new Map<string, ReturnType<typeof normalizeCowContext>>()
    ;[...animals, ...cows].forEach((row) => {
      const context = normalizeCowContext(row)
      if (context.id) byId.set(context.id, context)
      if (context.cowNumber) byNumber.set(context.cowNumber, context)
    })
    return { byId, byNumber }
  }

  function normalizeObservation(input: ObservationInput): Observation | null {
    const value = numericValue(input.value)
    if (value === null) return null
    const keys = dateKeys(input.collectionDate)
    return {
      id: String(input.id || `obs-${Date.now()}-${Math.random()}`),
      recordType: String(input.recordType || '表型记录'),
      cowId: String(input.cowId || ''),
      cowNumber: String(input.cowNumber || ''),
      cowName: String(input.cowName || ''),
      breed: normalizeCattleBreedOrDefault(input.breed),
      currentPen: String(input.currentPen || ''),
      category: String(input.category || ''),
      traitCode: String(input.traitCode || ''),
      traitName: String(input.traitName || ''),
      collectionDate: keys.dateKey,
      dateKey: keys.dateKey,
      monthKey: keys.monthKey,
      yearKey: keys.yearKey,
      milkingShift: String(input.milkingShift || ''),
      parityCalvingDate: String(input.parityCalvingDate || ''),
      value,
      unit: String(input.unit || ''),
      parity: numberOrEmpty(input.parity),
      daysInMilk: numberOrEmpty(input.daysInMilk),
      source: String(input.source || '场内采集记录'),
      equipmentId: String(input.equipmentId || ''),
      collector: String(input.collector || ''),
      notes: String(input.notes || ''),
      sourceTable: String(input.sourceTable || ''),
      sourceRecordId: String(input.sourceRecordId || input.id || '')
    }
  }

  function observationToRow(item: Observation, method: PhenotypeExportMethodDefinition): ExportRow {
    return {
      exportMethod: method.name,
      recordType: item.recordType,
      cowNumber: item.cowNumber,
      cowName: item.cowName,
      breed: item.breed,
      currentPen: item.currentPen,
      category: item.category,
      traitCode: item.traitCode,
      traitName: item.traitName,
      period: item.dateKey || '-',
      collectionDate: item.collectionDate,
      firstDate: item.collectionDate,
      lastDate: item.collectionDate,
      milkingShift: item.milkingShift,
      value: numberOrBlank(item.value),
      unit: item.unit,
      aggregation: '原始值',
      recordCount: 1,
      parity: item.parity,
      parityCalvingDate: item.parityCalvingDate,
      daysInMilkRange: item.daysInMilk === '' ? '' : String(item.daysInMilk),
      source: item.source,
      sourceRecordIds: [item.sourceTable, item.sourceRecordId].filter(Boolean).join(':'),
      equipmentId: item.equipmentId,
      collector: item.collector,
      notes: item.notes
    }
  }

  function aggregateValue(values: Observation[], method: PhenotypeExportMethodDefinition) {
    if (method.aggregation === 'count') return values.length
    if (method.aggregation === 'latest') {
      return (
        values.slice().sort((left, right) => right.dateKey.localeCompare(left.dateKey))[0]?.value ??
        ''
      )
    }
    if (method.aggregation === 'min') return Math.min(...values.map((item) => item.value))
    if (method.aggregation === 'max') return Math.max(...values.map((item) => item.value))
    if (method.aggregation === 'sum') return values.reduce((sum, item) => sum + item.value, 0)
    const sum = values.reduce((total, item) => total + item.value, 0)
    return values.length ? sum / values.length : ''
  }

  function getGroupKey(item: Observation, method: PhenotypeExportMethodDefinition) {
    const base = [item.cowNumber, item.traitCode]
    if (method.groupBy === 'day') return [...base, item.dateKey].join('|')
    if (method.groupBy === 'month') return [...base, item.monthKey].join('|')
    if (method.groupBy === 'year') return [...base, item.yearKey].join('|')
    if (method.groupBy === 'parity') return [...base, `胎次${item.parity || '未填'}`].join('|')
    if (method.groupBy === 'lactation_305')
      return [...base, `胎次${item.parity || '未填'}`, '305天'].join('|')
    if (method.groupBy === 'cow') return base.join('|')
    return item.id
  }

  function getPeriod(items: Observation[], method: PhenotypeExportMethodDefinition) {
    const first = items.slice().sort((left, right) => left.dateKey.localeCompare(right.dateKey))[0]
    if (!first) return '-'
    if (method.groupBy === 'day') return first.dateKey || '-'
    if (method.groupBy === 'month') return first.monthKey || '-'
    if (method.groupBy === 'year') return first.yearKey || '-'
    if (method.groupBy === 'parity') return first.parity ? `第 ${first.parity} 胎` : '胎次未填'
    if (method.groupBy === 'lactation_305')
      return first.parity
        ? `第 ${first.parity} 胎 1-${method.lactationWindowDays} 天`
        : `1-${method.lactationWindowDays} 天`
    if (method.groupBy === 'cow') return '单牛汇总'
    return first.dateKey || '-'
  }

  function aggregateObservations(
    items: Observation[],
    method: PhenotypeExportMethodDefinition
  ): ExportRow[] {
    if (method.groupBy === 'raw' || method.aggregation === 'raw') {
      return items.map((item) => observationToRow(item, method))
    }
    const groupMap = new Map<string, Observation[]>()
    items.forEach((item) => {
      if (method.groupBy === 'lactation_305') {
        const day = Number(item.daysInMilk)
        if (!Number.isFinite(day) || day < 1 || day > method.lactationWindowDays) return
      }
      const key = getGroupKey(item, method)
      groupMap.set(key, [...(groupMap.get(key) || []), item])
    })
    return Array.from(groupMap.values()).map((group) => {
      const sorted = group.slice().sort((left, right) => left.dateKey.localeCompare(right.dateKey))
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const value = aggregateValue(group, method)
      return {
        exportMethod: method.name,
        recordType: first.recordType,
        cowNumber: first.cowNumber,
        cowName: first.cowName,
        breed: first.breed,
        currentPen: first.currentPen,
        category: first.category,
        traitCode: first.traitCode,
        traitName: first.traitName,
        period: getPeriod(group, method),
        collectionDate: first.collectionDate,
        firstDate: first.collectionDate,
        lastDate: last.collectionDate,
        value: numberOrBlank(value),
        unit: first.unit,
        aggregation: method.name,
        recordCount: group.length,
        parity: first.parity,
        milkingShift: Array.from(
          new Set(group.map((item) => item.milkingShift).filter(Boolean))
        ).join('、'),
        parityCalvingDate: Array.from(
          new Set(group.map((item) => item.parityCalvingDate).filter(Boolean))
        ).join('、'),
        daysInMilkRange: group.some((item) => item.daysInMilk !== '')
          ? `${Math.min(...group.map((item) => Number(item.daysInMilk)).filter(Number.isFinite))}-${Math.max(...group.map((item) => Number(item.daysInMilk)).filter(Number.isFinite))}`
          : '',
        source: Array.from(new Set(group.map((item) => item.source))).join('、'),
        sourceRecordIds: Array.from(
          new Set(
            group
              .map((item) => [item.sourceTable, item.sourceRecordId].filter(Boolean).join(':'))
              .filter(Boolean)
          )
        ).join('、'),
        equipmentId: Array.from(
          new Set(group.map((item) => item.equipmentId).filter(Boolean))
        ).join('、'),
        collector: Array.from(new Set(group.map((item) => item.collector).filter(Boolean))).join(
          '、'
        ),
        notes: method.description
      }
    })
  }

  function matchFilters(item: Observation) {
    const cowNumber = exportConfig.cowNumber.trim().toLowerCase()
    if (cowNumber && ![item.cowNumber, item.cowName].join(' ').toLowerCase().includes(cowNumber))
      return false
    if (exportConfig.categories.length && !exportConfig.categories.includes(item.category))
      return false
    if (exportConfig.traitCodes.length && !exportConfig.traitCodes.includes(item.traitCode))
      return false
    if (exportConfig.parities.length && !exportConfig.parities.includes(Number(item.parity)))
      return false
    if (exportConfig.daysInMilkStart || exportConfig.daysInMilkEnd) {
      const day = Number(item.daysInMilk)
      if (Number.isFinite(day) && day > 0) {
        if (exportConfig.daysInMilkStart && day < exportConfig.daysInMilkStart) return false
        if (exportConfig.daysInMilkEnd && day > exportConfig.daysInMilkEnd) return false
      }
    }
    const time = new Date(item.dateKey).getTime()
    if (exportConfig.startDate) {
      const start = new Date(exportConfig.startDate).getTime()
      if (Number.isFinite(time) && Number.isFinite(start) && time < start) return false
    }
    if (exportConfig.endDate) {
      const end = new Date(exportConfig.endDate).getTime() + 86400000
      if (Number.isFinite(time) && Number.isFinite(end) && time > end) return false
    }
    return true
  }

  async function loadTraits() {
    const [v2Traits, v2Categories, rows] = await Promise.all([
      readTableSafe('trait_definition'),
      readTableSafe('trait_category'),
      readTableSafe(TRAIT_TABLE)
    ])
    if (v2Traits.length) {
      const categoryById = new Map(
        v2Categories.map((row: any) => [String(row.id || ''), String(row.name || row.code || '')])
      )
      const mappedRows: PhenotypeTraitDefinition[] = v2Traits.map((row: any) => {
        const categoryId = String(row.categoryId || row.category_id || '')
        const traitType = String(row.traitType || row.trait_type || '')
        return {
          id: String(row.id || `trait-${row.code}`),
          code: String(row.code || ''),
          name: String(row.name || row.code || ''),
          category: categoryById.get(categoryId) || String(row.category || traitType || '未分类'),
          unit: String(row.unit || ''),
          dataType: normalizeTraitDataType(row.dataType || row.data_type),
          source: '人工采集',
          requiredFields: String(
            row.requiredFields || row.required_fields || '牛号、采集日期、测定值'
          ),
          linkedDomains: String(row.linkedDomains || row.linked_domains || '牛只、系谱、组学'),
          status: normalizeTraitStatus(row.status) as PhenotypeTraitDefinition['status'],
          description: String(
            row.description || row.defaultAggregation || row.default_aggregation || ''
          )
        }
      })
      const existingCodes = new Set(mappedRows.map((row) => row.code))
      rows.forEach((row: any) => {
        const code = String(row.code || '')
        if (!code || existingCodes.has(code)) return
        mappedRows.push({
          id: String(row.id || `trait-${code}`),
          code,
          name: String(row.name || ''),
          category: String(row.category || '未分类'),
          unit: String(row.unit || ''),
          dataType: String(
            row.dataType || row.data_type || '数值'
          ) as PhenotypeTraitDefinition['dataType'],
          source: String(row.source || '人工采集') as PhenotypeTraitDefinition['source'],
          requiredFields: String(row.requiredFields || row.required_fields || ''),
          linkedDomains: String(row.linkedDomains || row.linked_domains || ''),
          status: String(row.status || '启用') as PhenotypeTraitDefinition['status'],
          description: String(row.description || '')
        })
      })
      traitRows.value = mappedRows
      return
    }
    if (rows.length) {
      traitRows.value = rows.map((row: any) => ({
        id: String(row.id || `trait-${row.code}`),
        code: String(row.code || ''),
        name: String(row.name || ''),
        category: String(row.category || '未分类'),
        unit: String(row.unit || ''),
        dataType: String(
          row.dataType || row.data_type || '数值'
        ) as PhenotypeTraitDefinition['dataType'],
        source: String(row.source || '人工采集') as PhenotypeTraitDefinition['source'],
        requiredFields: String(row.requiredFields || row.required_fields || ''),
        linkedDomains: String(row.linkedDomains || row.linked_domains || ''),
        status: String(row.status || '启用') as PhenotypeTraitDefinition['status'],
        description: String(row.description || '')
      }))
      return
    }
    const seedRows = DEFAULT_PHENOTYPE_TRAITS.map((trait) => ({
      ...trait,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))
    await databaseService.addTableDataAsync(TRAIT_TABLE, seedRows)
    traitRows.value = seedRows
  }

  async function loadMethods() {
    const rows = await databaseService.getTableDataAsync(METHOD_TABLE, { silent: true })
    if (rows.length) {
      methodRows.value = rows.map((row: any) => ({
        id: String(row.id || `method-${row.code}`),
        code: String(row.code || ''),
        name: String(row.name || ''),
        category: String(row.category || '未分类'),
        groupBy: String(
          row.groupBy || row.group_by || 'raw'
        ) as PhenotypeExportMethodDefinition['groupBy'],
        aggregation: String(
          row.aggregation || 'raw'
        ) as PhenotypeExportMethodDefinition['aggregation'],
        timeGranularity: String(row.timeGranularity || row.time_granularity || ''),
        lactationWindowDays: Number(row.lactationWindowDays || row.lactation_window_days || 305),
        requiredFields: String(row.requiredFields || row.required_fields || ''),
        status: String(row.status || '启用') as PhenotypeExportMethodDefinition['status'],
        description: String(row.description || '')
      }))
      return
    }
    const seedRows = DEFAULT_PHENOTYPE_EXPORT_METHODS.map((method) => ({
      ...method,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))
    await databaseService.addTableDataAsync(METHOD_TABLE, seedRows)
    methodRows.value = seedRows
  }

  async function buildObservations() {
    const [animals, cows, traitObservations, milkMeasurements, phenotypeRecords, milkRecords] =
      await Promise.all([
        readTableSafe('animal'),
        readTableSafe('cows'),
        readTableSafe('trait_observation'),
        readTableSafe('milk_measurement'),
        readTableSafe('phenotype-records'),
        readTableSafe('milk-records')
      ])
    const cowContext = buildCowContext(cows, animals)
    const cowsById = new Map(cows.map((cow: any) => [String(cow.id), cow]))
    const cowsByNumber = new Map(
      cows.map((cow: any) => [String(cow.cowNumber || cow.cow_number), cow])
    )
    const observations: Observation[] = []

    traitObservations.forEach((row: any) => {
      const animalId = String(row.animalId || row.animal_id || '')
      const cow = cowContext.byId.get(animalId) || normalizeCowContext({})
      const trait =
        traitById(String(row.traitId || row.trait_id || '')) ||
        traitByCode(String(row.traitCode || row.trait_code || ''))
      const item = normalizeObservation({
        id: String(row.id || ''),
        recordType: '表型观测',
        cowId: animalId,
        cowNumber: String(cow.cowNumber || row.cowNumber || row.cow_number || ''),
        cowName: String(cow.cowName || ''),
        breed: String(cow.breed || ''),
        currentPen: String(cow.currentPen || ''),
        category: String(trait?.category || row.category || ''),
        traitCode: String(
          trait?.code || row.traitCode || row.trait_code || row.traitId || row.trait_id || ''
        ),
        traitName: String(trait?.name || row.traitName || row.trait_name || ''),
        collectionDate: dateOf(row),
        milkingShift: milkingShiftOf(row),
        value: row.numericValue ?? row.numeric_value ?? row.value,
        unit: String(row.unit || trait?.unit || ''),
        parity: numberOrEmpty(row.parityNo || row.parity_no),
        parityCalvingDate: parityCalvingDateOf(row),
        daysInMilk: numberOrEmpty(row.daysInMilk || row.days_in_milk),
        source: String(row.sourceType || row.source_type || '表型观测记录'),
        equipmentId: String(row.methodId || row.method_id || row.batchId || row.batch_id || ''),
        collector: String(row.collector || ''),
        notes: String(row.textValue || row.text_value || row.qualityFlag || row.quality_flag || ''),
        sourceTable: 'trait_observation',
        sourceRecordId: String(row.id || '')
      })
      if (item) observations.push(item)
    })

    milkMeasurements.forEach((row: any) => {
      const animalId = String(row.animalId || row.animal_id || '')
      const cow = cowContext.byId.get(animalId) || normalizeCowContext({})
      const base: ObservationInput = {
        id: String(row.id || ''),
        recordType: '奶厅测量',
        cowId: animalId,
        cowNumber: String(cow.cowNumber || row.cowNumber || row.cow_number || ''),
        cowName: String(cow.cowName || ''),
        breed: String(cow.breed || ''),
        currentPen: String(cow.currentPen || ''),
        category: '泌乳性能',
        collectionDate: dateOf(row),
        milkingShift: milkingShiftOf(row),
        parity: numberOrEmpty(row.parityNo || row.parity_no),
        parityCalvingDate: parityCalvingDateOf(row),
        daysInMilk: numberOrEmpty(row.daysInMilk || row.days_in_milk),
        source: String(row.sourceType || row.source_type || '奶厅测量记录'),
        equipmentId: String(row.visitId || row.visit_id || ''),
        collector: '',
        notes: String(row.qualityFlag || row.quality_flag || ''),
        sourceTable: 'milk_measurement',
        sourceRecordId: String(row.id || '')
      }
      const milkTraitMap: Array<[string, string, unknown, string]> = [
        ['milk_yield', '产奶量', row.milkYield ?? row.milk_yield, 'kg'],
        ['milk_flow_avg', '平均奶流速', row.milkFlowAvg ?? row.milk_flow_avg, 'kg/min'],
        ['milk_flow_peak', '峰值奶流速', row.milkFlowPeak ?? row.milk_flow_peak, 'kg/min'],
        ['milk_conductivity', '电导率', row.conductivity, 'mS/cm'],
        ['milk_temperature', '奶温', row.milkTemperature ?? row.milk_temperature, '°C'],
        ['milk_fat', '乳脂率', row.fatPercent ?? row.fat_percent, '%'],
        ['milk_protein', '乳蛋白率', row.proteinPercent ?? row.protein_percent, '%'],
        ['milk_lactose', '乳糖率', row.lactosePercent ?? row.lactose_percent, '%'],
        [
          'somatic_cell_count',
          '体细胞数',
          row.somaticCellCount ?? row.somatic_cell_count,
          'cells/mL'
        ]
      ]
      milkTraitMap.forEach(([traitCode, fallbackName, value, fallbackUnit]) => {
        const trait = traitByCode(traitCode)
        const item = normalizeObservation({
          ...base,
          id: `${base.id}-${traitCode}`,
          traitCode,
          traitName: trait?.name || fallbackName,
          unit: trait?.unit || fallbackUnit,
          value
        })
        if (item) observations.push(item)
      })
    })

    phenotypeRecords.forEach((row: any) => {
      const cow = cowsById.get(cowIdOf(row)) || cowsByNumber.get(cowNumberOf(row)) || {}
      const traitCode = String(row.traitCode || row.trait_code || '')
      const trait = traitByCode(traitCode)
      const item = normalizeObservation({
        id: String(row.id || ''),
        recordType: '表型采集',
        cowId: cowIdOf(row) || String(cow.id || ''),
        cowNumber: String(row.cowNumber || row.cow_number || cow.cowNumber || ''),
        cowName: String(cow.earTagNumber || cow.ear_tag_number || ''),
        breed: String(cow.breed || ''),
        currentPen: String(cow.currentPen || cow.current_pen || ''),
        category: String(row.category || trait?.category || ''),
        traitCode,
        traitName: String(row.traitName || row.trait_name || trait?.name || ''),
        collectionDate: dateOf(row),
        milkingShift: milkingShiftOf(row),
        value: row.value,
        unit: String(row.unit || trait?.unit || ''),
        parity: numberOrEmpty(row.parity || cow.parity),
        parityCalvingDate: parityCalvingDateOf(row) || parityCalvingDateOf(cow),
        daysInMilk: numberOrEmpty(row.daysInMilk || row.days_in_milk),
        source: String(row.source || '现场测定记录'),
        equipmentId: String(row.equipmentId || row.equipment_id || ''),
        collector: String(row.collector || ''),
        notes: String(row.notes || row.textValue || row.text_value || ''),
        sourceTable: 'phenotype_records',
        sourceRecordId: String(row.id || '')
      })
      if (item) observations.push(item)
    })

    milkRecords.forEach((row: any) => {
      const cow = cowsById.get(cowIdOf(row)) || cowsByNumber.get(cowNumberOf(row)) || {}
      const quality = parseQuality(row)
      const base: ObservationInput = {
        id: String(row.id || ''),
        recordType: '奶厅记录',
        cowId: cowIdOf(row) || String(cow.id || ''),
        cowNumber: String(cow.cowNumber || cowNumberOf(row) || ''),
        cowName: String(cow.earTagNumber || cow.ear_tag_number || ''),
        breed: String(cow.breed || ''),
        currentPen: String(cow.currentPen || cow.current_pen || ''),
        category: '泌乳性能',
        collectionDate: dateOf(row),
        milkingShift: milkingShiftOf(row),
        parity: numberOrEmpty(row.parity || cow.parity),
        parityCalvingDate: parityCalvingDateOf(row) || parityCalvingDateOf(cow),
        daysInMilk: numberOrEmpty(row.daysInMilk || row.days_in_milk),
        source: '奶厅与 DHI 记录',
        equipmentId: String(row.equipmentId || row.equipment_id || ''),
        collector: String(row.milkerId || row.milker_id || row.operator || ''),
        notes: String(row.notes || ''),
        sourceTable: 'milk_records',
        sourceRecordId: String(row.id || '')
      }
      const milkTraitMap: Array<[string, string, unknown, string]> = [
        ['milk_yield', '产奶量', row.volume ?? row.milkVolume ?? row.milk_volume, 'kg'],
        ['milk_fat', '乳脂率', quality.fat, '%'],
        ['milk_protein', '乳蛋白率', quality.protein, '%'],
        ['milk_lactose', '乳糖率', quality.lactose, '%'],
        ['somatic_cell_count', '体细胞数', quality.scc, 'cells/mL'],
        ['milk_urea', '尿素氮', quality.urea, 'mg/dL'],
        ['freezing_point', '冰点', quality.freezingPoint ?? quality.freezing_point, '°C']
      ]
      milkTraitMap.forEach(([traitCode, fallbackName, value, fallbackUnit]) => {
        const trait = traitByCode(traitCode)
        const item = normalizeObservation({
          ...base,
          id: `${base.id}-${traitCode}`,
          traitCode,
          traitName: trait?.name || fallbackName,
          unit: trait?.unit || fallbackUnit,
          value
        })
        if (item) observations.push(item)
      })
    })

    const dedupedObservations = dedupeObservations(observations)
    observationCount.value = dedupedObservations.length
    return dedupedObservations
  }

  async function buildRows() {
    const method = selectedMethod.value || activeMethods.value[0]
    if (!method) return []
    const allObservations = await buildObservations()
    parityValues.value = Array.from(
      new Set(
        allObservations
          .map((item) => Number(item.parity))
          .filter((value) => Number.isFinite(value) && value > 0)
      )
    ).sort((a, b) => a - b)
    const observations = allObservations.filter(matchFilters)
    const missingFields = getMissingRequiredFields(observations, method)
    if (missingFields.length) {
      throw new Error(`当前口径缺少必备字段：${missingFields.join('、')}`)
    }
    const rows = aggregateObservations(observations, method)
    allExportRows.value = rows
    totalRecords.value = rows.length
    return rows
  }

  function hasObservationField(item: Observation, fieldLabel: string) {
    if (fieldLabel.includes('牛号')) return Boolean(item.cowNumber)
    if (fieldLabel.includes('性状编码')) return Boolean(item.traitCode)
    if (fieldLabel.includes('采集日期')) return Boolean(item.collectionDate)
    if (fieldLabel.includes('胎次')) return item.parity !== ''
    if (fieldLabel.includes('泌乳天数')) return item.daysInMilk !== ''
    if (fieldLabel.includes('测定值') || fieldLabel.includes('测量值'))
      return Number.isFinite(Number(item.value))
    return true
  }

  function getMissingRequiredFields(
    observations: Observation[],
    method: PhenotypeExportMethodDefinition
  ) {
    if (!observations.length) return []
    return method.requiredFields
      .split(/[、,，/]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((field) => observations.every((item) => !hasObservationField(item, field)))
  }

  function selectedExportRows(rows: ExportRow[]) {
    return rows.map((row) =>
      Object.fromEntries(
        exportConfig.fields.map((field) => [getFieldLabel(field), row[field] ?? ''])
      )
    )
  }

  function formatPreviewCell(value: unknown) {
    if (value === null || value === undefined || value === '') return '-'
    return String(value)
  }

  function escapeCsvValue(value: unknown) {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  async function hashPayload(value: string | ArrayBuffer) {
    const payload = typeof value === 'string' ? new TextEncoder().encode(value) : value
    if (window.crypto?.subtle) {
      const buffer = await window.crypto.subtle.digest('SHA-256', payload)
      return Array.from(new Uint8Array(buffer))
        .map((item) => item.toString(16).padStart(2, '0'))
        .join('')
    }
    const bytes =
      typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
    let hash = 0
    for (let index = 0; index < bytes.length; index += 1)
      hash = (Math.imul(31, hash) + bytes[index]) | 0
    return `fallback-${Math.abs(hash).toString(16)}`
  }

  function collectSourceRecordIds(rows: ExportRow[]) {
    const result: Record<string, string[]> = {}
    rows.forEach((row) => {
      String(row.sourceRecordIds || '')
        .split(/[、,，;]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => {
          const [table, ...idParts] = item.split(':')
          const id = idParts.join(':')
          if (!table || !id) return
          result[table] = Array.from(new Set([...(result[table] || []), id]))
        })
    })
    return result
  }

  async function writeAuditLog(
    fileName: string,
    rows: ExportRow[],
    exportedRows: Record<string, unknown>[],
    fileHash: string,
    startedAt: string
  ) {
    const finishedAt = new Date().toISOString()
    const auditId = `export-phenotype-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
    const cowNumbers = Array.from(
      new Set(rows.map((row) => String(row.cowNumber || '')).filter(Boolean))
    )
    const sourceRecordIds = collectSourceRecordIds(rows)
    const parameters = {
      format: exportConfig.format,
      methodCode: exportConfig.methodCode,
      methodName: selectedMethod.value?.name || '',
      categories: exportConfig.categories,
      traitCodes: exportConfig.traitCodes,
      startDate: exportConfig.startDate,
      endDate: exportConfig.endDate,
      cowNumber: exportConfig.cowNumber,
      parities: exportConfig.parities,
      daysInMilkStart: exportConfig.daysInMilkStart,
      daysInMilkEnd: exportConfig.daysInMilkEnd,
      fields: exportConfig.fields
    }
    const resultSnapshot = {
      auditId,
      rowCount: rows.length,
      fileName,
      fileHash,
      exportedFields: exportConfig.fields,
      cowNumbers,
      sourceRecordIds,
      previewRows: exportedRows.slice(0, 5)
    }
    const relationScope = {
      domain: 'phenotype_export',
      cowNumbers,
      traitCodes: exportConfig.traitCodes,
      methodCode: exportConfig.methodCode,
      sourceRecordIds
    }

    await databaseService.addTableDataAsync('export-audit-logs', {
      id: auditId,
      operator: getOperator(),
      action_type: 'export_phenotype_data',
      status: 'completed',
      file_name: fileName,
      file_hash: fileHash,
      file_format: exportConfig.format,
      row_count: rows.length,
      filters_json: parameters,
      parameters_json: parameters,
      result_snapshot: resultSnapshot,
      cow_ids: cowNumbers,
      relation_scope: relationScope,
      source_record_ids: sourceRecordIds,
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: Math.max(1, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
      created_at: startedAt,
      updated_at: finishedAt
    })

    await databaseService.addTableDataAsync('operation-audit-logs', {
      id: `op-audit-${auditId}`,
      action_type: 'export_phenotype_data',
      target_type: 'export_audit_logs',
      target_id: auditId,
      operator: getOperator(),
      status: 'completed',
      request_payload: parameters,
      result_payload: resultSnapshot,
      cow_ids: cowNumbers,
      relation_scope: relationScope,
      source_record_ids: {
        ...sourceRecordIds,
        export_audit_logs: [auditId]
      },
      created_at: startedAt,
      updated_at: finishedAt
    })

    await recordV2ExportRun({
      scopeCode: 'phenotype_export',
      scopeName: '表型数据导出',
      scopeDomain: 'trait_observation',
      sourceType: 'phenotype_export',
      fileName,
      fileFormat: exportConfig.format,
      rowCount: rows.length,
      checksum: fileHash,
      fileSize: estimatePayloadSize(exportedRows),
      operatorName: getOperator(),
      startedAt,
      finishedAt,
      parameters,
      resultSnapshot,
      periods: [
        {
          periodType: 'date_range',
          startAt: exportConfig.startDate,
          endAt: exportConfig.endDate,
          customWindowCode: exportConfig.methodCode
        },
        ...exportConfig.parities.map((parity) => ({
          periodType: 'parity',
          parityNo: parity,
          customWindowCode: exportConfig.methodCode
        }))
      ],
      scopes: [
        ...cowNumbers
          .slice(0, 200)
          .map((cowNumber) => ({ scopeType: 'cow_number', scopeValue: cowNumber })),
        ...exportConfig.traitCodes.map((traitCode) => ({
          scopeType: 'trait_code',
          scopeValue: traitCode
        })),
        ...exportConfig.categories.map((category) => ({
          scopeType: 'trait_category',
          scopeValue: category
        })),
        ...exportConfig.fields.map((field) => ({ scopeType: 'field', scopeValue: field })),
        ...Object.keys(sourceRecordIds).map((table) => ({
          scopeType: 'source_table',
          scopeValue: table
        })),
        { scopeType: 'method_code', scopeValue: exportConfig.methodCode }
      ],
      selectableFilters: {
        methodCode: activeMethods.value.map((method) => method.code),
        categories: categoryOptions.value,
        traitCodes: activeTraits.value.map((trait) => trait.code),
        dateRange: ['startDate', 'endDate'],
        parities: parityOptions.value,
        fields: Object.keys(fieldLabels)
      },
      selectableVariables: exportConfig.fields,
      defaultPeriods: [
        { periodType: 'date_range', startAt: exportConfig.startDate, endAt: exportConfig.endDate }
      ]
    })
    return auditId
  }

  const handlePreview = async () => {
    if (!formRef.value) return
    await formRef.value.validate(async (valid) => {
      if (!valid) return
      previewLoading.value = true
      try {
        const rows = await buildRows()
        allExportRows.value = rows
        resetPreviewData()
      } catch (error) {
        console.error('预览表型数据失败:', error)
        ElMessage.error('预览表型数据失败')
      } finally {
        previewLoading.value = false
      }
    })
  }

  const handleExport = async () => {
    if (!formRef.value) return
    await formRef.value.validate(async (valid) => {
      if (!valid) return
      exportLoading.value = true
      try {
        const startedAt = new Date().toISOString()
        const rows = await buildRows()
        if (!rows.length) {
          ElMessage.warning('当前筛选条件下没有可导出的表型记录')
          return
        }
        const exportRows = selectedExportRows(rows)
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
        const methodName = selectedMethod.value?.name || '自定义口径'
        const fileName = `表型数据导出_${methodName}_${timestamp}.${exportConfig.format}`
        let fileHash = ''

        if (exportConfig.format === 'xlsx') {
          const workbook = XLSX.utils.book_new()
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows), '表型数据')
          const workbookPayload = XLSX.write(workbook, {
            bookType: 'xlsx',
            type: 'array'
          }) as ArrayBuffer
          fileHash = await hashPayload(workbookPayload)
          XLSX.writeFile(workbook, fileName)
        } else {
          const header = Object.keys(exportRows[0] || {})
            .map(escapeCsvValue)
            .join(',')
          const body = exportRows
            .map((row) => Object.values(row).map(escapeCsvValue).join(','))
            .join('\n')
          const csvText = `\ufeff${[header, body].filter(Boolean).join('\n')}`
          fileHash = await hashPayload(csvText)
          const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' })
          const link = document.createElement('a')
          const url = URL.createObjectURL(blob)
          link.href = url
          link.download = fileName
          link.click()
          URL.revokeObjectURL(url)
        }

        const auditId = await writeAuditLog(fileName, rows, exportRows, fileHash, startedAt)
        ElMessage.success(`导出成功，审计编号 ${auditId}`)
      } catch (error) {
        console.error('导出表型数据失败:', error)
        ElMessage.error('导出表型数据失败')
      } finally {
        exportLoading.value = false
      }
    })
  }

  function syncTraitSelection() {
    const available = new Set(filteredTraitOptions.value.map((trait) => trait.code))
    exportConfig.traitCodes = exportConfig.traitCodes.filter((code) => available.has(code))
  }

  function selectAllTraits() {
    exportConfig.traitCodes = filteredTraitOptions.value.map((trait) => trait.code)
  }

  const resetConfig = () => {
    exportConfig.format = 'xlsx'
    exportConfig.methodCode = activeMethods.value[0]?.code || 'raw'
    exportConfig.categories = []
    exportConfig.traitCodes = activeTraits.value.map((trait) => trait.code)
    exportConfig.startDate = ''
    exportConfig.endDate = ''
    exportConfig.cowNumber = ''
    exportConfig.parities = []
    exportConfig.daysInMilkStart = 0
    exportConfig.daysInMilkEnd = 305
    exportConfig.fields = fieldOptions.slice(0, 14).map((field) => field.key)
    allExportRows.value = []
  }

  onMounted(async () => {
    await loadTraits()
    await loadMethods()
    resetConfig()
    await handlePreview()
  })

  defineOptions({ name: 'PhenotypeDataExport' })
</script>

<style scoped lang="scss">
  .preview-table-scroll {
    max-width: 100%;
    max-height: 480px;
    overflow: auto;
  }

  .inline-range {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    width: 100%;
  }

  .summary-card {
    display: grid;
    gap: 6px;
    min-height: 120px;
    padding: 16px;
    background: var(--fluent-surface, #fff);
    border: 1px solid rgb(148 163 184 / 35%);
    border-radius: 8px;
    box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
    transition: border-color 180ms cubic-bezier(0.16, 1, 0.3, 1);

    span {
      color: var(--fluent-muted, #64748b);
      font-size: 13px;
      font-weight: 680;
    }

    strong {
      color: var(--fluent-text, #0f172a);
      font-size: 24px;
      font-weight: 780;
    }

    small {
      color: var(--fluent-text-soft, #64748b);
      line-height: 1.55;
    }

    &:hover {
      border-color: rgb(71 111 89 / 28%);
    }
  }
</style>
