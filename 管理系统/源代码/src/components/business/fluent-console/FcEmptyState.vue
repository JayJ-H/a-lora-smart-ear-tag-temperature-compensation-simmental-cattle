<template>
  <div class="fc-empty-state art-card-xs">
    <div class="fc-empty-icon">
      <ArtSvgIcon :icon="icon" />
    </div>
    <h3>{{ title }}</h3>
    <p v-if="description">{{ description }}</p>
    <ElButton v-if="actionLabel" type="primary" @click="$emit('action')">
      {{ actionLabel }}
    </ElButton>
  </div>
</template>

<script setup lang="ts">
  defineOptions({ name: 'FcEmptyState' })

  withDefaults(
    defineProps<{
      title: string
      description?: string
      actionLabel?: string
      icon?: string
    }>(),
    {
      icon: 'ri:inbox-line'
    }
  )

  defineEmits<{
    (event: 'action'): void
  }>()
</script>

<style scoped lang="scss">
  .fc-empty-state {
    display: grid;
    justify-items: center;
    min-height: 190px;
    padding: 28px 18px;
    text-align: center;
    border-style: dashed !important;
  }

  .fc-empty-icon {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
    border: 1px solid var(--art-card-border);
    border-radius: calc(var(--custom-radius) / 2 + 2px);
  }

  .fc-empty-icon .art-svg-icon {
    font-size: 22px;
  }

  h3 {
    margin: 12px 0 0;
    font-size: 16px;
    font-weight: 760;
  }

  p {
    max-width: 420px;
    margin: 8px 0 0;
    color: var(--art-gray-600);
    font-size: 13px;
    line-height: 1.55;
  }

  h3 + .el-button,
  p + .el-button {
    margin-top: 14px;
  }
</style>
