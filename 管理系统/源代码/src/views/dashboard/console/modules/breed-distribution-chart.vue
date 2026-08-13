<template>
  <ArtBarChart height="100%" :data="数据" :xAxisData="labels" :showAxisLine="false" />
</template>

<script setup lang="ts">
  import { onMounted, ref } from 'vue'
  import { buildUnifiedDataContext } from '@/services/unified-records'

  defineOptions({ name: 'BreedDistributionChart' })

  const labels = ref<string[]>([])
  const data = ref<number[]>([])

  onMounted(async () => {
    const context = await buildUnifiedDataContext()
    const rows = context.cows || []
    const counts = new Map<string, number>()
    rows.forEach((row: any) => {
      const breed = String(row.breed || row.breedType || row.breed_type || '未登记')
      counts.set(breed, (counts.get(breed) || 0) + 1)
    })
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
    labels.value = sorted.map(([label]) => label)
    data.value = sorted.map(([, value]) => value)
  })
</script>
