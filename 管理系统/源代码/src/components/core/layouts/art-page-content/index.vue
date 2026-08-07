<!-- 布局内容 -->
<template>
  <div class="layout-content" :class="{ 'overflow-auto': isFullPage }" :style="containerStyle">
    <div id="app-content-header">
      <!-- 节日滚动 -->
      <ArtFestivalTextScroll v-if="!isFullPage" />

      <!-- 路由信息调试 -->
      <div
        v-if="isOpenRouteInfo === 'true'"
        class="px-2 py-1.5 mb-3 text-sm text-g-500 bg-g-200 border-full-d rounded-md"
      >
        router meta：{{ route.meta }}
      </div>
    </div>

    <RouterView v-if="isRefresh" v-slot="{ Component, route }" :style="contentStyle">
      <Suspense>
        <template #default>
          <KeepAlive v-if="route.meta.keepAlive" :max="10" :exclude="keepAliveExclude">
            <component class="art-page-view" :is="Component" :key="route.fullPath" />
          </KeepAlive>
          <component v-else class="art-page-view" :is="Component" :key="route.fullPath" />
        </template>
        <template #fallback>
          <section class="route-loading-card" :style="contentStyle">
            <span>正在载入页面</span>
            <strong>{{ route.meta.title || '业务模块' }}</strong>
            <p>数据和组件加载完成后会自动显示。</p>
          </section>
        </template>
      </Suspense>
    </RouterView>
  </div>
</template>
<script setup lang="ts">
  import type { CSSProperties } from 'vue'
  import { useRoute } from 'vue-router'
  import { useAutoLayoutHeight } from '@/hooks/core/useLayoutHeight'
  import { useSettingStore } from '@/store/modules/setting'
  import { useWorktabStore } from '@/store/modules/worktab'

  defineOptions({ name: 'ArtPageContent' })

  const route = useRoute()
  const { containerMinHeight } = useAutoLayoutHeight()
  const { containerWidth, refresh } = storeToRefs(useSettingStore())
  const { keepAliveExclude } = storeToRefs(useWorktabStore())

  const isRefresh = shallowRef(true)
  const isOpenRouteInfo = import.meta.env.VITE_OPEN_ROUTE_INFO

  // 检查当前路由是否需要使用无基础布局模式
  const isFullPage = computed(() => route.matched.some((r) => r.meta?.isFullPage))

  const containerStyle = computed(
    (): CSSProperties =>
      isFullPage.value
        ? {
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100vh',
            zIndex: 2500,
            background: 'var(--default-bg-color)'
          }
        : {
            maxWidth: containerWidth.value
          }
  )

  const contentStyle = computed(
    (): CSSProperties => ({
      minHeight: containerMinHeight.value
    })
  )

  const reload = () => {
    isRefresh.value = false
    nextTick(() => {
      isRefresh.value = true
    })
  }

  watch(refresh, reload, { flush: 'post' })
</script>

<style scoped lang="scss">
  .route-loading-card {
    display: grid;
    place-content: center;
    gap: 8px;
    min-height: 360px;
    margin: 14px;
    padding: 24px;
    text-align: center;
    border: 1px solid rgba(74, 124, 89, 0.16);
    border-radius: 8px;
    background:
      linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(240, 253, 244, 0.74)),
      var(--default-bg-color);
    box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
  }

  .route-loading-card span {
    color: #64748b;
    font-size: 13px;
    font-weight: 720;
  }

  .route-loading-card strong {
    color: #111827;
    font-size: 22px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .route-loading-card p {
    margin: 0;
    color: #64748b;
    font-size: 13px;
  }
</style>
