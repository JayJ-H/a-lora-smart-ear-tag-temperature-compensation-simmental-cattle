<template>
  <div class="art-card h-105 p-4 box-border mb-5 max-sm:mb-4">
    <ArtBarChart
      class="box-border p-2"
      barWidth="50%"
      height="13.7rem"
      :showAxisLine="false"
      :data="chartData"
      :xAxisData="xAxisLabels"
    />
    <div class="ml-1">
      <h3 class="mt-5 text-lg font-medium">牛只概述</h3>
      <p class="mt-1 text-sm"
        >在群牛数 <span class="text-success font-medium">{{ list[1].num }}头</span></p
      >
      <p class="mt-1 text-sm">实时监控牛只状态，包括在群、离群和健康状况等关键信息</p>
    </div>
    <div class="flex-b mt-2">
      <div class="flex-1" v-for="(item, index) in list" :key="index">
        <p class="text-2xl text-g-900">{{ item.num }}</p>
        <p class="text-xs text-g-500">{{ item.name }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { onMounted } from 'vue'
  import { buildUnifiedDataContext } from '@/services/unified-records'
  import {
    normalizeStatus,
    toFiniteNumber,
    getHealthScoreMap
  } from '@/views/breeding-platform/platform-data'
  import * as databaseService from '@/services/数据库'

  interface CowStatItem {
    name: string
    num: string
  }

  // 最近9个月
  const xAxisLabels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月']

  // 每月在群牛数（基于实际数据计算）
  const chartData = ref<number[]>([0, 0, 0, 0, 0, 0, 0, 0, 0])

  /**
   * 牛只统计数据列表
   * 包含总牛数、在群牛数、离群牛数和健康率等关键指标
   */
  const list = reactive<CowStatItem[]>([
    { name: '总牛数', num: '0' },
    { name: '在群牛数', num: '0' },
    { name: '离群牛数', num: '0' },
    { name: '健康率', num: '0%' }
  ])

  // 计算统计数据
  const calculateStats = async () => {
    try {
      const [context, healthScores] = await Promise.all([
        buildUnifiedDataContext(),
        databaseService.getTableDataAsync('health_scores', { silent: true }).catch(() => [])
      ])
      const allCows = context.cows || []
      const healthByCow = getHealthScoreMap(healthScores as any[])
      const totalCows = allCows.length
      const inPenCows = allCows.filter((cow: any) => normalizeStatus(cow.status) !== '离群').length
      const exitCows = allCows.filter((cow: any) => normalizeStatus(cow.status) === '离群').length
      const healthyCows = allCows.filter((cow: any) => {
        const id = String(cow.id ?? cow.cowId ?? cow.cow_id ?? cow.animalId ?? cow.animal_id ?? '')
        const healthScore = toFiniteNumber(cow.healthScore ?? cow.health_score ?? healthByCow[id])
        return (healthScore !== null && healthScore >= 80) || normalizeStatus(cow.status) === '健康'
      }).length

      const healthRate = totalCows > 0 ? Math.round((healthyCows / totalCows) * 100) : 0

      list[0].num = totalCows.toString()
      list[1].num = inPenCows.toString()
      list[2].num = exitCows.toString()
      list[3].num = `${healthRate}%`

      // 暂无真实月度历史时，仅展示当前月真实在群数
      chartData.value = [0, 0, 0, 0, 0, 0, 0, 0, inPenCows]
    } catch (error) {
      console.error('计算统计数据失败:', error)
    }
  }

  onMounted(() => {
    calculateStats()
  })
</script>
