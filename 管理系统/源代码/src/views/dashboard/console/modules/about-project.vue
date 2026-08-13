<template>
  <div class="art-card p-5 flex-b mb-5 max-sm:mb-4">
    <div>
      <h2 class="text-2xl font-medium">关于系统</h2>
      <p class="text-g-700 mt-1">{{ systemName }} 面向牛场生产、繁殖、健康、传感器和育种评估闭环</p>
      <p class="text-g-700 mt-1"
        >整合个体档案、圈舍、事件、泌乳、表型、组学和设备数据，支撑日常生产管理</p
      >

      <div class="flex flex-wrap gap-3.5 max-w-150 mt-9">
        <div
          class="system-link"
          v-for="link in linkList"
          :key="link.label"
          @click="goPage(link.url)"
        >
          <span class="text-g-700">{{ link.label }}</span>
          <ArtSvgIcon icon="ri:arrow-right-s-line" class="text-lg text-g-600" />
        </div>
      </div>
    </div>
    <img class="w-75 max-md:!hidden" src="@imgs/draw/draw1.png" alt="draw1" />
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { WEB_LINKS } from '@/utils/constants'

  const { t } = useI18n()
  const systemName = computed(() => t('system.name'))

  const linkList = [
    { label: '系统文档', url: WEB_LINKS.DOCS },
    { label: '使用指南', url: WEB_LINKS.INTRODUCE },
    { label: '技术支持', url: WEB_LINKS.GITHUB_HOME },
    { label: '平台资讯', url: WEB_LINKS.BILIBILI }
  ]

  /**
   * 在新标签页中打开指定 URL
   * @param url 要打开的网页地址
   */
  const goPage = (url: string): void => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
</script>

<style scoped>
  .system-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 15rem;
    height: 3.125rem;
    padding: 0 0.875rem;
    color: var(--fluent-text);
    cursor: pointer;
    background: #f8fafc;
    border: 1px solid rgb(226 232 240);
    border-radius: 8px;
    transition:
      background-color 160ms ease,
      border-color 160ms ease;
  }

  .system-link:hover {
    background: #fff;
    border-color: rgb(var(--fluent-primary-rgb) / 24%);
  }

  @media (width <= 640px) {
    .system-link {
      width: 100%;
    }
  }
</style>
