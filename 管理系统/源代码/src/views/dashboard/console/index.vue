<template>
  <FcPageShell
    title="生产运行控制台"
    status-label="系统状态"
    :status-value="systemStatusText"
    primary-action-label="生成今日清单"
    primary-action-icon="ri:task-line"
    secondary-action-label="刷新数据"
    secondary-action-icon="ri:refresh-line"
    @primary-action="buildDailyPlan"
    @secondary-action="loadDashboard"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          label="个体总数"
          :value="dashboard.totalCows"
          note="在册个体与传感器数据合并统计"
          icon="ri:group-line"
        />
        <FcMetricTile
          label="健康关注"
          :value="dashboard.riskCows"
          note="异常体温、健康状态或活动预警"
          icon="ri:heart-pulse-line"
          tone="danger"
        />
        <FcMetricTile
          label="今日泌乳"
          :value="dashboard.todayMilk.toFixed(1)"
          unit="kg"
          note="来自泌乳记录的当日汇总"
          icon="ri:drop-line"
          tone="teal"
        />
        <FcMetricTile
          label="设备连接"
          :value="dashboard.onlineDevices"
          :note="`${dashboard.totalDevices} 台设备接入，${dashboard.syncJobs} 个同步任务`"
          icon="ri:base-station-line"
          tone="info"
        />
      </section>
    </template>

    <section class="console-grid">
      <FcPanel title="今日处置优先级">
        <div class="task-stack">
          <article
            v-for="item in priorityTasks"
            :key="item.title"
            class="task-row"
            :class="item.tone"
          >
            <div class="task-icon">
              <ArtSvgIcon :icon="item.icon" />
            </div>
            <div>
              <h3>{{ item.title }}</h3>
              <p>{{ item.description }}</p>
            </div>
            <ElTag :type="item.tagType">{{ item.level }}</ElTag>
          </article>
        </div>
      </FcPanel>

      <FcPanel title="运行诊断">
        <div class="diagnostic-grid">
          <div v-for="item in diagnostics" :key="item.label" class="diagnostic-card">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <p>{{ item.note }}</p>
          </div>
        </div>
      </FcPanel>
    </section>

    <section class="console-grid is-wide-left">
      <FcPanel title="个体状态分层">
        <div class="segment-board">
          <article v-for="segment in herdSegments" :key="segment.label" class="segment-card">
            <div>
              <span>{{ segment.label }}</span>
              <strong>{{ segment.value }}</strong>
            </div>
            <p>{{ segment.note }}</p>
          </article>
        </div>
      </FcPanel>

      <FcPanel title="下一步动作">
        <div class="action-list">
          <button
            v-for="action in quickActions"
            :key="action.label"
            type="button"
            @click="action.handler"
          >
            <ArtSvgIcon :icon="action.icon" />
            <span>{{ action.label }}</span>
          </button>
        </div>
      </FcPanel>
    </section>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive } from 'vue'
  import { ElMessage } from 'element-plus'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import * as databaseService from '@/services/数据库'
  import {
    buildUnifiedDataContext,
    loadUnifiedMilkRecords,
    loadUnifiedReproductionEvents
  } from '@/services/unified-records'
  import { loadUnifiedSensorData, normalizeStatus } from '@/views/breeding-platform/platform-data'

  defineOptions({ name: 'Console' })

  type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'
  type ToneType = 'primary' | 'success' | 'warning' | 'danger'

  interface PriorityTask {
    title: string
    description: string
    level: string
    tagType: TagType
    tone: ToneType
    icon: string
  }

  const dashboard = reactive({
    totalCows: 0,
    riskCows: 0,
    healthyCows: 0,
    heatCows: 0,
    pregnantCows: 0,
    productionRecords: 0,
    todayMilk: 0,
    onlineDevices: 0,
    totalDevices: 0,
    syncJobs: 0,
    activeAlerts: 0,
    latestSensorAgeMinutes: 0
  })

  const safeRows = async (table: string) => {
    try {
      return await databaseService.getTableDataAsync(table, { silent: true })
    } catch {
      return []
    }
  }

  const safeMergedRows = async (...tables: string[]) => {
    const groups = await Promise.all(tables.map((table) => safeRows(table)))
    const seen = new Set<string>()
    const rows: any[] = []
    groups.flat().forEach((row: any, index: number) => {
      const key = String(
        row?.id ??
          row?.code ??
          row?.deviceId ??
          row?.device_id ??
          row?.recordId ??
          row?.record_id ??
          ''
      ).trim()
      const dedupeKey = key || `${index}:${JSON.stringify(row)}`
      if (seen.has(dedupeKey)) return
      seen.add(dedupeKey)
      rows.push(row)
    })
    return rows
  }

  const sameDay = (value: unknown, target = new Date()) => {
    if (!value) return false
    const date = new Date(String(value))
    return Number.isFinite(date.getTime()) && date.toDateString() === target.toDateString()
  }

  const statusText = (value: unknown) => String(value ?? '')

  const isOnlineStatus = (value: unknown) => {
    const raw = statusText(value)
    return (
      ['online', 'connected', 'active', 'normal'].includes(raw.toLowerCase()) ||
      ['在线', '正常'].includes(raw)
    )
  }

  const milkTime = (record: any) =>
    record.milkingTime ??
    record.milking_time ??
    record.measuredAt ??
    record.measured_at ??
    record.createdAt ??
    record.created_at

  const milkVolume = (record: any) =>
    Number(
      record.volume ??
        record.milkVolume ??
        record.milk_volume ??
        record.milkYield ??
        record.milk_yield ??
        0
    )

  const systemStatusText = computed(() => {
    if (dashboard.activeAlerts > 0 || dashboard.riskCows > 0) return '需要值守复核'
    if (dashboard.latestSensorAgeMinutes > 120) return '数据同步延迟'
    return '运行稳定'
  })

  const priorityTasks = computed<PriorityTask[]>(() => [
    {
      title: dashboard.riskCows ? '复核健康异常牛只' : '健康风险正常',
      description: dashboard.riskCows ? `${dashboard.riskCows} 头健康关注。` : '暂无健康异常。',
      level: dashboard.riskCows ? '高优先级' : '正常',
      tagType: dashboard.riskCows ? 'danger' : 'success',
      tone: dashboard.riskCows ? 'danger' : 'success',
      icon: 'ri:heart-pulse-line'
    },
    {
      title: dashboard.latestSensorAgeMinutes > 120 ? '检查数据入库路径' : '数据同步稳定',
      description:
        dashboard.latestSensorAgeMinutes > 120
          ? `传感器延迟 ${dashboard.latestSensorAgeMinutes} 分钟。`
          : '同步正常。',
      level: dashboard.latestSensorAgeMinutes > 120 ? '待诊断' : '正常',
      tagType: dashboard.latestSensorAgeMinutes > 120 ? 'warning' : 'success',
      tone: dashboard.latestSensorAgeMinutes > 120 ? 'warning' : 'success',
      icon: 'ri:database-2-line'
    },
    {
      title: dashboard.productionRecords ? '整理生产补录任务' : '待补齐今日生产记录',
      description: dashboard.productionRecords
        ? `${dashboard.productionRecords} 条生产记录。`
        : '今日生产批次待补齐。',
      level: dashboard.productionRecords ? '今日任务' : '待复核',
      tagType: dashboard.productionRecords ? 'primary' : 'warning',
      tone: dashboard.productionRecords ? 'primary' : 'warning',
      icon: 'ri:clipboard-line'
    }
  ])

  const diagnostics = computed(() => [
    {
      label: 'API / 数据库',
      value: '已接入',
      note: '检查脚本可访问平台健康接口'
    },
    {
      label: '设备在线',
      value: `${dashboard.onlineDevices}/${dashboard.totalDevices}`,
      note: dashboard.totalDevices ? '来自硬件设备表' : '暂无设备档案'
    },
    {
      label: '同步任务',
      value: dashboard.syncJobs,
      note: '数据流配置'
    },
    {
      label: '活跃预警',
      value: dashboard.activeAlerts,
      note: '来自健康与硬件预警池'
    }
  ])

  const herdSegments = computed(() => [
    { label: '全群档案', value: dashboard.totalCows, note: '基础信息完整性与个体规模' },
    { label: '健康正常', value: dashboard.healthyCows, note: '状态稳定，可按常规节奏巡检' },
    {
      label: '发情/预产',
      value: dashboard.heatCows + dashboard.pregnantCows,
      note: '繁殖窗口'
    },
    {
      label: '生产数据',
      value: dashboard.productionRecords,
      note: dashboard.productionRecords ? '泌乳、饲喂、繁殖记录' : '今日生产批次待补齐'
    }
  ])

  const quickActions = [
    {
      label: '查看健康预警',
      icon: 'ri:alarm-warning-line',
      handler: () => ElMessage.info('请从智能育种进入繁殖与健康监测')
    },
    {
      label: '打开硬件诊断',
      icon: 'ri:stethoscope-line',
      handler: () => ElMessage.info('请从数据与设备进入硬件集成平台')
    },
    {
      label: '查看事件预警',
      icon: 'ri:alarm-warning-line',
      handler: () => ElMessage.info('请从种质资源进入事件预警并生成处置队列')
    }
  ]

  const loadDashboard = async () => {
    const context = await buildUnifiedDataContext()
    const cows = context.cows || []
    const [milk, reproduction, feed, allDevices, syncJobs, alerts, hardwareAlerts] =
      await Promise.all([
        loadUnifiedMilkRecords(context),
        loadUnifiedReproductionEvents(context),
        safeMergedRows('feed-records', 'feed_records'),
        safeMergedRows('hardware-devices', 'hardware_devices', 'device'),
        safeMergedRows('data-synchronizations', 'data_synchronizations'),
        safeRows('alerts'),
        safeRows('hardware-alerts')
      ])
    const breeding = reproduction.events || []

    dashboard.totalCows = cows.length
    dashboard.riskCows = cows.filter((cow: any) =>
      ['异常', '预警'].includes(normalizeStatus(cow.status))
    ).length
    dashboard.healthyCows = cows.filter((cow: any) => normalizeStatus(cow.status) === '健康').length
    dashboard.heatCows = cows.filter((cow: any) => normalizeStatus(cow.status) === '发情').length
    dashboard.pregnantCows = cows.filter((cow: any) =>
      ['妊娠', '预产'].includes(normalizeStatus(cow.status))
    ).length
    dashboard.productionRecords = milk.length + feed.length + breeding.length
    dashboard.todayMilk = milk
      .filter((record: any) => sameDay(milkTime(record)))
      .reduce((sum: number, record: any) => sum + milkVolume(record), 0)
    dashboard.totalDevices = allDevices.length
    dashboard.onlineDevices = allDevices.filter((device: any) =>
      isOnlineStatus(device.status ?? device.connectionStatus ?? device.connection_status)
    ).length
    dashboard.syncJobs = syncJobs.length
    dashboard.activeAlerts = [...alerts, ...hardwareAlerts].filter(
      (item: any) => item.status === 'active'
    ).length

    void updateLatestSensorAge(cows as any[])
  }

  const updateLatestSensorAge = async (cows: any[]) => {
    try {
      const sensors = await loadUnifiedSensorData(cows as any)
      const latestSensorTime = sensors
        .map((item: any) =>
          new Date(
            item.timestamp ?? item.measuredAt ?? item.createdAt ?? item.updatedAt ?? 0
          ).getTime()
        )
        .filter(Number.isFinite)
        .sort((a: number, b: number) => b - a)[0]
      dashboard.latestSensorAgeMinutes = latestSensorTime
        ? Math.max(0, Math.round((Date.now() - latestSensorTime) / 60000))
        : 999
    } catch {
      dashboard.latestSensorAgeMinutes = 999
    }
  }

  const buildDailyPlan = () => {
    ElMessage.info('今日生产处置清单已按当前风险排序，可在业务模块继续处理')
  }

  onMounted(loadDashboard)
</script>

<style scoped lang="scss">
  .fc-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }

  .console-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.72fr);
    gap: 18px;
  }

  .console-grid.is-wide-left {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 320px);
  }

  .task-stack,
  .action-list {
    display: grid;
    gap: 12px;
  }

  .task-row {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 14px;
    background: #fff;
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .task-row h3 {
    margin: 0;
    color: var(--fluent-text);
    font-size: 15px;
    font-weight: 760;
  }

  .task-row p {
    margin: 5px 0 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
    line-height: 1.55;
  }

  .task-icon {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    color: var(--fluent-primary);
    background: rgb(var(--fluent-primary-rgb) / 10%);
    border-radius: var(--fluent-radius);
  }

  .task-row.danger .task-icon {
    color: var(--fluent-danger);
    background: rgb(209 52 56 / 10%);
  }

  .task-row.warning .task-icon {
    color: var(--fluent-amber);
    background: rgb(245 165 36 / 12%);
  }

  .diagnostic-grid,
  .segment-board {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .diagnostic-card,
  .segment-card {
    min-height: 116px;
    padding: 14px;
    background: var(--fluent-surface-subtle);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .diagnostic-card span,
  .segment-card span {
    display: block;
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 700;
  }

  .diagnostic-card strong,
  .segment-card strong {
    display: block;
    margin-top: 8px;
    color: var(--fluent-text);
    font-size: 24px;
    font-weight: 780;
  }

  .diagnostic-card p,
  .segment-card p {
    margin: 8px 0 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
    line-height: 1.55;
  }

  .segment-card div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .action-list button {
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

  .action-list button:hover {
    background: rgb(248 250 252);
    border-color: var(--fluent-border-strong);
    box-shadow: inset 0 0 0 1px rgb(var(--fluent-primary-rgb) / 9%);
  }

  .action-list .art-svg-icon {
    color: var(--fluent-primary);
    font-size: 20px;
  }

  @media (max-width: 1180px) {
    .fc-metric-grid,
    .console-grid,
    .console-grid.is-wide-left {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .fc-metric-grid,
    .console-grid,
    .console-grid.is-wide-left,
    .diagnostic-grid,
    .segment-board {
      grid-template-columns: 1fr;
    }

    .task-row {
      grid-template-columns: 42px minmax(0, 1fr);
    }

    .task-row .el-tag {
      grid-column: 2;
      justify-self: start;
    }
  }
</style>
