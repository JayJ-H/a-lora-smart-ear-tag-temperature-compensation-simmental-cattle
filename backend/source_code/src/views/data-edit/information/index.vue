<template>
  <FcPageShell
    :title="pageTitle"
    :description="pageDescription"
    status-label="当前牛只"
    :status-value="selectedCowLabel"
  >
    <section class="edit-layout">
      <FcPanel title="选择牛只" subtitle="输入牛号、耳号、RFID 或 cowId">
        <CowNumberAutocomplete
          v-model="cowKeyword"
          placeholder="搜索牛号"
          @select="handleCowSelect"
        />
        <div v-if="selectedCow.cowNumber" class="cow-summary">
          <strong>{{ selectedCow.cowNumber }}</strong>
          <span>{{ selectedCow.summary || '已匹配牛只档案' }}</span>
        </div>
      </FcPanel>

      <FcPanel title="修改类型" subtitle="与信息录入分组保持一致">
        <div class="group-grid">
          <button
            v-for="item in editGroups"
            :key="item.path"
            type="button"
            class="group-card"
            :class="{ active: activeGroup.path === item.path }"
            @click="goGroup(item)"
          >
            <ArtSvgIcon :icon="item.icon" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </FcPanel>
    </section>

    <section v-if="!isPedigreeMode" class="edit-main">
      <FcPanel :title="`${activeGroup.label}事件`" subtitle="选择最近录入事件后修改">
        <template #actions>
          <ElSelect
            v-model="selectedEventType"
            clearable
            placeholder="全部事件"
            style="width: 150px"
          >
            <ElOption
              v-for="event in filteredEventOptions"
              :key="event.code"
              :label="event.label"
              :value="event.code"
            />
          </ElSelect>
          <ElButton :loading="loadingEvents" @click="loadEvents">刷新</ElButton>
        </template>

        <FcEmptyState
          v-if="!selectedCow.cowNumber"
          title="先选择牛只"
          description="选择牛只后会显示该牛最近录入事件。"
          icon="ri:search-line"
        />
        <FcEmptyState
          v-else-if="!visibleEvents.length"
          title="暂无可修改事件"
          description="当前牛只在该业务块下没有最近录入事件。"
          icon="ri:file-list-3-line"
        />
        <div
          v-else
          ref="eventListRef"
          class="event-card-list"
          @scroll="onEventScroll"
          @wheel.passive="onEventWheel"
        >
          <button
            v-for="event in visibleEvents"
            :key="event.id"
            type="button"
            class="event-card"
            :class="{ active: editingEvent?.id === event.id }"
            @click="openEvent(event)"
          >
            <div>
              <strong>{{ event.eventName || event.eventCode }}</strong>
              <span>{{ formatDateTime(event.occurredAt) }}</span>
            </div>
            <div>
              <ElTag size="small">{{ event.status || '已记录' }}</ElTag>
              <small>{{ event.operatorName || '-' }}</small>
            </div>
            <p>{{ eventSummary(event) }}</p>
          </button>
        </div>
      </FcPanel>

      <FcPanel title="事件修改" subtitle="保存后同步标准表、旧镜像表、明细表和审计">
        <FcEmptyState
          v-if="!editingEvent"
          title="选择左侧事件"
          description="点开事件卡片后在这里修改字段。"
          icon="ri:edit-line"
        />
        <ElForm v-else label-position="top" class="edit-form">
          <div class="form-grid">
            <ElFormItem label="发生时间" required>
              <ElDatePicker
                v-model="editForm.occurredAt"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </ElFormItem>
            <ElFormItem label="事件状态">
              <ElSelect v-model="editForm.eventStatus" filterable>
                <ElOption
                  v-for="option in eventStatusOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="级别">
              <ElSelect v-model="editForm.severity" filterable>
                <ElOption
                  v-for="option in severityOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="修改原因" required>
              <ElInput v-model="editForm.reason" placeholder="填写本次修改原因" />
            </ElFormItem>
          </div>

          <div class="dynamic-grid">
            <ElFormItem
              v-for="field in activeFields"
              :key="field.fieldName"
              :label="field.label"
              :required="field.required"
            >
              <ElInput
                v-if="field.type === 'text'"
                v-model="dynamicForm[field.fieldName]"
                :placeholder="field.placeholder || field.label"
              />
              <ElInputNumber
                v-else-if="field.type === 'number'"
                v-model="dynamicForm[field.fieldName]"
                :min="field.min"
                :step="field.step || 1"
                style="width: 100%"
              />
              <ElDatePicker
                v-else-if="field.type === 'date'"
                v-model="dynamicForm[field.fieldName]"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
              <ElDatePicker
                v-else-if="field.type === 'datetime'"
                v-model="dynamicForm[field.fieldName]"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
              <ElSwitch
                v-else-if="field.type === 'boolean'"
                v-model="dynamicForm[field.fieldName]"
              />
              <ElSelect
                v-else
                v-model="dynamicForm[field.fieldName]"
                filterable
                :allow-create="field.allowCreate"
                default-first-option
              >
                <ElOption
                  v-for="option in optionsForField(field)"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </ElSelect>
            </ElFormItem>
          </div>

          <ElFormItem label="备注">
            <ElInput v-model="editForm.notes" type="textarea" :rows="3" />
          </ElFormItem>

          <div class="form-actions">
            <ElButton @click="resetEventForm">重置</ElButton>
            <ElButton type="primary" :loading="saving" @click="saveEvent">保存修改</ElButton>
          </div>
        </ElForm>
      </FcPanel>
    </section>

    <section v-else class="pedigree-main">
      <FcPanel title="系谱修改" subtitle="只保存父母号与祖代号，不自动创建完整父母牛档">
        <template #actions>
          <ElButton :loading="loadingPedigree" @click="loadPedigree">读取系谱</ElButton>
        </template>

        <FcEmptyState
          v-if="!selectedCow.cowNumber"
          title="先选择牛只"
          description="选择牛只后可修改父号、母号和祖代编号。"
          icon="ri:git-branch-line"
        />
        <ElForm v-else label-position="top" class="edit-form">
          <div class="dynamic-grid">
            <ElFormItem label="父号">
              <CowNumberAutocomplete
                v-model="pedigreeForm.fatherNumber"
                placeholder="父号，可为外部编号"
                allow-new
              />
            </ElFormItem>
            <ElFormItem label="母号">
              <CowNumberAutocomplete
                v-model="pedigreeForm.motherNumber"
                placeholder="母号，可为外部编号"
                allow-new
              />
            </ElFormItem>
            <ElFormItem label="父系祖父">
              <CowNumberAutocomplete
                v-model="pedigreeForm.paternalGrandfatherNumber"
                placeholder="父系祖父号"
                allow-new
              />
            </ElFormItem>
            <ElFormItem label="父系祖母">
              <CowNumberAutocomplete
                v-model="pedigreeForm.paternalGrandmotherNumber"
                placeholder="父系祖母号"
                allow-new
              />
            </ElFormItem>
            <ElFormItem label="母系祖父">
              <CowNumberAutocomplete
                v-model="pedigreeForm.maternalGrandfatherNumber"
                placeholder="母系祖父号"
                allow-new
              />
            </ElFormItem>
            <ElFormItem label="母系祖母">
              <CowNumberAutocomplete
                v-model="pedigreeForm.maternalGrandmotherNumber"
                placeholder="母系祖母号"
                allow-new
              />
            </ElFormItem>
          </div>
          <ElFormItem label="修改原因" required>
            <ElInput v-model="pedigreeReason" placeholder="填写本次修改原因" />
          </ElFormItem>
          <div class="form-actions">
            <ElButton @click="loadPedigree">重置</ElButton>
            <ElButton type="primary" :loading="saving" @click="savePedigree">保存系谱</ElButton>
          </div>
        </ElForm>
      </FcPanel>
    </section>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { ElMessage } from 'element-plus'
  import CowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import FcEmptyState from '@/components/business/fluent-console/FcEmptyState.vue'
  import { useLazyRenderWindow } from '@/hooks'
  import * as databaseService from '@/services/database'
  import {
    ensureInformationEntryEventDictionary,
    ensureInformationEntryOptionDictionaries,
    entryFieldScope,
    type InformationEntryEventOption,
    type SelectOption
  } from '@/services/platform-dictionary'
  import { EVENT_OPTIONS } from '@/services/import-templates'
  import { useUserStore } from '@/store/modules/user'
  import type { CustomField } from '@/utils/flexible-export'
  import { formatDateOnly } from '@/utils/date-display'
  import { SUPPORTED_CATTLE_BREEDS } from '@/utils/cattle-breeds'

  type CowSuggestion = {
    cowId?: string
    cowNumber: string
    summary?: string
  }

  type EditGroup = {
    path: string
    label: string
    eventGroup: string
    icon: string
  }

  const route = useRoute()
  const router = useRouter()
  const userStore = useUserStore()

  const editGroups: EditGroup[] = [
    { path: 'production', label: '生产修改', eventGroup: '生产', icon: 'ri:drop-line' },
    { path: 'reproduction', label: '繁殖修改', eventGroup: '繁殖', icon: 'ri:heart-pulse-line' },
    { path: 'health', label: '健康修改', eventGroup: '健康', icon: 'ri:first-aid-kit-line' },
    { path: 'movement', label: '转群修改', eventGroup: '转群', icon: 'ri:arrow-left-right-line' },
    { path: 'sampling', label: '采样修改', eventGroup: '采样', icon: 'ri:test-tube-line' },
    { path: 'device', label: '设备修改', eventGroup: '设备', icon: 'ri:rfid-line' },
    { path: 'research', label: '育种科研修改', eventGroup: '育种科研', icon: 'ri:dna-line' },
    { path: 'pedigree', label: '系谱修改', eventGroup: '系谱', icon: 'ri:git-branch-line' }
  ]

  const cowKeyword = ref('')
  const selectedCow = reactive<CowSuggestion>({ cowId: '', cowNumber: '', summary: '' })
  const selectedEventType = ref('')
  const eventOptions = ref<InformationEntryEventOption[]>(
    EVENT_OPTIONS.map((item) => ({ ...item }))
  )
  const customFields = ref<CustomField[]>([])
  const events = ref<databaseService.EditableCowEvent[]>([])
  const editingEvent = ref<databaseService.EditableCowEvent | null>(null)
  const loadingEvents = ref(false)
  const loadingPedigree = ref(false)
  const saving = ref(false)
  const eventListRef = ref<HTMLElement | null>(null)
  const severityOptions = ref<SelectOption[]>([])
  const eventStatusOptions = ref<SelectOption[]>([])
  const baseOptions = reactive<Record<string, SelectOption[]>>({
    pen: [],
    breed: [],
    medicine: [],
    medicineBatch: [],
    medicineUnit: [],
    vaccine: [],
    operator: [],
    transferReason: [],
    disease: [],
    trait: []
  })

  const editForm = reactive({
    occurredAt: '',
    eventStatus: '已记录',
    severity: '正常',
    notes: '',
    reason: ''
  })
  const dynamicForm = reactive<Record<string, any>>({})
  const pedigreeForm = reactive({
    fatherNumber: '',
    motherNumber: '',
    paternalGrandfatherNumber: '',
    paternalGrandmotherNumber: '',
    maternalGrandfatherNumber: '',
    maternalGrandmotherNumber: ''
  })
  const pedigreeReason = ref('')

  const activePath = computed(
    () => String(route.path).split('/').filter(Boolean).pop() || 'production'
  )
  const activeGroup = computed(
    () => editGroups.find((item) => item.path === activePath.value) || editGroups[0]
  )
  const isPedigreeMode = computed(() => activeGroup.value.path === 'pedigree')
  const pageTitle = computed(() => activeGroup.value.label)
  const pageDescription = computed(
    () => '按牛号回看最近录入记录，修改后同步事实表、兼容表、明细表和审计。'
  )
  const selectedCowLabel = computed(() => selectedCow.cowNumber || '未选择')
  const filteredEventOptions = computed(() =>
    eventOptions.value.filter((item) => item.group === activeGroup.value.eventGroup)
  )
  const activeFields = computed(() => {
    const scope = entryFieldScope(editingEvent.value?.eventCode || selectedEventType.value)
    return customFields.value
      .filter((field) => field.scope === scope && field.isActive !== false)
      .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0))
  })

  const {
    visibleItems: visibleEvents,
    handleScroll: onEventScroll,
    handleWheel: onEventWheel,
    resetVisibleCount: resetEventWindow
  } = useLazyRenderWindow(events, {
    initialCount: 8,
    batchSize: 8,
    mode: 'fixed-window'
  })

  onMounted(async () => {
    await loadDictionaries()
    await loadBaseOptions()
  })

  watch(
    () => activeGroup.value.path,
    async () => {
      selectedEventType.value = ''
      editingEvent.value = null
      events.value = []
      if (selectedCow.cowNumber) {
        if (isPedigreeMode.value) await loadPedigree()
        else await loadEvents()
      }
    }
  )

  watch(selectedEventType, () => {
    if (selectedCow.cowNumber && !isPedigreeMode.value) void loadEvents()
  })

  async function loadDictionaries() {
    const [baseRows, fieldRows] = await Promise.all([
      databaseService.getTableDataAsync('base-info-categories', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('custom-fields', { silent: true }).catch(() => [])
    ])
    const optionRows = await ensureInformationEntryOptionDictionaries(baseRows || [])
    eventOptions.value = await ensureInformationEntryEventDictionary(optionRows || [])
    customFields.value = (fieldRows || []) as CustomField[]
    severityOptions.value = baseInfoOptions(optionRows, 'information-entry:severity')
    eventStatusOptions.value = baseInfoOptions(optionRows, 'information-entry:event-status')
    if (!severityOptions.value.length)
      severityOptions.value = toOptions(['正常', '提示', '关注', '严重'])
    if (!eventStatusOptions.value.length)
      eventStatusOptions.value = toOptions(['已记录', '待复核', '已确认', '已作废'])
  }

  async function loadBaseOptions() {
    const [penRows, medicineRows, batchRows, reasonRows, diseaseRows, personRows, traitRows] =
      await Promise.all([
        databaseService.getTableDataAsync('pens', { silent: true }).catch(() => []),
        databaseService.getTableDataAsync('medicines', { silent: true }).catch(() => []),
        databaseService.getTableDataAsync('medicine-batch', { silent: true }).catch(() => []),
        databaseService.getTableDataAsync('transfer-reasons', { silent: true }).catch(() => []),
        databaseService.getTableDataAsync('diseases', { silent: true }).catch(() => []),
        databaseService.getTableDataAsync('persons', { silent: true }).catch(() => []),
        databaseService.getTableDataAsync('trait_definition', { silent: true }).catch(() => [])
      ])
    baseOptions.pen = rowsToOptions(
      penRows,
      ['name', 'label', 'penName', 'pen_name'],
      ['code', 'id', 'value']
    )
    baseOptions.breed = toOptions([...SUPPORTED_CATTLE_BREEDS])
    baseOptions.medicine = rowsToOptions(
      medicineRows,
      ['name', 'label', 'medicineName'],
      ['code', 'id', 'value']
    )
    baseOptions.medicineBatch = rowsToOptions(
      batchRows,
      ['batchNo', 'batch_no', 'name'],
      ['id', 'batchNo', 'batch_no']
    )
    baseOptions.transferReason = rowsToOptions(
      reasonRows,
      ['name', 'label'],
      ['value', 'code', 'id']
    )
    baseOptions.disease = rowsToOptions(diseaseRows, ['name', 'label'], ['code', 'id', 'value'])
    baseOptions.operator = rowsToOptions(
      personRows,
      ['name', 'label', 'personName'],
      ['id', 'code', 'value']
    )
    baseOptions.trait = rowsToOptions(
      traitRows,
      ['traitName', 'trait_name', 'name'],
      ['traitCode', 'trait_code', 'code', 'id']
    )
    baseOptions.medicineUnit = toOptions(['ml', 'mg', 'g', '支', '瓶', '次'])
    baseOptions.vaccine = baseOptions.medicine
  }

  function handleCowSelect(item: CowSuggestion) {
    selectedCow.cowId = item.cowId || ''
    selectedCow.cowNumber = item.cowNumber
    selectedCow.summary = item.summary || ''
    cowKeyword.value = item.cowNumber
    editingEvent.value = null
    if (isPedigreeMode.value) void loadPedigree()
    else void loadEvents()
  }

  async function loadEvents() {
    if (!selectedCow.cowNumber) return
    loadingEvents.value = true
    try {
      events.value = await databaseService.getEditableCowEvents(selectedCow, {
        eventGroup: activeGroup.value.eventGroup,
        eventType: selectedEventType.value,
        limit: 20
      })
      resetEventWindow()
    } finally {
      loadingEvents.value = false
    }
  }

  function openEvent(event: databaseService.EditableCowEvent) {
    editingEvent.value = event
    editForm.occurredAt = normalizeDateOnly(event.occurredAt)
    editForm.eventStatus = event.status || '已记录'
    editForm.severity = textValue(event.raw.severity || event.details.severity || '正常')
    editForm.notes = textValue(event.raw.notes || event.details.notes)
    editForm.reason = ''
    Object.keys(dynamicForm).forEach((key) => delete dynamicForm[key])
    activeFields.value.forEach((field) => {
      dynamicForm[field.fieldName] =
        event.details[field.fieldName] ?? event.details[field.label] ?? ''
    })
  }

  function resetEventForm() {
    if (editingEvent.value) openEvent(editingEvent.value)
  }

  async function saveEvent() {
    if (!editingEvent.value) return
    const missing = activeFields.value.find(
      (field) => field.required && !textValue(dynamicForm[field.fieldName])
    )
    if (missing) {
      ElMessage.error(`${missing.label} 不能为空`)
      return
    }
    if (!textValue(editForm.reason)) {
      ElMessage.error('请填写修改原因')
      return
    }
    saving.value = true
    try {
      const details = { ...editingEvent.value.details }
      activeFields.value.forEach((field) => {
        details[field.fieldName] = dynamicForm[field.fieldName]
        details[field.label] = dynamicForm[field.fieldName]
      })
      const updated = await databaseService.updateCowEvent(
        editingEvent.value.id,
        {
          occurredAt: editForm.occurredAt,
          eventStatus: editForm.eventStatus,
          severity: editForm.severity,
          notes: editForm.notes,
          details
        },
        {
          operatorId: operatorId(),
          operatorName: operatorName(),
          reason: editForm.reason
        }
      )
      ElMessage.success('事件修改已保存')
      await loadEvents()
      const matched = events.value.find((event) => event.id === updated.id)
      if (matched) openEvent(matched)
    } catch (error) {
      ElMessage.error(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      saving.value = false
    }
  }

  async function loadPedigree() {
    if (!selectedCow.cowNumber) return
    loadingPedigree.value = true
    try {
      const row = await databaseService.getEditablePedigree(selectedCow)
      pedigreeForm.fatherNumber = row.fatherNumber
      pedigreeForm.motherNumber = row.motherNumber
      pedigreeForm.paternalGrandfatherNumber = row.paternalGrandfatherNumber
      pedigreeForm.paternalGrandmotherNumber = row.paternalGrandmotherNumber
      pedigreeForm.maternalGrandfatherNumber = row.maternalGrandfatherNumber
      pedigreeForm.maternalGrandmotherNumber = row.maternalGrandmotherNumber
      pedigreeReason.value = ''
    } finally {
      loadingPedigree.value = false
    }
  }

  async function savePedigree() {
    if (!selectedCow.cowNumber) return
    if (!textValue(pedigreeReason.value)) {
      ElMessage.error('请填写修改原因')
      return
    }
    saving.value = true
    try {
      await databaseService.updateCowPedigree(selectedCow, pedigreeForm, {
        operatorId: operatorId(),
        operatorName: operatorName(),
        reason: pedigreeReason.value
      })
      ElMessage.success('系谱修改已保存')
      await loadPedigree()
    } catch (error) {
      ElMessage.error(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      saving.value = false
    }
  }

  function goGroup(item: EditGroup) {
    if (item.path === activeGroup.value.path) return
    router.push(`/information-edit/${item.path}`)
  }

  function optionsForField(field: CustomField) {
    if (field.optionSource === 'cow')
      return selectedCow.cowNumber
        ? [{ label: selectedCow.cowNumber, value: selectedCow.cowNumber }]
        : []
    if (field.optionSource && baseOptions[field.optionSource])
      return baseOptions[field.optionSource]
    return (field.options || []).map((item) => ({ label: item, value: item }))
  }

  function eventSummary(event: databaseService.EditableCowEvent) {
    return (
      Object.entries(event.details)
        .filter(
          ([key, value]) =>
            !['eventTime', 'event_time', 'sourceTable', 'source_table'].includes(key) &&
            textValue(value)
        )
        .slice(0, 4)
        .map(([key, value]) => `${key}: ${textValue(value)}`)
        .join(' / ') || '无额外字段'
    )
  }

  function baseInfoOptions(rows: any[], scope: string) {
    return (rows || [])
      .filter((row) => textValue(row.scope || row.payload?.scope) === scope)
      .map((row) => {
        const value = textValue(row.value || row.code || row.name || row.label)
        const label = textValue(row.label || row.name || row.value || row.code)
        return value ? { label: label || value, value, name: label || value } : null
      })
      .filter(Boolean) as SelectOption[]
  }

  function rowsToOptions(rows: any[], labelKeys: string[], valueKeys: string[]) {
    return (rows || [])
      .map((row) => {
        const value = firstText(...valueKeys.map((key) => row[key]))
        const label = firstText(...labelKeys.map((key) => row[key]), value)
        return value ? { label, value, name: label } : null
      })
      .filter(Boolean) as SelectOption[]
  }

  function toOptions(values: string[]) {
    return values.map((value) => ({ label: value, value, name: value }))
  }

  function operatorName() {
    const info: any = userStore.getUserInfo || {}
    return (
      textValue(
        info.realName || info.nickname || info.userName || info.username || info.name || info.userId
      ) || '当前用户'
    )
  }

  function operatorId() {
    const info: any = userStore.getUserInfo || {}
    return (
      textValue(
        info.userId ||
          info.id ||
          info.personId ||
          info.person_id ||
          info.userName ||
          info.username ||
          info.name
      ) || `current:${operatorName()}`
    )
  }

  function normalizeDateOnly(value: string) {
    return formatDateOnly(value, '')
  }

  function formatDateTime(value: string) {
    return formatDateOnly(value, '-')
  }

  function firstText(...values: unknown[]) {
    return values.map(textValue).find(Boolean) || ''
  }

  function textValue(value: unknown) {
    return String(value ?? '').trim()
  }
</script>

<style scoped lang="scss">
  .edit-layout,
  .edit-main {
    display: grid;
    grid-template-columns: minmax(0, 0.78fr) minmax(0, 1.22fr);
    gap: 12px;
    min-width: 0;
  }

  .pedigree-main {
    min-width: 0;
  }

  .cow-summary {
    display: grid;
    gap: 4px;
    margin-top: 12px;
    padding: 12px;
    background: var(--default-box-color);
    border: 1px solid var(--art-card-border);
    border-radius: calc(var(--custom-radius) / 2 + 2px);
  }

  .cow-summary span {
    color: var(--art-gray-600);
    font-size: 12px;
  }

  .group-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .group-card {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
    min-height: 42px;
    padding: 10px;
    cursor: pointer;
    background: var(--default-box-color);
    border: 1px solid var(--art-card-border);
    border-radius: calc(var(--custom-radius) / 2 + 2px);
    transition:
      transform 0.16s ease,
      border-color 0.16s ease;
  }

  .group-card:hover {
    transform: translateY(-2px);
  }

  .group-card.active {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary);
  }

  .group-card span {
    min-width: 0;
    overflow: hidden;
    font-size: 13px;
    font-weight: 720;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .event-card-list {
    display: grid;
    gap: 10px;
    max-height: 560px;
    padding-right: 4px;
    overflow: auto;
  }

  .event-card {
    display: grid;
    gap: 8px;
    width: 100%;
    min-width: 0;
    padding: 12px;
    text-align: left;
    cursor: pointer;
    background: var(--default-box-color);
    border: 1px solid var(--art-card-border);
    border-radius: calc(var(--custom-radius) / 2 + 2px);
  }

  .event-card.active {
    border-color: var(--el-color-primary);
    box-shadow: 0 10px 24px rgb(64 112 244 / 14%);
  }

  .event-card > div {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
  }

  .event-card strong,
  .event-card span,
  .event-card small,
  .event-card p {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .event-card span,
  .event-card small,
  .event-card p {
    color: var(--art-gray-600);
    font-size: 12px;
  }

  .event-card p {
    margin: 0;
  }

  .edit-form {
    min-width: 0;
  }

  .form-grid,
  .dynamic-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 12px;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  :deep(.el-select),
  :deep(.el-input),
  :deep(.el-date-editor) {
    width: 100%;
  }

  @media (max-width: 1180px) {
    .edit-layout,
    .edit-main {
      grid-template-columns: 1fr;
    }

    .group-grid,
    .form-grid,
    .dynamic-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 680px) {
    .group-grid,
    .form-grid,
    .dynamic-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
