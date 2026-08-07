<template>
  <div class="database-page">
    <div class="database-head">
      <div>
        <h1>数据台账</h1>
      </div>

      <div class="head-actions">
        <ElTag type="success">{{ dataTables.length }} 张台账</ElTag>
        <ElButton type="primary" :loading="loading" @click="refreshAllData">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-2" />
          刷新统计
        </ElButton>
      </div>
    </div>

    <div class="toolbar">
      <ElInput
        v-model="tableKeyword"
        clearable
        class="w-72"
        placeholder="搜索台账名称、分组或表名"
      />
      <ElSelect v-model="selectedCategory" filterable class="w-56">
        <ElOption label="全部分组" value="all" />
        <ElOption
          v-for="category in tableCategories"
          :key="category"
          :label="category"
          :value="category"
        />
      </ElSelect>
      <ElSelect v-model="selectedTable" filterable class="w-72" @change="loadSelectedTable">
        <ElOption
          v-for="table in filteredTables"
          :key="table.key"
          :label="`${table.name} / ${table.key}`"
          :value="table.key"
        />
      </ElSelect>

      <div class="table-scope">
        当前表：{{ currentTable?.name || selectedTable }}，显示 {{ visibleTableData.length }}/{{
          tableData.length
        }}
        条
      </div>
    </div>

    <div
      ref="tableCardGridRef"
      class="table-card-grid"
      @scroll.passive="onTableCardScroll"
      @wheel.passive="onTableCardWheel"
    >
      <div
        v-for="table in visibleTableCards"
        :key="table.key"
        class="table-card"
        :class="{ active: selectedTable === table.key }"
        @click="selectTable(table.key)"
      >
        <div class="table-card-top">
          <div>
            <div class="table-category">{{ table.displayCategory || table.category }}</div>
            <div class="table-name">
              {{ table.name }}
            </div>
          </div>
          <ElTag size="small" :type="table.model === 'standard' ? 'success' : 'info'">
            {{ table.model === 'standard' ? '标准表' : '台账' }}
          </ElTag>
        </div>
        <div class="table-count">
          {{ tableCounts[table.key] ?? 0 }}
        </div>
        <div class="table-key">{{ table.key }}</div>
      </div>
    </div>

    <div class="toolbar">
      <ElButton :loading="loading" @click="loadSelectedTable">刷新当前表</ElButton>
      <ElButton type="primary" @click="openCreateDialog">新增记录</ElButton>
      <ElButton :disabled="!tableData.length" @click="exportCurrentTable">导出当前台账</ElButton>
      <ElButton
        v-if="filteredTables.length > visibleTableCards.length"
        link
        @click="() => loadMoreTableCards()"
      >
        加载更多台账 {{ visibleTableCards.length }}/{{ filteredTables.length }}
      </ElButton>
    </div>

    <div class="table-shell">
      <ElTable
        :data="visibleTableData"
        v-loading="loading"
        border
        stripe
        height="620"
        table-layout="auto"
        empty-text="当前台账暂无记录"
        @wheel.passive="onTableWheel"
      >
        <ElTableColumn
          v-for="column in visibleColumns"
          :key="column"
          :prop="column"
          :label="getColumnLabel(column)"
          min-width="140"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            {{ formatCell(row[column]) }}
          </template>
        </ElTableColumn>
        <ElTableColumn fixed="right" label="操作" width="150">
          <template #default="{ row }">
            <ElButton link type="primary" @click="openEditDialog(row)">编辑</ElButton>
            <ElButton link type="danger" @click="deleteRecord(row)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>
    <div v-if="tableData.length > visibleTableData.length" class="load-more-row">
      <ElButton @click="() => loadMoreTableRows()"
        >加载更多 {{ visibleTableData.length }}/{{ tableData.length }}</ElButton
      >
    </div>

    <ElDialog
      v-model="editDialogVisible"
      :title="editMode === 'create' ? '新增台账记录' : '编辑台账记录'"
      width="720px"
      destroy-on-close
    >
      <div class="record-editor">
        <div class="mb-3 text-sm text-gray-500 dark:text-gray-400">
          {{ currentTable?.name || selectedTable }} / {{ selectedTable }}
        </div>
        <ElInput
          v-model="recordJson"
          type="textarea"
          :autosize="{ minRows: 16, maxRows: 24 }"
          spellcheck="false"
          class="json-editor"
        />
      </div>
      <template #footer>
        <ElButton @click="editDialogVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="saving" @click="saveRecord">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import * as databaseService from '@/services/database'
  import { V2_DATABASE_TABLES } from '@/services/v2-database-tables'
  import { useLazyGridRenderWindow, useLazyRenderWindow } from '@/hooks'

  interface DataTableMeta {
    key: string
    name: string
    category: string
    displayCategory?: string
    model?: 'standard' | 'ledger'
  }

  const loading = ref(false)
  const saving = ref(false)
  const selectedTable = ref('cows')
  const selectedCategory = ref('all')
  const tableKeyword = ref('')
  const tableData = ref<any[]>([])
  const tableCounts = ref<Record<string, number>>({})
  const editDialogVisible = ref(false)
  const editMode = ref<'create' | 'edit'>('create')
  const editingRecordId = ref('')
  const recordJson = ref('')

  const legacyDataTables: DataTableMeta[] = [
    { key: 'cows', name: '牛只基础信息', category: '核心数据' },
    { key: 'sensors', name: '传感器数据', category: '核心数据' },
    { key: 'sensor-readings', name: '传感器长表', category: '核心数据' },
    { key: 'alerts', name: '预警记录', category: '核心数据' },
    { key: 'health-scores', name: '健康评分', category: '核心数据' },
    { key: 'persons', name: '人员', category: '基础资料' },
    { key: 'pens', name: '圈舍', category: '基础资料' },
    { key: 'diseases', name: '疾病字典', category: '基础资料' },
    { key: 'medicines', name: '药品字典', category: '基础资料' },
    { key: 'transfer-reasons', name: '转群原因', category: '基础资料' },
    { key: 'base-info-categories', name: '基础分类配置', category: '基础资料' },
    { key: 'phenotype-trait-definitions', name: '表型性状字典', category: '表型管理' },
    { key: 'phenotype-export-methods', name: '表型导出口径', category: '表型管理' },
    { key: 'phenotype-records', name: '表型采集记录', category: '表型管理' },
    { key: 'milk-records', name: '产奶记录', category: '生产管理' },
    { key: 'milk-quality-standards', name: '奶质标准', category: '生产管理' },
    { key: 'lactation-curves', name: '泌乳曲线', category: '生产管理' },
    { key: 'feed-records', name: '饲喂记录', category: '生产管理' },
    { key: 'feed-formulas', name: '饲料配方', category: '生产管理' },
    { key: 'feed-inventory', name: '饲料库存', category: '生产管理' },
    { key: 'breeding-records', name: '繁殖记录', category: '繁殖管理' },
    { key: 'reproduction-cycles', name: '繁殖周期', category: '繁殖管理' },
    { key: 'workflow-templates', name: '工作流模板', category: '自动化' },
    { key: 'workflow-instances', name: '工作流实例', category: '自动化' },
    { key: 'automated-actions', name: '自动化动作', category: '自动化' },
    { key: 'smart-transfer-rules', name: '智能转群规则', category: '自动化' },
    { key: 'reminder-rules', name: '提醒规则', category: '自动化' },
    { key: 'predictive-models', name: '预测模型', category: '预测分析' },
    { key: 'prediction-results', name: '预测结果', category: '预测分析' },
    { key: 'forecast-scenarios', name: '预测场景', category: '预测分析' },
    { key: 'predictive-alerts', name: '预测预警', category: '预测分析' },
    { key: 'hardware-devices', name: '硬件设备', category: '硬件集成' },
    { key: 'integration-protocols', name: '集成协议', category: '硬件集成' },
    { key: 'data-synchronizations', name: '数据同步', category: '硬件集成' },
    { key: 'hardware-alerts', name: '硬件告警', category: '硬件集成' },
    { key: 'entry-events', name: '入场事件', category: '事件记录' },
    { key: 'transfer-events', name: '转群事件', category: '事件记录' },
    { key: 'exit-events', name: '离场事件', category: '事件记录' },
    { key: 'breeding-events', name: '繁殖事件', category: '事件记录' },
    { key: 'veterinary-events', name: '兽医事件', category: '事件记录' },
    { key: 'export-audit-logs', name: '导出审计', category: '审计' },
    { key: 'operation-audit-logs', name: '旧版操作审计', category: '审计' }
  ]

  const dataTables: DataTableMeta[] = [
    ...legacyDataTables,
    ...V2_DATABASE_TABLES.map(({ key, name, category }) => ({
      key,
      name,
      category,
      displayCategory: category.replace(/^v2\s*/i, ''),
      model: 'standard' as const
    }))
  ]

  const currentTable = computed(() => dataTables.find((table) => table.key === selectedTable.value))
  const tableCategories = computed(() =>
    Array.from(new Set(dataTables.map((table) => table.displayCategory || table.category)))
  )
  const filteredTables = computed(() => {
    const keyword = tableKeyword.value.trim().toLowerCase()
    return dataTables.filter((table) => {
      const matchedCategory =
        selectedCategory.value === 'all' ||
        (table.displayCategory || table.category) === selectedCategory.value
      const matchedKeyword =
        !keyword ||
        table.key.toLowerCase().includes(keyword) ||
        table.name.toLowerCase().includes(keyword) ||
        table.category.toLowerCase().includes(keyword) ||
        (table.displayCategory || table.category).toLowerCase().includes(keyword)
      return matchedCategory && matchedKeyword
    })
  })
  const {
    containerRef: tableCardGridRef,
    visibleItems: visibleTableCards,
    loadMore: loadMoreTableCards,
    handleScroll: onTableCardScroll,
    handleWheel: onTableCardWheel
  } = useLazyGridRenderWindow(filteredTables, {
    rowCount: 2,
    minItemWidth: 260,
    gap: 16,
    fallbackColumns: 4,
    mode: 'fixed-window'
  })
  const {
    visibleItems: visibleTableData,
    loadMore: loadMoreTableRows,
    handleWheel: onTableWheel
  } = useLazyRenderWindow(tableData, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  watch(filteredTables, (tables) => {
    if (!tables.some((table) => table.key === selectedTable.value) && tables[0]) {
      selectedTable.value = tables[0].key
      loadSelectedTable()
    }
  })

  const hiddenColumns = new Set([
    'payload',
    'rawPayload',
    'raw_payload',
    'requestPayload',
    'request_payload',
    'resultPayload',
    'result_payload'
  ])

  const columnLabels: Record<string, string> = {
    id: '记录编号',
    animalId: '牛只编号',
    animal_id: '牛只编号',
    cowId: '牛只编号',
    cow_id: '牛只编号',
    animalNumber: '牛号',
    animal_number: '牛号',
    cowNumber: '牛号',
    cow_number: '牛号',
    earTagNumber: '耳标号',
    ear_tag_number: '耳标号',
    name: '名称',
    code: '编码',
    category: '类别',
    categoryName: '类别',
    category_name: '类别',
    status: '状态',
    breed: '品种',
    sex: '性别',
    gender: '性别',
    periodType: '周期类型',
    period_type: '周期类型',
    periodKey: '周期',
    period_key: '周期',
    parityNo: '胎次',
    parity_no: '胎次',
    traitId: '性状编号',
    trait_id: '性状编号',
    traitCode: '性状编码',
    trait_code: '性状编码',
    traitName: '性状名称',
    trait_name: '性状名称',
    observedAt: '观测时间',
    observed_at: '观测时间',
    numericValue: '数值',
    numeric_value: '数值',
    unit: '单位',
    operator: '操作人',
    operatorName: '操作人',
    operator_name: '操作人',
    createdAt: '创建时间',
    created_at: '创建时间',
    updatedAt: '更新时间',
    updated_at: '更新时间',
    startedAt: '开始时间',
    started_at: '开始时间',
    finishedAt: '完成时间',
    finished_at: '完成时间'
  }

  const visibleColumns = computed(() => {
    const keys = new Set<string>()
    tableData.value.forEach((row) => {
      Object.keys(row || {}).forEach((key) => keys.add(key))
    })
    const columns = Array.from(keys).filter((key) => !hiddenColumns.has(key))
    const idIndex = columns.indexOf('id')
    if (idIndex > 0) {
      columns.splice(idIndex, 1)
      columns.unshift('id')
    }
    return columns
  })

  const getColumnLabel = (column: string) => columnLabels[column] || column.replace(/_/g, ' ')

  const formatCell = (value: unknown) => {
    if (value === null || value === undefined || value === '') return '-'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  const loadTableData = async (tableKey: string) => {
    const rows = await databaseService.getTableDataAsync(tableKey, { silent: true })
    tableCounts.value[tableKey] = rows.length
    if (tableKey === selectedTable.value) {
      tableData.value = rows
    }
    return rows
  }

  const loadSelectedTable = async () => {
    loading.value = true
    try {
      await loadTableData(selectedTable.value)
    } catch (error) {
      console.error('加载数据表失败:', error)
      ElMessage.error('加载台账数据失败')
    } finally {
      loading.value = false
    }
  }

  const selectTable = async (tableKey: string) => {
    selectedTable.value = tableKey
    await loadSelectedTable()
  }

  const refreshAllData = async () => {
    loading.value = true
    try {
      tableCounts.value = await databaseService.getDataStatsAsync()
      await loadSelectedTable()
      ElMessage.success('数据台账统计已刷新')
    } catch (error) {
      console.error('刷新数据库失败:', error)
      ElMessage.error('刷新数据台账失败')
    } finally {
      loading.value = false
    }
  }

  const buildDefaultRecord = () => {
    const now = new Date().toISOString()
    return {
      id: `${selectedTable.value}-${Date.now()}`,
      status: 'active',
      createdAt: now,
      updatedAt: now
    }
  }

  const openCreateDialog = () => {
    editMode.value = 'create'
    editingRecordId.value = ''
    recordJson.value = JSON.stringify(buildDefaultRecord(), null, 2)
    editDialogVisible.value = true
  }

  const openEditDialog = (row: any) => {
    editMode.value = 'edit'
    editingRecordId.value = String(row?.id || '')
    recordJson.value = JSON.stringify(row || {}, null, 2)
    editDialogVisible.value = true
  }

  const parseRecordJson = () => {
    try {
      const parsed = JSON.parse(recordJson.value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('记录必须是 JSON 对象')
      }
      if (!parsed.id) parsed.id = `${selectedTable.value}-${Date.now()}`
      parsed.updatedAt = parsed.updatedAt || new Date().toISOString()
      if (editMode.value === 'create') parsed.createdAt = parsed.createdAt || parsed.updatedAt
      return parsed
    } catch (error: any) {
      throw new Error(error?.message || 'JSON 格式不正确')
    }
  }

  const saveRecord = async () => {
    saving.value = true
    try {
      const record = parseRecordJson()
      if (editMode.value === 'create') {
        await databaseService.addTableDataAsync(selectedTable.value, record)
      } else {
        await databaseService.updateTableRecordAsync(
          selectedTable.value,
          editingRecordId.value || record.id,
          record
        )
      }
      editDialogVisible.value = false
      await loadSelectedTable()
      ElMessage.success('台账记录已保存')
    } catch (error: any) {
      ElMessage.error(error?.message || '保存失败')
    } finally {
      saving.value = false
    }
  }

  const deleteRecord = async (row: any) => {
    const id = row?.id
    if (!id) {
      ElMessage.warning('当前记录没有 id，无法删除')
      return
    }
    try {
      await ElMessageBox.confirm(`确认删除记录 ${id}？`, '删除台账记录', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      })
      await databaseService.deleteTableRecordAsync(selectedTable.value, String(id))
      await loadSelectedTable()
      ElMessage.success('台账记录已删除')
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        ElMessage.error('删除失败')
      }
    }
  }

  const exportCurrentTable = () => {
    const blob = new Blob([JSON.stringify(tableData.value, null, 2)], {
      type: 'application/json;charset=utf-8'
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${selectedTable.value}-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  onMounted(async () => {
    await refreshAllData()
  })

  defineOptions({ name: 'DatabaseManagement' })
</script>

<style scoped>
  .database-page {
    min-height: 100%;
    padding: 18px;
    color: #0f172a;
  }

  .database-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }

  .database-head h1 {
    margin: 2px 0 0;
    font-size: 22px;
    line-height: 1.25;
    font-weight: 650;
    color: #0f172a;
  }

  .database-head p {
    margin: 6px 0 0;
    max-width: 760px;
    font-size: 13px;
    line-height: 1.6;
    color: #64748b;
  }

  .head-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 10px;
  }

  .table-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(236px, 1fr));
    gap: 12px;
    max-height: min(360px, 42vh);
    overflow-y: auto;
    overscroll-behavior: contain;
    margin-bottom: 16px;
    padding: 2px 2px 8px;
  }

  .table-card {
    cursor: pointer;
    min-height: 126px;
    border: 1px solid #d8e0ea;
    border-radius: 8px;
    padding: 13px;
    background: #fff;
    transition:
      border-color 0.16s ease,
      background-color 0.16s ease,
      box-shadow 0.16s ease;
  }

  .dark .table-card {
    background: rgb(15 23 42 / 76%);
    border-color: rgb(51 65 85 / 88%);
  }

  .table-card:hover,
  .table-card.active {
    border-color: #0f766e;
    background: #f8fafc;
    box-shadow: 0 8px 18px rgb(15 23 42 / 7%);
  }

  .dark .table-card:hover,
  .dark .table-card.active {
    background: rgb(30 41 59 / 78%);
    border-color: #14b8a6;
  }

  .table-card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .table-category,
  .table-key {
    min-width: 0;
    font-size: 12px;
    color: #64748b;
  }

  .table-name {
    margin-top: 3px;
    font-size: 15px;
    line-height: 1.4;
    font-weight: 650;
    color: #0f172a;
  }

  .table-count {
    margin-top: 14px;
    font-size: 26px;
    line-height: 1;
    font-weight: 680;
    color: #0f172a;
  }

  .table-key {
    margin-top: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 14px;
    padding: 12px;
    border: 1px solid #d8e0ea;
    border-radius: 8px;
    background: #fff;
  }

  .dark .toolbar {
    background: rgb(15 23 42 / 76%);
    border-color: rgb(51 65 85 / 88%);
  }

  .table-scope {
    margin-left: auto;
    font-size: 13px;
    color: #64748b;
  }

  .table-shell {
    min-width: 0;
    overflow: auto;
    border: 1px solid #d8e0ea;
    border-radius: 8px;
    background: #fff;
  }

  .dark .table-shell {
    background: rgb(15 23 42 / 76%);
    border-color: rgb(51 65 85 / 88%);
  }

  .record-editor :deep(.el-textarea__inner) {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
    line-height: 1.5;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding: 14px 0 4px;
  }

  .dark .database-page,
  .dark .database-head h1,
  .dark .table-name,
  .dark .table-count {
    color: #e5e7eb;
  }

  .dark .database-head p,
  .dark .table-category,
  .dark .table-key,
  .dark .table-scope {
    color: #94a3b8;
  }

  @media (max-width: 720px) {
    .database-page {
      padding: 12px;
    }

    .database-head {
      align-items: flex-start;
      flex-direction: column;
    }

    .head-actions,
    .toolbar :deep(.el-input),
    .toolbar :deep(.el-select) {
      width: 100%;
    }

    .table-scope {
      margin-left: 0;
    }
  }
</style>
