<template>
  <section class="fc-panel art-card" :class="{ 'is-dense': dense }">
    <header v-if="title || $slots.actions" class="fc-panel-header art-card-header">
      <div class="title">
        <h4 v-if="title">{{ title }}</h4>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="fc-panel-actions">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>

<script setup lang="ts">
  defineOptions({ name: 'FcPanel' })

  withDefaults(
    defineProps<{
      title?: string
      subtitle?: string
      dense?: boolean
    }>(),
    {
      dense: false
    }
  )
</script>

<style scoped lang="scss">
  .fc-panel {
    min-width: 0;
    overflow: hidden;
    padding: 14px;
  }

  .fc-panel.is-dense {
    padding: 12px;
  }

  .fc-panel-header {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    justify-content: space-between;
    min-width: 0;
    margin-bottom: 12px;
    padding-bottom: 10px;
    padding-right: 0;
    border-bottom: 1px solid var(--art-card-border);

    > div:first-child {
      min-width: 0;
    }
  }

  .fc-panel-header h4 {
    min-width: 0;
    overflow: hidden;
    margin: 0;
    font-size: 16px;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fc-panel-header p {
    display: -webkit-box;
    max-width: 620px;
    margin: 4px 0 0;
    overflow: hidden;
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .fc-panel-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 52%;
    justify-content: flex-end;
  }

  .fc-panel-actions :deep(.el-button) {
    min-width: 0;
  }

  .fc-panel-actions :deep(.el-button > span) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 900px) {
    .fc-panel-header {
      display: grid;
      grid-template-columns: 1fr;
    }

    .fc-panel-actions {
      max-width: 100%;
      justify-content: flex-start;
    }
  }
</style>
