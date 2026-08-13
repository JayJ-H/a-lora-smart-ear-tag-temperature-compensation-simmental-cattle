<template>
  <div class="custom-fields-page">
    <div class="custom-fields-head">
      <div>
        <h1>自定义字段管理</h1>
        <p>维护牛只、事件、产奶、健康与信息录入字段，字段保存后直接驱动录入和导入配置。</p>
      </div>
      <ElButton type="primary" @click="showAddDialog = true">
        <ArtSvgIcon icon="ri:add-line" class="mr-2" />新建字段
      </ElButton>
    </div>

    <!-- 按范围分组显示 -->
    <ElTabs v-model="activeScope" class="scope-tabs" @tab-change="loadFields">
      <ElTabPane label="牛只信息" name="cow" />
      <ElTabPane label="繁殖事件" name="breeding" />
      <ElTabPane label="产奶记录" name="milk" />
      <ElTabPane label="饲料记录" name="feed" />
      <ElTabPane label="健康评分" name="health" />
      <ElTabPane label="信息录入字段" name="information-entry" />
    </ElTabs>

    <div v-if="activeScope === 'information-entry'" class="entry-field-selector">
      <ElSelect
        v-model="selectedEntryGroup"
        filterable
        class="w-full"
        placeholder="选择事件分组"
        @change="handleEntryGroupChange"
      >
        <ElOption
          v-for="group in informationEntryGroups"
          :key="group"
          :label="group"
          :value="group"
        />
      </ElSelect>
      <ElSelect
        v-model="selectedEntryEventType"
        filterable
        class="w-full"
        placeholder="选择事件名称"
        @change="loadFields"
      >
        <ElOption
          v-for="event in filteredInformationEntryEvents"
          :key="event.code"
          :label="event.label"
          :value="event.code"
        />
      </ElSelect>
    </div>

    <!-- 字段列表 -->
    <div
      v-if="fields.length > 0"
      ref="fieldGridRef"
      class="field-grid"
      @scroll.passive="onFieldGridScroll"
      @wheel.passive="onFieldGridWheel"
    >
      <div v-for="field in visibleFields" :key="field.id" class="field-card">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-medium text-gray-900 dark:text-white">{{ field.label }}</h3>
          <ElSwitch v-model="field.isActive" size="small" @change="toggleField(field)" />
        </div>
        <p class="text-sm text-gray-500 mb-1"
          >字段名: <code>{{ field.fieldName }}</code></p
        >
        <p class="text-sm text-gray-500 mb-1">类型: {{ getTypeLabel(field.type) }}</p>
        <p v-if="field.optionSource" class="text-sm text-gray-500 mb-1"
          >选项来源: {{ getOptionSourceLabel(field.optionSource) }}</p
        >
        <p v-if="field.required" class="text-sm text-red-500">* 必填</p>
        <p v-if="field.defaultValue" class="text-sm text-gray-500"
          >默认值: {{ field.defaultValue }}</p
        >
        <p v-if="field.description" class="text-sm text-gray-400 mt-1">{{ field.description }}</p>
        <div class="flex items-center gap-2 mt-3">
          <ElButton size="small" @click="editField(field)">编辑</ElButton>
          <ElButton type="danger" size="small" @click="confirmDelete(field.id)">删除</ElButton>
        </div>
      </div>
    </div>
    <div v-if="fields.length > visibleFields.length" class="load-more-row">
      <ElButton @click="() => loadMoreFields()"
        >加载更多 {{ visibleFields.length }}/{{ fields.length }}</ElButton
      >
    </div>

    <ElEmpty v-else description="暂无自定义字段，点击「新建字段」添加" />

    <!-- 新建/编辑对话框 -->
    <ElDialog
      v-model="showAddDialog"
      :title="editingField ? '编辑字段' : '新建字段'"
      width="min(500px, calc(100vw - 32px))"
    >
      <ElForm :model="form" label-width="100px">
        <ElFormItem label="显示名称" required>
          <ElInput v-model="form.label" placeholder="如：体况评分" />
        </ElFormItem>
        <ElFormItem label="字段名" required>
          <ElInput v-model="form.fieldName" placeholder="如：body_score" />
        </ElFormItem>
        <ElFormItem label="字段类型" required>
          <ElSelect v-model="form.type" class="w-full">
            <ElOption label="文本" value="text" />
            <ElOption label="数字" value="number" />
            <ElOption label="日期" value="date" />
            <ElOption label="日期时间" value="datetime" />
            <ElOption label="下拉选择" value="select" />
            <ElOption label="布尔值" value="boolean" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem v-if="form.type === 'select'" label="选项来源">
          <ElSelect
            v-model="form.optionSource"
            clearable
            class="w-full"
            placeholder="固定选项或选择平台字典"
          >
            <ElOption
              v-for="item in optionSourceOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem v-if="form.type === 'select'" label="选项列表">
          <ElInput
            v-model="form.optionsText"
            placeholder="固定选项用逗号分隔；已选动态来源时可留空"
          />
        </ElFormItem>
        <ElFormItem v-if="form.type === 'number'" label="数字范围">
          <div class="flex gap-2 w-full">
            <ElInputNumber v-model="form.min" :precision="2" placeholder="最小值" class="flex-1" />
            <ElInputNumber
              v-model="form.step"
              :precision="2"
              :min="0"
              placeholder="步长"
              class="flex-1"
            />
          </div>
        </ElFormItem>
        <ElFormItem label="默认值">
          <ElInput v-model="form.defaultValue" placeholder="可选" />
        </ElFormItem>
        <ElFormItem label="输入提示">
          <ElInput v-model="form.placeholder" placeholder="可选" />
        </ElFormItem>
        <ElFormItem v-if="form.type === 'select'" label="允许新增">
          <ElSwitch v-model="form.allowCreate" />
        </ElFormItem>
        <ElFormItem label="是否必填">
          <ElSwitch v-model="form.required" />
        </ElFormItem>
        <ElFormItem label="显示顺序">
          <ElInputNumber v-model="form.sortOrder" :min="0" />
        </ElFormItem>
        <ElFormItem label="字段描述">
          <ElInput v-model="form.description" type="textarea" :rows="2" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="showAddDialog = false">取消</ElButton>
        <ElButton type="primary" @click="saveField">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, computed, onMounted } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import * as flexibleExport from '@/utils/flexible-export'
  import type { CustomField } from '@/utils/flexible-export'
  import {
    getCustomFieldsByScope,
    getInformationEntryEvents,
    INFORMATION_ENTRY_OPTION_SOURCE_OPTIONS,
    type InformationEntryEventOption
  } from '@/services/platform-dictionary'
  import { useLazyGridRenderWindow } from '@/hooks'

  const activeScope = ref('cow')
  const selectedEntryGroup = ref('繁殖')
  const selectedEntryEventType = ref('insemination')
  const fields = ref<CustomField[]>([])
  const {
    containerRef: fieldGridRef,
    visibleItems: visibleFields,
    loadMore: loadMoreFields,
    handleScroll: onFieldGridScroll,
    handleWheel: onFieldGridWheel
  } = useLazyGridRenderWindow(fields, {
    rowCount: 2,
    minItemWidth: 260,
    gap: 12,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })
  const showAddDialog = ref(false)
  const editingField = ref<CustomField | null>(null)
  const informationEntryEvents = ref<InformationEntryEventOption[]>([])
  const optionSourceOptions = INFORMATION_ENTRY_OPTION_SOURCE_OPTIONS
  const actualScope = computed(() =>
    activeScope.value === 'information-entry'
      ? `information-entry:${selectedEntryEventType.value}`
      : activeScope.value
  )
  const informationEntryGroups = computed(() =>
    Array.from(new Set(informationEntryEvents.value.map((event) => event.group))).filter(Boolean)
  )
  const filteredInformationEntryEvents = computed(() =>
    informationEntryEvents.value.filter((event) => event.group === selectedEntryGroup.value)
  )
  const selectedEntryEvent = computed(() =>
    informationEntryEvents.value.find((event) => event.code === selectedEntryEventType.value)
  )

  const form = reactive<Partial<CustomField>>({
    fieldName: '',
    label: '',
    scope: 'cow',
    type: 'text',
    optionsText: '',
    optionSource: '',
    defaultValue: '',
    min: undefined,
    step: undefined,
    placeholder: '',
    allowCreate: false,
    required: false,
    sortOrder: 0,
    description: ''
  })

  async function loadFields() {
    form.scope = actualScope.value
    fields.value = await getCustomFieldsByScope(actualScope.value)
  }

  async function loadInformationEntryEvents() {
    informationEntryEvents.value = await getInformationEntryEvents()
    if (!informationEntryGroups.value.includes(selectedEntryGroup.value)) {
      selectedEntryGroup.value = informationEntryGroups.value[0] || '繁殖'
    }
    if (
      !informationEntryEvents.value.some((event) => event.code === selectedEntryEventType.value)
    ) {
      selectedEntryEventType.value =
        filteredInformationEntryEvents.value[0]?.code ||
        informationEntryEvents.value[0]?.code ||
        'insemination'
    }
  }

  async function handleEntryGroupChange() {
    selectedEntryEventType.value =
      filteredInformationEntryEvents.value[0]?.code || selectedEntryEventType.value
    await loadFields()
  }

  function getTypeLabel(type: string): string {
    const map: Record<string, string> = {
      text: '文本',
      number: '数字',
      date: '日期',
      datetime: '日期时间',
      select: '下拉选择',
      boolean: '布尔值'
    }
    return map[type] || type
  }

  function getOptionSourceLabel(value: string): string {
    return optionSourceOptions.find((item) => item.value === value)?.label || value
  }

  function toggleField(field: CustomField) {
    flexibleExport.saveCustomField(field)
    ElMessage.success(field.isActive ? '字段已启用' : '字段已禁用')
  }

  function editField(field: CustomField) {
    editingField.value = field
    if (activeScope.value === 'information-entry' && field.eventCode) {
      selectedEntryEventType.value = field.eventCode
      const event = informationEntryEvents.value.find((item) => item.code === field.eventCode)
      if (event) selectedEntryGroup.value = event.group
    }
    Object.assign(form, {
      ...field,
      optionsText: field.options?.join(',') || '',
      optionSource: field.optionSource || ''
    })
    showAddDialog.value = true
  }

  async function saveField() {
    if (!form.label || !form.fieldName) {
      ElMessage.warning('请填写显示名称和字段名')
      return
    }
    if (
      flexibleExport.isSystemControlledCustomField(form.fieldName) ||
      flexibleExport.isSystemControlledCustomField(form.label)
    ) {
      ElMessage.warning('胎次、当前圈舍、DIM、本胎输精次数等字段由系统自动计算，不能建为自定义字段')
      return
    }

    const field: CustomField = {
      id: editingField.value?.id || `cf-${Date.now()}`,
      fieldName: form.fieldName!,
      label: form.label!,
      scope: actualScope.value,
      eventCode:
        activeScope.value === 'information-entry' ? selectedEntryEventType.value : undefined,
      eventGroup:
        activeScope.value === 'information-entry' ? selectedEntryEvent.value?.group : undefined,
      type: form.type || 'text',
      options:
        form.type === 'select'
          ? (form.optionsText || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      optionSource: form.type === 'select' ? form.optionSource || undefined : undefined,
      defaultValue: form.defaultValue,
      min: form.type === 'number' ? form.min : undefined,
      step: form.type === 'number' ? form.step : undefined,
      placeholder: form.placeholder,
      allowCreate: form.type === 'select' ? form.allowCreate || false : undefined,
      required: form.required || false,
      sortOrder: form.sortOrder || 0,
      description: form.description,
      isActive: true,
      createdAt: editingField.value?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    await flexibleExport.saveCustomField(field)
    ElMessage.success('保存成功')
    showAddDialog.value = false
    editingField.value = null
    resetForm()
    await loadFields()
  }

  async function confirmDelete(id: string) {
    await ElMessageBox.confirm('确定删除此自定义字段？', '确认删除', { type: 'warning' })
    await flexibleExport.deleteCustomField(id)
    ElMessage.success('删除成功')
    await loadFields()
  }

  function resetForm() {
    Object.assign(form, {
      fieldName: '',
      label: '',
      type: 'text',
      optionsText: '',
      optionSource: '',
      defaultValue: '',
      min: undefined,
      step: undefined,
      placeholder: '',
      allowCreate: false,
      required: false,
      sortOrder: 0,
      description: ''
    })
  }

  onMounted(async () => {
    await loadInformationEntryEvents()
    await loadFields()
  })

  defineOptions({ name: 'CustomFieldsManagement' })
</script>

<style scoped>
  .custom-fields-page {
    min-height: 100%;
    padding: 18px;
    color: #0f172a;
  }

  .custom-fields-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }

  .custom-fields-head h1 {
    margin: 2px 0 0;
    font-size: 22px;
    line-height: 1.25;
    font-weight: 650;
    color: #0f172a;
  }

  .custom-fields-head p {
    margin: 6px 0 0;
    max-width: 760px;
    font-size: 13px;
    line-height: 1.6;
    color: #64748b;
  }

  .scope-tabs {
    border: 1px solid #d8e0ea;
    border-radius: 8px;
    padding: 0 12px;
    background: #fff;
  }

  .entry-field-selector {
    display: grid;
    grid-template-columns: minmax(160px, 0.8fr) minmax(220px, 1.2fr);
    gap: 12px;
    max-width: 640px;
    margin-top: 12px;
    padding: 12px;
    border: 1px solid #d8e0ea;
    border-radius: 8px;
    background: #fff;
  }

  .field-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
    max-height: min(410px, 48vh);
    overflow-y: auto;
    overscroll-behavior: contain;
    margin-top: 14px;
    padding: 2px 2px 8px;
  }

  .field-card {
    min-width: 0;
    padding: 14px;
    background: #fff;
    border: 1px solid #d8e0ea;
    border-radius: 8px;
    transition:
      border-color 0.16s ease,
      background-color 0.16s ease;
  }

  .field-card:hover {
    background: rgb(248 250 252 / 82%);
    border-color: #0f766e;
  }

  .field-card code {
    padding: 1px 5px;
    color: #1d4ed8;
    background: rgb(239 246 255);
    border: 1px solid rgb(191 219 254);
    border-radius: 4px;
    font-size: 12px;
  }

  .el-form-item__label {
    color: rgb(55 65 81);
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding: 14px 0 4px;
  }

  .dark .el-form-item__label {
    color: rgb(209 213 219);
  }

  :global(.dark) .custom-fields-page,
  :global(.dark) .custom-fields-head h1 {
    color: #e5e7eb;
  }

  :global(.dark) .custom-fields-head p {
    color: #94a3b8;
  }

  :global(.dark) .scope-tabs,
  :global(.dark) .entry-field-selector {
    background: rgb(15 23 42 / 76%);
    border-color: rgb(51 65 85 / 88%);
  }

  :global(.dark) .field-card {
    background: rgb(15 23 42 / 72%);
    border-color: rgb(51 65 85 / 90%);
  }

  :global(.dark) .field-card:hover {
    background: rgb(30 41 59 / 78%);
    border-color: rgb(96 165 250 / 36%);
  }

  :global(.dark) .field-card code {
    color: #bfdbfe;
    background: rgb(30 41 59);
    border-color: rgb(51 65 85);
  }

  @media (max-width: 640px) {
    .custom-fields-page {
      padding: 12px;
    }

    .custom-fields-head {
      align-items: flex-start;
      flex-direction: column;
    }

    .entry-field-selector {
      grid-template-columns: 1fr;
    }
  }
</style>
