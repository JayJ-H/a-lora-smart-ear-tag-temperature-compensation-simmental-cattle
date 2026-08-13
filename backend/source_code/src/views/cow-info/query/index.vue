<template>
  <div class="cow-query-page">
    <div class="cow-query-head">
      <h1>{{ ui('个体查询', 'Individual cattle query') }}</h1>
    </div>

    <!-- 搜索栏-->
    <div class="query-filter-panel art-card-sm">
      <ElForm :inline="true" :model="searchForm" class="flex flex-wrap gap-4">
        <ElFormItem label="个体编号">
          <CowNumberAutocomplete
            v-model="searchForm.cowNumber"
            class="cow-search-autocomplete"
            placeholder="输入牛号自动补齐"
            @select="handleCowSearchSelect"
          />
        </ElFormItem>
        <ElFormItem label="个体类型">
          <ElSelect
            v-model="searchForm.type"
            placeholder="请选择个体类型"
            clearable
            style="width: 150px"
          >
            <ElOption
              v-for="type in cowTypes"
              :key="type.value"
              :label="type.label"
              :value="type.value"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="状态">
          <ElSelect
            v-model="searchForm.status"
            placeholder="请选择状态"
            clearable
            style="width: 150px"
          >
            <ElOption
              v-for="status in cowStatuses"
              :key="status.value"
              :label="status.label"
              :value="status.value"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem>
          <ElButton type="primary" @click="handleSearch">
            <ArtSvgIcon icon="ri:search-line" class="mr-2" />
            查询
          </ElButton>
          <ElButton @click="handleReset">
            <ArtSvgIcon icon="ri:refresh-line" class="mr-2" />
            重置
          </ElButton>
        </ElFormItem>
      </ElForm>
    </div>

    <!-- 个体卡片列表 -->
    <div
      ref="cowCardContainerRef"
      class="cow-card-lazy-scroll"
      @scroll.passive="onCowCardScroll"
      @wheel.passive="onCowCardWheel"
    >
      <div class="cow-query-grid">
        <div
          v-for="cow in currentPageData"
          :key="cow.id"
          :data-cow-id="cow.id"
          :ref="setCardElement"
          :class="['cow-query-card', 'art-card', getCardClass(cow.status)]"
          @click="showCowDetail(cow)"
        >
          <div class="cow-card-topline">
            <div class="cow-card-id-wrap">
              <div class="cow-card-id-meta">
                <div class="cow-status-dots">
                  <div :class="['w-3 h-3 rounded-full', getHealthStatusDotClass(cow)]"></div>
                  <div
                    :class="['w-3 h-3 rounded-full ml-1', getPregnancyStatusDotClass(cow)]"
                  ></div>
                  <div :class="['w-3 h-3 rounded-full ml-1', getMixingStatusDotClass(cow)]"></div>
                </div>
                <span :class="['cow-card-type', getTextClass(cow.status)]">{{ displayCattleType(cow.type) }}</span>
              </div>
              <div class="cow-card-number-block">
                <span class="cow-card-number-label">{{ ui('个体编号', 'Cattle ID') }}</span>
                <strong :class="['cow-card-number', getTextClass(cow.status)]">
                  {{ cow.cowNumber }}
                </strong>
              </div>
            </div>
          </div>

          <div class="space-y-2 text-sm mb-3" :class="getTextClass(cow.status)">
            <div class="flex justify-between">
              <span>{{ ui('品种', 'Breed') }}: {{ displayBreed(cow.breed) }}</span>
              <span>{{ ui('性别', 'Sex') }}: {{ displayGender(cow.gender) }}</span>
            </div>
            <div>{{ ui('当前栏位', 'Current pen') }}: {{ displayPen(cow.currentPen) }}</div>
            <div>{{ ui('胎次', 'Parity') }}: {{ cow.parity }}</div>
          </div>

          <div class="text-xs" :class="getTextClass(cow.status)">
            {{ ui('出生', 'Born') }}: {{ formatDate(cow.birthDate) }} ({{ getAge(cow.birthDate) }})
          </div>

          <!-- 扩展传感器数据显示-->
          <div class="sensor-section">
            <!-- 传感器数据概览-->
            <div class="grid grid-cols-2 gap-3 mb-3">
              <div class="sensor-mini-stat art-card-xs">
                <div class="text-xs text-gray-600 dark:text-gray-300">{{ ui('最近体温', 'Latest temperature') }}</div>
                <div class="text-sm font-semibold text-gray-900 dark:text-white">{{
                  formatSensorTemperature(getLatestSensorData(cow.id))
                }}</div>
              </div>
            </div>
          </div>

          <!-- 小型体温曲线 -->
          <div class="sensor-section">
            <div class="grid grid-cols-1 gap-3">
              <div class="sensor-chart-tile art-card-xs">
                <div class="text-sm text-center mb-2 font-medium" :class="getTextClass(cow.status)"
                  >{{ ui('体温曲线', 'Temperature trend') }}</div
                >
                <div
                  :id="`temp-chart-${cow.id}`"
                  class="h-28 w-full"
                  :class="getTextClass(cow.status)"
                  data-card-chart
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 个体详情对话框-->
    <ElDialog
      v-model="detailDialogVisible"
      :title="ui('牛只个体档案', 'Individual cattle record')"
      width="90%"
      :before-close="handleCloseDetail"
      class="custom-dialog"
    >
      <div v-if="selectedCow">
        <!-- 基本信息 -->
        <div class="detail-section art-card">
          <h3 class="detail-section-title">{{ ui('基本信息', 'Basic information') }}</h3>
          <div class="detail-cell-grid">
            <div class="detail-cell art-card-xs">
              <div class="text-sm text-gray-600 dark:text-gray-300">{{
                ui('个体编号', 'Cattle ID')
              }}</div>
              <div class="font-semibold text-gray-900 dark:text-white">{{
                selectedCow.cowNumber
              }}</div>
            </div>
            <div class="detail-cell art-card-xs">
              <div class="text-sm text-gray-600 dark:text-gray-300">{{
                ui('耳标号', 'Ear tag')
              }}</div>
              <div class="font-semibold text-gray-900 dark:text-white">{{
                selectedCow.earTagNumber || ui('无', 'None')
              }}</div>
            </div>
            <div class="detail-cell art-card-xs">
              <div class="text-sm text-gray-600 dark:text-gray-300">{{ ui('品种', 'Breed') }}</div>
              <div class="font-semibold text-gray-900 dark:text-white">{{
                displayBreed(selectedCow.breed)
              }}</div>
            </div>
            <div class="detail-cell art-card-xs">
              <div class="text-sm text-gray-600 dark:text-gray-300">{{ ui('性别', 'Sex') }}</div>
              <div class="font-semibold text-gray-900 dark:text-white">{{
                displayGender(selectedCow.gender)
              }}</div>
            </div>
            <div class="detail-cell art-card-xs">
              <div class="text-sm text-gray-600 dark:text-gray-300">{{
                ui('个体类型', 'Cattle type')
              }}</div>
              <div class="font-semibold text-gray-900 dark:text-white">{{
                displayCattleType(selectedCow.type)
              }}</div>
            </div>
            <div class="detail-cell art-card-xs">
              <div class="text-sm text-gray-600 dark:text-gray-300">{{
                ui('当前栏位', 'Current pen')
              }}</div>
              <div class="font-semibold text-gray-900 dark:text-white">{{
                displayPen(selectedCow.currentPen)
              }}</div>
            </div>
            <div class="detail-cell art-card-xs">
              <div class="text-sm text-gray-600 dark:text-gray-300">{{ ui('胎次', 'Parity') }}</div>
              <div class="font-semibold text-gray-900 dark:text-white">{{
                selectedCow.parity
              }}</div>
            </div>
            <div class="detail-cell art-card-xs">
              <div class="text-sm text-gray-600 dark:text-gray-300">{{ ui('状态', 'Status') }}</div>
              <div class="font-semibold text-gray-900 dark:text-white">{{
                displayStatus(selectedCow.status)
              }}</div>
            </div>
          </div>
        </div>

        <!-- 血统信息-->
        <div class="detail-section art-card">
          <h3 class="detail-section-title">{{ ui('系谱信息', 'Pedigree') }}</h3>
          <div class="detail-cell-grid">
            <div class="detail-cell art-card-xs">
              <div class="text-sm text-green-400 dark:text-green-300">{{
                ui('父号', 'Sire ID')
              }}</div>
              <div class="font-semibold text-gray-900 dark:text-white">{{
                selectedCow.fatherNumber || ui('无', 'None')
              }}</div>
            </div>
            <div class="detail-cell art-card-xs">
              <div class="text-sm text-pink-400 dark:text-pink-300">{{ ui('母号', 'Dam ID') }}</div>
              <div class="font-semibold text-gray-900 dark:text-white">{{
                selectedCow.motherNumber || ui('无', 'None')
              }}</div>
            </div>
            <div class="detail-cell art-card-xs">
              <div class="text-sm text-teal-400 dark:text-teal-300">{{
                ui('外祖父号', 'Maternal grandsire ID')
              }}</div>
              <div class="font-semibold text-gray-900 dark:text-white">{{
                selectedCow.grandfatherNumber || ui('无', 'None')
              }}</div>
            </div>
            <div class="detail-cell art-card-xs">
              <div class="text-sm text-green-400 dark:text-green-300">{{
                ui('外祖母号', 'Maternal granddam ID')
              }}</div>
              <div class="font-semibold text-gray-900 dark:text-white">{{
                selectedCow.grandmotherNumber || ui('无', 'None')
              }}</div>
            </div>
          </div>
        </div>

        <!-- 24小时数据图表 -->
        <div class="detail-section art-card">
          <h3 class="detail-section-title">{{ ui('24小时数据曲线', '24-hour monitoring') }}</h3>
          <div class="detail-chart-grid">
            <!-- 体温曲线 -->
            <div class="detail-chart-panel art-card-sm">
              <h4>{{ ui('体温曲线 (°C)', 'Temperature trend (°C)') }}</h4>
              <div ref="temperatureChart" class="detail-chart"></div>
            </div>
          </div>
        </div>

        <!-- 事件记录 -->
        <div class="detail-section art-card">
          <h3 class="detail-section-title">{{ ui('个体事件记录（最近20条）', 'Individual event records (latest 20)') }}</h3>
          <div class="cow-event-table-shell art-card-xs">
            <ElTable
              :data="visibleCowEvents"
              height="320"
              style="width: 100%"
              @wheel.passive="onCowEventTableWheel"
            >
              <ElTableColumn prop="eventTime" :label="ui('时间', 'Time')" width="180">
                <template #default="scope">
                  {{ formatDateTime(scope.row.eventTime) }}
                </template>
              </ElTableColumn>
              <ElTableColumn prop="eventType" :label="ui('事件类型', 'Event type')" width="120" />
              <ElTableColumn prop="event" :label="ui('事件详情', 'Event details')" min-width="220" show-overflow-tooltip />
              <ElTableColumn prop="person" :label="ui('人员', 'Operator')" width="110" />
              <ElTableColumn prop="notes" :label="ui('备注', 'Notes')" min-width="180" show-overflow-tooltip />
            </ElTable>
          </div>
          <div v-if="cowEvents.length" class="load-more-row">
            <span>
              当前窗口 {{ cowEventStartIndex + 1 }}-{{ cowEventEndIndex }} /
              {{ cowEventTotalCount }} 条
            </span>
          </div>
        </div>
      </div>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import {
    ref,
    reactive,
    computed,
    onMounted,
    onBeforeUnmount,
    nextTick,
    watch,
    type ComponentPublicInstance
  } from 'vue'
  import { useI18n } from 'vue-i18n'
  import * as echarts from 'echarts'
  import { getCowApiDataSource, type FrontendDataSource } from '@/api/cow'
  import * as databaseService from '@/services/database'
  import CowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'
  import { useLazyGridRenderWindow, useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'
  import type { CowBasic, CowStatus, CowType, ExtendedSensorData } from '@/types'
  import {
    getLatestSensorMap,
    loadUnifiedSensorData
  } from '@/views/breeding-platform/platform-data'

  const { locale } = useI18n()
  const ui = (zh: string, en: string) => (locale.value.startsWith('zh') ? zh : en)
  const displayBreed = (value: unknown) => {
    const text = String(value || '').trim()
    if (locale.value.startsWith('zh')) return text || '未维护'
    if (/西门塔尔|simmental/i.test(text)) return 'Simmental'
    if (/华西|huaxi/i.test(text)) return 'Huaxi'
    return text || 'Not available'
  }
  const displayGender = (value: unknown) => {
    const text = String(value || '').trim()
    if (locale.value.startsWith('zh')) return text || '未知'
    if (/^(母|female|cow|dam)$/i.test(text)) return 'Female'
    if (/^(公|male|bull|sire)$/i.test(text)) return 'Male'
    return text || 'Unknown'
  }
  const displayCattleType = (value: unknown) => {
    const text = String(value || '').trim()
    if (locale.value.startsWith('zh')) return text || '未维护'
    const labels: Record<string, string> = {
      犊牛: 'Calf',
      小育成牛: 'Young heifer',
      大育成牛: 'Heifer',
      青年牛: 'Yearling',
      成母牛: 'Adult cow',
      种公牛: 'Breeding bull'
    }
    return labels[text] || text || 'Not available'
  }
  const displayPen = (value: unknown) => {
    const text = String(value || '').trim()
    if (locale.value.startsWith('zh')) return text || '未分栏'
    if (!text || text === '未分栏') return 'Unassigned'
    if (text === '新三圈' || /^nzh_demo_pen_new_3$/i.test(text)) return 'Pen 3'
    return text
  }
  const displayStatus = (value: unknown) => {
    const text = String(value || '').trim()
    if (locale.value.startsWith('zh')) return text || '在群'
    const labels: Record<string, string> = {
      健康: 'Healthy',
      在群: 'In herd',
      异常: 'Abnormal',
      发情: 'Estrus',
      预产: 'Expected calving',
      混群: 'Mixed group',
      离群: 'Exited'
    }
    return labels[text] || text || 'In herd'
  }

  // 鍝嶅簲寮忔暟鎹?
  const searchForm = reactive({
    cowNumber: '',
    type: '' as CowType | '',
    status: '' as CowStatus | ''
  })

  const cowList = ref<CowBasic[]>([])
  const allCows = ref<CowBasic[]>([])
  const detailDialogVisible = ref(false)
  const selectedCow = ref<CowBasic | null>(null)
  const temperatureChart = ref<HTMLDivElement>()
  const cowEvents = ref<any[]>([])
  const {
    visibleItems: visibleCowEvents,
    startIndex: cowEventStartIndex,
    endIndex: cowEventEndIndex,
    totalCount: cowEventTotalCount,
    resetVisibleCount: resetCowEventRows,
    handleWheel: onCowEventTableWheel
  } = useLazyRenderWindow(cowEvents, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  // 传感器数据存储
  const sensorDataMap = ref<Record<string, ExtendedSensorData>>({})
  const allSensorRows = ref<ExtendedSensorData[]>([])
  const visibleCardIds = ref<Set<string>>(new Set())
  const renderedCardIds = ref<Set<string>>(new Set())
  const cardElements = new Map<string, Element>()
  let cardObserver: IntersectionObserver | null = null
  let cardRenderTimer: number | null = null
  const dataSource = ref<FrontendDataSource>(getCowApiDataSource())
  type SensorMetric = 'temperature'
  type SensorSeriesPoint = { time: string; value: number; timestamp: number }

  const looksLikeMojibake = (value: string) =>
    /[ÃÂæäåçèéïð]|鍝|鏁|鎹|寮|浼|犳|劅|噐/.test(value) ||
    (/[a-zA-Z]/.test(value) && /[^\x00-\x7F]/.test(value) && value.includes('�'))

  const cleanDisplayText = (value: unknown, fallback = '未维护') => {
    const text = String(value ?? '').trim()
    if (!text || looksLikeMojibake(text)) return fallback
    return text
  }

  const textValue = (...values: unknown[]) =>
    values.map((value) => cleanDisplayText(value, '')).find(Boolean) || ''

  const normalizeGenderText = (value: unknown) => {
    const text = cleanDisplayText(value, '').toLowerCase()
    if (/^(m|male|bull)$|公|种公/.test(text)) return '公'
    if (/^(f|female|cow|dam)$|母/.test(text)) return '母'
    return text ? cleanDisplayText(value, '未知') : '未知'
  }

  const normalizeStatusText = (value: unknown) => {
    const text = cleanDisplayText(value, '')
    if (!text) return '在群'
    if (/^(active|in_herd|in-herd|normal)$/i.test(text) || /在群|健康|正常/.test(text))
      return '在群'
    if (/left|离群|出群|淘汰/i.test(text)) return '离群'
    return text
  }

  const numberValue = (...values: unknown[]) => {
    for (const value of values) {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) return numeric
    }
    return Number.NaN
  }

  const parsePayload = (value: unknown): Record<string, any> => {
    if (!value) return {}
    if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>
    try {
      const parsed = JSON.parse(String(value))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  const getSensorCowId = (data: any) =>
    String(data?.cowId ?? data?.cow_id ?? data?.animalId ?? data?.animal_id ?? '')
  const getSensorCowNumber = (data: any) =>
    String(data?.cowNumber ?? data?.cow_number ?? data?.animalNumber ?? data?.animal_number ?? '')
  const normalizeCowBasic = (row: any): CowBasic | null => {
    const id = textValue(row?.id, row?.cowId, row?.cow_id, row?.animalId, row?.animal_id)
    const cowNumber = textValue(
      row?.cowNumber,
      row?.cow_number,
      row?.animalNumber,
      row?.animal_number,
      row?.number
    )
    const key = id || cowNumber
    if (!key) return null
    const gender = normalizeGenderText(textValue(row?.gender, row?.sex))
    const type =
      textValue(
        row?.type,
        row?.cowType,
        row?.cow_type,
        row?.productionStage,
        row?.production_stage
      ) || (gender.includes('公') ? '种公牛' : '成母牛')
    return {
      ...row,
      id: id || cowNumber,
      cowId: id || cowNumber,
      animalId: textValue(row?.animalId, row?.animal_id),
      animal_id: textValue(row?.animal_id, row?.animalId),
      cowNumber,
      cow_number: cowNumber,
      animalNumber: cowNumber,
      animal_number: cowNumber,
      earTagNumber: textValue(row?.earTagNumber, row?.ear_tag_number, row?.earTag, row?.ear_tag),
      fatherNumber: textValue(
        row?.fatherNumber,
        row?.father_number,
        row?.sireNumber,
        row?.sire_number
      ),
      motherNumber: textValue(
        row?.motherNumber,
        row?.mother_number,
        row?.damNumber,
        row?.dam_number
      ),
      breed: cleanDisplayText(textValue(row?.breed, row?.breedName, row?.breed_name), '未维护'),
      gender: gender as any,
      birthDate: textValue(row?.birthDate, row?.birth_date, row?.dateOfBirth, row?.date_of_birth),
      type: cleanDisplayText(type, '未维护') as CowType,
      currentPen: cleanDisplayText(
        textValue(
          row?.currentPenName,
          row?.current_pen_name,
          row?.currentPen,
          row?.current_pen,
          row?.penName,
          row?.pen_name,
          row?.unitName,
          row?.unit_name,
          row?.currentPenId,
          row?.current_pen_id
        ),
        '未分栏'
      ),
      status: normalizeStatusText(
        textValue(row?.status, row?.animalStatus, row?.animal_status)
      ) as CowStatus,
      pregnancy: Boolean(row?.pregnancy ?? row?.isPregnant ?? row?.is_pregnant),
      mixing: Boolean(row?.mixing ?? row?.isMixed ?? row?.is_mixed),
      parity: Number(
        row?.parity ??
          row?.parityNo ??
          row?.parity_no ??
          row?.reportedParityNo ??
          row?.reported_parity_no ??
          0
      ),
      createdAt: textValue(row?.createdAt, row?.created_at) || new Date().toISOString(),
      updatedAt:
        textValue(row?.updatedAt, row?.updated_at) ||
        textValue(row?.createdAt, row?.created_at) ||
        new Date().toISOString()
    } as CowBasic
  }
  const mergeCowSources = (cows: any[] = [], animals: any[] = []) => {
    const rowsByKey = new Map<string, CowBasic>()
    ;[...animals, ...cows].forEach((row) => {
      const normalized = normalizeCowBasic(row)
      if (!normalized) return
      const key = normalized.cowNumber || normalized.id
      const existing = rowsByKey.get(key)
      rowsByKey.set(key, existing ? ({ ...existing, ...normalized } as CowBasic) : normalized)
    })
    return Array.from(rowsByKey.values())
  }
  const getSensorTimeValue = (data: any) =>
    data?.timestamp ??
    data?.ts ??
    data?.measuredAt ??
    data?.measured_at ??
    data?.recordTime ??
    data?.record_time ??
    data?.createdAt ??
    data?.created_at ??
    data?.updatedAt ??
    data?.updated_at ??
    ''
  const getSensorMetricName = (data: any) =>
    textValue(data?.metricCode, data?.metric_code, data?.metric, data?.dataType, data?.data_type)
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
  const isTemperatureMetric = (metric: string) =>
    /temp|temperature|body_temperature|ear_temperature|rectal_temperature|体温|耳温|温度/.test(
      metric
    )
  const isActivityMetric = (metric: string) =>
    /activity|active|motion|activity_index|活动|运动/.test(metric)
  const getLongReadingValue = (data: any) => {
    const payload = parsePayload(data?.rawPayload ?? data?.raw_payload ?? data?.payload)
    return numberValue(
      data?.readingValue,
      data?.reading_value,
      data?.value,
      data?.numericValue,
      data?.numeric_value,
      payload.readingValue,
      payload.reading_value,
      payload.value
    )
  }
  const getSensorMetricValue = (data: any, metric: SensorMetric) => {
    const payload = parsePayload(data?.rawPayload ?? data?.raw_payload ?? data?.payload)
    const metricName = getSensorMetricName(data)
    const reading = getLongReadingValue(data)
    if (metric === 'temperature') {
      if (metricName && isTemperatureMetric(metricName) && Number.isFinite(reading)) return reading
      return numberValue(
        data?.temperature,
        data?.bodyTemperature,
        data?.body_temperature,
        data?.earTemperature,
        data?.ear_temperature,
        data?.rectalTemperature,
        data?.rectal_temperature,
        payload.temperature,
        payload.body_temperature
      )
    }
    return numberValue(
      data?.activityIndex,
      data?.activity_index,
      data?.activity,
      data?.activity?.activeTime,
      payload.activityIndex,
      payload.activity_index,
      payload.activity
    )
  }
  const sensorMatchesCow = (data: any, cow: CowBasic) => {
    const sensorCowId = getSensorCowId(data)
    const sensorCowNumber = getSensorCowNumber(data)
    return (
      sensorCowId === String(cow.id) ||
      sensorCowId === String(cow.cowNumber) ||
      sensorCowNumber === String(cow.cowNumber) ||
      sensorCowNumber === String(cow.id)
    )
  }
  const cowKeys = (cow: CowBasic | null | undefined) =>
    Array.from(
      new Set(
        [
          cow?.id,
          (cow as any)?.cowId,
          (cow as any)?.cow_id,
          (cow as any)?.animalId,
          (cow as any)?.animal_id,
          cow?.cowNumber,
          (cow as any)?.cow_number,
          (cow as any)?.animalNumber,
          (cow as any)?.animal_number
        ]
          .map((value) => String(value ?? '').trim())
          .filter(Boolean)
      )
    )
  const getSensorTimestamp = (data: any) => {
    const timestamp = new Date(getSensorTimeValue(data)).getTime()
    return Number.isFinite(timestamp) ? timestamp : 0
  }
  const getSensorTimeLabel = (data: any, index: number) => {
    const timestamp = getSensorTimestamp(data)
    if (!timestamp) return `${index + 1}`
    const date = new Date(timestamp)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  const getCowSensorSeries = (cowId: string) => {
    const cow = allCows.value.find(
      (item) => String(item.id) === String(cowId) || String(item.cowNumber) === String(cowId)
    )
    const rowsByTime = new Map<string, ExtendedSensorData>()
    allSensorRows.value
      .filter((data: any) =>
        cow ? sensorMatchesCow(data, cow) : getSensorCowId(data) === String(cowId)
      )
      .sort((a: any, b: any) => getSensorTimestamp(a) - getSensorTimestamp(b))
      .forEach((data: any) => {
        const timestamp = getSensorTimestamp(data)
        if (!timestamp) return
        const metric = getSensorMetricName(data) || 'temperature'
        const key = `${metric}-${Math.floor(timestamp / 60000)}`
        rowsByTime.set(key, data)
      })
    return Array.from(rowsByTime.values())
      .sort((a: any, b: any) => getSensorTimestamp(a) - getSensorTimestamp(b))
      .slice(-24)
  }
  const getMetricSeries = (cowId: string, metric: SensorMetric): SensorSeriesPoint[] => {
    const metricRows = getCowSensorSeries(cowId)
      .map((data: any, index: number) => ({
        time: getSensorTimeLabel(data, index),
        value: getSensorMetricValue(data, metric),
        timestamp: getSensorTimestamp(data)
      }))
      .filter(
        (data) =>
          Number.isFinite(data.value) &&
          (metric !== 'temperature' || (data.value >= 30 && data.value <= 45))
      )

    return metricRows
      .sort((left, right) => left.timestamp - right.timestamp)
      .slice(-24)
      .map((item, index) => ({
        ...item,
        time: item.timestamp ? item.time : `${index + 1}`
      }))
  }
  const getSensorRowKey = (data: any) =>
    String(
      data?.id ||
        `${getSensorCowId(data)}-${getSensorCowNumber(data)}-${getSensorTimeValue(data)}-${getSensorMetricName(data)}-${getLongReadingValue(data)}-${getSensorMetricValue(data, 'temperature')}`
    )
  const mergeSensorRows = (baseRows: ExtendedSensorData[], nextRows: ExtendedSensorData[]) => {
    const rowsByKey = new Map<string, ExtendedSensorData>()
    ;[...baseRows, ...nextRows].forEach((row) => {
      rowsByKey.set(getSensorRowKey(row), row)
    })
    return Array.from(rowsByKey.values())
  }
  const sensorReadingsForCow = (cow: CowBasic, row: ExtendedSensorData) => {
    const timestamp = getSensorTimeValue(row) || new Date().toISOString()
    const readings: Array<
      ReturnType<typeof databaseService.addSensorReading> extends Promise<void>
        ? Parameters<typeof databaseService.addSensorReading>[0]
        : never
    > = []
    const temperature = getSensorMetricValue(row, 'temperature')
    if (Number.isFinite(temperature)) {
      readings.push({
        cowId: String((row as any).cowId || cow.id),
        cowNumber: String((row as any).cowNumber || cow.cowNumber || ''),
        deviceId: String((row as any).deviceId || (row as any).device_id || ''),
        timestamp,
        metric: 'temperature',
        value: temperature,
        unit: '℃',
        quality: String((row as any).quality || (row as any).qualityFlag || 'good')
      })
    }
    return readings.map((reading) => databaseService.addSensorReading(reading))
  }
  const getEventTime = (event: any) =>
    event?.occurredAt ??
    event?.occurred_at ??
    event?.eventDate ??
    event?.event_date ??
    event?.eventTime ??
    event?.event_time ??
    event?.createdAt ??
    event?.created_at ??
    ''
  const eventDisplayType = (event: any) => {
    const group = String(event?.eventGroup ?? event?.event_group ?? '').trim()
    const text =
      `${event?.eventCode ?? event?.event_code ?? ''} ${event?.eventType ?? event?.event_type ?? ''} ${event?.eventName ?? event?.event_name ?? ''}`.toLowerCase()
    if (group === 'movement' || /entry|transfer|exit|入群|转群|离群|出群/.test(text)) {
      if (/transfer|转群/.test(text)) return '转群'
      if (/exit|离群|出群|淘汰/.test(text)) return '出群'
      return '入群'
    }
    if (
      group === 'health' ||
      /veterinary|health|diagnosis|treatment|medication|兽医|发病|治疗|用药/.test(text)
    ) {
      return '兽医'
    }
    if (
      group === 'reproduction' ||
      /breeding|insemination|calving|pregnancy|配种|输精|产犊|妊检/.test(text)
    ) {
      return '育种'
    }
    return '生产事件'
  }
  const normalizeCowEvent = (event: any) => ({
    cowId: String(event?.cowId ?? event?.cow_id ?? ''),
    cowNumber: String(
      event?.cowNumber ?? event?.cow_number ?? event?.animalNumber ?? event?.animal_number ?? ''
    ),
    eventTime: getEventTime(event),
    eventType: eventDisplayType(event),
    event:
      event?.eventName ??
      event?.event_name ??
      event?.eventType ??
      event?.event_type ??
      event?.type ??
      eventDisplayType(event),
    person:
      event?.operatorName ??
      event?.operator_name ??
      event?.operator ??
      event?.person ??
      event?.vetName ??
      event?.recorder ??
      '',
    notes: event?.notes ?? event?.description ?? ''
  })
  const loadCowEvents = async (cow: CowBasic) => {
    const cowKeySet = new Set(cowKeys(cow))
    const events = (await databaseService.getUnifiedCowEventRowsAsync().catch(() => []))
      .filter((event: any) => {
        const eventCowId = String(
          event?.cowId ?? event?.cow_id ?? event?.animalId ?? event?.animal_id ?? ''
        )
        const eventCowNumber = String(
          event?.cowNumber ?? event?.cow_number ?? event?.animalNumber ?? event?.animal_number ?? ''
        )
        return cowKeySet.has(eventCowId) || cowKeySet.has(eventCowNumber)
      })
      .map((event: any) => normalizeCowEvent(event))

    const seen = new Set<string>()
    return events
      .filter((event: any) => {
        const key = [
          event.cowId,
          event.cowNumber,
          event.eventTime,
          event.event,
          event.eventType
        ].join('|')
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime())
  }
  const buildLatestSensorMap = (cows: CowBasic[]) => {
    const cowIds = new Set(cows.flatMap((cow) => cowKeys(cow)))
    const latestMap = getLatestSensorMap(allSensorRows.value)
    return Object.fromEntries(Object.entries(latestMap).filter(([cowId]) => cowIds.has(cowId)))
  }

  const chartInstances = ref<Map<string, echarts.ECharts>>(new Map())

  const getOrCreateChart = (element: HTMLElement, key: string) => {
    const cached = chartInstances.value.get(key)
    if (cached && !cached.isDisposed() && cached.getDom() === element) return cached

    if (cached) {
      cached.dispose()
      chartInstances.value.delete(key)
    }

    const exist = echarts.getInstanceByDom(element)
    if (exist && !exist.isDisposed()) {
      chartInstances.value.set(key, exist)
      return exist
    }

    const chart = echarts.init(element)
    chartInstances.value.set(key, chart)
    return chart
  }

  const disposeChart = (key: string) => {
    const chart = chartInstances.value.get(key)
    if (chart) {
      chart.dispose()
      chartInstances.value.delete(key)
    }
  }

  const disposeAllCharts = () => {
    chartInstances.value.forEach((chart) => {
      chart.dispose()
    })
    chartInstances.value.clear()
  }

  const defaultCowTypeValues = ['犊牛', '小育成牛', '大育成牛', '青年牛', '成母牛', '种公牛']
  const defaultCowStatusValues = ['健康', '异常', '发情', '预产', '混群', '离群']
  const cowTypes = ref<Array<{ label: string; value: CowType }>>([])
  const cowStatuses = ref<Array<{ label: string; value: CowStatus }>>([])

  const rebuildFilterOptions = (rows: CowBasic[]) => {
    const typeValues = Array.from(
      new Set([
        ...rows
          .map((cow: any) => String(cow.type ?? cow.cowType ?? cow.cow_type ?? '').trim())
          .filter(Boolean),
        ...defaultCowTypeValues
      ])
    )
    const statusValues = Array.from(
      new Set([
        ...rows.map((cow: any) => String(cow.status ?? '').trim()).filter(Boolean),
        ...defaultCowStatusValues
      ])
    )
    cowTypes.value = typeValues.map((value) => ({ label: value, value: value as CowType }))
    cowStatuses.value = statusValues.map((value) => ({ label: value, value: value as CowStatus }))
  }

  // 方法
  const loadCows = async () => {
    try {
      // 优先从数据库服务获取数据，backend 模式不使用前端 fallback 写库
      let [cowRows, animalRows] = await Promise.all([
        databaseService.getTableDataAsync('cows', { silent: true }),
        databaseService.getTableDataAsync('animal', { silent: true })
      ])
      let cowsData = mergeCowSources(cowRows, animalRows)
      dataSource.value = cowsData.length > 0 ? 'real' : getCowApiDataSource()
      allCows.value = cowsData
      cowList.value = cowsData
      rebuildFilterOptions(cowsData)
      // 鍔犺浇浼犳劅鍣ㄦ暟鎹?
      await loadSensorData(cowsData)
    } catch (error) {
      console.error('加载牛只数据失败:', error)
      dataSource.value = 'error'
    }
  }

  // 鍔犺浇浼犳劅鍣ㄦ暟鎹?
  const loadSensorData = async (cows: CowBasic[]) => {
    try {
      const snapshot = await databaseService
        .runBackendRpcAsync<
          Record<string, any>
        >('getHealthDashboardSnapshot', { perCowLimit: 24 }, { timeout: 10000, showErrorLog: false })
        .catch(() => null)
      const snapshotRows = [
        snapshot?.sensorRows,
        snapshot?.temperature,
        snapshot?.temperatures
      ].find((rows) => Array.isArray(rows)) as any[] | undefined
      const normalizedSnapshotRows = (snapshotRows || [])
        .map((row: any, index: number) => {
          const timestamp = String(getSensorTimeValue(row) || '')
          const temperature = numberValue(
            row?.temperature,
            row?.readingValue,
            row?.reading_value,
            row?.value
          )
          if (!timestamp || !Number.isFinite(temperature)) return null
          const rowCowId = getSensorCowId(row)
          const rowCowNumber = getSensorCowNumber(row)
          const cow = cows.find(
            (item) => cowKeys(item).includes(rowCowId) || cowKeys(item).includes(rowCowNumber)
          )
          const cowId = rowCowId || String(cow?.id || rowCowNumber)
          const cowNumber = rowCowNumber || String(cow?.cowNumber || '')
          if (!cowId && !cowNumber) return null
          return {
              ...row,
              id: String(row?.id || `health-snapshot-${cowId || cowNumber}-${timestamp}-${index}`),
              cowId: cowId || cowNumber,
              cowNumber,
              timestamp,
              temperature,
              createdAt: String(row?.createdAt || row?.created_at || timestamp),
              steps: Number(row?.steps || 0),
              rumination: row?.rumination || { count: 0, duration: 0, efficiency: 0 },
              activity: row?.activity || {
                lyingTime: 0,
                standingTime: 0,
                walkingDistance: 0,
                activeTime: 0
              },
              feeding: row?.feeding || {
                eatingTime: 0,
                estimatedIntake: 0,
                feedingEfficiency: 0
              },
              vitalSigns: row?.vitalSigns || {
                respiratoryRate: 0,
                heartRate: 0,
                bodyScore: 0
              },
              environment: row?.environment || {
                ambientTemp: 0,
                humidity: 0,
                ammonia: 0,
                lightLevel: 0
              }
          } as ExtendedSensorData
        })
        .filter((row): row is ExtendedSensorData => Boolean(row))

      if (normalizedSnapshotRows.length) {
        allSensorRows.value = normalizedSnapshotRows
        sensorDataMap.value = {
          ...sensorDataMap.value,
          ...buildLatestSensorMap(cows)
        }
        return
      }

      const sensorRows = await loadUnifiedSensorData(cows)
      allSensorRows.value = sensorRows
      const latestSensorMap = buildLatestSensorMap(cows)
      sensorDataMap.value = { ...sensorDataMap.value, ...latestSensorMap }
    } catch (error) {
      console.error('加载传感器数据失败:', error)
    }
  }

  const getLatestSensorData = (cowId: string): ExtendedSensorData | null => {
    const cow = allCows.value.find(
      (item) => String(item.id) === String(cowId) || String(item.cowNumber) === String(cowId)
    )
    const data = cowKeys(cow || ({ id: cowId, cowNumber: cowId } as CowBasic))
      .map((key) => sensorDataMap.value[key])
      .find(Boolean)
    return data || null
  }

  const formatSensorTemperature = (data: ExtendedSensorData | null) => {
    const value = data ? getSensorMetricValue(data, 'temperature') : Number.NaN
    return Number.isFinite(value) ? `${value.toFixed(1)}°C` : ui('暂无', 'None')
  }

  const handleSearch = () => {
    let filtered = [...allCows.value]

    if (searchForm.cowNumber) {
      filtered = filtered.filter((cow) =>
        cowKeys(cow).some((key) => key.includes(searchForm.cowNumber))
      )
    }

    if (searchForm.type) {
      filtered = filtered.filter((cow) => cow.type === searchForm.type)
    }

    if (searchForm.status) {
      filtered = filtered.filter((cow) => cow.status === searchForm.status)
    }

    cowList.value = filtered
    resetCowCardWindow()
  }

  const handleCowSearchSelect = (item: { cowNumber: string }) => {
    searchForm.cowNumber = item.cowNumber
    handleSearch()
  }

  const handleReset = () => {
    searchForm.cowNumber = ''
    searchForm.type = ''
    searchForm.status = ''
    cowList.value = [...allCows.value]
    resetCowCardWindow()
    resetCardObservation()
  }

  const showCowDetail = async (cow: CowBasic) => {
    selectedCow.value = cow
    detailDialogVisible.value = true

    cowEvents.value = await loadCowEvents(cow)
    resetCowEventRows()

    nextTick(() => {
      if (temperatureChart.value) {
        renderCharts()
      }
    })
  }

  const handleCloseDetail = () => {
    detailDialogVisible.value = false
    selectedCow.value = null
    cowEvents.value = []
    resetCowEventRows()
  }

  const getCardClass = (status: CowStatus) => {
    const statusClasses = {
      健康: 'cow-query-card--healthy',
      在群: 'cow-query-card--healthy',
      异常: 'cow-query-card--abnormal',
      发情: 'cow-query-card--heat'
    }
    return (statusClasses as Record<string, string>)[status] || 'cow-query-card--neutral'
  }

  const getTextClass = (status?: CowStatus) => {
    void status
    return 'text-gray-900 dark:text-white'
  }

  const getHealthStatusDotClass = (cow: any) => {
    switch (cow.status) {
      case '健康':
      case '在群':
        return 'bg-green-500'
      case '异常':
        return 'bg-red-500'
      case '发情':
        return 'bg-yellow-500'
      default:
        return 'bg-gray-400'
    }
  }

  const getPregnancyStatusDotClass = (cow: any) => {
    // 预产状态显示蓝色，否则显示灰色
    return cow.pregnancy === true ? 'bg-green-500' : 'bg-gray-400'
  }

  const getMixingStatusDotClass = (cow: any) => {
    // 混群状态显示紫色，否则显示灰色
    return cow.mixing === true ? 'bg-teal-500' : 'bg-gray-400'
  }

  const formatDate = (date: string) => {
    return formatDateOnly(date)
  }

  const formatDateTime = (dateTime: string) => {
    return formatDateOnly(dateTime)
  }

  const getAge = (birthDate: string) => {
    const birth = new Date(birthDate)
    if (!Number.isFinite(birth.getTime())) return '-'
    const now = new Date()
    const age = now.getFullYear() - birth.getFullYear()
    return `${age}岁`
  }

  const buildLineChartOption = (
    seriesData: SensorSeriesPoint[],
    config: {
      name: string
      color: string
      min?: number
      max?: number
      compact?: boolean
      noDataText?: string
    }
  ) => {
    const hasData = seriesData.length > 0
    return {
      grid: config.compact
        ? { left: '12%', right: '8%', top: '12%', bottom: '15%' }
        : { left: 45, right: 18, top: 28, bottom: 32 },
      tooltip: {
        trigger: 'axis'
      },
      graphic: hasData
        ? []
        : [
            {
              type: 'text',
              left: 'center',
              top: 'middle',
              style: {
                text: config.noDataText || '暂无传感器数据',
                fill: '#6b7280',
                fontSize: config.compact ? 12 : 14,
                fontWeight: 600
              }
            }
          ],
      xAxis: {
        type: 'category',
        show: true,
        data: hasData
          ? seriesData.map((d, index) =>
              index === 0 || index === seriesData.length - 1 || index % 6 === 0 ? d.time : ''
            )
          : [''],
        axisLabel: {
          hideOverlap: true,
          fontSize: config.compact ? 9 : 11,
          interval: 0,
          rotate: 0
        },
        axisTick: {
          length: config.compact ? 2 : 4
        }
      },
      yAxis: {
        type: 'value',
        show: true,
        name: config.compact ? '' : config.name,
        min: config.min,
        max: config.max,
        axisLabel: {
          fontSize: config.compact ? 8 : 11
        },
        axisTick: {
          length: config.compact ? 2 : 4
        }
      },
      series: [
        {
          name: config.name,
          data: hasData ? seriesData.map((d) => d.value) : [],
          type: 'line',
          smooth: true,
          lineStyle: {
            color: config.color,
            width: config.compact ? 1 : 2
          },
          areaStyle: {
            color: config.color === '#ef4444' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(96, 192, 65, 0.1)'
          },
          symbol: config.compact ? 'none' : 'circle',
          symbolSize: config.compact ? 0 : 6
        }
      ]
    }
  }

  const renderCharts = () => {
    if (!selectedCow.value || !temperatureChart.value) return

    const temperatureData = getMetricSeries(selectedCow.value.id, 'temperature')

    const tempChart = getOrCreateChart(temperatureChart.value, 'detail-temp')
    tempChart.setOption(
      buildLineChartOption(temperatureData, {
        name: ui('体温 (°C)', 'Temperature (°C)'),
        color: '#ef4444',
        min: 35,
        max: 42,
        noDataText: ui('暂无体温数据', 'No temperature data')
      }),
      true
    )
  }

  const {
    containerRef: cowCardContainerRef,
    visibleItems: currentPageData,
    resetVisibleCount: resetCowCardWindow,
    handleScroll: onCowCardScroll,
    handleWheel: onCowCardWheel
  } = useLazyGridRenderWindow(cowList, {
    rowCount: 2,
    minItemWidth: 268,
    gap: 14,
    fallbackColumns: 4,
    mode: 'fixed-window'
  })

  const resetCardObservation = () => {
    cleanupCardCharts()
    visibleCardIds.value = new Set()
    renderedCardIds.value = new Set()
    nextTick(() => {
      observeCurrentPageCards()
    })
  }

  const scheduleCardChartRender = () => {
    if (cardRenderTimer !== null) {
      window.clearTimeout(cardRenderTimer)
    }
    cardRenderTimer = window.setTimeout(() => {
      cardRenderTimer = null
      renderCardCharts()
    }, 60)
  }

  const observeCurrentPageCards = () => {
    if (cardObserver) {
      cardObserver.disconnect()
    }
    if (typeof IntersectionObserver === 'undefined') {
      visibleCardIds.value = new Set(currentPageData.value.map((cow) => String(cow.id)))
      scheduleCardChartRender()
      return
    }
    cardObserver = new IntersectionObserver(
      (entries) => {
        const nextVisibleIds = new Set(visibleCardIds.value)
        entries.forEach((entry) => {
          const cowId = (entry.target as HTMLElement).dataset.cowId
          if (!cowId) return
          if (entry.isIntersecting) {
            nextVisibleIds.add(cowId)
          } else {
            nextVisibleIds.delete(cowId)
            disposeChart(`temp-${cowId}`)
            const nextRenderedIds = new Set(renderedCardIds.value)
            nextRenderedIds.delete(cowId)
            renderedCardIds.value = nextRenderedIds
          }
        })
        visibleCardIds.value = nextVisibleIds
        scheduleCardChartRender()
      },
      {
        root: null,
        rootMargin: '120px 0px',
        threshold: 0.05
      }
    )

    cardElements.forEach((element) => {
      cardObserver?.observe(element)
    })
  }

  const setCardElement = (element: Element | ComponentPublicInstance | null) => {
    const dom = element && '$el' in element ? element.$el : element
    if (!(dom instanceof HTMLElement)) {
      return
    }
    const cowId = dom.dataset.cowId
    if (!cowId) return
    dom.dataset.cowId = cowId
    cardElements.set(cowId, dom)
    cardObserver?.observe(dom)
  }

  const cleanupCardCharts = () => {
    const currentIds = new Set(currentPageData.value.map((cow) => String(cow.id)))
    Array.from(chartInstances.value.keys()).forEach((key) => {
      if (!key.startsWith('temp-')) return
      const cowId = key.replace(/^temp-/, '')
      if (!currentIds.has(cowId)) {
        disposeChart(key)
      }
    })
  }

  // 渲染卡片中的小型图表
  const renderCardCharts = () => {
    cleanupCardCharts()
    const nextRenderedIds = new Set(renderedCardIds.value)
    currentPageData.value.forEach((cow) => {
      if (!visibleCardIds.value.has(cow.id)) return
      nextRenderedIds.add(cow.id)

      const tempChartElement = document.getElementById(`temp-chart-${cow.id}`)
      if (tempChartElement) {
        const tempChart = getOrCreateChart(tempChartElement, `temp-${cow.id}`)
        const tempData = getMetricSeries(cow.id, 'temperature')
        tempChart.setOption(
          buildLineChartOption(tempData, {
            name: '体温 (°C)',
            color: '#ef4444',
            min: 35,
            max: 42,
            compact: true,
            noDataText: '暂无体温数据'
          }),
          true
        )
      }
    })
    renderedCardIds.value = nextRenderedIds
  }

  // 生命周期
  onMounted(() => {
    loadCows()
  })

  onBeforeUnmount(() => {
    if (cardRenderTimer !== null) {
      window.clearTimeout(cardRenderTimer)
      cardRenderTimer = null
    }
    cardObserver?.disconnect()
    disposeAllCharts()
  })

  // 监听 cowList 变化，重新观察当前页可见卡片
  watch(
    cowList,
    () => {
      nextTick(() => {
        resetCardObservation()
      })
    },
    { deep: true, flush: 'post' }
  )

  watch(
    allSensorRows,
    () => {
      if (!detailDialogVisible.value || !selectedCow.value) return
      nextTick(renderCharts)
    },
    { flush: 'post' }
  )
</script>

<style scoped>
  .cow-query-page {
    padding: 14px;
    background: #f8fafc;
  }

  .cow-query-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 12px;
    padding: 12px 14px;
    border: 1px solid rgb(148 163 184 / 22%);
    border-radius: 8px;
    background: #fff;
  }

  .cow-query-head h1 {
    margin: 0;
    color: #0f172a;
    font-size: 22px;
    font-weight: 800;
    line-height: 1.2;
  }

  .cow-query-head p {
    margin: 5px 0 0;
    color: #64748b;
    font-size: 13px;
  }

  .query-filter-panel {
    padding: 12px 14px;
    margin-bottom: 12px;
  }

  .query-filter-panel :deep(.el-form) {
    align-items: center;
    gap: 10px 14px;
    margin: 0;
  }

  .query-filter-panel :deep(.el-form-item) {
    margin: 0;
    min-width: 0;
  }

  .cow-search-autocomplete {
    width: min(380px, 78vw);
    min-width: min(260px, 100%);
  }

  .cow-card-lazy-scroll {
    max-height: calc((360px * 2) + 18px);
    overflow-y: auto;
    padding-right: 6px;
    overscroll-behavior: contain;
  }

  .cow-query-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
    gap: 12px;
  }

  .cow-query-card {
    display: flex;
    min-width: 0;
    min-height: 360px;
    flex-direction: column;
    padding: 12px;
    cursor: pointer;
    border-left-width: 4px;
    transition:
      border-color 0.16s ease,
      background-color 0.16s ease,
      box-shadow 0.16s ease,
      transform 0.16s ease;
  }

  .cow-query-card:hover {
    border-color: rgb(15 118 110 / 45%);
    background: #f8fafc;
    transform: var(--fluent-card-hover-transform);
  }

  .cow-card-topline,
  .cow-card-id-wrap,
  .cow-status-dots {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .cow-card-topline {
    min-width: 0;
    margin-bottom: 12px;
  }

  .cow-card-id-wrap {
    display: grid;
    gap: 6px;
    overflow: hidden;
  }

  .cow-card-id-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
  }

  .cow-card-number-block {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .cow-card-number-label {
    color: #64748b;
    font-size: 11px;
    font-weight: 680;
    line-height: 1;
  }

  .cow-status-dots {
    flex: 0 0 auto;
  }

  .cow-card-number,
  .cow-card-type {
    min-width: 0;
    overflow: hidden;
    font-weight: 700;
    line-height: 1.35;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .cow-card-number {
    max-width: 100%;
    display: block;
    font-size: 16px;
    text-overflow: ellipsis;
    white-space: normal;
  }

  .cow-card-type {
    display: inline-flex;
    flex: 0 0 auto;
    max-width: 112px;
    padding: 2px 8px;
    align-items: center;
    justify-content: center;
    color: #0f172a;
    background: rgb(248 250 252 / 86%);
    border: 1px solid rgb(148 163 184 / 20%);
    border-radius: 999px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cow-query-card .space-y-2 div,
  .cow-query-card .space-y-2 span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .cow-query-card .space-y-2 .flex.justify-between {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .cow-query-card .space-y-2 .flex.justify-between span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cow-query-card--healthy {
    border-left-color: #16a34a;
  }

  .cow-query-card--abnormal {
    border-left-color: #dc2626;
  }

  .cow-query-card--heat {
    border-left-color: #d97706;
  }

  .cow-query-card--neutral {
    border-left-color: #64748b;
  }

  .sensor-section {
    padding-top: 10px;
    margin-top: 10px;
    border-top: 1px solid rgb(148 163 184 / 20%);
  }

  .sensor-mini-stat,
  .sensor-chart-tile {
    min-width: 0;
  }

  .sensor-mini-stat {
    padding: 7px 9px;
  }

  .sensor-chart-tile {
    padding: 8px;
    min-width: 0;
  }

  .sensor-chart-tile :deep([data-card-chart]),
  .cow-query-card [data-card-chart] {
    height: 86px !important;
  }

  .detail-section {
    padding: 14px;
    margin-bottom: 12px;
  }

  :deep(.custom-dialog .el-dialog__body) {
    max-height: calc(100vh - 170px);
    overflow-y: auto;
  }

  .detail-section-title {
    margin: 0 0 12px;
    color: #0f172a;
    font-size: 16px;
    font-weight: 800;
  }

  .detail-cell {
    padding: 10px;
  }

  .detail-cell-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
  }

  .detail-cell .font-semibold {
    overflow-wrap: anywhere;
  }

  .detail-chart-panel {
    min-width: 0;
    padding: 12px;
  }

  .detail-chart-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  .detail-chart {
    width: 100%;
    height: 320px;
    min-height: 320px;
  }

  .detail-chart-panel h4 {
    margin: 0 0 10px;
    text-align: center;
    color: #0f172a;
    font-weight: 700;
  }

  .cow-event-table-shell {
    overflow: auto;
  }

  .cow-event-table-shell :deep(.el-table) {
    min-width: 860px;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 12px;
  }

  :global(.dark) .cow-query-head h1,
  :global(.dark) .detail-section-title,
  :global(.dark) .detail-chart-panel h4 {
    color: #f8fafc;
  }

  :global(.dark) .cow-query-head p {
    color: #cbd5e1;
  }

  :global(.dark) .cow-query-card:hover {
    background: rgb(30 41 59 / 72%);
  }

  @media (max-width: 768px) {
    .cow-query-page {
      padding: 14px;
    }

    .cow-query-head {
      display: grid;
    }

    .cow-query-grid {
      grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
    }
  }
</style>
