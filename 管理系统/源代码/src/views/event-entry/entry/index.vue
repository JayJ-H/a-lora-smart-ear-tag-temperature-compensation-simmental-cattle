<template>
  <div class="entry-page">
    <div class="entry-page-head">
      <div>
        <h1>入场录入</h1>
        <p>给新入场牛只建档，写入入场事件，并同步生成初始圈舍关系。</p>
      </div>
      <div class="entry-page-head__chips" aria-label="入场录入口径">
        <span>允许新牛号</span>
        <span>父母号可外部</span>
        <span>目标圈舍必选</span>
      </div>
    </div>

    <div class="entry-summary-strip">
      <div>
        <small>提交结果</small>
        <strong>牛档 + 入场事件</strong>
      </div>
      <div>
        <small>圈舍口径</small>
        <strong>从无圈舍进入目标圈舍</strong>
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
            <h2>入场信息</h2>
            <p>除备注、新牛号、父母号外，其他字段从平台字典选择。</p>
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
                  placeholder="请输入新牛号，或参考已有牛号"
                  allow-new
                  @blur="checkCowExists"
                  @select="checkCowExists"
                />
                <div class="text-xs text-gray-500 mt-1">
                  <span :class="cowExistsStatus.class">{{ cowExistsStatus.text }}</span>
                </div>
              </ElFormItem>
            </ElCol>

            <ElCol :xs="24" :lg="12">
              <ElFormItem label="耳标号" prop="earTagNumber">
                <ElInput v-model="formData.earTagNumber" placeholder="请输入耳标号" />
              </ElFormItem>
            </ElCol>
          </ElRow>

          <ElRow :gutter="20">
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="品种" prop="breed">
                <ElSelect v-model="formData.breed" placeholder="请选择品种" class="w-full">
                  <ElOption
                    v-for="breed in breedOptions"
                    :key="breed"
                    :label="breed"
                    :value="breed"
                  />
                </ElSelect>
              </ElFormItem>
            </ElCol>

            <ElCol :xs="24" :lg="12">
              <ElFormItem label="性别" prop="gender">
                <ElSelect v-model="formData.gender" placeholder="请选择性别" class="w-full">
                  <ElOption label="公" value="公" />
                  <ElOption label="母" value="母" />
                </ElSelect>
              </ElFormItem>
            </ElCol>
          </ElRow>

          <ElRow :gutter="20">
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="出生日期" prop="birthDate">
                <ElDatePicker
                  v-model="formData.birthDate"
                  type="date"
                  placeholder="请选择出生日期"
                  format="YYYY-MM-DD"
                  value-format="YYYY-MM-DD"
                  class="w-full"
                />
              </ElFormItem>
            </ElCol>

            <ElCol :xs="24" :lg="12">
              <ElFormItem label="入场原因" prop="reason">
                <ElSelect v-model="formData.reason" placeholder="请选择入场原因" class="w-full">
                  <ElOption
                    v-for="reason in entryReasons"
                    :key="reason.value"
                    :label="reason.label"
                    :value="reason.value"
                  />
                </ElSelect>
              </ElFormItem>
            </ElCol>
          </ElRow>

          <ElRow :gutter="20">
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="父号">
                <ElInput v-model="formData.fatherNumber" placeholder="可填本场公牛号或外部父号" />
              </ElFormItem>
            </ElCol>

            <ElCol :xs="24" :lg="12">
              <ElFormItem label="母号">
                <ElInput
                  v-model="formData.motherNumber"
                  placeholder="可填本场母牛号、外部母号或留空"
                />
              </ElFormItem>
            </ElCol>
          </ElRow>

          <ElRow :gutter="20">
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="栏舍" prop="pen">
                <ElSelect v-model="formData.pen" placeholder="请选择栏舍" class="w-full" filterable>
                  <ElOption
                    v-for="pen in pens"
                    :key="pen.id"
                    :label="`${pen.name}${pen.category ? `（${pen.category}）` : ''}${pen.mirroredToFarmUnit ? '（兼容圈舍）' : ''}`"
                    :value="pen.id"
                  />
                </ElSelect>
              </ElFormItem>
            </ElCol>

            <ElCol :xs="24" :lg="12">
              <ElFormItem label="记录人" prop="recorder">
                <ElSelect
                  v-model="formData.recorder"
                  placeholder="请选择记录人"
                  class="w-full"
                  filterable
                >
                  <ElOption
                    v-for="person in persons"
                    :key="person.id"
                    :label="`${person.name}${person.department ? `（${person.department}）` : ''}`"
                    :value="person.name"
                  />
                </ElSelect>
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
        title="最近入场记录"
        :event-types="['entry']"
        :refresh-key="recentRefreshKey"
        :records="recentEventSourceRows"
      />
    </section>

    <div class="entry-panel entry-history-panel">
      <div class="entry-panel__head entry-panel__head--inline">
        <div>
          <h2>入场历史</h2>
          <p>单条录入成功后会进入历史记录，表格上下滚动只渲染当前窗口。</p>
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
          :data="visibleEntryEvents"
          height="420"
          style="width: 100%"
          :loading="tableLoading"
          class="entry-history-table"
          @wheel.passive="onEntryTableWheel"
        >
          <ElTableColumn prop="cowNumber" label="牛号" width="120" />
          <ElTableColumn prop="earTagNumber" label="耳标号" width="120" />
          <ElTableColumn prop="breed" label="品种" width="120" />
          <ElTableColumn prop="gender" label="性别" width="90" />
          <ElTableColumn prop="birthDate" label="出生日期" width="130" />
          <ElTableColumn prop="reason" label="入场原因" width="120">
            <template #default="{ row }">{{ getReasonLabel(row.reason) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="pen" label="栏舍" width="120" />
          <ElTableColumn prop="recorder" label="记录人" width="120" />
          <ElTableColumn prop="entryTime" label="入场时间" width="180">
            <template #default="{ row }">{{ formatDateTime(row.entryTime) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="notes" label="备注" min-width="180" show-overflow-tooltip />
        </ElTable>
      </div>
      <div v-if="entryEvents.length > visibleEntryEvents.length" class="load-more-row">
        <ElButton size="small" plain @click="() => loadMoreEntryEvents()">
          加载更多 {{ visibleEntryEvents.length }}/{{ entryEvents.length }}
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
  import { onMounted, reactive, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import type { FormInstance, FormRules } from 'element-plus'
  import * as databaseService from '@/services/数据库'
  import { useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'
  import { ensureBreedDictionary } from '@/services/platform-dictionary'
  import {
    SUPPORTED_CATTLE_BREEDS,
    normalizeCattleBreed,
    normalizeCattleBreedOrDefault,
    requireSupportedCattleBreed
  } from '@/utils/cattle-breeds'
  import CowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'
  import RecentEventRecords from '../components/RecentEventRecords.vue'

  type Gender = '公' | '母'
  interface EntryForm {
    cowNumber: string
    earTagNumber: string
    breed: string
    gender: Gender | ''
    birthDate: string
    fatherNumber: string
    motherNumber: string
    reason: string
    pen: string
    recorder: string
    notes: string
  }

  interface EntryEventRecord {
    id: string
    cowNumber: string
    earTagNumber?: string
    breed: string
    gender: Gender
    birthDate: string
    fatherNumber?: string
    motherNumber?: string
    reason: string
    pen: string
    recorder: string
    notes?: string
    entryTime: string
    createdAt: string
  }

  interface SimplePerson {
    id: string
    name: string
    department?: string
  }

  interface SimplePen {
    id: string
    name: string
    category?: string
    sourceTable?: 'farm_unit' | 'pens'
    mirroredToFarmUnit?: boolean
  }

  const formRef = ref<FormInstance>()
  const submitLoading = ref(false)
  const tableLoading = ref(false)
  const recentRefreshKey = ref(0)
  const recentEventSourceRows = ref<any[]>([])
  const cowExistsStatus = ref({ text: '', class: 'text-gray-500' })

  const currentPage = ref(1)
  const pageSize = ref(10)
  const totalEvents = ref(0)
  const entryEvents = ref<EntryEventRecord[]>([])
  const {
    visibleItems: visibleEntryEvents,
    loadMore: loadMoreEntryEvents,
    handleWheel: onEntryTableWheel
  } = useLazyRenderWindow(entryEvents, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const persons = ref<SimplePerson[]>([])
  const pens = ref<SimplePen[]>([])
  const breedOptions = ref<string[]>([])

  const DEFAULT_BREED_TYPES = [...SUPPORTED_CATTLE_BREEDS]
  const entryReasons = ref<Array<{ label: string; value: string }>>([])
  const DEFAULT_ENTRY_REASONS = ['购入入群', '转入入群', '胚胎移植入群']

  const formData = reactive<EntryForm>({
    cowNumber: '',
    earTagNumber: '',
    breed: '',
    gender: '',
    birthDate: '',
    fatherNumber: '',
    motherNumber: '',
    reason: '',
    pen: '',
    recorder: '',
    notes: ''
  })

  const formRules: FormRules = {
    cowNumber: [{ required: true, message: '请输入牛号', trigger: 'blur' }],
    breed: [{ required: true, message: '请选择品种', trigger: 'change' }],
    gender: [{ required: true, message: '请选择性别', trigger: 'change' }],
    birthDate: [{ required: true, message: '请选择出生日期', trigger: 'change' }],
    reason: [{ required: true, message: '请选择入场原因', trigger: 'change' }],
    pen: [{ required: true, message: '请选择栏舍', trigger: 'change' }],
    recorder: [{ required: true, message: '请选择记录人', trigger: 'change' }]
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
    return [...(cows || []), ...(animals || [])]
  }
  const findCowByNumber = async (cowNumber: string) =>
    (await loadCowRows()).find((cow: any) => cowNumberOf(cow) === cowNumber)

  const mapPerson = (raw: any): SimplePerson => ({
    id: normalize(
      raw.id || raw.personId || raw.name || raw.personName || raw.recorder || 'p-unknown'
    ),
    name: normalize(raw.name || raw.personName || raw.recorder),
    department: normalize(raw.department) || undefined
  })

  const mapPen = (
    raw: any,
    sourceTable: 'farm_unit' | 'pens',
    mirroredToFarmUnit = false
  ): SimplePen => ({
    id: normalize(
      raw.id ||
        raw.unitId ||
        raw.unit_id ||
        raw.code ||
        raw.unitCode ||
        raw.unit_code ||
        raw.penCode ||
        raw.pen_code ||
        raw.penId ||
        raw.pen_id ||
        raw.name ||
        raw.pen ||
        raw.currentPen ||
        'pen-unknown'
    ),
    name: normalize(
      raw.name ||
        raw.unitName ||
        raw.unit_name ||
        raw.penName ||
        raw.pen_name ||
        raw.pen ||
        raw.currentPen
    ),
    category:
      normalize(
        raw.category || raw.categoryName || raw.category_name || raw.unitType || raw.unit_type
      ) || undefined,
    sourceTable,
    mirroredToFarmUnit
  })

  const mapActiveBreedName = (raw: any): string => {
    if (raw.isActive === false || raw.is_active === false || raw.status === '停用') return ''
    return normalizeCattleBreed(
      raw.name || raw.breed || raw.breedName || raw.breed_name || raw.code
    )
  }

  const _mapEntryEvent = (raw: any): EntryEventRecord => ({
    id: normalize(raw.id),
    cowNumber: normalize(raw.cowNumber),
    earTagNumber: normalize(raw.earTagNumber) || undefined,
    breed: normalizeCattleBreedOrDefault(raw.breed),
    gender: (normalize(raw.gender) === '母' ? '母' : '公') as Gender,
    birthDate: normalize(raw.birthDate),
    reason: normalize(raw.reason) || '',
    pen: normalize(raw.pen),
    recorder: normalize(raw.recorder),
    notes: normalize(raw.notes) || undefined,
    entryTime: normalize(raw.entryTime),
    createdAt: normalize(raw.createdAt)
  })

  const loadBaseData = async () => {
    try {
      const [personRows, farmUnitRows, penRows, breedRows, cowRows, animalRows, reasonRows] =
        await Promise.all([
          databaseService.getTableDataAsync('persons'),
          databaseService.getTableDataAsync('farm_unit', { silent: true }),
          databaseService.getTableDataAsync('pens', { silent: true }),
          databaseService.getTableDataAsync('breed-types', { silent: true }),
          databaseService.getTableDataAsync('cows', { silent: true }),
          databaseService.getTableDataAsync('animal', { silent: true }),
          databaseService.getTableDataAsync('transfer-reasons', { silent: true })
        ])
      persons.value = (personRows || []).map(mapPerson).filter((x) => x.name)
      pens.value = buildAssignablePens(farmUnitRows || [], penRows || [])
      entryReasons.value = optionListFromReasons(reasonRows, DEFAULT_ENTRY_REASONS)

      const ensuredBreedRows = await ensureBreedDictionary(breedRows || [])
      const fromDictionary = Array.from(
        new Set((ensuredBreedRows || []).map(mapActiveBreedName).filter(Boolean))
      )
      const fromCows = Array.from(
        new Set(
          [...(cowRows || []), ...(animalRows || [])]
            .map((row: any) => normalizeCattleBreed(row.breed || row.breedName || row.breed_name))
            .filter(Boolean)
        )
      )
      const merged = Array.from(new Set([...fromDictionary, ...fromCows, ...DEFAULT_BREED_TYPES]))
      breedOptions.value = merged
    } catch (error) {
      console.error('加载基础数据失败:', error)
    }
  }

  const loadEntryEvents = async () => {
    tableLoading.value = true
    try {
      // 从统一事件表查询入场事件
      const all = await databaseService.getUnifiedCowEventRowsAsync()
      recentEventSourceRows.value = all || []
      const entryRecords = (all || []).filter((e: any) => e.eventType === 'entry')

      const mapped = entryRecords
        .map((e: any) => ({
          id: normalize(e.id),
          cowNumber: normalize(e.cowNumber),
          earTagNumber: normalize(e.details?.earTagNumber) || undefined,
          breed: normalizeCattleBreedOrDefault(
            e.details?.breed ||
              (all || []).find((a: any) => a.cowNumber === e.cowNumber && a.eventType === 'entry')
                ?.details?.breed
          ),
          gender: (normalize(e.details?.gender) === '母' ? '母' : '公') as Gender,
          birthDate: normalize(e.details?.birthDate) || '',
          reason: normalize(e.details?.entryReason) || '',
          pen:
            normalize(
              e.details?.toUnitName ||
                e.details?.to_unit_name ||
                e.details?.toPenName ||
                e.details?.pen
            ) || '',
          recorder: normalize(e.operatorName) || normalize(e.details?.recorder) || '',
          notes: normalize(e.notes) || undefined,
          entryTime: normalize(e.eventTime),
          createdAt: normalize(e.createdAt)
        }))
        .sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime())

      totalEvents.value = mapped.length
      const start = (currentPage.value - 1) * pageSize.value
      const end = start + pageSize.value
      entryEvents.value = mapped.slice(start, end)
    } catch (error) {
      console.error('加载入场记录失败:', error)
      ElMessage.error('加载入场记录失败')
    } finally {
      tableLoading.value = false
    }
  }

  const checkCowExists = async () => {
    const cowNumber = formData.cowNumber.trim()
    if (!cowNumber) {
      cowExistsStatus.value = { text: '', class: 'text-gray-500' }
      return
    }

    try {
      const exists = Boolean(await findCowByNumber(cowNumber))
      cowExistsStatus.value = exists
        ? { text: '该牛号已存在', class: 'text-red-600' }
        : { text: '该牛号可用', class: 'text-green-600' }
    } catch {
      cowExistsStatus.value = { text: '校验失败', class: 'text-yellow-600' }
    }
  }

  const getReasonLabel = (reason: string) => {
    const found = entryReasons.value.find((item) => item.value === reason)
    return found ? found.label : reason
  }

  const formatDateTime = (dateTime: string) => formatDateOnly(dateTime, '--')

  const handleSubmit = async () => {
    if (!formRef.value) return

    try {
      await formRef.value.validate()
    } catch {
      return
    }

    submitLoading.value = true
    try {
      // 构建事件记录（新旧表共用）
      const eventId = `entry-${Date.now()}`
      const now = new Date().toISOString()
      const cowNumber = formData.cowNumber.trim()
      const breed = requireSupportedCattleBreed(formData.breed)
      const existingCow = await findCowByNumber(cowNumber)
      const selectedPen = resolvePen(formData.pen)

      if (currentPenOf(existingCow)) {
        ElMessage.warning('该牛已有当前栏舍，变更栏舍请使用转群录入')
        return
      }

      const newEvent: EntryEventRecord = {
        id: eventId,
        cowNumber,
        earTagNumber: formData.earTagNumber.trim() || undefined,
        breed,
        gender: formData.gender as Gender,
        birthDate: formData.birthDate,
        fatherNumber: formData.fatherNumber.trim() || undefined,
        motherNumber: formData.motherNumber.trim() || undefined,
        reason: formData.reason,
        pen: selectedPen.name,
        recorder: formData.recorder,
        notes: formData.notes.trim() || undefined,
        entryTime: now,
        createdAt: now
      }

      // 写入统一事件表（优先）
      await databaseService.addCowEvent({
        id: eventId,
        cowNumber,
        eventType: 'entry',
        eventTime: now,
        operatorName: formData.recorder,
        details: {
          entryReason: formData.reason,
          birthDate: formData.birthDate,
          earTagNumber: formData.earTagNumber.trim() || undefined,
          breed,
          gender: formData.gender,
          fatherNumber: formData.fatherNumber.trim() || undefined,
          father_number: formData.fatherNumber.trim() || undefined,
          motherNumber: formData.motherNumber.trim() || undefined,
          mother_number: formData.motherNumber.trim() || undefined,
          pen: selectedPen.name,
          toPenId: selectedPen.id,
          toPenName: selectedPen.name,
          toUnitId: selectedPen.id,
          to_unit_id: selectedPen.id,
          toUnitName: selectedPen.name,
          to_unit_name: selectedPen.name,
          recorder: formData.recorder
        },
        notes: formData.notes.trim() || undefined
      })

      // 兼容：仍写入旧表（迁移完成后可删除）
      await databaseService.addTableDataAsync('entry-events', newEvent)

      ElMessage.success('入场录入成功')
      handleReset()
      await loadEntryEvents()
      recentRefreshKey.value += 1
    } catch (error: any) {
      console.error('提交入场失败:', error)
      ElMessage.error(error?.message || '提交失败')
    } finally {
      submitLoading.value = false
    }
  }

  const handleReset = () => {
    formRef.value?.resetFields()
    cowExistsStatus.value = { text: '', class: 'text-gray-500' }
  }

  const handleSizeChange = (size: number) => {
    pageSize.value = size
    currentPage.value = 1
    void loadEntryEvents()
  }

  const handleCurrentChange = (page: number) => {
    currentPage.value = page
    void loadEntryEvents()
  }

  function optionListFromReasons(rows: any[], fallback: string[]) {
    const options = (rows || [])
      .filter((row: any) => isEnabledRow(row))
      .map((row: any) => {
        const name = normalize(row.name || row.reason || row.reasonName || row.reason_name)
        const category = normalize(
          row.category || row.categoryName || row.reasonType || row.reason_type
        )
        return name ? { label: category ? `${name}（${category}）` : name, value: name } : null
      })
      .filter((item): item is { label: string; value: string } => Boolean(item))
      .filter((item) => !/出生|初生|产犊/.test(item.value))
    return options.length ? options : fallback.map((name) => ({ label: name, value: name }))
  }

  function isEnabledRow(row: any) {
    const status = normalize(row.status).toLowerCase()
    if (status)
      return ['启用', '正常', 'active', 'enabled'].some((item) => item.toLowerCase() === status)
    if (row.isActive !== undefined) return Boolean(row.isActive)
    if (row.is_active !== undefined) return Boolean(row.is_active)
    return true
  }

  function uniquePens(rows: SimplePen[]) {
    const seen = new Set<string>()
    return rows.filter((row) => {
      const key = row.id || row.name
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  function buildAssignablePens(farmUnitRows: any[], penRows: any[]) {
    const farmUnitKeys = new Set<string>()
    const farmOptions = (farmUnitRows || [])
      .filter(isEnabledRow)
      .map((row: any) => {
        penIdentityKeys(row).forEach((key) => farmUnitKeys.add(key))
        return mapPen(row, 'farm_unit')
      })
      .filter((x) => x.name)

    const compatiblePenOptions = (penRows || [])
      .filter(isEnabledRow)
      .filter((row: any) => !penIdentityKeys(row).some((key) => farmUnitKeys.has(key)))
      .map((row: any) => mapPen(row, 'pens', true))
      .filter((x) => x.name)

    return uniquePens([...farmOptions, ...compatiblePenOptions])
  }

  function penIdentityKeys(row: any) {
    return [
      row?.id,
      row?.unitId,
      row?.unit_id,
      row?.code,
      row?.unitCode,
      row?.unit_code,
      row?.penCode,
      row?.pen_code,
      row?.penId,
      row?.pen_id,
      row?.name,
      row?.unitName,
      row?.unit_name,
      row?.penName,
      row?.pen_name
    ]
      .map((value) => normalize(value).toLowerCase())
      .filter(Boolean)
  }

  function resolvePen(id: string) {
    return pens.value.find((pen) => pen.id === id || pen.name === id) || { id, name: id }
  }

  function currentPenOf(cow: any) {
    return normalize(
      cow?.currentUnitId ||
        cow?.current_unit_id ||
        cow?.currentPenId ||
        cow?.current_pen_id ||
        cow?.currentPenCode ||
        cow?.current_pen_code ||
        cow?.currentPen ||
        cow?.current_pen
    )
  }

  onMounted(() => {
    void loadBaseData()
    void loadEntryEvents()
  })

  defineOptions({ name: 'EntryEvent' })
</script>

<style scoped lang="scss" src="../entry-layout.scss"></style>
