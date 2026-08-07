<template>
  <div class="statistics-page p-5">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">离群牛统计</h1>
      </div>

      <div class="flex items-center gap-4">
        <div class="text-sm text-gray-600 dark:text-gray-300"> 共 {{ totalCows }} 头离群牛只 </div>
        <ElButton type="primary" @click="loadLeftCows" :loading="loading">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-2" />
          刷新数据
        </ElButton>
      </div>
    </div>

    <div
      v-if="leftCows.length > 0"
      ref="cowCardContainerRef"
      class="cow-card-lazy-scroll"
      @scroll.passive="onCowCardScroll"
      @wheel.passive="onCowCardWheel"
    >
      <div class="statistics-cow-grid">
        <div
          v-for="cow in currentPageData"
          :key="cow.id"
          class="statistics-cow-card cursor-pointer hover:-translate-y-1"
          @click="showCowDetail(cow)"
        >
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center">
              <div class="flex items-center mr-2">
                <div :class="['w-3 h-3 rounded-full', getHealthStatusDotClass(cow)]"></div>
                <div :class="['w-3 h-3 rounded-full ml-1', getPregnancyStatusDotClass(cow)]"></div>
                <div :class="['w-3 h-3 rounded-full ml-1', getMixingStatusDotClass(cow)]"></div>
              </div>
              <span class="font-semibold text-gray-900 dark:text-white">
                牛号: {{ cow.cowNumber }}
              </span>
            </div>
            <span class="text-sm text-gray-900 dark:text-white">{{ cow.type }}</span>
          </div>

          <div class="space-y-2 text-sm mb-3 text-gray-900 dark:text-white">
            <div class="flex justify-between">
              <span>品种: {{ cow.breed }}</span>
              <span>性别: {{ cow.gender }}</span>
            </div>
            <div>圈舍: {{ cow.currentPen }}</div>
            <div>胎次: {{ cow.parity }}</div>
          </div>

          <div class="text-xs text-gray-900 dark:text-white">
            出生: {{ formatDate(cow.birthDate) }} ({{ getAge(cow.birthDate) }})
          </div>

          <div class="mt-3 pt-3 border-t border-white/30">
            <div class="grid grid-cols-2 gap-3 mb-3">
              <div class="statistics-soft-cell px-3 py-2">
                <div class="text-xs text-gray-600 dark:text-gray-300">最近体温</div>
                <div class="text-sm font-semibold text-gray-900 dark:text-white">
                  {{ formatTemperature(getLatestSensorData(cow.id)?.temperature) }}
                </div>
              </div>
              <div class="statistics-soft-cell px-3 py-2">
                <div class="text-xs text-gray-600 dark:text-gray-300">最近步数</div>
                <div class="text-sm font-semibold text-gray-900 dark:text-white">
                  {{ getLatestSensorData(cow.id)?.steps ?? '--' }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="text-center py-16">
      <ArtSvgIcon icon="ri:cow-line" class="text-6xl text-gray-400 mb-4 mx-auto" />
      <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">暂无离群牛只</h3>
    </div>

    <ElDialog
      v-model="detailDialogVisible"
      title="牛只详细信息"
      width="min(1040px, calc(100vw - 32px))"
      :before-close="handleCloseDetail"
      class="custom-dialog"
    >
      <div v-if="selectedCow">
        <div class="statistics-detail-block">
          <h3 class="text-lg font-semibold mb-4 text-gray-900 dark:text-white">基本信息</h3>
          <div class="statistics-detail-grid grid gap-4">
            <div class="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg">
              <div class="text-sm text-green-800 dark:text-green-200 font-medium">牛号</div>
              <div class="text-lg font-bold text-green-900 dark:text-green-100">{{
                selectedCow.cowNumber
              }}</div>
            </div>
            <div class="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg">
              <div class="text-sm text-green-800 dark:text-green-200 font-medium">品种</div>
              <div class="text-lg font-bold text-green-900 dark:text-green-100">{{
                selectedCow.breed
              }}</div>
            </div>
            <div class="bg-teal-50 dark:bg-teal-900/20 p-3 rounded-lg">
              <div class="text-sm text-teal-800 dark:text-teal-200 font-medium">性别</div>
              <div class="text-lg font-bold text-teal-900 dark:text-teal-100">{{
                selectedCow.gender
              }}</div>
            </div>
            <div class="bg-orange-50 dark:bg-orange-900/20 p-3 rounded-lg">
              <div class="text-sm text-orange-800 dark:text-orange-200 font-medium">类型</div>
              <div class="text-lg font-bold text-orange-900 dark:text-orange-100">{{
                selectedCow.type
              }}</div>
            </div>
          </div>

          <div class="statistics-detail-grid grid gap-4 mt-4">
            <div class="bg-gray-50 dark:bg-gray-900 bg-opacity-20 p-3 rounded-lg">
              <div class="text-sm text-gray-800 dark:text-gray-200 font-medium">圈舍</div>
              <div class="text-lg font-bold text-gray-900 dark:text-gray-100">{{
                selectedCow.currentPen
              }}</div>
            </div>
            <div class="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
              <div class="text-sm text-red-800 dark:text-red-200 font-medium">胎次</div>
              <div class="text-lg font-bold text-red-900 dark:text-red-100">{{
                selectedCow.parity
              }}</div>
            </div>
            <div class="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg">
              <div class="text-sm text-green-800 dark:text-green-200 font-medium">状态</div>
              <div class="text-lg font-bold text-green-900 dark:text-green-100">{{
                selectedCow.status
              }}</div>
            </div>
            <div class="bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-lg">
              <div class="text-sm text-emerald-800 dark:text-emerald-200 font-medium">出生日期</div>
              <div class="text-lg font-bold text-emerald-900 dark:text-emerald-100">
                {{ formatDate(selectedCow.birthDate) }}
              </div>
            </div>
          </div>
        </div>

        <div class="statistics-detail-block">
          <h3 class="text-lg font-semibold mb-4 text-gray-900 dark:text-white">血缘信息</h3>
          <div class="statistics-detail-grid grid gap-4">
            <div class="bg-pink-50 dark:bg-pink-900/20 p-3 rounded-lg">
              <div class="text-sm text-pink-800 dark:text-pink-200 font-medium">父号</div>
              <div class="text-lg font-bold text-pink-900 dark:text-pink-100">
                {{ selectedCow.fatherNumber || '未知' }}
              </div>
            </div>
            <div class="bg-pink-50 dark:bg-pink-900/20 p-3 rounded-lg">
              <div class="text-sm text-pink-800 dark:text-pink-200 font-medium">母号</div>
              <div class="text-lg font-bold text-pink-900 dark:text-pink-100">
                {{ selectedCow.motherNumber || '未知' }}
              </div>
            </div>
            <div class="bg-rose-50 dark:bg-rose-900/20 p-3 rounded-lg">
              <div class="text-sm text-rose-800 dark:text-rose-200 font-medium">外祖父号</div>
              <div class="text-lg font-bold text-rose-900 dark:text-rose-100">
                {{ selectedCow.grandfatherNumber || '未知' }}
              </div>
            </div>
            <div class="bg-rose-50 dark:bg-rose-900/20 p-3 rounded-lg">
              <div class="text-sm text-rose-800 dark:text-rose-200 font-medium">外祖母号</div>
              <div class="text-lg font-bold text-rose-900 dark:text-rose-100">
                {{ selectedCow.grandmotherNumber || '未知' }}
              </div>
            </div>
          </div>
        </div>

        <div class="statistics-panel">
          <h3 class="text-lg font-semibold mb-4 text-gray-900 dark:text-white">24小时数据监控</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="statistics-chart-block">
              <h4 class="text-md font-medium mb-3 text-center text-gray-900 dark:text-white"
                >体温曲线 (°C)</h4
              >
              <div :id="`detail-temp-chart-${selectedCow.id}`" class="h-64 w-full"></div>
            </div>
            <div class="statistics-chart-block">
              <h4 class="text-md font-medium mb-3 text-center text-gray-900 dark:text-white"
                >步数曲线</h4
              >
              <div :id="`detail-step-chart-${selectedCow.id}`" class="h-64 w-full"></div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="text-center">
          <ElButton @click="handleCloseDetail">关闭</ElButton>
        </div>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
  import type { CowBasic, ExtendedSensorData } from '@/types'
  import * as echarts from 'echarts'
  import * as databaseService from '@/services/database'
  import { useLazyGridRenderWindow } from '@/hooks'
  import { buildUnifiedDataContext } from '@/services/unified-records'
  import { normalizeStatus } from '@/views/breeding-platform/platform-data'
  import { formatDateOnly } from '@/utils/date-display'

  const loading = ref(false)
  const detailDialogVisible = ref(false)
  const selectedCow = ref<CowBasic | null>(null)
  const leftCows = ref<CowBasic[]>([])
  const totalCows = ref(0)
  const sensorDataMap = ref<Record<string, ExtendedSensorData>>({})
  const chartInstances = ref<Map<string, echarts.ECharts>>(new Map())

  const getSensorCowId = (data: any) => String(data?.cowId ?? data?.cow_id ?? '')
  const getSensorTimeValue = (data: any) =>
    data?.timestamp ??
    data?.ts ??
    data?.createdAt ??
    data?.created_at ??
    data?.updatedAt ??
    data?.updated_at ??
    ''
  const getSensorTimestamp = (data: any) => {
    const timestamp = new Date(getSensorTimeValue(data)).getTime()
    return Number.isFinite(timestamp) ? timestamp : 0
  }
  const getSensorTimeLabel = (data: any, index: number) => {
    const timestamp = getSensorTimestamp(data)
    if (!timestamp) return `${index + 1}`
    return formatDateOnly(new Date(timestamp), `${index + 1}`)
  }
  const getCowSensorSeries = (cowId: string) => {
    const cow = leftCows.value.find((item) => String(item.id) === String(cowId))
    const cowKeys = [String(cowId), String((cow as any)?.cowNumber || '')].filter(Boolean)
    return databaseService
      .getUnifiedSensorData(cowKeys)
      .filter(
        (data: any) =>
          cowKeys.includes(getSensorCowId(data)) ||
          cowKeys.includes(String(data?.cowNumber || data?.cow_number || ''))
      )
      .sort((a: any, b: any) => getSensorTimestamp(a) - getSensorTimestamp(b))
      .slice(-24)
  }
  const getMetricSeries = (cowId: string, metric: 'temperature' | 'steps') => {
    return getCowSensorSeries(cowId)
      .map((data: any, index: number) => ({
        time: getSensorTimeLabel(data, index),
        value: Number(data?.[metric])
      }))
      .filter((data) => Number.isFinite(data.value))
  }
  const buildLatestSensorMap = (cows: CowBasic[]) => {
    const cowKeys = cows
      .flatMap((cow) => [String(cow.id), String((cow as any).cowNumber || '')])
      .filter(Boolean)
    const unifiedMap = databaseService.getLatestSensorDataMap(cowKeys)
    const latestMap: Record<string, ExtendedSensorData> = {}
    cows.forEach((cow) => {
      const sensor = unifiedMap[String(cow.id)] || unifiedMap[String((cow as any).cowNumber || '')]
      if (sensor) latestMap[String(cow.id)] = sensor as ExtendedSensorData
    })

    return latestMap
  }

  const {
    containerRef: cowCardContainerRef,
    visibleItems: currentPageData,
    handleScroll: onCowCardScroll,
    handleWheel: onCowCardWheel
  } = useLazyGridRenderWindow(leftCows, {
    rowCount: 2,
    minItemWidth: 280,
    gap: 24,
    fallbackColumns: 4,
    mode: 'fixed-window'
  })

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
    chartInstances.value.forEach((chart) => chart.dispose())
    chartInstances.value.clear()
  }

  const formatTemperature = (value: unknown) => {
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? `${numberValue.toFixed(1)}°C` : '--'
  }

  const formatDate = (dateString: string) => {
    return formatDateOnly(dateString, '-')
  }

  const getAge = (birthDate: string) => {
    const birth = new Date(birthDate)
    const now = new Date()
    const ageInMonths =
      (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())

    if (ageInMonths < 12) return `${ageInMonths}个月`
    const years = Math.floor(ageInMonths / 12)
    const months = ageInMonths % 12
    return months > 0 ? `${years}岁${months}个月` : `${years}岁`
  }

  const getLatestSensorData = (cowId: string): ExtendedSensorData | null => {
    const data = sensorDataMap.value[cowId]
    return data || null
  }

  const isLeftCow = (cow: any) => {
    const status = normalizeStatus(cow.status)
    return status === '离群' || status === '终止饲养'
  }

  const sortByCowNumber = (a: any, b: any) =>
    String(
      a.cowNumber ?? a.cow_number ?? a.animalNumber ?? a.animal_number ?? a.number ?? ''
    ).localeCompare(
      String(b.cowNumber ?? b.cow_number ?? b.animalNumber ?? b.animal_number ?? b.number ?? ''),
      'zh-CN',
      { numeric: true }
    )

  const loadLeftCows = async () => {
    loading.value = true
    try {
      const context = await buildUnifiedDataContext()
      let allCows = (context.cows || []) as CowBasic[]
      const left = allCows.filter(isLeftCow).sort(sortByCowNumber)

      leftCows.value = left
      totalCows.value = left.length
      void loadSensorData(left)
    } finally {
      loading.value = false
    }
  }

  const loadSensorData = async (cows: CowBasic[]) => {
    await databaseService.getUnifiedSensorDataAsync(
      cows.flatMap((cow) => [String(cow.id), String((cow as any).cowNumber || '')]).filter(Boolean)
    )
    const latestSensorMap = buildLatestSensorMap(cows)
    sensorDataMap.value = { ...sensorDataMap.value, ...latestSensorMap }
  }

  const showCowDetail = async (cow: CowBasic) => {
    selectedCow.value = cow
    detailDialogVisible.value = true
    await nextTick()
    renderDetailCharts(cow)
  }

  const handleCloseDetail = () => {
    if (selectedCow.value) {
      disposeChart(`detail-temp-${selectedCow.value.id}`)
      disposeChart(`detail-step-${selectedCow.value.id}`)
    }
    detailDialogVisible.value = false
    selectedCow.value = null
  }

  const getHealthStatusDotClass = (cow: any) => {
    switch (cow.status) {
      case '健康':
        return 'bg-green-500'
      case '异常':
        return 'bg-red-500'
      case '发情':
        return 'bg-yellow-500'
      default:
        return 'bg-gray-400'
    }
  }

  const getPregnancyStatusDotClass = (_cow?: any) => 'bg-gray-500'

  const getMixingStatusDotClass = (_cow?: any) => 'bg-gray-500'

  const createTempOption = (data: Array<{ time: string; value: number }>, detail = false) => ({
    tooltip: detail ? { trigger: 'axis' } : undefined,
    grid: {
      left: detail ? '8%' : '12%',
      right: '8%',
      top: detail ? '10%' : '12%',
      bottom: '15%'
    },
    xAxis: {
      type: 'category',
      show: true,
      data: data.map((d, i) => (i % (detail ? 4 : 6) === 0 ? d.time : '')),
      axisLabel: {
        fontSize: detail ? undefined : 8,
        interval: 0,
        rotate: 45
      },
      axisTick: {
        length: 2
      }
    },
    yAxis: {
      type: 'value',
      name: detail ? '体温(°C)' : undefined,
      show: true,
      min: 35,
      max: 42,
      axisLabel: {
        fontSize: detail ? undefined : 8
      },
      axisTick: {
        length: 2
      }
    },
    series: [
      {
        name: '体温',
        data: data.map((d) => d.value),
        type: 'line',
        smooth: true,
        lineStyle: {
          color: detail ? '#60c041' : '#ef4444',
          width: detail ? 2 : 1
        },
        areaStyle: {
          color: detail ? 'rgba(96, 192, 65, 0.2)' : 'rgba(239, 68, 68, 0.1)'
        },
        symbol: detail ? 'circle' : 'none',
        symbolSize: detail ? 6 : undefined
      }
    ]
  })

  const createStepOption = (data: Array<{ time: string; value: number }>, detail = false) => ({
    tooltip: detail ? { trigger: 'axis' } : undefined,
    grid: {
      left: detail ? '8%' : '12%',
      right: '8%',
      top: detail ? '10%' : '12%',
      bottom: '15%'
    },
    xAxis: {
      type: 'category',
      show: true,
      data: data.map((d, i) => (i % (detail ? 4 : 6) === 0 ? d.time : '')),
      axisLabel: {
        fontSize: detail ? undefined : 8,
        interval: 0,
        rotate: 45
      },
      axisTick: {
        length: 2
      }
    },
    yAxis: {
      type: 'value',
      name: detail ? '步数' : undefined,
      show: true,
      axisLabel: {
        fontSize: detail ? undefined : 8
      },
      axisTick: {
        length: 2
      }
    },
    series: [
      {
        name: '步数',
        data: data.map((d) => d.value),
        type: 'line',
        smooth: true,
        lineStyle: {
          color: '#60c041',
          width: detail ? 2 : 1
        },
        areaStyle: {
          color: detail ? 'rgba(96, 192, 65, 0.2)' : 'rgba(96, 192, 65, 0.1)'
        },
        symbol: detail ? 'circle' : 'none',
        symbolSize: detail ? 6 : undefined
      }
    ]
  })

  const makeTempData = (cowId: string) => getMetricSeries(cowId, 'temperature')

  const makeStepData = (cowId: string) => getMetricSeries(cowId, 'steps')

  const renderDetailCharts = (cow: CowBasic) => {
    const tempChartElement = document.getElementById(`detail-temp-chart-${cow.id}`)
    if (tempChartElement) {
      getOrCreateChart(tempChartElement, `detail-temp-${cow.id}`).setOption(
        createTempOption(makeTempData(cow.id), true),
        true
      )
    }

    const stepChartElement = document.getElementById(`detail-step-chart-${cow.id}`)
    if (stepChartElement) {
      getOrCreateChart(stepChartElement, `detail-step-${cow.id}`).setOption(
        createStepOption(makeStepData(cow.id), true),
        true
      )
    }
  }

  onMounted(() => {
    loadLeftCows()
  })

  onBeforeUnmount(() => {
    disposeAllCharts()
  })
  defineOptions({ name: 'LeftCows' })
</script>

<style scoped>
  .cow-card-lazy-scroll {
    max-height: min(72vh, 720px);
    overflow-y: auto;
    padding-right: 6px;
  }

  .custom-dialog .el-dialog__body {
    padding: 20px;
  }
</style>
