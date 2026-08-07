<template>
  <div class="server-status">
    <div class="status-header">
      <div>
        <h1>{{ ui('服务器运行状态', 'Server status') }}</h1>
      </div>
      <div class="status-actions">
        <div class="last-refresh">
          <span>{{ ui('最后刷新', 'Last refreshed') }}</span>
          <strong>{{ status ? formatDateTime(status.generatedAt) : '--' }}</strong>
        </div>
        <div class="refresh-switch">
          <span>{{ ui('自动刷新', 'Auto refresh') }}</span>
          <ElSwitch v-model="autoRefresh" />
        </div>
        <ElButton :loading="loading" @click="loadStatus()">
          <ArtSvgIcon icon="ri:refresh-line" class="button-icon" />
          {{ ui('刷新', 'Refresh') }}
        </ElButton>
      </div>
    </div>

    <div v-if="errorMessage" class="status-error">
      <ArtSvgIcon icon="ri:error-warning-line" />
      <span>{{ errorMessage }}</span>
    </div>

    <div
      v-if="status?.readiness"
      class="readiness-band"
      :class="`readiness-band--${status.readiness.level}`"
    >
      <div>
        <h2>{{ readinessTitle }}</h2>
        <p>{{ readinessSummary }}</p>
      </div>
      <div class="readiness-score">
        <span>{{ ui('就绪度', 'Readiness') }}</span>
        <strong>{{ status.readiness.percent }}%</strong>
        <small>{{ readinessScoreText }}</small>
      </div>
      <div class="readiness-risks">
        <ElTag :type="readinessTagType">{{ readinessTagText }}</ElTag>
        <span>{{ readinessRiskText }}</span>
      </div>
    </div>

    <div class="summary-grid">
      <div
        v-for="item in statusCards"
        :key="item.key"
        class="status-card"
        :class="[item.state, `status-card--${item.key}`]"
      >
        <div class="card-topline">
          <div class="card-title">
            <ArtSvgIcon :icon="item.icon" />
            <span>{{ item.title }}</span>
          </div>
          <ElTag size="small" :type="item.tagType">{{ item.tagText }}</ElTag>
        </div>
        <div class="card-main">{{ item.main }}</div>
        <div class="card-detail">{{ item.detail }}</div>
      </div>
    </div>

    <div class="detail-grid">
      <div class="status-panel status-panel--wide">
        <div class="panel-header">
          <div>
            <h2>{{ ui('投产检查项', 'Production checks') }}</h2>
          </div>
          <ElTag :type="readinessTagType">{{ readinessTagText }}</ElTag>
        </div>
        <div class="readiness-list">
          <div
            v-for="item in status?.readiness?.items || []"
            :key="item.key"
            class="readiness-row"
            :class="`readiness-row--${item.state}`"
          >
            <span class="readiness-dot"></span>
            <strong>{{ readinessItemLabel(item) }}</strong>
            <p>{{ readinessItemDetail(item) }}</p>
          </div>
        </div>
      </div>

      <div class="status-panel">
        <div class="panel-header">
          <div>
            <h2>{{ ui('后端进程', 'Backend process') }}</h2>
          </div>
          <ElTag :type="status?.backend.ok ? 'success' : 'danger'">
            {{ status?.backend.ok ? ui('在线', 'Online') : ui('离线', 'Offline') }}
          </ElTag>
        </div>
        <div class="metric-list">
          <div class="metric-row">
            <span>{{ ui('API 端口', 'API port') }}</span>
            <strong>{{ status?.backend.port ?? '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ ui('进程 PID', 'Process PID') }}</span>
            <strong>{{ status?.backend.pid ?? '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ ui('运行时长', 'Uptime') }}</span>
            <strong>{{ formatUptime(status?.backend.uptimeSeconds) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ ui('Node 版本', 'Node version') }}</span>
            <strong>{{ status?.backend.nodeVersion || '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ ui('认证模式', 'Authentication mode') }}</span>
            <strong>{{ status?.backend.authMode || '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ ui('会话数', 'Active sessions') }}</span>
            <strong>{{ status?.backend.activeSessions ?? '--' }}</strong>
          </div>
        </div>
        <div class="memory-block">
          <div class="memory-line">
            <span>{{ ui('堆内存', 'Heap memory') }}</span>
            <span
              >{{ formatMemory(status?.backend.memoryMb?.heapUsed) }} /
              {{ formatMemory(status?.backend.memoryMb?.heapTotal) }}</span
            >
          </div>
          <ElProgress :percentage="heapUsagePercent" :stroke-width="8" />
          <div class="memory-line small">
            <span>RSS</span>
            <span>{{ formatMemory(status?.backend.memoryMb?.rss) }}</span>
          </div>
        </div>
      </div>

      <div class="status-panel">
        <div class="panel-header">
          <div>
            <h2>{{ ui('数据库', 'Database') }}</h2>
            <p>{{ databaseAddress }}</p>
          </div>
          <ElTag :type="status?.database.ok ? 'success' : 'danger'">
            {{ status?.database.ok ? ui('已连接', 'Connected') : ui('异常', 'Error') }}
          </ElTag>
        </div>
        <div class="database-latency">
          <span>{{ ui('查询延迟', 'Query latency') }}</span>
          <strong>{{ status?.database.latencyMs ?? '--' }} ms</strong>
        </div>
        <div v-if="status?.database.error" class="inline-error">
          {{ status.database.error }}
        </div>
        <div class="lazy-table-note">
          第 {{ databaseCountStartIndex + 1 }}-{{ databaseCountEndIndex }} 条 / 共
          {{ databaseCountTotalCount }} 条
        </div>
        <ElTable
          :data="visibleDatabaseCounts"
          height="294"
          style="width: 100%"
          @wheel.passive="onDatabaseCountTableWheel"
        >
          <ElTableColumn label="数据表" min-width="150">
            <template #default="{ row }">
              <div class="table-name">
                <span>{{ getTableTitle(row.table) }}</span>
                <small>{{ row.table }}</small>
              </div>
            </template>
          </ElTableColumn>
          <ElTableColumn label="状态" width="90">
            <template #default="{ row }">
              <ElTag size="small" :type="row.ok ? 'success' : 'danger'">
                {{ row.ok ? '正常' : '异常' }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn label="记录数" width="100" align="right">
            <template #default="{ row }">
              {{ row.total ?? '--' }}
            </template>
          </ElTableColumn>
        </ElTable>
      </div>

      <div class="status-panel">
        <div class="panel-header">
          <div>
            <h2>MQTT 接口</h2>
            <p>{{ mqttAddress }}</p>
          </div>
          <ElTag :type="mqttTagType">{{ mqttTagText }}</ElTag>
        </div>
        <div class="metric-list">
          <div class="metric-row">
            <span>订阅主题</span>
            <strong>{{ status?.mqtt.topic || '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>当前连接</span>
            <strong>{{ status?.mqtt.connectedClients ?? '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>累计连接</span>
            <strong>{{ status?.mqtt.totalClients ?? '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>接收消息</span>
            <strong>{{ status?.mqtt.receivedCount ?? '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>入库消息</span>
            <strong>{{ status?.mqtt.ingestedCount ?? '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>忽略消息</span>
            <strong>{{ status?.mqtt.ignoredCount ?? '--' }}</strong>
          </div>
        </div>
        <div class="last-message">
          <div>
            <span>最近主题</span>
            <strong>{{ status?.mqtt.lastTopic || '--' }}</strong>
          </div>
          <div>
            <span>最近牛号</span>
            <strong>{{ status?.mqtt.lastCowNumber || '--' }}</strong>
          </div>
          <div>
            <span>最近入库</span>
            <strong>{{ formatDateTime(status?.mqtt.lastIngestAt) }}</strong>
          </div>
        </div>
        <div v-if="status?.mqtt.lastError" class="inline-error">
          {{ status.mqtt.lastError }}
        </div>
      </div>

      <div class="status-panel">
        <div class="panel-header">
          <div>
            <h2>数据新鲜度</h2>
          </div>
          <ElTag :type="dataFreshnessTagType">{{ dataFreshnessTagText }}</ElTag>
        </div>
        <div class="metric-list">
          <div class="metric-row">
            <span>传感器总数</span>
            <strong>{{ status?.dataFreshness?.totalCount ?? '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>近 24 小时</span>
            <strong>{{ status?.dataFreshness?.last24hCount ?? '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>最近牛号</span>
            <strong>{{ status?.dataFreshness?.latest?.cowNumber || '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>最近体温</span>
            <strong>{{ formatTemperature(status?.dataFreshness?.latest?.temperature) }}</strong>
          </div>
          <div class="metric-row">
            <span>最近采集</span>
            <strong>{{ formatDateTime(status?.dataFreshness?.latest?.timestamp) }}</strong>
          </div>
          <div class="metric-row">
            <span>距今</span>
            <strong>{{ formatAgeMinutes(status?.dataFreshness?.ageMinutes) }}</strong>
          </div>
        </div>
        <div v-if="status?.dataFreshness?.error" class="inline-error">
          {{ status.dataFreshness.error }}
        </div>
      </div>

      <div class="status-panel">
        <div class="panel-header">
          <div>
            <h2>预警队列</h2>
          </div>
          <ElTag :type="alertTagType">{{ alertTagText }}</ElTag>
        </div>
        <div class="alert-severity-grid">
          <div>
            <span>严重</span>
            <strong>{{ status?.alerts?.bySeverity.critical ?? '--' }}</strong>
          </div>
          <div>
            <span>高</span>
            <strong>{{ status?.alerts?.bySeverity.high ?? '--' }}</strong>
          </div>
          <div>
            <span>中</span>
            <strong>{{ status?.alerts?.bySeverity.medium ?? '--' }}</strong>
          </div>
          <div>
            <span>低</span>
            <strong>{{ status?.alerts?.bySeverity.low ?? '--' }}</strong>
          </div>
        </div>
        <div class="metric-list">
          <div class="metric-row">
            <span>全部预警</span>
            <strong>{{ status?.alerts?.total ?? '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>活跃预警</span>
            <strong>{{ status?.alerts?.active ?? '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>已确认</span>
            <strong>{{ status?.alerts?.acknowledged ?? '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>已解决</span>
            <strong>{{ status?.alerts?.resolved ?? '--' }}</strong>
          </div>
        </div>
        <div class="last-message">
          <div>
            <span>最近牛号</span>
            <strong>{{ status?.alerts?.latest?.cowNumber || '--' }}</strong>
          </div>
          <div>
            <span>最近级别</span>
            <strong>{{ getSeverityLabel(status?.alerts?.latest?.severity) }}</strong>
          </div>
          <div>
            <span>最近时间</span>
            <strong>{{ formatDateTime(status?.alerts?.latest?.alertTime) }}</strong>
          </div>
          <div>
            <span>最近标题</span>
            <strong>{{ status?.alerts?.latest?.title || '--' }}</strong>
          </div>
        </div>
        <div v-if="status?.alerts?.error" class="inline-error">
          {{ status.alerts.error }}
        </div>
      </div>

      <div class="status-panel">
        <div class="panel-header">
          <div>
            <h2>前端代理</h2>
          </div>
          <ElTag :type="status ? 'success' : 'danger'">
            {{ status ? '正常' : '未连通' }}
          </ElTag>
        </div>
        <div class="metric-list">
          <div class="metric-row">
            <span>前端地址</span>
            <strong>{{ clientAddress }}</strong>
          </div>
          <div class="metric-row">
            <span>后端入口</span>
            <strong>{{ status?.frontend.requestHost || '--' }}</strong>
          </div>
          <div class="metric-row">
            <span>代理接口</span>
            <strong>/api/system/status</strong>
          </div>
          <div class="metric-row">
            <span>轮询间隔</span>
            <strong>5 秒</strong>
          </div>
          <div class="metric-row">
            <span>页面状态</span>
            <strong>{{ status ? '已加载' : '等待接口' }}</strong>
          </div>
        </div>
        <div class="health-score">
          <span>投产就绪度</span>
          <strong>{{ readinessScoreText }}</strong>
        </div>
        <ElProgress
          :percentage="readinessPercent"
          :stroke-width="10"
          :status="readinessPercent === 100 ? 'success' : undefined"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import api from '@/utils/http'
  import { useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'

  const isBackendMode = import.meta.env.VITE_ACCESS_MODE === 'backend'
  const { locale } = useI18n()
  const ui = (zh: string, en: string) => (locale.value.startsWith('zh') ? zh : en)

  interface TableCountStatus {
    table: string
    label: string
    ok: boolean
    total: number | null
    error: string | null
  }

  type ReadinessLevel = 'ready' | 'warning' | 'blocked'
  type ReadinessItemState = 'pass' | 'warning' | 'fail'

  interface DataFreshnessStatus {
    ok: boolean
    state: 'fresh' | 'stale' | 'empty' | 'error'
    staleAfterMinutes: number
    totalCount: number
    last24hCount: number
    ageMinutes: number | null
    latest: {
      id: string | null
      cowId: string | null
      cowNumber: string | null
      timestamp: string | null
      createdAt: string | null
      temperature: number | null
    } | null
    error: string | null
  }

  interface AlertStatus {
    ok: boolean
    total: number
    active: number
    acknowledged: number
    resolved: number
    bySeverity: {
      critical: number
      high: number
      medium: number
      low: number
      other: number
    }
    latest: {
      id: string | null
      cowId: string | null
      cowNumber: string | null
      alertTime: string | null
      severity: string | null
      alertType: string | null
      title: string | null
      status: string | null
      createdAt: string | null
    } | null
    error: string | null
  }

  interface ReadinessStatus {
    level: ReadinessLevel
    score: number
    total: number
    percent: number
    summary: string
    items: Array<{
      key: string
      label: string
      state: ReadinessItemState
      detail: string
    }>
    risks: Array<{
      key: string
      label: string
      state: ReadinessItemState
      detail: string
    }>
  }

  interface SystemStatus {
    generatedAt: string
    environment?: {
      nodeEnv: string
      timezone: string
      authMode: string
      mqttEnabled: boolean
      dataStaleAfterMinutes: number
    }
    backend: {
      ok: boolean
      service: string
      port: number
      pid: number
      startedAt: string
      uptimeSeconds: number
      nodeVersion: string
      platform: string
      memoryMb: Record<string, number>
      authMode: string
      activeSessions: number
    }
    frontend: {
      apiProxyReachable: boolean
      requestHost: string
      requestOrigin: string
      userAgent: string
    }
    database: {
      ok: boolean
      latencyMs: number | null
      config: {
        host: string
        port: number
        user: string
        database: string
        connectionLimit: number
      }
      counts: TableCountStatus[]
      error: string | null
    }
    mqtt: {
      enabled: boolean
      listening: boolean
      host: string
      port: number
      topic: string
      startedAt: string | null
      connectedClients: number
      totalClients: number
      receivedCount: number
      ingestedCount: number
      ignoredCount: number
      errorCount: number
      lastTopic: string | null
      lastCowNumber: string | null
      lastMessageAt: string | null
      lastIngestAt: string | null
      lastError: string | null
    }
    dataFreshness?: DataFreshnessStatus
    alerts?: AlertStatus
    readiness?: ReadinessStatus
  }

  type TagType = 'success' | 'warning' | 'danger' | 'info'

  const status = ref<SystemStatus | null>(null)
  const loading = ref(false)
  const autoRefresh = ref(true)
  const errorMessage = ref('')
  let refreshTimer: number | null = null

  const databaseCounts = computed(() => status.value?.database.counts || [])
  const {
    visibleItems: visibleDatabaseCounts,
    startIndex: databaseCountStartIndex,
    endIndex: databaseCountEndIndex,
    totalCount: databaseCountTotalCount,
    handleWheel: onDatabaseCountTableWheel
  } = useLazyRenderWindow(databaseCounts, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const tableTitleMap: Record<string, string> = {
    cows: '牛只档案',
    sensors: '传感器数据',
    alerts: '预警记录',
    health_scores: '健康评分',
    hardware_devices: '硬件设备',
    predictive_models: '预测模型'
  }

  const statusCards = computed(() => {
    const data = status.value
    return [
      {
        key: 'frontend',
        title: ui('前端代理', 'Frontend proxy'),
        icon: 'ri:window-line',
        state: data ? 'online' : 'offline',
        tagText: data ? ui('在线', 'Online') : ui('离线', 'Offline'),
        tagType: data ? 'success' : 'danger',
        main: clientAddress.value,
        detail: data
          ? ui('页面到后端 API 转发正常', 'Frontend-to-backend API proxy operational')
          : ui('等待状态接口响应', 'Waiting for status response')
      },
      {
        key: 'backend',
        title: ui('后端服务', 'Backend service'),
        icon: 'ri:server-line',
        state: data?.backend.ok ? 'online' : 'offline',
        tagText: data?.backend.ok ? ui('在线', 'Online') : ui('离线', 'Offline'),
        tagType: data?.backend.ok ? 'success' : 'danger',
        main: data ? `:${data.backend.port}` : '--',
        detail: data
          ? `${ui('已运行', 'Uptime')} ${formatUptime(data.backend.uptimeSeconds)}`
          : ui('未取得运行信息', 'Runtime information unavailable')
      },
      {
        key: 'database',
        title: ui('业务数据库', 'Business database'),
        icon: 'ri:database-2-line',
        state: data?.database.ok ? 'online' : 'offline',
        tagText: data?.database.ok ? ui('已连接', 'Connected') : ui('异常', 'Error'),
        tagType: data?.database.ok ? 'success' : 'danger',
        main: data?.database.config
          ? `${data.database.config.host}:${data.database.config.port}`
          : '--',
        detail: data?.database.ok
          ? `${data.database.config.database} · ${ui('延迟', 'latency')} ${data.database.latencyMs} ms`
          : data?.database.error || ui('未连接', 'Disconnected')
      },
      {
        key: 'mqtt',
        title: ui('MQTT 接入', 'MQTT interface'),
        icon: 'ri:broadcast-line',
        state: data?.mqtt.listening ? 'online' : data?.mqtt.enabled ? 'warning' : 'offline',
        tagText: mqttTagText.value,
        tagType: mqttTagType.value,
        main: data?.mqtt.enabled ? `:${data.mqtt.port}` : '--',
        detail: data?.mqtt.listening
          ? locale.value.startsWith('zh')
            ? `累计接收 ${data.mqtt.receivedCount} 条`
            : `${data.mqtt.receivedCount} messages received`
          : data?.mqtt.lastError || ui('未监听', 'Not listening')
      },
      {
        key: 'freshness',
        title: ui('数据新鲜度', 'Data freshness'),
        icon: 'ri:pulse-line',
        state: dataFreshnessState.value,
        tagText: dataFreshnessTagText.value,
        tagType: dataFreshnessTagType.value,
        main: data?.dataFreshness ? formatAgeMinutes(data.dataFreshness.ageMinutes) : '--',
        detail: data?.dataFreshness
          ? locale.value.startsWith('zh')
            ? `近24小时 ${data.dataFreshness.last24hCount} 条 · 总计 ${data.dataFreshness.totalCount} 条`
            : `${data.dataFreshness.last24hCount} in 24 h · ${data.dataFreshness.totalCount} total`
          : ui('等待状态接口返回', 'Waiting for status response')
      },
      {
        key: 'alerts',
        title: ui('预警队列', 'Alert queue'),
        icon: 'ri:alarm-warning-line',
        state: alertState.value,
        tagText: alertTagText.value,
        tagType: alertTagType.value,
        main: data?.alerts
          ? locale.value.startsWith('zh')
            ? `${data.alerts.active} 条活跃`
            : `${data.alerts.active} active`
          : '--',
        detail: data?.alerts
          ? locale.value.startsWith('zh')
            ? `严重 ${data.alerts.bySeverity.critical} · 高 ${data.alerts.bySeverity.high}`
            : `Critical ${data.alerts.bySeverity.critical} · High ${data.alerts.bySeverity.high}`
          : ui('等待预警统计', 'Waiting for alert statistics')
      }
    ] as Array<{
      key: string
      title: string
      icon: string
      state: string
      tagText: string
      tagType: TagType
      main: string
      detail: string
    }>
  })

  const databaseAddress = computed(() => {
    const db = status.value?.database.config
    return db ? `${db.user}@${db.host}:${db.port}/${db.database}` : '--'
  })

  const clientAddress = computed(() => {
    if (typeof window === 'undefined') return '--'
    return window.location.host || '--'
  })

  const mqttAddress = computed(() => {
    const mqtt = status.value?.mqtt
    return mqtt ? `mqtt://${mqtt.host}:${mqtt.port}` : '--'
  })

  const mqttTagText = computed(() => {
    const mqtt = status.value?.mqtt
    if (!mqtt) return ui('未知', 'Unknown')
    if (!mqtt.enabled) return ui('未启用', 'Disabled')
    return mqtt.listening ? ui('监听中', 'Listening') : ui('异常', 'Error')
  })

  const mqttTagType = computed<TagType>(() => {
    const mqtt = status.value?.mqtt
    if (!mqtt) return 'info'
    if (!mqtt.enabled) return 'info'
    return mqtt.listening ? 'success' : 'danger'
  })

  const readiness = computed(() => status.value?.readiness)

  const readinessSummary = computed(() => {
    const level = readiness.value?.level
    if (level === 'ready') return ui('核心服务和数据链路均已就绪。', 'Core services and data pipelines are ready.')
    if (level === 'warning') return ui('核心服务可用，但仍有需要关注的运行风险。', 'Core services are available, with operational risks requiring attention.')
    if (level === 'blocked') return ui('存在阻止系统正常投产的检查项。', 'One or more checks currently block production readiness.')
    return ui('正在等待运行状态响应。', 'Waiting for the runtime status response.')
  })

  const readinessItemLabel = (item: { key: string; label: string }) => {
    const labels: Record<string, string> = {
      frontend: 'Frontend proxy',
      backend: 'Backend service',
      database: 'MySQL database',
      mqtt: 'MQTT ingestion',
      data: 'Data ingestion',
      freshness: 'Data ingestion',
      alerts: 'Alert backlog'
    }
    if (locale.value.startsWith('zh')) return item.label
    return labels[item.key] || item.label
  }

  const readinessItemDetail = (item: { key: string; detail: string }) => {
    if (locale.value.startsWith('zh')) return item.detail
    const detail = String(item.detail || '')
    if (item.key === 'frontend') return 'Page-to-API proxy is reachable'
    if (item.key === 'backend') return detail.replace('API 端口', 'API port').replace('在线', 'online')
    if (item.key === 'database') return detail.replace('查询延迟', 'Query latency')
    if (item.key === 'mqtt') return detail.replace('监听', 'Listening on')
    if (item.key === 'data' || item.key === 'freshness') return detail.replace('最近', 'Data received within the last ').replace('分钟有采集数据', ' minutes')
    if (item.key === 'alerts') return detail.replace('活跃', 'Active').replace('条，严重', ', critical').replace('条', '')
    return detail
  }

  const readinessTitle = computed(() => {
    const level = readiness.value?.level
    if (level === 'ready') return ui('可进入生产观察', 'Ready for production observation')
    if (level === 'warning') return ui('可运行但需关注风险', 'Operational with risks requiring attention')
    if (level === 'blocked') return ui('存在投产阻断项', 'Production readiness is blocked')
    return ui('等待投产状态', 'Waiting for production status')
  })

  const readinessTagText = computed(() => {
    const level = readiness.value?.level
    if (level === 'ready') return ui('就绪', 'Ready')
    if (level === 'warning') return ui('关注', 'Attention')
    if (level === 'blocked') return ui('阻断', 'Blocked')
    return ui('未知', 'Unknown')
  })

  const readinessTagType = computed<TagType>(() => {
    const level = readiness.value?.level
    if (level === 'ready') return 'success'
    if (level === 'warning') return 'warning'
    if (level === 'blocked') return 'danger'
    return 'info'
  })

  const readinessRiskText = computed(() => {
    const risks = readiness.value?.risks || []
    if (risks.length === 0) return ui('暂无风险项', 'No active risks')
    return risks.map((item) => readinessItemLabel(item)).join(locale.value.startsWith('zh') ? '、' : ', ')
  })

  const readinessPercent = computed(() => readiness.value?.percent ?? 0)

  const readinessScoreText = computed(() => {
    const data = readiness.value
    if (!data) return '--'
    return `${data.score}/${data.total}`
  })

  const dataFreshnessState = computed(() => {
    const freshness = status.value?.dataFreshness
    if (!freshness) return 'offline'
    if (freshness.state === 'fresh') return 'online'
    if (freshness.state === 'stale') return 'warning'
    return 'offline'
  })

  const dataFreshnessTagText = computed(() => {
    const freshness = status.value?.dataFreshness
    if (!freshness) return ui('未知', 'Unknown')
    if (freshness.state === 'fresh') return ui('新鲜', 'Fresh')
    if (freshness.state === 'stale') return ui('滞后', 'Stale')
    if (freshness.state === 'empty') return ui('无数据', 'No data')
    return ui('异常', 'Error')
  })

  const dataFreshnessTagType = computed<TagType>(() => {
    const freshness = status.value?.dataFreshness
    if (!freshness) return 'info'
    if (freshness.state === 'fresh') return 'success'
    if (freshness.state === 'stale') return 'warning'
    return 'danger'
  })

  const alertState = computed(() => {
    const alerts = status.value?.alerts
    if (!alerts?.ok) return 'offline'
    if (alerts.bySeverity.critical > 0) return 'offline'
    if (alerts.active > 0) return 'warning'
    return 'online'
  })

  const alertTagText = computed(() => {
    const alerts = status.value?.alerts
    if (!alerts) return ui('未知', 'Unknown')
    if (!alerts.ok) return ui('异常', 'Error')
    if (alerts.bySeverity.critical > 0) return ui('严重', 'Critical')
    if (alerts.active > 0) return ui('待处理', 'Pending')
    return ui('正常', 'Normal')
  })

  const alertTagType = computed<TagType>(() => {
    const alerts = status.value?.alerts
    if (!alerts) return 'info'
    if (!alerts.ok || alerts.bySeverity.critical > 0) return 'danger'
    if (alerts.active > 0) return 'warning'
    return 'success'
  })

  const heapUsagePercent = computed(() => {
    const memory = status.value?.backend.memoryMb
    if (!memory?.heapUsed || !memory?.heapTotal) return 0
    return Math.min(100, Math.round((memory.heapUsed / memory.heapTotal) * 100))
  })

  async function loadStatus(options: { silent?: boolean } = {}) {
    if (!options.silent) loading.value = true
    try {
      if (!isBackendMode) {
        // frontend模式：返回前端自检状态
        status.value = {
          backend: {
            available: false,
            mode: 'frontend' as const,
            message: '前端模式，后端服务未连接'
          },
          database: { available: true, mode: 'indexeddb' as const },
          sensors: { available: true },
          mqtt: { available: false, message: '前端模式下MQTT不可用' },
          alerts: { active: 0, pending: 0 },
          freshness: { lastSync: null, state: 'ok' as const },
          tables: []
        } as unknown as SystemStatus
        errorMessage.value = ''
        return
      }
      status.value = await api.get<SystemStatus>({
        url: '/api/system/status',
        showErrorMessage: false,
        showErrorLog: false
      })
      errorMessage.value = ''
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errorMessage.value = `状态接口不可用：${message}`
    } finally {
      if (!options.silent) loading.value = false
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh()
    if (!autoRefresh.value) return
    refreshTimer = window.setInterval(() => {
      loadStatus({ silent: true })
    }, 5000)
  }

  function stopAutoRefresh() {
    if (!refreshTimer) return
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }

  function formatUptime(seconds?: number) {
    if (!seconds && seconds !== 0) return '--'
    const day = Math.floor(seconds / 86400)
    const hour = Math.floor((seconds % 86400) / 3600)
    const minute = Math.floor((seconds % 3600) / 60)
    if (locale.value.startsWith('zh')) {
      if (day > 0) return `${day}天 ${hour}小时`
      if (hour > 0) return `${hour}小时 ${minute}分钟`
      return `${minute}分钟`
    }
    if (day > 0) return `${day} d ${hour} h`
    if (hour > 0) return `${hour} h ${minute} min`
    return `${minute} min`
  }

  function formatDateTime(value?: string | null) {
    return formatDateOnly(value, '--')
  }

  function formatMemory(value?: number) {
    if (value === undefined || value === null) return '--'
    return `${value.toFixed(1)} MB`
  }

  function formatTemperature(value?: number | null) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return '--'
    return `${Number(value).toFixed(1)}℃`
  }

  function formatAgeMinutes(value?: number | null) {
    if (value === undefined || value === null) return '--'
    if (value < 60) return locale.value.startsWith('zh') ? `${value} 分钟` : `${value} min`
    const hour = Math.floor(value / 60)
    const minute = value % 60
    if (hour < 24) {
      if (locale.value.startsWith('zh'))
        return minute > 0 ? `${hour}小时 ${minute}分钟` : `${hour}小时`
      return minute > 0 ? `${hour} h ${minute} min` : `${hour} h`
    }
    const day = Math.floor(hour / 24)
    const restHour = hour % 24
    if (locale.value.startsWith('zh')) return restHour > 0 ? `${day}天 ${restHour}小时` : `${day}天`
    return restHour > 0 ? `${day} d ${restHour} h` : `${day} d`
  }

  function getSeverityLabel(severity?: string | null) {
    const labels: Record<string, string> = {
      critical: '严重',
      high: '高',
      medium: '中',
      low: '低'
    }
    if (!severity) return '--'
    return labels[severity] || severity
  }

  function getTableTitle(table: string) {
    return tableTitleMap[table] || table
  }

  watch(autoRefresh, startAutoRefresh)

  onMounted(() => {
    loadStatus()
    startAutoRefresh()
  })

  onBeforeUnmount(stopAutoRefresh)
</script>

<style scoped>
  .server-status {
    padding: 18px;
    color: #203228;
  }

  .status-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 18px;
    padding: 24px;
    overflow: hidden;
    background: var(--fluent-surface, #fff);
    border: 1px solid rgb(71 111 89 / 12%);
    border-radius: 8px;
    box-shadow: 0 1px 2px rgb(31 53 42 / 6%);
  }

  .status-header h1 {
    margin: 0;
    color: #203228;
    font-size: clamp(24px, 2vw, 28px);
    font-weight: 780;
    line-height: 1.2;
    letter-spacing: 0;
  }

  .status-header p {
    max-width: 620px;
    margin: 10px 0 0;
    color: #66796d;
    font-size: 14px;
    line-height: 1.75;
  }

  .status-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .last-refresh {
    min-width: 190px;
    padding: 11px 12px;
    background: rgb(255 255 255 / 68%);
    border: 1px solid rgb(71 111 89 / 12%);
    border-radius: 7px;
  }

  .last-refresh span,
  .last-refresh strong {
    display: block;
  }

  .last-refresh span {
    color: #7a8d81;
    font-size: 12px;
  }

  .last-refresh strong {
    margin-top: 4px;
    color: #203228;
    font-size: 13px;
    font-weight: 720;
  }

  .refresh-switch {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 42px;
    padding: 0 12px;
    color: #587263;
    font-size: 14px;
    background: rgb(255 255 255 / 68%);
    border: 1px solid rgb(71 111 89 / 12%);
    border-radius: 7px;
  }

  .button-icon {
    margin-right: 6px;
  }

  .status-error {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    padding: 12px 14px;
    border: 1px solid #fecaca;
    border-radius: 8px;
    color: #b91c1c;
    background: #fef2f2;
  }

  .readiness-band {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 150px minmax(180px, auto);
    gap: 18px;
    align-items: center;
    margin-bottom: 16px;
    padding: 18px 20px;
    border: 1px solid rgb(71 111 89 / 12%);
    border-left: 4px solid #2f8b57;
    border-radius: 8px;
    background: var(--fluent-surface, #fff);
    box-shadow: 0 1px 2px rgb(31 53 42 / 6%);
  }

  .readiness-band--warning {
    border-left-color: #d97706;
  }

  .readiness-band--blocked {
    border-left-color: #dc2626;
  }

  .readiness-band h2 {
    margin: 0;
    color: #203228;
    font-size: 21px;
    font-weight: 780;
    line-height: 1.25;
    letter-spacing: 0;
  }

  .readiness-band p {
    margin: 7px 0 0;
    color: #66796d;
    font-size: 13px;
    line-height: 1.65;
  }

  .readiness-score {
    display: grid;
    gap: 3px;
    justify-items: end;
    padding: 10px 14px;
    border: 1px solid rgb(71 111 89 / 10%);
    border-radius: 8px;
    background: rgb(255 255 255 / 70%);
  }

  .readiness-score span,
  .readiness-score small,
  .readiness-risks span {
    color: #6f8276;
    font-size: 12px;
  }

  .readiness-score strong {
    color: #203228;
    font-size: clamp(20px, 1.8vw, 23px);
    font-weight: 790;
    line-height: 1.05;
  }

  .readiness-risks {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
  }

  .readiness-risks span {
    overflow-wrap: anywhere;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin-bottom: 16px;
  }

  .status-card,
  .status-panel {
    border: 1px solid rgb(71 111 89 / 10%);
    border-radius: 8px;
    background: var(--fluent-surface, #fff);
    box-shadow: 0 1px 2px rgb(31 53 42 / 6%);
  }

  .status-card {
    position: relative;
    min-height: 150px;
    padding: 16px;
    overflow: hidden;
    border-top: 0;
  }

  .status-card::before {
    position: absolute;
    inset: 0 auto 0 0;
    width: 4px;
    content: '';
    background: #9ca3af;
  }

  .status-card::after {
    position: absolute;
    right: 14px;
    bottom: 14px;
    width: 44px;
    height: 44px;
    content: '';
    background: rgb(71 111 89 / 7%);
    border-radius: 50%;
  }

  .status-card.online {
    border-color: rgb(22 163 74 / 18%);
  }

  .status-card.online::before {
    background: #2f8b57;
  }

  .status-card.warning {
    border-color: rgb(217 119 6 / 20%);
  }

  .status-card.warning::before {
    background: #d97706;
  }

  .status-card.offline {
    border-color: rgb(220 38 38 / 18%);
  }

  .status-card.offline::before {
    background: #dc2626;
  }

  .card-topline,
  .panel-header,
  .memory-line,
  .metric-row,
  .database-latency,
  .health-score {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .card-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: #476252;
    font-size: 14px;
    font-weight: 680;
  }

  .card-main {
    margin-top: 14px;
    min-height: 30px;
    color: #203228;
    font-size: clamp(22px, 2vw, 26px);
    font-weight: 760;
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-detail {
    margin-top: 8px;
    min-height: 20px;
    color: #6f8276;
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .status-panel {
    padding: 18px;
    min-width: 0;
  }

  .status-panel--wide {
    grid-column: 1 / -1;
  }

  .panel-header {
    align-items: flex-start;
    margin-bottom: 16px;
  }

  .panel-header h2 {
    margin: 0;
    color: #203228;
    font-size: 18px;
    font-weight: 760;
    line-height: 1.3;
    letter-spacing: 0;
  }

  .panel-header p {
    margin: 5px 0 0;
    color: #6f8276;
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .metric-list {
    display: grid;
    gap: 10px;
  }

  .readiness-list {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .readiness-row {
    display: grid;
    grid-template-columns: 10px minmax(0, 92px) minmax(0, 1fr);
    gap: 9px;
    align-items: center;
    min-height: 48px;
    padding: 10px 12px;
    border: 1px solid rgb(71 111 89 / 9%);
    border-radius: 8px;
    background: rgb(248 252 249 / 76%);
  }

  .readiness-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #2f8b57;
  }

  .readiness-row--warning .readiness-dot {
    background: #d97706;
  }

  .readiness-row--fail .readiness-dot {
    background: #dc2626;
  }

  .readiness-row strong {
    color: #203228;
    font-size: 13px;
    font-weight: 720;
  }

  .readiness-row p {
    margin: 0;
    color: #6f8276;
    font-size: 13px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .alert-severity-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
    margin-bottom: 12px;
  }

  .alert-severity-grid div {
    display: grid;
    gap: 4px;
    min-height: 62px;
    padding: 10px 12px;
    border: 1px solid rgb(71 111 89 / 9%);
    border-radius: 8px;
    background: rgb(248 252 249 / 76%);
  }

  .alert-severity-grid span {
    color: #6f8276;
    font-size: 12px;
  }

  .alert-severity-grid strong {
    color: #203228;
    font-size: 22px;
    font-weight: 790;
    line-height: 1.1;
  }

  .metric-row,
  .database-latency,
  .health-score {
    padding: 10px 0;
    border-bottom: 1px solid rgb(71 111 89 / 8%);
  }

  .metric-row span,
  .database-latency span,
  .health-score span,
  .memory-line span,
  .last-message span {
    color: #6f8276;
    font-size: 13px;
  }

  .metric-row strong,
  .database-latency strong,
  .health-score strong,
  .memory-line strong,
  .last-message strong {
    min-width: 0;
    color: #203228;
    font-size: 14px;
    font-weight: 680;
    text-align: right;
    overflow-wrap: anywhere;
  }

  .memory-block {
    margin-top: 16px;
  }

  .memory-line {
    margin-bottom: 8px;
  }

  .memory-line.small {
    margin-top: 10px;
    margin-bottom: 0;
  }

  .database-latency {
    margin-bottom: 12px;
  }

  .table-name {
    display: grid;
    gap: 2px;
  }

  .table-name span {
    color: #203228;
    font-weight: 680;
  }

  .table-name small {
    color: #6f8276;
    font-size: 12px;
  }

  .last-message {
    display: grid;
    gap: 10px;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid rgb(71 111 89 / 8%);
  }

  .last-message div {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 8px;
    align-items: center;
  }

  .last-message strong {
    text-align: left;
  }

  .inline-error {
    margin: 10px 0;
    padding: 10px 12px;
    border-radius: 8px;
    color: #b91c1c;
    background: #fef2f2;
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  @media (max-width: 1200px) {
    .summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .readiness-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 900px) {
    .readiness-band {
      grid-template-columns: 1fr;
    }

    .readiness-score,
    .readiness-risks {
      justify-items: start;
      justify-content: flex-start;
    }

    .detail-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .server-status {
      padding: 14px;
    }

    .status-header {
      display: grid;
    }

    .status-actions {
      justify-content: flex-start;
    }

    .summary-grid {
      grid-template-columns: 1fr;
    }

    .readiness-list,
    .alert-severity-grid {
      grid-template-columns: 1fr;
    }

    .card-main {
      font-size: 22px;
    }
  }

  :global(.dark) .server-status {
    color: #f4fbf6;
  }

  :global(.dark) .status-header h1,
  :global(.dark) .readiness-band h2,
  :global(.dark) .readiness-score strong,
  :global(.dark) .card-main,
  :global(.dark) .panel-header h2,
  :global(.dark) .metric-row strong,
  :global(.dark) .database-latency strong,
  :global(.dark) .health-score strong,
  :global(.dark) .memory-line strong,
  :global(.dark) .last-message strong,
  :global(.dark) .table-name span,
  :global(.dark) .readiness-row strong,
  :global(.dark) .alert-severity-grid strong {
    color: #f4fbf6;
  }

  :global(.dark) .status-header {
    background: var(--fluent-surface);
    border-color: rgb(255 255 255 / 8%);
    box-shadow: none;
  }

  :global(.dark) .status-card,
  :global(.dark) .status-panel,
  :global(.dark) .readiness-band {
    border-color: rgb(255 255 255 / 8%);
    background: var(--fluent-surface);
    box-shadow: none;
  }

  :global(.dark) .metric-row,
  :global(.dark) .database-latency,
  :global(.dark) .health-score,
  :global(.dark) .last-message,
  :global(.dark) .readiness-row,
  :global(.dark) .alert-severity-grid div {
    border-color: rgb(255 255 255 / 8%);
  }

  :global(.dark) .status-header p,
  :global(.dark) .readiness-band p,
  :global(.dark) .readiness-score span,
  :global(.dark) .readiness-score small,
  :global(.dark) .readiness-risks span,
  :global(.dark) .readiness-row p,
  :global(.dark) .card-title,
  :global(.dark) .card-detail,
  :global(.dark) .panel-header p,
  :global(.dark) .metric-row span,
  :global(.dark) .database-latency span,
  :global(.dark) .health-score span,
  :global(.dark) .memory-line span,
  :global(.dark) .last-message span,
  :global(.dark) .table-name small,
  :global(.dark) .alert-severity-grid span,
  :global(.dark) .refresh-switch {
    color: #abc0b3;
  }

  :global(.dark) .last-refresh,
  :global(.dark) .refresh-switch,
  :global(.dark) .readiness-score,
  :global(.dark) .readiness-row,
  :global(.dark) .alert-severity-grid div {
    background: rgb(255 255 255 / 5%);
    border-color: rgb(255 255 255 / 8%);
  }

  :global(.dark) .last-refresh strong {
    color: #f4fbf6;
  }

  .server-status {
    color: var(--fluent-text) !important;
  }

  .status-header,
  .readiness-band,
  .status-card,
  .status-panel {
    background: var(--fluent-surface) !important;
    border-color: var(--fluent-border) !important;
    box-shadow: var(--fluent-inset-highlight) !important;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .status-header {
    background: var(--fluent-surface) !important;
  }

  .status-header p,
  .last-refresh span,
  .refresh-switch,
  .readiness-band p,
  .readiness-score span,
  .readiness-score small,
  .readiness-risks span,
  .card-title,
  .card-detail,
  .panel-header p,
  .metric-row span,
  .database-latency span,
  .health-score span,
  .memory-line span,
  .last-message span,
  .readiness-row p,
  .alert-severity-grid span,
  .table-name small {
    color: var(--fluent-text-soft) !important;
  }

  .status-header h1,
  .last-refresh strong,
  .readiness-band h2,
  .readiness-score strong,
  .card-main,
  .panel-header h2,
  .metric-row strong,
  .database-latency strong,
  .health-score strong,
  .memory-line strong,
  .last-message strong,
  .table-name span,
  .readiness-row strong,
  .alert-severity-grid strong {
    color: var(--fluent-text) !important;
  }

  .last-refresh,
  .refresh-switch,
  .readiness-score,
  .readiness-row,
  .alert-severity-grid div {
    background: var(--fluent-surface-subtle) !important;
    border-color: var(--fluent-border) !important;
  }

  .readiness-band {
    border-left-color: var(--el-color-primary) !important;
  }

  .readiness-band--warning {
    border-left-color: var(--fluent-amber) !important;
  }

  .readiness-band--blocked {
    border-left-color: var(--fluent-rose) !important;
  }

  .status-card::after {
    background: rgb(var(--fluent-primary-rgb) / 9%) !important;
  }

  .status-card.online {
    border-color: rgb(var(--fluent-primary-rgb) / 24%) !important;
  }

  .status-card.online::before,
  .readiness-dot {
    background: var(--el-color-primary) !important;
  }

  .status-card.warning {
    border-color: rgb(245 165 36 / 24%) !important;
  }

  .status-card.warning::before,
  .readiness-row--warning .readiness-dot {
    background: var(--fluent-amber) !important;
  }

  .status-card.offline {
    border-color: rgb(216 59 93 / 22%) !important;
  }

  .status-card.offline::before,
  .readiness-row--fail .readiness-dot {
    background: var(--fluent-rose) !important;
  }

  .metric-row,
  .database-latency,
  .health-score,
  .last-message {
    border-color: var(--fluent-border) !important;
  }

  :global(.dark) .status-header,
  :global(.dark) .status-card,
  :global(.dark) .status-panel,
  :global(.dark) .readiness-band {
    background: var(--fluent-surface) !important;
    box-shadow: var(--fluent-shadow) !important;
  }
</style>
