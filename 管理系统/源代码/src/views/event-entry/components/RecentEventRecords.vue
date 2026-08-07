<template>
  <section class="recent-event-card art-card">
    <div class="recent-event-card__head art-card-header">
      <div>
        <h3>{{ title }}</h3>
        <p>最近 {{ visibleEvents.length }} / {{ filteredEvents.length }} 条成功录入记录</p>
      </div>
      <ElButton size="small" plain :loading="loading" @click="loadRecords">刷新</ElButton>
    </div>

    <div class="recent-event-list" @scroll.passive="onScroll" @wheel.passive="onWheel">
      <article v-for="item in visibleEvents" :key="item.id" class="recent-event-item art-card-xs">
        <div class="recent-event-item__main">
          <span>{{ item.eventName }}</span>
          <strong>{{ item.cowNumber || '未关联牛号' }}</strong>
        </div>
        <dl>
          <div>
            <dt>时间</dt>
            <dd>{{ formatDateTime(item.eventTime) }}</dd>
          </div>
          <div>
            <dt>操作人</dt>
            <dd>{{ item.operatorName || '-' }}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{{ item.statusText }}</dd>
          </div>
        </dl>
      </article>

      <div v-if="filteredEvents.length" class="recent-event-foot">
        <span>当前显示 {{ visibleEvents.length }} / {{ filteredEvents.length }}</span>
        <ElButton v-if="hasMoreEvents" size="small" plain @click="loadMoreEvents()">
          继续加载
        </ElButton>
      </div>

      <FcEmptyState
        v-if="!filteredEvents.length && !loading"
        icon="ri:file-list-3-line"
        title="暂无成功录入记录"
        description="提交成功后会在这里显示最近的单条录入记录。"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue'
  import FcEmptyState from '@/components/business/fluent-console/FcEmptyState.vue'
  import { useLazyRenderWindow } from '@/hooks'
  import * as databaseService from '@/services/database'
  import { formatDateOnly } from '@/utils/date-display'

  interface RecentEventItem {
    id: string
    eventType: string
    eventCode: string
    eventName: string
    cowNumber: string
    eventTime: string
    operatorName: string
    statusText: string
  }

  const props = withDefaults(
    defineProps<{
      title?: string
      eventTypes?: string[]
      refreshKey?: number
      records?: any[]
    }>(),
    {
      title: '最近成功录入',
      eventTypes: () => [],
      refreshKey: 0,
      records: () => []
    }
  )

  const loading = ref(false)
  const recentRecords = ref<RecentEventItem[]>([])

  const normalizedEventTypes = computed(
    () => new Set(props.eventTypes.map((item) => normalize(item)))
  )

  const filteredEvents = computed(() => {
    const allowed = normalizedEventTypes.value
    return recentRecords.value
      .filter((item) => !allowed.size || allowed.has(item.eventType) || allowed.has(item.eventCode))
      .sort((left, right) => parseTime(right.eventTime) - parseTime(left.eventTime))
  })

  const {
    visibleItems: visibleEvents,
    hasMore: hasMoreEvents,
    loadMore: loadMoreEvents,
    handleScroll: onScroll,
    handleWheel: onWheel
  } = useLazyRenderWindow(filteredEvents, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  onMounted(loadRecords)

  watch(
    () => props.records,
    (rows) => {
      if (Array.isArray(rows) && rows.length) {
        recentRecords.value = rows.map(mapEvent).filter((item) => item.id)
      }
    },
    { immediate: true, deep: true }
  )

  watch(
    () => props.refreshKey,
    () => {
      if (!props.records?.length) void loadRecords()
    }
  )

  async function loadRecords() {
    if (props.records?.length) {
      recentRecords.value = props.records.map(mapEvent).filter((item) => item.id)
      return
    }
    loading.value = true
    try {
      const rows = await databaseService.getUnifiedCowEventRowsAsync()
      recentRecords.value = (rows || []).map(mapEvent).filter((item) => item.id)
    } finally {
      loading.value = false
    }
  }

  function mapEvent(row: any): RecentEventItem {
    return {
      id: normalize(row.id),
      eventType: normalize(row.eventType || row.event_type),
      eventCode: normalize(row.eventCode || row.event_code),
      eventName: normalize(row.eventName || row.event_name || row.eventType || row.event_type),
      cowNumber: normalize(
        row.cowNumber || row.cow_number || row.animalNumber || row.animal_number
      ),
      eventTime: normalize(
        row.eventTime || row.event_time || row.occurredAt || row.occurred_at || row.createdAt
      ),
      operatorName: normalize(row.operatorName || row.operator_name || row.recorder),
      statusText: statusLabel(row.eventStatus || row.event_status || row.status)
    }
  }

  function normalize(value: unknown) {
    return value == null ? '' : String(value).trim()
  }

  function parseTime(value: string) {
    const time = new Date(value).getTime()
    return Number.isFinite(time) ? time : 0
  }

  function formatDateTime(value: string) {
    return formatDateOnly(value)
  }

  function statusLabel(value: unknown) {
    const raw = normalize(value)
    const map: Record<string, string> = {
      recorded: '已记录',
      confirmed: '已确认',
      pending_review: '待复核',
      voided: '已作废'
    }
    return map[raw] || raw || '已记录'
  }
</script>

<style scoped lang="scss">
  .recent-event-card {
    height: 100%;
    min-height: 320px;
    padding: 14px;
  }

  .recent-event-card__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;

    h3 {
      margin: 0;
      color: #0f172a;
      font-size: 16px;
      font-weight: 700;
    }

    p {
      margin: 4px 0 0;
      color: #64748b;
      font-size: 12px;
    }
  }

  .recent-event-list {
    max-height: min(54vh, 430px);
    overflow: auto;
    padding-right: 4px;
  }

  .recent-event-item {
    padding: 10px;
    margin-bottom: 8px;
    transition:
      background-color 0.16s ease,
      border-color 0.16s ease;

    &:hover {
      border-color: rgb(20 184 166 / 45%);
      background: rgb(240 253 250 / 86%);
    }

    dl {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin: 10px 0 0;
    }

    dt {
      color: #94a3b8;
      font-size: 11px;
    }

    dd {
      margin: 2px 0 0;
      overflow-wrap: anywhere;
      color: #334155;
      font-size: 12px;
    }
  }

  .recent-event-item__main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;

    span {
      overflow: hidden;
      color: #0f766e;
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    strong {
      overflow: hidden;
      color: #0f172a;
      font-size: 15px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .recent-event-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 2px 0;
    color: #64748b;
    font-size: 12px;
  }

  :global(.dark) {
    .recent-event-card__head h3,
    .recent-event-item__main strong {
      color: #f8fafc;
    }

    .recent-event-card__head p,
    .recent-event-foot,
    .recent-event-item dd {
      color: #cbd5e1;
    }

  }

  @media (max-width: 768px) {
    .recent-event-card {
      padding: 14px;
    }

    .recent-event-item dl {
      grid-template-columns: 1fr;
    }
  }
</style>

