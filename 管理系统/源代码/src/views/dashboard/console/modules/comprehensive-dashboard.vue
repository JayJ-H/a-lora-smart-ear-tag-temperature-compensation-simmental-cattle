<template>
  <ArtLineChart
    height="100%"
    :data="数据"
    :xAxisData="labels"
    :showAreaColor="true"
    :showAxisLine="false"
  />
</template>

<script setup lang="ts">
  import { onMounted, ref } from 'vue'
  import * as databaseService from '@/services/数据库'
  import { loadUnifiedMilkRecords, loadUnifiedReproductionEvents } from '@/services/unified-records'

  defineOptions({ name: 'ComprehensiveDashboard' })

  const labels = ref<string[]>([])
  const data = ref<number[]>([])

  function dateKey(value: unknown) {
    const date = new Date(String(value || ''))
    if (!Number.isFinite(date.getTime())) return ''
    return `${date.getMonth() + 1}/${date.getDate()}`
  }

  onMounted(async () => {
    const [milk, feed, breeding, alerts] = await Promise.all([
      loadUnifiedMilkRecords().catch(() => []),
      databaseService.getTableDataAsync('feed-records', { silent: true }).catch(() => []),
      loadUnifiedReproductionEvents()
        .then((result) => result.events)
        .catch(() => []),
      databaseService.getTableDataAsync('alerts', { silent: true }).catch(() => [])
    ])
    const counts = new Map<string, number>()
    const allRows = [
      ...milk.map((row: any) => row.milkingTime ?? row.measuredAt ?? row.createdAt),
      ...feed.map((row: any) => row.feedingTime ?? row.feedTime ?? row.createdAt),
      ...breeding.map((row: any) => row.eventTime ?? row.createdAt),
      ...alerts.map((row: any) => row.alertTime ?? row.createdAt)
    ]
    allRows.forEach((value) => {
      const key = dateKey(value)
      if (key) counts.set(key, (counts.get(key) || 0) + 1)
    })
    const sorted = Array.from(counts.entries()).slice(-10)
    labels.value = sorted.map(([label]) => label)
    data.value = sorted.map(([, value]) => value)
  })
</script>
