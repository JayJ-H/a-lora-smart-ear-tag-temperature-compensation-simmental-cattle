<template>
  <FcPageShell
    title="数值性状"
    status-label="配置状态"
    :status-value="`${activeTraits.length}/${traits.length} 启用`"
    primary-action-label="新增性状"
    primary-action-icon="ri:add-line"
    secondary-action-label="重置筛选"
    secondary-action-icon="ri:refresh-line"
    @primary-action="openCreateDialog"
    @secondary-action="resetFilters"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          label="性状总数"
          :value="traits.length"
          note="可直接采集或导入的数值字段"
          icon="ri:list-settings-line"
        />
        <FcMetricTile
          label="体尺性状"
          :value="bodyMeasureTraits.length"
          note="内置 24 项牛只体尺测量"
          icon="ri:ruler-2-line"
          tone="teal"
        />
        <FcMetricTile
          label="自动导入"
          :value="autoImportTraits.length"
          note="传感器、奶厅或批量导入来源"
          icon="ri:download-cloud-line"
          tone="info"
        />
        <FcMetricTile
          label="关联组学"
          :value="omicsLinkedTraits.length"
          note="可进入组学与系谱联合分析"
          icon="ri:node-tree"
          tone="warning"
        />
      </section>
    </template>

    <section class="trait-config-layout">
      <FcPanel title="性状类别">
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

      <FcPanel title="配置说明">
        <div class="explain-stack">
          <article>
            <span>必填字段</span>
          </article>
          <article>
            <span>可自定义</span>
          </article>
          <article>
            <span>关联分析</span>
          </article>
        </div>
      </FcPanel>
    </section>

    <FcPanel title="数值性状列表">
      <div class="filter-bar">
        <ElInput v-model="filters.keyword" clearable placeholder="搜索性状名称、编码、来源" />
        <ElSelect v-model="filters.source" clearable placeholder="采集来源">
          <ElOption label="人工采集" value="人工采集" />
          <ElOption label="传感器导入" value="传感器导入" />
          <ElOption label="奶厅导入" value="奶厅导入" />
          <ElOption label="批量导入" value="批量导入" />
          <ElOption label="实验检测" value="实验检测" />
        </ElSelect>
        <ElSelect v-model="filters.status" clearable placeholder="状态">
          <ElOption label="启用" value="启用" />
          <ElOption label="停用" value="停用" />
        </ElSelect>
      </div>

      <div class="lazy-table-toolbar">
        <ElTag type="info" effect="light"
          >显示 {{ visibleTraits.length }}/{{ filteredTraits.length }} 项</ElTag
        >
      </div>
      <ElTable :data="visibleTraits" height="520" @wheel.passive="onTraitTableWheel">
        <ElTableColumn prop="name" label="性状名称" width="150" />
        <ElTableColumn prop="code" label="编码" width="170" />
        <ElTableColumn prop="category" label="类别" width="120">
          <template #default="{ row }"
            ><ElTag size="small">{{ row.category }}</ElTag></template
          >
        </ElTableColumn>
        <ElTableColumn label="单位/类型" width="130">
          <template #default="{ row }">{{ row.unit || '-' }} · {{ row.dataType }}</template>
        </ElTableColumn>
        <ElTableColumn prop="source" label="采集来源" width="130" />
        <ElTableColumn prop="requiredFields" label="必填字段" min-width="220" />
        <ElTableColumn prop="linkedDomains" label="关联域" min-width="220" />
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
      <div v-if="filteredTraits.length > visibleTraits.length" class="load-more-row">
        <ElButton @click="() => loadMoreTraits()"
          >加载更多 {{ visibleTraits.length }}/{{ filteredTraits.length }}</ElButton
        >
      </div>
    </FcPanel>

    <ElDialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="min(680px, calc(100vw - 32px))"
      @closed="resetForm"
    >
      <ElForm label-width="110px">
        <ElFormItem label="性状名称"><ElInput v-model="form.name" /></ElFormItem>
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
        <ElFormItem label="单位/类型">
          <div class="form-inline">
            <ElInput v-model="form.unit" placeholder="单位" />
            <ElSelect v-model="form.dataType" placeholder="类型">
              <ElOption label="数值" value="数值" />
              <ElOption label="等级" value="等级" />
              <ElOption label="文本" value="文本" />
            </ElSelect>
          </div>
        </ElFormItem>
        <ElFormItem label="采集来源">
          <ElSelect v-model="form.source" class="w-full">
            <ElOption label="人工采集" value="人工采集" />
            <ElOption label="传感器导入" value="传感器导入" />
            <ElOption label="奶厅导入" value="奶厅导入" />
            <ElOption label="批量导入" value="批量导入" />
            <ElOption label="实验检测" value="实验检测" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="事实来源表">
          <ElSelect
            v-model="form.sourceTable"
            filterable
            allow-create
            default-first-option
            class="w-full"
          >
            <ElOption label="统一表型观测 trait_observation" value="trait_observation" />
            <ElOption label="奶厅测量 milk_measurement" value="milk_measurement" />
            <ElOption label="旧表型记录 phenotype-records" value="phenotype-records" />
            <ElOption label="旧产奶记录 milk-records" value="milk-records" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="字段映射">
          <div class="mapping-grid">
            <ElInput
              v-model="form.sourceAnimalField"
              placeholder="牛只字段，如 animalId / cowId / cowNumber"
            />
            <ElInput
              v-model="form.sourceTraitField"
              placeholder="性状字段，如 traitCode；奶厅固定列可留空"
            />
            <ElInput
              v-model="form.sourceValueField"
              placeholder="值字段，如 value / numericValue / milkYield"
            />
            <ElInput
              v-model="form.sourceDateField"
              placeholder="日期字段，如 collectionDate / measuredAt"
            />
            <ElInput v-model="form.sourceParityField" placeholder="胎次字段，如 parity，可留空" />
            <ElInput v-model="form.sourceDimField" placeholder="DIM字段，如 daysInMilk，可留空" />
          </div>
        </ElFormItem>
        <ElFormItem label="必填字段">
          <ElCheckboxGroup v-model="requiredFieldSelection" class="check-grid">
            <ElCheckbox v-for="item in requiredFieldOptions" :key="item" :label="item" />
          </ElCheckboxGroup>
        </ElFormItem>
        <ElFormItem label="关联数据">
          <ElCheckboxGroup v-model="linkedDomainSelection" class="check-grid">
            <ElCheckbox v-for="item in linkedDomainOptions" :key="item" :label="item" />
          </ElCheckboxGroup>
        </ElFormItem>
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
      title="新增数值性状大类"
      width="min(520px, calc(100vw - 32px))"
      @closed="resetCategoryForm"
    >
      <ElForm label-width="110px">
        <ElFormItem label="大类名称">
          <ElInput v-model="categoryForm.name" placeholder="如：肉用性能、抗病性状、屠宰性状" />
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
  import { computed, onMounted, reactive, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import * as databaseService from '@/services/database'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import { useLazyRenderWindow } from '@/hooks'
  import {
    DEFAULT_PHENOTYPE_TRAITS,
    type PhenotypeTraitCategory,
    type PhenotypeTraitDefinition
  } from '@/views/germplasm/phenotype/trait-definitions'

  const TRAIT_TABLE = 'phenotype-trait-definitions'
  const CATEGORY_TABLE = 'base-info-categories'
  const CATEGORY_SCOPE = 'phenotype-trait-definitions'
  const traits = ref<PhenotypeTraitDefinition[]>([])
  const categories = ref<string[]>([])
  const filters = reactive({ keyword: '', category: '', source: '', status: '' })
  const dialogVisible = ref(false)
  const categoryDialogVisible = ref(false)
  const editingId = ref('')
  const categoryForm = reactive({ name: '', description: '' })
  const requiredFieldSelection = ref<string[]>([])
  const linkedDomainSelection = ref<string[]>([])
  const form = reactive<PhenotypeTraitDefinition>({
    id: '',
    code: '',
    name: '',
    category: '体尺性状',
    unit: '',
    dataType: '数值',
    source: '人工采集',
    sourceTable: 'trait_observation',
    sourceAnimalField: 'animalId',
    sourceTraitField: 'traitCode',
    sourceValueField: 'value',
    sourceDateField: 'collectionDate',
    sourceParityField: 'parity',
    sourceDimField: 'daysInMilk',
    requiredFields: '牛号、采集日期、采集人、测量值',
    linkedDomains: '个体档案、系谱、组学样本',
    status: '启用',
    description: ''
  })

  const defaultCategories = Array.from(
    new Set(DEFAULT_PHENOTYPE_TRAITS.map((trait) => trait.category))
  )
  const activeTraits = computed(() => traits.value.filter((trait) => trait.status === '启用'))
  const bodyMeasureTraits = computed(() =>
    traits.value.filter((trait) => trait.category === '体尺性状')
  )
  const autoImportTraits = computed(() =>
    traits.value.filter((trait) =>
      ['传感器导入', '奶厅导入', '批量导入', '实验检测'].includes(trait.source)
    )
  )
  const omicsLinkedTraits = computed(() =>
    traits.value.filter((trait) => trait.linkedDomains.includes('组学'))
  )
  const dialogTitle = computed(() => `${editingId.value ? '编辑' : '新增'}数值性状`)
  const requiredFieldOptions = computed(() => recommendedRequiredFields())
  const linkedDomainOptions = computed(() => recommendedLinkedDomains())

  const categoryCards = computed(() =>
    categories.value.map((category) => ({
      name: category,
      count: traits.value.filter((trait) => trait.category === category).length,
      note:
        category === '体尺性状'
          ? '体高、体斜长、胸围等 24 项体尺'
          : category === '泌乳性能'
            ? '产奶量、乳脂、乳蛋白和奶质'
            : '生长、健康、繁殖和行为相关性状'
    }))
  )

  const filteredTraits = computed(() => {
    const keyword = filters.keyword.trim().toLowerCase()
    return traits.value.filter((trait) => {
      const text = [trait.name, trait.code, trait.category, trait.source, trait.linkedDomains]
        .join(' ')
        .toLowerCase()
      return (
        (!keyword || text.includes(keyword)) &&
        (!filters.category || trait.category === filters.category) &&
        (!filters.source || trait.source === filters.source) &&
        (!filters.status || trait.status === filters.status)
      )
    })
  })
  const {
    visibleItems: visibleTraits,
    loadMore: loadMoreTraits,
    handleWheel: onTraitTableWheel
  } = useLazyRenderWindow(filteredTraits, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  function resetFilters() {
    filters.keyword = ''
    filters.category = ''
    filters.source = ''
    filters.status = ''
  }

  function resetForm() {
    editingId.value = ''
    const defaultCategory =
      filters.category && categories.value.includes(filters.category)
        ? filters.category
        : categories.value[0] || '体尺性状'
    Object.assign(form, {
      id: '',
      code: '',
      name: '',
      category: defaultCategory as PhenotypeTraitCategory,
      unit: '',
      dataType: '数值',
      source: '人工采集',
      sourceTable: 'trait_observation',
      sourceAnimalField: 'animalId',
      sourceTraitField: 'traitCode',
      sourceValueField: 'value',
      sourceDateField: 'collectionDate',
      sourceParityField: 'parity',
      sourceDimField: 'daysInMilk',
      requiredFields: '牛号、采集日期、采集人、测量值',
      linkedDomains: '个体档案、系谱、组学样本',
      status: '启用',
      description: ''
    })
    syncSelectionsFromForm()
  }

  function openCreateDialog() {
    resetForm()
    dialogVisible.value = true
  }

  function resetCategoryForm() {
    categoryForm.name = ''
    categoryForm.description = ''
  }

  function openCategoryDialog() {
    resetCategoryForm()
    categoryDialogVisible.value = true
  }

  function openEditDialog(row: PhenotypeTraitDefinition) {
    Object.assign(form, row)
    syncSelectionsFromForm()
    editingId.value = row.id
    dialogVisible.value = true
  }

  function splitTextList(value: unknown) {
    return String(value || '')
      .split(/[、,，;]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function syncSelectionsFromForm() {
    requiredFieldSelection.value = splitTextList(
      form.requiredFields || recommendedRequiredFields().join('、')
    )
    linkedDomainSelection.value = splitTextList(
      form.linkedDomains || recommendedLinkedDomains().join('、')
    )
  }

  function recommendedRequiredFields() {
    const base = ['牛号', '采集日期', '测定值']
    const source = String(form.source || '')
    const category = String(form.category || '')
    if (source === '人工采集') base.push('采集人')
    if (['传感器导入', '奶厅导入'].includes(source))
      base.push(source === '奶厅导入' ? '奶厅设备' : '传感器编号')
    if (source === '实验检测') base.push('样本编号')
    if (category.includes('泌乳') || source === '奶厅导入') base.push('胎次', '泌乳天数')
    return Array.from(new Set(base))
  }

  function recommendedLinkedDomains() {
    const domains = ['个体档案', '系谱']
    const source = String(form.source || '')
    const category = String(form.category || '')
    if (category.includes('泌乳') || source === '奶厅导入') domains.push('泌乳记录', '奶厅设备')
    if (source === '传感器导入') domains.push('传感器记录')
    if (source === '实验检测') domains.push('样本记录')
    if (category.includes('健康')) domains.push('健康记录')
    domains.push('组学样本')
    return Array.from(new Set(domains))
  }

  async function loadTraits() {
    try {
      const rows = await databaseService.getTableDataAsync(TRAIT_TABLE, { silent: true })
      if (rows.length) {
        const merged = await ensureDefaultTraitRows(rows)
        traits.value = merged.map((row) => normalizeTrait(row))
        return
      }
      const seedRows = DEFAULT_PHENOTYPE_TRAITS.map((trait) => ({
        ...trait,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))
      await databaseService.addTableDataAsync(TRAIT_TABLE, seedRows)
      traits.value = (await databaseService.getTableDataAsync(TRAIT_TABLE, { silent: true })).map(
        (row) => normalizeTrait(row)
      )
    } catch (error) {
      console.error('加载数值性状失败:', error)
      ElMessage.error('加载数值性状失败')
      traits.value = DEFAULT_PHENOTYPE_TRAITS.map((trait) => ({ ...trait }))
    }
  }

  async function ensureDefaultTraitRows(rows: any[]) {
    const existingCodes = new Set(
      rows
        .map((row) => String(row.code || row.traitCode || row.trait_code || '').trim())
        .filter(Boolean)
    )
    const missing = DEFAULT_PHENOTYPE_TRAITS.filter((trait) => !existingCodes.has(trait.code)).map(
      (trait) => ({
        ...trait,
        sourceTable: trait.sourceTable || defaultSourceTableForTrait(trait),
        sourceAnimalField: trait.sourceAnimalField || 'animalId',
        sourceTraitField: trait.sourceTraitField || 'traitCode',
        sourceValueField: trait.sourceValueField || defaultValueFieldForTrait(trait),
        sourceDateField: trait.sourceDateField || 'collectionDate',
        sourceParityField: trait.sourceParityField || 'parity',
        sourceDimField: trait.sourceDimField || 'daysInMilk',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    )
    if (!missing.length) return rows
    await databaseService.addTableDataAsync(TRAIT_TABLE, missing)
    return databaseService.getTableDataAsync(TRAIT_TABLE, { silent: true })
  }

  function normalizeTrait(row: Record<string, any>): PhenotypeTraitDefinition {
    return {
      id: String(row.id || `trait-${row.code || Date.now()}`),
      code: String(row.code || ''),
      name: String(row.name || ''),
      category: String(row.category || '体尺性状') as PhenotypeTraitCategory,
      unit: String(row.unit || ''),
      dataType: String(
        row.dataType || row.data_type || '数值'
      ) as PhenotypeTraitDefinition['dataType'],
      source: String(row.source || '人工采集') as PhenotypeTraitDefinition['source'],
      sourceTable: String(row.sourceTable || row.source_table || defaultSourceTableForTrait(row)),
      sourceAnimalField: String(row.sourceAnimalField || row.source_animal_field || 'animalId'),
      sourceTraitField: String(row.sourceTraitField || row.source_trait_field || 'traitCode'),
      sourceValueField: String(
        row.sourceValueField || row.source_value_field || defaultValueFieldForTrait(row)
      ),
      sourceDateField: String(row.sourceDateField || row.source_date_field || 'collectionDate'),
      sourceParityField: String(row.sourceParityField || row.source_parity_field || 'parity'),
      sourceDimField: String(row.sourceDimField || row.source_dim_field || 'daysInMilk'),
      requiredFields: String(
        row.requiredFields || row.required_fields || '牛号、采集日期、采集人、测量值'
      ),
      linkedDomains: String(row.linkedDomains || row.linked_domains || '个体档案、系谱、组学样本'),
      status: String(row.status || '启用') as PhenotypeTraitDefinition['status'],
      description: String(row.description || '')
    }
  }

  function defaultSourceTableForTrait(row: Record<string, any>) {
    const source = String(row.source || '').trim()
    if (source === '奶厅导入') return 'milk_measurement'
    return 'trait_observation'
  }

  function defaultValueFieldForTrait(row: Record<string, any>) {
    const code = String(row.code || row.traitCode || row.trait_code || '').trim()
    const map: Record<string, string> = {
      milk_yield: 'milkYield',
      milk_fat: 'fatRate',
      milk_protein: 'proteinRate',
      milk_lactose: 'lactoseRate',
      somatic_cell_count: 'somaticCellCount',
      milking_duration: 'milkingDuration',
      milk_temperature: 'milkTemperature'
    }
    return map[code] || 'value'
  }

  async function loadCategories() {
    const seedRows = defaultCategories.map((name, index) => ({
      id: `${CATEGORY_SCOPE}-category-${index + 1}`,
      scope: CATEGORY_SCOPE,
      name,
      description:
        name === '体尺性状'
          ? '体高、体斜长、胸围等牛只体型结构测量'
          : name === '泌乳性能'
            ? '产奶量、乳脂、乳蛋白、乳糖、体细胞数和 DHI 指标'
            : '场内可扩展表型分类',
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

  async function submitCategoryForm() {
    const name = categoryForm.name.trim()
    if (!name) {
      ElMessage.warning('数值性状大类名称不能为空')
      return
    }
    if (categories.value.includes(name)) {
      ElMessage.warning('数值性状大类已存在')
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
      console.error('新增数值性状大类失败:', error)
      ElMessage.error('新增数值性状大类失败，请检查数据库连接')
      return
    }
    categories.value.push(name)
    form.category = name
    filters.category = name
    categoryDialogVisible.value = false
    ElMessage.success('数值性状大类已新增')
  }

  async function submitForm() {
    const payload = {
      ...form,
      id: editingId.value || `trait-${Date.now()}`,
      code: String(form.code || '').trim(),
      name: String(form.name || '').trim(),
      category: String(form.category || '').trim() as PhenotypeTraitCategory,
      sourceTable: String(form.sourceTable || 'trait_observation').trim(),
      sourceAnimalField: String(form.sourceAnimalField || 'animalId').trim(),
      sourceTraitField: String(form.sourceTraitField || 'traitCode').trim(),
      sourceValueField: String(form.sourceValueField || 'value').trim(),
      sourceDateField: String(form.sourceDateField || 'collectionDate').trim(),
      sourceParityField: String(form.sourceParityField || 'parity').trim(),
      sourceDimField: String(form.sourceDimField || 'daysInMilk').trim(),
      requiredFields: requiredFieldSelection.value.join('、'),
      linkedDomains: linkedDomainSelection.value.join('、')
    }
    if (!payload.name || !payload.code) {
      ElMessage.warning('性状名称和字段编码不能为空')
      return
    }
    const duplicated = traits.value.some(
      (trait) =>
        trait.id !== editingId.value &&
        trait.code.trim().toLowerCase() === payload.code.toLowerCase()
    )
    if (duplicated) {
      ElMessage.warning('字段编码已存在，请使用唯一编码')
      return
    }
    try {
      if (editingId.value) {
        await databaseService.updateTableRecordAsync(TRAIT_TABLE, editingId.value, {
          ...payload,
          updatedAt: new Date().toISOString()
        })
      } else {
        await databaseService.addTableDataAsync(TRAIT_TABLE, {
          ...payload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      }
      traits.value = (await databaseService.getTableDataAsync(TRAIT_TABLE, { silent: true })).map(
        (row) => normalizeTrait(row)
      )
      dialogVisible.value = false
      ElMessage.success('数值性状已保存到数据库')
    } catch (error) {
      console.error('保存数值性状失败:', error)
      ElMessage.error('保存数值性状失败')
    }
  }

  async function toggleStatus(row: PhenotypeTraitDefinition) {
    const status = row.status === '启用' ? '停用' : '启用'
    try {
      await databaseService.updateTableRecordAsync(TRAIT_TABLE, row.id, {
        ...row,
        status,
        updatedAt: new Date().toISOString()
      })
      traits.value = traits.value.map((trait) =>
        trait.id === row.id ? { ...trait, status } : trait
      )
      ElMessage.success(`${row.name} 已${status}`)
    } catch (error) {
      console.error('更新数值性状状态失败:', error)
      ElMessage.error('更新数值性状状态失败')
    }
  }

  watch(
    () => [form.source, form.category],
    () => {
      if (!dialogVisible.value || editingId.value) return
      requiredFieldSelection.value = recommendedRequiredFields()
      linkedDomainSelection.value = recommendedLinkedDomains()
    }
  )

  onMounted(async () => {
    await loadCategories()
    await loadTraits()
  })
</script>

<style scoped lang="scss">
  .fc-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }

  .trait-config-layout {
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

  .form-inline {
    display: grid;
    grid-template-columns: 1fr 160px;
    gap: 10px;
    width: 100%;
  }

  @media (max-width: 1180px) {
    .fc-metric-grid,
    .trait-config-layout,
    .category-stack {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .trait-config-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .fc-metric-grid,
    .category-stack,
    .filter-bar,
    .form-inline {
      grid-template-columns: 1fr;
    }
  }
</style>
