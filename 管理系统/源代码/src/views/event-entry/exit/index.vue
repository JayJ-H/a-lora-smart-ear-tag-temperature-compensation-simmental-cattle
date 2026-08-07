<template>
  <div class="entry-page">
    <div class="entry-page-head">
      <div>
        <h1>离场录入</h1>
        <p>记录出售、淘汰、死亡或转出，提交后保留追溯事件并更新牛只状态。</p>
      </div>
      <div class="entry-page-head__chips" aria-label="离场录入口径">
        <span>必须已有牛号</span>
        <span>原因字典选择</span>
        <span>离场后不再占用圈舍</span>
      </div>
    </div>

    <div class="entry-summary-strip">
      <div>
        <small>提交结果</small>
        <strong>离场事件 + 牛只状态</strong>
      </div>
      <div>
        <small>圈舍口径</small>
        <strong>当前圈舍退出为空</strong>
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
            <h2>离场信息</h2>
            <p>离场原因从平台原因字典读取，备注仅记录现场补充说明。</p>
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
              <ElFormItem label="离场原因" prop="reason">
                <ElSelect v-model="formData.reason" placeholder="请选择离场原因" class="w-full">
                  <ElOption
                    v-for="reason in exitReasons"
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
              <ElFormItem label="离场时间" prop="exitTime">
                <ElDatePicker
                  v-model="formData.exitTime"
                  type="date"
                  placeholder="请选择离场时间"
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
        title="最近离场记录"
        :event-types="['exit', 'death']"
        :refresh-key="recentRefreshKey"
        :records="recentEventSourceRows"
      />
    </section>

    <div class="entry-panel entry-history-panel">
      <div class="entry-panel__head entry-panel__head--inline">
        <div>
          <h2>离场历史</h2>
          <p>保留最近离场记录，死亡原因会同步归入统一事件口径。</p>
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
          :data="visibleExitEvents"
          height="420"
          style="width: 100%"
          :loading="tableLoading"
          class="entry-history-table"
          @wheel.passive="onExitTableWheel"
        >
          <ElTableColumn prop="cowNumber" label="牛号" width="120" />
          <ElTableColumn prop="reason" label="离场原因" width="140" />
          <ElTableColumn prop="recorder" label="记录人" width="120" />
          <ElTableColumn prop="exitTime" label="离场时间" width="180">
            <template #default="{ row }">{{ formatDateTime(row.exitTime) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="notes" label="备注" min-width="220" show-overflow-tooltip />
        </ElTable>
      </div>
      <div v-if="exitEvents.length > visibleExitEvents.length" class="load-more-row">
        <ElButton size="small" plain @click="() => loadMoreExitEvents()">
          加载更多 {{ visibleExitEvents.length }}/{{ exitEvents.length }}
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

  interface ExitForm {
    cowNumber: string
    reason: string
    recorder: string
    exitTime: string
    notes: string
  }

  interface ExitEventRecord {
    id: string
    cowNumber: string
    reason: string
    recorder: string
    exitTime: string
    notes?: string
    createdAt: string
  }

  interface SimplePerson {
    id: string
    name: string
    department?: string
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
  const exitEvents = ref<ExitEventRecord[]>([])
  const {
    visibleItems: visibleExitEvents,
    loadMore: loadMoreExitEvents,
    handleWheel: onExitTableWheel
  } = useLazyRenderWindow(exitEvents, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const persons = ref<SimplePerson[]>([])
  const exitReasons = ref<Array<{ label: string; value: string }>>([])
  const DEFAULT_EXIT_REASONS = ['淘汰', '出售', '死亡', '转出他场']

  const todayKey = () => new Date().toISOString().slice(0, 10)

  const formData = reactive<ExitForm>({
    cowNumber: '',
    reason: '',
    recorder: '',
    exitTime: todayKey(),
    notes: ''
  })

  const formRules: FormRules = {
    cowNumber: [{ required: true, message: '请输入牛号', trigger: 'blur' }],
    reason: [{ required: true, message: '请选择离场原因', trigger: 'change' }],
    recorder: [{ required: true, message: '请选择记录人', trigger: 'change' }],
    exitTime: [{ required: true, message: '请选择离场时间', trigger: 'change' }]
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

  const _mapExitEvent = (raw: any): ExitEventRecord => ({
    id: normalize(raw.id),
    cowNumber: normalize(raw.cowNumber),
    reason: normalize(raw.reason),
    recorder: normalize(raw.recorder),
    exitTime: normalize(raw.exitTime),
    notes: normalize(raw.notes) || undefined,
    createdAt: normalize(raw.createdAt)
  })

  const loadBaseData = async () => {
    try {
      const [rows, reasonRows] = await Promise.all([
        databaseService.getTableDataAsync('persons'),
        databaseService.getTableDataAsync('transfer-reasons', { silent: true })
      ])
      persons.value = (rows || []).map(mapPerson).filter((x) => x.name)
      exitReasons.value = optionListFromReasons(reasonRows, DEFAULT_EXIT_REASONS)
    } catch (error) {
      console.error('加载人员数据失败:', error)
    }
  }

  const loadExitEvents = async () => {
    tableLoading.value = true
    try {
      const all = await databaseService.getUnifiedCowEventRowsAsync()
      recentEventSourceRows.value = all || []
      const exitRecords = (all || []).filter((e: any) => ['exit', 'death'].includes(e.eventType))
      const mapped = exitRecords
        .map((e: any) => ({
          id: normalize(e.id),
          cowNumber: normalize(e.cowNumber),
          reason: normalize(e.details?.exitReason) || '',
          recorder: normalize(e.operatorName) || '',
          exitTime: normalize(e.eventTime),
          notes: normalize(e.notes) || undefined,
          createdAt: normalize(e.createdAt)
        }))
        .sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime())

      totalEvents.value = mapped.length
      const start = (currentPage.value - 1) * pageSize.value
      const end = start + pageSize.value
      exitEvents.value = mapped.slice(start, end)
    } catch (error) {
      console.error('加载离场记录失败:', error)
      ElMessage.error('加载离场记录失败')
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
        text: `当前状态：${normalize(cow.status) || '未知'}`,
        class: 'text-green-600'
      }
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

    submitLoading.value = true
    try {
      const eventId = `exit-${Date.now()}`
      const now = new Date().toISOString()
      const cowNumber = formData.cowNumber.trim()
      const eventType = isDeathReason(formData.reason) ? 'death' : 'exit'

      // 写入统一事件表（优先）
      await databaseService.addCowEvent({
        id: eventId,
        cowNumber,
        eventType,
        eventTime: formData.exitTime || now,
        operatorName: formData.recorder,
        details: {
          exitReason: formData.reason,
          destination: undefined
        },
        notes: formData.notes.trim() || undefined
      })

      // 兼容：仍写入旧表
      const newEvent: ExitEventRecord = {
        id: eventId,
        cowNumber,
        reason: formData.reason,
        recorder: formData.recorder,
        exitTime: formData.exitTime || now,
        notes: formData.notes.trim() || undefined,
        createdAt: now
      }
      await databaseService.addTableDataAsync('exit-events', newEvent)

      ElMessage.success('离场录入成功')
      handleReset()
      await loadExitEvents()
      recentRefreshKey.value += 1
    } catch (error: any) {
      console.error('提交离场失败:', error)
      ElMessage.error(error?.message || '提交失败')
    } finally {
      submitLoading.value = false
    }
  }

  const handleReset = () => {
    formRef.value?.resetFields()
    formData.exitTime = todayKey()
    cowStatus.value = { text: '', class: 'text-gray-500' }
  }

  const handleSizeChange = (size: number) => {
    pageSize.value = size
    currentPage.value = 1
    void loadExitEvents()
  }

  const handleCurrentChange = (page: number) => {
    currentPage.value = page
    void loadExitEvents()
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
      .filter(Boolean) as Array<{ label: string; value: string }>
    return options.length ? options : fallback.map((name) => ({ label: name, value: name }))
  }

  function isDeathReason(reason: string) {
    return /死亡|病死|猝死|death/i.test(normalize(reason))
  }

  function isEnabledRow(row: any) {
    const status = normalize(row.status).toLowerCase()
    if (status)
      return ['启用', '正常', 'active', 'enabled'].some((item) => item.toLowerCase() === status)
    if (row.isActive !== undefined) return Boolean(row.isActive)
    if (row.is_active !== undefined) return Boolean(row.is_active)
    return true
  }

  onMounted(() => {
    void loadBaseData()
    void loadExitEvents()
  })

  defineOptions({ name: 'ExitEvent' })
</script>

<style scoped lang="scss" src="../entry-layout.scss"></style>
