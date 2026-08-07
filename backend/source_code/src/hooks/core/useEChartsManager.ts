import { onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'

type ChartDom = HTMLElement | null | undefined
type ChartInstance = echarts.ECharts
type ChartOption = Parameters<ChartInstance['setOption']>[0]
type ChartSetOptionOpts = Parameters<ChartInstance['setOption']>[1]

interface ChartEntry {
  dom: HTMLElement
  instance: ChartInstance
}

export function useEChartsManager() {
  const chartMap = new Map<string, ChartEntry>()

  const disposeChart = (key: string) => {
    const entry = chartMap.get(key)
    if (!entry) return
    if (!entry.instance.isDisposed()) {
      entry.instance.dispose()
    }
    chartMap.delete(key)
  }

  const disposeAllCharts = () => {
    chartMap.forEach((entry) => {
      if (!entry.instance.isDisposed()) {
        entry.instance.dispose()
      }
    })
    chartMap.clear()
  }

  const getOrCreateChart = (key: string, dom: ChartDom): ChartInstance | null => {
    if (!dom) return null

    const current = chartMap.get(key)
    if (current) {
      if (current.dom === dom && !current.instance.isDisposed()) {
        return current.instance
      }
      disposeChart(key)
    }

    const reusedInstance = echarts.getInstanceByDom(dom)
    if (reusedInstance) {
      chartMap.set(key, { dom, instance: reusedInstance })
      return reusedInstance
    }

    const instance = echarts.init(dom)
    chartMap.set(key, { dom, instance })
    return instance
  }

  const setChartOption = (
    key: string,
    dom: ChartDom,
    option: ChartOption,
    opts?: ChartSetOptionOpts
  ) => {
    const chart = getOrCreateChart(key, dom)
    if (!chart) return null
    chart.setOption(option, opts as any)
    return chart
  }

  const getChart = (key: string) => {
    const entry = chartMap.get(key)
    return entry?.instance ?? null
  }

  const resizeChart = (key: string) => {
    const chart = getChart(key)
    if (chart && !chart.isDisposed()) {
      chart.resize()
    }
  }

  const resizeAllCharts = () => {
    chartMap.forEach((entry) => {
      if (!entry.instance.isDisposed()) {
        entry.instance.resize()
      }
    })
  }

  onBeforeUnmount(() => {
    disposeAllCharts()
  })

  return {
    disposeChart,
    disposeAllCharts,
    getOrCreateChart,
    getChart,
    resizeChart,
    resizeAllCharts,
    setChartOption
  }
}
