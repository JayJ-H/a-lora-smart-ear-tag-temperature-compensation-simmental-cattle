<template>
  <ElRow :gutter="20" class="flex">
    <ElCol v-for="(item, index) in dataList" :key="index" :sm="12" :md="6" :lg="6">
      <div class="art-card relative flex flex-col justify-center h-35 px-5 mb-5 max-sm:mb-4">
        <span class="text-g-700 text-sm">{{ item.des }}</span>
        <ArtCountTo class="text-[26px] font-medium mt-2" :target="item.num" :duration="1300" />
        <div class="flex-c mt-1">
          <span class="text-xs text-g-600">当前台账</span>
          <span
            class="ml-1 text-xs font-semibold"
            :class="[item.change.indexOf('+') === -1 ? 'text-danger' : 'text-success']"
          >
            {{ item.change }}
          </span>
        </div>
        <div
          class="absolute top-0 bottom-0 right-5 m-auto size-12.5 rounded-xl flex-cc bg-theme/10"
        >
          <ArtSvgIcon :icon="item.icon" class="text-xl text-theme" />
        </div>
      </div>
    </ElCol>
  </ElRow>
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

  interface CardDataItem {
    des: string
    icon: string
    startVal: number
    duration: number
    num: number
    change: string
  }

  /**
   * 卡片统计数据列表
   * 展示总牛数、在群牛数、离群牛数和健康牛数等核心数据指标
   */
  const dataList = reactive<CardDataItem[]>([
    {
      des: '总牛数',
      icon: 'ri:cow-line',
      startVal: 0,
      duration: 1000,
      num: 0,
      change: '+0%'
    },
    {
      des: '在群牛数',
      icon: 'ri:group-line',
      startVal: 0,
      duration: 1000,
      num: 0,
      change: '+0%'
    },
    {
      des: '离群牛数',
      icon: 'ri:logout-box-line',
      startVal: 0,
      duration: 1000,
      num: 0,
      change: '+0%'
    },
    {
      des: '健康牛数',
      icon: 'ri:heart-pulse-line',
      startVal: 0,
      duration: 1000,
      num: 0,
      change: '+0%'
    }
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

      // 暂无真实历史基线时变化率保持为0
      dataList[0].num = totalCows
      dataList[0].change = '+0%'

      dataList[1].num = inPenCows
      dataList[1].change = '+0%'

      dataList[2].num = exitCows
      dataList[2].change = '+0%'

      dataList[3].num = healthyCows
      dataList[3].change = '+0%'
    } catch (error) {
      console.error('计算统计数据失败:', error)
    }
  }

  onMounted(() => {
    calculateStats()
  })
</script>
