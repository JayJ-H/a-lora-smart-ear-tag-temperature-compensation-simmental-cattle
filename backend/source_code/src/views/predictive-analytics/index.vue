<template>
  <FcPageShell
    title="预测模型运维"
    status-label="模型状态"
    :status-value="modelStatusText"
    :primary-action-label="primaryActionLabel"
    primary-action-icon="ri:sparkling-line"
    secondary-action-label="刷新模型"
    secondary-action-icon="ri:refresh-line"
    @primary-action="handlePrimaryAction"
    @secondary-action="refreshData"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          label="预测模型"
          :value="models.length"
          note="覆盖生产、健康、经营和繁殖"
          icon="ri:brain-line"
        />
        <FcMetricTile
          label="可用模型"
          :value="readyModelCount"
          note="可直接生成业务预测"
          icon="ri:checkbox-circle-line"
          tone="teal"
        />
        <FcMetricTile
          label="平均准确率"
          :value="averageAccuracyText"
          note="按当前模型性能汇总"
          icon="ri:line-chart-line"
          tone="warning"
        />
        <FcMetricTile
          label="活跃预警"
          :value="activeAlertCount"
          note="需要运营人员持续跟进"
          icon="ri:alarm-warning-line"
          tone="danger"
        />
      </section>
    </template>

    <section class="predictive-flow-layout">
      <FcPanel title="建模门槛流水线">
        <div class="model-pipeline">
          <article
            v-for="(item, index) in modelPipeline"
            :key="item.label"
            class="pipeline-step"
            :class="item.tone"
          >
            <div class="pipeline-index">{{ index + 1 }}</div>
            <div class="pipeline-body">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
            <ArtSvgIcon :icon="item.icon" />
          </article>
        </div>
      </FcPanel>

      <FcPanel title="下一步决策">
        <div v-if="decisionQueue.length" class="decision-queue">
          <article
            v-for="item in decisionQueue"
            :key="item.id"
            class="decision-item"
            :class="item.tone"
          >
            <div>
              <span>{{ item.kind }}</span>
              <h3>{{ item.title }}</h3>
              <p>{{ item.description }}</p>
            </div>
            <ElTag :type="item.tagType">{{ item.level }}</ElTag>
          </article>
        </div>
        <FcEmptyState
          v-else
          icon="ri:checkbox-circle-line"
          title="当前没有预测处置项"
          description="暂无预测处置项。"
        />
      </FcPanel>
    </section>

    <section class="predictive-layout is-wide">
      <FcPanel title="预测结果趋势">
        <template #actions>
          <ElSelect v-model="selectedModel" clearable placeholder="选择模型" class="model-select">
            <ElOption label="全部模型" value="" />
            <ElOption
              v-for="model in models"
              :key="model.id"
              :label="model.name"
              :value="model.id"
            />
          </ElSelect>
        </template>
        <div class="chart-shell">
          <div ref="predictionsChartRef" class="chart-container"></div>
          <FcEmptyState
            v-if="!displayPredictions.length"
            icon="ri:line-chart-line"
            title="暂无预测曲线"
            description="暂无预测结果。"
          />
        </div>
      </FcPanel>

      <FcPanel title="模型操作">
        <div class="action-stack">
          <button type="button" @click="createModelDialogVisible = true">
            <ArtSvgIcon icon="ri:add-line" />
            <span>创建模型</span>
          </button>
          <button type="button" @click="createScenarioDialogVisible = true">
            <ArtSvgIcon icon="ri:route-line" />
            <span>创建场景</span>
          </button>
          <button type="button" @click="handlePrimaryAction">
            <ArtSvgIcon icon="ri:sparkling-line" />
            <span>{{ primaryActionLabel }}</span>
          </button>
        </div>
      </FcPanel>
    </section>

    <section class="predictive-layout is-models">
      <FcPanel title="模型资产">
        <div
          v-if="models.length"
          ref="modelGridContainerRef"
          class="model-grid-scroll"
          @scroll.passive="onModelGridScroll"
          @wheel.passive="onModelGridWheel"
        >
          <div class="model-grid">
            <article
              v-for="model in visibleModels"
              :key="model.id"
              class="model-card"
              :class="model.status"
            >
              <div class="model-card-top">
                <div>
                  <span
                    >{{ getModelTypeLabel(model.type) }} ·
                    {{ getAlgorithmLabel(model.algorithm) }}</span
                  >
                  <h3>{{ model.name }}</h3>
                  <p>{{ model.description }}</p>
                </div>
                <ElTag :type="getModelStatusTagType(model.status)">{{
                  getModelStatusLabel(model.status)
                }}</ElTag>
              </div>

              <div class="score-grid">
                <div
                  ><span>准确率</span
                  ><strong>{{ formatPercent(model.performance.accuracy) }}</strong></div
                >
                <div
                  ><span>F1</span
                  ><strong>{{ formatPercent(model.performance.f1Score) }}</strong></div
                >
                <div
                  ><span>目标变量</span><strong>{{ model.targetVariable }}</strong></div
                >
              </div>

              <div class="model-actions">
                <ElButton size="small" @click="trainModel(model)">训练</ElButton>
                <ElButton size="small" type="danger" @click="deleteModel(model)">删除</ElButton>
              </div>
            </article>
          </div>
          <div class="load-more-row">
            <span>
              当前窗口 {{ modelStartIndex + 1 }}-{{ modelEndIndex }} / {{ modelTotalCount }} 个模型
            </span>
          </div>
        </div>
        <FcEmptyState
          v-else
          icon="ri:brain-line"
          title="暂无预测模型"
          description="暂无模型资产。"
          action-label="创建模型"
          @action="createModelDialogVisible = true"
        />
      </FcPanel>

      <div class="side-stack">
        <FcPanel title="场景推演" dense>
          <div class="scenario-list">
            <article v-for="scenario in scenarios.slice(0, 5)" :key="scenario.id">
              <div>
                <span>{{ scenario.timeHorizon }} 天 · {{ formatDate(scenario.createdAt) }}</span>
                <strong>{{ scenario.name }}</strong>
                <p>{{ scenario.description }}</p>
              </div>
              <ElTag :type="getRiskLevelTagType(scenario.riskLevel)">
                {{ getRiskLevelLabel(scenario.riskLevel) }}
              </ElTag>
            </article>
            <FcEmptyState
              v-if="!scenarios.length"
              icon="ri:route-line"
              title="暂无场景"
              description="暂无场景记录。"
            />
          </div>
        </FcPanel>

        <FcPanel title="预测预警" dense>
          <div class="alert-filter">
            <ElSelect v-model="alertFilter.severity" clearable placeholder="级别">
              <ElOption label="低" value="low" />
              <ElOption label="中" value="medium" />
              <ElOption label="高" value="high" />
              <ElOption label="紧急" value="critical" />
            </ElSelect>
            <ElSelect v-model="alertFilter.status" clearable placeholder="状态">
              <ElOption label="活跃" value="active" />
              <ElOption label="已确认" value="acknowledged" />
              <ElOption label="已解决" value="resolved" />
            </ElSelect>
          </div>
          <div class="predictive-alert-list">
            <article
              v-for="item in filteredAlerts.slice(0, 5)"
              :key="item.id"
              class="predictive-alert"
              :class="item.severity"
            >
              <div>
                <span
                  >{{ formatDate(item.predictedDate) }} · 概率
                  {{ formatPercent(item.probability) }}</span
                >
                <strong>{{ item.title }}</strong>
                <p>{{ item.description }}</p>
              </div>
              <div class="alert-actions">
                <ElTag :type="getSeverityTagType(item.severity)">{{
                  getSeverityLabel(item.severity)
                }}</ElTag>
                <ElButton
                  v-if="item.status === 'active'"
                  size="small"
                  type="warning"
                  @click="acknowledgeAlert(item)"
                  >确认</ElButton
                >
                <ElButton
                  v-if="item.status === 'acknowledged'"
                  size="small"
                  type="success"
                  @click="resolveAlert(item)"
                  >解决</ElButton
                >
              </div>
            </article>
            <FcEmptyState
              v-if="!filteredAlerts.length"
              icon="ri:shield-check-line"
              title="没有匹配预警"
              description="当前筛选无结果。"
            />
          </div>
        </FcPanel>
      </div>
    </section>

    <FcDataTableShell title="预测明细">
      <ElTable
        :data="visiblePredictions"
        v-loading="loading"
        height="360"
        @wheel.passive="onPredictionTableWheel"
      >
        <ElTableColumn prop="targetDate" label="目标日期" width="120" />
        <ElTableColumn label="模型" min-width="170">
          <template #default="{ row }">{{ getModelName(row.modelId) }}</template>
        </ElTableColumn>
        <ElTableColumn label="预测值" width="120">
          <template #default="{ row }">{{ formatPredictionValue(row) }}</template>
        </ElTableColumn>
        <ElTableColumn label="置信区间" min-width="180">
          <template #default="{ row }">
            {{ row.confidenceInterval.lower.toFixed(2) }} -
            {{ row.confidenceInterval.upper.toFixed(2) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="准确率" width="100">
          <template #default="{ row }">{{
            row.accuracy !== undefined ? formatPercent(row.accuracy) : '-'
          }}</template>
        </ElTableColumn>
        <ElTableColumn label="生成时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.generatedAt) }}</template>
        </ElTableColumn>
      </ElTable>
    </FcDataTableShell>

    <ElDialog
      v-model="createModelDialogVisible"
      title="创建预测模型"
      width="620px"
      @close="resetCreateModelForm"
    >
      <ElForm
        ref="createModelFormRef"
        :model="createModelForm"
        :rules="createModelFormRules"
        label-width="110px"
      >
        <ElFormItem label="模型名称" prop="name">
          <ElInput v-model="createModelForm.name" placeholder="例如：产奶量 7 日预测" />
        </ElFormItem>
        <ElFormItem label="说明" prop="description">
          <ElInput v-model="createModelForm.description" type="textarea" :rows="3" />
        </ElFormItem>
        <ElFormItem label="类型" prop="type">
          <ElSelect v-model="createModelForm.type" class="w-full">
            <ElOption label="生产" value="production" />
            <ElOption label="健康" value="health" />
            <ElOption label="经营" value="economic" />
            <ElOption label="繁殖" value="reproduction" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="算法" prop="algorithm">
          <ElSelect v-model="createModelForm.algorithm" class="w-full">
            <ElOption label="线性回归" value="linear_regression" />
            <ElOption label="随机森林" value="random_forest" />
            <ElOption label="神经网络" value="neural_network" />
            <ElOption label="时间序列" value="time_series" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="目标变量" prop="targetVariable">
          <ElInput v-model="createModelForm.targetVariable" placeholder="例如：milk_yield" />
        </ElFormItem>
      </ElForm>

      <template #footer>
        <ElButton @click="createModelDialogVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="creating" @click="handleCreateModel">创建</ElButton>
      </template>
    </ElDialog>

    <ElDialog
      v-model="createScenarioDialogVisible"
      title="创建预测场景"
      width="620px"
      @close="resetCreateScenarioForm"
    >
      <ElForm
        ref="createScenarioFormRef"
        :model="createScenarioForm"
        :rules="createScenarioFormRules"
        label-width="110px"
      >
        <ElFormItem label="场景名称" prop="name">
          <ElInput v-model="createScenarioForm.name" placeholder="例如：饲料价格上涨 5%" />
        </ElFormItem>
        <ElFormItem label="说明" prop="description">
          <ElInput v-model="createScenarioForm.description" type="textarea" :rows="3" />
        </ElFormItem>
        <ElFormItem label="预测天数" prop="timeHorizon">
          <ElInputNumber
            v-model="createScenarioForm.timeHorizon"
            :min="1"
            :max="365"
            controls-position="right"
          />
        </ElFormItem>
        <ElFormItem label="风险级别" prop="riskLevel">
          <ElSelect v-model="createScenarioForm.riskLevel" class="w-full">
            <ElOption label="低" value="low" />
            <ElOption label="中" value="medium" />
            <ElOption label="高" value="high" />
          </ElSelect>
        </ElFormItem>
      </ElForm>

      <template #footer>
        <ElButton @click="createScenarioDialogVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="creating" @click="handleCreateScenario">创建</ElButton>
      </template>
    </ElDialog>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import type { FormInstance, FormRules } from 'element-plus'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import FcEmptyState from '@/components/business/fluent-console/FcEmptyState.vue'
  import FcDataTableShell from '@/components/business/fluent-console/FcDataTableShell.vue'
  import { predictiveApi } from '@/api/cow'
  import { useEChartsManager, useLazyGridRenderWindow, useLazyRenderWindow } from '@/hooks'
  import { loadPlatformSnapshot } from '@/views/breeding-platform/platform-data'
  import { formatDateOnly } from '@/utils/date-display'
  import type {
    ForecastScenario,
    PredictionResult,
    PredictiveAlert,
    PredictiveModel
  } from '@/types/cow'

  defineOptions({ name: 'PredictiveAnalytics' })

  type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'
  type CreateModelPayload = Omit<
    PredictiveModel,
    'id' | 'createdAt' | 'performance' | 'status' | 'lastTrained'
  >
  type CreateScenarioPayload = Omit<ForecastScenario, 'id' | 'results' | 'createdAt'>

  interface DecisionItem {
    id: string
    kind: string
    title: string
    description: string
    level: string
    tagType: TagType
    tone: 'danger' | 'warning' | 'primary'
  }

  const loading = ref(false)
  const creating = ref(false)
  const selectedModel = ref('')
  const alertFilter = reactive<{
    severity: '' | PredictiveAlert['severity']
    status: '' | PredictiveAlert['status']
  }>({
    severity: '',
    status: ''
  })

  const models = ref<PredictiveModel[]>([])
  const predictions = ref<PredictionResult[]>([])
  const scenarios = ref<ForecastScenario[]>([])
  const alerts = ref<PredictiveAlert[]>([])
  const predictionsChartRef = ref<HTMLElement | null>(null)
  const { setChartOption, resizeChart } = useEChartsManager()

  const createModelDialogVisible = ref(false)
  const createScenarioDialogVisible = ref(false)
  const createModelFormRef = ref<FormInstance>()
  const createScenarioFormRef = ref<FormInstance>()

  const defaultModelPayload = (): CreateModelPayload => ({
    name: '',
    description: '',
    type: 'production',
    algorithm: 'linear_regression',
    targetVariable: '',
    featureVariables: ['feed_intake', 'temperature', 'activity_index'],
    trainingData: {
      startDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      sampleSize: 1000
    }
  })

  const defaultScenarioPayload = (): CreateScenarioPayload => ({
    name: '',
    description: '',
    baseDate: new Date().toISOString().slice(0, 10),
    timeHorizon: 30,
    assumptions: [
      {
        variable: 'feed_price',
        currentValue: 100,
        assumedValue: 105,
        changePercent: 5
      }
    ],
    riskLevel: 'low',
    recommendations: []
  })

  const createModelForm = reactive<CreateModelPayload>(defaultModelPayload())
  const createScenarioForm = reactive<CreateScenarioPayload>(defaultScenarioPayload())

  const createModelFormRules: FormRules = {
    name: [{ required: true, message: '请输入模型名称', trigger: 'blur' }],
    description: [{ required: true, message: '请输入说明', trigger: 'blur' }],
    type: [{ required: true, message: '请选择类型', trigger: 'change' }],
    algorithm: [{ required: true, message: '请选择算法', trigger: 'change' }],
    targetVariable: [{ required: true, message: '请输入目标变量', trigger: 'blur' }]
  }

  const createScenarioFormRules: FormRules = {
    name: [{ required: true, message: '请输入场景名称', trigger: 'blur' }],
    description: [{ required: true, message: '请输入说明', trigger: 'blur' }],
    timeHorizon: [{ required: true, message: '请输入天数', trigger: 'change' }],
    riskLevel: [{ required: true, message: '请选择风险级别', trigger: 'change' }]
  }

  const readyModelCount = computed(
    () => models.value.filter((item) => item.status === 'ready').length
  )
  const trainingModelCount = computed(
    () => models.value.filter((item) => item.status === 'training').length
  )
  const failedModelCount = computed(
    () => models.value.filter((item) => item.status === 'failed').length
  )
  const activeAlertCount = computed(
    () => alerts.value.filter((item) => item.status === 'active').length
  )

  const displayPredictions = computed(() => {
    if (!selectedModel.value) return predictions.value
    return predictions.value.filter((item) => item.modelId === selectedModel.value)
  })
  const {
    containerRef: modelGridContainerRef,
    visibleItems: visibleModels,
    startIndex: modelStartIndex,
    endIndex: modelEndIndex,
    totalCount: modelTotalCount,
    handleScroll: onModelGridScroll,
    handleWheel: onModelGridWheel
  } = useLazyGridRenderWindow(models, {
    rowCount: 2,
    minItemWidth: 260,
    gap: 12,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })
  const { visibleItems: visiblePredictions, handleWheel: onPredictionTableWheel } =
    useLazyRenderWindow(displayPredictions, {
      initialCount: 10,
      batchSize: 10,
      mode: 'fixed-window'
    })

  const averageAccuracyText = computed(() => {
    const values = models.value
      .map((item) => item.performance?.accuracy)
      .filter((value): value is number => Number.isFinite(value))
    if (!values.length) return '--'
    return formatPercent(values.reduce((sum, value) => sum + value, 0) / values.length)
  })

  const modelStatusText = computed(() => {
    if (!models.value.length) return '未建模，不能预测'
    if (failedModelCount.value) return `${failedModelCount.value} 个失败`
    if (readyModelCount.value) return `${readyModelCount.value} 个可用`
    return '训练中'
  })

  const primaryActionLabel = computed(() => {
    if (!models.value.length) return '创建模型'
    if (!readyModelCount.value) return '训练模型'
    return '生成预测'
  })

  const modelPipeline = computed(() => [
    {
      label: '训练数据',
      value: models.value.length ? '已绑定' : '待定义',
      note: models.value.length ? '模型已声明训练区间和特征变量' : '需要先创建模型并绑定训练数据',
      icon: 'ri:database-2-line',
      tone: models.value.length ? 'stable' : 'danger'
    },
    {
      label: '模型资产',
      value: models.value.length,
      note: models.value.length ? '可进入训练或发布流程' : '当前没有模型，不能预测',
      icon: 'ri:brain-line',
      tone: models.value.length ? 'stable' : 'danger'
    },
    {
      label: '训练发布',
      value: readyModelCount.value
        ? `${readyModelCount.value} 可用`
        : trainingModelCount.value
          ? '训练中'
          : '未就绪',
      note: failedModelCount.value
        ? `${failedModelCount.value} 个模型训练失败`
        : '只有可用模型才能生成预测',
      icon: readyModelCount.value ? 'ri:checkbox-circle-line' : 'ri:loader-4-line',
      tone: failedModelCount.value ? 'danger' : readyModelCount.value ? 'stable' : 'warning'
    },
    {
      label: '预测输出',
      value: predictions.value.length,
      note: predictions.value.length ? '可用于趋势和置信区间复核' : '尚无可复核的预测结果',
      icon: 'ri:line-chart-line',
      tone: predictions.value.length ? 'stable' : 'warning'
    }
  ])

  const _modelBoard = computed(() => [
    {
      label: '可用',
      value: readyModelCount.value,
      note: '可直接生成预测',
      icon: 'ri:checkbox-circle-line',
      tone: 'stable'
    },
    {
      label: '训练中',
      value: trainingModelCount.value,
      note: '等待训练完成后再发布',
      icon: 'ri:loader-4-line',
      tone: 'warning'
    },
    {
      label: '失败',
      value: failedModelCount.value,
      note: '需要复核训练数据或特征',
      icon: 'ri:error-warning-line',
      tone: failedModelCount.value ? 'danger' : 'stable'
    },
    {
      label: '预测结果',
      value: predictions.value.length,
      note: '趋势 / 置信区间',
      icon: 'ri:line-chart-line',
      tone: 'stable'
    }
  ])

  const filteredAlerts = computed(() =>
    alerts.value.filter((item) => {
      if (alertFilter.severity && item.severity !== alertFilter.severity) return false
      if (alertFilter.status && item.status !== alertFilter.status) return false
      return true
    })
  )

  const decisionQueue = computed<DecisionItem[]>(() => {
    const setupItems = !models.value.length
      ? [
          {
            id: 'setup-no-model',
            kind: '建模阻塞',
            title: '尚未创建预测模型',
            description: '当前无法生成预测或风险判断。请先创建模型并完成训练，再使用模型运维流程。',
            level: '不能预测',
            tagType: 'danger',
            tone: 'danger'
          } as DecisionItem
        ]
      : !readyModelCount.value
        ? [
            {
              id: 'setup-no-ready-model',
              kind: '模型未就绪',
              title: '没有可用模型',
              description: '模型仍在训练或训练失败。请优先完成训练，否则预测结果不可用。',
              level: '待训练',
              tagType: 'warning',
              tone: 'warning'
            } as DecisionItem
          ]
        : []

    const alertItems = alerts.value
      .filter((item) => item.status !== 'resolved')
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
      .slice(0, 4)
      .map(
        (item) =>
          ({
            id: `alert-${item.id}`,
            kind: '预测预警',
            title: item.title,
            description: `${formatDate(item.predictedDate)} 可能发生，概率 ${formatPercent(item.probability)}。`,
            level: getSeverityLabel(item.severity),
            tagType: getSeverityTagType(item.severity),
            tone: severityRank(item.severity) >= 3 ? 'danger' : 'warning'
          }) as DecisionItem
      )

    const failedItems = models.value
      .filter((item) => item.status === 'failed')
      .slice(0, 2)
      .map(
        (item) =>
          ({
            id: `model-${item.id}`,
            kind: '模型失败',
            title: item.name,
            description: '训练失败会影响预测可信度，建议复核训练数据和特征变量。',
            level: '待修复',
            tagType: 'danger',
            tone: 'danger'
          }) as DecisionItem
      )

    return [...setupItems, ...alertItems, ...failedItems].slice(0, 6)
  })

  const statusLabelMap: Record<PredictiveModel['status'], string> = {
    training: '训练中',
    ready: '可用',
    failed: '失败'
  }

  const statusTagMap: Record<PredictiveModel['status'], TagType> = {
    training: 'warning',
    ready: 'success',
    failed: 'danger'
  }

  const modelTypeMap: Record<PredictiveModel['type'], string> = {
    production: '生产',
    health: '健康',
    economic: '经营',
    reproduction: '繁殖'
  }

  const algorithmMap: Record<PredictiveModel['algorithm'], string> = {
    linear_regression: '线性回归',
    random_forest: '随机森林',
    neural_network: '神经网络',
    time_series: '时间序列'
  }

  const riskLabelMap: Record<ForecastScenario['riskLevel'], string> = {
    low: '低',
    medium: '中',
    high: '高'
  }

  const riskTagMap: Record<ForecastScenario['riskLevel'], TagType> = {
    low: 'success',
    medium: 'warning',
    high: 'danger'
  }

  const severityLabelMap: Record<PredictiveAlert['severity'], string> = {
    low: '低',
    medium: '中',
    high: '高',
    critical: '紧急'
  }

  const severityTagMap: Record<PredictiveAlert['severity'], TagType> = {
    low: 'info',
    medium: 'warning',
    high: 'danger',
    critical: 'danger'
  }

  const getModelStatusLabel = (status: PredictiveModel['status']) => statusLabelMap[status]
  const getModelStatusTagType = (status: PredictiveModel['status']) => statusTagMap[status]
  const getModelTypeLabel = (type: PredictiveModel['type']) => modelTypeMap[type]
  const getAlgorithmLabel = (algorithm: PredictiveModel['algorithm']) => algorithmMap[algorithm]
  const getRiskLevelLabel = (riskLevel: ForecastScenario['riskLevel']) => riskLabelMap[riskLevel]
  const getRiskLevelTagType = (riskLevel: ForecastScenario['riskLevel']) => riskTagMap[riskLevel]
  const getSeverityLabel = (severity: PredictiveAlert['severity']) => severityLabelMap[severity]
  const getSeverityTagType = (severity: PredictiveAlert['severity']) => severityTagMap[severity]

  const severityRank = (severity: PredictiveAlert['severity']) => {
    const ranks: Record<PredictiveAlert['severity'], number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4
    }
    return ranks[severity]
  }

  const getModelName = (modelId: string) =>
    models.value.find((item) => item.id === modelId)?.name ?? '未知模型'

  const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`
  const formatDate = (date: string) => formatDateOnly(date, '-')
  const formatDateTime = (date: string) => formatDateOnly(date, '-')

  const formatPredictionValue = (item: PredictionResult) => {
    const model = models.value.find((m) => m.id === item.modelId)
    if (model?.type === 'health' || model?.targetVariable.includes('rate')) {
      return formatPercent(item.predictedValue)
    }
    return item.predictedValue.toFixed(2)
  }

  const average = (values: number[]) => {
    const valid = values.filter((value) => Number.isFinite(value))
    if (!valid.length) return undefined
    return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 100) / 100
  }

  const latestByTime = (rows: any[], timeKeys: string[]) => {
    return [...rows].sort((a, b) => {
      const at = Math.max(
        ...timeKeys.map((key) => new Date(a?.[key] || 0).getTime()).filter(Number.isFinite)
      )
      const bt = Math.max(
        ...timeKeys.map((key) => new Date(b?.[key] || 0).getTime()).filter(Number.isFinite)
      )
      return bt - at
    })[0]
  }

  const buildPredictionFeaturesFromRealData = async (model: PredictiveModel) => {
    const snapshot = await loadPlatformSnapshot()
    const sensors = snapshot.sensors || []
    const feedRecords = snapshot.feedRecords || []
    const milkRecords = snapshot.milkRecords || []
    const cows = snapshot.cows || []

    const latestSensor = latestByTime(sensors, ['timestamp', 'createdAt', 'updatedAt'])
    if (!latestSensor && sensors.length === 0) {
      throw new Error('No real sensor data available')
    }

    const baseFeatures: Record<string, number | undefined> = {
      feed_intake: average(
        feedRecords.map((record: any) =>
          Number(record.actualAmount ?? record.feedAmount ?? record.amount)
        )
      ),
      temperature: Number(latestSensor?.temperature ?? latestSensor?.bodyTemperature),
      activity_index: Number(
        latestSensor?.activityIndex ?? latestSensor?.activity ?? latestSensor?.steps
      ),
      steps: Number(latestSensor?.steps),
      ambient_temperature: Number(
        latestSensor?.ambientTemp ?? latestSensor?.environmentTemperature
      ),
      humidity: Number(latestSensor?.humidity),
      milk_yield: average(
        milkRecords.map((record: any) =>
          Number(record.milkVolume ?? record.volume ?? record.milkYield ?? record.milk_yield)
        )
      ),
      parity: average(cows.map((cow: any) => Number(cow.parity ?? cow.parityNo ?? cow.parity_no))),
      days_in_milk: average(cows.map((cow: any) => Number(cow.daysInMilk ?? cow.days_in_milk)))
    }

    const features: Record<string, number> = {}
    const requested = model.featureVariables.length
      ? model.featureVariables
      : ['feed_intake', 'temperature', 'activity_index']
    requested.forEach((key) => {
      const value = baseFeatures[key]
      if (value !== undefined && Number.isFinite(value)) features[key] = value
    })

    if (!Object.keys(features).length) {
      throw new Error('No usable real feature values available')
    }

    return features
  }

  const loadModels = async () => {
    const response = await predictiveApi.getPredictiveModels()
    models.value = response.data
  }

  const loadPredictions = async () => {
    const response = await predictiveApi.getPredictionResults(
      selectedModel.value ? { modelId: selectedModel.value } : {}
    )
    predictions.value = response.data
    await nextTick()
    renderPredictionChart()
  }

  const loadScenarios = async () => {
    const response = await predictiveApi.getForecastScenarios()
    scenarios.value = response.data
  }

  const loadAlerts = async () => {
    const response = await predictiveApi.getPredictiveAlerts({
      severity: alertFilter.severity || undefined,
      status: alertFilter.status || undefined
    })
    alerts.value = response.data
  }

  const renderPredictionChart = () => {
    if (!predictionsChartRef.value || !displayPredictions.value.length) return
    const data = displayPredictions.value.slice(-20)
    setChartOption('predictive-results-chart', predictionsChartRef.value, {
      color: ['#60c041', '#00a6a6', '#f5a524'],
      tooltip: { trigger: 'axis' },
      grid: { left: 36, right: 24, top: 32, bottom: 32, containLabel: true },
      xAxis: {
        type: 'category',
        data: data.map((item) => formatDate(item.targetDate)),
        axisLine: { lineStyle: { color: 'rgba(96, 192, 65, 0.22)' } },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(96, 192, 65, 0.12)' } }
      },
      series: [
        {
          type: 'line',
          smooth: true,
          data: data.map((item) => item.predictedValue),
          lineStyle: { width: 3, color: '#60c041' },
          itemStyle: { color: '#60c041' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(96, 192, 65, 0.28)' },
                { offset: 1, color: 'rgba(96, 192, 65, 0.04)' }
              ]
            }
          }
        }
      ]
    })
  }

  const refreshData = async () => {
    loading.value = true
    try {
      await Promise.all([loadModels(), loadPredictions(), loadScenarios(), loadAlerts()])
    } catch (error) {
      ElMessage.error('加载预测数据失败')
      console.error(error)
    } finally {
      loading.value = false
    }
  }

  const resetCreateModelForm = () => Object.assign(createModelForm, defaultModelPayload())
  const resetCreateScenarioForm = () => Object.assign(createScenarioForm, defaultScenarioPayload())

  const handleCreateModel = async () => {
    if (!createModelFormRef.value) return
    try {
      await createModelFormRef.value.validate()
    } catch {
      return
    }

    creating.value = true
    try {
      const response = await predictiveApi.createPredictiveModel({
        ...createModelForm,
        name: createModelForm.name.trim(),
        description: createModelForm.description.trim(),
        targetVariable: createModelForm.targetVariable.trim(),
        featureVariables: [...createModelForm.featureVariables],
        trainingData: { ...createModelForm.trainingData }
      })
      if (response.code === 200) {
        ElMessage.success('模型已创建')
        createModelDialogVisible.value = false
        resetCreateModelForm()
        await loadModels()
      }
    } catch (error) {
      ElMessage.error('创建模型失败')
      console.error(error)
    } finally {
      creating.value = false
    }
  }

  const handleCreateScenario = async () => {
    if (!createScenarioFormRef.value) return
    try {
      await createScenarioFormRef.value.validate()
    } catch {
      return
    }

    creating.value = true
    try {
      const response = await predictiveApi.createForecastScenario({
        ...createScenarioForm,
        name: createScenarioForm.name.trim(),
        description: createScenarioForm.description.trim(),
        assumptions: [...createScenarioForm.assumptions],
        recommendations: [...createScenarioForm.recommendations]
      })
      if (response.code === 200) {
        ElMessage.success('场景已创建')
        createScenarioDialogVisible.value = false
        resetCreateScenarioForm()
        await loadScenarios()
      }
    } catch (error) {
      ElMessage.error('创建场景失败')
      console.error(error)
    } finally {
      creating.value = false
    }
  }

  const trainModel = async (model: PredictiveModel) => {
    try {
      const response = await predictiveApi.trainPredictiveModel(model.id, {
        startDate: model.trainingData.startDate,
        endDate: model.trainingData.endDate,
        features: model.featureVariables
      })
      if (response.code === 200) {
        ElMessage.success('训练任务已进入队列')
        await loadModels()
      }
    } catch (error) {
      ElMessage.error('训练模型失败')
      console.error(error)
    }
  }

  const deleteModel = async (model: PredictiveModel) => {
    try {
      await ElMessageBox.confirm(`确定删除模型“${model.name}”？`, '确认删除', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      })

      const response = await predictiveApi.deletePredictiveModel(model.id)
      if (response.code === 200) {
        ElMessage.success('模型已删除')
        if (selectedModel.value === model.id) selectedModel.value = ''
        await refreshData()
      }
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error('删除模型失败')
        console.error(error)
      }
    }
  }

  const generateNewPrediction = async () => {
    const modelId =
      selectedModel.value || models.value.find((item) => item.status === 'ready')?.id || ''
    if (!modelId) {
      ElMessage.warning('请先选择或创建一个可用模型')
      return
    }

    try {
      const model = models.value.find((item) => item.id === modelId)
      if (!model) {
        ElMessage.warning('未找到选中的模型')
        return
      }
      selectedModel.value = modelId
      const targetDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString().slice(0, 10)
      const features = await buildPredictionFeaturesFromRealData(model)
      const response = await predictiveApi.generatePrediction(modelId, targetDate, features)
      if (response.code === 200) {
        ElMessage.success('预测已生成')
        await loadPredictions()
      }
    } catch (error) {
      ElMessage.error('生成预测失败，请确认传感器和生产数据可用')
      console.error(error)
    }
  }

  const handlePrimaryAction = () => {
    if (!models.value.length) {
      createModelDialogVisible.value = true
      return
    }

    if (!readyModelCount.value) {
      const model =
        models.value.find((item) => item.status === 'training' || item.status === 'failed') ||
        models.value[0]
      if (model) {
        trainModel(model)
        return
      }
    }

    generateNewPrediction()
  }

  const acknowledgeAlert = async (item: PredictiveAlert) => {
    try {
      const response = await predictiveApi.acknowledgePredictiveAlert(item.id)
      if (response.code === 200) {
        ElMessage.success('预警已确认')
        await loadAlerts()
      }
    } catch (error) {
      ElMessage.error('确认预警失败')
      console.error(error)
    }
  }

  const resolveAlert = async (item: PredictiveAlert) => {
    try {
      const response = await predictiveApi.resolvePredictiveAlert(
        item.id,
        'Handled from predictive console'
      )
      if (response.code === 200) {
        ElMessage.success('预警已解决')
        await loadAlerts()
      }
    } catch (error) {
      ElMessage.error('解决预警失败')
      console.error(error)
    }
  }

  const handleResize = () => resizeChart('predictive-results-chart')

  watch(selectedModel, async () => {
    await loadPredictions()
  })

  watch(displayPredictions, () => {
    nextTick(renderPredictionChart)
  })

  watch(
    () => ({ ...alertFilter }),
    async () => {
      await loadAlerts()
    }
  )

  onMounted(async () => {
    await refreshData()
    window.addEventListener('resize', handleResize)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize)
  })
</script>

<style scoped lang="scss">
  .fc-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }

  .predictive-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 0.5fr);
    gap: 18px;
    align-items: start;
  }

  .predictive-flow-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.5fr);
    gap: 18px;
    align-items: start;
  }

  .predictive-layout.is-wide {
    grid-template-columns: minmax(0, 1.2fr) minmax(280px, 300px);
  }

  .predictive-layout.is-models {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 320px);
  }

  .model-board {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
  }

  .model-pipeline {
    display: grid;
    gap: 10px;
  }

  .pipeline-step {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 32px;
    gap: 14px;
    align-items: center;
    min-height: 86px;
    padding: 14px;
    background: var(--fluent-surface, #fff);
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .pipeline-step.warning {
    border-left-color: var(--fluent-amber);
  }

  .pipeline-step.danger {
    border-left-color: var(--fluent-danger);
  }

  .pipeline-index {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    color: var(--fluent-primary);
    font-weight: 780;
    background: rgb(var(--fluent-primary-rgb) / 10%);
    border-radius: 50%;
  }

  .pipeline-step.warning .pipeline-index {
    color: var(--fluent-amber);
    background: rgb(245 165 36 / 12%);
  }

  .pipeline-step.danger .pipeline-index {
    color: var(--fluent-danger);
    background: rgb(209 52 56 / 10%);
  }

  .pipeline-step > .art-svg-icon {
    color: var(--fluent-primary);
    font-size: 24px;
  }

  .pipeline-step.warning > .art-svg-icon {
    color: var(--fluent-amber);
  }

  .pipeline-step.danger > .art-svg-icon {
    color: var(--fluent-danger);
  }

  .model-state {
    min-height: 168px;
    padding: 15px;
    background: #fff;
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .state-icon {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    margin-bottom: 14px;
    color: var(--fluent-primary);
    background: rgb(var(--fluent-primary-rgb) / 10%);
    border-radius: var(--fluent-radius);
  }

  .model-state.warning .state-icon {
    color: var(--fluent-amber);
    background: rgb(245 165 36 / 12%);
  }

  .model-state.danger .state-icon {
    color: var(--fluent-danger);
    background: rgb(209 52 56 / 10%);
  }

  .model-state span,
  .pipeline-body span,
  .decision-item span,
  .model-card span,
  .scenario-list span,
  .predictive-alert span,
  .score-grid span {
    display: block;
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .model-state strong {
    display: block;
    margin-top: 8px;
    color: var(--fluent-text);
    font-size: clamp(22px, 2vw, 26px);
    font-weight: 780;
  }

  .pipeline-body strong {
    display: block;
    margin-top: 5px;
    color: var(--fluent-text);
    font-size: 22px;
    font-weight: 780;
  }

  .model-state p,
  .pipeline-body p,
  .decision-item p,
  .model-card p,
  .scenario-list p,
  .predictive-alert p {
    margin: 8px 0 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
    line-height: 1.6;
  }

  .decision-queue,
  .action-stack,
  .model-grid,
  .side-stack,
  .scenario-list,
  .predictive-alert-list {
    display: grid;
    gap: 12px;
  }

  .decision-item,
  .scenario-list article,
  .predictive-alert {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    justify-content: space-between;
    padding: 14px;
    background: rgb(255 255 255 / 42%);
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .decision-item.danger,
  .predictive-alert.high,
  .predictive-alert.critical {
    border-left-color: var(--fluent-danger);
  }

  .decision-item.warning,
  .predictive-alert.medium {
    border-left-color: var(--fluent-amber);
  }

  .decision-item h3,
  .model-card h3,
  .scenario-list strong,
  .predictive-alert strong {
    margin: 5px 0 0;
    color: var(--fluent-text);
    font-size: 16px;
    font-weight: 760;
  }

  .chart-shell {
    position: relative;
    min-height: 320px;
    overflow: hidden;
    background: var(--fluent-surface-subtle);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .chart-container {
    width: 100%;
    height: 320px;
    padding: 8px;
  }

  .model-select {
    width: 220px;
  }

  .action-stack button {
    display: flex;
    gap: 10px;
    align-items: center;
    width: 100%;
    padding: 13px 14px;
    color: var(--fluent-text);
    text-align: left;
    cursor: pointer;
    background: rgb(255 255 255 / 42%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
    transition:
      background-color 160ms ease,
      border-color 160ms ease,
      box-shadow 160ms ease;
  }

  .action-stack button:hover {
    background: rgb(248 250 252);
    border-color: var(--fluent-border-strong);
    box-shadow: inset 0 0 0 1px rgb(var(--fluent-primary-rgb) / 9%);
  }

  .action-stack .art-svg-icon {
    color: var(--fluent-primary);
    font-size: 20px;
  }

  .model-grid {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  }

  .model-grid-scroll {
    max-height: calc((238px * 2) + 24px);
    padding: 2px 8px 2px 2px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .model-card {
    display: flex;
    flex-direction: column;
    min-height: 238px;
    padding: 13px;
    background: #fff;
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
    box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
  }

  .model-card.training {
    border-left-color: var(--fluent-amber);
  }

  .model-card.failed {
    border-left-color: var(--fluent-danger);
  }

  .model-card-top {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    min-width: 0;
  }

  .model-card-top > div {
    min-width: 0;
  }

  .model-card-top > .el-tag {
    flex: 0 0 auto;
  }

  .score-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 14px;
  }

  .score-grid div {
    min-width: 0;
    padding: 10px;
    background: rgb(255 255 255 / 40%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .score-grid strong {
    display: block;
    margin-top: 4px;
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 14px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-actions,
  .alert-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
    margin-top: auto;
    padding-top: 14px;
  }

  .alert-filter {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 12px;
  }

  @media (max-width: 1280px) {
    .fc-metric-grid,
    .predictive-flow-layout,
    .predictive-layout,
    .predictive-layout.is-wide,
    .predictive-layout.is-models,
    .model-board {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .fc-metric-grid,
    .predictive-layout,
    .predictive-layout.is-wide,
    .predictive-layout.is-models,
    .model-board,
    .score-grid,
    .alert-filter {
      grid-template-columns: 1fr;
    }

    .decision-item,
    .scenario-list article,
    .predictive-alert {
      display: grid;
    }

    .model-select {
      width: 100%;
    }
  }
</style>
