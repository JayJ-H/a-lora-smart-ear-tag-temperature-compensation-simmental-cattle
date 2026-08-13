<template>
  <div class="art-card h-128 p-5 mb-5 max-sm:mb-4">
    <div class="art-card-header">
      <div class="title">
        <h4>平台动态</h4>
        <p
          >今日<span class="text-success">+{{ list.length }}</span></p
        >
      </div>
    </div>

    <div class="h-9/10 mt-2 overflow-hidden">
      <ElScrollbar>
        <div
          class="h-17.5 leading-17.5 border-b border-g-300 text-sm overflow-hidden last:border-b-0"
          v-for="(item, index) in list"
          :key="index"
        >
          <span class="text-g-800 font-medium">{{ item.operator }}</span>
          <span class="mx-2 text-g-600">{{ item.action }}</span>
          <span class="text-theme">{{ item.target }}</span>
        </div>
      </ElScrollbar>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { onMounted, reactive } from 'vue'
  import { getUnifiedCowEventRowsAsync } from '@/services/数据库'

  interface FarmActivityItem {
    operator: string
    action: string
    target: string
  }

  const list = reactive<FarmActivityItem[]>([])

  function eventTime(row: any) {
    return new Date(
      row.eventTime ??
        row.event_time ??
        row.transferTime ??
        row.transfer_time ??
        row.entryTime ??
        row.entry_time ??
        row.createdAt ??
        row.created_at ??
        0
    ).getTime()
  }

  async function loadActivities() {
    const rows = await getUnifiedCowEventRowsAsync().catch(() => [])
    const actionOf = (row: any) => {
      const code = String(row.eventCode ?? row.event_code ?? row.eventType ?? row.event_type ?? '')
      const group = String(row.eventGroup ?? row.event_group ?? row.category ?? '')
      if (code.includes('entry') || group.includes('入群')) return '录入了'
      if (code.includes('transfer') || group.includes('转群')) return '处理了'
      if (code.includes('veterinary') || code.includes('health') || group.includes('健康')) {
        return '处置了'
      }
      return '更新了'
    }
    const labelOf = (row: any) => {
      const name = row.eventName ?? row.event_name ?? row.eventTypeName
      const code = String(row.eventCode ?? row.event_code ?? row.eventType ?? row.event_type ?? '')
      if (name) return String(name)
      if (code.includes('entry')) return '入群事件'
      if (code.includes('transfer')) return '转群事件'
      if (code.includes('veterinary') || code.includes('health')) return '兽医事件'
      if (code.includes('breeding') || code.includes('insemination') || code.includes('calving')) {
        return '繁育记录'
      }
      return '生产事件'
    }
    const next = rows
      .map((row: any) => ({ row, action: actionOf(row), label: labelOf(row) }))
      .sort((a, b) => eventTime(b.row) - eventTime(a.row))
      .slice(0, 10)
      .map(({ row, action, label }) => ({
        operator: String(row.recorder || row.operator || row.veterinarian || '系统'),
        action,
        target: `${row.cowNumber || row.cow_number || row.cowId || ''}${label}`.trim()
      }))
    list.splice(0, list.length, ...next)
  }

  onMounted(loadActivities)
</script>
