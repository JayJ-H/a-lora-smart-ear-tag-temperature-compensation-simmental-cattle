<template>
  <FcPageShell
    :title="t('publication.uplinks.title')"
    :status-label="t('publication.uplinks.subscriptionTopic')"
    :status-value="statusTopicText"
    :primary-action-label="t('publication.uplinks.restart')"
    primary-action-icon="ri:restart-line"
    :secondary-action-label="t('publication.uplinks.refreshRecords')"
    secondary-action-icon="ri:refresh-line"
    @primary-action="sendRestartCommand"
    @secondary-action="loadData"
  >
    <template #metrics>
      <section class="metric-grid">
        <FcMetricTile
          :label="t('publication.uplinks.uplinkMessages')"
          :value="uplinkRows.length"
          icon="ri:arrow-up-line"
        />
        <FcMetricTile
          :label="t('publication.uplinks.latestPublished')"
          :value="formatDateTime(latestPublishedAt)"
          :note="latestUplink?.topic || t('publication.uplinks.noPublishedTopic')"
          icon="ri:time-line"
          tone="teal"
        />
        <FcMetricTile
          :label="t('publication.uplinks.latestReceived')"
          :value="formatDateTime(latestReceivedAt)"
          :note="
            latestUplink?.cowNumber || latestUplink?.deviceId || t('publication.uplinks.noRecords')
          "
          icon="ri:inbox-archive-line"
          tone="info"
        />
        <FcMetricTile
          :label="t('publication.uplinks.commandAudit')"
          :value="commandRows.length"
          :note="
            latestCommand?.status
              ? statusText(latestCommand.status)
              : t('publication.uplinks.noCommands')
          "
          icon="ri:send-plane-line"
          :tone="latestCommand?.status === 'failed' ? 'danger' : 'warning'"
        />
        <FcMetricTile
          :label="t('publication.uplinks.latestDownlinkTopic')"
          :value="latestDownlink?.topic || commandTopicText"
          :note="
            latestDownlink
              ? formatDateTime(latestDownlink.publishedAt || latestDownlink.createdAt)
              : t('publication.uplinks.waitingCommand')
          "
          icon="ri:radar-line"
          tone="primary"
        />
      </section>
    </template>

    <section class="page-grid">
      <FcPanel
        :title="t('publication.uplinks.records')"
        :subtitle="t('publication.uplinks.recordsSubtitle')"
      >
        <div class="toolbar">
          <ElInput
            v-model="filters.keyword"
            clearable
            :placeholder="t('publication.uplinks.searchPlaceholder')"
          />
          <ElSelect
            v-model="filters.direction"
            clearable
            :placeholder="t('publication.uplinks.direction')"
          >
            <ElOption :label="t('publication.uplinks.uplink')" value="uplink" />
            <ElOption :label="t('publication.uplinks.downlink')" value="downlink" />
          </ElSelect>
          <ElSelect
            v-model="filters.metric"
            clearable
            :placeholder="t('publication.uplinks.status')"
          >
            <ElOption :label="t('publication.uplinks.ingested')" value="ingested" />
            <ElOption :label="t('publication.uplinks.sent')" value="sent" />
            <ElOption :label="t('publication.uplinks.ignored')" value="ignored" />
            <ElOption :label="t('publication.uplinks.failed')" value="failed" />
          </ElSelect>
        </div>

        <ElTable
          :data="filteredRows"
          height="560"
          style="width: 100%"
          @row-click="selectMessageRow"
        >
          <ElTableColumn :label="t('publication.uplinks.direction')" width="82">
            <template #default="{ row }">
              <ElTag size="small" :type="row.direction === 'downlink' ? 'warning' : 'success'">
                {{
                  row.direction === 'downlink'
                    ? t('publication.uplinks.dispatched')
                    : t('publication.uplinks.published')
                }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn
            prop="cowNumber"
            :label="t('publication.uplinks.cowOrTag')"
            min-width="110"
          />
          <ElTableColumn prop="deviceId" :label="t('publication.uplinks.device')" min-width="120" />
          <ElTableColumn prop="topic" label="Topic" min-width="220" show-overflow-tooltip />
          <ElTableColumn :label="t('publication.uplinks.publishedAt')" min-width="168">
            <template #default="{ row }">{{ formatDateTime(row.publishedAt) }}</template>
          </ElTableColumn>
          <ElTableColumn :label="t('publication.uplinks.receivedAt')" min-width="168">
            <template #default="{ row }">{{ formatDateTime(row.receivedAt) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="status" :label="t('publication.uplinks.status')" width="90">
            <template #default="{ row }">
              <ElTag size="small" :type="statusTagType(row.status)">{{
                statusText(row.status)
              }}</ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('publication.uplinks.bodyTemperature')" min-width="120">
            <template #default="{ row }">
              {{ formatTemperature(resolvedBodyTemperature(row)) }}
            </template>
          </ElTableColumn>
          <ElTableColumn label="RSSI" width="92">
            <template #default="{ row }">
              {{ formatRssi(resolvedRssi(row)) }}
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('publication.uplinks.linkedRecords')" min-width="104">
            <template #default="{ row }">
              {{
                linkedSensorRows(row).length
                  ? t('publication.uplinks.recordCount', { count: linkedSensorRows(row).length })
                  : '--'
              }}
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('publication.uplinks.payload')" min-width="340">
            <template #default="{ row }">
              <div class="payload-cell">{{ payloadPreview(row) }}</div>
            </template>
          </ElTableColumn>
        </ElTable>
      </FcPanel>

      <div class="side-stack">
        <FcPanel :title="t('publication.uplinks.subscriptionAndCommands')" dense>
          <div class="info-list">
            <article>
              <span>{{ t('publication.uplinks.uplinkSubscription') }}</span>
              <strong>{{ mqttTopicText }}</strong>
            </article>
            <article>
              <span>{{ t('publication.uplinks.commandTopic') }}</span>
              <strong>{{ commandTopicText }}</strong>
            </article>
            <article>
              <span>{{ t('publication.uplinks.latestCommand') }}</span>
              <strong>{{
                formatDateTime(latestCommand?.requestedAt || latestCommand?.createdAt)
              }}</strong>
            </article>
          </div>

          <div class="topic-list">
            <article>
              <div>
                <span>{{ t('publication.uplinks.subscriptionStatus') }}</span>
                <strong>{{ mqttTopicText }}</strong>
              </div>
              <ElTag size="small" type="success">{{ t('publication.uplinks.subscribed') }}</ElTag>
            </article>
            <article>
              <div>
                <span>{{ t('publication.uplinks.downlinkTarget') }}</span>
                <strong>{{ commandTopicText }}</strong>
              </div>
              <ElTag size="small" :type="sending ? 'warning' : 'info'">
                {{
                  sending ? t('publication.uplinks.sending') : t('publication.uplinks.pendingSend')
                }}
              </ElTag>
            </article>
          </div>

          <div class="command-form">
            <ElInput
              v-model="commandForm.deviceId"
              clearable
              :placeholder="t('publication.uplinks.targetDevice')"
            />
            <ElSelect
              v-model="commandForm.type"
              :placeholder="t('publication.uplinks.commandType')"
            >
              <ElOption :label="t('publication.uplinks.restartGateway')" value="restart" />
              <ElOption :label="t('publication.uplinks.customCommand')" value="custom" />
            </ElSelect>
            <ElInput
              v-model="commandForm.topic"
              clearable
              :placeholder="t('publication.uplinks.topicPlaceholder')"
            />
            <ElInputNumber v-model="commandForm.qos" :min="0" :max="2" controls-position="right" />
            <ElCheckbox v-model="commandForm.retain">Retain</ElCheckbox>
            <ElInput
              v-model="commandForm.payloadJson"
              type="textarea"
              :rows="5"
              placeholder='{"method":"reset"}'
            />
            <ElButton type="primary" :loading="sending" @click="sendCommand">{{
              t('publication.uplinks.sendCommand')
            }}</ElButton>
          </div>
        </FcPanel>

        <FcPanel :title="t('publication.uplinks.recentCommands')" dense>
          <div class="log-list">
            <article v-for="row in latestCommandRows" :key="String(row.id)">
              <div>
                <strong>{{ row.deviceId || '-' }}</strong>
                <span>{{ row.commandType || row.type || 'control' }}</span>
                <p>{{ formatDateTime(row.requestedAt || row.createdAt) }}</p>
              </div>
              <ElTag size="small" :type="statusTagType(row.status)">{{
                statusText(row.status)
              }}</ElTag>
            </article>
            <FcEmptyState
              v-if="!latestCommandRows.length"
              icon="ri:terminal-box-line"
              :title="t('publication.uplinks.noCommandTitle')"
              :description="t('publication.uplinks.noCommandDescription')"
            />
          </div>
        </FcPanel>

        <FcPanel
          :title="t('publication.uplinks.mappedTemperature')"
          :subtitle="t('publication.uplinks.mappedTemperatureSubtitle')"
          dense
        >
          <div class="mapping-summary">
            <article>
              <span>{{ t('publication.uplinks.currentRecord') }}</span>
              <strong>{{
                selectedMessageRow?.cowNumber || selectedMessageRow?.deviceId || '--'
              }}</strong>
            </article>
            <article>
              <span>{{ t('publication.uplinks.publishedAt') }}</span>
              <strong>{{
                formatDateTime(selectedMessageRow?.publishedAt || selectedMessageRow?.receivedAt)
              }}</strong>
            </article>
            <article>
              <span>{{ t('publication.uplinks.linkedCount') }}</span>
              <strong>{{ selectedLinkedSensorRows.length || 0 }}</strong>
            </article>
          </div>

          <ElTable :data="selectedLinkedSensorRows" max-height="260" style="width: 100%">
            <ElTableColumn prop="metric" :label="t('publication.uplinks.metric')" min-width="120" />
            <ElTableColumn :label="t('publication.uplinks.value')" min-width="100">
              <template #default="{ row }">
                {{ formatSensorValue(row) }}
              </template>
            </ElTableColumn>
            <ElTableColumn :label="t('publication.uplinks.publishedAt')" min-width="168">
              <template #default="{ row }">
                {{ formatDateTime(row.measuredAt || row.timestamp || row.createdAt) }}
              </template>
            </ElTableColumn>
            <ElTableColumn
              prop="sourceTable"
              :label="t('publication.uplinks.sourceTable')"
              min-width="120"
            />
            <ElTableColumn
              prop="sourceRecordId"
              :label="t('publication.uplinks.sourceRecord')"
              min-width="160"
              show-overflow-tooltip
            />
          </ElTable>
          <FcEmptyState
            v-if="!selectedLinkedSensorRows.length"
            icon="ri:pulse-line"
            :title="t('publication.uplinks.noMappedTitle')"
            :description="t('publication.uplinks.noMappedDescription')"
          />
        </FcPanel>
      </div>
    </section>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { ElMessage } from 'element-plus'
  import { hardwareApi } from '@/api/cow'
  import * as databaseService from '@/services/数据库'
  import { formatDateOnly } from '@/utils/date-display'

  const { t } = useI18n()

  interface MqttMessageRow {
    id: string
    direction: string
    topic: string
    status: string
    qos?: number
    deviceId?: string
    cowId?: string
    cowNumber?: string
    commandType?: string
    sourceMessageId?: string
    publishedAt?: string
    receivedAt?: string
    payloadJson?: unknown
    parsedPayload?: unknown
    sourceRecordIds?: Record<string, string[]>
    source_record_ids?: Record<string, string[]>
    createdAt?: string
    requestedAt?: string
  }

  interface UnifiedSensorRow {
    id?: string
    cowId?: string
    cowNumber?: string
    metric?: string
    metricCode?: string
    metric_code?: string
    value?: number
    readingValue?: number
    reading_value?: number
    temperature?: number
    bodyTemperature?: number
    body_temperature?: number
    measuredAt?: string
    timestamp?: string
    createdAt?: string
    sourceTable?: string
    sourceRecordId?: string
    source_record_id?: string
  }

  const loading = ref(false)
  const sending = ref(false)
  const mqttRows = ref<MqttMessageRow[]>([])
  const commandRows = ref<Record<string, any>[]>([])
  const hardwareRows = ref<Record<string, any>[]>([])
  const sensorRows = ref<UnifiedSensorRow[]>([])
  const selectedMessageId = ref('')

  const filters = reactive({
    keyword: '',
    direction: 'uplink',
    metric: ''
  })

  const commandForm = reactive({
    deviceId: MQTT_DEFAULT_DEVICE_ID(),
    type: 'restart',
    topic: '',
    qos: 0,
    retain: false,
    payloadJson: '{"method":"reset"}'
  })

  function MQTT_DEFAULT_DEVICE_ID() {
    return 'mqtt-live-gateway'
  }

  const safeRows = async <T,>(tableName: string, limit = 100): Promise<T[]> => {
    try {
      return (await databaseService.getTableDataAsync(tableName, {
        silent: true,
        limit,
        pageSize: limit,
        orderDir: 'desc'
      })) as T[]
    } catch {
      return []
    }
  }

  const loadData = async () => {
    loading.value = true
    try {
      const [messageRows, commandLogRows, deviceRows, unifiedSensorRows] = await Promise.all([
        safeRows<MqttMessageRow>('mqtt-message-logs', 200),
        safeRows<Record<string, any>>('hardware-command-logs', 50),
        safeRows<Record<string, any>>('hardware-devices', 50),
        databaseService.getUnifiedSensorDataAsync([], { limit: 200, pageSize: 200 }).catch(() => [])
      ])
      mqttRows.value = messageRows.sort(sortByRecent)
      commandRows.value = commandLogRows.sort(sortByRecent)
      hardwareRows.value = deviceRows
      sensorRows.value = unifiedSensorRows
      if (!commandForm.deviceId) {
        commandForm.deviceId = String(deviceRows[0]?.id || MQTT_DEFAULT_DEVICE_ID())
      }
      if (!selectedMessageId.value && messageRows.length) {
        const latestUplinkRow =
          messageRows.find((row) => String(row.direction || '').toLowerCase() !== 'downlink') ||
          messageRows[0]
        selectedMessageId.value = String(latestUplinkRow?.id || '')
      }
    } finally {
      loading.value = false
    }
  }

  const uplinkRows = computed(() => mqttRows.value.filter((row) => row.direction !== 'downlink'))
  const downlinkRows = computed(() => mqttRows.value.filter((row) => row.direction === 'downlink'))
  const latestUplink = computed(() => uplinkRows.value[0] || null)
  const latestDownlink = computed(() => downlinkRows.value[0] || null)
  const latestCommand = computed(() => commandRows.value[0] || null)
  const selectedMessageRow = computed(
    () =>
      mqttRows.value.find((row) => String(row.id) === selectedMessageId.value) ||
      latestUplink.value ||
      null
  )
  const latestPublishedAt = computed(() => latestUplink.value?.publishedAt || '')
  const latestReceivedAt = computed(
    () => latestUplink.value?.receivedAt || latestUplink.value?.createdAt || ''
  )
  const latestCommandRows = computed(() => commandRows.value.slice(0, 6))
  const mqttTopicText = computed(() => uplinkRows.value[0]?.topic || 'cattle/+/temperature')
  const commandTopicText = computed(
    () => commandForm.topic || `command/send/${commandForm.deviceId || MQTT_DEFAULT_DEVICE_ID()}`
  )
  const statusTopicText = computed(() => mqttTopicText.value || '--')
  const selectedLinkedSensorRows = computed(() =>
    selectedMessageRow.value ? linkedSensorRows(selectedMessageRow.value) : []
  )

  const filteredRows = computed(() => {
    const keyword = filters.keyword.trim().toLowerCase()
    return mqttRows.value.filter((row) => {
      if (filters.direction && row.direction !== filters.direction) return false
      if (filters.metric && row.status !== filters.metric) return false
      if (!keyword) return true
      const haystack = JSON.stringify([
        row.cowNumber,
        row.deviceId,
        row.topic,
        row.payloadJson,
        row.parsedPayload,
        row.commandType
      ]).toLowerCase()
      return haystack.includes(keyword)
    })
  })

  function sortByRecent(left: Record<string, any>, right: Record<string, any>) {
    const leftTime = Date.parse(
      String(left.publishedAt || left.receivedAt || left.requestedAt || left.createdAt || 0)
    )
    const rightTime = Date.parse(
      String(right.publishedAt || right.receivedAt || right.requestedAt || right.createdAt || 0)
    )
    return rightTime - leftTime
  }

  function normalizeStringList(values: unknown): string[] {
    return Array.isArray(values)
      ? values.map((value) => String(value || '').trim()).filter(Boolean)
      : []
  }

  function mqttSourceRecordIds(row: MqttMessageRow) {
    return (row.sourceRecordIds || row.source_record_ids || {}) as Record<string, string[]>
  }

  function sensorMetric(row: UnifiedSensorRow) {
    return String(row.metric || row.metricCode || row.metric_code || '').trim()
  }

  function normalizedSensorMetric(row: UnifiedSensorRow) {
    return sensorMetric(row).toLowerCase()
  }

  function sensorSourceRecordId(row: UnifiedSensorRow) {
    return String(row.sourceRecordId || row.source_record_id || row.id || '').trim()
  }

  function sensorNumericValue(row: UnifiedSensorRow) {
    const value =
      row.readingValue ??
      row.reading_value ??
      row.value ??
      row.bodyTemperature ??
      row.body_temperature ??
      row.temperature
    return value === undefined || value === null || Number.isNaN(Number(value))
      ? undefined
      : Number(value)
  }

  function linkedSensorRows(row: MqttMessageRow) {
    const sourceRecordIds = mqttSourceRecordIds(row)
    const readingIds = new Set(
      normalizeStringList(sourceRecordIds.sensor_readings).concat(
        normalizeStringList(sourceRecordIds.sensor_reading)
      )
    )
    const sensorIds = new Set(normalizeStringList(sourceRecordIds.sensors))
    const sourceMessageId = String(row.sourceMessageId || '').trim()
    const cowId = String(row.cowId || '').trim()
    const cowNumber = String(row.cowNumber || '').trim()

    return sensorRows.value.filter((sensorRow) => {
      const recordId = sensorSourceRecordId(sensorRow)
      if (readingIds.has(recordId) || sensorIds.has(recordId)) return true
      if (sourceMessageId && recordId === sourceMessageId) return true
      if (cowId && String(sensorRow.cowId || '').trim() === cowId) {
        const sensorTime = Date.parse(
          String(sensorRow.measuredAt || sensorRow.timestamp || sensorRow.createdAt || '')
        )
        const messageTime = Date.parse(
          String(row.publishedAt || row.receivedAt || row.createdAt || '')
        )
        if (
          Number.isFinite(sensorTime) &&
          Number.isFinite(messageTime) &&
          Math.abs(sensorTime - messageTime) <= 60 * 1000
        ) {
          return true
        }
      }
      return (
        cowNumber &&
        String(sensorRow.cowNumber || '').trim() === cowNumber &&
        sourceMessageId &&
        recordId.includes(sourceMessageId)
      )
    })
  }

  function bodyTemperaturePriority(row: UnifiedSensorRow) {
    const metric = normalizedSensorMetric(row)
    if (!metric || /ambient|environment|signal/.test(metric)) return -1
    if (/rectal_temperature|rectal/.test(metric)) return 4
    if (/body_temperature|bodytemp|body_temp/.test(metric)) return 3
    if (/ear_temperature|eartemp|ear_temp/.test(metric)) return 2
    if (metric === 'temperature' || /(^|_)temperature$/.test(metric)) return 1
    return -1
  }

  function linkedBodyTemperature(row: MqttMessageRow) {
    const linked = linkedSensorRows(row)
      .map((sensorRow) => ({ sensorRow, priority: bodyTemperaturePriority(sensorRow) }))
      .filter((entry) => entry.priority >= 0)
      .sort((left, right) => right.priority - left.priority)[0]?.sensorRow
    return sensorNumericValue(linked || {})
  }

  function messagePayload(row: MqttMessageRow): Record<string, any> {
    for (const candidate of [row.parsedPayload, row.payloadJson]) {
      if (candidate && typeof candidate === 'object') return candidate as Record<string, any>
      if (typeof candidate !== 'string' || !candidate.trim()) continue
      try {
        const parsed = JSON.parse(candidate)
        if (parsed && typeof parsed === 'object') return parsed as Record<string, any>
      } catch {
        // Non-JSON MQTT payloads are displayed from linked sensor readings only.
      }
    }
    return {}
  }

  function resolvedBodyTemperature(row: MqttMessageRow) {
    const linkedValue = linkedBodyTemperature(row)
    if (linkedValue !== undefined) return linkedValue
    const payload = messagePayload(row)
    const value =
      payload.bodyTemperature ??
      payload.rectalTemperature ??
      payload.compensatedTemperature ??
      payload.earTemperature ??
      payload.temperature
    return value === undefined || value === null || Number.isNaN(Number(value))
      ? undefined
      : Number(value)
  }

  function resolvedRssi(row: MqttMessageRow) {
    const linkedValue = sensorNumericValue(
      linkedSensorRows(row).find((sensorRow) => /signal_strength|rssi/i.test(sensorMetric(sensorRow))) ||
        {}
    )
    if (linkedValue !== undefined) return linkedValue
    const payload = messagePayload(row)
    const value = payload.signalStrength ?? payload.signal_strength ?? payload.rssi ?? payload.RSSI
    return value === undefined || value === null || Number.isNaN(Number(value))
      ? undefined
      : Number(value)
  }

  function formatDateTime(value?: string) {
    if (!value) return '--'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return formatDateOnly(value, '--')
    return `${formatDateOnly(date, '--')} ${String(date.getHours()).padStart(2, '0')}:${String(
      date.getMinutes()
    ).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
  }

  function statusText(status?: string) {
    const map: Record<string, string> = {
      ingested: t('publication.uplinks.ingested'),
      ignored: t('publication.uplinks.ignored'),
      sent: t('publication.uplinks.sent'),
      acknowledged: t('publication.uplinks.acknowledged'),
      failed: t('publication.uplinks.failed'),
      received: t('publication.uplinks.received')
    }
    return map[String(status || '')] || String(status || '--')
  }

  function statusTagType(status?: string) {
    const key = String(status || '').toLowerCase()
    if (['sent', 'acknowledged', 'ingested', 'received'].includes(key)) return 'success'
    if (key === 'ignored') return 'warning'
    if (key === 'failed') return 'danger'
    return 'info'
  }

  function payloadPreview(row: MqttMessageRow) {
    const source = row.payloadJson ?? row.parsedPayload
    if (typeof source === 'string') return source
    try {
      return JSON.stringify(source || {}, null, 0)
    } catch {
      return '--'
    }
  }

  function formatTemperature(value?: number) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return '--'
    return `${Number(value).toFixed(2)}℃`
  }

  function formatRssi(value?: number) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return '--'
    return `${Number(value).toFixed(0)} dBm`
  }

  function formatSensorValue(row: UnifiedSensorRow) {
    const value = sensorNumericValue(row)
    if (value === undefined) return '--'
    if (/signal_strength/.test(sensorMetric(row))) return `${value.toFixed(0)} dBm`
    if (/temperature/.test(sensorMetric(row))) return `${value.toFixed(1)}℃`
    return `${value}`
  }

  function selectMessageRow(row: MqttMessageRow) {
    selectedMessageId.value = String(row.id || '')
  }

  async function sendCommand() {
    const deviceId = String(commandForm.deviceId || '').trim()
    if (!deviceId) {
      ElMessage.warning(t('publication.uplinks.deviceRequired'))
      return
    }

    let payload = undefined as Record<string, unknown> | undefined
    if (commandForm.payloadJson.trim()) {
      try {
        payload = JSON.parse(commandForm.payloadJson)
      } catch {
        ElMessage.error(t('publication.uplinks.invalidPayload'))
        return
      }
    }

    sending.value = true
    try {
      await hardwareApi.sendDeviceCommand(deviceId, {
        type: commandForm.type,
        priority: 'high',
        qos: Math.max(0, Math.min(2, Number(commandForm.qos || 0))),
        retain: Boolean(commandForm.retain),
        parameters: {
          requestedBy: t('publication.uplinks.deviceAdmin'),
          reason:
            commandForm.type === 'restart'
              ? t('publication.uplinks.remoteRestart')
              : t('publication.uplinks.manualCommand')
        },
        ...(commandForm.topic.trim() ? { topic: commandForm.topic.trim() } : {}),
        ...(payload ? { payload } : {})
      })
      ElMessage.success(t('publication.uplinks.commandSent'))
      await loadData()
    } catch (error) {
      ElMessage.error(t('publication.uplinks.commandFailed'))
      console.error(error)
    } finally {
      sending.value = false
    }
  }

  async function sendRestartCommand() {
    commandForm.type = 'restart'
    if (!commandForm.payloadJson.trim()) commandForm.payloadJson = '{"method":"reset"}'
    await sendCommand()
  }

  onMounted(loadData)
</script>

<style scoped lang="scss">
  .metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 14px;
  }

  .page-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.7fr);
    gap: 18px;
    align-items: start;
  }

  .toolbar,
  .command-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 140px 160px;
    gap: 10px;
    margin-bottom: 14px;
  }

  .command-form {
    grid-template-columns: 1fr;
  }

  .payload-cell {
    display: -webkit-box;
    overflow: hidden;
    font-size: 12px;
    line-height: 1.55;
    color: var(--fluent-text-soft);
    word-break: break-all;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  .side-stack,
  .log-list,
  .info-list,
  .topic-list {
    display: grid;
    gap: 12px;
  }

  .log-list article,
  .info-list article,
  .topic-list article {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    padding: 12px;
    background: rgb(255 255 255 / 42%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .log-list strong,
  .info-list strong,
  .topic-list strong {
    font-size: 13px;
    font-weight: 720;
    color: var(--fluent-text);
    overflow-wrap: anywhere;
  }

  .log-list span,
  .info-list span,
  .topic-list span {
    display: block;
    font-size: 12px;
    color: var(--fluent-muted);
  }

  .log-list p {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--fluent-text-soft);
  }

  @media (width <= 1100px) {
    .page-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (width <= 760px) {
    .toolbar {
      grid-template-columns: 1fr;
    }
  }
</style>
