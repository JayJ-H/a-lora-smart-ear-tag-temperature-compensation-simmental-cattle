<template>
  <div class="statistics-page p-5">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">灵活统计分析</h1>
        <p class="text-gray-600 dark:text-gray-300 mt-1"
          >按胎次/日/月/年多维度聚合分析，支持最大/最小/平均/次数统计</p
        >
      </div>
    </div>

    <!-- 配置面板 -->
    <div class="statistics-panel mb-6">
      <h2 class="text-lg font-semibold mb-4 text-gray-900 dark:text-white">分析配置</h2>

      <ElForm :model="config" label-width="120px" class="max-w-4xl">
        <ElRow :gutter="20">
          <ElCol :xs="24" :sm="12" :lg="8">
            <ElFormItem label="数据范围">
              <ElSelect v-model="config.scope" placeholder="选择数据范围" class="w-full">
                <ElOption label="牛只信息" value="cow" />
                <ElOption label="繁殖事件" value="breeding" />
                <ElOption label="产奶记录" value="milk" />
                <ElOption label="饲料记录" value="feed" />
                <ElOption label="健康评分" value="health" />
              </ElSelect>
            </ElFormItem>
          </ElCol>

          <ElCol :xs="24" :sm="12" :lg="8">
            <ElFormItem label="牛群类型">
              <ElSelect v-model="config.targetType" placeholder="选择牛群类型" class="w-full">
                <ElOption label="全部牛只" value="all" />
                <ElOption label="泌乳牛" value="lactating" />
                <ElOption label="干奶牛" value="dry" />
                <ElOption label="种公牛" value="bulls" />
                <ElOption label="犊牛" value="calves" />
                <ElOption label="育成牛" value="heifers" />
                <ElOption label="预产牛" value="pregnant" />
              </ElSelect>
            </ElFormItem>
          </ElCol>

          <ElCol :xs="24" :sm="12" :lg="8">
            <ElFormItem label="分组维度">
              <ElSelect v-model="config.groupBy" placeholder="选择分组维度" class="w-full">
                <ElOption label="不分组" value="none" />
                <ElOption label="按日" value="day" />
                <ElOption label="按月" value="month" />
                <ElOption label="按年" value="year" />
                <ElOption label="按胎次" value="parity" />
                <ElOption label="按圈舍" value="pen" />
                <ElOption label="按品种" value="breed" />
              </ElSelect>
            </ElFormItem>
          </ElCol>
        </ElRow>

        <ElRow :gutter="20">
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="开始日期">
              <ElDatePicker
                v-model="config.dateRange.start"
                type="date"
                format="YYYY-MM-DD"
                value-format="YYYY-MM-DD"
                class="w-full"
              />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="结束日期">
              <ElDatePicker
                v-model="config.dateRange.end"
                type="date"
                format="YYYY-MM-DD"
                value-format="YYYY-MM-DD"
                class="w-full"
              />
            </ElFormItem>
          </ElCol>
        </ElRow>

        <!-- 聚合字段配置 -->
        <ElFormItem label="聚合字段">
          <div
            v-for="(agg, index) in config.aggregations"
            :key="index"
            class="flex items-center gap-2 mb-2"
          >
            <ElSelect v-model="agg.field" placeholder="选择字段" class="w-40">
              <ElOption
                v-for="f in availableFields"
                :key="f.value"
                :label="f.label"
                :value="f.value"
              />
            </ElSelect>
            <ElCheckboxGroup v-model="agg.functions" size="small">
              <ElCheckbox label="count">次数</ElCheckbox>
              <ElCheckbox label="sum">合计</ElCheckbox>
              <ElCheckbox label="avg">平均</ElCheckbox>
              <ElCheckbox label="min">最小</ElCheckbox>
              <ElCheckbox label="max">最大</ElCheckbox>
            </ElCheckboxGroup>
            <ElInput v-model="agg.label" placeholder="显示名称" class="w-32" size="small" />
            <ElButton type="danger" size="small" @click="removeAggregation(index)">删除</ElButton>
          </div>
          <ElButton type="primary" size="small" @click="addAggregation">
            <ArtSvgIcon icon="ri:add-line" class="mr-1" />添加聚合字段
          </ElButton>
        </ElFormItem>

        <ElFormItem>
          <ElButton type="primary" @click="handleAnalyze" :loading="loading">
            <ArtSvgIcon icon="ri:bar-chart-2-line" class="mr-2" />执行分析
          </ElButton>
          <ElButton @click="handleExport">
            <ArtSvgIcon icon="ri:download-line" class="mr-2" />导出结果
          </ElButton>
          <ElButton @click="saveConfig">
            <ArtSvgIcon icon="ri:save-line" class="mr-2" />保存配置
          </ElButton>
          <ElButton @click="resetConfig">重置</ElButton>
        </ElFormItem>
      </ElForm>
    </div>

    <!-- 分析结果 -->
    <div v-if="results.length > 0" class="statistics-panel">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">分析结果</h2>
        <ElTag type="info">显示 {{ visibleResults.length }}/{{ results.length }} 个分组</ElTag>
      </div>

      <ElTable
        :data="visibleResults"
        style="width: 100%"
        :loading="loading"
        max-height="600"
        @wheel.passive="onResultTableWheel"
      >
        <ElTableColumn
          v-if="config.groupBy !== 'none'"
          prop="分组维度"
          label="分组维度"
          width="150"
          fixed
        />
        <ElTableColumn prop="记录数" label="记录数" width="100" />

        <ElTableColumn
          v-for="(col, index) in resultColumns"
          :key="index"
          :prop="col"
          :label="col"
          min-width="120"
        />
      </ElTable>
      <div v-if="results.length > visibleResults.length" class="load-more-row">
        <ElButton @click="() => loadMoreResults()"
          >加载更多 {{ visibleResults.length }}/{{ results.length }}</ElButton
        >
      </div>
    </div>

    <!-- 空状态 -->
    <ElEmpty v-else description="请配置分析条件后点击「执行分析」" />

    <!-- 已保存的配置 -->
    <div class="statistics-panel mt-6">
      <h2 class="text-lg font-semibold mb-4 text-gray-900 dark:text-white">已保存的分析配置</h2>
      <div
        v-if="savedConfigs.length > 0"
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <div
          v-for="cfg in savedConfigs"
          :key="cfg.id"
          class="p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-400 cursor-pointer transition-colors"
          @click="loadConfig(cfg)"
        >
          <h3 class="font-medium text-gray-900 dark:text-white">{{ cfg.name }}</h3>
          <p class="text-sm text-gray-500 mt-1">
            {{ getScopeLabel(cfg.scope) }} · {{ getGroupByLabel(cfg.groupBy) }}
          </p>
          <div class="flex items-center justify-between mt-2">
            <ElButton type="primary" size="small" @click.stop="loadAndRunConfig(cfg)"
              >运行</ElButton
            >
            <ElButton type="danger" size="small" @click.stop="deleteSavedConfig(cfg.id)"
              >删除</ElButton
            >
          </div>
        </div>
      </div>
      <ElEmpty v-else description="暂无保存的配置" />
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, onMounted, computed } from 'vue'
  import { ElMessage } from 'element-plus'
  import * as flexibleExport from '@/utils/flexible-export'
  import * as databaseService from '@/services/database'
  import type { ExportConfig, Aggregation } from '@/utils/flexible-export'
  import { useLazyRenderWindow } from '@/hooks'

  interface AnalyzeConfig {
    scope: string
    targetType: string
    groupBy: string
    dateRange: { start: string; end: string }
    aggregations: Aggregation[]
    format: 'xlsx' | 'csv'
  }

  const loading = ref(false)
  const results = ref<Record<string, any>[]>([])
  const {
    visibleItems: visibleResults,
    loadMore: loadMoreResults,
    handleWheel: onResultTableWheel
  } = useLazyRenderWindow(results, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const savedConfigs = ref<any[]>([])

  const config = reactive<AnalyzeConfig>({
    scope: 'breeding',
    targetType: 'all',
    groupBy: 'parity',
    dateRange: { start: '', end: '' },
    aggregations: [{ field: 'id', functions: ['count'], label: '配种' }],
    format: 'xlsx'
  })

  const availableFields = computed(() => {
    const fieldMap: Record<string, Array<{ value: string; label: string }>> = {
      breeding: [
        { value: 'id', label: '记录ID' },
        { value: 'cowNumber', label: '牛号' },
        { value: 'pregnancyResult', label: '妊检结果' },
        { value: 'cost', label: '费用' },
        { value: 'offspringCount', label: '犊牛数量' }
      ],
      milk: [
        { value: 'volume', label: '产奶量' },
        { value: 'fat', label: '乳脂率' },
        { value: 'protein', label: '乳蛋白' },
        { value: 'lactose', label: '乳糖率' },
        { value: 'scc', label: '体细胞数' },
        { value: 'cost', label: '费用' }
      ],
      feed: [
        { value: 'actualAmount', label: '实际投喂量' },
        { value: 'plannedAmount', label: '计划投喂量' },
        { value: 'cost', label: '费用' }
      ],
      cow: [
        { value: 'parity', label: '胎次' },
        { value: 'daysInMilk', label: '泌乳天数' },
        { value: 'cowNumber', label: '牛号' }
      ],
      health: [
        { value: 'overallScore', label: '健康评分' },
        { value: 'temperatureScore', label: '体温评分' },
        { value: 'activityScore', label: '活动评分' }
      ]
    }
    return fieldMap[config.scope] || fieldMap.breeding
  })

  const resultColumns = computed(() => {
    if (results.value.length === 0) return []
    return Object.keys(results.value[0]).filter((col) => col !== '分组维度' && col !== '记录数')
  })

  function addAggregation() {
    config.aggregations.push({ field: 'id', functions: ['count'], label: '' })
  }

  function removeAggregation(index: number) {
    config.aggregations.splice(index, 1)
  }

  async function handleAnalyze() {
    loading.value = true
    try {
      const _exportConfig: ExportConfig = {
        id: 'temp-analysis',
        name: '临时分析',
        scope: config.scope,
        targetType: config.targetType,
        groupBy: config.groupBy as any,
        dateRange:
          config.dateRange.start && config.dateRange.end ? (config.dateRange as any) : undefined,
        aggregations: config.aggregations,
        columns: [],
        format: 'xlsx',
        createdAt: new Date().toISOString()
      }

      // 手动执行分析逻辑
      const tableName = getTableNameByScope(config.scope)
      const rawData = await databaseService.getTableDataAsync(tableName, { silent: true })
      if (!rawData || rawData.length === 0) {
        ElMessage.warning('没有可分析的数据')
        return
      }

      // 过滤
      let data = filterByTargetType(rawData, config.targetType)
      if (config.dateRange.start && config.dateRange.end) {
        data = data.filter((item) => {
          const date = new Date(
            item.createdAt || item.eventTime || item.milkingTime || item.feedTime
          )
          return date >= new Date(config.dateRange.start) && date <= new Date(config.dateRange.end)
        })
      }

      // 分组聚合
      const groups = flexibleExport.groupByDimension(
        data,
        config.groupBy,
        getTimeField(config.scope)
      )
      results.value = []

      for (const [groupName, groupData] of Object.entries(groups)) {
        const row: Record<string, any> = {}
        if (config.groupBy !== 'none') row['分组维度'] = groupName
        row['记录数'] = groupData.length

        for (const agg of config.aggregations) {
          const values = groupData.map((item) => flexibleExport.getFieldValue(item, agg.field))
          const aggResults = flexibleExport.aggregateValues(values, agg.functions)

          for (const [fn, value] of Object.entries(aggResults)) {
            const fnLabel = getAggregationLabel(fn)
            const colLabel = agg.label || agg.field
            row[`${colLabel}(${fnLabel})`] = fn === 'count' ? value : parseFloat(value.toFixed(2))
          }
        }

        results.value.push(row)
      }

      ElMessage.success(`分析完成，共 ${data.length} 条记录，${results.value.length} 个分组`)
    } catch (error) {
      console.error('分析失败:', error)
      ElMessage.error('分析失败')
    } finally {
      loading.value = false
    }
  }

  async function handleExport() {
    if (results.value.length === 0) {
      ElMessage.warning('请先执行分析')
      return
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const fileName = `统计分析_${config.scope}_${config.groupBy}_${timestamp}.xlsx`

    const ws = XLSX.utils.json_to_sheet(results.value)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '分析结果')
    XLSX.writeFile(wb, fileName)
  }

  async function saveConfig() {
    const name = prompt('请输入配置名称:')
    if (!name) return

    const exportConfig: ExportConfig = {
      id: `config-${Date.now()}`,
      name,
      scope: config.scope,
      targetType: config.targetType,
      groupBy: config.groupBy as any,
      dateRange:
        config.dateRange.start && config.dateRange.end ? (config.dateRange as any) : undefined,
      aggregations: config.aggregations,
      columns: [],
      format: 'xlsx',
      createdAt: new Date().toISOString()
    }

    await flexibleExport.saveExportConfig(exportConfig)
    ElMessage.success('配置已保存')
    await loadSavedConfigs()
  }

  async function loadConfig(cfg: any) {
    config.scope = cfg.scope
    config.targetType = cfg.targetType
    config.groupBy = cfg.groupBy
    config.aggregations = cfg.aggregations || []
    config.dateRange = cfg.dateRange || { start: '', end: '' }
    ElMessage.success('配置已加载')
  }

  async function loadAndRunConfig(cfg: any) {
    await loadConfig(cfg)
    await handleAnalyze()
  }

  async function deleteSavedConfig(id: string) {
    await flexibleExport.deleteExportConfig(id)
    ElMessage.success('配置已删除')
    await loadSavedConfigs()
  }

  async function loadSavedConfigs() {
    savedConfigs.value = await flexibleExport.getExportConfigs(config.scope)
  }

  function resetConfig() {
    config.scope = 'breeding'
    config.targetType = 'all'
    config.groupBy = 'parity'
    config.dateRange = { start: '', end: '' }
    config.aggregations = [{ field: 'id', functions: ['count'], label: '配种' }]
    results.value = []
  }

  function getScopeLabel(scope: string): string {
    const map: Record<string, string> = {
      cow: '牛只',
      breeding: '繁殖',
      milk: '产奶',
      feed: '饲料',
      health: '健康'
    }
    return map[scope] || scope
  }

  function getGroupByLabel(groupBy: string): string {
    const map: Record<string, string> = {
      none: '不分组',
      day: '按日',
      month: '按月',
      year: '按年',
      parity: '按胎次',
      pen: '按圈舍',
      breed: '按品种'
    }
    return map[groupBy] || groupBy
  }

  function getAggregationLabel(fn: string): string {
    const map: Record<string, string> = {
      count: '次数',
      sum: '合计',
      avg: '平均',
      min: '最小',
      max: '最大',
      median: '中位数'
    }
    return map[fn] || fn
  }

  function getTableNameByScope(scope: string): string {
    const map: Record<string, string> = {
      cow: 'cows',
      breeding: 'breeding-events',
      milk: 'milk-records',
      feed: 'feed-records',
      health: 'health-scores'
    }
    return map[scope] || 'cows'
  }

  function getTimeField(scope: string): string {
    const map: Record<string, string> = {
      cow: 'createdAt',
      breeding: 'eventTime',
      milk: 'milkingTime',
      feed: 'feedTime',
      health: 'timestamp'
    }
    return map[scope] || 'createdAt'
  }

  function filterByTargetType(data: any[], targetType: string): any[] {
    switch (targetType) {
      case 'lactating':
        return data.filter((c) => c.type === '成母牛' || c.type === '青年牛')
      case 'dry':
        return data.filter((c) => c.type === '干奶牛')
      case 'bulls':
        return data.filter((c) => c.type === '种公牛')
      case 'calves':
        return data.filter((c) => c.type === '犊牛')
      case 'heifers':
        return data.filter((c) => c.type === '小育成' || c.type === '大育成')
      case 'pregnant':
        return data.filter((c) => c.pregnancy === true || c.status === '预产')
      default:
        return data
    }
  }

  import * as XLSX from 'xlsx'

  onMounted(() => {
    void loadSavedConfigs()
  })

  defineOptions({ name: 'FlexibleAnalysis' })
</script>

<style scoped>
  .el-form-item__label {
    color: rgb(55 65 81);
  }
  .dark .el-form-item__label {
    color: rgb(209 213 219);
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 12px;
  }
</style>
