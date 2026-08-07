<template>
  <div class="import-config-page">
    <section class="page-head surface-card">
      <div>
        <h1>导入模板管理</h1>
        <p>维护字段映射、默认值、去重键和冲突策略；日常上传、预检和提交统一到信息导入入口执行。</p>
      </div>
      <div class="head-actions">
        <ElButton :icon="Upload" @click="goImportEntry()">去信息导入</ElButton>
        <ElButton type="primary" @click="showAddDialog = true">
          <ArtSvgIcon icon="ri:add-line" class="mr-2" />新建适配规则
        </ElButton>
      </div>
    </section>

    <section
      ref="templateGridRef"
      class="template-grid"
      @scroll.passive="onTemplateGridScroll"
      @wheel.passive="onTemplateGridWheel"
    >
      <article
        v-for="template in visibleBuiltinTemplates"
        :key="template.code"
        class="template-card surface-card"
        @click="goImportEntry(template.code)"
      >
        <div>
          <span>{{ template.group }}</span>
          <h3>{{ template.name }}</h3>
          <p>{{ template.description }}</p>
        </div>
        <div class="template-meta">
          <ElTag size="small">{{ template.columns.length }} 列</ElTag>
          <ElTag size="small" type="info">{{ template.targetTables.length }} 表</ElTag>
          <ElTag size="small" type="success">{{ conflictText(template.conflictStrategy) }}</ElTag>
        </div>
        <div class="template-field-groups">
          <div
            v-for="group in previewTemplateFieldGroups(template)"
            :key="`${template.code}-${group.section}`"
            class="template-field-group"
          >
            <strong>{{ group.section }}</strong>
            <span>{{ group.labels.join('、') }}</span>
          </div>
        </div>
        <div class="card-actions">
          <ElButton size="small" :icon="Download" @click.stop="downloadTemplate(template)"
            >下载模板</ElButton
          >
          <ElButton size="small" type="primary" @click.stop="goImportEntry(template.code)"
            >执行导入</ElButton
          >
        </div>
      </article>
    </section>
    <div
      v-if="builtinTemplates.length > visibleBuiltinTemplates.length"
      class="load-more-row template-load-more"
    >
      <ElButton @click="() => loadMoreBuiltinTemplates()"
        >加载更多模板 {{ visibleBuiltinTemplates.length }}/{{ builtinTemplates.length }}</ElButton
      >
    </div>

    <section class="surface-card config-section">
      <div class="section-title">
        <div>
          <span>适配配置</span>
          <h2>自定义字段映射规则</h2>
        </div>
        <ElTabs v-model="activeScope" @tab-change="loadConfigs">
          <ElTabPane
            v-for="scope in scopes"
            :key="scope.value"
            :label="scope.label"
            :name="scope.value"
          />
        </ElTabs>
      </div>

      <div class="lazy-table-toolbar">
        <ElTag type="info" effect="light"
          >显示 {{ visibleConfigs.length }}/{{ configs.length }} 条</ElTag
        >
      </div>
      <div class="config-table-shell" @wheel.passive="onConfigTableWheel">
        <ElTable :data="visibleConfigs" table-layout="auto" style="width: 100%">
          <ElTableColumn prop="name" label="规则名称" width="190" />
          <ElTableColumn label="字段映射" min-width="320">
            <template #default="{ row }">
              <div class="tag-list">
                <ElTag
                  v-for="(dbField, excelCol) in row.fieldMapping || {}"
                  :key="excelCol"
                  size="small"
                >
                  {{ excelCol }} ->
                  {{ mappingFieldLabel(dbField, row.templateCode || scopeToTemplate(row.scope)) }}
                </ElTag>
              </div>
            </template>
          </ElTableColumn>
          <ElTableColumn label="去重/冲突" width="190">
            <template #default="{ row }">
              {{ configConflictText(row) }}：{{ row.duplicateKey || '未设置' }}
            </template>
          </ElTableColumn>
          <ElTableColumn label="创建时间" width="180">
            <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
          </ElTableColumn>
          <ElTableColumn label="操作" width="190">
            <template #default="{ row }">
              <ElButton
                type="primary"
                size="small"
                @click="goImportEntry(row.templateCode || scopeToTemplate(row.scope), row.id)"
                >去信息导入</ElButton
              >
              <ElButton size="small" @click="editConfig(row)">编辑</ElButton>
              <ElButton type="danger" size="small" @click="deleteConfig(row.id)">删除</ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
      <div v-if="configs.length > visibleConfigs.length" class="load-more-row">
        <ElButton @click="() => loadMoreConfigs()"
          >加载更多 {{ visibleConfigs.length }}/{{ configs.length }}</ElButton
        >
      </div>
      <ElEmpty
        v-if="configs.length === 0"
        description="当前分类暂无适配规则，内置模板可直接在信息导入中使用"
      />
    </section>

    <ElDialog
      v-model="showAddDialog"
      :title="editingConfig ? '编辑适配规则' : '新建适配规则'"
      width="min(760px, calc(100vw - 32px))"
    >
      <ElForm :model="form" label-width="126px">
        <ElFormItem label="规则名称" required>
          <ElInput v-model="form.name" placeholder="如：奶厅日产奶导入字段映射" />
        </ElFormItem>
        <ElFormItem label="目标分类" required>
          <ElSelect v-model="form.scope" class="w-full" @change="syncTemplateByScope">
            <ElOption
              v-for="scope in scopes"
              :key="scope.value"
              :label="scope.label"
              :value="scope.value"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="绑定模板" required>
          <ElSelect
            v-model="form.templateCode"
            class="w-full"
            filterable
            @change="syncDefaultsByTemplate"
          >
            <ElOption
              v-for="template in templateOptionsForScope"
              :key="template.code"
              :label="`${template.group} / ${template.name}`"
              :value="template.code"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="字段映射">
          <div class="mapping-list">
            <div v-for="(mapping, index) in form.mappings" :key="index" class="mapping-row">
              <ElInput v-model="mapping.excelCol" placeholder="模板列名/外部列名" size="small" />
              <span>-></span>
              <ElSelect
                v-model="mapping.dbField"
                filterable
                placeholder="系统字段编号"
                size="small"
              >
                <ElOption
                  v-for="field in availableDbFields"
                  :key="field.value"
                  :label="field.label"
                  :value="field.value"
                />
              </ElSelect>
              <ElButton type="danger" size="small" @click="form.mappings!.splice(index, 1)"
                >删除</ElButton
              >
            </div>
            <ElButton size="small" @click="form.mappings!.push({ excelCol: '', dbField: '' })">
              <ArtSvgIcon icon="ri:add-line" class="mr-1" />添加映射
            </ElButton>
          </div>
        </ElFormItem>
        <ElRow :gutter="16">
          <ElCol :span="12">
            <ElFormItem label="日期格式">
              <ElSelect v-model="form.dateFormat" class="w-full">
                <ElOption label="YYYY-MM-DD" value="YYYY-MM-DD" />
                <ElOption label="YYYY/MM/DD" value="YYYY/MM/DD" />
                <ElOption label="DD/MM/YYYY" value="DD/MM/YYYY" />
                <ElOption label="MM/DD/YYYY" value="MM/DD/YYYY" />
              </ElSelect>
            </ElFormItem>
          </ElCol>
          <ElCol :span="12">
            <ElFormItem label="去重键">
              <ElInput v-model="form.duplicateKey" placeholder="如：animal_number" />
            </ElFormItem>
          </ElCol>
        </ElRow>
        <ElFormItem label="数字格式">
          <ElSelect
            v-model="form.numberFormat"
            clearable
            class="w-full"
            placeholder="默认：小数点格式"
          >
            <ElOption label="12.5 / 1,200.5" value="dot_decimal" />
            <ElOption label="12,5 / 1.200,5" value="comma_decimal" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="重复处理">
          <ElRadioGroup v-model="form.conflictStrategy">
            <ElRadioButton label="skip">跳过</ElRadioButton>
            <ElRadioButton label="update">更新</ElRadioButton>
            <ElRadioButton label="reject">报错</ElRadioButton>
          </ElRadioGroup>
        </ElFormItem>
        <ElFormItem label="默认值">
          <div class="mapping-list">
            <div v-for="(_, key) in form.defaultValues" :key="key" class="mapping-row">
              <ElInput :model-value="String(key)" disabled size="small" />
              <ElInput v-model="form.defaultValues![key]" placeholder="默认值" size="small" />
              <ElButton type="danger" size="small" @click="delete form.defaultValues![key]"
                >删除</ElButton
              >
            </div>
            <ElButton size="small" @click="addDefaultValue">
              <ArtSvgIcon icon="ri:add-line" class="mr-1" />添加默认值
            </ElButton>
          </div>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="showAddDialog = false">取消</ElButton>
        <ElButton type="primary" @click="saveConfig">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import { Download, Upload } from '@element-plus/icons-vue'
  import * as flexibleExport from '@/utils/flexible-export'
  import type { ImportConfig } from '@/utils/flexible-export'
  import {
    getImportTemplates,
    getTemplateSystemFieldOptions,
    resolveTemplateSystemField,
    type ImportTemplate
  } from '@/services/import-templates'
  import { downloadImportTemplateWithDictionaries } from '@/services/import-template-dictionaries'
  import { useLazyGridRenderWindow, useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'

  const router = useRouter()
  const scopes = [
    { label: '个体主档', value: 'animal' },
    { label: '事件繁殖', value: 'event' },
    { label: '表型泌乳', value: 'phenotype' },
    { label: '奶厅测量', value: 'milk' },
    { label: '组学样本', value: 'omics' },
    { label: '设备传感器', value: 'device' },
    { label: '旧配置兼容', value: 'cow' }
  ]

  const builtinTemplates = getImportTemplates()
  const {
    containerRef: templateGridRef,
    visibleItems: visibleBuiltinTemplates,
    loadMore: loadMoreBuiltinTemplates,
    handleScroll: onTemplateGridScroll,
    handleWheel: onTemplateGridWheel
  } = useLazyGridRenderWindow(builtinTemplates, {
    rowCount: 2,
    minItemWidth: 250,
    gap: 12,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })
  const activeScope = ref('animal')
  const configs = ref<ImportConfig[]>([])
  const {
    visibleItems: visibleConfigs,
    loadMore: loadMoreConfigs,
    handleWheel: onConfigTableWheel
  } = useLazyRenderWindow(configs, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const showAddDialog = ref(false)
  const editingConfig = ref<ImportConfig | null>(null)

  const form = reactive<Partial<ImportConfig>>({
    name: '',
    scope: 'animal',
    templateCode: 'animal-profile',
    fieldMapping: {},
    mappings: [{ excelCol: '', dbField: '' }],
    dateFormat: 'YYYY-MM-DD',
    numberFormat: 'dot_decimal',
    conflictStrategy: 'skip',
    skipDuplicates: true,
    duplicateKey: 'animal_number',
    defaultValues: {}
  })

  const templateOptionsForScope = computed(() => {
    const scope = form.scope || activeScope.value
    return builtinTemplates.filter((template) => templateScopeOf(template.code) === scope)
  })

  const availableDbFields = computed(() => {
    const templateCode = form.templateCode || scopeToTemplate(form.scope || activeScope.value)
    const template =
      builtinTemplates.find((item) => item.code === templateCode) || builtinTemplates[0]
    return getTemplateSystemFieldOptions(template).map((field) => ({
      value: field.number,
      label: `${field.number}. ${field.section} / ${field.label} / ${field.targetField}`
    }))
  })

  async function downloadTemplate(template: ImportTemplate) {
    await downloadImportTemplateWithDictionaries(template)
  }

  function normalizeMappingDbField(value: string) {
    const templateCode = form.templateCode || scopeToTemplate(form.scope || activeScope.value)
    const template =
      builtinTemplates.find((item) => item.code === templateCode) || builtinTemplates[0]
    const resolved = resolveTemplateSystemField(template, value)
    const option = getTemplateSystemFieldOptions(template).find(
      (item) => item.targetField === resolved
    )
    return option?.number || ''
  }

  function mappingFieldLabel(value: string, templateCode?: string) {
    const template =
      builtinTemplates.find((item) => item.code === templateCode) || builtinTemplates[0]
    const resolved = resolveTemplateSystemField(template, value)
    const option = getTemplateSystemFieldOptions(template).find(
      (item) => item.targetField === resolved || item.number === String(value)
    )
    return option ? `${option.number}. ${option.label} / ${option.targetField}` : value
  }

  function previewTemplateFieldGroups(template: (typeof builtinTemplates)[number]) {
    const groups = new Map<string, string[]>()
    template.columns.forEach((column) => {
      const section = column.section || '其他字段'
      if (!groups.has(section)) groups.set(section, [])
      groups.get(section)!.push(column.label)
    })
    const order = [
      '牛只身份',
      '系谱关系',
      '生产周期',
      '测量与性状',
      '事件业务',
      '样本与组学',
      '设备与传感器',
      '采集与追溯',
      '其他字段'
    ]
    return order
      .filter((section) => groups.has(section))
      .map((section) => {
        const labels = groups.get(section)!
        const visibleLabels = labels.slice(0, 4)
        return {
          section,
          labels:
            labels.length > visibleLabels.length
              ? [...visibleLabels, `等${labels.length}项`]
              : visibleLabels
        }
      })
  }

  async function loadConfigs() {
    const all = await Promise.all(
      scopes.map((scope) => flexibleExport.getImportConfigs(scope.value))
    )
    const rows = all.flat()
    configs.value = rows.filter((item) => item.scope === activeScope.value)
  }

  function goImportEntry(templateCode?: string, configId?: string) {
    router.push({
      path: '/data-and-devices/information-import',
      query: templateCode ? { template: templateCode, configId, tab: 'batch' } : undefined
    })
  }

  function addDefaultValue() {
    const key = window.prompt('请输入字段名:')
    if (key && form.defaultValues) form.defaultValues[key] = ''
  }

  async function saveConfig() {
    if (!form.name || !form.scope) {
      ElMessage.warning('请填写规则名称和目标分类')
      return
    }
    const fieldMapping: Record<string, string> = {}
    for (const mapping of form.mappings || []) {
      const normalizedDbField = normalizeMappingDbField(mapping.dbField)
      if (mapping.excelCol && normalizedDbField) fieldMapping[mapping.excelCol] = normalizedDbField
    }
    const hasDefaultValues = Object.values(form.defaultValues || {}).some((value) =>
      String(value ?? '').trim()
    )
    const hasExecutionRule = Boolean(
      Object.keys(fieldMapping).length ||
      hasDefaultValues ||
      form.duplicateKey ||
      form.conflictStrategy ||
      form.dateFormat ||
      form.numberFormat
    )
    if (!hasExecutionRule) {
      ElMessage.warning('请至少配置字段映射、默认值、去重键、冲突策略或格式规则')
      return
    }
    const config: ImportConfig = {
      id: editingConfig.value?.id || `import-config-${Date.now()}`,
      name: form.name,
      scope: form.scope,
      templateCode: form.templateCode || scopeToTemplate(form.scope),
      fieldMapping,
      dateFormat: form.dateFormat,
      numberFormat: form.numberFormat,
      defaultValues: form.defaultValues || {},
      conflictStrategy: form.conflictStrategy || (form.skipDuplicates ? 'skip' : 'update'),
      skipDuplicates:
        (form.conflictStrategy || (form.skipDuplicates ? 'skip' : 'update')) === 'skip',
      duplicateKey: form.duplicateKey || 'animal_number',
      createdAt: editingConfig.value?.createdAt || new Date().toISOString()
    }
    await flexibleExport.saveImportConfig(config)
    ElMessage.success('保存成功')
    showAddDialog.value = false
    editingConfig.value = null
    activeScope.value = config.scope
    resetForm()
    await loadConfigs()
  }

  function editConfig(config: ImportConfig) {
    editingConfig.value = config
    form.name = config.name
    form.scope = config.scope
    form.templateCode = config.templateCode || scopeToTemplate(config.scope)
    form.dateFormat = config.dateFormat
    form.numberFormat = config.numberFormat || 'dot_decimal'
    form.conflictStrategy = config.conflictStrategy || (config.skipDuplicates ? 'skip' : 'update')
    form.skipDuplicates = config.skipDuplicates
    form.duplicateKey = config.duplicateKey
    form.defaultValues = { ...config.defaultValues }
    form.mappings = Object.entries(config.fieldMapping || {}).map(([excelCol, dbField]) => ({
      excelCol,
      dbField: normalizeMappingDbField(dbField)
    }))
    showAddDialog.value = true
  }

  async function deleteConfig(id: string) {
    await ElMessageBox.confirm('确定删除此适配规则？', '确认删除', { type: 'warning' })
    await flexibleExport.deleteImportConfig(id)
    ElMessage.success('已删除')
    await loadConfigs()
  }

  function resetForm() {
    form.name = ''
    form.scope = activeScope.value
    form.templateCode = scopeToTemplate(activeScope.value)
    form.fieldMapping = {}
    form.mappings = [{ excelCol: '', dbField: '' }]
    form.dateFormat = 'YYYY-MM-DD'
    form.numberFormat = 'dot_decimal'
    form.conflictStrategy = 'skip'
    form.skipDuplicates = true
    form.duplicateKey = 'animal_number'
    form.defaultValues = {}
  }

  function syncTemplateByScope() {
    form.templateCode = scopeToTemplate(form.scope || activeScope.value)
    syncDefaultsByTemplate()
  }

  function syncDefaultsByTemplate() {
    const template = builtinTemplates.find((item) => item.code === form.templateCode)
    if (!template) return
    form.scope = templateScopeOf(template.code)
    form.duplicateKey = template.duplicateKeys.join(',')
    form.conflictStrategy = template.conflictStrategy
    form.skipDuplicates = template.conflictStrategy === 'skip'
  }

  function scopeToTemplate(scope = 'animal') {
    const map: Record<string, string> = {
      animal: 'animal-profile',
      cow: 'animal-profile',
      event: 'animal-event',
      breeding: 'animal-event',
      phenotype: 'trait-observation',
      milk: 'milk-measurement',
      omics: 'omics-sample',
      device: 'device-sensor'
    }
    return map[scope] || 'animal-event'
  }

  function templateScopeOf(templateCode: string) {
    const map: Record<string, string> = {
      'animal-profile': 'animal',
      pedigree: 'animal',
      'animal-event': 'event',
      'trait-observation': 'phenotype',
      'milk-measurement': 'milk',
      'omics-sample': 'omics',
      'omics-dataset': 'omics',
      'device-sensor': 'device'
    }
    return map[templateCode] || 'event'
  }

  function conflictText(value: string) {
    return value === 'skip' ? '跳过重复' : value === 'update' ? '重复更新' : '重复报错'
  }

  function configConflictText(config: ImportConfig) {
    return conflictText(config.conflictStrategy || (config.skipDuplicates ? 'skip' : 'update'))
  }

  function formatDate(value?: string) {
    return formatDateOnly(value, '-')
  }

  onMounted(loadConfigs)

  defineOptions({ name: 'ImportConfigsManagement' })
</script>

<style scoped lang="scss">
  .import-config-page {
    padding: 18px;
    color: #0f172a;
  }

  .surface-card {
    background: #fff;
    border: 1px solid #d8e0ea;
    border-radius: 8px;
    transition:
      border-color 0.18s ease,
      background-color 0.18s ease;
  }

  .template-card:hover {
    background: #f8fafc;
    border-color: #0f766e;
  }

  .page-head,
  .section-title,
  .head-actions,
  .card-actions,
  .template-meta,
  .tag-list {
    display: flex;
    gap: 10px;
  }

  .page-head,
  .section-title {
    align-items: flex-start;
    justify-content: space-between;
  }

  .page-head {
    padding: 16px;
    margin-bottom: 14px;
  }

  .head-actions,
  .card-actions,
  .template-meta,
  .tag-list {
    flex-wrap: wrap;
  }

  .section-title span,
  .template-card span {
    color: #64748b;
    font-size: 12px;
  }

  h1,
  h2,
  h3,
  p {
    margin: 0;
  }

  h1 {
    margin-top: 2px;
    font-size: 22px;
    line-height: 1.25;
    font-weight: 650;
  }

  h2 {
    margin-top: 4px;
    font-size: 16px;
    line-height: 1.35;
    font-weight: 650;
  }

  .page-head p,
  .template-card p {
    margin-top: 6px;
    color: #64748b;
    font-size: 13px;
    line-height: 1.55;
  }

  .template-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 12px;
    max-height: min(636px, 62vh);
    overflow-y: auto;
    overscroll-behavior: contain;
    margin-bottom: 8px;
    padding: 2px 2px 8px;
  }

  .template-card {
    display: grid;
    min-height: 196px;
    padding: 13px;
    align-content: space-between;
    cursor: pointer;
  }

  .template-field-groups {
    display: grid;
    gap: 6px;
    max-height: 192px;
    padding-right: 2px;
    overflow: auto;
  }

  .template-field-group {
    display: grid;
    gap: 3px;
    padding: 7px 9px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
  }

  .template-field-group strong {
    font-size: 12px;
    color: #0f172a;
  }

  .template-field-group span {
    overflow: hidden;
    font-size: 12px;
    color: #64748b;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .config-section {
    padding: 14px;
  }

  .config-table-shell {
    max-height: 460px;
    overflow: auto;
    border: 1px solid #d8e0ea;
    border-radius: 8px;
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

  .mapping-list {
    display: grid;
    width: 100%;
    gap: 8px;
  }

  .mapping-row {
    display: grid;
    grid-template-columns: minmax(130px, 1fr) auto minmax(130px, 1fr) auto;
    gap: 8px;
    align-items: center;
  }

  .w-full {
    width: 100%;
  }

  .template-load-more {
    padding: 0 0 14px;
  }

  :global(.dark) .import-config-page,
  :global(.dark) h1,
  :global(.dark) h2,
  :global(.dark) h3,
  :global(.dark) .template-field-group strong {
    color: #e5e7eb;
  }

  :global(.dark) .surface-card {
    background: rgb(15 23 42 / 76%);
    border-color: rgb(51 65 85 / 88%);
  }

  :global(.dark) .template-card:hover {
    background: rgb(30 41 59 / 78%);
    border-color: #14b8a6;
  }

  :global(.dark) .template-field-group {
    background: rgb(30 41 59 / 72%);
    border-color: rgb(51 65 85 / 88%);
  }

  :global(.dark) .template-field-group span,
  :global(.dark) .page-head p,
  :global(.dark) .template-card p,
  :global(.dark) .section-title span,
  :global(.dark) .template-card span {
    color: #94a3b8;
  }

  @media (max-width: 760px) {
    .import-config-page {
      padding: 12px;
    }

    .page-head,
    .section-title {
      display: block;
    }

    .head-actions {
      margin-top: 12px;
    }

    .mapping-row {
      grid-template-columns: 1fr;
    }
  }
</style>
