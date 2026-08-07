<template>
  <article class="fc-metric-tile art-card-sm" :class="`is-${tone}`">
    <div class="fc-metric-top">
      <span>{{ label }}</span>
      <ArtSvgIcon v-if="icon" :icon="icon" />
    </div>
    <div class="fc-metric-value">
      {{ value }}
      <small v-if="unit">{{ unit }}</small>
    </div>
    <p v-if="note" class="fc-metric-note">{{ note }}</p>
  </article>
</template>

<script setup lang="ts">
  defineOptions({ name: 'FcMetricTile' })

  withDefaults(
    defineProps<{
      label: string
      value: string | number
      unit?: string
      note?: string
      icon?: string
      tone?: 'primary' | 'teal' | 'warning' | 'danger' | 'info'
    }>(),
    {
      tone: 'primary'
    }
  )
</script>

<style scoped lang="scss">
  .fc-metric-tile {
    position: relative;
    min-height: 94px;
    padding: 13px 14px;
    overflow: visible;
  }

  .fc-metric-tile::before {
    position: absolute;
    inset: 0 auto 0 0;
    width: 4px;
    content: '';
    background: var(--el-color-primary);
  }

  .fc-metric-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: var(--art-gray-600);
    font-size: 12px;
    font-weight: 650;
  }

  .fc-metric-top .art-svg-icon {
    color: var(--el-color-primary);
    font-size: 20px;
  }

  .fc-metric-value {
    margin-top: 8px;
    color: var(--art-gray-900);
    font-size: 23px;
    font-weight: 780;
    line-height: 1.1;
    overflow-wrap: anywhere;
  }

  .fc-metric-value small {
    margin-left: 4px;
    color: var(--art-gray-600);
    font-size: 15px;
    font-weight: 650;
  }

  .fc-metric-note {
    margin: 6px 0 0;
    color: var(--art-gray-600);
    font-size: 12px;
    line-height: 1.45;
  }

  .is-teal::before {
    background: #00a6a6;
  }

  .is-teal .art-svg-icon {
    color: #00a6a6;
  }

  .is-warning::before {
    background: var(--el-color-warning);
  }

  .is-warning .art-svg-icon {
    color: var(--el-color-warning);
  }

  .is-danger::before {
    background: var(--el-color-danger);
  }

  .is-danger .art-svg-icon {
    color: var(--el-color-danger);
  }

  .is-info::before {
    background: var(--el-color-info);
  }

  .is-info .art-svg-icon {
    color: var(--el-color-info);
  }
</style>
