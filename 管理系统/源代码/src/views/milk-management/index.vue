<template>
  <FcPageShell
    title="泌乳性能"
    status-label="监测状态"
    :status-value="milkStatusText"
    :primary-action-label="milkRecords.length ? '记录泌乳数据' : '补录泌乳数据'"
    primary-action-icon="ri:add-line"
    secondary-action-label="刷新数据"
    secondary-action-icon="ri:refresh-line"
    @primary-action="focusRecords"
    @secondary-action="loadData"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          label="奶厅今日产量"
          :value="todayTotalMilk.toFixed(1)"
          unit="kg"
          :note="`日均 ${milkStats.avgDailyMilk.toFixed(1)} kg，近两周 ${milkStats.weeklyChange}%`"
          icon="ri:drop-line"
        />
        <FcMetricTile
          label="泌乳传感器在线"
          :value="lactationSensorOnlineRate"
          unit="%"
          :note="`${onlineLactationSensors}/${lactationSensors.length || 0} 个泌乳传感器在线`"
          icon="ri:wifi-line"
          tone="teal"
        />
        <FcMetricTile
          label="班次泌乳记录"
          :value="todayMilkingShiftCount"
          :note="`今日 ${todayMilkRecords.length} 条记录，自动挤奶 ${automaticMilkingRecords.length} 条`"
          icon="ri:calendar-schedule-line"
          tone="info"
        />
        <FcMetricTile
          label="异常/缺失"
          :value="reviewQueue.length"
          note="SCC 超标、C 级奶、当日缺记录或同步缺口"
          icon="ri:alarm-warning-line"
          tone="warning"
        />
      </section>
    </template>

    <section class="milk-flow-layout">
      <FcPanel title="奶厅生产总览">
        <div class="decision-grid">
          <article
            v-for="item in productionDecisions"
            :key="item.label"
            class="decision-card"
            :class="item.tone"
          >
            <div class="decision-icon">
              <ArtSvgIcon :icon="item.icon" />
            </div>
            <div>
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
              <p>{{ item.note }}</p>
            </div>
          </article>
        </div>
      </FcPanel>

      <FcPanel title="奶厅设备接入">
        <div v-if="milkParlorDevices.length" class="device-access-list">
          <article
            v-for="device in milkParlorDevices.slice(0, 5)"
            :key="device.id"
            class="device-access-item"
            :class="getDeviceTone(device)"
          >
            <div>
              <span
                >{{ getDeviceTypeText(device) }} · {{ device.location?.penName || '奶厅' }}</span
              >
              <h3>{{ device.name || device.id }}</h3>
              <p
                >{{ device.brand || '设备' }} {{ device.model || '' }} ·
                {{ formatRelative(getDeviceLastSeen(device)) }}</p
              >
            </div>
            <ElTag :type="getDeviceStatusTagType(device.status)">{{
              getDeviceStatusLabel(device.status)
            }}</ElTag>
          </article>
        </div>
        <FcEmptyState
          v-else
          icon="ri:base-station-line"
          title="奶厅设备档案待补齐"
          description="暂无奶厅设备档案。"
        />
      </FcPanel>
    </section>

    <section class="milk-layout">
      <FcPanel title="实时泌乳传感器">
        <div class="sensor-overview-grid">
          <div
            ><span>在线率</span><strong>{{ lactationSensorOnlineRate }}%</strong></div
          >
          <div
            ><span>弱信号</span><strong>{{ weakLactationSensors.length }}</strong></div
          >
          <div
            ><span>低电量</span><strong>{{ lowBatteryLactationSensors.length }}</strong></div
          >
          <div
            ><span>最新上报</span><strong>{{ latestLactationSensorText }}</strong></div
          >
        </div>
        <div v-if="lactationSensors.length" class="sensor-list">
          <article
            v-for="sensor in lactationSensors.slice(0, 5)"
            :key="sensor.id || sensor.sensorId"
            class="sensor-item"
            :class="getSensorTone(sensor)"
          >
            <div>
              <span
                >个体 {{ getCowNumber(sensor.cowId) }} · {{ sensor.sensorId || sensor.id }}</span
              >
              <h3>{{ getSensorStatusLabel(sensor.status) }}</h3>
              <p
                >信号 {{ sensor.signalStrength ?? '-' }} · 电量 {{ sensor.batteryLevel ?? '-' }}% ·
                {{ formatRelative(sensor.lastUpdateTime) }}</p
              >
            </div>
            <ElTag :type="getSensorTagType(sensor)">{{ getSensorRiskText(sensor) }}</ElTag>
          </article>
        </div>
      </FcPanel>

      <FcPanel title="班次泌乳记录" subtitle="班次产量">
        <div class="shift-list">
          <article
            v-for="shift in shiftOverview"
            :key="shift.label"
            class="shift-item"
            :class="shift.tone"
          >
            <div>
              <span>{{ shift.window }}</span>
              <h3>{{ shift.label }}</h3>
              <p
                >{{ shift.records }} 条记录 · {{ shift.automatic }} 条自动挤奶 ·
                {{ shift.abnormal }} 条异常</p
              >
            </div>
            <strong>{{ shift.volume.toFixed(1) }} kg</strong>
          </article>
        </div>
      </FcPanel>
    </section>

    <section class="milk-flow-layout">
      <FcPanel title="泌乳数据采集流程" subtitle="采集链路">
        <div class="batch-timeline">
          <article
            v-for="item in batchTimeline"
            :key="item.label"
            class="batch-step"
            :class="item.tone"
          >
            <div class="batch-icon">
              <ArtSvgIcon :icon="item.icon" />
            </div>
            <div>
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
              <p>{{ item.note }}</p>
            </div>
          </article>
        </div>
      </FcPanel>

      <FcPanel title="异常或缺失数据" subtitle="待处理">
        <div v-if="reviewQueue.length" class="review-list">
          <article
            v-for="item in reviewQueue"
            :key="item.id"
            class="review-item"
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
          title="当前没有泌乳数据复核任务"
          description="暂无异常记录。"
        />
      </FcPanel>
    </section>

    <section class="milk-layout is-wide">
      <FcPanel title="泌乳曲线" subtitle="单牛趋势">
        <template #actions>
          <ElSelect
            v-model="selectedCowForCurve"
            filterable
            placeholder="输入牛号选择"
            class="cow-select"
            :filter-method="filterCurveCowOptions"
            @change="renderLactationCurveForSelection"
            @visible-change="(visible: boolean) => handleCowSelectDropdown('curve', visible)"
          >
            <ElOption
              v-for="cow in visibleCurveCowOptions"
              :key="cow.id"
              :label="`个体 ${cow.cowNumber || cow.id}`"
              :value="cow.id"
            />
          </ElSelect>
        </template>
        <div class="chart-shell">
          <div id="lactation-curve-chart" class="chart-box"></div>
          <FcEmptyState
            v-if="!curveRows.length"
            icon="ri:line-chart-line"
            title="暂无泌乳曲线"
            description="当前个体暂无泌乳记录。"
          />
        </div>
      </FcPanel>

      <FcPanel title="曲线摘要">
        <div class="summary-grid">
          <div
            ><span>峰值产奶</span
            ><strong>{{ curveStats.peakProduction.toFixed(1) }} kg</strong></div
          >
          <div
            ><span>峰值日期</span><strong>{{ curveStats.peakDate || '-' }}</strong></div
          >
          <div
            ><span>累计产量</span
            ><strong>{{ curveStats.totalProduction.toFixed(1) }} kg</strong></div
          >
          <div
            ><span>曲线持久性</span><strong>{{ curveStats.persistency }}%</strong></div
          >
        </div>
      </FcPanel>
    </section>

    <section class="milk-layout is-wide">
      <FcPanel title="奶质指标" subtitle="奶质分布">
        <div class="quality-indicator-grid">
          <div v-for="item in milkQualityIndicators" :key="item.label" :class="item.tone">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <p>{{ item.note }}</p>
          </div>
        </div>
        <div class="quality-board">
          <article
            v-for="grade in gradeDistribution"
            :key="grade.label"
            class="grade-card"
            :class="grade.tone"
          >
            <div>
              <span>{{ grade.label }}</span>
              <strong>{{ grade.count }}</strong>
            </div>
            <ElProgress :percentage="grade.percent" :stroke-width="8" />
          </article>
        </div>
      </FcPanel>

      <FcPanel title="快捷动作">
        <div class="action-stack">
          <button type="button" @click="focusRecords">
            <ArtSvgIcon icon="ri:file-list-3-line" />
            <span>核对泌乳记录</span>
          </button>
          <button type="button" @click="showQualityOnly">
            <ArtSvgIcon icon="ri:shield-check-line" />
            <span>只看异常奶质</span>
          </button>
          <button type="button" @click="resetFilter">
            <ArtSvgIcon icon="ri:refresh-line" />
            <span>清空筛选</span>
          </button>
        </div>
      </FcPanel>
    </section>

    <FcDataTableShell title="泌乳记录核对" subtitle="记录明细">
      <template #filters>
        <div class="filter-bar">
          <ElSelect
            v-model="filterForm.cowId"
            clearable
            filterable
            placeholder="输入牛号筛选"
            :filter-method="filterRecordCowOptions"
            @visible-change="(visible: boolean) => handleCowSelectDropdown('record', visible)"
          >
            <ElOption
              v-for="cow in visibleRecordCowOptions"
              :key="cow.id"
              :label="`个体 ${cow.cowNumber || cow.id}`"
              :value="cow.id"
            />
          </ElSelect>
          <ElDatePicker
            v-model="filterForm.dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
          />
          <ElSelect v-model="filterForm.grade" clearable placeholder="奶质等级">
            <ElOption label="A 级" value="A" />
            <ElOption label="B 级" value="B" />
            <ElOption label="C 级" value="C" />
          </ElSelect>
          <ElButton type="primary" @click="loadData">查询</ElButton>
          <ElButton @click="resetFilter">重置</ElButton>
        </div>
      </template>

      <ElTable
        ref="recordsTableRef"
        :data="visibleFilteredRecords"
        v-loading="loading"
        height="420"
        @wheel.passive="onRecordsTableWheel"
      >
        <ElTableColumn label="个体编号" width="110">
          <template #default="{ row }">{{ getCowNumber(row.cowId) }}</template>
        </ElTableColumn>
        <ElTableColumn label="挤奶时间" min-width="170">
          <template #default="{ row }">{{ formatDateTime(row.milkingTime) }}</template>
        </ElTableColumn>
        <ElTableColumn label="产奶量" width="110">
          <template #default="{ row }"
            >{{ Number(row.volume || row.milkVolume || 0).toFixed(1) }} kg</template
          >
        </ElTableColumn>
        <ElTableColumn label="奶质指标" min-width="230">
          <template #default="{ row }">
            乳脂 {{ row.milkQuality?.fat ?? '-' }}% · 蛋白 {{ row.milkQuality?.protein ?? '-' }}% ·
            SCC
            {{ formatNumber(row.milkQuality?.scc) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="等级" width="100">
          <template #default="{ row }">
            <ElTag :type="getGradeTagType(row.milkQuality?.grade)" size="small"
              >{{ row.milkQuality?.grade || '-' }} 级</ElTag
            >
          </template>
        </ElTableColumn>
        <ElTableColumn label="方式" width="120">
          <template #default="{ row }">{{
            row.milkingMethod === 'automatic' ? '自动挤奶' : '人工挤奶'
          }}</template>
        </ElTableColumn>
        <ElTableColumn label="奶厅设备" min-width="150">
          <template #default="{ row }">{{ getEquipmentName(row.equipmentId) }}</template>
        </ElTableColumn>
        <ElTableColumn label="挤奶员" width="130">
          <template #default="{ row }">{{
            row.milkerId ? getPersonName(row.milkerId) : '-'
          }}</template>
        </ElTableColumn>
      </ElTable>
      <div v-if="filteredRecords.length > visibleFilteredRecords.length" class="load-more-row">
        <ElButton @click="() => loadMoreRecords()"
          >加载更多 {{ visibleFilteredRecords.length }}/{{ filteredRecords.length }}</ElButton
        >
      </div>
    </FcDataTableShell>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import * as echarts from 'echarts'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import FcEmptyState from '@/components/business/fluent-console/FcEmptyState.vue'
  import FcDataTableShell from '@/components/business/fluent-console/FcDataTableShell.vue'
  import * as databaseService from '@/services/数据库'
  import { buildUnifiedDataContext, loadUnifiedMilkRecords } from '@/services/unified-records'
  import { useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'

  defineOptions({ name: 'MilkManagement' })

  type AnyRow = Record<string, any>
  type TagType = 'primary' | 'success' | 'warning' | 'info' | 'danger'

  interface ReviewItem {
    id: string
    kind: string
    title: string
    description: string
    level: string
    tagType: TagType
    tone: 'danger' | 'warning' | 'primary'
  }

  interface ShiftSummary {
    label: string
    window: string
    records: number
    automatic: number
    abnormal: number
    volume: number
    tone: 'stable' | 'warning' | 'danger'
  }

  const loading = ref(false)
  const selectedCowForCurve = ref('')
  const curveCowKeyword = ref('')
  const recordCowKeyword = ref('')
  const recordsTableRef = ref()

  const milkRecords = ref<AnyRow[]>([])
  const lactatingCows = ref<AnyRow[]>([])
  const allPersons = ref<AnyRow[]>([])
  const sensorStatusRows = ref<AnyRow[]>([])
  const hardwareDevices = ref<AnyRow[]>([])
  const syncTasks = ref<AnyRow[]>([])
  const todayTotalMilk = ref(0)
  const chartInstances = ref<Map<string, echarts.ECharts>>(new Map())
  const curveRows = ref<AnyRow[]>([])

  const milkStats = reactive({
    avgDailyMilk: 0,
    weeklyChange: 0,
    qualityRate: 0,
    gradeARate: 0,
    lactatingCows: 0,
    abnormalRecords: 0
  })

  const curveStats = reactive({
    peakProduction: 0,
    peakDate: '',
    totalProduction: 0,
    persistency: 0
  })

  const filterForm = reactive<{
    cowId: string
    dateRange: Date[]
    grade: string
  }>({
    cowId: '',
    dateRange: [],
    grade: ''
  })

  const safeTable = async (tableName: string): Promise<AnyRow[]> => {
    try {
      const rows = await databaseService.getTableDataAsync(tableName, { silent: true })
      return Array.isArray(rows) ? rows : []
    } catch {
      return []
    }
  }

  const filteredRecords = computed(() =>
    milkRecords.value.filter((record) => {
      if (filterForm.cowId && record.cowId !== filterForm.cowId) return false
      if (filterForm.grade && record.milkQuality?.grade !== filterForm.grade) return false
      if (filterForm.dateRange.length === 2) {
        const time = new Date(record.milkingTime).getTime()
        const start = filterForm.dateRange[0].getTime()
        const end = filterForm.dateRange[1].getTime() + 86400000
        if (!Number.isFinite(time) || time < start || time > end) return false
      }
      return true
    })
  )
  const normalizeCowSearch = (value: unknown) =>
    String(value || '')
      .trim()
      .toLowerCase()
  const pickCowOptions = (keyword: string) => {
    const text = normalizeCowSearch(keyword)
    const options = text
      ? lactatingCows.value.filter((cow) =>
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
      : lactatingCows.value
    return options.slice(0, 30)
  }
  const visibleCurveCowOptions = computed(() =>
    pickCowOptions(curveCowKeyword.value || selectedCowForCurve.value)
  )
  const visibleRecordCowOptions = computed(() =>
    pickCowOptions(recordCowKeyword.value || filterForm.cowId)
  )
  const filterCurveCowOptions = (keyword: string) => {
    curveCowKeyword.value = keyword
  }
  const filterRecordCowOptions = (keyword: string) => {
    recordCowKeyword.value = keyword
  }
  const handleCowSelectDropdown = (target: 'curve' | 'record', visible: boolean) => {
    if (visible) return
    if (target === 'curve') curveCowKeyword.value = ''
    if (target === 'record') recordCowKeyword.value = ''
  }
  const {
    visibleItems: visibleFilteredRecords,
    loadMore: loadMoreRecords,
    handleWheel: onRecordsTableWheel
  } = useLazyRenderWindow(filteredRecords, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const abnormalRecords = computed(() =>
    milkRecords.value.filter((record) => isAbnormalRecord(record))
  )

  const todayMilkRecords = computed(() =>
    milkRecords.value.filter((record) => sameDay(record.milkingTime, new Date()))
  )

  const automaticMilkingRecords = computed(() =>
    milkRecords.value.filter((record) => record.milkingMethod === 'automatic')
  )

  const todayMilkingShiftCount = computed(
    () => shiftOverview.value.filter((shift) => shift.records > 0).length
  )

  const milkParlorDevices = computed(() =>
    hardwareDevices.value.filter((device) => isMilkParlorDevice(device))
  )

  const milkSyncTasks = computed(() => syncTasks.value.filter((sync) => isMilkSyncTask(sync)))

  const lactationSensors = computed(() => {
    const lactatingIds = new Set(lactatingCows.value.map((cow) => String(cow.id)))
    const milkCowIds = new Set(milkRecords.value.map((record) => String(record.cowId)))
    return sensorStatusRows.value.filter(
      (sensor) => lactatingIds.has(String(sensor.cowId)) || milkCowIds.has(String(sensor.cowId))
    )
  })

  const onlineLactationSensors = computed(
    () => lactationSensors.value.filter((sensor) => sensor.status === 'online').length
  )

  const lactationSensorOnlineRate = computed(() =>
    lactationSensors.value.length
      ? Math.round((onlineLactationSensors.value / lactationSensors.value.length) * 100)
      : 0
  )

  const weakLactationSensors = computed(() =>
    lactationSensors.value.filter(
      (sensor) => Number(sensor.signalStrength ?? 0) < 65 || sensor.status === 'error'
    )
  )

  const lowBatteryLactationSensors = computed(() =>
    lactationSensors.value.filter((sensor) => Number(sensor.batteryLevel ?? 0) <= 25)
  )

  const latestLactationSensorText = computed(() => {
    const latest = latestTimestamp(lactationSensors.value, [
      'lastUpdateTime',
      'timestamp',
      'updatedAt'
    ])
    return latest ? formatRelative(new Date(latest).toISOString()) : '未上报'
  })

  const milkParlorOnlineDevices = computed(
    () => milkParlorDevices.value.filter((device) => device.status === 'online').length
  )

  const milkSyncErrors = computed(() =>
    milkSyncTasks.value.filter((sync) => sync.status === 'error')
  )

  const shiftOverview = computed<ShiftSummary[]>(() => {
    const shifts = [
      { label: '早班', window: '05:00-11:59', start: 5, end: 12 },
      { label: '中班', window: '12:00-17:59', start: 12, end: 18 },
      { label: '夜班', window: '18:00-04:59', start: 18, end: 29 }
    ]

    return shifts.map((shift) => {
      const rows = todayMilkRecords.value.filter((record) => {
        const hour = new Date(record.milkingTime).getHours()
        const normalizedHour = hour < 5 ? hour + 24 : hour
        return normalizedHour >= shift.start && normalizedHour < shift.end
      })
      const abnormal = rows.filter((record) => isAbnormalRecord(record)).length

      return {
        label: shift.label,
        window: shift.window,
        records: rows.length,
        automatic: rows.filter((record) => record.milkingMethod === 'automatic').length,
        abnormal,
        volume: rows.reduce((sum, record) => sum + getVolume(record), 0),
        tone: abnormal ? 'danger' : rows.length ? 'stable' : 'warning'
      }
    })
  })

  const milkQualityIndicators = computed(() => {
    const recordsWithQuality = milkRecords.value.filter((record) => record.milkQuality)
    const average = (field: string) => {
      const values = recordsWithQuality
        .map((record) => Number(record.milkQuality?.[field]))
        .filter(Number.isFinite)
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
    }
    const sccValues = recordsWithQuality
      .map((record) => Number(record.milkQuality?.scc))
      .filter(Number.isFinite)
    const avgScc = sccValues.length
      ? sccValues.reduce((sum, value) => sum + value, 0) / sccValues.length
      : 0

    return [
      {
        label: '平均乳脂',
        value: `${average('fat').toFixed(2)}%`,
        note: '用于复核泌乳性能和饲喂变化',
        tone: 'stable'
      },
      {
        label: '平均蛋白',
        value: `${average('protein').toFixed(2)}%`,
        note: '低蛋白批次需联动日粮检查',
        tone: average('protein') && average('protein') < 3 ? 'warning' : 'stable'
      },
      {
        label: '平均乳糖',
        value: `${average('lactose').toFixed(2)}%`,
        note: '辅助识别奶质异常和采样偏差',
        tone: 'stable'
      },
      {
        label: '平均 SCC',
        value: avgScc ? formatNumber(Math.round(avgScc)) : '-',
        note: '超过 400,000 进入异常复核',
        tone: avgScc > 400000 ? 'danger' : 'stable'
      }
    ]
  })

  const gradeDistribution = computed(() => {
    const total = Math.max(1, milkRecords.value.length)
    return ['A', 'B', 'C'].map((grade) => {
      const count = milkRecords.value.filter((record) => record.milkQuality?.grade === grade).length
      return {
        label: `${grade} 级奶`,
        count,
        percent: Math.round((count / total) * 100),
        tone: grade === 'A' ? 'success' : grade === 'B' ? 'warning' : 'danger'
      }
    })
  })

  const productionDecisions = computed(() => [
    {
      label: '今日奶厅产量',
      value: `${todayTotalMilk.value.toFixed(1)} kg`,
      note: todayTotalMilk.value
        ? `${todayMilkRecords.value.length} 条班次记录。`
        : '今日暂无泌乳记录。',
      icon: 'ri:drop-line',
      tone: todayTotalMilk.value ? 'stable' : 'warning'
    },
    {
      label: '奶厅设备在线',
      value: `${milkParlorOnlineDevices.value}/${milkParlorDevices.value.length}`,
      note: milkParlorDevices.value.length ? '奶厅设备已接入。' : '暂无奶厅设备档案。',
      icon: 'ri:robot-2-line',
      tone: milkParlorDevices.value.length && milkParlorOnlineDevices.value ? 'stable' : 'warning'
    },
    {
      label: '泌乳传感器',
      value: `${lactationSensorOnlineRate.value}%`,
      note: lactationSensors.value.length
        ? `${weakLactationSensors.value.length} 个弱信号，${lowBatteryLactationSensors.value.length} 个低电量。`
        : '暂无泌乳传感器。',
      icon: 'ri:group-line',
      tone: lactationSensorOnlineRate.value >= 85 ? 'stable' : 'warning'
    },
    {
      label: '奶厅数据同步',
      value: milkSyncTasks.value.length ? `${milkSyncTasks.value.length} 条` : '待接入',
      note: milkSyncErrors.value.length
        ? `${milkSyncErrors.value.length} 条奶量同步任务错误。`
        : '同步正常。',
      icon: 'ri:database-2-line',
      tone: milkSyncErrors.value.length
        ? 'danger'
        : milkSyncTasks.value.length
          ? 'stable'
          : 'warning'
    }
  ])

  const batchTimeline = computed(() => [
    {
      label: '奶厅采集',
      value: todayMilkRecords.value.length ? `${todayMilkRecords.value.length} 条` : '未采集',
      note: todayMilkRecords.value.length
        ? '今日班次泌乳记录已进入生产统计'
        : '未发现今日奶厅泌乳记录',
      icon: 'ri:drop-line',
      tone: todayMilkRecords.value.length ? 'stable' : 'danger'
    },
    {
      label: '泌乳传感器',
      value: `${lactationSensorOnlineRate.value}%`,
      note: lactationSensors.value.length ? '在线率、信号、电量' : '未发现泌乳传感器状态',
      icon: 'ri:wifi-line',
      tone:
        lactationSensorOnlineRate.value >= 85
          ? 'stable'
          : lactationSensors.value.length
            ? 'warning'
            : 'danger'
    },
    {
      label: '泌乳入库',
      value: todayTotalMilk.value ? `${todayTotalMilk.value.toFixed(1)} kg` : '未入库',
      note: todayTotalMilk.value ? '今日产量已入库' : '待同步或补录',
      icon: 'ri:database-2-line',
      tone: todayTotalMilk.value ? 'stable' : 'warning'
    },
    {
      label: '奶质',
      value: `${milkStats.qualityRate}%`,
      note: milkRecords.value.length
        ? `A/B 级记录占比，C 级和 SCC 超标进入复核`
        : '没有奶质数据，暂时不能判断达标率',
      icon: 'ri:shield-check-line',
      tone: abnormalRecords.value.length
        ? 'warning'
        : milkRecords.value.length
          ? 'stable'
          : 'danger'
    },
    {
      label: '复核',
      value: reviewQueue.value.length,
      note: reviewQueue.value.length ? '仍有复核项' : '当前无批次复核事项',
      icon: 'ri:file-search-line',
      tone: reviewQueue.value.length ? 'danger' : 'stable'
    }
  ])

  const reviewQueue = computed<ReviewItem[]>(() => {
    const blockingItems = !milkRecords.value.length
      ? [
          {
            id: 'milk-no-records',
            kind: '同步待核对',
            title: '泌乳记录待补采',
            description: '当前批次缺少泌乳记录，需复核采集设备同步或人工补录状态。',
            level: '待复核',
            tagType: 'danger',
            tone: 'danger'
          } as ReviewItem
        ]
      : []

    const qualityItems = abnormalRecords.value.slice(0, 4).map(
      (record) =>
        ({
          id: `quality-${record.id}`,
          kind: '奶质复核',
          title: `个体 ${getCowNumber(record.cowId)}`,
          description: `等级 ${record.milkQuality?.grade || '-'}，SCC ${formatNumber(record.milkQuality?.scc)}，时间 ${formatDateTime(record.milkingTime)}。`,
          level: '待复核',
          tagType: 'warning',
          tone: 'warning'
        }) as ReviewItem
    )

    const missingToday = lactatingCows.value
      .filter(
        (cow) =>
          !milkRecords.value.some(
            (record) => record.cowId === cow.id && sameDay(record.milkingTime, new Date())
          )
      )
      .slice(0, 3)
      .map(
        (cow) =>
          ({
            id: `missing-${cow.id}`,
            kind: '今日缺记录',
            title: `个体 ${cow.cowNumber || cow.id}`,
            description: '当前泌乳个体今日没有记录，建议确认采集设备或人工补录。',
            level: '待补录',
            tagType: 'danger',
            tone: 'danger'
          }) as ReviewItem
      )

    const deviceItems = !milkParlorDevices.value.length
      ? [
          {
            id: 'milk-no-device',
            kind: '奶厅设备',
            title: '奶厅设备档案待补齐',
            description:
              '硬件设备表暂无 milking_robot 或 milk_volume 能力设备，请检查奶厅硬件同步数据。',
            level: '待接入',
            tagType: 'warning',
            tone: 'warning'
          } as ReviewItem
        ]
      : []

    const sensorItems =
      lactationSensors.value.length && lactationSensorOnlineRate.value < 85
        ? [
            {
              id: 'milk-sensor-online-rate',
              kind: '泌乳传感器',
              title: `在线率 ${lactationSensorOnlineRate.value}% 低于生产阈值`,
              description: `${weakLactationSensors.value.length} 个弱信号或故障，${lowBatteryLactationSensors.value.length} 个低电量。`,
              level: '需处置',
              tagType: 'danger',
              tone: 'danger'
            } as ReviewItem
          ]
        : []

    const syncItems = milkSyncTasks.value.length
      ? milkSyncErrors.value.slice(0, 2).map(
          (sync) =>
            ({
              id: `milk-sync-${sync.id}`,
              kind: '同步状态',
              title: `${sync.sourceDevice || '奶厅设备'} → ${sync.targetSystem || '泌乳记录库'}`,
              description: `${sync.dataType || 'milk_volume'} 同步异常，错误次数 ${sync.errorCount ?? 0}。`,
              level: '待诊断',
              tagType: 'danger',
              tone: 'danger'
            }) as ReviewItem
        )
      : [
          {
            id: 'milk-no-sync',
            kind: '同步状态',
            title: '奶厅同步任务待接入',
            description:
              '当前系统未返回 milk_volume、milk_production_db 或奶厅 API/MQTT 同步任务，请检查同步服务。',
            level: '待接入',
            tagType: 'warning',
            tone: 'warning'
          } as ReviewItem
        ]

    return [
      ...blockingItems,
      ...qualityItems,
      ...missingToday,
      ...deviceItems,
      ...sensorItems,
      ...syncItems
    ].slice(0, 8)
  })

  const milkStatusText = computed(() => {
    if (!milkRecords.value.length) return '待采集/待入库'
    if (!todayTotalMilk.value) return '当日未入库'
    if (abnormalRecords.value.length) return '需复核奶质'
    return `${todayTotalMilk.value.toFixed(1)} kg`
  })

  const loadData = async () => {
    loading.value = true
    try {
      const context = await buildUnifiedDataContext()
      const [records, persons, sensors, devices, synchronizations] = await Promise.all([
        loadUnifiedMilkRecords(context),
        safeTable('persons'),
        safeTable('sensor-status'),
        safeTable('hardware-devices'),
        safeTable('data-synchronizations')
      ])

      milkRecords.value = records
      lactatingCows.value = context.cows.filter(
        (cow) => isLactatingCow(cow) || records.some((record) => sameCow(record, cow))
      )
      allPersons.value = persons
      sensorStatusRows.value = sensors
      hardwareDevices.value = devices
      syncTasks.value = synchronizations
      if (!selectedCowForCurve.value && lactatingCows.value[0])
        selectedCowForCurve.value = lactatingCows.value[0].id

      calculateStats()
      await nextTick()
      renderLactationCurveForSelection()
    } finally {
      loading.value = false
    }
  }

  const calculateStats = () => {
    const records = milkRecords.value
    const todayRecords = records.filter((record) => sameDay(record.milkingTime, new Date()))
    const gradeACount = records.filter((record) => record.milkQuality?.grade === 'A').length
    const qualityCount = records.filter((record) =>
      ['A', 'B'].includes(record.milkQuality?.grade)
    ).length

    todayTotalMilk.value = todayRecords.reduce((sum, record) => sum + getVolume(record), 0)
    milkStats.avgDailyMilk = records.length
      ? records.reduce((sum, record) => sum + getVolume(record), 0) / uniqueDays(records)
      : 0
    milkStats.qualityRate = records.length ? Math.round((qualityCount / records.length) * 100) : 0
    milkStats.gradeARate = records.length ? Math.round((gradeACount / records.length) * 100) : 0
    milkStats.lactatingCows = lactatingCows.value.length
    milkStats.abnormalRecords = abnormalRecords.value.length

    const now = Date.now()
    const weekMs = 7 * 86400000
    const currentWeek = records
      .filter((record) => now - new Date(record.milkingTime).getTime() <= weekMs)
      .reduce((sum, record) => sum + getVolume(record), 0)
    const previousWeek = records
      .filter((record) => {
        const diff = now - new Date(record.milkingTime).getTime()
        return diff > weekMs && diff <= weekMs * 2
      })
      .reduce((sum, record) => sum + getVolume(record), 0)
    milkStats.weeklyChange = previousWeek
      ? Math.round(((currentWeek - previousWeek) / previousWeek) * 100)
      : 0
  }

  const isLactatingCow = (cow: AnyRow) => {
    const type = String(
      cow.type ?? cow.currentStageCode ?? cow.current_stage_code ?? cow.productionStage ?? ''
    )
    const gender = String(cow.gender ?? cow.sex ?? '')
    const status = String(cow.status ?? '')
    return (
      gender.includes('母') ||
      type.includes('泌乳') ||
      type.includes('成母') ||
      type.toLowerCase().includes('lactating') ||
      status.includes('泌乳')
    )
  }

  const isAbnormalRecord = (record: AnyRow) => {
    const scc = Number(record.milkQuality?.scc || 0)
    return scc > 400000 || record.milkQuality?.grade === 'C'
  }

  const isMilkParlorDevice = (device: AnyRow) => {
    const type = String(device.type ?? '')
    const capabilities = Array.isArray(device.capabilities) ? device.capabilities.map(String) : []
    const nameText =
      `${device.name ?? ''} ${device.location?.penName ?? ''} ${device.brand ?? ''}`.toLowerCase()
    return (
      type === 'milking_robot' ||
      capabilities.includes('milk_volume') ||
      nameText.includes('挤奶') ||
      nameText.includes('奶厅') ||
      nameText.includes('milk')
    )
  }

  const isMilkSyncTask = (sync: AnyRow) => {
    const text =
      `${sync.sourceDevice ?? ''} ${sync.targetSystem ?? ''} ${sync.dataType ?? ''} ${JSON.stringify(sync.configuration ?? {})}`.toLowerCase()
    return (
      text.includes('milk') ||
      text.includes('milking') ||
      text.includes('奶') ||
      text.includes('milk_volume')
    )
  }

  const getVolume = (record: AnyRow) =>
    Number(record.volume ?? record.milkVolume ?? record.milkYield ?? record.milk_yield ?? 0)

  const sameCow = (record: AnyRow, cow: AnyRow) => {
    const recordIds = [record.cowId, record.cow_id, record.animalId, record.animal_id].map((item) =>
      String(item || '')
    )
    const recordNumbers = [
      record.cowNumber,
      record.cow_number,
      record.animalNumber,
      record.animal_number
    ].map((item) => String(item || ''))
    const cowIds = [cow.id, cow.cowId, cow.cow_id, cow.animalId, cow.animal_id].map((item) =>
      String(item || '')
    )
    const cowNumbers = [
      cow.cowNumber,
      cow.cow_number,
      cow.animalNumber,
      cow.animal_number,
      cow.number
    ].map((item) => String(item || ''))
    return (
      recordIds.some((id) => id && cowIds.includes(id)) ||
      recordNumbers.some((number) => number && cowNumbers.includes(number))
    )
  }

  const resetFilter = () => {
    filterForm.cowId = ''
    filterForm.dateRange = []
    filterForm.grade = ''
  }

  const showQualityOnly = () => {
    filterForm.grade = 'C'
    ElMessage.info('已筛选 C 级奶记录，可继续按日期或牛只缩小范围')
  }

  const focusRecords = () => {
    ElMessage.success('泌乳记录核对区已准备好，可按个体、日期和等级筛选')
  }

  const renderLactationCurveForSelection = () => {
    const rows = selectedCowForCurve.value
      ? milkRecords.value.filter((record) => record.cowId === selectedCowForCurve.value)
      : milkRecords.value
    renderLactationCurve(rows)
  }

  const getCowNumber = (cowId: string) =>
    lactatingCows.value.find((cow) => cow.id === cowId)?.cowNumber || cowId || '-'
  const getPersonName = (personId: string) =>
    allPersons.value.find((person) => person.id === personId)?.name || personId || '-'
  const getEquipmentName = (equipmentId: string) => {
    if (!equipmentId) return '-'
    return hardwareDevices.value.find((device) => device.id === equipmentId)?.name || equipmentId
  }

  const getDeviceLastSeen = (device: AnyRow) =>
    String(device.lastSeen ?? device.updatedAt ?? device.createdAt ?? '')

  const getDeviceTypeText = (device: AnyRow) => {
    if (device.type === 'milking_robot') return '挤奶机器人'
    if (Array.isArray(device.capabilities) && device.capabilities.includes('milk_volume'))
      return '奶量采集设备'
    return '奶厅设备'
  }

  const getDeviceStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      online: '在线',
      offline: '离线',
      maintenance: '维护中',
      error: '故障'
    }
    return labels[status] || '未知'
  }

  const getDeviceStatusTagType = (status: string): TagType => {
    if (status === 'online') return 'success'
    if (status === 'maintenance') return 'warning'
    if (status === 'error') return 'danger'
    return 'info'
  }

  const getDeviceTone = (device: AnyRow) => {
    if (device.status === 'online') return 'stable'
    if (device.status === 'error') return 'danger'
    return 'warning'
  }

  const getSensorStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      online: '在线采集',
      offline: '离线',
      error: '故障'
    }
    return labels[status] || '未知状态'
  }

  const getSensorTagType = (sensor: AnyRow): TagType => {
    if (sensor.status === 'error') return 'danger'
    if (
      sensor.status === 'offline' ||
      Number(sensor.batteryLevel ?? 0) <= 25 ||
      Number(sensor.signalStrength ?? 0) < 65
    )
      return 'warning'
    return 'success'
  }

  const getSensorTone = (sensor: AnyRow) => {
    const tagType = getSensorTagType(sensor)
    if (tagType === 'danger') return 'danger'
    if (tagType === 'warning') return 'warning'
    return 'stable'
  }

  const getSensorRiskText = (sensor: AnyRow) => {
    if (sensor.status === 'error') return sensor.errorCode || '故障'
    if (sensor.status === 'offline') return '离线'
    if (Number(sensor.batteryLevel ?? 0) <= 25) return '低电量'
    if (Number(sensor.signalStrength ?? 0) < 65) return '弱信号'
    return '正常'
  }

  const getGradeTagType = (grade: string): TagType => {
    if (grade === 'A') return 'success'
    if (grade === 'B') return 'warning'
    if (grade === 'C') return 'danger'
    return 'info'
  }

  const formatDate = (value: string | Date) => {
    return formatDateOnly(value)
  }

  const formatDateTime = (value: string | Date) => {
    return formatDateOnly(value)
  }

  const formatRelative = (value: string | Date) => {
    if (!value) return '暂无记录'
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return '暂无记录'
    const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000))
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes} 分钟前`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours} 小时前`
    return `${Math.round(hours / 24)} 天前`
  }

  const formatNumber = (value: unknown) => {
    const number = Number(value)
    return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '-'
  }

  const sameDay = (value: string | Date, target: Date) => {
    if (!value) return false
    const date = new Date(value)
    return Number.isFinite(date.getTime()) && date.toDateString() === target.toDateString()
  }

  const uniqueDays = (records: AnyRow[]) => {
    const days = new Set(
      records
        .map((record) => new Date(record.milkingTime).toDateString())
        .filter((value) => value !== 'Invalid Date')
    )
    return days.size || 1
  }

  const latestTimestamp = (rows: AnyRow[], keys: string[]) => {
    const times = rows
      .flatMap((row) => keys.map((key) => new Date(String(row[key] ?? '')).getTime()))
      .filter(Number.isFinite)
    return times.length ? Math.max(...times) : null
  }

  const getOrCreateChart = (id: string) => {
    const element = document.getElementById(id)
    if (!element) return null
    const cached = chartInstances.value.get(id)
    if (cached && !cached.isDisposed()) return cached
    const existing = echarts.getInstanceByDom(element)
    if (existing && !existing.isDisposed()) {
      chartInstances.value.set(id, existing)
      return existing
    }
    const chart = echarts.init(element)
    chartInstances.value.set(id, chart)
    return chart
  }

  const renderLactationCurve = (records: AnyRow[]) => {
    const chart = getOrCreateChart('lactation-curve-chart')
    if (!chart) return

    const sorted = [...records].sort(
      (a, b) => new Date(a.milkingTime).getTime() - new Date(b.milkingTime).getTime()
    )
    const rows = sorted.map((record, index) => ({
      label: formatDate(record.milkingTime) || String(index + 1),
      volume: getVolume(record),
      fat: Number(record.milkQuality?.fat || 0),
      protein: Number(record.milkQuality?.protein || 0),
      raw: record
    }))
    curveRows.value = rows

    curveStats.peakProduction = rows.length ? Math.max(...rows.map((row) => row.volume)) : 0
    const peakRow = rows.find((row) => row.volume === curveStats.peakProduction)
    curveStats.peakDate = peakRow ? formatDate(peakRow.raw.milkingTime) : ''
    curveStats.totalProduction = rows.reduce((sum, row) => sum + row.volume, 0)
    curveStats.persistency = rows.length
      ? Math.round(
          (rows.slice(-5).reduce((sum, row) => sum + row.volume, 0) /
            Math.max(
              1,
              rows.slice(0, 5).reduce((sum, row) => sum + row.volume, 0)
            )) *
            100
        )
      : 0

    chart.setOption(
      {
        color: ['#60c041', '#f5a524', '#00a6a6'],
        tooltip: { trigger: 'axis' },
        legend: { data: ['产奶量', '乳脂率', '蛋白率'], top: 8 },
        grid: { left: 44, right: 48, top: 54, bottom: 38, containLabel: true },
        xAxis: { type: 'category', data: rows.map((row) => row.label), axisTick: { show: false } },
        yAxis: [
          {
            type: 'value',
            name: 'kg',
            splitLine: { lineStyle: { color: 'rgba(96, 192, 65, 0.12)' } }
          },
          { type: 'value', name: '%', min: 0, max: 8 }
        ],
        series: [
          {
            name: '产奶量',
            type: 'line',
            smooth: true,
            data: rows.map((row) => row.volume),
            areaStyle: { color: 'rgba(96, 192, 65, 0.16)' },
            lineStyle: { width: 3 }
          },
          { name: '乳脂率', type: 'line', yAxisIndex: 1, data: rows.map((row) => row.fat) },
          { name: '蛋白率', type: 'line', yAxisIndex: 1, data: rows.map((row) => row.protein) }
        ]
      },
      true
    )
  }

  watch(selectedCowForCurve, () => nextTick(renderLactationCurveForSelection))

  onMounted(loadData)

  onBeforeUnmount(() => {
    chartInstances.value.forEach((chart) => chart.dispose())
    chartInstances.value.clear()
  })
</script>

<style scoped lang="scss">
  .fc-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }

  .milk-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 0.5fr);
    gap: 18px;
    align-items: start;
  }

  .milk-flow-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.5fr);
    gap: 18px;
    align-items: start;
  }

  .milk-layout.is-wide {
    grid-template-columns: minmax(0, 1.15fr) minmax(280px, 320px);
  }

  .decision-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .batch-timeline {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
  }

  .batch-step {
    position: relative;
    min-height: 172px;
    padding: 15px;
    background: var(--fluent-surface, #fff);
    border: 1px solid var(--fluent-border);
    border-top: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .batch-step.warning {
    border-top-color: var(--fluent-amber);
  }

  .batch-step.danger {
    border-top-color: var(--fluent-danger);
  }

  .batch-step.stable {
    border-top-color: var(--fluent-primary);
  }

  .batch-icon {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    margin-bottom: 16px;
    color: var(--fluent-primary);
    background: rgb(var(--fluent-primary-rgb) / 10%);
    border-radius: var(--fluent-radius);
  }

  .batch-step.warning .batch-icon {
    color: var(--fluent-amber);
    background: rgb(245 165 36 / 12%);
  }

  .batch-step.danger .batch-icon {
    color: var(--fluent-danger);
    background: rgb(209 52 56 / 10%);
  }

  .decision-card {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    gap: 12px;
    min-height: 150px;
    padding: 15px;
    background: #fff;
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .decision-icon {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    color: var(--fluent-primary);
    background: rgb(var(--fluent-primary-rgb) / 10%);
    border-radius: var(--fluent-radius);
  }

  .decision-card.warning .decision-icon {
    color: var(--fluent-amber);
    background: rgb(245 165 36 / 12%);
  }

  .decision-card.danger .decision-icon {
    color: var(--fluent-danger);
    background: rgb(209 52 56 / 10%);
  }

  .device-access-list,
  .sensor-list,
  .shift-list,
  .quality-indicator-grid {
    display: grid;
    gap: 12px;
  }

  .device-access-item,
  .sensor-item,
  .shift-item,
  .quality-indicator-grid div,
  .sensor-overview-grid div {
    min-width: 0;
    padding: 14px;
    background: rgb(255 255 255 / 42%);
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .device-access-item,
  .sensor-item,
  .shift-item {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .device-access-item.warning,
  .sensor-item.warning,
  .shift-item.warning,
  .quality-indicator-grid .warning {
    border-left-color: var(--fluent-amber);
  }

  .device-access-item.danger,
  .sensor-item.danger,
  .shift-item.danger,
  .quality-indicator-grid .danger {
    border-left-color: var(--fluent-danger);
  }

  .sensor-overview-grid,
  .quality-indicator-grid {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    margin-bottom: 14px;
  }

  .batch-step span,
  .decision-card span,
  .review-item span,
  .summary-grid span,
  .grade-card span,
  .device-access-item span,
  .sensor-item span,
  .shift-item span,
  .quality-indicator-grid span,
  .sensor-overview-grid span {
    display: block;
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .batch-step strong,
  .decision-card strong,
  .summary-grid strong,
  .grade-card strong,
  .shift-item strong,
  .quality-indicator-grid strong,
  .sensor-overview-grid strong {
    display: block;
    margin-top: 8px;
    color: var(--fluent-text);
    font-size: 24px;
    font-weight: 780;
  }

  .batch-step p,
  .decision-card p,
  .review-item p,
  .device-access-item p,
  .sensor-item p,
  .shift-item p,
  .quality-indicator-grid p {
    margin: 8px 0 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
    line-height: 1.6;
  }

  .review-list,
  .summary-grid,
  .quality-board,
  .action-stack {
    display: grid;
    gap: 12px;
  }

  .review-item {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    justify-content: space-between;
    padding: 14px;
    background: rgb(255 255 255 / 42%);
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-amber);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .review-item.danger {
    border-left-color: var(--fluent-danger);
  }

  .review-item h3 {
    margin: 5px 0 0;
    color: var(--fluent-text);
    font-size: 15px;
    font-weight: 760;
  }

  .device-access-item h3,
  .sensor-item h3,
  .shift-item h3 {
    margin: 5px 0 0;
    color: var(--fluent-text);
    font-size: 15px;
    font-weight: 760;
  }

  .chart-shell {
    position: relative;
    min-height: 340px;
    overflow: hidden;
    background: var(--fluent-surface-subtle);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .chart-box {
    width: 100%;
    height: 340px;
  }

  .cow-select {
    width: 220px;
  }

  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .summary-grid div,
  .grade-card {
    min-width: 0;
    padding: 14px;
    background: rgb(255 255 255 / 42%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .quality-board {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .grade-card {
    border-left: 4px solid var(--fluent-primary);
  }

  .grade-card.warning {
    border-left-color: var(--fluent-amber);
  }

  .grade-card.danger {
    border-left-color: var(--fluent-danger);
  }

  .grade-card .el-progress {
    margin-top: 12px;
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

  .filter-bar {
    display: grid;
    grid-template-columns: 180px minmax(260px, 1fr) 140px auto auto;
    gap: 10px;
    align-items: center;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding: 12px 0 0;
  }

  @media (max-width: 1280px) {
    .fc-metric-grid,
    .milk-flow-layout,
    .milk-layout,
    .milk-layout.is-wide,
    .batch-timeline,
    .decision-grid,
    .quality-board,
    .sensor-overview-grid,
    .quality-indicator-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .filter-bar {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .fc-metric-grid,
    .milk-flow-layout,
    .milk-layout,
    .milk-layout.is-wide,
    .decision-grid,
    .batch-timeline,
    .summary-grid,
    .quality-board,
    .sensor-overview-grid,
    .quality-indicator-grid,
    .filter-bar {
      grid-template-columns: 1fr;
    }

    .review-item,
    .device-access-item,
    .sensor-item,
    .shift-item {
      display: grid;
    }

    .cow-select {
      width: 100%;
    }
  }
</style>
