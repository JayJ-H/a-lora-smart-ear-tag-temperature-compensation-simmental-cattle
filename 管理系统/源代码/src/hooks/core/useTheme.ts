/**
 * useTheme - 系统主题管理
 *
 * 提供完整的主题切换和管理功能，支持亮色、暗色和自动模式。
 * 自动处理主题切换时的过渡效果，确保切换流畅无闪烁。
 *
 * ## 主要功能
 *
 * 1. 主题切换 - 支持亮色、暗色、自动三种主题模式
 * 2. 自动模式 - 根据系统偏好自动切换主题
 * 3. 颜色适配 - 自动调整主题色的明暗变体（9 个层级）
 * 4. 过渡优化 - 切换时临时禁用过渡效果，避免闪烁
 * 5. 状态持久化 - 主题设置自动保存到 store
 *
 * ## 使用说明
 *
 * ```typescript
 * const { switchThemeStyles } = useTheme()
 *
 * // 切换到暗色主题
 * switchThemeStyles(SystemThemeEnum.DARK)
 *
 * // 切换到亮色主题
 * switchThemeStyles(SystemThemeEnum.LIGHT)
 *
 * // 切换到自动模式（跟随系统）
 * switchThemeStyles(SystemThemeEnum.AUTO)
 * ```
 *
 * @module useTheme
 * @author Art Design Pro Team
 */

import { useSettingStore } from '@/store/modules/setting'
import { SystemThemeEnum } from '@/enums/appEnum'
import AppConfig from '@/config'
import { SystemThemeTypes } from '@/types/store'
import { setElementThemeColor } from '@/utils/ui'
import { usePreferredDark } from '@vueuse/core'
import { watch } from 'vue'
import { StorageConfig } from '@/utils'

const BRAND_THEME_COLOR = AppConfig.systemMainColor[0]
const PREVIOUS_BLUE_THEME_COLORS = new Set([
  '#0078D4',
  '#0078d4',
  '#2563EB',
  '#2563eb',
  '#00A2ED',
  '#00a2ed'
])

function normalizeThemeColor(color: string): string {
  if (!color || PREVIOUS_BLUE_THEME_COLORS.has(color)) {
    return BRAND_THEME_COLOR
  }

  return (
    AppConfig.systemMainColor.find(
      (themeColor) => themeColor.toLowerCase() === color.toLowerCase()
    ) || BRAND_THEME_COLOR
  )
}

export function useTheme() {
  const settingStore = useSettingStore()

  // 禁用过渡效果
  const disableTransitions = () => {
    const style = document.createElement('style')
    style.setAttribute('id', 'disable-transitions')
    style.textContent = '* { transition: none !important; }'
    document.head.appendChild(style)
  }

  // 启用过渡效果
  const enableTransitions = () => {
    const style = document.getElementById('disable-transitions')
    if (style) {
      style.remove()
    }
  }

  // 设置系统主题
  const setSystemTheme = (theme: SystemThemeEnum, themeMode?: SystemThemeEnum) => {
    // 临时禁用过渡效果
    disableTransitions()

    const el = document.getElementsByTagName('html')[0]
    if (!themeMode) {
      themeMode = theme
    }

    const normalizedTheme = SystemThemeEnum.LIGHT
    const normalizedThemeMode = SystemThemeEnum.LIGHT
    const currentTheme = AppConfig.systemThemeStyles[normalizedTheme as keyof SystemThemeTypes]

    if (currentTheme) {
      el.setAttribute('class', currentTheme.className)
    }

    // 设置按钮颜色加深或变浅
    const primary = normalizeThemeColor(settingStore.systemThemeColor)
    if (primary !== settingStore.systemThemeColor) {
      settingStore.systemThemeColor = primary
    }

    setElementThemeColor(primary)

    // 更新store中的主题设置
    settingStore.setGlopTheme(normalizedTheme, normalizedThemeMode)
    localStorage.setItem(StorageConfig.THEME_KEY, SystemThemeEnum.LIGHT)

    // 使用 requestAnimationFrame 确保在下一帧恢复过渡效果
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        enableTransitions()
      })
    })
  }

  // 使用 VueUse 的 usePreferredDark 检测系统主题偏好
  const prefersDark = usePreferredDark()

  // 自动设置系统主题
  const setSystemAutoTheme = () => {
    setSystemTheme(SystemThemeEnum.LIGHT, SystemThemeEnum.LIGHT)
  }

  // 切换主题
  const switchThemeStyles = (_theme: SystemThemeEnum) => {
    setSystemTheme(SystemThemeEnum.LIGHT, SystemThemeEnum.LIGHT)
  }

  return {
    setSystemTheme,
    setSystemAutoTheme,
    switchThemeStyles,
    prefersDark
  }
}

/**
 * 初始化主题系统
 */
export function initializeTheme() {
  const settingStore = useSettingStore()
  const prefersDark = usePreferredDark()

  // 根据系统偏好应用主题
  const applyThemeByMode = () => {
    const el = document.getElementsByTagName('html')[0]
    const actualTheme = SystemThemeEnum.LIGHT
    settingStore.systemThemeType = SystemThemeEnum.LIGHT
    settingStore.systemThemeMode = SystemThemeEnum.LIGHT
    localStorage.setItem(StorageConfig.THEME_KEY, SystemThemeEnum.LIGHT)

    // 设置主题 class
    const currentTheme = AppConfig.systemThemeStyles[actualTheme as keyof SystemThemeTypes]
    if (currentTheme) {
      el.setAttribute('class', currentTheme.className)
    }

    // 设置主题颜色
    const themeColor = normalizeThemeColor(settingStore.systemThemeColor)
    if (themeColor !== settingStore.systemThemeColor) {
      settingStore.systemThemeColor = themeColor
    }
    setElementThemeColor(themeColor)

    // 设置圆角
    document.documentElement.style.setProperty('--custom-radius', `${settingStore.customRadius}rem`)
  }

  // 应用主题
  applyThemeByMode()

  watch(prefersDark, () => {
    applyThemeByMode()
  })
}
