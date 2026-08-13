<template>
  <div class="entry-page">
    <div class="entry-page-head">
      <div>
        <h1>兽医录入</h1>
        <p>记录发病、治疗、用药、免疫、手术和健康检查，疾病与药品来自平台字典。</p>
      </div>
      <div class="entry-page-head__chips" aria-label="兽医录入口径">
        <span>必须已有牛号</span>
        <span>疾病药品字典选择</span>
        <span>健康状态联动更新</span>
      </div>
    </div>

    <div class="entry-summary-strip">
      <div>
        <small>提交结果</small>
        <strong>兽医事件 + 健康状态</strong>
      </div>
      <div>
        <small>用药口径</small>
        <strong>药品/疫苗按字典追溯</strong>
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
            <h2>兽医事件信息</h2>
            <p>除症状、手术说明、备注等现场描述外，关键口径均从字典选择。</p>
          </div>
          <ElTag type="danger" effect="plain">单条录入</ElTag>
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
                  <ElOption label="发病" value="发病" />
                  <ElOption label="治疗" value="治疗" />
                  <ElOption label="用药" value="用药" />
                  <ElOption label="免疫" value="免疫" />
                  <ElOption label="手术" value="手术" />
                  <ElOption label="检查" value="检查" />
                </ElSelect>
              </ElFormItem>
            </ElCol>
          </ElRow>

          <ElRow :gutter="20">
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="发生时间" prop="eventTime">
                <ElDatePicker
                  v-model="formData.eventTime"
                  type="date"
                  placeholder="请选择发生时间"
                  format="YYYY-MM-DD"
                  value-format="YYYY-MM-DD"
                  class="w-full"
                />
              </ElFormItem>
            </ElCol>
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="记录人" prop="veterinarian">
                <ElSelect
                  v-model="formData.veterinarian"
                  placeholder="请选择记录人"
                  class="w-full"
                  filterable
                >
                  <ElOption
                    v-for="person in veterinarianOptions"
                    :key="person.id"
                    :label="`${person.name}${person.role ? `（${person.role}）` : ''}`"
                    :value="person.id"
                  />
                </ElSelect>
              </ElFormItem>
            </ElCol>
          </ElRow>

          <template v-if="formData.eventType === '发病'">
            <ElRow :gutter="20">
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="疾病名称">
                  <ElSelect
                    v-model="formData.disease"
                    placeholder="请选择疾病"
                    class="w-full"
                    filterable
                  >
                    <ElOption
                      v-for="item in diseaseOptions"
                      :key="item"
                      :label="item"
                      :value="item"
                    />
                  </ElSelect>
                </ElFormItem>
              </ElCol>
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="诊断结果">
                  <ElSelect
                    v-model="formData.diagnosisResult"
                    placeholder="请选择诊断结果"
                    class="w-full"
                  >
                    <ElOption label="疑似" value="疑似" />
                    <ElOption label="确诊" value="确诊" />
                    <ElOption label="排除" value="排除" />
                  </ElSelect>
                </ElFormItem>
              </ElCol>
            </ElRow>
            <ElFormItem label="症状描述">
              <ElInput
                v-model="formData.symptoms"
                type="textarea"
                :rows="3"
                placeholder="请输入症状描述"
              />
            </ElFormItem>
          </template>

          <template v-if="formData.eventType === '治疗'">
            <ElRow :gutter="20">
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="治疗方式">
                  <ElSelect
                    v-model="formData.treatmentMethod"
                    placeholder="请选择治疗方式"
                    class="w-full"
                  >
                    <ElOption label="药物治疗" value="药物治疗" />
                    <ElOption label="注射治疗" value="注射治疗" />
                    <ElOption label="输液治疗" value="输液治疗" />
                    <ElOption label="物理治疗" value="物理治疗" />
                  </ElSelect>
                </ElFormItem>
              </ElCol>
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="治疗结果">
                  <ElSelect
                    v-model="formData.treatmentResult"
                    placeholder="请选择治疗结果"
                    class="w-full"
                  >
                    <ElOption label="有效" value="有效" />
                    <ElOption label="痊愈" value="痊愈" />
                    <ElOption label="无效" value="无效" />
                    <ElOption label="继续观察" value="继续观察" />
                  </ElSelect>
                </ElFormItem>
              </ElCol>
            </ElRow>
            <ElRow :gutter="20">
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="药品">
                  <ElSelect
                    v-model="formData.medicine"
                    placeholder="请选择药品"
                    class="w-full"
                    filterable
                  >
                    <ElOption
                      v-for="item in medicineOptions"
                      :key="item"
                      :label="item"
                      :value="item"
                    />
                  </ElSelect>
                </ElFormItem>
              </ElCol>
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="剂量">
                  <ElInput v-model="formData.dosage" placeholder="例如：20ml/次" />
                </ElFormItem>
              </ElCol>
            </ElRow>
          </template>

          <template v-if="formData.eventType === '用药'">
            <ElRow :gutter="20">
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="药品">
                  <ElSelect
                    v-model="formData.medicine"
                    placeholder="请选择药品"
                    class="w-full"
                    filterable
                  >
                    <ElOption
                      v-for="item in medicineOptions"
                      :key="item"
                      :label="item"
                      :value="item"
                    />
                  </ElSelect>
                </ElFormItem>
              </ElCol>
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="剂量">
                  <ElInput v-model="formData.dosage" placeholder="例如：20ml/次" />
                </ElFormItem>
              </ElCol>
            </ElRow>
          </template>

          <template v-if="formData.eventType === '免疫'">
            <ElRow :gutter="20">
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="疫苗名称">
                  <ElSelect
                    v-model="formData.vaccineName"
                    placeholder="请选择疫苗"
                    class="w-full"
                    filterable
                  >
                    <ElOption
                      v-for="item in vaccineOptions"
                      :key="item"
                      :label="item"
                      :value="item"
                    />
                  </ElSelect>
                </ElFormItem>
              </ElCol>
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="疫苗批次">
                  <ElInput v-model="formData.vaccineBatch" placeholder="请输入疫苗批次" />
                </ElFormItem>
              </ElCol>
            </ElRow>
            <ElRow :gutter="20">
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="下次免疫日期">
                  <ElDatePicker
                    v-model="formData.nextVaccinationDate"
                    type="date"
                    placeholder="请选择下次免疫日期"
                    format="YYYY-MM-DD"
                    value-format="YYYY-MM-DD"
                    class="w-full"
                  />
                </ElFormItem>
              </ElCol>
            </ElRow>
          </template>

          <template v-if="formData.eventType === '手术'">
            <ElRow :gutter="20">
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="手术类型">
                  <ElInput v-model="formData.surgeryType" placeholder="请输入手术类型" />
                </ElFormItem>
              </ElCol>
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="手术结果">
                  <ElSelect
                    v-model="formData.surgeryResult"
                    placeholder="请选择手术结果"
                    class="w-full"
                  >
                    <ElOption label="成功" value="成功" />
                    <ElOption label="失败" value="失败" />
                    <ElOption label="术后观察" value="术后观察" />
                  </ElSelect>
                </ElFormItem>
              </ElCol>
            </ElRow>
            <ElFormItem label="手术说明">
              <ElInput
                v-model="formData.surgeryDescription"
                type="textarea"
                :rows="3"
                placeholder="请输入手术说明"
              />
            </ElFormItem>
          </template>

          <template v-if="formData.eventType === '检查'">
            <ElRow :gutter="20">
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="检查类型">
                  <ElSelect
                    v-model="formData.examinationType"
                    placeholder="请选择检查类型"
                    class="w-full"
                  >
                    <ElOption label="体温检查" value="体温检查" />
                    <ElOption label="血液检查" value="血液检查" />
                    <ElOption label="粪便检查" value="粪便检查" />
                    <ElOption label="B 超检查" value="B 超检查" />
                  </ElSelect>
                </ElFormItem>
              </ElCol>
              <ElCol :xs="24" :lg="12">
                <ElFormItem label="检查结果">
                  <ElSelect
                    v-model="formData.examinationResult"
                    placeholder="请选择检查结果"
                    class="w-full"
                  >
                    <ElOption label="正常" value="正常" />
                    <ElOption label="异常" value="异常" />
                    <ElOption label="待复查" value="待复查" />
                  </ElSelect>
                </ElFormItem>
              </ElCol>
            </ElRow>
            <ElFormItem label="检查内容">
              <ElInput
                v-model="formData.examinationContent"
                type="textarea"
                :rows="3"
                placeholder="请输入检查内容"
              />
            </ElFormItem>
          </template>

          <ElRow :gutter="20">
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="费用（元）">
                <ElInputNumber v-model="formData.cost" :min="0" :precision="2" class="w-full" />
              </ElFormItem>
            </ElCol>
          </ElRow>

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
        title="最近兽医记录"
        :event-types="['veterinary', 'vaccination', 'health_check']"
        :refresh-key="recentRefreshKey"
        :records="recentEventSourceRows"
      />
    </section>

    <div class="entry-panel entry-history-panel">
      <div class="entry-panel__head entry-panel__head--inline">
        <div>
          <h2>兽医事件历史</h2>
          <p>按统一事件和旧兽医表合并展示，表格左右滚动查看完整追溯字段。</p>
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
          :data="visibleVeterinaryEvents"
          height="420"
          style="width: 100%"
          :loading="tableLoading"
          class="entry-history-table entry-history-table--wide"
          @wheel.passive="onVeterinaryTableWheel"
        >
          <ElTableColumn prop="cowNumber" label="牛号" width="110" />
          <ElTableColumn prop="eventType" label="事件类型" width="120" />
          <ElTableColumn prop="eventTime" label="发生时间" width="180">
            <template #default="{ row }">{{ formatDateTime(row.eventTime) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="person" label="记录人" width="120" />
          <ElTableColumn prop="disease" label="疾病" width="120" />
          <ElTableColumn prop="medicine" label="药品/疫苗" width="140" />
          <ElTableColumn prop="cost" label="费用（元）" width="110">
            <template #default="{ row }">{{ Number(row.cost || 0).toFixed(2) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="notes" label="备注" min-width="180" show-overflow-tooltip />
        </ElTable>
      </div>
      <div v-if="veterinaryEvents.length > visibleVeterinaryEvents.length" class="load-more-row">
        <ElButton size="small" plain @click="() => loadMoreVeterinaryEvents()">
          加载更多 {{ visibleVeterinaryEvents.length }}/{{ veterinaryEvents.length }}
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
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import type { FormInstance, FormRules } from 'element-plus'
  import * as databaseService from '@/services/数据库'
  import { useLazyRenderWindow } from '@/hooks'
  import CowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'
  import RecentEventRecords from '../components/RecentEventRecords.vue'
  import { formatDateOnly } from '@/utils/date-display'

  type VeterinaryEventType = '发病' | '治疗' | '用药' | '免疫' | '手术' | '检查'
  type UnifiedEventType = 'veterinary' | 'vaccination' | 'health_check'

  interface VeterinaryForm {
    cowNumber: string
    eventType: VeterinaryEventType | ''
    eventTime: string
    veterinarian: string
    disease: string
    diagnosisResult: string
    symptoms: string
    treatmentMethod: string
    treatmentResult: string
    medicine: string
    dosage: string
    vaccineName: string
    vaccineBatch: string
    nextVaccinationDate: string
    surgeryType: string
    surgeryResult: string
    surgeryDescription: string
    examinationType: string
    examinationResult: string
    examinationContent: string
    cost: number
    notes: string
  }

  interface VeterinaryEventRecord {
    id: string
    cowNumber: string
    eventType: string
    eventDate?: string
    eventTime: string
    person: string
    veterinarian?: string
    veterinarianName?: string
    disease?: string
    medicine?: string
    diagnosisResult?: string
    symptoms?: string
    treatmentMethod?: string
    treatmentResult?: string
    dosage?: string
    vaccineName?: string
    vaccineBatch?: string
    nextVaccinationDate?: string
    surgeryType?: string
    surgeryResult?: string
    surgeryDescription?: string
    examinationType?: string
    examinationResult?: string
    examinationContent?: string
    cost?: number
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
  const veterinaryEvents = ref<VeterinaryEventRecord[]>([])
  const {
    visibleItems: visibleVeterinaryEvents,
    loadMore: loadMoreVeterinaryEvents,
    handleWheel: onVeterinaryTableWheel
  } = useLazyRenderWindow(veterinaryEvents, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const persons = ref<SimplePerson[]>([])
  const diseaseOptions = ref<string[]>([])
  const medicineOptions = ref<string[]>([])
  const vaccineOptions = ref<string[]>([])

  const todayKey = () => new Date().toISOString().slice(0, 10)

  const formData = reactive<VeterinaryForm>({
    cowNumber: '',
    eventType: '',
    eventTime: todayKey(),
    veterinarian: '',
    disease: '',
    diagnosisResult: '',
    symptoms: '',
    treatmentMethod: '',
    treatmentResult: '',
    medicine: '',
    dosage: '',
    vaccineName: '',
    vaccineBatch: '',
    nextVaccinationDate: '',
    surgeryType: '',
    surgeryResult: '',
    surgeryDescription: '',
    examinationType: '',
    examinationResult: '',
    examinationContent: '',
    cost: 0,
    notes: ''
  })

  const formRules: FormRules = {
    cowNumber: [{ required: true, message: '请输入牛号', trigger: 'blur' }],
    eventType: [{ required: true, message: '请选择事件类型', trigger: 'change' }],
    eventTime: [{ required: true, message: '请选择发生时间', trigger: 'change' }],
    veterinarian: [{ required: true, message: '请选择记录人', trigger: 'change' }]
  }

  const normalize = (value: unknown): string => (value == null ? '' : String(value))
  const cowNumberOf = (row: any) =>
    normalize(
      row?.cowNumber || row?.cow_number || row?.animalNumber || row?.animal_number || row?.number
    )
  const loadCowRows = async () => {
    const [cows, animals] = await Promise.all([
      databaseService.getTableDataAsync('cows', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('animal', { silent: true }).catch(() => [])
    ])
    return [
      ...(cows || []).map((row: any) => ({ ...row, __sourceTable: 'cows' })),
      ...(animals || []).map((row: any) => ({ ...row, __sourceTable: 'animal' }))
    ]
  }
  const findCowByNumber = async (cowNumber: string) =>
    (await loadCowRows()).find((cow: any) => cowNumberOf(cow) === cowNumber)

  const mapPerson = (raw: any): SimplePerson => ({
    id: normalize(
      raw.id || raw.personId || raw.name || raw.personName || raw.veterinarian || 'p-unknown'
    ),
    name: normalize(raw.name || raw.personName || raw.operatorName),
    role: normalize(raw.role || raw.roleName) || undefined
  })

  const mapVeterinaryEvent = (raw: any): VeterinaryEventRecord => ({
    id: normalize(raw.id),
    cowNumber: normalize(raw.cowNumber || raw.cow_number),
    eventType: normalize(raw.eventType || raw.event_type) || '兽医事件',
    eventDate: normalize(raw.eventDate || raw.event_date) || undefined,
    eventTime: normalize(raw.eventTime || raw.event_time || raw.eventDate || raw.createdAt),
    person: normalize(raw.person || raw.veterinarianName || raw.veterinarian || raw.operatorName),
    veterinarian: normalize(raw.veterinarian) || undefined,
    veterinarianName: normalize(raw.veterinarianName) || undefined,
    disease: normalize(raw.disease || raw.diseaseName) || undefined,
    medicine: normalize(raw.medicine || raw.medicationName || raw.vaccineName) || undefined,
    diagnosisResult: normalize(raw.diagnosisResult) || undefined,
    symptoms: normalize(raw.symptoms) || undefined,
    treatmentMethod: normalize(raw.treatmentMethod) || undefined,
    treatmentResult: normalize(raw.treatmentResult) || undefined,
    dosage: normalize(raw.dosage) || undefined,
    vaccineName: normalize(raw.vaccineName) || undefined,
    vaccineBatch: normalize(raw.vaccineBatch) || undefined,
    nextVaccinationDate: normalize(raw.nextVaccinationDate) || undefined,
    surgeryType: normalize(raw.surgeryType) || undefined,
    surgeryResult: normalize(raw.surgeryResult) || undefined,
    surgeryDescription: normalize(raw.surgeryDescription) || undefined,
    examinationType: normalize(raw.examinationType) || undefined,
    examinationResult: normalize(raw.examinationResult) || undefined,
    examinationContent: normalize(raw.examinationContent) || undefined,
    cost: Number(raw.cost || 0),
    notes: normalize(raw.notes) || undefined,
    createdAt: normalize(raw.createdAt || raw.created_at || raw.eventTime)
  })

  const veterinarianOptions = computed(() => {
    const filtered = persons.value.filter((person) =>
      ['兽医', '防疫', '技术员', '生产主管'].some((role) => (person.role || '').includes(role))
    )
    return filtered.length > 0 ? filtered : persons.value
  })

  const getVeterinarianName = (id: string) => {
    const person = persons.value.find((item) => item.id === id)
    return person?.name || id
  }

  const loadBaseData = async () => {
    try {
      const [personRows, diseaseRows, medicineRows] = await Promise.all([
        databaseService.getTableDataAsync('persons', { silent: true }).catch(() => []),
        databaseService.getTableDataAsync('diseases', { silent: true }).catch(() => []),
        databaseService.getTableDataAsync('medicines', { silent: true }).catch(() => [])
      ])

      persons.value = (personRows || [])
        .filter(isEnabledRow)
        .map(mapPerson)
        .filter((item) => item.name)
      diseaseOptions.value = uniqueValues(
        (diseaseRows || [])
          .filter(isEnabledRow)
          .map((item: any) =>
            normalize(item.name || item.diseaseName || item.disease_name || item.diagnosis)
          )
      )
      medicineOptions.value = uniqueValues(
        (medicineRows || [])
          .filter(isEnabledRow)
          .map((item: any) =>
            normalize(item.name || item.medicineName || item.medicine_name || item.code)
          )
      )
      const vaccineRows = (medicineRows || []).filter((item: any) =>
        normalize(item.category || item.categoryName || item.type || item.name).includes('疫苗')
      )
      vaccineOptions.value = uniqueValues(
        (vaccineRows.length ? vaccineRows : medicineRows || [])
          .filter(isEnabledRow)
          .map((item: any) =>
            normalize(item.name || item.medicineName || item.medicine_name || item.code)
          )
      )
    } catch (error) {
      console.error('加载兽医基础数据失败:', error)
    }
  }

  const loadVeterinaryEvents = async () => {
    tableLoading.value = true
    try {
      const cowEvents = await databaseService.getUnifiedCowEventRowsAsync().catch(() => [])
      recentEventSourceRows.value = cowEvents || []
      const unifiedHealthTypes = [
        'veterinary',
        'diagnosis',
        'treatment',
        'medication',
        'vaccination',
        'health_check',
        'surgery',
        'deworming',
        'quarantine',
        'disinfection',
        'lab_test',
        'hoof_trim',
        'mastitis_check',
        'death'
      ]
      const unifiedRecords = (cowEvents || [])
        .filter((event: any) => unifiedHealthTypes.includes(event.eventType))
        .map(mapUnifiedEvent)
      const merged = dedupeEvents(unifiedRecords).sort(
        (left, right) => new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime()
      )

      totalEvents.value = merged.length
      const start = (currentPage.value - 1) * pageSize.value
      const end = start + pageSize.value
      veterinaryEvents.value = merged.slice(start, end)
    } catch (error) {
      console.error('加载兽医事件失败:', error)
      ElMessage.error('加载兽医事件失败')
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
        text: `当前状态：${normalize(cow.status) || '未知'} / 当前圈舍：${normalize(cow.currentPen || cow.current_pen) || '未设置'}`,
        class: 'text-green-600'
      }
    } catch {
      cowStatus.value = { text: '校验失败', class: 'text-yellow-600' }
    }
  }

  const validateByEventType = () => {
    if (formData.eventType === '发病') {
      if (!formData.disease.trim()) {
        ElMessage.warning('发病事件需要选择疾病；没有可选项时请先在平台管理维护疾病字典')
        return false
      }
      if (!formData.diagnosisResult) {
        ElMessage.warning('发病事件需要选择诊断结果')
        return false
      }
    }

    if (formData.eventType === '治疗') {
      if (!formData.treatmentMethod) {
        ElMessage.warning('治疗事件需要选择治疗方式')
        return false
      }
      if (!formData.treatmentResult) {
        ElMessage.warning('治疗事件需要选择治疗结果')
        return false
      }
    }

    if (formData.eventType === '用药') {
      if (!formData.medicine.trim()) {
        ElMessage.warning('用药事件需要选择药品；没有可选项时请先在平台管理维护药品字典')
        return false
      }
      if (!formData.dosage.trim()) {
        ElMessage.warning('用药事件需要填写剂量')
        return false
      }
    }

    if (formData.eventType === '免疫' && !formData.vaccineName.trim()) {
      ElMessage.warning('免疫事件需要选择疫苗；没有可选项时请先在平台管理维护疫苗类药品')
      return false
    }

    if (formData.eventType === '手术') {
      if (!formData.surgeryType.trim()) {
        ElMessage.warning('手术事件需要填写手术类型')
        return false
      }
      if (!formData.surgeryResult) {
        ElMessage.warning('手术事件需要选择手术结果')
        return false
      }
    }

    if (formData.eventType === '检查') {
      if (!formData.examinationType) {
        ElMessage.warning('检查事件需要选择检查类型')
        return false
      }
      if (!formData.examinationResult) {
        ElMessage.warning('检查事件需要选择检查结果')
        return false
      }
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
      const eventId = `vet-${Date.now()}`
      const now = new Date().toISOString()
      const cowNumber = formData.cowNumber.trim()
      const eventTime = formData.eventTime || now
      const veterinarianName = getVeterinarianName(formData.veterinarian)
      const unifiedType = getUnifiedType(formData.eventType as VeterinaryEventType)
      const details = buildDetails(unifiedType)

      await databaseService.addCowEvent({
        id: eventId,
        cowNumber,
        eventType: unifiedType,
        eventTime,
        operatorName: veterinarianName,
        details,
        cost: Number(formData.cost || 0),
        notes: formData.notes.trim() || undefined
      })

      const newEvent: VeterinaryEventRecord = {
        id: eventId,
        cowNumber,
        eventType: formData.eventType as VeterinaryEventType,
        eventDate: eventTime.split('T')[0],
        eventTime,
        person: veterinarianName,
        veterinarian: formData.veterinarian,
        veterinarianName,
        disease: formData.disease.trim() || undefined,
        medicine: formData.medicine.trim() || formData.vaccineName.trim() || undefined,
        diagnosisResult: formData.diagnosisResult || undefined,
        symptoms: formData.symptoms.trim() || undefined,
        treatmentMethod: formData.treatmentMethod || undefined,
        treatmentResult: formData.treatmentResult || undefined,
        dosage: formData.dosage.trim() || undefined,
        vaccineName: formData.vaccineName.trim() || undefined,
        vaccineBatch: formData.vaccineBatch.trim() || undefined,
        nextVaccinationDate: formData.nextVaccinationDate || undefined,
        surgeryType: formData.surgeryType.trim() || undefined,
        surgeryResult: formData.surgeryResult || undefined,
        surgeryDescription: formData.surgeryDescription.trim() || undefined,
        examinationType: formData.examinationType || undefined,
        examinationResult: formData.examinationResult || undefined,
        examinationContent: formData.examinationContent.trim() || undefined,
        cost: Number(formData.cost || 0),
        notes: formData.notes.trim() || undefined,
        createdAt: now
      }
      await databaseService.addTableDataAsync('veterinary-events', newEvent)
      await updateCowHealthStatus(cowNumber, now)

      ElMessage.success('兽医事件录入成功')
      handleReset()
      await loadVeterinaryEvents()
      recentRefreshKey.value += 1
    } catch (error: any) {
      console.error('提交兽医事件失败:', error)
      ElMessage.error(error?.message || '提交失败')
    } finally {
      submitLoading.value = false
    }
  }

  const handleReset = () => {
    formRef.value?.resetFields()
    formData.eventTime = todayKey()
    formData.cost = 0
    cowStatus.value = { text: '', class: 'text-gray-500' }
  }

  const handleSizeChange = (size: number) => {
    pageSize.value = size
    currentPage.value = 1
    void loadVeterinaryEvents()
  }

  const handleCurrentChange = (page: number) => {
    currentPage.value = page
    void loadVeterinaryEvents()
  }

  function isEnabledRow(row: any) {
    const status = normalize(row.status).toLowerCase()
    if (status) {
      return ['启用', '正常', '在职', 'active', 'enabled'].some(
        (item) => item.toLowerCase() === status
      )
    }
    if (row.isActive !== undefined) return Boolean(row.isActive)
    if (row.is_active !== undefined) return Boolean(row.is_active)
    return true
  }

  function uniqueValues(values: string[]) {
    return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
  }

  function getUnifiedType(eventType: VeterinaryEventType): UnifiedEventType {
    if (eventType === '免疫') return 'vaccination'
    if (eventType === '检查') return 'health_check'
    return 'veterinary'
  }

  function buildDetails(unifiedType: UnifiedEventType) {
    if (unifiedType === 'vaccination') {
      return {
        vaccineName: formData.vaccineName.trim(),
        vaccineBatch: formData.vaccineBatch.trim() || undefined,
        dosage: formData.dosage.trim() || undefined,
        nextVaccinationDate: formData.nextVaccinationDate || undefined,
        cost: Number(formData.cost || 0)
      }
    }
    if (unifiedType === 'health_check') {
      return {
        checkType: formData.examinationType,
        findings: formData.examinationResult,
        recommendations: formData.examinationContent.trim() || undefined,
        cost: Number(formData.cost || 0)
      }
    }
    return {
      diagnosis: formData.disease.trim() || formData.diagnosisResult || undefined,
      symptoms: formData.symptoms.trim() || undefined,
      medicine: formData.medicine.trim() || undefined,
      treatment: formData.treatmentMethod || undefined,
      result: formData.treatmentResult || formData.surgeryResult || undefined,
      dosage: formData.dosage.trim() || undefined,
      surgeryType: formData.surgeryType.trim() || undefined,
      surgeryDescription: formData.surgeryDescription.trim() || undefined,
      cost: Number(formData.cost || 0)
    }
  }

  function mapUnifiedEvent(row: any): VeterinaryEventRecord {
    const details = row.details || {}
    const eventType =
      row.eventType === 'vaccination'
        ? '免疫'
        : row.eventType === 'health_check'
          ? '检查'
          : details.surgeryType
            ? '手术'
            : details.treatment || details.medicine
              ? '治疗'
              : '发病'
    return {
      id: normalize(row.id),
      cowNumber: normalize(row.cowNumber || row.cow_number),
      eventType,
      eventTime: normalize(row.eventTime || row.event_time || row.createdAt),
      eventDate: normalize(row.eventDate || row.event_date) || undefined,
      person: normalize(row.operatorName || row.operator_name),
      disease: normalize(details.diagnosis) || undefined,
      medicine:
        normalize(details.medicine || details.vaccineName || details.treatment) || undefined,
      diagnosisResult: normalize(details.result) || undefined,
      treatmentMethod: normalize(details.treatment) || undefined,
      treatmentResult: normalize(details.result) || undefined,
      dosage: normalize(details.dosage) || undefined,
      vaccineName: normalize(details.vaccineName) || undefined,
      vaccineBatch: normalize(details.vaccineBatch) || undefined,
      nextVaccinationDate: normalize(details.nextVaccinationDate) || undefined,
      examinationType: normalize(details.checkType) || undefined,
      examinationResult: normalize(details.findings) || undefined,
      examinationContent: normalize(details.recommendations) || undefined,
      cost: Number(details.cost || row.cost || 0),
      notes: normalize(row.notes) || undefined,
      createdAt: normalize(row.createdAt || row.created_at || row.eventTime)
    }
  }

  function dedupeEvents(rows: VeterinaryEventRecord[]) {
    const seen = new Set<string>()
    return rows.filter((row) => {
      const key = row.id || `${row.cowNumber}|${row.eventType}|${row.eventTime}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  async function updateCowHealthStatus(cowNumber: string, now: string) {
    const target = await findCowByNumber(cowNumber)
    const targetId = normalize(target?.id || target?.cowId || target?.animalId || target?.cowNumber)
    if (!target || !targetId) return

    const updateData: Record<string, any> = { updatedAt: now }
    if (formData.eventType === '发病' || formData.eventType === '手术') {
      updateData.status = '待观察'
    }
    if (formData.eventType === '治疗') {
      updateData.status = formData.treatmentResult === '痊愈' ? '健康' : '待观察'
    }
    if (formData.eventType === '检查') {
      updateData.status = formData.examinationResult === '正常' ? '健康' : '待观察'
    }
    const targetTables = target.__sourceTable === 'animal' ? ['animal', 'cows'] : ['cows', 'animal']
    await Promise.all(
      targetTables.map((tableName) =>
        databaseService
          .updateTableRecordAsync(tableName, targetId, updateData)
          .catch(() => undefined)
      )
    )
  }

  onMounted(() => {
    void loadBaseData()
    void loadVeterinaryEvents()
  })

  defineOptions({ name: 'VeterinaryEvent' })
</script>

<style scoped lang="scss" src="../entry-layout.scss"></style>
