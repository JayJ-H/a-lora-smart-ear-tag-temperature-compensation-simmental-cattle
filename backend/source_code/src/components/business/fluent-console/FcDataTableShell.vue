<template>
  <FcPanel :title="title" :subtitle="subtitle">
    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>
    <div v-if="$slots.filters" class="fc-filter-bar">
      <slot name="filters" />
    </div>
    <div class="fc-table-scroll">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="fc-table-footer">
      <slot name="footer" />
    </footer>
  </FcPanel>
</template>

<script setup lang="ts">
  import FcPanel from './FcPanel.vue'

  defineOptions({ name: 'FcDataTableShell' })

  defineProps<{
    title?: string
    subtitle?: string
  }>()
</script>

<style scoped lang="scss">
  .fc-filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    min-width: 0;
    margin-bottom: 12px;
    padding: 10px;
    background: var(--default-box-color);
    border: 1px solid var(--art-card-border);
    border-radius: calc(var(--custom-radius) / 2 + 2px);
  }

  .fc-table-scroll {
    min-width: 0;
    overflow: auto;
    border-radius: calc(var(--custom-radius) / 2 + 2px);
    overscroll-behavior: contain;
  }

  .fc-table-scroll :deep(.el-table) {
    min-width: 100%;
  }

  .fc-table-scroll :deep(.el-table__cell) {
    min-width: 0;
  }

  .fc-table-footer {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
    margin-top: 12px;
    color: var(--art-gray-600);
    font-size: 12px;
  }
</style>
