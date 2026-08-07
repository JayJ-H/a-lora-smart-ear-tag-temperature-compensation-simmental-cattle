<template>
  <div class="fluent-page art-page-view">
    <div class="fluent-page-header">
      <div>
        <h1>精准饲喂管理</h1>
      </div>

      <div class="fluent-page-actions">
        <div class="fluent-inline-stat">今日投喂 {{ todayTotalFeed.toFixed(1) }} kg</div>
        <ElButton :loading="loading" @click="loadData">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />
          刷新
        </ElButton>
        <ElButton type="primary" @click="activeTab = 'formulas'">
          <ArtSvgIcon icon="ri:add-line" class="mr-1" />
          配方管理
        </ElButton>
      </div>
    </div>

    <div class="fluent-metric-grid">
      <div class="fluent-metric-card">
        <div class="metric-label">配方总数</div>
        <div class="metric-value">{{ feedStats.formulaCount }}</div>
        <div class="metric-note">启用 {{ feedStats.activeFormulas }} 个</div>
      </div>
      <div class="fluent-metric-card is-info">
        <div class="metric-label">今日记录</div>
        <div class="metric-value">{{ feedStats.todayRecords }}</div>
        <div class="metric-note">覆盖圈舍 {{ feedStats.coveredPens }} 个</div>
      </div>
      <div class="fluent-metric-card is-warning">
        <div class="metric-label">库存预警</div>
        <div class="metric-value">{{ feedStats.lowStockAlerts }}</div>
        <div class="metric-note">需要补料复核</div>
      </div>
      <div class="fluent-metric-card is-teal">
        <div class="metric-label">今日成本</div>
        <div class="metric-value">¥{{ feedStats.totalCost.toLocaleString() }}</div>
        <div class="metric-note">按实际投喂量估算</div>
      </div>
    </div>

    <div class="production-proof-strip">
      <div class="proof-item">
        <span>今日投喂</span>
        <strong>{{ todayFeedSummary }}</strong>
      </div>
      <div class="proof-item">
        <span>最近投喂</span>
        <strong>{{ latestFeedSummary }}</strong>
      </div>
      <div class="proof-item">
        <span>库存安全</span>
        <strong>{{ inventoryProofSummary }}</strong>
      </div>
      <div class="proof-item">
        <span>成本核算</span>
        <strong>{{ costProofSummary }}</strong>
      </div>
    </div>

    <ElTabs v-model="activeTab" class="mt-6">
      <ElTabPane label="饲料配方" name="formulas">
        <div class="fluent-panel mb-5">
          <ElForm :inline="true" :model="formulaFilter" class="flex flex-wrap gap-3">
            <ElFormItem label="目标群体">
              <ElSelect
                v-model="formulaFilter.targetGroup"
                clearable
                placeholder="全部群体"
                style="width: 160px"
              >
                <ElOption label="干奶牛" value="dry" />
                <ElOption label="新产牛" value="fresh" />
                <ElOption label="泌乳牛" value="lactating" />
                <ElOption label="后备牛" value="heifer" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="状态">
              <ElSelect
                v-model="formulaFilter.isActive"
                clearable
                placeholder="全部状态"
                style="width: 140px"
              >
                <ElOption label="启用" :value="true" />
                <ElOption label="停用" :value="false" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem>
              <ElButton type="primary" @click="loadData">查询</ElButton>
              <ElButton @click="resetFormulaFilter">重置</ElButton>
            </ElFormItem>
          </ElForm>
        </div>

        <div
          ref="formulaGridRef"
          class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"
          @wheel.passive="onFormulaGridWheel"
        >
          <div v-for="formula in visibleFormulas" :key="formula.id" class="fluent-object-card">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3>{{ formula.name || '未命名配方' }}</h3>
                <p>{{ formula.description || '暂无配方说明' }}</p>
              </div>
              <ElTag :type="formula.isActive ? 'success' : 'info'" size="small">
                {{ formula.isActive ? '启用' : '停用' }}
              </ElTag>
            </div>
            <div class="object-meta">
              <span>群体：{{ getTargetGroupLabel(formula.targetGroup) }}</span>
              <span>成本：¥{{ Number(formula.totalCost || 0).toFixed(2) }}/kg</span>
              <span>预期提升：{{ Number(formula.expectedProduction || 0) }}%</span>
            </div>
          </div>
        </div>
        <div v-if="filteredFormulas.length > visibleFormulas.length" class="load-more-row">
          <ElButton @click="() => loadMoreFormulas()"
            >加载更多 {{ visibleFormulas.length }}/{{ filteredFormulas.length }}</ElButton
          >
        </div>
        <ElEmpty v-if="!filteredFormulas.length" description="暂无配方数据" />
      </ElTabPane>

      <ElTabPane label="投喂记录" name="records">
        <div class="fluent-panel mb-5">
          <ElForm :inline="true" :model="recordFilter" class="flex flex-wrap gap-3">
            <ElFormItem label="圈舍">
              <ElSelect
                v-model="recordFilter.penId"
                clearable
                placeholder="全部圈舍"
                style="width: 160px"
              >
                <ElOption v-for="pen in allPens" :key="pen.id" :label="pen.name" :value="pen.id" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="日期">
              <ElDatePicker
                v-model="recordFilter.date"
                type="date"
                placeholder="选择日期"
                style="width: 160px"
              />
            </ElFormItem>
            <ElFormItem>
              <ElButton type="primary" @click="loadData">查询</ElButton>
              <ElButton @click="resetRecordFilter">重置</ElButton>
            </ElFormItem>
          </ElForm>
        </div>

        <div class="fluent-panel">
          <ElTable
            :data="visibleRecords"
            v-loading="loading"
            height="520"
            @wheel.passive="onRecordTableWheel"
          >
            <ElTableColumn label="圈舍" width="120">
              <template #default="{ row }">{{ getPenName(row.penId) }}</template>
            </ElTableColumn>
            <ElTableColumn label="配方" min-width="160">
              <template #default="{ row }">{{ getFormulaName(row.formulaId) }}</template>
            </ElTableColumn>
            <ElTableColumn label="投喂时间" min-width="170">
              <template #default="{ row }">{{ formatDate(getFeedTime(row)) }}</template>
            </ElTableColumn>
            <ElTableColumn prop="plannedAmount" label="计划量(kg)" width="120" />
            <ElTableColumn prop="actualAmount" label="实际量(kg)" width="120" />
            <ElTableColumn label="饲喂员" width="120">
              <template #default="{ row }">{{ getPersonName(row.feederId) }}</template>
            </ElTableColumn>
            <ElTableColumn label="质量" width="160">
              <template #default="{ row }">
                水分 {{ row.feedQuality?.moisture ?? '-' }}% · 污染
                {{ row.feedQuality?.contamination ?? '-' }}/10
              </template>
            </ElTableColumn>
          </ElTable>
        </div>
      </ElTabPane>

      <ElTabPane label="库存监控" name="inventory">
        <div class="grid grid-cols-1 xl:grid-cols-[1.1fr_1.5fr] gap-5">
          <div class="fluent-panel">
            <h2>库存状态</h2>
            <div id="inventory-chart" class="chart-box"></div>
          </div>
          <div class="fluent-panel">
            <h2>饲料库存</h2>
            <ElTable :data="visibleInventory" height="420" @wheel.passive="onInventoryTableWheel">
              <ElTableColumn prop="feedName" label="饲料名称" min-width="140" />
              <ElTableColumn prop="currentStock" label="当前库存(kg)" width="140" />
              <ElTableColumn prop="minimumStock" label="最低库存(kg)" width="140" />
              <ElTableColumn prop="unitCost" label="单价(¥/kg)" width="120" />
              <ElTableColumn label="状态" width="110">
                <template #default="{ row }">
                  <ElTag
                    :type="row.currentStock <= row.minimumStock ? 'danger' : 'success'"
                    size="small"
                  >
                    {{ row.currentStock <= row.minimumStock ? '需补货' : '正常' }}
                  </ElTag>
                </template>
              </ElTableColumn>
            </ElTable>
          </div>
        </div>
      </ElTabPane>

      <ElTabPane label="成本分析" name="cost">
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div class="fluent-panel">
            <h2>成本趋势</h2>
            <div id="cost-trend-chart" class="chart-box"></div>
          </div>
          <div class="fluent-panel">
            <h2>配方成本对比</h2>
            <div id="formula-cost-chart" class="chart-box"></div>
          </div>
          <div class="fluent-panel xl:col-span-2">
            <h2>投喂执行结构</h2>
            <div id="feed-efficiency-chart" class="chart-box"></div>
          </div>
        </div>
      </ElTabPane>
    </ElTabs>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
  import * as echarts from 'echarts'
  import * as databaseService from '@/services/database'
  import { loadUnifiedMilkRecords } from '@/services/unified-records'
  import { useLazyGridRenderWindow, useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'

  type AnyRow = Record<string, any>

  const loading = ref(false)
  const activeTab = ref('formulas')

  const feedFormulas = ref<AnyRow[]>([])
  const feedRecords = ref<AnyRow[]>([])
  const milkRecords = ref<AnyRow[]>([])
  const feedInventory = ref<AnyRow[]>([])
  const allPens = ref<AnyRow[]>([])
  const allPersons = ref<AnyRow[]>([])
  const todayTotalFeed = ref(0)
  const todayMilkVolume = ref(0)

  const chartInstances = ref<Map<string, echarts.ECharts>>(new Map())

  const feedStats = reactive({
    formulaCount: 0,
    activeFormulas: 0,
    todayRecords: 0,
    coveredPens: 0,
    lowStockAlerts: 0,
    totalCost: 0
  })

  const formulaFilter = reactive<{ targetGroup: string; isActive: boolean | '' }>({
    targetGroup: '',
    isActive: ''
  })

  const recordFilter = reactive<{ penId: string; date: Date | null }>({
    penId: '',
    date: null
  })

  const filteredFormulas = computed(() =>
    feedFormulas.value.filter((formula) => {
      if (formulaFilter.targetGroup && formula.targetGroup !== formulaFilter.targetGroup)
        return false
      if (formulaFilter.isActive !== '' && Boolean(formula.isActive) !== formulaFilter.isActive)
        return false
      return true
    })
  )

  const filteredRecords = computed(() =>
    feedRecords.value.filter((record) => {
      if (recordFilter.penId && record.penId !== recordFilter.penId) return false
      if (recordFilter.date && !sameDay(getFeedTime(record), recordFilter.date)) return false
      return true
    })
  )

  const {
    containerRef: formulaGridRef,
    visibleItems: visibleFormulas,
    loadMore: loadMoreFormulas,
    handleWheel: onFormulaGridWheel
  } = useLazyGridRenderWindow(filteredFormulas, {
    rowCount: 2,
    minItemWidth: 280,
    gap: 20,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })

  const { visibleItems: visibleRecords, handleWheel: onRecordTableWheel } = useLazyRenderWindow(
    filteredRecords,
    {
      initialCount: 10,
      batchSize: 10,
      mode: 'fixed-window'
    }
  )

  const { visibleItems: visibleInventory, handleWheel: onInventoryTableWheel } =
    useLazyRenderWindow(feedInventory, {
      initialCount: 10,
      batchSize: 10,
      mode: 'fixed-window'
    })

  const safeTable = async (tableName: string): Promise<AnyRow[]> => {
    try {
      const rows = await databaseService.getTableDataAsync(tableName, { silent: true })
      return Array.isArray(rows) ? rows : []
    } catch {
      return []
    }
  }

  const loadData = async () => {
    loading.value = true
    try {
      const [formulas, records, milkRows, inventory, pens, persons] = await Promise.all([
        safeTable('feed-formulas'),
        safeTable('feed-records'),
        loadUnifiedMilkRecords().catch(() => []),
        safeTable('feed-inventory'),
        safeTable('pens'),
        safeTable('persons')
      ])

      feedFormulas.value = formulas
      feedRecords.value = records
      milkRecords.value = milkRows
      feedInventory.value = inventory
      allPens.value = pens
      allPersons.value = persons

      calculateStats()
      await nextTick()
      renderCharts()
    } finally {
      loading.value = false
    }
  }

  const calculateStats = () => {
    const todayRecords = feedRecords.value.filter((record) =>
      sameDay(getFeedTime(record), new Date())
    )
    const todayMilkRows = milkRecords.value.filter((record) =>
      sameDay(getMilkTime(record), new Date())
    )
    const formulaCostMap = new Map(
      feedFormulas.value.map((formula) => [String(formula.id), Number(formula.totalCost || 0)])
    )

    feedStats.formulaCount = feedFormulas.value.length
    feedStats.activeFormulas = feedFormulas.value.filter((formula) =>
      Boolean(formula.isActive)
    ).length
    feedStats.todayRecords = todayRecords.length
    feedStats.coveredPens = new Set(todayRecords.map((record) => record.penId).filter(Boolean)).size
    feedStats.lowStockAlerts = feedInventory.value.filter(
      (item) => Number(item.currentStock || 0) <= Number(item.minimumStock || 0)
    ).length
    feedStats.totalCost = Math.round(
      todayRecords.reduce(
        (sum, record) =>
          sum +
          Number(record.actualAmount || 0) * (formulaCostMap.get(String(record.formulaId)) || 0),
        0
      )
    )
    todayTotalFeed.value = todayRecords.reduce(
      (sum, record) => sum + Number(record.actualAmount || 0),
      0
    )
    todayMilkVolume.value = todayMilkRows.reduce(
      (sum, record) => sum + Number(record.volume || record.milkVolume || 0),
      0
    )
  }

  const resetFormulaFilter = () => {
    formulaFilter.targetGroup = ''
    formulaFilter.isActive = ''
  }

  const resetRecordFilter = () => {
    recordFilter.penId = ''
    recordFilter.date = null
  }

  const getTargetGroupLabel = (group: string) => {
    const labels: Record<string, string> = {
      dry: '干奶牛',
      fresh: '新产牛',
      lactating: '泌乳牛',
      heifer: '后备牛'
    }
    return labels[group] || group || '未分组'
  }

  const getPenName = (penId: string) =>
    allPens.value.find((pen) => pen.id === penId)?.name || penId || '-'
  const getFormulaName = (formulaId: string) =>
    feedFormulas.value.find((formula) => formula.id === formulaId)?.name || formulaId || '-'
  const getPersonName = (personId: string) =>
    allPersons.value.find((person) => person.id === personId)?.name || personId || '-'
  const getFeedTime = (record: AnyRow) =>
    record.feedingTime ??
    record.feedTime ??
    record.feed_time ??
    record.createdAt ??
    record.created_at
  const getMilkTime = (record: AnyRow) =>
    record.milkingTime ??
    record.milkTime ??
    record.milking_time ??
    record.createdAt ??
    record.created_at

  const formatDate = (value: string | Date) => {
    return formatDateOnly(value)
  }

  const sameDay = (value: string | Date, target: Date) => {
    if (!value) return false
    return new Date(value).toDateString() === target.toDateString()
  }

  const getInventoryValue = (item: AnyRow, camelKey: string, snakeKey: string) =>
    Number(item[camelKey] ?? item[snakeKey] ?? 0)

  const latestFeedSummary = computed(() => {
    const latest = feedRecords.value
      .filter((record) => getFeedTime(record))
      .slice()
      .sort((a, b) => new Date(getFeedTime(b)).getTime() - new Date(getFeedTime(a)).getTime())[0]

    if (!latest) return '暂无投喂记录'

    const batchNo = latest.feedQuality?.batchNo ? ` · ${latest.feedQuality.batchNo}` : ''
    return `${formatDate(getFeedTime(latest))} · ${getPenName(latest.penId)} · ${Number(latest.actualAmount || 0).toFixed(1)} kg${batchNo}`
  })

  const todayFeedSummary = computed(
    () => `${todayTotalFeed.value.toFixed(1)} kg · ${feedStats.todayRecords} 条`
  )

  const inventoryProofSummary = computed(() => {
    const totalStock = feedInventory.value.reduce(
      (sum, item) => sum + getInventoryValue(item, 'currentStock', 'current_stock'),
      0
    )
    const safeItems = feedInventory.value.filter(
      (item) =>
        getInventoryValue(item, 'currentStock', 'current_stock') >
        getInventoryValue(item, 'minimumStock', 'minimum_stock')
    )
    const safetyDays = todayTotalFeed.value > 0 ? Math.round(totalStock / todayTotalFeed.value) : 0
    return `${safetyDays} 天 · ${safeItems.length}/${feedInventory.value.length} 项高于最低库存`
  })

  const costProofSummary = computed(() => {
    const costPerKg = todayTotalFeed.value > 0 ? feedStats.totalCost / todayTotalFeed.value : 0
    const costPerKgMilk =
      todayMilkVolume.value > 0 ? feedStats.totalCost / todayMilkVolume.value : 0
    return `今日 ¥${feedStats.totalCost.toLocaleString()} · ${costPerKg.toFixed(2)} 元/kg · ${todayMilkVolume.value.toFixed(1)} kg 奶 → ${costPerKgMilk.toFixed(2)} 元/kg奶`
  })

  const getOrCreateChart = (id: string) => {
    const element = document.getElementById(id)
    if (!element) return null

    const cached = chartInstances.value.get(id)
    if (cached && !cached.isDisposed()) return cached

    const chart = echarts.init(element)
    chartInstances.value.set(id, chart)
    return chart
  }

  const renderCharts = () => {
    renderInventoryChart()
    renderCostTrendChart()
    renderFormulaCostChart()
    renderFeedEfficiencyChart()
  }

  const renderInventoryChart = () => {
    const chart = getOrCreateChart('inventory-chart')
    if (!chart) return

    const rows = feedInventory.value.slice(0, 8)
    chart.setOption(
      {
        tooltip: { trigger: 'axis' },
        legend: { data: ['当前库存', '最低库存'] },
        grid: { left: 46, right: 20, top: 48, bottom: 40 },
        xAxis: { type: 'category', data: rows.map((row) => row.feedName || row.feedId || '-') },
        yAxis: { type: 'value', name: 'kg' },
        series: [
          {
            name: '当前库存',
            type: 'bar',
            data: rows.map((row) => Number(row.currentStock || 0)),
            itemStyle: { color: '#60c041' }
          },
          {
            name: '最低库存',
            type: 'line',
            data: rows.map((row) => Number(row.minimumStock || 0)),
            itemStyle: { color: '#f5a524' }
          }
        ]
      },
      true
    )
  }

  const renderCostTrendChart = () => {
    const chart = getOrCreateChart('cost-trend-chart')
    if (!chart) return

    const formulaCostMap = new Map(
      feedFormulas.value.map((formula) => [String(formula.id), Number(formula.totalCost || 0)])
    )
    const rows = Array.from({ length: 6 }, (_, index) => {
      const date = new Date()
      date.setMonth(date.getMonth() - (5 - index))
      const monthRecords = feedRecords.value.filter((record) => {
        const current = new Date(getFeedTime(record))
        return (
          current.getFullYear() === date.getFullYear() && current.getMonth() === date.getMonth()
        )
      })
      return {
        label: date.toLocaleDateString('zh-CN', { month: 'short' }),
        value: Math.round(
          monthRecords.reduce(
            (sum, record) =>
              sum +
              Number(record.actualAmount || 0) *
                (formulaCostMap.get(String(record.formulaId)) || 0),
            0
          )
        )
      }
    })

    chart.setOption(
      {
        tooltip: { trigger: 'axis' },
        grid: { left: 54, right: 20, top: 30, bottom: 38 },
        xAxis: { type: 'category', data: rows.map((row) => row.label) },
        yAxis: { type: 'value', name: '¥' },
        series: [
          {
            name: '实际成本',
            type: 'line',
            smooth: true,
            data: rows.map((row) => row.value),
            areaStyle: { color: 'rgba(96, 192, 65, 0.18)' },
            itemStyle: { color: '#60c041' }
          }
        ]
      },
      true
    )
  }

  const renderFormulaCostChart = () => {
    const chart = getOrCreateChart('formula-cost-chart')
    if (!chart) return

    const rows = feedFormulas.value.slice(0, 8)
    chart.setOption(
      {
        tooltip: { trigger: 'axis' },
        grid: { left: 46, right: 20, top: 30, bottom: 56 },
        xAxis: {
          type: 'category',
          data: rows.map((row) => row.name || '-'),
          axisLabel: { rotate: 24 }
        },
        yAxis: { type: 'value', name: '¥/kg' },
        series: [
          {
            name: '配方成本',
            type: 'bar',
            data: rows.map((row) => Number(row.totalCost || 0)),
            itemStyle: { color: '#00a6a6' }
          }
        ]
      },
      true
    )
  }

  const renderFeedEfficiencyChart = () => {
    const chart = getOrCreateChart('feed-efficiency-chart')
    if (!chart) return

    const planned = feedRecords.value.reduce(
      (sum, record) => sum + Number(record.plannedAmount || 0),
      0
    )
    const actual = feedRecords.value.reduce(
      (sum, record) => sum + Number(record.actualAmount || 0),
      0
    )
    chart.setOption(
      {
        tooltip: { trigger: 'item' },
        legend: { left: 'center', bottom: 8 },
        series: [
          {
            name: '投喂结构',
            type: 'pie',
            radius: ['42%', '70%'],
            center: ['50%', '45%'],
            data: [
              { name: '计划投喂量', value: planned, itemStyle: { color: '#60c041' } },
              { name: '实际投喂量', value: actual, itemStyle: { color: '#00a6a6' } },
              {
                name: '有效采食估算',
                value: Math.round(actual * 0.85),
                itemStyle: { color: '#f5a524' }
              }
            ]
          }
        ]
      },
      true
    )
  }

  watch(activeTab, () => nextTick(renderCharts))

  onMounted(loadData)

  onBeforeUnmount(() => {
    chartInstances.value.forEach((chart) => chart.dispose())
    chartInstances.value.clear()
  })

  defineOptions({ name: 'FeedManagement' })
</script>

<style scoped>
  .chart-box {
    width: 100%;
    height: 320px;
  }

  .production-proof-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
    margin-top: 16px;
  }

  .proof-item {
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid rgba(96, 192, 65, 0.18);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.78);
    box-shadow: 0 10px 28px rgba(24, 38, 20, 0.06);
  }

  .proof-item span {
    display: block;
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--fluent-text-soft);
  }

  .proof-item strong {
    display: block;
    overflow-wrap: anywhere;
    font-size: 15px;
    font-weight: 700;
    line-height: 1.45;
    color: var(--fluent-text);
  }

  .metric-label,
  .metric-note,
  .object-meta {
    color: var(--fluent-text-soft);
  }

  .metric-value {
    margin: 8px 0;
    font-size: clamp(22px, 2vw, 29px);
    font-weight: 700;
    color: var(--fluent-text);
  }

  .fluent-object-card h3,
  .fluent-panel h2 {
    margin: 0 0 8px;
    font-size: 18px;
    font-weight: 700;
    color: var(--fluent-text);
  }

  .fluent-object-card p {
    margin: 0;
    color: var(--fluent-text-soft);
  }

  .object-meta {
    display: grid;
    gap: 8px;
    margin-top: 18px;
    font-size: 13px;
  }

  @media (max-width: 1024px) {
    .production-proof-strip {
      grid-template-columns: 1fr;
    }
  }
</style>
