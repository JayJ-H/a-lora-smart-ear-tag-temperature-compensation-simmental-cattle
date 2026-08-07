<template>
  <ArtBarChart height="100%" :data="data" :xAxisData="labels" :showAxisLine="false" />
</template>

<script setup lang="ts">
  import { onMounted, ref } from 'vue'
  import { buildUnifiedDataContext } from '@/services/unified-records'
  import { normalizeStatus } from '@/views/breeding-platform/platform-data'

  defineOptions({ name: 'HealthDistributionChart' })

  const labels = ref(['健康', '异常', '发情', '预产', '离群'])
  const data = ref<number[]>([0, 0, 0, 0, 0])

  onMounted(async () => {
    const context = await buildUnifiedDataContext()
    const rows = context.cows || []
    data.value = labels.value.map(
      (label) => rows.filter((row: any) => normalizeStatus(row.status).includes(label)).length
    )
  })
</script>
