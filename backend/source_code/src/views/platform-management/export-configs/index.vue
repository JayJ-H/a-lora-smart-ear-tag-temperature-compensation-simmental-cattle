<template>
  <div class="export-config-page">
    <div class="export-config-head">
      <div>
        <h1>导出配置管理</h1>
        <p>管理已保存的导出模板，模板只负责配置，日常执行统一回到信息导出入口。</p>
      </div>
    </div>

    <!-- 预设模板 -->
    <div class="config-section">
      <div class="section-title">
        <h2>预设模板</h2>
      </div>
      <div class="preset-grid">
        <div
          v-for="(tpl, index) in presets"
          :key="index"
          class="template-card"
          @click="usePreset(tpl)"
        >
          <h3>{{ tpl.name }}</h3>
          <p>{{ getPresetDesc(tpl) }}</p>
          <ElTag size="small" type="info" class="mt-2">{{
            !tpl.groupBy || tpl.groupBy === 'none'
              ? '不分组'
              : `按${getGroupByLabel(tpl.groupBy)}分组`
          }}</ElTag>
        </div>
      </div>
    </div>

    <!-- 已保存的配置 -->
    <div class="config-section">
      <div class="section-title">
        <h2>已保存的配置</h2>
      </div>
      <div class="lazy-table-toolbar">
        <ElTag type="info" effect="light"
          >显示 {{ visibleSavedConfigs.length }}/{{ savedConfigs.length }} 条</ElTag
        >
      </div>
      <div class="config-table-shell">
        <ElTable
          :data="visibleSavedConfigs"
          table-layout="auto"
          style="width: 100%"
          @wheel.passive="onConfigTableWheel"
        >
          <ElTableColumn prop="name" label="配置名称" width="200" show-overflow-tooltip />
          <ElTableColumn prop="scope" label="数据范围" width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ getScopeLabel(row.scope) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="targetType" label="牛群类型" width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ getTargetTypeLabel(row.targetType) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="groupBy" label="分组维度" width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ getGroupByLabel(row.groupBy) }}</template>
          </ElTableColumn>
          <ElTableColumn label="聚合字段" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <ElTag
                v-for="agg in row.aggregations || []"
                :key="agg.field"
                size="small"
                class="mr-1"
              >
                {{ agg.label || agg.field }}({{ agg.functions?.join('/') }})
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn label="操作" width="160">
            <template #default="{ row }">
              <ElButton type="primary" size="small" @click="executeConfig(row)">执行导出</ElButton>
              <ElButton type="danger" size="small" @click="deleteConfig(row.id)">删除</ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
      <div v-if="savedConfigs.length > visibleSavedConfigs.length" class="load-more-row">
        <ElButton @click="() => loadMoreSavedConfigs()"
          >加载更多 {{ visibleSavedConfigs.length }}/{{ savedConfigs.length }}</ElButton
        >
      </div>
      <ElEmpty v-if="savedConfigs.length === 0" description="暂无保存的配置" />
    </div>

    <!-- 使用预设对话框 -->
    <ElDialog
      v-model="showPresetDialog"
      title="使用预设模板"
      width="min(600px, calc(100vw - 32px))"
    >
      <ElForm :model="presetForm" label-width="120px">
        <ElFormItem label="模板名称">
          <ElInput v-model="presetForm.name" />
        </ElFormItem>
        <ElFormItem label="开始日期">
          <ElDatePicker
            v-model="presetForm.dateRange.start"
            type="date"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            class="w-full"
          />
        </ElFormItem>
        <ElFormItem label="结束日期">
          <ElDatePicker
            v-model="presetForm.dateRange.end"
            type="date"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            class="w-full"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="showPresetDialog = false">取消</ElButton>
        <ElButton type="primary" @click="confirmPreset">保存并导出</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, onMounted } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import * as flexibleExport from '@/utils/flexible-export'
  import type { ExportConfig } from '@/utils/flexible-export'
  import { useLazyRenderWindow } from '@/hooks'

  const savedConfigs = ref<any[]>([])
  const {
    visibleItems: visibleSavedConfigs,
    loadMore: loadMoreSavedConfigs,
    handleWheel: onConfigTableWheel
  } = useLazyRenderWindow(savedConfigs, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const showPresetDialog = ref(false)
  const currentPreset = ref<any>(null)

  const presetForm = reactive({
    name: '',
    dateRange: { start: '', end: '' }
  })

  const presets = flexibleExport.PRESET_EXPORT_TEMPLATES

  function getPresetDesc(tpl: any): string {
    const map: Record<string, string> = {
      按胎次配种统计: '按胎次统计每胎配种次数，分析繁殖效率',
      按月产奶量统计: '按月统计产奶量合计、平均、最大、最小值',
      按年繁殖效率: '按年统计配种次数和妊检次数',
      牛群状态统计: '统计当前牛群各状态分布'
    }
    return map[tpl.name] || ''
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

  function getTargetTypeLabel(type: string): string {
    const map: Record<string, string> = {
      all: '全部',
      lactating: '泌乳牛',
      dry: '干奶牛',
      bulls: '种公牛',
      calves: '犊牛',
      heifers: '育成牛',
      pregnant: '预产牛'
    }
    return map[type] || type
  }

  function getGroupByLabel(groupBy: string | undefined): string {
    const map: Record<string, string> = {
      none: '不分组',
      day: '日',
      month: '月',
      year: '年',
      parity: '胎次',
      pen: '圈舍',
      breed: '品种'
    }
    return groupBy ? map[groupBy] || groupBy : '不分组'
  }

  function usePreset(tpl: any) {
    currentPreset.value = tpl
    presetForm.name = tpl.name
    presetForm.dateRange = { start: '', end: '' }
    showPresetDialog.value = true
  }

  async function confirmPreset() {
    if (!currentPreset.value) return

    const config: ExportConfig = {
      id: `preset-${Date.now()}`,
      name: presetForm.name,
      scope: currentPreset.value.scope,
      targetType: currentPreset.value.targetType,
      groupBy: currentPreset.value.groupBy,
      dateRange:
        presetForm.dateRange.start && presetForm.dateRange.end
          ? (presetForm.dateRange as any)
          : undefined,
      aggregations: currentPreset.value.aggregations || [],
      columns: currentPreset.value.columns || [],
      format: currentPreset.value.format || 'xlsx',
      createdAt: new Date().toISOString()
    }

    await flexibleExport.saveExportConfig(config)
    await flexibleExport.executeExport(config)
    ElMessage.success('已保存并导出')
    showPresetDialog.value = false
    await loadConfigs()
  }

  async function executeConfig(config: any) {
    await flexibleExport.executeExport(config)
  }

  async function deleteConfig(id: string) {
    await ElMessageBox.confirm('确定删除此导出配置？', '确认删除', { type: 'warning' })
    await flexibleExport.deleteExportConfig(id)
    ElMessage.success('已删除')
    await loadConfigs()
  }

  async function loadConfigs() {
    savedConfigs.value = await flexibleExport.getExportConfigs()
  }

  onMounted(() => {
    void loadConfigs()
  })

  defineOptions({ name: 'ExportConfigsManagement' })
</script>

<style scoped>
  .export-config-page {
    padding: 18px;
    color: #0f172a;
  }

  .export-config-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }

  .export-config-head h1 {
    margin: 2px 0 0;
    font-size: 22px;
    line-height: 1.25;
    font-weight: 650;
    color: #0f172a;
  }

  .export-config-head p {
    margin: 6px 0 0;
    max-width: 720px;
    font-size: 13px;
    line-height: 1.6;
    color: #64748b;
  }

  .config-section {
    margin-bottom: 16px;
  }

  .section-title {
    margin-bottom: 10px;
  }

  .section-title h2 {
    margin: 0;
    font-size: 16px;
    line-height: 1.35;
    font-weight: 650;
    color: #0f172a;
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 12px;
  }

  .template-card {
    min-width: 0;
    min-height: 122px;
    padding: 13px;
    cursor: pointer;
    background: #fff;
    border: 1px solid #d8e0ea;
    border-radius: 8px;
    transition:
      background-color 160ms ease,
      border-color 160ms ease;
  }

  .template-card:hover {
    background: rgb(248 250 252);
    border-color: #0f766e;
  }

  .template-card h3 {
    margin: 0;
    font-size: 15px;
    line-height: 1.4;
    font-weight: 650;
    color: #0f172a;
  }

  .template-card p {
    margin: 5px 0 8px;
    min-height: 38px;
    font-size: 13px;
    line-height: 1.45;
    color: #64748b;
  }

  .config-table-shell {
    max-width: 100%;
    overflow: auto;
    border: 1px solid #d8e0ea;
    border-radius: 8px;
    background: #fff;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 12px;
  }

  .el-form-item__label {
    color: rgb(55 65 81);
  }
  .dark .el-form-item__label {
    color: rgb(209 213 219);
  }

  .lazy-table-toolbar {
    display: flex;
    justify-content: flex-end;
    margin: 0 0 10px;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 14px;
  }

  :global(.dark) .export-config-page,
  :global(.dark) .export-config-head h1,
  :global(.dark) .section-title h2,
  :global(.dark) .template-card h3 {
    color: #e5e7eb;
  }

  :global(.dark) .export-config-head p,
  :global(.dark) .template-card p {
    color: #94a3b8;
  }

  :global(.dark) .template-card,
  :global(.dark) .config-table-shell {
    background: rgb(15 23 42 / 76%);
    border-color: rgb(51 65 85 / 88%);
  }

  :global(.dark) .template-card:hover {
    background: rgb(30 41 59 / 78%);
    border-color: #14b8a6;
  }

  @media (max-width: 640px) {
    .export-config-page {
      padding: 12px;
    }
  }
</style>
