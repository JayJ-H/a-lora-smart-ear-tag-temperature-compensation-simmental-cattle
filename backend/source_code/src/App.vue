<template>
  <ElConfigProvider size="default" :locale="locales[language]" :z-index="3000">
    <RouterView v-slot="{ Component, route }">
      <Suspense>
        <template #default>
          <component :is="Component" :key="route.fullPath" />
        </template>
        <template #fallback>
          <main class="app-route-loading">
            <span>{{ t('system.loading') }}</span>
            <strong>{{
              route.meta?.title ? t(String(route.meta.title)) : t('system.name')
            }}</strong>
            <p>{{ t('system.connecting') }}</p>
          </main>
        </template>
      </Suspense>
    </RouterView>
    <main v-if="fallbackVisible" class="app-route-standby">
      <span>{{ t('system.loading') }}</span>
      <strong>{{ route.name || t('system.name') }}</strong>
      <p>{{ t('system.preparing') }}</p>
    </main>
    <div v-show="effectsEnabled" class="cursor-highlight" aria-hidden="true"></div>
  </ElConfigProvider>
</template>

<script setup lang="ts">
  import { useUserStore } from './store/modules/user'
  import zh from 'element-plus/es/locale/lang/zh-cn'
  import en from 'element-plus/es/locale/lang/en'
  import { systemUpgrade } from './utils/sys'
  import { toggleTransition } from './utils/ui/animation'
  import { checkStorageCompatibility } from './utils/storage'
  import { initializeTheme } from './hooks/core/useTheme'
  import { useUiEffects } from './composables/useUiEffects'
  import { useRoute } from 'vue-router'
  import { useI18n } from 'vue-i18n'

  const userStore = useUserStore()
  const { language } = storeToRefs(userStore)
  const route = useRoute()
  const { effectsEnabled } = useUiEffects()
  const fallbackVisible = ref(true)
  const { t } = useI18n()

  const locales = {
    zh: zh,
    en: en
  }

  let highlightFrame = 0
  let standbyTimer: number | undefined

  const hasRenderedRouteContent = () => {
    const app = document.querySelector('#app')
    if (!app) return false
    const content = app.querySelector(
      '.app-layout, .auth-right-wrap, .account-page, .art-page-view, .route-loading-card, .app-route-loading'
    )
    return Boolean(content?.textContent?.replace(/\s+/g, '').trim())
  }

  const scheduleRouteReadinessCheck = () => {
    fallbackVisible.value = true
    if (standbyTimer) window.clearTimeout(standbyTimer)
    const startedAt = Date.now()
    const check = () => {
      if (hasRenderedRouteContent()) {
        fallbackVisible.value = false
        return
      }
      if (Date.now() - startedAt < 15000) {
        standbyTimer = window.setTimeout(check, 80)
        return
      }
      fallbackVisible.value = false
    }
    nextTick(() => {
      standbyTimer = window.setTimeout(check, 40)
    })
  }

  const hideCursorHighlight = () => {
    document.documentElement.style.setProperty('--cursor-highlight-opacity', '0')
    document.documentElement.classList.remove('cursor-highlight-active')
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (!effectsEnabled.value || event.pointerType === 'touch') {
      hideCursorHighlight()
      return
    }

    if (highlightFrame) cancelAnimationFrame(highlightFrame)
    highlightFrame = requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--cursor-highlight-x', `${event.clientX}px`)
      document.documentElement.style.setProperty('--cursor-highlight-y', `${event.clientY}px`)
      document.documentElement.style.setProperty('--cursor-highlight-opacity', '1')
      document.documentElement.classList.add('cursor-highlight-active')
      highlightFrame = 0
    })
  }

  onBeforeMount(() => {
    toggleTransition(true)
    initializeTheme()
  })

  onMounted(() => {
    checkStorageCompatibility()
    toggleTransition(false)
    systemUpgrade()
    scheduleRouteReadinessCheck()
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('pointerleave', hideCursorHighlight)
    window.addEventListener('blur', hideCursorHighlight)
  })

  watch(() => route.fullPath, scheduleRouteReadinessCheck, { flush: 'post' })
  watch(effectsEnabled, (enabled) => {
    if (!enabled) hideCursorHighlight()
  })

  onBeforeUnmount(() => {
    if (highlightFrame) cancelAnimationFrame(highlightFrame)
    if (standbyTimer) window.clearTimeout(standbyTimer)
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerleave', hideCursorHighlight)
    window.removeEventListener('blur', hideCursorHighlight)
  })
</script>

<style scoped>
  .cursor-highlight {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2999;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    background: radial-gradient(
      circle 190px at var(--cursor-highlight-x, -400px) var(--cursor-highlight-y, -400px),
      rgb(74 180 112 / 16%),
      rgb(214 154 68 / 8%) 34%,
      transparent 72%
    );
    opacity: var(--cursor-highlight-opacity, 0);
    transition: opacity 0.18s ease;
  }

  .app-route-loading {
    display: grid;
    gap: 8px;
    place-content: center;
    min-height: 100vh;
    padding: 32px;
    color: #1f2937;
    text-align: center;
    background:
      radial-gradient(circle at 18% 16%, rgb(74 180 112 / 16%), transparent 28%),
      linear-gradient(135deg, #f8fcf8, #fff 46%, #eef8ef);
  }

  .app-route-standby {
    position: fixed;
    inset: 0;
    z-index: 2500;
    display: grid;
    gap: 8px;
    place-content: center;
    padding: 32px;
    color: #1f2937;
    text-align: center;
    background:
      radial-gradient(circle at 20% 16%, rgb(74 180 112 / 18%), transparent 30%),
      linear-gradient(135deg, #f8fcf8, #fff 48%, #eef8ef);
  }

  .app-route-standby span {
    font-size: 13px;
    font-weight: 720;
    color: #64748b;
  }

  .app-route-standby strong {
    font-size: 24px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .app-route-standby p {
    margin: 0;
    font-size: 13px;
    color: #64748b;
  }

  .app-route-loading span {
    font-size: 13px;
    font-weight: 720;
    color: #64748b;
  }

  .app-route-loading strong {
    font-size: 24px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .app-route-loading p {
    margin: 0;
    font-size: 13px;
    color: #64748b;
  }

  :global(.dark) .cursor-highlight {
    background: radial-gradient(
      circle 210px at var(--cursor-highlight-x, -400px) var(--cursor-highlight-y, -400px),
      rgb(120 226 157 / 22%),
      rgb(214 154 68 / 10%) 36%,
      transparent 74%
    );
  }

  @media (pointer: coarse), (prefers-reduced-motion: reduce) {
    .cursor-highlight {
      display: none;
    }
  }
</style>
