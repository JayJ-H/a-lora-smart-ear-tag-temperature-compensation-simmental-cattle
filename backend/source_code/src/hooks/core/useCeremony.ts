/** Controls configured festival animations. */

import { useTimeoutFn, useIntervalFn, useDateFormat } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useSettingStore } from '@/store/modules/setting'
import { mittBus } from '@/utils/sys'
import { festivalConfigList } from '@/config/modules/festival'

const FESTIVAL_CONFIG = {
  /** Initial delay in milliseconds. */
  INITIAL_DELAY: 300,
  /** Firework interval in milliseconds. */
  FIREWORK_INTERVAL: 1000,
  /** Text delay in milliseconds. */
  TEXT_DELAY: 2000,
  /** Default number of fireworks. */
  DEFAULT_FIREWORKS_COUNT: 3
} as const

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

  /** Returns the festival configured for the current date. */
  const currentFestivalData = computed(() => {
    const currentDate = useDateFormat(new Date(), 'YYYY-MM-DD').value
    return festivalConfigList.find((item) => isDateInRange(currentDate, item.date, item.endDate))
  })

  const updateFestivalDate = () => {
    settingStore.setFestivalDate(currentFestivalData.value?.date || '')
  }

  const triggerFirework = () => {
    mittBus.emit('triggerFireworks', currentFestivalData.value?.image)
  }

  const showFestivalText = () => {
    settingStore.setholidayFireworksLoaded(true)

    useTimeoutFn(() => {
      settingStore.setShowFestivalText(true)
      updateFestivalDate()
    }, FESTIVAL_CONFIG.TEXT_DELAY)
  }

  const startFireworksLoop = () => {
    let playedCount = 0
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

  const openFestival = () => {
    if (!currentFestivalData.value || !isShowFireworks.value) {
      return
    }

    const { start } = useTimeoutFn(startFireworksLoop, FESTIVAL_CONFIG.INITIAL_DELAY)
    start()
  }

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
