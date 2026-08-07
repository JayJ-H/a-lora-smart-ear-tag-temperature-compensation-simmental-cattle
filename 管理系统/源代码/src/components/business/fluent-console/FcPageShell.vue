<template>
  <main class="fc-page-shell page-content">
    <section class="fc-hero art-card">
      <div class="fc-hero-main">
        <span v-if="kicker" class="fc-hero-kicker">{{ kicker }}</span>
        <h1>{{ title }}</h1>
        <p v-if="description">{{ description }}</p>
      </div>

      <div class="fc-hero-side">
        <slot name="status">
          <div v-if="statusLabel || statusValue" class="fc-hero-status">
            <span>{{ statusLabel }}</span>
            <strong>{{ statusValue }}</strong>
          </div>
        </slot>

        <div class="fc-hero-actions">
          <slot name="actions">
            <ElButton v-if="secondaryActionLabel" @click="$emit('secondary-action')">
              <ArtSvgIcon v-if="secondaryActionIcon" :icon="secondaryActionIcon" class="mr-1" />
              {{ secondaryActionLabel }}
            </ElButton>
            <ElButton v-if="primaryActionLabel" type="primary" @click="$emit('primary-action')">
              <ArtSvgIcon v-if="primaryActionIcon" :icon="primaryActionIcon" class="mr-1" />
              {{ primaryActionLabel }}
            </ElButton>
          </slot>
        </div>
      </div>
    </section>

    <slot name="metrics" />
    <slot />
  </main>
</template>

<script setup lang="ts">
  defineOptions({ name: 'FcPageShell' })

  defineProps<{
    kicker?: string
    title: string
    description?: string
    statusLabel?: string
    statusValue?: string
    primaryActionLabel?: string
    primaryActionIcon?: string
    secondaryActionLabel?: string
    secondaryActionIcon?: string
  }>()

  defineEmits<{
    (event: 'primary-action'): void
    (event: 'secondary-action'): void
  }>()
</script>

<style scoped lang="scss">
  .fc-page-shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    min-width: 0;
    max-width: 100%;
    min-height: 100%;
    padding: 14px;
  }

  .fc-page-shell > * {
    min-width: 0;
    max-width: 100%;
  }

  .fc-hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
    min-height: 86px;
    padding: 14px 16px;
    overflow: visible;
  }

  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 780;
    line-height: 1.22;
    letter-spacing: 0;
  }

  .fc-hero-main,
  .fc-hero-side {
    min-width: 0;
  }

  .fc-hero-kicker {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 9px;
    margin-bottom: 6px;
    font-size: 11px;
    font-weight: 760;
    letter-spacing: 0;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
    border: 1px solid var(--art-card-border);
    border-radius: calc(var(--custom-radius) / 2 + 2px);
  }

  .fc-hero-main p {
    max-width: 760px;
    margin: 6px 0 0;
    font-size: 13px;
    line-height: 1.55;
  }

  .fc-hero-side {
    display: grid;
    gap: 12px;
    justify-items: end;
  }

  .fc-hero-status {
    min-width: 180px;
    padding: 9px 11px;
    background: var(--default-box-color);
    border: 1px solid var(--art-card-border);
    border-radius: calc(var(--custom-radius) / 2 + 2px);
  }

  .fc-hero-status span,
  .fc-hero-status strong {
    display: block;
  }

  .fc-hero-status span {
    color: var(--art-gray-600);
    font-size: 12px;
    font-weight: 650;
  }

  .fc-hero-status strong {
    margin-top: 4px;
    font-size: 15px;
    font-weight: 760;
    overflow-wrap: anywhere;
  }

  .fc-hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: flex-end;
  }

  @media (max-width: 900px) {
    .fc-hero {
      grid-template-columns: 1fr;
    }

    .fc-hero-side {
      justify-items: start;
    }

    .fc-hero-actions {
      justify-content: flex-start;
    }
  }

  @media (max-width: 640px) {
    .fc-page-shell {
      padding: 12px;
    }

    .fc-hero {
      padding: 14px;
    }

    h1 {
      font-size: 21px;
    }
  }
</style>
