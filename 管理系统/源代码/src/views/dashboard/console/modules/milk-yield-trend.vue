<template>
  <div class="art-card h-105 p-5 mb-5 max-sm:mb-4">
    <div class="art-card-header">
      <div class="title">
        <h4>产奶量趋势</h4>
        <p
          >本月环比<span class="text-success">{{ growthText }}</span></p
        >
      </div>
    </div>
    <ArtLineChart
      height="calc(100% - 40px)"
      :data="数据"
      :xAxisData="xAxisData"
      :showAreaColor="true"
      :showAxisLine="false"
    />
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue'
  import { buildUnifiedDataContext, loadUnifiedMilkRecords } from '@/services/unified-records'

  const data = ref<number[]>(Array(12).fill(0))
  const xAxisData = Array.from({ length: 12 }, (_, index) => `${index + 1}月`)
  const growthText = computed(() => {
    const current = data.value[new Date().getMonth()] || 0
    const previous = data.value[Math.max(0, new Date().getMonth() - 1)] || 0
    if (!previous) return '+0%'
    return `${(((current - previous) / previous) * 100).toFixed(1)}%`
  })

  function getMilkTime(row: any) {
    return new Date(
      row.milkingTime ?? row.milking_time ?? row.createdAt ?? row.created_at ?? ''
    ).getTime()
  }

  async function loadMilkTrend() {
    const context = await buildUnifiedDataContext()
    const rows = await loadUnifiedMilkRecords(context)
    const year = new Date().getFullYear()
    const buckets = Array(12).fill(0)
    rows.forEach((row: any) => {
      const timestamp = getMilkTime(row)
      if (!Number.isFinite(timestamp)) return
      const date = new Date(timestamp)
      if (date.getFullYear() !== year) return
      buckets[date.getMonth()] += Number(
        row.volume ?? row.milkVolume ?? row.milk_volume ?? row.milkYield ?? row.milk_yield ?? 0
      )
    })
    data.value = buckets.map((value) => Number((value / 1000).toFixed(2)))
  }

  onMounted(loadMilkTrend)
</script>
