<template>
  <div class="art-card p-5 flex-b mb-5 max-sm:mb-4">
    <div>
      <h2 class="text-2xl font-medium">关于系统</h2>
      <p class="text-g-700 mt-1">{{ systemName }} 面向牛场生产、繁殖、健康、传感器和育种评估闭环</p>
      <p class="text-g-700 mt-1"
        >整合个体档案、圈舍、事件、泌乳、表型、组学和设备数据，支撑日常生产管理</p
      >

    </div>
    <img class="w-75 max-md:!hidden" src="@imgs/draw/draw1.png" alt="draw1" />
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'

  const { t } = useI18n()
  const systemName = computed(() => t('system.name'))
</script>

