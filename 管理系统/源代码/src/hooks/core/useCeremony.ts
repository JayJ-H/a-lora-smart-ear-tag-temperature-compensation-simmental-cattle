/** 节日动画控制。 */

import { useTimeoutFn, useIntervalFn, useDateFormat } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useSettingStore } from '@/store/modules/setting'
import { mittBus } from '@/utils/sys'
import { festivalConfigList } from '@/config/modules/festival'

/**
 * 节日庆祝配置常量
 */
const FESTIVAL_CONFIG = {
  /** 初始延迟（毫秒） */
  INITIAL_DELAY: 300,
  /** 烟花播放间隔（毫秒） */
  FIREWORK_INTERVAL: 1000,
  /** 文本显示延迟（毫秒） */
  TEXT_DELAY: 2000,
  /** 默认烟花播放次数 */
  DEFAULT_FIREWORKS_COUNT: 3
} as const

/**
 * 节日庆祝功能
 * 提供节日烟花效果和祝福文本展示
 */
export function useCeremony() {
  const settingStore = useSettingStore()
  const { holidayFireworksLoaded, isShowFireworks } = storeToRefs(settingStore)

  let fireworksInterval: { pause: () => void } | null = null

  const isDateInRange = (
    currentDate: string,
    festivalDate: string,
    festivalEndDate?: string
  ): boolean => {
    if (!festivalEndDate) {
      return currentDate === festivalDate
    }

    const current = new Date(currentDate)
    const start = new Date(festivalDate)
    const end = new Date(festivalEndDate)

    return current >= start && current <= end
  }

  /**
   * 获取当前日期对应的节日数据
   */
  const currentFestivalData = computed(() => {
    const currentDate = useDateFormat(new Date(), 'YYYY-MM-DD').value
    return festivalConfigList.find((item) => isDateInRange(currentDate, item.date, item.endDate))
  })

  /**
   * 更新节日日期到 store
   */
  const updateFestivalDate = () => {
    settingStore.setFestivalDate(currentFestivalData.value?.date || '')
  }

  /**
   * 触发烟花效果
   */
  const triggerFirework = () => {
    mittBus.emit('triggerFireworks', currentFestivalData.value?.image)
  }

  /**
   * 完成烟花效果后显示文本
   */
  const showFestivalText = () => {
    settingStore.setholidayFireworksLoaded(true)

    useTimeoutFn(() => {
      settingStore.setShowFestivalText(true)
      updateFestivalDate()
    }, FESTIVAL_CONFIG.TEXT_DELAY)
  }

  /**
   * 启动烟花循环
   */
  const startFireworksLoop = () => {
    let playedCount = 0
    // 使用节日配置的播放次数，如果没有则使用默认值
    const count = currentFestivalData.value?.count ?? FESTIVAL_CONFIG.DEFAULT_FIREWORKS_COUNT

    const { pause } = useIntervalFn(() => {
      triggerFirework()
      playedCount++

      if (playedCount >= count) {
        pause()
        showFestivalText()
      }
    }, FESTIVAL_CONFIG.FIREWORK_INTERVAL)

    fireworksInterval = { pause }
  }

  /**
   * 开启节日庆祝
   */
  const openFestival = () => {
    if (!currentFestivalData.value || !isShowFireworks.value) {
      return
    }

    const { start } = useTimeoutFn(startFireworksLoop, FESTIVAL_CONFIG.INITIAL_DELAY)
    start()
  }

  /**
   * 清理烟花效果
   */
  const cleanup = () => {
    if (fireworksInterval) {
      fireworksInterval.pause()
      fireworksInterval = null
    }
    settingStore.setShowFestivalText(false)
    updateFestivalDate()
  }

  return {
    openFestival,
    cleanup,
    holidayFireworksLoaded,
    currentFestivalData,
    isShowFireworks
  }
}
