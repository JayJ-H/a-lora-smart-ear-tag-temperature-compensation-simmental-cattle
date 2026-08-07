<template>
  <div class="multi-dimension-chart">
    <div class="chart-header mb-4">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ title }}</h3>
      <div class="flex items-center gap-2">
        <ElSelect v-model="selectedMetrics" multiple placeholder="选择指标" style="width: 200px" size="small">
          <ElOption
            v-for="metric in availableMetrics"
            :key="metric.key"
            :label="metric.label"
            :value="metric.key"
          />
        </ElSelect>
        <ElButton type="primary" size="small" @click="renderChart" :loading="loading">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />
          更新图表
        </ElButton>
      </div>
    </div>

    <div class="chart-container">
      <div :id="chartId" :style="{ width: '100%', height: height + 'px' }"></div>
    </div>

    <!-- 图表控制面板 -->
    <div class="chart-controls">
      <div class="chart-control-grid">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">时间范围</label>
          <ElSelect v-model="timeRange" size="small" @change="handleTimeRangeChange">
            <ElOption label="最近1小时" value="1h" />
            <ElOption label="最近6小时" value="6h" />
            <ElOption label="最近24小时" value="24h" />
            <ElOption label="最近7天" value="7d" />
            <ElOption label="最近30天" value="30d" />
          </ElSelect>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">图表类型</label>
          <ElSelect v-model="chartType" size="small" @change="renderChart">
            <ElOption label="折线图" value="line" />
            <ElOption label="面积图" value="area" />
            <ElOption label="柱状图" value="bar" />
            <ElOption label="散点图" value="scatter" />
          </ElSelect>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">聚合方式</label>
          <ElSelect v-model="aggregation" size="small" @change="renderChart">
            <ElOption label="平均值" value="avg" />
            <ElOption label="最大值" value="max" />
            <ElOption label="最小值" value="min" />
            <ElOption label="总和" value="sum" />
          </ElSelect>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">显示选项</label>
          <ElCheckbox v-model="showLegend" @change="renderChart" class="mr-2">图例</ElCheckbox>
          <ElCheckbox v-model="showDataLabels" @change="renderChart">数据标签</ElCheckbox>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import type { ExtendedSensorData } from '@/types'
import { sensorApi } from '@/api/cow'
import * as echarts from 'echarts'
import { formatDateOnly } from '@/utils/date-display'

// Props
interface Props {
  title?: string
  cowIds?: string[]
  height?: number
  initialMetrics?: string[]
}

const props = withDefaults(defineProps<Props>(), {
  title: '多维度传感器数据图表',
  cowIds: () => [],
  height: 400,
  initialMetrics: () => ['temperature']
})

// 响应式数据
const loading = ref(false)
const selectedMetrics = ref<string[]>(props.initialMetrics)
const timeRange = ref('24h')
const chartType = ref<'line' | 'area' | 'bar' | 'scatter'>('line')
const aggregation = ref<'avg' | 'max' | 'min' | 'sum'>('avg')
const showLegend = ref(true)
const showDataLabels = ref(false)
const chartData = ref<ExtendedSensorData[]>([])

// 图表实例
let chartInstance: echarts.ECharts | null = null

// 生成唯一的图表ID
const chartId = `multi-dimension-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

// 可用的指标配置
const availableMetrics = [
  { key: 'temperature', label: '体温(°C)', color: '#d83b5d', unit: '°C' },
  { key: 'rumination.count', label: '反刍次数', color: '#00a6a6', unit: '次' },
  { key: 'rumination.duration', label: '反刍时长(分)', color: '#3f8a2a', unit: '分' },
  { key: 'rumination.efficiency', label: '反刍效率(%)', color: '#60c041', unit: '%' },
  { key: 'activity.lyingTime', label: '躺卧时间(分)', color: '#f59e0b', unit: '分' },
  { key: 'activity.standingTime', label: '站立时间(分)', color: '#f5a524', unit: '分' },
  { key: 'activity.walkingDistance', label: '步行距离(米)', color: '#00a6a6', unit: '米' },
  { key: 'activity.activeTime', label: '活跃时间(分)', color: '#60c041', unit: '分' },
  { key: 'feeding.eatingTime', label: '采食时间(分)', color: '#10b981', unit: '分' },
  { key: 'feeding.estimatedIntake', label: '估算采食量(kg)', color: '#059669', unit: 'kg' },
  { key: 'feeding.feedingEfficiency', label: '采食效率(%)', color: '#047857', unit: '%' },
  { key: 'vitalSigns.respiratoryRate', label: '呼吸频率(次/分)', color: '#d83b5d', unit: '次/分' },
  { key: 'vitalSigns.heartRate', label: '心率(次/分)', color: '#d13438', unit: '次/分' },
  { key: 'vitalSigns.bodyScore', label: '体况评分', color: '#f5a524', unit: '分' },
  { key: 'environment.ambientTemp', label: '环境温度(°C)', color: '#6b7280', unit: '°C' },
  { key: 'environment.humidity', label: '湿度(%)', color: '#4b5563', unit: '%' },
  { key: 'environment.ammonia', label: '氨气浓度(ppm)', color: '#374151', unit: 'ppm' }
]

// 获取指标配置
const getMetricConfig = (key: string) => {
  return availableMetrics.find(m => m.key === key)
}

// 获取嵌套对象的值
const getNestedValue = (obj: any, path: string): number => {
  return path.split('.').reduce((current, key) => current?.[key], obj) || 0
}

// 加载数据
const loadData = async () => {
  if (props.cowIds.length === 0) return

  loading.value = true
  try {
    const promises = props.cowIds.map(async (cowId) => {
      const endTime = new Date().toISOString()
      const startTime = getStartTime(timeRange.value)

      const res = await sensorApi.getExtendedSensorData({
        cowId,
        startTime,
        endTime,
        page: 1,
        pageSize: 100 // 获取足够的数据点
      })

      if (res.code === 200) {
        return res.data.map(item => ({ ...item, cowId }))
      }
      return []
    })

    const results = await Promise.all(promises)
    chartData.value = results.flat()
  } catch (error) {
    console.error('加载图表数据失败:', error)
  } finally {
    loading.value = false
  }
}

// 获取开始时间
const getStartTime = (range: string): string => {
  const now = new Date()
  switch (range) {
    case '1h': now.setHours(now.getHours() - 1); break
    case '6h': now.setHours(now.getHours() - 6); break
    case '24h': now.setHours(now.getHours() - 24); break
    case '7d': now.setDate(now.getDate() - 7); break
    case '30d': now.setDate(now.getDate() - 30); break
  }
  return now.toISOString()
}

// 时间范围变化处理
const handleTimeRangeChange = () => {
  loadData().then(() => {
    renderChart()
  })
}

// 渲染图表
const renderChart = () => {
  if (!chartData.value.length || !selectedMetrics.value.length) return

  const element = document.getElementById(chartId)
  if (!element) return

  if (!chartInstance || chartInstance.isDisposed() || chartInstance.getDom() !== element) {
    if (chartInstance && !chartInstance.isDisposed()) {
      chartInstance.dispose()
    }
    const reused = echarts.getInstanceByDom(element)
    chartInstance = reused && !reused.isDisposed() ? reused : echarts.init(element)
  }

  // 按时间分组数据
  const timeGroups: Record<string, ExtendedSensorData[]> = {}
  chartData.value.forEach(item => {
    const timeKey = formatDateOnly(item.timestamp, '-')
    if (!timeGroups[timeKey]) {
      timeGroups[timeKey] = []
    }
    timeGroups[timeKey].push(item)
  })

  // 生成图表配置
  const xAxisData = Object.keys(timeGroups).sort()
  const series: any[] = []

  selectedMetrics.value.forEach(metricKey => {
    const metricConfig = getMetricConfig(metricKey)
    if (!metricConfig) return

    const seriesData = xAxisData.map(timeKey => {
      const items = timeGroups[timeKey]
      if (!items || items.length === 0) return 0

      // 根据聚合方式计算值
      let values: number[] = []
      items.forEach(item => {
        const value = getNestedValue(item, metricKey)
        if (typeof value === 'number' && !isNaN(value)) {
          values.push(value)
        }
      })

      if (values.length === 0) return 0

      switch (aggregation.value) {
        case 'max': return Math.max(...values)
        case 'min': return Math.min(...values)
        case 'sum': return values.reduce((a, b) => a + b, 0)
        case 'avg':
        default: return values.reduce((a, b) => a + b, 0) / values.length
      }
    })

    const seriesConfig: any = {
      name: metricConfig.label,
      type: chartType.value === 'area' ? 'line' : chartType.value,
      data: seriesData,
      itemStyle: { color: metricConfig.color },
      lineStyle: { color: metricConfig.color, width: 2 },
      symbol: 'circle',
      symbolSize: 6,
      smooth: true
    }

    // 面积图特殊配置
    if (chartType.value === 'area') {
      seriesConfig.areaStyle = {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: metricConfig.color + '40' },
            { offset: 1, color: metricConfig.color + '10' }
          ]
        }
      }
    }

    // 数据标签
    if (showDataLabels.value) {
      seriesConfig.label = {
        show: true,
        position: 'top',
        formatter: (params: any) => `${params.value.toFixed(1)}${metricConfig.unit}`
      }
    }

    series.push(seriesConfig)
  })

  const option = {
    color: series.map((item) => item.itemStyle.color),
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross'
      },
      formatter: (params: any[]) => {
        let result = `${params[0].name}<br/>`
        params.forEach(param => {
          const metricConfig = getMetricConfig(selectedMetrics.value[series.findIndex(s => s.name === param.seriesName)])
          result += `${param.marker}${param.seriesName}: ${param.value.toFixed(1)}${metricConfig?.unit || ''}<br/>`
        })
        return result
      }
    },
    legend: {
      show: showLegend.value,
      data: series.map(s => s.name),
      top: 10,
      textStyle: {
        color: getComputedStyle(document.documentElement).getPropertyValue('--fluent-text-soft').trim() || '#5f6f89'
      }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '10%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: xAxisData,
      axisLine: { lineStyle: { color: 'rgba(96, 192, 65, 0.24)' } },
      axisTick: { show: false },
      axisLabel: {
        rotate: xAxisData.length > 12 ? 45 : 0
      }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(96, 192, 65, 0.12)' } },
      axisLabel: {
        formatter: (value: number) => value.toFixed(1)
      }
    },
    series
  }

  chartInstance.setOption(option, true)
}

// 监听数据变化
watch(() => props.cowIds, () => {
  loadData().then(() => {
    renderChart()
  })
}, { immediate: true })

// 清理图表实例
onUnmounted(() => {
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
})
</script>

<style scoped>
.multi-dimension-chart {
  padding: 1.5rem;
  background:
    linear-gradient(180deg, var(--fluent-highlight), rgb(255 255 255 / 0%)),
    radial-gradient(circle at 100% 0, rgb(var(--fluent-primary-rgb) / 10%), transparent 32%),
    var(--fluent-surface);
  border: 1px solid var(--fluent-border);
  border-radius: var(--fluent-radius);
  box-shadow:
    var(--fluent-inset-highlight),
    var(--fluent-shadow);
  backdrop-filter: var(--fluent-blur);
  -webkit-backdrop-filter: var(--fluent-blur);
}

.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--fluent-border);
}

.chart-header h3 {
  color: var(--fluent-text) !important;
  letter-spacing: 0;
}

.chart-controls {
  margin-top: 1rem;
  padding: 0.85rem;
  background: var(--fluent-surface-subtle);
  border: 1px solid var(--fluent-border);
  border-radius: var(--fluent-radius);
  box-shadow: var(--fluent-inset-highlight);
}

.chart-controls label {
  color: var(--fluent-text-soft) !important;
}

.chart-container {
  padding-top: 12px;
}

@media (max-width: 720px) {
  .chart-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
