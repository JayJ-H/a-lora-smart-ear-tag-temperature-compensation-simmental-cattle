<template>
  <FcPageShell
    title="表型记录"
    status-label="表型状态"
    :status-value="statusText"
    primary-action-label="新增表型采集"
    primary-action-icon="ri:add-line"
    secondary-action-label="刷新表型"
    secondary-action-icon="ri:refresh-line"
    @primary-action="addManualPhenotype"
    @secondary-action="loadData"
  >
    <template #metrics>
      <section class="floating-grid metric-grid">
        <FcMetricTile
          label="性状字典"
          :value="traitDefinitions.length"
          note="含 24 项体尺，支持平台管理维护"
          icon="ri:list-settings-line"
        />
        <FcMetricTile
          label="表型记录"
          :value="phenotypeRecords.length"
          note="按牛号、日期、性状小类存储"
          icon="ri:file-list-3-line"
          tone="teal"
        />
        <FcMetricTile
          label="覆盖个体"
          :value="coveredCowCount"
          note="已有泌乳、体重、体尺或传感器表型"
          icon="ri:team-line"
          tone="info"
        />
        <FcMetricTile
          label="关联就绪"
          :value="linkedReadyCount"
          note="同时具备表型、系谱和组学证据"
          icon="ri:node-tree"
          tone="warning"
        />
      </section>
    </template>

    <section class="main-layout">
      <div class="left-stack">
        <FcPanel title="性状选择" class="trait-panel">
          <div class="trait-layer-scroll">
            <div class="layer-grid">
              <button
                v-for="layer in traitLayers"
                :key="layer.category"
                class="surface-card layer-card art-card-sm"
                :class="{ active: selectedCategory === layer.category }"
                type="button"
                @click="selectCategory(layer.category)"
              >
                <span>{{ layer.category }}</span>
                <strong>{{ layer.recordCount }}</strong>
                <small>{{ layer.traitCount }} 个性状</small>
              </button>
            </div>
          </div>

          <div class="trait-picker">
            <button
              v-for="trait in visibleTraits"
              :key="trait.code"
              class="trait-chip art-card-xs"
              :class="{ active: selectedTraitCode === trait.code }"
              type="button"
              @click="selectTrait(trait.code)"
            >
              <span>{{ trait.name }}</span>
              <small>{{ traitRecordCount(trait.code) }} 条 · {{ displayUnit(trait.unit) }}</small>
            </button>
          </div>
        </FcPanel>

        <FcPanel title="单牛表型卡片" class="cow-phenotype-panel">
          <div
            v-if="phenotypeRecordsLoading"
            class="surface-card phenotype-loading-card art-card-xs"
          >
            <span>正在关联表型记录</span>
            <strong>表型记录加载中</strong>
          </div>
          <div class="card-toolbar">
            <CowNumberAutocomplete
              v-model="keyword"
              placeholder="搜索牛号、耳标、父号、母号"
              @select="handleCowKeywordSelect"
            />
            <ElSelect
              v-model="selectedCategory"
              placeholder="性状大类"
              @change="syncTraitWithCategory"
            >
              <ElOption
                v-for="category in traitCategories"
                :key="category"
                :label="category"
                :value="category"
              />
            </ElSelect>
          </div>

          <div
            ref="cowCardContainerRef"
            class="cow-card-scroll"
            @scroll.passive="onCowCardScroll"
            @wheel.passive="onCowCardWheel"
          >
            <div class="cow-card-grid">
              <button
                v-for="row in renderedCowRows"
                :key="row.cow.id"
                class="surface-card cow-card art-card"
                :class="{ active: selectedCowId === row.cow.id }"
                type="button"
                @click="openCowDetail(row.cow.id)"
              >
                <div class="cow-card-head">
                  <div>
                    <span>{{ penName(row.cow) }}</span>
                    <h3>牛号 {{ row.cow.cowNumber }}</h3>
                    <p
                      >父 {{ row.cow.fatherNumber || '-' }} / 母
                      {{ row.cow.motherNumber || '-' }}</p
                    >
                  </div>
                  <ElTag :type="row.tagType">{{ row.status }}</ElTag>
                </div>

                <div class="cow-trait-grid">
                  <div>
                    <span>当前性状</span>
                    <strong>{{ row.selectedRecordCount }} 条</strong>
                  </div>
                  <div>
                    <span>均奶</span>
                    <strong>{{ row.averageMilk.toFixed(1) }} kg</strong>
                  </div>
                  <div>
                    <span>体尺覆盖</span>
                    <strong>{{ row.bodyMeasureCount }}/24</strong>
                  </div>
                  <div>
                    <span>组学样本</span>
                    <strong>{{ row.omicsSampleCount }} 个</strong>
                  </div>
                </div>

                <div class="link-row">
                  <span>关联完整度</span>
                  <ElProgress :percentage="row.linkScore" :stroke-width="7" :show-text="false" />
                  <strong>{{ row.linkScore }}%</strong>
                </div>
              </button>
            </div>
          </div>
          <div v-if="filteredCowRows.length" class="load-more-row">
            <span
              >当前窗口 {{ cowCardStartIndex + 1 }}-{{ cowCardEndIndex }} /
              {{ cowCardTotalCount }} 头</span
            >
          </div>
        </FcPanel>
      </div>

      <aside class="right-stack">
        <FcPanel title="单牛表型明细" class="cow-detail-panel">
          <div v-if="selectedCowRow" class="detail-shell">
            <div class="surface-card detail-head art-card-sm">
              <div>
                <span>{{ selectedTrait?.category }}</span>
                <h3>{{ selectedCowRow.cow.cowNumber }} · {{ selectedTrait?.name }}</h3>
              </div>
              <ElTag :type="selectedCowRow.tagType">{{ selectedCowRecords.length }} 条记录</ElTag>
            </div>

            <div ref="trendChartRef" class="trend-chart art-card-sm"></div>

            <div class="analysis-grid">
              <div class="surface-card art-card-xs">
                <span>最新值</span>
                <strong>{{ latestValueText }}</strong>
              </div>
              <div class="surface-card art-card-xs">
                <span>均值</span>
                <strong>{{ averageValueText }}</strong>
              </div>
              <div class="surface-card art-card-xs">
                <span>系谱</span>
                <strong>{{ selectedCowRow.pedigreeScore }}%</strong>
              </div>
              <div class="surface-card art-card-xs">
                <span>组学</span>
                <strong>{{ selectedCowRow.omicsSampleCount }} 个</strong>
              </div>
            </div>

            <div class="record-list" @wheel.passive="onSelectedCowRecordWheel">
              <article
                v-for="record in visibleSelectedCowRecords"
                :key="record.id"
                class="surface-card record-card art-card-xs"
              >
                <div>
                  <span>{{ formatDate(record.collectionDate) }} · {{ record.source }}</span>
                  <h4>{{ record.traitName }}</h4>
                  <p
                    >{{ record.collector }}，关联：系谱
                    {{ record.pedigreeLinked ? '已关联' : '待补' }} / 组学
                    {{ record.omicsLinked ? '已关联' : '待采样' }}</p
                  >
                </div>
                <strong>{{ formatTraitValue(record) }}</strong>
              </article>
            </div>
            <div v-if="selectedCowRecords.length" class="load-more-row">
              <span>
                当前窗口 {{ selectedCowRecordStartIndex + 1 }}-{{ selectedCowRecordEndIndex }} /
                {{ selectedCowRecordTotalCount }} 条
              </span>
            </div>
          </div>
        </FcPanel>

        <FcPanel title="待处理提示" class="phenotype-queue-panel">
          <div class="queue-list">
            <article
              v-for="item in queueItems"
              :key="item.id"
              class="surface-card queue-item art-card-xs"
            >
              <div>
                <span>{{ item.kind }}</span>
                <h3>{{ item.title }}</h3>
                <p>{{ item.description }}</p>
              </div>
              <ElTag :type="item.tagType">{{ item.level }}</ElTag>
            </article>
          </div>
        </FcPanel>
      </aside>
    </section>

    <FcPanel title="采集记录">
      <div class="record-toolbar">
        <ElDatePicker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
        />
        <ElButton @click="dateRange = []">清空日期</ElButton>
      </div>
      <div
        class="record-table-scroll"
        @scroll.passive="onRecordScroll"
        @wheel.passive="onRecordWheel"
      >
        <ElTable :data="renderedRecords" height="460">
          <ElTableColumn prop="cowNumber" label="牛号" width="120" />
          <ElTableColumn prop="collectionDate" label="采集日期" width="130">
            <template #default="{ row }">{{ formatDate(row.collectionDate) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="traitName" label="性状小类" width="150" />
          <ElTableColumn prop="category" label="大类" width="120">
            <template #default="{ row }"
              ><ElTag size="small">{{ row.category }}</ElTag></template
            >
          </ElTableColumn>
          <ElTableColumn label="数值" width="130">
            <template #default="{ row }">{{ formatTraitValue(row) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="source" label="来源" width="120" />
          <ElTableColumn prop="collector" label="采集人/设备" width="170" />
          <ElTableColumn label="关联状态" min-width="220">
            <template #default="{ row }">
              系谱 {{ row.pedigreeLinked ? '已关联' : '待补' }} · 组学
              {{ row.omicsLinked ? '已关联' : '待采样' }}
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
      <div v-if="filteredRecords.length" class="load-more-row">
        <span>
          当前窗口 {{ recordStartIndex + 1 }}-{{ recordEndIndex }} / {{ recordTotalCount }} 条记录
        </span>
      </div>
    </FcPanel>
  </FcPageShell>

  <ElDialog
    v-model="cowDetailVisible"
    :title="cowDetail.title"
    width="940px"
    class="phenotype-detail-dialog"
  >
    <div class="phenotype-detail-shell">
      <div class="surface-card detail-head art-card-sm">
        <div>
          <span>{{ cowDetail.subtitle }}</span>
          <h3>{{ cowDetail.primary }}</h3>
        </div>
        <ElTag type="success">{{ cowDetail.records.length }} 条记录</ElTag>
      </div>

      <div class="detail-grid">
        <div
          v-for="row in cowDetail.rows"
          :key="row.label"
          class="surface-card detail-row art-card-xs"
        >
          <span>{{ row.label }}</span>
          <strong>{{ row.value }}</strong>
        </div>
      </div>

      <div class="record-list detail-record-list" @wheel.passive="onCowDetailRecordWheel">
        <article
          v-for="record in visibleCowDetailRecords"
          :key="record.id"
          class="surface-card record-card art-card-xs"
        >
          <div>
            <span>{{ formatDate(record.collectionDate) }} · {{ record.source }}</span>
            <h4>{{ record.traitName }}</h4>
            <p
              >{{ record.collector }}，关联：系谱 {{ record.pedigreeLinked ? '已关联' : '待补' }} /
              组学 {{ record.omicsLinked ? '已关联' : '待采样' }}</p
            >
          </div>
          <strong>{{ formatTraitValue(record) }}</strong>
        </article>
      </div>
      <div v-if="cowDetail.records.length" class="load-more-row">
        <span>
          当前窗口 {{ cowDetailRecordStartIndex + 1 }}-{{ cowDetailRecordEndIndex }} /
          {{ cowDetailRecordTotalCount }} 条
        </span>
      </div>

      <div class="detail-note">{{ cowDetail.note }}</div>
    </div>
  </ElDialog>

  <ElDialog v-model="manualDialogVisible" title="新增表型采集" width="640px">
    <ElForm label-width="110px" class="phenotype-form">
      <ElFormItem label="牛号">
        <ElSelect
          v-model="manualForm.cowId"
          filterable
          remote
          :remote-method="filterManualCowOptions"
          placeholder="输入牛号、耳号或圈舍筛选"
          class="w-full"
        >
          <ElOption
            v-for="row in manualCowOptions"
            :key="row.cow.id"
            :label="`${row.cow.cowNumber} · ${penName(row.cow)}`"
            :value="row.cow.id"
          />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="采集日期">
        <ElDatePicker
          v-model="manualForm.collectionDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择采集日期"
          class="w-full"
        />
      </ElFormItem>
      <ElFormItem label="性状小类">
        <ElSelect
          v-model="manualForm.traitCode"
          filterable
          placeholder="选择表型性状"
          class="w-full"
        >
          <ElOption
            v-for="trait in traitDefinitions"
            :key="trait.code"
            :label="`${trait.category} · ${trait.name} (${displayUnit(trait.unit)})`"
            :value="trait.code"
          />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="数值">
        <ElInputNumber v-model="manualForm.value" :precision="2" :step="1" class="w-full" />
      </ElFormItem>
      <ElFormItem label="来源">
        <ElSelect v-model="manualForm.source" class="w-full">
          <ElOption label="人工采集" value="人工采集" />
          <ElOption label="传感器导入" value="传感器导入" />
          <ElOption label="奶厅导入" value="奶厅导入" />
          <ElOption label="系统计算" value="系统计算" />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="采集人/设备">
        <ElInput v-model="manualForm.collector" placeholder="填写采集人或设备名称" />
      </ElFormItem>
    </ElForm>
    <template #footer>
      <ElButton @click="manualDialogVisible = false">取消</ElButton>
      <ElButton type="primary" :loading="savingManualPhenotype" @click="saveManualPhenotype"
        >保存</ElButton
      >
    </template>
  </ElDialog>
</template>

<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
  import type { ECharts } from 'echarts'
  import { ElMessage } from 'element-plus'
  import * as databaseService from '@/services/database'
  import {
    buildUnifiedDataContext,
    loadUnifiedMilkRecords,
    loadUnifiedPhenotypeRecords
  } from '@/services/unified-records'
  import { useLazyGridRenderWindow, useLazyRenderWindow } from '@/hooks'
  import {
    ensureAnimalForV2Fk,
    ensureTraitDefinitionForObservation,
    ensureTraitObservationBatch
  } from '@/services/v2-canonical-guards'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import CowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'
  import { formatDateOnly } from '@/utils/date-display'
  import {
    DEFAULT_PHENOTYPE_TRAITS,
    type PhenotypeTraitDefinition as StoredTraitDefinition
  } from '@/views/germplasm/phenotype/trait-definitions'
  import {
    average,
    formatDate,
    getMilkStatsMap,
    getPedigreeCompleteness,
    normalizeStatus,
    type PlatformSnapshot
  } from '@/views/breeding-platform/platform-data'

  type Category = '泌乳性能' | '生长体重' | '体尺性状' | '健康繁殖' | '行为传感'
  type Source = '人工采集' | '传感器导入' | '奶厅导入' | '系统计算'
  type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

  interface TraitDefinition {
    code: string
    name: string
    category: Category
    unit: string
    source: Source
    description: string
  }

  interface PhenotypeRecord {
    id: string
    cowId: string
    cowNumber: string
    collectionDate: string
    traitCode: string
    traitName: string
    category: Category
    value: number
    unit: string
    source: Source
    collector: string
    pedigreeLinked: boolean
    omicsLinked: boolean
    dataSource?: 'real' | 'deterministic_baseline' | 'mixed'
  }

  interface ManualPhenotypeForm {
    cowId: string
    collectionDate: string
    traitCode: string
    value: number
    source: Source
    collector: string
  }

  type DetailLine = { label: string; value: string }

  const bodyTraits: TraitDefinition[] = [
    ['body_height', '体高'],
    ['body_length', '体斜长'],
    ['heart_girth', '胸围'],
    ['cannon_circumference', '管围'],
    ['chest_depth', '胸深'],
    ['chest_width', '胸宽'],
    ['rump_length', '尻长'],
    ['rump_width', '尻宽'],
    ['hip_width', '髋宽'],
    ['pin_bone_width', '坐骨端宽'],
    ['hook_bone_width', '腰角宽'],
    ['sacral_height', '十字部高'],
    ['rump_height', '尻高'],
    ['head_length', '头长'],
    ['forehead_width', '额宽'],
    ['horn_spacing', '角间距'],
    ['ear_length', '耳长'],
    ['tail_head_height', '尾根高'],
    ['abdomen_girth', '腹围'],
    ['udder_depth', '乳房深'],
    ['front_teat_length', '前乳头长'],
    ['rear_teat_length', '后乳头长'],
    ['teat_spacing', '乳头间距'],
    ['hoof_circumference', '后肢蹄围']
  ].map(([code, name]) => ({
    code,
    name,
    category: '体尺性状',
    unit: 'cm',
    source: '人工采集',
    description: '24 项体尺性状用于牛只体型结构、传统育种评价和组学关联。'
  })) as TraitDefinition[]

  const defaultTraitDefinitions: TraitDefinition[] = [
    {
      code: 'milk_yield',
      name: '单次产奶量',
      category: '泌乳性能',
      unit: 'kg',
      source: '奶厅导入',
      description: '奶厅按班次采集的产奶量，是泌乳育种值的核心表型。'
    },
    {
      code: 'milk_fat',
      name: '乳脂率',
      category: '泌乳性能',
      unit: '%',
      source: '奶厅导入',
      description: '用于奶质、营养价值和乳成分组学关联分析。'
    },
    {
      code: 'milk_protein',
      name: '乳蛋白率',
      category: '泌乳性能',
      unit: '%',
      source: '奶厅导入',
      description: '用于乳品质评价和候选基因关联。'
    },
    {
      code: 'milk_lactose',
      name: '乳糖率',
      category: '泌乳性能',
      unit: '%',
      source: '奶厅导入',
      description: '用于奶质稳定性和代谢状态评价。'
    },
    {
      code: 'somatic_cell_count',
      name: '体细胞数',
      category: '泌乳性能',
      unit: '万/mL',
      source: '奶厅导入',
      description: '用于乳房健康、抗病性和样本剔除判断。'
    },
    {
      code: 'body_weight',
      name: '体重',
      category: '生长体重',
      unit: 'kg',
      source: '传感器导入',
      description: '用于生长性能、饲喂效率和选育分层。'
    },
    {
      code: 'body_temperature',
      name: '体温',
      category: '健康繁殖',
      unit: '°C',
      source: '传感器导入',
      description: '用于健康状态、热应激和异常样本识别。'
    },
    ...bodyTraits
  ]

  const TRAIT_TABLE = 'phenotype-trait-definitions'
  const RECORD_TABLE = 'phenotype-records'
  const snapshot = ref<PlatformSnapshot>({
    cows: [],
    sensors: [],
    milkRecords: [],
    breedingRecords: [],
    alerts: [],
    healthScores: []
  })
  const traitDefinitions = ref<TraitDefinition[]>(
    defaultTraitDefinitions.map((trait) => ({ ...trait }))
  )
  const storedPhenotypeRecords = ref<PhenotypeRecord[]>([])
  const keyword = ref('')
  const selectedCategory = ref<Category>('泌乳性能')
  const selectedTraitCode = ref('milk_daily_total')
  const selectedCowId = ref('')
  const dateRange = ref<Date[]>([])
  const cowDetailVisible = ref(false)
  const cowDetail = reactive({
    title: '牛卡详情',
    subtitle: '',
    primary: '',
    note: '',
    rows: [] as DetailLine[],
    records: [] as PhenotypeRecord[]
  })
  const manualDialogVisible = ref(false)
  const savingManualPhenotype = ref(false)
  const phenotypeRecordsLoading = ref(false)
  const manualCowKeyword = ref('')
  const manualForm = reactive<ManualPhenotypeForm>({
    cowId: '',
    collectionDate: '',
    traitCode: 'milk_daily_total',
    value: 0,
    source: '人工采集',
    collector: '育种员'
  })
  const trendChartRef = ref<HTMLDivElement>()
  let trendChart: ECharts | null = null
  let echartsLoader: Promise<typeof import('echarts')> | null = null

  function loadEcharts() {
    echartsLoader ||= import('echarts')
    return echartsLoader
  }

  const traitCategories = computed(() =>
    Array.from(new Set(traitDefinitions.value.map((trait) => trait.category)))
  )
  const visibleTraits = computed(() =>
    traitDefinitions.value.filter((trait) => trait.category === selectedCategory.value)
  )
  const selectedTrait = computed(
    () =>
      traitDefinitions.value.find((trait) => trait.code === selectedTraitCode.value) ||
      traitDefinitions.value[0]
  )
  const milkStatsMap = computed(() => getMilkStatsMap(snapshot.value.milkRecords))

  function mergeRowsById(rows: Record<string, any>[]) {
    const seen = new Set<string>()
    return rows.filter((row, index) => {
      const key = String(row.id ?? row.sampleId ?? row.sample_id ?? index).trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const phenotypeRecords = computed<PhenotypeRecord[]>(() => storedPhenotypeRecords.value)
  const recordsByCowId = computed(() => {
    const map = new Map<string, PhenotypeRecord[]>()
    phenotypeRecords.value.forEach((record) => {
      if (!record.cowId) return
      const rows = map.get(record.cowId) || []
      rows.push(record)
      map.set(record.cowId, rows)
    })
    return map
  })
  const recordsByCowAndTrait = computed(() => {
    const map = new Map<string, PhenotypeRecord[]>()
    phenotypeRecords.value.forEach((record) => {
      if (!record.cowId || !record.traitCode) return
      const key = `${record.cowId}|${record.traitCode}`
      const rows = map.get(key) || []
      rows.push(record)
      map.set(key, rows)
    })
    map.forEach((rows) =>
      rows.sort(
        (left, right) =>
          new Date(left.collectionDate).getTime() - new Date(right.collectionDate).getTime()
      )
    )
    return map
  })
  const traitRecordCountMap = computed(() => {
    const map = new Map<string, number>()
    phenotypeRecords.value.forEach((record) => {
      map.set(record.traitCode, (map.get(record.traitCode) || 0) + 1)
    })
    return map
  })
  const categoryRecordCountMap = computed(() => {
    const map = new Map<string, number>()
    phenotypeRecords.value.forEach((record) => {
      map.set(record.category, (map.get(record.category) || 0) + 1)
    })
    return map
  })
  const bodyMeasureCountByCowId = computed(() => {
    const map = new Map<string, Set<string>>()
    phenotypeRecords.value.forEach((record) => {
      if (record.category !== '体尺性状' || !record.cowId || !record.traitCode) return
      const set = map.get(record.cowId) || new Set<string>()
      set.add(record.traitCode)
      map.set(record.cowId, set)
    })
    return map
  })
  const omicsCountByCowId = computed(() => {
    const map = new Map<string, number>()
    const samples = snapshot.value.omicsSamples || []
    samples.forEach((sample) => {
      const cowId = String(sample.cowId ?? sample.cow_id ?? '')
      if (cowId) map.set(cowId, (map.get(cowId) || 0) + 1)
    })
    return map
  })

  const cowRows = computed(() =>
    snapshot.value.cows.map((cow) => {
      const records = recordsByCowId.value.get(cow.id) || []
      const selectedRecords =
        recordsByCowAndTrait.value.get(`${cow.id}|${selectedTraitCode.value}`) || []
      const bodyMeasureCount = bodyMeasureCountByCowId.value.get(cow.id)?.size || 0
      const pedigreeScore = getPedigreeCompleteness(cow)
      const omicsSampleCount = omicsCountByCowId.value.get(cow.id) || 0
      const linkScore = Math.round(
        Math.min(100, (records.length / 40) * 35) +
          pedigreeScore * 0.35 +
          Math.min(100, omicsSampleCount * 50) * 0.3
      )
      const status = normalizeStatus(cow.status)
      return {
        cow,
        records,
        selectedRecordCount: selectedRecords.length,
        averageMilk: milkStatsMap.value[cow.id]?.average || 0,
        bodyMeasureCount,
        pedigreeScore,
        omicsSampleCount,
        linkScore,
        status,
        tagType:
          status === '异常'
            ? ('danger' as TagType)
            : linkScore >= 75
              ? ('success' as TagType)
              : ('warning' as TagType)
      }
    })
  )

  const manualCowOptions = computed(() => {
    const keyword = manualCowKeyword.value.trim().toLowerCase()
    const selectedId = manualForm.cowId
    const rows = cowRows.value.filter((row) => {
      if (selectedId && row.cow.id === selectedId) return true
      if (!keyword) return true
      return [
        row.cow.cowNumber,
        row.cow.earTagNumber,
        row.cow.fatherNumber,
        row.cow.motherNumber,
        penName(row.cow)
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
    return rows.slice(0, 30)
  })

  function filterManualCowOptions(query: string) {
    manualCowKeyword.value = query
  }

  const filteredCowRows = computed(() => {
    const value = keyword.value.trim().toLowerCase()
    return cowRows.value.filter((row) => {
      const text = [
        row.cow.cowNumber,
        row.cow.earTagNumber,
        row.cow.fatherNumber,
        row.cow.motherNumber,
        penName(row.cow)
      ]
        .join(' ')
        .toLowerCase()
      const matchesKeyword = !value || text.includes(value)
      const shouldRequireRecords =
        !phenotypeRecordsLoading.value && phenotypeRecords.value.length > 0
      return matchesKeyword && (!shouldRequireRecords || row.selectedRecordCount > 0)
    })
  })
  const {
    containerRef: cowCardContainerRef,
    visibleItems: renderedCowRows,
    startIndex: cowCardStartIndex,
    endIndex: cowCardEndIndex,
    totalCount: cowCardTotalCount,
    resetVisibleCount: resetCowCardWindow,
    handleScroll: onCowCardScroll,
    handleWheel: onCowCardWheel
  } = useLazyGridRenderWindow(filteredCowRows, {
    rowCount: 2,
    minItemWidth: 280,
    gap: 14,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })

  const selectedCowRow = computed(
    () =>
      cowRows.value.find((row) => row.cow.id === selectedCowId.value) || filteredCowRows.value[0]
  )
  const selectedCowRecords = computed(() => {
    const cowId = selectedCowRow.value?.cow.id
    if (!cowId) return []
    return recordsByCowAndTrait.value.get(`${cowId}|${selectedTraitCode.value}`) || []
  })
  const {
    visibleItems: visibleSelectedCowRecords,
    resetVisibleCount: resetSelectedCowRecordWindow,
    startIndex: selectedCowRecordStartIndex,
    endIndex: selectedCowRecordEndIndex,
    totalCount: selectedCowRecordTotalCount,
    handleWheel: onSelectedCowRecordWheel
  } = useLazyRenderWindow(selectedCowRecords, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const cowDetailRecords = computed(() => cowDetail.records)
  const {
    visibleItems: visibleCowDetailRecords,
    resetVisibleCount: resetCowDetailRecordWindow,
    startIndex: cowDetailRecordStartIndex,
    endIndex: cowDetailRecordEndIndex,
    totalCount: cowDetailRecordTotalCount,
    handleWheel: onCowDetailRecordWheel
  } = useLazyRenderWindow(cowDetailRecords, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const filteredRecords = computed(() => {
    const cowId = selectedCowRow.value?.cow.id
    const baseRows = cowId
      ? recordsByCowAndTrait.value.get(`${cowId}|${selectedTraitCode.value}`) || []
      : phenotypeRecords.value.filter((record) => record.traitCode === selectedTraitCode.value)
    return baseRows.filter((record) => {
      if (record.traitCode !== selectedTraitCode.value) return false
      if (cowId && record.cowId !== cowId) return false
      if (dateRange.value.length === 2) {
        const time = new Date(record.collectionDate).getTime()
        const start = dateRange.value[0].getTime()
        const end = dateRange.value[1].getTime() + 86400000
        if (!Number.isFinite(time) || time < start || time > end) return false
      }
      return true
    })
  })
  const {
    visibleItems: renderedRecords,
    resetVisibleCount: resetRecordWindow,
    startIndex: recordStartIndex,
    endIndex: recordEndIndex,
    totalCount: recordTotalCount,
    handleScroll: onRecordScroll,
    handleWheel: onRecordWheel
  } = useLazyRenderWindow(filteredRecords, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const coveredCowCount = computed(
    () => new Set(phenotypeRecords.value.map((record) => record.cowId)).size
  )
  const linkedReadyCount = computed(
    () =>
      cowRows.value.filter(
        (row) => row.pedigreeScore >= 75 && row.omicsSampleCount > 0 && row.records.length >= 8
      ).length
  )
  const statusText = computed(() =>
    linkedReadyCount.value ? '可关联分析' : phenotypeRecords.value.length ? '采集中' : '待接入'
  )

  const traitLayers = computed(() =>
    traitCategories.value.map((category) => {
      const traits = traitDefinitions.value.filter((trait) => trait.category === category)
      return {
        category,
        traitCount: traits.length,
        recordCount: categoryRecordCountMap.value.get(category) || 0
      }
    })
  )

  const queueItems = computed(() => [
    ...cowRows.value
      .filter((row) => row.pedigreeScore < 75)
      .slice(0, 2)
      .map((row) => ({
        id: `pedigree-${row.cow.id}`,
        kind: '系谱待补',
        title: `牛号 ${row.cow.cowNumber}`,
        description: '父母或祖代字段不足。',
        level: '待补',
        tagType: 'warning' as TagType
      })),
    ...cowRows.value
      .filter((row) => row.omicsSampleCount === 0 && row.records.length >= 8)
      .slice(0, 2)
      .map((row) => ({
        id: `omics-${row.cow.id}`,
        kind: '组学待采样',
        title: `牛号 ${row.cow.cowNumber}`,
        description: '表型覆盖较完整，建议补充血液、乳样或毛囊样本用于组学关联。',
        level: '可采样',
        tagType: 'success' as TagType
      }))
  ])

  const latestValueText = computed(() => {
    const latest = selectedCowRecords.value[selectedCowRecords.value.length - 1]
    return latest ? formatTraitValue(latest) : '-'
  })
  const averageValueText = computed(() => {
    const values = selectedCowRecords.value.map((record) => record.value)
    return values.length
      ? `${average(values).toLocaleString('zh-CN')} ${displayUnit(selectedTrait.value.unit)}`
      : '-'
  })

  function mapStoredTrait(trait: StoredTraitDefinition | Record<string, any>): TraitDefinition {
    const row = trait as Record<string, any>
    const code = String(row.code || row.traitCode || row.trait_code || '')
    const category = String(row.category || row.trait_category || row.categoryName || '')
    const traitType = String(row.traitType || row.trait_type || '').toLowerCase()
    const normalizedCategory =
      category ||
      (code.startsWith('milk_') || traitType === 'lactation'
        ? '泌乳性能'
        : code.includes('temperature')
          ? '健康繁殖'
          : code.includes('step') || traitType === 'sensor'
            ? '行为传感'
            : code.includes('weight')
              ? '生长体重'
              : '体尺性状')
    return {
      code,
      name: String(row.name || row.traitName || row.trait_name || code),
      category: normalizedCategory as Category,
      unit: String(row.unit || ''),
      source: String(row.source || row.sourceType || row.source_type || '人工采集') as Source,
      description: String(row.description || '')
    }
  }

  function normalizePhenotypeRecord(row: Record<string, any>): PhenotypeRecord {
    const traitCode = String(row.traitCode || row.trait_code || '')
    const trait =
      traitDefinitions.value.find((item) => item.code === traitCode) || traitDefinitions.value[0]
    return {
      id: String(
        row.id ||
          `${row.cowId || row.cow_id}-${traitCode}-${row.collectionDate || row.collection_date}`
      ),
      cowId: String(row.cowId || row.cow_id || ''),
      cowNumber: String(row.cowNumber || row.cow_number || ''),
      collectionDate: String(
        row.collectionDate || row.collection_date || row.createdAt || new Date().toISOString()
      ),
      traitCode,
      traitName: String(row.traitName || row.trait_name || trait?.name || traitCode),
      category: String(row.category || trait?.category || '体尺性状') as Category,
      value: Number(Number(row.value || 0).toFixed(2)),
      unit: String(row.unit || trait?.unit || ''),
      source: String(row.source || trait?.source || '人工采集') as Source,
      collector: String(row.collector || '系统'),
      pedigreeLinked: Boolean(row.pedigreeLinked ?? row.pedigree_linked),
      omicsLinked: Boolean(row.omicsLinked ?? row.omics_linked),
      dataSource: String(
        row.dataSource || row.data_source || 'real'
      ) as PhenotypeRecord['dataSource']
    }
  }

  async function loadTraitDefinitions() {
    const [rows, v2Rows] = await Promise.all([
      databaseService.getTableDataAsync(TRAIT_TABLE, { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('trait_definition', { silent: true }).catch(() => [])
    ])
    const mapped = [...rows, ...v2Rows].map(mapStoredTrait).filter((trait) => trait.code)
    if (mapped.length) {
      const byCode = new Map<string, TraitDefinition>()
      ;[...defaultTraitDefinitions, ...mapped].forEach((trait) => {
        byCode.set(trait.code, { ...(byCode.get(trait.code) || trait), ...trait })
      })
      traitDefinitions.value = Array.from(byCode.values())
      return
    }
    await databaseService.addTableDataAsync(
      TRAIT_TABLE,
      DEFAULT_PHENOTYPE_TRAITS.map((trait) => ({
        ...trait,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))
    )
    traitDefinitions.value = (
      await databaseService.getTableDataAsync(TRAIT_TABLE, { silent: true })
    ).map(mapStoredTrait)
  }

  async function loadPhenotypeRecords() {
    const rows = await loadUnifiedPhenotypeRecords(traitDefinitions.value)
    storedPhenotypeRecords.value = rows.map(normalizePhenotypeRecord)
  }

  function pickDefaultTraitWithRecords() {
    if (traitRecordCount(selectedTraitCode.value) > 0) return
    const categoryBest = traitDefinitions.value
      .filter((trait) => trait.category === selectedCategory.value)
      .slice()
      .sort((left, right) => traitRecordCount(right.code) - traitRecordCount(left.code))
      .find((trait) => traitRecordCount(trait.code) > 0)
    if (categoryBest) {
      selectedTraitCode.value = categoryBest.code
      return
    }
    const globalBest = traitDefinitions.value
      .slice()
      .sort((left, right) => traitRecordCount(right.code) - traitRecordCount(left.code))
      .find((trait) => traitRecordCount(trait.code) > 0)
    if (!globalBest) return
    selectedCategory.value = globalBest.category
    selectedTraitCode.value = globalBest.code
  }

  function formatTraitValue(record: PhenotypeRecord) {
    return `${record.value.toLocaleString('zh-CN')} ${displayUnit(record.unit)}`
  }

  function displayUnit(unit: string) {
    return /^cells?\/mL$/i.test(unit) ? '个/mL' : unit
  }

  function formatDateTime(value: unknown) {
    return formatDateOnly(value)
  }

  function penName(cow: Record<string, unknown>) {
    const record = cow as unknown as Record<string, unknown>
    return String(record.currentPen || record.penName || record.pen || '未分栏')
  }

  function selectCategory(category: Category) {
    selectedCategory.value = category
    syncTraitWithCategory()
  }

  function syncTraitWithCategory() {
    const first = traitDefinitions.value
      .filter((trait) => trait.category === selectedCategory.value)
      .sort((left, right) => traitRecordCount(right.code) - traitRecordCount(left.code))[0]
    if (first) selectedTraitCode.value = first.code
  }

  function selectTrait(code: string) {
    selectedTraitCode.value = code
  }

  function handleCowKeywordSelect(item: { cowNumber: string; cowId?: string }) {
    keyword.value = item.cowNumber
    const row =
      cowRows.value.find((entry) => entry.cow.id === item.cowId) ||
      cowRows.value.find((entry) => String(entry.cow.cowNumber) === item.cowNumber)
    if (row) selectedCowId.value = row.cow.id
    resetCowCardWindow()
  }

  function selectCow(cowId: string) {
    selectedCowId.value = cowId
  }

  function openCowDetail(cowId: string) {
    const row = cowRows.value.find((item) => item.cow.id === cowId)
    if (!row) {
      selectCow(cowId)
      return
    }
    const records = recordsByCowAndTrait.value.get(`${cowId}|${selectedTraitCode.value}`) || []
    selectCow(cowId)
    cowDetail.title = `牛号 ${row.cow.cowNumber}`
    cowDetail.subtitle = `${selectedTrait.value.category} · ${selectedTrait.value.name}`
    cowDetail.primary = `${row.selectedRecordCount} 条记录`
    cowDetail.note = '右侧趋势已同步。'
    cowDetail.rows = [
      { label: '当前性状', value: selectedTrait.value.name },
      { label: '入库依据', value: '现场测定、奶厅记录和传感器采集' },
      { label: '统计口径', value: `${selectedTrait.value.category} · ${selectedTrait.value.name}` },
      {
        label: '采集日期范围',
        value: records.length
          ? `${formatDate(records[0].collectionDate)} - ${formatDate(records[records.length - 1].collectionDate)}`
          : '-'
      },
      { label: '系谱完整度', value: `${row.pedigreeScore}%` },
      { label: '组学样本', value: `${row.omicsSampleCount} 个` },
      { label: '关联完整度', value: `${row.linkScore}%` },
      {
        label: '更新时间',
        value: records.length ? formatDateTime(records[records.length - 1].collectionDate) : '-'
      }
    ]
    cowDetail.records = records.slice().reverse()
    resetCowDetailRecordWindow()
    cowDetailVisible.value = true
  }

  function traitRecordCount(code: string) {
    return traitRecordCountMap.value.get(code) || 0
  }

  function resetRenderWindows() {
    resetCowCardWindow()
    resetRecordWindow()
    resetSelectedCowRecordWindow()
    resetCowDetailRecordWindow()
  }

  function addManualPhenotype() {
    manualCowKeyword.value = ''
    manualForm.cowId =
      selectedCowRow.value?.cow.id ||
      filteredCowRows.value[0]?.cow.id ||
      cowRows.value[0]?.cow.id ||
      ''
    manualForm.collectionDate = new Date().toISOString().slice(0, 10)
    manualForm.traitCode =
      selectedTraitCode.value || traitDefinitions.value[0]?.code || 'milk_daily_total'
    manualForm.value = 0
    manualForm.source = selectedTrait.value?.source || '人工采集'
    manualForm.collector = manualForm.source === '奶厅导入' ? '奶厅录入员' : '育种员'
    manualDialogVisible.value = true
  }

  async function saveManualPhenotype() {
    const cow = snapshot.value.cows.find((item) => item.id === manualForm.cowId)
    const trait = traitDefinitions.value.find((item) => item.code === manualForm.traitCode)
    const value = Number(manualForm.value)
    if (!cow || !trait || !manualForm.collectionDate || !Number.isFinite(value)) {
      ElMessage.warning('请补齐牛号、采集日期、性状小类和数值')
      return
    }

    savingManualPhenotype.value = true
    const now = new Date().toISOString()
    try {
      const animal = await ensureAnimalForV2Fk(
        {
          cowId: cow.id,
          cowNumber: cow.cowNumber,
          cowName: cow.cowNumber,
          cow,
          resolved: true,
          sourceKey: cow.id || cow.cowNumber,
          originalCowId: cow.id,
          originalCowNumber: cow.cowNumber
        },
        cow
      )
      const canonicalTrait = await ensureTraitDefinitionForObservation(trait.code, {
        traitName: trait.name,
        unit: trait.unit,
        traitType: trait.category === '泌乳性能' ? 'lactation' : 'phenotype',
        dataType: 'number'
      })
      const batchId = `manual-${manualForm.collectionDate}`
      await ensureTraitObservationBatch(batchId, {
        batchName: `手工表型采集 ${manualForm.collectionDate}`,
        sourceType: 'manual',
        operatorName: manualForm.collector.trim() || '育种员',
        collectedAt: manualForm.collectionDate
      })
      const record = {
        id: `phenotype-${manualForm.cowId}-${manualForm.traitCode}-${Date.now()}`,
        cowId: animal.id,
        cow_id: animal.id,
        animalId: animal.id,
        animal_id: animal.id,
        cowNumber: animal.number || cow.cowNumber,
        cow_number: animal.number || cow.cowNumber,
        animalNumber: animal.number || cow.cowNumber,
        animal_number: animal.number || cow.cowNumber,
        collectionDate: manualForm.collectionDate,
        collection_date: manualForm.collectionDate,
        observedAt: manualForm.collectionDate,
        observed_at: manualForm.collectionDate,
        traitCode: trait.code,
        trait_code: trait.code,
        traitId: canonicalTrait.id,
        trait_id: canonicalTrait.id,
        traitName: trait.name,
        trait_name: trait.name,
        category: trait.category,
        value,
        numericValue: value,
        numeric_value: value,
        unit: trait.unit,
        source: manualForm.source,
        sourceType: 'manual',
        source_type: 'manual',
        collector: manualForm.collector.trim() || '育种员',
        pedigreeLinked: getPedigreeCompleteness(cow) >= 75,
        pedigree_linked: getPedigreeCompleteness(cow) >= 75,
        omicsLinked: Boolean(
          (snapshot.value.omicsSamples || []).some(
            (sample) => String(sample.cowId ?? sample.cow_id ?? '') === cow.id
          )
        ),
        omics_linked: Boolean(
          (snapshot.value.omicsSamples || []).some(
            (sample) => String(sample.cowId ?? sample.cow_id ?? '') === cow.id
          )
        ),
        dataSource: 'real',
        data_source: 'real',
        createdAt: now,
        created_at: now,
        updatedAt: now,
        updated_at: now
      }
      await databaseService.addTableDataAsync('trait_observation', {
        ...record,
        batchId,
        batch_id: batchId,
        qualityFlag: '正常',
        quality_flag: '正常'
      })
      await databaseService.addTableDataAsync(RECORD_TABLE, {
        ...record,
        updatedAt: now
      })
      manualDialogVisible.value = false
      selectedCategory.value = trait.category
      selectedTraitCode.value = trait.code
      selectedCowId.value = cow.id
      await loadPhenotypeRecords()
      openCowDetail(cow.id)
      await nextTick()
      renderChart()
      ElMessage.success(`已保存 ${cow.cowNumber} 的 ${trait.name} 表型记录`)
    } catch (error: any) {
      ElMessage.error(error?.message || '保存表型采集记录失败')
    } finally {
      savingManualPhenotype.value = false
    }
  }

  async function renderChart() {
    const element = trendChartRef.value
    if (!element) return
    const records = selectedCowRecords.value
    const echarts = await loadEcharts()
    trendChart = echarts.getInstanceByDom(element) || echarts.init(element)
    trendChart.setOption({
      grid: { top: 26, right: 18, bottom: 34, left: 44 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: records.map((record) => formatDate(record.collectionDate)),
        axisLabel: { color: '#64748b' }
      },
      yAxis: {
        type: 'value',
        name: displayUnit(selectedTrait.value.unit),
        axisLabel: { color: '#64748b' },
        splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.24)' } }
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbolSize: 8,
          data: records.map((record) => record.value),
          lineStyle: { width: 3, color: '#16a34a' },
          itemStyle: { color: '#16a34a' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(22, 163, 74, 0.22)' },
              { offset: 1, color: 'rgba(22, 163, 74, 0.02)' }
            ])
          }
        }
      ]
    })
  }

  async function loadData() {
    await loadTraitDefinitions()
    const context = await buildUnifiedDataContext()
    const [phenotypeRows, omicsSamples, legacyOmicsSamples] = await Promise.all([
      loadUnifiedPhenotypeRecords(traitDefinitions.value, context, {
        limit: 5000,
        pageSize: 5000,
        timeout: 20000
      }),
      databaseService.getTableDataAsync('omics_samples', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('omics-samples', { silent: true }).catch(() => [])
    ])
    storedPhenotypeRecords.value = phenotypeRows.map(normalizePhenotypeRecord)
    pickDefaultTraitWithRecords()
    snapshot.value = {
      ...snapshot.value,
      cows: context.cows as PlatformSnapshot['cows'],
      omicsSamples: mergeRowsById([
        ...(omicsSamples as Record<string, any>[]),
        ...(legacyOmicsSamples as Record<string, any>[])
      ]) as PlatformSnapshot['omicsSamples']
    }
    await nextTick()
    if (!selectedCowId.value && filteredCowRows.value[0])
      selectedCowId.value = filteredCowRows.value[0].cow.id
    renderChart()
    loadUnifiedMilkRecords(context)
      .then((milkRecords) => {
        snapshot.value = {
          ...snapshot.value,
          milkRecords: milkRecords as PlatformSnapshot['milkRecords']
        }
      })
      .catch((error) => {
        console.error('加载表型页泌乳摘要失败', error)
      })
  }

  function schedulePhenotypeRecordLoad() {
    phenotypeRecordsLoading.value = true
    const run = () => {
      loadPhenotypeRecords()
        .then(async () => {
          pickDefaultTraitWithRecords()
          await nextTick()
          if (!selectedCowId.value && filteredCowRows.value[0]) {
            selectedCowId.value = filteredCowRows.value[0].cow.id
          }
          renderChart()
        })
        .catch((error) => {
          console.error('加载表型记录失败', error)
          ElMessage.warning('表型主界面已打开，表型记录稍后可刷新重试')
        })
        .finally(() => {
          phenotypeRecordsLoading.value = false
        })
    }
    const idle =
      window.requestIdleCallback || ((callback: () => void) => window.setTimeout(callback, 0))
    idle(run)
  }

  watch([selectedTraitCode, selectedCowId, selectedCategory], () => nextTick(renderChart))
  watch([selectedTraitCode, selectedCategory, keyword, dateRange], resetRenderWindows)
  onMounted(loadData)
  onBeforeUnmount(() => trendChart?.dispose())
</script>

<style scoped lang="scss">
  .floating-grid,
  .main-layout,
  .left-stack,
  .right-stack,
  .layer-grid,
  .trait-picker,
  .cow-card-grid,
  .cow-trait-grid,
  .analysis-grid,
  .record-list,
  .queue-list {
    display: grid;
    gap: 14px;
  }

  .metric-grid {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }

  .main-layout {
    grid-template-columns: minmax(0, 1fr) minmax(360px, 390px);
    align-items: stretch;
    --phenotype-main-height: 782px;
  }

  .left-stack,
  .right-stack {
    min-width: 0;
    min-height: var(--phenotype-main-height);
    height: var(--phenotype-main-height);
  }

  .left-stack {
    grid-template-rows: minmax(260px, 300px) minmax(0, 1fr);
  }

  .right-stack {
    grid-template-rows: minmax(0, 1fr) minmax(310px, 336px);
  }

  .left-stack > :deep(.fc-panel),
  .right-stack > :deep(.fc-panel) {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .trait-panel,
  .cow-phenotype-panel,
  .cow-detail-panel,
  .phenotype-queue-panel {
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }

  .trait-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .cow-phenotype-panel,
  .cow-detail-panel,
  .phenotype-queue-panel {
    display: flex;
    flex-direction: column;
  }

  .cow-detail-panel .detail-shell,
  .phenotype-queue-panel .queue-list {
    flex: 1 1 auto;
    min-height: 0;
  }

  .surface-card {
    min-width: 0;
    box-sizing: border-box;
  }

  .layer-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .trait-layer-scroll {
    min-height: 0;
    max-height: 124px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .layer-card,
  .cow-card,
  .trait-chip {
    width: 100%;
    text-align: left;
    cursor: pointer;
  }

  .layer-card {
    min-height: 86px;
    padding: 12px;
    border-left: 4px solid #22c55e;
  }

  .layer-card.active,
  .cow-card.active,
  .trait-chip.active {
    border-color: rgba(22, 163, 74, 0.62);
    background: rgba(22, 163, 74, 0.06);
  }

  .layer-card span,
  .cow-card span,
  .detail-head span,
  .analysis-grid span,
  .record-card span,
  .queue-item span,
  .trait-chip small,
  .cow-trait-grid span,
  .link-row span {
    display: block;
    color: #64748b;
    font-size: 12px;
    font-weight: 680;
  }

  .layer-card strong {
    display: block;
    margin-top: 8px;
    color: #111827;
    font-size: 20px;
    line-height: 1;
  }

  .layer-card small {
    display: inline-flex;
    float: none;
    margin-top: 8px;
    color: #16a34a;
    font-weight: 760;
  }

  .cow-card p,
  .detail-head p,
  .record-card p,
  .queue-item p {
    margin: 8px 0 0;
    color: #475569;
    font-size: 13px;
    line-height: 1.55;
  }

  .trait-picker {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    flex: 1 1 auto;
    min-height: 0;
    height: auto;
    overflow: auto;
    padding-right: 4px;
  }

  .trait-chip {
    min-height: 64px;
    padding: 10px 12px;
  }

  .trait-chip span {
    display: block;
    min-width: 0;
    overflow: hidden;
    color: #1f2937;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trait-chip small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 180px;
    gap: 10px;
    margin-bottom: 14px;
  }

  .phenotype-loading-card {
    display: grid;
    gap: 4px;
    margin-bottom: 12px;
    padding: 10px 12px;
    background: rgba(236, 253, 245, 0.82);
    border-color: rgba(34, 197, 94, 0.22);
  }

  .phenotype-loading-card span {
    color: #64748b;
    font-size: 12px;
    font-weight: 720;
  }

  .phenotype-loading-card strong {
    color: #14532d;
    font-size: 13px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .cow-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cow-card-scroll {
    max-height: calc((184px * 2) + 18px);
    overflow-y: auto;
    padding-right: 6px;
    overscroll-behavior: contain;
  }

  .record-table-scroll {
    max-width: 100%;
    max-height: 460px;
    overflow: auto;
  }

  .cow-card {
    min-width: 0;
    min-height: 184px;
    padding: 12px;
    border-left: 4px solid #16a34a;
    overflow: hidden;
    transition:
      transform 0.18s ease,
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      background-color 0.18s ease;
  }

  .cow-card:hover {
    border-color: rgb(var(--fluent-primary-rgb) / 34%);
    transform: var(--fluent-card-hover-transform);
  }

  .cow-card-head,
  .link-row,
  .record-toolbar,
  .record-card {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .cow-card h3,
  .detail-head h3,
  .queue-item h3 {
    margin: 4px 0 0;
    color: #111827;
    font-size: 18px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .cow-card h3,
  .detail-head h3 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cow-card-head > div,
  .detail-head > div,
  .record-card > div,
  .queue-item > div {
    min-width: 0;
  }

  .cow-card-head p,
  .record-card p,
  .queue-item p {
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .cow-trait-grid,
  .analysis-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 14px;
  }

  .cow-trait-grid div,
  .analysis-grid .surface-card {
    padding: 11px;
  }

  .cow-trait-grid strong,
  .analysis-grid strong,
  .record-card strong {
    display: block;
    margin-top: 4px;
    color: #111827;
    font-size: 15px;
  }

  .link-row {
    align-items: center;
    margin-top: 12px;
  }

  .link-row .el-progress {
    flex: 1;
  }

  .detail-shell {
    display: grid;
    gap: 14px;
    min-height: 0;
    height: 100%;
    align-content: start;
  }

  .detail-head,
  .record-card,
  .queue-item {
    padding: 14px;
  }

  .trend-chart {
    height: 240px;
  }

  .record-list {
    max-height: 248px;
    overflow: auto;
    padding-right: 4px;
  }

  .queue-item {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    align-items: start;
    gap: 12px;
    position: relative;
    overflow: hidden;
    border-left: 4px solid #22c55e;
    min-height: 150px;
  }

  .queue-item::after {
    position: absolute;
    inset: 0 auto 0 0;
    width: 4px;
    content: '';
    background: #22c55e;
  }

  .queue-item::before {
    display: inline-grid;
    place-items: center;
    width: 40px;
    height: 40px;
    color: #047857;
    font-size: 12px;
    font-weight: 820;
    content: '待补';
    background: rgba(220, 252, 231, 0.86);
    border: 1px solid rgba(22, 163, 74, 0.22);
    border-radius: 8px;
  }

  .queue-item > div {
    min-width: 0;
  }

  .queue-item h3 {
    display: -webkit-box;
    max-height: 45px;
    overflow: hidden;
    text-overflow: ellipsis;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .queue-item p {
    display: -webkit-box;
    max-height: 42px;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .queue-item :deep(.el-tag) {
    max-width: 88px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .record-card h4 {
    margin: 4px 0 0;
    color: #111827;
    font-size: 15px;
  }

  .phenotype-detail-shell {
    display: grid;
    gap: 14px;
  }

  .detail-head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    padding: 14px;
  }

  .detail-head span,
  .detail-head p,
  .detail-row span,
  .record-card span,
  .queue-item span {
    display: block;
    color: #64748b;
    font-size: 12px;
    font-weight: 680;
  }

  .detail-head h3 {
    margin: 4px 0 0;
    color: #111827;
    font-size: 24px;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .detail-row {
    min-width: 0;
    padding: 12px;
  }

  .detail-row strong {
    display: block;
    margin-top: 4px;
    color: #111827;
    font-size: 13px;
    font-weight: 760;
  }

  .detail-record-list {
    max-height: 260px;
  }

  .detail-note {
    padding: 12px 14px;
    color: #475569;
    font-size: 13px;
    line-height: 1.6;
    background: rgba(22, 163, 74, 0.05);
    border: 1px solid rgba(22, 163, 74, 0.12);
    border-radius: 8px;
  }

  .record-toolbar {
    justify-content: flex-start;
    margin-bottom: 14px;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 14px;
  }

  @media (max-width: 1280px) {
    .metric-grid,
    .main-layout,
    .layer-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .main-layout {
      grid-template-columns: 1fr;
    }

    .left-stack,
    .right-stack {
      min-height: 0;
      height: auto;
      grid-template-rows: auto;
    }

    .cow-card-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .metric-grid,
    .layer-grid,
    .card-toolbar,
    .cow-trait-grid,
    .analysis-grid {
      grid-template-columns: 1fr;
    }

    .cow-card-head,
    .link-row,
    .record-card,
    .queue-item {
      display: grid;
    }

    .cow-card-grid {
      grid-template-columns: 1fr;
    }

    .queue-item {
      grid-template-columns: 1fr;
    }
  }
</style>
