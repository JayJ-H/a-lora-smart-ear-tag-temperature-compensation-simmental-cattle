<template>
  <div class="fluent-page art-page-view">
    <div class="fluent-page-header">
      <div>
        <h1>繁殖与健康监测</h1>
      </div>

      <div class="fluent-page-actions">
        <div class="fluent-inline-stat">{{ currentTime }}</div>
        <ElButton :loading="loading" @click="loadData">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />
          刷新
        </ElButton>
        <ElButton type="primary" :loading="analyzing" @click="runHealthAnalysis">
          <ArtSvgIcon icon="ri:brain-line" class="mr-1" />
          运行分析
        </ElButton>
      </div>
    </div>

    <div class="fluent-metric-grid">
      <div class="fluent-metric-card">
        <div class="metric-label">健康牛只</div>
        <div class="metric-value">{{ alertStats.healthy }}</div>
        <div class="metric-note">监测总数 {{ monitoredCows }}</div>
      </div>
      <div class="fluent-metric-card is-warning">
        <div class="metric-label">中等风险</div>
        <div class="metric-value">{{ alertStats.mediumRisk }}</div>
        <div class="metric-note">建议持续关注</div>
      </div>
      <div class="fluent-metric-card is-warning">
        <div class="metric-label">高风险预警</div>
        <div class="metric-value">{{ alertStats.highRisk }}</div>
        <div class="metric-note">需要现场复核</div>
      </div>
      <div class="fluent-metric-card is-danger">
        <div class="metric-label">危急状态</div>
        <div class="metric-value">{{ alertStats.critical }}</div>
        <div class="metric-note">立即干预</div>
      </div>
    </div>

    <ElTabs v-model="activeTab" class="mt-6">
      <ElTabPane label="实时监测" name="monitoring">
        <div class="fluent-panel mb-5">
          <ElForm :inline="true" :model="monitorFilter" class="flex flex-wrap gap-3">
            <ElFormItem label="风险等级">
              <ElSelect
                v-model="monitorFilter.riskLevel"
                clearable
                placeholder="全部等级"
                style="width: 160px"
              >
                <ElOption label="低风险" value="low" />
                <ElOption label="中等风险" value="medium" />
                <ElOption label="高风险" value="high" />
                <ElOption label="危急" value="critical" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="个体">
              <CowNumberAutocomplete
                v-model="monitorCowInput"
                class="smart-cow-autocomplete"
                placeholder="输入牛号自动补齐"
                @select="handleMonitorCowSelect"
              />
            </ElFormItem>
            <ElFormItem>
              <ElButton type="primary" @click="loadHealthScores">查询</ElButton>
              <ElButton @click="resetMonitorFilter">重置</ElButton>
            </ElFormItem>
          </ElForm>
        </div>

        <div
          class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 score-card-viewport"
          @scroll.passive="onScoreCardScroll"
          @wheel.passive="onScoreCardWheel"
        >
          <div v-for="score in visibleScores" :key="score.id" class="fluent-object-card">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3>个体 {{ getCowNumber(score.cowId) }}</h3>
                <p>{{ formatDate(score.timestamp || score.createdAt) }}</p>
              </div>
              <ElTag :type="getRiskTagType(score.riskLevel)" size="small">{{
                getRiskLevelLabel(score.riskLevel)
              }}</ElTag>
            </div>

            <div class="score-value" :class="getScoreColorClass(score.overallScore)">
              {{ score.overallScore }}
            </div>
            <div class="dimension-grid">
              <span>体温 {{ score.dimensions.temperature }}</span>
              <span>活动 {{ score.dimensions.activity }}</span>
              <span>反刍 {{ score.dimensions.rumination }}</span>
              <span>采食 {{ score.dimensions.feeding }}</span>
            </div>

            <div v-if="score.alerts.length" class="card-section is-danger">
              <strong>预警信息</strong>
              <span v-for="alert in score.alerts.slice(0, 2)" :key="alert.id">{{
                alert.title
              }}</span>
            </div>
            <div v-if="score.recommendations.length" class="card-section">
              <strong>建议措施</strong>
              <span v-for="item in score.recommendations.slice(0, 2)" :key="item">{{ item }}</span>
            </div>
          </div>
        </div>
        <div v-if="filteredScores.length > visibleScores.length" class="load-more-row">
          <ElButton @click="() => loadMoreScores()"
            >加载更多 {{ visibleScores.length }}/{{ filteredScores.length }}</ElButton
          >
        </div>
        <ElEmpty v-if="!filteredScores.length" description="暂无监测评分数据" />
      </ElTabPane>

      <ElTabPane label="预警管理" name="alerts">
        <div class="grid grid-cols-1 xl:grid-cols-[1fr_1.4fr] gap-5">
          <div class="fluent-panel">
            <h2>预警分布</h2>
            <div id="alert-stats-chart" class="chart-box"></div>
          </div>
          <div class="fluent-panel">
            <div class="flex items-center justify-between mb-4">
              <h2>活跃预警</h2>
              <ElButton type="primary" @click="acknowledgeAllAlerts">批量确认</ElButton>
            </div>
            <ElTable
              :data="visibleActiveAlerts"
              v-loading="loading"
              height="420"
              @wheel.passive="onAlertTableWheel"
            >
              <ElTableColumn label="个体" width="100">
                <template #default="{ row }">{{ getCowNumber(row.cowId) }}</template>
              </ElTableColumn>
              <ElTableColumn label="类型" width="120">
                <template #default="{ row }">
                  <ElTag :type="getAlertTypeTag(row.alertType)" size="small">{{
                    getAlertTypeLabel(row.alertType)
                  }}</ElTag>
                </template>
              </ElTableColumn>
              <ElTableColumn label="级别" width="100">
                <template #default="{ row }">
                  <ElTag :type="getSeverityTagType(row.severity)" size="small">{{
                    getSeverityLabel(row.severity)
                  }}</ElTag>
                </template>
              </ElTableColumn>
              <ElTableColumn prop="title" label="预警标题" min-width="180" />
              <ElTableColumn label="触发时间" width="170">
                <template #default="{ row }">{{
                  formatDate(row.alertTime || row.createdAt)
                }}</template>
              </ElTableColumn>
              <ElTableColumn label="操作" width="100">
                <template #default="{ row }">
                  <ElButton type="primary" size="small" @click="acknowledgeAlert(row)"
                    >确认</ElButton
                  >
                </template>
              </ElTableColumn>
            </ElTable>
            <div v-if="activeAlerts.length > visibleActiveAlerts.length" class="load-more-row">
              <ElButton @click="() => loadMoreAlerts()"
                >加载更多 {{ visibleActiveAlerts.length }}/{{ activeAlerts.length }}</ElButton
              >
            </div>
          </div>
        </div>
      </ElTabPane>

      <ElTabPane label="监测模型" name="models">
        <div class="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-5">
          <div class="fluent-panel">
            <h2>模型表现</h2>
            <div id="model-performance-chart" class="chart-box"></div>
          </div>
          <div class="fluent-panel">
            <div class="flex items-center justify-between mb-4">
              <h2>模型列表</h2>
              <ElButton type="primary" @click="showTrainModelDialog = true">训练模型</ElButton>
            </div>
            <ElTable :data="visibleHealthModels" height="420" @wheel.passive="onModelTableWheel">
              <ElTableColumn prop="name" label="模型名称" min-width="150" />
              <ElTableColumn label="类型" width="140">
                <template #default="{ row }">{{ getModelTypeLabel(row.modelType) }}</template>
              </ElTableColumn>
              <ElTableColumn prop="algorithm" label="算法" width="140" />
              <ElTableColumn label="准确率" width="110">
                <template #default="{ row }"
                  >{{ (Number(row.accuracy || 0) * 100).toFixed(1) }}%</template
                >
              </ElTableColumn>
              <ElTableColumn label="状态" width="100">
                <template #default="{ row }">
                  <ElTag :type="row.isActive ? 'success' : 'info'" size="small">{{
                    row.isActive ? '启用' : '停用'
                  }}</ElTag>
                </template>
              </ElTableColumn>
            </ElTable>
            <div v-if="healthModels.length > visibleHealthModels.length" class="load-more-row">
              <ElButton @click="() => loadMoreModels()"
                >加载更多 {{ visibleHealthModels.length }}/{{ healthModels.length }}</ElButton
              >
            </div>
          </div>
        </div>
      </ElTabPane>

      <ElTabPane label="风险预测" name="predictions">
        <div class="fluent-panel mb-5">
          <ElForm :inline="true" class="flex flex-wrap gap-3">
            <ElFormItem label="个体">
              <CowNumberAutocomplete
                v-model="predictionCowInput"
                class="smart-cow-autocomplete is-wide"
                placeholder="输入牛号自动补齐"
                @select="handlePredictionCowSelect"
              />
            </ElFormItem>
            <ElFormItem label="预测类型">
              <ElSelect v-model="predictionType" style="width: 160px">
                <ElOption label="疾病风险" value="disease_risk" />
                <ElOption label="健康趋势" value="health_trend" />
                <ElOption label="处置效果" value="treatment_effect" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem>
              <ElButton type="primary" :loading="predicting" @click="generatePrediction"
                >生成预测</ElButton
              >
            </ElFormItem>
          </ElForm>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div class="fluent-panel">
            <h2>当前预测</h2>
            <ElEmpty v-if="!currentPrediction" description="请选择个体并生成预测" />
            <div v-else class="prediction-grid">
              <span>个体</span><strong>{{ getCowNumber(currentPrediction.cowId) }}</strong>
              <span>类型</span
              ><strong>{{ getPredictionTypeLabel(currentPrediction.predictionType) }}</strong>
              <span>预测值</span><strong>{{ currentPrediction.predictedValue }}</strong>
              <span>置信度</span
              ><strong>{{ (currentPrediction.confidence * 100).toFixed(1) }}%</strong>
            </div>
          </div>
          <div class="fluent-panel">
            <h2>预测历史</h2>
            <ElTable
              :data="visiblePredictionHistory"
              height="300"
              @wheel.passive="onPredictionTableWheel"
            >
              <ElTableColumn label="个体" width="100">
                <template #default="{ row }">{{ getCowNumber(row.cowId) }}</template>
              </ElTableColumn>
              <ElTableColumn label="类型" width="120">
                <template #default="{ row }">{{
                  getPredictionTypeLabel(row.predictionType)
                }}</template>
              </ElTableColumn>
              <ElTableColumn prop="predictedValue" label="预测值" width="100" />
              <ElTableColumn label="置信度" width="100">
                <template #default="{ row }"
                  >{{ (Number(row.confidence || 0) * 100).toFixed(1) }}%</template
                >
              </ElTableColumn>
            </ElTable>
            <div
              v-if="predictionHistory.length > visiblePredictionHistory.length"
              class="load-more-row"
            >
              <ElButton @click="() => loadMorePredictions()"
                >加载更多 {{ visiblePredictionHistory.length }}/{{
                  predictionHistory.length
                }}</ElButton
              >
            </div>
          </div>
        </div>
      </ElTabPane>
    </ElTabs>

    <ElDialog v-model="showTrainModelDialog" title="训练监测模型" width="520px">
      <ElForm :model="modelForm" label-width="92px">
        <ElFormItem label="模型名称">
          <ElInput v-model="modelForm.name" placeholder="输入模型名称" />
        </ElFormItem>
        <ElFormItem label="模型类型">
          <ElSelect v-model="modelForm.modelType" style="width: 100%">
            <ElOption label="异常检测" value="anomaly_detection" />
            <ElOption label="趋势预测" value="trend_prediction" />
            <ElOption label="疾病预测" value="disease_prediction" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="算法">
          <ElSelect v-model="modelForm.algorithm" style="width: 100%">
            <ElOption label="随机森林" value="Random Forest" />
            <ElOption label="支持向量机" value="SVM" />
            <ElOption label="神经网络" value="Neural Network" />
            <ElOption label="梯度提升" value="Gradient Boosting" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="说明">
          <ElInput
            v-model="modelForm.description"
            type="textarea"
            :rows="3"
            placeholder="输入模型说明"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="showTrainModelDialog = false">取消</ElButton>
        <ElButton type="primary" :loading="training" @click="trainModel">开始训练</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import * as echarts from 'echarts'
  import * as databaseService from '@/services/数据库'
  import { predictiveApi } from '@/api/cow'
  import { useUserStore } from '@/store/modules/user'
  import { useLazyRenderWindow } from '@/hooks'
  import CowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'
  import { formatDateOnly } from '@/utils/date-display'

  type AnyRow = Record<string, any>
  type TagType = 'primary' | 'success' | 'warning' | 'info' | 'danger'
  type SensorMetric = 'temperature' | 'activity'

  interface SensorSnapshot {
    id: string
    cowId: string
    cowNumber: string
    timestamp: string
    temperature?: number
    activity?: number
    deviceId?: string
    sourceTable: string
  }

  interface ReproductionSnapshot {
    lastCalvingTime: number | null
    lastInseminationTime: number | null
    lastPositivePregnancyTime: number | null
    daysInMilk: number | null
    parityNo: number | null
  }

  const loading = ref(false)
  const analyzing = ref(false)
  const predicting = ref(false)
  const training = ref(false)
  const activeTab = ref('monitoring')
  const showTrainModelDialog = ref(false)
  const monitoredCows = ref(0)
  const selectedCowForPrediction = ref('')
  const predictionType = ref('health_trend')
  const currentPrediction = ref<AnyRow | null>(null)
  const currentTime = ref('')
  const userStore = useUserStore()
  const monitorCowInput = ref('')
  const predictionCowInput = ref('')

  const healthScores = ref<AnyRow[]>([])
  const activeAlerts = ref<AnyRow[]>([])
  const healthModels = ref<AnyRow[]>([])
  const predictionHistory = ref<AnyRow[]>([])
  const allCows = ref<AnyRow[]>([])
  const chartInstances = ref<Map<string, echarts.ECharts>>(new Map())
  let timeTimer: number | undefined

  const alertStats = reactive({
    healthy: 0,
    mediumRisk: 0,
    highRisk: 0,
    critical: 0
  })

  const monitorFilter = reactive({
    riskLevel: '',
    cowId: ''
  })

  const modelForm = reactive({
    name: '',
    modelType: 'anomaly_detection',
    algorithm: 'Random Forest',
    description: ''
  })

  const defaultPredictionModelId = computed(() => healthModels.value[0]?.id || '')

  const normalizeCowSearch = (value: unknown) =>
    String(value || '')
      .trim()
      .toLowerCase()

  const pickCowOptions = (keyword: string) => {
    const text = normalizeCowSearch(keyword)
    const options = text
      ? allCows.value.filter((cow) =>
          [
            cow.id,
            cow.cowId,
            cow.cow_id,
            cow.cowNumber,
            cow.cow_number,
            cow.animalNumber,
            cow.animal_number,
            cow.earTagNumber,
            cow.ear_tag_number
          ]
            .map(normalizeCowSearch)
            .some((value) => value.includes(text))
        )
      : allCows.value
    return options.slice(0, 30)
  }

  const handleMonitorCowSelect = (item: { cowId: string; cowNumber: string }) => {
    monitorCowInput.value = item.cowNumber
    monitorFilter.cowId = item.cowId || item.cowNumber
    loadHealthScores()
  }
  const handlePredictionCowSelect = (item: { cowId: string; cowNumber: string }) => {
    predictionCowInput.value = item.cowNumber
    selectedCowForPrediction.value = item.cowId || item.cowNumber
  }

  const filteredScores = computed(() =>
    healthScores.value.filter((score) => {
      if (monitorFilter.riskLevel && score.riskLevel !== monitorFilter.riskLevel) return false
      if (monitorFilter.cowId && score.cowId !== monitorFilter.cowId) return false
      return true
    })
  )
  const {
    visibleItems: visibleScores,
    loadMore: loadMoreScores,
    handleScroll: onScoreCardScroll,
    handleWheel: onScoreCardWheel
  } = useLazyRenderWindow(filteredScores, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const {
    visibleItems: visibleActiveAlerts,
    loadMore: loadMoreAlerts,
    handleWheel: onAlertTableWheel
  } = useLazyRenderWindow(activeAlerts, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const {
    visibleItems: visibleHealthModels,
    loadMore: loadMoreModels,
    handleWheel: onModelTableWheel
  } = useLazyRenderWindow(healthModels, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const {
    visibleItems: visiblePredictionHistory,
    loadMore: loadMorePredictions,
    handleWheel: onPredictionTableWheel
  } = useLazyRenderWindow(predictionHistory, {
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

  const DAY_MS = 86400000

  const textValue = (...values: unknown[]) =>
    values.map((value) => String(value ?? '').trim()).find(Boolean) || ''

  const normalizeCowRow = (row: AnyRow): AnyRow | null => {
    const id = textValue(row.id, row.cowId, row.cow_id, row.animalId, row.animal_id)
    const cowNumber = textValue(
      row.cowNumber,
      row.cow_number,
      row.animalNumber,
      row.animal_number,
      row.number
    )
    if (!id && !cowNumber) return null
    return {
      ...row,
      id: id || cowNumber,
      cowId: id || cowNumber,
      cow_id: id || cowNumber,
      cowNumber,
      cow_number: cowNumber,
      animalNumber: cowNumber,
      animal_number: cowNumber,
      status: textValue(row.status, row.animalStatus, row.animal_status) || '在群'
    }
  }

  const mergeCowRows = (cowRows: AnyRow[] = [], animalRows: AnyRow[] = []) => {
    const map = new Map<string, AnyRow>()
    ;[...animalRows, ...cowRows].forEach((row) => {
      const cow = normalizeCowRow(row)
      if (!cow) return
      const key = cow.id || cow.cowNumber
      const existing = map.get(key) || {}
      map.set(key, { ...existing, ...cow })
    })
    return Array.from(map.values())
  }

  const cowKeys = (cow: AnyRow | null | undefined) =>
    Array.from(
      new Set(
        [
          cow?.id,
          cow?.cowId,
          cow?.cow_id,
          cow?.animalId,
          cow?.animal_id,
          cow?.cowNumber,
          cow?.cow_number,
          cow?.animalNumber,
          cow?.animal_number
        ]
          .map((value) => String(value ?? '').trim())
          .filter(Boolean)
      )
    )

  const cowKeysFromRow = (row: AnyRow, payload: AnyRow = {}) =>
    Array.from(
      new Set(
        [
          row.id,
          row.cowId,
          row.cow_id,
          row.animalId,
          row.animal_id,
          row.cowNumber,
          row.cow_number,
          row.animalNumber,
          row.animal_number,
          row.number,
          payload.cowId,
          payload.cow_id,
          payload.animalId,
          payload.animal_id,
          payload.cowNumber,
          payload.cow_number,
          payload.animalNumber,
          payload.animal_number
        ]
          .map((value) => String(value ?? '').trim())
          .filter(Boolean)
      )
    )

  const parsePayload = (value: unknown): AnyRow => {
    if (!value) return {}
    if (typeof value === 'object' && !Array.isArray(value)) return value as AnyRow
    try {
      const parsed = JSON.parse(String(value))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  const numberValue = (...values: unknown[]) => {
    for (const value of values) {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) return numeric
    }
    return null
  }

  const toTime = (value: unknown) => {
    const time = new Date(String(value || '')).getTime()
    return Number.isFinite(time) ? time : 0
  }

  const normalizeDateTime = (value: unknown) => {
    const text = textValue(value)
    if (!text) return ''
    const time = toTime(text)
    return time ? new Date(time).toISOString() : text
  }

  const normalizeMetric = (value: unknown): SensorMetric | '' => {
    const metric = textValue(value)
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
    if (
      /temp|temperature|body_temperature|ear_temperature|rectal_temperature|体温|耳温|温度/.test(
        metric
      )
    ) {
      return 'temperature'
    }
    if (/activity|active|motion|activity_index|活动|运动/.test(metric)) return 'activity'
    return ''
  }

  const cowIdOf = (row: AnyRow, payload: AnyRow = {}) =>
    textValue(
      row.cowId,
      row.cow_id,
      row.animalId,
      row.animal_id,
      payload.cowId,
      payload.cow_id,
      payload.animalId,
      payload.animal_id
    )

  const cowNumberOf = (row: AnyRow, payload: AnyRow = {}) =>
    textValue(
      row.cowNumber,
      row.cow_number,
      row.animalNumber,
      row.animal_number,
      row.number,
      payload.cowNumber,
      payload.cow_number,
      payload.animalNumber,
      payload.animal_number
    )

  const sensorTimeOf = (row: AnyRow, payload: AnyRow = {}) =>
    textValue(
      row.timestamp,
      row.ts,
      row.measuredAt,
      row.measured_at,
      row.recordTime,
      row.record_time,
      row.createdAt,
      row.created_at,
      payload.timestamp,
      payload.ts,
      payload.measuredAt,
      payload.measured_at
    )

  const normalizeSensorRow = (row: AnyRow, sourceTable: string): SensorSnapshot | null => {
    const payload = parsePayload(row.rawPayload || row.raw_payload || row.payload)
    const cowId = cowIdOf(row, payload)
    const cowNumber = cowNumberOf(row, payload)
    const timestamp = sensorTimeOf(row, payload)
    if ((!cowId && !cowNumber) || !timestamp || !toTime(timestamp)) return null

    const metric = normalizeMetric(
      row.metricCode || row.metric_code || row.metric || row.dataType || row.data_type
    )
    const reading = numberValue(
      row.readingValue,
      row.reading_value,
      row.value,
      payload.readingValue,
      payload.reading_value,
      payload.value
    )
    const snapshot: SensorSnapshot = {
      id:
        textValue(row.id) ||
        `${sourceTable}:${cowId || cowNumber}:${timestamp}:${metric || 'sensor'}`,
      cowId,
      cowNumber,
      timestamp: normalizeDateTime(timestamp),
      deviceId: textValue(
        row.deviceId,
        row.device_id,
        row.sensorId,
        row.sensor_id,
        payload.deviceId,
        payload.device_id
      ),
      sourceTable
    }
    const temperature = numberValue(
      row.temperature,
      row.bodyTemperature,
      row.body_temperature,
      row.earTemperature,
      row.ear_temperature,
      row.rectalTemperature,
      row.rectal_temperature,
      payload.temperature,
      payload.body_temperature
    )
    const activity = numberValue(
      row.activity,
      row.activityIndex,
      row.activity_index,
      payload.activity,
      payload.activity_index
    )
    if (temperature !== null) snapshot.temperature = temperature
    if (activity !== null) snapshot.activity = activity
    if (reading !== null && metric) snapshot[metric] = reading

    return snapshot.temperature !== undefined || snapshot.activity !== undefined ? snapshot : null
  }

  const resolveCowKey = (
    snapshot: SensorSnapshot,
    cowsById: Map<string, AnyRow>,
    cowsByNumber: Map<string, AnyRow>
  ) => {
    const cow = cowKeysFromRow(snapshot)
      .map((key) => cowsById.get(key) || cowsByNumber.get(key))
      .find(Boolean)
    return cow?.id || snapshot.cowId || snapshot.cowNumber
  }

  const buildSensorHistory = (rows: Array<{ sourceTable: string; rows: AnyRow[] }>) => {
    const cowsById = new Map<string, AnyRow>()
    const cowsByNumber = new Map<string, AnyRow>()
    allCows.value.forEach((cow) => {
      cowKeys(cow).forEach((key) => cowsById.set(key, cow))
      if (cow.cowNumber) cowsByNumber.set(String(cow.cowNumber), cow)
    })
    const history: Record<string, SensorSnapshot[]> = {}
    rows
      .flatMap((source) =>
        source.rows
          .map((row) => normalizeSensorRow(row, source.sourceTable))
          .filter((row): row is SensorSnapshot => Boolean(row))
      )
      .forEach((snapshot) => {
        const cowId = resolveCowKey(snapshot, cowsById, cowsByNumber)
        if (!cowId) return
        const cow = cowsById.get(cowId)
        const normalized = {
          ...snapshot,
          cowId,
          cowNumber: cow?.cowNumber || snapshot.cowNumber
        }
        history[cowId] = history[cowId] || []
        history[cowId].push(normalized)
      })
    Object.values(history).forEach((items) => {
      items.sort((left, right) => toTime(right.timestamp) - toTime(left.timestamp))
    })
    return history
  }

  const eventCodeOf = (row: AnyRow) => {
    const details = parsePayload(row.details || row.customValues || row.custom_values)
    const raw = textValue(
      row.eventCode,
      row.event_code,
      row.eventType,
      row.event_type,
      row.type,
      row.eventName,
      row.event_name,
      details.eventCode,
      details.event_code,
      details.eventType,
      details.event_type,
      details.eventName,
      details.event_name
    ).toLowerCase()
    if (/insemination|breeding|semen|配种|输精|人工授精/.test(raw)) return 'insemination'
    if (/pregnancy|妊检|妊娠检查/.test(raw)) return 'pregnancy_check'
    if (/calving|delivery|产犊|分娩/.test(raw)) return 'calving'
    if (/heat|estrus|发情/.test(raw)) return 'heat'
    return raw
  }

  const eventTimeOf = (row: AnyRow) =>
    toTime(
      textValue(
        row.occurredAt,
        row.occurred_at,
        row.eventTime,
        row.event_time,
        row.eventDate,
        row.event_date,
        row.breedingDate,
        row.breeding_date,
        row.inseminationDate,
        row.insemination_date,
        row.pregnancyCheckDate,
        row.pregnancy_check_date,
        row.calvingDate,
        row.calving_date,
        row.actualCalvingDate,
        row.actual_calving_date,
        row.createdAt,
        row.created_at
      )
    )

  const isPositivePregnancy = (row: AnyRow) => {
    const details = parsePayload(row.details || row.customValues || row.custom_values)
    const result = textValue(
      row.result,
      row.pregnancyResult,
      row.pregnancy_result,
      details.result,
      details.pregnancyResult,
      details.pregnancy_result,
      details['妊检结果']
    )
    return /阳性|怀孕|妊娠|positive|pregnant/i.test(result)
  }

  const latestHistoryTime = (history: Record<string, SensorSnapshot[]>) => {
    const latest = Object.values(history)
      .flat()
      .map((row) => toTime(row.timestamp))
      .filter((time) => time > 0)
      .sort((left, right) => right - left)[0]
    return latest || Date.now()
  }

  const buildReproductionSnapshots = (
    events: AnyRow[],
    episodes: AnyRow[],
    referenceTime = Date.now()
  ) => {
    const cowsById = new Map<string, AnyRow>()
    const cowsByNumber = new Map<string, AnyRow>()
    allCows.value.forEach((cow) => {
      cowKeys(cow).forEach((key) => cowsById.set(key, cow))
      if (cow.cowNumber) cowsByNumber.set(String(cow.cowNumber), cow)
    })
    const snapshots = new Map<string, ReproductionSnapshot>()
    const ensure = (cowId: string): ReproductionSnapshot => {
      const current = snapshots.get(cowId) || {
        lastCalvingTime: null,
        lastInseminationTime: null,
        lastPositivePregnancyTime: null,
        daysInMilk: null,
        parityNo: null
      }
      snapshots.set(cowId, current)
      return current
    }

    events.forEach((row) => {
      const cowId =
        cowKeysFromRow(row)
          .map((key) => cowsById.get(key) || cowsByNumber.get(key))
          .find(Boolean)?.id ||
        cowIdOf(row) ||
        ''
      if (!cowId || !cowsById.has(cowId)) return
      const code = eventCodeOf(row)
      const time = eventTimeOf(row)
      if (!time) return
      const snapshot = ensure(cowId)
      if (code === 'calving' && (!snapshot.lastCalvingTime || time > snapshot.lastCalvingTime)) {
        snapshot.lastCalvingTime = time
        snapshot.daysInMilk = Math.max(1, Math.floor((referenceTime - time) / DAY_MS) + 1)
      }
      if (
        code === 'insemination' &&
        (!snapshot.lastInseminationTime || time > snapshot.lastInseminationTime)
      ) {
        snapshot.lastInseminationTime = time
      }
      if (
        code === 'pregnancy_check' &&
        isPositivePregnancy(row) &&
        (!snapshot.lastPositivePregnancyTime || time > snapshot.lastPositivePregnancyTime)
      ) {
        snapshot.lastPositivePregnancyTime = time
      }
    })

    episodes.forEach((row) => {
      const cowId =
        cowKeysFromRow(row)
          .map((key) => cowsById.get(key) || cowsByNumber.get(key))
          .find(Boolean)?.id ||
        cowIdOf(row) ||
        ''
      if (!cowId || !cowsById.has(cowId)) return
      const startTime = toTime(
        row.startDate || row.start_date || row.lactationStartDate || row.lactation_start_date
      )
      const endTime = toTime(row.endDate || row.end_date)
      if (!startTime || (endTime && endTime < referenceTime)) return
      const snapshot = ensure(cowId)
      snapshot.parityNo = numberValue(row.parityNo, row.parity_no, snapshot.parityNo)
      snapshot.lastCalvingTime =
        snapshot.lastCalvingTime && snapshot.lastCalvingTime > startTime
          ? snapshot.lastCalvingTime
          : startTime
      snapshot.daysInMilk = Math.max(1, Math.floor((referenceTime - startTime) / DAY_MS) + 1)
    })

    return snapshots
  }

  const average = (values: number[]) => {
    const usable = values.filter((value) => Number.isFinite(value))
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null
  }

  const rowsBetween = (rows: SensorSnapshot[], start: number, end: number) =>
    rows.filter((row) => {
      const time = toTime(row.timestamp)
      return time >= start && time < end
    })

  const dailyMetricValues = (
    rows: SensorSnapshot[],
    metric: SensorMetric,
    start: number,
    end: number
  ) => {
    const buckets = new Map<string, number[]>()
    rowsBetween(rows, start, end).forEach((row) => {
      const value = row[metric]
      if (value === undefined || !Number.isFinite(value)) return
      const date = new Date(toTime(row.timestamp)).toISOString().slice(0, 10)
      buckets.set(date, [...(buckets.get(date) || []), value])
    })
    return Array.from(buckets.values())
      .map((values) => average(values))
      .filter((value): value is number => value !== null)
  }

  const dailyLowMetricDays = (
    rows: SensorSnapshot[],
    metric: SensorMetric,
    start: number,
    end: number,
    threshold: number
  ) =>
    dailyMetricValues(rows, metric, start, end).filter((value) => value > 0 && value <= threshold)
      .length

  const latestMetric = (rows: SensorSnapshot[], metric: SensorMetric) => {
    const found = rows.find((row) => row[metric] !== undefined)
    if (!found) return null
    return found[metric] ?? null
  }

  const makeDerivedAlert = (
    cow: AnyRow,
    input: {
      id: string
      alertType: string
      severity: string
      title: string
      description: string
      evidence: string[]
      alertTime?: string
    }
  ) =>
    normalizeAlert({
      id: input.id,
      cowId: cow.id,
      cowNumber: cow.cowNumber,
      alertType: input.alertType,
      severity: input.severity,
      title: input.title,
      description: `${input.description}${input.evidence.length ? `；依据：${input.evidence.join('，')}` : ''}`,
      status: 'active',
      alertTime: input.alertTime || new Date().toISOString(),
      createdAt: input.alertTime || new Date().toISOString(),
      sourceTable: 'derived-monitoring'
    })

  const buildDerivedMonitoring = (
    sensorHistory: Record<string, SensorSnapshot[]>,
    reproduction: Map<string, ReproductionSnapshot>,
    referenceTime = Date.now()
  ) => {
    const now = referenceTime
    const todayStart = new Date(new Date(referenceTime).toDateString()).getTime()
    const yesterdayStart = todayStart - DAY_MS
    const weekStart = todayStart - 8 * DAY_MS
    const weekEnd = todayStart - DAY_MS
    const threeDaysStart = todayStart - 3 * DAY_MS
    const rows: AnyRow[] = []
    const alerts: AnyRow[] = []

    allCows.value.forEach((cow) => {
      const cowId = String(cow.id || '')
      if (!cowId) return
      const sensors = sensorHistory[cowId] || []
      const reproductionState = reproduction.get(cowId) || {
        lastCalvingTime: null,
        lastInseminationTime: null,
        lastPositivePregnancyTime: null,
        daysInMilk: null,
        parityNo: null
      }
      const yesterdayRows = rowsBetween(sensors, yesterdayStart, todayStart)
      const weekRows = rowsBetween(sensors, weekStart, weekEnd)
      const recent3Rows = rowsBetween(sensors, threeDaysStart, now + DAY_MS)
      const latestTemperature = latestMetric(sensors, 'temperature')
      const latestMovement = latestMetric(sensors, 'activity')
      const recentTemperatures = dailyMetricValues(
        recent3Rows,
        'temperature',
        threeDaysStart,
        now + DAY_MS
      )
      const weekTemperatures = dailyMetricValues(sensors, 'temperature', weekStart, weekEnd)
      const yesterdayMovement = average(yesterdayRows.map((row) => row.activity ?? NaN))
      const weekMovement = average(weekRows.map((row) => row.activity ?? NaN))
      const yesterdayActivity = average(yesterdayRows.map((row) => row.activity ?? NaN))
      const weekActivity = average(weekRows.map((row) => row.activity ?? NaN))
      const weekTemperature = average(weekTemperatures)
      const highTempDays = recentTemperatures.filter((value) => value >= 39.2).length
      const tempRise =
        latestTemperature !== null &&
        weekTemperature !== null &&
        latestTemperature >= weekTemperature + 0.3
      const movementDrop =
        yesterdayMovement !== null &&
        weekMovement !== null &&
        weekMovement > 0 &&
        yesterdayMovement <= weekMovement * 0.65
      const movementRise =
        yesterdayActivity !== null &&
        weekActivity !== null &&
        weekActivity > 0 &&
        yesterdayActivity >= weekActivity * 1.25
      const lowTemperatureDays = dailyLowMetricDays(
        sensors,
        'temperature',
        now - 5 * DAY_MS,
        now + DAY_MS,
        35.5
      )
      const lowMovementDays = dailyLowMetricDays(
        sensors,
        'activity',
        now - 5 * DAY_MS,
        now + DAY_MS,
        20
      )
      const lowMovement = lowMovementDays >= 3

      if (highTempDays >= 2 && movementDrop) {
        alerts.push(
          makeDerivedAlert(cow, {
            id: `derived-health-${cowId}`,
            alertType: 'health',
            severity: 'critical',
            title: '健康预警',
            description: '体温持续异常且昨日活动量较上周明显下降',
            evidence: [
              `近3日高温${highTempDays}天`,
              `昨日活动${Math.round(yesterdayMovement || 0)}`,
              `上周均值${Math.round(weekMovement || 0)}`
            ]
          })
        )
      }

      if (tempRise && movementRise && Number(reproductionState.daysInMilk || 0) > 305) {
        alerts.push(
          makeDerivedAlert(cow, {
            id: `derived-estrus-${cowId}`,
            alertType: 'estrus',
            severity: 'high',
            title: '发情预测',
            description: '体温较上周升高、活动量增加，且本胎次已超过305天',
            evidence: [
              `DIM ${reproductionState.daysInMilk}`,
              `最新体温${latestTemperature?.toFixed(1) || '-'}℃`,
              `昨日活动${Math.round(yesterdayActivity || 0)}`
            ]
          })
        )
      }

      const pregnancyAnchor =
        reproductionState.lastPositivePregnancyTime && reproductionState.lastInseminationTime
          ? reproductionState.lastInseminationTime
          : null
      if (pregnancyAnchor) {
        const pregnantDays = Math.floor((now - pregnancyAnchor) / DAY_MS)
        if (pregnantDays >= 300 && pregnantDays <= 320) {
          alerts.push(
            makeDerivedAlert(cow, {
              id: `derived-calving-${cowId}`,
              alertType: 'calving',
              severity: pregnantDays >= 310 ? 'critical' : 'high',
              title: '临产预测',
              description: '末次配种已接近妊娠末期',
              evidence: [`末次配种距今${pregnantDays}天`, '建议核对妊检和预产期']
            })
          )
        }
      }

      if (lowTemperatureDays >= 3 || lowMovement) {
        alerts.push(
          makeDerivedAlert(cow, {
            id: `derived-ear-tag-${cowId}`,
            alertType: '耳标',
            severity: lowTemperatureDays >= 3 && lowMovement ? 'high' : 'medium',
            title: '耳标异常',
            description: '长期低温或活动量过低，疑似耳标脱落、未佩戴或设备异常',
            evidence: [
              `低温天数${lowTemperatureDays}`,
              `低活动天数${lowMovementDays}`,
              `最新活动${latestMovement === null ? '-' : Math.round(latestMovement)}`
            ]
          })
        )
      }

      const alertItems = alerts.filter((alert) => alert.cowId === cowId)
      const penalties = alertItems.reduce((sum, alert) => {
        if (alert.severity === 'critical') return sum + 32
        if (alert.severity === 'high') return sum + 22
        if (alert.severity === 'medium') return sum + 12
        return sum + 6
      }, 0)
      const tempScore =
        latestTemperature === null
          ? 80
          : latestTemperature >= 40
            ? 35
            : latestTemperature >= 39.2
              ? 55
              : latestTemperature <= 35.5
                ? 45
                : 88
      const activityScore =
        movementDrop || lowMovement ? 45 : movementRise ? 72 : latestMovement === null ? 75 : 86
      const overallScore = Math.max(
        20,
        Math.min(96, Math.round((tempScore + activityScore + 172) / 4 - penalties))
      )
      rows.push(
        normalizeHealthScore(
          {
            id: `derived-score-${cowId}`,
            cowId,
            overallScore,
            riskLevel: riskLevelFromScore(overallScore),
            temperature: tempScore,
            activity: activityScore,
            rumination: 78,
            feeding: 78,
            recommendations: alertItems.length
              ? ['现场核对体温、活动、耳标佩戴和繁殖记录', '需要时生成处置工单']
              : ['保持常规巡检', '继续观察体温与活动趋势'],
            createdAt: sensors[0]?.timestamp || new Date().toISOString()
          },
          alertItems
        )
      )
    })

    return { scores: rows, alerts }
  }

  const loadDerivedMonitoring = async () => {
    const [
      sensors,
      v2SensorReadings,
      legacySensorReadings,
      unifiedEvents,
      breedingRecords,
      reproductionCycles,
      lactationEpisodes,
      parityEpisodes
    ] = await Promise.all([
      safeTable('sensors'),
      safeTable('sensor_reading'),
      safeTable('sensor-readings'),
      databaseService.getUnifiedCowEventRowsAsync().catch(() => []),
      safeTable('breeding-records'),
      safeTable('reproduction-cycles'),
      safeTable('lactation_episode'),
      safeTable('parity_episode')
    ])
    const sensorHistory = buildSensorHistory([
      { sourceTable: 'sensors', rows: sensors },
      { sourceTable: 'sensor_reading', rows: v2SensorReadings },
      { sourceTable: 'sensor-readings', rows: legacySensorReadings }
    ])
    const reproduction = buildReproductionSnapshots(
      [...unifiedEvents, ...breedingRecords, ...reproductionCycles],
      [...lactationEpisodes, ...parityEpisodes, ...reproductionCycles],
      latestHistoryTime(sensorHistory)
    )
    return buildDerivedMonitoring(sensorHistory, reproduction, latestHistoryTime(sensorHistory))
  }

  const dedupeAlerts = (rows: AnyRow[]) => {
    const map = new Map<string, AnyRow>()
    rows.forEach((row) => {
      const key = String(row.id || `${row.cowId}:${row.alertType}:${row.title}`)
      const existing = map.get(key)
      if (!existing || existing.sourceTable === 'derived-monitoring') map.set(key, row)
    })
    return Array.from(map.values()).sort(
      (left, right) =>
        toTime(right.alertTime || right.createdAt) - toTime(left.alertTime || left.createdAt)
    )
  }

  const acknowledgedAlertIds = (rows: AnyRow[]) =>
    new Set(
      rows
        .map(normalizeAlert)
        .filter((row) => row.status === 'acknowledged' || row.status === 'resolved')
        .map((row) => row.id)
    )

  const loadData = async () => {
    loading.value = true
    try {
      const [cowRows, animalRows] = await Promise.all([safeTable('cows'), safeTable('animal')])
      const cows = mergeCowRows(cowRows, animalRows)
      allCows.value = cows
      monitoredCows.value = cows.length
      if (!selectedCowForPrediction.value && cows[0]) selectedCowForPrediction.value = cows[0].id

      await Promise.all([
        loadHealthScores(),
        loadActiveAlerts(),
        loadHealthModels(),
        loadPredictionHistory()
      ])
      calculateStats()
      await nextTick()
      renderCharts()
    } finally {
      loading.value = false
    }
  }

  const loadHealthScores = async () => {
    const [rows, alerts, predictiveAlerts, derived] = await Promise.all([
      safeTable('health-scores'),
      safeTable('alerts'),
      safeTable('predictive-alerts'),
      loadDerivedMonitoring()
    ])
    const alertRows: AnyRow[] = [
      ...alerts.map((alert) => ({ ...alert, sourceTable: 'alerts' })),
      ...predictiveAlerts.map((alert) => ({ ...alert, sourceTable: 'predictive-alerts' })),
      ...derived.alerts
    ]
    const cowIndex = new Map<string, AnyRow>()
    allCows.value.forEach((cow) => cowKeys(cow).forEach((key) => cowIndex.set(key, cow)))
    const alertsByCow = alertRows.reduce<Record<string, AnyRow[]>>((map, alert) => {
      const cow = cowKeysFromRow(alert)
        .map((key) => cowIndex.get(key))
        .find(Boolean)
      const cowId = String(cow?.id || alert.cowId || alert.cow_id || '')
      if (!cowId) return map
      map[cowId] = map[cowId] || []
      map[cowId].push(normalizeAlert(alert))
      return map
    }, {})

    const persistedScores = rows.map((row) => {
      const cow = cowKeysFromRow(row)
        .map((key) => cowIndex.get(key))
        .find(Boolean)
      const normalized = normalizeHealthScore(
        { ...row, cowId: cow?.id || row.cowId || row.cow_id },
        alertsByCow[String(cow?.id || row.cowId || row.cow_id || '')] || []
      )
      return normalized
    })
    const persistedCowIds = new Set(persistedScores.map((score) => score.cowId))
    healthScores.value = [
      ...persistedScores,
      ...derived.scores.filter((score) => !persistedCowIds.has(score.cowId))
    ]
    calculateStats()
  }

  const loadActiveAlerts = async () => {
    const [alerts, predictiveAlerts, derived] = await Promise.all([
      safeTable('alerts'),
      safeTable('predictive-alerts'),
      loadDerivedMonitoring()
    ])
    const acknowledged = acknowledgedAlertIds([...alerts, ...predictiveAlerts])
    const cowIndex = new Map<string, AnyRow>()
    allCows.value.forEach((cow) => cowKeys(cow).forEach((key) => cowIndex.set(key, cow)))
    activeAlerts.value = dedupeAlerts(
      (
        [
          ...alerts.map((alert) => ({ ...alert, sourceTable: 'alerts' })),
          ...predictiveAlerts.map((alert) => ({ ...alert, sourceTable: 'predictive-alerts' })),
          ...derived.alerts.filter((alert) => !acknowledged.has(alert.id))
        ] as AnyRow[]
      )
        .map((alert) => {
          const cow = cowKeysFromRow(alert)
            .map((key) => cowIndex.get(key))
            .find(Boolean)
          return normalizeAlert({ ...alert, cowId: cow?.id || alert.cowId || alert.cow_id })
        })
        .filter((alert) => alert.status === 'active')
    )
  }

  const loadHealthModels = async () => {
    const rows = await safeTable('predictive-models')
    healthModels.value = rows.map(normalizePredictiveModel)
  }

  const loadPredictionHistory = async () => {
    predictionHistory.value = (await safeTable('prediction-results')).map(normalizePredictionResult)
  }

  const normalizeAlert = (alert: AnyRow): AnyRow => ({
    id: String(alert.id || `${alert.cowId || alert.cow_id}-${alert.createdAt || Date.now()}`),
    cowId: String(alert.cowId || alert.cow_id || ''),
    cowNumber: String(
      alert.cowNumber || alert.cow_number || alert.animalNumber || alert.animal_number || ''
    ),
    alertType: alert.alertType || alert.alert_type || 'temperature',
    severity: alert.severity || 'medium',
    title: alert.title || alert.message || '健康风险预警',
    description: alert.description || alert.message || '',
    status: alert.status || 'active',
    alertTime:
      alert.alertTime ||
      alert.alert_time ||
      alert.createdAt ||
      alert.created_at ||
      new Date().toISOString(),
    createdAt: alert.createdAt || alert.created_at || new Date().toISOString(),
    sourceTable: alert.sourceTable || 'alerts'
  })

  const normalizeHealthScore = (score: AnyRow, alerts: AnyRow[]): AnyRow => {
    const payload = typeof score.payload === 'object' && score.payload ? score.payload : {}
    const dimensions =
      typeof score.dimensions === 'object' && score.dimensions
        ? score.dimensions
        : payload.dimensions || {}
    const overallScore = Number(
      score.overallScore ??
        score.overall_score ??
        score.score ??
        payload.overallScore ??
        payload.score ??
        0
    )
    return {
      id: String(
        score.id ||
          `${score.cowId || score.cow_id || payload.cowId}-${score.createdAt || Date.now()}`
      ),
      cowId: String(score.cowId || score.cow_id || payload.cowId || ''),
      overallScore,
      riskLevel:
        score.riskLevel ||
        score.risk_level ||
        payload.riskLevel ||
        riskLevelFromScore(overallScore),
      dimensions: {
        temperature: Number(
          score.temperature ?? score.temperatureScore ?? dimensions.temperature ?? 0
        ),
        activity: Number(score.activity ?? score.activityScore ?? dimensions.activity ?? 0),
        rumination: Number(score.rumination ?? score.ruminationScore ?? dimensions.rumination ?? 0),
        feeding: Number(score.feeding ?? score.feedingScore ?? dimensions.feeding ?? 0)
      },
      alerts,
      recommendations: Array.isArray(score.recommendations)
        ? score.recommendations
        : Array.isArray(payload.recommendations)
          ? payload.recommendations
          : defaultRecommendations(overallScore),
      timestamp: score.timestamp || score.createdAt || score.created_at || new Date().toISOString(),
      createdAt: score.createdAt || score.created_at || new Date().toISOString()
    }
  }

  const normalizePredictiveModel = (row: AnyRow): AnyRow => {
    const performance =
      typeof row.performance === 'object' && row.performance ? row.performance : {}
    return {
      ...row,
      id: String(row.id || ''),
      name: String(row.name || '未命名模型'),
      modelType: row.modelType || row.model_type || row.type || 'trend_prediction',
      algorithm: row.algorithm || '-',
      accuracy: Number(row.accuracy ?? performance.accuracy ?? 0),
      precision: Number(row.precision ?? performance.precision ?? 0),
      recall: Number(row.recall ?? performance.recall ?? 0),
      isActive:
        ['ready', 'active', 'training'].includes(String(row.status || '').toLowerCase()) ||
        Boolean(row.isActive ?? row.is_active),
      lastTrained: row.lastTrained || row.last_trained || row.createdAt || row.created_at
    }
  }

  const normalizePredictionResult = (row: AnyRow): AnyRow => {
    const factors = typeof row.factors === 'object' && row.factors ? row.factors : {}
    const confidenceInterval = row.confidenceInterval || row.confidence_interval || {}
    const confidence = Number(
      confidenceInterval.confidence ?? row.confidence ?? row.accuracy ?? 0.9
    )
    return {
      ...row,
      id: String(row.id || ''),
      cowId: String(row.cowId || row.cow_id || factors.cowId || ''),
      predictionType:
        row.predictionType || row.prediction_type || factors.predictionType || predictionType.value,
      predictedValue: Number(row.predictedValue ?? row.predicted_value ?? 0),
      confidence,
      createdAt: row.generatedAt || row.generated_at || row.createdAt || row.created_at || row.ts
    }
  }

  const riskLevelFromScore = (score: number) => {
    if (score >= 80) return 'low'
    if (score >= 65) return 'medium'
    if (score >= 45) return 'high'
    return 'critical'
  }

  const defaultRecommendations = (score: number) => {
    if (score >= 80) return ['保持当前巡检频率', '继续观察体温和反刍趋势']
    if (score >= 65) return ['增加一次现场观察', '复核采食与活动数据']
    return ['安排兽医复核', '检查饲养环境与饮水状态']
  }

  const calculateStats = () => {
    const scores = healthScores.value
    if (scores.length) {
      alertStats.healthy = scores.filter((score) => score.riskLevel === 'low').length
      alertStats.mediumRisk = scores.filter((score) => score.riskLevel === 'medium').length
      alertStats.highRisk = scores.filter((score) => score.riskLevel === 'high').length
      alertStats.critical = scores.filter((score) => score.riskLevel === 'critical').length
      return
    }

    alertStats.healthy = Math.max(0, monitoredCows.value - activeAlerts.value.length)
    alertStats.mediumRisk = activeAlerts.value.filter((alert) => alert.severity === 'medium').length
    alertStats.highRisk = activeAlerts.value.filter((alert) => alert.severity === 'high').length
    alertStats.critical = activeAlerts.value.filter((alert) => alert.severity === 'critical').length
  }

  const resetMonitorFilter = () => {
    monitorFilter.riskLevel = ''
    monitorFilter.cowId = ''
    monitorCowInput.value = ''
  }

  const runHealthAnalysis = async () => {
    analyzing.value = true
    try {
      await loadData()
      ElMessage.success('监测分析结果已刷新')
    } finally {
      analyzing.value = false
    }
  }

  const acknowledgeAlert = async (alert: AnyRow) => {
    try {
      if (String(alert.sourceTable || '') === 'predictive-alerts') {
        await predictiveApi.acknowledgePredictiveAlert(alert.id)
      } else if (String(alert.sourceTable || '') === 'derived-monitoring') {
        await databaseService.addTableDataAsync('alerts', {
          id: alert.id,
          cowId: alert.cowId,
          cow_id: alert.cowId,
          alertType: alert.alertType,
          alert_type: alert.alertType,
          severity: alert.severity,
          title: alert.title,
          description: alert.description,
          status: 'acknowledged',
          alertTime: alert.alertTime,
          alert_time: alert.alertTime,
          sourceType: 'derived_monitoring_acknowledged',
          source_type: 'derived_monitoring_acknowledged',
          acknowledgedBy:
            userStore.getUserInfo?.userName || userStore.getUserInfo?.userId || '当前用户',
          acknowledged_by:
            userStore.getUserInfo?.userName || userStore.getUserInfo?.userId || '当前用户',
          acknowledgedAt: new Date().toISOString(),
          acknowledged_at: new Date().toISOString(),
          createdAt: alert.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      } else {
        await databaseService.updateTableRecordAsync('alerts', alert.id, {
          status: 'acknowledged',
          updatedAt: new Date().toISOString()
        })
      }
      await Promise.all([loadActiveAlerts(), loadHealthScores()])
      ElMessage.success('预警已确认并写入数据库')
    } catch (error) {
      console.error('确认预警失败:', error)
      ElMessage.error('确认预警失败')
    }
  }

  const acknowledgeAllAlerts = async () => {
    await Promise.all(activeAlerts.value.map((alert) => acknowledgeAlert(alert)))
  }

  const generatePrediction = async () => {
    if (!selectedCowForPrediction.value) {
      ElMessage.warning('请选择个体')
      return
    }
    if (!defaultPredictionModelId.value) {
      ElMessage.warning('请先从数据库创建或训练预测模型')
      return
    }

    predicting.value = true
    try {
      const score = healthScores.value.find((item) => item.cowId === selectedCowForPrediction.value)
      const response = await predictiveApi.generatePrediction(
        defaultPredictionModelId.value,
        new Date().toISOString().slice(0, 10),
        {
          cowId: selectedCowForPrediction.value,
          predictionType: predictionType.value,
          healthScore: Number(score?.overallScore || 0),
          temperature: Number(score?.dimensions?.temperature || 0),
          activity: Number(score?.dimensions?.activity || 0),
          rumination: Number(score?.dimensions?.rumination || 0),
          feeding: Number(score?.dimensions?.feeding || 0)
        } as AnyRow
      )
      currentPrediction.value = normalizePredictionResult({
        ...response.data,
        cowId: selectedCowForPrediction.value,
        predictionType: predictionType.value
      })
      await loadPredictionHistory()
      ElMessage.success('预测已生成并写入数据库')
    } finally {
      predicting.value = false
    }
  }

  const trainModel = async () => {
    training.value = true
    try {
      const createPredictiveModel = predictiveApi.createPredictiveModel as unknown as (
        model: AnyRow
      ) => Promise<{ data: AnyRow }>
      const created = await createPredictiveModel({
        name: modelForm.name || `${getModelTypeLabel(modelForm.modelType)}模型`,
        description: modelForm.description,
        type: 'health',
        modelType: modelForm.modelType,
        algorithm: modelForm.algorithm,
        targetVariable: predictionType.value,
        featureVariables: ['overallScore', 'temperature', 'activity', 'rumination', 'feeding'],
        trainingData: {
          startDate: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
          endDate: new Date().toISOString().slice(0, 10),
          sampleSize: healthScores.value.length
        }
      })
      const modelId = String((created.data as AnyRow)?.id || '')
      if (modelId) {
        await predictiveApi.trainPredictiveModel(modelId, {
          startDate: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
          endDate: new Date().toISOString().slice(0, 10),
          features: ['overallScore', 'temperature', 'activity', 'rumination', 'feeding']
        })
      }
      await loadHealthModels()
      showTrainModelDialog.value = false
      modelForm.name = ''
      modelForm.description = ''
      ElMessage.success('模型已提交后端并写入数据库')
      await nextTick()
      renderModelPerformanceChart()
    } finally {
      training.value = false
    }
  }

  const getCowNumber = (cowId: string) =>
    allCows.value.find((cow) => cow.id === cowId)?.cowNumber || cowId || '-'

  const getRiskLevelLabel = (level: string) => {
    const labels: Record<string, string> = {
      low: '低风险',
      medium: '中等风险',
      high: '高风险',
      critical: '危急'
    }
    return labels[level] || level || '-'
  }

  const getRiskTagType = (level: string): TagType => {
    if (level === 'low') return 'success'
    if (level === 'medium') return 'warning'
    if (level === 'high') return 'danger'
    if (level === 'critical') return 'danger'
    return 'info'
  }

  const getScoreColorClass = (score: number) => {
    if (score >= 80) return 'is-good'
    if (score >= 65) return 'is-watch'
    return 'is-risk'
  }

  const getAlertTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      temperature: '体温异常',
      activity: '活动异常',
      rumination: '反刍异常',
      feeding: '采食异常',
      vital_signs: '生命体征',
      behavior: '行为异常'
    }
    return labels[type] || type || '-'
  }

  const getAlertTypeTag = (type: string): TagType => (type === 'temperature' ? 'danger' : 'warning')

  const getSeverityLabel = (severity: string) => {
    const labels: Record<string, string> = { low: '低', medium: '中', high: '高', critical: '危急' }
    return labels[severity] || severity || '-'
  }

  const getSeverityTagType = (severity: string): TagType => {
    if (severity === 'low') return 'success'
    if (severity === 'medium') return 'warning'
    return 'danger'
  }

  const getModelTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      anomaly_detection: '异常检测',
      trend_prediction: '趋势预测',
      disease_prediction: '疾病预测'
    }
    return labels[type] || type || '-'
  }

  const getPredictionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      disease_risk: '疾病风险',
      health_trend: '健康趋势',
      treatment_effect: '处置效果'
    }
    return labels[type] || type || '-'
  }

  const formatDate = (value: string | Date) => {
    return formatDateOnly(value, '-')
  }

  const updateCurrentTime = () => {
    currentTime.value = formatDateOnly(new Date(), '-')
  }

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
    renderAlertStatsChart()
    renderModelPerformanceChart()
  }

  const renderAlertStatsChart = () => {
    const chart = getOrCreateChart('alert-stats-chart')
    if (!chart) return

    chart.setOption(
      {
        tooltip: { trigger: 'item' },
        legend: { left: 'center', bottom: 8 },
        series: [
          {
            name: '健康状态分布',
            type: 'pie',
            radius: ['42%', '70%'],
            center: ['50%', '45%'],
            data: [
              { name: '低风险', value: alertStats.healthy, itemStyle: { color: '#60c041' } },
              { name: '中等风险', value: alertStats.mediumRisk, itemStyle: { color: '#f5a524' } },
              { name: '高风险', value: alertStats.highRisk, itemStyle: { color: '#f97316' } },
              { name: '危急状态', value: alertStats.critical, itemStyle: { color: '#d83b5d' } }
            ]
          }
        ]
      },
      true
    )
  }

  const renderModelPerformanceChart = () => {
    const chart = getOrCreateChart('model-performance-chart')
    if (!chart) return

    const rows = healthModels.value.map((model) => ({
      name: String(model.name || '-').slice(0, 12),
      accuracy: Number(model.accuracy || 0) * 100,
      precision: Number(model.precision || 0) * 100,
      recall: Number(model.recall || 0) * 100
    }))

    chart.setOption(
      {
        tooltip: { trigger: 'axis' },
        legend: { data: ['准确率', '精确率', '召回率'] },
        grid: { left: 50, right: 20, top: 44, bottom: 56 },
        xAxis: { type: 'category', data: rows.map((row) => row.name), axisLabel: { rotate: 20 } },
        yAxis: { type: 'value', name: '%', min: 0, max: 100 },
        series: [
          {
            name: '准确率',
            type: 'bar',
            data: rows.map((row) => row.accuracy.toFixed(1)),
            itemStyle: { color: '#60c041' }
          },
          {
            name: '精确率',
            type: 'bar',
            data: rows.map((row) => row.precision.toFixed(1)),
            itemStyle: { color: '#00a6a6' }
          },
          {
            name: '召回率',
            type: 'bar',
            data: rows.map((row) => row.recall.toFixed(1)),
            itemStyle: { color: '#f5a524' }
          }
        ]
      },
      true
    )
  }

  watch(activeTab, () => nextTick(renderCharts))

  onMounted(() => {
    updateCurrentTime()
    timeTimer = window.setInterval(updateCurrentTime, 1000)
    void userStore
    loadData()
  })

  onUnmounted(() => {
    if (timeTimer) window.clearInterval(timeTimer)
    chartInstances.value.forEach((chart) => chart.dispose())
    chartInstances.value.clear()
  })

  defineOptions({ name: 'SmartAlert' })
</script>

<style scoped>
  .chart-box {
    width: 100%;
    height: 320px;
  }

  .score-card-viewport {
    max-height: 720px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding: 12px 0 0;
  }

  .metric-label,
  .metric-note,
  .fluent-object-card p,
  .dimension-grid,
  .card-section span,
  .prediction-grid span {
    color: var(--fluent-text-soft);
  }

  .metric-value {
    margin: 8px 0;
    font-size: clamp(22px, 2vw, 29px);
    font-weight: 700;
    color: var(--fluent-text);
  }

  .fluent-panel h2,
  .fluent-object-card h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: var(--fluent-text);
  }

  .score-value {
    margin: 18px 0 12px;
    font-size: clamp(26px, 2.4vw, 32px);
    font-weight: 800;
  }

  .score-value.is-good {
    color: var(--fluent-primary);
  }

  .score-value.is-watch {
    color: var(--fluent-amber);
  }

  .score-value.is-risk {
    color: var(--fluent-rose);
  }

  .dimension-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    font-size: 13px;
  }

  .card-section {
    display: grid;
    gap: 6px;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--fluent-border);
    font-size: 13px;
  }

  .card-section strong {
    color: var(--fluent-text);
  }

  .card-section.is-danger span {
    color: var(--fluent-rose);
  }

  .prediction-grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 14px 18px;
  }

  .prediction-grid strong {
    color: var(--fluent-text);
  }
</style>
