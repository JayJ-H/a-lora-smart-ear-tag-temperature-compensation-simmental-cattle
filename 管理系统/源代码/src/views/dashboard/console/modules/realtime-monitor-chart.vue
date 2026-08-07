<template>
  <div class="realtime-monitor">
    <div class="monitor-grid">
      <div class="monitor-item" v-for="item in monitorData" :key="item.id">
        <div class="item-header">
          <div class="item-icon" :class="item.status">
            <ArtSvgIcon :icon="item.icon" />
          </div>
          <div class="item-info">
            <div class="item-name">{{ item.name }}</div>
            <div class="item-value">{{ item.value }}</div>
          </div>
        </div>
        <div class="item-chart">
          <div class="mini-chart" :ref="(el) => setChartRef(el, item.id)"></div>
        </div>
        <div class="item-status">
          <span class="status-dot" :class="item.status"></span>
          <span class="status-text">{{ item.statusText }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, onMounted, onUnmounted } from 'vue'
  import type { ComponentPublicInstance } from 'vue'
  import * as echarts from 'echarts'
  import { useEChartsManager } from '@/hooks'
  import { loadUnifiedSensorData } from '@/views/breeding-platform/platform-data'

  const chartRefs = ref<Record<string, HTMLDivElement>>({})
  const chartInstances = ref<Record<string, echarts.ECharts>>({})
  const { getOrCreateChart, disposeChart, disposeAllCharts, resizeAllCharts } = useEChartsManager()

  interface MonitorItem {
    id: 'temperature' | 'activity' | 'feeding' | 'rumination'
    name: string
    icon: string
    value: string
    status: 'normal' | 'warning' | 'error'
    statusText: string
    data: number[]
  }

  const setChartRef = (el: Element | ComponentPublicInstance | null, id: string) => {
    if (el instanceof HTMLDivElement) {
      chartRefs.value[id] = el
      initMiniChart(id)
      return
    }
    delete chartRefs.value[id]
    delete chartInstances.value[id]
    disposeChart(`mini-chart-${id}`)
  }

  const monitorData = reactive<MonitorItem[]>([
    {
      id: 'temperature',
      name: '体温传感器',
      icon: 'ri:temp-hot-line',
      value: '--',
      status: 'normal',
      statusText: '正常',
      data: []
    },
    {
      id: 'activity',
      name: '活动监测',
      icon: 'ri:run-line',
      value: '--',
      status: 'normal',
      statusText: '活跃',
      data: []
    },
    {
      id: 'feeding',
      name: '采食监测',
      icon: 'ri:restaurant-line',
      value: '--',
      status: 'warning',
      statusText: '偏低',
      data: []
    },
    {
      id: 'rumination',
      name: '反刍监测',
      icon: 'ri:refresh-line',
      value: '--',
      status: 'normal',
      statusText: '良好',
      data: []
    }
  ])

  const initMiniChart = (id: string) => {
    const el = chartRefs.value[id]
    if (!el) return

    const item = monitorData.find((d) => d.id === id)
    if (!item) return

    const instance = getOrCreateChart(`mini-chart-${id}`, el)
    if (!instance) return
    chartInstances.value[id] = instance

    const option = {
      backgroundColor: 'transparent',
      grid: {
        left: '5%',
        right: '5%',
        top: '10%',
        bottom: '10%'
      },
      xAxis: {
        type: 'category',
        show: false,
        data: Array.from({ length: 10 }, (_, i) => i + 1)
      },
      yAxis: {
        type: 'value',
        show: false
      },
      series: [
        {
          data: item.data,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: {
            color: getStatusColor(item.status),
            width: 2
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: getStatusColor(item.status) + '40' },
              { offset: 1, color: getStatusColor(item.status) + '10' }
            ])
          }
        }
      ]
    }

    instance.setOption(option)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'normal':
        return '#60C041'
      case 'warning':
        return '#F5A524'
      case 'error':
        return '#D83B5D'
      default:
        return '#60C041'
    }
  }

  const getSensorTimestamp = (row: any) => {
    const timestamp = new Date(
      row?.timestamp ??
        row?.ts ??
        row?.createdAt ??
        row?.created_at ??
        row?.updatedAt ??
        row?.updated_at ??
        ''
    ).getTime()
    return Number.isFinite(timestamp) ? timestamp : 0
  }

  const getMetricValue = (row: any, id: MonitorItem['id']) => {
    const value =
      id === 'temperature'
        ? row?.temperature
        : id === 'activity'
          ? row?.steps
          : id === 'feeding'
            ? (row?.feeding?.feedingEfficiency ?? row?.feeding_efficiency)
            : (row?.rumination?.count ?? row?.rumination_count)
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : null
  }

  const formatMonitorValue = (id: MonitorItem['id'], value: number | null) => {
    if (value === null) return '--'
    if (id === 'temperature') return `${value.toFixed(1)}°C`
    if (id === 'activity') return `${Math.round(value)}步`
    if (id === 'feeding') return `${Math.round(value)}%`
    return `${Math.round(value)}次`
  }

  const resolveMonitorStatus = (
    id: MonitorItem['id'],
    value: number | null
  ): Pick<MonitorItem, 'status' | 'statusText'> => {
    if (value === null) return { status: 'warning', statusText: '暂无数据' }
    if (id === 'temperature' && (value < 37 || value > 39.5))
      return { status: 'warning', statusText: '需关注' }
    if (id === 'feeding' && value < 60) return { status: 'warning', statusText: '偏低' }
    return { status: 'normal', statusText: '正常' }
  }

  const refreshMonitorData = async () => {
    const rows = await loadUnifiedSensorData()
    const latestRows = [...rows]
      .sort((a, b) => getSensorTimestamp(a) - getSensorTimestamp(b))
      .slice(-10)

    monitorData.forEach((item) => {
      const series = latestRows
        .map((row) => getMetricValue(row, item.id))
        .filter((value): value is number => value !== null)
      const latestValue = series.length > 0 ? series[series.length - 1] : null
      const status = resolveMonitorStatus(item.id, latestValue)

      item.data = series
      item.value = formatMonitorValue(item.id, latestValue)
      item.status = status.status
      item.statusText = status.statusText

      const instance = chartInstances.value[item.id]
      if (instance) {
        instance.setOption(
          {
            series: [{ data: [...item.data] }]
          },
          true
        )
      }
    })
  }

  const updateData = () => {
    refreshMonitorData().catch((error) => {
      console.error('刷新实时监控数据失败:', error)
    })
  }

  let updateInterval: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    updateData()
    updateInterval = setInterval(updateData, 3000)
    window.addEventListener('resize', resizeAllCharts)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', resizeAllCharts)
    disposeAllCharts()
    if (updateInterval !== null) {
      clearInterval(updateInterval)
      updateInterval = null
    }
  })
</script>

<style scoped lang="scss">
  .realtime-monitor {
    height: calc(100% - 40px);
    padding: 14px;
  }

  .monitor-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    height: 100%;
  }

  .monitor-item {
    position: relative;
    overflow: hidden;
    background: #fff;
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    padding: 16px;
    box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
    transition:
      background-color 160ms ease,
      border-color 160ms ease,
      box-shadow 160ms ease;

    &:hover {
      background: rgb(248 250 252);
      border-color: var(--fluent-border-strong);
      box-shadow: inset 0 0 0 1px rgb(var(--fluent-primary-rgb) / 9%);
    }
  }

  .item-header {
    display: flex;
    align-items: center;
    margin-bottom: 12px;
  }

  .item-icon {
    width: 40px;
    height: 40px;
    border-radius: var(--fluent-radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 12px;
    font-size: 18px;

    &.normal {
      background:
        linear-gradient(180deg, rgb(255 255 255 / 22%), rgb(255 255 255 / 0%)),
        linear-gradient(135deg, #60c041, #3f8a2a);
      color: white;
    }

    &.warning {
      background:
        linear-gradient(180deg, rgb(255 255 255 / 22%), rgb(255 255 255 / 0%)),
        linear-gradient(135deg, #f5a524, #ff8c00);
      color: white;
    }

    &.error {
      background:
        linear-gradient(180deg, rgb(255 255 255 / 22%), rgb(255 255 255 / 0%)),
        linear-gradient(135deg, #d83b5d, #d13438);
      color: white;
    }
  }

  .item-info {
    flex: 1;
  }

  .item-name {
    font-size: 14px;
    color: var(--fluent-text-soft);
    margin-bottom: 4px;
  }

  .item-value {
    font-size: 18px;
    font-weight: bold;
    color: var(--fluent-text);
  }

  .item-chart {
    height: 60px;
    margin-bottom: 8px;
  }

  .mini-chart {
    width: 100%;
    height: 100%;
  }

  .item-status {
    display: flex;
    align-items: center;
    font-size: 12px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;

    &.normal {
      background: #60c041;
    }

    &.warning {
      background: #f5a524;
    }

    &.error {
      background: #d83b5d;
    }
  }

  .status-text {
    color: var(--fluent-text-soft);
  }

  @media (max-width: 768px) {
    .monitor-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
