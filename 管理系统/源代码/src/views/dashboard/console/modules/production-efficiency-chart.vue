<template>
  <ArtBarChart height="100%" :data="数据" :xAxisData="labels" :showAxisLine="false" />
</template>

<script setup lang="ts">
  import { onMounted, ref } from 'vue'
  import * as databaseService from '@/services/数据库'
  import { loadUnifiedMilkRecords } from '@/services/unified-records'

  defineOptions({ name: 'ProductionEfficiencyChart' })

  const labels = ref(['泌乳记录', '饲喂记录', '繁育记录', '传感器记录'])
  const data = ref<number[]>([0, 0, 0, 0])

  onMounted(async () => {
    const [milk, feed, breeding, sensors] = await Promise.all([
      loadUnifiedMilkRecords().catch(() => []),
      databaseService.getTableDataAsync('feed-records', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('breeding-records', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('sensors', { silent: true }).catch(() => [])
    ])
    data.value = [milk.length, feed.length, breeding.length, sensors.length]
  })
</script>
