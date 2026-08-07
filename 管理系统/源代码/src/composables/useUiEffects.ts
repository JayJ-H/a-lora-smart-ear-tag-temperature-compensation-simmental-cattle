import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const STORAGE_KEY = 'nzh-ui-effects-enabled'
const isClient = typeof window !== 'undefined' && typeof document !== 'undefined'

const readInitialValue = () => {
  if (!isClient) return true
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === null ? true : stored === 'true'
}

const effectsEnabled = ref(readInitialValue())

const applyEffectsState = (enabled: boolean) => {
  if (!isClient) return
  document.documentElement.dataset.uiEffects = enabled ? 'on' : 'off'
  window.localStorage.setItem(STORAGE_KEY, String(enabled))
}

if (isClient) {
  applyEffectsState(effectsEnabled.value)
}

watch(effectsEnabled, applyEffectsState)

export function useUiEffects() {
  const { t } = useI18n()
  const effectsLabel = computed(() =>
    effectsEnabled.value ? t('system.effectsOn') : t('system.effectsOff')
  )
  const effectsIcon = computed(() =>
    effectsEnabled.value ? 'ri:sparkling-2-line' : 'ri:sparkling-line'
  )

  const toggleEffects = () => {
    effectsEnabled.value = !effectsEnabled.value
  }

  return {
    effectsEnabled,
    effectsLabel,
    effectsIcon,
    toggleEffects
  }
}
