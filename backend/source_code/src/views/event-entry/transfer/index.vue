<template>
  <div class="entry-page">
    <div class="entry-page-head">
      <div>
        <h1>转群录入</h1>
        <p>给已有牛只记录圈舍变更，系统只读当前圈舍，提交后同步目标圈舍关系。</p>
      </div>
      <div class="entry-page-head__chips" aria-label="转群录入口径">
        <span>必须已有牛号</span>
        <span>当前圈舍只读</span>
        <span>目标圈舍必选</span>
      </div>
    </div>

    <div class="entry-summary-strip">
      <div>
        <small>提交结果</small>
        <strong>转群事件 + 圈舍关系</strong>
      </div>
      <div>
        <small>圈舍口径</small>
        <strong>当前圈舍进入目标圈舍</strong>
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
            <h2>转群信息</h2>
            <p>牛号从场内档案选择，目标圈舍来自可分配圈舍字典。</p>
          </div>
          <ElTag type="warning" effect="plain">单条录入</ElTag>
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
              <ElFormItem label="转群原因" prop="reason">
                <ElSelect v-model="formData.reason" placeholder="请选择转群原因" class="w-full">
                  <ElOption v-for="item in reasonOptions" :key="item" :label="item" :value="item" />
                </ElSelect>
              </ElFormItem>
            </ElCol>
          </ElRow>

          <ElRow :gutter="20">
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="原栏舍" prop="fromPen">
                <ElInput
                  v-model="formData.fromPen"
                  disabled
                  placeholder="选择牛号后自动读取当前栏舍"
                />
              </ElFormItem>
            </ElCol>
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="目标栏舍" prop="toPen">
                <ElSelect
                  v-model="formData.toPen"
                  placeholder="请选择目标栏舍"
                  class="w-full"
                  filterable
                >
                  <ElOption
                    v-for="pen in pens"
                    :key="pen.id"
                    :label="`${pen.name}${pen.category ? `（${pen.category}）` : ''}${pen.mirroredToFarmUnit ? '（兼容圈舍）' : ''}`"
                    :value="pen.id"
                  />
                </ElSelect>
              </ElFormItem>
            </ElCol>
          </ElRow>

          <ElRow :gutter="20">
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
            <ElCol :xs="24" :lg="12">
              <ElFormItem label="转群时间" prop="transferTime">
                <ElDatePicker
                  v-model="formData.transferTime"
                  type="date"
                  placeholder="请选择转群时间"
                  format="YYYY-MM-DD"
                  value-format="YYYY-MM-DD"
                  class="w-full"
                />
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
        title="最近转群记录"
        :event-types="['transfer']"
        :refresh-key="recentRefreshKey"
        :records="recentEventSourceRows"
      />
    </section>

    <div class="entry-panel entry-history-panel">
      <div class="entry-panel__head entry-panel__head--inline">
        <div>
          <h2>转群历史</h2>
          <p>历史表格左右滚动查看完整字段，上下滚动只渲染当前窗口。</p>
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
          :data="visibleTransferEvents"
          height="420"
          style="width: 100%"
          :loading="tableLoading"
          class="entry-history-table"
          @wheel.passive="onTransferTableWheel"
        >
          <ElTableColumn prop="cowNumber" label="牛号" width="120" />
          <ElTableColumn prop="reason" label="转群原因" width="140" />
          <ElTableColumn prop="fromPen" label="原栏舍" width="140" />
          <ElTableColumn prop="toPen" label="目标栏舍" width="140" />
          <ElTableColumn prop="recorder" label="记录人" width="120" />
          <ElTableColumn prop="transferTime" label="转群时间" width="180">
            <template #default="{ row }">{{ formatDateTime(row.transferTime) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="notes" label="备注" min-width="200" show-overflow-tooltip />
        </ElTable>
      </div>
      <div v-if="transferEvents.length > visibleTransferEvents.length" class="load-more-row">
        <ElButton size="small" plain @click="() => loadMoreTransferEvents()">
          加载更多 {{ visibleTransferEvents.length }}/{{ transferEvents.length }}
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
  import * as databaseService from '@/services/database'
  import { useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'
  import CowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'
  import RecentEventRecords from '../components/RecentEventRecords.vue'

  interface TransferForm {
    cowNumber: string
    reason: string
    fromPen: string
    toPen: string
    recorder: string
    transferTime: string
    notes: string
  }

  interface TransferEventRecord {
    id: string
    cowNumber: string
    reason: string
    fromPen: string
    toPen: string
    recorder: string
    transferTime: string
    notes?: string
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
  const cowStatus = ref({ text: '', class: 'text-gray-500' })

  const currentPage = ref(1)
  const pageSize = ref(10)
  const totalEvents = ref(0)
  const transferEvents = ref<TransferEventRecord[]>([])
  const {
    visibleItems: visibleTransferEvents,
    loadMore: loadMoreTransferEvents,
    handleWheel: onTransferTableWheel
  } = useLazyRenderWindow(transferEvents, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const persons = ref<SimplePerson[]>([])
  const pens = ref<SimplePen[]>([])

  const reasonOptions = ref<string[]>([])
  const DEFAULT_TRANSFER_REASONS = ['断奶转群', '妊娠转群', '疾病隔离', '饲养调整', '管理调整']

  const todayKey = () => new Date().toISOString().slice(0, 10)

  const formData = reactive<TransferForm>({
    cowNumber: '',
    reason: '',
    fromPen: '',
    toPen: '',
    recorder: '',
    transferTime: todayKey(),
    notes: ''
  })

  const formRules: FormRules = {
    cowNumber: [{ required: true, message: '请输入牛号', trigger: 'blur' }],
    reason: [{ required: true, message: '请选择转群原因', trigger: 'change' }],
    fromPen: [{ required: true, message: '请选择牛号以自动读取原栏舍', trigger: 'change' }],
    toPen: [{ required: true, message: '请选择目标栏舍', trigger: 'change' }],
    recorder: [{ required: true, message: '请选择记录人', trigger: 'change' }],
    transferTime: [{ required: true, message: '请选择转群时间', trigger: 'change' }]
  }

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

  const mapActiveReasonName = (raw: any): string => {
    if (!isEnabledRow(raw)) return ''
    return normalize(raw.name || raw.reason || raw.reasonName || raw.reason_name)
  }

  const _mapTransferEvent = (raw: any): TransferEventRecord => ({
    id: normalize(raw.id),
    cowNumber: normalize(raw.cowNumber),
    reason: normalize(raw.reason),
    fromPen: normalize(raw.fromPen),
    toPen: normalize(raw.toPen),
    recorder: normalize(raw.recorder),
    transferTime: normalize(raw.transferTime),
    notes: normalize(raw.notes) || undefined,
    createdAt: normalize(raw.createdAt)
  })

  const loadBaseData = async () => {
    try {
      const [personRows, farmUnitRows, penRows, reasonRows] = await Promise.all([
        databaseService.getTableDataAsync('persons'),
        databaseService.getTableDataAsync('farm_unit', { silent: true }),
        databaseService.getTableDataAsync('pens', { silent: true }),
        databaseService.getTableDataAsync('transfer-reasons', { silent: true })
      ])
      persons.value = (personRows || []).map(mapPerson).filter((x) => x.name)
      pens.value = buildAssignablePens(farmUnitRows || [], penRows || [])

      const fromDictionary = Array.from(
        new Set((reasonRows || []).map(mapActiveReasonName).filter(Boolean))
      )
      reasonOptions.value = fromDictionary.length ? fromDictionary : DEFAULT_TRANSFER_REASONS
    } catch (error) {
      console.error('加载基础数据失败:', error)
    }
  }

  const loadTransferEvents = async () => {
    tableLoading.value = true
    try {
      const all = await databaseService.getUnifiedCowEventRowsAsync()
      recentEventSourceRows.value = all || []
      const transferRecords = (all || []).filter((e: any) => e.eventType === 'transfer')
      const mapped = transferRecords
        .map((e: any) => ({
          id: normalize(e.id),
          cowNumber: normalize(e.cowNumber),
          reason: normalize(e.details?.transferReason) || '',
          fromPen: normalize(e.details?.fromPenName) || normalize(e.details?.fromPenId) || '',
          toPen:
            normalize(e.details?.toUnitName || e.details?.to_unit_name || e.details?.toPenName) ||
            normalize(e.details?.toPenId) ||
            '',
          recorder: normalize(e.operatorName) || '',
          transferTime: normalize(e.eventTime),
          notes: normalize(e.notes) || undefined,
          createdAt: normalize(e.createdAt)
        }))
        .sort((a, b) => new Date(b.transferTime).getTime() - new Date(a.transferTime).getTime())

      totalEvents.value = mapped.length
      const start = (currentPage.value - 1) * pageSize.value
      const end = start + pageSize.value
      transferEvents.value = mapped.slice(start, end)
    } catch (error) {
      console.error('加载转群记录失败:', error)
      ElMessage.error('加载转群记录失败')
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

      formData.fromPen = currentPenOf(cow)
      const currentLabel = penLabel(formData.fromPen)
      cowStatus.value = { text: `当前栏舍：${currentLabel || '未设置'}`, class: 'text-green-600' }
    } catch {
      cowStatus.value = { text: '校验失败', class: 'text-yellow-600' }
    }
  }

  const formatDateTime = (dateTime: string) => formatDateOnly(dateTime, '--')

  const handleSubmit = async () => {
    if (!formRef.value) return

    try {
      await formRef.value.validate()
    } catch {
      return
    }

    const fromPenForCheck = resolvePen(formData.fromPen)
    const toPenForCheck = resolvePen(formData.toPen)
    if (samePen(fromPenForCheck, toPenForCheck)) {
      ElMessage.warning('原栏舍和目标栏舍不能相同')
      return
    }

    submitLoading.value = true
    try {
      const eventId = `transfer-${Date.now()}`
      const now = new Date().toISOString()
      const cowNumber = formData.cowNumber.trim()
      const fromPen = resolvePen(formData.fromPen)
      const toPen = resolvePen(formData.toPen)

      // 写入统一事件表（优先）
      await databaseService.addCowEvent({
        id: eventId,
        cowNumber,
        eventType: 'transfer',
        eventTime: formData.transferTime || now,
        operatorName: formData.recorder,
        details: {
          fromPenId: fromPen.id,
          fromPenName: fromPen.name,
          fromUnitId: fromPen.id,
          from_unit_id: fromPen.id,
          fromUnitName: fromPen.name,
          from_unit_name: fromPen.name,
          toPenId: toPen.id,
          toPenName: toPen.name,
          toUnitId: toPen.id,
          to_unit_id: toPen.id,
          toUnitName: toPen.name,
          to_unit_name: toPen.name,
          transferReason: formData.reason
        },
        notes: formData.notes.trim() || undefined
      })

      // 兼容：仍写入旧表
      const newEvent: TransferEventRecord = {
        id: eventId,
        cowNumber,
        reason: formData.reason,
        fromPen: fromPen.name,
        toPen: toPen.name,
        recorder: formData.recorder,
        transferTime: formData.transferTime || now,
        notes: formData.notes.trim() || undefined,
        createdAt: now
      }
      await databaseService.addTableDataAsync('transfer-events', newEvent)

      ElMessage.success('转群录入成功')
      handleReset()
      await loadTransferEvents()
      recentRefreshKey.value += 1
    } catch (error: any) {
      console.error('提交转群失败:', error)
      ElMessage.error(error?.message || '提交失败')
    } finally {
      submitLoading.value = false
    }
  }

  const handleReset = () => {
    formRef.value?.resetFields()
    formData.transferTime = todayKey()
    cowStatus.value = { text: '', class: 'text-gray-500' }
  }

  const handleSizeChange = (size: number) => {
    pageSize.value = size
    currentPage.value = 1
    void loadTransferEvents()
  }

  const handleCurrentChange = (page: number) => {
    currentPage.value = page
    void loadTransferEvents()
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

  function penLabel(id: string) {
    return resolvePen(id).name || id
  }

  function samePen(left: SimplePen, right: SimplePen) {
    const leftKeys = [left.id, left.name]
      .map((value) => normalize(value).toLowerCase())
      .filter(Boolean)
    const rightKeys = [right.id, right.name]
      .map((value) => normalize(value).toLowerCase())
      .filter(Boolean)
    return leftKeys.some((value) => rightKeys.includes(value))
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
    void loadTransferEvents()
  })

  defineOptions({ name: 'TransferEvent' })
</script>

<style scoped lang="scss" src="../entry-layout.scss"></style>
