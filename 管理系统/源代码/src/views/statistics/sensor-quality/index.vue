<template>
  <div class="sensor-quality-page">
    <div class="sensor-quality-head">
      <div>
        <h1>泌乳传感器质量监控</h1>
      </div>

      <div class="head-actions">
        <div class="sensor-total">
          泌乳采集 {{ milkingSensors.length }} / 全部 {{ totalSensors }} 个传感器
        </div>
        <ElButton type="primary" @click="loadSensorData" :loading="loading">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-2" />
          刷新数据
        </ElButton>
      </div>
    </div>

    <!-- 泌乳传感器状态概览 -->
    <div class="sensor-summary-grid mb-6">
      <div class="metric-card">
        <div class="metric-row">
          <div>
            <div class="metric-label">泌乳在线率</div>
            <div class="metric-value metric-green">{{ milkingOnlineRate }}%</div>
          </div>
          <div class="metric-icon metric-green">
            <ArtSvgIcon icon="ri:wifi-line" />
          </div>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-row">
          <div>
            <div class="metric-label">离线/故障</div>
            <div class="metric-value">{{ milkingOfflineCount }}</div>
          </div>
          <div class="metric-icon">
            <ArtSvgIcon icon="ri:wifi-off-line" />
          </div>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-row">
          <div>
            <div class="metric-label">弱信号</div>
            <div class="metric-value metric-red">{{ weakSignalSensors.length }}</div>
          </div>
          <div class="metric-icon metric-red">
            <ArtSvgIcon icon="ri:error-warning-line" />
          </div>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-row">
          <div>
            <div class="metric-label">低电量/待校准</div>
            <div class="metric-value metric-orange">{{
              lowBatterySensors.length + calibrationDueSensors.length
            }}</div>
          </div>
          <div class="metric-icon metric-orange">
            <ArtSvgIcon icon="ri:alert-line" />
          </div>
        </div>
      </div>
    </div>

    <!-- 奶厅采集质量面板 -->
    <div class="quality-grid">
      <div class="work-panel panel-wide">
        <div class="panel-head">
          <h3>奶厅采集质量</h3>
          <ElTag :type="milkingLinkHealth.tagType">{{ milkingLinkHealth.label }}</ElTag>
        </div>
        <div class="sensor-link-grid">
          <div
            v-for="node in milkingLinkNodes"
            :key="node.label"
            :class="['sensor-node', node.tone]"
          >
            <div class="sensor-node-head">
              <span>{{ node.label }}</span>
              <ArtSvgIcon :icon="node.icon" />
            </div>
            <div class="sensor-node-value">{{ node.value }}</div>
          </div>
        </div>
      </div>

      <div class="work-panel">
        <div class="panel-head">
          <h3>生产风险</h3>
        </div>
        <div class="risk-list">
          <div v-for="item in sensorRiskItems" :key="item.label" class="risk-item">
            <div>{{ item.label }}</div>
            <ElTag :type="item.tagType">{{ item.value }}</ElTag>
          </div>
        </div>
      </div>
    </div>

    <!-- 标签页 -->
    <ElTabs v-model="activeTab" class="sensor-tabs">
      <!-- 传感器状态监控 -->
      <ElTabPane label="泌乳传感器状态" name="status">
        <div class="tab-grid">
          <!-- 传感器列表 -->
          <div class="work-panel">
            <div class="panel-head">
              <h3>泌乳传感器状态列表</h3>
            </div>
            <div
              class="sensor-list"
              @scroll.passive="onMilkingSensorScroll"
              @wheel.passive="onMilkingSensorWheel"
            >
              <div
                v-for="sensor in visibleMilkingSensors"
                :key="sensor.id"
                class="sensor-list-item"
              >
                <div class="sensor-identity">
                  <div :class="['w-3 h-3 rounded-full', getStatusColor(sensor.status)]"></div>
                  <div>
                    <div class="sensor-cow">牛号: {{ getCowNumber(sensor.cowId) }}</div>
                    <div class="sensor-meta"
                      >ID: {{ sensor.sensorId }} · {{ formatRelative(sensor.lastUpdateTime) }}</div
                    >
                  </div>
                </div>
                <div class="sensor-reading">
                  <div>电量: {{ sensor.batteryLevel }}%</div>
                  <div>信号: {{ sensor.signalStrength }}</div>
                  <ElTag size="small" :type="getSensorRiskTagType(sensor)">{{
                    getSensorRiskLabel(sensor)
                  }}</ElTag>
                </div>
              </div>
              <div v-if="!milkingSensors.length" class="empty-note">
                未发现与泌乳个体或奶厅设备关联的传感器状态。
              </div>
              <div
                v-if="milkingSensors.length > visibleMilkingSensors.length"
                class="load-more-row"
              >
                <ElButton size="small" plain @click="loadMoreMilkingSensors()">
                  继续加载 {{ visibleMilkingSensors.length }}/{{ milkingSensors.length }}
                </ElButton>
              </div>
            </div>
          </div>

          <!-- 电池电量分布 -->
          <div class="work-panel">
            <div class="panel-head">
              <h3>泌乳传感器电量分布</h3>
            </div>
            <div :id="`battery-chart`" class="h-64 w-full"></div>
          </div>
        </div>
      </ElTabPane>

      <!-- 数据质量检查 -->
      <ElTabPane label="奶厅采集质量" name="quality">
        <div class="panel-stack">
          <!-- 质量问题列表 -->
          <div class="work-panel">
            <div class="panel-head">
              <h3>泌乳与奶厅采集质量问题</h3>
              <ElButton type="warning" size="small" @click="showQualityDialog = true">
                <ArtSvgIcon icon="ri:add-line" class="mr-2" />
                标记问题
              </ElButton>
            </div>

            <div class="table-shell">
              <ElTable
                :data="visibleMilkingQualityIssues"
                style="width: 100%"
                max-height="400"
                @wheel.passive="onQualityIssueTableWheel"
              >
                <ElTableColumn prop="cowId" label="牛号" width="80">
                  <template #default="scope">
                    {{ getCowNumber(scope.row.cowId) }}
                  </template>
                </ElTableColumn>
                <ElTableColumn prop="dataType" label="数据类型" width="120">
                  <template #default="scope">
                    {{ getDataTypeLabel(scope.row.dataType) }}
                  </template>
                </ElTableColumn>
                <ElTableColumn prop="originalValue" label="原始值" width="100" />
                <ElTableColumn prop="qualityScore" label="质量评分" width="100">
                  <template #default="scope">
                    <ElTag
                      :type="
                        scope.row.qualityScore > 80
                          ? 'success'
                          : scope.row.qualityScore > 60
                            ? 'warning'
                            : 'danger'
                      "
                    >
                      {{ scope.row.qualityScore }}
                    </ElTag>
                  </template>
                </ElTableColumn>
                <ElTableColumn prop="issues" label="问题描述">
                  <template #default="scope">
                    <div class="max-w-xs truncate" :title="scope.row.issues.join(', ')">
                      {{ scope.row.issues.join(', ') }}
                    </div>
                  </template>
                </ElTableColumn>
                <ElTableColumn prop="timestamp" label="发现时间" width="160">
                  <template #default="scope">
                    {{ formatDate(scope.row.timestamp) }}
                  </template>
                </ElTableColumn>
              </ElTable>
            </div>
          </div>

          <!-- 数据质量趋势 -->
          <div class="work-panel">
            <div class="panel-head">
              <h3>奶厅质量趋势</h3>
            </div>
            <div :id="`quality-trend-chart`" class="h-64 w-full"></div>
          </div>
        </div>
      </ElTabPane>

      <!-- 校准管理 -->
      <ElTabPane label="泌乳传感器校准" name="calibration">
        <div class="panel-stack">
          <!-- 校准记录 -->
          <div class="work-panel">
            <div class="panel-head">
              <h3>泌乳传感器校准记录</h3>
              <ElButton type="primary" size="small" @click="showCalibrationDialog = true">
                <ArtSvgIcon icon="ri:add-line" class="mr-2" />
                新增校准
              </ElButton>
            </div>

            <div class="table-shell">
              <ElTable
                :data="visibleMilkingCalibrations"
                style="width: 100%"
                max-height="400"
                @wheel.passive="onCalibrationTableWheel"
              >
                <ElTableColumn prop="sensorId" label="传感器ID" width="120" />
                <ElTableColumn prop="calibrationType" label="校准类型" width="120">
                  <template #default="scope">
                    {{ getCalibrationTypeLabel(scope.row.calibrationType) }}
                  </template>
                </ElTableColumn>
                <ElTableColumn prop="accuracy" label="精度" width="100">
                  <template #default="scope">
                    <ElTag
                      :type="
                        scope.row.accuracy > 95
                          ? 'success'
                          : scope.row.accuracy > 90
                            ? 'warning'
                            : 'danger'
                      "
                    >
                      {{ scope.row.accuracy }}%
                    </ElTag>
                  </template>
                </ElTableColumn>
                <ElTableColumn prop="technician" label="技术员" width="100" />
                <ElTableColumn prop="calibrationDate" label="校准日期" width="120">
                  <template #default="scope">
                    {{ formatDate(scope.row.calibrationDate) }}
                  </template>
                </ElTableColumn>
                <ElTableColumn prop="validUntil" label="有效期至" width="120">
                  <template #default="scope">
                    {{ formatDate(scope.row.validUntil) }}
                  </template>
                </ElTableColumn>
                <ElTableColumn label="校准状态" width="120">
                  <template #default="scope">
                    <ElTag :type="isCalibrationValid(scope.row) ? 'success' : 'danger'">
                      {{ isCalibrationValid(scope.row) ? '有效' : '过期' }}
                    </ElTag>
                  </template>
                </ElTableColumn>
              </ElTable>
            </div>
          </div>
        </div>
      </ElTabPane>
    </ElTabs>

    <!-- 质量问题标记对话框 -->
    <ElDialog v-model="showQualityDialog" title="标记数据质量问题" width="600px">
      <ElForm :model="qualityForm" label-width="100px">
        <ElFormItem label="牛只">
          <ElSelect
            v-model="qualityForm.cowId"
            filterable
            remote
            :remote-method="filterCowOptions"
            placeholder="选择牛只"
            style="width: 100%"
          >
            <ElOption
              v-for="cow in visibleCowOptions"
              :key="cow.id"
              :label="`牛号: ${cow.cowNumber}`"
              :value="cow.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="数据类型">
          <ElSelect v-model="qualityForm.dataType" placeholder="选择数据类型" style="width: 100%">
            <ElOption label="泌乳量" value="milk_volume" />
            <ElOption label="奶厅采集质量" value="milking" />
            <ElOption label="体温" value="temperature" />
            <ElOption label="步数" value="steps" />
            <ElOption label="反刍" value="rumination" />
            <ElOption label="活动" value="activity" />
            <ElOption label="进食" value="feeding" />
            <ElOption label="生命体征" value="vitalSigns" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="原始值">
          <ElInputNumber v-model="qualityForm.originalValue" :precision="2" style="width: 100%" />
        </ElFormItem>
        <ElFormItem label="质量评分">
          <ElSlider v-model="qualityForm.qualityScore" :min="0" :max="100" style="width: 100%" />
        </ElFormItem>
        <ElFormItem label="问题描述">
          <ElInput
            v-model="qualityForm.issuesText"
            type="textarea"
            :rows="3"
            placeholder="请输入问题描述，多个问题用逗号分隔"
            style="width: 100%"
          />
        </ElFormItem>
      </ElForm>

      <template #footer>
        <div class="text-center">
          <ElButton @click="showQualityDialog = false">取消</ElButton>
          <ElButton type="primary" @click="submitQualityIssue" :loading="submitting">提交</ElButton>
        </div>
      </template>
    </ElDialog>

    <!-- 校准对话框 -->
    <ElDialog v-model="showCalibrationDialog" title="传感器校准" width="600px">
      <ElForm :model="calibrationForm" label-width="120px">
        <ElFormItem label="传感器ID">
          <ElSelect
            v-model="calibrationForm.sensorId"
            filterable
            remote
            :remote-method="filterSensorOptions"
            placeholder="选择传感器"
            style="width: 100%"
          >
            <ElOption
              v-for="sensor in visibleSensorOptions"
              :key="sensor.id"
              :label="`传感器: ${sensor.sensorId} (牛号: ${getCowNumber(sensor.cowId)})`"
              :value="sensor.sensorId"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="校准类型">
          <ElSelect
            v-model="calibrationForm.calibrationType"
            placeholder="选择校准类型"
            style="width: 100%"
          >
            <ElOption label="偏移校准" value="offset" />
            <ElOption label="比例校准" value="scale" />
            <ElOption label="线性校准" value="linear" />
            <ElOption label="多项式校准" value="polynomial" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="技术员">
          <ElInput
            v-model="calibrationForm.technician"
            placeholder="请输入技术员姓名"
            style="width: 100%"
          />
        </ElFormItem>
        <ElFormItem label="精度">
          <ElSlider v-model="calibrationForm.accuracy" :min="80" :max="100" style="width: 100%" />
          <div class="text-center mt-2">{{ calibrationForm.accuracy }}%</div>
        </ElFormItem>
      </ElForm>

      <template #footer>
        <div class="text-center">
          <ElButton @click="showCalibrationDialog = false">取消</ElButton>
          <ElButton type="primary" @click="submitCalibration" :loading="submitting"
            >提交校准</ElButton
          >
        </div>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, reactive, onMounted } from 'vue'
  import type { SensorStatus, DataQualityCheck, SensorCalibration, CowBasic } from '@/types'
  import { sensorApi } from '@/api/cow'
  import * as databaseService from '@/services/database'
  import { loadUnifiedMilkRecords } from '@/services/unified-records'
  import { useEChartsManager, useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'

  import { ElMessage } from 'element-plus'

  type AnyRow = Record<string, any>
  type TagType = 'primary' | 'success' | 'warning' | 'info' | 'danger'

  // 状态变量
  const loading = ref(false)
  const activeTab = ref('status')
  const totalSensors = ref(0)
  const showQualityDialog = ref(false)
  const showCalibrationDialog = ref(false)
  const submitting = ref(false)
  const cowOptionKeyword = ref('')
  const sensorOptionKeyword = ref('')

  // 数据存储
  const sensorStatusList = ref<SensorStatus[]>([])
  const qualityIssues = ref<DataQualityCheck[]>([])
  const calibrations = ref<SensorCalibration[]>([])
  const allCows = ref<CowBasic[]>([])
  const milkRecords = ref<AnyRow[]>([])
  const hardwareDevices = ref<AnyRow[]>([])
  const synchronizations = ref<AnyRow[]>([])
  const { getOrCreateChart } = useEChartsManager()

  // 统计数据
  const sensorStats = reactive({
    online: 0,
    offline: 0,
    error: 0
  })
  const qualityIssuesCount = ref(0)

  // 表单数据
  const qualityForm = reactive({
    cowId: '',
    dataType: '',
    originalValue: 0,
    qualityScore: 50,
    issuesText: ''
  })

  const calibrationForm = reactive({
    sensorId: '',
    calibrationType: 'offset',
    technician: '',
    accuracy: 95
  })

  const milkingCowIds = computed(() => {
    const ids = new Set<string>()
    milkRecords.value.forEach((record) => {
      if (record.cowId) ids.add(String(record.cowId))
    })
    allCows.value.forEach((cow) => {
      const type = String((cow as AnyRow).type ?? '')
      const gender = String((cow as AnyRow).gender ?? '')
      if (
        gender.includes('母') ||
        type.includes('泌乳') ||
        type.includes('成母') ||
        type.toLowerCase().includes('lactating')
      ) {
        ids.add(String(cow.id))
      }
    })
    return ids
  })

  const milkingDevices = computed(() =>
    hardwareDevices.value.filter((device) => isMilkingDevice(device))
  )

  const milkingSynchronizations = computed(() =>
    synchronizations.value.filter((sync) => isMilkingSync(sync))
  )

  const milkingSensors = computed(() =>
    sensorStatusList.value.filter((sensor) => {
      const sensorText =
        `${sensor.sensorId} ${sensor.id} ${(sensor as AnyRow).deviceId ?? ''}`.toLowerCase()
      return (
        milkingCowIds.value.has(String(sensor.cowId)) ||
        sensorText.includes('milk') ||
        sensorText.includes('milking') ||
        sensorText.includes('奶') ||
        milkingDevices.value.some((device) => sensorText.includes(String(device.id).toLowerCase()))
      )
    })
  )
  const filterRowsByKeyword = <T,>(rows: T[], keyword: string, fields: (row: T) => unknown[]) => {
    const normalized = keyword.trim().toLowerCase()
    if (!normalized) return rows
    return rows.filter((row) =>
      fields(row)
        .map((value) => String(value ?? '').toLowerCase())
        .some((value) => value.includes(normalized))
    )
  }
  const filterCowOptions = (keyword: string) => {
    cowOptionKeyword.value = keyword
  }
  const filterSensorOptions = (keyword: string) => {
    sensorOptionKeyword.value = keyword
  }
  const visibleCowOptions = computed(() =>
    filterRowsByKeyword(allCows.value, cowOptionKeyword.value, (cow) => [
      cow.id,
      cow.cowNumber,
      (cow as AnyRow).earTagNumber,
      (cow as AnyRow).name
    ]).slice(0, 50)
  )
  const visibleSensorOptions = computed(() =>
    filterRowsByKeyword(sensorStatusList.value, sensorOptionKeyword.value, (sensor) => [
      sensor.id,
      sensor.sensorId,
      sensor.cowId,
      getCowNumber(sensor.cowId)
    ]).slice(0, 50)
  )
  const {
    visibleItems: visibleMilkingSensors,
    loadMore: loadMoreMilkingSensors,
    handleScroll: onMilkingSensorScroll,
    handleWheel: onMilkingSensorWheel
  } = useLazyRenderWindow(milkingSensors, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const milkingOnlineSensors = computed(() =>
    milkingSensors.value.filter((sensor) => sensor.status === 'online')
  )

  const milkingOnlineRate = computed(() =>
    milkingSensors.value.length
      ? Math.round((milkingOnlineSensors.value.length / milkingSensors.value.length) * 100)
      : 0
  )

  const milkingOfflineCount = computed(
    () => milkingSensors.value.filter((sensor) => sensor.status !== 'online').length
  )

  const weakSignalSensors = computed(() =>
    milkingSensors.value.filter(
      (sensor) => sensor.status === 'error' || Number(sensor.signalStrength ?? 0) < 65
    )
  )

  const lowBatterySensors = computed(() =>
    milkingSensors.value.filter((sensor) => Number(sensor.batteryLevel ?? 0) <= 25)
  )

  const milkingSensorIds = computed(
    () => new Set(milkingSensors.value.map((sensor) => sensor.sensorId))
  )

  const milkingCalibrations = computed(() =>
    calibrations.value.filter(
      (calibration) =>
        milkingSensorIds.value.has(calibration.sensorId) ||
        String(calibration.sensorId).toLowerCase().includes('milk')
    )
  )

  const calibrationDueSensors = computed(() =>
    milkingSensors.value.filter((sensor) => {
      const matched = milkingCalibrations.value.find(
        (calibration) => calibration.sensorId === sensor.sensorId
      )
      if (!matched) return true
      return !isCalibrationValid(matched)
    })
  )

  const milkingQualityIssues = computed(() =>
    qualityIssues.value.filter((issue) => {
      const text = `${issue.dataType} ${issue.issues?.join(' ') ?? ''}`.toLowerCase()
      return (
        milkingCowIds.value.has(String(issue.cowId)) ||
        text.includes('milk') ||
        text.includes('milking') ||
        text.includes('奶') ||
        text.includes('泌乳')
      )
    })
  )
  const { visibleItems: visibleMilkingQualityIssues, handleWheel: onQualityIssueTableWheel } =
    useLazyRenderWindow(milkingQualityIssues, {
      initialCount: 10,
      batchSize: 10,
      mode: 'fixed-window'
    })
  const { visibleItems: visibleMilkingCalibrations, handleWheel: onCalibrationTableWheel } =
    useLazyRenderWindow(milkingCalibrations, {
      initialCount: 10,
      batchSize: 10,
      mode: 'fixed-window'
    })

  const milkingLinkHealth = computed<{ label: string; tagType: TagType }>(() => {
    if (
      !milkingSensors.value.length ||
      !milkingDevices.value.length ||
      !milkingSynchronizations.value.length
    ) {
      return { label: '采集未完整', tagType: 'warning' }
    }
    if (
      weakSignalSensors.value.length ||
      lowBatterySensors.value.length ||
      calibrationDueSensors.value.length
    ) {
      return { label: '需处置', tagType: 'danger' }
    }
    return { label: '状态正常', tagType: 'success' }
  })

  const milkingLinkNodes = computed(() => [
    {
      label: '奶厅设备',
      value: `${milkingDevices.value.filter((device) => device.status === 'online').length}/${milkingDevices.value.length}`,
      note: milkingDevices.value.length ? '挤奶机器人或奶量采集设备已接入' : '未发现奶厅设备档案',
      icon: 'ri:robot-2-line',
      tone: milkingDevices.value.length ? 'sensor-node-ok' : 'sensor-node-warn'
    },
    {
      label: '泌乳传感器',
      value: `${milkingOnlineRate.value}%`,
      note: `${milkingSensors.value.length} 个传感器关联泌乳个体`,
      icon: 'ri:wifi-line',
      tone: milkingOnlineRate.value >= 85 ? 'sensor-node-ok' : 'sensor-node-warn'
    },
    {
      label: '校准有效',
      value: `${Math.max(0, milkingSensors.value.length - calibrationDueSensors.value.length)}/${milkingSensors.value.length}`,
      note: '按有效期判断泌乳传感器校准状态',
      icon: 'ri:equalizer-line',
      tone: calibrationDueSensors.value.length ? 'sensor-node-danger' : 'sensor-node-ok'
    },
    {
      label: '奶厅数据同步',
      value: milkingSynchronizations.value.length
        ? `${milkingSynchronizations.value.length} 条`
        : '待接入',
      note: milkingSynchronizations.value.some((sync) => sync.status === 'error')
        ? '存在奶量同步错误'
        : 'API/MQTT 同步状态可见',
      icon: 'ri:database-2-line',
      tone: milkingSynchronizations.value.length ? 'sensor-node-ok' : 'sensor-node-warn'
    }
  ])

  const sensorRiskItems = computed(
    () =>
      [
        {
          label: '在线率异常',
          value: milkingOnlineRate.value >= 85 ? '通过' : `${milkingOnlineRate.value}%`,
          note: '泌乳传感器低于 85% 时，奶厅实时采集需要先完成数据质量核对。',
          tagType: milkingOnlineRate.value >= 85 ? 'success' : 'danger'
        },
        {
          label: '信号异常',
          value: weakSignalSensors.value.length,
          note: '信号低于 65 或 error 状态会造成泌乳量缺口。',
          tagType: weakSignalSensors.value.length ? 'danger' : 'success'
        },
        {
          label: '电量异常',
          value: lowBatterySensors.value.length,
          note: '电量低于 25% 的泌乳传感器需要换电或维护。',
          tagType: lowBatterySensors.value.length ? 'warning' : 'success'
        },
        {
          label: '校准缺口',
          value: calibrationDueSensors.value.length,
          note: '无校准记录或有效期过期会影响泌乳量映射可信度。',
          tagType: calibrationDueSensors.value.length ? 'warning' : 'success'
        }
      ] as { label: string; value: string | number; note: string; tagType: TagType }[]
  )

  // 获取牛号
  const getCowNumber = (cowId: string): string => {
    const cow = allCows.value.find((c) => c.id === cowId)
    return cow?.cowNumber || cowId
  }

  // 获取状态颜色
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'online':
        return 'bg-green-500'
      case 'offline':
        return 'bg-gray-500'
      case 'error':
        return 'bg-red-500'
      default:
        return 'bg-gray-500'
    }
  }

  const isMilkingDevice = (device: AnyRow) => {
    const capabilities = Array.isArray(device.capabilities) ? device.capabilities.map(String) : []
    const text =
      `${device.name ?? ''} ${device.type ?? ''} ${device.location?.penName ?? ''}`.toLowerCase()
    return (
      device.type === 'milking_robot' ||
      capabilities.includes('milk_volume') ||
      text.includes('milk') ||
      text.includes('milking') ||
      text.includes('挤奶') ||
      text.includes('奶厅')
    )
  }

  const isMilkingSync = (sync: AnyRow) => {
    const text =
      `${sync.sourceDevice ?? ''} ${sync.targetSystem ?? ''} ${sync.dataType ?? ''} ${JSON.stringify(sync.configuration ?? {})}`.toLowerCase()
    return (
      text.includes('milk') ||
      text.includes('milking') ||
      text.includes('奶') ||
      text.includes('milk_volume')
    )
  }

  // 获取数据类型标签
  const getDataTypeLabel = (dataType: string): string => {
    const labels: Record<string, string> = {
      temperature: '体温',
      steps: '步数',
      rumination: '反刍',
      activity: '活动',
      feeding: '进食',
      vitalSigns: '生命体征',
      milk_volume: '泌乳量',
      milk_quality: '奶质',
      milking: '挤奶采集'
    }
    return labels[dataType] || dataType
  }

  // 获取校准类型标签
  const getCalibrationTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      offset: '偏移校准',
      scale: '比例校准',
      linear: '线性校准',
      polynomial: '多项式校准'
    }
    return labels[type] || type
  }

  // 格式化日期
  const formatDate = (dateString: string): string => {
    return formatDateOnly(dateString, '-')
  }

  const formatRelative = (dateString: string): string => {
    const date = new Date(dateString)
    if (!Number.isFinite(date.getTime())) return '暂无上报'
    const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000))
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes} 分钟前`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours} 小时前`
    return `${Math.round(hours / 24)} 天前`
  }

  const isCalibrationValid = (calibration: SensorCalibration): boolean => {
    return new Date(calibration.validUntil).getTime() >= Date.now()
  }

  const getSensorRiskTagType = (sensor: SensorStatus): TagType => {
    if (sensor.status === 'error') return 'danger'
    if (
      sensor.status === 'offline' ||
      Number(sensor.signalStrength ?? 0) < 65 ||
      Number(sensor.batteryLevel ?? 0) <= 25
    )
      return 'warning'
    return 'success'
  }

  const getSensorRiskLabel = (sensor: SensorStatus): string => {
    if (sensor.status === 'error') return sensor.errorCode || '故障'
    if (sensor.status === 'offline') return '离线'
    if (Number(sensor.batteryLevel ?? 0) <= 25) return '低电量'
    if (Number(sensor.signalStrength ?? 0) < 65) return '弱信号'
    return '正常'
  }

  const safeRows = async <T,>(tableName: string): Promise<T[]> => {
    try {
      const rows = await databaseService.getTableDataAsync(tableName, { silent: true })
      return Array.isArray(rows) ? (rows as T[]) : []
    } catch {
      return []
    }
  }

  // 加载传感器数据
  const loadSensorData = async () => {
    loading.value = true
    try {
      const [cowRows, sensorRows, issueRows, calibrationRows, milkRows, deviceRows, syncRows] =
        await Promise.all([
          safeRows<CowBasic>('cows'),
          safeRows<SensorStatus>('sensor-status'),
          safeRows<DataQualityCheck>('data-quality-checks'),
          safeRows<SensorCalibration>('sensor-calibrations'),
          loadUnifiedMilkRecords().catch(() => []),
          safeRows<AnyRow>('hardware-devices'),
          safeRows<AnyRow>('data-synchronizations')
        ])

      allCows.value = cowRows
      sensorStatusList.value = sensorRows
      totalSensors.value = sensorStatusList.value.length

      // 统计状态
      sensorStats.online = sensorStatusList.value.filter((s) => s.status === 'online').length
      sensorStats.offline = sensorStatusList.value.filter((s) => s.status === 'offline').length
      sensorStats.error = sensorStatusList.value.filter((s) => s.status === 'error').length

      milkRecords.value = milkRows
      hardwareDevices.value = deviceRows
      synchronizations.value = syncRows
      qualityIssues.value = issueRows
      calibrations.value = calibrationRows
      qualityIssuesCount.value = milkingQualityIssues.value.length

      // 渲染图表
      setTimeout(() => {
        renderCharts()
      }, 100)
    } catch (error) {
      ElMessage.error(
        '加载传感器数据失败: ' + (error instanceof Error ? error.message : String(error))
      )
    } finally {
      loading.value = false
    }
  }

  // 渲染图表
  const renderCharts = () => {
    // 电池电量分布图
    const batteryChartElement = document.getElementById('battery-chart')
    if (batteryChartElement) {
      const batteryChart = getOrCreateChart('battery-chart', batteryChartElement)
      if (!batteryChart) return

      const batteryRanges = {
        '0-20%': milkingSensors.value.filter((s) => s.batteryLevel <= 20).length,
        '21-40%': milkingSensors.value.filter((s) => s.batteryLevel > 20 && s.batteryLevel <= 40)
          .length,
        '41-60%': milkingSensors.value.filter((s) => s.batteryLevel > 40 && s.batteryLevel <= 60)
          .length,
        '61-80%': milkingSensors.value.filter((s) => s.batteryLevel > 60 && s.batteryLevel <= 80)
          .length,
        '81-100%': milkingSensors.value.filter((s) => s.batteryLevel > 80).length
      }

      const batteryOption = {
        tooltip: {
          trigger: 'axis'
        },
        grid: {
          left: '8%',
          right: '8%',
          top: '10%',
          bottom: '15%'
        },
        xAxis: {
          type: 'category',
          data: Object.keys(batteryRanges)
        },
        yAxis: {
          type: 'value',
          name: '传感器数量'
        },
        series: [
          {
            name: '泌乳传感器电量分布',
            type: 'bar',
            data: Object.values(batteryRanges),
            itemStyle: {
              color: function (params: any) {
                const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981']
                return colors[params.dataIndex] || '#6b7280'
              }
            }
          }
        ]
      }
      batteryChart.setOption(batteryOption)
    }

    // 数据质量趋势图
    const qualityTrendElement = document.getElementById('quality-trend-chart')
    if (qualityTrendElement) {
      const qualityChart = getOrCreateChart('quality-trend-chart', qualityTrendElement)
      if (!qualityChart) return

      // 生成最近7天的数据质量统计
      const qualityTrendData = Array.from({ length: 7 }, (_, i) => {
        const date = new Date()
        date.setDate(date.getDate() - (6 - i))
        const dayQualityIssues = milkingQualityIssues.value.filter(
          (q) => new Date(q.timestamp).toDateString() === date.toDateString()
        )

        return {
          date: date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
          issues: dayQualityIssues.length,
          avgScore:
            dayQualityIssues.length > 0
              ? dayQualityIssues.reduce((sum, q) => sum + q.qualityScore, 0) /
                dayQualityIssues.length
              : null
        }
      })

      const qualityTrendOption = {
        tooltip: {
          trigger: 'axis'
        },
        grid: {
          left: '8%',
          right: '8%',
          top: '10%',
          bottom: '15%'
        },
        legend: {
          data: ['质量问题数量', '平均质量评分']
        },
        xAxis: {
          type: 'category',
          data: qualityTrendData.map((d) => d.date)
        },
        yAxis: [
          {
            type: 'value',
            name: '问题数量',
            position: 'left'
          },
          {
            type: 'value',
            name: '质量评分',
            min: 0,
            max: 100,
            position: 'right'
          }
        ],
        series: [
          {
            name: '质量问题数量',
            type: 'bar',
            data: qualityTrendData.map((d) => d.issues),
            itemStyle: { color: '#f97316' }
          },
          {
            name: '平均质量评分',
            type: 'line',
            yAxisIndex: 1,
            data: qualityTrendData.map((d) =>
              d.avgScore === null ? null : Math.round(d.avgScore)
            ),
            lineStyle: { color: '#22c55e' },
            itemStyle: { color: '#22c55e' }
          }
        ]
      }
      qualityChart.setOption(qualityTrendOption)
    }
  }

  // 提交质量问题
  const submitQualityIssue = async () => {
    if (!qualityForm.cowId || !qualityForm.dataType) {
      ElMessage.warning('请填写完整信息')
      return
    }

    submitting.value = true
    try {
      const issues = qualityForm.issuesText
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s)

      await sensorApi.markDataQualityIssue({
        cowId: qualityForm.cowId,
        timestamp: new Date().toISOString(),
        dataType: qualityForm.dataType as any,
        originalValue: qualityForm.originalValue,
        qualityScore: qualityForm.qualityScore,
        isValid: qualityForm.qualityScore > 80,
        issues: issues.length > 0 ? issues : ['数据异常']
      })

      ElMessage.success('质量问题已标记')
      showQualityDialog.value = false

      // 重置表单
      Object.assign(qualityForm, {
        cowId: '',
        dataType: '',
        originalValue: 0,
        qualityScore: 50,
        issuesText: ''
      })

      // 重新加载数据
      await loadSensorData()
    } catch (error) {
      ElMessage.error(
        '提交质量问题失败: ' + (error instanceof Error ? error.message : String(error))
      )
      ElMessage.error('提交失败')
    } finally {
      submitting.value = false
    }
  }

  // 提交校准记录
  const submitCalibration = async () => {
    if (!calibrationForm.sensorId || !calibrationForm.technician) {
      ElMessage.warning('请填写完整信息')
      return
    }

    submitting.value = true
    try {
      await sensorApi.calibrateSensor({
        sensorId: calibrationForm.sensorId,
        calibrationType: calibrationForm.calibrationType as SensorCalibration['calibrationType'],
        parameters: {}, // 简化版，实际应该有具体参数
        calibrationDate: new Date().toISOString(),
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 一年有效期
        accuracy: calibrationForm.accuracy,
        technician: calibrationForm.technician
      })

      ElMessage.success('校准记录已保存')
      showCalibrationDialog.value = false

      // 重置表单
      Object.assign(calibrationForm, {
        sensorId: '',
        calibrationType: 'offset',
        technician: '',
        accuracy: 95
      })

      // 重新加载数据
      await loadSensorData()
    } catch (error) {
      ElMessage.error(
        '提交校准记录失败: ' + (error instanceof Error ? error.message : String(error))
      )
      ElMessage.error('提交失败')
    } finally {
      submitting.value = false
    }
  }

  // 初始化
  onMounted(() => {
    loadSensorData()
  })

  defineOptions({ name: 'SensorQuality' })
</script>

<style scoped>
  .sensor-quality-page {
    min-height: 100%;
    padding: 18px;
    color: #0f172a;
  }

  .sensor-quality-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }

  .sensor-quality-head h1 {
    margin: 2px 0 0;
    font-size: 22px;
    line-height: 1.25;
    font-weight: 650;
    color: #0f172a;
  }

  .head-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 10px;
  }

  .sensor-total {
    font-size: 13px;
    color: #64748b;
  }

  .sensor-summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }

  .metric-card,
  .work-panel {
    min-width: 0;
    border: 1px solid #d8e0ea;
    border-radius: 8px;
    background: #fff;
  }

  .metric-card {
    padding: 13px;
  }

  .metric-row,
  .panel-head,
  .risk-item,
  .sensor-list-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .metric-label {
    font-size: 13px;
    color: #64748b;
  }

  .metric-value {
    margin-top: 4px;
    font-size: 24px;
    line-height: 1;
    font-weight: 680;
    color: #334155;
  }

  .metric-icon {
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: #475569;
    background: #f1f5f9;
  }

  .metric-green {
    color: #047857;
  }

  .metric-red {
    color: #dc2626;
  }

  .metric-orange {
    color: #c2410c;
  }

  .metric-icon.metric-green {
    background: #ecfdf5;
  }

  .metric-icon.metric-red {
    background: #fef2f2;
  }

  .metric-icon.metric-orange {
    background: #fff7ed;
  }

  .quality-grid,
  .tab-grid {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
    gap: 14px;
    margin-bottom: 16px;
  }

  .work-panel {
    padding: 14px;
  }

  .panel-wide {
    grid-column: span 1;
  }

  .panel-head {
    margin-bottom: 12px;
  }

  .panel-head h3 {
    margin: 0;
    font-size: 16px;
    line-height: 1.35;
    font-weight: 650;
    color: #0f172a;
  }

  .sensor-link-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
  }

  .sensor-node {
    min-width: 0;
    padding: 11px;
    border: 1px solid #d8e0ea;
    border-radius: 8px;
    background: #f8fafc;
  }

  .sensor-node-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
    color: #64748b;
  }

  .sensor-node-value {
    margin-top: 6px;
    font-size: 19px;
    line-height: 1.15;
    font-weight: 680;
    color: #0f172a;
  }

  .risk-list,
  .panel-stack {
    display: grid;
    gap: 12px;
  }

  .risk-item {
    padding: 10px 11px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #f8fafc;
    font-size: 14px;
    font-weight: 560;
    color: #0f172a;
  }

  .sensor-tabs {
    margin-top: 10px;
  }

  .sensor-list {
    display: grid;
    gap: 10px;
    max-height: 388px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .sensor-list-item {
    align-items: flex-start;
    padding: 11px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #f8fafc;
  }

  .sensor-identity {
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .sensor-cow {
    font-size: 14px;
    font-weight: 650;
    color: #0f172a;
  }

  .sensor-meta,
  .sensor-reading,
  .empty-note {
    font-size: 12px;
    line-height: 1.55;
    color: #64748b;
  }

  .sensor-reading {
    text-align: right;
  }

  .table-shell {
    min-width: 0;
    overflow: auto;
    border: 1px solid #d8e0ea;
    border-radius: 8px;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 8px;
  }

  .sensor-node-ok {
    border-color: rgb(34 197 94 / 36%);
  }

  .sensor-node-warn {
    border-color: rgb(245 158 11 / 42%);
  }

  .sensor-node-danger {
    border-color: rgb(239 68 68 / 42%);
  }

  :global(.dark) .sensor-quality-page,
  :global(.dark) .sensor-quality-head h1,
  :global(.dark) .panel-head h3,
  :global(.dark) .sensor-node-value,
  :global(.dark) .risk-item,
  :global(.dark) .sensor-cow {
    color: #e5e7eb;
  }

  :global(.dark) .sensor-total,
  :global(.dark) .metric-label,
  :global(.dark) .sensor-node-head,
  :global(.dark) .sensor-meta,
  :global(.dark) .sensor-reading,
  :global(.dark) .empty-note {
    color: #94a3b8;
  }

  :global(.dark) .metric-card,
  :global(.dark) .work-panel,
  :global(.dark) .table-shell {
    background: rgb(15 23 42 / 76%);
    border-color: rgb(51 65 85 / 88%);
  }

  :global(.dark) .sensor-node,
  :global(.dark) .risk-item,
  :global(.dark) .sensor-list-item {
    background: rgb(30 41 59 / 72%);
    border-color: rgb(51 65 85 / 88%);
  }

  @media (max-width: 900px) {
    .quality-grid,
    .tab-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .sensor-quality-page {
      padding: 12px;
    }

    .sensor-quality-head {
      align-items: flex-start;
      flex-direction: column;
    }

    .head-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .sensor-list-item {
      flex-direction: column;
    }

    .sensor-reading {
      text-align: left;
    }
  }
</style>
