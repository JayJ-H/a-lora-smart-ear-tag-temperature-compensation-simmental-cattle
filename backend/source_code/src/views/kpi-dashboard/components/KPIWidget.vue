<template>
  <div class="kpi-widget">
    <div class="widget-header">
      <div class="flex items-center justify-between">
        <h3 class="widget-title">{{ widget.title }}</h3>
        <div class="widget-actions">
          <ElButton size="small" type="text" @click="$emit('refresh')">
            <ArtSvgIcon icon="ri:refresh-line" />
          </ElButton>
        </div>
      </div>
    </div>

    <div class="widget-content">
      <!-- 指标组件 -->
      <div v-if="widget.type === 'metric' && data?.type === 'metric'">
        <div class="metric-content">
          <div class="metric-main">
            <div class="metric-value">
              <span class="value">{{ formatValue(data.data.currentValue) }}</span>
              <span class="unit">{{ data.data.metric.unit }}</span>
            </div>
            <div class="metric-trend">
              <ArtSvgIcon
                :icon="getTrendIcon(data.data.trend)"
                :class="`trend-icon ${data.data.trend}`"
              />
              <span class="trend-text">{{ getTrendText(data.data.trend) }}</span>
            </div>
          </div>

          <div class="metric-details">
            <div class="metric-target">
              <span class="label">目标值:</span>
              <span class="value">{{ formatValue(data.data.metric.targetValue) }}</span>
            </div>
            <div v-if="data.data.metric.warningThreshold" class="metric-warning">
              <span class="label">预警阈值:</span>
              <span class="value">{{ formatValue(data.data.metric.warningThreshold) }}</span>
            </div>
          </div>

          <div class="metric-status">
            <ElTag :type="getStatusType(data.data.status)">
              {{ getStatusText(data.data.status) }}
            </ElTag>
          </div>
        </div>
      </div>

      <!-- 图表组件 -->
      <div v-else-if="widget.type === 'chart' && data?.type === 'chart'">
        <div class="chart-content">
          <div ref="chartRef" class="chart-container"></div>
        </div>
      </div>

      <!-- 表格组件 -->
      <div v-else-if="widget.type === 'table' && data?.type === 'table'">
        <div class="table-content">
          <ElTable
            :data="visibleTableRows"
            size="small"
            style="width: 100%"
            @wheel.passive="onWidgetTableWheel"
          >
            <ElTableColumn
              v-for="column in widget.config.columns || ['name', 'value']"
              :key="column"
              :prop="column"
              :label="getTableColumnLabel(column)"
              :min-width="getTableColumnWidth(column)"
            >
              <template #default="{ row }">
                {{ formatTableCell(row, column) }}
              </template>
            </ElTableColumn>
          </ElTable>
          <div v-if="widgetTableRows.length > visibleTableRows.length" class="widget-load-more">
            <ElButton size="small" text @click="() => loadMoreWidgetRows()">
              加载更多 {{ visibleTableRows.length }}/{{ widgetTableRows.length }}
            </ElButton>
          </div>
        </div>
      </div>

      <!-- 文本组件 -->
      <div v-else-if="widget.type === 'text'">
        <div class="text-content" v-html="widget.config.content"></div>
      </div>

      <!-- 预警组件 -->
      <div v-else-if="widget.type === 'alert'">
        <div class="alert-content">
          <div class="alert-item">
            <ArtSvgIcon icon="ri:alarm-line" class="alert-icon warning" />
            <span class="alert-text">{{ data?.data?.alertsCount || 0 }} 个预警</span>
          </div>
        </div>
      </div>

      <!-- 加载状态 -->
      <div v-else-if="!data" class="loading-state">
        <ArtSvgIcon icon="ri:loader-4-line" class="loading-icon" />
        <span>加载中...</span>
      </div>
    </div>

    <div class="widget-footer">
      <div class="update-time">
        <ArtSvgIcon icon="ri:time-line" class="time-icon" />
        <span>更新时间: {{ formatTime(data?.lastUpdated) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch, nextTick, onMounted } from 'vue'
  import * as echarts from 'echarts'
  import type { DashboardWidget } from '@/types/cow'
  import { useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'

  // Props
  interface Props {
    widget: DashboardWidget
    data?: {
      type: string
      data: any
      lastUpdated: string
    }
  }

  const props = defineProps<Props>()

  // Emits
  defineEmits<{
    refresh: []
  }>()

  // Refs
  const chartRef = ref<HTMLElement>()
  const widgetTableRows = computed<Record<string, unknown>[]>(() =>
    Array.isArray(props.data?.data) ? props.data.data : []
  )
  const {
    visibleItems: visibleTableRows,
    loadMore: loadMoreWidgetRows,
    handleWheel: onWidgetTableWheel
  } = useLazyRenderWindow(widgetTableRows, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  // 图表实例
  let chartInstance: echarts.ECharts | null = null

  const getChartTokens = () => {
    const styles = getComputedStyle(document.documentElement)
    const primary = styles.getPropertyValue('--fluent-primary').trim() || '#60C041'
    const primaryRgb = styles.getPropertyValue('--fluent-primary-rgb').trim() || '96 192 65'
    const teal = styles.getPropertyValue('--fluent-teal').trim() || '#00A6A6'
    const amber = styles.getPropertyValue('--fluent-amber').trim() || '#F5A524'
    const rose = styles.getPropertyValue('--fluent-rose').trim() || '#D83B5D'
    const text = styles.getPropertyValue('--fluent-text-soft').trim() || '#5F6F89'
    const grid = `rgb(${primaryRgb} / 0.16)`

    return { primary, teal, amber, rose, text, grid }
  }

  // 格式化数值
  const formatValue = (value: number | undefined) => {
    if (value === undefined || value === null) return '--'

    if (value >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M'
    } else if (value >= 1000) {
      return (value / 1000).toFixed(1) + 'K'
    } else if (value % 1 !== 0) {
      return value.toFixed(2)
    } else {
      return value.toString()
    }
  }

  // 获取趋势图标
  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up':
        return 'ri:arrow-up-line'
      case 'down':
        return 'ri:arrow-down-line'
      default:
        return 'ri:minus-line'
    }
  }

  // 获取趋势文本
  const getTrendText = (trend: string) => {
    switch (trend) {
      case 'up':
        return '上升'
      case 'down':
        return '下降'
      default:
        return '稳定'
    }
  }

  // 获取状态类型
  type TagType = 'primary' | 'success' | 'warning' | 'info' | 'danger'

  const getStatusType = (status: string): TagType => {
    switch (status) {
      case 'critical':
        return 'danger'
      case 'warning':
        return 'warning'
      case 'normal':
        return 'success'
      default:
        return 'info'
    }
  }

  // 获取状态文本
  const getStatusText = (status: string) => {
    switch (status) {
      case 'critical':
        return '严重'
      case 'warning':
        return '预警'
      case 'normal':
        return '正常'
      default:
        return '未知'
    }
  }

  // 格式化时间
  const tableColumnLabels: Record<string, string> = {
    device: '设备',
    status: '状态',
    scheduledDate: '计划日期',
    date: '日期',
    name: '名称',
    value: '数值'
  }

  const tableStatusLabels: Record<string, string> = {
    scheduled: '待执行',
    completed: '已完成',
    in_progress: '执行中',
    overdue: '已逾期',
    cancelled: '已取消'
  }

  const getTableColumnLabel = (column: string) => tableColumnLabels[column] || column

  const getTableColumnWidth = (column: string) => {
    if (column === 'device') return 120
    if (column === 'scheduledDate') return 86
    return 72
  }

  const formatDateCell = (value: unknown) => {
    return formatDateOnly(value, '--')
  }

  const formatTableCell = (row: Record<string, unknown>, column: string) => {
    const value = row?.[column]
    if (column === 'status') return tableStatusLabels[String(value)] || String(value || '--')
    if (/date|time/i.test(column)) return formatDateCell(value)
    return value === undefined || value === null || value === '' ? '--' : String(value)
  }

  const formatTime = (timeString?: string) => {
    return formatDateOnly(timeString, '--')
  }

  // 初始化图表
  const initChart = () => {
    if (!chartRef.value || !props.data?.data?.data) return

    const reused = echarts.getInstanceByDom(chartRef.value)
    chartInstance = reused && !reused.isDisposed() ? reused : echarts.init(chartRef.value)

    const chartData = props.data.data.data
    const config = props.widget.config
    const chartTokens = getChartTokens()

    let option: any = {}

    switch (config.chartType) {
      case 'line':
        option = {
          tooltip: {
            trigger: 'axis'
          },
          xAxis: {
            type: 'category',
            data: chartData.map((item: any) => item.date),
            axisLine: { lineStyle: { color: chartTokens.grid } },
            axisLabel: { color: chartTokens.text }
          },
          yAxis: {
            type: 'value',
            axisLine: { lineStyle: { color: chartTokens.grid } },
            axisLabel: { color: chartTokens.text },
            splitLine: { lineStyle: { color: chartTokens.grid } }
          },
          series: [
            {
              data: chartData.map((item: any) => item.value),
              type: 'line',
              smooth: true,
              areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  {
                    offset: 0,
                    color: `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--fluent-primary-rgb').trim() || '96 192 65'} / 0.28)`
                  },
                  {
                    offset: 1,
                    color: `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--fluent-primary-rgb').trim() || '96 192 65'} / 0.04)`
                  }
                ])
              },
              itemStyle: { color: chartTokens.primary },
              lineStyle: { color: chartTokens.primary, width: 3 }
            }
          ]
        }
        break

      case 'bar':
        option = {
          tooltip: {
            trigger: 'axis'
          },
          xAxis: {
            type: 'category',
            data: chartData.map((item: any) => item.date || item.name),
            axisLine: { lineStyle: { color: chartTokens.grid } },
            axisLabel: { color: chartTokens.text }
          },
          yAxis: {
            type: 'value',
            axisLine: { lineStyle: { color: chartTokens.grid } },
            axisLabel: { color: chartTokens.text },
            splitLine: { lineStyle: { color: chartTokens.grid } }
          },
          series: [
            {
              data: chartData.map((item: any) => item.value),
              type: 'bar',
              itemStyle: {
                borderRadius: [6, 6, 0, 0],
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: chartTokens.teal },
                  { offset: 1, color: chartTokens.primary }
                ])
              }
            }
          ]
        }
        break

      case 'pie':
        option = {
          tooltip: {
            trigger: 'item',
            formatter: '{a} <br/>{b}: {c} ({d}%)'
          },
          series: [
            {
              type: 'pie',
              color: [chartTokens.primary, chartTokens.teal, chartTokens.amber, chartTokens.rose],
              data: chartData.map((item: any) => ({
                name: item.name,
                value: item.value
              })),
              emphasis: {
                itemStyle: {
                  shadowBlur: 10,
                  shadowOffsetX: 0,
                  shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
              }
            }
          ]
        }
        break
    }

    chartInstance.setOption(option)
  }

  // 销毁图表
  const destroyChart = () => {
    if (chartInstance) {
      chartInstance.dispose()
      chartInstance = null
    }
  }

  // 监听数据变化
  watch(
    () => props.data,
    () => {
      nextTick(() => {
        if (props.widget.type === 'chart') {
          destroyChart()
          initChart()
        }
      })
    },
    { deep: true }
  )

  // 生命周期
  onMounted(() => {
    if (props.widget.type === 'chart') {
      nextTick(() => {
        initChart()
      })
    }
  })
</script>

<style scoped lang="scss">
  .kpi-widget {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--fluent-surface);
    border: 1px solid var(--fluent-border);
    border-radius: 8px;
    box-shadow: none;
    overflow: hidden;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .widget-header {
    padding: 13px 14px;
    border-bottom: 1px solid var(--fluent-border);
    background: var(--fluent-surface-subtle);
  }

  .widget-title {
    font-size: 15px;
    font-weight: 650;
    color: var(--fluent-text);
    margin: 0;
  }

  .widget-actions {
    opacity: 0;
    transition: opacity 0.2s;
  }

  .kpi-widget:hover .widget-actions {
    opacity: 1;
  }

  .widget-content {
    flex: 1;
    padding: 14px;
    overflow: auto;
  }

  .metric-content {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .metric-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .metric-value {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }

  .metric-value .value {
    font-size: clamp(24px, 2.2vw, 30px);
    font-weight: 700;
    color: var(--fluent-text);
  }

  .metric-value .unit {
    font-size: 14px;
    color: var(--fluent-text-soft);
  }

  .metric-trend {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .trend-icon.up {
    color: var(--fluent-rose);
  }

  .trend-icon.down {
    color: var(--fluent-primary);
  }

  .trend-icon.stable {
    color: var(--fluent-muted);
  }

  .trend-text {
    font-size: 14px;
    color: var(--fluent-text-soft);
  }

  .metric-details {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .metric-target,
  .metric-warning {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .metric-target .label,
  .metric-warning .label {
    font-size: 14px;
    color: var(--fluent-text-soft);
  }

  .metric-target .value,
  .metric-warning .value {
    font-size: 14px;
    font-weight: 500;
    color: var(--fluent-text);
  }

  .metric-status {
    margin-top: auto;
  }

  .chart-content {
    height: 100%;
  }

  .chart-container {
    width: 100%;
    height: 200px;
  }

  .table-content {
    height: 100%;
    overflow: auto;
  }

  .table-content :deep(.el-table .cell) {
    line-height: 1.35;
    word-break: keep-all;
  }

  .widget-load-more {
    display: flex;
    justify-content: center;
    padding-top: 8px;
  }

  .text-content {
    line-height: 1.6;
    color: var(--fluent-text-soft);
  }

  .alert-content {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .alert-icon {
    font-size: 20px;
  }

  .alert-icon.warning {
    color: var(--fluent-amber);
  }

  .alert-text {
    font-size: 14px;
    color: var(--fluent-text-soft);
  }

  .loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--fluent-text-soft);
  }

  .loading-icon {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .widget-footer {
    padding: 10px 14px;
    border-top: 1px solid var(--fluent-border);
    background: var(--fluent-surface-subtle);
  }

  .update-time {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--fluent-text-soft);
  }

  .time-icon {
    font-size: 14px;
  }

  // 暗色主题
  .dark .kpi-widget {
    background: var(--fluent-surface);
    border: 1px solid var(--fluent-border);
  }

  .dark .widget-header {
    background: var(--fluent-surface-subtle);
    border-bottom-color: var(--fluent-border);
  }

  .dark .widget-title {
    color: var(--fluent-text);
  }

  .dark .metric-value .value {
    color: var(--fluent-text);
  }

  .dark .metric-value .unit {
    color: var(--fluent-text-soft);
  }

  .dark .trend-text {
    color: var(--fluent-text-soft);
  }

  .dark .metric-target .label,
  .dark .metric-warning .label,
  .dark .alert-text {
    color: var(--fluent-text-soft);
  }

  .dark .metric-target .value,
  .dark .metric-warning .value {
    color: var(--fluent-text);
  }

  .dark .text-content {
    color: var(--fluent-text-soft);
  }

  .dark .update-time {
    color: var(--fluent-text-soft);
  }

  .dark .widget-footer {
    background: var(--fluent-surface-subtle);
    border-top-color: var(--fluent-border);
  }
</style>
