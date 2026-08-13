<template>
  <div class="art-card h-128 p-5 mb-5 max-sm:mb-4">
    <div class="art-card-header">
      <div class="title">
        <h4>今日任务</h4>
        <p
          >待处理<span class="text-danger">{{ pendingCount }}</span></p
        >
      </div>
    </div>

    <div class="h-[calc(100%-40px)] overflow-auto">
      <ElScrollbar>
        <div
          class="flex-cb h-17.5 border-b border-g-300 text-sm last:border-b-0"
          v-for="(item, index) in list"
          :key="index"
        >
          <div>
            <p class="text-sm">{{ item.task }}</p>
            <p class="text-g-500 mt-1">{{ item.time }}</p>
          </div>
          <ElCheckbox v-model="item.completed" />
        </div>
      </ElScrollbar>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive } from 'vue'
  import * as databaseService from '@/services/database'
  import { loadUnifiedReproductionEvents } from '@/services/unified-records'
  import { formatDateOnly } from '@/utils/date-display'

  interface TaskItem {
    task: string
    time: string
    completed: boolean
  }

  const list = reactive<TaskItem[]>([])
  const pendingCount = computed(() => list.filter((item) => !item.completed).length)

  function formatTime(value: unknown) {
    return formatDateOnly(value, '今日')
  }

  async function loadTasks() {
    const [alerts, breeding, sensors, feedInventory] = await Promise.all([
      databaseService.getTableDataAsync('alerts', { silent: true }).catch(() => []),
      loadUnifiedReproductionEvents()
        .then((result) => result.events)
        .catch(() => []),
      databaseService.getTableDataAsync('sensors', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('feed-inventory', { silent: true }).catch(() => [])
    ])
    const next: TaskItem[] = []
    alerts
      .filter((row: any) => String(row.status || '').toLowerCase() !== 'resolved')
      .slice(0, 2)
      .forEach((row: any) => {
        next.push({
          task: row.title || row.description || '处理健康预警',
          time: formatTime(row.alertTime ?? row.alert_time ?? row.createdAt),
          completed: false
        })
      })
    breeding.slice(0, 2).forEach((row: any) => {
      next.push({
        task: `复核繁育记录 ${row.cowNumber || row.cow_number || row.cowId || ''}`.trim(),
        time: formatTime(row.eventTime ?? row.event_time),
        completed: true
      })
    })
    if (!sensors.length) next.push({ task: '检查传感器数据同步', time: '今日', completed: false })
    const lowStock = feedInventory.filter(
      (row: any) =>
        Number(row.currentStock ?? row.current_stock ?? row.stock ?? 999) <=
        Number(row.minStock ?? row.min_stock ?? 0)
    )
    if (lowStock.length)
      next.push({
        task: `补充低库存饲料 ${lowStock[0].feedType || lowStock[0].name || ''}`.trim(),
        time: '今日',
        completed: false
      })
    list.splice(0, list.length, ...next.slice(0, 8))
  }

  onMounted(loadTasks)
</script>
