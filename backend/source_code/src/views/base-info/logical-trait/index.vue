<template>
  <FcPageShell
    title="逻辑性状规则"
    status-label="规则状态"
    :status-value="`${activeRules.length}/${rules.length} 启用`"
    primary-action-label="新增规则"
    primary-action-icon="ri:add-line"
    secondary-action-label="重置筛选"
    secondary-action-icon="ri:refresh-line"
    @primary-action="openCreateDialog"
    @secondary-action="resetFilters"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          label="规则总数"
          :value="rules.length"
          note="基于事件、周期和记录计算"
          icon="ri:function-line"
        />
        <FcMetricTile
          label="事件间隔"
          :value="eventIntervalRules.length"
          note="产犊间隔、空怀天数等"
          icon="ri:time-line"
          tone="teal"
        />
        <FcMetricTile
          label="事件次数"
          :value="eventCountRules.length"
          note="配种次数、治疗次数等"
          icon="ri:counter-line"
          tone="info"
        />
        <FcMetricTile
          label="周期聚合"
          :value="aggregationRules.length"
          note="胎次、泌乳期和单牛汇总"
          icon="ri:stack-line"
          tone="warning"
        />
      </section>
    </template>

    <section class="rule-config-layout">
      <FcPanel title="规则类别">
        <template #actions>
          <ElButton size="small" @click="openCategoryDialog">
            <ArtSvgIcon icon="ri:add-line" class="mr-1" />
            新增大类
          </ElButton>
        </template>
        <div class="category-stack">
          <button
            v-for="item in categoryCards"
            :key="item.name"
            type="button"
            :class="{ active: filters.category === item.name }"
            @click="filters.category = filters.category === item.name ? '' : item.name"
          >
            <span>{{ item.name }}</span>
            <strong>{{ item.count }}</strong>
            <small>{{ item.note }}</small>
          </button>
        </div>
      </FcPanel>

      <FcPanel title="规则类型">
        <div class="explain-stack">
          <article>
            <span>事件间隔</span>
            <p>从起点事件到终点事件的时间差，例如产犊间隔、空怀天数。</p>
          </article>
          <article>
            <span>事件次数</span>
            <p>在指定周期内统计事件发生次数，例如当前胎次配种次数。</p>
          </article>
          <article>
            <span>记录聚合</span>
            <p>对观测值按日、月、年、胎次或单牛做合计、均值、最大最小。</p>
          </article>
        </div>
      </FcPanel>
    </section>

    <FcPanel title="逻辑性状规则列表">
      <div class="filter-bar">
        <ElInput v-model="filters.keyword" clearable placeholder="搜索规则名称、编码、事件类型" />
        <ElSelect v-model="filters.ruleType" clearable placeholder="规则类型">
          <ElOption
            v-for="option in ruleTypeOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </ElSelect>
        <ElSelect v-model="filters.periodScope" clearable placeholder="周期范围">
          <ElOption
            v-for="option in periodScopeOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </ElSelect>
        <ElSelect v-model="filters.status" clearable placeholder="状态">
          <ElOption label="启用" value="启用" />
          <ElOption label="停用" value="停用" />
        </ElSelect>
      </div>

      <div class="lazy-table-toolbar">
        <ElTag type="info" effect="light"
          >显示 {{ visibleRules.length }}/{{ filteredRules.length }} 项</ElTag
        >
      </div>
      <ElTable :data="visibleRules" height="520" @wheel.passive="onRuleTableWheel">
        <ElTableColumn prop="name" label="性状名称" width="150" />
        <ElTableColumn prop="code" label="编码" width="190" />
        <ElTableColumn prop="category" label="类别" width="110">
          <template #default="{ row }"
            ><ElTag size="small">{{ row.category }}</ElTag></template
          >
        </ElTableColumn>
        <ElTableColumn label="规则/周期" width="170">
          <template #default="{ row }"
            >{{ getRuleTypeLabel(row.ruleType) }} ·
            {{ getPeriodScopeLabel(row.periodScope) }}</template
          >
        </ElTableColumn>
        <ElTableColumn label="输入条件" min-width="260">
          <template #default="{ row }">
            <template v-if="isRecordSourceRule(row.ruleType)">
              <span>{{ formatEvents(row.sourceTraitCodes) }}</span>
            </template>
            <template v-else>
              <span>{{ formatEvents(row.startEventTypes) }}</span>
              <span v-if="row.ruleType === 'event_interval'">
                -> {{ formatEvents(row.endEventTypes) }}</span
              >
            </template>
          </template>
        </ElTableColumn>
        <ElTableColumn label="胎次/匹配" width="180">
          <template #default="{ row }"
            >{{ getParityModeLabel(row.parityMode) }} ·
            {{ getMatchModeLabel(row.matchMode) }}</template
          >
        </ElTableColumn>
        <ElTableColumn label="阈值" width="120">
          <template #default="{ row }"
            >{{ row.minValue ?? '-' }} - {{ row.maxValue ?? '-' }} {{ row.unit }}</template
          >
        </ElTableColumn>
        <ElTableColumn prop="status" label="状态" width="90">
          <template #default="{ row }"
            ><ElTag :type="row.status === '启用' ? 'success' : 'info'">{{
              row.status
            }}</ElTag></template
          >
        </ElTableColumn>
        <ElTableColumn label="操作" width="140">
          <template #default="{ row }">
            <ElButton size="small" @click="openEditDialog(row)">编辑</ElButton>
            <ElButton
              size="small"
              :type="row.status === '启用' ? 'warning' : 'success'"
              @click="toggleStatus(row)"
            >
              {{ row.status === '启用' ? '停用' : '启用' }}
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <div v-if="filteredRules.length > visibleRules.length" class="load-more-row">
        <ElButton @click="() => loadMoreRules()"
          >加载更多 {{ visibleRules.length }}/{{ filteredRules.length }}</ElButton
        >
      </div>
    </FcPanel>

    <ElDialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="min(860px, calc(100vw - 32px))"
      @closed="resetForm"
    >
      <ElForm label-width="118px">
        <div class="dialog-grid">
          <ElFormItem label="性状名称"><ElInput v-model="form.name" /></ElFormItem>
          <ElFormItem label="字段编码"><ElInput v-model="form.code" /></ElFormItem>
          <ElFormItem label="类别">
            <ElSelect v-model="form.category" class="w-full">
              <ElOption
                v-for="category in categories"
                :key="category"
                :label="category"
                :value="category"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="单位"
            ><ElInput v-model="form.unit" placeholder="如 d、次、kg、L"
          /></ElFormItem>
          <ElFormItem label="规则类型">
            <ElSelect v-model="form.ruleType" class="w-full" @change="handleRuleTypeChange">
              <ElOption
                v-for="option in ruleTypeOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="数据源表">
            <ElSelect v-model="form.sourceTable" class="w-full">
              <ElOption
                v-for="option in activeSourceTableOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem v-if="isRecordSourceRule(form.ruleType)" label="源性状">
            <ElSelect
              v-model="form.sourceTraitCodes"
              multiple
              filterable
              allow-create
              default-first-option
              class="w-full"
            >
              <ElOption
                v-for="option in sourceTraitOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem v-if="isRecordSourceRule(form.ruleType)" label="值字段">
            <ElInput
              v-model="form.sourceValueField"
              placeholder="默认 value，可填 recordCount 等数值字段"
            />
          </ElFormItem>
          <ElFormItem v-if="isRecordSourceRule(form.ruleType)" label="日期字段">
            <ElInput v-model="form.sourceDateField" placeholder="默认 collectionDate" />
          </ElFormItem>
          <ElFormItem v-if="!isRecordSourceRule(form.ruleType)" label="起点事件">
            <ElSelect
              v-model="form.startEventTypes"
              multiple
              filterable
              allow-create
              default-first-option
              class="w-full"
            >
              <ElOption
                v-for="option in eventTypeOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem v-if="form.ruleType === 'event_interval'" label="终点事件">
            <ElSelect
              v-model="form.endEventTypes"
              multiple
              filterable
              allow-create
              default-first-option
              class="w-full"
            >
              <ElOption
                v-for="option in eventTypeOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="周期范围">
            <ElSelect v-model="form.periodScope" class="w-full">
              <ElOption
                v-for="option in periodScopeOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="胎次规则">
            <ElSelect v-model="form.parityMode" class="w-full">
              <ElOption
                v-for="option in parityModeOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="指定胎次">
            <ElInputNumber v-model="form.parityOffset" :min="-20" :max="20" />
          </ElFormItem>
          <ElFormItem label="匹配方式">
            <ElSelect v-model="form.matchMode" class="w-full">
              <ElOption
                v-for="option in matchModeOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="聚合算法">
            <ElSelect v-model="form.aggregation" class="w-full">
              <ElOption
                v-for="option in aggregationOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="输出性状">
            <ElInput v-model="form.outputTraitCode" placeholder="默认同字段编码" />
          </ElFormItem>
          <ElFormItem label="最小阈值"
            ><ElInputNumber v-model="form.minValue" :step="1"
          /></ElFormItem>
          <ElFormItem label="最大阈值"
            ><ElInputNumber v-model="form.maxValue" :step="1"
          /></ElFormItem>
        </div>
        <ElFormItem label="必备字段">
          <ElCheckboxGroup v-model="requiredFieldSelection" class="check-grid">
            <ElCheckbox v-for="item in requiredFieldOptions" :key="item" :label="item" />
          </ElCheckboxGroup>
        </ElFormItem>
        <ElFormItem label="关联数据">
          <ElCheckboxGroup v-model="linkedDomainSelection" class="check-grid">
            <ElCheckbox v-for="item in linkedDomainOptions" :key="item" :label="item" />
          </ElCheckboxGroup>
        </ElFormItem>
        <ElFormItem label="说明"
          ><ElInput v-model="form.description" type="textarea" :rows="3"
        /></ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="submitForm">保存</ElButton>
      </template>
    </ElDialog>

    <ElDialog
      v-model="categoryDialogVisible"
      title="新增逻辑性状大类"
      width="min(520px, calc(100vw - 32px))"
      @closed="resetCategoryForm"
    >
      <ElForm label-width="110px">
        <ElFormItem label="大类名称">
          <ElInput v-model="categoryForm.name" placeholder="如：繁殖效率、健康事件、生产周期" />
        </ElFormItem>
        <ElFormItem label="说明">
          <ElInput v-model="categoryForm.description" type="textarea" :rows="3" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="categoryDialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="submitCategoryForm">保存</ElButton>
      </template>
    </ElDialog>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import * as databaseService from '@/services/database'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import { useLazyRenderWindow } from '@/hooks'
  import {
    DEFAULT_PHENOTYPE_TRAITS,
    type PhenotypeTraitDefinition
  } from '@/views/germplasm/phenotype/trait-definitions'

  type LogicalTraitRuleType =
    | 'event_interval'
    | 'event_count'
    | 'record_aggregation'
    | 'period_days'
  type LogicalTraitStatus = '启用' | '停用'

  interface LogicalTraitRule {
    id: string
    code: string
    name: string
    category: string
    unit: string
    ruleType: LogicalTraitRuleType
    sourceTable: string
    sourceTraitCodes: string[]
    sourceValueField: string
    sourceDateField: string
    startEventTypes: string[]
    endEventTypes: string[]
    periodScope: string
    parityMode: string
    parityOffset: number
    matchMode: string
    aggregation: string
    outputTraitCode: string
    minValue: number | null
    maxValue: number | null
    requiredFields: string
    linkedDomains: string
    status: LogicalTraitStatus
    description: string
  }

  const RULE_TABLE = 'logical-trait-rules'
  const CATEGORY_TABLE = 'base-info-categories'
  const CATEGORY_SCOPE = 'logical-trait-rules'

  const ruleTypeOptions: Array<{ label: string; value: LogicalTraitRuleType }> = [
    { label: '事件间隔', value: 'event_interval' },
    { label: '事件次数', value: 'event_count' },
    { label: '记录聚合', value: 'record_aggregation' },
    { label: '周期天数', value: 'period_days' }
  ]

  const sourceTableOptions = [
    { label: '表型与泌乳统一事实', value: 'phenotype_fact' },
    { label: '性状观测 trait_observation', value: 'trait_observation' },
    { label: '奶厅测量 milk_measurement', value: 'milk_measurement' }
  ]

  const eventSourceTableOptions = [
    { label: '统一事件明细 animal_event', value: 'animal_event' },
    { label: '旧统一事件 cow-events', value: 'cow-events' },
    { label: '繁殖记录 breeding_records', value: 'breeding_records' },
    { label: '入群事件 entry_events', value: 'entry_events' },
    { label: '转群事件 transfer_events', value: 'transfer_events' },
    { label: '离群事件 exit_events', value: 'exit_events' },
    { label: '繁殖事件 breeding_events', value: 'breeding_events' },
    { label: '兽医事件 veterinary_events', value: 'veterinary_events' }
  ]

  const eventTypeOptions = [
    { label: '产犊 calving', value: 'calving' },
    { label: '配种/输精 insemination', value: 'insemination' },
    { label: '妊检 pregnancy_check', value: 'pregnancy_check' },
    { label: '干奶 dry_off', value: 'dry_off' },
    { label: '发情 heat', value: 'heat' },
    { label: '流产 abortion', value: 'abortion' },
    { label: '治疗 treatment', value: 'treatment' },
    { label: '转群 transfer', value: 'transfer' }
  ]

  const periodScopeOptions = [
    { label: '原始事件', value: 'raw' },
    { label: '按日', value: 'day' },
    { label: '按周', value: 'week' },
    { label: '按旬', value: 'ten_day' },
    { label: '按半月', value: 'half_month' },
    { label: '按月', value: 'month' },
    { label: '按季度', value: 'quarter' },
    { label: '按半年', value: 'half_year' },
    { label: '按年', value: 'year' },
    { label: '按季节', value: 'season' },
    { label: '按胎次', value: 'parity' },
    { label: '繁殖周期', value: 'reproduction_cycle' },
    { label: '泌乳期', value: 'lactation' },
    { label: '305天泌乳窗', value: 'lactation_305' },
    { label: '按泌乳阶段', value: 'lactation_stage' },
    { label: '按DIM分段', value: 'dim_bucket' },
    { label: '按妊娠期', value: 'pregnancy' },
    { label: '按干奶期', value: 'dry_period' },
    { label: '按牛群', value: 'herd_group' },
    { label: '按圈舍', value: 'pen' },
    { label: '按生产阶段', value: 'production_stage' },
    { label: '按采集时段', value: 'milking_shift' },
    { label: '按设备/批次', value: 'equipment' },
    { label: '按采集人', value: 'collector' },
    { label: '按操作人', value: 'operator' },
    { label: '单牛汇总', value: 'cow' },
    { label: '7天滚动窗', value: 'rolling_7' },
    { label: '30天滚动窗', value: 'rolling_30' },
    { label: '90天滚动窗', value: 'rolling_90' },
    { label: '自定义时间窗', value: 'custom_window' }
  ]

  const parityModeOptions = [
    { label: '不限定胎次', value: 'none' },
    { label: '当前胎次', value: 'current' },
    { label: '指定胎次', value: 'specific' },
    { label: '倒数胎次', value: 'relative_from_current' },
    { label: '同胎次', value: 'same' },
    { label: '同胎次或上胎次', value: 'same_or_previous' }
  ]

  const matchModeOptions = [
    { label: '最近起点到终点', value: 'latest_before_end' },
    { label: '起点后首个终点', value: 'first_after_start' },
    { label: '连续同类型事件', value: 'consecutive_same_type' },
    { label: '周期内计数', value: 'count_in_period' },
    { label: '周期边界差值', value: 'period_boundary' }
  ]

  const aggregationOptions = [
    { label: '原始结果', value: 'raw' },
    { label: '记录数', value: 'count' },
    { label: '合计', value: 'sum' },
    { label: '均值', value: 'avg' },
    { label: '最小值', value: 'min' },
    { label: '最大值', value: 'max' },
    { label: '中位数', value: 'median' },
    { label: '最新值', value: 'latest' }
  ]

  const defaultRules: LogicalTraitRule[] = [
    {
      id: 'logic-calving-interval',
      code: 'calving_interval_days',
      name: '产犊间隔',
      category: '繁殖效率',
      unit: 'd',
      ruleType: 'event_interval',
      sourceTable: 'animal_event',
      sourceTraitCodes: [],
      sourceValueField: 'value',
      sourceDateField: 'collectionDate',
      startEventTypes: ['calving'],
      endEventTypes: ['calving'],
      periodScope: 'parity',
      parityMode: 'none',
      parityOffset: 0,
      matchMode: 'consecutive_same_type',
      aggregation: 'raw',
      outputTraitCode: 'calving_interval_days',
      minValue: 180,
      maxValue: 900,
      requiredFields: '牛号、产犊事件、事件时间、胎次',
      linkedDomains: '个体档案、繁殖记录、系谱、组学样本',
      status: '启用',
      description: '同一头牛相邻两次产犊事件之间的天数。'
    },
    {
      id: 'logic-open-days',
      code: 'open_days',
      name: '空怀天数',
      category: '繁殖效率',
      unit: 'd',
      ruleType: 'event_interval',
      sourceTable: 'animal_event',
      sourceTraitCodes: [],
      sourceValueField: 'value',
      sourceDateField: 'collectionDate',
      startEventTypes: ['calving'],
      endEventTypes: ['insemination', 'pregnancy_check'],
      periodScope: 'parity',
      parityMode: 'current',
      parityOffset: -1,
      matchMode: 'first_after_start',
      aggregation: 'raw',
      outputTraitCode: 'open_days',
      minValue: 0,
      maxValue: 300,
      requiredFields: '牛号、产犊事件、首配或妊检事件、事件时间、胎次',
      linkedDomains: '个体档案、繁殖记录、系谱、组学样本',
      status: '启用',
      description: '产犊后至首配或确认妊娠相关事件的间隔，用于评价繁殖恢复效率。'
    },
    {
      id: 'logic-insemination-count',
      code: 'insemination_count_per_parity',
      name: '胎次内配种次数',
      category: '繁殖效率',
      unit: '次',
      ruleType: 'event_count',
      sourceTable: 'animal_event',
      sourceTraitCodes: [],
      sourceValueField: 'value',
      sourceDateField: 'collectionDate',
      startEventTypes: ['insemination'],
      endEventTypes: [],
      periodScope: 'parity',
      parityMode: 'current',
      parityOffset: -1,
      matchMode: 'count_in_period',
      aggregation: 'count',
      outputTraitCode: 'insemination_count_per_parity',
      minValue: 0,
      maxValue: 12,
      requiredFields: '牛号、配种事件、事件时间、胎次',
      linkedDomains: '个体档案、繁殖记录、系谱、组学样本',
      status: '启用',
      description: '统计一个胎次周期内发生的配种或输精次数。'
    },
    {
      id: 'logic-last-insemination-to-calving',
      code: 'last_insemination_to_calving_days',
      name: '末次输精至产犊间隔',
      category: '繁殖效率',
      unit: 'd',
      ruleType: 'event_interval',
      sourceTable: 'animal_event',
      sourceTraitCodes: [],
      sourceValueField: 'value',
      sourceDateField: 'collectionDate',
      startEventTypes: ['insemination'],
      endEventTypes: ['calving'],
      periodScope: 'parity',
      parityMode: 'same_or_previous',
      parityOffset: 0,
      matchMode: 'latest_before_end',
      aggregation: 'raw',
      outputTraitCode: 'last_insemination_to_calving_days',
      minValue: 180,
      maxValue: 380,
      requiredFields: '牛号、配种事件、产犊事件、事件时间、胎次',
      linkedDomains: '个体档案、繁殖记录、系谱、组学样本',
      status: '启用',
      description: '产犊前最近一次输精或配种到本次产犊的天数。'
    }
  ]

  const defaultCategories = ['繁殖效率', '健康事件', '生产周期', '泌乳聚合']
  const rules = ref<LogicalTraitRule[]>([])
  const categories = ref<string[]>([])
  const sourceTraits = ref<PhenotypeTraitDefinition[]>([...DEFAULT_PHENOTYPE_TRAITS])
  const filters = reactive({ keyword: '', category: '', ruleType: '', periodScope: '', status: '' })
  const dialogVisible = ref(false)
  const categoryDialogVisible = ref(false)
  const editingId = ref('')
  const categoryForm = reactive({ name: '', description: '' })
  const requiredFieldSelection = ref<string[]>([])
  const linkedDomainSelection = ref<string[]>([])
  const form = reactive<LogicalTraitRule>({ ...defaultRules[0], id: '', code: '', name: '' })

  const activeRules = computed(() => rules.value.filter((rule) => rule.status === '启用'))
  const eventIntervalRules = computed(() =>
    rules.value.filter((rule) => rule.ruleType === 'event_interval')
  )
  const eventCountRules = computed(() =>
    rules.value.filter((rule) => rule.ruleType === 'event_count')
  )
  const aggregationRules = computed(() =>
    rules.value.filter((rule) => ['record_aggregation', 'period_days'].includes(rule.ruleType))
  )
  const dialogTitle = computed(() => `${editingId.value ? '编辑' : '新增'}逻辑性状规则`)
  const requiredFieldOptions = computed(() => recommendedRequiredFields())
  const linkedDomainOptions = computed(() => recommendedLinkedDomains())
  const sourceTraitOptions = computed(() =>
    Array.from(
      new Map(
        sourceTraits.value
          .filter((trait) => trait.status !== '停用' && trait.code)
          .map((trait) => [
            trait.code,
            { value: trait.code, label: `${trait.name}（${trait.code}）` }
          ])
      ).values()
    ).sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
  )
  const activeSourceTableOptions = computed(() =>
    isRecordSourceRule(form.ruleType) ? sourceTableOptions : eventSourceTableOptions
  )

  const categoryCards = computed(() =>
    categories.value.map((category) => ({
      name: category,
      count: rules.value.filter((rule) => rule.category === category).length,
      note:
        category === '繁殖效率'
          ? '配种次数、空怀天数、产犊间隔'
          : category === '健康事件'
            ? '治疗次数、发病间隔和休药周期'
            : category === '生产周期'
              ? '胎次、泌乳期和生产阶段'
              : '可扩展计算性状分类'
    }))
  )

  const filteredRules = computed(() => {
    const keyword = filters.keyword.trim().toLowerCase()
    return rules.value.filter((rule) => {
      const text = [
        rule.name,
        rule.code,
        rule.category,
        rule.sourceTable,
        rule.sourceTraitCodes.join(','),
        rule.startEventTypes.join(','),
        rule.endEventTypes.join(','),
        rule.description
      ]
        .join(' ')
        .toLowerCase()
      return (
        (!keyword || text.includes(keyword)) &&
        (!filters.category || rule.category === filters.category) &&
        (!filters.ruleType || rule.ruleType === filters.ruleType) &&
        (!filters.periodScope || rule.periodScope === filters.periodScope) &&
        (!filters.status || rule.status === filters.status)
      )
    })
  })
  const {
    visibleItems: visibleRules,
    loadMore: loadMoreRules,
    handleWheel: onRuleTableWheel
  } = useLazyRenderWindow(filteredRules, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  function getRuleTypeLabel(value: string) {
    return ruleTypeOptions.find((item) => item.value === value)?.label || value
  }

  function getPeriodScopeLabel(value: string) {
    return periodScopeOptions.find((item) => item.value === value)?.label || value
  }

  function getParityModeLabel(value: string) {
    return parityModeOptions.find((item) => item.value === value)?.label || value
  }

  function getMatchModeLabel(value: string) {
    return matchModeOptions.find((item) => item.value === value)?.label || value
  }

  function formatEvents(values: string[]) {
    return values?.length ? values.join('、') : '-'
  }

  function isRecordSourceRule(ruleType: string) {
    return ruleType === 'record_aggregation' || ruleType === 'period_days'
  }

  function handleRuleTypeChange(value: LogicalTraitRuleType) {
    if (isRecordSourceRule(value)) {
      form.sourceTable = 'phenotype_fact'
      form.sourceValueField = form.sourceValueField || 'value'
      form.sourceDateField = form.sourceDateField || 'collectionDate'
      form.startEventTypes = []
      form.endEventTypes = []
      if (form.aggregation === 'raw') form.aggregation = value === 'period_days' ? 'count' : 'avg'
      syncSelectionsFromRule()
      return
    }
    form.sourceTable = form.sourceTable === 'phenotype_fact' ? 'animal_event' : form.sourceTable
    form.sourceTraitCodes = []
    if (value === 'event_count') {
      form.endEventTypes = []
      form.matchMode = 'count_in_period'
      form.aggregation = 'count'
    }
    syncSelectionsFromRule()
  }

  function asStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean)
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) return []
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean)
      } catch {
        return trimmed
          .split(/[,，、]/)
          .map((item) => item.trim())
          .filter(Boolean)
      }
    }
    return []
  }

  function normalizeNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function normalizeRule(row: Record<string, any>): LogicalTraitRule {
    const code = String(row.code || '')
    return {
      id: String(row.id || `logic-${code || Date.now()}`),
      code,
      name: String(row.name || ''),
      category: String(row.category || '繁殖效率'),
      unit: String(row.unit || 'd'),
      ruleType: String(row.ruleType || row.rule_type || 'event_interval') as LogicalTraitRuleType,
      sourceTable: String(row.sourceTable || row.source_table || 'animal_event'),
      sourceTraitCodes: asStringArray(
        row.sourceTraitCodes ||
          row.source_trait_codes ||
          row.sourceTraitCode ||
          row.source_trait_code
      ),
      sourceValueField: String(row.sourceValueField || row.source_value_field || 'value'),
      sourceDateField: String(row.sourceDateField || row.source_date_field || 'collectionDate'),
      startEventTypes: asStringArray(row.startEventTypes || row.start_event_types),
      endEventTypes: asStringArray(row.endEventTypes || row.end_event_types),
      periodScope: String(row.periodScope || row.period_scope || 'parity'),
      parityMode: String(row.parityMode || row.parity_mode || 'current'),
      parityOffset: Number(row.parityOffset ?? row.parity_offset ?? 0),
      matchMode: String(row.matchMode || row.match_mode || 'latest_before_end'),
      aggregation: String(row.aggregation || 'raw'),
      outputTraitCode: String(row.outputTraitCode || row.output_trait_code || code),
      minValue: normalizeNumber(row.minValue ?? row.min_value),
      maxValue: normalizeNumber(row.maxValue ?? row.max_value),
      requiredFields: String(
        row.requiredFields || row.required_fields || '牛号、事件类型、事件时间、胎次'
      ),
      linkedDomains: String(
        row.linkedDomains || row.linked_domains || '个体档案、繁殖记录、系谱、组学样本'
      ),
      status: String(row.status || '启用') as LogicalTraitStatus,
      description: String(row.description || '')
    }
  }

  function resetFilters() {
    filters.keyword = ''
    filters.category = ''
    filters.ruleType = ''
    filters.periodScope = ''
    filters.status = ''
  }

  function resetForm() {
    const defaultCategory =
      filters.category && categories.value.includes(filters.category)
        ? filters.category
        : categories.value[0] || '繁殖效率'
    editingId.value = ''
    Object.assign(form, {
      id: '',
      code: '',
      name: '',
      category: defaultCategory,
      unit: 'd',
      ruleType: 'event_interval',
      sourceTable: 'animal_event',
      sourceTraitCodes: [],
      sourceValueField: 'value',
      sourceDateField: 'collectionDate',
      startEventTypes: [],
      endEventTypes: [],
      periodScope: 'parity',
      parityMode: 'current',
      parityOffset: -1,
      matchMode: 'latest_before_end',
      aggregation: 'raw',
      outputTraitCode: '',
      minValue: null,
      maxValue: null,
      requiredFields: '牛号、事件类型、事件时间、胎次',
      linkedDomains: '个体档案、繁殖记录、系谱、组学样本',
      status: '启用',
      description: ''
    })
    syncSelectionsFromRule()
  }

  function openCreateDialog() {
    resetForm()
    dialogVisible.value = true
  }

  function openEditDialog(row: LogicalTraitRule) {
    Object.assign(form, {
      ...row,
      sourceTraitCodes: [...row.sourceTraitCodes],
      startEventTypes: [...row.startEventTypes],
      endEventTypes: [...row.endEventTypes]
    })
    editingId.value = row.id
    syncSelectionsFromRule()
    dialogVisible.value = true
  }

  function splitTextList(value: unknown) {
    return String(value || '')
      .split(/[、,，;]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function syncSelectionsFromRule() {
    requiredFieldSelection.value = splitTextList(
      form.requiredFields || recommendedRequiredFields().join('、')
    )
    linkedDomainSelection.value = splitTextList(
      form.linkedDomains || recommendedLinkedDomains().join('、')
    )
  }

  function recommendedRequiredFields() {
    if (isRecordSourceRule(form.ruleType)) {
      return ['牛号', '源性状', '采集日期', '测定值', '周期', '胎次']
    }
    if (form.ruleType === 'event_count') {
      return ['牛号', '统计事件', '事件时间', '周期', '胎次']
    }
    return ['牛号', '起点事件', '终点事件', '事件时间', '胎次']
  }

  function recommendedLinkedDomains() {
    const domains = ['个体档案']
    if (isRecordSourceRule(form.ruleType)) domains.push('表型记录', '泌乳记录')
    else domains.push('事件记录', '繁殖记录')
    domains.push('系谱', '组学样本')
    return Array.from(new Set(domains))
  }

  function resetCategoryForm() {
    categoryForm.name = ''
    categoryForm.description = ''
  }

  function openCategoryDialog() {
    resetCategoryForm()
    categoryDialogVisible.value = true
  }

  async function loadCategories() {
    const seedRows = defaultCategories.map((name, index) => ({
      id: `${CATEGORY_SCOPE}-category-${index + 1}`,
      scope: CATEGORY_SCOPE,
      name,
      description: '逻辑性状规则分类',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))
    try {
      const rows = await databaseService.getTableDataAsync(CATEGORY_TABLE, { silent: true })
      const scoped = rows
        .filter((row) => row.scope === CATEGORY_SCOPE)
        .map((row) => String(row.name || '').trim())
        .filter(Boolean)
      if (scoped.length) {
        categories.value = Array.from(new Set(scoped))
        return
      }
      await databaseService.addTableDataAsync(CATEGORY_TABLE, seedRows)
      categories.value = seedRows.map((row) => row.name)
    } catch {
      categories.value = defaultCategories
    }
  }

  async function loadRules() {
    try {
      const rows = await databaseService.getTableDataAsync(RULE_TABLE, { silent: true })
      if (rows.length) {
        rules.value = rows.map((row) => normalizeRule(row))
        return
      }
      const seedRows = defaultRules.map((rule) => ({
        ...rule,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))
      await databaseService.addTableDataAsync(RULE_TABLE, seedRows)
      rules.value = (await databaseService.getTableDataAsync(RULE_TABLE, { silent: true })).map(
        (row) => normalizeRule(row)
      )
    } catch (error) {
      console.error('加载逻辑性状规则失败:', error)
      ElMessage.error('加载逻辑性状规则失败')
      rules.value = defaultRules.map((rule) => ({ ...rule }))
    }
  }

  async function loadSourceTraits() {
    try {
      const rows = await databaseService.getTableDataAsync('phenotype-trait-definitions', {
        silent: true
      })
      const normalized = rows.map((row) => ({
        id: String(row.id || `trait-${row.code || Date.now()}`),
        code: String(row.code || ''),
        name: String(row.name || row.traitName || row.trait_name || row.code || ''),
        category: String(row.category || '表型记录'),
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
      sourceTraits.value = Array.from(
        new Map(
          [...DEFAULT_PHENOTYPE_TRAITS, ...normalized].map((trait) => [trait.code, trait])
        ).values()
      )
    } catch {
      sourceTraits.value = [...DEFAULT_PHENOTYPE_TRAITS]
    }
  }

  async function submitCategoryForm() {
    const name = categoryForm.name.trim()
    if (!name) {
      ElMessage.warning('逻辑性状大类名称不能为空')
      return
    }
    if (categories.value.includes(name)) {
      ElMessage.warning('逻辑性状大类已存在')
      return
    }
    const payload = {
      id: `${CATEGORY_SCOPE}-category-${Date.now()}`,
      scope: CATEGORY_SCOPE,
      name,
      description: categoryForm.description.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    try {
      await databaseService.addTableDataAsync(CATEGORY_TABLE, payload)
    } catch (error) {
      console.error('新增逻辑性状大类失败:', error)
      ElMessage.error('新增逻辑性状大类失败，请检查数据库连接')
      return
    }
    categories.value.push(name)
    form.category = name
    filters.category = name
    categoryDialogVisible.value = false
    ElMessage.success('逻辑性状大类已新增')
  }

  async function submitForm() {
    const code = String(form.code || '').trim()
    const name = String(form.name || '').trim()
    if (!name || !code) {
      ElMessage.warning('性状名称和字段编码不能为空')
      return
    }
    if (
      form.ruleType === 'event_interval' &&
      (!form.startEventTypes.length || !form.endEventTypes.length)
    ) {
      ElMessage.warning('事件间隔规则需要配置起点事件和终点事件')
      return
    }
    if (form.ruleType === 'event_count' && !form.startEventTypes.length) {
      ElMessage.warning('事件次数规则需要配置统计事件类型')
      return
    }
    if (isRecordSourceRule(form.ruleType) && !form.sourceTraitCodes.length) {
      ElMessage.warning('记录聚合或周期天数规则需要配置源性状')
      return
    }
    const duplicated = rules.value.some(
      (rule) => rule.id !== editingId.value && rule.code.trim().toLowerCase() === code.toLowerCase()
    )
    if (duplicated) {
      ElMessage.warning('字段编码已存在，请使用唯一编码')
      return
    }
    const payload: LogicalTraitRule = {
      ...form,
      id: editingId.value || `logic-${Date.now()}`,
      code,
      name,
      category: String(form.category || categories.value[0] || '繁殖效率'),
      outputTraitCode: String(form.outputTraitCode || code).trim(),
      sourceTraitCodes: Array.from(
        new Set(form.sourceTraitCodes.map((item) => String(item).trim()).filter(Boolean))
      ),
      sourceValueField: String(form.sourceValueField || 'value').trim(),
      sourceDateField: String(form.sourceDateField || 'collectionDate').trim(),
      requiredFields: requiredFieldSelection.value.join('、'),
      linkedDomains: linkedDomainSelection.value.join('、')
    }
    try {
      if (editingId.value) {
        await databaseService.updateTableRecordAsync(RULE_TABLE, editingId.value, {
          ...payload,
          updatedAt: new Date().toISOString()
        })
      } else {
        await databaseService.addTableDataAsync(RULE_TABLE, {
          ...payload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      }
      rules.value = (await databaseService.getTableDataAsync(RULE_TABLE, { silent: true })).map(
        (row) => normalizeRule(row)
      )
      dialogVisible.value = false
      ElMessage.success('逻辑性状规则已保存')
    } catch (error) {
      console.error('保存逻辑性状规则失败:', error)
      ElMessage.error('保存逻辑性状规则失败')
    }
  }

  async function toggleStatus(row: LogicalTraitRule) {
    const status: LogicalTraitStatus = row.status === '启用' ? '停用' : '启用'
    try {
      await databaseService.updateTableRecordAsync(RULE_TABLE, row.id, {
        ...row,
        status,
        updatedAt: new Date().toISOString()
      })
      rules.value = rules.value.map((rule) => (rule.id === row.id ? { ...rule, status } : rule))
      ElMessage.success(`${row.name} 已${status}`)
    } catch (error) {
      console.error('更新逻辑性状规则状态失败:', error)
      ElMessage.error('更新逻辑性状规则状态失败')
    }
  }

  watch(
    () => [form.ruleType, form.periodScope, form.sourceTable],
    () => {
      if (!dialogVisible.value || editingId.value) return
      requiredFieldSelection.value = recommendedRequiredFields()
      linkedDomainSelection.value = recommendedLinkedDomains()
    }
  )

  onMounted(async () => {
    await Promise.all([loadCategories(), loadSourceTraits()])
    await loadRules()
  })

  defineOptions({ name: 'LogicalTraitManagement' })
</script>

<style scoped lang="scss">
  .fc-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }

  .rule-config-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 18px;
    align-items: start;
  }

  .category-stack,
  .explain-stack {
    display: grid;
    gap: 12px;
  }

  .category-stack {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .category-stack button,
  .explain-stack article {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 14px;
    text-align: left;
    background: rgb(255 255 255 / 42%);
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .category-stack button {
    cursor: pointer;
  }

  .category-stack button.active,
  .category-stack button:hover {
    background: rgb(var(--fluent-primary-rgb) / 10%);
    border-color: var(--fluent-border-strong);
  }

  .category-stack span,
  .explain-stack span {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .category-stack strong {
    color: var(--fluent-text);
    font-size: clamp(20px, 1.8vw, 23px);
    font-weight: 780;
  }

  .category-stack small,
  .explain-stack p {
    margin: 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
    line-height: 1.6;
  }

  .filter-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 170px 150px 120px;
    gap: 10px;
    margin-bottom: 14px;
  }

  .lazy-table-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 10px;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 14px;
  }

  .dialog-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 14px;
  }

  @media (max-width: 1180px) {
    .fc-metric-grid,
    .rule-config-layout {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .rule-config-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .fc-metric-grid,
    .category-stack,
    .filter-bar,
    .dialog-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
