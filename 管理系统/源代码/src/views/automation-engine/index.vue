<template>
  <div class="fluent-page automation-engine">
    <section class="fluent-page-header">
      <div>
        <h1>自动化流程引擎</h1>
      </div>
      <div class="fluent-page-actions">
        <ElButton :loading="checking" @click="runAutomationCheck">
          <ArtSvgIcon icon="ri:play-circle-line" class="mr-1" />
          核验后端状态
        </ElButton>
        <ElButton type="primary" disabled title="生产写入由规则服务统一管控">
          <ArtSvgIcon icon="ri:add-line" class="mr-1" />
          创建工作流
        </ElButton>
      </div>
    </section>

    <ElAlert
      class="backend-alert"
      :type="backendReady ? 'success' : 'warning'"
      :closable="false"
      show-icon
      :title="automationAlertTitle"
    />

    <section class="fluent-metric-grid">
      <div class="fluent-metric-card">
        <div class="metric-label">数据库规则</div>
        <div class="metric-value">{{ activeRules }}</div>
        <div class="metric-note">来自 workflow-templates / automated-actions</div>
      </div>
      <div class="fluent-metric-card is-teal">
        <div class="metric-label">执行记录</div>
        <div class="metric-value">{{ runningInstances }}</div>
        <div class="metric-note">来自 workflow-instances</div>
      </div>
      <div class="fluent-metric-card is-warning">
        <div class="metric-label">执行成功率</div>
        <div class="metric-value">{{ successRateText }}</div>
        <div class="metric-note">仅统计真实执行记录</div>
      </div>
      <div class="fluent-metric-card is-info">
        <div class="metric-label">提醒记录</div>
        <div class="metric-value">{{ todayReminders }}</div>
        <div class="metric-note">来自 reminder-rules</div>
      </div>
    </section>

    <section class="fluent-panel">
      <ElTabs v-model="activeTab">
        <ElTabPane label="工作流" name="workflows">
          <div
            ref="workflowContainerRef"
            class="automation-window-scroll"
            @scroll.passive="onWorkflowScroll"
            @wheel.passive="onWorkflowWheel"
          >
            <div class="automation-grid">
              <article
                v-for="workflow in visibleWorkflows"
                :key="workflow.id"
                class="fluent-object-card workflow-card"
              >
                <div class="card-topline">
                  <div>
                    <h2>{{ workflow.name }}</h2>
                  </div>
                  <ElTag :type="workflow.enabled ? 'success' : 'info'">
                    {{ workflow.enabled ? '启用' : '停用' }}
                  </ElTag>
                </div>
                <div class="workflow-meta">
                  <span>触发：{{ workflow.trigger }}</span>
                  <span>优先级：{{ workflow.priority }}</span>
                  <span>步骤：{{ workflow.steps }}</span>
                </div>
                <ElProgress :percentage="workflow.progress" :stroke-width="8" />
                <div class="card-actions">
                  <ElButton size="small" disabled @click="toggleWorkflow(workflow.id)">
                    {{ workflow.enabled ? '停用' : '启用' }}
                  </ElButton>
                  <ElButton size="small" type="primary" disabled @click="startWorkflow(workflow.id)"
                    >启动</ElButton
                  >
                </div>
              </article>
              <div v-if="!workflows.length" class="integration-empty"
                >自动化工作流表暂无记录，当前保留核验视图。</div
              >
            </div>
            <div v-if="workflows.length" class="load-more-row">
              <span>
                当前窗口 {{ workflowStartIndex + 1 }}-{{ workflowEndIndex }} /
                {{ workflowTotalCount }} 条
              </span>
            </div>
          </div>
        </ElTabPane>

        <ElTabPane label="自动化动作" name="actions">
          <ElTable
            :data="visibleActions"
            table-layout="auto"
            style="width: 100%"
            height="420"
            @wheel.passive="onActionTableWheel"
          >
            <ElTableColumn prop="name" label="动作名称" min-width="180" />
            <ElTableColumn prop="type" label="动作类型" width="130">
              <template #default="{ row }">
                <ElTag>{{ row.type }}</ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="condition" label="触发条件" min-width="220" />
            <ElTableColumn prop="successRate" label="成功率" width="120">
              <template #default="{ row }">{{
                row.successRate === null ? '-' : `${row.successRate}%`
              }}</template>
            </ElTableColumn>
            <ElTableColumn prop="enabled" label="状态" width="100">
              <template #default="{ row }">
                <ElTag :type="row.enabled ? 'success' : 'info'">{{
                  row.enabled ? '启用' : '停用'
                }}</ElTag>
              </template>
            </ElTableColumn>
          </ElTable>
          <div v-if="actions.length > visibleActions.length" class="load-more-row">
            <ElButton @click="() => loadMoreActions()">
              加载更多 {{ visibleActions.length }}/{{ actions.length }}
            </ElButton>
          </div>
        </ElTabPane>

        <ElTabPane label="智能转群" name="transfer">
          <div
            ref="transferRuleContainerRef"
            class="automation-window-scroll"
            @scroll.passive="onTransferRuleScroll"
            @wheel.passive="onTransferRuleWheel"
          >
            <div class="rule-list">
              <article
                v-for="rule in visibleTransferRules"
                :key="rule.id"
                class="fluent-object-card rule-card"
              >
                <div>
                  <h2>{{ rule.name }}</h2>
                </div>
                <div class="rule-footer">
                  <ElTag :type="rule.successRate === null ? 'info' : 'success'">
                    {{ rule.successRate === null ? '无执行记录' : `${rule.successRate}% 成功率` }}
                  </ElTag>
                  <span>{{ rule.source }} -> {{ rule.target }}</span>
                </div>
              </article>
              <div v-if="!transferRules.length" class="integration-empty">
                转群规则表未返回记录，当前不展示前端内置规则。
              </div>
            </div>
            <div v-if="transferRules.length" class="load-more-row">
              <span>
                当前窗口 {{ transferRuleStartIndex + 1 }}-{{ transferRuleEndIndex }} /
                {{ transferRuleTotalCount }} 条
              </span>
            </div>
          </div>
        </ElTabPane>

        <ElTabPane label="提醒规则" name="reminders">
          <ElTable
            :data="visibleReminders"
            table-layout="auto"
            style="width: 100%"
            height="420"
            @wheel.passive="onReminderTableWheel"
          >
            <ElTableColumn prop="name" label="提醒名称" min-width="180" />
            <ElTableColumn prop="schedule" label="触发节奏" min-width="180" />
            <ElTableColumn prop="owner" label="负责人" width="120" />
            <ElTableColumn prop="status" label="状态" width="110">
              <template #default="{ row }">
                <ElTag :type="row.status === '待确认' ? 'warning' : 'success'">{{
                  row.status
                }}</ElTag>
              </template>
            </ElTableColumn>
          </ElTable>
          <div v-if="reminders.length > visibleReminders.length" class="load-more-row">
            <ElButton @click="() => loadMoreReminders()">
              加载更多 {{ visibleReminders.length }}/{{ reminders.length }}
            </ElButton>
          </div>
        </ElTabPane>
      </ElTabs>
    </section>

    <ElDialog v-model="dialogVisible" title="创建工作流规则" width="560px">
      <ElForm label-width="96px">
        <ElFormItem label="名称">
          <ElInput v-model="workflowForm.name" placeholder="输入工作流名称" />
        </ElFormItem>
        <ElFormItem label="触发方式">
          <ElSelect v-model="workflowForm.trigger" class="w-full">
            <ElOption label="事件触发" value="事件触发" />
            <ElOption label="定时触发" value="定时触发" />
            <ElOption label="条件触发" value="条件触发" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="说明">
          <ElInput v-model="workflowForm.description" type="textarea" :rows="3" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">取消</ElButton>
        <ElButton type="primary" disabled @click="createWorkflow">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import { automationApi } from '@/api/cow'
  import * as databaseService from '@/services/数据库'
  import { useLazyGridRenderWindow, useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'

  interface Workflow {
    id: string
    name: string
    description: string
    trigger: string
    priority: string
    steps: number
    progress: number
    enabled: boolean
  }

  type AnyRow = Record<string, any>

  const activeTab = ref('workflows')
  const checking = ref(false)
  const dialogVisible = ref(false)

  const workflowRows = ref<AnyRow[]>([])
  const actionRows = ref<AnyRow[]>([])
  const transferRuleRows = ref<AnyRow[]>([])
  const reminderRows = ref<AnyRow[]>([])
  const runRows = ref<AnyRow[]>([])

  const backendStatus = reactive({
    checked: false,
    lastChecked: '',
    failedTables: [] as string[]
  })

  const workflowForm = reactive({
    name: '',
    trigger: '事件触发',
    description: ''
  })

  const toEnabled = (value: unknown) =>
    ['true', '1', 'enabled', 'active', 'running'].includes(String(value ?? '').toLowerCase())

  const percentFromRows = (rows: AnyRow[]) => {
    if (!rows.length) return null
    const success = rows.filter((row) =>
      ['success', 'completed', 'done'].includes(
        String(row.status ?? row.result ?? '').toLowerCase()
      )
    ).length
    return Math.round((success / rows.length) * 100)
  }

  const safeRows = async (table: string) => {
    try {
      return await databaseService.getTableDataAsync(table, { silent: true })
    } catch {
      backendStatus.failedTables.push(table)
      return []
    }
  }

  const workflows = computed<Workflow[]>(() =>
    workflowRows.value.map((row, index) => ({
      id: String(row.id ?? `workflow-${index}`),
      name: String(row.name ?? row.workflowName ?? row.workflow_name ?? '未命名工作流'),
      description: String(row.description ?? row.remark ?? '来自自动化工作流表'),
      trigger: String(
        row.trigger ?? row.triggerType ?? row.trigger_type ?? row.triggerCondition?.eventType ?? '-'
      ),
      priority: String(row.priority ?? '-'),
      steps: Array.isArray(row.steps)
        ? row.steps.length
        : Number(row.stepCount ?? row.step_count ?? 0),
      progress: Math.max(0, Math.min(100, Number(row.progress ?? row.completionRate ?? 0))),
      enabled: toEnabled(row.enabled ?? row.isActive ?? row.is_active ?? row.status)
    }))
  )

  const actions = computed(() =>
    actionRows.value.map((row, index) => ({
      id: String(row.id ?? `action-${index}`),
      name: String(row.name ?? row.actionName ?? row.action_name ?? '未命名动作'),
      type: String(row.type ?? row.actionType ?? row.action_type ?? '-'),
      condition: formatCondition(row.condition ?? row.triggerCondition ?? row.trigger_condition),
      successRate: row.successRate ?? row.success_rate ?? null,
      enabled: toEnabled(row.enabled ?? row.isActive ?? row.is_active ?? row.status)
    }))
  )

  const transferRules = computed(() =>
    transferRuleRows.value.map((row, index) => ({
      id: String(row.id ?? `transfer-${index}`),
      name: String(row.name ?? row.ruleName ?? row.rule_name ?? '未命名转群规则'),
      description: String(
        row.description ??
          row.remark ??
          row.transferReason ??
          row.transfer_reason ??
          '来自转群规则表'
      ),
      source: Array.isArray(row.sourcePens)
        ? row.sourcePens.join('、') || '-'
        : String(row.source ?? row.sourcePen ?? row.source_pen ?? '-'),
      target: String(row.target ?? row.targetPen ?? row.target_pen ?? row.targetPenId ?? '-'),
      successRate: row.successRate ?? row.success_rate ?? null
    }))
  )

  const {
    containerRef: workflowContainerRef,
    visibleItems: visibleWorkflows,
    startIndex: workflowStartIndex,
    endIndex: workflowEndIndex,
    totalCount: workflowTotalCount,
    handleScroll: onWorkflowScroll,
    handleWheel: onWorkflowWheel
  } = useLazyGridRenderWindow(workflows, {
    rowCount: 2,
    minItemWidth: 280,
    gap: 14,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })

  const {
    containerRef: transferRuleContainerRef,
    visibleItems: visibleTransferRules,
    startIndex: transferRuleStartIndex,
    endIndex: transferRuleEndIndex,
    totalCount: transferRuleTotalCount,
    handleScroll: onTransferRuleScroll,
    handleWheel: onTransferRuleWheel
  } = useLazyGridRenderWindow(transferRules, {
    rowCount: 2,
    minItemWidth: 280,
    gap: 14,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })

  const reminders = computed(() =>
    reminderRows.value.map((row, index) => ({
      id: String(row.id ?? `reminder-${index}`),
      name: String(row.name ?? row.reminderName ?? row.reminder_name ?? '未命名提醒'),
      schedule: formatCondition(
        row.schedule ??
          row.scheduleJson ??
          row.schedule_json ??
          row.cron ??
          row.triggerTime ??
          row.trigger_time
      ),
      owner: String(
        row.owner ?? row.assignee ?? row.handler ?? row.notification?.recipients?.[0] ?? '-'
      ),
      status: toEnabled(row.enabled ?? row.isActive ?? row.is_active) ? '启用' : '停用'
    }))
  )

  const {
    visibleItems: visibleActions,
    loadMore: loadMoreActions,
    handleWheel: onActionTableWheel
  } = useLazyRenderWindow(actions, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const {
    visibleItems: visibleReminders,
    loadMore: loadMoreReminders,
    handleWheel: onReminderTableWheel
  } = useLazyRenderWindow(reminders, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const activeRules = computed(
    () =>
      workflows.value.filter((item) => item.enabled).length +
      actions.value.filter((item) => item.enabled).length
  )
  const runningInstances = computed(() => runRows.value.length)
  const successRate = computed(() => percentFromRows(runRows.value))
  const successRateText = computed(() =>
    successRate.value === null ? '-' : `${successRate.value}%`
  )
  const todayReminders = computed(
    () => reminders.value.filter((item) => item.status === '启用').length
  )
  const backendReady = computed(
    () =>
      workflowRows.value.length > 0 ||
      actionRows.value.length > 0 ||
      runRows.value.length > 0 ||
      reminderRows.value.length > 0
  )
  const automationAlertTitle = computed(() =>
    backendReady.value
      ? `自动化后端：${workflowRows.value.length} 条规则 / ${runRows.value.length} 条执行`
      : '自动化后端暂无记录'
  )

  function formatCondition(value: unknown) {
    if (!value) return '-'
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const loadAutomationStatus = async () => {
    backendStatus.failedTables = []
    const [workflowData, actionData, transferData, reminderData, runData] = await Promise.all([
      safeRows('workflow-templates'),
      safeRows('automated-actions'),
      safeRows('smart-transfer-rules'),
      safeRows('reminder-rules'),
      safeRows('workflow-instances')
    ])

    workflowRows.value = workflowData
    actionRows.value = actionData
    transferRuleRows.value = transferData
    reminderRows.value = reminderData
    runRows.value = runData
    backendStatus.checked = true
    backendStatus.lastChecked = formatDateOnly(new Date(), '-')
  }

  const runAutomationCheck = async () => {
    checking.value = true
    try {
      await loadAutomationStatus()
      await automationApi.executeAutomationCheck()
      ElMessage.info(
        backendReady.value
          ? '已刷新自动化后端核验结果'
          : '自动化生产记录暂无更新，执行操作保持规则服务管控'
      )
    } finally {
      checking.value = false
    }
  }

  const toggleWorkflow = (id: string) => {
    void id
    ElMessage.warning('生产状态由规则服务统一管控，请在后端运维流程中执行启停')
  }

  const startWorkflow = (id: string) => {
    void id
    ElMessage.warning('生产启动由规则服务统一调度，请在后端运维流程中执行')
  }

  const createWorkflow = () => {
    ElMessage.warning('生产写入由规则服务统一管控，请在后端运维流程中创建规则')
  }

  onMounted(loadAutomationStatus)

  defineOptions({ name: 'AutomationEngine' })
</script>

<style scoped lang="scss">
  .metric-label,
  .metric-note {
    color: var(--fluent-text-soft);
  }

  .metric-value {
    margin: 8px 0;
    color: var(--fluent-text);
    font-size: clamp(22px, 2vw, 28px);
    font-weight: 780;
  }

  .backend-alert {
    margin-bottom: 16px;
  }

  .integration-empty {
    padding: 18px;
    color: var(--fluent-text-soft);
    background: rgb(255 255 255 / 42%);
    border: 1px dashed var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .automation-window-scroll {
    max-height: calc((156px * 2) + 28px);
    padding: 2px 8px 2px 2px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .automation-grid,
  .rule-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 14px;
  }

  .workflow-card,
  .rule-card {
    display: grid;
    gap: 14px;
  }

  .card-topline,
  .rule-footer,
  .card-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  h2 {
    margin: 0;
    color: var(--fluent-text);
    font-size: 17px;
  }

  p,
  .workflow-meta,
  .rule-footer span {
    margin: 4px 0 0;
    color: var(--fluent-text-soft);
  }

  .workflow-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 13px;
  }
</style>
