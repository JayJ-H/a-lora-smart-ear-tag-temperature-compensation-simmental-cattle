<template>
  <div class="economic-analysis">
    <!-- 头部工具栏 -->
    <div class="analysis-header">
      <div class="analysis-head-row">
        <div class="analysis-title-group">
          <div>
            <h1>经济效益分析</h1>
          </div>
          <ElDatePicker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            class="w-80"
            @change="handleDateRangeChange"
          />
        </div>
        <div class="analysis-actions">
          <ElButton @click="loadAnalysisData">
            <ArtSvgIcon icon="ri:refresh-line" class="mr-2" />
            刷新数据
          </ElButton>
          <ElButton type="primary" @click="generateReport">
            <ArtSvgIcon icon="ri:file-chart-line" class="mr-2" />
            生成报告
          </ElButton>
        </div>
      </div>
    </div>

    <!-- 概览卡片 -->
    <div v-if="analysisData" class="overview-cards">
      <div class="economic-summary-grid">
        <div
          class="overview-card"
          role="button"
          tabindex="0"
          @click="openSummaryDetail('revenue')"
          @keydown.enter.prevent="openSummaryDetail('revenue')"
          @keydown.space.prevent="openSummaryDetail('revenue')"
        >
          <div class="card-header">
            <ArtSvgIcon icon="ri:money-dollar-circle-line" class="card-icon revenue" />
            <span class="card-title">总收入</span>
          </div>
          <div class="card-value">{{ formatCurrency(analysisData.summary.totalRevenue) }}</div>
          <div class="card-change">
            <ArtSvgIcon
              :icon="summaryChangeIcon('revenue')"
              :class="`change-icon ${summaryChangeTone('revenue')}`"
            />
            <span class="change-text">{{ formatSummaryChange('revenue') }}</span>
          </div>
        </div>

        <div
          class="overview-card"
          role="button"
          tabindex="0"
          @click="openSummaryDetail('cost')"
          @keydown.enter.prevent="openSummaryDetail('cost')"
          @keydown.space.prevent="openSummaryDetail('cost')"
        >
          <div class="card-header">
            <ArtSvgIcon icon="ri:subtract-line" class="card-icon cost" />
            <span class="card-title">总成本</span>
          </div>
          <div class="card-value">{{ formatCurrency(analysisData.summary.totalCost) }}</div>
          <div class="card-change">
            <ArtSvgIcon
              :icon="summaryChangeIcon('cost')"
              :class="`change-icon ${summaryChangeTone('cost', true)}`"
            />
            <span class="change-text">{{ formatSummaryChange('cost') }}</span>
          </div>
        </div>

        <div
          class="overview-card"
          role="button"
          tabindex="0"
          @click="openSummaryDetail('profit')"
          @keydown.enter.prevent="openSummaryDetail('profit')"
          @keydown.space.prevent="openSummaryDetail('profit')"
        >
          <div class="card-header">
            <ArtSvgIcon icon="ri:pie-chart-line" class="card-icon profit" />
            <span class="card-title">净利润</span>
          </div>
          <div class="card-value">{{ formatCurrency(analysisData.summary.netProfit) }}</div>
          <div class="card-change">
            <ArtSvgIcon
              :icon="summaryChangeIcon('profit')"
              :class="`change-icon ${summaryChangeTone('profit')}`"
            />
            <span class="change-text">{{ formatSummaryChange('profit') }}</span>
          </div>
        </div>

        <div
          class="overview-card"
          role="button"
          tabindex="0"
          @click="openSummaryDetail('margin')"
          @keydown.enter.prevent="openSummaryDetail('margin')"
          @keydown.space.prevent="openSummaryDetail('margin')"
        >
          <div class="card-header">
            <ArtSvgIcon icon="ri:percent-line" class="card-icon margin" />
            <span class="card-title">利润率</span>
          </div>
          <div class="card-value">{{ analysisData.summary.profitMargin.toFixed(1) }}%</div>
          <div class="card-change">
            <ArtSvgIcon
              :icon="summaryChangeIcon('margin')"
              :class="`change-icon ${summaryChangeTone('margin')}`"
            />
            <span class="change-text">{{ formatSummaryPointChange('margin') }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 图表区域 -->
    <div class="charts-section">
      <div class="chart-grid">
        <!-- 成本构成饼图 -->
        <div
          class="chart-card"
          role="button"
          tabindex="0"
          @click="openChartDetail('cost')"
          @keydown.enter.prevent="openChartDetail('cost')"
          @keydown.space.prevent="openChartDetail('cost')"
        >
          <div class="chart-header">
            <h3 class="chart-title">成本构成分析</h3>
          </div>
          <div ref="costChartRef" class="chart-container"></div>
        </div>

        <!-- 收入构成饼图 -->
        <div
          class="chart-card"
          role="button"
          tabindex="0"
          @click="openChartDetail('revenue')"
          @keydown.enter.prevent="openChartDetail('revenue')"
          @keydown.space.prevent="openChartDetail('revenue')"
        >
          <div class="chart-header">
            <h3 class="chart-title">收入构成分析</h3>
          </div>
          <div ref="revenueChartRef" class="chart-container"></div>
        </div>

        <!-- 趋势图 -->
        <div
          class="chart-card chart-wide"
          role="button"
          tabindex="0"
          @click="openChartDetail('trend')"
          @keydown.enter.prevent="openChartDetail('trend')"
          @keydown.space.prevent="openChartDetail('trend')"
        >
          <div class="chart-header">
            <h3 class="chart-title">收支趋势分析</h3>
          </div>
          <div ref="trendChartRef" class="chart-container"></div>
        </div>
      </div>
    </div>

    <!-- 详细数据表格 -->
    <div class="data-tables-section">
      <ElTabs v-model="activeTab" @tab-click="handleTabClick">
        <ElTabPane label="成本明细" name="costs">
          <div class="table-header mb-4">
            <div class="flex items-center justify-between">
              <h4 class="table-title">成本记录</h4>
              <ElButton type="primary" size="small" @click="showCostDialog">
                <ArtSvgIcon icon="ri:add-line" class="mr-2" />
                添加成本
              </ElButton>
            </div>
          </div>
          <div class="table-shell">
            <ElTable
              :data="visibleCostRecords"
              style="width: 100%"
              v-loading="loading"
              @wheel.passive="onCostTableWheel"
              @row-click="openCostRowDetail"
            >
              <ElTableColumn prop="date" label="日期" width="120">
                <template #default="scope">
                  {{ formatDate(scope.row.date) }}
                </template>
              </ElTableColumn>
              <ElTableColumn prop="category" label="类别" width="120">
                <template #default="scope">
                  <ElTag :type="getCategoryTagType(scope.row.category)">
                    {{ getCategoryLabel(scope.row.category) }}
                  </ElTag>
                </template>
              </ElTableColumn>
              <ElTableColumn prop="name" label="项目名称" min-width="150" />
              <ElTableColumn prop="amount" label="金额(元)" width="120">
                <template #default="scope">
                  {{ formatCurrency(scope.row.amount) }}
                </template>
              </ElTableColumn>
              <ElTableColumn prop="description" label="描述" min-width="200" />
              <ElTableColumn label="操作" width="120" fixed="right">
                <template #default="scope">
                  <ElButton size="small" type="danger" @click.stop="deleteCostRecord(scope.row)">
                    删除
                  </ElButton>
                </template>
              </ElTableColumn>
            </ElTable>
          </div>
        </ElTabPane>

        <ElTabPane label="收入明细" name="revenue">
          <div class="table-header mb-4">
            <div class="flex items-center justify-between">
              <h4 class="table-title">收入记录</h4>
              <ElButton type="primary" size="small" @click="showRevenueDialog">
                <ArtSvgIcon icon="ri:add-line" class="mr-2" />
                添加收入
              </ElButton>
            </div>
          </div>
          <div class="table-shell">
            <ElTable
              :data="visibleRevenueRecords"
              style="width: 100%"
              v-loading="loading"
              @wheel.passive="onRevenueTableWheel"
              @row-click="openRevenueRowDetail"
            >
              <ElTableColumn prop="date" label="日期" width="120">
                <template #default="scope">
                  {{ formatDate(scope.row.date) }}
                </template>
              </ElTableColumn>
              <ElTableColumn prop="category" label="类别" width="120">
                <template #default="scope">
                  <ElTag :type="getRevenueCategoryTagType(scope.row.category)">
                    {{ getRevenueCategoryLabel(scope.row.category) }}
                  </ElTag>
                </template>
              </ElTableColumn>
              <ElTableColumn prop="name" label="项目名称" min-width="150" />
              <ElTableColumn prop="quantity" label="数量" width="100" />
              <ElTableColumn prop="unitPrice" label="单价(元)" width="120">
                <template #default="scope">
                  {{ formatCurrency(scope.row.unitPrice) }}
                </template>
              </ElTableColumn>
              <ElTableColumn prop="amount" label="金额(元)" width="120">
                <template #default="scope">
                  {{ formatCurrency(scope.row.amount) }}
                </template>
              </ElTableColumn>
              <ElTableColumn prop="description" label="描述" min-width="200" />
              <ElTableColumn label="操作" width="120" fixed="right">
                <template #default="scope">
                  <ElButton size="small" type="danger" @click.stop="deleteRevenueRecord(scope.row)">
                    删除
                  </ElButton>
                </template>
              </ElTableColumn>
            </ElTable>
          </div>
        </ElTabPane>

        <ElTabPane label="预算管理" name="budget">
          <div class="table-header mb-4">
            <div class="flex items-center justify-between">
              <h4 class="table-title">预算计划</h4>
              <ElButton type="primary" size="small" @click="showBudgetDialog">
                <ArtSvgIcon icon="ri:add-line" class="mr-2" />
                创建预算
              </ElButton>
            </div>
          </div>
          <div class="table-shell">
            <ElTable
              :data="visibleBudgetPlans"
              style="width: 100%"
              v-loading="loading"
              @wheel.passive="onBudgetTableWheel"
              @row-click="openBudgetDetail"
            >
              <ElTableColumn prop="name" label="预算名称" min-width="200" />
              <ElTableColumn label="预算周期" width="200">
                <template #default="scope">
                  {{ formatDate(scope.row.period.startDate) }} -
                  {{ formatDate(scope.row.period.endDate) }}
                </template>
              </ElTableColumn>
              <ElTableColumn prop="totalPlanned" label="预算金额(元)" width="140">
                <template #default="scope">
                  {{ formatCurrency(scope.row.totalPlanned) }}
                </template>
              </ElTableColumn>
              <ElTableColumn prop="totalActual" label="实际金额(元)" width="140">
                <template #default="scope">
                  {{ scope.row.totalActual ? formatCurrency(scope.row.totalActual) : '-' }}
                </template>
              </ElTableColumn>
              <ElTableColumn prop="status" label="状态" width="100">
                <template #default="scope">
                  <ElTag :type="getStatusTagType(scope.row.status)">
                    {{ getStatusLabel(scope.row.status) }}
                  </ElTag>
                </template>
              </ElTableColumn>
              <ElTableColumn label="操作" width="150" fixed="right">
                <template #default="scope">
                  <ElButton size="small" @click.stop="openBudgetDetail(scope.row)">查看</ElButton>
                  <ElButton size="small" type="danger" @click.stop="deleteBudgetPlan(scope.row)">
                    删除
                  </ElButton>
                </template>
              </ElTableColumn>
            </ElTable>
          </div>
        </ElTabPane>
      </ElTabs>
    </div>

    <!-- 添加成本对话框 -->
    <ElDialog v-model="costDialogVisible" title="添加成本记录" width="600px" @close="resetCostForm">
      <ElForm ref="costFormRef" :model="costForm" :rules="costFormRules" label-width="100px">
        <ElFormItem label="日期" prop="date">
          <ElDatePicker
            v-model="costForm.date"
            type="date"
            placeholder="选择日期"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
          />
        </ElFormItem>
        <ElFormItem label="类别" prop="category">
          <ElSelect v-model="costForm.category" placeholder="选择类别">
            <ElOption label="饲料" value="feed" />
            <ElOption label="兽医" value="veterinary" />
            <ElOption label="人工" value="labor" />
            <ElOption label="设备" value="equipment" />
            <ElOption label="水电" value="utilities" />
            <ElOption label="其他" value="other" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="项目名称" prop="name">
          <ElInput v-model="costForm.name" placeholder="请输入项目名称" />
        </ElFormItem>
        <ElFormItem label="金额" prop="amount">
          <ElInputNumber
            v-model="costForm.amount"
            :min="0"
            :precision="2"
            controls-position="right"
            class="w-full"
          />
        </ElFormItem>
        <ElFormItem label="描述">
          <ElInput
            v-model="costForm.description"
            type="textarea"
            placeholder="请输入描述"
            :rows="3"
          />
        </ElFormItem>
      </ElForm>

      <template #footer>
        <ElButton @click="costDialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="handleCreateCost" :loading="creating"> 添加 </ElButton>
      </template>
    </ElDialog>

    <!-- 添加收入对话框 -->
    <ElDialog
      v-model="revenueDialogVisible"
      title="添加收入记录"
      width="600px"
      @close="resetRevenueForm"
    >
      <ElForm
        ref="revenueFormRef"
        :model="revenueForm"
        :rules="revenueFormRules"
        label-width="100px"
      >
        <ElFormItem label="日期" prop="date">
          <ElDatePicker
            v-model="revenueForm.date"
            type="date"
            placeholder="选择日期"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
          />
        </ElFormItem>
        <ElFormItem label="类别" prop="category">
          <ElSelect v-model="revenueForm.category" placeholder="选择类别">
            <ElOption label="鲜奶结算" value="milk_sales" />
            <ElOption label="淘汰处置收入" value="cow_sales" />
            <ElOption label="犊牛转出收入" value="calf_sales" />
            <ElOption label="粪肥资源化收入" value="manure_sales" />
            <ElOption label="其他" value="other" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="项目名称" prop="name">
          <ElInput v-model="revenueForm.name" placeholder="请输入项目名称" />
        </ElFormItem>
        <ElFormItem label="数量" prop="quantity">
          <ElInputNumber
            v-model="revenueForm.quantity"
            :min="0"
            :precision="2"
            controls-position="right"
          />
        </ElFormItem>
        <ElFormItem label="单价" prop="unitPrice">
          <ElInputNumber
            v-model="revenueForm.unitPrice"
            :min="0"
            :precision="2"
            controls-position="right"
          />
        </ElFormItem>
        <ElFormItem label="描述">
          <ElInput
            v-model="revenueForm.description"
            type="textarea"
            placeholder="请输入描述"
            :rows="3"
          />
        </ElFormItem>
      </ElForm>

      <template #footer>
        <ElButton @click="revenueDialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="handleCreateRevenue" :loading="creating"> 添加 </ElButton>
      </template>
    </ElDialog>

    <ElDialog v-model="detailDialogVisible" :title="detailDialog.title" width="720px">
      <div class="analysis-detail">
        <div class="detail-summary">
          <span>{{ detailDialog.subtitle }}</span>
          <strong>{{ detailDialog.primary }}</strong>
        </div>
        <div class="detail-grid">
          <div v-for="row in detailDialog.rows" :key="row.label" class="detail-row">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
        <div class="detail-table" v-if="detailDialog.items.length">
          <div v-for="item in detailDialog.items" :key="item.label" class="detail-item">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
        <div class="detail-note">{{ detailDialog.note }}</div>
      </div>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, onMounted, nextTick } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import * as databaseService from '@/services/数据库'
  import type { EconomicAnalysis, CostItem, RevenueItem, BudgetPlan } from '@/types/cow'
  import { economicApi } from '@/api/cow'
  import { useEChartsManager, useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'

  type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'
  type SummaryDetailType = 'revenue' | 'cost' | 'profit' | 'margin'
  type SummaryChangeKey = SummaryDetailType
  type ChartDetailType = 'cost' | 'revenue' | 'trend'
  type DetailLine = { label: string; value: string }

  const formatDateInput = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  const today = new Date()
  const defaultStartDate = new Date(today)
  defaultStartDate.setDate(today.getDate() - 30)
  const defaultStartDay = formatDateInput(defaultStartDate)
  const currentDay = formatDateInput(today)

  // 响应式数据
  const dateRange = ref([defaultStartDay, currentDay])
  const analysisData = ref<any>(null)
  const costRecords = ref<CostItem[]>([])
  const revenueRecords = ref<RevenueItem[]>([])
  const budgetPlans = ref<BudgetPlan[]>([])
  const { getOrCreateChart } = useEChartsManager()
  const { visibleItems: visibleCostRecords, handleWheel: onCostTableWheel } = useLazyRenderWindow(
    costRecords,
    {
      initialCount: 10,
      batchSize: 10,
      mode: 'fixed-window'
    }
  )
  const { visibleItems: visibleRevenueRecords, handleWheel: onRevenueTableWheel } =
    useLazyRenderWindow(revenueRecords, {
      initialCount: 10,
      batchSize: 10,
      mode: 'fixed-window'
    })
  const { visibleItems: visibleBudgetPlans, handleWheel: onBudgetTableWheel } = useLazyRenderWindow(
    budgetPlans,
    {
      initialCount: 10,
      batchSize: 10,
      mode: 'fixed-window'
    }
  )
  const loading = ref(false)
  const activeTab = ref('costs')
  const fluentChartPalette = ['#60c041', '#00a6a6', '#f5a524', '#d83b5d', '#6b7280']
  const fluentLegendText = { color: 'var(--fluent-text-soft)' }

  // 图表引用
  const costChartRef = ref<HTMLElement>()
  const revenueChartRef = ref<HTMLElement>()
  const trendChartRef = ref<HTMLElement>()

  // 对话框状态
  const costDialogVisible = ref(false)
  const revenueDialogVisible = ref(false)
  const detailDialogVisible = ref(false)
  const creating = ref(false)

  const detailDialog = reactive({
    title: '详情',
    subtitle: '',
    primary: '',
    note: '',
    rows: [] as DetailLine[],
    items: [] as DetailLine[]
  })

  // 成本表单
  const costFormRef = ref()
  const costForm = reactive({
    date: '',
    category: 'feed' as const,
    name: '',
    amount: 0,
    unit: '元',
    description: ''
  })

  // 收入表单
  const revenueFormRef = ref()
  const revenueForm = reactive({
    date: '',
    category: 'milk_sales' as const,
    name: '',
    unit: '元',
    quantity: 0,
    unitPrice: 0,
    description: ''
  })

  // 表单验证规则
  const costFormRules = {
    date: [{ required: true, message: '请选择日期', trigger: 'change' }],
    category: [{ required: true, message: '请选择类别', trigger: 'change' }],
    name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
    amount: [{ required: true, message: '请输入金额', trigger: 'blur' }]
  }

  const revenueFormRules = {
    date: [{ required: true, message: '请选择日期', trigger: 'change' }],
    category: [{ required: true, message: '请选择类别', trigger: 'change' }],
    name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
    quantity: [{ required: true, message: '请输入数量', trigger: 'blur' }],
    unitPrice: [{ required: true, message: '请输入单价', trigger: 'blur' }]
  }

  const emptyAnalysis = () => ({
    id: 'empty-analysis',
    period: dateRange.value.join(' 至 '),
    summary: {
      totalRevenue: 0,
      totalCost: 0,
      grossProfit: 0,
      netProfit: 0,
      profitMargin: 0,
      roi: 0,
      breakEvenPoint: 0
    },
    costBreakdown: {},
    revenueBreakdown: {},
    trends: {
      revenue: [],
      costs: [],
      profit: []
    },
    recommendations: ['当前日期范围内暂无成本或收入记录，请先录入生产经营数据。']
  })

  const isInDateRange = (dateValue: string | undefined) => {
    if (!dateRange.value || dateRange.value.length !== 2) return true
    if (!dateValue) return false
    const time = new Date(dateValue).getTime()
    const start = new Date(dateRange.value[0]).getTime()
    const end = new Date(dateRange.value[1]).getTime() + 86400000
    return Number.isFinite(time) && time >= start && time < end
  }

  const groupBreakdown = (rows: Array<{ category: string; amount: number }>, total: number) =>
    rows.reduce<Record<string, { amount: number; percentage: number; trend: 'stable' }>>(
      (result, row) => {
        const key = row.category || 'other'
        const current = result[key]?.amount || 0
        const amount = Number((current + toNumber(row.amount)).toFixed(2))
        result[key] = {
          amount,
          percentage: total ? Number(((amount / total) * 100).toFixed(1)) : 0,
          trend: 'stable'
        }
        return result
      },
      {}
    )

  const trendRowsFromRecords = (costs: CostItem[], revenues: RevenueItem[]) => {
    const dates = Array.from(
      new Set([...costs.map((row) => row.date), ...revenues.map((row) => row.date)].filter(Boolean))
    ).sort()
    return {
      revenue: dates.map((date) => ({
        date: String(date).slice(5, 10),
        amount: Number(
          revenues
            .filter((row) => row.date === date)
            .reduce((sum, row) => sum + toNumber(row.amount), 0)
            .toFixed(2)
        )
      })),
      costs: dates.map((date) => ({
        date: String(date).slice(5, 10),
        amount: Number(
          costs
            .filter((row) => row.date === date)
            .reduce((sum, row) => sum + toNumber(row.amount), 0)
            .toFixed(2)
        )
      })),
      profit: dates.map((date) => {
        const revenue = revenues
          .filter((row) => row.date === date)
          .reduce((sum, row) => sum + toNumber(row.amount), 0)
        const cost = costs
          .filter((row) => row.date === date)
          .reduce((sum, row) => sum + toNumber(row.amount), 0)
        return { date: String(date).slice(5, 10), amount: Number((revenue - cost).toFixed(2)) }
      })
    }
  }

  const buildAnalysisFromRecords = (costs: CostItem[], revenues: RevenueItem[]) => {
    const scopedCosts = costs.filter((row) => isInDateRange(row.date))
    const scopedRevenues = revenues.filter((row) => isInDateRange(row.date))
    const totalCost = Number(
      scopedCosts.reduce((sum, row) => sum + toNumber(row.amount), 0).toFixed(2)
    )
    const totalRevenue = Number(
      scopedRevenues.reduce((sum, row) => sum + toNumber(row.amount), 0).toFixed(2)
    )
    if (!totalCost && !totalRevenue) return emptyAnalysis()
    const netProfit = Number((totalRevenue - totalCost).toFixed(2))
    return {
      id: `derived-${dateRange.value.join('-')}`,
      period: dateRange.value.join(' 至 '),
      summary: {
        totalRevenue,
        totalCost,
        grossProfit: netProfit,
        netProfit,
        profitMargin: totalRevenue ? Number(((netProfit / totalRevenue) * 100).toFixed(1)) : 0,
        roi: totalCost ? Number(((netProfit / totalCost) * 100).toFixed(1)) : 0,
        breakEvenPoint: 0
      },
      costBreakdown: groupBreakdown(scopedCosts, totalCost),
      revenueBreakdown: groupBreakdown(scopedRevenues, totalRevenue),
      trends: trendRowsFromRecords(scopedCosts, scopedRevenues),
      recommendations: ['分析结果由 cost_items 与 revenue_items 实时聚合生成，可回溯到明细记录。']
    }
  }

  // 加载分析数据
  const loadAnalysisData = async () => {
    if (!dateRange.value || dateRange.value.length !== 2) return

    loading.value = true
    try {
      const [analysisList, costs, revenues] = await Promise.all([
        databaseService.getTableDataAsync('economic-analysis', { silent: true }),
        databaseService.getTableDataAsync('cost-items', { silent: true }),
        databaseService.getTableDataAsync('revenue-items', { silent: true })
      ])
      const normalizedAllCosts = costs.map(normalizeCostRow)
      const normalizedAllRevenues = revenues.map(normalizeRevenueRow)
      const normalizedCosts = normalizedAllCosts.filter((row) => isInDateRange(row.date))
      const normalizedRevenues = normalizedAllRevenues.filter((row) => isInDateRange(row.date))
      costRecords.value = normalizedCosts
      revenueRecords.value = normalizedRevenues

      const matchedAnalysis = analysisList
        .map(normalizeAnalysisRow)
        .find(
          (row) =>
            String(row.period || '').includes(dateRange.value[0].slice(0, 7)) ||
            String(row.createdAt || '').slice(0, 10) >= dateRange.value[0]
        )
      const currentAnalysis =
        matchedAnalysis || buildAnalysisFromRecords(normalizedAllCosts, normalizedAllRevenues)
      analysisData.value = {
        ...currentAnalysis,
        summaryComparison: buildSummaryComparison(
          normalizedAllCosts,
          normalizedAllRevenues,
          currentAnalysis.summary
        )
      }
      nextTick(() => {
        renderCharts()
      })
    } catch (error) {
      ElMessage.error('获取分析数据失败')
      ElMessage.error('加载分析数据失败')
    } finally {
      loading.value = false
    }
  }

  // 加载成本记录
  const loadCostRecords = async () => {
    if (!dateRange.value || dateRange.value.length !== 2) return

    try {
      costRecords.value = (await databaseService.getTableDataAsync('cost-items'))
        .map(normalizeCostRow)
        .filter((row) => isInDateRange(row.date))
    } catch (error) {
      ElMessage.error('获取成本记录失败')
      ElMessage.error('加载成本记录失败')
    }
  }

  // 加载收入记录
  const loadRevenueRecords = async () => {
    if (!dateRange.value || dateRange.value.length !== 2) return

    try {
      revenueRecords.value = (await databaseService.getTableDataAsync('revenue-items'))
        .map(normalizeRevenueRow)
        .filter((row) => isInDateRange(row.date))
    } catch (error) {
      ElMessage.error('获取收入记录失败')
      ElMessage.error('加载收入记录失败')
    }
  }

  // 加载预算计划
  const loadBudgetPlans = async () => {
    try {
      const response = await economicApi.getBudgetPlans()
      if (response.code === 200) {
        budgetPlans.value = response.data.map(normalizeBudgetRow)
      }
    } catch (error) {
      ElMessage.error('获取预算计划失败')
      ElMessage.error('加载预算计划失败')
    }
  }

  // 渲染图表
  const renderCharts = () => {
    if (!analysisData.value) return

    // 成本构成饼图
    if (costChartRef.value) {
      const costChart = getOrCreateChart('cost-chart', costChartRef.value)
      if (!costChart) return
      const costData = Object.entries(
        analysisData.value.costBreakdown as Record<string, { amount: number }>
      ).map(([key, value]) => ({
        name: getCategoryLabel(key as any),
        value: value.amount
      }))

      costChart.setOption({
        color: fluentChartPalette,
        tooltip: {
          trigger: 'item',
          formatter: '{a} <br/>{b}: {c}元 ({d}%)'
        },
        legend: {
          orient: 'vertical',
          left: 'left',
          textStyle: fluentLegendText
        },
        series: [
          {
            name: '成本构成',
            type: 'pie',
            radius: '50%',
            data: costData,
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: 'rgba(0, 0, 0, 0.5)'
              }
            }
          }
        ]
      })
    }

    // 收入构成饼图
    if (revenueChartRef.value) {
      const revenueChart = getOrCreateChart('revenue-chart', revenueChartRef.value)
      if (!revenueChart) return
      const revenueData = Object.entries(
        analysisData.value.revenueBreakdown as Record<string, { amount: number }>
      ).map(([key, value]) => ({
        name: getRevenueCategoryLabel(key as any),
        value: value.amount
      }))

      revenueChart.setOption({
        color: fluentChartPalette,
        tooltip: {
          trigger: 'item',
          formatter: '{a} <br/>{b}: {c}元 ({d}%)'
        },
        legend: {
          orient: 'vertical',
          left: 'left',
          textStyle: fluentLegendText
        },
        series: [
          {
            name: '收入构成',
            type: 'pie',
            radius: '50%',
            data: revenueData,
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: 'rgba(0, 0, 0, 0.5)'
              }
            }
          }
        ]
      })
    }

    // 趋势图
    if (trendChartRef.value) {
      const trendChart = getOrCreateChart('trend-chart', trendChartRef.value)
      if (!trendChart) return

      trendChart.setOption({
        color: fluentChartPalette,
        tooltip: {
          trigger: 'axis'
        },
        legend: {
          data: ['收入', '成本', '利润'],
          textStyle: fluentLegendText
        },
        xAxis: {
          type: 'category',
          data: safeTrendRows(analysisData.value.trends?.revenue).map((item: any) => item.date)
        },
        yAxis: {
          type: 'value'
        },
        series: [
          {
            name: '收入',
            type: 'line',
            data: safeTrendRows(analysisData.value.trends?.revenue).map((item: any) => item.amount),
            lineStyle: { color: '#60c041', width: 2 },
            itemStyle: { color: '#60c041' }
          },
          {
            name: '成本',
            type: 'line',
            data: safeTrendRows(analysisData.value.trends?.costs).map((item: any) => item.amount),
            lineStyle: { color: '#d83b5d', width: 2 },
            itemStyle: { color: '#d83b5d' }
          },
          {
            name: '利润',
            type: 'line',
            data: safeTrendRows(analysisData.value.trends?.profit).map((item: any) => item.amount),
            lineStyle: { color: '#00a6a6', width: 2 },
            itemStyle: { color: '#00a6a6' }
          }
        ]
      })
    }
  }

  // 工具函数
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY'
    }).format(amount)
  }

  const formatDate = (dateString: string | undefined) => {
    return formatDateOnly(dateString, '-')
  }

  const formatDateTime = (dateString: string | undefined) => {
    return formatDateOnly(dateString, '-')
  }

  const toNumber = (value: unknown) => {
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : 0
  }

  const safeTrendRows = (rows: any[]) => (Array.isArray(rows) ? rows : [])

  const getSelectedRangeBounds = () => {
    if (!dateRange.value || dateRange.value.length !== 2) return null
    const start = new Date(dateRange.value[0]).getTime()
    const endInclusive = new Date(dateRange.value[1]).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(endInclusive)) return null
    return {
      start,
      endExclusive: endInclusive + 86400000,
      dayCount: Math.max(1, Math.round((endInclusive - start) / 86400000) + 1)
    }
  }

  const isRecordInBounds = (dateValue: string | undefined, start: number, endExclusive: number) => {
    if (!dateValue) return false
    const time = new Date(dateValue).getTime()
    return Number.isFinite(time) && time >= start && time < endExclusive
  }

  const summarizePeriod = (
    costs: CostItem[],
    revenues: RevenueItem[],
    start: number,
    endExclusive: number
  ) => {
    const scopedCosts = costs.filter((row) => isRecordInBounds(row.date, start, endExclusive))
    const scopedRevenues = revenues.filter((row) => isRecordInBounds(row.date, start, endExclusive))
    const totalCost = scopedCosts.reduce((sum, row) => sum + toNumber(row.amount), 0)
    const totalRevenue = scopedRevenues.reduce((sum, row) => sum + toNumber(row.amount), 0)
    const netProfit = totalRevenue - totalCost
    return {
      totalCost,
      totalRevenue,
      netProfit,
      profitMargin: totalRevenue ? (netProfit / totalRevenue) * 100 : 0
    }
  }

  const percentChange = (current: number, previous: number) => {
    if (!previous) return null
    return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(1))
  }

  const buildSummaryComparison = (
    costs: CostItem[],
    revenues: RevenueItem[],
    currentSummary: Record<string, number>
  ) => {
    const bounds = getSelectedRangeBounds()
    if (!bounds) return {}
    const previousEndExclusive = bounds.start
    const previousStart = bounds.start - bounds.dayCount * 86400000
    const previous = summarizePeriod(costs, revenues, previousStart, previousEndExclusive)
    return {
      revenue: percentChange(toNumber(currentSummary.totalRevenue), previous.totalRevenue),
      cost: percentChange(toNumber(currentSummary.totalCost), previous.totalCost),
      profit: percentChange(toNumber(currentSummary.netProfit), previous.netProfit),
      margin: previous.totalRevenue
        ? Number((toNumber(currentSummary.profitMargin) - previous.profitMargin).toFixed(1))
        : null
    }
  }

  const getSummaryChange = (key: SummaryChangeKey): number | null => {
    const value = analysisData.value?.summaryComparison?.[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  const summaryChangeIcon = (key: SummaryChangeKey) => {
    const value = getSummaryChange(key)
    if (value === null || value === 0) return 'ri:subtract-line'
    return value > 0 ? 'ri:arrow-up-line' : 'ri:arrow-down-line'
  }

  const summaryChangeTone = (key: SummaryChangeKey, invert = false) => {
    const value = getSummaryChange(key)
    if (value === null || value === 0) return 'neutral'
    const isPositive = value > 0
    return invert ? (isPositive ? 'down' : 'up') : isPositive ? 'up' : 'down'
  }

  const formatSummaryChange = (key: SummaryChangeKey) => {
    const value = getSummaryChange(key)
    if (value === null) return '无上期对比'
    if (value === 0) return '环比持平'
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}% 环比`
  }

  const formatSummaryPointChange = (key: SummaryChangeKey) => {
    const value = getSummaryChange(key)
    if (value === null) return '无上期对比'
    if (value === 0) return '环比持平'
    return `${value > 0 ? '+' : ''}${value.toFixed(1)} 个百分点`
  }

  const openDetailDialog = (payload: {
    title: string
    subtitle: string
    primary: string
    note: string
    rows: DetailLine[]
    items?: DetailLine[]
  }) => {
    detailDialog.title = payload.title
    detailDialog.subtitle = payload.subtitle
    detailDialog.primary = payload.primary
    detailDialog.note = payload.note
    detailDialog.rows = payload.rows
    detailDialog.items = payload.items || []
    detailDialogVisible.value = true
  }

  const getAnalysisPeriod = () => {
    if (!dateRange.value || dateRange.value.length !== 2) return '-'
    return `${dateRange.value[0]} 至 ${dateRange.value[1]}`
  }

  const breakdownItems = (
    breakdown: Record<string, any>,
    labelGetter: (category: string) => string
  ) =>
    Object.entries(breakdown || {}).map(([key, item]) => ({
      label: labelGetter(key),
      value: `${formatCurrency(toNumber(item?.amount))} / ${toNumber(item?.percentage).toFixed(1)}%`
    }))

  const openSummaryDetail = (type: SummaryDetailType) => {
    if (!analysisData.value) return
    const summary = analysisData.value.summary
    const map: Record<
      SummaryDetailType,
      {
        title: string
        primary: string
        note: string
        items: DetailLine[]
        sourceTable: string
        scope: string
      }
    > = {
      revenue: {
        title: '总收入',
        primary: formatCurrency(summary.totalRevenue),
        note: '收入由当前日期范围内收入明细和经济分析汇总记录聚合。',
        sourceTable: 'revenue-items / economic-analysis',
        scope: `按 ${getAnalysisPeriod()} 内收入记录聚合`,
        items: revenueRecords.value.slice(0, 8).map((row) => ({
          label: `${row.id || '-'} · ${formatDate(row.date)} ${getRevenueCategoryLabel(row.category)}`,
          value: `${row.name} ${formatCurrency(row.amount)}`
        }))
      },
      cost: {
        title: '总成本',
        primary: formatCurrency(summary.totalCost),
        note: '成本由当前日期范围内成本明细和经济分析汇总记录聚合。',
        sourceTable: 'cost-items / economic-analysis',
        scope: `按 ${getAnalysisPeriod()} 内成本记录聚合`,
        items: costRecords.value.slice(0, 8).map((row) => ({
          label: `${row.id || '-'} · ${formatDate(row.date)} ${getCategoryLabel(row.category)}`,
          value: `${row.name} ${formatCurrency(row.amount)}`
        }))
      },
      profit: {
        title: '净利润',
        primary: formatCurrency(summary.netProfit),
        note: '净利润 = 总收入 - 总成本，用于核对生产经营结果。',
        sourceTable: 'cost-items + revenue-items / economic-analysis',
        scope: `按 ${getAnalysisPeriod()} 内收支差额计算`,
        items: [
          { label: '总收入', value: formatCurrency(summary.totalRevenue) },
          { label: '总成本', value: formatCurrency(summary.totalCost) },
          { label: '毛利润', value: formatCurrency(summary.grossProfit) }
        ]
      },
      margin: {
        title: '利润率',
        primary: `${toNumber(summary.profitMargin).toFixed(1)}%`,
        note: '利润率按当前日期范围内净利润与收入计算。',
        sourceTable: 'cost-items + revenue-items / economic-analysis',
        scope: `按 ${getAnalysisPeriod()} 内净利润与收入计算`,
        items: [
          { label: '投资回报率', value: `${toNumber(summary.roi).toFixed(1)}%` },
          { label: '盈亏平衡点', value: formatCurrency(summary.breakEvenPoint) }
        ]
      }
    }
    const selected = map[type]
    openDetailDialog({
      title: selected.title,
      subtitle: '经营概览',
      primary: selected.primary,
      note: selected.note,
      rows: [
        { label: '入库依据', value: '成本明细、收入明细和经营核算记录' },
        { label: '统计口径', value: selected.scope },
        { label: '关联台账', value: selected.sourceTable },
        { label: '分析周期', value: getAnalysisPeriod() },
        { label: '成本记录', value: `${costRecords.value.length} 条` },
        { label: '收入记录', value: `${revenueRecords.value.length} 条` },
        { label: '分析编号', value: String(analysisData.value.id || '-') },
        {
          label: '操作人',
          value: String(analysisData.value.operator || analysisData.value.createdBy || 'admin')
        },
        {
          label: '生成时间',
          value: formatDateTime(analysisData.value.createdAt || new Date().toISOString())
        }
      ],
      items: selected.items
    })
  }

  const openChartDetail = (type: ChartDetailType) => {
    if (!analysisData.value) return
    const map: Record<
      ChartDetailType,
      {
        title: string
        primary: string
        note: string
        items: DetailLine[]
        sourceTable: string
        scope: string
      }
    > = {
      cost: {
        title: '成本构成分析',
        primary: formatCurrency(analysisData.value.summary.totalCost),
        note: '按成本类别拆分，可追溯到成本明细表。',
        sourceTable: 'cost-items / economic-analysis',
        scope: `按 ${getAnalysisPeriod()} 内成本类别汇总`,
        items: breakdownItems(analysisData.value.costBreakdown, getCategoryLabel)
      },
      revenue: {
        title: '收入构成分析',
        primary: formatCurrency(analysisData.value.summary.totalRevenue),
        note: '按收入类别拆分，可追溯到收入明细表。',
        sourceTable: 'revenue-items / economic-analysis',
        scope: `按 ${getAnalysisPeriod()} 内收入类别汇总`,
        items: breakdownItems(analysisData.value.revenueBreakdown, getRevenueCategoryLabel)
      },
      trend: {
        title: '收支趋势分析',
        primary: `${safeTrendRows(analysisData.value.trends?.revenue).length} 天`,
        note: '趋势由收入、成本和利润按日期聚合生成。',
        sourceTable: 'cost-items + revenue-items / economic-analysis',
        scope: `按 ${getAnalysisPeriod()} 内日趋势聚合`,
        items: safeTrendRows(analysisData.value.trends?.profit)
          .slice(0, 10)
          .map((row: any) => ({
            label: String(row.date || '-'),
            value: `利润 ${formatCurrency(toNumber(row.amount))}`
          }))
      }
    }
    const selected = map[type]
    openDetailDialog({
      title: selected.title,
      subtitle: '图表数据',
      primary: selected.primary,
      note: selected.note,
      rows: [
        { label: '入库依据', value: '成本明细、收入明细和经营核算记录' },
        { label: '统计口径', value: selected.scope },
        { label: '关联台账', value: selected.sourceTable },
        { label: '分析周期', value: getAnalysisPeriod() },
        { label: '成本记录', value: `${costRecords.value.length} 条` },
        { label: '收入记录', value: `${revenueRecords.value.length} 条` },
        {
          label: '操作人',
          value: String(analysisData.value.operator || analysisData.value.createdBy || 'admin')
        },
        {
          label: '生成时间',
          value: formatDateTime(analysisData.value.createdAt || new Date().toISOString())
        }
      ],
      items: selected.items
    })
  }

  const openCostRowDetail = (row: CostItem) => {
    openDetailDialog({
      title: row.name,
      subtitle: '成本记录',
      primary: formatCurrency(row.amount),
      note: row.description || '该记录来自成本明细表，可用于生产成本核算。',
      rows: [
        { label: '记录 ID', value: row.id || '-' },
        { label: '日期', value: formatDate(row.date) },
        { label: '类别', value: getCategoryLabel(row.category) },
        { label: '关联牛只', value: row.cowId || '未绑定单牛' },
        { label: '入库依据', value: '成本明细和经营核算记录' },
        { label: '统计口径', value: '按成本明细与当前筛选周期展示' },
        {
          label: '操作人',
          value: String((row as any).operator || (row as any).createdBy || 'admin')
        },
        { label: '创建时间', value: formatDateTime(row.createdAt) },
        { label: '更新时间', value: formatDateTime((row as any).updatedAt) }
      ]
    })
  }

  const openRevenueRowDetail = (row: RevenueItem) => {
    openDetailDialog({
      title: row.name,
      subtitle: '收入记录',
      primary: formatCurrency(row.amount),
      note: row.description || '该记录来自收入明细表，可用于收入与利润核算。',
      rows: [
        { label: '记录 ID', value: row.id || '-' },
        { label: '日期', value: formatDate(row.date) },
        { label: '类别', value: getRevenueCategoryLabel(row.category) },
        {
          label: '数量/单价',
          value: `${row.quantity || 0} x ${formatCurrency(row.unitPrice || 0)}`
        },
        { label: '关联牛只', value: row.cowId || '未绑定单牛' },
        { label: '入库依据', value: '收入明细和经营核算记录' },
        { label: '统计口径', value: '按收入明细与当前筛选周期展示' },
        {
          label: '操作人',
          value: String((row as any).operator || (row as any).createdBy || 'admin')
        },
        { label: '创建时间', value: formatDateTime(row.createdAt) },
        { label: '更新时间', value: formatDateTime((row as any).updatedAt) }
      ]
    })
  }

  const normalizeBreakdown = (value: Record<string, any> = {}) =>
    Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        typeof item === 'number'
          ? { amount: item, percentage: 0, trend: 'stable' }
          : {
              amount: toNumber(item?.amount),
              percentage: toNumber(item?.percentage),
              trend: item?.trend || 'stable'
            }
      ])
    )

  const normalizeAnalysisRow = (row: any) => ({
    ...row,
    summary: {
      totalRevenue: toNumber(row.summary?.totalRevenue),
      totalCost: toNumber(row.summary?.totalCost),
      grossProfit: toNumber(row.summary?.grossProfit ?? row.summary?.netProfit),
      netProfit: toNumber(row.summary?.netProfit),
      profitMargin: toNumber(row.summary?.profitMargin),
      roi: toNumber(row.summary?.roi),
      breakEvenPoint: toNumber(row.summary?.breakEvenPoint)
    },
    costBreakdown: normalizeBreakdown(row.costBreakdown),
    revenueBreakdown: normalizeBreakdown(row.revenueBreakdown),
    trends: {
      revenue: safeTrendRows(row.trends?.revenue),
      costs: safeTrendRows(row.trends?.costs),
      profit: safeTrendRows(row.trends?.profit)
    }
  })

  const normalizeCostRow = (row: any) => ({
    ...row,
    date: row.date ?? row.itemDate ?? row.item_date,
    amount: toNumber(row.amount)
  })

  const normalizeRevenueRow = (row: any) => ({
    ...row,
    date: row.date ?? row.itemDate ?? row.item_date,
    amount: toNumber(row.amount),
    quantity: toNumber(row.quantity),
    unitPrice: toNumber(row.unitPrice ?? row.unit_price)
  })

  const normalizeBudgetRow = (row: any) => ({
    ...row,
    period:
      typeof row.period === 'string'
        ? { startDate: row.period.slice(0, 10), endDate: row.period.slice(-10) }
        : row.period,
    budgetItems: Array.isArray(row.budgetItems) ? row.budgetItems : []
  })

  const getCategoryLabel = (category: string) => {
    const labels = {
      feed: '饲料',
      veterinary: '兽医',
      labor: '人工',
      equipment: '设备',
      utilities: '水电',
      other: '其他'
    }
    return labels[category as keyof typeof labels] || category
  }

  const getRevenueCategoryLabel = (category: string) => {
    const labels = {
      milk_sales: '鲜奶结算',
      cow_sales: '淘汰处置收入',
      calf_sales: '犊牛转出收入',
      manure_sales: '粪肥资源化收入',
      other: '其他'
    }
    return labels[category as keyof typeof labels] || category
  }

  const getCategoryTagType = (category: string): TagType => {
    const types: Record<string, TagType> = {
      feed: 'warning',
      veterinary: 'danger',
      labor: 'info',
      equipment: 'success',
      utilities: 'primary',
      other: 'info'
    }
    return types[category as keyof typeof types] || 'info'
  }

  const getRevenueCategoryTagType = (category: string): TagType => {
    const types: Record<string, TagType> = {
      milk_sales: 'success',
      cow_sales: 'primary',
      calf_sales: 'warning',
      manure_sales: 'info',
      other: 'info'
    }
    return types[category as keyof typeof types] || 'info'
  }

  const getStatusLabel = (status: string) => {
    const labels = {
      draft: '草稿',
      approved: '已批准',
      active: '进行中',
      completed: '已完成'
    }
    return labels[status as keyof typeof labels] || status
  }

  const getStatusTagType = (status: string): TagType => {
    const types: Record<string, TagType> = {
      draft: 'info',
      approved: 'warning',
      active: 'success',
      completed: 'info'
    }
    return types[status as keyof typeof types] || 'info'
  }

  // 事件处理
  const handleDateRangeChange = () => {
    loadAnalysisData()
    if (activeTab.value === 'costs') {
      loadCostRecords()
    } else if (activeTab.value === 'revenue') {
      loadRevenueRecords()
    }
  }

  const handleTabClick = (tab: any) => {
    if (tab.props.name === 'costs') {
      loadCostRecords()
    } else if (tab.props.name === 'revenue') {
      loadRevenueRecords()
    } else if (tab.props.name === 'budget') {
      loadBudgetPlans()
    }
  }

  const showCostDialog = () => {
    costDialogVisible.value = true
  }

  const showRevenueDialog = () => {
    revenueDialogVisible.value = true
  }

  const showBudgetDialog = () => {
    activeTab.value = 'budget'
    void loadBudgetPlans()
    ElMessage.success('已切换到预算管理，当前生产预算来自预算台账')
  }

  const resetCostForm = () => {
    costForm.date = ''
    costForm.category = 'feed'
    costForm.name = ''
    costForm.amount = 0
    costForm.unit = '元'
    costForm.description = ''
  }

  const resetRevenueForm = () => {
    revenueForm.date = ''
    revenueForm.category = 'milk_sales'
    revenueForm.name = ''
    revenueForm.unit = '元'
    revenueForm.quantity = 0
    revenueForm.unitPrice = 0
    revenueForm.description = ''
  }

  const handleCreateCost = async () => {
    if (!costFormRef.value) return

    await costFormRef.value.validate(async (valid: boolean) => {
      if (!valid) return

      creating.value = true
      try {
        const response = await economicApi.createCostRecord(costForm)
        if (response.code === 200) {
          ElMessage.success('添加成功')
          costDialogVisible.value = false
          loadCostRecords()
          resetCostForm()
        }
      } catch (error) {
        ElMessage.error('添加失败')
        ElMessage.error('创建成本记录失败')
      } finally {
        creating.value = false
      }
    })
  }

  const handleCreateRevenue = async () => {
    if (!revenueFormRef.value) return

    await revenueFormRef.value.validate(async (valid: boolean) => {
      if (!valid) return

      creating.value = true
      try {
        // 计算总金额
        const totalAmount = revenueForm.quantity * revenueForm.unitPrice
        const record = { ...revenueForm, amount: totalAmount }

        const response = await economicApi.createRevenueRecord(record)
        if (response.code === 200) {
          ElMessage.success('添加成功')
          revenueDialogVisible.value = false
          loadRevenueRecords()
          resetRevenueForm()
        }
      } catch (error) {
        ElMessage.error('添加失败')
        ElMessage.error('创建收入记录失败')
      } finally {
        creating.value = false
      }
    })
  }

  const deleteCostRecord = async (record: CostItem) => {
    try {
      await ElMessageBox.confirm('确定删除这条成本记录吗？', '提示', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      })

      const response = await economicApi.deleteCostRecord(record.id)
      if (response.code === 200) {
        ElMessage.success('删除成功')
        loadCostRecords()
      }
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error('删除失败')
        ElMessage.error('删除成本记录失败')
      }
    }
  }

  const deleteRevenueRecord = async (record: RevenueItem) => {
    try {
      await ElMessageBox.confirm('确定删除这条收入记录吗？', '提示', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      })

      const response = await economicApi.deleteRevenueRecord(record.id)
      if (response.code === 200) {
        ElMessage.success('删除成功')
        loadRevenueRecords()
      }
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error('删除失败')
        ElMessage.error('删除收入记录失败')
      }
    }
  }

  const deleteBudgetPlan = async (plan: BudgetPlan) => {
    try {
      await ElMessageBox.confirm('确定删除这个预算计划吗？', '提示', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      })

      const response = await economicApi.deleteBudgetPlan(plan.id)
      if (response.code === 200) {
        ElMessage.success('删除成功')
        loadBudgetPlans()
      }
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error('删除失败')
        ElMessage.error('删除预算计划失败')
      }
    }
  }

  const openBudgetDetail = (plan: BudgetPlan) => {
    const items = Array.isArray(plan.budgetItems) ? plan.budgetItems : []
    openDetailDialog({
      title: plan.name,
      subtitle: '预算计划',
      primary: formatCurrency(plan.totalPlanned),
      note: '预算计划详情可追踪预算项、执行偏差和创建人，便于核对生产预算。',
      rows: [
        { label: '预算 ID', value: plan.id || '-' },
        {
          label: '预算周期',
          value: `${formatDate(plan.period?.startDate)} - ${formatDate(plan.period?.endDate)}`
        },
        { label: '入库依据', value: '预算计划和预算项记录' },
        { label: '统计口径', value: '按预算周期与预算项执行偏差汇总' },
        { label: '创建人', value: plan.createdBy || '-' },
        { label: '创建时间', value: formatDateTime(plan.createdAt) },
        { label: '更新时间', value: formatDateTime(plan.updatedAt) },
        { label: '状态', value: getStatusLabel(plan.status) },
        { label: '预算项数', value: `${items.length} 项` }
      ],
      items: items.map((item) => {
        const variance =
          item.variance ?? toNumber(item.actualAmount || 0) - toNumber(item.plannedAmount)
        const variancePercent =
          item.variancePercent !== undefined ? `${toNumber(item.variancePercent).toFixed(1)}%` : '-'
        return {
          label: getCategoryLabel(item.category),
          value: `计划 ${formatCurrency(item.plannedAmount)} / 实际 ${formatCurrency(item.actualAmount || 0)} / 偏差 ${formatCurrency(variance)}${variancePercent !== '-' ? ` (${variancePercent})` : ''}`
        }
      })
    })
  }

  const generateReport = async () => {
    if (!dateRange.value || dateRange.value.length !== 2) return

    try {
      const [startDate, endDate] = dateRange.value
      const response = await economicApi.generateProfitabilityReport({
        startDate,
        endDate,
        title: `平台盈利能力分析报告 (${startDate} 至 ${endDate})`
      })

      if (response.code === 200) {
        ElMessage.success('报告生成成功')
        const report = response.data as any
        ElMessageBox.alert(
          `收入：${formatCurrency(report.totalRevenue || report.summary?.totalRevenue || 0)}
成本：${formatCurrency(report.totalCost || report.summary?.totalCosts || 0)}
利润：${formatCurrency(report.totalProfit || report.summary?.netProfit || 0)}
利润率：${toNumber(report.profitMargin || report.summary?.grossMargin).toFixed(1)}%`,
          report.title || '盈利能力报告',
          { confirmButtonText: '知道了' }
        )
      }
    } catch (error) {
      ElMessage.error('生成报告失败')
      ElMessage.error('生成报表失败')
    }
  }

  // 生命周期
  onMounted(() => {
    loadAnalysisData()
    loadCostRecords()
  })
</script>

<style scoped lang="scss">
  .economic-analysis {
    padding: 18px;
    color: #0f172a;
  }

  .analysis-header {
    margin-bottom: 16px;
  }

  .analysis-head-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .analysis-title-group,
  .analysis-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .analysis-title-group h1 {
    margin: 2px 0 0;
    font-size: 22px;
    line-height: 1.25;
    font-weight: 650;
    color: #0f172a;
  }

  .overview-cards {
    margin-bottom: 16px;

    .overview-card {
      background: white;
      border: 1px solid #d8e0ea;
      border-radius: 8px;
      padding: 14px;
      cursor: pointer;
      transition:
        background-color 0.16s ease,
        border-color 0.16s ease;

      &:hover,
      &:focus-visible {
        border-color: #0f766e;
        background: #f8fafc;
        outline: none;
      }

      .card-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;

        .card-icon {
          font-size: 21px;

          &.revenue {
            color: #60c041;
          }

          &.cost {
            color: #f56c6c;
          }

          &.profit {
            color: #00a6a6;
          }

          &.margin {
            color: #e6a23c;
          }
        }

        .card-title {
          font-size: 14px;
          color: #6b7280;
          font-weight: 500;
        }
      }

      .card-value {
        font-size: 23px;
        font-weight: 680;
        color: #1f2937;
        margin-bottom: 8px;
      }

      .card-change {
        display: flex;
        align-items: center;
        gap: 4px;

        .change-icon {
          font-size: 16px;

          &.up {
            color: #60c041;
          }

          &.down {
            color: #f56c6c;
          }

          &.neutral {
            color: #64748b;
          }
        }

        .change-text {
          font-size: 14px;
          font-weight: 500;

          .up & {
            color: #60c041;
          }

          .down & {
            color: #f56c6c;
          }
        }
      }
    }
  }

  .charts-section {
    margin-bottom: 16px;

    .chart-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 14px;
    }

    .chart-wide {
      grid-column: 1 / -1;
    }

    .chart-card {
      background: white;
      border: 1px solid #d8e0ea;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      transition:
        background-color 0.16s ease,
        border-color 0.16s ease;

      &:hover,
      &:focus-visible {
        border-color: #0f766e;
        outline: none;
      }

      .chart-header {
        padding: 12px 14px;
        border-bottom: 1px solid #e2e8f0;
        background: #f8fafc;

        .chart-title {
          font-size: 16px;
          font-weight: 650;
          color: #1f2937;
          margin: 0;
        }
      }

      .chart-container {
        width: 100%;
        height: 300px;
        padding: 14px;
      }
    }
  }

  .data-tables-section {
    min-width: 0;

    .table-header {
      .table-title {
        margin: 0;
        font-size: 16px;
        font-weight: 650;
        color: #1f2937;
      }
    }

    .table-shell {
      min-width: 0;
      overflow: auto;
      border: 1px solid #d8e0ea;
      border-radius: 8px;
      background: #fff;
    }

    :deep(.el-table__body tr) {
      cursor: pointer;
      transition: background-color 0.18s;
    }

    :deep(.el-table__body tr:hover) {
      background-color: #f8fafc;
    }
  }

  // 暗色主题
  .dark {
    .overview-card {
      background: #1f2937;
      border: 1px solid #374151;

      .card-title {
        color: #9ca3af;
      }

      .card-value {
        color: #f9fafb;
      }
    }

    .chart-card {
      background: #1f2937;
      border: 1px solid #374151;

      .chart-header {
        background: #111827;
        border-bottom-color: #374151;
      }

      .chart-title {
        color: #f9fafb;
      }
    }

    .table-title {
      color: #f9fafb;
    }
  }

  @media (max-width: 640px) {
    .economic-analysis {
      padding: 12px;
    }

    .analysis-title-group,
    .analysis-actions,
    .analysis-title-group :deep(.el-date-editor) {
      width: 100%;
    }
  }
</style>
