<template>
  <div class="health-board">
    <section class="board-header">
      <div class="board-heading">
        <h1>{{ t('publication.dashboard.title') }}</h1>
        <div class="board-meta" :class="`is-${boardMeta.state}`">
          <span class="board-status">
            <ArtSvgIcon :icon="boardStatusIcon" />
            {{ boardMeta.statusText }}
          </span>
          <span>{{
            t('publication.dashboard.latestCollection', { time: boardMeta.latestSensorText })
          }}</span>
          <span>{{ t('publication.dashboard.refreshed', { time: boardMeta.refreshedAt }) }}</span>
        </div>
      </div>
      <button
        type="button"
        class="refresh-btn"
        :disabled="loading"
        :aria-busy="loading"
        @click="loadBoard"
      >
        <ArtSvgIcon icon="ri:refresh-line" />
        {{ loading ? t('publication.dashboard.refreshing') : t('publication.dashboard.refresh') }}
      </button>
    </section>

    <ElAlert
      v-if="boardMeta.errorText"
      class="board-alert"
      type="error"
      :title="boardMeta.errorText"
      show-icon
      :closable="false"
    />

    <section v-loading="loading" class="summary-grid">
      <article class="summary-card healthy">
        <span>{{ t('publication.dashboard.healthyNow') }}</span>
        <strong>{{ summary.healthy }}</strong>
      </article>
      <article class="summary-card unhealthy">
        <span>{{ t('publication.dashboard.reviewNow') }}</span>
        <strong>{{ summary.unhealthy }}</strong>
      </article>
      <article class="summary-card alert">
        <span>{{ t('publication.dashboard.temperatureAlertsToday') }}</span>
        <strong>{{ summary.todayAlerts }}</strong>
      </article>
      <article class="summary-card stale">
        <span>{{ t('publication.dashboard.pendingCollection') }}</span>
        <strong>{{ summary.stale }}</strong>
      </article>
      <article class="summary-card total">
        <span>{{ t('publication.dashboard.cattleInHerd') }}</span>
        <strong>{{ summary.total }}</strong>
      </article>
    </section>

    <section class="main-grid">
      <article class="chart-panel">
        <div class="panel-header">
          <h2>{{ t('publication.dashboard.currentHealth') }}</h2>
        </div>
        <div ref="healthPieRef" class="chart-container"></div>
      </article>

      <article class="chart-panel">
        <div class="panel-header">
          <h2>{{ t('publication.dashboard.latestTemperature') }}</h2>
          <span class="rule-chip" :title="t('publication.dashboard.ruleDescription')">{{
            t('publication.dashboard.twoOfThreeRule')
          }}</span>
        </div>
        <div ref="temperatureBarRef" class="chart-container"></div>
      </article>
    </section>

    <section class="table-panel">
      <div class="panel-header">
        <h2>{{ t('publication.dashboard.attentionCattle') }}</h2>
        <strong>{{ t('publication.dashboard.headCount', { count: attentionRows.length }) }}</strong>
      </div>
      <ElTable
        class="attention-table"
        v-loading="loading"
        :data="attentionRows"
        row-key="id"
        height="320"
        :empty-text="t('publication.dashboard.noAttention')"
        style="width: 100%"
      >
        <ElTableColumn
          prop="cowNumber"
          :label="t('publication.dashboard.cowNumber')"
          min-width="120"
        />
        <ElTableColumn prop="earTagNumber" :label="t('publication.dashboard.earTag')" width="100" />
        <ElTableColumn
          prop="latestTemperatureText"
          :label="t('publication.dashboard.latestTemperature')"
          width="120"
        />
        <ElTableColumn :label="t('publication.dashboard.status')" width="120">
          <template #default="{ row }">
            <ElTag :type="riskTagType(row)" effect="light">{{ row.riskText }}</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn
          prop="temperatureEvidence"
          :label="t('publication.dashboard.recentThree')"
          min-width="240"
          show-overflow-tooltip
        />
        <ElTableColumn
          prop="reason"
          :label="t('publication.dashboard.decisionBasis')"
          min-width="260"
          show-overflow-tooltip
        />
        <ElTableColumn
          prop="measuredAtText"
          :label="t('publication.dashboard.measuredAt')"
          min-width="160"
        />
        <ElTableColumn :label="t('publication.dashboard.actions')" width="120">
          <template #default="{ row }">
            <ElButton link type="primary" @click="openAlertCenter(row)">{{
              t('publication.dashboard.alertHandling')
            }}</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <div class="mobile-attention-list">
        <article v-for="row in attentionRows" :key="row.id" class="mobile-attention-row">
          <div class="mobile-attention-heading">
            <div>
              <strong>{{ row.cowNumber }}</strong>
              <span>{{
                t('publication.dashboard.earTagPrefix', { value: row.earTagNumber })
              }}</span>
            </div>
            <ElTag :type="riskTagType(row)" effect="light">{{ row.riskText }}</ElTag>
          </div>
          <dl>
            <div>
              <dt>{{ t('publication.dashboard.latestTemperature') }}</dt>
              <dd>{{ row.latestTemperatureText }}</dd>
            </div>
            <div>
              <dt>{{ t('publication.dashboard.recentThree') }}</dt>
              <dd>{{ row.temperatureEvidence }}</dd>
            </div>
            <div>
              <dt>{{ t('publication.dashboard.decisionBasis') }}</dt>
              <dd>{{ row.reason }}</dd>
            </div>
            <div>
              <dt>{{ t('publication.dashboard.measuredAt') }}</dt>
              <dd>{{ row.measuredAtText }}</dd>
            </div>
          </dl>
          <ElButton type="primary" size="small" @click="openAlertCenter(row)">{{
            t('publication.dashboard.alertHandling')
          }}</ElButton>
        </article>
        <ElEmpty
          v-if="attentionRows.length === 0"
          :description="t('publication.dashboard.noAttention')"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useRouter } from 'vue-router'
  import { useEChartsManager } from '@/hooks'
  import * as databaseService from '@/services/数据库'
  import { buildUnifiedDataContext } from '@/services/unified-records'
  import { loadUnifiedSensorData, normalizeStatus } from '@/views/breeding-platform/platform-data'
  import { formatDateOnly } from '@/utils/date-display'
  import {
    evaluateTwoOfThreeHighTemperature,
    THREE_POINT_HIGH_TEMPERATURE_THRESHOLD
  } from '@/utils/health-alert-rules'

  defineOptions({ name: 'DashboardBoard' })

  type AnyRow = Record<string, any>
  type HealthDashboardSnapshot = {
    cows: AnyRow[]
    animals: AnyRow[]
    sensorRows: AnyRow[]
    alerts: AnyRow[]
    healthScores: AnyRow[]
  }
  type CowHealthRow = {
    id: string
    cowNumber: string
    earTagNumber: string
    latestTemperature: number | null
    latestTemperatureText: string
    measuredAt: string
    measuredAtText: string
    temperatureAlertMatched: boolean
    temperatureEvidence: string
    dataState: 'fresh' | 'stale' | 'missing'
    unhealthy: boolean
    riskText: string
    severityRank: number
    reason: string
  }

  const healthPieRef = ref<HTMLDivElement>()
  const temperatureBarRef = ref<HTMLDivElement>()
  const rows = ref<CowHealthRow[]>([])
  const loading = ref(false)
  const router = useRouter()
  const { locale, t } = useI18n()
  const { getOrCreateChart, resizeAllCharts, disposeAllCharts } = useEChartsManager()

  const boardMeta = reactive({
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'stale' | 'error',
    statusText: t('publication.dashboard.loadingHealth'),
    refreshedAt: '-',
    latestSensorText: '-',
    errorText: ''
  })

  const summary = reactive({
    total: 0,
    healthy: 0,
    unhealthy: 0,
    todayAlerts: 0,
    stale: 0
  })

  const DATA_STALE_AFTER_MS = 24 * 60 * 60 * 1000
  const palette = {
    green: '#16a34a',
    red: '#dc2626',
    amber: '#f59e0b',
    teal: '#0f766e',
    blue: '#2563eb',
    slate: '#64748b'
  }

  const attentionRows = computed(() =>
    rows.value
      .filter((row) => row.unhealthy || row.dataState !== 'fresh')
      .sort((left, right) => {
        if (right.severityRank !== left.severityRank) return right.severityRank - left.severityRank
        return (right.latestTemperature || 0) - (left.latestTemperature || 0)
      })
  )

  const boardStatusIcon = computed(() => {
    if (loading.value) return 'ri:loader-4-line'
    if (boardMeta.state === 'error') return 'ri:error-warning-line'
    if (boardMeta.state === 'stale') return 'ri:time-line'
    if (boardMeta.state === 'empty') return 'ri:inbox-line'
    return 'ri:checkbox-circle-line'
  })

  const getText = (value: unknown) => String(value ?? '').trim()
  const getNumber = (value: unknown): number | null => {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
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
  const parseDate = (value: unknown): Date | null => {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(String(value))
    return Number.isFinite(date.getTime()) ? date : null
  }
  const dateKey = (value: unknown) => {
    const date = parseDate(value)
    if (!date) return ''
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-')
  }
  const formatDateTime = (value: unknown) => {
    const date = parseDate(value)
    if (!date) return '-'
    return `${formatDateOnly(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  const rowTime = (row: AnyRow, fields: string[]) => {
    for (const field of fields) {
      const date = parseDate(row[field])
      if (date) return date.getTime()
    }
    return 0
  }

  const cowKeys = (cow: AnyRow) =>
    [
      cow.id,
      cow.cowId,
      cow.cow_id,
      cow.animalId,
      cow.animal_id,
      cow.animalId,
      cow.animal_id,
      cow.cowNumber,
      cow.cow_number,
      cow.animalNumber,
      cow.animal_number,
      cow.earTagNumber,
      cow.ear_tag_number
    ]
      .map(getText)
      .filter(Boolean)

  const rowCowKeys = (row: AnyRow) => {
    const payload = parsePayload(row.payload ?? row.rawPayload ?? row.raw_payload)
    return [
      row.cowId,
      row.cow_id,
      row.animalId,
      row.animal_id,
      row.cowNumber,
      row.cow_number,
      row.animalNumber,
      row.animal_number,
      row.earTagNumber,
      row.ear_tag_number,
      payload.cowId,
      payload.cow_id,
      payload.animalId,
      payload.animal_id,
      payload.cowNumber,
      payload.cow_number,
      payload.earTagNumber,
      payload.ear_tag_number
    ]
      .map(getText)
      .filter(Boolean)
  }

  const normalizeCow = (row: AnyRow): AnyRow => ({
    ...row,
    id: getText(row.id || row.cowId || row.cow_id),
    animalId: getText(row.animalId || row.animal_id),
    cowNumber: getText(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number),
    earTagNumber: getText(row.earTagNumber || row.ear_tag_number)
  })

  const mergeCows = (cowRows: AnyRow[], animalRows: AnyRow[]) => {
    const map = new Map<string, AnyRow>()
    ;[...animalRows, ...cowRows].forEach((row) => {
      const normalized = normalizeCow(row)
      const key = normalized.cowNumber || normalized.id
      if (!key) return
      map.set(key, { ...(map.get(key) || {}), ...normalized })
    })
    return Array.from(map.values())
  }

  const readingTemperature = (row: AnyRow) => {
    const payload = parsePayload(row.payload ?? row.rawPayload ?? row.raw_payload)
    return getNumber(
      row.temperature ??
        row.bodyTemperature ??
        row.body_temperature ??
        row.readingValue ??
        row.reading_value ??
        row.value ??
        payload.temperature ??
        payload.bodyTemperature ??
        payload.body_temperature ??
        payload.readingValue ??
        payload.reading_value
    )
  }

  const temperatureHistoryForCow = (cow: AnyRow, sensorRows: AnyRow[]) => {
    const keys = new Set(cowKeys(cow))
    return sensorRows
      .filter((row) => rowCowKeys(row).some((key) => keys.has(key)))
      .map((row) => ({
        row,
        id: getText(row.id),
        temperature: readingTemperature(row),
        timestamp: rowTime(row, [
          'ts',
          'timestamp',
          'measuredAt',
          'measured_at',
          'createdAt',
          'created_at'
        ]),
        measuredAt: getText(
          row.ts ||
            row.timestamp ||
            row.measuredAt ||
            row.measured_at ||
            row.createdAt ||
            row.created_at
        ),
        sourceMessageId: getText(
          row.sourceMessageId || row.source_message_id || row.sourceRecordId || row.source_record_id
        )
      }))
      .filter((item) => item.temperature !== null && item.timestamp > 0)
      .sort((left, right) => left.timestamp - right.timestamp)
  }

  const todayAlertsForCow = (cow: AnyRow, alerts: AnyRow[]) => {
    const keys = new Set(cowKeys(cow))
    return alerts.filter((alert) => {
      const status = getText(alert.status || alert.alertStatus || alert.alert_status).toLowerCase()
      if (['closed', 'resolved', 'done', '已处理', '已关闭'].includes(status)) return false
      const alertDate = dateKey(
        alert.alertTime || alert.alert_time || alert.createdAt || alert.created_at
      )
      if (alertDate !== formatDateOnly(new Date(), '-')) return false
      return rowCowKeys(alert).some((key) => keys.has(key))
    })
  }

  const latestHealthScoreForCow = (cow: AnyRow, healthRows: AnyRow[]) => {
    const keys = new Set(cowKeys(cow))
    return healthRows
      .map((row) => {
        const payload = parsePayload(row.payload ?? row.rawPayload ?? row.raw_payload)
        return {
          row,
          payload,
          keys: rowCowKeys({ ...row, payload }),
          timestamp: rowTime(row, [
            'scoreTime',
            'score_time',
            'recordTime',
            'record_time',
            'createdAt',
            'created_at'
          ])
        }
      })
      .filter((item) => item.keys.some((key) => keys.has(key)))
      .sort((left, right) => right.timestamp - left.timestamp)[0]
  }

  const severityRank = (value: string) => {
    const text = value.toLowerCase()
    if (/critical|危急/.test(text)) return 4
    if (/high|异常|高/.test(text)) return 3
    if (/medium|偏高|中/.test(text)) return 2
    if (/low|提示|低/.test(text)) return 1
    return 0
  }

  const buildRows = (
    cowRows: AnyRow[],
    animalRows: AnyRow[],
    sensorRows: AnyRow[],
    alerts: AnyRow[],
    healthRows: AnyRow[]
  ) =>
    mergeCows(cowRows, animalRows).map((cow) => {
      const temperatureHistory = temperatureHistoryForCow(cow, sensorRows)
      const latest = temperatureHistory[temperatureHistory.length - 1]
      const temperatureRule = evaluateTwoOfThreeHighTemperature(
        temperatureHistory.map((item) => ({
          id: item.id,
          temperature: item.temperature,
          measuredAt: item.measuredAt,
          sourceMessageId: item.sourceMessageId
        }))
      )
      const temperature = latest?.temperature ?? null
      const measuredAt = latest?.measuredAt || ''
      const latestTimestamp = latest?.timestamp || 0
      const dataState: CowHealthRow['dataState'] = !latestTimestamp
        ? 'missing'
        : Date.now() - latestTimestamp > DATA_STALE_AFTER_MS
          ? 'stale'
          : 'fresh'
      const temperatureAlertMatched = dataState === 'fresh' && temperatureRule.matched
      const cowAlerts = todayAlertsForCow(cow, alerts)
      const score = latestHealthScoreForCow(cow, healthRows)
      const scoreIsFresh = Boolean(
        score?.timestamp && Date.now() - score.timestamp <= DATA_STALE_AFTER_MS
      )
      const scoreValue = scoreIsFresh
        ? getNumber(
            score?.payload.overallScore ??
              score?.payload.score ??
              score?.row.score ??
              score?.row.healthScore ??
              score?.row.health_score
          )
        : null
      const riskLevel = scoreIsFresh
        ? getText(score?.payload.riskLevel || score?.payload.risk_level)
        : ''
      const alertSeverity = getText(cowAlerts[0]?.severity || cowAlerts[0]?.level || '')
      const normalizedStatus = normalizeStatus(cow.status)
      const unhealthy =
        cowAlerts.length > 0 ||
        temperatureAlertMatched ||
        (scoreValue !== null && scoreValue < 80) ||
        (!!riskLevel && !/low|normal|healthy|健康|正常/i.test(riskLevel)) ||
        ['异常', '预警'].includes(normalizedStatus)
      const reasons = []
      if (cowAlerts.length)
        reasons.push(t('publication.dashboard.activeAlerts', { count: cowAlerts.length }))
      if (temperatureAlertMatched) {
        reasons.push(
          t('publication.dashboard.threePointEvidence', {
            count: temperatureRule.highCount,
            threshold: temperatureRule.threshold.toFixed(1)
          })
        )
      }
      if (scoreValue !== null && scoreValue < 80)
        reasons.push(t('publication.dashboard.healthScore', { score: scoreValue }))
      if (riskLevel && !/low|normal|healthy|健康|正常/i.test(riskLevel))
        reasons.push(t('publication.dashboard.risk', { risk: riskLevel }))
      if (['异常', '预警'].includes(normalizedStatus))
        reasons.push(t('publication.dashboard.cowStatus', { status: normalizedStatus }))
      if (dataState === 'stale') reasons.push(t('publication.dashboard.staleReason'))
      if (dataState === 'missing') reasons.push(t('publication.dashboard.missingReason'))
      const temperatureEvidence = temperatureRule.points.length
        ? temperatureRule.points
            .map(
              (point) =>
                `${point.position}:${point.temperature.toFixed(1)}°C${point.exceeded ? '↑' : ''}`
            )
            .join(' / ')
        : '-'
      const severity = Math.max(
        severityRank(alertSeverity),
        severityRank(riskLevel),
        temperatureAlertMatched ? 3 : 0,
        dataState === 'missing' ? 2 : dataState === 'stale' ? 1 : 0
      )
      return {
        id: getText(cow.id || cow.cowNumber),
        cowNumber: getText(
          cow.cowNumber || cow.cow_number || cow.animalNumber || cow.animal_number
        ),
        earTagNumber: getText(cow.earTagNumber || cow.ear_tag_number) || '-',
        latestTemperature: temperature,
        latestTemperatureText: temperature === null ? '-' : `${temperature.toFixed(1)}°C`,
        measuredAt: getText(measuredAt),
        measuredAtText: formatDateTime(measuredAt),
        temperatureAlertMatched,
        temperatureEvidence,
        dataState,
        unhealthy,
        riskText: unhealthy
          ? temperatureAlertMatched
            ? t('publication.dashboard.threePointAlert')
            : alertSeverity ||
              riskLevel ||
              normalizedStatus ||
              t('publication.dashboard.needsReview')
          : dataState === 'missing'
            ? t('publication.dashboard.missingData')
            : dataState === 'stale'
              ? t('publication.dashboard.staleData')
              : t('publication.dashboard.healthy'),
        severityRank: severity,
        reason:
          reasons.join(locale.value === 'zh' ? '；' : '; ') ||
          t('publication.dashboard.noRuleMatch')
      } satisfies CowHealthRow
    })

  const renderHealthPie = () => {
    const chart = getOrCreateChart('health-board-pie', healthPieRef.value)
    if (!chart) return
    chart.setOption(
      {
        tooltip: {
          trigger: 'item',
          formatter: `{b}: {c} ${t('publication.dashboard.chartHead')} ({d}%)`
        },
        legend: { bottom: 0, textStyle: { color: '#52637a' } },
        series: [
          {
            type: 'pie',
            radius: ['48%', '72%'],
            center: ['50%', '44%'],
            avoidLabelOverlap: true,
            itemStyle: { borderRadius: 8, borderColor: '#fff', borderWidth: 2 },
            label: {
              formatter: `{b}\n{c} ${t('publication.dashboard.chartHead')}`,
              color: '#0f172a',
              fontWeight: 700
            },
            data: [
              {
                name: t('publication.dashboard.healthy'),
                value: summary.healthy,
                itemStyle: { color: palette.green }
              },
              {
                name: t('publication.dashboard.unhealthy'),
                value: summary.unhealthy,
                itemStyle: { color: palette.red }
              },
              {
                name: t('publication.dashboard.pendingSupplement'),
                value: summary.stale,
                itemStyle: { color: palette.amber }
              }
            ]
          }
        ]
      },
      true
    )
  }

  const renderTemperatureBar = () => {
    const chart = getOrCreateChart('health-board-temperature', temperatureBarRef.value)
    if (!chart) return
    const sortedRows = [...rows.value].sort((left, right) => {
      if (Number(right.unhealthy) !== Number(left.unhealthy)) {
        return Number(right.unhealthy) - Number(left.unhealthy)
      }
      return left.cowNumber.localeCompare(right.cowNumber, 'zh-CN', { numeric: true })
    })
    chart.setOption(
      {
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: (params: any) => {
            const item = Array.isArray(params) ? params[0] : params
            const row = sortedRows[item.dataIndex]
            return `${row.cowNumber}<br/>${t('publication.dashboard.earTagPrefix', { value: row.earTagNumber })}<br/>${row.latestTemperatureText}<br/>${row.temperatureEvidence}<br/>${row.riskText}`
          }
        },
        grid: { left: 42, right: 18, top: 24, bottom: 42 },
        xAxis: {
          type: 'category',
          data: sortedRows.map((row) => row.cowNumber),
          axisLabel: { color: '#52637a', rotate: sortedRows.length > 10 ? 30 : 0 },
          axisLine: { lineStyle: { color: '#b8c6d9' } }
        },
        yAxis: {
          type: 'value',
          name: '°C',
          min: 37,
          max: 41,
          axisLabel: { color: '#52637a' },
          splitLine: { lineStyle: { color: 'rgba(82, 99, 122, 0.14)' } }
        },
        series: [
          {
            type: 'bar',
            barMaxWidth: 34,
            data: sortedRows.map((row) => ({
              value: row.latestTemperature || 0,
              itemStyle: {
                color:
                  row.unhealthy || row.temperatureAlertMatched
                    ? palette.red
                    : row.dataState === 'fresh'
                      ? palette.green
                      : palette.amber,
                borderRadius: [6, 6, 0, 0]
              }
            })),
            markLine: {
              symbol: 'none',
              label: {
                formatter: t('publication.dashboard.ruleThreshold'),
                color: palette.red,
                position: 'insideEndTop'
              },
              lineStyle: { color: palette.red, type: 'dashed' },
              data: [{ yAxis: THREE_POINT_HIGH_TEMPERATURE_THRESHOLD }]
            }
          }
        ],
        dataZoom:
          sortedRows.length > 12
            ? [
                { type: 'inside', start: 0, end: Math.max(25, (12 / sortedRows.length) * 100) },
                {
                  type: 'slider',
                  height: 16,
                  bottom: 4,
                  start: 0,
                  end: Math.max(25, (12 / sortedRows.length) * 100)
                }
              ]
            : []
      },
      true
    )
  }

  const renderCharts = async () => {
    await nextTick()
    renderHealthPie()
    renderTemperatureBar()
    window.setTimeout(resizeAllCharts, 80)
  }

  const loadBoard = async () => {
    if (loading.value) return
    loading.value = true
    boardMeta.state = 'loading'
    boardMeta.statusText = t('publication.dashboard.refreshingHealth')
    boardMeta.errorText = ''
    try {
      const snapshot = await databaseService
        .runBackendRpcAsync<HealthDashboardSnapshot>(
          'getHealthDashboardSnapshot',
          { perCowLimit: 3 },
          { timeout: 10000, showErrorLog: false }
        )
        .catch(() => null)

      let cowRows: AnyRow[]
      let animalRows: AnyRow[]
      let sensorRows: AnyRow[]
      let alerts: AnyRow[]
      let healthScores: AnyRow[]
      let failedSources: string[] = []

      if (snapshot && Array.isArray(snapshot.sensorRows)) {
        cowRows = Array.isArray(snapshot.cows) ? snapshot.cows : []
        animalRows = Array.isArray(snapshot.animals) ? snapshot.animals : []
        sensorRows = snapshot.sensorRows
        alerts = Array.isArray(snapshot.alerts) ? snapshot.alerts : []
        healthScores = Array.isArray(snapshot.healthScores) ? snapshot.healthScores : []
      } else {
        const context = await buildUnifiedDataContext()
        const results = await Promise.allSettled([
          loadUnifiedSensorData(context.cows as any),
          databaseService.getTableDataAsync('alerts', {
            silent: true,
            limit: 50000,
            pageSize: 50000
          }),
          databaseService.getTableDataAsync('health_scores', {
            silent: true,
            limit: 50000,
            pageSize: 50000
          })
        ])
        failedSources = [
          t('publication.dashboard.temperatureSource'),
          t('publication.dashboard.alertSource'),
          t('publication.dashboard.healthScoreSource')
        ].filter((_, index) => results[index].status === 'rejected')
        if (results[0].status === 'rejected')
          throw new Error(t('publication.dashboard.temperatureLoadFailed'))
        cowRows = context.cows as AnyRow[]
        animalRows = context.animals as AnyRow[]
        sensorRows = results[0].status === 'fulfilled' ? results[0].value : []
        alerts = results[1].status === 'fulfilled' ? results[1].value : []
        healthScores = results[2].status === 'fulfilled' ? results[2].value : []
      }

      rows.value = buildRows(
        cowRows,
        animalRows,
        sensorRows as AnyRow[],
        alerts as AnyRow[],
        healthScores as AnyRow[]
      )
      summary.total = rows.value.length
      summary.stale = rows.value.filter((row) => row.dataState !== 'fresh').length
      summary.unhealthy = rows.value.filter(
        (row) => row.unhealthy && row.dataState === 'fresh'
      ).length
      summary.healthy = rows.value.filter(
        (row) => !row.unhealthy && row.dataState === 'fresh'
      ).length
      const currentTodayKey = formatDateOnly(new Date(), '-')
      summary.todayAlerts = (alerts as AnyRow[]).filter(
        (row) =>
          dateKey(row.alertTime || row.alert_time || row.createdAt || row.created_at) ===
            currentTodayKey &&
          !['closed', 'resolved', 'done', '已处理', '已关闭'].includes(
            getText(row.status || row.alertStatus || row.alert_status).toLowerCase()
          )
      ).length
      const latestTimestamp = rows.value
        .map((row) => parseDate(row.measuredAt)?.getTime() || 0)
        .sort((left, right) => right - left)[0]
      boardMeta.latestSensorText = latestTimestamp ? formatDateTime(new Date(latestTimestamp)) : '-'
      boardMeta.refreshedAt = formatDateTime(new Date())
      if (failedSources.length) {
        boardMeta.state = 'error'
        boardMeta.statusText = t('publication.dashboard.partialData')
        boardMeta.errorText = t('publication.dashboard.partialDataError', {
          sources: failedSources.join(locale.value === 'zh' ? '、' : ', ')
        })
      } else if (!summary.total) {
        boardMeta.state = 'empty'
        boardMeta.statusText = t('publication.dashboard.noCattle')
      } else if (summary.stale === summary.total) {
        boardMeta.state = 'stale'
        boardMeta.statusText = t('publication.dashboard.allPending')
      } else {
        boardMeta.state = 'ready'
        boardMeta.statusText = t('publication.dashboard.updated')
      }
      await renderCharts()
    } catch (error) {
      boardMeta.state = 'error'
      boardMeta.statusText = t('publication.dashboard.loadFailed')
      boardMeta.errorText =
        error instanceof Error ? error.message : t('publication.dashboard.loadFailedRetry')
      boardMeta.refreshedAt = formatDateTime(new Date())
    } finally {
      loading.value = false
    }
  }

  const riskTagType = (row: CowHealthRow) => {
    if (row.unhealthy) return 'danger'
    if (row.dataState === 'missing') return 'warning'
    if (row.dataState === 'stale') return 'info'
    return 'success'
  }

  const openAlertCenter = (row: CowHealthRow) => {
    void router.push({
      path: '/germplasm-resources/individual-filter',
      query: { cowNumber: row.cowNumber }
    })
  }

  const handleResize = () => resizeAllCharts()

  onMounted(() => {
    void loadBoard()
    window.addEventListener('resize', handleResize)
  })

  watch(locale, () => {
    void loadBoard()
  })

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    disposeAllCharts()
  })
</script>

<style scoped lang="scss">
  .health-board {
    min-height: 100%;
    padding: 16px;
    color: var(--fluent-text, #0f172a);
    background: var(--default-bg-color, #f4f7f5);
  }

  .board-header,
  .summary-card,
  .chart-panel,
  .table-panel {
    background: var(--fluent-surface, #fff);
    border: 1px solid var(--fluent-border, rgb(148 163 184 / 22%));
    border-radius: var(--fluent-radius, 8px);
    box-shadow: var(--fluent-inset-highlight, 0 1px 0 rgb(255 255 255 / 60%));
  }

  .board-header {
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    margin-bottom: 14px;

    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 780;
      line-height: 1.2;
    }
  }

  .board-heading {
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .board-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    font-size: 12px;
    color: var(--fluent-text-secondary, #64748b);
  }

  .board-status {
    display: inline-flex;
    gap: 5px;
    align-items: center;
    font-weight: 700;
    color: var(--fluent-interactive, #367a27);
  }

  .board-meta.is-error .board-status {
    color: #b42318;
  }

  .board-meta.is-stale .board-status {
    color: #a15c00;
  }

  .board-alert {
    margin-bottom: 14px;
  }

  .refresh-btn {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    padding: 0 14px;
    color: var(--fluent-text, #0f172a);
    cursor: pointer;
    background: var(--fluent-surface, #fff);
    border: 1px solid var(--fluent-border, rgb(148 163 184 / 26%));
    border-radius: 8px;

    &:disabled {
      cursor: wait;
      opacity: 0.62;
    }

    &:focus-visible {
      outline: 2px solid var(--fluent-interactive, #367a27);
      outline-offset: 2px;
    }
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }

  .summary-card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px;
    border-left: 4px solid #64748b;

    span {
      font-size: 13px;
      font-weight: 700;
      color: var(--fluent-text-secondary, #64748b);
    }

    strong {
      font-size: 34px;
      font-weight: 820;
      line-height: 1;
      color: var(--fluent-text, #0f172a);
    }

    &.healthy {
      border-left-color: #16a34a;
    }

    &.unhealthy {
      border-left-color: #dc2626;
    }

    &.alert {
      border-left-color: #f59e0b;
    }

    &.stale {
      border-left-color: #7c3aed;
    }

    &.total {
      border-left-color: #0f766e;
    }
  }

  .main-grid {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: 14px;
    margin-bottom: 14px;
  }

  .chart-panel,
  .table-panel {
    min-width: 0;
    padding: 14px;
  }

  .panel-header {
    display: flex;
    gap: 14px;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;

    h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 780;
      line-height: 1.25;
    }

    strong {
      font-size: 18px;
      font-weight: 780;
      color: #0f766e;
      white-space: nowrap;
    }
  }

  .rule-chip {
    padding: 3px 7px;
    font-size: 12px;
    font-weight: 700;
    color: #9a3412;
    white-space: nowrap;
    background: #fff7ed;
    border: 1px solid #fed7aa;
    border-radius: 4px;
  }

  .chart-container {
    width: 100%;
    height: 300px;
  }

  .table-panel :deep(.el-table) {
    border-radius: 8px;
  }

  .mobile-attention-list {
    display: none;
  }

  @media (width <= 1180px) {
    .summary-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (width <= 1000px) {
    .main-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (width <= 760px) {
    .health-board {
      padding: 12px;
    }

    .board-header {
      flex-direction: column;
      align-items: stretch;
    }

    .refresh-btn {
      width: 100%;
    }

    .summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .chart-container {
      height: 300px;
    }

    .attention-table {
      display: none;
    }

    .mobile-attention-list {
      display: grid;
    }

    .mobile-attention-row {
      display: grid;
      gap: 12px;
      padding: 16px 0;
      border-bottom: 1px solid #dbe7d7;

      &:first-child {
        padding-top: 0;
      }

      &:last-child {
        border-bottom: 0;
      }

      > .el-button {
        justify-self: end;
      }

      dl {
        display: grid;
        gap: 8px;
        margin: 0;

        > div {
          display: grid;
          grid-template-columns: 74px minmax(0, 1fr);
          gap: 10px;
        }
      }

      dt {
        color: #64748b;
      }

      dd {
        min-width: 0;
        margin: 0;
        color: #334155;
        overflow-wrap: anywhere;
      }
    }

    .mobile-attention-heading {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      justify-content: space-between;

      > div {
        display: grid;
        gap: 2px;
      }

      strong {
        font-size: 17px;
        color: #172033;
      }

      span {
        font-size: 12px;
        color: #64748b;
      }
    }
  }

  @media (width <= 420px) {
    .summary-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .board-meta {
      gap: 6px;
    }

    .panel-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .chart-container {
      height: 280px;
    }
  }
</style>
