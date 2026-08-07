<template>
  <FcPageShell
    title="导出口径"
    status-label="口径状态"
    :status-value="`${activeMethods.length}/${methods.length} 启用`"
    primary-action-label="新增口径"
    primary-action-icon="ri:add-line"
    secondary-action-label="重置筛选"
    secondary-action-icon="ri:refresh-line"
    @primary-action="openCreateDialog"
    @secondary-action="resetFilters"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          label="口径总数"
          :value="methods.length"
          note="可用于任意表型性状导出"
          icon="ri:settings-5-line"
        />
        <FcMetricTile
          label="时间汇总"
          :value="timeMethods.length"
          note="日、月、年等时间维度"
          icon="ri:calendar-line"
          tone="teal"
        />
        <FcMetricTile
          label="胎次口径"
          :value="parityMethods.length"
          note="按胎次汇总生产表现"
          icon="ri:stack-line"
          tone="info"
        />
        <FcMetricTile
          label="泌乳期口径"
          :value="lactationMethods.length"
          note="305 天等泌乳期评价"
          icon="ri:drop-line"
          tone="warning"
        />
      </section>
    </template>

    <section class="method-config-layout">
      <FcPanel title="口径类别">
        <template #actions>
          <ElButton size="small" @click="openCategoryDialog">
            <ArtSvgIcon icon="ri:add-line" class="mr-1" />
            新增大类
          </ElButton>
        </template>
        <div class="category-stack">
          <button
            v-for="item in categoryCards"
            :key="item.name"
            type="button"
            :class="{ active: filters.category === item.name }"
            @click="filters.category = filters.category === item.name ? '' : item.name"
          >
            <span>{{ item.name }}</span>
            <strong>{{ item.count }}</strong>
            <small>{{ item.note }}</small>
          </button>
        </div>
      </FcPanel>

      <FcPanel title="口径参数">
        <div class="explain-stack">
          <article
            ><span>分组维度</span><p>决定按原始明细、日期、年份、胎次或单牛汇总。</p></article
          >
          <article
            ><span>聚合算法</span><p>支持合计、均值、最新值、最大值、最小值和计数。</p></article
          >
          <article><span>泌乳窗口</span><p>305 天等泌乳期口径按泌乳天数过滤后汇总。</p></article>
        </div>
      </FcPanel>
    </section>

    <FcPanel title="导出口径列表">
      <div class="filter-bar">
        <ElInput v-model="filters.keyword" clearable placeholder="搜索口径名称、编码、说明" />
        <ElSelect v-model="filters.groupBy" clearable placeholder="分组维度">
          <ElOption
            v-for="option in groupByOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </ElSelect>
        <ElSelect v-model="filters.status" clearable placeholder="状态">
          <ElOption label="启用" value="启用" />
          <ElOption label="停用" value="停用" />
        </ElSelect>
      </div>

      <div class="lazy-table-toolbar">
        <ElTag type="info" effect="light"
          >显示 {{ visibleMethods.length }}/{{ filteredMethods.length }} 项</ElTag
        >
      </div>
      <ElTable :data="visibleMethods" height="520" @wheel.passive="onMethodTableWheel">
        <ElTableColumn prop="name" label="口径名称" width="150" />
        <ElTableColumn prop="code" label="编码" width="170" />
        <ElTableColumn prop="category" label="类别" width="120">
          <template #default="{ row }"
            ><ElTag size="small">{{ row.category }}</ElTag></template
          >
        </ElTableColumn>
        <ElTableColumn label="分组/算法" width="160">
          <template #default="{ row }"
            >{{ getGroupByLabel(row.groupBy) }} ·
            {{ getAggregationLabel(row.aggregation) }}</template
          >
        </ElTableColumn>
        <ElTableColumn label="泌乳窗口" width="110">
          <template #default="{ row }">{{
            row.groupBy === 'lactation_305' ? `${row.lactationWindowDays} 天` : '-'
          }}</template>
        </ElTableColumn>
        <ElTableColumn prop="requiredFields" label="必备字段" min-width="220" />
        <ElTableColumn prop="description" label="说明" min-width="260" />
        <ElTableColumn prop="status" label="状态" width="90">
          <template #default="{ row }"
            ><ElTag :type="row.status === '启用' ? 'success' : 'info'">{{
              row.status
            }}</ElTag></template
          >
        </ElTableColumn>
        <ElTableColumn label="操作" width="140">
          <template #default="{ row }">
            <ElButton size="small" @click="openEditDialog(row)">编辑</ElButton>
            <ElButton
              size="small"
              :type="row.status === '启用' ? 'warning' : 'success'"
              @click="toggleStatus(row)"
            >
              {{ row.status === '启用' ? '停用' : '启用' }}
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <div v-if="filteredMethods.length > visibleMethods.length" class="load-more-row">
        <ElButton @click="() => loadMoreMethods()"
          >加载更多 {{ visibleMethods.length }}/{{ filteredMethods.length }}</ElButton
        >
      </div>
    </FcPanel>

    <ElDialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="min(720px, calc(100vw - 32px))"
      @closed="resetForm"
    >
      <ElForm label-width="120px">
        <ElFormItem label="口径名称"><ElInput v-model="form.name" /></ElFormItem>
        <ElFormItem label="字段编码"><ElInput v-model="form.code" /></ElFormItem>
        <ElFormItem label="类别">
          <ElSelect v-model="form.category" class="w-full">
            <ElOption
              v-for="category in categories"
              :key="category"
              :label="category"
              :value="category"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="分组维度">
          <ElSelect v-model="form.groupBy" class="w-full">
            <ElOption
              v-for="option in groupByOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="聚合算法">
          <ElSelect v-model="form.aggregation" class="w-full">
            <ElOption
              v-for="option in aggregationOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="时间粒度">
          <ElInput v-model="form.timeGranularity" placeholder="raw/day/month/year，可留空" />
        </ElFormItem>
        <ElFormItem label="泌乳窗口">
          <ElInputNumber v-model="form.lactationWindowDays" :min="1" :max="999" />
        </ElFormItem>
        <ElFormItem label="必备字段"><ElInput v-model="form.requiredFields" /></ElFormItem>
        <ElFormItem label="说明"
          ><ElInput v-model="form.description" type="textarea" :rows="3"
        /></ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="submitForm">保存</ElButton>
      </template>
    </ElDialog>

    <ElDialog
      v-model="categoryDialogVisible"
      title="新增口径大类"
      width="min(520px, calc(100vw - 32px))"
      @closed="resetCategoryForm"
    >
      <ElForm label-width="110px">
        <ElFormItem label="大类名称">
          <ElInput v-model="categoryForm.name" placeholder="如：季节汇总、试验批次、泌乳阶段" />
        </ElFormItem>
        <ElFormItem label="说明">
          <ElInput v-model="categoryForm.description" type="textarea" :rows="3" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="categoryDialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="submitCategoryForm">保存</ElButton>
      </template>
    </ElDialog>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import * as databaseService from '@/services/database'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import { useLazyRenderWindow } from '@/hooks'
  import {
    DEFAULT_PHENOTYPE_EXPORT_METHODS,
    type PhenotypeExportAggregation,
    type PhenotypeExportGroupBy,
    type PhenotypeExportMethodDefinition
  } from '@/views/germplasm/phenotype/export-method-definitions'

  const METHOD_TABLE = 'phenotype-export-methods'
  const CATEGORY_TABLE = 'base-info-categories'
  const CATEGORY_SCOPE = 'phenotype-export-methods'

  const groupByOptions: Array<{ label: string; value: PhenotypeExportGroupBy }> = [
    { label: '原始明细', value: 'raw' },
    { label: '按日', value: 'day' },
    { label: '按月', value: 'month' },
    { label: '按年', value: 'year' },
    { label: '按胎次', value: 'parity' },
    { label: '305 天泌乳期', value: 'lactation_305' },
    { label: '按单牛', value: 'cow' }
  ]

  const aggregationOptions: Array<{ label: string; value: PhenotypeExportAggregation }> = [
    { label: '原始值', value: 'raw' },
    { label: '合计', value: 'sum' },
    { label: '均值', value: 'mean' },
    { label: '最新值', value: 'latest' },
    { label: '最小值', value: 'min' },
    { label: '最大值', value: 'max' },
    { label: '记录数', value: 'count' }
  ]

  const methods = ref<PhenotypeExportMethodDefinition[]>([])
  const categories = ref<string[]>([])
  const filters = reactive({ keyword: '', category: '', groupBy: '', status: '' })
  const dialogVisible = ref(false)
  const categoryDialogVisible = ref(false)
  const editingId = ref('')
  const categoryForm = reactive({ name: '', description: '' })
  const form = reactive<PhenotypeExportMethodDefinition>({
    id: '',
    code: '',
    name: '',
    category: '时间汇总',
    groupBy: 'day',
    aggregation: 'mean',
    timeGranularity: 'day',
    lactationWindowDays: 305,
    requiredFields: '牛号、性状编码、采集日期、测定值',
    status: '启用',
    description: ''
  })

  const defaultCategories = Array.from(
    new Set(DEFAULT_PHENOTYPE_EXPORT_METHODS.map((item) => item.category))
  )
  const activeMethods = computed(() => methods.value.filter((item) => item.status === '启用'))
  const timeMethods = computed(() =>
    methods.value.filter((item) => ['day', 'month', 'year'].includes(item.groupBy))
  )
  const parityMethods = computed(() => methods.value.filter((item) => item.groupBy === 'parity'))
  const lactationMethods = computed(() =>
    methods.value.filter((item) => item.groupBy === 'lactation_305')
  )
  const dialogTitle = computed(() => `${editingId.value ? '编辑' : '新增'}导出口径`)

  const categoryCards = computed(() =>
    categories.value.map((category) => ({
      name: category,
      count: methods.value.filter((item) => item.category === category).length,
      note:
        category === '时间汇总'
          ? '按日、月、年等时间维度导出'
          : category === '胎次汇总'
            ? '按胎次评价单牛表现'
            : category === '泌乳期汇总'
              ? '按 305 天等泌乳窗口导出'
              : '自定义导出维度'
    }))
  )

  const filteredMethods = computed(() => {
    const keyword = filters.keyword.trim().toLowerCase()
    return methods.value.filter((method) => {
      const text = [method.name, method.code, method.category, method.description]
        .join(' ')
        .toLowerCase()
      return (
        (!keyword || text.includes(keyword)) &&
        (!filters.category || method.category === filters.category) &&
        (!filters.groupBy || method.groupBy === filters.groupBy) &&
        (!filters.status || method.status === filters.status)
      )
    })
  })
  const {
    visibleItems: visibleMethods,
    loadMore: loadMoreMethods,
    handleWheel: onMethodTableWheel
  } = useLazyRenderWindow(filteredMethods, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  function getGroupByLabel(value: string) {
    return groupByOptions.find((item) => item.value === value)?.label || value
  }

  function getAggregationLabel(value: string) {
    return aggregationOptions.find((item) => item.value === value)?.label || value
  }

  function resetFilters() {
    filters.keyword = ''
    filters.category = ''
    filters.groupBy = ''
    filters.status = ''
  }

  function resetForm() {
    editingId.value = ''
    const defaultCategory =
      filters.category && categories.value.includes(filters.category)
        ? filters.category
        : categories.value[0] || '时间汇总'
    Object.assign(form, {
      id: '',
      code: '',
      name: '',
      category: defaultCategory,
      groupBy: 'day',
      aggregation: 'mean',
      timeGranularity: 'day',
      lactationWindowDays: 305,
      requiredFields: '牛号、性状编码、采集日期、测定值',
      status: '启用',
      description: ''
    })
  }

  function resetCategoryForm() {
    categoryForm.name = ''
    categoryForm.description = ''
  }

  function openCreateDialog() {
    resetForm()
    dialogVisible.value = true
  }

  function openCategoryDialog() {
    resetCategoryForm()
    categoryDialogVisible.value = true
  }

  function openEditDialog(row: PhenotypeExportMethodDefinition) {
    Object.assign(form, row)
    editingId.value = row.id
    dialogVisible.value = true
  }

  function normalizeMethod(row: Record<string, any>): PhenotypeExportMethodDefinition {
    return {
      id: String(row.id || `method-${row.code || Date.now()}`),
      code: String(row.code || ''),
      name: String(row.name || ''),
      category: String(row.category || '时间汇总'),
      groupBy: String(row.groupBy || row.group_by || 'raw') as PhenotypeExportGroupBy,
      aggregation: String(row.aggregation || 'raw') as PhenotypeExportAggregation,
      timeGranularity: String(row.timeGranularity || row.time_granularity || ''),
      lactationWindowDays: Number(row.lactationWindowDays || row.lactation_window_days || 305),
      requiredFields: String(
        row.requiredFields || row.required_fields || '牛号、性状编码、采集日期、测定值'
      ),
      status: String(row.status || '启用') as PhenotypeExportMethodDefinition['status'],
      description: String(row.description || '')
    }
  }

  async function loadCategories() {
    const seedRows = defaultCategories.map((name, index) => ({
      id: `${CATEGORY_SCOPE}-category-${index + 1}`,
      scope: CATEGORY_SCOPE,
      name,
      description: '表型导出口径分类',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))
    try {
      const rows = await databaseService.getTableDataAsync(CATEGORY_TABLE, { silent: true })
      const scoped = rows
        .filter((row) => row.scope === CATEGORY_SCOPE)
        .map((row) => String(row.name || '').trim())
        .filter(Boolean)
      if (scoped.length) {
        categories.value = Array.from(new Set(scoped))
        return
      }
      await databaseService.addTableDataAsync(CATEGORY_TABLE, seedRows)
      categories.value = seedRows.map((row) => row.name)
    } catch {
      categories.value = defaultCategories
    }
  }

  async function loadMethods() {
    try {
      const rows = await databaseService.getTableDataAsync(METHOD_TABLE, { silent: true })
      if (rows.length) {
        methods.value = rows.map((row) => normalizeMethod(row))
        return
      }
      const seedRows = DEFAULT_PHENOTYPE_EXPORT_METHODS.map((item) => ({
        ...item,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))
      await databaseService.addTableDataAsync(METHOD_TABLE, seedRows)
      methods.value = (await databaseService.getTableDataAsync(METHOD_TABLE, { silent: true })).map(
        (row) => normalizeMethod(row)
      )
    } catch (error) {
      console.error('加载表型导出口径失败:', error)
      ElMessage.error('加载表型导出口径失败')
      methods.value = DEFAULT_PHENOTYPE_EXPORT_METHODS.map((item) => ({ ...item }))
    }
  }

  async function submitCategoryForm() {
    const name = categoryForm.name.trim()
    if (!name) {
      ElMessage.warning('口径大类名称不能为空')
      return
    }
    if (categories.value.includes(name)) {
      ElMessage.warning('口径大类已存在')
      return
    }
    const payload = {
      id: `${CATEGORY_SCOPE}-category-${Date.now()}`,
      scope: CATEGORY_SCOPE,
      name,
      description: categoryForm.description.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    try {
      await databaseService.addTableDataAsync(CATEGORY_TABLE, payload)
    } catch (error) {
      console.error('新增口径大类失败:', error)
      ElMessage.error('新增口径大类失败，请检查数据库连接')
      return
    }
    categories.value.push(name)
    form.category = name
    filters.category = name
    categoryDialogVisible.value = false
    ElMessage.success('口径大类已新增')
  }

  async function submitForm() {
    const payload = {
      ...form,
      id: editingId.value || `method-${Date.now()}`,
      code: String(form.code || '').trim(),
      name: String(form.name || '').trim(),
      category: String(form.category || '').trim()
    }
    if (!payload.name || !payload.code) {
      ElMessage.warning('口径名称和字段编码不能为空')
      return
    }
    const duplicated = methods.value.some(
      (method) =>
        method.id !== editingId.value &&
        method.code.trim().toLowerCase() === payload.code.toLowerCase()
    )
    if (duplicated) {
      ElMessage.warning('字段编码已存在，请使用唯一编码')
      return
    }
    try {
      if (editingId.value) {
        await databaseService.updateTableRecordAsync(METHOD_TABLE, editingId.value, {
          ...payload,
          updatedAt: new Date().toISOString()
        })
      } else {
        await databaseService.addTableDataAsync(METHOD_TABLE, {
          ...payload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      }
      methods.value = (await databaseService.getTableDataAsync(METHOD_TABLE, { silent: true })).map(
        (row) => normalizeMethod(row)
      )
      dialogVisible.value = false
      ElMessage.success('表型导出口径已保存')
    } catch (error) {
      console.error('保存表型导出口径失败:', error)
      ElMessage.error('保存表型导出口径失败')
    }
  }

  async function toggleStatus(row: PhenotypeExportMethodDefinition) {
    const status = row.status === '启用' ? '停用' : '启用'
    try {
      await databaseService.updateTableRecordAsync(METHOD_TABLE, row.id, {
        ...row,
        status,
        updatedAt: new Date().toISOString()
      })
      methods.value = methods.value.map((item) => (item.id === row.id ? { ...item, status } : item))
      ElMessage.success(`${row.name} 已${status}`)
    } catch (error) {
      console.error('更新表型导出口径状态失败:', error)
      ElMessage.error('更新表型导出口径状态失败')
    }
  }

  onMounted(async () => {
    await loadCategories()
    await loadMethods()
  })

  defineOptions({ name: 'PhenotypeExportMethodManagement' })
</script>

<style scoped lang="scss">
  .fc-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }

  .method-config-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 18px;
    align-items: start;
  }

  .category-stack,
  .explain-stack {
    display: grid;
    gap: 12px;
  }

  .category-stack {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .category-stack button,
  .explain-stack article {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 14px;
    text-align: left;
    background: rgb(255 255 255 / 42%);
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .category-stack button {
    cursor: pointer;
  }

  .category-stack button.active,
  .category-stack button:hover {
    background: rgb(var(--fluent-primary-rgb) / 10%);
    border-color: var(--fluent-border-strong);
  }

  .category-stack span,
  .explain-stack span {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .category-stack strong {
    color: var(--fluent-text);
    font-size: clamp(20px, 1.8vw, 23px);
    font-weight: 780;
  }

  .category-stack small,
  .explain-stack p {
    margin: 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
    line-height: 1.6;
  }

  .filter-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 180px 140px;
    gap: 10px;
    margin-bottom: 14px;
  }

  .lazy-table-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 10px;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 14px;
  }

  @media (max-width: 1180px) {
    .fc-metric-grid,
    .method-config-layout,
    .category-stack {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .method-config-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .fc-metric-grid,
    .category-stack,
    .filter-bar {
      grid-template-columns: 1fr;
    }
  }
</style>
