<template>
  <FcPageShell
    :title="t('publication.alerts.title')"
    :status-label="t('publication.alerts.currentAlerts')"
    :status-value="t('publication.alerts.headCount', { count: filteredCowList.length })"
    :primary-action-label="t('publication.alerts.createQueue')"
    primary-action-icon="ri:alarm-warning-line"
    :secondary-action-label="t('publication.alerts.resetRules')"
    secondary-action-icon="ri:refresh-line"
    @primary-action="createWorklist"
    @secondary-action="handleReset"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          :label="t('publication.alerts.matches')"
          :value="filteredCowList.length"
          :note="t('publication.alerts.matchesNote')"
          icon="ri:alarm-warning-line"
        />
        <FcMetricTile
          :label="t('publication.alerts.health')"
          :value="healthWarningCount"
          :note="t('publication.alerts.healthNote')"
          icon="ri:heart-pulse-line"
          tone="danger"
        />
        <FcMetricTile
          :label="t('publication.alerts.breeding')"
          :value="breedingWarningCount"
          :note="t('publication.alerts.breedingNote')"
          icon="ri:calendar-event-line"
          tone="warning"
        />
        <FcMetricTile
          :label="t('publication.alerts.rfid')"
          :value="rfidWarningCount"
          :note="t('publication.alerts.rfidNote')"
          icon="ri:rfid-line"
          tone="danger"
        />
        <FcMetricTile
          :label="t('publication.alerts.coverage')"
          :value="sensorCoverage"
          unit="%"
          :note="t('publication.alerts.coverageNote')"
          icon="ri:pulse-line"
          tone="teal"
        />
      </section>
    </template>

    <section class="filter-layout">
      <FcPanel :title="t('publication.alerts.ruleBuilder')">
        <div class="rule-builder">
          <div class="intent-strip" :aria-label="t('publication.alerts.commonScenarios')">
            <button class="art-card-xs" type="button" @click="setRulePreset('vet')">
              <ArtSvgIcon icon="ri:heart-pulse-line" />
              {{ t('publication.alerts.vetReview') }}
            </button>
            <button class="art-card-xs" type="button" @click="setRulePreset('breeding')">
              <ArtSvgIcon icon="ri:calendar-heart-line" />
              {{ t('publication.alerts.breedingCoordination') }}
            </button>
            <button class="art-card-xs" type="button" @click="setRulePreset('transfer')">
              <ArtSvgIcon icon="ri:route-line" />
              {{ t('publication.alerts.penVerification') }}
            </button>
            <button class="art-card-xs" type="button" @click="setRulePreset('all')">
              <ArtSvgIcon icon="ri:list-check-3" />
              {{ t('publication.alerts.herdInspection') }}
            </button>
          </div>

          <div class="rule-grid">
            <label class="rule-card is-wide art-card-xs">
              <span>{{ t('publication.alerts.scope') }}</span>
              <CowNumberAutocomplete
                v-model="filterForm.keyword"
                :placeholder="t('publication.alerts.scopePlaceholder')"
                @select="handleCowKeywordSelect"
              />
            </label>
            <label class="rule-card is-date art-card-xs">
              <span>{{ t('publication.alerts.eventWindow') }}</span>
              <ElDatePicker
                v-model="filterForm.dateRange"
                type="daterange"
                value-format="YYYY-MM-DD"
                :range-separator="t('publication.alerts.to')"
                :start-placeholder="t('publication.alerts.startDate')"
                :end-placeholder="t('publication.alerts.endDate')"
              />
            </label>
            <label class="rule-card art-card-xs">
              <span>{{ t('publication.alerts.primaryEvent') }}</span>
              <ElSelect
                v-model="filterForm.eventType"
                clearable
                :placeholder="t('publication.alerts.selectEvent')"
                @change="handleEventTypeChange"
              >
                <ElOption
                  v-for="type in eventTypes"
                  :key="type.value"
                  :label="type.label"
                  :value="type.value"
                />
              </ElSelect>
            </label>
            <label class="rule-card art-card-xs">
              <span>{{ t('publication.alerts.secondaryEvent') }}</span>
              <ElSelect
                v-model="filterForm.subEventType"
                clearable
                :placeholder="t('publication.alerts.selectSubtype')"
              >
                <ElOption
                  v-for="type in subEventTypes"
                  :key="type.value"
                  :label="type.label"
                  :value="type.value"
                />
              </ElSelect>
            </label>
            <label class="rule-card art-card-xs">
              <span>{{ t('publication.alerts.cowStatus') }}</span>
              <ElSelect
                v-model="filterForm.status"
                clearable
                :placeholder="t('publication.alerts.selectStatus')"
              >
                <ElOption
                  v-for="status in statusOptions"
                  :key="status.value"
                  :label="status.label"
                  :value="status.value"
                />
              </ElSelect>
            </label>
          </div>

          <div class="rule-footer">
            <div class="active-rules">
              <article v-for="item in activeRuleCards" :key="item.label" class="art-card-xs">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </article>
            </div>
            <div class="strategy-actions">
              <ElButton type="primary" @click="handleFilter">
                <ArtSvgIcon icon="ri:filter-line" class="mr-1" />
                {{ t('publication.alerts.applyRules') }}
              </ElButton>
              <ElButton @click="handleReset">{{ t('publication.alerts.reset') }}</ElButton>
            </div>
          </div>
        </div>
      </FcPanel>

      <FcPanel :title="t('publication.alerts.recommendations')">
        <div class="decision-stack">
          <article
            v-for="item in decisionCards"
            :key="item.label"
            class="decision-card art-card-xs"
            :class="item.tone"
          >
            <div>
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </article>
        </div>
      </FcPanel>
    </section>

    <section class="filter-layout is-list">
      <FcPanel :title="t('publication.alerts.alertQueue')">
        <div
          v-if="currentPageData.length"
          ref="cowCardContainerRef"
          class="cow-worklist-scroll"
          @scroll.passive="onCowCardScroll"
          @wheel.passive="onCowCardWheel"
        >
          <div class="cow-worklist">
            <article
              v-for="cow in currentPageData"
              :key="cow.id"
              class="cow-card art-card"
              :class="[getCowTone(cow), { 'is-active': selectedCow?.id === cow.id }]"
            >
              <div class="cow-card-top">
                <div>
                  <span>{{
                    dataLabel(cow.currentPen) || t('publication.alerts.unassignedPen')
                  }}</span>
                  <h3>{{ t('publication.alerts.cowNumber', { value: cow.cowNumber }) }}</h3>
                  <p
                    >{{ dataLabel(cow.breed) }} · {{ dataLabel(cow.gender) }} ·
                    {{ dataLabel(cow.type) }}</p
                  >
                </div>
                <ElTag :type="getCowTagType(cow.status)">{{ dataLabel(cow.status) }}</ElTag>
              </div>

              <div v-if="getCowAlerts(cow.id).length" class="alert-chip-row">
                <ElTag
                  v-for="alert in getCowAlerts(cow.id).slice(0, 3)"
                  :key="alert.id"
                  :type="alert.tagType"
                  size="small"
                >
                  {{ alert.title }}
                </ElTag>
              </div>

              <div class="sensor-strip">
                <div>
                  <span>{{ t('publication.alerts.latestTemperature') }}</span>
                  <strong>{{ formatSensorTemperature(getLatestSensorData(cow.id)) }}</strong>
                </div>
                <div>
                  <span>{{ t('publication.alerts.parity') }}</span>
                  <strong>{{ cow.parity }}</strong>
                </div>
                <div>
                  <span>DIM</span>
                  <strong>{{ formatDim(cow) }}</strong>
                </div>
              </div>

              <div class="cow-reason">
                <ArtSvgIcon :icon="getRecommendation(cow).icon" />
                <span>{{ getRecommendation(cow).text }}</span>
              </div>

              <div class="cow-card-actions">
                <ElButton size="small" @click.stop="showCowDetail(cow)">{{
                  t('publication.alerts.details')
                }}</ElButton>
                <ElButton size="small" type="primary" @click.stop="markCow(cow)">{{
                  t('publication.alerts.addToHandling')
                }}</ElButton>
              </div>
            </article>
          </div>
        </div>

        <FcEmptyState
          v-else
          icon="ri:search-eye-line"
          :title="t('publication.alerts.noMatches')"
          :description="t('publication.alerts.noMatchesDescription')"
          :action-label="t('publication.alerts.resetRules')"
          @action="handleReset"
        />
      </FcPanel>

      <div class="side-stack">
        <FcPanel :title="t('publication.alerts.eventMatches')" dense>
          <div class="event-hit-list">
            <article v-for="event in recentEvents.slice(0, 5)" :key="event.id" class="art-card-xs">
              <span>{{ event.eventType }} · {{ formatDate(event.eventTime) }}</span>
              <strong>{{ event.event }}</strong>
              <p>{{
                event.cowNumber
                  ? t('publication.alerts.cowNumber', { value: event.cowNumber })
                  : t('publication.alerts.unmatchedCow')
              }}</p>
            </article>
            <FcEmptyState
              v-if="!recentEvents.length"
              icon="ri:file-list-3-line"
              :title="t('publication.alerts.noEvents')"
              :description="t('publication.alerts.noEventsDescription')"
            />
          </div>
        </FcPanel>

        <FcPanel :title="t('publication.alerts.alertTypes')" dense>
          <div class="explain-list">
            <ElTag type="danger">{{ t('publication.alerts.vetReview') }}</ElTag>
            <ElTag type="warning">{{ t('publication.alerts.breedingCoordination') }}</ElTag>
            <ElTag type="info">{{ t('publication.alerts.penVerification') }}</ElTag>
            <ElTag type="success">{{ t('publication.alerts.sensorRecollection') }}</ElTag>
          </div>
        </FcPanel>
      </div>
    </section>

    <ElDialog
      v-model="detailDialogVisible"
      :title="t('publication.alerts.handlingCard')"
      width="860px"
      @close="handleCloseDetail"
    >
      <div v-if="selectedCow" class="detail-grid">
        <section class="detail-summary art-card-sm">
          <h3>{{ t('publication.alerts.cowNumber', { value: selectedCow.cowNumber }) }}</h3>
          <p
            >{{ dataLabel(selectedCow.breed) }} · {{ dataLabel(selectedCow.gender) }} ·
            {{ dataLabel(selectedCow.type) }}</p
          >
          <div class="detail-metrics">
            <div class="art-card-xs"
              ><span>{{ t('publication.alerts.earTag') }}</span
              ><strong>{{ selectedCow.earTagNumber || '-' }}</strong></div
            >
            <div class="art-card-xs"
              ><span>{{ t('publication.alerts.pen') }}</span
              ><strong>{{ dataLabel(selectedCow.currentPen) || '-' }}</strong></div
            >
            <div class="art-card-xs"
              ><span>{{ t('publication.alerts.birth') }}</span
              ><strong>{{ formatDate(selectedCow.birthDate) }}</strong></div
            >
            <div class="art-card-xs"
              ><span>{{ t('publication.alerts.parity') }}</span
              ><strong>{{ selectedCow.parity }}</strong></div
            >
            <div class="art-card-xs"
              ><span>DIM</span><strong>{{ formatDim(selectedCow) }}</strong></div
            >
          </div>
        </section>

        <section class="detail-summary art-card-sm">
          <h3>{{ t('publication.alerts.latestSensor') }}</h3>
          <p>{{ getRecommendation(selectedCow).text }}</p>
          <div class="detail-metrics">
            <div class="art-card-xs"
              ><span>{{ t('publication.alerts.temperature') }}</span
              ><strong>{{
                formatSensorTemperature(getLatestSensorData(selectedCow.id))
              }}</strong></div
            >
            <div class="art-card-xs"
              ><span>{{ t('publication.alerts.status') }}</span
              ><strong>{{ dataLabel(selectedCow.status) }}</strong></div
            >
            <div class="art-card-xs"
              ><span>{{ t('publication.alerts.age') }}</span
              ><strong>{{ getAge(selectedCow.birthDate) }}</strong></div
            >
          </div>
        </section>
      </div>

      <section v-if="selectedCow && getCowAlerts(selectedCow.id).length" class="alert-detail-list">
        <article
          v-for="alert in getCowAlerts(selectedCow.id)"
          :key="alert.id"
          class="art-card-xs"
          :class="alert.severity"
        >
          <div>
            <span>{{ alert.eventType }} · {{ alert.description }}</span>
            <h3>{{ alert.title }}</h3>
            <p>{{ alert.recommendation }}</p>
            <small>{{ alert.evidence.join('；') }}</small>
          </div>
          <ElTag :type="alert.tagType">{{ getAlertSeverityLabel(alert.severity) }}</ElTag>
        </article>
      </section>

      <FcDataTableShell :title="t('publication.alerts.eventRecords')">
        <ElTable :data="visibleCowEvents" height="300" @wheel.passive="onCowEventTableWheel">
          <ElTableColumn prop="eventTime" :label="t('publication.alerts.time')" width="170">
            <template #default="{ row }">{{ formatDateTime(row.eventTime) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="eventType" :label="t('publication.alerts.type')" width="110" />
          <ElTableColumn prop="event" :label="t('publication.alerts.event')" min-width="160" />
          <ElTableColumn prop="person" :label="t('publication.alerts.person')" width="120" />
          <ElTableColumn prop="notes" :label="t('publication.alerts.notes')" min-width="160" />
        </ElTable>
        <div v-if="cowEvents.length > visibleCowEvents.length" class="load-more-row">
          <ElButton @click="() => loadMoreCowEvents()">{{
            t('publication.alerts.loadMore', {
              visible: visibleCowEvents.length,
              total: cowEvents.length
            })
          }}</ElButton>
        </div>
      </FcDataTableShell>
    </ElDialog>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useRoute } from 'vue-router'
  import { ElMessage } from 'element-plus'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import FcEmptyState from '@/components/business/fluent-console/FcEmptyState.vue'
  import FcDataTableShell from '@/components/business/fluent-console/FcDataTableShell.vue'
  import CowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'
  import * as databaseService from '@/services/数据库'
  import { useLazyGridRenderWindow, useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'
  import {
    CURRENT_TEMPERATURE_ALERT_MAX_AGE_MS,
    evaluateTwoOfThreeHighTemperature,
    shouldSurfaceCurrentPersistedAlert,
    THREE_POINT_HIGH_TEMPERATURE_THRESHOLD
  } from '@/utils/health-alert-rules'
  import { CowGender, CowStatus, EventType } from '@/types'
  import type { CowBasic, ExtendedSensorData } from '@/types'

  defineOptions({ name: 'CowInfoFilter' })

  const { locale, t } = useI18n()

  type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

  interface CowEventRow {
    id: string
    cowId: string
    cowNumber?: string
    eventTime: string
    eventType: string
    event: string
    person: string
    notes: string
  }

  type AlertKind = 'health' | 'estrus' | 'calving' | 'tag' | 'rfid' | 'temperature'
  type AlertSeverity = 'critical' | 'high' | 'medium'

  interface SensorSnapshot {
    id: string
    cowId: string
    cowNumber?: string
    timestamp: string
    temperature?: number
    activity?: number
    deviceId?: string
    penId?: string
    penName?: string
    raw?: Record<string, unknown>
  }

  interface CowAlert {
    id: string
    cowId: string
    kind: AlertKind
    title: string
    eventType: EventType
    severity: AlertSeverity
    tagType: TagType
    icon: string
    description: string
    recommendation: string
    evidence: string[]
    detectedAt: string
    ruleCode?: string
  }

  interface CowProductionState {
    dim: number | null
    parity: number | null
    lastBreedingAt: string
    expectedCalvingAt: string
  }

  const filterForm = reactive({
    keyword: '',
    dateRange: [] as string[],
    eventType: '' as EventType | '',
    subEventType: '',
    status: '' as CowStatus | '',
    scope: 'alerts' as 'alerts' | 'all'
  })

  const cowList = ref<CowBasic[]>([])
  const filteredCowList = ref<CowBasic[]>([])
  const sensorDataMap = ref<Record<string, ExtendedSensorData>>({})
  const sensorHistoryMap = ref<Record<string, SensorSnapshot[]>>({})
  const cowAlertMap = ref<Record<string, CowAlert[]>>({})
  const productionStateMap = ref<Record<string, CowProductionState>>({})
  const allEvents = ref<CowEventRow[]>([])
  const cowEvents = ref<CowEventRow[]>([])
  const {
    visibleItems: visibleCowEvents,
    loadMore: loadMoreCowEvents,
    resetVisibleCount: resetCowEventRows,
    handleWheel: onCowEventTableWheel
  } = useLazyRenderWindow(cowEvents, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const selectedCow = ref<CowBasic | null>(null)
  const detailDialogVisible = ref(false)
  const route = useRoute()

  const DAY_MS = 86400000
  const GESTATION_DAYS = 310

  const dataLabel = (value?: string | number | null) => {
    const text = String(value ?? '').trim()
    if (locale.value === 'zh' || !text) return text
    const labels: Record<string, string> = {
      西门塔尔: 'Simmental',
      西门塔尔牛: 'Simmental',
      华西: 'Huaxi',
      华西牛: 'Huaxi',
      公: 'Male',
      母: 'Female',
      公牛: 'Bull',
      母牛: 'Cow',
      犊牛: 'Calf',
      育成牛: 'Heifer',
      青年牛: 'Young cattle',
      健康: 'Healthy',
      异常: 'Abnormal',
      发情: 'Estrus',
      妊娠: 'Pregnant',
      混群: 'Mixed group',
      在群: 'In herd',
      离群: 'Exited',
      成母牛: 'Adult cow',
      新三圈: 'Pen 3'
    }
    return labels[text] || text
  }

  const eventTypes = computed(() => [
    { label: t('publication.alerts.breedingEvent'), value: EventType.BREEDING },
    { label: t('publication.alerts.veterinaryEvent'), value: EventType.VETERINARY },
    { label: t('publication.alerts.transferEvent'), value: EventType.TRANSFER },
    { label: t('publication.alerts.entryEvent'), value: EventType.ENTRY },
    { label: t('publication.alerts.exitEvent'), value: EventType.EXIT }
  ])

  const subEventOptions = computed<Partial<Record<EventType, { label: string; value: string }[]>>>(
    () => ({
      [EventType.BREEDING]: [
        { label: t('publication.alerts.mating'), value: '配种' },
        { label: t('publication.alerts.pregnancyCheck'), value: '孕检' },
        { label: t('publication.alerts.calving'), value: '产犊' }
      ],
      [EventType.VETERINARY]: [
        { label: t('publication.alerts.illness'), value: '发病' },
        { label: t('publication.alerts.medication'), value: '用药' },
        { label: t('publication.alerts.treatment'), value: '治疗' }
      ],
      [EventType.TRANSFER]: [{ label: t('publication.alerts.transferEvent'), value: '转群' }],
      [EventType.ENTRY]: [{ label: t('publication.alerts.entryEvent'), value: '入群' }],
      [EventType.EXIT]: [{ label: t('publication.alerts.exitEvent'), value: '离群' }]
    })
  )

  const statusOptions = computed(() =>
    Object.values(CowStatus).map((status) => ({ label: dataLabel(status), value: status }))
  )
  const subEventTypes = computed(() =>
    filterForm.eventType ? subEventOptions.value[filterForm.eventType] || [] : []
  )

  const abnormalCount = computed(
    () => filteredCowList.value.filter((cow) => cow.status === CowStatus.ABNORMAL).length
  )
  const heatCount = computed(
    () => filteredCowList.value.filter((cow) => cow.status === CowStatus.HEAT).length
  )
  const pregnantCount = computed(
    () => filteredCowList.value.filter((cow) => cow.status === CowStatus.PREGNANT).length
  )
  const filteredAlerts = computed(() =>
    filteredCowList.value.flatMap((cow) => getCowAlerts(cow.id))
  )
  const healthWarningCount = computed(
    () =>
      filteredAlerts.value.filter((alert) => ['health', 'temperature'].includes(alert.kind)).length
  )
  const breedingWarningCount = computed(
    () => filteredAlerts.value.filter((alert) => ['estrus', 'calving'].includes(alert.kind)).length
  )
  const rfidWarningCount = computed(
    () => filteredAlerts.value.filter((alert) => ['tag', 'rfid'].includes(alert.kind)).length
  )

  const sensorCoverage = computed(() => {
    if (!filteredCowList.value.length) return 0
    const covered = filteredCowList.value.filter((cow) => sensorDataMap.value[cow.id]).length
    return Math.round((covered / filteredCowList.value.length) * 100)
  })

  const {
    containerRef: cowCardContainerRef,
    visibleItems: currentPageData,
    resetVisibleCount: resetCowCardWindow,
    handleScroll: onCowCardScroll,
    handleWheel: onCowCardWheel
  } = useLazyGridRenderWindow(filteredCowList, {
    rowCount: 2,
    minItemWidth: 280,
    gap: 12,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })

  const recentEvents = computed(() => {
    const cowIds = new Set(filteredCowList.value.map((cow) => cow.id))
    return allEvents.value
      .filter((event) => cowIds.has(event.cowId))
      .sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime())
  })

  const eventTypeLabel = computed(() =>
    filterForm.eventType
      ? eventTypes.value.find((item) => item.value === filterForm.eventType)?.label ||
        filterForm.eventType
      : t('publication.alerts.unlimited')
  )

  const activeRuleCards = computed(() => [
    {
      label: t('publication.alerts.object'),
      value: filterForm.keyword.trim() || t('publication.alerts.wholeHerd')
    },
    {
      label: t('publication.alerts.event'),
      value: filterForm.subEventType || eventTypeLabel.value
    },
    {
      label: t('publication.alerts.status'),
      value: dataLabel(filterForm.status) || t('publication.alerts.unlimited')
    },
    {
      label: t('publication.alerts.window'),
      value:
        filterForm.dateRange.length === 2
          ? `${filterForm.dateRange[0]} ${t('publication.alerts.to')} ${filterForm.dateRange[1]}`
          : t('publication.alerts.unlimited')
    }
  ])

  const decisionCards = computed(() => [
    {
      label: t('publication.alerts.vetPriority'),
      value: healthWarningCount.value || abnormalCount.value,
      note: healthWarningCount.value
        ? t('publication.alerts.persistentAbnormal')
        : t('publication.alerts.healthFallback'),
      tone: healthWarningCount.value || abnormalCount.value ? 'danger' : 'stable'
    },
    {
      label: t('publication.alerts.breedingCoordination'),
      value: breedingWarningCount.value || heatCount.value + pregnantCount.value,
      note: t('publication.alerts.breedingWindow'),
      tone:
        breedingWarningCount.value || heatCount.value + pregnantCount.value ? 'warning' : 'stable'
    },
    {
      label: t('publication.alerts.rfid'),
      value: rfidWarningCount.value,
      note: t('publication.alerts.rfidDecisionNote'),
      tone: rfidWarningCount.value ? 'danger' : 'stable'
    },
    {
      label: t('publication.alerts.eventMatches'),
      value: recentEvents.value.length,
      note: t('publication.alerts.eventBasis'),
      tone: recentEvents.value.length ? 'primary' : 'stable'
    }
  ])

  const safeRows = async <T,>(tableName: string): Promise<T[]> => {
    try {
      const rows = await databaseService.getTableDataAsync(tableName, { silent: true })
      return Array.isArray(rows) ? (rows as T[]) : []
    } catch {
      return []
    }
  }

  const textValue = (...values: unknown[]) =>
    values.map((value) => String(value ?? '').trim()).find(Boolean) || ''

  const numberValue = (...values: unknown[]) => {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue
      const numeric = Number(value)
      if (Number.isFinite(numeric)) return numeric
    }
    return null
  }

  const parsePayload = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {}
      } catch {
        return {}
      }
    }
    return {}
  }

  const toTime = (value: unknown) => {
    const time = new Date(String(value || '')).getTime()
    return Number.isFinite(time) ? time : 0
  }

  const getCowId = (row: any) =>
    textValue(row?.cowId, row?.cow_id, row?.animalId, row?.animal_id, row?.cow?.id)
  const getCowNumber = (row: any) =>
    textValue(
      row?.cowNumber,
      row?.cow_number,
      row?.animalNumber,
      row?.animal_number,
      row?.cow?.cowNumber
    )
  const getEventTime = (row: any) =>
    textValue(
      row?.occurredAt,
      row?.occurred_at,
      row?.eventDate,
      row?.event_date,
      row?.eventTime,
      row?.event_time,
      row?.breedingDate,
      row?.breeding_date,
      row?.createdAt,
      row?.created_at
    )
  const getSensorCowId = (row: any) =>
    textValue(row?.cowId, row?.cow_id, row?.animalId, row?.animal_id)
  const getSensorTime = (row: any) =>
    textValue(
      row?.measuredAt,
      row?.measured_at,
      row?.timestamp,
      row?.ts,
      row?.createdAt,
      row?.created_at
    )

  const normalizeCowEvent = (row: any, eventType: EventType): CowEventRow => ({
    id: String(
      row?.id ?? `${eventType}-${getCowId(row) || getCowNumber(row)}-${getEventTime(row)}`
    ),
    cowId: getCowId(row),
    cowNumber: getCowNumber(row),
    eventTime: getEventTime(row),
    eventType,
    event: textValue(
      row?.eventName,
      row?.event_name,
      row?.eventCode,
      row?.event_code,
      row?.eventType,
      row?.event_type,
      row?.type,
      eventType
    ),
    person: String(
      row?.operatorName ?? row?.operator ?? row?.person ?? row?.vetName ?? row?.recorder ?? ''
    ),
    notes: String(row?.notes ?? row?.description ?? '')
  })

  const loadCowEvents = async () => {
    const rawEvents = (await databaseService.getUnifiedCowEventRowsAsync().catch(() => [])).map(
      (row) => normalizeCowEvent(row, mapUnifiedEventType(row))
    )
    const cowById = new Map(cowList.value.map((cow) => [String(cow.id), cow]))
    const cowByNumber = new Map(cowList.value.map((cow) => [String(cow.cowNumber), cow]))
    allEvents.value = rawEvents.map((event) => {
      const matchedCow =
        cowById.get(String(event.cowId)) || cowByNumber.get(String(event.cowNumber || ''))
      return {
        ...event,
        cowId: matchedCow?.id || event.cowId,
        cowNumber: matchedCow?.cowNumber || event.cowNumber
      }
    })
  }

  const isTemperatureMetric = (metric: string) =>
    /temp|temperature|body_temperature|ear_temperature|体温|耳温|温度/.test(metric)
  const isActivityMetric = (metric: string) => /activity|active|motion|活动|运动/.test(metric)

  const normalizeSensorRow = (row: any): SensorSnapshot | null => {
    const payload = parsePayload(row?.rawPayload ?? row?.raw_payload ?? row?.payload)
    const metric = textValue(
      row?.metricCode,
      row?.metric_code,
      row?.metric,
      row?.dataType,
      row?.data_type
    ).toLowerCase()
    const reading = numberValue(
      row?.readingValue,
      row?.reading_value,
      row?.value,
      payload.readingValue,
      payload.reading_value,
      payload.value
    )
    const directTemperature = numberValue(
      row?.temperature,
      row?.bodyTemperature,
      row?.body_temperature,
      row?.earTemperature,
      row?.ear_temperature,
      payload.temperature,
      payload.bodyTemperature,
      payload.body_temperature,
      payload.earTemperature,
      payload.ear_temperature
    )
    const directActivity = numberValue(
      row?.activity,
      row?.activityIndex,
      row?.activity_index,
      payload.activity,
      payload.activityIndex,
      payload.activity_index
    )
    const timestamp =
      getSensorTime(row) ||
      textValue(payload.measuredAt, payload.measured_at, payload.timestamp, payload.ts)
    const cowId =
      getSensorCowId(row) ||
      textValue(payload.cowId, payload.cow_id, payload.animalId, payload.animal_id)

    if (!cowId || !timestamp || !toTime(timestamp)) return null

    const snapshot: SensorSnapshot = {
      id: String(row?.id ?? `${cowId}-${timestamp}-${metric || 'sensor'}`),
      cowId,
      cowNumber:
        getCowNumber(row) ||
        textValue(
          payload.cowNumber,
          payload.cow_number,
          payload.animalNumber,
          payload.animal_number
        ),
      timestamp,
      deviceId: textValue(row?.deviceId, row?.device_id, payload.deviceId, payload.device_id),
      penId: textValue(
        row?.penId,
        row?.pen_id,
        row?.unitId,
        row?.unit_id,
        payload.penId,
        payload.pen_id,
        payload.unitId,
        payload.unit_id,
        payload.rfidPenId,
        payload.rfid_pen_id,
        payload.readPenId,
        payload.read_pen_id
      ),
      penName: textValue(
        row?.penName,
        row?.pen_name,
        row?.unitName,
        row?.unit_name,
        payload.penName,
        payload.pen_name,
        payload.unitName,
        payload.unit_name,
        payload.rfidPen,
        payload.rfid_pen,
        payload.readPen,
        payload.read_pen
      ),
      raw: row
    }

    if (directTemperature !== null) snapshot.temperature = directTemperature
    if (directActivity !== null) snapshot.activity = directActivity
    if (reading !== null && metric) {
      if (isTemperatureMetric(metric)) snapshot.temperature = reading
      if (isActivityMetric(metric)) snapshot.activity = reading
    }

    return snapshot.temperature !== undefined ||
      snapshot.activity !== undefined ||
      snapshot.penId ||
      snapshot.penName
      ? snapshot
      : null
  }

  const buildSensorHistoryMap = (cows: CowBasic[], rows: any[], identifiers: any[] = []) => {
    const cowIds = new Set(cows.map((cow) => cow.id))
    const cowByNumber = new Map(cows.map((cow) => [String(cow.cowNumber), cow]))
    const cowById = new Map(cows.map((cow) => [String(cow.id), cow]))
    const cowByIdentifier = new Map<string, CowBasic>()
    identifiers.forEach((row) => {
      const animalId = textValue(row?.animalId, row?.animal_id, row?.cowId, row?.cow_id)
      const identifier = textValue(
        row?.identifierValue,
        row?.identifier_value,
        row?.value,
        row?.number
      )
      const cow = cowById.get(animalId)
      if (cow && identifier) cowByIdentifier.set(identifier, cow)
    })
    const history: Record<string, SensorSnapshot[]> = {}

    rows
      .map(normalizeSensorRow)
      .filter((snapshot): snapshot is SensorSnapshot => Boolean(snapshot))
      .forEach((snapshot) => {
        const cow =
          (cowIds.has(snapshot.cowId) ? cowById.get(snapshot.cowId) : undefined) ||
          cowByNumber.get(String(snapshot.cowNumber || '')) ||
          cowByIdentifier.get(snapshot.cowId) ||
          (snapshot.cowNumber ? cowByIdentifier.get(snapshot.cowNumber) : undefined)
        const cowId = cow?.id || snapshot.cowId
        if (!cowIds.has(cowId)) return
        if (!history[cowId]) history[cowId] = []
        history[cowId].push({ ...snapshot, cowId, cowNumber: cow?.cowNumber || snapshot.cowNumber })
      })

    Object.values(history).forEach((items) => {
      items.sort((left, right) => toTime(right.timestamp) - toTime(left.timestamp))
    })
    return history
  }

  const buildLatestSensorMap = (cows: CowBasic[], history: Record<string, SensorSnapshot[]>) => {
    const latestMap: Record<string, ExtendedSensorData> = {}
    cows.forEach((cow) => {
      const rows = history[cow.id] || []
      if (!rows.length) return
      const latestTemperature = rows.find((row) => row.temperature !== undefined)
      const latestActivity = rows.find((row) => row.activity !== undefined)
      const latest = rows[0]
      latestMap[cow.id] = {
        ...latest.raw,
        id: latest.id,
        cowId: cow.id,
        timestamp: latest.timestamp,
        temperature: latestTemperature?.temperature ?? 0,
        activityIndex: latestActivity?.activity ?? 0,
        rumination: {
          count: 0,
          duration: 0,
          efficiency: 0
        },
        activity: {
          lyingTime: 0,
          standingTime: 0,
          walkingDistance: 0,
          activeTime: latestActivity?.activity ?? 0
        },
        feeding: {
          eatingTime: 0,
          estimatedIntake: 0,
          feedingEfficiency: 0
        },
        vitalSigns: {
          respiratoryRate: 0,
          heartRate: 0,
          bodyScore: 0
        },
        environment: {
          ambientTemp: 0,
          humidity: 0,
          ammonia: 0,
          lightLevel: 0
        },
        createdAt: latest.timestamp
      } as unknown as ExtendedSensorData
    })

    return latestMap
  }

  const average = (values: number[]) => {
    const safeValues = values.filter((value) => Number.isFinite(value))
    return safeValues.length
      ? safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length
      : null
  }

  const rowsBetween = (rows: SensorSnapshot[], start: number, end: number) =>
    rows.filter((row) => {
      const time = toTime(row.timestamp)
      return time >= start && time < end
    })

  const latestNumeric = (rows: SensorSnapshot[], key: 'temperature' | 'activity') => {
    const found = rows.find((row) => row[key] !== undefined)
    return found?.[key] ?? null
  }

  const dailyMetricValues = (
    rows: SensorSnapshot[],
    key: 'temperature' | 'activity',
    start: number,
    end: number
  ) => {
    const buckets = new Map<string, number[]>()
    rowsBetween(rows, start, end).forEach((row) => {
      const value = row[key]
      if (value === undefined || !Number.isFinite(value)) return
      const day = new Date(toTime(row.timestamp)).toISOString().slice(0, 10)
      if (!buckets.has(day)) buckets.set(day, [])
      buckets.get(day)?.push(value)
    })
    return Array.from(buckets.values())
      .map((values) => average(values))
      .filter((value): value is number => value !== null)
  }

  const getCowProductionState = (cow: CowBasic): CowProductionState =>
    productionStateMap.value[cow.id] || {
      dim: null,
      parity: numberValue(cow.parity),
      lastBreedingAt: '',
      expectedCalvingAt: ''
    }

  const getEventCowKey = (row: any) => getCowId(row) || getCowNumber(row)

  const getBreedingEventDate = (row: any) =>
    textValue(
      row?.inseminationDate,
      row?.insemination_date,
      row?.breedingDate,
      row?.breeding_date,
      row?.eventTime,
      row?.event_time,
      row?.occurredAt,
      row?.occurred_at,
      row?.eventDate,
      row?.event_date,
      row?.createdAt,
      row?.created_at
    )

  const isBreedingEvent = (row: any) => {
    const eventText =
      `${row?.eventCode ?? row?.event_code ?? ''} ${row?.eventType ?? row?.event_type ?? ''} ${row?.eventName ?? row?.event_name ?? ''} ${row?.type ?? ''} ${row?.event ?? ''}`.toLowerCase()
    return /insemination|mating|breeding|配种|输精|人工授精/.test(eventText)
  }

  const mapUnifiedEventType = (row: any): EventType => {
    const group = textValue(row?.eventGroup, row?.event_group)
    const eventText =
      `${row?.eventCode ?? row?.event_code ?? ''} ${row?.eventType ?? row?.event_type ?? ''} ${row?.eventName ?? row?.event_name ?? ''}`.toLowerCase()
    if (group === 'movement' || /entry|transfer|exit|入群|转群|离群|出群/.test(eventText)) {
      if (/transfer|转群/.test(eventText)) return EventType.TRANSFER
      if (/exit|离群|出群|淘汰/.test(eventText)) return EventType.EXIT
      return EventType.ENTRY
    }
    if (
      group === 'health' ||
      /veterinary|health|diagnosis|treatment|medication|兽医|发病|治疗|用药/.test(eventText)
    ) {
      return EventType.VETERINARY
    }
    if (
      group === 'reproduction' ||
      /breeding|insemination|calving|pregnancy|配种|输精|产犊|妊检/.test(eventText)
    ) {
      return EventType.BREEDING
    }
    return EventType.BREEDING
  }

  const buildProductionStateMap = async (cows: CowBasic[]) => {
    const [
      animalRows,
      parityRows,
      lactationRows,
      gestationRows,
      reproductionRows,
      unifiedEventRows
    ] = await Promise.all([
      safeRows<any>('animal'),
      safeRows<any>('parity_episode'),
      safeRows<any>('lactation_episode'),
      safeRows<any>('gestation_episode'),
      safeRows<any>('reproduction-cycles'),
      databaseService.getUnifiedCowEventRowsAsync().catch(() => [])
    ])
    const cowById = new Map(cows.map((cow) => [cow.id, cow]))
    const cowByNumber = new Map(cows.map((cow) => [cow.cowNumber, cow]))
    const cowIdByAnimalId = new Map<string, string>()
    animalRows.forEach((row) => {
      const animalId = textValue(row.id, row.animalId, row.animal_id)
      const cowNumber = textValue(
        row.cowNumber,
        row.cow_number,
        row.animalNumber,
        row.animal_number
      )
      const matched = cowById.get(animalId) || cowByNumber.get(cowNumber)
      if (!animalId || !matched) return
      cowIdByAnimalId.set(animalId, matched.id)
    })

    const states: Record<string, CowProductionState> = {}
    cows.forEach((cow) => {
      states[cow.id] = {
        dim: numberValue((cow as any).daysInMilk, (cow as any).days_in_milk),
        parity: numberValue((cow as any).currentParity, (cow as any).current_parity, cow.parity),
        lastBreedingAt: '',
        expectedCalvingAt: ''
      }
    })

    parityRows.forEach((row) => {
      const cowId = cowIdByAnimalId.get(textValue(row.animalId, row.animal_id)) || getCowId(row)
      if (!cowId || !states[cowId]) return
      const parity = numberValue(row.parityNo, row.parity_no, row.currentParity, row.current_parity)
      if (
        parity !== null &&
        (states[cowId].parity === null || parity > Number(states[cowId].parity))
      ) {
        states[cowId].parity = parity
      }
    })

    lactationRows
      .slice()
      .sort(
        (left, right) =>
          toTime(right.startDate ?? right.start_date ?? right.createdAt ?? right.created_at) -
          toTime(left.startDate ?? left.start_date ?? left.createdAt ?? left.created_at)
      )
      .forEach((row) => {
        const cowId = cowIdByAnimalId.get(textValue(row.animalId, row.animal_id)) || getCowId(row)
        if (!cowId || !states[cowId]) return
        const explicitDim = numberValue(row.daysInMilk, row.days_in_milk)
        const start = textValue(row.startDate, row.start_date)
        const resolvedDim =
          explicitDim ??
          (start ? Math.max(1, Math.floor((Date.now() - toTime(start)) / DAY_MS) + 1) : null)
        if (resolvedDim !== null && states[cowId].dim === null) states[cowId].dim = resolvedDim
      })

    reproductionRows.forEach((row) => {
      const key = getEventCowKey(row)
      const cow = cowById.get(key) || cowByNumber.get(key)
      if (!cow) return
      const lastBreedingAt = textValue(
        row.inseminationDate,
        row.insemination_date,
        row.breedingDate,
        row.breeding_date,
        row.cycleStartDate,
        row.cycle_start_date
      )
      const expectedCalvingAt = textValue(row.expectedCalvingDate, row.expected_calving_date)
      if (lastBreedingAt && toTime(lastBreedingAt) > toTime(states[cow.id].lastBreedingAt))
        states[cow.id].lastBreedingAt = lastBreedingAt
      if (expectedCalvingAt) states[cow.id].expectedCalvingAt = expectedCalvingAt
    })
    ;(unifiedEventRows || []).filter(isBreedingEvent).forEach((row) => {
      const key = getEventCowKey(row)
      const cow =
        cowById.get(key) || cowByNumber.get(key) || cowById.get(cowIdByAnimalId.get(key) || '')
      if (!cow) return
      const date = getBreedingEventDate(row)
      if (date && toTime(date) > toTime(states[cow.id].lastBreedingAt))
        states[cow.id].lastBreedingAt = date
    })

    gestationRows.forEach((row) => {
      const cowId = cowIdByAnimalId.get(textValue(row.animalId, row.animal_id)) || getCowId(row)
      if (!cowId || !states[cowId]) return
      const conceptionAt = textValue(row.conceptionAt, row.conception_at)
      const expectedCalvingAt = textValue(row.expectedCalvingDate, row.expected_calving_date)
      if (conceptionAt && toTime(conceptionAt) > toTime(states[cowId].lastBreedingAt))
        states[cowId].lastBreedingAt = conceptionAt
      if (expectedCalvingAt) states[cowId].expectedCalvingAt = expectedCalvingAt
    })

    Object.values(states).forEach((state) => {
      if (!state.expectedCalvingAt && state.lastBreedingAt) {
        state.expectedCalvingAt = new Date(
          toTime(state.lastBreedingAt) + GESTATION_DAYS * DAY_MS
        ).toISOString()
      }
    })

    return states
  }

  const getSystemPenCandidates = (cow: CowBasic) =>
    [
      cow.currentPen,
      (cow as any).currentPenId,
      (cow as any).current_pen_id,
      (cow as any).currentUnitId,
      (cow as any).current_unit_id
    ]
      .map((value) => textValue(value).toLowerCase())
      .filter(Boolean)

  const buildUnitCandidateMap = (rows: any[]) => {
    const map = new Map<string, string[]>()
    rows.forEach((row) => {
      const values = [
        textValue(row.id),
        textValue(row.code, row.unitCode, row.unit_code, row.penCode, row.pen_code),
        textValue(row.name, row.unitName, row.unit_name, row.penName, row.pen_name)
      ]
        .map((value) => value.toLowerCase())
        .filter(Boolean)
      values.forEach((value) => map.set(value, values))
    })
    return map
  }

  const expandUnitCandidates = (values: string[], unitMap: Map<string, string[]>) =>
    Array.from(new Set(values.flatMap((value) => [value, ...(unitMap.get(value) || [])]))).filter(
      Boolean
    )

  const buildDevicePenMap = (devices: any[]) => {
    const map = new Map<string, string[]>()
    devices.forEach((device) => {
      const payload = parsePayload(device?.location)
      const deviceId = textValue(device.id, device.deviceId, device.device_id)
      if (!deviceId) return
      map.set(
        deviceId,
        [
          textValue(
            device.unitId,
            device.unit_id,
            device.penId,
            device.pen_id,
            payload.penId,
            payload.pen_id,
            payload.unitId,
            payload.unit_id
          ),
          textValue(
            device.unitName,
            device.unit_name,
            device.penName,
            device.pen_name,
            payload.penName,
            payload.pen_name,
            payload.unitName,
            payload.unit_name
          )
        ]
          .map((value) => value.toLowerCase())
          .filter(Boolean)
      )
    })
    return map
  }

  const activeAssignmentRows = (assignments: any[], cow: CowBasic, animalId: string) =>
    assignments.filter((row) => {
      const rowCowId = textValue(row.cowId, row.cow_id, row.animalId, row.animal_id)
      const status = textValue(row.status).toLowerCase()
      return (
        [cow.id, animalId].filter(Boolean).includes(rowCowId) &&
        !textValue(row.releasedAt, row.released_at) &&
        (!status || ['active', '绑定', 'online'].includes(status))
      )
    })

  const createCowAlert = (
    cow: CowBasic,
    input: Omit<CowAlert, 'id' | 'cowId' | 'detectedAt'>
  ): CowAlert => ({
    ...input,
    id: `${cow.id}-${input.kind}`,
    cowId: cow.id,
    detectedAt: new Date().toISOString()
  })

  const severityFromAlert = (value: string): AlertSeverity => {
    const severity = textValue(value).toLowerCase()
    if (severity === 'critical') return 'critical'
    if (severity === 'high') return 'high'
    return 'medium'
  }

  const tagTypeFromAlertSeverity = (severity: AlertSeverity): TagType =>
    severity === 'critical' || severity === 'high' ? 'danger' : 'warning'

  const buildPersistedAlertMap = async (cows: CowBasic[]) => {
    const rows = await safeRows<any>('alerts')
    const cowById = new Map(cows.map((cow) => [String(cow.id), cow]))
    const cowByNumber = new Map(cows.map((cow) => [String(cow.cowNumber), cow]))
    const alerts: Record<string, CowAlert[]> = {}

    rows.forEach((row) => {
      const payload = parsePayload(row?.payload)
      const cow =
        cowById.get(String(getCowId(row))) ||
        cowById.get(textValue(payload.cowId, payload.cow_id)) ||
        cowByNumber.get(String(getCowNumber(row))) ||
        cowByNumber.get(textValue(payload.cowNumber, payload.cow_number))
      if (!cow) return

      const status = textValue(row?.status, payload.status).toLowerCase()
      if (['closed', 'resolved', 'done', '已处理', '已关闭'].includes(status)) return

      const alertType = textValue(
        row?.alertType,
        row?.alert_type,
        payload.alertType,
        payload.alert_type
      )
      const severity = severityFromAlert(textValue(row?.severity, payload.severity))
      const temperature = numberValue(
        row?.temperature,
        row?.triggerValue,
        row?.trigger_value,
        payload.temperature,
        payload.bodyTemperature,
        payload.body_temperature,
        payload.triggerValue,
        payload.trigger_value
      )
      const detectedAt = textValue(
        row?.alertTime,
        row?.alert_time,
        row?.createdAt,
        row?.created_at,
        payload.measuredAt,
        payload.measured_at
      )
      const ruleCode = textValue(row?.ruleCode, row?.rule_code, payload.ruleCode, payload.rule_code)
      const rawTitle = textValue(row?.title, payload.title)
      const persistedTemperatureTitle = /temp|temperature|体温|高温|热应激/i.test(
        `${alertType} ${rawTitle}`
      )
      const title =
        ruleCode === 'temperature_two_of_three_above_39_5'
          ? t('publication.alerts.threePointTitle')
          : locale.value !== 'zh' && persistedTemperatureTitle
            ? t('publication.alerts.temperatureAlertTitle')
            : rawTitle || t('publication.alerts.temperatureAlertTitle')
      const isTemperatureAlert = /temp|temperature|体温|温度/i.test(alertType || title)
      const description =
        textValue(row?.description, payload.description) ||
        (temperature !== null
          ? t('publication.alerts.temperatureThresholdDescription', {
              value: temperature.toFixed(1)
            })
          : t('publication.alerts.temperatureMonitoringDescription'))
      const threshold = numberValue(payload.threshold, row?.threshold)
      const temperatureWindow = Array.isArray(payload.temperatureWindow)
        ? payload.temperatureWindow
        : Array.isArray(payload.temperature_window)
          ? payload.temperature_window
          : []
      if (
        !shouldSurfaceCurrentPersistedAlert({
          isTemperatureAlert,
          detectedAt,
          threshold,
          ruleCode,
          temperatureWindowSize: temperatureWindow.length
        })
      ) {
        return
      }
      const windowEvidence = temperatureWindow
        .map((point: any, index: number) => {
          const value = numberValue(
            point?.temperature,
            point?.readingValue,
            point?.reading_value,
            point?.value
          )
          if (value === null) return ''
          return `${index + 1}:${value.toFixed(1)}°C${value > THREE_POINT_HIGH_TEMPERATURE_THRESHOLD ? '↑' : ''}`
        })
        .filter(Boolean)
      const evidence = [
        windowEvidence.length
          ? t('publication.alerts.latestThreeEvidence', { points: windowEvidence.join(' / ') })
          : '',
        Number.isFinite(Number(payload.highCount))
          ? t('publication.alerts.hitEvidence', {
              high: Number(payload.highCount),
              required: Number(payload.requiredHighCount || 2)
            })
          : '',
        temperature !== null
          ? t('publication.alerts.temperatureEvidence', { value: temperature.toFixed(1) })
          : '',
        threshold !== null
          ? t('publication.alerts.thresholdEvidence', { value: threshold.toFixed(1) })
          : '',
        detectedAt ? t('publication.alerts.timeEvidence', { value: formatDate(detectedAt) }) : ''
      ].filter(Boolean)

      const item: CowAlert = {
        id: String(row?.id || `${cow.id}-${title}-${detectedAt || Date.now()}`),
        cowId: cow.id,
        kind: isTemperatureAlert ? 'temperature' : 'health',
        title,
        eventType: EventType.VETERINARY,
        severity,
        tagType: tagTypeFromAlertSeverity(severity),
        icon: 'ri:heart-pulse-line',
        description,
        recommendation:
          severity === 'critical'
            ? t('publication.alerts.temperatureImmediateReview')
            : t('publication.alerts.temperatureRoutineReview'),
        evidence,
        detectedAt: detectedAt || new Date().toISOString(),
        ruleCode
      }

      alerts[cow.id] = [...(alerts[cow.id] || []), item]
    })

    return alerts
  }

  const buildCowAlerts = async (
    cows: CowBasic[],
    history: Record<string, SensorSnapshot[]>,
    productionStates: Record<string, CowProductionState>
  ) => {
    const [persistedAlerts, animalRows, assignments, devices, farmUnits, pens] = await Promise.all([
      buildPersistedAlertMap(cows),
      safeRows<any>('animal'),
      safeRows<any>('animal_device_assignment'),
      safeRows<any>('device'),
      safeRows<any>('farm_unit'),
      safeRows<any>('pens')
    ])
    const animalIdByCowId = new Map<string, string>()
    const animalRowByCowId = new Map<string, any>()
    const cowByNumber = new Map(cows.map((cow) => [cow.cowNumber, cow]))
    animalRows.forEach((row) => {
      const animalId = textValue(row.id, row.animalId, row.animal_id)
      const cowNumber = textValue(
        row.cowNumber,
        row.cow_number,
        row.animalNumber,
        row.animal_number
      )
      const matched = cows.find((cow) => cow.id === animalId) || cowByNumber.get(cowNumber)
      if (animalId && matched) {
        animalIdByCowId.set(matched.id, animalId)
        animalRowByCowId.set(matched.id, row)
      }
    })
    const unitMap = buildUnitCandidateMap([...farmUnits, ...pens])
    const devicePenMap = buildDevicePenMap(devices)
    const now = Date.now()
    const todayStart = new Date(new Date().toDateString()).getTime()
    const yesterdayStart = todayStart - DAY_MS
    const weekStart = todayStart - 8 * DAY_MS
    const weekEnd = todayStart - DAY_MS
    const tenDaysEnd = now + 10 * DAY_MS
    const alerts: Record<string, CowAlert[]> = {}

    cows.forEach((cow) => {
      const rows = history[cow.id] || []
      const yesterdayRows = rowsBetween(rows, yesterdayStart, todayStart)
      const weekRows = rowsBetween(rows, weekStart, weekEnd)
      const yesterdayActivity = average(
        yesterdayRows.map((row) => row.activity ?? NaN).filter(Number.isFinite)
      )
      const weekActivity = average(
        weekRows.map((row) => row.activity ?? NaN).filter(Number.isFinite)
      )
      const temperatureEvaluation = evaluateTwoOfThreeHighTemperature(
        rows
          .filter((row) => row.temperature !== undefined)
          .map((row) => ({
            id: row.id,
            temperature: row.temperature,
            measuredAt: row.timestamp,
            sourceMessageId: textValue(row.raw?.sourceMessageId, row.raw?.source_message_id)
          }))
          .sort((left, right) => toTime(left.measuredAt) - toTime(right.measuredAt))
      )
      const weekTemperatures = dailyMetricValues(rows, 'temperature', weekStart, weekEnd)
      const latestTemperature = latestNumeric(rows, 'temperature')
      const latestMovement = latestNumeric(rows, 'activity')
      const weekTemperature = average(weekTemperatures)
      const production = productionStates[cow.id] || getCowProductionState(cow)
      const cowAlerts: CowAlert[] = []
      const lowTempDays = dailyMetricValues(
        rows,
        'temperature',
        now - 5 * DAY_MS,
        now + DAY_MS
      ).filter((value) => value > 0 && value <= 35.5).length
      const noOrLowMovement = latestMovement !== null && latestMovement <= 20
      const activityDrop =
        yesterdayActivity !== null &&
        weekActivity !== null &&
        weekActivity > 0 &&
        yesterdayActivity <= weekActivity * 0.65
      const activityRise =
        yesterdayActivity !== null &&
        weekActivity !== null &&
        weekActivity > 0 &&
        yesterdayActivity >= weekActivity * 1.25
      const tempRise =
        latestTemperature !== null &&
        weekTemperature !== null &&
        latestTemperature >= weekTemperature + 0.3
      const dim = production.dim
      const parity = production.parity ?? numberValue(cow.parity)

      const persistedCowAlerts = persistedAlerts[cow.id] || []
      const hasPersistedThreePointAlert = persistedCowAlerts.some(
        (alert) => alert.ruleCode === 'temperature_two_of_three_above_39_5'
      )
      const latestWindowPoint = temperatureEvaluation.points.at(-1)
      const latestWindowTime = toTime(latestWindowPoint?.measuredAt)
      const hasFreshTemperatureWindow =
        latestWindowTime > 0 && now - latestWindowTime <= CURRENT_TEMPERATURE_ALERT_MAX_AGE_MS
      if (
        temperatureEvaluation.matched &&
        hasFreshTemperatureWindow &&
        !hasPersistedThreePointAlert
      ) {
        const maxTemperature = Math.max(
          ...temperatureEvaluation.points.map((point) => point.temperature)
        )
        const severity: AlertSeverity =
          activityDrop || maxTemperature >= 40.5 ? 'critical' : 'medium'
        cowAlerts.push(
          createCowAlert(cow, {
            kind: 'temperature',
            title: t('publication.alerts.threePointTitle'),
            eventType: EventType.VETERINARY,
            severity,
            tagType: tagTypeFromAlertSeverity(severity),
            icon: 'ri:heart-pulse-line',
            description: t('publication.alerts.threePointDescription', {
              count: temperatureEvaluation.highCount,
              threshold: temperatureEvaluation.threshold.toFixed(1)
            }),
            recommendation: activityDrop
              ? t('publication.alerts.urgentTemperatureRecommendation')
              : t('publication.alerts.temperatureRecommendation'),
            evidence: [
              t('publication.alerts.latestThreeEvidence', {
                points: temperatureEvaluation.points
                  .map(
                    (point) =>
                      `${point.position}:${point.temperature.toFixed(1)}°C${point.exceeded ? '↑' : ''}`
                  )
                  .join(' / ')
              }),
              t('publication.alerts.hitEvidence', {
                high: temperatureEvaluation.highCount,
                required: temperatureEvaluation.requiredHighCount
              }),
              activityDrop
                ? t('publication.alerts.activityDrop', {
                    yesterday: Math.round(yesterdayActivity || 0),
                    week: Math.round(weekActivity || 0)
                  })
                : t('publication.alerts.activityStable')
            ],
            ruleCode: 'temperature_two_of_three_above_39_5'
          })
        )
      }

      if (
        cow.gender === CowGender.FEMALE &&
        tempRise &&
        activityRise &&
        parity !== null &&
        parity > 0 &&
        dim !== null &&
        dim > 305
      ) {
        cowAlerts.push(
          createCowAlert(cow, {
            kind: 'estrus',
            title: t('publication.alerts.estrusTitle'),
            eventType: EventType.BREEDING,
            severity: 'high',
            tagType: 'warning',
            icon: 'ri:calendar-heart-line',
            description: t('publication.alerts.estrusDescription'),
            recommendation: t('publication.alerts.estrusRecommendation'),
            evidence: [
              t('publication.alerts.latestTemperatureEvidence', {
                value: latestTemperature?.toFixed(1)
              }),
              t('publication.alerts.weeklyTemperatureEvidence', {
                value: weekTemperature?.toFixed(1)
              }),
              t('publication.alerts.dimParityEvidence', { dim: dim ?? '-', parity: parity ?? '-' })
            ]
          })
        )
      }

      if (cow.gender === CowGender.FEMALE && production.lastBreedingAt) {
        const expected = toTime(production.expectedCalvingAt)
        const daysToCalving = expected ? Math.ceil((expected - now) / DAY_MS) : null
        if (daysToCalving !== null && daysToCalving >= 0 && expected <= tenDaysEnd) {
          cowAlerts.push(
            createCowAlert(cow, {
              kind: 'calving',
              title: t('publication.alerts.calvingTitle'),
              eventType: EventType.BREEDING,
              severity: 'high',
              tagType: 'warning',
              icon: 'ri:home-heart-line',
              description: t('publication.alerts.calvingDescription'),
              recommendation: t('publication.alerts.calvingRecommendation'),
              evidence: [
                t('publication.alerts.lastBreeding', {
                  date: formatDate(production.lastBreedingAt)
                }),
                t('publication.alerts.expectedCalving', {
                  date: formatDate(production.expectedCalvingAt)
                }),
                t('publication.alerts.daysRemaining', { days: daysToCalving })
              ]
            })
          )
        }
      }

      if (
        (lowTempDays >= 3 ||
          (latestTemperature !== null && latestTemperature > 0 && latestTemperature <= 35.5)) &&
        (noOrLowMovement || !rowsBetween(rows, now - 24 * 60 * 60000, now + DAY_MS).length)
      ) {
        cowAlerts.push(
          createCowAlert(cow, {
            kind: 'tag',
            title: t('publication.alerts.tagTitle'),
            eventType: EventType.VETERINARY,
            severity: 'high',
            tagType: 'danger',
            icon: 'ri:rfid-line',
            description: t('publication.alerts.tagDescription'),
            recommendation: t('publication.alerts.tagRecommendation'),
            evidence: [
              t('publication.alerts.lowTemperatureDays', { days: lowTempDays }),
              t('publication.alerts.latestTemperatureEvidence', {
                value: latestTemperature?.toFixed(1) ?? '-'
              }),
              t('publication.alerts.latestActivity', { value: latestMovement ?? '-' })
            ]
          })
        )
      }

      const animalRow = animalRowByCowId.get(cow.id) || {}
      const systemPens = expandUnitCandidates(
        [
          ...getSystemPenCandidates(cow),
          textValue(
            animalRow.currentPen,
            animalRow.current_pen,
            animalRow.currentPenId,
            animalRow.current_pen_id,
            animalRow.currentUnitId,
            animalRow.current_unit_id
          ).toLowerCase()
        ].filter(Boolean),
        unitMap
      )
      const animalId = animalIdByCowId.get(cow.id) || cow.id
      const boundRows = activeAssignmentRows(assignments, cow, animalId)
      const boundPenMismatch = boundRows.some((row) => {
        const deviceId = textValue(row.deviceId, row.device_id)
        const rowPens = [
          textValue(
            row.penId,
            row.pen_id,
            row.unitId,
            row.unit_id,
            row.penName,
            row.pen_name,
            row.unitName,
            row.unit_name
          ).toLowerCase(),
          ...(devicePenMap.get(deviceId) || [])
        ].filter(Boolean)
        return (
          systemPens.length && rowPens.length && !rowPens.some((pen) => systemPens.includes(pen))
        )
      })
      const readPenMismatch = rows.slice(0, 5).some((row) => {
        const pens = [row.penId, row.penName]
          .map((value) => textValue(value).toLowerCase())
          .filter(Boolean)
        return systemPens.length && pens.length && !pens.some((pen) => systemPens.includes(pen))
      })

      if (boundPenMismatch || readPenMismatch) {
        cowAlerts.push(
          createCowAlert(cow, {
            kind: 'rfid',
            title: t('publication.alerts.penTitle'),
            eventType: EventType.TRANSFER,
            severity: 'medium',
            tagType: 'warning',
            icon: 'ri:route-line',
            description: t('publication.alerts.penDescription'),
            recommendation: t('publication.alerts.penRecommendation'),
            evidence: [
              t('publication.alerts.systemPen', { value: dataLabel(cow.currentPen) || '-' }),
              boundPenMismatch
                ? t('publication.alerts.boundPenMismatch')
                : t('publication.alerts.boundPenMatch'),
              readPenMismatch
                ? t('publication.alerts.readPenMismatch')
                : t('publication.alerts.readPenMatch')
            ]
          })
        )
      }

      alerts[cow.id] = [...persistedCowAlerts, ...cowAlerts].sort(
        (left, right) => alertSeverityRank(right.severity) - alertSeverityRank(left.severity)
      )
    })

    return alerts
  }

  const alertSeverityRank = (severity: AlertSeverity) => {
    const ranks: Record<AlertSeverity, number> = {
      medium: 1,
      high: 2,
      critical: 3
    }
    return ranks[severity]
  }

  const getCowAlerts = (cowId: string) => cowAlertMap.value[cowId] || []

  const hasDerivedAlert = (cow: CowBasic) => getCowAlerts(cow.id).length > 0

  const eventTypeMatchesAlerts = (cow: CowBasic) => {
    if (!filterForm.eventType) return true
    return getCowAlerts(cow.id).some((alert) => alert.eventType === filterForm.eventType)
  }

  const alertMatchesDateRange = (alert: CowAlert) => {
    if (filterForm.dateRange.length !== 2) return true
    const time = toTime(alert.detectedAt)
    const start = new Date(filterForm.dateRange[0]).getTime()
    const end = new Date(filterForm.dateRange[1]).getTime() + DAY_MS
    return Number.isFinite(time) && time >= start && time <= end
  }

  const alertDateMatchesCow = (cow: CowBasic) =>
    filterForm.dateRange.length !== 2 || getCowAlerts(cow.id).some(alertMatchesDateRange)

  const loadData = async () => {
    const [cows, sensors, sensorReadings, legacySensorReadings, identifiers] = await Promise.all([
      safeRows<CowBasic>('cows'),
      safeRows<any>('sensors'),
      safeRows<any>('sensor_reading'),
      safeRows<any>('sensor-readings'),
      safeRows<any>('animal_identifier')
    ])
    cowList.value = cows
    const cowNumberQuery = Array.isArray(route.query.cowNumber)
      ? route.query.cowNumber[0]
      : route.query.cowNumber
    if (typeof cowNumberQuery === 'string') filterForm.keyword = cowNumberQuery
    sensorHistoryMap.value = buildSensorHistoryMap(
      cows,
      [...sensors, ...sensorReadings, ...legacySensorReadings],
      identifiers
    )
    sensorDataMap.value = buildLatestSensorMap(cows, sensorHistoryMap.value)
    productionStateMap.value = await buildProductionStateMap(cows)
    cowAlertMap.value = await buildCowAlerts(cows, sensorHistoryMap.value, productionStateMap.value)
    await loadCowEvents()
    handleFilter()
  }

  const handleEventTypeChange = () => {
    filterForm.subEventType = ''
    handleFilter()
  }

  const handleCowKeywordSelect = (item: Record<string, any>) => {
    filterForm.keyword = textValue(item?.cowNumber, item?.value, item?.earTagNumber)
    handleFilter()
  }

  const setRulePreset = (preset: 'vet' | 'breeding' | 'transfer' | 'all') => {
    filterForm.keyword = ''
    filterForm.dateRange = []
    filterForm.subEventType = ''

    if (preset === 'vet') {
      filterForm.eventType = EventType.VETERINARY
      filterForm.status = CowStatus.ABNORMAL
      filterForm.scope = 'alerts'
    } else if (preset === 'breeding') {
      filterForm.eventType = EventType.BREEDING
      filterForm.status = ''
      filterForm.scope = 'alerts'
    } else if (preset === 'transfer') {
      filterForm.eventType = EventType.TRANSFER
      filterForm.status = CowStatus.MIXED
      filterForm.scope = 'alerts'
    } else {
      filterForm.eventType = ''
      filterForm.status = ''
      filterForm.scope = 'all'
    }

    handleFilter()
  }

  const eventMatchesDateRange = (event: CowEventRow) => {
    if (filterForm.dateRange.length !== 2) return true
    const time = new Date(event.eventTime).getTime()
    const start = new Date(filterForm.dateRange[0]).getTime()
    const end = new Date(filterForm.dateRange[1]).getTime() + 86400000
    return Number.isFinite(time) && time >= start && time <= end
  }

  const handleFilter = () => {
    const keyword = filterForm.keyword.trim().toLowerCase()
    const eventCowIds = new Set(
      allEvents.value
        .filter((event) => !filterForm.eventType || event.eventType === filterForm.eventType)
        .filter(
          (event) => !filterForm.subEventType || event.event.includes(filterForm.subEventType)
        )
        .filter(eventMatchesDateRange)
        .map((event) => event.cowId)
    )

    let result = cowList.value.filter((cow) => {
      if (keyword) {
        const haystack = [
          cow.cowNumber,
          cow.earTagNumber,
          cow.currentPen,
          cow.breed,
          ...getCowAlerts(cow.id).flatMap((alert) => [
            alert.title,
            alert.description,
            ...alert.evidence
          ])
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(keyword)) return false
      }
      if (filterForm.status && cow.status !== filterForm.status) return false
      if (
        filterForm.scope === 'alerts' &&
        !hasDerivedAlert(cow) &&
        ![CowStatus.ABNORMAL, CowStatus.HEAT, CowStatus.PREGNANT, CowStatus.MIXED].includes(
          cow.status
        )
      )
        return false
      if (!eventTypeMatchesAlerts(cow)) {
        if (!eventCowIds.has(cow.id)) return false
      }
      if (!alertDateMatchesCow(cow) && !eventCowIds.has(cow.id)) return false
      if (
        (filterForm.eventType || filterForm.subEventType || filterForm.dateRange.length === 2) &&
        !eventCowIds.has(cow.id)
      ) {
        return hasDerivedAlert(cow) && eventTypeMatchesAlerts(cow) && alertDateMatchesCow(cow)
      }
      return true
    })

    if (filterForm.eventType && !eventCowIds.size) {
      result = fallbackByEventIntent(result)
    }

    filteredCowList.value = result
    resetCowCardWindow()
  }

  const fallbackByEventIntent = (rows: CowBasic[]) => {
    if (filterForm.eventType === EventType.BREEDING) {
      return rows.filter(
        (cow) =>
          cow.gender === CowGender.FEMALE &&
          [CowStatus.HEAT, CowStatus.PREGNANT].includes(cow.status)
      )
    }
    if (filterForm.eventType === EventType.VETERINARY) {
      return rows.filter((cow) => cow.status === CowStatus.ABNORMAL)
    }
    if (filterForm.eventType === EventType.TRANSFER) {
      return rows.filter((cow) => Boolean(cow.currentPen))
    }
    return rows
  }

  const handleReset = () => {
    filterForm.keyword = ''
    filterForm.dateRange = []
    filterForm.eventType = ''
    filterForm.subEventType = ''
    filterForm.status = ''
    filterForm.scope = 'alerts'
    handleFilter()
  }

  const getLatestSensorData = (cowId: string) => sensorDataMap.value[cowId] || null

  const formatSensorTemperature = (data: ExtendedSensorData | null) => {
    const value = Number((data as any)?.temperature)
    return Number.isFinite(value) && value > 0
      ? `${value.toFixed(1)}°C`
      : t('publication.alerts.noTemperature')
  }

  const formatDim = (cow: CowBasic) => {
    const dim = getCowProductionState(cow).dim
    return dim !== null && Number.isFinite(dim) ? String(Math.round(dim)) : '-'
  }

  const getAlertSeverityLabel = (severity: AlertSeverity) => {
    const labels: Record<AlertSeverity, string> = {
      critical: t('publication.alerts.severityCritical'),
      high: t('publication.alerts.severityHigh'),
      medium: t('publication.alerts.severityMedium')
    }
    return labels[severity]
  }

  const getCowTagType = (status: CowStatus): TagType => {
    if (status === CowStatus.HEALTHY) return 'success'
    if (status === CowStatus.ABNORMAL) return 'danger'
    if ([CowStatus.HEAT, CowStatus.PREGNANT].includes(status)) return 'warning'
    return 'info'
  }

  const getCowTone = (cow: CowBasic) => {
    const topAlert = getCowAlerts(cow.id)[0]
    if (topAlert?.tagType === 'danger') return 'danger'
    if (topAlert?.tagType === 'warning') return 'warning'
    if (cow.status === CowStatus.ABNORMAL) return 'danger'
    if ([CowStatus.HEAT, CowStatus.PREGNANT].includes(cow.status)) return 'warning'
    if (cow.status === CowStatus.HEALTHY) return 'stable'
    return 'neutral'
  }

  const getRecommendation = (cow: CowBasic) => {
    const topAlert = getCowAlerts(cow.id)[0]
    if (topAlert) return { icon: topAlert.icon, text: topAlert.recommendation }
    if (cow.status === CowStatus.ABNORMAL)
      return {
        icon: 'ri:heart-pulse-line',
        text: t('publication.alerts.abnormalRecommendation')
      }
    if (cow.status === CowStatus.HEAT)
      return {
        icon: 'ri:calendar-event-line',
        text: t('publication.alerts.heatRecommendation')
      }
    if (cow.status === CowStatus.PREGNANT)
      return {
        icon: 'ri:home-heart-line',
        text: t('publication.alerts.pregnantRecommendation')
      }
    if (!getLatestSensorData(cow.id))
      return {
        icon: 'ri:signal-wifi-error-line',
        text: t('publication.alerts.missingSensorRecommendation')
      }
    return {
      icon: 'ri:checkbox-circle-line',
      text: t('publication.alerts.stableRecommendation')
    }
  }

  const showCowDetail = (cow: CowBasic) => {
    selectedCow.value = cow
    cowEvents.value = allEvents.value
      .filter((event) => event.cowId === cow.id)
      .sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime())
    resetCowEventRows()
    detailDialogVisible.value = true
  }

  const handleCloseDetail = () => {
    detailDialogVisible.value = false
    selectedCow.value = null
    cowEvents.value = []
    resetCowEventRows()
  }

  const markCow = (cow: CowBasic) => {
    ElMessage.success(t('publication.alerts.addedToQueue', { cow: cow.cowNumber }))
  }

  const createWorklist = () => {
    ElMessage.success(t('publication.alerts.queueCreated', { count: filteredCowList.value.length }))
  }

  const formatDate = (date: string) => {
    return formatDateOnly(date)
  }

  const formatDateTime = (date: string) => {
    return formatDateOnly(date)
  }

  const getAge = (birthDate: string) => {
    const birth = new Date(birthDate)
    if (!Number.isFinite(birth.getTime())) return '-'
    const now = new Date()
    return t('publication.alerts.yearsOld', {
      years: Math.max(0, now.getFullYear() - birth.getFullYear())
    })
  }

  onMounted(loadData)
  watch(locale, () => {
    void loadData()
  })
</script>

<style scoped lang="scss">
  .fc-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }

  .filter-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 14px;
    align-items: start;
  }

  .filter-layout.is-list {
    grid-template-columns: minmax(0, 1.25fr) 340px;
  }

  .rule-builder {
    display: grid;
    gap: 12px;
  }

  .intent-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
  }

  .intent-strip button {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    padding: 10px 12px;
    color: var(--fluent-text);
    cursor: pointer;
    transition:
      background-color 160ms ease,
      border-color 160ms ease;
  }

  .intent-strip button:hover {
    background: rgb(248 250 252);
    border-color: var(--fluent-border-strong);
  }

  .intent-strip .art-svg-icon {
    font-size: 18px;
    color: var(--fluent-primary);
  }

  .rule-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .rule-card.is-date {
    grid-column: span 2;
  }

  .rule-card {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 12px;
  }

  .rule-card span {
    font-size: 12px;
    font-weight: 680;
    color: var(--fluent-muted);
  }

  .rule-card :deep(.el-date-editor.el-input__wrapper) {
    width: 100%;
  }

  .rule-card :deep(.cow-number-autocomplete),
  .rule-card :deep(.el-select),
  .rule-card :deep(.el-input) {
    width: 100%;
    min-width: 0;
  }

  .rule-footer {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .active-rules {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px;
  }

  .active-rules article {
    min-width: 0;
    padding: 10px;
  }

  .active-rules span {
    display: block;
    font-size: 11px;
    font-weight: 680;
    color: var(--fluent-muted);
  }

  .active-rules strong {
    display: block;
    margin-top: 4px;
    overflow: hidden;
    font-size: 13px;
    font-weight: 720;
    color: var(--fluent-text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .strategy-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-start;
  }

  .decision-stack,
  .side-stack,
  .event-hit-list {
    display: grid;
    gap: 12px;
  }

  .decision-card,
  .event-hit-list article {
    padding: 12px;
    border-left: 4px solid var(--fluent-primary);
  }

  .decision-card.danger {
    border-left-color: var(--fluent-danger);
  }

  .decision-card.warning {
    border-left-color: var(--fluent-amber);
  }

  .decision-card div {
    display: flex;
    gap: 12px;
    align-items: baseline;
    justify-content: space-between;
  }

  .decision-card span,
  .event-hit-list span,
  .sensor-strip span,
  .cow-card-top span,
  .detail-metrics span {
    font-size: 12px;
    font-weight: 680;
    color: var(--fluent-muted);
  }

  .decision-card strong {
    font-size: 24px;
    font-weight: 780;
    color: var(--fluent-text);
  }

  .decision-card p,
  .event-hit-list p,
  .explain-list p {
    margin: 8px 0 0;
    font-size: 13px;
    line-height: 1.65;
    color: var(--fluent-text-soft);
  }

  .cow-worklist {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }

  .cow-worklist-scroll {
    max-height: min(48vh, 430px);
    padding-right: 6px;
    overflow-y: auto;
  }

  .cow-card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 12px;
    overflow: hidden;
    cursor: pointer;
    border-left: 4px solid var(--fluent-muted);
    transition:
      background-color 160ms ease,
      border-color 160ms ease;
  }

  .cow-card:hover,
  .cow-card:focus-visible {
    background: rgb(248 250 252);
    border-color: rgb(var(--fluent-primary-rgb) / 34%);
    outline: none;
  }

  .cow-card.is-active {
    border-color: rgb(var(--fluent-primary-rgb) / 46%);
  }

  .cow-card.stable {
    border-left-color: var(--fluent-primary);
  }

  .cow-card.warning {
    border-left-color: var(--fluent-amber);
  }

  .cow-card.danger {
    border-left-color: var(--fluent-danger);
  }

  .cow-card-top {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .cow-card-top > div {
    min-width: 0;
  }

  .cow-card-top h3,
  .cow-card-top p,
  .cow-reason span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    overflow-wrap: anywhere;
  }

  .cow-card-top h3,
  .cow-card-top p {
    white-space: nowrap;
  }

  .cow-card h3,
  .event-hit-list strong,
  .detail-summary h3 {
    margin: 4px 0 0;
    font-size: 16px;
    font-weight: 760;
    color: var(--fluent-text);
  }

  .cow-card p,
  .detail-summary p {
    margin: 5px 0 0;
    font-size: 13px;
    color: var(--fluent-text-soft);
  }

  .sensor-strip,
  .detail-metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
  }

  .sensor-strip div,
  .detail-metrics div {
    min-width: 0;
    padding: 8px;
  }

  .sensor-strip strong,
  .detail-metrics strong {
    display: block;
    margin-top: 4px;
    overflow: hidden;
    font-size: 14px;
    font-weight: 760;
    color: var(--fluent-text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cow-reason {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    min-height: 42px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--fluent-text-soft);
  }

  .cow-reason .art-svg-icon {
    flex: 0 0 auto;
    margin-top: 2px;
    font-size: 18px;
    color: var(--fluent-primary);
  }

  .alert-chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 24px;
  }

  .alert-detail-list {
    display: grid;
    gap: 10px;
    margin: 0 0 16px;
  }

  .alert-detail-list article {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    padding: 14px;
    border-left: 4px solid var(--fluent-amber);
  }

  .alert-detail-list article.critical,
  .alert-detail-list article.high {
    border-left-color: var(--fluent-danger);
  }

  .alert-detail-list span,
  .alert-detail-list small {
    display: block;
    font-size: 12px;
    font-weight: 650;
    color: var(--fluent-muted);
  }

  .alert-detail-list h3 {
    margin: 5px 0 0;
    font-size: 15px;
    font-weight: 760;
    color: var(--fluent-text);
  }

  .alert-detail-list p {
    margin: 6px 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--fluent-text-soft);
  }

  .cow-card-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .pagination-row {
    display: flex;
    justify-content: center;
    margin-top: 18px;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 12px;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    margin-bottom: 16px;
  }

  .detail-summary {
    padding: 16px;
  }

  .detail-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 14px;
  }

  @media (width <= 1320px) {
    .rule-grid,
    .intent-strip,
    .active-rules {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .rule-card.is-date {
      grid-column: span 2;
    }
  }

  @media (width <= 980px) {
    .fc-metric-grid,
    .filter-layout,
    .filter-layout.is-list,
    .detail-grid {
      grid-template-columns: 1fr;
    }

    .rule-grid,
    .intent-strip,
    .active-rules,
    .rule-footer {
      grid-template-columns: 1fr;
    }

    .rule-card.is-date {
      grid-column: auto;
    }

    .strategy-actions {
      justify-content: flex-start;
    }
  }

  @media (width <= 640px) {
    .fc-metric-grid,
    .sensor-strip,
    .detail-metrics {
      grid-template-columns: 1fr;
    }
  }
</style>
