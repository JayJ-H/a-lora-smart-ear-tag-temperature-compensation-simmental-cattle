<template>
  <div class="entry-page">
    <div class="entry-page-head">
      <div>
        <h1>繁殖录入</h1>
        <p>记录输精、妊检、产犊和流产，胎次与本胎统计由系统按产犊周期计算。</p>
      </div>
      <div class="entry-page-head__chips" aria-label="繁殖录入口径">
        <span>一次提交一条事件</span>
        <span>胎次系统计算</span>
        <span>产犊可生成犊牛档案</span>
      </div>
    </div>

    <div class="entry-summary-strip">
      <div>
        <small>提交结果</small>
        <strong>繁殖事件 + 周期重算</strong>
      </div>
      <div>
        <small>胎次口径</small>
        <strong>产犊日至下次产犊前</strong>
      </div>
      <div>
        <small>最近记录</small>
        <strong>右侧 10 条懒渲染</strong>
      </div>
    </div>

    <section class="entry-workbench">
      <div class="entry-panel entry-form-panel">
        <div class="entry-panel__head">
          <div>
            <h2>繁殖事件信息</h2>
            <p>输精次数、空怀天数、产犊间隔等作为逻辑性状统计，不在这里手填。</p>
          </div>
          <ElTag type="success" effect="plain">单条录入</ElTag>
        </div>

        <ElForm
          ref="formRef"
          :model="formData"
          :rules="formRules"
          label-width="120px"
          class="entry-form"
        >
          <ElRow :gutter="20">
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="牛号" prop="cowNumber">
                <CowNumberAutocomplete
                  v-model="formData.cowNumber"
                  placeholder="请输入或选择已有牛号"
                  @blur="checkCowStatus"
                  @select="checkCowStatus"
                />
                <div class="text-xs text-gray-500 mt-1">
                  <span :class="cowStatus.class">{{ cowStatus.text }}</span>
                </div>
              </ElFormItem>
            </ElCol>
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="事件类型" prop="eventType">
                <ElSelect v-model="formData.eventType" placeholder="请选择事件类型" class="w-full">
                  <ElOption label="配种" value="配种" />
                  <ElOption label="妊检" value="妊检" />
                  <ElOption label="产犊" value="产犊" />
                  <ElOption label="流产" value="流产" />
                </ElSelect>
              </ElFormItem>
            </ElCol>
          </ElRow>

          <ElRow :gutter="20">
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="事件时间" prop="eventTime">
                <ElDatePicker
                  v-model="formData.eventTime"
                  type="date"
                  placeholder="请选择事件时间"
                  format="YYYY-MM-DD"
                  value-format="YYYY-MM-DD"
                  class="w-full"
                />
              </ElFormItem>
            </ElCol>
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="执行人员" prop="operator">
                <ElSelect
                  v-model="formData.operator"
                  placeholder="请选择执行人员"
                  class="w-full"
                  filterable
                >
                  <ElOption
                    v-for="person in operatorOptions"
                    :key="person.id"
                    :label="`${person.name}${person.role ? `（${person.role}）` : ''}`"
                    :value="person.id"
                  />
                </ElSelect>
              </ElFormItem>
            </ElCol>
          </ElRow>

          <template v-if="formData.eventType === '配种'">
            <ElRow :gutter="20">
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="精液编号">
                  <ElInput v-model="formData.semenNumber" placeholder="请输入精液编号" />
                </ElFormItem>
              </ElCol>
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="公牛编号">
                  <ElInput v-model="formData.bullNumber" placeholder="请输入公牛编号（可选）" />
                </ElFormItem>
              </ElCol>
            </ElRow>
            <ElRow :gutter="20">
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="配种方式">
                  <ElSelect
                    v-model="formData.breedingMethod"
                    placeholder="请选择配种方式"
                    class="w-full"
                  >
                    <ElOption label="人工授精" value="人工授精" />
                    <ElOption label="自然交配" value="自然交配" />
                  </ElSelect>
                </ElFormItem>
              </ElCol>
            </ElRow>
          </template>

          <template v-if="formData.eventType === '妊检'">
            <ElRow :gutter="20">
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="妊检结果">
                  <ElSelect
                    v-model="formData.pregnancyResult"
                    placeholder="请选择妊检结果"
                    class="w-full"
                  >
                    <ElOption label="阴性" value="阴性" />
                    <ElOption label="阳性" value="阳性" />
                  </ElSelect>
                </ElFormItem>
              </ElCol>
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="预产日期">
                  <ElDatePicker
                    v-model="formData.dueDate"
                    type="date"
                    placeholder="请选择预产日期"
                    format="YYYY-MM-DD"
                    value-format="YYYY-MM-DD"
                    class="w-full"
                  />
                </ElFormItem>
              </ElCol>
            </ElRow>
          </template>

          <template v-if="formData.eventType === '产犊'">
            <ElRow :gutter="20">
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="产犊结果">
                  <ElSelect
                    v-model="formData.calvingResult"
                    placeholder="请选择产犊结果"
                    class="w-full"
                  >
                    <ElOption label="正常" value="正常" />
                    <ElOption label="难产" value="难产" />
                    <ElOption label="死胎" value="死胎" />
                  </ElSelect>
                </ElFormItem>
              </ElCol>
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="犊牛数量">
                  <ElInputNumber
                    v-model="formData.offspringCount"
                    :min="0"
                    :max="5"
                    class="w-full"
                  />
                </ElFormItem>
              </ElCol>
            </ElRow>
            <div v-if="formData.offspringCount > 0" class="calf-row-list">
              <div class="calf-row-list__head">
                <span>逐头犊牛档案</span>
                <small>提交后自动建档，并按本次产犊事件写入父母关系</small>
              </div>
              <div v-for="(calf, index) in formData.calfRows" :key="index" class="calf-row">
                <strong>犊牛 {{ index + 1 }}</strong>
                <ElInput v-model="calf.cowNumber" placeholder="犊牛号" />
                <ElInput v-model="calf.earTagNumber" placeholder="耳号（可选）" />
                <ElSelect v-model="calf.sex" placeholder="性别">
                  <ElOption label="公" value="公" />
                  <ElOption label="母" value="母" />
                  <ElOption label="未知" value="未知" />
                </ElSelect>
                <ElInput v-model="calf.remark" placeholder="备注（可选）" />
              </div>
            </div>
          </template>

          <template v-if="formData.eventType === '流产'">
            <ElRow :gutter="20">
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="流产原因">
                  <ElInput v-model="formData.abortionReason" placeholder="请输入流产原因" />
                </ElFormItem>
              </ElCol>
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="妊娠天数">
                  <ElInputNumber
                    v-model="formData.gestationDays"
                    :min="0"
                    :max="320"
                    class="w-full"
                  />
                </ElFormItem>
              </ElCol>
            </ElRow>
          </template>

          <ElFormItem label="备注">
            <ElInput v-model="formData.notes" type="textarea" :rows="3" placeholder="可选备注" />
          </ElFormItem>

          <ElFormItem class="entry-form-actions">
            <ElButton type="primary" @click="handleSubmit" :loading="submitLoading">
              <ArtSvgIcon icon="ri:add-line" class="mr-2" />提交
            </ElButton>
            <ElButton @click="handleReset">
              <ArtSvgIcon icon="ri:refresh-line" class="mr-2" />重置
            </ElButton>
          </ElFormItem>
        </ElForm>
      </div>
      <RecentEventRecords
        title="最近繁殖记录"
        :event-types="['insemination', 'pregnancy_check', 'calving', 'abortion']"
        :refresh-key="recentRefreshKey"
        :records="recentEventSourceRows"
      />
    </section>

    <div class="entry-panel entry-history-panel">
      <div class="entry-panel__head entry-panel__head--inline">
        <div>
          <h2>繁殖事件历史</h2>
          <p>点击记录可查看追溯详情，表格只渲染当前窗口以避免卡顿。</p>
        </div>
        <div class="entry-page-size">
          <span>每页</span>
          <ElSelect v-model="pageSize" size="small" style="width: 80px">
            <ElOption :value="10" label="10" />
            <ElOption :value="20" label="20" />
            <ElOption :value="50" label="50" />
          </ElSelect>
        </div>
      </div>

      <div class="entry-table-shell">
        <ElTable
          :data="visibleBreedingEvents"
          height="420"
          style="width: 100%"
          :loading="tableLoading"
          class="entry-history-table entry-history-table--wide breeding-event-table"
          @wheel.passive="onBreedingTableWheel"
          @row-click="openEventDetail"
        >
          <ElTableColumn prop="cowNumber" label="牛号" width="110" />
          <ElTableColumn prop="eventType" label="事件类型" width="110" />
          <ElTableColumn prop="eventTime" label="事件时间" width="180">
            <template #default="{ row }">{{ formatDateTime(row.eventTime) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="person" label="执行人员" width="120" />
          <ElTableColumn prop="semenNumber" label="精液编号" width="130" />
          <ElTableColumn prop="pregnancyResult" label="妊检结果" width="110" />
          <ElTableColumn prop="calvingResult" label="产犊结果" width="110" />
          <ElTableColumn prop="notes" label="备注" min-width="180" show-overflow-tooltip />
        </ElTable>
      </div>
      <div v-if="breedingEvents.length > visibleBreedingEvents.length" class="load-more-row">
        <ElButton size="small" plain @click="() => loadMoreBreedingEvents()">
          加载更多 {{ visibleBreedingEvents.length }}/{{ breedingEvents.length }}
        </ElButton>
      </div>

      <ElPagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="totalEvents"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      />
    </div>

    <ElDialog v-model="detailVisible" title="繁殖事件详情" width="760px">
      <section v-if="selectedEvent" class="event-detail-panel">
        <div class="event-detail-heading">
          <span>{{ selectedEvent.eventType }}</span>
          <h3>{{ selectedEvent.cowNumber }}</h3>
          <p>{{ selectedEvent.notes || '无备注' }}</p>
        </div>

        <div class="event-detail-grid">
          <div v-for="row in eventDetailRows" :key="row.label">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
      </section>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import type { FormInstance, FormRules } from 'element-plus'
  import * as databaseService from '@/services/database'
  import { useLazyRenderWindow } from '@/hooks'
  import CowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'
  import RecentEventRecords from '../components/RecentEventRecords.vue'
  import { formatDateOnly } from '@/utils/date-display'

  type BreedingEventType = '配种' | '妊检' | '产犊' | '流产'
  type BreedingMethod = '人工授精' | '自然交配'
  type PregnancyResult = '阴性' | '阳性'
  type CalvingResult = '正常' | '难产' | '死胎'
  type OffspringGender = '公' | '母' | '未知'

  interface CalfRow {
    cowNumber: string
    earTagNumber: string
    sex: OffspringGender | ''
    remark: string
  }

  interface BreedingForm {
    cowNumber: string
    eventType: BreedingEventType | ''
    eventTime: string
    operator: string
    semenNumber: string
    bullNumber: string
    breedingMethod: BreedingMethod | ''
    pregnancyResult: PregnancyResult | ''
    dueDate: string
    calvingResult: CalvingResult | ''
    offspringCount: number
    offspringGender: OffspringGender | ''
    calfRows: CalfRow[]
    abortionReason: string
    gestationDays: number
    notes: string
  }

  interface BreedingEventRecord {
    id: string
    cowNumber: string
    eventType: BreedingEventType
    eventDate?: string
    eventTime: string
    person: string
    operator?: string
    operatorName?: string
    semenNumber?: string
    bullNumber?: string
    breedingMethod?: string
    pregnancyResult?: string
    dueDate?: string
    calvingResult?: string
    deliveryResult?: string
    offspringCount?: number
    offspringGender?: string
    calfRows?: CalfRow[]
    abortionReason?: string
    gestationDays?: number
    notes?: string
    createdAt: string
  }

  interface SimplePerson {
    id: string
    name: string
    role?: string
  }

  const formRef = ref<FormInstance>()
  const submitLoading = ref(false)
  const tableLoading = ref(false)
  const recentRefreshKey = ref(0)
  const recentEventSourceRows = ref<any[]>([])
  const cowStatus = ref({ text: '', class: 'text-gray-500' })

  const currentPage = ref(1)
  const pageSize = ref(10)
  const totalEvents = ref(0)
  const breedingEvents = ref<BreedingEventRecord[]>([])
  const {
    visibleItems: visibleBreedingEvents,
    loadMore: loadMoreBreedingEvents,
    handleWheel: onBreedingTableWheel
  } = useLazyRenderWindow(breedingEvents, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const detailVisible = ref(false)
  const selectedEvent = ref<BreedingEventRecord | null>(null)

  const persons = ref<SimplePerson[]>([])

  function createCalfRow(): CalfRow {
    return {
      cowNumber: '',
      earTagNumber: '',
      sex: '未知',
      remark: ''
    }
  }

  const todayKey = () => new Date().toISOString().slice(0, 10)

  const formData = reactive<BreedingForm>({
    cowNumber: '',
    eventType: '',
    eventTime: todayKey(),
    operator: '',
    semenNumber: '',
    bullNumber: '',
    breedingMethod: '',
    pregnancyResult: '',
    dueDate: '',
    calvingResult: '',
    offspringCount: 1,
    offspringGender: '',
    calfRows: [createCalfRow()],
    abortionReason: '',
    gestationDays: 0,
    notes: ''
  })

  const formRules: FormRules = {
    cowNumber: [{ required: true, message: '请输入牛号', trigger: 'blur' }],
    eventType: [{ required: true, message: '请选择事件类型', trigger: 'change' }],
    eventTime: [{ required: true, message: '请选择事件时间', trigger: 'change' }],
    operator: [{ required: true, message: '请选择执行人员', trigger: 'change' }]
  }

  watch(
    () => formData.offspringCount,
    (count) => {
      const target = Math.max(0, Math.min(5, Math.floor(Number(count) || 0)))
      if (formData.calfRows.length > target) {
        formData.calfRows.splice(target)
      }
      while (formData.calfRows.length < target) {
        formData.calfRows.push(createCalfRow())
      }
    },
    { immediate: true }
  )

  const normalize = (value: unknown): string => (value == null ? '' : String(value))
  const cowNumberOf = (row: any) =>
    normalize(
      row?.cowNumber || row?.cow_number || row?.animalNumber || row?.animal_number || row?.number
    )
  const findCowByNumber = async (cowNumber: string) => {
    const [cows, animals] = await Promise.all([
      databaseService.getTableDataAsync('cows', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('animal', { silent: true }).catch(() => [])
    ])
    return [...(cows || []), ...(animals || [])].find((cow: any) => cowNumberOf(cow) === cowNumber)
  }

  const mapPerson = (raw: any): SimplePerson => ({
    id: normalize(
      raw.id || raw.personId || raw.name || raw.personName || raw.operator || 'p-unknown'
    ),
    name: normalize(raw.name || raw.personName),
    role: normalize(raw.role || raw.roleName) || undefined
  })

  const _mapBreedingEvent = (raw: any): BreedingEventRecord => ({
    id: normalize(raw.id),
    cowNumber: normalize(raw.cowNumber),
    eventType: (normalize(raw.eventType) || '配种') as BreedingEventType,
    eventDate: normalize(raw.eventDate) || undefined,
    eventTime: normalize(raw.eventTime || raw.eventDate || raw.createdAt),
    person: normalize(raw.person || raw.operatorName || raw.operator),
    operator: normalize(raw.operator) || undefined,
    operatorName: normalize(raw.operatorName) || undefined,
    semenNumber: normalize(raw.semenNumber) || undefined,
    bullNumber: normalize(raw.bullNumber) || undefined,
    breedingMethod: normalize(raw.breedingMethod) || undefined,
    pregnancyResult: normalize(raw.pregnancyResult) || undefined,
    dueDate: normalize(raw.dueDate) || undefined,
    calvingResult: normalize(raw.calvingResult || raw.deliveryResult) || undefined,
    deliveryResult: normalize(raw.deliveryResult) || undefined,
    offspringCount: Number(raw.offspringCount || 0) || undefined,
    offspringGender: normalize(raw.offspringGender) || undefined,
    abortionReason: normalize(raw.abortionReason) || undefined,
    gestationDays: Number(raw.gestationDays || 0) || undefined,
    notes: normalize(raw.notes) || undefined,
    createdAt: normalize(raw.createdAt || raw.eventTime)
  })

  const operatorOptions = computed(() => {
    const filtered = persons.value.filter((person) => {
      const role = person.role || ''
      return role.includes('繁殖') || role.includes('兽医') || role.includes('技术')
    })
    return filtered.length > 0 ? filtered : persons.value
  })

  const getOperatorName = (operatorId: string) => {
    const person = persons.value.find((item) => item.id === operatorId)
    return person?.name || operatorId
  }

  const normalizedCalfRows = () =>
    formData.calfRows
      .slice(0, Math.max(0, formData.offspringCount || 0))
      .map((row) => ({
        cowNumber: row.cowNumber.trim(),
        earTagNumber: row.earTagNumber.trim(),
        sex: row.sex || '未知',
        remark: row.remark.trim()
      }))
      .filter((row) => row.cowNumber)

  const eventDetailRows = computed(() => {
    const event = selectedEvent.value
    if (!event) return []
    return [
      { label: '记录 ID', value: event.id },
      { label: '牛号', value: event.cowNumber },
      { label: '事件类型', value: event.eventType },
      { label: '事件时间', value: formatDateTime(event.eventTime) },
      { label: '执行人员', value: event.person || event.operatorName || event.operator || '-' },
      { label: '精液编号', value: event.semenNumber || '-' },
      { label: '公牛编号', value: event.bullNumber || '-' },
      { label: '配种方式', value: event.breedingMethod || '-' },
      { label: '妊检结果', value: event.pregnancyResult || '-' },
      { label: '预产日期', value: event.dueDate || '-' },
      { label: '产犊结果', value: event.calvingResult || event.deliveryResult || '-' },
      { label: '犊牛数量', value: event.offspringCount ?? '-' },
      { label: '犊牛性别', value: event.offspringGender || '-' },
      { label: '流产原因', value: event.abortionReason || '-' },
      { label: '妊娠天数', value: event.gestationDays ?? '-' },
      { label: '关联台账', value: '繁殖事件台账' },
      { label: '来源记录', value: event.id },
      { label: '入库依据', value: '场内繁殖录入记录' },
      { label: '统计口径', value: '按单牛繁殖事件记录追溯' },
      { label: '创建时间', value: formatDateTime(event.createdAt) },
      { label: '操作人', value: event.operatorName || event.person || event.operator || 'admin' }
    ]
  })

  const loadBaseData = async () => {
    try {
      const rows = await databaseService.getTableDataAsync('persons')
      persons.value = (rows || []).map(mapPerson).filter((x) => x.name)
    } catch (error) {
      console.error('加载人员数据失败:', error)
    }
  }

  const loadBreedingEvents = async () => {
    tableLoading.value = true
    try {
      const all = await databaseService.getUnifiedCowEventRowsAsync()
      recentEventSourceRows.value = all || []
      const breedingRecords = (all || []).filter((e: any) =>
        ['breeding', 'insemination', 'pregnancy_check', 'calving', 'abortion'].includes(e.eventType)
      )
      const mapped = breedingRecords
        .map((e: any) => {
          const eventTypeLabel = ['breeding', 'insemination'].includes(e.eventType)
            ? e.details?.method || '配种'
            : e.eventType === 'pregnancy_check'
              ? e.details?.checkMethod || '妊检'
              : e.eventType === 'abortion'
                ? '流产'
                : '产犊'
          return {
            id: normalize(e.id),
            cowNumber: normalize(e.cowNumber),
            eventType: eventTypeLabel,
            eventDate: normalize(e.details?.eventDate) || '',
            eventTime: normalize(e.eventTime),
            person: normalize(e.operatorName) || '',
            semenNumber: normalize(e.details?.semenBatch) || '',
            bullNumber: normalize(e.details?.bullNumber) || '',
            breedingMethod: normalize(e.details?.method) || '',
            pregnancyResult: normalize(e.details?.result) || '',
            calvingResult: normalize(e.details?.deliveryMethod) || '',
            offspringCount: e.details?.calfCount || 0,
            offspringGender: normalize(e.details?.calfDetails?.[0]?.gender) || '',
            offspringStatus: normalize(e.details?.calfDetails?.[0]?.status) || '',
            notes: normalize(e.notes) || undefined,
            createdAt: normalize(e.createdAt)
          }
        })
        .sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime())

      totalEvents.value = mapped.length
      const start = (currentPage.value - 1) * pageSize.value
      const end = start + pageSize.value
      breedingEvents.value = mapped.slice(start, end)
    } catch (error) {
      console.error('加载繁殖事件失败:', error)
      ElMessage.error('加载繁殖事件失败')
    } finally {
      tableLoading.value = false
    }
  }

  const checkCowStatus = async () => {
    const cowNumber = formData.cowNumber.trim()
    if (!cowNumber) {
      cowStatus.value = { text: '', class: 'text-gray-500' }
      return
    }

    try {
      const cow = await findCowByNumber(cowNumber)
      if (!cow) {
        cowStatus.value = { text: '牛号不存在', class: 'text-red-600' }
        return
      }
      cowStatus.value = {
        text: `当前状态：${normalize(cow.status) || '未知'} / 当前栏舍：${normalize(cow.currentPen) || '未设置'}`,
        class: 'text-green-600'
      }
    } catch {
      cowStatus.value = { text: '校验失败', class: 'text-yellow-600' }
    }
  }

  const validateByEventType = () => {
    if (formData.eventType === '配种' && !formData.semenNumber.trim()) {
      ElMessage.warning('配种事件需要填写精液编号')
      return false
    }
    if (formData.eventType === '妊检' && !formData.pregnancyResult) {
      ElMessage.warning('妊检事件需要选择妊检结果')
      return false
    }
    if (formData.eventType === '产犊' && !formData.calvingResult) {
      ElMessage.warning('产犊事件需要选择产犊结果')
      return false
    }
    if (formData.eventType === '产犊' && formData.offspringCount > 0) {
      const missingIndex = formData.calfRows.findIndex((row) => !row.cowNumber.trim())
      if (missingIndex >= 0) {
        ElMessage.warning(`请填写犊牛 ${missingIndex + 1} 的牛号`)
        return false
      }
      const calfNumbers = formData.calfRows.map((row) => row.cowNumber.trim()).filter(Boolean)
      if (new Set(calfNumbers).size !== calfNumbers.length) {
        ElMessage.warning('同一次产犊内犊牛号不能重复')
        return false
      }
    }
    if (formData.eventType === '流产' && !formData.abortionReason.trim()) {
      ElMessage.warning('流产事件需要填写流产原因')
      return false
    }
    return true
  }

  const formatDateTime = (value: string) => {
    return formatDateOnly(value, '--')
  }

  const handleSubmit = async () => {
    if (!formRef.value) return

    try {
      await formRef.value.validate()
    } catch {
      return
    }

    if (!validateByEventType()) return

    submitLoading.value = true
    try {
      const eventId = `breeding-${Date.now()}`
      const now = new Date().toISOString()
      const cowNumber = formData.cowNumber.trim()
      const eventTime = formData.eventTime || now
      const operatorName = getOperatorName(formData.operator)

      // 写入统一事件表（优先）
      const unifiedType =
        formData.eventType === '妊检'
          ? 'pregnancy_check'
          : formData.eventType === '产犊'
            ? 'calving'
            : formData.eventType === '流产'
              ? 'abortion'
              : 'insemination'

      const details: any = {}
      if (unifiedType === 'insemination') {
        details.method = formData.breedingMethod || '人工授精'
        details.semenBatch = formData.semenNumber.trim() || undefined
        details.bullNumber = formData.bullNumber.trim() || undefined
      } else if (unifiedType === 'pregnancy_check') {
        details.checkMethod = 'B超'
        details.result = formData.pregnancyResult || undefined
        details.expectedDueDate = formData.dueDate || undefined
      } else if (unifiedType === 'calving') {
        const calfRows = normalizedCalfRows()
        details.calfCount = calfRows.length || formData.offspringCount || 1
        details.calf_count = details.calfCount
        details.calves = calfRows
        details.calfRows = calfRows
        details.deliveryMethod = formData.calvingResult === '正常' ? '顺产' : '难产'
        details.gestationDays = formData.gestationDays || undefined
      } else if (unifiedType === 'abortion') {
        details.abortionReason = formData.abortionReason.trim() || undefined
        details.gestationDays = formData.gestationDays || undefined
      }

      await databaseService.addCowEvent({
        id: eventId,
        cowNumber,
        eventType: unifiedType,
        eventTime,
        operatorName,
        details,
        notes: formData.notes.trim() || undefined
      })

      // 兼容：仍写入旧表
      const newEvent: BreedingEventRecord = {
        id: eventId,
        cowNumber,
        eventType: formData.eventType as BreedingEventType,
        eventDate: eventTime.split('T')[0],
        eventTime,
        person: operatorName,
        operator: formData.operator,
        operatorName,
        semenNumber: formData.semenNumber.trim() || undefined,
        bullNumber: formData.bullNumber.trim() || undefined,
        breedingMethod: formData.breedingMethod || undefined,
        pregnancyResult: formData.pregnancyResult || undefined,
        dueDate: formData.dueDate || undefined,
        calvingResult: formData.calvingResult || undefined,
        deliveryResult: formData.calvingResult || undefined,
        offspringCount: normalizedCalfRows().length || formData.offspringCount || undefined,
        offspringGender: normalizedCalfRows()[0]?.sex || formData.offspringGender || undefined,
        calfRows: unifiedType === 'calving' ? normalizedCalfRows() : undefined,
        abortionReason: formData.abortionReason.trim() || undefined,
        gestationDays: formData.gestationDays || undefined,
        notes: formData.notes.trim() || undefined,
        createdAt: now
      }
      await databaseService.addTableDataAsync('breeding-events', newEvent)

      ElMessage.success('繁殖事件录入成功')
      handleReset()
      await loadBreedingEvents()
      recentRefreshKey.value += 1
    } catch (error: any) {
      console.error('提交繁殖事件失败:', error)
      ElMessage.error(error?.message || '提交失败')
    } finally {
      submitLoading.value = false
    }
  }

  const handleReset = () => {
    formRef.value?.resetFields()
    formData.eventTime = todayKey()
    formData.offspringCount = 1
    formData.offspringGender = ''
    formData.calfRows.splice(0, formData.calfRows.length, createCalfRow())
    formData.gestationDays = 0
    cowStatus.value = { text: '', class: 'text-gray-500' }
  }

  const handleSizeChange = (size: number) => {
    pageSize.value = size
    currentPage.value = 1
    void loadBreedingEvents()
  }

  const handleCurrentChange = (page: number) => {
    currentPage.value = page
    void loadBreedingEvents()
  }

  const openEventDetail = (row: BreedingEventRecord) => {
    selectedEvent.value = row
    detailVisible.value = true
  }

  onMounted(() => {
    void loadBaseData()
    void loadBreedingEvents()
  })

  defineOptions({ name: 'BreedingEvent' })
</script>

<style scoped lang="scss" src="../entry-layout.scss"></style>
<style scoped lang="scss">
  .calf-row-list {
    display: grid;
    gap: 10px;
    padding: 12px;
    margin: 4px 0 18px 120px;
    border: 1px solid rgb(148 163 184 / 20%);
    border-radius: 8px;
    background: rgb(248 250 252 / 70%);
  }

  .calf-row-list__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;

    span {
      color: #0f172a;
      font-weight: 800;
    }

    small {
      color: #64748b;
      font-size: 12px;
    }
  }

  .calf-row {
    display: grid;
    grid-template-columns: 74px repeat(4, minmax(0, 1fr));
    gap: 10px;
    align-items: center;

    strong {
      color: #334155;
      font-size: 13px;
      white-space: nowrap;
    }
  }

  .breeding-event-table :deep(.el-table__body tr) {
    cursor: pointer;
    transition: background 0.18s ease;
  }

  .breeding-event-table :deep(.el-table__body tr:hover) {
    background: rgb(248 250 252);
  }

  .event-detail-panel {
    display: grid;
    gap: 18px;
  }

  .event-detail-heading {
    padding: 18px;
    color: white;
    background: #2f6f7f;
    border-radius: 8px;
  }

  .event-detail-heading span {
    font-size: 13px;
    opacity: 0.86;
  }

  .event-detail-heading h3 {
    margin: 6px 0;
    font-size: 24px;
    font-weight: 700;
  }

  .event-detail-heading p {
    margin: 0;
    opacity: 0.9;
  }

  .event-detail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 12px;
  }

  .event-detail-grid div {
    padding: 12px;
    background: rgb(248 250 252);
    border: 1px solid rgb(226 232 240);
    border-radius: 8px;
  }

  .event-detail-grid span {
    display: block;
    margin-bottom: 5px;
    font-size: 12px;
    color: rgb(100 116 139);
  }

  .event-detail-grid strong {
    color: rgb(15 23 42);
  }

  .dark .event-detail-grid div {
    background: rgb(15 23 42 / 70%);
    border-color: rgb(148 163 184 / 22%);
  }

  .dark .event-detail-grid span {
    color: rgb(148 163 184);
  }

  .dark .event-detail-grid strong {
    color: rgb(248 250 252);
  }

  :global(.dark) .calf-row-list {
    border-color: rgb(255 255 255 / 12%);
    background: rgb(15 23 42 / 42%);
  }

  :global(.dark) .calf-row-list__head span,
  :global(.dark) .calf-row strong {
    color: #f8fafc;
  }

  :global(.dark) .calf-row-list__head small {
    color: #cbd5e1;
  }

  @media (max-width: 920px) {
    .calf-row-list {
      margin-left: 0;
    }

    .calf-row {
      grid-template-columns: 1fr;
    }

    .calf-row-list__head {
      display: grid;
    }
  }
</style>
