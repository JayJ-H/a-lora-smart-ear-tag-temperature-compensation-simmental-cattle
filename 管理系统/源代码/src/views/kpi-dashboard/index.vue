<template>
  <div class="kpi-dashboard fluent-page">
    <!-- 头部工具栏 -->
    <div class="dashboard-header fluent-page-header">
      <div class="dashboard-head-row">
        <div class="dashboard-title-group">
          <div>
            <h1>生产经营指标看板</h1>
          </div>
          <ElSelect
            v-model="selectedDashboard"
            placeholder="选择评估看板"
            class="w-64"
            @change="handleDashboardChange"
          >
            <ElOption
              v-for="dashboard in dashboards"
              :key="dashboard.id"
              :label="dashboard.name"
              :value="dashboard.id"
            />
          </ElSelect>
        </div>
        <div class="dashboard-actions">
          <ElButton type="primary" @click="refreshData">
            <ArtSvgIcon icon="ri:refresh-line" class="mr-2" />
            刷新数据
          </ElButton>
          <ElButton @click="openCreateDashboardDialog">
            <ArtSvgIcon icon="ri:add-line" class="mr-2" />
            新建评估看板
          </ElButton>
        </div>
      </div>
    </div>

    <!-- 评估看板网格 -->
    <div
      v-if="dashboardData && dashboardData.dashboard"
      class="dashboard-grid"
      :style="{ gridTemplateColumns: `repeat(${dashboardData.dashboard.layout.columns}, 1fr)` }"
    >
      <div
        v-for="widget in dashboardData.dashboard.layout.widgets"
        :key="widget.id"
        class="dashboard-widget"
        :class="`col-span-${widget.position.width} row-span-${widget.position.height}`"
        :style="{
          gridColumn: `span ${widget.position.width}`,
          gridRow: `span ${widget.position.height}`
        }"
        role="button"
        tabindex="0"
        @click="openWidgetDetail(widget.id)"
        @keydown.enter.prevent="openWidgetDetail(widget.id)"
        @keydown.space.prevent="openWidgetDetail(widget.id)"
      >
        <KPIWidget
          :widget="widget"
          :data="dashboardData.widgetsData[widget.id]"
          @refresh="refreshWidget(widget.id)"
        />
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <ArtSvgIcon icon="ri:dashboard-line" class="text-6xl text-gray-400 mb-4" />
      <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">暂无生产经营指标数据</h3>
      <ElButton type="primary" @click="openCreateDashboardDialog"> 创建评估看板 </ElButton>
    </div>

    <!-- 新建评估看板对话框 -->
    <ElDialog
      v-model="createDashboardDialogVisible"
      title="新建评估看板"
      width="600px"
      @close="resetCreateForm"
    >
      <ElForm ref="createFormRef" :model="createForm" :rules="createFormRules" label-width="100px">
        <ElFormItem label="看板名称" prop="name">
          <ElInput v-model="createForm.name" placeholder="请输入育种评估看板名称" />
        </ElFormItem>
        <ElFormItem label="描述" prop="description">
          <ElInput
            v-model="createForm.description"
            type="textarea"
            placeholder="请输入评估看板描述"
            :rows="3"
          />
        </ElFormItem>
        <ElFormItem label="分类" prop="category">
          <ElSelect v-model="createForm.category" placeholder="选择分类">
            <ElOption label="育种总览" value="overview" />
            <ElOption label="泌乳性状" value="生产配置" />
            <ElOption label="繁殖评估" value="reproduction" />
            <ElOption label="健康监测" value="health" />
            <ElOption label="组学分析" value="economic" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="公开" prop="isPublic">
          <ElSwitch v-model="createForm.isPublic" />
        </ElFormItem>
      </ElForm>

      <template #footer>
        <ElButton @click="createDashboardDialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="handleCreateDashboard" :loading="creating">
          创建
        </ElButton>
      </template>
    </ElDialog>

    <ElDialog v-model="widgetDetailVisible" :title="widgetDetail.title" width="760px">
      <div class="widget-detail">
        <div class="detail-summary">
          <span>{{ widgetDetail.subtitle }}</span>
          <strong>{{ widgetDetail.primary }}</strong>
        </div>
        <div class="detail-grid">
          <div v-for="row in widgetDetail.rows" :key="row.label" class="detail-row">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
        <div class="detail-table" v-if="widgetDetail.items.length">
          <div v-for="item in widgetDetail.items" :key="item.label" class="detail-item">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
        <div class="detail-note">{{ widgetDetail.note }}</div>
      </div>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, onMounted } from 'vue'
  import { ElMessage } from 'element-plus'
  import KPIWidget from './components/KPIWidget.vue'
  import * as databaseService from '@/services/数据库'
  import type { KPIDashboard, KPIDashboardData } from '@/types/cow'
  type DetailLine = { label: string; value: string }

  // 响应式数据
  const selectedDashboard = ref('')
  const dashboards = ref<KPIDashboard[]>([])
  const dashboardData = ref<KPIDashboardData | null>(null)
  const createDashboardDialogVisible = ref(false)
  const widgetDetailVisible = ref(false)
  const creating = ref(false)
  const widgetDetail = reactive({
    title: '组件详情',
    subtitle: '',
    primary: '',
    note: '',
    rows: [] as DetailLine[],
    items: [] as DetailLine[]
  })

  // 创建表单
  const createFormRef = ref()
  const createForm = reactive({
    name: '',
    description: '',
    category: 'overview' as const,
    isPublic: true
  })

  // 表单验证规则
  const createFormRules = {
    name: [{ required: true, message: '请输入看板名称', trigger: 'blur' }],
    description: [{ required: true, message: '请输入描述', trigger: 'blur' }],
    category: [{ required: true, message: '请选择分类', trigger: 'change' }]
  }

  // 获取仪表板列表
  const loadDashboards = async () => {
    try {
      const dashboardList = await databaseService.getTableDataAsync('kpi-dashboards')
      dashboards.value = dashboardList
      if (dashboardList.length > 0 && !selectedDashboard.value) {
        selectedDashboard.value = dashboardList[0].id
        await loadDashboardData()
      }
    } catch (error) {
      ElMessage.error('获取评估看板列表失败')
      console.error('Load dashboards error:', error)
    }
  }

  // 获取仪表板数据
  const loadDashboardData = async () => {
    if (!selectedDashboard.value) return

    try {
      const dataList = await databaseService.getTableDataAsync('kpi-dashboard-data')
      const selectedData = dataList.find(
        (data: any) => data.dashboardId === selectedDashboard.value
      )
      dashboardData.value = selectedData || null
    } catch (error) {
      ElMessage.error('获取评估看板数据失败')
      console.error('Load dashboard data error:', error)
    }
  }

  // 刷新数据
  const refreshData = () => {
    void loadDashboardData()
  }

  // 刷新单个组件
  const refreshWidget = (_widgetId: string) => {
    void loadDashboardData()
  }

  const formatMetricValue = (value: unknown) => {
    const numberValue = Number(value)
    if (!Number.isFinite(numberValue)) return String(value ?? '--')
    if (numberValue >= 1000000) return `${(numberValue / 1000000).toFixed(1)}M`
    if (numberValue >= 1000) return `${(numberValue / 1000).toFixed(1)}K`
    if (numberValue % 1 !== 0) return numberValue.toFixed(2)
    return numberValue.toString()
  }

  const openWidgetDetail = (widgetId: string) => {
    if (!dashboardData.value) return
    const widget = dashboardData.value.dashboard.layout.widgets.find((item) => item.id === widgetId)
    const data = dashboardData.value.widgetsData[widgetId]
    if (!widget || !data) return

    const rows: DetailLine[] = [
      { label: '组件类型', value: widget.type },
      {
        label: '布局位置',
        value: `(${widget.position.x}, ${widget.position.y}) / ${widget.position.width}x${widget.position.height}`
      },
      { label: '更新时间', value: data.lastUpdated || '-' },
      { label: '入库依据', value: widget.config.dataSource || '看板业务数据' },
      {
        label: '操作人',
        value: String((data.data as any)?.operator || (data.data as any)?.createdBy || 'admin')
      }
    ]

    const items: DetailLine[] = []
    let primary = '--'
    let note = '当前组件支持点击查看数据详情。'

    if (data.type === 'metric') {
      primary = formatMetricValue(data.data?.currentValue)
      items.push(
        { label: '指标值', value: formatMetricValue(data.data?.currentValue) },
        { label: '目标值', value: formatMetricValue(data.data?.metric?.targetValue) },
        { label: '预警阈值', value: formatMetricValue(data.data?.metric?.warningThreshold) },
        { label: '状态', value: String(data.data?.status || '--') }
      )
      note = '指标卡可追溯到单项 KPI 数据。'
    } else if (data.type === 'chart') {
      const points = Array.isArray(data.data?.data) ? data.data.data : []
      primary = `${points.length} 个点`
      items.push(
        { label: '图表类型', value: widget.config.chartType || 'unknown' },
        { label: '数据点数', value: `${points.length} 个` },
        {
          label: '最新值',
          value: points.length ? formatMetricValue(points[points.length - 1]?.value) : '--'
        }
      )
      note = '图表数据来自当前看板数据集，可继续刷新。'
    } else if (data.type === 'table') {
      const rowsData = Array.isArray(data.data) ? data.data : []
      primary = `${rowsData.length} 行`
      items.push(
        { label: '列定义', value: (widget.config.columns || []).join('、') || '默认列' },
        { label: '记录数', value: `${rowsData.length} 行` },
        { label: '关联台账', value: widget.config.dataSource || '看板业务数据' }
      )
      note = '表格组件可继续下钻到具体记录。'
    } else if (data.type === 'alert') {
      primary = `${data.data?.alertsCount || 0} 条`
      items.push({ label: '预警数', value: `${data.data?.alertsCount || 0} 条` })
      note = '预警组件用于生产异常、健康和设备异常追踪。'
    } else {
      primary = widget.title
    }

    widgetDetail.title = widget.title
    widgetDetail.subtitle = widget.type
    widgetDetail.primary = primary
    widgetDetail.note = note
    widgetDetail.rows = rows
    widgetDetail.items = items
    widgetDetailVisible.value = true
  }

  // 仪表板切换
  const handleDashboardChange = () => {
    void loadDashboardData()
  }

  // 打开创建仪表板对话框
  const openCreateDashboardDialog = () => {
    createDashboardDialogVisible.value = true
  }

  // 重置创建表单
  const resetCreateForm = () => {
    createForm.name = ''
    createForm.description = ''
    createForm.category = 'overview'
    createForm.isPublic = true
  }

  // 创建仪表板
  const handleCreateDashboard = async () => {
    if (!createFormRef.value) return

    await createFormRef.value.validate(async (valid: boolean) => {
      if (!valid) return

      creating.value = true
      try {
        // 创建新的生产经营指标看板
        const newDashboard = {
          ...createForm,
          id: `kpi_dashboard_${Date.now()}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          layout: {
            columns: 4,
            widgets: []
          },
          isActive: true
        }

        // 保存到数据库
        await databaseService.addTableDataAsync('kpi-dashboards', newDashboard)

        ElMessage.success('评估看板创建成功')
        createDashboardDialogVisible.value = false
        await loadDashboards()
        resetCreateForm()
      } catch (error) {
        ElMessage.error('创建失败')
        console.error('Create dashboard error:', error)
      } finally {
        creating.value = false
      }
    })
  }

  // 生命周期
  onMounted(() => {
    void loadDashboards()
  })
</script>

<style scoped lang="scss">
  .kpi-dashboard {
    padding: 18px;
  }

  .dashboard-header {
    margin-bottom: 16px;
    padding: 14px;
    border: 1px solid var(--fluent-border);
    border-radius: 8px;
    background: var(--fluent-surface);
    box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
  }

  .dashboard-head-row,
  .dashboard-title-group,
  .dashboard-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .dashboard-head-row {
    justify-content: space-between;
  }

  .dashboard-title-group h1 {
    margin: 2px 0 0;
    font-size: 22px;
    line-height: 1.25;
    font-weight: 650;
    color: var(--fluent-text);
  }

  .dashboard-grid {
    display: grid;
    gap: 14px;
    grid-auto-rows: minmax(184px, auto);
  }

  .dashboard-widget {
    background: var(--fluent-surface);
    border: 1px solid var(--fluent-border);
    border-radius: 8px;
    box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
    overflow: hidden;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    cursor: pointer;
    transition:
      border-color 180ms ease,
      background-color 180ms ease;
  }

  .dashboard-widget:hover,
  .dashboard-widget:focus-visible {
    border-color: #0f766e;
    background: var(--fluent-surface-muted);
    outline: none;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    text-align: center;
  }

  .dark .dashboard-widget {
    background: var(--fluent-surface);
    border: 1px solid var(--fluent-border);
  }

  .dark .dashboard-header {
    border-color: var(--fluent-border);
  }

  .widget-detail {
    display: grid;
    gap: 14px;
  }

  .detail-summary {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding: 16px;
    background: var(--fluent-surface-muted);
    border: 1px solid var(--fluent-border);
    border-radius: 8px;

    span {
      color: var(--fluent-text-soft);
      font-size: 13px;
      font-weight: 720;
    }

    strong {
      color: var(--fluent-text);
      font-size: clamp(22px, 2vw, 26px);
      line-height: 1;
    }
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .detail-row,
  .detail-item {
    display: grid;
    gap: 6px;
    padding: 12px;
    background: var(--fluent-surface-muted);
    border: 1px solid var(--fluent-border);
    border-radius: 8px;

    span {
      color: var(--fluent-text-soft);
      font-size: 12px;
    }

    strong {
      color: var(--fluent-text);
      font-size: 14px;
      line-height: 1.45;
    }
  }

  .detail-table {
    display: grid;
    gap: 10px;
  }

  .detail-note {
    padding: 12px;
    color: var(--fluent-text-soft);
    line-height: 1.55;
    background: var(--fluent-surface-subtle);
    border: 1px solid var(--fluent-border);
    border-radius: 8px;
  }

  @media (max-width: 720px) {
    .kpi-dashboard {
      padding: 12px;
    }

    .dashboard-title-group,
    .dashboard-actions,
    .dashboard-title-group :deep(.el-select) {
      width: 100%;
    }
  }
</style>
