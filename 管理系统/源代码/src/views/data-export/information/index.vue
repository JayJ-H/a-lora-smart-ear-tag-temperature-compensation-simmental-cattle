<template>
  <div class="information-export-page">
    <section class="export-title-row">
      <div>
        <h1>信息导出</h1>
      </div>
      <div class="title-actions">
        <ElButton @click="loadPageData">刷新数据</ElButton>
        <ElButton type="primary" @click="openCreateStrategy">新建策略</ElButton>
      </div>
    </section>

    <section class="export-stat-grid">
      <article class="stat-card">
        <span>导出模板</span>
        <strong>{{ allStrategies.length }}</strong>
      </article>
      <article class="stat-card">
        <span>常用模板</span>
        <strong>{{ featuredTemplateCount }}</strong>
      </article>
      <article class="stat-card">
        <span>自建策略</span>
        <strong>{{ customStrategies.length }}</strong>
      </article>
      <article class="stat-card">
        <span>筛选选项</span>
        <strong>{{ referenceRows.length }}</strong>
      </article>
      <article class="stat-card">
        <span>最近预览</span>
        <strong>{{ totalRows }}</strong>
      </article>
    </section>

    <section class="strategy-panel">
      <div class="panel-section-head">
        <div>
          <span>导出模板库</span>
          <h2>业务导出模板</h2>
        </div>
        <ElTag type="info">每次只渲染三排模板</ElTag>
      </div>
      <div class="strategy-toolbar">
        <ElSegmented v-model="strategyScope" :options="strategyScopeOptions" />
        <ElInput
          v-model="strategyKeyword"
          clearable
          placeholder="搜索模板、字段或口径"
        />
      </div>

      <div
        ref="strategyViewportRef"
        class="information-strategy-viewport"
        :style="strategyViewportStyle"
        @scroll="handleStrategyScroll"
      >
        <div
          v-if="filteredStrategies.length"
          class="information-strategy-spacer"
          :style="strategySpacerStyle"
        >
          <div class="analysis-module-grid information-strategy-grid" :style="strategyGridStyle">
            <article
              v-for="strategy in visibleStrategies"
              :key="strategy.id"
              class="analysis-module-card information-strategy-card"
              :class="[strategy.tone, { active: selectedStrategy?.id === strategy.id }]"
              tabindex="0"
              @click="openStrategyConfig(strategy)"
              @keyup.enter="openStrategyConfig(strategy)"
            >
              <div class="strategy-card-top">
                <div class="strategy-title-wrap">
                  <span class="strategy-icon">{{ strategyInitial(strategy) }}</span>
                  <div>
                    <span class="strategy-eyebrow">{{ strategyEyebrow(strategy) }}</span>
                    <h3>{{ strategy.name }}</h3>
                  </div>
                </div>
                <ElTag size="small" :type="strategy.builtin ? 'info' : 'success'">
                  {{ strategy.builtin ? '内置' : '自建' }}
                </ElTag>
              </div>

              <div v-if="strategy.description" class="strategy-description">{{
                strategy.description
              }}</div>

              <div class="strategy-source-line">
                <span>取数范围</span>
                <strong>{{ strategySourceText(strategy) }}</strong>
              </div>

              <div class="strategy-metric-row">
                <div>
                  <span>口径</span>
                  <strong>{{ strategyAggregationText(strategy) }}</strong>
                </div>
                <div>
                  <span>周期</span>
                  <strong>{{ groupByLabel(strategy.period.groupBy) }}</strong>
                </div>
                <div>
                  <span>排序</span>
                  <strong>{{ strategySortText(strategy) }}</strong>
                </div>
              </div>

              <div class="strategy-field-strip">
                <span v-for="field in strategyFieldPreview(strategy)" :key="field">{{
                  field
                }}</span>
              </div>

              <div class="strategy-card-actions">
                <ElButton
                  size="small"
                  type="primary"
                  class="strategy-config-button"
                  @click.stop="openStrategyConfig(strategy)"
                >
                  配置导出
                </ElButton>
                <ElDropdown trigger="click" @click.stop>
                  <ElButton size="small" text>更多</ElButton>
                  <template #dropdown>
                    <ElDropdownMenu>
                      <ElDropdownItem @click="duplicateStrategy(strategy)"
                        >复制为自建策略</ElDropdownItem
                      >
                      <ElDropdownItem v-if="!strategy.builtin" @click="openRenameStrategy(strategy)"
                        >重命名</ElDropdownItem
                      >
                      <ElDropdownItem
                        v-if="!strategy.builtin"
                        divided
                        @click="deleteCustomStrategy(strategy)"
                      >
                        删除策略
                      </ElDropdownItem>
                    </ElDropdownMenu>
                  </template>
                </ElDropdown>
              </div>
            </article>
          </div>
        </div>
        <div v-else class="strategy-empty-state">当前筛选条件下暂无导出模板</div>
      </div>
    </section>

    <section class="preview-panel">
      <div class="preview-head">
        <div>
          <h2>预览表</h2>
          <p>{{ previewDescription }}</p>
        </div>
        <div class="preview-actions">
          <ElTag type="info">总计 {{ totalRows }} 行</ElTag>
          <ElTag>显示 {{ previewRows.length }} 行</ElTag>
          <ElTag type="success">上下/左右滚动</ElTag>
        </div>
      </div>
      <div
        class="preview-table-shell"
        @scroll.passive="onPreviewScroll"
        @wheel.passive="onPreviewWheel"
      >
        <ElTable
          :data="previewRows"
          :style="{ minWidth: previewTableMinWidth }"
          height="430"
          border
          stripe
          empty-text="当前筛选条件下暂无记录"
        >
          <ElTableColumn type="index" width="58" label="#" fixed="left" />
          <ElTableColumn
            v-for="field in previewColumns"
            :key="field.key"
            :prop="field.key"
            min-width="176"
            show-overflow-tooltip
          >
            <template #header>
              <div class="preview-column-header">
                <button
                  type="button"
                  class="sort-rank-button"
                  :class="{ active: sortPriority(field.key) }"
                  :title="sortPriority(field.key) ? '点击清除该字段排序' : '未参与排序'"
                  @click.stop="clearColumnSort(field.key)"
                >
                  {{ sortPriority(field.key) || '-' }}
                </button>
                <span class="preview-column-name">{{ field.label }}</span>
                <span class="sort-direction-buttons">
                  <button
                    type="button"
                    :class="{ active: sortDirectionFor(field.key) === 'asc' }"
                    title="低到高 / 旧到新"
                    @click.stop="setColumnSort(field.key, 'asc')"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    :class="{ active: sortDirectionFor(field.key) === 'desc' }"
                    title="高到低 / 新到旧"
                    @click.stop="setColumnSort(field.key, 'desc')"
                  >
                    ↓
                  </button>
                </span>
              </div>
            </template>
            <template #default="{ row }">
              {{ formatCell(displayCellValue(row, field)) }}
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
    </section>

    <ElDrawer
      v-model="configDrawerVisible"
      class="information-config-drawer"
      size="78%"
      :title="selectedStrategy ? `${selectedStrategy.name} - 导出配置` : '导出配置'"
      destroy-on-close
    >
      <div v-if="selectedStrategy" class="drawer-content">
        <section class="drawer-summary">
          <div>
            <span>{{ strategyTypeLabel(selectedStrategy.strategyType) }}</span>
            <h3>{{ selectedStrategy.name }}</h3>
            <p>{{ selectedStrategy.description }}</p>
          </div>
          <ElTag :type="selectedStrategy.builtin ? 'info' : 'success'">
            {{ selectedStrategy.builtin ? '内置策略' : '自建策略' }}
          </ElTag>
        </section>

        <section class="config-grid">
          <div class="config-block wide">
            <div class="block-head">
              <div>
                <h3>{{ isCurrentTraitStrategy ? '维度字段' : '字段' }}</h3>
                <p>{{
                  isCurrentTraitStrategy
                    ? '这里选择牛号、日期、班次、胎次和本胎产犊时间等维度列；性状数值列由下方性状选择决定。'
                    : '导出表和预览表使用同一组字段。'
                }}</p>
              </div>
              <div>
                <ElButton size="small" @click="selectAllFields">全选</ElButton>
                <ElButton size="small" @click="invertFields">反选</ElButton>
                <ElButton size="small" @click="resetFields">默认</ElButton>
              </div>
            </div>
            <ElCheckboxGroup v-model="configForm.fields" class="field-check-sections">
              <section
                v-for="group in activeFieldGroups"
                :key="group.title"
                class="field-check-section"
                :class="{ 'is-collapsed': !isFieldGroupExpanded(group.title) }"
              >
                <button
                  class="field-section-head"
                  type="button"
                  @click="toggleFieldGroup(group.title)"
                >
                  <div>
                    <strong>{{ group.title }}</strong>
                    <span>{{ group.description }}</span>
                  </div>
                  <em>{{
                    isFieldGroupExpanded(group.title) ? '收起' : `${group.fields.length} 项`
                  }}</em>
                </button>
                <div v-if="isFieldGroupExpanded(group.title)" class="field-check-grid">
                  <ElCheckbox v-for="field in group.fields" :key="field.key" :label="field.key">
                    {{ field.label }}
                  </ElCheckbox>
                </div>
              </section>
            </ElCheckboxGroup>
          </div>

          <div class="config-block">
            <div class="block-head">
              <div>
                <h3>基础阈值</h3>
                <p>按牛、品种、圈舍、状态和胎次筛选。</p>
              </div>
            </div>
            <div class="form-stack">
              <ElInput
                v-model="configForm.filters.cowNumber"
                clearable
                placeholder="牛号模糊匹配"
              />
              <ElSelect v-model="configForm.filters.breeds" multiple clearable placeholder="品种">
                <ElOption v-for="item in breedOptions" :key="item" :label="item" :value="item" />
              </ElSelect>
              <ElSelect v-model="configForm.filters.statuses" multiple clearable placeholder="状态">
                <ElOption v-for="item in statusOptions" :key="item" :label="item" :value="item" />
              </ElSelect>
              <ElSelect v-model="configForm.filters.pens" multiple clearable placeholder="圈舍">
                <ElOption v-for="item in penOptions" :key="item" :label="item" :value="item" />
              </ElSelect>
              <ElSelect v-model="configForm.filters.genders" multiple clearable placeholder="性别">
                <ElOption v-for="item in genderOptions" :key="item" :label="item" :value="item" />
              </ElSelect>
              <div class="inline-inputs">
                <ElInputNumber
                  v-model="configForm.filters.parityMin"
                  :min="0"
                  placeholder="胎次下限"
                />
                <ElInputNumber
                  v-model="configForm.filters.parityMax"
                  :min="0"
                  placeholder="胎次上限"
                />
              </div>
              <ElSelect
                v-model="configForm.filters.paritySelections"
                multiple
                filterable
                allow-create
                default-first-option
                clearable
                collapse-tags
                collapse-tags-tooltip
                placeholder="指定胎次：1、2 或 -1 当前胎"
              >
                <ElOption
                  v-for="item in paritySelectionOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </ElSelect>
            </div>
          </div>

          <div class="config-block">
            <div class="block-head">
              <div>
                <h3>周期阈值</h3>
                <p>支持日期、胎次、泌乳天数和 305 天窗口。</p>
              </div>
            </div>
            <div class="form-stack">
              <ElDatePicker
                v-model="configForm.filters.dateRange"
                type="daterange"
                value-format="YYYY-MM-DD"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
              />
              <div class="inline-inputs">
                <ElInputNumber
                  v-model="configForm.filters.dimMin"
                  :min="0"
                  placeholder="DIM 下限"
                />
                <ElInputNumber
                  v-model="configForm.filters.dimMax"
                  :min="0"
                  placeholder="DIM 上限"
                />
              </div>
              <ElSelect v-model="configForm.period.groupBy" placeholder="周期口径">
                <ElOptionGroup
                  v-for="group in groupByOptionGroups"
                  :key="group.label"
                  :label="group.label"
                >
                  <ElOption
                    v-for="item in group.options"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value"
                  />
                </ElOptionGroup>
              </ElSelect>
              <ElSelect v-model="configForm.aggregation" placeholder="聚合口径">
                <ElOption
                  v-for="item in aggregationOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </ElSelect>
            </div>
          </div>

          <div class="config-block">
            <div class="block-head">
              <div>
                <h3>{{ isCurrentTraitStrategy ? '性状选择' : '事件与性状' }}</h3>
                <p>{{
                  isCurrentTraitStrategy
                    ? '所选性状会直接作为预览表和导出文件的数值列，可同时导出多个性状。'
                    : '按事件类型、表型大类和小类性状筛选。'
                }}</p>
              </div>
            </div>
            <div class="form-stack">
              <ElSelect
                v-if="showEventSelector"
                v-model="configForm.filters.eventTypes"
                multiple
                clearable
                placeholder="事件类型"
              >
                <ElOption
                  v-for="item in eventTypeOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </ElSelect>
              <ElSelect
                v-if="showTraitSelector"
                v-model="configForm.filters.traitCategories"
                multiple
                clearable
                placeholder="表型大类"
              >
                <ElOption
                  v-for="item in traitCategoryOptions"
                  :key="item"
                  :label="item"
                  :value="item"
                />
              </ElSelect>
              <ElSelect
                v-if="showTraitSelector"
                v-model="configForm.filters.traitCodes"
                multiple
                filterable
                clearable
                collapse-tags
                collapse-tags-tooltip
                placeholder="选择导出性状，可多选"
              >
                <ElOption
                  v-for="item in traitCodeOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </ElSelect>
              <div v-if="isCurrentTraitStrategy" class="trait-column-summary">
                <span v-for="field in selectedTraitColumns" :key="field.key">{{
                  field.label
                }}</span>
                <em v-if="!selectedTraitColumns.length">未选择性状时不会生成数值列</em>
              </div>
            </div>
          </div>

          <div class="config-block">
            <div class="block-head">
              <div>
                <h3>数值阈值</h3>
                <p>对任意数值字段设置上下限或区间。</p>
              </div>
            </div>
            <div class="form-stack">
              <ElSelect v-model="configForm.filters.numericField" clearable placeholder="数值字段">
                <ElOption
                  v-for="field in numericFieldDefs"
                  :key="field.key"
                  :label="field.label"
                  :value="field.key"
                />
              </ElSelect>
              <ElSelect v-model="configForm.filters.numericOperator" placeholder="比较方式">
                <ElOption label="大于等于" value="gte" />
                <ElOption label="小于等于" value="lte" />
                <ElOption label="等于" value="eq" />
                <ElOption label="区间" value="between" />
              </ElSelect>
              <div v-if="configForm.filters.numericOperator === 'between'" class="inline-inputs">
                <ElInputNumber v-model="configForm.filters.numericMin" placeholder="下限" />
                <ElInputNumber v-model="configForm.filters.numericMax" placeholder="上限" />
              </div>
              <ElInputNumber v-else v-model="configForm.filters.numericValue" placeholder="阈值" />
            </div>
          </div>

          <div class="config-block wide">
            <div class="block-head">
              <div>
                <h3>输出</h3>
                <p>预览和导出使用完全相同的数据结果。</p>
              </div>
            </div>
            <div class="output-row">
              <ElRadioGroup v-model="configForm.format">
                <ElRadioButton label="xlsx">XLSX</ElRadioButton>
                <ElRadioButton label="csv">CSV</ElRadioButton>
              </ElRadioGroup>
              <div class="output-actions">
                <ElButton @click="saveCurrentStrategy">
                  {{ selectedStrategy.builtin ? '保存为自建策略' : '保存策略' }}
                </ElButton>
                <ElButton :loading="previewLoading" @click="generatePreview">生成预览</ElButton>
                <ElButton type="primary" :loading="exportLoading" @click="exportCurrentRows"
                  >导出</ElButton
                >
              </div>
            </div>
          </div>
        </section>
      </div>
    </ElDrawer>

    <ElDialog
      v-model="strategyDialogVisible"
      :title="strategyDialogMode === 'create' ? '新建导出策略' : '重命名导出策略'"
      width="520px"
    >
      <ElForm label-position="top">
        <ElFormItem label="策略名称">
          <ElInput v-model="strategyForm.name" placeholder="输入策略名称" />
        </ElFormItem>
        <ElFormItem v-if="strategyDialogMode === 'create'" label="策略类型">
          <ElSelect v-model="strategyForm.strategyType" class="w-full">
            <ElOption
              v-for="item in strategyTypeOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="说明">
          <ElInput
            v-model="strategyForm.description"
            type="textarea"
            :rows="3"
            placeholder="记录该策略的使用场景"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="strategyDialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="saveStrategyDialog">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
  import { useRoute } from 'vue-router'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import * as XLSX from 'xlsx'
  import { getMilkMissingReview } from '@/api/milk-review'
  import * as databaseService from '@/services/database'
  import type { MilkMissingReviewItem } from '@/services/milk-production-statistics'
  import { estimatePayloadSize, recordV2ExportRun } from '@/services/v2-export'
  import type { V2ExportPeriodInput } from '@/services/v2-export'
  import { useUserStore } from '@/store/modules/user'
  import { useLazyRenderWindow } from '@/hooks'
  import { buildCowReferenceContext, resolveCowRef, sourceRecordKey } from '@/utils/cow-reference'
  import { PERIOD_EXPORT_FIELD_SCHEMA } from '@/utils/export'
  import {
    DEFAULT_PHENOTYPE_TRAITS,
    type PhenotypeTraitDefinition
  } from '@/views/germplasm/phenotype/trait-definitions'

  type StrategyType =
    | 'animal-profile'
    | 'animal-events'
    | 'phenotype-lactation'
    | 'milk-missing-review'
    | 'breeding-dataset'
  type ExportFormat = 'xlsx' | 'csv'
  type GroupBy =
    | 'raw'
    | 'day'
    | 'week'
    | 'ten_day'
    | 'half_month'
    | 'month'
    | 'quarter'
    | 'half_year'
    | 'year'
    | 'season'
    | 'parity'
    | 'parity_calving_date'
    | 'lactation'
    | 'lactation_305'
    | 'lactation_stage'
    | 'dim_bucket'
    | 'reproduction_cycle'
    | 'pregnancy'
    | 'dry_period'
    | 'herd_group'
    | 'pen'
    | 'production_stage'
    | 'milking_shift'
    | 'equipment'
    | 'collector'
    | 'operator'
    | 'cow'
    | 'rolling_7'
    | 'rolling_30'
    | 'rolling_90'
    | 'custom_window'
  type Aggregation = 'raw' | 'count' | 'sum' | 'avg' | 'min' | 'max' | 'median' | 'latest'
  type SortDirection = 'asc' | 'desc'

  interface ExportField {
    key: string
    label: string
    type?: 'text' | 'number' | 'date'
  }

  const userPeriodExportFieldKeys = PERIOD_EXPORT_FIELD_SCHEMA.map((field) => field.key).filter(
    (key) =>
      ![
        'periodSource',
        'herdGroup',
        'currentPen',
        'productionStage',
        'equipmentId',
        'collector',
        'operatorName'
      ].includes(key)
  )

  interface SortRule {
    field: string
    direction: SortDirection
  }

  interface FilterState {
    cowNumber: string
    breeds: string[]
    statuses: string[]
    pens: string[]
    genders: string[]
    eventTypes: string[]
    traitCategories: string[]
    traitCodes: string[]
    dateRange: string[]
    paritySelections: string[]
    parityMin: number | null
    parityMax: number | null
    dimMin: number | null
    dimMax: number | null
    numericField: string
    numericOperator: 'gte' | 'lte' | 'eq' | 'between'
    numericValue: number | null
    numericMin: number | null
    numericMax: number | null
    expectedShifts: string[]
  }

  interface ExportStrategy {
    id: string
    name: string
    domain: string
    description: string
    strategyType: StrategyType
    builtin: boolean
    fields: string[]
    defaultFields: string[]
    filters: Partial<FilterState>
    period: { groupBy: GroupBy }
    aggregation: Aggregation
    sortRules: SortRule[]
    format: ExportFormat
    tone: string
    templateKind?: 'base' | 'trait-period' | 'event-count'
    templateGroup?: string
    traitCode?: string
    traitName?: string
    eventType?: string
    templateKeywords?: string[]
    presetCode?: string
    featured?: boolean
    createdAt?: string
    updatedAt?: string
    operatorName?: string
  }

  interface ExportRow {
    [key: string]: unknown
    id?: string
    cowKey?: string
    cowId?: string
    cowNumber?: string
    sourceTable?: string
    sourceRecordId?: string
    sourceRecordIds?: string
  }

  const hiddenUserExportFieldKeys = new Set([
    'recordType',
    'cowNumbers',
    'cowId',
    'animalId',
    'earTagNumber',
    'cowName',
    'sourceTable',
    'sourceRecordId',
    'sourceRecordIds',
    'periodSource',
    'aggregation'
  ])

  const periodFieldGroupByLabels: Partial<Record<GroupBy, string>> = {
    day: '统计日期',
    week: '统计周',
    ten_day: '统计旬',
    half_month: '统计半月',
    month: '统计月份',
    quarter: '统计季度',
    half_year: '统计半年',
    year: '统计年份',
    season: '统计季节',
    lactation_305: '305天窗口',
    lactation_stage: '泌乳阶段',
    dim_bucket: 'DIM分段',
    reproduction_cycle: '繁殖周期',
    pregnancy: '妊娠期',
    dry_period: '干奶期',
    herd_group: '牛群',
    pen: '圈舍',
    production_stage: '生产阶段',
    milking_shift: '班次',
    equipment: '设备/批次',
    collector: '采集人',
    operator: '操作人',
    rolling_7: '7天窗口',
    rolling_30: '30天窗口',
    rolling_90: '90天窗口',
    custom_window: '自定义时间窗'
  }

  interface ObservationInput {
    [key: string]: unknown
    id: string
    recordType: string
    cowId: string
    cowNumber: string
    cowName?: string
    breed?: string
    currentPen?: string
    category: string
    traitCode: string
    traitName: string
    collectionDate: string
    value: unknown
    unit?: string
    parity?: unknown
    daysInMilk?: unknown
    reproductionCycle?: unknown
    pregnancyStage?: unknown
    dryPeriod?: unknown
    herdGroup?: string
    productionStage?: string
    status?: string
    source?: string
    equipmentId?: string
    collector?: string
    operatorName?: string
    notes?: string
    currentParity?: unknown
    cowCurrentParity?: unknown
    sourceTable: string
    sourceRecordId: string
    sourceRecordIds?: string
  }

  type EventIntervalMode = 'consecutive_same_type' | 'latest_before_end' | 'first_after_start'
  type EventIntervalParityRelation = 'same' | 'previous_to_current' | 'same_or_previous' | 'none'
  type LogicalTraitRuleType =
    | 'event_interval'
    | 'event_count'
    | 'record_aggregation'
    | 'period_days'
  type LogicalTraitStatus = '启用' | '停用'

  interface EventIntervalTraitSpec {
    code: string
    name: string
    category: string
    unit: string
    sourceTable?: string
    startEventTypes: string[]
    endEventTypes: string[]
    mode: EventIntervalMode
    parityRelation: EventIntervalParityRelation
    minDays?: number
    maxDays?: number
    description: string
    sourceRuleId?: string
  }

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
    periodScope: GroupBy
    parityMode: string
    parityOffset: number
    matchMode: string
    aggregation: Aggregation
    outputTraitCode: string
    minValue: number | null
    maxValue: number | null
    requiredFields: string
    linkedDomains: string
    status: LogicalTraitStatus
    description: string
  }

  const userStore = useUserStore()
  const route = useRoute()

  const pedigreeFields: ExportField[] = [
    { key: 'fatherNumber', label: '父号', type: 'text' },
    { key: 'motherNumber', label: '母号', type: 'text' },
    { key: 'paternalGrandfatherNumber', label: '祖父号', type: 'text' },
    { key: 'paternalGrandmotherNumber', label: '祖母号', type: 'text' },
    { key: 'maternalGrandfatherNumber', label: '外祖父号', type: 'text' },
    { key: 'maternalGrandmotherNumber', label: '外祖母号', type: 'text' },
    { key: 'paternalGrandfatherFatherNumber', label: '祖父之父号', type: 'text' },
    { key: 'paternalGrandfatherMotherNumber', label: '祖父之母号', type: 'text' },
    { key: 'paternalGrandmotherFatherNumber', label: '祖母之父号', type: 'text' },
    { key: 'paternalGrandmotherMotherNumber', label: '祖母之母号', type: 'text' },
    { key: 'maternalGrandfatherFatherNumber', label: '外祖父之父号', type: 'text' },
    { key: 'maternalGrandfatherMotherNumber', label: '外祖父之母号', type: 'text' },
    { key: 'maternalGrandmotherFatherNumber', label: '外祖母之父号', type: 'text' },
    { key: 'maternalGrandmotherMotherNumber', label: '外祖母之母号', type: 'text' }
  ]

  const pedigreeFieldKeys = pedigreeFields.map((field) => field.key)
  const directPedigreeFieldKeys = ['fatherNumber', 'motherNumber']
  const grandparentPedigreeFieldKeys = [
    'paternalGrandfatherNumber',
    'paternalGrandmotherNumber',
    'maternalGrandfatherNumber',
    'maternalGrandmotherNumber'
  ]

  const animalFields: ExportField[] = [
    { key: 'cowNumber', label: '牛号', type: 'text' },
    { key: 'animalId', label: '牛只ID', type: 'text' },
    { key: 'earTagNumber', label: '耳标号', type: 'text' },
    { key: 'breed', label: '品种', type: 'text' },
    { key: 'gender', label: '性别', type: 'text' },
    { key: 'birthDate', label: '出生日期', type: 'date' },
    { key: 'type', label: '生产阶段', type: 'text' },
    { key: 'currentPen', label: '圈舍', type: 'text' },
    { key: 'herdGroup', label: '牛群', type: 'text' },
    { key: 'productionStage', label: '生产阶段明细', type: 'text' },
    { key: 'status', label: '状态', type: 'text' },
    { key: 'pregnancy', label: '妊娠状态', type: 'text' },
    { key: 'pregnancyStage', label: '妊娠阶段', type: 'text' },
    { key: 'dryPeriod', label: '干奶期', type: 'text' },
    { key: 'parity', label: '胎次', type: 'number' },
    { key: 'currentParity', label: '当前胎次', type: 'number' },
    { key: 'parityCalvingDate', label: '本胎产犊时间', type: 'date' },
    { key: 'reproductionCycle', label: '繁殖周期', type: 'text' },
    ...pedigreeFields,
    { key: 'createdAt', label: '建档时间', type: 'date' },
    { key: 'updatedAt', label: '更新时间', type: 'date' },
    { key: 'sourceTable', label: '来源表', type: 'text' },
    { key: 'sourceRecordId', label: '来源记录ID', type: 'text' }
  ]

  const eventFields: ExportField[] = [
    { key: 'cowNumber', label: '牛号', type: 'text' },
    { key: 'cowNumbers', label: '牛号集合', type: 'text' },
    { key: 'cowCount', label: '牛只数', type: 'number' },
    { key: 'cowId', label: '牛只ID', type: 'text' },
    { key: 'breed', label: '品种', type: 'text' },
    { key: 'currentPen', label: '圈舍', type: 'text' },
    { key: 'herdGroup', label: '牛群', type: 'text' },
    { key: 'productionStage', label: '生产阶段', type: 'text' },
    { key: 'parity', label: '胎次', type: 'number' },
    { key: 'currentParity', label: '当前胎次', type: 'number' },
    { key: 'reproductionCycle', label: '繁殖周期', type: 'text' },
    { key: 'pregnancyStage', label: '妊娠阶段', type: 'text' },
    { key: 'dryPeriod', label: '干奶期', type: 'text' },
    ...pedigreeFields,
    { key: 'eventTypeLabel', label: '事件类型', type: 'text' },
    { key: 'period', label: '周期', type: 'text' },
    { key: 'eventDate', label: '事件时间', type: 'date' },
    { key: 'milkingShift', label: '班次', type: 'text' },
    { key: 'parityCalvingDate', label: '本胎产犊时间', type: 'date' },
    { key: 'firstDate', label: '开始日期', type: 'date' },
    { key: 'lastDate', label: '结束日期', type: 'date' },
    { key: 'value', label: '统计值', type: 'number' },
    { key: 'aggregation', label: '统计口径', type: 'text' },
    { key: 'recordCount', label: '记录次数', type: 'number' },
    { key: 'operatorName', label: '操作人', type: 'text' },
    { key: 'description', label: '事件内容', type: 'text' },
    { key: 'notes', label: '备注', type: 'text' },
    { key: 'cost', label: '费用', type: 'number' },
    { key: 'createdAt', label: '记录时间', type: 'date' },
    { key: 'sourceTable', label: '来源表', type: 'text' },
    { key: 'sourceRecordId', label: '来源记录ID', type: 'text' },
    { key: 'sourceRecordIds', label: '来源记录ID集合', type: 'text' }
  ]

  const phenotypeFields: ExportField[] = [
    { key: 'recordType', label: '记录类型', type: 'text' },
    { key: 'cowNumber', label: '牛号', type: 'text' },
    { key: 'cowNumbers', label: '牛号集合', type: 'text' },
    { key: 'cowCount', label: '牛只数', type: 'number' },
    { key: 'cowId', label: '牛只ID', type: 'text' },
    { key: 'cowName', label: '耳标/名称', type: 'text' },
    { key: 'breed', label: '品种', type: 'text' },
    { key: 'currentPen', label: '圈舍', type: 'text' },
    { key: 'herdGroup', label: '牛群', type: 'text' },
    { key: 'productionStage', label: '生产阶段', type: 'text' },
    { key: 'category', label: '表型大类', type: 'text' },
    { key: 'traitCode', label: '性状编码', type: 'text' },
    { key: 'traitName', label: '性状名称', type: 'text' },
    { key: 'period', label: '周期', type: 'text' },
    { key: 'collectionDate', label: '采集日期', type: 'date' },
    { key: 'firstDate', label: '开始日期', type: 'date' },
    { key: 'lastDate', label: '结束日期', type: 'date' },
    { key: 'milkingShift', label: '班次', type: 'text' },
    { key: 'value', label: '测定值', type: 'number' },
    { key: 'unit', label: '单位', type: 'text' },
    { key: 'aggregation', label: '统计口径', type: 'text' },
    { key: 'recordCount', label: '记录次数', type: 'number' },
    { key: 'parity', label: '胎次', type: 'number' },
    { key: 'currentParity', label: '当前胎次', type: 'number' },
    { key: 'parityCalvingDate', label: '本胎产犊时间', type: 'date' },
    { key: 'reproductionCycle', label: '繁殖周期', type: 'text' },
    { key: 'pregnancyStage', label: '妊娠阶段', type: 'text' },
    { key: 'dryPeriod', label: '干奶期', type: 'text' },
    ...pedigreeFields,
    { key: 'daysInMilk', label: '泌乳天数', type: 'number' },
    { key: 'daysInMilkRange', label: 'DIM范围', type: 'text' },
    { key: 'lactationStartDate', label: '开产日期', type: 'date' },
    { key: 'lactationEndDate', label: '停产日期', type: 'date' },
    { key: 'calfBreed', label: '产仔品种', type: 'text' },
    { key: 'parityMilkYield', label: '胎次产奶量', type: 'number' },
    { key: 'milkYield305', label: '305天产奶量', type: 'number' },
    { key: 'averageDailyMilk', label: '平均日产奶', type: 'number' },
    { key: 'coverageDays', label: '覆盖天数', type: 'number' },
    { key: 'missingDays', label: '缺失天数', type: 'number' },
    { key: 'source', label: '记录来源', type: 'text' },
    { key: 'equipmentId', label: '设备/批次', type: 'text' },
    { key: 'collector', label: '采集人', type: 'text' },
    { key: 'operatorName', label: '操作人', type: 'text' },
    { key: 'notes', label: '备注', type: 'text' },
    { key: 'sourceRecordIds', label: '来源记录ID', type: 'text' }
  ]

  const milkMissingReviewFields: ExportField[] = [
    { key: 'cowNumber', label: '牛号', type: 'text' },
    { key: 'cowName', label: '耳标/名称', type: 'text' },
    { key: 'breed', label: '品种', type: 'text' },
    { key: 'currentPen', label: '圈舍', type: 'text' },
    { key: 'parity', label: '胎次', type: 'number' },
    { key: 'parityCalvingDate', label: '本胎产犊时间', type: 'date' },
    { key: 'lactationStartDate', label: '开产日期', type: 'date' },
    { key: 'lactationEndDate', label: '停产日期', type: 'date' },
    { key: 'collectionDate', label: '缺失日期', type: 'date' },
    { key: 'daysInMilk', label: '泌乳天数', type: 'number' },
    { key: 'milkingShift', label: '缺失班次', type: 'text' },
    { key: 'missingKind', label: '缺失类型', type: 'text' },
    { key: 'existingShiftCount', label: '已有班次数', type: 'number' },
    { key: 'existingDailyMilk', label: '已有日产奶量', type: 'number' },
    { key: 'recommendedMilk', label: '推荐补偿产奶量', type: 'number' },
    { key: 'recommendationMethod', label: '推荐方法', type: 'text' },
    { key: 'recommendationText', label: '推荐说明', type: 'text' },
    { key: 'confidence', label: '置信度', type: 'text' },
    { key: 'reviewStatus', label: '复核状态', type: 'text' },
    { key: 'monthKey', label: '月份', type: 'text' },
    { key: 'yearKey', label: '年份', type: 'text' },
    { key: 'sourceRecordIds', label: '来源记录ID', type: 'text' }
  ]

  const leaderCowPeriodProfileFields: ExportField[] = [
    { key: 'cowNumber', label: '牛号', type: 'text' },
    { key: 'breed', label: '品种', type: 'text' },
    { key: 'gender', label: '性别', type: 'text' },
    { key: 'birthDate', label: '出生日期', type: 'date' },
    { key: 'parity', label: '胎次', type: 'number' },
    { key: 'currentParity', label: '当前胎次', type: 'number' },
    { key: 'parityCalvingDate', label: '本胎产犊时间', type: 'date' },
    { key: 'lactationStartDate', label: '开产日期', type: 'date' },
    { key: 'lactationEndDate', label: '停产日期', type: 'date' },
    { key: 'calfBreed', label: '产仔品种', type: 'text' },
    { key: 'daysInMilkRange', label: 'DIM范围', type: 'text' },
    { key: 'parityMilkYield', label: '胎次产奶量', type: 'number' },
    { key: 'milkYield305', label: '305天产奶量', type: 'number' },
    { key: 'averageDailyMilk', label: '平均日产奶', type: 'number' },
    { key: 'coverageDays', label: '覆盖天数', type: 'number' },
    { key: 'missingDays', label: '缺失天数', type: 'number' },
    { key: 'reproductionCycle', label: '繁殖周期', type: 'text' },
    { key: 'pregnancyStage', label: '妊娠阶段', type: 'text' },
    { key: 'dryPeriod', label: '干奶期', type: 'text' },
    { key: 'currentPen', label: '圈舍', type: 'text' },
    { key: 'sourceRecordIds', label: '来源记录ID', type: 'text' }
  ]

  const combinedFields: ExportField[] = [
    { key: 'datasetDomain', label: '数据域', type: 'text' },
    { key: 'cowNumber', label: '牛号', type: 'text' },
    { key: 'cowNumbers', label: '牛号集合', type: 'text' },
    { key: 'cowCount', label: '牛只数', type: 'number' },
    { key: 'cowId', label: '牛只ID', type: 'text' },
    { key: 'breed', label: '品种', type: 'text' },
    { key: 'gender', label: '性别', type: 'text' },
    { key: 'status', label: '状态', type: 'text' },
    { key: 'currentPen', label: '圈舍', type: 'text' },
    { key: 'herdGroup', label: '牛群', type: 'text' },
    { key: 'productionStage', label: '生产阶段', type: 'text' },
    { key: 'parity', label: '胎次', type: 'number' },
    { key: 'currentParity', label: '当前胎次', type: 'number' },
    { key: 'parityCalvingDate', label: '本胎产犊时间', type: 'date' },
    { key: 'period', label: '周期', type: 'text' },
    { key: 'eventTypeLabel', label: '事件类型', type: 'text' },
    { key: 'eventDate', label: '事件时间', type: 'date' },
    { key: 'category', label: '表型大类', type: 'text' },
    { key: 'traitCode', label: '性状编码', type: 'text' },
    { key: 'traitName', label: '性状名称', type: 'text' },
    { key: 'value', label: '测定值', type: 'number' },
    { key: 'milkingShift', label: '班次', type: 'text' },
    { key: 'unit', label: '单位', type: 'text' },
    { key: 'recordCount', label: '记录次数', type: 'number' },
    ...pedigreeFields,
    { key: 'sourceTable', label: '来源表', type: 'text' },
    { key: 'sourceRecordIds', label: '来源记录ID', type: 'text' }
  ]

  const eventTypeOptions = [
    { value: 'entry', label: '入群' },
    { value: 'transfer', label: '转群' },
    { value: 'exit', label: '离群/淘汰' },
    { value: 'breeding', label: '繁殖' },
    { value: 'mating_plan', label: '选配方案' },
    { value: 'heat', label: '发情' },
    { value: 'insemination', label: '输精/配种' },
    { value: 'semen_check', label: '精液/冻精' },
    { value: 'embryo_transfer', label: '胚胎移植' },
    { value: 'pregnancy_check', label: '妊检' },
    { value: 'calving', label: '产犊' },
    { value: 'postpartum_check', label: '产后检查' },
    { value: 'abortion', label: '流产' },
    { value: 'dry_off', label: '干奶' },
    { value: 'veterinary', label: '兽医' },
    { value: 'diagnosis', label: '诊断' },
    { value: 'treatment', label: '治疗' },
    { value: 'medication', label: '用药' },
    { value: 'vaccination', label: '疫苗' },
    { value: 'deworming', label: '驱虫' },
    { value: 'quarantine', label: '隔离' },
    { value: 'disinfection', label: '消毒' },
    { value: 'lab_test', label: '实验室检测' },
    { value: 'hoof_trim', label: '修蹄' },
    { value: 'mastitis_check', label: '乳房炎检查' },
    { value: 'death', label: '死亡' },
    { value: 'milking', label: '泌乳' },
    { value: 'milking_session', label: '采奶' },
    { value: 'milk_quality', label: '奶质检测' },
    { value: 'dhi_test', label: 'DHI检测' },
    { value: 'feeding', label: '饲喂' },
    { value: 'feed_delivery', label: '投料' },
    { value: 'feed_adjustment', label: '日粮调整' },
    { value: 'feed_intake', label: '采食' },
    { value: 'water_intake', label: '饮水' },
    { value: 'body_measurement', label: '体尺测定' },
    { value: 'weighing', label: '称重' },
    { value: 'sensor_alert', label: '传感器告警' },
    { value: 'device_maintenance', label: '设备维护' },
    { value: 'sample_collection', label: '样本采集' },
    { value: 'genotyping', label: '基因分型' },
    { value: 'sequencing', label: '测序' },
    { value: 'omics_assay', label: '组学检测' },
    { value: 'event', label: '其他事件' }
  ]

  const groupByOptions: Array<{ value: GroupBy; label: string }> = [
    { value: 'raw', label: '原始记录' },
    { value: 'day', label: '按日' },
    { value: 'week', label: '按周' },
    { value: 'ten_day', label: '按旬' },
    { value: 'half_month', label: '按半月' },
    { value: 'month', label: '按月' },
    { value: 'quarter', label: '按季度' },
    { value: 'half_year', label: '按半年' },
    { value: 'year', label: '按年' },
    { value: 'season', label: '按季节' },
    { value: 'parity', label: '按胎次' },
    { value: 'parity_calving_date', label: '按本胎产犊时间' },
    { value: 'lactation', label: '按泌乳期' },
    { value: 'lactation_305', label: '305天泌乳窗' },
    { value: 'lactation_stage', label: '按泌乳阶段' },
    { value: 'dim_bucket', label: '按DIM分段' },
    { value: 'reproduction_cycle', label: '按繁殖周期' },
    { value: 'pregnancy', label: '按妊娠期' },
    { value: 'dry_period', label: '按干奶期' },
    { value: 'herd_group', label: '按牛群' },
    { value: 'pen', label: '按圈舍' },
    { value: 'production_stage', label: '按生产阶段' },
    { value: 'milking_shift', label: '按班次' },
    { value: 'equipment', label: '按设备/批次' },
    { value: 'collector', label: '按采集人' },
    { value: 'operator', label: '按操作人' },
    { value: 'cow', label: '单牛汇总' },
    { value: 'rolling_7', label: '7天滚动窗' },
    { value: 'rolling_30', label: '30天滚动窗' },
    { value: 'rolling_90', label: '90天滚动窗' },
    { value: 'custom_window', label: '自定义时间窗' }
  ]

  const groupByOptionGroups: Array<{
    label: string
    options: Array<{ value: GroupBy; label: string }>
  }> = [
    {
      label: '记录明细',
      options: groupByOptions.filter((item) => ['raw', 'cow'].includes(item.value))
    },
    {
      label: '时间周期',
      options: groupByOptions.filter((item) =>
        [
          'day',
          'week',
          'ten_day',
          'half_month',
          'month',
          'quarter',
          'half_year',
          'year',
          'season',
          'rolling_7',
          'rolling_30',
          'rolling_90',
          'custom_window'
        ].includes(item.value)
      )
    },
    {
      label: '胎次与泌乳',
      options: groupByOptions.filter((item) =>
        [
          'parity',
          'parity_calving_date',
          'lactation',
          'lactation_305',
          'lactation_stage',
          'dim_bucket'
        ].includes(item.value)
      )
    },
    {
      label: '繁殖与健康周期',
      options: groupByOptions.filter((item) =>
        ['reproduction_cycle', 'pregnancy', 'dry_period'].includes(item.value)
      )
    },
    {
      label: '牛群与生产位置',
      options: groupByOptions.filter((item) =>
        ['herd_group', 'pen', 'production_stage'].includes(item.value)
      )
    },
    {
      label: '采集与操作',
      options: groupByOptions.filter((item) =>
        ['milking_shift', 'equipment', 'collector', 'operator'].includes(item.value)
      )
    }
  ]

  const aggregationOptions: Array<{ value: Aggregation; label: string }> = [
    { value: 'raw', label: '原始值' },
    { value: 'count', label: '次数' },
    { value: 'sum', label: '合计' },
    { value: 'avg', label: '平均' },
    { value: 'min', label: '最小' },
    { value: 'max', label: '最大' },
    { value: 'median', label: '中位数' },
    { value: 'latest', label: '最新值' }
  ]

  const allTraitPeriodSpecs: Array<{ groupBy: GroupBy; aggregations: Aggregation[] }> = [
    { groupBy: 'raw', aggregations: ['raw'] },
    ...groupByOptions
      .filter((item) => item.value !== 'raw')
      .map((item) => ({
        groupBy: item.value,
        aggregations: ['sum', 'avg', 'min', 'max', 'median', 'count', 'latest'] as Aggregation[]
      }))
  ]

  const allEventCountPeriodSpecs: Array<{ groupBy: GroupBy; aggregation: Aggregation }> = [
    { groupBy: 'raw', aggregation: 'raw' },
    ...groupByOptions
      .filter((item) => item.value !== 'raw')
      .map((item) => ({ groupBy: item.value, aggregation: 'count' as Aggregation }))
  ]

  const strategyTypeOptions: Array<{ value: StrategyType; label: string }> = [
    { value: 'animal-profile', label: '个体档案' },
    { value: 'animal-events', label: '事件记录' },
    { value: 'phenotype-lactation', label: '表型与泌乳' },
    { value: 'milk-missing-review', label: '泌乳缺失复核' },
    { value: 'breeding-dataset', label: '育种综合数据包' }
  ]

  const builtinStrategies: ExportStrategy[] = [
    {
      id: 'builtin-animal-profile',
      name: '个体档案导出',
      domain: 'animal',
      description: '导出牛只档案、圈舍、生产阶段、状态、胎次和三代系谱字段。',
      strategyType: 'animal-profile',
      builtin: true,
      fields: [
        'cowNumber',
        'breed',
        'gender',
        'birthDate',
        'type',
        'currentPen',
        'herdGroup',
        'status',
        'parity',
        'parityCalvingDate',
        ...pedigreeFieldKeys
      ],
      defaultFields: [
        'cowNumber',
        'breed',
        'gender',
        'birthDate',
        'type',
        'currentPen',
        'herdGroup',
        'status',
        'parity',
        'parityCalvingDate',
        ...directPedigreeFieldKeys,
        ...grandparentPedigreeFieldKeys
      ],
      filters: { expectedShifts: ['早班', '晚班'] },
      period: { groupBy: 'raw' },
      aggregation: 'raw',
      sortRules: [
        { field: 'cowNumber', direction: 'asc' },
        { field: 'parity', direction: 'desc' },
        { field: 'birthDate', direction: 'asc' }
      ],
      format: 'xlsx',
      tone: 'teal',
      templateKind: 'base',
      templateGroup: '基础导出',
      featured: true
    },
    {
      id: 'builtin-animal-events',
      name: '事件记录导出',
      domain: 'animal_event',
      description: '导出入群、转群、离群、繁殖、兽医等场内事件及来源记录。',
      strategyType: 'animal-events',
      builtin: true,
      fields: [
        'cowNumber',
        'eventTypeLabel',
        'eventDate',
        'milkingShift',
        'parity',
        'parityCalvingDate',
        'operatorName',
        'description',
        'cost',
        'notes'
      ],
      defaultFields: [
        'cowNumber',
        'eventTypeLabel',
        'eventDate',
        'milkingShift',
        'parity',
        'parityCalvingDate',
        'operatorName',
        'description',
        'cost',
        'notes'
      ],
      filters: {},
      period: { groupBy: 'raw' },
      aggregation: 'raw',
      sortRules: [
        { field: 'eventDate', direction: 'desc' },
        { field: 'cowNumber', direction: 'asc' },
        { field: 'eventTypeLabel', direction: 'asc' }
      ],
      format: 'xlsx',
      tone: 'info',
      templateKind: 'base',
      templateGroup: '基础导出',
      featured: true
    },
    {
      id: 'builtin-phenotype-lactation',
      name: '表型与泌乳导出',
      domain: 'trait_observation',
      description: '导出体尺、体重、DHI、奶厅测量、305天泌乳窗等表型记录。',
      strategyType: 'phenotype-lactation',
      builtin: true,
      fields: [
        'cowNumber',
        'category',
        'collectionDate',
        'parity',
        'parityCalvingDate',
        'daysInMilk',
        'daysInMilkRange',
        'milkingShift',
        'source'
      ],
      defaultFields: [
        'cowNumber',
        'category',
        'collectionDate',
        'parity',
        'parityCalvingDate',
        'daysInMilk',
        'milkingShift',
        'source'
      ],
      filters: { traitCodes: ['milk_yield'] },
      period: { groupBy: 'raw' },
      aggregation: 'raw',
      sortRules: [
        { field: 'collectionDate', direction: 'desc' },
        { field: 'cowNumber', direction: 'asc' },
        { field: 'traitCode', direction: 'asc' }
      ],
      format: 'xlsx',
      tone: 'warning',
      templateKind: 'base',
      templateGroup: '基础导出',
      featured: true
    },
    {
      id: 'builtin-milk-missing-review',
      name: '泌乳缺失复核导出',
      domain: 'data_quality_issue',
      description: '导出系统识别到的缺整日、缺班次、空产量和汇总待拆分记录，以及补偿建议。',
      strategyType: 'milk-missing-review',
      builtin: true,
      fields: [
        'cowNumber',
        'collectionDate',
        'parity',
        'parityCalvingDate',
        'daysInMilk',
        'milkingShift',
        'missingKind',
        'recommendedMilk',
        'recommendationMethod',
        'confidence',
        'reviewStatus'
      ],
      defaultFields: [
        'cowNumber',
        'collectionDate',
        'parity',
        'parityCalvingDate',
        'daysInMilk',
        'milkingShift',
        'missingKind',
        'existingShiftCount',
        'existingDailyMilk',
        'recommendedMilk',
        'recommendationMethod',
        'confidence',
        'reviewStatus'
      ],
      filters: {},
      period: { groupBy: 'raw' },
      aggregation: 'raw',
      sortRules: [
        { field: 'collectionDate', direction: 'desc' },
        { field: 'cowNumber', direction: 'asc' },
        { field: 'milkingShift', direction: 'asc' }
      ],
      format: 'xlsx',
      tone: 'danger',
      templateKind: 'base',
      templateGroup: '泌乳模板',
      presetCode: 'milk-missing-review',
      templateKeywords: ['缺失复核', '缺班次', '缺整日', '补偿建议', '人工核对'],
      featured: true
    },
    {
      id: 'builtin-breeding-dataset',
      name: '育种综合数据包',
      domain: 'breeding_dataset',
      description: '按牛号合并档案、事件、表型与泌乳记录，用于科研和育种分析取数。',
      strategyType: 'breeding-dataset',
      builtin: true,
      fields: [
        'datasetDomain',
        'cowNumber',
        'breed',
        'status',
        'currentPen',
        'parity',
        'parityCalvingDate',
        'milkingShift',
        'eventTypeLabel',
        'eventDate',
        'traitCode',
        'traitName',
        'value',
        'unit',
        ...pedigreeFieldKeys,
        'source'
      ],
      defaultFields: [
        'datasetDomain',
        'cowNumber',
        'breed',
        'status',
        'currentPen',
        'parity',
        'parityCalvingDate',
        'milkingShift',
        'eventTypeLabel',
        'eventDate',
        'traitCode',
        'traitName',
        'value',
        'unit',
        ...directPedigreeFieldKeys,
        ...grandparentPedigreeFieldKeys,
        'source'
      ],
      filters: {},
      period: { groupBy: 'raw' },
      aggregation: 'raw',
      sortRules: [
        { field: 'cowNumber', direction: 'asc' },
        { field: 'datasetDomain', direction: 'asc' },
        { field: 'period', direction: 'desc' }
      ],
      format: 'xlsx',
      tone: 'danger',
      templateKind: 'base',
      templateGroup: '基础导出',
      featured: true
    }
  ]

  const eventIntervalTraitSpecs: EventIntervalTraitSpec[] = [
    {
      code: 'calving_interval_days',
      name: '产犊间隔',
      category: '繁殖性状',
      unit: 'd',
      startEventTypes: ['calving'],
      endEventTypes: ['calving'],
      mode: 'consecutive_same_type',
      parityRelation: 'none',
      minDays: 180,
      maxDays: 900,
      description: '同一头牛相邻两次产犊事件之间的天数。'
    },
    {
      code: 'last_insemination_to_calving_days',
      name: '末次输精至产犊间隔',
      category: '繁殖性状',
      unit: 'd',
      startEventTypes: ['insemination'],
      endEventTypes: ['calving'],
      mode: 'latest_before_end',
      parityRelation: 'same_or_previous',
      minDays: 180,
      maxDays: 380,
      description: '产犊前最近一次输精/配种到本次产犊的天数；优先匹配同胎次或上胎次事件。'
    },
    {
      code: 'calving_to_first_insemination_days',
      name: '产犊至首配间隔',
      category: '繁殖性状',
      unit: 'd',
      startEventTypes: ['calving'],
      endEventTypes: ['insemination'],
      mode: 'first_after_start',
      parityRelation: 'same_or_previous',
      minDays: 0,
      maxDays: 300,
      description: '产犊后到下一次首个输精/配种事件的天数。'
    },
    {
      code: 'insemination_to_pregnancy_check_days',
      name: '输精至妊检间隔',
      category: '繁殖性状',
      unit: 'd',
      startEventTypes: ['insemination'],
      endEventTypes: ['pregnancy_check'],
      mode: 'latest_before_end',
      parityRelation: 'same',
      minDays: 0,
      maxDays: 120,
      description: '妊检前最近一次输精/配种到妊检事件的天数。'
    },
    {
      code: 'calving_to_pregnancy_check_days',
      name: '产犊至妊检间隔',
      category: '繁殖性状',
      unit: 'd',
      startEventTypes: ['calving'],
      endEventTypes: ['pregnancy_check'],
      mode: 'latest_before_end',
      parityRelation: 'same_or_previous',
      minDays: 0,
      maxDays: 420,
      description: '本轮产犊后到妊检事件的天数。'
    },
    {
      code: 'dry_off_to_calving_days',
      name: '干奶至产犊间隔',
      category: '繁殖性状',
      unit: 'd',
      startEventTypes: ['dry_off'],
      endEventTypes: ['calving'],
      mode: 'latest_before_end',
      parityRelation: 'same_or_previous',
      minDays: 20,
      maxDays: 180,
      description: '产犊前最近一次干奶事件到本次产犊的天数。'
    }
  ]

  const eventIntervalTraits: PhenotypeTraitDefinition[] = eventIntervalTraitSpecs.map((spec) => ({
    id: `event-interval-${spec.code}`,
    code: spec.code,
    name: spec.name,
    category: spec.category,
    unit: spec.unit,
    dataType: '数值',
    source: '系统计算',
    requiredFields: '牛号、起点事件、终点事件、事件时间、胎次',
    linkedDomains: '个体档案、繁殖记录、事件记录、系谱、组学样本',
    status: '启用',
    description: spec.description
  }))

  const additionalExportTraits: PhenotypeTraitDefinition[] = [
    {
      id: 'milk-temperature',
      code: 'milk_temperature',
      name: '奶温',
      category: '泌乳性能',
      unit: '℃',
      dataType: '数值',
      source: '奶厅导入',
      requiredFields: '牛号、采集日期、奶厅设备、奶温',
      linkedDomains: '个体档案、奶厅设备、健康记录',
      status: '启用',
      description: '奶厅或传感器采集的奶温记录。'
    },
    {
      id: 'milking-duration',
      code: 'milking_duration',
      name: '挤奶时长',
      category: '泌乳性能',
      unit: 'min',
      dataType: '数值',
      source: '奶厅导入',
      requiredFields: '牛号、采集日期、奶厅设备、挤奶时长',
      linkedDomains: '个体档案、奶厅设备、泌乳记录',
      status: '启用',
      description: '奶厅设备记录的单次挤奶时长。'
    },
    ...eventIntervalTraits
  ]

  const traitTemplateFields = [
    'period',
    'cowNumber',
    'cowNumbers',
    'cowCount',
    'aggregation',
    'recordCount',
    'firstDate',
    'lastDate',
    'parity',
    'currentParity',
    'parityCalvingDate',
    'daysInMilkRange',
    'milkingShift',
    'breed',
    'currentPen',
    'herdGroup',
    'productionStage',
    'reproductionCycle',
    'pregnancyStage',
    'dryPeriod',
    'equipmentId',
    'collector',
    'operatorName',
    'sourceRecordIds'
  ]
  const traitRawFields = [
    'recordType',
    'cowNumber',
    'collectionDate',
    'parity',
    'currentParity',
    'parityCalvingDate',
    'daysInMilk',
    'milkingShift',
    'breed',
    'currentPen',
    'herdGroup',
    'productionStage',
    'source',
    'equipmentId',
    'collector',
    'operatorName',
    'sourceRecordIds'
  ]
  const eventCountFields = [
    'period',
    'eventTypeLabel',
    'cowNumber',
    'cowNumbers',
    'cowCount',
    'value',
    'aggregation',
    'recordCount',
    'firstDate',
    'lastDate',
    'milkingShift',
    'parity',
    'currentParity',
    'parityCalvingDate',
    'breed',
    'currentPen',
    'herdGroup',
    'productionStage',
    'reproductionCycle',
    'pregnancyStage',
    'dryPeriod',
    'operatorName',
    'sourceRecordIds'
  ]
  const traitValueFieldPrefix = 'traitValue:'
  const traitTechnicalFieldKeys = new Set(['traitCode', 'traitName', 'value', 'unit'])
  const leaderMilkPresetPrefix = 'custom-leader-milk-stat-'

  const strategyScopeOptions = [
    '常用',
    '全部',
    '泌乳模板',
    '体尺模板',
    '性状模板',
    '次数模板',
    '基础',
    '自建'
  ]
  const strategyScope = ref('常用')
  const strategyKeyword = ref('')
  const customStrategies = ref<ExportStrategy[]>([])
  const storedTraitDefinitions = ref<PhenotypeTraitDefinition[]>([])
  const storedLogicalTraitRules = ref<LogicalTraitRule[]>([])
  const selectedStrategy = ref<ExportStrategy | null>(null)
  const strategyViewportRef = ref<HTMLElement | null>(null)
  const strategyViewportWidth = ref(0)
  const strategyStartRow = ref(0)
  const configDrawerVisible = ref(false)
  const strategyDialogVisible = ref(false)
  const strategyDialogMode = ref<'create' | 'rename'>('create')
  const editingStrategyId = ref('')
  const fullPreviewRows = ref<ExportRow[]>([])
  const totalRows = ref(0)
  const referenceRows = ref<ExportRow[]>([])
  const farmUnitDisplayMap = ref(new Map<string, string>())
  const referenceRowsLoading = ref(false)
  const previewLoading = ref(false)
  const exportLoading = ref(false)
  const previewSignature = ref('')
  const previewSortRules = ref<SortRule[]>([])
  const expandedFieldGroups = ref<string[]>([])

  const strategyForm = reactive({
    name: '',
    strategyType: 'animal-profile' as StrategyType,
    description: ''
  })

  const configForm = reactive({
    fields: [] as string[],
    format: 'xlsx' as ExportFormat,
    filters: defaultFilters(),
    period: { groupBy: 'raw' as GroupBy },
    aggregation: 'raw' as Aggregation,
    sortRules: defaultSortRules()
  })

  const activeLogicalTraitRules = computed(() =>
    storedLogicalTraitRules.value.filter(
      (rule) => rule.status === '启用' && (rule.outputTraitCode || rule.code)
    )
  )
  const logicalTraitDefinitions = computed(
    () =>
      activeLogicalTraitRules.value
        .map((rule) => logicalRuleToTraitDefinition(rule))
        .filter(Boolean) as PhenotypeTraitDefinition[]
  )
  const activeEventIntervalTraitSpecs = computed(() => {
    const map = new Map<string, EventIntervalTraitSpec>()
    eventIntervalTraitSpecs.forEach((spec) => map.set(canonicalTraitCode(spec.code), spec))
    activeLogicalTraitRules.value
      .filter((rule) => rule.ruleType === 'event_interval')
      .map((rule) => logicalRuleToEventIntervalSpec(rule))
      .filter(Boolean)
      .forEach((spec) => map.set(canonicalTraitCode(spec!.code), spec!))
    return Array.from(map.values())
  })

  const templateTraits = computed(() =>
    buildTemplateTraitCatalog(
      [
        ...DEFAULT_PHENOTYPE_TRAITS,
        ...additionalExportTraits,
        ...logicalTraitDefinitions.value,
        ...storedTraitDefinitions.value
      ],
      referenceRows.value
    )
  )
  const builtinTemplateStrategies = computed(() =>
    buildBuiltinTemplateStrategies(templateTraits.value)
  )
  const allStrategies = computed(() => [
    ...builtinStrategies,
    ...builtinTemplateStrategies.value,
    ...customStrategies.value
  ])
  const featuredTemplateCount = computed(
    () => allStrategies.value.filter((strategy) => strategy.featured).length
  )
  const strategyCardHeight = 304
  const strategyGridGap = 12
  const strategyRenderRows = 3
  let strategyResizeObserver: ResizeObserver | null = null

  const {
    visibleItems: previewRows,
    resetVisibleCount: resetPreviewRows,
    handleScroll: onPreviewScroll,
    handleWheel: onPreviewWheel
  } = useLazyRenderWindow(fullPreviewRows, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const filteredStrategies = computed(() => {
    const keyword = strategyKeyword.value.trim().toLowerCase()
    return allStrategies.value.filter((strategy) => {
      if (!matchesStrategyScope(strategy, strategyScope.value)) return false
      if (!keyword) return true
      return [
        strategy.name,
        strategy.description,
        strategyTypeLabel(strategy.strategyType),
        strategy.templateGroup,
        strategy.traitName,
        strategy.traitCode,
        eventTypeLabel(strategy.eventType),
        groupByLabel(strategy.period.groupBy),
        aggregationLabel(strategy.aggregation),
        ...(strategy.templateKeywords || []),
        ...strategy.fields,
        ...strategyFieldPreview(strategy)
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  })

  const strategyColumnCount = computed(() =>
    columnCountForStrategyWidth(strategyViewportWidth.value)
  )
  const strategyRowStride = computed(() => strategyCardHeight + strategyGridGap)
  const strategyRowCount = computed(() =>
    Math.ceil(filteredStrategies.value.length / strategyColumnCount.value)
  )
  const maxStrategyStartRow = computed(() =>
    Math.max(0, strategyRowCount.value - strategyRenderRows)
  )
  const visibleStrategyStartIndex = computed(
    () => strategyStartRow.value * strategyColumnCount.value
  )
  const visibleStrategyCount = computed(() => strategyColumnCount.value * strategyRenderRows)
  const visibleStrategies = computed(() =>
    filteredStrategies.value.slice(
      visibleStrategyStartIndex.value,
      visibleStrategyStartIndex.value + visibleStrategyCount.value
    )
  )
  const strategyViewportStyle = computed(() => {
    const rows = Math.min(strategyRenderRows, Math.max(strategyRowCount.value, 1))
    return {
      height: `${rows * strategyCardHeight + Math.max(0, rows - 1) * strategyGridGap + 8}px`
    }
  })
  const strategySpacerStyle = computed(() => ({
    height: `${strategyRowCount.value * strategyCardHeight + Math.max(0, strategyRowCount.value - 1) * strategyGridGap}px`
  }))
  const strategyGridStyle = computed(() => ({
    gap: `${strategyGridGap}px`,
    gridAutoRows: `${strategyCardHeight}px`,
    gridTemplateColumns: `repeat(${strategyColumnCount.value}, minmax(0, 1fr))`,
    transform: `translate3d(0, ${strategyStartRow.value * strategyRowStride.value}px, 0)`
  }))

  const isCurrentTraitStrategy = computed(() => isTraitStrategy(selectedStrategy.value))
  const showEventSelector = computed(
    () =>
      !selectedStrategy.value ||
      ['animal-events', 'breeding-dataset'].includes(selectedStrategy.value.strategyType)
  )
  const showTraitSelector = computed(
    () =>
      !selectedStrategy.value ||
      ['phenotype-lactation', 'breeding-dataset'].includes(selectedStrategy.value.strategyType)
  )
  const activeFieldDefs = computed(() => {
    const fields = selectedStrategy.value
      ? fieldDefsForStrategy(selectedStrategy.value)
      : combinedFields
    const visibleFields = fields.filter((field) => isUserVisibleField(selectedStrategy.value, field.key))
    return uniqueExportFields(
      isCurrentTraitStrategy.value
        ? visibleFields.filter((field) => !traitTechnicalFieldKeys.has(field.key))
        : visibleFields,
      selectedStrategy.value
    )
  })
  const activeFieldGroups = computed(() => groupFieldDefinitions(activeFieldDefs.value))
  function ensureFieldGroupExpanded() {
    const titles = activeFieldGroups.value.map((group) => group.title)
    expandedFieldGroups.value = expandedFieldGroups.value.filter((title) => titles.includes(title))
    if (!expandedFieldGroups.value.length && titles.length) {
      expandedFieldGroups.value = [titles[0]]
    }
  }
  function isFieldGroupExpanded(title: string) {
    return expandedFieldGroups.value.includes(title)
  }
  function toggleFieldGroup(title: string) {
    if (isFieldGroupExpanded(title)) {
      expandedFieldGroups.value = expandedFieldGroups.value.filter((item) => item !== title)
      ensureFieldGroupExpanded()
      return
    }
    expandedFieldGroups.value = [...expandedFieldGroups.value, title]
  }
  const selectedTraitCodes = computed(() => currentSelectedTraitCodes())
  const selectedTraitColumns = computed(() =>
    selectedTraitCodes.value.map((code) => ({
      key: traitValueKey(code),
      label: traitColumnLabelForStrategy(selectedStrategy.value, code),
      type: 'number' as const
    }))
  )
  const activeFieldMap = computed(
    () =>
      new Map(
        [...activeFieldDefs.value, ...selectedTraitColumns.value].map((field) => [field.key, field])
      )
  )
  const previewColumns = computed(() => {
    const baseFields = configForm.fields
      .map((key) => activeFieldMap.value.get(key))
      .filter(isExportField)
      .filter((field) => isUserVisibleField(selectedStrategy.value, field.key)) as ExportField[]
    const normalizedBaseFields = uniqueExportFields(baseFields, selectedStrategy.value)
    if (!isCurrentTraitStrategy.value) return normalizedBaseFields
    const baseKeys = new Set(normalizedBaseFields.map((field) => field.key))
    return uniqueExportFields([
      ...normalizedBaseFields,
      ...selectedTraitColumns.value.filter((field) => !baseKeys.has(field.key))
    ], selectedStrategy.value)
  })
  const previewTableMinWidth = computed(
    () => `${Math.max(860, 58 + previewColumns.value.length * 176)}px`
  )
  const activePreviewSortRules = computed(() => previewSortRules.value.filter((rule) => rule.field))
  const numericFieldDefs = computed(() => {
    const fields = activeFieldDefs.value.filter((field) => field.type === 'number')
    return isCurrentTraitStrategy.value ? [...selectedTraitColumns.value, ...fields] : fields
  })

  const breedOptions = computed(() => uniqueOptions(referenceRows.value.map((row) => row.breed)))
  const statusOptions = computed(() => uniqueOptions(referenceRows.value.map((row) => row.status)))
  const penOptions = computed(() =>
    uniqueOptions(referenceRows.value.map((row) => displayPenValue(row.currentPen)))
  )
  const genderOptions = computed(() => uniqueOptions(referenceRows.value.map((row) => row.gender)))
  const paritySelectionOptions = computed(() => {
    const absolute = Array.from(
      new Set(
        referenceRows.value
          .map((row) => numericValue(row.parity))
          .filter((value): value is number => value !== null && value > 0)
      )
    )
      .sort((left, right) => left - right)
      .map((value) => ({ value: String(value), label: `第 ${value} 胎` }))
    const relative = [
      { value: '-1', label: '当前胎次（-1）' },
      { value: '-2', label: '上一胎（-2）' },
      { value: '-3', label: '上两胎（-3）' }
    ]
    return [...relative, ...absolute]
  })
  const traitCategoryOptions = computed(() =>
    uniqueOptions([
      ...referenceRows.value.map((row) => row.category),
      ...templateTraits.value.map((trait) => trait.category)
    ])
  )
  const traitCodeOptions = computed(() => {
    const map = new Map<string, string>()
    templateTraits.value.forEach((trait) => {
      if (trait.code) map.set(trait.code, `${trait.name}（${trait.code}）`)
    })
    referenceRows.value.forEach((row) => {
      const code = canonicalTraitCode(row.traitCode)
      if (!code) return
      const name = String(row.traitName || code)
      if (!map.has(code)) map.set(code, `${name}（${code}）`)
    })
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }))
  })

  const previewDescription = computed(() => {
    if (!selectedStrategy.value) return '选择策略并生成预览后，这里展示可导出的数据。'
    const sortText = activePreviewSortRules.value
      .map(
        (rule, index) =>
          `优先级 ${index + 1} ${fieldLabel(rule.field)} ${rule.direction === 'desc' ? '降序' : '升序'}`
      )
      .join('，')
    return `${selectedStrategy.value.name}，${groupByLabel(configForm.period.groupBy)}，${aggregationLabel(configForm.aggregation)}${sortText ? `，${sortText}` : ''}`
  })

  watch([strategyScope, strategyKeyword], () => {
    resetStrategyWindow()
  })

  watch(
    () => filteredStrategies.value.length,
    () => {
      resetStrategyWindow()
    }
  )

  watch(strategyColumnCount, () => {
    resetStrategyWindow()
  })

  onMounted(async () => {
    await loadPageData()
    openStrategyFromRoute()
    nextTick(() => {
      setupStrategyViewportObserver()
    })
  })

  onUnmounted(() => {
    strategyResizeObserver?.disconnect()
    window.removeEventListener('resize', updateStrategyViewportWidth)
  })

  function columnCountForStrategyWidth(width: number) {
    const normalizedWidth = Math.max(width || 0, 320)
    const minCardWidth = normalizedWidth < 760 ? 232 : 252
    return Math.max(
      1,
      Math.min(
        5,
        Math.floor((normalizedWidth + strategyGridGap) / (minCardWidth + strategyGridGap))
      )
    )
  }

  function setupStrategyViewportObserver() {
    updateStrategyViewportWidth()
    if (!strategyViewportRef.value) return
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateStrategyViewportWidth)
      return
    }
    strategyResizeObserver = new ResizeObserver(updateStrategyViewportWidth)
    strategyResizeObserver.observe(strategyViewportRef.value)
  }

  function updateStrategyViewportWidth() {
    strategyViewportWidth.value = strategyViewportRef.value?.clientWidth || window.innerWidth
  }

  function resetStrategyWindow() {
    strategyStartRow.value = 0
    if (strategyViewportRef.value) strategyViewportRef.value.scrollTop = 0
  }

  function handleStrategyScroll() {
    const scrollTop = strategyViewportRef.value?.scrollTop || 0
    strategyStartRow.value = Math.min(
      maxStrategyStartRow.value,
      Math.max(0, Math.floor(scrollTop / strategyRowStride.value))
    )
  }

  function buildBuiltinTemplateStrategies(traits: PhenotypeTraitDefinition[]) {
    return [...buildTraitTemplateStrategies(traits), ...buildEventCountTemplateStrategies()]
  }

  function buildTraitTemplateStrategies(traits: PhenotypeTraitDefinition[]) {
    return traits.flatMap((trait) =>
      allTraitPeriodSpecs.flatMap((period) =>
        period.aggregations.map((aggregation) =>
          makeTraitTemplateStrategy(trait, period.groupBy, aggregation)
        )
      )
    )
  }

  function buildEventCountTemplateStrategies() {
    return eventTypeOptions.flatMap((eventType) =>
      allEventCountPeriodSpecs.map((period) =>
        makeEventCountTemplateStrategy(eventType, period.groupBy, period.aggregation)
      )
    )
  }

  function buildTemplateTraitCatalog(traits: PhenotypeTraitDefinition[], rows: ExportRow[]) {
    const map = new Map<string, PhenotypeTraitDefinition>()
    traits.forEach((trait) => {
      const normalized = normalizeTemplateTrait(trait)
      if (normalized)
        map.set(normalized.code, { ...(map.get(normalized.code) || normalized), ...normalized })
    })
    rows.forEach((row) => {
      const code = canonicalTraitCode(row.traitCode)
      if (!code || map.has(code)) return
      map.set(
        code,
        normalizeTemplateTrait({
          id: `runtime-${code}`,
          code,
          name: str(row.traitName || code),
          category: str(row.category || '表型记录'),
          unit: str(row.unit),
          dataType: '数值',
          source: '系统计算',
          requiredFields: '牛号、采集日期、测定值',
          linkedDomains: '个体档案、系谱、组学样本',
          status: '启用',
          description: '来自当前系统记录的可导出性状。'
        })!
      )
    })
    return Array.from(map.values())
      .filter((trait) => trait.status !== '停用')
      .sort((left, right) =>
        `${left.category}-${left.name}`.localeCompare(`${right.category}-${right.name}`, 'zh-CN')
      )
  }

  function normalizeTemplateTrait(row: Record<string, any>): PhenotypeTraitDefinition | null {
    const code = canonicalTraitCode(row.code || row.traitCode || row.trait_code)
    if (!code) return null
    return {
      id: str(row.id || `trait-${code}`),
      code,
      name: str(row.name || row.traitName || row.trait_name || code),
      category: str(row.category || row.traitCategory || row.trait_category || '表型记录'),
      unit: str(row.unit),
      dataType: str(
        row.dataType || row.data_type || '数值'
      ) as PhenotypeTraitDefinition['dataType'],
      source: str(row.source || '系统计算') as PhenotypeTraitDefinition['source'],
      sourceTable: str(row.sourceTable || row.source_table),
      sourceAnimalField: str(row.sourceAnimalField || row.source_animal_field),
      sourceTraitField: str(row.sourceTraitField || row.source_trait_field),
      sourceValueField: str(row.sourceValueField || row.source_value_field),
      sourceDateField: str(row.sourceDateField || row.source_date_field),
      sourceParityField: str(row.sourceParityField || row.source_parity_field),
      sourceDimField: str(row.sourceDimField || row.source_dim_field),
      requiredFields: str(row.requiredFields || row.required_fields || '牛号、采集日期、测定值'),
      linkedDomains: str(row.linkedDomains || row.linked_domains || '个体档案、系谱、组学样本'),
      status: str(row.status || '启用') as PhenotypeTraitDefinition['status'],
      description: str(row.description)
    }
  }

  function normalizeLogicalTraitRule(row: Record<string, any>): LogicalTraitRule | null {
    const code = canonicalTraitCode(row.outputTraitCode || row.output_trait_code || row.code)
    if (!code) return null
    return {
      id: str(row.id || `logic-${code}`),
      code: canonicalTraitCode(row.code || code),
      name: str(row.name || row.traitName || row.trait_name || code),
      category: str(row.category || row.traitCategory || row.trait_category || '逻辑性状'),
      unit: str(row.unit || (str(row.ruleType || row.rule_type).includes('count') ? '次' : 'd')),
      ruleType: normalizeLogicalRuleType(row.ruleType || row.rule_type),
      sourceTable: str(row.sourceTable || row.source_table || 'animal_event'),
      sourceTraitCodes: normalizeTraitCodeList(
        row.sourceTraitCodes ||
          row.source_trait_codes ||
          row.sourceTraitCode ||
          row.source_trait_code
      ),
      sourceValueField: str(row.sourceValueField || row.source_value_field || 'value'),
      sourceDateField: str(row.sourceDateField || row.source_date_field || 'collectionDate'),
      startEventTypes: normalizeEventTypeList(row.startEventTypes || row.start_event_types),
      endEventTypes: normalizeEventTypeList(row.endEventTypes || row.end_event_types),
      periodScope: normalizeGroupBy(row.periodScope || row.period_scope || 'parity', 'parity'),
      parityMode: str(row.parityMode || row.parity_mode || 'current'),
      parityOffset: normalizeInteger(row.parityOffset ?? row.parity_offset, 0),
      matchMode: str(row.matchMode || row.match_mode || 'latest_before_end'),
      aggregation: normalizeAggregation(row.aggregation),
      outputTraitCode: code,
      minValue: normalizeNullableNumber(row.minValue ?? row.min_value),
      maxValue: normalizeNullableNumber(row.maxValue ?? row.max_value),
      requiredFields: str(
        row.requiredFields || row.required_fields || '牛号、事件类型、事件时间、胎次'
      ),
      linkedDomains: str(
        row.linkedDomains || row.linked_domains || '个体档案、繁殖记录、系谱、组学样本'
      ),
      status: str(row.status || '启用') === '停用' ? '停用' : '启用',
      description: str(row.description)
    }
  }

  function normalizeLogicalRuleType(value: unknown): LogicalTraitRuleType {
    const text = str(value)
    if (text === 'event_count') return 'event_count'
    if (text === 'record_aggregation') return 'record_aggregation'
    if (text === 'period_days') return 'period_days'
    return 'event_interval'
  }

  function normalizeEventTypeList(value: unknown) {
    const values = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? (() => {
            const trimmed = value.trim()
            if (!trimmed) return []
            try {
              const parsed = JSON.parse(trimmed)
              if (Array.isArray(parsed)) return parsed
            } catch {
              return trimmed.split(/[,，、;]/)
            }
            return trimmed.split(/[,，、;]/)
          })()
        : []
    return Array.from(new Set(values.map((item) => normalizeEventType(item)).filter(Boolean)))
  }

  function normalizeNullableNumber(value: unknown): number | null {
    const numeric = numericValue(value)
    return numeric === null ? null : numeric
  }

  function normalizeInteger(value: unknown, fallback: number) {
    const numeric = numericValue(value)
    return numeric === null ? fallback : Math.trunc(numeric)
  }

  function logicalRuleToTraitDefinition(rule: LogicalTraitRule): PhenotypeTraitDefinition | null {
    const code = canonicalTraitCode(rule.outputTraitCode || rule.code)
    if (!code) return null
    return {
      id: `logical-${rule.id}`,
      code,
      name: rule.name || code,
      category: rule.category || '逻辑性状',
      unit: rule.unit || (rule.ruleType === 'event_count' ? '次' : 'd'),
      dataType: '数值',
      source: '系统计算',
      sourceTable: 'logical-trait-rules',
      sourceAnimalField: 'cowId',
      sourceTraitField: 'traitCode',
      sourceValueField: 'value',
      sourceDateField: 'collectionDate',
      sourceParityField: 'parity',
      sourceDimField: 'daysInMilk',
      requiredFields: rule.requiredFields || '牛号、事件类型、事件时间、胎次',
      linkedDomains: rule.linkedDomains || '个体档案、繁殖记录、系谱、组学样本',
      status: rule.status,
      description: rule.description || '由性状词典中的逻辑规则计算生成。'
    }
  }

  function logicalRuleToEventIntervalSpec(rule: LogicalTraitRule): EventIntervalTraitSpec | null {
    const mode = normalizeEventIntervalMode(rule.matchMode)
    if (!rule.startEventTypes.length || !rule.endEventTypes.length) return null
    return {
      code: canonicalTraitCode(rule.outputTraitCode || rule.code),
      name: rule.name,
      category: rule.category || '逻辑性状',
      unit: rule.unit || 'd',
      sourceTable: normalizeLogicalSourceTable(rule.sourceTable || 'animal_event'),
      startEventTypes: rule.startEventTypes,
      endEventTypes: rule.endEventTypes,
      mode,
      parityRelation: parityRelationForRule(rule),
      minDays: rule.minValue ?? undefined,
      maxDays: rule.maxValue ?? undefined,
      description: rule.description,
      sourceRuleId: rule.id
    }
  }

  function normalizeEventIntervalMode(value: unknown): EventIntervalMode {
    const text = str(value)
    if (text === 'consecutive_same_type') return 'consecutive_same_type'
    if (text === 'first_after_start') return 'first_after_start'
    return 'latest_before_end'
  }

  function parityRelationForRule(rule: LogicalTraitRule): EventIntervalParityRelation {
    if (rule.parityMode === 'none') return 'none'
    if (rule.parityMode === 'same') return 'same'
    if (rule.parityMode === 'same_or_previous') return 'same_or_previous'
    if (rule.parityMode === 'relative_from_current' && rule.parityOffset <= -1)
      return 'previous_to_current'
    return 'same_or_previous'
  }

  function makeTraitTemplateStrategy(
    trait: PhenotypeTraitDefinition,
    groupBy: GroupBy,
    aggregation: Aggregation
  ): ExportStrategy {
    const businessName = traitTemplateName(trait, groupBy, aggregation)
    const rawTemplate = groupBy === 'raw' && aggregation === 'raw'
    const featured = isFeaturedTraitTemplate(trait, groupBy, aggregation)
    return makeExportStrategy({
      id: `builtin-trait-${sanitizeKey(trait.code)}-${groupBy}-${aggregation}`,
      name: businessName,
      domain: 'trait_observation',
      description: `${trait.name}的${groupByLabel(groupBy)}${aggregationLabel(aggregation)}导出，保留牛号、周期、统计值、记录次数和来源记录。`,
      strategyType: 'phenotype-lactation',
      fields: rawTemplate ? [...traitRawFields] : [...traitTemplateFields],
      defaultFields: rawTemplate ? [...traitRawFields] : [...traitTemplateFields],
      filters: {
        traitCategories: [trait.category],
        traitCodes: [trait.code],
        dimMin: groupBy === 'lactation_305' ? 1 : null,
        dimMax: groupBy === 'lactation_305' ? 305 : null
      },
      period: { groupBy },
      aggregation,
      sortRules: rawTemplate
        ? [
            { field: 'collectionDate', direction: 'desc' },
            { field: 'cowNumber', direction: 'asc' },
            { field: 'value', direction: defaultValueSortDirection(trait, aggregation) }
          ]
        : [
            { field: 'period', direction: 'desc' },
            { field: 'value', direction: defaultValueSortDirection(trait, aggregation) },
            { field: 'cowNumber', direction: 'asc' }
          ],
      tone: traitTone(trait),
      templateKind: 'trait-period',
      templateGroup: `${trait.category}模板`,
      traitCode: trait.code,
      traitName: trait.name,
      templateKeywords: traitTemplateKeywords(trait, groupBy, aggregation),
      featured
    })
  }

  function makeEventCountTemplateStrategy(
    eventType: { value: string; label: string },
    groupBy: GroupBy,
    aggregation: Aggregation
  ): ExportStrategy {
    const rawTemplate = groupBy === 'raw'
    const displayName = eventCountTemplateName(eventType.value, eventType.label, groupBy)
    return makeExportStrategy({
      id: `builtin-event-${sanitizeKey(eventType.value)}-${groupBy}-${aggregation}`,
      name: displayName,
      domain: 'animal_event',
      description: rawTemplate
        ? `导出${eventType.label}事件明细，保留单次发生时间、操作人、费用和来源记录。`
        : `统计${eventType.label}事件在${groupByLabel(groupBy)}内的发生次数，形成${displayName}。`,
      strategyType: 'animal-events',
      fields: rawTemplate
        ? [
            'cowNumber',
            'eventTypeLabel',
            'eventDate',
            'milkingShift',
            'parity',
            'currentParity',
            'parityCalvingDate',
            'operatorName',
            'description',
            'cost',
            'notes',
            'sourceTable',
            'sourceRecordId'
          ]
        : [...eventCountFields],
      defaultFields: rawTemplate
        ? [
            'cowNumber',
            'eventTypeLabel',
            'eventDate',
            'milkingShift',
            'parity',
            'currentParity',
            'parityCalvingDate',
            'operatorName',
            'description',
            'cost',
            'notes',
            'sourceTable',
            'sourceRecordId'
          ]
        : [...eventCountFields],
      filters: { eventTypes: [eventType.value] },
      period: { groupBy },
      aggregation,
      sortRules: rawTemplate
        ? [
            { field: 'eventDate', direction: 'desc' },
            { field: 'cowNumber', direction: 'asc' },
            { field: 'eventTypeLabel', direction: 'asc' }
          ]
        : [
            { field: 'value', direction: 'desc' },
            { field: 'period', direction: 'desc' },
            { field: 'cowNumber', direction: 'asc' }
          ],
      tone: eventTone(eventType.value),
      templateKind: 'event-count',
      templateGroup: '事件次数模板',
      eventType: eventType.value,
      templateKeywords: eventTemplateKeywords(eventType.value, eventType.label, groupBy),
      featured: isFeaturedEventTemplate(eventType.value, groupBy, aggregation)
    })
  }

  function makeExportStrategy(
    input: Partial<ExportStrategy> &
      Pick<ExportStrategy, 'id' | 'name' | 'description' | 'strategyType'>
  ): ExportStrategy {
    return {
      id: input.id,
      name: input.name,
      domain: input.domain || input.strategyType,
      description: input.description,
      strategyType: input.strategyType,
      builtin: input.builtin ?? true,
      fields: input.fields ? [...input.fields] : [],
      defaultFields: input.defaultFields ? [...input.defaultFields] : [...(input.fields || [])],
      filters: input.filters || {},
      period: input.period || { groupBy: 'raw' },
      aggregation: input.aggregation || 'raw',
      sortRules: normalizeSortRules(input.sortRules),
      format: input.format || 'xlsx',
      tone: input.tone || 'info',
      templateKind: input.templateKind,
      templateGroup: input.templateGroup,
      traitCode: input.traitCode,
      traitName: input.traitName,
      eventType: input.eventType,
      templateKeywords: input.templateKeywords ? [...input.templateKeywords] : [],
      presetCode: input.presetCode,
      featured: input.featured
    }
  }

  function matchesStrategyScope(strategy: ExportStrategy, scope: string) {
    if (scope === '全部') return true
    if (scope === '常用') return !!strategy.featured
    if (scope === '自建') return !strategy.builtin
    if (scope === '基础') return strategy.templateKind === 'base'
    if (scope === '次数模板')
      return (
        strategy.templateKind === 'event-count' ||
        (strategy.templateKind === 'trait-period' && strategy.aggregation === 'count')
      )
    if (scope === '性状模板') return strategy.templateKind === 'trait-period'
    if (scope === '泌乳模板')
      return (
        strategy.strategyType === 'milk-missing-review' ||
        (strategy.templateKind === 'trait-period' &&
          isMilkTrait(strategy.traitCode, strategy.templateGroup))
      )
    if (scope === '体尺模板')
      return (
        strategy.templateKind === 'trait-period' && str(strategy.templateGroup).includes('体尺')
      )
    return true
  }

  function strategyInitial(strategy: ExportStrategy) {
    if (strategy.templateKind === 'event-count') return '次'
    if (strategy.templateKind === 'trait-period') {
      if (strategy.aggregation === 'count') return '次'
      if (str(strategy.templateGroup).includes('繁殖')) return '繁'
      if (isMilkTrait(strategy.traitCode, strategy.templateGroup)) return '奶'
      if (str(strategy.templateGroup).includes('体尺')) return '尺'
      if (str(strategy.templateGroup).includes('健康')) return '康'
      return '型'
    }
    const initials: Record<StrategyType, string> = {
      'animal-profile': '档',
      'animal-events': '事',
      'phenotype-lactation': '型',
      'milk-missing-review': '缺',
      'breeding-dataset': '综'
    }
    return initials[strategy.strategyType]
  }

  function strategyEyebrow(strategy: ExportStrategy) {
    if (strategy.templateKind === 'trait-period')
      return `${strategy.templateGroup || '性状模板'} / ${strategy.traitName || '性状'}`
    if (strategy.templateKind === 'event-count')
      return `${strategy.templateGroup || '次数模板'} / ${eventTypeLabel(strategy.eventType)}`
    if (strategy.templateKind === 'base')
      return `基础导出 / ${strategyTypeLabel(strategy.strategyType)}`
    return strategyTypeLabel(strategy.strategyType)
  }

  function strategySourceText(strategy: ExportStrategy) {
    if (strategy.templateKind === 'trait-period') {
      if (str(strategy.templateGroup).includes('繁殖')) return '繁殖事件 / 事件间隔计算 / 系谱关联'
      return isMilkTrait(strategy.traitCode, strategy.templateGroup)
        ? '表型记录 / 奶厅记录 / 传感器记录'
        : '表型记录 / 人工采集 / 传感器记录'
    }
    if (strategy.templateKind === 'event-count')
      return '场内事件 / 繁殖 / 兽医 / 奶厅 / 饲喂 / 传感器'
    const sourceText: Record<StrategyType, string> = {
      'animal-profile': 'animal / cows / animal_parentage',
      'animal-events': 'animal_event / 场内事件表',
      'phenotype-lactation': 'trait_observation / milk_measurement',
      'milk-missing-review': 'milk_measurement / lactation_episode / data_quality_issue',
      'breeding-dataset': '档案 + 事件 + 表型 + 泌乳'
    }
    return sourceText[strategy.strategyType]
  }

  function strategyFieldPreview(strategy: ExportStrategy) {
    if (strategy.templateKind === 'trait-period') {
      return [
        strategy.traitName || '性状',
        groupByLabel(strategy.period.groupBy),
        strategy.aggregation === 'count' ? '次数' : aggregationLabel(strategy.aggregation)
      ]
    }
    if (strategy.templateKind === 'event-count') {
      return [
        eventTypeLabel(strategy.eventType),
        groupByLabel(strategy.period.groupBy),
        aggregationLabel(strategy.aggregation)
      ]
    }
    const columns = exportColumnsForStrategy(strategy, strategy.fields)
    const visibleCount = 3
    const preview = columns.slice(0, visibleCount).map((field) => field.label)
    return columns.length > visibleCount
      ? [...preview, `+${columns.length - visibleCount}`]
      : preview
  }

  function strategyAggregationText(strategy: ExportStrategy) {
    if (strategy.templateKind === 'trait-period')
      return strategy.aggregation === 'count' ? '次数' : aggregationLabel(strategy.aggregation)
    if (strategy.templateKind === 'event-count')
      return strategy.aggregation === 'raw' ? '明细' : '次数'
    return aggregationLabel(strategy.aggregation)
  }

  function traitTemplateName(
    trait: PhenotypeTraitDefinition,
    groupBy: GroupBy,
    aggregation: Aggregation
  ) {
    if (aggregation === 'count') return traitCountTemplateName(trait, groupBy)
    if (canonicalTraitCode(trait.code) === 'milk_yield')
      return milkYieldTemplateName(groupBy, aggregation)
    const baseName = traitDisplayName(trait)
    if (groupBy === 'raw') return `${baseName}原始明细`
    if (groupBy === 'lactation_305')
      return `305天${baseName}${aggregationBusinessLabel(aggregation)}`
    if (groupBy === 'cow' && aggregation === 'latest') return `${baseName}最新值`
    return `${groupByBusinessPrefix(groupBy)}${baseName}${aggregationBusinessLabel(aggregation)}`
  }

  function traitCountTemplateName(trait: PhenotypeTraitDefinition, groupBy: GroupBy) {
    const baseName = traitDisplayName(trait)
    const prefix = groupByBusinessPrefix(groupBy)
    if (canonicalTraitCode(trait.code) === 'milk_yield') {
      const names: Partial<Record<GroupBy, string>> = {
        day: '日采奶次数',
        week: '周采奶次数',
        ten_day: '旬采奶次数',
        half_month: '半月采奶次数',
        month: '月采奶次数',
        quarter: '季度采奶次数',
        half_year: '半年采奶次数',
        year: '年采奶次数',
        season: '季节采奶次数',
        parity: '每胎次采奶次数',
        lactation: '泌乳期采奶次数',
        lactation_305: '305天采奶次数',
        lactation_stage: '泌乳阶段采奶次数',
        dim_bucket: 'DIM分段采奶次数',
        reproduction_cycle: '繁殖周期采奶次数',
        pregnancy: '妊娠期采奶次数',
        dry_period: '干奶期采奶次数',
        herd_group: '牛群采奶次数',
        pen: '圈舍采奶次数',
        production_stage: '生产阶段采奶次数',
        milking_shift: '班次采奶次数',
        equipment: '设备采奶次数',
        collector: '采集人采奶次数',
        operator: '操作人采奶次数',
        cow: '单牛采奶次数',
        rolling_7: '7天采奶次数',
        rolling_30: '30天采奶次数',
        rolling_90: '90天采奶次数',
        custom_window: '自定义窗口采奶次数'
      }
      return names[groupBy] || `${prefix}采奶次数`
    }
    if (isMilkTrait(trait.code, trait.category)) return `${prefix}${baseName}检测次数`
    if (
      trait.category.includes('体尺') ||
      trait.category.includes('生长') ||
      canonicalTraitCode(trait.code) === 'body_weight'
    )
      return `${prefix}${baseName}测定次数`
    return `${prefix}${baseName}记录次数`
  }

  function milkYieldTemplateName(groupBy: GroupBy, aggregation: Aggregation) {
    if (groupBy === 'raw') return '产奶量原始明细'
    if (aggregation === 'sum') {
      const sumNames: Partial<Record<GroupBy, string>> = {
        day: '日产奶量',
        week: '周总产奶量',
        ten_day: '旬总产奶量',
        half_month: '半月总产奶量',
        month: '月总产奶量',
        quarter: '季度总产奶量',
        half_year: '半年总产奶量',
        year: '年总产奶量',
        season: '季节总产奶量',
        parity: '每胎次产奶量',
        lactation: '泌乳期总产奶量',
        lactation_305: '305天产奶量',
        lactation_stage: '泌乳阶段总产奶量',
        dim_bucket: 'DIM分段总产奶量',
        reproduction_cycle: '繁殖周期产奶量',
        pregnancy: '妊娠期产奶量',
        dry_period: '干奶期产奶量',
        herd_group: '牛群总产奶量',
        pen: '圈舍总产奶量',
        production_stage: '生产阶段总产奶量',
        milking_shift: '班次总产奶量',
        equipment: '设备总产奶量',
        collector: '采集人总产奶量',
        operator: '操作人总产奶量',
        cow: '单牛总产奶量',
        rolling_7: '7天总产奶量',
        rolling_30: '30天总产奶量',
        rolling_90: '90天总产奶量',
        custom_window: '自定义窗口总产奶量'
      }
      return sumNames[groupBy] || `${groupByBusinessPrefix(groupBy)}产奶量`
    }
    if (aggregation === 'avg') {
      const averageNames: Partial<Record<GroupBy, string>> = {
        day: '日产奶量平均',
        week: '周平均产奶量',
        ten_day: '旬平均产奶量',
        half_month: '半月平均产奶量',
        month: '月平均产奶量',
        quarter: '季度平均产奶量',
        half_year: '半年平均产奶量',
        year: '年平均产奶量',
        season: '季节平均产奶量',
        parity: '每胎次平均产奶量',
        lactation: '泌乳期平均产奶量',
        lactation_305: '305天平均产奶量',
        lactation_stage: '泌乳阶段平均产奶量',
        dim_bucket: 'DIM分段平均产奶量',
        herd_group: '牛群平均产奶量',
        pen: '圈舍平均产奶量',
        production_stage: '生产阶段平均产奶量',
        milking_shift: '班次平均产奶量',
        equipment: '设备平均产奶量',
        collector: '采集人平均产奶量',
        operator: '操作人平均产奶量',
        cow: '单牛平均产奶量'
      }
      return averageNames[groupBy] || `${groupByBusinessPrefix(groupBy)}产奶量平均`
    }
    if (groupBy === 'lactation_305') return `305天产奶量${aggregationBusinessLabel(aggregation)}`
    if (groupBy === 'cow' && aggregation === 'latest') return '单牛产奶量最新值'
    return `${groupByBusinessPrefix(groupBy)}产奶量${aggregationBusinessLabel(aggregation)}`
  }

  function eventCountTemplateName(eventType: string, label: string, groupBy: GroupBy) {
    const eventName = eventType === 'breeding' ? '配种/繁殖' : label
    if (groupBy === 'raw') return `${eventName}事件明细`
    if (groupBy === 'cow') return `单牛${eventName}次数`
    return `${groupByBusinessPrefix(groupBy)}${eventName}次数`
  }

  function traitTemplateKeywords(
    trait: PhenotypeTraitDefinition,
    groupBy: GroupBy,
    aggregation: Aggregation
  ) {
    const keywords = new Set(
      [
        trait.code,
        trait.name,
        trait.category,
        groupByLabel(groupBy),
        aggregationLabel(aggregation),
        traitTemplateName(trait, groupBy, aggregation)
      ].filter(Boolean)
    )
    if (canonicalTraitCode(trait.code) === 'milk_yield') {
      if (groupBy === 'day' && aggregation === 'sum')
        ['日产奶', '日产奶量', '日总产奶'].forEach((item) => keywords.add(item))
      if (groupBy === 'month' && aggregation === 'sum')
        ['月总产奶', '月总产奶量', '月产奶量', '月奶量'].forEach((item) => keywords.add(item))
      if (groupBy === 'year' && aggregation === 'sum')
        ['年总产奶', '年总产奶量', '年奶量'].forEach((item) => keywords.add(item))
      if (groupBy === 'lactation_305' && aggregation === 'sum')
        ['305天产奶', '305天产奶量', '305日产奶量', '305奶量'].forEach((item) => keywords.add(item))
      if (groupBy === 'parity' && aggregation === 'sum')
        ['胎次产奶', '每胎产奶', '每胎次产奶量'].forEach((item) => keywords.add(item))
      if (groupBy === 'lactation' && aggregation === 'sum')
        ['泌乳期产奶', '泌乳期总产奶'].forEach((item) => keywords.add(item))
      if (groupBy === 'equipment' && aggregation === 'sum')
        ['设备产奶', '设备总产奶', '设备总产奶量', '按设备产奶', '按设备产奶量'].forEach((item) =>
          keywords.add(item)
        )
      if (groupBy === 'equipment' && aggregation === 'avg')
        ['设备平均产奶', '设备平均产奶量', '按设备平均产奶'].forEach((item) => keywords.add(item))
      if (aggregation === 'avg') ['平均产奶', '平均产奶量'].forEach((item) => keywords.add(item))
      if (aggregation === 'count')
        ['采奶次数', '挤奶次数', '产奶记录次数'].forEach((item) => keywords.add(item))
    }
    if (aggregation === 'count') {
      ;[
        `${trait.name}次数`,
        `${trait.name}记录次数`,
        `${trait.name}采集次数`,
        `${trait.name}测定次数`,
        '测定次数',
        '采集次数',
        '记录次数'
      ].forEach((item) => keywords.add(item))
      if (trait.category.includes('体尺'))
        ['体尺测定次数', '体尺采集次数'].forEach((item) => keywords.add(item))
      if (trait.category.includes('泌乳'))
        ['奶质检测次数', 'DHI次数'].forEach((item) => keywords.add(item))
    }
    if (
      trait.category.includes('繁殖') ||
      eventIntervalTraitSpecs.some((spec) => spec.code === canonicalTraitCode(trait.code))
    ) {
      ;[
        '事件间隔',
        '繁殖间隔',
        '繁殖性状',
        '空怀天数',
        '产犊间隔',
        '首配间隔',
        '末次输精',
        '配种到产犊',
        '妊检间隔',
        '干奶到产犊'
      ].forEach((item) => keywords.add(item))
    }
    return Array.from(keywords)
  }

  function eventTemplateKeywords(eventType: string, label: string, groupBy: GroupBy) {
    const keywords = new Set(
      [
        eventType,
        label,
        groupByLabel(groupBy),
        eventCountTemplateName(eventType, label, groupBy)
      ].filter(Boolean)
    )
    if (groupBy !== 'raw') {
      ;[`${label}次数`, `${label}统计`, `${groupByBusinessPrefix(groupBy)}${label}次数`].forEach(
        (item) => keywords.add(item)
      )
    }
    const breedingLike = eventType === 'breeding' || eventType === 'insemination'
    if (breedingLike && groupBy !== 'raw') {
      ;['配种次数', '输精次数', '配种统计', '输精统计'].forEach((item) => keywords.add(item))
      if (groupBy === 'cow') ['单牛配种次数', '单牛输精次数'].forEach((item) => keywords.add(item))
      if (groupBy === 'parity')
        ['胎次配种次数', '每胎配种次数', '胎次输精次数'].forEach((item) => keywords.add(item))
      if (groupBy === 'reproduction_cycle')
        ['繁殖周期配种次数', '周期配种次数'].forEach((item) => keywords.add(item))
      if (groupBy === 'month') ['月配种次数', '月输精次数'].forEach((item) => keywords.add(item))
    }
    if (eventType === 'treatment' && groupBy !== 'raw') keywords.add('治疗次数')
    if (eventType === 'transfer' && groupBy !== 'raw') keywords.add('转群次数')
    if (eventType === 'milk_quality' && groupBy !== 'raw') keywords.add('奶质检测次数')
    if (eventType === 'dhi_test' && groupBy !== 'raw') keywords.add('DHI次数')
    if (eventType === 'sample_collection' && groupBy !== 'raw') keywords.add('采样次数')
    if (eventType === 'genotyping' && groupBy !== 'raw') keywords.add('基因分型次数')
    if (eventType === 'sequencing' && groupBy !== 'raw') keywords.add('测序次数')
    return Array.from(keywords)
  }

  function traitDisplayName(trait: PhenotypeTraitDefinition) {
    if (trait.code === 'milk_yield') return '产奶量'
    return trait.name.replace(/^单次/, '')
  }

  function groupByBusinessPrefix(groupBy: GroupBy) {
    const map: Record<GroupBy, string> = {
      raw: '',
      day: '日',
      week: '周',
      ten_day: '旬',
      half_month: '半月',
      month: '月',
      quarter: '季度',
      half_year: '半年',
      year: '年',
      season: '季节',
      parity: '每胎次',
      parity_calving_date: '本胎产犊时间',
      lactation: '泌乳期',
      lactation_305: '305天',
      lactation_stage: '泌乳阶段',
      dim_bucket: 'DIM分段',
      reproduction_cycle: '繁殖周期',
      pregnancy: '妊娠期',
      dry_period: '干奶期',
      herd_group: '牛群',
      pen: '圈舍',
      production_stage: '生产阶段',
      milking_shift: '班次',
      equipment: '设备',
      collector: '采集人',
      operator: '操作人',
      cow: '单牛',
      rolling_7: '7天',
      rolling_30: '30天',
      rolling_90: '90天',
      custom_window: '自定义窗口'
    }
    return map[groupBy]
  }

  function aggregationBusinessLabel(aggregation: Aggregation) {
    const map: Record<Aggregation, string> = {
      raw: '',
      count: '记录次数',
      sum: '合计',
      avg: '平均',
      min: '最小值',
      max: '最大值',
      median: '中位数',
      latest: '最新值'
    }
    return map[aggregation]
  }

  function isFeaturedTraitTemplate(
    trait: PhenotypeTraitDefinition,
    groupBy: GroupBy,
    aggregation: Aggregation
  ) {
    const code = canonicalTraitCode(trait.code)
    const featuredPairs = new Set([
      'milk_yield:day:sum',
      'milk_yield:week:sum',
      'milk_yield:month:sum',
      'milk_yield:month:avg',
      'milk_yield:quarter:sum',
      'milk_yield:year:sum',
      'milk_yield:parity:sum',
      'milk_yield:lactation:sum',
      'milk_yield:lactation_305:sum',
      'milk_yield:herd_group:avg',
      'milk_yield:pen:avg',
      'milk_yield:equipment:sum',
      'milk_yield:equipment:avg',
      'milk_fat:month:avg',
      'milk_fat:quarter:avg',
      'milk_protein:month:avg',
      'milk_protein:quarter:avg',
      'milk_lactose:month:avg',
      'somatic_cell_count:month:avg',
      'somatic_cell_count:quarter:avg',
      'body_weight:cow:latest',
      'body_weight:week:avg',
      'body_weight:month:avg',
      'body_weight:production_stage:avg',
      'body_temperature:day:avg',
      'daily_steps:day:sum',
      'daily_steps:rolling_7:avg',
      'daily_steps:rolling_30:avg',
      'calving_interval_days:cow:avg',
      'calving_interval_days:parity:avg',
      'last_insemination_to_calving_days:cow:latest',
      'last_insemination_to_calving_days:parity:avg',
      'calving_to_first_insemination_days:cow:latest',
      'calving_to_first_insemination_days:parity:avg',
      'insemination_to_pregnancy_check_days:cow:latest',
      'dry_off_to_calving_days:cow:latest'
    ])
    if (featuredPairs.has(`${code}:${groupBy}:${aggregation}`)) return true
    if (
      aggregation === 'count' &&
      ['milk_yield', 'somatic_cell_count', 'body_weight', 'daily_steps'].includes(code) &&
      ['day', 'week', 'month', 'lactation_305', 'cow', 'equipment'].includes(groupBy)
    )
      return true
    if (
      aggregation === 'count' &&
      trait.category === '体尺性状' &&
      ['month', 'cow', 'collector'].includes(groupBy)
    )
      return true
    return trait.category === '体尺性状' && groupBy === 'cow' && aggregation === 'latest'
  }

  function isFeaturedEventTemplate(eventType: string, groupBy: GroupBy, aggregation: Aggregation) {
    if (aggregation !== 'count') return false
    return (
      [
        'breeding:parity',
        'breeding:cow',
        'breeding:reproduction_cycle',
        'breeding:month',
        'heat:month',
        'insemination:parity',
        'insemination:cow',
        'insemination:reproduction_cycle',
        'insemination:month',
        'pregnancy_check:reproduction_cycle',
        'pregnancy_check:month',
        'calving:year',
        'calving:parity',
        'abortion:year',
        'dry_off:month',
        'veterinary:month',
        'diagnosis:month',
        'treatment:month',
        'medication:month',
        'vaccination:year',
        'hoof_trim:quarter',
        'transfer:month',
        'exit:year',
        'entry:year',
        'milking:day',
        'milking_session:day',
        'milking_session:month',
        'dhi_test:month',
        'feed_delivery:day',
        'feeding:day'
      ].includes(`${eventType}:${groupBy}`) ||
      (['mating_plan', 'semen_check', 'embryo_transfer', 'postpartum_check'].includes(eventType) &&
        ['cow', 'month', 'parity', 'reproduction_cycle'].includes(groupBy)) ||
      (['milk_quality', 'dhi_test', 'milking_session'].includes(eventType) &&
        ['day', 'month', 'cow', 'equipment'].includes(groupBy)) ||
      (['sample_collection', 'genotyping', 'sequencing', 'omics_assay'].includes(eventType) &&
        ['month', 'cow', 'operator'].includes(groupBy)) ||
      (['deworming', 'quarantine', 'disinfection', 'lab_test', 'mastitis_check'].includes(
        eventType
      ) &&
        ['month', 'quarter', 'cow', 'operator'].includes(groupBy))
    )
  }

  function defaultValueSortDirection(
    trait: PhenotypeTraitDefinition,
    aggregation: Aggregation
  ): SortDirection {
    if (aggregation === 'min') return 'asc'
    if (canonicalTraitCode(trait.code) === 'somatic_cell_count') return 'asc'
    return 'desc'
  }

  function traitTone(trait: PhenotypeTraitDefinition) {
    if (isMilkTrait(trait.code, trait.category)) return 'warning'
    if (trait.category.includes('体尺') || trait.category.includes('生长')) return 'teal'
    if (trait.category.includes('健康') || trait.category.includes('繁殖')) return 'danger'
    return 'info'
  }

  function eventTone(eventType: string) {
    if (
      [
        'breeding',
        'mating_plan',
        'heat',
        'insemination',
        'semen_check',
        'embryo_transfer',
        'pregnancy_check',
        'calving',
        'postpartum_check',
        'abortion',
        'dry_off'
      ].includes(eventType)
    )
      return 'warning'
    if (
      [
        'veterinary',
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
        'death',
        'exit',
        'sensor_alert'
      ].includes(eventType)
    )
      return 'danger'
    if (
      [
        'transfer',
        'entry',
        'feeding',
        'feed_delivery',
        'feed_adjustment',
        'feed_intake',
        'water_intake',
        'device_maintenance'
      ].includes(eventType)
    )
      return 'teal'
    return 'info'
  }

  function isMilkTrait(code?: unknown, group?: unknown) {
    const text = `${canonicalTraitCode(code)} ${str(group)}`.toLowerCase()
    return (
      text.includes('milk') ||
      text.includes('somatic_cell') ||
      text.includes('泌乳') ||
      text.includes('奶')
    )
  }

  function canonicalTraitCode(value: unknown) {
    const code = str(value).toLowerCase()
    const alias: Record<string, string> = {
      fat_rate: 'milk_fat',
      fat_percent: 'milk_fat',
      milk_fat_rate: 'milk_fat',
      protein_rate: 'milk_protein',
      protein_percent: 'milk_protein',
      milk_protein_rate: 'milk_protein',
      lactose_rate: 'milk_lactose',
      lactose_percent: 'milk_lactose',
      milk_lactose_rate: 'milk_lactose',
      scc: 'somatic_cell_count'
    }
    return alias[code] || code
  }

  function sanitizeKey(value: unknown) {
    return (
      str(value)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'item'
    )
  }

  function strategySortText(strategy: ExportStrategy) {
    const count = strategy.sortRules.filter((rule) => rule.field).length
    return count ? `${count} 级` : '未设'
  }

  function defaultFilters(): FilterState {
    return {
      cowNumber: '',
      breeds: [],
      statuses: [],
      pens: [],
      genders: [],
      eventTypes: [],
      traitCategories: [],
      traitCodes: [],
      dateRange: [],
      paritySelections: [],
      parityMin: null,
      parityMax: null,
      dimMin: null,
      dimMax: null,
      numericField: '',
      numericOperator: 'gte',
      numericValue: null,
      numericMin: null,
      numericMax: null,
      expectedShifts: []
    }
  }

  function defaultSortRules(): SortRule[] {
    return [
      { field: '', direction: 'desc' },
      { field: '', direction: 'desc' },
      { field: '', direction: 'desc' }
    ]
  }

  async function loadPageData() {
    await Promise.all([
      loadCustomStrategies(),
      loadStoredTraitDefinitions(),
      loadLogicalTraitRules()
    ])
    void loadReferenceRows()
  }

  async function loadStoredTraitDefinitions() {
    const rows = await readTableSafe('phenotype-trait-definitions')
    storedTraitDefinitions.value = rows
      .map((row: any) => normalizeTemplateTrait(row))
      .filter(Boolean) as PhenotypeTraitDefinition[]
  }

  async function loadLogicalTraitRules() {
    const rows = await readTableSafe('logical-trait-rules')
    storedLogicalTraitRules.value = rows
      .map((row: any) => normalizeLogicalTraitRule(row))
      .filter(Boolean) as LogicalTraitRule[]
  }

  async function loadCustomStrategies() {
    const rows = await readTableSafe('export-configs')
    customStrategies.value = rows
      .filter((row: any) => exportConfigScope(row) === 'information-export')
      .map(mapConfigRowToStrategy)
      .filter(Boolean) as ExportStrategy[]
  }

  function exportConfigScope(row: any) {
    const payload = parseObject(row?.payload)
    return str(row?.scope || payload.scope)
  }

  async function loadReferenceRows() {
    referenceRowsLoading.value = true
    const [animals, cows, parityEpisodes, traits, categories, farmUnits] = await Promise.all([
      readTableSafe('animal'),
      readTableSafe('cows'),
      readTableSafe('parity_episode'),
      readTableSafe('trait_definition'),
      readTableSafe('trait_category'),
      readTableSafe('farm_unit')
    ]).finally(() => {
      referenceRowsLoading.value = false
    })
    rebuildFarmUnitDisplayMap(farmUnits)
    const paritySummary = buildParitySummaryResolver(parityEpisodes)
    const categoryById = new Map(
      categories.map((row: any) => [str(row.id), str(row.name || row.code)])
    )
    const animalRows = (animals.length ? animals : cows).map((row: any) => {
      const animalId = animalIdOf(row)
      const animalNumber = animalNumberOf(row)
      const parityInfo = paritySummary.resolve(animalId, animalNumber)
      return {
        id: animalId || animalNumber,
        animalId,
        cowId: animalId,
        cowNumber: animalNumber,
        breed: breedFieldValue(row),
        gender: str(row.sex || row.gender),
        currentPen: str(
          row.currentPen ||
            row.current_pen ||
            row.currentPenId ||
            row.current_pen_id ||
            row.currentUnitId ||
            row.current_unit_id
        ),
        status: str(row.status),
        parity: numberOrBlank(parityValueOf(row) ?? parityInfo?.parity),
        currentParity: numberOrBlank(currentParityValueOf(row) ?? parityInfo?.parity),
        parityCalvingDate: str(parityCalvingDateOf(row) || parityInfo?.startDate),
        datasetDomain: '个体档案',
        sourceTable: animals.length ? 'animal' : 'cows',
        sourceRecordId: animalId || animalNumber
      }
    })
    const dictionaryTraitRows = [
      ...traits.map((row: any) => ({
        id: str(row.id || row.code),
        category:
          categoryById.get(str(row.categoryId || row.category_id)) ||
          str(row.category || row.traitCategory || row.trait_category || row.traitType || '表型记录'),
        traitCode: str(row.code || row.traitCode || row.trait_code || row.id),
        traitName: str(row.name || row.traitName || row.trait_name || row.code),
        unit: str(row.unit),
        datasetDomain: '表型与泌乳',
        sourceTable: 'trait_definition',
        sourceRecordId: str(row.id || row.code)
      })),
      ...storedTraitDefinitions.value.map((trait) => ({
        id: str(trait.id || trait.code),
        category: str(trait.category || '表型记录'),
        traitCode: str(trait.code),
        traitName: str(trait.name || trait.code),
        unit: str(trait.unit),
        datasetDomain: '表型与泌乳',
        sourceTable: 'phenotype-trait-definitions',
        sourceRecordId: str(trait.id || trait.code)
      })),
      ...logicalTraitDefinitions.value.map((trait) => ({
        id: str(trait.id || trait.code),
        category: str(trait.category || '逻辑性状'),
        traitCode: str(trait.code),
        traitName: str(trait.name || trait.code),
        unit: str(trait.unit),
        datasetDomain: '表型与泌乳',
        sourceTable: 'logical-trait-rules',
        sourceRecordId: str(trait.id || trait.code)
      }))
    ].filter((row) => canonicalTraitCode(row.traitCode))
    referenceRows.value = dedupeReferenceRows([...animalRows, ...dictionaryTraitRows])
  }

  function dedupeReferenceRows(rows: ExportRow[]) {
    const seen = new Set<string>()
    return rows.filter((row) => {
      const traitCode = canonicalTraitCode(row.traitCode)
      const key = traitCode
        ? `trait:${traitCode}`
        : `animal:${str(row.cowId || row.animalId)}:${str(row.cowNumber)}`
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  function openStrategyConfig(strategy: ExportStrategy) {
    selectedStrategy.value = cloneStrategy(strategy)
    applyStrategyToConfig(selectedStrategy.value)
    clearPreviewRows()
    configDrawerVisible.value = true
  }

  function openStrategyFromRoute() {
    const code = str(route.query.strategy || route.query.strategyType || route.query.strategyId)
    if (!code) return
    const matched = allStrategies.value.find(
      (strategy) =>
        strategy.id === code ||
        strategy.strategyType === code ||
        strategy.traitCode === code ||
        strategy.name === code
    )
    if (matched) openStrategyConfig(matched)
  }

  function applyStrategyToConfig(strategy: ExportStrategy) {
    const initialFields =
      strategy.builtin && strategy.defaultFields.length ? strategy.defaultFields : strategy.fields
    configForm.fields = normalizedFieldsForConfig(strategy, initialFields)
    configForm.format = strategy.format || 'xlsx'
    configForm.filters = { ...defaultFilters(), ...normalizedFiltersForStrategy(strategy) }
    if (isTraitStrategy(strategy)) {
      configForm.filters.traitCodes = normalizeTraitCodeList(configForm.filters.traitCodes)
      if (!configForm.filters.traitCodes.length && strategy.traitCode) {
        configForm.filters.traitCodes = [canonicalTraitCode(strategy.traitCode)]
      }
    }
    configForm.period = { groupBy: strategy.period?.groupBy || 'raw' }
    configForm.aggregation = strategy.aggregation || 'raw'
    configForm.sortRules = normalizeSortRules(strategy.sortRules)
    previewSortRules.value = []
    ensureFieldGroupExpanded()
  }

  function clearPreviewRows() {
    fullPreviewRows.value = []
    totalRows.value = 0
    previewSignature.value = ''
    resetPreviewRows()
  }

  function currentPreviewSignature() {
    return JSON.stringify({
      strategyId: selectedStrategy.value?.id || '',
      presetCode: leaderMilkPresetCode(selectedStrategy.value),
      fields: [...configForm.fields],
      filters: { ...configForm.filters },
      period: { ...configForm.period },
      aggregation: configForm.aggregation,
      sortRules: activeExportSortRules(),
      format: configForm.format
    })
  }

  function openCreateStrategy() {
    strategyDialogMode.value = 'create'
    editingStrategyId.value = ''
    strategyForm.name = ''
    strategyForm.strategyType = 'animal-profile'
    strategyForm.description = ''
    strategyDialogVisible.value = true
  }

  function openRenameStrategy(strategy: ExportStrategy) {
    strategyDialogMode.value = 'rename'
    editingStrategyId.value = strategy.id
    strategyForm.name = strategy.name
    strategyForm.strategyType = strategy.strategyType
    strategyForm.description = strategy.description
    strategyDialogVisible.value = true
  }

  async function saveStrategyDialog() {
    const name = strategyForm.name.trim()
    if (!name) {
      ElMessage.warning('请填写策略名称')
      return
    }
    if (strategyDialogMode.value === 'rename') {
      const strategy = customStrategies.value.find((item) => item.id === editingStrategyId.value)
      if (!strategy) return
      strategy.name = name
      strategy.description = strategyForm.description.trim()
      await persistStrategy(strategy)
      strategyDialogVisible.value = false
      ElMessage.success('策略已更新')
      await loadCustomStrategies()
      return
    }

    const base =
      builtinStrategies.find((item) => item.strategyType === strategyForm.strategyType) ||
      builtinStrategies[0]
    const next: ExportStrategy = {
      ...cloneStrategy(base),
      id: makeId('info-export-strategy'),
      name,
      description: strategyForm.description.trim() || base.description,
      builtin: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      operatorName: getOperator()
    }
    await persistStrategy(next)
    strategyDialogVisible.value = false
    await loadCustomStrategies()
    const created = customStrategies.value.find((item) => item.id === next.id) || next
    openStrategyConfig(created)
    ElMessage.success('策略已创建')
  }

  async function duplicateStrategy(strategy: ExportStrategy) {
    const copy: ExportStrategy = {
      ...cloneStrategy(strategy),
      id: makeId('info-export-strategy'),
      name: `${strategy.name} 副本`,
      builtin: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      operatorName: getOperator()
    }
    await persistStrategy(copy)
    await loadCustomStrategies()
    ElMessage.success('已复制为自建策略')
  }

  async function deleteCustomStrategy(strategy: ExportStrategy) {
    await ElMessageBox.confirm(`确认删除“${strategy.name}”？`, '删除导出策略', { type: 'warning' })
    await databaseService.deleteTableRecordAsync('export-configs', strategy.id)
    if (selectedStrategy.value?.id === strategy.id) {
      selectedStrategy.value = null
      configDrawerVisible.value = false
    }
    await loadCustomStrategies()
    ElMessage.success('策略已删除')
  }

  async function saveCurrentStrategy() {
    if (!selectedStrategy.value) return
    if (!configForm.fields.length) {
      ElMessage.warning('请至少选择一个字段')
      return
    }
    const next: ExportStrategy = {
      ...selectedStrategy.value,
      id: selectedStrategy.value.builtin
        ? makeId('info-export-strategy')
        : selectedStrategy.value.id,
      name: selectedStrategy.value.builtin
        ? `${selectedStrategy.value.name} 自建`
        : selectedStrategy.value.name,
      builtin: false,
      fields: [...configForm.fields],
      filters: { ...configForm.filters },
      period: { ...configForm.period },
      aggregation: configForm.aggregation,
      sortRules: normalizeSortRules(activeExportSortRules()),
      format: configForm.format,
      updatedAt: new Date().toISOString(),
      operatorName: getOperator()
    }
    if (!next.createdAt) next.createdAt = new Date().toISOString()
    await persistStrategy(next)
    await loadCustomStrategies()
    selectedStrategy.value = cloneStrategy(next)
    ElMessage.success('策略已保存')
  }

  async function generatePreview() {
    if (!selectedStrategy.value) return
    if (!configForm.fields.length) {
      ElMessage.warning('请至少选择一个字段')
      return
    }
    if (isTraitStrategy(selectedStrategy.value) && !selectedTraitCodes.value.length) {
      ElMessage.warning('请至少选择一个导出性状')
      return
    }
    previewLoading.value = true
    try {
      const signature = currentPreviewSignature()
      const rows = await buildRowsForStrategy(selectedStrategy.value)
      const filtered = applyFilters(rows)
      const isLeaderMilkPreset = Boolean(leaderMilkPresetCode(selectedStrategy.value))
      const aggregated = isLeaderMilkPreset || usesPreAggregatedFacts(filtered)
        ? filtered
        : aggregateRows(filtered, selectedStrategy.value)
      const prepared = applyPostPreviewFilters(
        preparePreviewRows(aggregated, selectedStrategy.value)
      )
      const sorted = applySort(prepared, activeExportSortRules())
      fullPreviewRows.value = sorted
      resetPreviewRows()
      totalRows.value = sorted.length
      previewSignature.value = signature
      ElMessage.success(`已生成 ${sorted.length} 行预览数据`)
    } catch (error) {
      console.error(error)
      ElMessage.error('生成预览失败')
    } finally {
      previewLoading.value = false
    }
  }

  function usesPreAggregatedFacts(rows: ExportRow[]) {
    return (
      rows.length > 0 &&
      rows.every((row) =>
        ['fact_lactation_305', 'fact_cow_trait_parity'].includes(str(row.sourceTable))
      )
    )
  }

  async function exportCurrentRows() {
    if (!selectedStrategy.value) return
    if (previewLoading.value) {
      ElMessage.warning('预览正在生成，请稍后再导出')
      return
    }
    if (!fullPreviewRows.value.length || previewSignature.value !== currentPreviewSignature()) {
      await generatePreview()
    }
    if (!fullPreviewRows.value.length) {
      ElMessage.warning('当前筛选条件下暂无可导出数据')
      return
    }
    exportLoading.value = true
    const startedAt = new Date().toISOString()
    try {
      const exportRows = fullPreviewRows.value.map((row) => rowWithLabels(row))
      const timestamp = formatTimestamp(new Date())
      const fileName = `信息导出_${safeFileName(selectedStrategy.value.name)}_${timestamp}.${configForm.format}`
      const checksum = await hashPayload(
        JSON.stringify({ fileName, exportRows, parameters: buildExportParameters() })
      )
      if (configForm.format === 'csv') {
        downloadCsv(fileName, exportRows)
      } else {
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows), '信息导出')
        XLSX.writeFile(workbook, fileName)
      }
      await writeAuditLog(fileName, fullPreviewRows.value, exportRows, checksum, startedAt)
      ElMessage.success('导出完成')
    } catch (error) {
      console.error(error)
      ElMessage.error('导出失败')
    } finally {
      exportLoading.value = false
    }
  }

  function selectAllFields() {
    configForm.fields = normalizeExportFieldKeys(
      selectedStrategy.value,
      activeFieldDefs.value.map((field) => field.key)
    )
    prunePreviewSortRules()
  }

  function invertFields() {
    const selected = new Set(configForm.fields)
    configForm.fields = normalizeExportFieldKeys(
      selectedStrategy.value,
      activeFieldDefs.value
      .map((field) => field.key)
      .filter((key) => !selected.has(key))
    )
    prunePreviewSortRules()
  }

  function resetFields() {
    if (!selectedStrategy.value) return
    configForm.fields = normalizedFieldsForConfig(
      selectedStrategy.value,
      selectedStrategy.value.defaultFields
    )
    prunePreviewSortRules()
  }

  function sortPriority(field: string) {
    const index = activePreviewSortRules.value.findIndex((rule) => rule.field === field)
    return index >= 0 ? index + 1 : 0
  }

  function sortDirectionFor(field: string) {
    return activePreviewSortRules.value.find((rule) => rule.field === field)?.direction || ''
  }

  function setColumnSort(field: string, direction: SortDirection) {
    const nextRules = activePreviewSortRules.value.map((rule) => ({ ...rule }))
    const existing = nextRules.find((rule) => rule.field === field)
    if (existing) {
      existing.direction = direction
    } else {
      nextRules.push({ field, direction })
    }
    previewSortRules.value = nextRules
    refreshPreviewSort()
  }

  function clearColumnSort(field: string) {
    if (!sortPriority(field)) return
    previewSortRules.value = activePreviewSortRules.value.filter((rule) => rule.field !== field)
    refreshPreviewSort()
  }

  function refreshPreviewSort() {
    if (!fullPreviewRows.value.length) return
    const sorted = applySort(fullPreviewRows.value, activeExportSortRules())
    fullPreviewRows.value = sorted
    previewSignature.value = currentPreviewSignature()
    resetPreviewRows()
  }

  function activeExportSortRules() {
    const rules = activePreviewSortRules.value.length
      ? activePreviewSortRules.value
      : configForm.sortRules
    return normalizeActiveSortRules(rules)
  }

  function prunePreviewSortRules() {
    const selectedFields = new Set(previewColumns.value.map((field) => field.key))
    previewSortRules.value = previewSortRules.value.filter((rule) => selectedFields.has(rule.field))
  }

  function _addSortRule() {
    configForm.sortRules.push({ field: '', direction: 'desc' })
  }

  function _removeSortRule(index: number) {
    if (configForm.sortRules.length <= 3) return
    configForm.sortRules.splice(index, 1)
  }

  async function persistStrategy(strategy: ExportStrategy) {
    const row = strategyToConfigRow(strategy)
    const rows = await readTableSafe('export-configs')
    const exists = rows.some((item: any) => String(item.id || '') === strategy.id)
    if (exists) {
      await databaseService.updateTableRecordAsync('export-configs', strategy.id, row)
    } else {
      await databaseService.addTableDataAsync('export-configs', row)
    }
  }

  function strategyToConfigRow(strategy: ExportStrategy) {
    const fields = normalizedFieldsForConfig(strategy, strategy.fields)
    const defaultFields = normalizedFieldsForConfig(strategy, strategy.defaultFields)
    const filtersForSave = normalizedFiltersForStrategy(strategy, fields)
    const saveStrategy = { ...strategy, fields, defaultFields, filters: filtersForSave }
    const traitColumns = traitColumnsForStrategy(saveStrategy, fields)
    const filters = {
      description: strategy.description,
      strategyType: strategy.strategyType,
      fields,
      defaultFields,
      filters: filtersForSave,
      traitColumns: traitColumns.map((field) => ({
        field: field.key,
        label: field.label,
        format: field.type || 'number'
      })),
      period: strategy.period,
      aggregation: strategy.aggregation,
      sortRules: strategy.sortRules,
      format: strategy.format,
      tone: strategy.tone,
      templateKind: strategy.templateKind,
      templateGroup: strategy.templateGroup,
      traitCode: strategy.traitCode,
      traitName: strategy.traitName,
      eventType: strategy.eventType,
      templateKeywords: strategy.templateKeywords,
      presetCode: strategy.presetCode,
      featured: strategy.featured
    }
    return {
      id: strategy.id,
      name: strategy.name,
      scope: 'information-export',
      targetType: strategy.strategyType,
      groupBy: strategy.period.groupBy === 'raw' ? 'none' : strategy.period.groupBy,
      aggregations:
        strategy.aggregation === 'raw'
          ? []
          : [
              {
                field: 'value',
                functions: [strategy.aggregation],
                label: aggregationLabel(strategy.aggregation)
              }
            ],
      columns: exportColumnsForStrategy(saveStrategy, fields).map((field) => ({
        field: field.key,
        label: field.label,
        visible: true,
        format: field.type || 'text'
      })),
      filters,
      format: strategy.format,
      createdAt: strategy.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  function mapConfigRowToStrategy(row: any): ExportStrategy | null {
    const payload = normalizeExportConfigPayload(row)
    const strategyType = normalizeStrategyType(
      payload.strategyType || row.targetType || row.target_type
    )
    const base = builtinStrategies.find((item) => item.strategyType === strategyType)
    if (!base) return null
    const columns = parseArray(row.columns)
    const payloadFields = stringArray(payload.fields)
    const columnFields = visibleColumnFields(columns)
    const fields = payloadFields.length ? payloadFields : columnFields
    const defaultFields = stringArray(payload.defaultFields)
    const restoredFilters = parseObject(payload.filters)
    const restoredTraitCodes =
      strategyType === 'phenotype-lactation'
        ? traitCodesFromPersistedConfig(fields, columns, payload, restoredFilters, base)
        : []
    if (restoredTraitCodes.length) {
      restoredFilters.traitCodes = restoredTraitCodes
      if (restoredFilters.numericField === 'value')
        restoredFilters.numericField = traitValueKey(restoredTraitCodes[0])
    }
    const strategy: ExportStrategy = {
      ...cloneStrategy(base),
      id: String(row.id || makeId('info-export-strategy')),
      name: String(row.name || base.name),
      description: String(payload.description || base.description),
      strategyType,
      builtin: false,
      fields: fields.length ? fields : [...base.fields],
      defaultFields: defaultFields.length ? defaultFields : [...base.defaultFields],
      filters: restoredFilters,
      period: { groupBy: normalizeGroupBy(payload.period?.groupBy || row.groupBy || row.group_by) },
      aggregation: normalizeAggregation(payload.aggregation),
      sortRules: normalizeSortRules(payload.sortRules || base.sortRules),
      format: normalizeFormat(payload.format || row.format),
      tone: String(payload.tone || base.tone),
      templateKind: normalizeTemplateKind(payload.templateKind),
      templateGroup: str(payload.templateGroup),
      traitCode: restoredTraitCodes[0] || canonicalTraitCode(payload.traitCode),
      traitName: str(payload.traitName),
      eventType: str(payload.eventType),
      templateKeywords: Array.isArray(payload.templateKeywords)
        ? payload.templateKeywords.map(String)
        : [],
      presetCode: str(payload.presetCode),
      featured: Boolean(payload.featured),
      createdAt: String(row.createdAt || row.created_at || ''),
      updatedAt: String(row.updatedAt || row.updated_at || ''),
      operatorName: String(row.operatorName || row.operator_name || '')
    }
    strategy.fields = normalizedFieldsForConfig(strategy, strategy.fields)
    strategy.defaultFields = normalizedFieldsForConfig(strategy, strategy.defaultFields)
    strategy.filters = normalizedFiltersForStrategy(strategy, strategy.fields)
    return strategy
  }

  function normalizeExportConfigPayload(row: any): Record<string, any> {
    const fullPayload = parseObject(row.payload)
    const nestedFilters = parseObject(fullPayload.filters)
    const rowFilters = parseObject(row.filters)
    if (Object.keys(fullPayload).length) {
      return {
        ...fullPayload,
        ...nestedFilters,
        filters: parseObject(nestedFilters.filters || fullPayload.filters?.filters),
        fields: fullPayload.fields || nestedFilters.fields,
        defaultFields: fullPayload.defaultFields || nestedFilters.defaultFields,
        period: fullPayload.period || nestedFilters.period || { groupBy: fullPayload.groupBy },
        aggregation: fullPayload.aggregation || nestedFilters.aggregation,
        sortRules: fullPayload.sortRules || nestedFilters.sortRules,
        format: fullPayload.format || nestedFilters.format,
        tone: fullPayload.tone || nestedFilters.tone,
        templateKind: fullPayload.templateKind || nestedFilters.templateKind,
        templateGroup: fullPayload.templateGroup || nestedFilters.templateGroup,
        traitCode: fullPayload.traitCode || nestedFilters.traitCode,
        traitName: fullPayload.traitName || nestedFilters.traitName,
        eventType: fullPayload.eventType || nestedFilters.eventType,
        templateKeywords: fullPayload.templateKeywords || nestedFilters.templateKeywords,
        presetCode: fullPayload.presetCode || nestedFilters.presetCode
      }
    }
    if (Object.keys(rowFilters).length) {
      return {
        ...row,
        ...rowFilters,
        filters: parseObject(rowFilters.filters),
        fields: row.fields || rowFilters.fields,
        defaultFields: row.defaultFields || rowFilters.defaultFields,
        period: row.period || rowFilters.period || { groupBy: row.groupBy || row.group_by },
        aggregation: row.aggregation || rowFilters.aggregation,
        sortRules: row.sortRules || rowFilters.sortRules,
        format: row.format || rowFilters.format,
        tone: row.tone || rowFilters.tone,
        templateKind: row.templateKind || rowFilters.templateKind,
        templateGroup: row.templateGroup || rowFilters.templateGroup,
        traitCode: row.traitCode || rowFilters.traitCode,
        traitName: row.traitName || rowFilters.traitName,
        eventType: row.eventType || rowFilters.eventType,
        templateKeywords: row.templateKeywords || rowFilters.templateKeywords,
        presetCode: row.presetCode || rowFilters.presetCode
      }
    }
    return row
  }

  async function buildRowsForStrategy(strategy: ExportStrategy): Promise<ExportRow[]> {
    const preset = leaderMilkPresetCode(strategy)
    if (preset === 'missing-review') return buildMilkMissingReviewRows()
    if (preset === 'cow-period-profile')
      return buildLeaderCowPeriodProfileRows(strategy)
    if (preset) return buildLeaderMilkPresetRows(strategy)
    if (strategy.strategyType === 'animal-profile') return buildAnimalRows()
    if (strategy.strategyType === 'animal-events') return buildEventRows()
    if (strategy.strategyType === 'milk-missing-review') return buildMilkMissingReviewRows()
    if (strategy.strategyType === 'phenotype-lactation') {
      const presetRows = await buildLeaderMilkPresetRows(strategy)
      if (presetRows.length) return presetRows
      const factRows = await buildFactRowsForTraitStrategy(strategy)
      if (factRows.length) return factRows
      return buildPhenotypeRows()
    }
    const [animals, events, phenotypes] = await Promise.all([
      buildAnimalRows(),
      buildEventRows(),
      buildPhenotypeRows()
    ])
    return [
      ...animals.map((row) => ({
        ...row,
        datasetDomain: '个体档案',
        cowId: str(row.animalId || row.cowId),
        sourceRecordIds: [row.sourceTable, row.sourceRecordId].filter(Boolean).join(':')
      })),
      ...events.map((row) => ({
        ...row,
        datasetDomain: '事件记录',
        sourceRecordIds: [row.sourceTable, row.sourceRecordId].filter(Boolean).join(':')
      })),
      ...phenotypes.map((row) => ({
        ...row,
        datasetDomain: '表型与泌乳',
        sourceTable: row.sourceTable || 'trait_observation'
      }))
    ]
  }

  async function buildMilkMissingReviewRows(): Promise<ExportRow[]> {
    const [startDate, endDate] =
      configForm.filters.dateRange.length === 2
        ? configForm.filters.dateRange
        : defaultMilkMissingReviewDateRange()
    const result = await getMilkMissingReview({
      startDate,
      endDate,
      period: 'day',
      expectedShifts: milkMissingReviewExpectedShifts()
    })
    return result.items.map((item) => normalizeMilkMissingReviewRow(item))
  }

  function milkMissingReviewExpectedShifts() {
    const shifts = Array.isArray(configForm.filters.expectedShifts)
      ? configForm.filters.expectedShifts.map((shift) => str(shift)).filter(Boolean)
      : []
    return shifts.length ? Array.from(new Set(shifts)) : ['早班', '晚班']
  }

  function normalizeMilkMissingReviewRow(item: MilkMissingReviewItem): ExportRow {
    return {
      id: item.id,
      cowId: item.cowId,
      cowNumber: item.cowNumber,
      cowName: item.cowName,
      breed: item.breed,
      currentPen: '',
      parity: item.parityNo,
      currentParity: item.parityNo,
      parityCalvingDate: item.lactationStartDate,
      lactationStartDate: item.lactationStartDate,
      lactationEndDate: item.lactationEndDate,
      collectionDate: item.date,
      firstDate: item.date,
      lastDate: item.date,
      period: item.date,
      daysInMilk: item.dim,
      milkingShift: item.expectedShift,
      missingKind: milkMissingKindLabel(item.missingKind),
      existingShiftCount: item.existingShiftCount,
      existingDailyMilk: item.existingDailyMilk,
      recommendedMilk: item.recommendedMilk,
      recommendationMethod: milkMissingMethodLabel(item.recommendationMethod),
      recommendationText: item.recommendationText,
      confidence: milkMissingConfidenceLabel(item.confidence),
      reviewStatus: milkMissingStatusLabel(item.status),
      monthKey: item.monthKey,
      yearKey: item.yearKey,
      sourceTable: 'milk_missing_review',
      sourceRecordId: item.id,
      sourceRecordIds: compactSourceRecordIds([item.id, ...(item.sourceRecordIds || [])], 6)
    }
  }

  function compactSourceRecordIds(values: unknown[], limit = 12) {
    const tokens = splitJoined(values)
    if (tokens.length <= limit) return tokens.join('、')
    return `${tokens.slice(0, limit).join('、')} 等${tokens.length}条`
  }

  function defaultMilkMissingReviewDateRange() {
    const end = addDateDays(new Date(), -1)
    const start = addDateDays(end, -29)
    return [dateKeyOfDate(start), dateKeyOfDate(end)]
  }

  function addDateDays(date: Date, days: number) {
    const next = new Date(date)
    next.setDate(next.getDate() + days)
    return next
  }

  function dateKeyOfDate(date: Date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function milkMissingMethodLabel(method: MilkMissingReviewItem['recommendationMethod']) {
    const map: Record<MilkMissingReviewItem['recommendationMethod'], string> = {
      lactation_305_curve: '305天泌乳曲线',
      curve_interpolation: '同牛曲线插值',
      recent_average: '近期平均',
      neighbor_average: '邻近均值',
      summary_profile: '汇总资料拆分',
      cow_average: '个体均值',
      manual_required: '人工核对'
    }
    return map[method] || str(method)
  }

  function milkMissingKindLabel(kind: MilkMissingReviewItem['missingKind']) {
    const map: Record<MilkMissingReviewItem['missingKind'], string> = {
      day: '缺整日',
      shift: '缺班次',
      empty_value: '空产量',
      summary_only: '汇总待拆分'
    }
    return map[kind] || str(kind)
  }

  function milkMissingConfidenceLabel(confidence: MilkMissingReviewItem['confidence']) {
    return confidence === 'high' ? '高' : confidence === 'medium' ? '中' : '低'
  }

  function milkMissingStatusLabel(status: MilkMissingReviewItem['status']) {
    const map: Record<MilkMissingReviewItem['status'], string> = {
      pending: '待确认',
      confirmed: '已确认',
      ignored: '已忽略'
    }
    return map[status] || str(status)
  }

  async function buildLeaderMilkPresetRows(strategy: ExportStrategy): Promise<ExportRow[]> {
    const preset = leaderMilkPresetCode(strategy)
    if (!preset) return []
    const milkRows = (await buildPhenotypeRows()).filter(
      (row) => canonicalTraitCode(row.traitCode) === 'milk_yield'
    )
    if (!milkRows.length) return []
    if (preset === 'shift-detail') return milkRows.map(withMilkTraitValue)
    if (preset === 'daily-summary')
      return aggregateMilkRows(milkRows, strategy, 'day', 'sum').map((row) => ({
        ...withMilkTraitValue(row),
        milkingShift: ''
      }))
    if (preset === '305-yield') return buildLeader305Rows(milkRows, strategy)
    if (preset === 'parity-yield') return aggregateMilkRows(milkRows, strategy, 'parity', 'sum')
    if (preset === 'year-with-parity')
      return aggregateMilkRows(milkRows, strategy, 'year_with_parity', 'sum')
    if (preset === 'avg-daily-yield')
      return aggregateMilkRows(milkRows, strategy, 'cow', 'avg_daily')
    return []
  }

  function leaderMilkPresetCode(strategy?: ExportStrategy | null) {
    if (!strategy) return ''
    const explicit = str(strategy.presetCode).replace(/^milk-stat-/, '')
    if (explicit === 'milk-missing-review') return 'missing-review'
    if (explicit) return explicit
    const id = str(strategy.id)
    if (id.startsWith(leaderMilkPresetPrefix)) return id.slice(leaderMilkPresetPrefix.length)
    const name = str(strategy.name)
    if (name.includes('班次产奶明细')) return 'shift-detail'
    if (name.includes('日产奶量汇总')) return 'daily-summary'
    if (name.includes('缺失复核')) return 'missing-review'
    if (name.includes('牛只胎次周期指标')) return 'cow-period-profile'
    if (name.includes('305天产奶量')) return '305-yield'
    if (name.includes('胎次产奶量归属')) return 'parity-yield'
    if (name.includes('年度产奶带胎次')) return 'year-with-parity'
    if (name.includes('平均日产奶量')) return 'avg-daily-yield'
    return ''
  }

  async function buildLeader305Rows(
    milkRows: ExportRow[],
    strategy: ExportStrategy
  ): Promise<ExportRow[]> {
    const factRows = await buildLactation305FactRows()
    if (factRows.length) return enrichLeader305FactRows(factRows, milkRows).map(withMilkTraitValue)
    return aggregateMilkRows(milkRows, strategy, 'lactation_305', 'sum')
  }

  function enrichLeader305FactRows(factRows: ExportRow[], milkRows: ExportRow[]): ExportRow[] {
    const groups = new Map<string, ExportRow[]>()
    milkRows.forEach((row) => {
      const dim = numericValue(row.daysInMilk)
      if (dim === null || dim < 1 || dim > 305) return
      const key = [cowGroupKey(row), str(row.parity || row.currentParity || '')].join('|')
      if (!key.startsWith('|')) groups.set(key, [...(groups.get(key) || []), row])
    })
    return factRows.map((row) => {
      const key = [cowGroupKey(row), str(row.parity || row.currentParity || '')].join('|')
      const sourceRows = groups.get(key) || []
      const daysInMilkRange = row.daysInMilkRange || dimRange(sourceRows)
      return {
        ...row,
        daysInMilkRange
      }
    })
  }

  function withMilkTraitValue(row: ExportRow): ExportRow {
    return {
      ...row,
      [traitValueKey('milk_yield')]: row[traitValueKey('milk_yield')] ?? row.value
    }
  }

  type MilkPresetGroupBy = 'day' | 'parity' | 'year_with_parity' | 'lactation_305' | 'cow'
  type MilkPresetAggregation = 'sum' | 'avg_daily'

  function aggregateMilkRows(
    rows: ExportRow[],
    strategy: ExportStrategy,
    groupBy: MilkPresetGroupBy,
    aggregation: MilkPresetAggregation
  ) {
    const grouped = new Map<string, ExportRow[]>()
    rows.forEach((row) => {
      if (groupBy === 'lactation_305') {
        const dim = numericValue(row.daysInMilk)
        if (dim === null || dim < 1 || dim > 305) return
      }
      const key = milkPresetGroupKey(row, groupBy)
      if (!key) return
      grouped.set(key, [...(grouped.get(key) || []), row])
    })
    return Array.from(grouped.values()).map((group) =>
      withMilkTraitValue(aggregateMilkPresetGroup(group, strategy, groupBy, aggregation))
    )
  }

  function milkPresetGroupKey(row: ExportRow, groupBy: MilkPresetGroupBy) {
    const cowKey = cowGroupKey(row)
    if (!cowKey) return ''
    if (groupBy === 'day') return [cowKey, periodValue(row, 'day')].join('|')
    if (groupBy === 'parity') return [cowKey, str(row.parity || '未填')].join('|')
    if (groupBy === 'year_with_parity')
      return [cowKey, periodValue(row, 'year'), str(row.parity || '未填')].join('|')
    if (groupBy === 'lactation_305') return [cowKey, str(row.parity || '未填'), '305'].join('|')
    if (groupBy === 'cow') return cowKey
    return ''
  }

  function aggregateMilkPresetGroup(
    group: ExportRow[],
    strategy: ExportStrategy,
    groupBy: MilkPresetGroupBy,
    aggregation: MilkPresetAggregation
  ): ExportRow {
    const sorted = group
      .slice()
      .sort((left, right) => dateValue(left).localeCompare(dateValue(right)))
    const first = sorted[0] || {}
    const last = sorted[sorted.length - 1] || first
    const values = sorted
      .map((row) => numericValue(row.value))
      .filter((value): value is number => value !== null)
    const total = round(values.reduce((sum, value) => sum + value, 0))
    const distinctDays = uniqueText(sorted.map((row) => periodValue(row, 'day'))).filter(
      (value) => value !== '-'
    )
    const value =
      aggregation === 'avg_daily'
        ? distinctDays.length
          ? round(total / distinctDays.length)
          : ''
        : total
    const cowNumbers = uniqueText(sorted.map((row) => row.cowNumber))
    const dominant = dominantContext(sorted)
    const period = milkPresetPeriodLabel(first, groupBy)
    const sourceRecordIds = uniqueJoined(
      sorted.map((row) =>
        str(row.sourceRecordIds || [row.sourceTable, row.sourceRecordId].filter(Boolean).join(':'))
      )
    )
    return {
      ...first,
      datasetDomain: '表型与泌乳',
      recordType: milkPresetRecordType(groupBy, aggregation),
      period,
      firstDate: dateValue(first),
      lastDate: dateValue(last),
      collectionDate: dateValue(last),
      cowNumber: cowNumbers.length === 1 ? cowNumbers[0] : str(first.cowNumber || ''),
      cowNumbers: cowNumbers.join('、'),
      cowCount: cowNumbers.length || 1,
      breed: firstRealBreed(dominant.breed, first.breed),
      currentPen: dominant.currentPen || first.currentPen,
      herdGroup: dominant.herdGroup || first.herdGroup,
      productionStage: dominant.productionStage || first.productionStage || first.type,
      status: dominant.status || first.status,
      category: '泌乳性能',
      traitCode: 'milk_yield',
      traitName: traitColumnLabelForStrategy(strategy, 'milk_yield'),
      value,
      unit: 'kg',
      aggregation: aggregation === 'avg_daily' ? '平均' : '合计',
      recordCount: sorted.length,
      parity: dominant.parity || first.parity,
      currentParity: dominant.currentParity || first.currentParity,
      parityCalvingDate: dominant.parityCalvingDate || first.parityCalvingDate,
      lactationStartDate: dominant.parityCalvingDate || first.parityCalvingDate,
      lactationEndDate: milkPresetLactationEndDate(sorted),
      calfBreed: dominantValue(sorted, 'calfBreed'),
      daysInMilk: groupBy === 'lactation_305' ? 305 : first.daysInMilk,
      daysInMilkRange: dimRange(sorted),
      parityMilkYield: groupBy === 'parity' ? total : '',
      milkYield305: groupBy === 'lactation_305' ? total : '',
      averageDailyMilk: distinctDays.length ? round(total / distinctDays.length) : '',
      coverageDays: distinctDays.length,
      missingDays: '',
      milkingShift: groupBy === 'day' || groupBy === 'cow' ? '' : dominant.milkingShift || '',
      source: '奶厅测量计算',
      sourceTable: uniqueJoined(sorted.map((row) => row.sourceTable)),
      sourceRecordIds,
      sourceRecordId: sourceRecordIds,
      ...pickPedigreeValues(dominant, first)
    }
  }

  function milkPresetPeriodLabel(row: ExportRow, groupBy: MilkPresetGroupBy) {
    if (groupBy === 'day') return periodValue(row, 'day')
    if (groupBy === 'parity') return row.parity ? `第 ${row.parity} 胎` : '胎次未填'
    if (groupBy === 'year_with_parity') {
      const year = periodValue(row, 'year')
      const parity = row.parity ? `第 ${row.parity} 胎` : '胎次未填'
      return `${year} / ${parity}`
    }
    if (groupBy === 'lactation_305') return row.parity ? `第 ${row.parity} 胎 1-305天` : '1-305天'
    if (groupBy === 'cow') return '单牛汇总'
    return dateValue(row) || '-'
  }

  function milkPresetRecordType(groupBy: MilkPresetGroupBy, aggregation: MilkPresetAggregation) {
    if (groupBy === 'day') return '日产奶量汇总'
    if (groupBy === 'parity') return '胎次产奶量汇总'
    if (groupBy === 'year_with_parity') return '年度产奶带胎次'
    if (groupBy === 'lactation_305') return '305天产奶量'
    if (aggregation === 'avg_daily') return '平均日产奶量'
    return '产奶统计'
  }

  function milkPresetLactationEndDate(group: ExportRow[]) {
    const explicit = dominantValue(group, 'lactationEndDate')
    if (explicit) return explicit
    const dryOff = dominantValue(group, 'dryOffDate') || dominantValue(group, 'dry_off_date')
    return dryOff || ''
  }

  async function buildLeaderCowPeriodProfileRows(strategy: ExportStrategy): Promise<ExportRow[]> {
    const [animalRows, phenotypeRows] = await Promise.all([buildAnimalRows(), buildPhenotypeRows()])
    const milkRows = phenotypeRows.filter(
      (row) => canonicalTraitCode(row.traitCode) === 'milk_yield'
    )
    const byCow = new Map<string, ExportRow>()
    animalRows.forEach((row) => {
      ;[row.cowId, row.animalId, row.cowNumber].map(str).filter(Boolean).forEach((key) => {
        if (!byCow.has(key)) byCow.set(key, row)
      })
    })
    const parityRows = aggregateMilkRows(milkRows, strategy, 'parity', 'sum')
    if (!parityRows.length) {
      return animalRows.map((row) => ({
        ...row,
        recordType: '牛只胎次周期指标',
        period: row.parity ? `第 ${row.parity} 胎` : '胎次未填',
        lactationStartDate: row.parityCalvingDate,
        lactationEndDate: '',
        calfBreed: '',
        parityMilkYield: '',
        milkYield305: '',
        averageDailyMilk: '',
        coverageDays: '',
        missingDays: '',
        sourceTable: row.sourceTable || 'animal',
        sourceRecordId: row.sourceRecordId
      }))
    }
    const rows305 = aggregateMilkRows(milkRows, strategy, 'lactation_305', 'sum')
    const yield305ByCowParity = new Map(
      rows305.map((row) => [
        [cowGroupKey(row), str(row.parity || '')].join('|'),
        row
      ])
    )
    return parityRows.map((row) => {
      const animal = (byCow.get(str(row.cowId)) ||
        byCow.get(str(row.cowNumber)) ||
        ({
          ...normalizeCowContext(row),
          cowId: row.cowId,
          animalId: row.cowId,
          gender: row.gender,
          birthDate: row.birthDate,
          sourceTable: row.sourceTable,
          sourceRecordId: row.sourceRecordId
        } as ExportRow)) as ExportRow
      const key = [cowGroupKey(row), str(row.parity || '')].join('|')
      const row305 = yield305ByCowParity.get(key)
      const animalSourceToken = [animal.sourceTable || 'animal', animal.sourceRecordId]
        .map(str)
        .filter(Boolean)
        .join(':')
      return {
        ...animal,
        ...row,
        id: `leader-cow-period-${sanitizeKey(str(row.cowId || row.cowNumber))}-${sanitizeKey(str(row.parity || 'unknown'))}`,
        recordType: '牛只胎次周期指标',
        cowId: str(row.cowId || animal.cowId || animal.animalId),
        animalId: str(animal.animalId || row.cowId),
        cowNumber: str(row.cowNumber || animal.cowNumber),
        breed: firstRealBreed(animal.breed, row.breed),
        gender: str(animal.gender),
        birthDate: str(animal.birthDate),
        period: row.parity ? `第 ${row.parity} 胎` : '胎次未填',
        parity: row.parity,
        currentParity: row.currentParity || animal.currentParity,
        parityCalvingDate: row.parityCalvingDate || animal.parityCalvingDate,
        lactationStartDate: row.parityCalvingDate || animal.parityCalvingDate,
        lactationEndDate: row.lactationEndDate || '',
        calfBreed: str(row.calfBreed || animal.calfBreed),
        parityMilkYield: row.value,
        milkYield305: row305?.value || row.milkYield305 || '',
        averageDailyMilk: row.averageDailyMilk,
        coverageDays: row.coverageDays,
        missingDays: row305?.missingDays || '',
        sourceTable: uniqueJoined([animal.sourceTable, row.sourceTable]),
        sourceRecordIds: uniqueJoined([animalSourceToken, row.sourceRecordIds]),
        sourceRecordId: uniqueJoined([animalSourceToken, row.sourceRecordIds])
      }
    })
  }

  async function buildFactRowsForTraitStrategy(strategy: ExportStrategy): Promise<ExportRow[]> {
    if (!isTraitStrategy(strategy)) return []
    const groupBy = configForm.period.groupBy
    const aggregation = configForm.aggregation
    const selectedCodes = currentSelectedTraitCodes()
    if (
      groupBy === 'lactation_305' &&
      selectedCodes.includes('milk_yield') &&
      aggregation === 'sum'
    ) {
      return buildLactation305FactRows()
    }
    if (groupBy === 'parity' && aggregation !== 'raw') {
      return buildTraitParityFactRows(selectedCodes, aggregation)
    }
    return []
  }

  async function buildLactation305FactRows(): Promise<ExportRow[]> {
    const [facts, animals, cows, parentageRows, identifiers] = await Promise.all([
      readTableSafe('fact_lactation_305'),
      readTableSafe('animal'),
      readTableSafe('cows'),
      readTableSafe('animal_parentage'),
      readTableSafe('animal_identifier')
    ])
    if (!facts.length) return []
    const cowContext = buildCowContext(cows, animals, parentageRows, identifiers)
    return facts
      .map((row: any) => {
        const cowRef = resolveCowRef(row, cowContext.reference)
        const cow =
          cowContext.byId.get(str(cowRef.cowId)) ||
          cowContext.byNumber.get(str(cowRef.cowNumber)) ||
          normalizeCowContext(row)
        return {
          id: str(row.id),
          recordType: '305天泌乳事实',
          cowKey: cowRef.sourceKey,
          cowId: str(cowRef.cowId || row.cowId || row.cow_id || row.animalId || row.animal_id),
          cowNumber: str(
            cowRef.cowNumber ||
              row.cowNumber ||
              row.cow_number ||
              row.animalNumber ||
              row.animal_number
          ),
          cowName: str(cow.cowName),
          breed: firstRealBreed(cow.breed, row.breed),
          currentPen: str(cow.currentPen),
          herdGroup: str(cow.herdGroup),
          productionStage: str(cow.productionStage),
          status: str(cow.status),
          category: '泌乳性能',
          traitCode: 'milk_yield',
          traitName: '305天产奶量',
          collectionDate: str(
            row.endDate ||
              row.end_date ||
              row.updatedAt ||
              row.updated_at ||
              row.startDate ||
              row.start_date
          ),
          firstDate: str(row.startDate || row.start_date),
          lastDate: str(row.endDate || row.end_date),
          parityCalvingDate: str(row.startDate || row.start_date),
          period:
            row.parityNo || row.parity_no
              ? `第 ${row.parityNo || row.parity_no} 胎 1-305天`
              : '305天泌乳窗',
          value: row.milkYield305 ?? row.milk_yield_305 ?? row.value,
          unit: 'kg',
          parity: row.parityNo ?? row.parity_no,
          currentParity: row.parityNo ?? row.parity_no,
          cowCurrentParity: cow.currentParity ?? cow.parity,
          daysInMilk: 305,
          aggregation: '305天事实',
          recordCount: row.recordCount ?? row.record_count ?? 0,
          coverageDays: row.coverageDays ?? row.coverage_days,
          missingDays: row.missingDays ?? row.missing_days,
          source: '周期事实表',
          sourceTable: 'fact_lactation_305',
          sourceRecordId: str(row.id),
          sourceRecordIds: str(
            row.sourceRecordIds || row.source_record_ids || `fact_lactation_305:${row.id}`
          ),
          ...pickPedigreeValues(row, cow)
        }
      })
      .filter((row) => numericValue(row.value) !== null)
  }

  async function buildTraitParityFactRows(
    traitCodes: string[],
    aggregation: Aggregation
  ): Promise<ExportRow[]> {
    const [facts, animals, cows, parentageRows, identifiers] = await Promise.all([
      readTableSafe('fact_cow_trait_parity'),
      readTableSafe('animal'),
      readTableSafe('cows'),
      readTableSafe('animal_parentage'),
      readTableSafe('animal_identifier')
    ])
    if (!facts.length) return []
    const allowed = new Set(traitCodes.map((code) => canonicalTraitCode(code)).filter(Boolean))
    const cowContext = buildCowContext(cows, animals, parentageRows, identifiers)
    return facts
      .filter((row: any) => {
        const code = canonicalTraitCode(row.traitCode || row.trait_code)
        if (allowed.size && !allowed.has(code)) return false
        return str(row.aggregation || 'raw') === aggregation
      })
      .map((row: any) => {
        const code = canonicalTraitCode(row.traitCode || row.trait_code)
        const cowRef = resolveCowRef(row, cowContext.reference)
        const cow =
          cowContext.byId.get(str(cowRef.cowId)) ||
          cowContext.byNumber.get(str(cowRef.cowNumber)) ||
          normalizeCowContext(row)
        return {
          id: str(row.id),
          recordType: '胎次性状事实',
          cowKey: cowRef.sourceKey,
          cowId: str(cowRef.cowId || row.cowId || row.cow_id || row.animalId || row.animal_id),
          cowNumber: str(
            cowRef.cowNumber ||
              row.cowNumber ||
              row.cow_number ||
              row.animalNumber ||
              row.animal_number
          ),
          cowName: str(cow.cowName),
          breed: firstRealBreed(cow.breed, row.breed),
          currentPen: str(cow.currentPen),
          herdGroup: str(cow.herdGroup),
          productionStage: str(cow.productionStage),
          status: str(cow.status),
          category: traitCategoryForCode(code),
          traitCode: code,
          traitName: str(row.traitName || row.trait_name || traitLabelForCode(code)),
          collectionDate: str(
            row.endDate ||
              row.end_date ||
              row.updatedAt ||
              row.updated_at ||
              row.startDate ||
              row.start_date
          ),
          firstDate: str(row.startDate || row.start_date),
          lastDate: str(row.endDate || row.end_date),
          parityCalvingDate: str(row.startDate || row.start_date),
          period:
            row.parityNo || row.parity_no ? `第 ${row.parityNo || row.parity_no} 胎` : '胎次未填',
          value: row.value,
          unit: str(row.unit),
          parity: row.parityNo ?? row.parity_no,
          currentParity: row.parityNo ?? row.parity_no,
          cowCurrentParity: cow.currentParity ?? cow.parity,
          aggregation: aggregationLabel(aggregation),
          recordCount: row.recordCount ?? row.record_count ?? 0,
          source: '周期事实表',
          sourceTable: 'fact_cow_trait_parity',
          sourceRecordId: str(row.id),
          sourceRecordIds: str(
            row.sourceRecordIds || row.source_record_ids || `fact_cow_trait_parity:${row.id}`
          ),
          ...pickPedigreeValues(row, cow)
        }
      })
      .filter((row) => numericValue(row.value) !== null)
  }

  async function buildAnimalRows(): Promise<ExportRow[]> {
    const [animals, cows, parentageRows, parityEpisodes] = await Promise.all([
      readTableSafe('animal'),
      readTableSafe('cows'),
      readTableSafe('animal_parentage'),
      readTableSafe('parity_episode')
    ])
    const paritySummary = buildParitySummaryResolver(parityEpisodes)
    if (animals.length) {
      const resolvePedigree = buildPedigreeResolver(animals, cows, parentageRows)
      return animals.map((row: any) => {
        const animalId = animalIdOf(row)
        const animalNumber = animalNumberOf(row)
        const parityInfo = paritySummary.resolve(animalId, animalNumber)
        return {
          id: animalId,
          animalId,
          cowId: animalId,
          cowNumber: animalNumber,
          earTagNumber: str(
            row.earTagNumber || row.ear_tag_number || row.electronicTag || row.electronic_tag
          ),
          breed: breedFieldValue(row),
          gender: str(row.sex || row.gender),
          birthDate: str(row.birthDate || row.birth_date),
          type: str(
            row.productionPurpose ||
              row.production_purpose ||
              row.currentStageName ||
              row.current_stage_name ||
              row.currentStageId ||
              row.current_stage_id
          ),
          currentPen: str(
            row.currentPen ||
              row.current_pen ||
              row.currentPenId ||
              row.current_pen_id ||
              row.currentUnitId ||
              row.current_unit_id
          ),
          herdGroup: str(
            row.herdGroup ||
              row.herd_group ||
              row.groupName ||
              row.group_name ||
              row.currentGroupName ||
              row.current_group_name ||
              row.currentGroupId ||
              row.current_group_id
          ),
          productionStage: str(
            row.productionStage ||
              row.production_stage ||
              row.productionPurpose ||
              row.production_purpose ||
              row.currentStageName ||
              row.current_stage_name ||
              row.currentStageId ||
              row.current_stage_id
          ),
          status: str(row.status),
          pregnancy: row.pregnancy ? '是' : '否',
          pregnancyStage: pregnancyStageOf(row),
          dryPeriod: dryPeriodOf(row),
          parity: numberOrBlank(parityValueOf(row) ?? parityInfo?.parity),
          currentParity: numberOrBlank(currentParityValueOf(row) ?? parityInfo?.parity),
          parityCalvingDate: str(parityCalvingDateOf(row) || parityInfo?.startDate),
          reproductionCycle: reproductionCycleOf(row),
          ...resolvePedigree(row),
          createdAt: str(row.createdAt || row.created_at),
          updatedAt: str(row.updatedAt || row.updated_at),
          sourceTable: 'animal',
          sourceRecordId: animalId
        }
      })
    }
    const resolvePedigree = buildPedigreeResolver(animals, cows, parentageRows)
    return cows.map((row: any) => {
      const animalId = animalIdOf(row)
      const animalNumber = animalNumberOf(row)
      const parityInfo = paritySummary.resolve(animalId, animalNumber)
      return {
        ...row,
        id: animalId,
        animalId,
        cowId: animalId,
        cowNumber: animalNumber,
        earTagNumber: str(row.earTagNumber || row.ear_tag_number),
        gender: str(row.gender || row.sex),
        birthDate: str(row.birthDate || row.birth_date),
        currentPen: str(row.currentPen || row.current_pen),
        herdGroup: str(
          row.herdGroup ||
            row.herd_group ||
            row.groupName ||
            row.group_name ||
            row.currentGroupName ||
            row.current_group_name ||
            row.currentGroupId ||
            row.current_group_id
        ),
        productionStage: str(
          row.productionStage ||
            row.production_stage ||
            row.type ||
            row.productionPurpose ||
            row.production_purpose
        ),
        status: str(row.status),
        pregnancy: row.pregnancy ? '是' : '否',
        pregnancyStage: pregnancyStageOf(row),
        dryPeriod: dryPeriodOf(row),
        parity: numberOrBlank(parityValueOf(row) ?? parityInfo?.parity),
        currentParity: numberOrBlank(currentParityValueOf(row) ?? parityInfo?.parity),
        parityCalvingDate: str(parityCalvingDateOf(row) || parityInfo?.startDate),
        reproductionCycle: reproductionCycleOf(row),
        ...resolvePedigree(row),
        sourceTable: 'cows',
        sourceRecordId: animalId
      }
    })
  }

  async function buildEventRows(): Promise<ExportRow[]> {
    const [v2Events, animals, cows, parentageRows, identifiers, cowEvents, breedingRecords] =
      await Promise.all([
        readTableSafe('animal_event'),
        readTableSafe('animal'),
        readTableSafe('cows'),
        readTableSafe('animal_parentage'),
        readTableSafe('animal_identifier'),
        readTableSafe('cow-events'),
        readTableSafe('breeding-records')
      ])
    const animalNumberMap = buildAnimalNumberMap(animals)
    const cowContext = buildCowContext(cows, animals, parentageRows, identifiers)
    const normalizedV2 = v2Events.map((row: any) => {
      const animalId = str(row.animalId || row.animal_id)
      const customValues = parseObject(row.customValues || row.custom_values)
      const type = normalizeEventType(
        row.eventType ||
          row.event_type ||
          row.eventCode ||
          row.event_code ||
          row.eventName ||
          row.event_name
      )
      return {
        id: str(row.id),
        cowId: animalId,
        cowNumber: animalNumberMap.get(animalId) || str(row.cowNumber || row.cow_number),
        eventType: type,
        eventTypeLabel: eventTypeLabel(type),
        eventDate: str(
          row.occurredAt ||
            row.occurred_at ||
            row.productionDate ||
            row.production_date ||
            row.createdAt ||
            row.created_at
        ),
        milkingShift: str(
          explicitMilkingShiftValue({ ...customValues, ...row }) ||
            milkingShiftValue({
              eventDate: str(
                row.occurredAt ||
                  row.occurred_at ||
                  row.productionDate ||
                  row.production_date ||
                  row.createdAt ||
                  row.created_at
              )
            })
        ),
        operatorName: str(row.operatorName || row.operator_name),
        description: str(
          row.eventName ||
            row.event_name ||
            row.eventCode ||
            row.event_code ||
            row.sourceType ||
            row.source_type
        ),
        notes: str(row.notes),
        cost: numberOrBlank(customValues.cost ?? customValues.fee),
        parity: numberOrBlank(parityValueOf(row) ?? parityValueOf(customValues)),
        currentParity: numberOrBlank(
          currentParityValueOf(row) ?? currentParityValueOf(customValues)
        ),
        parityCalvingDate: parityCalvingDateOf({ ...customValues, ...row }),
        createdAt: str(row.createdAt || row.created_at),
        sourceTable: 'animal_event',
        sourceRecordId: str(row.id)
      }
    })
    const legacy = [
      ...cowEvents.map((row: any) =>
        normalizeLegacyEvent(
          row,
          canonicalEventSourceTable(row.sourceTable || row.source_table || 'cow-events')
        )
      ),
      ...(await readTableSafe('entry-events')).map((row: any) =>
        normalizeLegacyEvent({ ...row, eventType: 'entry' }, 'entry_events')
      ),
      ...(await readTableSafe('transfer-events')).map((row: any) =>
        normalizeLegacyEvent({ ...row, eventType: 'transfer' }, 'transfer_events')
      ),
      ...(await readTableSafe('exit-events')).map((row: any) =>
        normalizeLegacyEvent({ ...row, eventType: 'exit' }, 'exit_events')
      ),
      ...(await readTableSafe('breeding-events')).map((row: any) =>
        normalizeLegacyEvent({ ...row, eventType: 'breeding' }, 'breeding_events')
      ),
      ...(await readTableSafe('veterinary-events')).map((row: any) =>
        normalizeLegacyEvent({ ...row, eventType: 'veterinary' }, 'veterinary_events')
      ),
      ...breedingRecords.map((row: any) => normalizeLegacyEvent(row, 'breeding_records'))
    ]
    const seen = new Set<string>()
    const rows = [...normalizedV2, ...legacy]
      .sort(
        (left, right) =>
          eventSourcePriority(left.sourceTable) - eventSourcePriority(right.sourceTable)
      )
      .filter((row) => {
        const keys = eventDedupKeys(row)
        if (keys.some((key) => seen.has(key))) return false
        keys.forEach((key) => seen.add(key))
        return true
      })
      .map((row) => enrichEventRow(row, cowContext))
    const parityResolver = buildParityResolver(rows)
    return rows.map((row) => applyParityResolution(row, parityResolver))
  }

  async function buildPhenotypeRows(): Promise<ExportRow[]> {
    const [
      animals,
      cows,
      parentageRows,
      identifiers,
      traits,
      categories,
      traitObservations,
      milkMeasurements,
      phenotypeRecords,
      milkRecords,
      parityEpisodes,
      lactationEpisodes
    ] = await Promise.all([
      readTableSafe('animal'),
      readTableSafe('cows'),
      readTableSafe('animal_parentage'),
      readTableSafe('animal_identifier'),
      readTableSafe('trait_definition'),
      readTableSafe('trait_category'),
      readTableSafe('trait_observation'),
      readTableSafe('milk_measurement'),
      readTableSafe('phenotype-records'),
      readTableSafe('milk-records'),
      readTableSafe('parity_episode'),
      readTableSafe('lactation_episode')
    ])
    const cowContext = buildCowContext(cows, animals, parentageRows, identifiers)
    const eventRows = await buildEventRows()
    const parityResolver = buildParityResolver([
      ...eventRows,
      ...buildParityEpisodeSeedRows(parityEpisodes, 'parity_episode', cowContext),
      ...buildParityEpisodeSeedRows(lactationEpisodes, 'lactation_episode', cowContext)
    ])
    const categoryById = new Map(
      categories.map((row: any) => [str(row.id), str(row.name || row.code)])
    )
    const traitById = new Map<string, any>()
    const traitByCode = new Map<string, any>()
    traits.forEach((row: any) => {
      const normalized = {
        id: str(row.id),
        code: str(row.code),
        name: str(row.name || row.code),
        category:
          categoryById.get(str(row.categoryId || row.category_id)) ||
          str(row.category || row.traitType || row.trait_type || '未分类'),
        unit: str(row.unit)
      }
      if (normalized.id) traitById.set(normalized.id, normalized)
      if (normalized.code) traitByCode.set(normalized.code, normalized)
    })

    const rows: ExportRow[] = []
    traitObservations.forEach((row: any) => {
      const animalId = str(row.animalId || row.animal_id)
      const cow =
        cowContext.byId.get(animalId) ||
        cowContext.byNumber.get(str(row.cowNumber || row.cow_number)) ||
        normalizeCowContext({})
      const trait =
        traitById.get(str(row.traitId || row.trait_id)) ||
        traitByCode.get(str(row.traitCode || row.trait_code))
      const item = normalizeObservation({
        id: str(row.id),
        recordType: '表型观测',
        cowId: animalId,
        cowNumber: str(cow.cowNumber || row.cowNumber || row.cow_number),
        cowName: str(cow.cowName),
        breed: firstRealBreed(cow.breed, row.breed),
        currentPen: str(cow.currentPen),
        herdGroup: str(cow.herdGroup),
        productionStage: str(cow.productionStage),
        status: str(cow.status),
        category: str(trait?.category || row.category),
        traitCode: str(
          trait?.code || row.traitCode || row.trait_code || row.traitId || row.trait_id
        ),
        traitName: str(trait?.name || row.traitName || row.trait_name),
        collectionDate: dateOf(row),
        value: row.numericValue ?? row.numeric_value ?? row.value,
        unit: str(row.unit || trait?.unit),
        parity: parityValueOf(row),
        currentParity: cow.currentParity ?? cow.parity,
        cowCurrentParity: cow.currentParity ?? cow.parity,
        parityCalvingDate: parityCalvingDateOf(row) || parityCalvingDateOf(cow),
        daysInMilk: row.daysInMilk ?? row.days_in_milk,
        milkingShift: explicitMilkingShiftValue(row),
        source: str(row.sourceType || row.source_type || '表型观测记录'),
        equipmentId: str(row.methodId || row.method_id || row.batchId || row.batch_id),
        collector: str(row.collector),
        operatorName: recordOperator(row),
        notes: str(row.textValue || row.text_value || row.qualityFlag || row.quality_flag),
        sourceTable: 'trait_observation',
        sourceRecordId: str(row.id),
        ...pickPedigreeValues(cow)
      })
      if (item) rows.push(applyParityResolution(item, parityResolver))
    })

    milkMeasurements.forEach((row: any) => {
      const animalId = str(row.animalId || row.animal_id)
      const cow =
        cowContext.byId.get(animalId) ||
        cowContext.byNumber.get(str(row.cowNumber || row.cow_number)) ||
        normalizeCowContext({})
      const base = {
        id: str(row.id),
        recordType: '奶厅测量',
        cowId: animalId,
        cowNumber: str(cow.cowNumber || row.cowNumber || row.cow_number),
        cowName: str(cow.cowName),
        breed: firstRealBreed(cow.breed, row.breed),
        currentPen: str(cow.currentPen),
        herdGroup: str(cow.herdGroup),
        productionStage: str(cow.productionStage),
        status: str(cow.status),
        category: '泌乳性能',
        collectionDate: dateOf(row),
        parity: parityValueOf(row),
        currentParity: cow.currentParity ?? cow.parity,
        cowCurrentParity: cow.currentParity ?? cow.parity,
        parityCalvingDate: parityCalvingDateOf(row) || parityCalvingDateOf(cow),
        daysInMilk: row.daysInMilk ?? row.days_in_milk,
        milkingShift: milkingShiftValue(row),
        source: str(row.sourceType || row.source_type || '奶厅测量记录'),
        equipmentId: str(row.visitId || row.visit_id),
        collector: str(row.collector),
        operatorName: recordOperator(row),
        notes: str(row.qualityFlag || row.quality_flag),
        sourceTable: 'milk_measurement',
        sourceRecordId: str(row.id),
        ...pickPedigreeValues(cow)
      }
      const milkTraitMap: Array<[string, string, unknown, string]> = [
        ['milk_yield', '产奶量', row.milkYield ?? row.milk_yield, 'kg'],
        [
          'milk_fat',
          '乳脂率',
          row.fatRate ?? row.fat_rate ?? row.fatPercent ?? row.fat_percent,
          '%'
        ],
        [
          'milk_protein',
          '乳蛋白率',
          row.proteinRate ?? row.protein_rate ?? row.proteinPercent ?? row.protein_percent,
          '%'
        ],
        [
          'milk_lactose',
          '乳糖率',
          row.lactoseRate ?? row.lactose_rate ?? row.lactosePercent ?? row.lactose_percent,
          '%'
        ],
        [
          'somatic_cell_count',
          '体细胞数',
          row.somaticCellCount ?? row.somatic_cell_count ?? row.scc,
          'cells/mL'
        ],
        ['milking_duration', '挤奶时长', row.milkingDuration ?? row.milking_duration, 'min'],
        ['milk_temperature', '奶温', row.milkTemperature ?? row.milk_temperature, '℃']
      ]
      milkTraitMap.forEach(([traitCode, traitName, value, unit]) => {
        const item = normalizeObservation({
          ...base,
          traitCode,
          traitName,
          value,
          unit,
          id: `${base.id}-${traitCode}`
        })
        if (item) rows.push(applyParityResolution(item, parityResolver))
      })
    })

    phenotypeRecords.forEach((row: any) => {
      const cowId = str(row.cowId || row.cow_id)
      const cowNumber = str(row.cowNumber || row.cow_number)
      const cow =
        cowContext.byId.get(cowId) || cowContext.byNumber.get(cowNumber) || normalizeCowContext(row)
      const item = normalizeObservation({
        id: str(row.id),
        recordType: '表型记录',
        cowId: str(cowId || cow.id),
        cowNumber: str(cowNumber || cow.cowNumber),
        cowName: str(row.cowName || row.cow_name || cow.cowName),
        breed: firstRealBreed(row.breed, cow.breed),
        currentPen: str(row.currentPen || row.current_pen || cow.currentPen),
        herdGroup: str(row.herdGroup || row.herd_group || cow.herdGroup),
        productionStage: str(row.productionStage || row.production_stage || cow.productionStage),
        status: str(row.status || cow.status),
        category: str(row.category || row.traitCategory || row.trait_category || '表型记录'),
        traitCode: str(row.traitCode || row.trait_code || row.traitName || row.trait_name),
        traitName: str(row.traitName || row.trait_name || row.traitCode || row.trait_code),
        collectionDate: dateOf(row),
        value: row.value ?? row.numericValue ?? row.numeric_value,
        unit: str(row.unit),
        parity: parityValueOf(row),
        currentParity: cow.currentParity ?? cow.parity,
        cowCurrentParity: cow.currentParity ?? cow.parity,
        parityCalvingDate: parityCalvingDateOf(row) || parityCalvingDateOf(cow),
        daysInMilk: row.daysInMilk || row.days_in_milk,
        milkingShift: explicitMilkingShiftValue(row),
        source: '表型记录',
        equipmentId: str(row.equipmentId || row.equipment_id),
        collector: str(row.collector),
        operatorName: recordOperator(row),
        notes: str(row.notes),
        sourceTable: 'phenotype-records',
        sourceRecordId: str(row.id),
        ...pickPedigreeValues(row, cow)
      })
      if (item) rows.push(applyParityResolution(item, parityResolver))
    })

    milkRecords.forEach((row: any) => {
      const cowId = str(row.cowId || row.cow_id)
      const cowNumber = str(row.cowNumber || row.cow_number)
      const cow =
        cowContext.byId.get(cowId) || cowContext.byNumber.get(cowNumber) || normalizeCowContext(row)
      const base = {
        id: str(row.id),
        recordType: '产奶记录',
        cowId: str(cowId || cow.id),
        cowNumber: str(cowNumber || cow.cowNumber),
        cowName: str(row.cowName || row.cow_name || cow.cowName),
        breed: firstRealBreed(row.breed, cow.breed),
        currentPen: str(row.currentPen || row.current_pen || cow.currentPen),
        herdGroup: str(row.herdGroup || row.herd_group || cow.herdGroup),
        productionStage: str(row.productionStage || row.production_stage || cow.productionStage),
        status: str(row.status || cow.status),
        category: '泌乳性能',
        collectionDate: dateOf(row),
        parity: parityValueOf(row),
        currentParity: cow.currentParity ?? cow.parity,
        cowCurrentParity: cow.currentParity ?? cow.parity,
        parityCalvingDate: parityCalvingDateOf(row) || parityCalvingDateOf(cow),
        daysInMilk: row.daysInMilk || row.days_in_milk,
        milkingShift: milkingShiftValue(row),
        source: '产奶记录',
        equipmentId: str(row.deviceId || row.device_id),
        collector: str(row.operatorName || row.operator_name),
        operatorName: recordOperator(row),
        notes: str(row.notes),
        sourceTable: 'milk-records',
        sourceRecordId: str(row.id),
        ...pickPedigreeValues(row, cow)
      }
      const legacyMilkTraits: Array<[string, string, unknown, string]> = [
        ['milk_yield', '产奶量', row.milkYield ?? row.milk_yield ?? row.yield, 'kg'],
        [
          'milk_fat',
          '乳脂率',
          row.fatRate ?? row.fat_rate ?? row.fatPercent ?? row.fat_percent ?? row.fat,
          '%'
        ],
        [
          'milk_protein',
          '乳蛋白率',
          row.proteinRate ??
            row.protein_rate ??
            row.proteinPercent ??
            row.protein_percent ??
            row.protein,
          '%'
        ],
        [
          'milk_lactose',
          '乳糖率',
          row.lactoseRate ??
            row.lactose_rate ??
            row.lactosePercent ??
            row.lactose_percent ??
            row.lactose,
          '%'
        ],
        [
          'somatic_cell_count',
          '体细胞数',
          row.somaticCellCount ?? row.somatic_cell_count ?? row.scc,
          'cells/mL'
        ]
      ]
      legacyMilkTraits.forEach(([traitCode, traitName, value, unit]) => {
        const item = normalizeObservation({
          ...base,
          traitCode,
          traitName,
          value,
          unit,
          id: `${base.id}-${traitCode}`
        })
        if (item) rows.push(applyParityResolution(item, parityResolver))
      })
    })
    rows.push(
      ...buildDictionaryMappedObservationRows(
        storedTraitDefinitions.value,
        {
          trait_observation: traitObservations,
          milk_measurement: milkMeasurements,
          'phenotype-records': phenotypeRecords,
          'milk-records': milkRecords
        },
        cowContext,
        rows,
        parityResolver
      )
    )
    const factualRows = dedupePhenotypeBusinessRows(rows)
    rows.splice(0, rows.length, ...factualRows)
    rows.push(...buildRecordAggregationObservationRows(factualRows, cowContext))
    rows.push(...buildEventIntervalObservationRows(eventRows, cowContext))
    rows.push(...buildEventCountObservationRows(eventRows, cowContext))
    return rows
  }

  function dedupePhenotypeBusinessRows(rows: ExportRow[]) {
    const seen = new Set<string>()
    return rows
      .slice()
      .sort(
        (left, right) =>
          phenotypeSourcePriority(left.sourceTable) - phenotypeSourcePriority(right.sourceTable)
      )
      .filter((row) => {
        const cowKey = str(row.cowId || row.cowNumber || row.cowKey)
        const traitCode = canonicalTraitCode(row.traitCode || row.traitName)
        const date = dateValue(row) || str(row.collectionDate || row.createdAt)
        const value = str(row.value)
        const keys = Array.from(
          new Set(
            [
              row.sourceRecordId ? `record:${cowKey}|${traitCode}|${row.sourceRecordId}` : '',
              row.id ? `id:${cowKey}|${traitCode}|${row.id}` : '',
              date ? `business:${cowKey}|${traitCode}|${date}|${value}` : ''
            ].filter(Boolean)
          )
        )
        if (keys.some((key) => seen.has(key))) return false
        keys.forEach((key) => seen.add(key))
        return true
      })
  }

  function phenotypeSourcePriority(sourceTable: unknown) {
    const source = normalizeLogicalSourceTable(sourceTable)
    if (source === 'trait_observation' || source === 'milk_measurement') return 0
    if (source === 'phenotype-records' || source === 'milk-records') return 1
    return 2
  }

  function buildDictionaryMappedObservationRows(
    traits: PhenotypeTraitDefinition[],
    tableRows: Record<string, any[]>,
    cowContext: ReturnType<typeof buildCowContext>,
    existingRows: ExportRow[],
    parityResolver: ReturnType<typeof buildParityResolver>
  ): ExportRow[] {
    const rows: ExportRow[] = []
    const existing = new Set(
      existingRows.map(
        (row) =>
          `${normalizeLogicalSourceTable(row.sourceTable)}:${row.sourceRecordId}:${canonicalTraitCode(row.traitCode)}`
      )
    )
    traits
      .filter(
        (trait) =>
          trait.status !== '停用' && trait.code && trait.sourceTable && trait.sourceValueField
      )
      .forEach((trait) => {
        const sourceTable = normalizeLogicalSourceTable(trait.sourceTable)
        const records = tableRows[sourceTable] || tableRows[str(trait.sourceTable)] || []
        records.forEach((record: any) => {
          const mapped = normalizeDictionaryMappedObservation(
            trait,
            record,
            sourceTable,
            cowContext
          )
          if (!mapped) return
          const key = `${normalizeLogicalSourceTable(mapped.sourceTable)}:${mapped.sourceRecordId}:${canonicalTraitCode(mapped.traitCode)}`
          if (existing.has(key)) return
          existing.add(key)
          rows.push(applyParityResolution(mapped, parityResolver))
        })
      })
    return rows
  }

  function normalizeDictionaryMappedObservation(
    trait: PhenotypeTraitDefinition,
    record: Record<string, any>,
    sourceTable: string,
    cowContext: ReturnType<typeof buildCowContext>
  ): ExportRow | null {
    const value = valueByField(record, trait.sourceValueField)
    if (numericValue(value) === null) return null
    const rowTraitCode = canonicalTraitCode(
      valueByField(record, trait.sourceTraitField) || record.traitCode || record.trait_code
    )
    const traitCode = canonicalTraitCode(trait.code)
    if (
      rowTraitCode &&
      rowTraitCode !== traitCode &&
      !isFixedColumnTraitSource(sourceTable, trait.sourceTraitField)
    )
      return null
    const animalRef =
      valueByField(record, trait.sourceAnimalField) ||
      record.animalId ||
      record.animal_id ||
      record.cowId ||
      record.cow_id
    const cowNumberRef = record.cowNumber || record.cow_number
    const cow =
      cowContext.byId.get(str(animalRef)) ||
      cowContext.byNumber.get(str(cowNumberRef)) ||
      normalizeCowContext(record)
    const recordId = str(record.id || `${traitCode}-${dateOf(record)}-${animalRef || cowNumberRef}`)
    return normalizeObservation({
      id: `dictionary-${sanitizeKey(sourceTable)}-${sanitizeKey(recordId)}-${traitCode}`,
      recordType: '数值性状事实',
      cowId: str(animalRef || cow.id),
      cowNumber: str(cow.cowNumber || cowNumberRef),
      cowName: str(cow.cowName),
      breed: firstRealBreed(cow.breed, record.breed),
      currentPen: str(cow.currentPen),
      herdGroup: str(cow.herdGroup),
      productionStage: str(cow.productionStage),
      status: str(cow.status),
      category: trait.category,
      traitCode,
      traitName: trait.name,
      collectionDate: str(valueByField(record, trait.sourceDateField) || dateOf(record)),
      value,
      unit: trait.unit,
      parity: valueByField(record, trait.sourceParityField) ?? parityValueOf(record),
      currentParity: cow.currentParity ?? cow.parity,
      cowCurrentParity: cow.currentParity ?? cow.parity,
      parityCalvingDate: parityCalvingDateOf(record) || parityCalvingDateOf(cow),
      daysInMilk:
        valueByField(record, trait.sourceDimField) ?? record.daysInMilk ?? record.days_in_milk,
      milkingShift: explicitMilkingShiftValue(record),
      source: trait.source,
      equipmentId: str(
        record.equipmentId ||
          record.equipment_id ||
          record.deviceId ||
          record.device_id ||
          record.batchId ||
          record.batch_id
      ),
      collector: str(record.collector),
      operatorName: recordOperator(record),
      notes: str(record.notes || record.qualityFlag || record.quality_flag),
      sourceTable,
      sourceRecordId: recordId,
      ...pickPedigreeValues(record, cow)
    })
  }

  function isFixedColumnTraitSource(sourceTable: string, traitField?: string) {
    return (
      ['milk_measurement', 'milk_records', 'milk-records'].includes(
        normalizeLogicalSourceTable(sourceTable)
      ) && !str(traitField)
    )
  }

  function valueByField(record: Record<string, any>, field?: string) {
    const key = str(field)
    if (!key) return undefined
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key]
    const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    if (Object.prototype.hasOwnProperty.call(record, snake)) return record[snake]
    const camel = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    if (Object.prototype.hasOwnProperty.call(record, camel)) return record[camel]
    return undefined
  }

  function buildRecordAggregationObservationRows(
    factualRows: ExportRow[],
    cowContext: ReturnType<typeof buildCowContext>
  ): ExportRow[] {
    const rows: ExportRow[] = []
    const rules = activeLogicalTraitRules.value.filter(
      (rule) =>
        (rule.ruleType === 'record_aggregation' || rule.ruleType === 'period_days') &&
        rule.sourceTraitCodes.length
    )
    rules.forEach((rule) => {
      const sourceCodes = new Set(
        rule.sourceTraitCodes.map((code) => canonicalTraitCode(code)).filter(Boolean)
      )
      const sourceTable = normalizeLogicalSourceTable(rule.sourceTable)
      const matched = factualRows.filter((row) => {
        const code = canonicalTraitCode(row.traitCode)
        if (!code || !sourceCodes.has(code)) return false
        if (
          sourceTable !== 'phenotype_fact' &&
          normalizeLogicalSourceTable(row.sourceTable) !== sourceTable
        )
          return false
        if (!matchesLogicalParityMode(row, rule)) return false
        if (rule.periodScope === 'lactation_305') {
          const dim = numericValue(row.daysInMilk)
          if (dim === null || dim < 1 || dim > 305) return false
        }
        if (
          rule.ruleType !== 'period_days' &&
          rule.aggregation !== 'count' &&
          numericValue(logicalSourceValue(row, rule)) === null
        )
          return false
        return true
      })
      const grouped = new Map<string, ExportRow[]>()
      matched.forEach((row) => {
        const key = recordAggregationRuleGroupKey(row, rule)
        grouped.set(key, [...(grouped.get(key) || []), row])
      })
      grouped.forEach((group) => {
        const sorted = group
          .slice()
          .sort((left, right) =>
            logicalSourceDate(left, rule).localeCompare(logicalSourceDate(right, rule))
          )
        const first = sorted[0]
        const last = sorted[sorted.length - 1] || first
        if (first && last)
          pushRecordAggregationObservation(rows, rule, sorted, first, last, cowContext)
      })
    })
    return rows
  }

  function recordAggregationRuleGroupKey(row: ExportRow, rule: LogicalTraitRule) {
    const base = [cowGroupKey(row)]
    base.push(logicalPeriodKey(rowWithRuleDate(row, rule), rule.periodScope))
    return base.join('|')
  }

  function pushRecordAggregationObservation(
    rows: ExportRow[],
    rule: LogicalTraitRule,
    group: ExportRow[],
    first: ExportRow,
    last: ExportRow,
    cowContext: ReturnType<typeof buildCowContext>
  ) {
    const values = group
      .map((row) => numericValue(logicalSourceValue(row, rule)))
      .filter((value): value is number => value !== null)
    const value =
      rule.ruleType === 'period_days'
        ? periodSpanDays(group, rule)
        : aggregateNumericForRule(values, group, rule)
    if (numericValue(value) === null) return
    const cow =
      cowContext.byId.get(str(first.cowId || last.cowId)) ||
      cowContext.byNumber.get(str(first.cowNumber || last.cowNumber)) ||
      normalizeCowContext({})
    const period = recordAggregationPeriodLabel(first, rule)
    const sourceRecordIds = uniqueJoined(
      group.map((row) =>
        str(row.sourceRecordIds || [row.sourceTable, row.sourceRecordId].filter(Boolean).join(':'))
      )
    )
    const item = normalizeObservation({
      id: `record-aggregation-${rule.outputTraitCode || rule.code}-${sanitizeKey(str(first.cowId || first.cowNumber))}-${sanitizeKey(period)}`,
      recordType: rule.ruleType === 'period_days' ? '周期天数性状' : '记录聚合性状',
      cowId: str(first.cowId || cow.id),
      cowNumber: str(first.cowNumber || cow.cowNumber),
      cowName: str(first.cowName || cow.cowName),
      breed: firstRealBreed(first.breed, cow.breed),
      currentPen: str(first.currentPen || cow.currentPen),
      herdGroup: str(first.herdGroup || cow.herdGroup),
      productionStage: str(first.productionStage || cow.productionStage),
      status: str(first.status || cow.status),
      category: rule.category,
      traitCode: rule.outputTraitCode || rule.code,
      traitName: rule.name,
      collectionDate: logicalSourceDate(last, rule) || dateValue(last),
      value,
      unit: rule.unit,
      parity: first.parity,
      currentParity: first.currentParity || cow.currentParity || cow.parity,
      cowCurrentParity: first.cowCurrentParity || cow.currentParity || cow.parity,
      daysInMilk: first.daysInMilk,
      reproductionCycle: first.reproductionCycle || cow.reproductionCycle,
      pregnancyStage: first.pregnancyStage || cow.pregnancyStage,
      dryPeriod: first.dryPeriod || cow.dryPeriod,
      source: '性状规则计算',
      equipmentId: dominantValue(group, 'equipmentId'),
      collector: dominantValue(group, 'collector'),
      operatorName: dominantValue(group, 'operatorName'),
      notes: `${rule.sourceTraitCodes.join('、')} ${period} ${aggregationLabel(rule.aggregation)}`,
      sourceTable:
        rule.ruleType === 'period_days' ? 'period_days_trait' : 'record_aggregation_trait',
      sourceRecordId: `${rule.outputTraitCode || rule.code}:${sourceRecordIds}`,
      sourceRecordIds,
      ...pickPedigreeValues(first, cow)
    })
    if (item) rows.push(item)
  }

  function recordAggregationPeriodLabel(row: ExportRow, rule: LogicalTraitRule) {
    return logicalPeriodLabel(rowWithRuleDate(row, rule), rule.periodScope)
  }

  function aggregateNumericForRule(values: number[], group: ExportRow[], rule: LogicalTraitRule) {
    if (rule.aggregation === 'count') return group.length
    if (!values.length) return ''
    if (rule.aggregation === 'sum') return round(values.reduce((sum, value) => sum + value, 0))
    if (rule.aggregation === 'avg')
      return round(values.reduce((sum, value) => sum + value, 0) / values.length)
    if (rule.aggregation === 'min') return Math.min(...values)
    if (rule.aggregation === 'max') return Math.max(...values)
    if (rule.aggregation === 'median') {
      const sorted = values.slice().sort((left, right) => left - right)
      const mid = Math.floor(sorted.length / 2)
      return round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
    }
    if (rule.aggregation === 'latest') {
      const latest = group
        .slice()
        .sort((left, right) =>
          logicalSourceDate(right, rule).localeCompare(logicalSourceDate(left, rule))
        )[0]
      return logicalSourceValue(latest, rule)
    }
    return values[0] ?? ''
  }

  function periodSpanDays(group: ExportRow[], rule: LogicalTraitRule) {
    const explicitBounds = group
      .map((row) => {
        const start = Date.parse(
          str(
            row.startDate || row.start_date || row.periodStart || row.period_start || row.firstDate
          )
        )
        const end = Date.parse(
          str(row.endDate || row.end_date || row.periodEnd || row.period_end || row.lastDate)
        )
        return Number.isFinite(start) && Number.isFinite(end) && end >= start
          ? Math.round((end - start) / 86400000) + 1
          : null
      })
      .filter((value): value is number => value !== null)
    if (explicitBounds.length) return Math.max(...explicitBounds)
    const times = group
      .map((row) => Date.parse(logicalSourceDate(row, rule)))
      .filter((time) => Number.isFinite(time))
      .sort((left, right) => left - right)
    if (times.length < 2) return defaultPeriodDays(group[0], rule)
    return Math.round((times[times.length - 1] - times[0]) / 86400000)
  }

  function defaultPeriodDays(row: ExportRow | undefined, rule: LogicalTraitRule) {
    if (!row) return ''
    if (rule.periodScope === 'day') return 1
    if (rule.periodScope === 'week' || rule.periodScope === 'rolling_7') return 7
    if (rule.periodScope === 'ten_day') return 10
    if (rule.periodScope === 'half_month') return 15
    if (rule.periodScope === 'month' || rule.periodScope === 'rolling_30') return 30
    if (
      rule.periodScope === 'quarter' ||
      rule.periodScope === 'season' ||
      rule.periodScope === 'rolling_90'
    )
      return 90
    if (rule.periodScope === 'half_year') return 183
    if (rule.periodScope === 'year') return 365
    if (rule.periodScope === 'lactation_305') return 305
    const dim = numericValue(row.daysInMilk)
    if (rule.periodScope === 'lactation' && dim !== null) return Math.max(1, dim)
    return 1
  }

  function logicalSourceValue(row: ExportRow, rule: LogicalTraitRule) {
    const field = rule.sourceValueField || 'value'
    return row[field] ?? row.value
  }

  function logicalSourceDate(row: ExportRow, rule: LogicalTraitRule) {
    const field = rule.sourceDateField || 'collectionDate'
    return str(row[field] || dateValue(row))
  }

  function rowWithRuleDate(row: ExportRow, rule: LogicalTraitRule): ExportRow {
    return {
      ...row,
      collectionDate: logicalSourceDate(row, rule),
      eventDate: logicalSourceDate(row, rule)
    }
  }

  function normalizeLogicalSourceTable(value: unknown) {
    const text = str(value).replace(/-/g, '_')
    if (!text || text === 'phenotype_fact') return 'phenotype_fact'
    return text
  }

  function matchesLogicalSourceTable(row: ExportRow, sourceTable?: string) {
    const expected = normalizeLogicalSourceTable(sourceTable || 'animal_event')
    if (!expected || expected === 'phenotype_fact') return true
    return normalizeLogicalSourceTable(row.sourceTable) === expected
  }

  function buildEventIntervalObservationRows(
    eventRows: ExportRow[],
    cowContext: ReturnType<typeof buildCowContext>
  ): ExportRow[] {
    const rows: ExportRow[] = []
    const grouped = new Map<string, ExportRow[]>()
    eventRows.forEach((row) => {
      const key = cowGroupKey(row)
      if (!key || eventTime(row) === null) return
      grouped.set(key, [...(grouped.get(key) || []), row])
    })

    grouped.forEach((group) => {
      const sorted = group.slice().sort(compareEventsByTime)
      activeEventIntervalTraitSpecs.value.forEach((spec) => {
        const scoped = sorted.filter((row) => matchesLogicalSourceTable(row, spec.sourceTable))
        if (spec.mode === 'consecutive_same_type') {
          const typed = scoped.filter((row) => matchesEventTypes(row, spec.endEventTypes))
          typed.forEach((end, index) => {
            if (index === 0) return
            pushIntervalObservation(rows, spec, typed[index - 1], end, cowContext)
          })
          return
        }

        if (spec.mode === 'latest_before_end') {
          const ends = scoped.filter((row) => matchesEventTypes(row, spec.endEventTypes))
          ends.forEach((end) => {
            const endTime = eventTime(end)
            if (endTime === null) return
            const candidates = scoped.filter(
              (row) =>
                matchesEventTypes(row, spec.startEventTypes) &&
                eventTime(row) !== null &&
                eventTime(row)! <= endTime &&
                intervalPairKey(row) !== intervalPairKey(end)
            )
            const start = selectLatestStartEvent(candidates, end, spec.parityRelation)
            if (start) pushIntervalObservation(rows, spec, start, end, cowContext)
          })
          return
        }

        const starts = scoped.filter((row) => matchesEventTypes(row, spec.startEventTypes))
        starts.forEach((start, index) => {
          const startTime = eventTime(start)
          if (startTime === null) return
          const nextStartTime = starts
            .slice(index + 1)
            .map(eventTime)
            .find((value): value is number => value !== null)
          const candidates = scoped.filter((row) => {
            const time = eventTime(row)
            if (!matchesEventTypes(row, spec.endEventTypes) || time === null || time < startTime)
              return false
            if (intervalPairKey(row) === intervalPairKey(start)) return false
            return nextStartTime === undefined || time < nextStartTime
          })
          const end = selectFirstEndEvent(candidates, start, spec.parityRelation)
          if (end) pushIntervalObservation(rows, spec, start, end, cowContext)
        })
      })
    })
    return rows
  }

  function buildEventCountObservationRows(
    eventRows: ExportRow[],
    cowContext: ReturnType<typeof buildCowContext>
  ): ExportRow[] {
    const rows: ExportRow[] = []
    const rules = activeLogicalTraitRules.value.filter(
      (rule) => rule.ruleType === 'event_count' && rule.startEventTypes.length
    )
    rules.forEach((rule) => {
      const matched = eventRows.filter(
        (row) =>
          matchesLogicalSourceTable(row, rule.sourceTable) &&
          matchesEventTypes(row, rule.startEventTypes) &&
          eventTime(row) !== null &&
          matchesLogicalParityMode(row, rule)
      )
      const grouped = new Map<string, ExportRow[]>()
      matched.forEach((row) => {
        const key = eventCountRuleGroupKey(row, rule)
        grouped.set(key, [...(grouped.get(key) || []), row])
      })
      grouped.forEach((group) => {
        const sorted = group.slice().sort(compareEventsByTime)
        const first = sorted[0]
        const last = sorted[sorted.length - 1] || first
        if (first && last) pushEventCountObservation(rows, rule, sorted, first, last, cowContext)
      })
    })
    return rows
  }

  function eventCountRuleGroupKey(row: ExportRow, rule: LogicalTraitRule) {
    const base = [cowGroupKey(row)]
    base.push(logicalPeriodKey(row, rule.periodScope))
    return base.join('|')
  }

  function matchesLogicalParityMode(row: ExportRow, rule: LogicalTraitRule) {
    const parity = numericValue(row.parity)
    if (rule.parityMode === 'none') return true
    if (parity === null) return false
    const currentParity = numericValue(row.currentParity)
    if (rule.parityMode === 'specific') return rule.parityOffset > 0 && parity === rule.parityOffset
    if (rule.parityMode === 'relative_from_current') {
      const cowCurrentParity = numericValue(row.cowCurrentParity)
      if (cowCurrentParity === null) return false
      const target = cowCurrentParity + rule.parityOffset + 1
      return target > 0 && parity === target
    }
    if (rule.parityMode === 'current') {
      const cowCurrentParity = numericValue(row.cowCurrentParity)
      const base = cowCurrentParity !== null ? cowCurrentParity : currentParity
      if (base === null) return false
      const offset = Number(rule.parityOffset || 0)
      const target = offset < 0 ? base + offset + 1 : base
      return target > 0 && parity === target
    }
    return true
  }

  function pushEventCountObservation(
    rows: ExportRow[],
    rule: LogicalTraitRule,
    group: ExportRow[],
    first: ExportRow,
    last: ExportRow,
    cowContext: ReturnType<typeof buildCowContext>
  ) {
    const cow =
      cowContext.byId.get(str(first.cowId || last.cowId)) ||
      cowContext.byNumber.get(str(first.cowNumber || last.cowNumber)) ||
      normalizeCowContext({})
    const sourceRecordIds = uniqueJoined(group.map((row) => eventSourceToken(row)))
    const period = eventCountPeriodLabel(first, rule)
    const item = normalizeObservation({
      id: `event-count-${rule.outputTraitCode || rule.code}-${sanitizeKey(str(first.cowId || first.cowNumber))}-${sanitizeKey(period)}`,
      recordType: '事件次数性状',
      cowId: str(first.cowId || cow.id),
      cowNumber: str(first.cowNumber || cow.cowNumber),
      cowName: str(cow.cowName),
      breed: firstRealBreed(first.breed, cow.breed),
      currentPen: str(first.currentPen || cow.currentPen),
      herdGroup: str(first.herdGroup || cow.herdGroup),
      productionStage: str(first.productionStage || cow.productionStage),
      status: str(first.status || cow.status),
      category: rule.category,
      traitCode: rule.outputTraitCode || rule.code,
      traitName: rule.name,
      collectionDate: eventDateKey(last),
      value: group.length,
      unit: rule.unit || '次',
      parity: first.parity,
      currentParity: first.currentParity || cow.currentParity || cow.parity,
      cowCurrentParity: first.cowCurrentParity || cow.currentParity || cow.parity,
      reproductionCycle: first.reproductionCycle || cow.reproductionCycle,
      pregnancyStage: first.pregnancyStage || cow.pregnancyStage,
      dryPeriod: first.dryPeriod || cow.dryPeriod,
      source: '事件记录计算',
      operatorName: dominantValue(group, 'operatorName'),
      notes: `${eventTypeLabel(rule.startEventTypes[0])} ${period} 发生 ${group.length} 次`,
      sourceTable: 'event_count_trait',
      sourceRecordId: `${rule.outputTraitCode || rule.code}:${sourceRecordIds}`,
      sourceRecordIds,
      ...pickPedigreeValues(first, cow)
    })
    if (item) rows.push(item)
  }

  function eventCountPeriodLabel(row: ExportRow, rule: LogicalTraitRule) {
    return logicalPeriodLabel(row, rule.periodScope)
  }

  function logicalPeriodKey(row: ExportRow, groupBy: GroupBy | string) {
    if (groupBy === 'cow') return '单牛'
    if (groupBy === 'parity') return `胎次:${str(row.parity || '未填')}`
    if (groupBy === 'parity_calving_date') return `本胎产犊时间:${parityCalvingDateValue(row)}`
    if (groupBy === 'lactation') return lactationKey(row)
    if (groupBy === 'lactation_305') return `${lactationKey(row)}:305`
    if (groupBy === 'lactation_stage') return lactationStageValue(row)
    if (groupBy === 'dim_bucket') return dimBucketValue(row)
    if (groupBy === 'reproduction_cycle')
      return `繁殖周期:${cycleValue(row, 'reproductionCycle', '未填')}`
    if (groupBy === 'pregnancy') return `妊娠期:${cycleValue(row, 'pregnancyStage', '未填')}`
    if (groupBy === 'dry_period') return `干奶期:${cycleValue(row, 'dryPeriod', '未填')}`
    if (groupBy === 'herd_group') return `牛群:${str(row.herdGroup || '未填')}`
    if (groupBy === 'pen') return `圈舍:${displayPenValue(row.currentPen) || '未填'}`
    if (groupBy === 'production_stage')
      return `生产阶段:${str(row.productionStage || row.type || row.status || '未填')}`
    if (groupBy === 'milking_shift') return milkingShiftValue(row)
    if (groupBy === 'equipment') return `设备:${equipmentValue(row)}`
    if (groupBy === 'collector') return `采集人:${collectorValue(row)}`
    if (groupBy === 'operator') return `操作人:${operatorValue(row)}`
    return `${groupBy}:${periodValue(row, groupBy as GroupBy)}`
  }

  function logicalPeriodLabel(row: ExportRow, groupBy: GroupBy | string) {
    if (groupBy === 'cow') return '单牛汇总'
    if (groupBy === 'parity') return row.parity ? `第 ${row.parity} 胎` : '胎次未填'
    if (groupBy === 'parity_calving_date') return parityCalvingDateValue(row)
    if (groupBy === 'lactation') return lactationKey(row)
    if (groupBy === 'lactation_305') return row.parity ? `第 ${row.parity} 胎 1-305天` : '1-305天'
    if (groupBy === 'lactation_stage') return lactationStageValue(row)
    if (groupBy === 'dim_bucket') return dimBucketValue(row)
    if (groupBy === 'reproduction_cycle')
      return cycleValue(row, 'reproductionCycle', '繁殖周期未填')
    if (groupBy === 'pregnancy') return cycleValue(row, 'pregnancyStage', '妊娠期未填')
    if (groupBy === 'dry_period') return cycleValue(row, 'dryPeriod', '干奶期未填')
    if (groupBy === 'herd_group') return str(row.herdGroup || '牛群未填')
    if (groupBy === 'pen') return displayPenValue(row.currentPen) || '圈舍未填'
    if (groupBy === 'production_stage')
      return str(row.productionStage || row.type || row.status || '生产阶段未填')
    if (groupBy === 'milking_shift') return milkingShiftValue(row)
    if (groupBy === 'equipment') return equipmentValue(row)
    if (groupBy === 'collector') return collectorValue(row)
    if (groupBy === 'operator') return operatorValue(row)
    return periodValue(row, groupBy as GroupBy)
  }

  function pushIntervalObservation(
    rows: ExportRow[],
    spec: EventIntervalTraitSpec,
    start: ExportRow,
    end: ExportRow,
    cowContext: ReturnType<typeof buildCowContext>
  ) {
    const startTime = eventTime(start)
    const endTime = eventTime(end)
    if (startTime === null || endTime === null) return
    const days = Math.round((endTime - startTime) / 86400000)
    if (!Number.isFinite(days) || days < 0) return
    const cow =
      cowContext.byId.get(str(end.cowId || start.cowId)) ||
      cowContext.byNumber.get(str(end.cowNumber || start.cowNumber)) ||
      normalizeCowContext({})
    const sourceRecordIds = uniqueJoined([eventSourceToken(start), eventSourceToken(end)])
    const startDate = eventDateKey(start)
    const endDate = eventDateKey(end)
    const qualityNote = intervalQualityNote(spec, days)
    const item = normalizeObservation({
      id: `interval-${spec.code}-${sanitizeKey(str(start.sourceTable))}-${sanitizeKey(str(start.sourceRecordId || start.id))}-${sanitizeKey(str(end.sourceTable))}-${sanitizeKey(str(end.sourceRecordId || end.id))}`,
      recordType: '事件间隔性状',
      cowId: str(end.cowId || start.cowId || cow.id),
      cowNumber: str(end.cowNumber || start.cowNumber || cow.cowNumber),
      cowName: str(cow.cowName),
      breed: firstRealBreed(end.breed, start.breed, cow.breed),
      currentPen: str(end.currentPen || start.currentPen || cow.currentPen),
      herdGroup: str(end.herdGroup || start.herdGroup || cow.herdGroup),
      productionStage: str(end.productionStage || start.productionStage || cow.productionStage),
      status: str(end.status || start.status || cow.status),
      category: spec.category,
      traitCode: spec.code,
      traitName: spec.name,
      collectionDate: endDate,
      value: days,
      unit: spec.unit,
      parity: end.parity || start.parity,
      currentParity: end.currentParity || start.currentParity || cow.currentParity || cow.parity,
      cowCurrentParity:
        end.cowCurrentParity || start.cowCurrentParity || cow.currentParity || cow.parity,
      reproductionCycle: end.reproductionCycle || start.reproductionCycle || cow.reproductionCycle,
      pregnancyStage: end.pregnancyStage || start.pregnancyStage || cow.pregnancyStage,
      dryPeriod: end.dryPeriod || start.dryPeriod || cow.dryPeriod,
      source: '事件记录计算',
      operatorName: str(end.operatorName || start.operatorName),
      notes: `${eventTypeLabel(start.eventType)} ${startDate} 至 ${eventTypeLabel(end.eventType)} ${endDate}${qualityNote ? `；${qualityNote}` : ''}`,
      sourceTable: 'event_interval_trait',
      sourceRecordId: `${spec.code}:${str(start.sourceRecordId || start.id)}>${str(end.sourceRecordId || end.id)}`,
      sourceRecordIds,
      ...pickPedigreeValues(end, start, cow)
    })
    if (item) rows.push(item)
  }

  function matchesEventTypes(row: ExportRow, eventTypes: string[]) {
    const type = normalizeEventType(row.eventType || row.eventTypeLabel)
    return eventTypes.includes(type)
  }

  function selectLatestStartEvent(
    candidates: ExportRow[],
    end: ExportRow,
    relation: EventIntervalParityRelation
  ) {
    const scoped = filterEventsByParityRelation(candidates, end, relation, 'latest_before_end')
    return scoped
      .slice()
      .sort(
        (left, right) =>
          parityRank(left, end, relation, 'latest_before_end') -
            parityRank(right, end, relation, 'latest_before_end') ||
          compareEventsByTime(right, left)
      )[0]
  }

  function selectFirstEndEvent(
    candidates: ExportRow[],
    start: ExportRow,
    relation: EventIntervalParityRelation
  ) {
    const scoped = filterEventsByParityRelation(candidates, start, relation, 'first_after_start')
    return scoped
      .slice()
      .sort(
        (left, right) =>
          parityRank(left, start, relation, 'first_after_start') -
            parityRank(right, start, relation, 'first_after_start') ||
          compareEventsByTime(left, right)
      )[0]
  }

  function filterEventsByParityRelation(
    candidates: ExportRow[],
    anchor: ExportRow,
    relation: EventIntervalParityRelation,
    mode: EventIntervalMode
  ) {
    if (relation === 'none') return candidates
    const strict = candidates.filter(
      (candidate) => parityRank(candidate, anchor, relation, mode) < 2
    )
    return strict
  }

  function parityRank(
    candidate: ExportRow,
    anchor: ExportRow,
    relation: EventIntervalParityRelation,
    mode: EventIntervalMode
  ) {
    if (relation === 'none') return 0
    const candidateParity = numericValue(candidate.parity)
    const anchorParity = numericValue(anchor.parity)
    if (candidateParity === null || anchorParity === null) return 2
    if (relation === 'same') return candidateParity === anchorParity ? 0 : 3
    if (relation === 'previous_to_current')
      return candidateParity === anchorParity - 1 ? 0 : candidateParity === anchorParity ? 1 : 3
    if (candidateParity === anchorParity) return 0
    if (mode === 'latest_before_end' && candidateParity === anchorParity - 1) return 1
    if (mode === 'first_after_start' && candidateParity === anchorParity + 1) return 1
    return 3
  }

  function compareEventsByTime(left: ExportRow, right: ExportRow) {
    const timeDiff = (eventTime(left) ?? 0) - (eventTime(right) ?? 0)
    if (timeDiff) return timeDiff
    return intervalPairKey(left).localeCompare(intervalPairKey(right), 'zh-CN')
  }

  function eventTime(row: ExportRow) {
    const time = Date.parse(str(row.eventDate || row.collectionDate || row.createdAt || row.period))
    return Number.isFinite(time) ? time : null
  }

  function eventDateKey(row: ExportRow) {
    return (
      dateKeys(row.eventDate || row.collectionDate || row.createdAt || row.period).dateKey ||
      str(row.eventDate || row.collectionDate || row.createdAt || row.period)
    )
  }

  function eventSourceToken(row: ExportRow) {
    return str(
      row.sourceRecordIds || [row.sourceTable, row.sourceRecordId].filter(Boolean).join(':')
    )
  }

  function buildParityEpisodeSeedRows(
    rows: any[],
    sourceTable: string,
    cowContext: ReturnType<typeof buildCowContext>
  ): ExportRow[] {
    const seen = new Set<string>()
    return rows
      .map((row) => {
        const animalId = str(row.animalId || row.animal_id || row.cowId || row.cow_id)
        const animalNumber = str(
          row.animalNumber || row.animal_number || row.cowNumber || row.cow_number
        )
        const cow =
          cowContext.byId.get(animalId) ||
          cowContext.byNumber.get(animalNumber) ||
          normalizeCowContext(row)
        const cowId = str(animalId || cow.id)
        const cowNumber = str(animalNumber || cow.cowNumber)
        const startDate = parityCalvingDateOf(row)
        const startTime = Date.parse(startDate)
        if ((!cowId && !cowNumber) || !startDate || !Number.isFinite(startTime)) return null
        const parity = parityValueOf(row)
        const key = [cowId || cowNumber, parity || '', startDate].join('|')
        if (seen.has(key)) return null
        seen.add(key)
        return {
          id: `${sourceTable}:${str(row.id || key)}`,
          cowKey: cowId || cowNumber,
          cowId,
          cowNumber,
          eventType: 'calving',
          eventTypeLabel: '产犊',
          eventDate: startDate,
          parity: numberOrBlank(parity),
          currentParity: numberOrBlank(parity),
          parityCalvingDate: startDate,
          sourceTable,
          sourceRecordId: str(row.id || key)
        }
      })
      .filter(Boolean) as ExportRow[]
  }

  function buildParityResolver(eventRows: ExportRow[]) {
    const byCow = new Map<
      string,
      Array<{
        parity: number
        startTime: number
        endTime: number | null
        startDate: string
        endDate: string
      }>
    >()
    const grouped = new Map<string, ExportRow[]>()
    eventRows
      .filter((row) => matchesEventTypes(row, ['calving']) && eventTime(row) !== null)
      .sort(compareEventsByTime)
      .forEach((row) => {
        const key = parityCowKey(row)
        if (!key) return
        grouped.set(key, [...(grouped.get(key) || []), row])
      })
    grouped.forEach((rows, cowKey) => {
      const windows = rows.map((row, index) => {
        const next = rows[index + 1]
        const explicitParity = numericValue(row.parity)
        return {
          parity: explicitParity && explicitParity > 0 ? explicitParity : index + 1,
          startTime: eventTime(row)!,
          endTime: next ? eventTime(next) : null,
          startDate: eventDateKey(row),
          endDate: next ? eventDateKey(next) : ''
        }
      })
      byCow.set(cowKey, windows)
      rows.forEach((row) => {
        parityCowKeys(row).forEach((key) => {
          if (!byCow.has(key)) byCow.set(key, windows)
        })
      })
    })
    return {
      resolve(row: ExportRow) {
        const time = Date.parse(dateValue(row))
        if (!Number.isFinite(time)) return null
        const keys = parityCowKeys(row)
        for (const key of keys) {
          const window = byCow
            .get(key)
            ?.find(
              (item) => time >= item.startTime && (item.endTime === null || time < item.endTime)
            )
          if (window) return window
        }
        return null
      }
    }
  }

  function parityCowKey(row: ExportRow) {
    return cowGroupKey(row)
  }

  function parityCowKeys(row: ExportRow) {
    return Array.from(
      new Set(
        [str(row.cowKey), str(row.cowId), str(row.cowNumber), parityCowKey(row)].filter(Boolean)
      )
    )
  }

  function applyParityResolution(
    row: ExportRow,
    parityResolver: ReturnType<typeof buildParityResolver>
  ): ExportRow {
    const resolved = parityResolver.resolve(row)
    if (!resolved) return row
    const explicitParity = numericValue(row.parity)
    const currentParity = numericValue(row.currentParity)
    const cowCurrentParity = numericValue(row.cowCurrentParity)
    const explicitDim = numericValue(row.daysInMilk)
    const rowTime = Date.parse(dateValue(row))
    const resolvedDim = Number.isFinite(rowTime)
      ? Math.max(1, Math.floor((rowTime - resolved.startTime) / 86400000) + 1)
      : null
    const daysInMilk = explicitDim && explicitDim > 0 ? explicitDim : resolvedDim
    return {
      ...row,
      parity: explicitParity && explicitParity > 0 ? explicitParity : resolved.parity,
      currentParity: currentParity && currentParity > 0 ? currentParity : resolved.parity,
      cowCurrentParity:
        cowCurrentParity && cowCurrentParity > 0 ? cowCurrentParity : row.cowCurrentParity,
      daysInMilk: daysInMilk ?? row.daysInMilk,
      daysInMilkRange:
        row.daysInMilkRange || (daysInMilk ? String(daysInMilk) : row.daysInMilkRange),
      parityCalvingDate: row.parityCalvingDate || resolved.startDate,
      reproductionCycle: row.reproductionCycle || `第 ${resolved.parity} 胎繁殖周期`
    }
  }

  function intervalPairKey(row: ExportRow) {
    return str(
      row.sourceRecordIds ||
        [row.sourceTable, row.sourceRecordId || row.id].filter(Boolean).join(':')
    )
  }

  function intervalQualityNote(spec: EventIntervalTraitSpec, days: number) {
    if (spec.minDays !== undefined && days < spec.minDays)
      return `低于常用核查阈值 ${spec.minDays} 天`
    if (spec.maxDays !== undefined && days > spec.maxDays)
      return `高于常用核查阈值 ${spec.maxDays} 天`
    return ''
  }

  function normalizeObservation(input: ObservationInput): ExportRow | null {
    const value = numericValue(input.value)
    if (value === null) return null
    const keys = dateKeys(input.collectionDate)
    const sourceRecordIds =
      input.sourceRecordIds || [input.sourceTable, input.sourceRecordId].filter(Boolean).join(':')
    const traitCode = canonicalTraitCode(input.traitCode)
    return {
      id: input.id,
      recordType: input.recordType,
      cowKey: str(input.cowId || input.cowNumber || sourceRecordKey(input)),
      cowId: input.cowId,
      cowNumber: input.cowNumber,
      cowName: input.cowName || '',
      breed: firstRealBreed(input.breed),
      currentPen: input.currentPen || '',
      herdGroup: input.herdGroup || '',
      productionStage: input.productionStage || '',
      status: input.status || '',
      category: input.category,
      traitCode,
      traitName: input.traitName,
      period: keys.dateKey || '-',
      collectionDate: keys.dateKey,
      firstDate: keys.dateKey,
      lastDate: keys.dateKey,
      value,
      unit: input.unit || '',
      milkingShift: milkingShiftValue(input),
      aggregation: '原始值',
      recordCount: 1,
      parity: numberOrBlank(input.parity),
      currentParity: numberOrBlank(input.currentParity),
      cowCurrentParity: numberOrBlank(input.cowCurrentParity ?? input.currentParity),
      parityCalvingDate: str(input.parityCalvingDate),
      reproductionCycle: str(input.reproductionCycle),
      pregnancyStage: str(input.pregnancyStage),
      dryPeriod: str(input.dryPeriod),
      daysInMilk: numberOrBlank(input.daysInMilk),
      daysInMilkRange:
        input.daysInMilk === undefined || input.daysInMilk === '' ? '' : String(input.daysInMilk),
      source: input.source || '',
      equipmentId: input.equipmentId || '',
      collector: input.collector || '',
      operatorName: input.operatorName || '',
      notes: input.notes || '',
      sourceTable: input.sourceTable,
      sourceRecordId: input.sourceRecordId,
      sourceRecordIds,
      ...pickPedigreeValues(input)
    }
  }

  function applyFilters(rows: ExportRow[]) {
    const filters = configForm.filters
    const cowKeyword = filters.cowNumber.trim().toLowerCase()
    const paritySelections = normalizeParitySelections(filters.paritySelections)
    return rows.filter((row) => {
      if (
        cowKeyword &&
        ![row.cowNumber, row.earTagNumber, row.cowName].join(' ').toLowerCase().includes(cowKeyword)
      )
        return false
      if (filters.breeds.length && !filters.breeds.includes(str(row.breed))) return false
      if (filters.statuses.length && !filters.statuses.includes(str(row.status))) return false
      if (filters.pens.length && !filters.pens.includes(displayPenValue(row.currentPen)))
        return false
      if (filters.genders.length && !filters.genders.includes(str(row.gender))) return false
      if (filters.eventTypes.length) {
        const eventType = str(row.eventType)
        if (!eventType || !filters.eventTypes.includes(eventType)) return false
      }
      if (filters.traitCategories.length) {
        const category = str(row.category)
        if (!category || !filters.traitCategories.includes(category)) return false
      }
      if (filters.traitCodes.length) {
        const traitCode = canonicalTraitCode(row.traitCode)
        if (!traitCode || !filters.traitCodes.includes(traitCode)) return false
      }
      const parity = numericValue(row.parity)
      if (filters.parityMin !== null && (parity === null || parity < filters.parityMin))
        return false
      if (filters.parityMax !== null && (parity === null || parity > filters.parityMax))
        return false
      if (!matchesParitySelections(row, paritySelections)) return false
      const dim = numericValue(row.daysInMilk)
      if (filters.dimMin !== null && (dim === null || dim < filters.dimMin)) return false
      if (filters.dimMax !== null && (dim === null || dim > filters.dimMax)) return false
      if (filters.dateRange.length === 2) {
        const rowTime = Date.parse(dateValue(row))
        const start = Date.parse(filters.dateRange[0])
        const endExclusive = Date.parse(filters.dateRange[1]) + 86400000
        if (!Number.isFinite(rowTime)) return false
        if (Number.isFinite(start) && rowTime < start) return false
        if (Number.isFinite(endExclusive) && rowTime >= endExclusive) return false
      }
      return true
    })
  }

  function matchesParitySelections(row: ExportRow, selections: number[]) {
    if (!selections.length) return true
    const parity = numericValue(row.parity)
    if (parity === null) return false
    const currentParity = numericValue(row.cowCurrentParity)
    const fallbackCurrentParity = currentParity ?? numericValue(row.currentParity)
    return selections.some((selection) => {
      if (selection > 0) return parity === selection
      if (fallbackCurrentParity === null) return false
      const targetParity = fallbackCurrentParity + selection + 1
      return targetParity > 0 && parity === targetParity
    })
  }

  function normalizeParitySelections(values: unknown) {
    const list = Array.isArray(values) ? values : [values]
    return Array.from(
      new Set(
        list
          .map((value) => {
            const text = str(value)
            if (!text) return null
            const match = text.match(/-?\d+/)
            return match ? Number(match[0]) : null
          })
          .filter((value): value is number => Number.isInteger(value) && value !== 0)
      )
    )
  }

  function normalizeParitySelectionStrings(values: unknown) {
    return normalizeParitySelections(values).map(String)
  }

  function aggregateRows(rows: ExportRow[], strategy: ExportStrategy) {
    if (configForm.period.groupBy === 'raw' && configForm.aggregation === 'raw') return rows
    const groupMap = new Map<string, ExportRow[]>()
    rows.forEach((row) => {
      if (configForm.period.groupBy === 'lactation_305') {
        const dim = numericValue(row.daysInMilk)
        if (dim === null || dim < 1 || dim > 305) return
      }
      const key = groupKey(row, strategy)
      groupMap.set(key, [...(groupMap.get(key) || []), row])
    })
    return Array.from(groupMap.values()).map((group) => aggregateGroup(group, strategy))
  }

  function preparePreviewRows(rows: ExportRow[], strategy: ExportStrategy) {
    return isTraitStrategy(strategy) ? pivotTraitRows(rows) : rows
  }

  function applyPostPreviewFilters(rows: ExportRow[]) {
    const field = configForm.filters.numericField
    if (!field || !hasActiveNumericFilter()) return rows
    return rows.filter((row) => passNumericFilter(row[field]))
  }

  function hasActiveNumericFilter() {
    const filters = configForm.filters
    if (!filters.numericField) return false
    if (filters.numericOperator === 'between')
      return filters.numericMin !== null || filters.numericMax !== null
    return filters.numericValue !== null
  }

  function passNumericFilter(value: unknown) {
    if (!hasActiveNumericFilter()) return true
    const numeric = numericValue(value)
    if (numeric === null) return false
    const filters = configForm.filters
    if (filters.numericOperator === 'gte' && filters.numericValue !== null)
      return numeric >= filters.numericValue
    if (filters.numericOperator === 'lte' && filters.numericValue !== null)
      return numeric <= filters.numericValue
    if (filters.numericOperator === 'eq' && filters.numericValue !== null)
      return numeric === filters.numericValue
    if (filters.numericOperator === 'between') {
      if (filters.numericMin !== null && numeric < filters.numericMin) return false
      if (filters.numericMax !== null && numeric > filters.numericMax) return false
    }
    return true
  }

  function pivotTraitRows(rows: ExportRow[]) {
    const groupMap = new Map<string, ExportRow>()
    rows.forEach((row) => {
      const code = canonicalTraitCode(row.traitCode)
      if (!code) return
      const key = traitPivotKey(row)
      const current = groupMap.get(key)
      if (current) {
        mergeTraitPivotRow(current, row, code)
        return
      }
      const next = { ...row }
      delete next.traitCode
      delete next.traitName
      delete next.value
      delete next.unit
      setTraitPivotValue(next, code, row.value)
      groupMap.set(key, next)
    })
    return Array.from(groupMap.values()).map(finalizeTraitPivotRow)
  }

  function traitPivotKey(row: ExportRow) {
    const groupBy = configForm.period.groupBy
    const base = ['datasetDomain', 'aggregation']
    if (groupBy === 'raw' && configForm.aggregation === 'raw') {
      return keyFromFields(row, [
        ...base,
        'sourceTable',
        'sourceRecordIds',
        'collectionDate',
        'cowNumber',
        'recordType',
        'parity',
        'daysInMilk',
        'equipmentId'
      ])
    }
    const grouped: Partial<Record<GroupBy, string[]>> = {
      herd_group: ['herdGroup', 'period'],
      pen: ['currentPen', 'period'],
      production_stage: ['productionStage', 'status', 'period'],
      equipment: ['equipmentId', 'period'],
      collector: ['collector', 'period'],
      operator: ['operatorName', 'period'],
      cow: ['cowNumber', 'period']
    }
    return keyFromFields(row, [
      ...base,
      ...(grouped[groupBy] || ['cowNumber', 'period']),
      'parity',
      'reproductionCycle',
      'pregnancyStage',
      'dryPeriod',
      'daysInMilkRange'
    ])
  }

  function keyFromFields(row: ExportRow, fields: string[]) {
    return fields.map((field) => `${field}:${str(row[field])}`).join('|')
  }

  function mergeTraitPivotRow(target: ExportRow, row: ExportRow, code: string) {
    setTraitPivotValue(target, code, row.value)
    target.sourceTable = uniqueJoined([target.sourceTable, row.sourceTable])
    target.sourceRecordIds = uniqueJoined([target.sourceRecordIds, row.sourceRecordIds])
    target.sourceRecordId = target.sourceRecordIds
    target.cowNumbers = uniqueJoined([target.cowNumbers, row.cowNumbers, row.cowNumber])
    target.recordCount = mergeNumericTotal(target.recordCount, row.recordCount)
    if (!target.firstDate || compareValues(row.firstDate, target.firstDate) < 0)
      target.firstDate = row.firstDate
    if (!target.lastDate || compareValues(row.lastDate, target.lastDate) > 0)
      target.lastDate = row.lastDate
  }

  function setTraitPivotValue(row: ExportRow, code: string, value: unknown) {
    const key = traitValueKey(code)
    if (row[key] === undefined || row[key] === '') {
      row[key] = value
    }
  }

  function finalizeTraitPivotRow(row: ExportRow) {
    if (row.cowNumbers) {
      const cowNumbers = splitJoined(row.cowNumbers)
      row.cowNumbers = cowNumbers.join('、')
      row.cowCount = cowNumbers.length || row.cowCount
    } else if (row.cowNumber && !row.cowCount) {
      row.cowNumbers = str(row.cowNumber)
      row.cowCount = 1
    }
    return row
  }

  function mergeNumericTotal(left: unknown, right: unknown) {
    const leftValue = numericValue(left)
    const rightValue = numericValue(right)
    if (leftValue === null) return rightValue ?? ''
    if (rightValue === null) return leftValue
    return leftValue + rightValue
  }

  function uniqueJoined(values: unknown[]) {
    return splitJoined(values).join('、')
  }

  function splitJoined(values: unknown) {
    const array = Array.isArray(values) ? values : [values]
    return Array.from(
      new Set(
        array
          .flatMap((value) => str(value).split(/[、,，;]/))
          .map((item) => item.trim())
          .filter(Boolean)
      )
    )
  }

  function cowGroupKey(row: ExportRow) {
    return str(row.cowKey || row.cowId || row.cowNumber || sourceRecordKey(row))
  }

  function groupKey(row: ExportRow, strategy: ExportStrategy) {
    const groupBy = configForm.period.groupBy
    const base: string[] = []
    if (
      !['herd_group', 'pen', 'production_stage', 'equipment', 'collector', 'operator'].includes(
        groupBy
      )
    ) {
      base.push(cowGroupKey(row))
    }
    if (strategy.strategyType === 'breeding-dataset') base.push(str(row.datasetDomain || '数据'))
    if (row.traitCode) base.push(str(row.traitCode))
    if (row.eventType) base.push(str(row.eventType))
    if (groupBy === 'cow') return base.join('|')
    if (groupBy === 'herd_group') return [...base, `牛群${row.herdGroup || '未填'}`].join('|')
    if (groupBy === 'pen') return [...base, `圈舍${displayPenValue(row.currentPen) || '未填'}`].join('|')
    if (groupBy === 'production_stage')
      return [...base, `阶段${row.productionStage || row.type || row.status || '未填'}`].join('|')
    if (groupBy === 'parity') return [...base, `胎次${row.parity || '未填'}`].join('|')
    if (groupBy === 'parity_calving_date') return [...base, parityCalvingDateValue(row)].join('|')
    if (groupBy === 'lactation') return [...base, lactationKey(row)].join('|')
    if (groupBy === 'lactation_305') return [...base, lactationKey(row), '305'].join('|')
    if (groupBy === 'lactation_stage') return [...base, lactationStageValue(row)].join('|')
    if (groupBy === 'dim_bucket') return [...base, dimBucketValue(row)].join('|')
    if (groupBy === 'reproduction_cycle')
      return [...base, cycleValue(row, 'reproductionCycle', '繁殖周期未填')].join('|')
    if (groupBy === 'pregnancy')
      return [...base, cycleValue(row, 'pregnancyStage', '妊娠期未填')].join('|')
    if (groupBy === 'dry_period')
      return [...base, cycleValue(row, 'dryPeriod', '干奶期未填')].join('|')
    if (groupBy === 'milking_shift') return [...base, milkingShiftValue(row)].join('|')
    if (groupBy === 'equipment') return [...base, equipmentValue(row)].join('|')
    if (groupBy === 'collector') return [...base, collectorValue(row)].join('|')
    if (groupBy === 'operator') return [...base, operatorValue(row)].join('|')
    if (
      [
        'day',
        'week',
        'ten_day',
        'half_month',
        'month',
        'quarter',
        'half_year',
        'year',
        'season',
        'rolling_7',
        'rolling_30',
        'rolling_90',
        'custom_window'
      ].includes(groupBy)
    )
      return [...base, periodValue(row, groupBy)].join('|')
    return [...base, stableRowKey(row)].join('|')
  }

  function stableRowKey(row: ExportRow) {
    return sanitizeKey(
      [
        row.id,
        row.sourceRecordId,
        row.sourceRecordIds,
        row.sourceTable,
        row.cowId,
        row.cowNumber,
        row.eventType,
        row.traitCode,
        row.collectionDate || row.eventDate || row.period || row.createdAt,
        row.value
      ]
        .map((item) => str(item))
        .filter(Boolean)
        .join('|') || 'untracked-row'
    )
  }

  function aggregateGroup(group: ExportRow[], strategy: ExportStrategy): ExportRow {
    const sorted = group
      .slice()
      .sort((left, right) => dateValue(left).localeCompare(dateValue(right)))
    const first = sorted[0] || {}
    const last = sorted[sorted.length - 1] || {}
    const values = group
      .map((row) => numericValue(row.value))
      .filter((value): value is number => value !== null)
    const aggregatedValue = aggregateNumeric(values, group)
    const sourceRecordIds = Array.from(
      new Set(
        group
          .map((row) =>
            str(
              row.sourceRecordIds || [row.sourceTable, row.sourceRecordId].filter(Boolean).join(':')
            )
          )
          .filter(Boolean)
      )
    ).join('、')
    const cowNumbers = uniqueText(group.map((row) => row.cowNumber))
    const dominant = dominantContext(group)
    return {
      ...first,
      datasetDomain: first.datasetDomain || strategyTypeLabel(strategy.strategyType),
      period: groupPeriodLabel(first),
      firstDate: dateValue(first),
      lastDate: dateValue(last),
      collectionDate: dateValue(first),
      cowNumber: cowNumbers.length === 1 ? cowNumbers[0] : str(first.cowNumber || ''),
      cowNumbers: cowNumbers.join('、'),
      cowCount: cowNumbers.length,
      breed: firstRealBreed(dominant.breed, first.breed),
      currentPen: dominant.currentPen || first.currentPen,
      herdGroup: dominant.herdGroup || first.herdGroup,
      productionStage: dominant.productionStage || first.productionStage || first.type,
      status: dominant.status || first.status,
      parity: dominant.parity || first.parity,
      currentParity: dominant.currentParity || first.currentParity,
      parityCalvingDate: dominant.parityCalvingDate || first.parityCalvingDate,
      milkingShift: dominant.milkingShift || first.milkingShift || milkingShiftValue(first),
      reproductionCycle: dominant.reproductionCycle || first.reproductionCycle,
      pregnancyStage: dominant.pregnancyStage || first.pregnancyStage,
      dryPeriod: dominant.dryPeriod || first.dryPeriod,
      equipmentId: dominant.equipmentId || first.equipmentId,
      collector: dominant.collector || first.collector,
      operatorName: dominant.operatorName || first.operatorName,
      ...pickPedigreeValues(dominant, first),
      value: aggregatedValue,
      aggregation: aggregationLabel(configForm.aggregation),
      recordCount: group.length,
      daysInMilkRange: dimRange(group),
      sourceTable: Array.from(
        new Set(group.map((row) => str(row.sourceTable)).filter(Boolean))
      ).join('、'),
      sourceRecordIds,
      sourceRecordId: sourceRecordIds
    }
  }

  function aggregateNumeric(values: number[], group: ExportRow[]) {
    if (configForm.aggregation === 'count') return group.length
    if (!values.length) return ''
    if (configForm.aggregation === 'sum')
      return round(values.reduce((sum, value) => sum + value, 0))
    if (configForm.aggregation === 'avg')
      return round(values.reduce((sum, value) => sum + value, 0) / values.length)
    if (configForm.aggregation === 'min') return Math.min(...values)
    if (configForm.aggregation === 'max') return Math.max(...values)
    if (configForm.aggregation === 'median') {
      const sorted = values.slice().sort((left, right) => left - right)
      const mid = Math.floor(sorted.length / 2)
      return round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
    }
    if (configForm.aggregation === 'latest') {
      const latest = group
        .slice()
        .sort((left, right) => dateValue(right).localeCompare(dateValue(left)))[0]
      return latest?.value ?? ''
    }
    return values[0] ?? ''
  }

  function applySort(rows: ExportRow[], rules: SortRule[]) {
    const activeRules = rules
      .filter((rule) => rule.field)
      .slice()
      .reverse()
    if (!activeRules.length) return rows
    return rows.slice().sort((left, right) => {
      for (const rule of activeRules) {
        const result = compareValues(left[rule.field], right[rule.field])
        if (result !== 0) return rule.direction === 'desc' ? -result : result
      }
      return 0
    })
  }

  function compareValues(left: unknown, right: unknown) {
    const leftEmpty = left === null || left === undefined || left === ''
    const rightEmpty = right === null || right === undefined || right === ''
    if (leftEmpty && rightEmpty) return 0
    if (leftEmpty) return 1
    if (rightEmpty) return -1
    const leftNumber = Number(left)
    const rightNumber = Number(right)
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
    const leftTime = Date.parse(String(left))
    const rightTime = Date.parse(String(right))
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime
    return String(left).localeCompare(String(right), 'zh-CN')
  }

  function buildExportParameters() {
    if (!selectedStrategy.value) return {}
    const sortRules = activeExportSortRules()
      .filter((rule) => rule.field)
      .map((rule) => ({ field: rule.field, direction: rule.direction }))
    return {
      strategyId: selectedStrategy.value.id,
      strategyName: selectedStrategy.value.name,
      strategyType: selectedStrategy.value.strategyType,
      format: configForm.format,
      dimensionFields: [...configForm.fields],
      fields: previewColumns.value.map((field) => field.key),
      fieldLabels: previewColumns.value.map((field) => field.label),
      filters: { ...configForm.filters },
      period: { ...configForm.period },
      aggregation: configForm.aggregation,
      traitColumns: selectedTraitColumns.value.map((field) => ({
        field: field.key,
        label: field.label
      })),
      sortRules,
      sortSource: activePreviewSortRules.value.length ? 'preview-column-header' : 'strategy-default'
    }
  }

  async function writeAuditLog(
    fileName: string,
    rows: ExportRow[],
    exportedRows: Record<string, unknown>[],
    checksum: string,
    startedAt: string
  ) {
    if (!selectedStrategy.value) return
    const finishedAt = new Date().toISOString()
    const auditId = `export-information-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const cowIds = Array.from(new Set(rows.map((row) => str(row.cowId)).filter(Boolean)))
    const cowNumbers = Array.from(new Set(rows.map((row) => str(row.cowNumber)).filter(Boolean)))
    const sourceRecordIds = collectSourceRecordIds(rows)
    const parameters = buildExportParameters()
    const resultSnapshot = {
      rowCount: rows.length,
      fileName,
      checksum,
      previewRows: exportedRows.slice(0, 5),
      cowIds,
      cowNumbers,
      sourceRecordIds
    }
    const relationScope = {
      domain: 'information_export',
      strategyType: selectedStrategy.value.strategyType,
      cowIds,
      cowNumbers,
      sourceRecordIds
    }

    await databaseService.addTableDataAsync('export-audit-logs', {
      id: auditId,
      operator: getOperator(),
      action_type: 'export_information',
      status: 'completed',
      file_name: fileName,
      file_hash: checksum,
      file_format: configForm.format,
      row_count: rows.length,
      filters_json: parameters,
      parameters_json: parameters,
      result_snapshot: resultSnapshot,
      cow_ids: cowIds,
      cow_numbers: cowNumbers,
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
      action_type: 'export_information',
      target_type: 'export_audit_logs',
      target_id: auditId,
      operator: getOperator(),
      status: 'completed',
      request_payload: parameters,
      result_payload: resultSnapshot,
      cow_ids: cowIds,
      cow_numbers: cowNumbers,
      relation_scope: relationScope,
      source_record_ids: {
        ...sourceRecordIds,
        export_audit_logs: [auditId]
      },
      created_at: startedAt,
      updated_at: finishedAt
    })

    await recordV2ExportRun({
      scopeCode: `information_export_${selectedStrategy.value.strategyType}`,
      scopeName: `信息导出-${selectedStrategy.value.name}`,
      scopeDomain: selectedStrategy.value.domain,
      sourceType: 'information_export',
      fileName,
      fileFormat: configForm.format,
      rowCount: rows.length,
      checksum,
      fileSize: estimatePayloadSize(exportedRows),
      operatorName: getOperator(),
      startedAt,
      finishedAt,
      parameters,
      resultSnapshot,
      periods: buildV2Periods(),
      scopes: [
        { scopeType: 'strategy_type', scopeValue: selectedStrategy.value.strategyType },
        ...cowNumbers
          .slice(0, 200)
          .map((cowNumber) => ({ scopeType: 'cow_number', scopeValue: cowNumber })),
        ...previewColumns.value.map((field) => ({ scopeType: 'field', scopeValue: field.key })),
        ...Object.keys(sourceRecordIds).map((table) => ({
          scopeType: 'source_table',
          scopeValue: table
        }))
      ],
      selectableFilters: {
        fields: previewColumns.value.map((field) => field.key),
        groupBy: groupByOptions.map((item) => item.value),
        aggregation: aggregationOptions.map((item) => item.value),
        filters: Object.keys(configForm.filters),
        sortRules: activeExportSortRules().filter((rule) => rule.field)
      },
      selectableVariables: previewColumns.value.map((field) => field.key),
      defaultPeriods: buildV2Periods()
    })
  }

  function buildV2Periods(): V2ExportPeriodInput[] {
    const periods: V2ExportPeriodInput[] = [
      {
        periodType: configForm.period.groupBy,
        startAt: configForm.filters.dateRange[0],
        endAt: configForm.filters.dateRange[1],
        customWindowCode: configForm.period.groupBy
      }
    ]
    if (configForm.filters.parityMin !== null || configForm.filters.parityMax !== null) {
      periods.push({
        periodType: 'parity_range',
        parityNo: configForm.filters.parityMin ?? configForm.filters.parityMax ?? undefined,
        customWindowCode: `parity_${configForm.filters.parityMin ?? ''}_${configForm.filters.parityMax ?? ''}`
      })
    }
    const paritySelections = normalizeParitySelections(configForm.filters.paritySelections)
    if (paritySelections.length) {
      periods.push({
        periodType: 'parity_selection',
        parityNo: paritySelections[0],
        customWindowCode: `parity_selection_${paritySelections.join('_')}`
      })
    }
    return periods
  }

  function collectSourceRecordIds(rows: ExportRow[]) {
    const result: Record<string, string[]> = {}
    rows.forEach((row) => {
      const tokens = str(
        row.sourceRecordIds || [row.sourceTable, row.sourceRecordId].filter(Boolean).join(':')
      )
        .split(/[、,，;]/)
        .map((item) => item.trim())
        .filter(Boolean)
      tokens.forEach((token) => {
        const [table, ...idParts] = token.split(':')
        const id = idParts.join(':')
        if (!table || !id) return
        result[table] = Array.from(new Set([...(result[table] || []), id]))
      })
    })
    return result
  }

  function rowWithLabels(row: ExportRow) {
    return Object.fromEntries(
      previewColumns.value.map((field) => [field.label, exportCellValue(row, field)])
    )
  }

  function exportCellValue(row: ExportRow, field: ExportField) {
    return displayCellValue(row, field)
  }

  function displayCellValue(row: ExportRow, field: ExportField) {
    const value = row[field.key]
    if (field.key === 'period') return exportPeriodValue(value, selectedStrategy.value)
    if (field.key === 'currentPen') return displayPenValue(value)
    if (field.key === 'unit') return displayUnitValue(value, row)
    if (field.type === 'date') return exportDateValue(value)
    return value ?? ''
  }

  function exportPeriodValue(value: unknown, strategy?: ExportStrategy | null) {
    const text = str(value)
    if (!text) return ''
    const groupBy = strategy?.period?.groupBy
    if (groupBy === 'lactation_305') return text.replace(/^第\s*\S+\s*胎\s*/, '')
    if (groupBy === 'year') return text.split('/')[0]?.trim() || text
    return text
  }

  function exportDateValue(value: unknown) {
    const raw = str(value)
    if (!raw) return ''
    return displayDateValue(raw)
  }

  function rebuildFarmUnitDisplayMap(rows: any[]) {
    const map = new Map<string, string>()
    rows.forEach((row) => {
      const display = str(
        row.name ||
          row.unitName ||
          row.unit_name ||
          row.penName ||
          row.pen_name ||
          row.locationLabel ||
          row.location_label ||
          row.code ||
          row.id
      )
      if (!display) return
      ;[
        row.id,
        row.code,
        row.name,
        row.unitName,
        row.unit_name,
        row.penName,
        row.pen_name,
        row.locationLabel,
        row.location_label,
        row.currentPen,
        row.current_pen,
        row.currentPenId,
        row.current_pen_id,
        row.currentUnitId,
        row.current_unit_id,
        row.unitId,
        row.unit_id
      ]
        .map(str)
        .filter(Boolean)
        .forEach((key) => map.set(key, display))
    })
    farmUnitDisplayMap.value = map
  }

  function displayPenValue(value: unknown) {
    const raw = str(value)
    if (!raw) return ''
    return farmUnitDisplayMap.value.get(raw) || raw
  }

  function displayUnitValue(value: unknown, row: ExportRow) {
    const raw = str(value)
    if (isMilkUnit(raw, row)) return 'kg'
    return raw
  }

  function isMilkUnit(value: string, row: ExportRow) {
    const unit = value.trim().toLowerCase()
    if (!['l', '升', 'liter', 'litre', 'kg', '千克'].includes(unit)) return false
    const traitCode = canonicalTraitCode(row.traitCode)
    const context = [
      traitCode,
      row.traitName,
      row.recordType,
      row.category,
      row.source,
      row.datasetDomain
    ]
      .map(str)
      .join(' ')
      .toLowerCase()
    return traitCode === 'milk_yield' || /milk|产奶|奶量|泌乳/.test(context)
  }

  function displayDateValue(value: unknown) {
    const raw = str(value)
    if (!raw) return ''
    const normalized = raw.replace('T', ' ').trim()
    const match = normalized.match(/^(\d{4}-\d{1,2}-\d{1,2})(?:\s+(\d{1,2})(?::(\d{1,2}))?)?/)
    if (match) {
      const date = normalizeDatePart(match[1])
      return date
    }
    const parsed = new Date(raw)
    if (!Number.isFinite(parsed.getTime())) {
      return normalized.slice(0, 10)
    }
    return formatLocalDatePart(parsed)
  }

  function normalizeDatePart(value: string) {
    const [year, month, day] = value.split('-')
    return [year, month?.padStart(2, '0'), day?.padStart(2, '0')].filter(Boolean).join('-')
  }

  function formatLocalDatePart(date: Date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-')
  }

  function downloadCsv(fileName: string, rows: Record<string, unknown>[]) {
    const headers = Object.keys(rows[0] || {})
    const content = [
      headers.map(escapeCsvValue).join(','),
      ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(','))
    ].join('\n')
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function escapeCsvValue(value: unknown) {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  async function hashPayload(value: string) {
    const payload = new TextEncoder().encode(value)
    if (window.crypto?.subtle) {
      const buffer = await window.crypto.subtle.digest('SHA-256', payload)
      return Array.from(new Uint8Array(buffer))
        .map((item) => item.toString(16).padStart(2, '0'))
        .join('')
    }
    let hash = 0
    payload.forEach((byte) => {
      hash = (Math.imul(31, hash) + byte) | 0
    })
    return `fallback-${Math.abs(hash).toString(16)}`
  }

  async function readTableSafe(tableName: string) {
    try {
      return await databaseService.getTableDataAsync(tableName, { silent: true })
    } catch {
      return []
    }
  }

  function isTraitStrategy(strategy?: ExportStrategy | null) {
    return strategy?.strategyType === 'phenotype-lactation'
  }

  function currentSelectedTraitCodes() {
    const codes = normalizeTraitCodeList(configForm.filters.traitCodes)
    if (codes.length) return codes
    const code = canonicalTraitCode(selectedStrategy.value?.traitCode)
    return code ? [code] : []
  }

  function normalizeTraitCodeList(values: unknown) {
    const list = Array.isArray(values) ? values : [values]
    return Array.from(new Set(list.map((value) => canonicalTraitCode(value)).filter(Boolean)))
  }

  function parseArray(value: unknown): any[] {
    if (Array.isArray(value)) return value
    if (typeof value !== 'string' || !value.trim()) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  function stringArray(value: unknown) {
    return parseArray(value)
      .map((item) => str(item))
      .filter(Boolean)
  }

  function visibleColumnFields(columns: any[]) {
    return columns
      .filter((column) => column && column.visible !== false)
      .map((column) => str(column.field || column.key))
      .filter(Boolean)
  }

  function traitValueKey(code: string) {
    return `${traitValueFieldPrefix}${canonicalTraitCode(code)}`
  }

  function isTraitValueKey(key: unknown) {
    return str(key).startsWith(traitValueFieldPrefix)
  }

  function traitCodeFromValueKey(key: unknown) {
    const text = str(key)
    return text.startsWith(traitValueFieldPrefix)
      ? canonicalTraitCode(text.slice(traitValueFieldPrefix.length))
      : ''
  }

  function traitLabelForCode(code: string) {
    const normalized = canonicalTraitCode(code)
    const trait = templateTraits.value.find((item) => canonicalTraitCode(item.code) === normalized)
    if (trait) return trait.name
    const row = referenceRows.value.find(
      (item) => canonicalTraitCode(item.traitCode) === normalized
    )
    return str(row?.traitName || normalized)
  }

  function traitColumnLabelForStrategy(strategy: ExportStrategy | null | undefined, code: string) {
    const normalized = canonicalTraitCode(code)
    if (normalized !== 'milk_yield' || !strategy) return traitLabelForCode(code)
    const groupBy = strategy.period?.groupBy || configForm.period.groupBy
    const aggregation = strategy.aggregation || configForm.aggregation
    if (groupBy === 'raw' || aggregation === 'raw') return '单次产奶量'
    if (groupBy === 'lactation_305' && aggregation === 'sum') return '305天产奶量'
    if (groupBy === 'day' && aggregation === 'sum') return '日产奶量'
    if (groupBy === 'parity' && aggregation === 'sum') return '胎次产奶量'
    if (groupBy === 'year' && aggregation === 'sum') return '年度产奶量'
    if (aggregation === 'avg') return '平均日产奶量'
    if (aggregation === 'sum') return `${groupByBusinessPrefix(groupBy)}产奶量`
    return milkYieldTemplateName(groupBy, aggregation)
  }

  function traitCategoryForCode(code: string) {
    const normalized = canonicalTraitCode(code)
    const trait = templateTraits.value.find((item) => canonicalTraitCode(item.code) === normalized)
    if (trait) return trait.category
    const row = referenceRows.value.find(
      (item) => canonicalTraitCode(item.traitCode) === normalized
    )
    return str(row?.category || '表型记录')
  }

  function normalizedFieldsForConfig(strategy: ExportStrategy, fields: string[]): string[] {
    const validKeys = new Set(fieldDefsForStrategy(strategy).map((field) => field.key))
    const selected = (Array.isArray(fields) ? fields : [])
      .map((field) => str(field))
      .filter((field) => field && validKeys.has(field))
      .filter((field) => isUserVisibleField(strategy, field))
      .filter(
        (field) =>
          !isTraitStrategy(strategy) ||
          (!traitTechnicalFieldKeys.has(field) && !isTraitValueKey(field))
      )
    if (selected.length) return normalizeExportFieldKeys(strategy, selected)
    return defaultFieldsForStrategy(strategy)
  }

  function defaultFieldsForStrategy(strategy: ExportStrategy): string[] {
    const validKeys = new Set(fieldDefsForStrategy(strategy).map((field) => field.key))
    const candidates = [
      ...(Array.isArray(strategy.defaultFields) ? strategy.defaultFields : []),
      ...(Array.isArray(strategy.fields) ? strategy.fields : [])
    ]
      .map((field) => str(field))
      .filter((field) => field && validKeys.has(field))
      .filter((field) => isUserVisibleField(strategy, field))
      .filter(
        (field) =>
          !isTraitStrategy(strategy) ||
          (!traitTechnicalFieldKeys.has(field) && !isTraitValueKey(field))
      )
    if (candidates.length) return normalizeExportFieldKeys(strategy, candidates)
    const base = builtinStrategies.find((item) => item.strategyType === strategy.strategyType)
    if (base && base.id !== strategy.id)
      return normalizedFieldsForConfig(
        base,
        base.defaultFields.length ? base.defaultFields : base.fields
      )
    return fieldDefsForStrategy(strategy)
      .filter((field) => isUserVisibleField(strategy, field.key))
      .filter((field) => !isTraitStrategy(strategy) || !traitTechnicalFieldKeys.has(field.key))
      .slice(0, 8)
      .map((field) => field.key)
  }

  function normalizedFiltersForStrategy(
    strategy: ExportStrategy,
    dimensionFields = normalizedFieldsForConfig(strategy, strategy.fields)
  ): Record<string, any> {
    const filters = { ...parseObject(strategy.filters) }
    filters.paritySelections = normalizeParitySelectionStrings(filters.paritySelections)
    if (!isTraitStrategy(strategy)) return filters
    const traitCodes = traitCodesFromStrategy(strategy, dimensionFields)
    filters.traitCodes = traitCodes
    if (filters.numericField === 'value' && traitCodes[0])
      filters.numericField = traitValueKey(traitCodes[0])
    if (isTraitValueKey(filters.numericField)) {
      const code = traitCodeFromValueKey(filters.numericField)
      if (code && !traitCodes.includes(code)) filters.numericField = ''
    }
    return filters
  }

  function traitCodesFromStrategy(strategy: ExportStrategy, fields: string[] = []): string[] {
    return Array.from(
      new Set([
        ...normalizeTraitCodeList(parseObject(strategy.filters).traitCodes),
        ...fields.map((field) => traitCodeFromValueKey(field)).filter(Boolean),
        ...normalizeTraitCodeList(strategy.traitCode)
      ])
    )
  }

  function traitColumnsForStrategy(strategy: ExportStrategy, fields: string[] = []): ExportField[] {
    if (!isTraitStrategy(strategy)) return []
    return traitCodesFromStrategy(strategy, fields).map((code) => ({
      key: traitValueKey(code),
      label: traitColumnLabelForStrategy(strategy, code),
      type: 'number' as const
    }))
  }

  function exportColumnsForStrategy(strategy: ExportStrategy, fields: string[]): ExportField[] {
    const fieldMap = new Map(fieldDefsForStrategy(strategy).map((field) => [field.key, field]))
    const dimensions = normalizedFieldsForConfig(strategy, fields)
      .map((field) => fieldMap.get(field))
      .filter(isExportField)
      .filter((field) => isUserVisibleField(strategy, field.key)) as ExportField[]
    const uniqueDimensions = uniqueExportFields(dimensions, strategy)
    if (!isTraitStrategy(strategy)) return uniqueDimensions
    const selected = new Set(uniqueDimensions.map((field) => field.key))
    return [
      ...uniqueDimensions,
      ...traitColumnsForStrategy(strategy, fields).filter((field) => !selected.has(field.key))
    ]
  }

  function traitCodesFromPersistedConfig(
    fields: string[],
    columns: any[],
    payload: Record<string, any>,
    filters: Record<string, any>,
    base: ExportStrategy
  ): string[] {
    const payloadTraitColumns = parseArray(payload.traitColumns)
    return Array.from(
      new Set([
        ...normalizeTraitCodeList(filters.traitCodes),
        ...normalizeTraitCodeList(payload.traitCodes),
        ...payloadTraitColumns
          .map((column) => traitCodeFromValueKey(column?.field || column?.key))
          .filter(Boolean),
        ...columns
          .map((column) => traitCodeFromValueKey(column?.field || column?.key))
          .filter(Boolean),
        ...fields.map((field) => traitCodeFromValueKey(field)).filter(Boolean),
        ...normalizeTraitCodeList(payload.traitCode),
        ...normalizeTraitCodeList(base.traitCode)
      ])
    )
  }

  function normalizeActiveSortRules(rules: SortRule[]) {
    const selectedColumns = selectedTraitColumns.value
    return rules
      .map((rule) => {
        const field = str(rule.field)
        if (isCurrentTraitStrategy.value && field === 'value') {
          return selectedColumns[0]
            ? { ...rule, field: selectedColumns[0].key }
            : { ...rule, field: '' }
        }
        if (isCurrentTraitStrategy.value && traitTechnicalFieldKeys.has(field)) {
          return { ...rule, field: '' }
        }
        return { ...rule, field }
      })
      .filter((rule) => rule.field)
  }

  function fieldDefsForStrategy(strategy: ExportStrategy) {
    const fields =
      leaderMilkPresetCode(strategy) === 'cow-period-profile'
        ? leaderCowPeriodProfileFields
        : strategy.strategyType === 'animal-profile'
          ? animalFields
          : strategy.strategyType === 'animal-events'
            ? eventFields
            : strategy.strategyType === 'phenotype-lactation'
              ? phenotypeFields
              : strategy.strategyType === 'milk-missing-review'
                ? milkMissingReviewFields
                : combinedFields
    return uniqueExportFields(fields, strategy)
  }

  function isUserVisibleField(strategy: ExportStrategy | null | undefined, field: string) {
    const key = str(field)
    if (!key) return false
    if (hiddenUserExportFieldKeys.has(key)) return false
    if (key === 'currentParity') return false
    if (key === 'period') {
      const groupBy = strategy?.period?.groupBy || 'raw'
      return !['raw', 'parity', 'cow', 'parity_calving_date'].includes(groupBy)
    }
    return true
  }

  function isExportField(field: ExportField | undefined): field is ExportField {
    return Boolean(field)
  }

  function normalizeExportFieldKeys(strategy: ExportStrategy | null | undefined, fields: string[]) {
    const result: string[] = []
    const seen = new Set<string>()
    fields.forEach((field) => {
      const key = str(field)
      if (!key || seen.has(key) || !isUserVisibleField(strategy, key)) return
      seen.add(key)
      result.push(key)
    })
    return result
  }

  function uniqueExportFields(fields: ExportField[], strategy?: ExportStrategy | null) {
    const seen = new Set<string>()
    const result: ExportField[] = []
    fields.forEach((field) => {
      const key = str(field.key)
      if (!key || seen.has(key) || !isUserVisibleField(strategy, key)) return
      seen.add(key)
      result.push({ ...field, label: labelForExportField(field, strategy) })
    })
    return result
  }

  function labelForExportField(field: ExportField, strategy?: ExportStrategy | null) {
    if (field.key !== 'period') return field.label
    return periodFieldGroupByLabels[strategy?.period?.groupBy || 'raw'] || '统计窗口'
  }

  function groupFieldDefinitions(fields: ExportField[]) {
    const groups = [
      {
        title: '牛只身份',
        description: '牛号、品种、性别、圈舍、牛群和当前状态。',
        keys: [
          'datasetDomain',
          'recordType',
          'cowNumber',
          'cowNumbers',
          'cowCount',
          'cowId',
          'animalId',
          'cowName',
          'earTagNumber',
          'breed',
          'gender',
          'birthDate',
          'type',
          'status',
          'currentPen',
          'herdGroup',
          'productionStage'
        ]
      },
      {
        title: '生产周期维度',
        description:
          '日期、班次、胎次、本胎产犊时间、DIM和305天窗口；本胎产犊时间用于系统推导胎次与泌乳天数。',
        keys: [
          ...userPeriodExportFieldKeys,
          'firstDate',
          'lastDate',
          'collectionDate',
          'lactationStartDate',
          'lactationEndDate',
          'daysInMilk',
          'daysInMilkRange',
          'parity',
          'currentParity',
          'parityCalvingDate',
          'reproductionCycle',
          'pregnancyStage',
          'dryPeriod',
          'milkingShift',
          'pregnancy',
          'createdAt',
          'updatedAt'
        ]
      },
      {
        title: '事件与性状值',
        description: '事件类型、性状大类、小类、测定值、单位和记录次数。',
        keys: [
          'eventTypeLabel',
          'category',
          'traitCode',
          'traitName',
          'value',
          'unit',
          'aggregation',
          'recordCount',
          'missingKind',
          'existingShiftCount',
          'existingDailyMilk',
          'recommendedMilk',
          'recommendationMethod',
          'recommendationText',
          'confidence',
          'monthKey',
          'yearKey',
          'cost',
          'description',
          'notes'
        ]
      },
      {
        title: '采集与追溯',
        description: '设备批次、采集人和操作人。',
        keys: [
          'source',
          'equipmentId',
          'collector',
          'operatorName',
          'sourceTable',
          'sourceRecordId',
          'sourceRecordIds'
        ]
      },
      {
        title: '系谱字段',
        description: '父母、祖代和三代以上亲缘字段。',
        keys: pedigreeFieldKeys
      }
    ]
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const used = new Set<string>()
    const resolved = groups
      .map((group) => {
        const groupFields = Array.from(new Set(group.keys))
          .map((key) => fieldMap.get(key))
          .filter(Boolean) as ExportField[]
        groupFields.forEach((field) => used.add(field.key))
        return { ...group, fields: groupFields }
      })
      .filter((group) => group.fields.length)
    const otherFields = fields.filter((field) => !used.has(field.key))
    if (otherFields.length) {
      resolved.push({
        title: '其他字段',
        description: '当前模板的补充字段。',
        keys: otherFields.map((field) => field.key),
        fields: otherFields
      })
    }
    return resolved
  }

  function fieldLabel(key: string) {
    if (isTraitValueKey(key)) return traitLabelForCode(traitCodeFromValueKey(key))
    return activeFieldMap.value.get(key)?.label || key
  }

  function uniqueOptions(values: unknown[]) {
    return Array.from(new Set(values.map((value) => str(value)).filter(Boolean))).sort(
      (left, right) => left.localeCompare(right, 'zh-CN')
    )
  }

  function normalizeSortRules(value: unknown): SortRule[] {
    const rows = Array.isArray(value) ? value : []
    const normalized = rows.map((row: any) => ({
      field: str(row.field),
      direction: row.direction === 'asc' ? ('asc' as SortDirection) : ('desc' as SortDirection)
    }))
    while (normalized.length < 3) normalized.push({ field: '', direction: 'desc' })
    return normalized
  }

  function normalizeStrategyType(value: unknown): StrategyType {
    const text = str(value)
    if (text === 'animal-events') return 'animal-events'
    if (text === 'phenotype-lactation') return 'phenotype-lactation'
    if (text === 'milk-missing-review') return 'milk-missing-review'
    if (text === 'breeding-dataset') return 'breeding-dataset'
    return 'animal-profile'
  }

  function normalizeGroupBy(value: unknown, fallback: GroupBy = 'raw'): GroupBy {
    const text = str(value).toLowerCase()
    if (text === 'none') return 'raw'
    return groupByOptions.some((item) => item.value === text) ? (text as GroupBy) : fallback
  }

  function normalizeAggregation(value: unknown): Aggregation {
    const text = str(value).toLowerCase()
    if (text === 'mean') return 'avg'
    return aggregationOptions.some((item) => item.value === text) ? (text as Aggregation) : 'raw'
  }

  function normalizeTemplateKind(value: unknown): ExportStrategy['templateKind'] {
    const text = str(value)
    if (text === 'base' || text === 'trait-period' || text === 'event-count') return text
    return undefined
  }

  function normalizeFormat(value: unknown): ExportFormat {
    return value === 'csv' ? 'csv' : 'xlsx'
  }

  function parseObject(value: unknown): Record<string, any> {
    if (!value) return {}
    if (typeof value === 'object') return value as Record<string, any>
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }
    return {}
  }

  function cloneStrategy(strategy: ExportStrategy): ExportStrategy {
    return {
      ...strategy,
      fields: [...strategy.fields],
      defaultFields: [...strategy.defaultFields],
      filters: { ...strategy.filters },
      period: { ...strategy.period },
      sortRules: normalizeSortRules(strategy.sortRules)
    }
  }

  function normalizeLegacyEvent(row: any, sourceTable: string): ExportRow {
    const type = normalizeEventType(
      row.eventType || row.event_type || row.type || row.eventName || row.event_name
    )
    const details = { ...parseObject(row.payload), ...parseObject(row.details) }
    const sourceRecordId =
      str(row.sourceRecordId || row.source_record_id || row.id) ||
      stableRowKey({
        sourceTable,
        cowId: str(row.cowId || row.cow_id || details.cowId || details.cow_id),
        cowNumber: str(row.cowNumber || row.cow_number || details.cowNumber || details.cow_number),
        eventType: type,
        eventDate: dateOf({ ...details, ...row }),
        operatorName: str(
          row.operatorName ||
            row.operator_name ||
            row.operator ||
            row.technician ||
            details.operatorName ||
            details.operator_name ||
            details.operator ||
            details.technician
        ),
        description: str(row.description || row.eventName || row.event_name || details.description)
      })
    return {
      id: str(row.id) || sourceRecordId,
      cowId: str(row.cowId || row.cow_id || details.cowId || details.cow_id),
      cowNumber: str(row.cowNumber || row.cow_number || details.cowNumber || details.cow_number),
      herdGroup: str(row.herdGroup || row.herd_group || details.herdGroup || details.herd_group),
      productionStage: str(
        row.productionStage ||
          row.production_stage ||
          details.productionStage ||
          details.production_stage
      ),
      status: str(row.status || details.status),
      parity: numberOrBlank(parityValueOf(row) ?? parityValueOf(details)),
      currentParity: numberOrBlank(currentParityValueOf(row) ?? currentParityValueOf(details)),
      reproductionCycle: reproductionCycleOf({ ...details, ...row }),
      pregnancyStage: pregnancyStageOf({ ...details, ...row }),
      dryPeriod: dryPeriodOf({ ...details, ...row }),
      eventType: type,
      eventTypeLabel: eventTypeLabel(type),
      eventDate: dateOf({ ...details, ...row }),
      milkingShift: milkingShiftValue({ eventDate: dateOf({ ...details, ...row }) }),
      parityCalvingDate: parityCalvingDateOf({ ...details, ...row }),
      operatorName: str(
        row.operatorName ||
          row.operator_name ||
          row.operator ||
          row.technician ||
          details.operatorName ||
          details.operator_name ||
          details.operator ||
          details.technician
      ),
      description: str(row.description || row.eventName || row.event_name || details.description),
      notes: str(row.notes || details.notes),
      cost: numberOrBlank(row.cost ?? details.cost),
      createdAt: str(row.createdAt || row.created_at),
      sourceTable,
      sourceRecordId
    }
  }

  function canonicalEventSourceTable(value: unknown) {
    const source = str(value)
    if (source === 'cow_events' || source === 'cow-events') return 'animal_event'
    return source
  }

  function eventSourcePriority(value: unknown) {
    const source = canonicalEventSourceTable(value)
    if (source === 'animal_event') return 0
    if (
      source === 'breeding_events' ||
      source === 'breeding-records' ||
      source === 'breeding_records'
    )
      return 1
    return 2
  }

  function eventDedupKeys(row: ExportRow) {
    const cowKey = str(row.cowId || row.cowNumber || row.cowKey)
    const eventType = normalizeEventType(row.eventType || row.eventTypeLabel)
    const sourceRecordId = str(row.sourceRecordId || row.id)
    const eventMoment = eventMomentKey(row.eventDate || row.createdAt || row.period)
    return Array.from(
      new Set(
        [
          sourceRecordId ? `record:${cowKey}|${eventType}|${sourceRecordId}` : '',
          row.id ? `id:${cowKey}|${eventType}|${str(row.id)}` : '',
          eventMoment ? `business:${cowKey}|${eventType}|${eventMoment}` : ''
        ].filter(Boolean)
      )
    )
  }

  function eventMomentKey(value: unknown) {
    const raw = str(value)
    if (!raw) return ''
    const time = Date.parse(raw)
    return Number.isFinite(time) ? new Date(time).toISOString() : raw.slice(0, 10)
  }

  function enrichEventRow(
    row: ExportRow,
    cowContext: ReturnType<typeof buildCowContext>
  ): ExportRow {
    const resolved = resolveCowRef(row, cowContext.reference)
    const cow = resolved.cow
      ? { ...normalizeCowContext(resolved.cow), ...pickPedigreeValues(resolved.cow) }
      : normalizeCowContext({})
    const keys = dateKeys(row.eventDate || row.createdAt)
    const sourceRecordIds = str(
      row.sourceRecordIds || [row.sourceTable, row.sourceRecordId].filter(Boolean).join(':')
    )
    return {
      ...row,
      cowKey: resolved.sourceKey,
      cowId: str(resolved.cowId || cow.id),
      cowNumber: str(resolved.cowNumber || cow.cowNumber),
      breed: firstRealBreed(row.breed, cow.breed),
      currentPen: str(row.currentPen || cow.currentPen),
      herdGroup: str(row.herdGroup || cow.herdGroup),
      productionStage: str(row.productionStage || cow.productionStage),
      status: str(row.status || cow.status),
      parity: numberOrBlank(row.parity ?? cow.parity),
      currentParity: numberOrBlank(row.currentParity ?? cow.currentParity ?? cow.parity),
      reproductionCycle: str(row.reproductionCycle || cow.reproductionCycle),
      pregnancyStage: str(row.pregnancyStage || cow.pregnancyStage),
      dryPeriod: str(row.dryPeriod || cow.dryPeriod),
      parityCalvingDate: str(row.parityCalvingDate || parityCalvingDateOf(cow)),
      period: keys.dateKey || '-',
      milkingShift: str(row.milkingShift || milkingShiftValue(row)),
      firstDate: keys.dateKey,
      lastDate: keys.dateKey,
      value: 1,
      aggregation: '原始记录',
      recordCount: 1,
      sourceRecordIds,
      ...pickPedigreeValues(row, cow)
    }
  }

  function normalizeEventType(value: unknown) {
    const text = str(value).toLowerCase()
    if (
      text.includes('mating_plan') ||
      text.includes('mating plan') ||
      text.includes('mate plan') ||
      text.includes('选配') ||
      text.includes('选种')
    )
      return 'mating_plan'
    if (text.includes('embryo') || text.includes('et') || text.includes('胚胎'))
      return 'embryo_transfer'
    if (
      text.includes('semen_check') ||
      text.includes('semen check') ||
      text.includes('frozen semen') ||
      text.includes('冻精') ||
      text.includes('精液')
    )
      return 'semen_check'
    if (
      text.includes('insemination') ||
      text.includes('semen') ||
      text.includes('ai') ||
      text.includes('输精') ||
      text.includes('配种')
    )
      return 'insemination'
    if (
      text.includes('pregnancy_check') ||
      text.includes('pregnancy check') ||
      text.includes('pregcheck') ||
      text.includes('妊检') ||
      text.includes('孕检')
    )
      return 'pregnancy_check'
    if (
      text.includes('calving') ||
      text.includes('parturition') ||
      text.includes('产犊') ||
      text.includes('分娩')
    )
      return 'calving'
    if (text.includes('postpartum') || text.includes('产后')) return 'postpartum_check'
    if (text.includes('abortion') || text.includes('流产')) return 'abortion'
    if (text.includes('dry_off') || text.includes('dry off') || text.includes('干奶'))
      return 'dry_off'
    if (text.includes('heat') || text.includes('estrus') || text.includes('发情')) return 'heat'
    if (
      text.includes('vaccination') ||
      text.includes('vaccine') ||
      text.includes('免疫') ||
      text.includes('疫苗')
    )
      return 'vaccination'
    if (text.includes('deworm') || text.includes('驱虫')) return 'deworming'
    if (text.includes('quarantine') || text.includes('isolation') || text.includes('隔离'))
      return 'quarantine'
    if (text.includes('disinfection') || text.includes('disinfect') || text.includes('消毒'))
      return 'disinfection'
    if (
      text.includes('lab_test') ||
      text.includes('lab test') ||
      text.includes('laboratory') ||
      text.includes('化验') ||
      text.includes('实验室')
    )
      return 'lab_test'
    if (
      text.includes('medication') ||
      text.includes('medicine') ||
      text.includes('drug') ||
      text.includes('用药') ||
      text.includes('投药')
    )
      return 'medication'
    if (text.includes('treatment') || text.includes('therapy') || text.includes('治疗'))
      return 'treatment'
    if (text.includes('diagnosis') || text.includes('diagnose') || text.includes('诊断'))
      return 'diagnosis'
    if (text.includes('hoof') || text.includes('修蹄')) return 'hoof_trim'
    if (text.includes('mastitis') || text.includes('乳房炎')) return 'mastitis_check'
    if (text.includes('dhi')) return 'dhi_test'
    if (
      text.includes('milk_quality') ||
      text.includes('milk quality') ||
      text.includes('奶质') ||
      text.includes('乳成分')
    )
      return 'milk_quality'
    if (
      text.includes('milking_session') ||
      text.includes('milking session') ||
      text.includes('采奶') ||
      text.includes('挤奶')
    )
      return 'milking_session'
    if (text.includes('feed_delivery') || text.includes('feed delivery') || text.includes('投料'))
      return 'feed_delivery'
    if (text.includes('feed_adjustment') || text.includes('ration') || text.includes('日粮'))
      return 'feed_adjustment'
    if (text.includes('feed_intake') || text.includes('feed intake') || text.includes('采食'))
      return 'feed_intake'
    if (text.includes('water_intake') || text.includes('water intake') || text.includes('饮水'))
      return 'water_intake'
    if (
      text.includes('body_measurement') ||
      text.includes('body measurement') ||
      text.includes('体尺')
    )
      return 'body_measurement'
    if (text.includes('weighing') || text.includes('weight') || text.includes('称重'))
      return 'weighing'
    if (
      text.includes('maintenance') ||
      text.includes('repair') ||
      text.includes('设备维护') ||
      text.includes('维修')
    )
      return 'device_maintenance'
    if (text.includes('genotyping') || text.includes('genotype') || text.includes('基因分型'))
      return 'genotyping'
    if (text.includes('sequencing') || text.includes('sequence') || text.includes('测序'))
      return 'sequencing'
    if (
      text.includes('omics') ||
      text.includes('metabolomics') ||
      text.includes('transcriptomics') ||
      text.includes('proteomics') ||
      text.includes('组学')
    )
      return 'omics_assay'
    if (
      text.includes('sensor') ||
      text.includes('alert') ||
      text.includes('告警') ||
      text.includes('预警')
    )
      return 'sensor_alert'
    if (text.includes('sample') || text.includes('采样') || text.includes('样本'))
      return 'sample_collection'
    if (text.includes('entry') || text.includes('入')) return 'entry'
    if (text.includes('transfer') || text.includes('movement') || text.includes('转'))
      return 'transfer'
    if (text.includes('death') || text.includes('dead') || text.includes('死亡')) return 'death'
    if (
      text.includes('exit') ||
      text.includes('cull') ||
      text.includes('离') ||
      text.includes('淘')
    )
      return 'exit'
    if (
      text.includes('breeding') ||
      text.includes('reproduction') ||
      text.includes('pregnancy') ||
      text.includes('繁殖') ||
      text.includes('妊')
    )
      return 'breeding'
    if (
      text.includes('veterinary') ||
      text.includes('health') ||
      text.includes('disease') ||
      text.includes('兽') ||
      text.includes('病')
    )
      return 'veterinary'
    if (text.includes('milk') || text.includes('奶') || text.includes('泌乳')) return 'milking'
    if (text.includes('feed') || text.includes('饲')) return 'feeding'
    return text || 'event'
  }

  function eventTypeLabel(value: unknown) {
    return eventTypeOptions.find((item) => item.value === value)?.label || str(value || '其他事件')
  }

  function buildAnimalNumberMap(animals: any[]) {
    const map = new Map<string, string>()
    animals.forEach((row) => {
      const id = animalIdOf(row)
      const number = animalNumberOf(row)
      if (id && number) map.set(id, number)
    })
    return map
  }

  function buildPedigreeResolver(animals: any[], cows: any[], parentageRows: any[]) {
    const numberById = new Map<string, string>()
    const idByNumber = new Map<string, string>()
    const parentageByAnimalId = new Map<string, any[]>()
    const parentageByAnimalNumber = new Map<string, any[]>()

    ;[...animals, ...cows].forEach((row) => {
      const id = animalIdOf(row)
      const number = animalNumberOf(row)
      if (id && number) {
        numberById.set(id, number)
        idByNumber.set(number, id)
      }
    })

    parentageRows.forEach((row) => {
      const animalNumber = animalNumberOf(row)
      const animalId =
        str(row.animalId || row.animal_id || row.cowId || row.cow_id) ||
        idByNumber.get(animalNumber) ||
        ''
      if (animalId) {
        parentageByAnimalId.set(animalId, [...(parentageByAnimalId.get(animalId) || []), row])
      }
      const resolvedNumber = animalNumber || (animalId ? numberById.get(animalId) || '' : '')
      if (resolvedNumber) {
        parentageByAnimalNumber.set(resolvedNumber, [
          ...(parentageByAnimalNumber.get(resolvedNumber) || []),
          row
        ])
      }
    })

    const resolveAnimalRef = (source: unknown) => {
      const row = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>
      const rawText = typeof source === 'string' || typeof source === 'number' ? str(source) : ''
      const explicitId = animalIdOf(row)
      const explicitNumber = animalNumberOf(row) || str(row.number)
      const id =
        explicitId ||
        idByNumber.get(explicitNumber || rawText) ||
        (rawText && parentageByAnimalId.has(rawText) ? rawText : '')
      const number = explicitNumber || rawText || (id ? numberById.get(id) || '' : '')
      return { id, number }
    }

    const knownAnimalRef = (number: string) => ({
      id: idByNumber.get(number) || '',
      number
    })

    const resolveParent = (source: unknown, parentType: 'father' | 'mother') => {
      const ref = resolveAnimalRef(source)
      const rows = parentageRowsForRef(ref)
      const seen = new Set<string>()
      const parentRow = rows.find((row) => {
        const key = str(
          row.id || `${row.parentRole || row.parent_role}-${row.parentNumber || row.parent_number}`
        )
        if (key && seen.has(key)) return false
        if (key) seen.add(key)
        return directParentRoleMatches(row.parentRole || row.parent_role, parentType)
      })
      if (!parentRow) return { id: '', number: '' }
      return parentLinkFromRow(parentRow)
    }

    const resolveRelative = (source: unknown, roles: string[]) => {
      const ref = resolveAnimalRef(source)
      const parentRow = parentageRowsForRef(ref).find((row) =>
        ancestorRoleMatches(row.parentRole || row.parent_role, roles)
      )
      return parentRow ? parentLinkFromRow(parentRow) : { id: '', number: '' }
    }

    function parentageRowsForRef(ref: { id: string; number: string }) {
      return [
        ...(ref.id ? parentageByAnimalId.get(ref.id) || [] : []),
        ...(ref.number ? parentageByAnimalNumber.get(ref.number) || [] : [])
      ]
    }

    function parentLinkFromRow(parentRow: any) {
      const parentNumber = str(
        parentRow.parentNumber ||
          parentRow.parent_number ||
          parentRow.parentAnimalNumber ||
          parentRow.parent_animal_number ||
          parentRow.parentCowNumber ||
          parentRow.parent_cow_number
      )
      const parentId =
        str(
          parentRow.parentAnimalId ||
            parentRow.parent_animal_id ||
            parentRow.parentId ||
            parentRow.parent_id
        ) || (parentNumber ? idByNumber.get(parentNumber) || '' : '')
      return {
        id: parentId,
        number: parentNumber || (parentId ? numberById.get(parentId) || '' : '')
      }
    }

    return (row: any) => {
      const fallback = fallbackPedigreeValues(row)
      const father = resolveParent(row, 'father')
      const mother = resolveParent(row, 'mother')
      const fatherRef = father.number ? father : knownAnimalRef(fallback.fatherNumber)
      const motherRef = mother.number ? mother : knownAnimalRef(fallback.motherNumber)

      const paternalGrandfather = resolveParent(fatherRef, 'father')
      const paternalGrandmother = resolveParent(fatherRef, 'mother')
      const maternalGrandfather = resolveParent(motherRef, 'father')
      const maternalGrandmother = resolveParent(motherRef, 'mother')
      const directPaternalGrandfather = resolveRelative(row, [
        'paternal_grandsire',
        'paternal_grandfather',
        'sire_sire',
        'father_father',
        '祖父',
        '父系祖父'
      ])
      const directPaternalGrandmother = resolveRelative(row, [
        'paternal_granddam',
        'paternal_grandmother',
        'sire_dam',
        'father_mother',
        '祖母',
        '父系祖母'
      ])
      const directMaternalGrandfather = resolveRelative(row, [
        'maternal_grandsire',
        'maternal_grandfather',
        'dam_sire',
        'mother_father',
        'grandfather',
        '外祖父',
        '母系祖父'
      ])
      const directMaternalGrandmother = resolveRelative(row, [
        'maternal_granddam',
        'maternal_grandmother',
        'dam_dam',
        'mother_mother',
        'grandmother',
        '外祖母',
        '母系祖母'
      ])

      const paternalGrandfatherNumber =
        paternalGrandfather.number ||
        directPaternalGrandfather.number ||
        fallback.paternalGrandfatherNumber
      const paternalGrandmotherNumber =
        paternalGrandmother.number ||
        directPaternalGrandmother.number ||
        fallback.paternalGrandmotherNumber
      const maternalGrandfatherNumber =
        maternalGrandfather.number ||
        directMaternalGrandfather.number ||
        fallback.maternalGrandfatherNumber
      const maternalGrandmotherNumber =
        maternalGrandmother.number ||
        directMaternalGrandmother.number ||
        fallback.maternalGrandmotherNumber
      const paternalGrandfatherRef = paternalGrandfather.number
        ? paternalGrandfather
        : directPaternalGrandfather.number
          ? directPaternalGrandfather
          : knownAnimalRef(paternalGrandfatherNumber)
      const paternalGrandmotherRef = paternalGrandmother.number
        ? paternalGrandmother
        : directPaternalGrandmother.number
          ? directPaternalGrandmother
          : knownAnimalRef(paternalGrandmotherNumber)
      const maternalGrandfatherRef = maternalGrandfather.number
        ? maternalGrandfather
        : directMaternalGrandfather.number
          ? directMaternalGrandfather
          : knownAnimalRef(maternalGrandfatherNumber)
      const maternalGrandmotherRef = maternalGrandmother.number
        ? maternalGrandmother
        : directMaternalGrandmother.number
          ? directMaternalGrandmother
          : knownAnimalRef(maternalGrandmotherNumber)

      const values = emptyPedigreeValues()
      values.fatherNumber = father.number || fallback.fatherNumber
      values.motherNumber = mother.number || fallback.motherNumber
      values.paternalGrandfatherNumber = paternalGrandfatherNumber
      values.paternalGrandmotherNumber = paternalGrandmotherNumber
      values.maternalGrandfatherNumber = maternalGrandfatherNumber
      values.maternalGrandmotherNumber = maternalGrandmotherNumber
      values.paternalGrandfatherFatherNumber =
        resolveParent(paternalGrandfatherRef, 'father').number ||
        fallback.paternalGrandfatherFatherNumber
      values.paternalGrandfatherMotherNumber =
        resolveParent(paternalGrandfatherRef, 'mother').number ||
        fallback.paternalGrandfatherMotherNumber
      values.paternalGrandmotherFatherNumber =
        resolveParent(paternalGrandmotherRef, 'father').number ||
        fallback.paternalGrandmotherFatherNumber
      values.paternalGrandmotherMotherNumber =
        resolveParent(paternalGrandmotherRef, 'mother').number ||
        fallback.paternalGrandmotherMotherNumber
      values.maternalGrandfatherFatherNumber =
        resolveParent(maternalGrandfatherRef, 'father').number ||
        fallback.maternalGrandfatherFatherNumber
      values.maternalGrandfatherMotherNumber =
        resolveParent(maternalGrandfatherRef, 'mother').number ||
        fallback.maternalGrandfatherMotherNumber
      values.maternalGrandmotherFatherNumber =
        resolveParent(maternalGrandmotherRef, 'father').number ||
        fallback.maternalGrandmotherFatherNumber
      values.maternalGrandmotherMotherNumber =
        resolveParent(maternalGrandmotherRef, 'mother').number ||
        fallback.maternalGrandmotherMotherNumber
      return values
    }
  }

  function directParentRoleMatches(value: unknown, parentType: 'father' | 'mother') {
    const raw = str(value).toLowerCase().trim()
    if (!raw) return false
    const compact = raw.replace(/[\s_-]/g, '')
    const fatherExact = ['sire', 'father', 'dad', 'maleparent', '父', '父号', '父本', '公牛']
    const motherExact = ['dam', 'mother', 'mom', 'femaleparent', '母', '母号', '母本', '母牛']
    if (parentType === 'father' && fatherExact.includes(compact)) return true
    if (parentType === 'mother' && motherExact.includes(compact)) return true
    if (compact.includes('grand') || raw.includes('祖')) return false
    if (parentType === 'father')
      return compact.includes('sire') || compact.includes('father') || raw.includes('父')
    return compact.includes('dam') || compact.includes('mother') || raw.includes('母')
  }

  function ancestorRoleMatches(value: unknown, roles: string[]) {
    const raw = str(value).toLowerCase().trim()
    const compact = raw.replace(/[\s_-]/g, '')
    return roles.some((role) => {
      const normalized = role.toLowerCase().replace(/[\s_-]/g, '')
      return compact === normalized || compact.includes(normalized) || raw.includes(role)
    })
  }

  function emptyPedigreeValues() {
    return Object.fromEntries(pedigreeFieldKeys.map((key) => [key, ''])) as Record<string, string>
  }

  function pickPedigreeValues(...sources: Array<Record<string, unknown> | null | undefined>) {
    const values = emptyPedigreeValues()
    pedigreeFieldKeys.forEach((key) => {
      for (const source of sources) {
        const value = str(source?.[key])
        if (value) {
          values[key] = value
          break
        }
      }
    })
    return values
  }

  function fallbackPedigreeValues(row: Record<string, unknown>) {
    return {
      ...emptyPedigreeValues(),
      fatherNumber: str(row.fatherNumber ?? row.father_number ?? row.sireNumber ?? row.sire_number),
      motherNumber: str(row.motherNumber ?? row.mother_number ?? row.damNumber ?? row.dam_number),
      paternalGrandfatherNumber: str(
        row.paternalGrandfatherNumber ??
          row.paternal_grandfather_number ??
          row.sireFatherNumber ??
          row.sire_father_number
      ),
      paternalGrandmotherNumber: str(
        row.paternalGrandmotherNumber ??
          row.paternal_grandmother_number ??
          row.sireMotherNumber ??
          row.sire_mother_number
      ),
      maternalGrandfatherNumber: str(
        row.maternalGrandfatherNumber ??
          row.maternal_grandfather_number ??
          row.damFatherNumber ??
          row.dam_father_number ??
          row.grandfatherNumber ??
          row.grandfather_number
      ),
      maternalGrandmotherNumber: str(
        row.maternalGrandmotherNumber ??
          row.maternal_grandmother_number ??
          row.damMotherNumber ??
          row.dam_mother_number ??
          row.grandmotherNumber ??
          row.grandmother_number
      ),
      paternalGrandfatherFatherNumber: str(
        row.paternalGrandfatherFatherNumber ?? row.paternal_grandfather_father_number
      ),
      paternalGrandfatherMotherNumber: str(
        row.paternalGrandfatherMotherNumber ?? row.paternal_grandfather_mother_number
      ),
      paternalGrandmotherFatherNumber: str(
        row.paternalGrandmotherFatherNumber ?? row.paternal_grandmother_father_number
      ),
      paternalGrandmotherMotherNumber: str(
        row.paternalGrandmotherMotherNumber ?? row.paternal_grandmother_mother_number
      ),
      maternalGrandfatherFatherNumber: str(
        row.maternalGrandfatherFatherNumber ?? row.maternal_grandfather_father_number
      ),
      maternalGrandfatherMotherNumber: str(
        row.maternalGrandfatherMotherNumber ?? row.maternal_grandfather_mother_number
      ),
      maternalGrandmotherFatherNumber: str(
        row.maternalGrandmotherFatherNumber ?? row.maternal_grandmother_father_number
      ),
      maternalGrandmotherMotherNumber: str(
        row.maternalGrandmotherMotherNumber ?? row.maternal_grandmother_mother_number
      )
    }
  }

  function animalIdOf(row: Record<string, unknown>) {
    return str(row.id ?? row.animalId ?? row.animal_id ?? row.cowId ?? row.cow_id)
  }

  function animalNumberOf(row: Record<string, unknown>) {
    return str(row.animalNumber ?? row.animal_number ?? row.cowNumber ?? row.cow_number)
  }

  function parityValueOf(row: Record<string, unknown>) {
    return firstNumericLikeValue(
      row.parity,
      row.parityNo,
      row.parity_no,
      row.parityNumber,
      row.parity_number,
      row.lactationNo,
      row.lactation_no,
      row.lactationNumber,
      row.lactation_number
    )
  }

  function currentParityValueOf(row: Record<string, unknown>) {
    return firstNumericLikeValue(
      row.currentParity,
      row.current_parity,
      row.currentParityNo,
      row.current_parity_no,
      row.latestParity,
      row.latest_parity,
      row.maxParity,
      row.max_parity,
      row.totalParity,
      row.total_parity,
      parityValueOf(row)
    )
  }

  function parityCalvingDateOf(row: Record<string, unknown>) {
    return firstDateLikeValue(
      row.parityCalvingDate,
      row.parity_calving_date,
      row.currentParityCalvingDate,
      row.current_parity_calving_date,
      row.latestCalvingDate,
      row.latest_calving_date,
      row.calvingDate,
      row.calving_date,
      row.startEventDate,
      row.start_event_date,
      row.lactationStartDate,
      row.lactation_start_date,
      row.startDate,
      row.start_date
    )
  }

  function buildParitySummaryResolver(rows: any[]) {
    const byKey = new Map<
      string,
      Array<{ parity: number; startDate: string; startTime: number; isOpen: boolean }>
    >()
    rows.forEach((row) => {
      const parity = numericValue(
        row.parityNo ?? row.parity_no ?? row.parity ?? row.lactationNo ?? row.lactation_no
      )
      const startDate = str(row.startDate || row.start_date || row.calvingDate || row.calving_date)
      const startTime = Date.parse(startDate)
      if (!parity || !startDate || !Number.isFinite(startTime)) return
      const status = str(row.parityStatus || row.parity_status || row.status).toLowerCase()
      const item = {
        parity,
        startDate,
        startTime,
        isOpen:
          !status ||
          status.includes('open') ||
          status.includes('current') ||
          status.includes('进行') ||
          status.includes('当前')
      }
      const keys = Array.from(
        new Set(
          [
            str(row.animalId || row.animal_id || row.cowId || row.cow_id),
            str(row.animalNumber || row.animal_number || row.cowNumber || row.cow_number)
          ].filter(Boolean)
        )
      )
      keys.forEach((key) => byKey.set(key, [...(byKey.get(key) || []), item]))
    })
    byKey.forEach((items, key) => {
      byKey.set(
        key,
        items.sort(
          (left, right) =>
            Number(right.isOpen) - Number(left.isOpen) ||
            right.parity - left.parity ||
            right.startTime - left.startTime
        )
      )
    })
    return {
      resolve(cowId: unknown, cowNumber: unknown) {
        for (const key of [str(cowId), str(cowNumber)].filter(Boolean)) {
          const item = byKey.get(key)?.[0]
          if (item) return item
        }
        return null
      }
    }
  }

  function firstDateLikeValue(...values: unknown[]) {
    for (const value of values) {
      const raw = str(value)
      if (!raw) continue
      const time = Date.parse(raw)
      if (Number.isFinite(time)) return raw.slice(0, 10)
    }
    return ''
  }

  function firstNumericLikeValue(...values: unknown[]) {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue
      const numeric = numericValue(value)
      if (numeric !== null) return numeric
      const match = str(value).match(/-?\d+/)
      if (match) return Number(match[0])
    }
    return undefined
  }

  function buildCowContext(
    cows: any[],
    animals: any[],
    parentageRows: any[] = [],
    identifiers: any[] = []
  ) {
    const byId = new Map<string, ReturnType<typeof normalizeCowContext>>()
    const byNumber = new Map<string, ReturnType<typeof normalizeCowContext>>()
    const normalizedCows: ReturnType<typeof normalizeCowContext>[] = []
    const resolvePedigree = buildPedigreeResolver(animals, cows, parentageRows)
    ;[...animals, ...cows].forEach((row) => {
      const context = { ...normalizeCowContext(row), ...resolvePedigree(row) }
      const previous =
        (context.id ? byId.get(context.id) : undefined) ||
        (context.cowNumber ? byNumber.get(context.cowNumber) : undefined)
      const merged = mergeCowContexts(previous, context)
      if (merged.id) byId.set(merged.id, merged)
      if (merged.cowNumber) byNumber.set(merged.cowNumber, merged)
    })
    normalizedCows.push(
      ...Array.from(
        new Map(
          [...byId.values(), ...byNumber.values()].map((row) => [
            `${row.id || ''}|${row.cowNumber || ''}`,
            row
          ])
        ).values()
      )
    )
    return { byId, byNumber, reference: buildCowReferenceContext(normalizedCows, identifiers) }
  }

  function mergeCowContexts(
    previous: ReturnType<typeof normalizeCowContext> | undefined,
    next: ReturnType<typeof normalizeCowContext>
  ) {
    if (!previous) return { ...next, breed: firstRealBreed(next.breed) }
    return {
      ...previous,
      ...next,
      id: str(previous.id || next.id),
      cowNumber: str(previous.cowNumber || next.cowNumber),
      cowName: str(next.cowName || previous.cowName),
      breed: firstRealBreed(previous.breed, next.breed),
      currentPen: str(next.currentPen || previous.currentPen),
      herdGroup: str(next.herdGroup || previous.herdGroup),
      productionStage: str(next.productionStage || previous.productionStage),
      status: str(next.status || previous.status),
      parity: next.parity || previous.parity,
      currentParity: next.currentParity || previous.currentParity,
      parityCalvingDate: str(next.parityCalvingDate || previous.parityCalvingDate)
    }
  }

  function normalizeCowContext(row: any) {
    return {
      id: animalIdOf(row),
      cowNumber: animalNumberOf(row),
      cowName: str(row.earTagNumber || row.ear_tag_number || row.name),
      breed: breedFieldValue(row),
      currentPen: str(
        row.currentPen ||
          row.current_pen ||
          row.currentPenId ||
          row.current_pen_id ||
          row.currentUnitId ||
          row.current_unit_id
      ),
      herdGroup: str(
        row.herdGroup ||
          row.herd_group ||
          row.groupName ||
          row.group_name ||
          row.currentGroupName ||
          row.current_group_name ||
          row.currentGroupId ||
          row.current_group_id
      ),
      productionStage: str(
        row.productionStage ||
          row.production_stage ||
          row.productionPurpose ||
          row.production_purpose ||
          row.currentStageName ||
          row.current_stage_name ||
          row.currentStageId ||
          row.current_stage_id ||
          row.type
      ),
      status: str(row.status),
      parity: parityValueOf(row),
      currentParity: currentParityValueOf(row),
      parityCalvingDate: parityCalvingDateOf(row),
      reproductionCycle: reproductionCycleOf(row),
      pregnancyStage: pregnancyStageOf(row),
      dryPeriod: dryPeriodOf(row),
      ...pickPedigreeValues(row)
    }
  }

  function reproductionCycleOf(row: any) {
    return str(
      row.reproductionCycle ??
        row.reproduction_cycle ??
        row.cycleNo ??
        row.cycle_no ??
        row.reproductionCycleNo ??
        row.reproduction_cycle_no ??
        (row.parity || row.parityNo || row.parity_no
          ? `第 ${row.parity || row.parityNo || row.parity_no} 胎繁殖周期`
          : '')
    )
  }

  function pregnancyStageOf(row: any) {
    const explicit = str(
      row.pregnancyStage ?? row.pregnancy_stage ?? row.gestationStage ?? row.gestation_stage
    )
    if (explicit) return explicit
    const days = numericValue(
      row.pregnancyDays ?? row.pregnancy_days ?? row.gestationDays ?? row.gestation_days
    )
    if (days !== null) {
      if (days <= 90) return '妊娠早期'
      if (days <= 210) return '妊娠中期'
      return '妊娠后期'
    }
    const text = str(row.pregnancy ?? row.isPregnant ?? row.is_pregnant ?? row.status).toLowerCase()
    if (text.includes('false') || text === '0' || text === '否' || text.includes('空怀'))
      return '未妊娠'
    if (
      text.includes('true') ||
      text === '1' ||
      text === '是' ||
      text.includes('妊') ||
      text.includes('孕')
    )
      return '妊娠期'
    return ''
  }

  function dryPeriodOf(row: any) {
    const explicit = str(row.dryPeriod ?? row.dry_period ?? row.dryPeriodNo ?? row.dry_period_no)
    if (explicit) return explicit
    const text = str(
      row.status ?? row.productionStage ?? row.production_stage ?? row.type
    ).toLowerCase()
    if (text.includes('dry') || text.includes('干奶')) return '干奶期'
    return ''
  }

  function lactationKey(row: ExportRow) {
    const parity = str(row.parity)
    if (parity) return `第 ${parity} 胎泌乳期`
    const dim = numericValue(row.daysInMilk)
    if (dim !== null) return `泌乳 ${Math.max(1, Math.ceil(dim / 305))} 期`
    return '泌乳期未填'
  }

  function parityCalvingDateValue(row: ExportRow) {
    const date = str(row.parityCalvingDate || parityCalvingDateOf(row))
    const parity = str(row.parity || row.currentParity)
    if (date && parity) return `第 ${parity} 胎 · ${date}`
    if (date) return date
    if (parity) return `第 ${parity} 胎 · 产犊时间未填`
    return '本胎产犊时间未填'
  }

  function cycleValue(row: ExportRow, field: string, fallback: string) {
    return str(row[field]) || fallback
  }

  function uniqueText(values: unknown[]) {
    return Array.from(new Set(values.map((value) => str(value)).filter(Boolean))).sort(
      (left, right) => left.localeCompare(right, 'zh-CN')
    )
  }

  function dominantContext(group: ExportRow[]) {
    return {
      breed: dominantValue(group, 'breed'),
      currentPen: dominantValue(group, 'currentPen'),
      herdGroup: dominantValue(group, 'herdGroup'),
      productionStage: dominantValue(group, 'productionStage'),
      status: dominantValue(group, 'status'),
      parity: dominantValue(group, 'parity'),
      currentParity: dominantValue(group, 'currentParity'),
      parityCalvingDate: dominantValue(group, 'parityCalvingDate'),
      milkingShift: dominantValue(group, 'milkingShift'),
      reproductionCycle: dominantValue(group, 'reproductionCycle'),
      pregnancyStage: dominantValue(group, 'pregnancyStage'),
      dryPeriod: dominantValue(group, 'dryPeriod'),
      equipmentId: dominantValue(group, 'equipmentId'),
      collector: dominantValue(group, 'collector'),
      operatorName: dominantValue(group, 'operatorName'),
      ...Object.fromEntries(pedigreeFieldKeys.map((key) => [key, dominantValue(group, key)]))
    }
  }

  function dominantValue(group: ExportRow[], key: string) {
    const counts = new Map<string, number>()
    group.forEach((row) => {
      const value = key === 'breed' ? firstRealBreed(row[key]) : str(row[key])
      if (!value) return
      counts.set(value, (counts.get(value) || 0) + 1)
    })
    return (
      Array.from(counts.entries()).sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN')
      )[0]?.[0] || ''
    )
  }

  function _roleMatches(value: unknown, roles: string[]) {
    const text = str(value).toLowerCase()
    return roles.some((role) => text.includes(role))
  }

  function dateKeys(value: unknown) {
    const raw = str(value)
    if (!raw) return emptyDateKeys()
    const date = new Date(raw)
    if (!Number.isFinite(date.getTime())) {
      const dateKey = raw.length >= 10 ? raw.slice(0, 10) : raw
      const monthKey = raw.length >= 7 ? raw.slice(0, 7) : ''
      const yearKey = raw.length >= 4 ? raw.slice(0, 4) : ''
      const day = Number(dateKey.slice(8, 10))
      return {
        dateKey,
        weekKey: dateKey,
        tenDayKey: tenDayFromParts(monthKey, day),
        halfMonthKey: halfMonthFromParts(monthKey, day),
        monthKey,
        quarterKey: quarterFromMonth(monthKey),
        halfYearKey: halfYearFromMonth(monthKey),
        yearKey,
        seasonKey: seasonFromMonth(monthKey)
      }
    }
    const year = date.getFullYear()
    const monthNumber = date.getMonth() + 1
    const month = String(monthNumber).padStart(2, '0')
    const dayNumber = date.getDate()
    const day = String(dayNumber).padStart(2, '0')
    const monthKey = `${year}-${month}`
    return {
      dateKey: `${year}-${month}-${day}`,
      weekKey: isoWeekKey(date),
      tenDayKey: tenDayFromParts(monthKey, dayNumber),
      halfMonthKey: halfMonthFromParts(monthKey, dayNumber),
      monthKey,
      quarterKey: quarterFromMonth(monthKey),
      halfYearKey: halfYearFromMonth(monthKey),
      yearKey: String(year),
      seasonKey: seasonFromMonth(monthKey)
    }
  }

  function emptyDateKeys() {
    return {
      dateKey: '',
      weekKey: '',
      tenDayKey: '',
      halfMonthKey: '',
      monthKey: '',
      quarterKey: '',
      halfYearKey: '',
      yearKey: '',
      seasonKey: ''
    }
  }

  function tenDayFromParts(monthKey: string, day: number) {
    if (!monthKey) return ''
    if (!Number.isFinite(day) || day <= 0) return `${monthKey}-旬未填`
    if (day <= 10) return `${monthKey}-上旬`
    if (day <= 20) return `${monthKey}-中旬`
    return `${monthKey}-下旬`
  }

  function halfMonthFromParts(monthKey: string, day: number) {
    if (!monthKey) return ''
    if (!Number.isFinite(day) || day <= 0) return `${monthKey}-半月未填`
    return `${monthKey}-${day <= 15 ? '上半月' : '下半月'}`
  }

  function halfYearFromMonth(monthKey: string) {
    const year = monthKey.slice(0, 4)
    const month = Number(monthKey.slice(5, 7))
    if (!year || !Number.isFinite(month) || month < 1) return monthKey || ''
    return `${year}-H${month <= 6 ? 1 : 2}`
  }

  function seasonFromMonth(monthKey: string) {
    const year = monthKey.slice(0, 4)
    const month = Number(monthKey.slice(5, 7))
    if (!year || !Number.isFinite(month) || month < 1) return monthKey || ''
    if ([3, 4, 5].includes(month)) return `${year}-春季`
    if ([6, 7, 8].includes(month)) return `${year}-夏季`
    if ([9, 10, 11].includes(month)) return `${year}-秋季`
    return `${year}-冬季`
  }

  function dateOf(row: any) {
    return str(
      row.collectionDate ??
        row.collection_date ??
        row.observedAt ??
        row.observed_at ??
        row.measuredAt ??
        row.measured_at ??
        row.productionDate ??
        row.production_date ??
        row.milkingTime ??
        row.milking_time ??
        row.eventDate ??
        row.eventTime ??
        row.occurredAt ??
        row.occurred_at ??
        row.entryTime ??
        row.transferTime ??
        row.exitTime ??
        row.createdAt ??
        row.created_at ??
        ''
    )
  }

  function recordOperator(row: any) {
    return str(
      row.operatorName ??
        row.operator_name ??
        row.operator ??
        row.technician ??
        row.collector ??
        row.importer ??
        row.createdBy ??
        row.created_by ??
        row.updatedBy ??
        row.updated_by ??
        ''
    )
  }

  function dateValue(row: ExportRow) {
    return str(
      row.collectionDate ||
        row.eventDate ||
        row.period ||
        row.createdAt ||
        row.birthDate ||
        row.updatedAt
    )
  }

  function isoWeekKey(value: Date) {
    const date = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()))
    const day = date.getUTCDay() || 7
    date.setUTCDate(date.getUTCDate() + 4 - day)
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
    const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
  }

  function quarterFromMonth(monthKey: string) {
    const year = monthKey.slice(0, 4)
    const month = Number(monthKey.slice(5, 7))
    if (!year || !Number.isFinite(month) || month < 1) return monthKey || ''
    return `${year}-Q${Math.ceil(month / 3)}`
  }

  function rollingWindowKey(row: ExportRow, days: number) {
    const raw = dateValue(row)
    const time = Date.parse(raw)
    if (!Number.isFinite(time)) return raw || '-'
    const date = new Date(time)
    const dayIndex = Math.floor(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
    )
    const startIndex = Math.floor(dayIndex / days) * days
    const start = new Date(startIndex * 86400000)
    const end = new Date((startIndex + days - 1) * 86400000)
    return `${formatDateKey(start)} 至 ${formatDateKey(end)}`
  }

  function customWindowKey(row: ExportRow): string {
    if (configForm.filters.dateRange.length === 2)
      return `${configForm.filters.dateRange[0]} 至 ${configForm.filters.dateRange[1]}`
    return periodValue(row, 'month')
  }

  function periodValue(row: ExportRow, groupBy: GroupBy): string {
    const keys = dateKeys(dateValue(row))
    if (groupBy === 'day') return keys.dateKey || '-'
    if (groupBy === 'week') return keys.weekKey || '-'
    if (groupBy === 'ten_day') return keys.tenDayKey || '-'
    if (groupBy === 'half_month') return keys.halfMonthKey || '-'
    if (groupBy === 'month') return keys.monthKey || '-'
    if (groupBy === 'quarter') return keys.quarterKey || '-'
    if (groupBy === 'half_year') return keys.halfYearKey || '-'
    if (groupBy === 'year') return keys.yearKey || '-'
    if (groupBy === 'season') return keys.seasonKey || '-'
    if (groupBy === 'parity_calving_date') return parityCalvingDateValue(row)
    if (groupBy === 'milking_shift') return milkingShiftValue(row)
    if (groupBy === 'lactation_stage') return lactationStageValue(row)
    if (groupBy === 'dim_bucket') return dimBucketValue(row)
    if (groupBy === 'equipment') return equipmentValue(row)
    if (groupBy === 'collector') return collectorValue(row)
    if (groupBy === 'operator') return operatorValue(row)
    if (groupBy === 'rolling_7') return rollingWindowKey(row, 7)
    if (groupBy === 'rolling_30') return rollingWindowKey(row, 30)
    if (groupBy === 'rolling_90') return rollingWindowKey(row, 90)
    if (groupBy === 'custom_window') return customWindowKey(row)
    return keys.dateKey || '-'
  }

  function groupPeriodLabel(row: ExportRow) {
    if (configForm.period.groupBy === 'cow') return '单牛汇总'
    if (configForm.period.groupBy === 'parity')
      return row.parity ? `第 ${row.parity} 胎` : '胎次未填'
    if (configForm.period.groupBy === 'parity_calving_date') return parityCalvingDateValue(row)
    if (configForm.period.groupBy === 'lactation') return lactationKey(row)
    if (configForm.period.groupBy === 'lactation_305')
      return row.parity ? `第 ${row.parity} 胎 1-305天` : '1-305天'
    if (configForm.period.groupBy === 'lactation_stage') return lactationStageValue(row)
    if (configForm.period.groupBy === 'dim_bucket') return dimBucketValue(row)
    if (configForm.period.groupBy === 'reproduction_cycle')
      return cycleValue(row, 'reproductionCycle', '繁殖周期未填')
    if (configForm.period.groupBy === 'pregnancy')
      return cycleValue(row, 'pregnancyStage', '妊娠期未填')
    if (configForm.period.groupBy === 'dry_period')
      return cycleValue(row, 'dryPeriod', '干奶期未填')
    if (configForm.period.groupBy === 'herd_group') return str(row.herdGroup || '牛群未填')
    if (configForm.period.groupBy === 'pen') return displayPenValue(row.currentPen) || '圈舍未填'
    if (configForm.period.groupBy === 'production_stage')
      return str(row.productionStage || row.type || row.status || '生产阶段未填')
    if (configForm.period.groupBy === 'milking_shift') return milkingShiftValue(row)
    if (configForm.period.groupBy === 'equipment') return equipmentValue(row)
    if (configForm.period.groupBy === 'collector') return collectorValue(row)
    if (configForm.period.groupBy === 'operator') return operatorValue(row)
    if (
      [
        'day',
        'week',
        'ten_day',
        'half_month',
        'month',
        'quarter',
        'half_year',
        'year',
        'season',
        'rolling_7',
        'rolling_30',
        'rolling_90',
        'custom_window'
      ].includes(configForm.period.groupBy)
    )
      return periodValue(row, configForm.period.groupBy)
    return dateValue(row) || '-'
  }

  function milkingShiftValue(row: ExportRow) {
    const explicit = explicitMilkingShiftValue(row)
    if (explicit) return explicit
    const raw = dateValue(row)
    const keys = dateKeys(raw)
    const time = Date.parse(raw)
    if (!Number.isFinite(time)) return `${keys.dateKey || '-'} 时段未填`
    if (!hasClockTime(raw)) return `${keys.dateKey || '-'} 班次未填`
    const hour = new Date(time).getHours()
    if (hour >= 5 && hour < 11) return `${keys.dateKey || '-'} 早班`
    if (hour >= 11 && hour < 17) return `${keys.dateKey || '-'} 中班`
    if (hour >= 17 && hour < 23) return `${keys.dateKey || '-'} 晚班`
    return `${keys.dateKey || '-'} 夜班`
  }

  function explicitMilkingShiftValue(row: Record<string, unknown>) {
    const value = str(
      row.milkingShift ??
        row.milking_shift ??
        row.shiftName ??
        row.shift_name ??
        row.shiftId ??
        row.shift_id ??
        row.shift ??
        row.sessionCode ??
        row.session_code
    ).trim()
    return value
  }

  function hasClockTime(value: unknown) {
    const raw = str(value)
    return /\d{1,2}:\d{2}/.test(raw) || /T\d{1,2}/.test(raw)
  }

  function lactationStageValue(row: ExportRow) {
    const dim = numericValue(row.daysInMilk)
    if (dim === null) return '泌乳阶段未填'
    if (dim < 1) return 'DIM无效'
    if (dim <= 30) return '泌乳初期 1-30天'
    if (dim <= 100) return '泌乳前期 31-100天'
    if (dim <= 200) return '泌乳中期 101-200天'
    if (dim <= 305) return '泌乳后期 201-305天'
    return '延长泌乳期 305天以上'
  }

  function dimBucketValue(row: ExportRow) {
    const dim = numericValue(row.daysInMilk)
    if (dim === null) return 'DIM未填'
    if (dim < 1) return 'DIM无效'
    if (dim <= 30) return 'DIM 1-30'
    if (dim <= 60) return 'DIM 31-60'
    if (dim <= 100) return 'DIM 61-100'
    if (dim <= 150) return 'DIM 101-150'
    if (dim <= 200) return 'DIM 151-200'
    if (dim <= 305) return 'DIM 201-305'
    return 'DIM 305以上'
  }

  function equipmentValue(row: ExportRow) {
    return str(row.equipmentId || row.sourceTable || '设备/批次未填')
  }

  function collectorValue(row: ExportRow) {
    return str(row.collector || row.operatorName || '采集人未填')
  }

  function operatorValue(row: ExportRow) {
    return str(row.operatorName || row.collector || '操作人未填')
  }

  function dimRange(group: ExportRow[]) {
    const values = group
      .map((row) => numericValue(row.daysInMilk))
      .filter((value): value is number => value !== null)
    if (!values.length) return ''
    return `${Math.min(...values)}-${Math.max(...values)}`
  }

  function formatDateKey(date: Date) {
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function numericValue(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }

  function numberOrBlank(value: unknown) {
    const numeric = numericValue(value)
    return numeric === null ? '' : numeric
  }

  function round(value: number) {
    return Math.round(value * 10000) / 10000
  }

  function str(value: unknown) {
    return String(value ?? '').trim()
  }

  function firstRealBreed(...values: unknown[]) {
    for (const value of values) {
      const text = str(value)
      if (text && !isPlaceholderBreed(text)) return text
    }
    return ''
  }

  function breedFieldValue(row: Record<string, unknown> | null | undefined) {
    if (!row) return ''
    return firstRealBreed(
      row.breed,
      row.breedName,
      row.breed_name,
      row.breedType,
      row.breed_type,
      row.breedCode,
      row.breed_code,
      row.breedId,
      row.breed_id,
      row.species
    )
  }

  function isPlaceholderBreed(value: unknown) {
    const text = str(value)
    if (!text) return true
    return /^(待补全|待补|未登记|未填|未知|无|none|null|undefined|-|--|n\/a)$/i.test(text)
  }

  function formatCell(value: unknown) {
    if (value === null || value === undefined || value === '') return '-'
    return String(value)
  }

  function _priorityLabel(index: number) {
    return ['第一优先级', '第二优先级', '第三优先级'][index] || `第 ${index + 1} 优先级`
  }

  function strategyTypeLabel(value: StrategyType) {
    return strategyTypeOptions.find((item) => item.value === value)?.label || value
  }

  function groupByLabel(value: GroupBy) {
    return groupByOptions.find((item) => item.value === value)?.label || value
  }

  function aggregationLabel(value: Aggregation) {
    return aggregationOptions.find((item) => item.value === value)?.label || value
  }

  function getOperator() {
    const info = userStore.info || {}
    return str(info.userName || info.userId || '当前登录账号')
  }

  function makeId(prefix: string) {
    const random = window.crypto?.randomUUID
      ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
    return `${prefix}-${Date.now().toString(36)}-${random}`
  }

  function formatTimestamp(date: Date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    const second = String(date.getSeconds()).padStart(2, '0')
    return `${year}${month}${day}_${hour}${minute}${second}`
  }

  function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, '_')
  }
</script>

<style scoped lang="scss">
  .information-export-page {
    display: grid;
    gap: 18px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow-x: visible;
    padding: 18px;
    box-sizing: border-box;
  }

  .export-title-row,
  .strategy-panel,
  .preview-panel,
  .config-block,
  .drawer-summary,
  .stat-card {
    min-width: 0;
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    background: var(--fluent-surface);
    box-shadow: var(--fluent-inset-highlight);
  }

  .export-title-row {
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;
    padding: 18px;

    > div:first-child {
      min-width: 0;
    }
  }

  .export-title-row h1,
  .preview-head h2,
  .config-block h3,
  .drawer-summary h3 {
    margin: 0;
    color: var(--fluent-text);
  }

  .export-title-row h1 {
    font-size: 22px;
    font-weight: 780;
  }

  .export-title-row p,
  .preview-head p,
  .config-block p,
  .drawer-summary p,
  .information-strategy-card p {
    margin: 6px 0 0;
    color: var(--fluent-text-muted);
    font-size: 13px;
    line-height: 1.6;
  }

  .title-actions,
  .preview-actions,
  .output-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }

  .export-stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
    min-width: 0;
  }

  .stat-card {
    display: grid;
    gap: 8px;
    padding: 16px;
  }

  .stat-card span {
    color: var(--fluent-text-muted);
    font-size: 13px;
  }

  .stat-card strong {
    color: var(--fluent-text);
    font-size: 24px;
    font-weight: 780;
  }

  .strategy-panel,
  .preview-panel {
    min-width: 0;
    padding: 16px;
  }

  .panel-section-head {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    justify-content: space-between;
    min-width: 0;
    padding-bottom: 14px;
    margin-bottom: 14px;
    border-bottom: 1px solid var(--fluent-border);
  }

  .panel-section-head > div {
    min-width: 0;
  }

  .panel-section-head span {
    color: var(--fluent-primary);
    font-size: 12px;
    font-weight: 760;
  }

  .panel-section-head h2 {
    margin: 4px 0 0;
    color: var(--fluent-text);
    font-size: 17px;
    font-weight: 760;
    letter-spacing: 0;
  }

  .strategy-toolbar {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(220px, 360px);
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }

  .information-strategy-viewport {
    position: relative;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 2px 8px 2px 2px;
    scrollbar-width: thin;
  }

  .information-strategy-spacer {
    position: relative;
  }

  .strategy-empty-state {
    display: grid;
    min-height: 160px;
    place-items: center;
    color: var(--fluent-text-muted);
    font-size: 13px;
    border: 1px dashed rgb(var(--fluent-primary-rgb) / 24%);
    border-radius: 8px;
    background: rgb(255 255 255 / 38%);
  }

  .information-strategy-grid {
    position: absolute;
    inset: 0 0 auto;
    display: grid;
    will-change: transform;
  }

  .information-strategy-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 7px;
    box-sizing: border-box;
    height: 304px;
    min-width: 0;
    padding: 12px;
    overflow: hidden;
    background: #fff;
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--strategy-accent, var(--fluent-primary));
    border-radius: 8px;
    box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
    transition:
      transform 160ms ease,
      box-shadow 160ms ease,
      background-color 160ms ease,
      border-color 160ms ease;
  }

  .information-strategy-card::before {
    position: absolute;
    inset: 0 0 auto;
    height: 3px;
    content: '';
    background: var(--strategy-accent, var(--fluent-primary));
    opacity: 0.72;
  }

  .information-strategy-card.teal {
    --strategy-accent: var(--fluent-teal);
  }

  .information-strategy-card.info {
    --strategy-accent: #2563eb;
  }

  .information-strategy-card.warning {
    --strategy-accent: var(--fluent-amber);
  }

  .information-strategy-card.danger {
    --strategy-accent: var(--fluent-danger);
  }

  .information-strategy-card.active {
    border-color: rgb(var(--fluent-primary-rgb) / 36%);
    box-shadow: inset 0 0 0 1px rgb(var(--fluent-primary-rgb) / 14%);
  }

  .information-strategy-card:hover,
  .information-strategy-card:focus-visible {
    transform: translate3d(0, -3px, 0);
    border-color: rgb(var(--fluent-primary-rgb) / 45%);
    background: rgb(248 250 252);
    box-shadow: 0 14px 28px rgb(15 23 42 / 10%);
    outline: none;
  }

  .strategy-card-top,
  .strategy-title-wrap,
  .strategy-card-actions {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .strategy-card-top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    min-width: 0;
    min-height: 40px;
  }

  .strategy-card-top > .el-tag {
    flex: 0 0 auto;
    max-width: 48px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .strategy-title-wrap {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    min-width: 0;
    align-items: flex-start;
    justify-content: flex-start;
  }

  .strategy-title-wrap > div {
    min-width: 0;
  }

  .strategy-icon {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    color: var(--strategy-accent, var(--fluent-primary));
    font-size: 16px;
    font-weight: 800;
    background: color-mix(in srgb, var(--strategy-accent, var(--fluent-primary)) 12%, transparent);
    border: 1px solid
      color-mix(in srgb, var(--strategy-accent, var(--fluent-primary)) 20%, transparent);
    border-radius: 8px;
  }

  .strategy-eyebrow {
    display: block;
    max-width: 100%;
    overflow: hidden;
    color: var(--strategy-accent, var(--fluent-primary));
    font-size: 12px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .information-strategy-card h3 {
    display: -webkit-box;
    margin: 3px 0 0;
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 14px;
    font-weight: 760;
    line-height: 1.28;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .strategy-description {
    display: -webkit-box;
    min-height: 30px;
    max-height: 30px;
    overflow: hidden;
    margin: 0 !important;
    color: var(--fluent-text-soft) !important;
    font-size: 12px !important;
    line-height: 1.42 !important;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .strategy-source-line {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
    min-height: 30px;
    padding: 5px 8px;
    background: rgb(255 255 255 / 52%);
    border: 1px solid rgb(15 23 42 / 6%);
    border-radius: 8px;
  }

  .strategy-source-line span,
  .strategy-metric-row span {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
    white-space: nowrap;
  }

  .strategy-source-line span {
    flex: 0 0 auto;
  }

  .strategy-source-line strong {
    min-width: 0;
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 12px;
    font-weight: 720;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .strategy-metric-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    min-height: 44px;
  }

  .strategy-metric-row div {
    display: grid;
    gap: 2px;
    min-width: 0;
    padding: 5px 7px;
    background: rgb(255 255 255 / 48%);
    border: 1px solid rgb(15 23 42 / 6%);
    border-radius: 8px;
  }

  .strategy-metric-row strong {
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 12px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .strategy-field-strip {
    display: flex;
    flex-wrap: nowrap;
    gap: 6px;
    min-width: 0;
    min-height: 26px;
    max-height: 26px;
    overflow: hidden;
  }

  .strategy-field-strip span {
    flex: 1 1 0;
    min-width: 0;
    padding: 3px 8px;
    overflow: hidden;
    color: color-mix(in srgb, var(--strategy-accent, var(--fluent-primary)) 82%, #111827);
    font-size: 12px;
    font-weight: 680;
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: color-mix(in srgb, var(--strategy-accent, var(--fluent-primary)) 10%, white);
    border: 1px solid
      color-mix(in srgb, var(--strategy-accent, var(--fluent-primary)) 16%, transparent);
    border-radius: 999px;
  }

  .strategy-card-actions {
    align-items: center;
    justify-content: space-between;
    min-height: 32px;
    margin-top: auto;
    padding-top: 0;
  }

  .strategy-card-actions .el-button {
    height: 30px;
    padding: 0 12px;
  }

  .strategy-card-actions .strategy-config-button.el-button {
    min-width: 92px;
    color: #fff !important;
    background: #2f7d32 !important;
    border-color: #2f7d32 !important;
    box-shadow: none !important;
  }

  .strategy-card-actions .strategy-config-button.el-button:hover,
  .strategy-card-actions .strategy-config-button.el-button:focus {
    color: #fff !important;
    background: #256d2b !important;
    border-color: #256d2b !important;
  }

  .strategy-card-actions :deep(.strategy-config-button.el-button > span) {
    color: #fff !important;
    font-weight: 760;
  }

  .strategy-card-actions .el-button--text {
    color: var(--fluent-text-soft) !important;
  }

  .strategy-card-actions :deep(.el-button--text > span) {
    color: var(--fluent-text-soft) !important;
  }

  .preview-head {
    display: flex;
    gap: 14px;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
    margin-bottom: 14px;
  }

  .preview-head > div {
    min-width: 0;
  }

  .preview-head p {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-table-shell {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow: auto;
    overscroll-behavior: contain;
    max-height: min(54vh, 520px);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 18%);
    border-radius: 8px;
    scrollbar-width: thin;
  }

  .preview-table-shell :deep(.el-table) {
    width: max-content;
  }

  .preview-table-shell :deep(.el-table__inner-wrapper) {
    min-width: 100%;
  }

  .preview-column-header {
    display: grid;
    grid-template-columns: 26px minmax(64px, 1fr) auto;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }

  .preview-column-name {
    min-width: 0;
    overflow: hidden;
    color: var(--fluent-text);
    font-weight: 720;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sort-rank-button,
  .sort-direction-buttons button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fluent-text-muted);
    background: rgb(255 255 255 / 72%);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 18%);
    border-radius: 6px;
    cursor: pointer;
  }

  .sort-rank-button {
    width: 24px;
    height: 24px;
    font-size: 12px;
    font-weight: 760;
  }

  .sort-rank-button.active,
  .sort-direction-buttons button.active {
    color: var(--fluent-primary);
    background: rgb(var(--fluent-primary-rgb) / 10%);
    border-color: rgb(var(--fluent-primary-rgb) / 42%);
  }

  .sort-direction-buttons {
    display: inline-flex;
    flex: 0 0 auto;
    gap: 3px;
  }

  .sort-direction-buttons button {
    width: 22px;
    height: 22px;
    padding: 0;
    font-size: 13px;
    line-height: 1;
  }

  .drawer-content {
    display: grid;
    gap: 16px;
  }

  .drawer-summary {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    justify-content: space-between;
    padding: 16px;

    > div:first-child {
      min-width: 0;
    }

    > .el-tag {
      flex: 0 0 auto;
    }
  }

  .drawer-summary span {
    color: var(--fluent-primary);
    font-size: 13px;
    font-weight: 700;
  }

  .config-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .config-block {
    display: grid;
    gap: 12px;
    padding: 16px;
  }

  .config-block.wide {
    grid-column: 1 / -1;
  }

  .block-head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .block-head h3 {
    font-size: 15px;
    font-weight: 760;
  }

  .field-check-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
    gap: 8px 10px;
  }

  .field-check-sections {
    display: grid;
    gap: 12px;
  }

  .field-check-section {
    display: grid;
    gap: 10px;
    padding: 12px 14px 14px;
    background: rgb(255 255 255 / 58%);
    border: 1px solid var(--fluent-border);
    border-radius: 8px;
  }

  .field-check-section.is-collapsed {
    gap: 0;
    padding-bottom: 12px;
  }

  .field-section-head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    min-width: 0;
    width: 100%;
    padding-bottom: 8px;
    text-align: left;
    cursor: pointer;
    background: transparent;
    border: 0;
    border-bottom: 1px solid rgb(15 23 42 / 6%);
  }

  .field-check-section.is-collapsed .field-section-head {
    padding-bottom: 0;
    border-bottom: 0;
  }

  .field-section-head div {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .field-section-head strong {
    color: var(--fluent-text);
    font-size: 14px;
    font-weight: 780;
  }

  .field-section-head span {
    color: var(--fluent-muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .field-section-head em {
    flex: none;
    padding: 3px 8px;
    border: 1px solid rgb(var(--fluent-primary-rgb) / 15%);
    border-radius: 999px;
    color: var(--fluent-primary);
    background: rgb(var(--fluent-primary-rgb) / 8%);
    font-size: 12px;
    font-style: normal;
    font-weight: 700;
  }

  .field-check-grid :deep(.el-checkbox) {
    min-width: 0;
    height: 32px;
    padding: 0 8px;
    margin-right: 0;
    background: rgb(255 255 255 / 48%);
    border: 1px solid rgb(15 23 42 / 5%);
    border-radius: 7px;
    transition:
      border-color 160ms ease,
      box-shadow 160ms ease;
  }

  .field-check-grid :deep(.el-checkbox:hover) {
    border-color: rgb(var(--fluent-primary-rgb) / 28%);
    box-shadow: 0 8px 18px rgb(30 69 42 / 8%);
  }

  .field-check-grid :deep(.el-checkbox__label) {
    overflow: hidden;
    font-size: 12px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trait-column-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 30px;
    padding: 8px;
    border: 1px solid rgb(var(--fluent-primary-rgb) / 16%);
    border-radius: 8px;
    background: rgb(255 255 255 / 62%);
  }

  .trait-column-summary span,
  .trait-column-summary em {
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 12px;
    line-height: 1.4;
  }

  .trait-column-summary span {
    color: var(--fluent-primary);
    background: rgb(var(--fluent-primary-rgb) / 10%);
  }

  .trait-column-summary em {
    color: var(--fluent-text-muted);
    font-style: normal;
  }

  .form-stack,
  .sort-rule-list {
    display: grid;
    gap: 10px;
  }

  .inline-inputs,
  .sort-rule-row,
  .output-row {
    display: grid;
    gap: 10px;
  }

  .inline-inputs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sort-rule-row {
    grid-template-columns: 110px minmax(180px, 1fr) minmax(180px, 1fr) auto;
    align-items: center;
  }

  .sort-rule-row span {
    color: var(--fluent-text-muted);
    font-size: 13px;
  }

  .output-row {
    grid-template-columns: auto 1fr;
    align-items: center;
  }

  .output-actions {
    justify-content: flex-end;
  }

  .w-full {
    width: 100%;
  }

  @media (max-width: 1180px) {
    .export-stat-grid,
    .config-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .strategy-toolbar {
      grid-template-columns: 1fr;
      justify-content: stretch;
    }
  }

  @media (max-width: 760px) {
    .export-title-row,
    .preview-head,
    .drawer-summary,
    .block-head,
    .output-row {
      align-items: stretch;
      flex-direction: column;
    }

    .export-stat-grid,
    .config-grid,
    .strategy-toolbar,
    .inline-inputs,
    .sort-rule-row,
    .output-row {
      grid-template-columns: 1fr;
    }
  }
</style>
