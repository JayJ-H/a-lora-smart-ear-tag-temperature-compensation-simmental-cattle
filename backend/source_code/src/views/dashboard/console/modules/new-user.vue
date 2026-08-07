<template>
  <div class="art-card p-5 h-128 overflow-hidden mb-5 max-sm:mb-4">
    <div class="art-card-header">
      <div class="title">
        <h4>新入群牛只</h4>
        <p
          >当前范围 <span class="text-success">{{ tableData.length }} 头</span></p
        >
      </div>
      <ElRadioGroup v-model="range">
        <ElRadioButton value="本月" label="本月" />
        <ElRadioButton value="上月" label="上月" />
        <ElRadioButton value="今年" label="今年" />
      </ElRadioGroup>
    </div>
    <ArtTable
      class="w-full"
      :data="tableData"
      style="width: 100%"
      size="large"
      table-layout="auto"
      :border="false"
      :stripe="false"
      :header-cell-style="{ background: 'transparent' }"
    >
      <template #default>
        <ElTableColumn label="牛号" prop="cowNumber" width="150px">
          <template #default="scope">
            <div style="display: flex; align-items: center">
              <ArtSvgIcon icon="ri:cow-line" class="text-green-500 mr-2" />
              <span>{{ scope.row.cowNumber }}</span>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="品种" prop="breed" />
        <ElTableColumn label="性别" prop="gender">
          <template #default="scope">
            <span>{{
              scope.row.gender === '母'
                ? '母牛'
                : scope.row.gender === '公'
                  ? '公牛'
                  : scope.row.gender
            }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="入群适应度" width="240">
          <template #default="scope">
            <ElProgress
              :percentage="scope.row.pro"
              :color="scope.row.color"
              :stroke-width="4"
              :aria-label="`${scope.row.cowNumber} 入群适应度 ${scope.row.pro}%`"
            />
          </template>
        </ElTableColumn>
      </template>
    </ArtTable>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue'
  import { buildUnifiedDataContext } from '@/services/unified-records'
  import { getHealthScoreMap } from '@/views/breeding-platform/platform-data'
  import * as databaseService from '@/services/database'

  interface CowTableItem {
    cowNumber: string
    breed: string
    gender: string
    age: number
    healthScore: number
    pro: number
    color: string
  }

  const ANIMATION_DELAY = 100

  const range = ref('本月')
  const rows = ref<CowTableItem[]>([])
  const tableData = computed(() => rows.value)

  function animateProgress(): void {
    setTimeout(() => {
      rows.value.forEach((item) => {
        item.pro = item.healthScore
      })
    }, ANIMATION_DELAY)
  }

  function getCreatedTime(row: any) {
    return new Date(
      row.createdAt ?? row.created_at ?? row.entryTime ?? row.entry_time ?? row.birthDate ?? ''
    ).getTime()
  }

  function inSelectedRange(timestamp: number) {
    if (!Number.isFinite(timestamp)) return true
    const date = new Date(timestamp)
    const now = new Date()
    if (range.value === '今年') return date.getFullYear() === now.getFullYear()
    const offset = range.value === '上月' ? 1 : 0
    const target = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    return date.getFullYear() === target.getFullYear() && date.getMonth() === target.getMonth()
  }

  async function loadRows() {
    const [context, healthScores] = await Promise.all([
      buildUnifiedDataContext(),
      databaseService.getTableDataAsync('health_scores', { silent: true }).catch(() => [])
    ])
    const cows = context.cows || []
    const healthByCow = getHealthScoreMap(healthScores as any[])
    rows.value = cows
      .filter((cow: any) => inSelectedRange(getCreatedTime(cow)))
      .sort((a: any, b: any) => (getCreatedTime(b) || 0) - (getCreatedTime(a) || 0))
      .slice(0, 8)
      .map((cow: any) => {
        const score = Number(
          cow.healthScore ??
            cow.health_score ??
            healthByCow[String(cow.id ?? cow.cowId ?? cow.animalId)] ??
            80
        )
        return {
          cowNumber: String(
            cow.cowNumber ??
              cow.cow_number ??
              cow.animalNumber ??
              cow.animal_number ??
              cow.number ??
              '-'
          ),
          breed: String(cow.breed ?? '-'),
          gender: String(cow.gender ?? '-'),
          age: Number(cow.age ?? 0),
          healthScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 80,
          pro: 0,
          color: score >= 90 ? '#60C041' : score >= 75 ? '#F5A524' : '#D83B5D'
        }
      })
    animateProgress()
  }

  watch(range, loadRows)
  onMounted(loadRows)
</script>

<style lang="scss" scoped>
  .art-card {
    :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
      color: var(--el-color-primary) !important;
      background: transparent !important;
    }
  }
</style>
