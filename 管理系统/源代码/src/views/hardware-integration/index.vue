<template>
  <FcPageShell
    title="硬件集成控制台"
    status-label="连接状态"
    :status-value="healthScoreText"
    primary-action-label="运行诊断"
    primary-action-icon="ri:stethoscope-line"
    secondary-action-label="刷新连接"
    secondary-action-icon="ri:refresh-line"
    @primary-action="runDiagnostics"
    @secondary-action="loadData"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          label="奶厅设备在线"
          :value="`${onlineMilkingDevices}/${milkingDevices.length}`"
          :note="milkingDevices.length ? '挤奶机器人和奶量采集设备纳入监控' : '未发现奶厅设备档案'"
          icon="ri:robot-2-line"
        />
        <FcMetricTile
          label="奶厅同步"
          :value="milkingSyncText"
          :note="milkingSyncNote"
          icon="ri:swap-2-line"
          :tone="milkingSyncMetricTone"
        />
        <FcMetricTile
          label="泌乳量映射"
          :value="milkVolumeMappingText"
          :note="milkVolumeMappingNote"
          icon="ri:git-merge-line"
          :tone="milkVolumeMappingTone"
        />
        <FcMetricTile
          label="奶厅异常"
          :value="milkingWorkQueue.length"
          :note="
            criticalMilkingAlerts
              ? `${criticalMilkingAlerts} 条高危/紧急`
              : '当前无高危奶厅硬件预警'
          "
          icon="ri:alarm-warning-line"
          tone="danger"
        />
      </section>
    </template>

    <section class="hardware-layout">
      <FcPanel title="奶厅设备接入状态">
        <div class="milking-device-grid">
          <article
            v-for="device in milkingDevices.slice(0, 6)"
            :key="device.id"
            class="milking-device-card"
            :class="`is-${device.status}`"
          >
            <div class="device-card-header">
              <div>
                <h3>{{ device.name }}</h3>
                <p>{{ getDeviceTypeLabel(device.type) }} · {{ device.brand }} {{ device.model }}</p>
              </div>
              <ElTag :type="getDeviceStatusTagType(device.status)">{{
                getDeviceStatusLabel(device.status)
              }}</ElTag>
            </div>
            <div class="milking-device-meta">
              <span>位置</span>
              <strong>{{ device.location?.penName || '奶厅未标注' }}</strong>
              <span>最后上报</span>
              <strong>{{ formatRelative(device.lastSeen) }}</strong>
              <span>能力</span>
              <strong>{{ getMilkingCapabilityText(device) }}</strong>
              <span>固件</span>
              <strong>{{ device.firmwareVersion || '-' }}</strong>
            </div>
          </article>
          <FcEmptyState
            v-if="!milkingDevices.length"
            icon="ri:robot-2-line"
            title="奶厅设备档案待补齐"
            description="暂无奶厅设备档案。"
          />
        </div>
      </FcPanel>

      <FcPanel title="奶厅 API/MQTT 数据同步">
        <div class="parlor-sync-stack">
          <article
            v-for="sync in milkingSynchronizations.slice(0, 5)"
            :key="sync.id"
            class="parlor-sync-item"
            :class="sync.status"
          >
            <div>
              <span
                >{{ getMilkingSyncSource(sync) }} →
                {{ getTargetSystemLabel(sync.targetSystem) }}</span
              >
              <h3
                >{{ getDataTypeLabel(sync.dataType) }} ·
                {{ getFrequencyLabel(sync.syncFrequency) }}</h3
              >
              <p
                >{{ formatDateTime(sync.lastSync) }} 最近同步 · {{ sync.recordsProcessed }} 条 ·
                错误 {{ sync.errorCount }}</p
              >
            </div>
            <div class="sync-actions">
              <ElTag :type="getSyncStatusTagType(sync.status)">{{
                getSyncStatusLabel(sync.status)
              }}</ElTag>
              <ElButton size="small" @click="triggerSync(sync)">执行</ElButton>
            </div>
          </article>
          <FcEmptyState
            v-if="!milkingSynchronizations.length"
            icon="ri:swap-2-line"
            title="奶厅同步任务待接入"
            description="暂无奶厅同步任务。"
          />
        </div>
      </FcPanel>
    </section>

    <section class="hardware-layout">
      <FcPanel title="泌乳量映射">
        <div class="mapping-board">
          <article v-for="mapping in milkVolumeMappings" :key="mapping.id" class="mapping-card">
            <div>
              <span>{{ mapping.source }} → {{ mapping.target }}</span>
              <h3>{{ mapping.dataType }}</h3>
              <div class="mapping-meta">
                <span>过滤 {{ mapping.filters }}</span>
                <span>处理 {{ mapping.transformations }}</span>
              </div>
            </div>
            <ElTag :type="mapping.tagType">{{ mapping.status }}</ElTag>
          </article>
          <FcEmptyState
            v-if="!milkVolumeMappings.length"
            icon="ri:git-merge-line"
            title="泌乳量字段映射待配置"
            description="暂无字段映射。"
          />
        </div>
      </FcPanel>

      <FcPanel title="奶厅异常与同步状态" subtitle="待处理">
        <div v-if="milkingWorkQueue.length" class="work-queue">
          <article
            v-for="item in milkingWorkQueue"
            :key="item.id"
            class="queue-item"
            :class="item.tone"
          >
            <div>
              <span>{{ item.kind }}</span>
              <h3>{{ item.title }}</h3>
              <p>{{ item.description }}</p>
            </div>
            <ElTag :type="item.tagType">{{ item.level }}</ElTag>
          </article>
        </div>
        <FcEmptyState
          v-else
          icon="ri:checkbox-circle-line"
          title="奶厅设备和同步状态正常"
          description="暂无阻塞事项。"
        />
      </FcPanel>
    </section>

    <section class="hardware-layout">
      <FcPanel title="数据流拓扑">
        <div class="link-map">
          <article v-for="node in linkNodes" :key="node.label" class="link-node" :class="node.tone">
            <div class="link-icon">
              <ArtSvgIcon :icon="node.icon" />
            </div>
            <div>
              <span>{{ node.label }}</span>
              <strong>{{ node.value }}</strong>
              <p>{{ node.note }}</p>
            </div>
          </article>
        </div>
      </FcPanel>

      <FcPanel title="今日工作队列">
        <div v-if="workQueue.length" class="work-queue">
          <article v-for="item in workQueue" :key="item.id" class="queue-item" :class="item.tone">
            <div>
              <span>{{ item.kind }}</span>
              <h3>{{ item.title }}</h3>
              <p>{{ item.description }}</p>
            </div>
            <ElTag :type="item.tagType">{{ item.level }}</ElTag>
          </article>
        </div>
        <FcEmptyState
          v-else
          icon="ri:checkbox-circle-line"
          title="当前没有硬件处置任务"
          description="暂无处置任务。"
        />
      </FcPanel>
    </section>

    <section class="hardware-layout">
      <FcPanel title="设备-牛绑定">
        <div class="assignment-toolbar">
          <ElSelect v-model="assignmentForm.deviceId" filterable clearable placeholder="选择设备">
            <ElOption
              v-for="device in assignableDevices"
              :key="device.id"
              :label="device.name"
              :value="device.id"
            />
          </ElSelect>
          <ElSelect v-model="assignmentForm.cowId" filterable clearable placeholder="选择牛只">
            <ElOption
              v-for="cow in cowOptions"
              :key="cow.id"
              :label="getCowOptionLabel(cow)"
              :value="cow.id"
            />
          </ElSelect>
          <ElInput v-model="assignmentForm.reason" clearable placeholder="绑定原因 / 换绑说明" />
        </div>
        <div class="assignment-actions">
          <ElButton type="primary" :loading="assignmentSaving" @click="bindSelectedDevice">
            <ArtSvgIcon icon="ri:link-m" class="mr-1" />
            绑定
          </ElButton>
          <ElButton :loading="assignmentSaving" @click="rebindSelectedDevice">
            <ArtSvgIcon icon="ri:swap-line" class="mr-1" />
            换绑
          </ElButton>
          <ElButton type="warning" :loading="assignmentSaving" @click="unbindSelectedDevice">
            <ArtSvgIcon icon="ri:link-unlink-m" class="mr-1" />
            解绑
          </ElButton>
        </div>

        <div v-if="activeAssignments.length" class="assignment-list">
          <article
            v-for="assignment in activeAssignments.slice(0, 6)"
            :key="assignment.id"
            class="assignment-row"
          >
            <div>
              <span
                >{{ getDeviceName(assignment.deviceId) }} ·
                {{ formatDateTime(assignment.assignedAt) }}</span
              >
              <h3>{{ getCowName(assignment.cowId) }}</h3>
              <p>{{ assignment.reason || '现场设备绑定' }}</p>
            </div>
            <div class="assignment-row-actions">
              <ElTag type="success">绑定中</ElTag>
              <ElButton
                size="small"
                type="warning"
                :loading="assignmentSaving"
                @click="unbindAssignment(assignment)"
                >解绑</ElButton
              >
              <ElButton size="small" @click="prefillAssignment(assignment)">换绑</ElButton>
            </div>
          </article>
        </div>
        <FcEmptyState
          v-else
          icon="ri:link-m"
          title="暂无活跃设备绑定"
          description="暂无活跃绑定。"
        />
      </FcPanel>

      <FcPanel title="绑定历史" dense>
        <div class="assignment-history">
          <article v-for="assignment in assignmentHistory.slice(0, 7)" :key="assignment.id">
            <div>
              <strong
                >{{ getDeviceName(assignment.deviceId) }} →
                {{ getCowName(assignment.cowId) }}</strong
              >
              <span
                >{{ formatDateTime(assignment.assignedAt) }} /
                {{
                  assignment.releasedAt ? formatDateTime(assignment.releasedAt) : '当前绑定'
                }}</span
              >
              <p>{{ assignment.reason || '-' }}</p>
            </div>
            <ElTag :type="assignment.status === 'active' ? 'success' : 'info'">
              {{ assignment.status === 'active' ? '绑定中' : '已解绑' }}
            </ElTag>
          </article>
          <FcEmptyState
            v-if="!assignmentHistory.length"
            icon="ri:history-line"
            title="暂无绑定历史"
            description="暂无历史记录。"
          />
        </div>
      </FcPanel>
    </section>

    <section class="hardware-layout is-device-first">
      <FcPanel title="设备矩阵">
        <template #actions>
          <ElButton type="primary" @click="registerDeviceDialogVisible = true">
            <ArtSvgIcon icon="ri:add-line" class="mr-1" />
            注册设备
          </ElButton>
        </template>

        <div class="device-toolbar">
          <ElInput v-model="deviceFilter.keyword" clearable placeholder="搜索设备、品牌、型号" />
          <ElSelect v-model="deviceFilter.type" clearable placeholder="设备类型">
            <ElOption
              v-for="type in deviceTypes"
              :key="type.value"
              :label="type.label"
              :value="type.value"
            />
          </ElSelect>
          <ElSelect v-model="deviceFilter.status" clearable placeholder="运行状态">
            <ElOption label="在线" value="online" />
            <ElOption label="离线" value="offline" />
            <ElOption label="维护中" value="maintenance" />
            <ElOption label="故障" value="error" />
          </ElSelect>
        </div>

        <div
          v-if="filteredDevices.length"
          ref="deviceGridContainerRef"
          class="device-grid-scroll"
          @scroll.passive="onDeviceGridScroll"
          @wheel.passive="onDeviceGridWheel"
        >
          <div class="device-grid">
            <article
              v-for="device in visibleDevices"
              :key="device.id"
              class="device-card"
              :class="`is-${device.status}`"
            >
              <div class="device-card-header">
                <div>
                  <h3>{{ device.name }}</h3>
                  <p
                    >{{ getDeviceTypeLabel(device.type) }} · {{ device.brand }}
                    {{ device.model }}</p
                  >
                </div>
                <ElTag :type="getDeviceStatusTagType(device.status)">
                  {{ getDeviceStatusLabel(device.status) }}
                </ElTag>
              </div>

              <div class="device-meta">
                <span>位置</span>
                <strong>{{ device.location?.penName || '未分配圈舍' }}</strong>
                <span>固件</span>
                <strong>{{ device.firmwareVersion || '-' }}</strong>
                <span>最后上报</span>
                <strong>{{ formatRelative(device.lastSeen) }}</strong>
              </div>

              <div class="capability-row">
                <ElTag
                  v-for="capability in device.capabilities.slice(0, 4)"
                  :key="capability"
                  size="small"
                >
                  {{ getCapabilityLabel(capability) }}
                </ElTag>
                <span v-if="!device.capabilities.length">暂无能力标签</span>
              </div>

              <div class="device-actions">
                <ElButton size="small" @click="viewDeviceDetail(device)">查看</ElButton>
                <ElButton size="small" @click="sendDeviceCommand(device)">控制</ElButton>
              </div>
            </article>
          </div>
        </div>
        <div v-if="filteredDevices.length > visibleDevices.length" class="load-more-row">
          <ElButton @click="() => loadMoreDevices()">
            加载更多设备 {{ visibleDevices.length }}/{{ filteredDevices.length }}
          </ElButton>
        </div>

        <FcEmptyState
          v-else
          icon="ri:base-station-line"
          title="没有匹配的设备"
          description="当前筛选无结果。"
          action-label="注册设备"
          @action="registerDeviceDialogVisible = true"
        />
      </FcPanel>

      <div class="side-stack">
        <FcPanel title="最近控制命令" dense>
          <div class="command-log-list">
            <article
              v-for="command in latestCommandLogs"
              :key="String(command.id)"
              class="command-log-row"
            >
              <div>
                <strong>{{
                  getDeviceName(String(command.deviceId ?? command.device_id ?? ''))
                }}</strong>
                <span
                  >{{ getCommandTypeLabel(command) }} · {{ command.operator || '设备管理员' }}</span
                >
                <p>{{
                  formatDateTime(
                    String(
                      command.requestedAt ??
                        command.requested_at ??
                        command.createdAt ??
                        command.created_at ??
                        ''
                    )
                  )
                }}</p>
              </div>
              <ElTag :type="getCommandStatusTagType(command)">{{
                getCommandStatusLabel(command)
              }}</ElTag>
            </article>
            <FcEmptyState
              v-if="!latestCommandLogs.length"
              icon="ri:terminal-box-line"
              title="暂无设备命令记录"
              description="暂无控制命令。"
            />
          </div>
        </FcPanel>

        <FcPanel title="协议质量" dense>
          <div class="protocol-list">
            <article v-for="protocol in protocols.slice(0, 4)" :key="protocol.id">
              <div>
                <strong>{{ protocol.name }}</strong>
                <span
                  >{{ getProtocolTypeLabel(protocol.type) }} ·
                  {{ protocol.dataFormat.toUpperCase() }}</span
                >
              </div>
              <ElProgress :percentage="normalizePercent(protocol.successRate)" :stroke-width="8" />
            </article>
            <FcEmptyState
              v-if="!protocols.length"
              icon="ri:git-branch-line"
              title="还没有协议配置"
              description="暂无协议配置。"
            />
          </div>
        </FcPanel>

        <FcPanel title="同步任务" dense>
          <div class="sync-list">
            <article v-for="sync in synchronizations.slice(0, 5)" :key="sync.id" class="sync-row">
              <div>
                <strong>{{ sync.sourceDevice }} → {{ sync.targetSystem }}</strong>
                <span>{{ sync.dataType }} · {{ getFrequencyLabel(sync.syncFrequency) }}</span>
              </div>
              <div class="sync-actions">
                <ElTag :type="getSyncStatusTagType(sync.status)">{{
                  getSyncStatusLabel(sync.status)
                }}</ElTag>
                <ElButton size="small" @click="triggerSync(sync)">执行</ElButton>
              </div>
            </article>
            <FcEmptyState
              v-if="!synchronizations.length"
              icon="ri:swap-2-line"
              title="暂无同步任务"
              description="暂无同步任务。"
            />
          </div>
        </FcPanel>
      </div>
    </section>

    <section class="hardware-layout">
      <FcPanel title="硬件预警">
        <div v-if="activeAlerts.length" class="alert-list">
          <article
            v-for="alert in activeAlerts.slice(0, 6)"
            :key="alert.id"
            class="alert-row"
            :class="alert.severity"
          >
            <div>
              <span
                >{{ getAlertTypeLabel(alert.type) }} · {{ formatDateTime(alert.detectedAt) }}</span
              >
              <h3>{{ alert.title }}</h3>
              <p>{{ alert.description }}</p>
            </div>
            <div class="alert-actions">
              <ElTag :type="getSeverityTagType(alert.severity)">
                {{ getSeverityLabel(alert.severity) }}
              </ElTag>
              <ElButton
                v-if="alert.status === 'active'"
                size="small"
                type="warning"
                @click="acknowledgeAlert(alert)"
              >
                确认
              </ElButton>
            </div>
          </article>
        </div>
        <FcEmptyState
          v-else
          icon="ri:shield-check-line"
          title="硬件预警已清空"
          description="暂无活跃预警。"
        />
      </FcPanel>

      <FcPanel title="维护计划">
        <div v-if="pendingMaintenance.length" class="maintenance-list">
          <article v-for="item in pendingMaintenance.slice(0, 6)" :key="item.id">
            <div>
              <span
                >{{ getMaintenanceTypeLabel(item.type) }} ·
                {{ formatDate(item.scheduledDate) }}</span
              >
              <h3>{{ item.title }}</h3>
              <p>{{ item.technician || '未分配技术员' }} · {{ getDeviceName(item.deviceId) }}</p>
            </div>
            <ElTag :type="getMaintenanceStatusTagType(item.status)">
              {{ getMaintenanceStatusLabel(item.status) }}
            </ElTag>
          </article>
        </div>
        <FcEmptyState
          v-else
          icon="ri:calendar-check-line"
          title="近期没有待维护任务"
          description="暂无待维护任务。"
        />
      </FcPanel>
    </section>

    <ElDialog
      v-model="registerDeviceDialogVisible"
      title="注册新设备"
      width="620px"
      @close="resetRegisterDeviceForm"
    >
      <ElForm
        ref="registerDeviceFormRef"
        :model="registerDeviceForm"
        :rules="registerDeviceFormRules"
        label-width="100px"
      >
        <ElFormItem label="设备名称" prop="name">
          <ElInput v-model="registerDeviceForm.name" placeholder="例如：A区温度传感器 01" />
        </ElFormItem>
        <ElFormItem label="设备类型" prop="type">
          <ElSelect v-model="registerDeviceForm.type" class="w-full" placeholder="选择设备类型">
            <ElOption
              v-for="type in deviceTypes"
              :key="type.value"
              :label="type.label"
              :value="type.value"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="品牌" prop="brand">
          <ElInput v-model="registerDeviceForm.brand" placeholder="请输入品牌" />
        </ElFormItem>
        <ElFormItem label="型号" prop="model">
          <ElInput v-model="registerDeviceForm.model" placeholder="请输入型号" />
        </ElFormItem>
        <ElFormItem label="序列号" prop="serialNumber">
          <ElInput v-model="registerDeviceForm.serialNumber" placeholder="请输入序列号" />
        </ElFormItem>
        <ElFormItem label="安装位置" prop="penName">
          <ElInput v-model="registerDeviceForm.penName" placeholder="例如：1号挤奶厅 / A区牛舍" />
        </ElFormItem>
        <ElFormItem label="接入人员" prop="operator">
          <ElInput v-model="registerDeviceForm.operator" placeholder="记录本次设备接入人员" />
        </ElFormItem>
        <ElFormItem label="接入说明">
          <ElInput
            v-model="registerDeviceForm.connectionNote"
            type="textarea"
            :rows="2"
            placeholder="记录网关、协议、数据表或现场检查说明"
          />
        </ElFormItem>
      </ElForm>

      <template #footer>
        <ElButton @click="registerDeviceDialogVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="registering" @click="handleRegisterDevice"
          >注册</ElButton
        >
      </template>
    </ElDialog>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import type { FormInstance, FormRules } from 'element-plus'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import FcEmptyState from '@/components/business/fluent-console/FcEmptyState.vue'
  import { hardwareApi } from '@/api/cow'
  import * as databaseService from '@/services/数据库'
  import { useLazyGridRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'
  import type {
    DataSynchronization,
    DeviceMaintenance,
    HardwareAlert,
    HardwareDevice,
    IntegrationProtocol
  } from '@/types/cow'

  defineOptions({ name: 'HardwareIntegration' })

  type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

  interface QueueItem {
    id: string
    kind: string
    title: string
    description: string
    level: string
    tagType: TagType
    tone: 'danger' | 'warning' | 'primary'
  }

  interface MilkVolumeMappingItem {
    id: string
    source: string
    target: string
    dataType: string
    filters: string
    transformations: string
    status: string
    tagType: TagType
  }

  interface CowOption {
    id: string
    animalId: string
    cowNumber: string
    earTagNumber: string
    currentPen: string
  }

  interface AssignmentRow {
    id: string
    cowId: string
    animalId: string
    cowNumber: string
    deviceId: string
    channelId: string
    assignedAt: string
    releasedAt: string
    reason: string
    status: 'active' | 'released'
    raw: Record<string, unknown>
  }

  type SyncConfiguration = NonNullable<DataSynchronization['configuration']>

  const loading = ref(false)
  const registering = ref(false)
  const assignmentSaving = ref(false)
  const registerDeviceDialogVisible = ref(false)
  const registerDeviceFormRef = ref<FormInstance>()

  const devices = ref<HardwareDevice[]>([])
  const cowOptions = ref<CowOption[]>([])
  const assignmentRows = ref<AssignmentRow[]>([])
  const protocols = ref<IntegrationProtocol[]>([])
  const synchronizations = ref<DataSynchronization[]>([])
  const hardwareAlerts = ref<HardwareAlert[]>([])
  const maintenanceRecords = ref<DeviceMaintenance[]>([])
  const sensorRows = ref<Record<string, unknown>[]>([])
  const commandLogs = ref<Record<string, unknown>[]>([])

  const deviceFilter = reactive({
    keyword: '',
    type: '' as '' | HardwareDevice['type'],
    status: '' as '' | HardwareDevice['status']
  })

  const registerDeviceForm = reactive({
    name: '',
    type: 'temperature_sensor' as HardwareDevice['type'],
    brand: '',
    model: '',
    serialNumber: '',
    penName: '',
    operator: '设备管理员',
    connectionNote: ''
  })

  const assignmentForm = reactive({
    deviceId: '',
    cowId: '',
    reason: '现场设备绑定'
  })

  const registerDeviceFormRules: FormRules = {
    name: [{ required: true, message: '请输入设备名称', trigger: 'blur' }],
    type: [{ required: true, message: '请选择设备类型', trigger: 'change' }],
    brand: [{ required: true, message: '请输入品牌', trigger: 'blur' }],
    model: [{ required: true, message: '请输入型号', trigger: 'blur' }],
    serialNumber: [{ required: true, message: '请输入序列号', trigger: 'blur' }],
    penName: [{ required: true, message: '请输入安装位置', trigger: 'blur' }],
    operator: [{ required: true, message: '请输入接入人员', trigger: 'blur' }]
  }

  const deviceTypes: { label: string; value: HardwareDevice['type'] }[] = [
    { label: '挤奶机器人', value: 'milking_robot' },
    { label: '饲喂机器人', value: 'feed_robot' },
    { label: '温度传感器', value: 'temperature_sensor' },
    { label: '活动监测器', value: 'activity_monitor' },
    { label: '电子秤', value: 'scale' },
    { label: '自动门', value: 'gate' },
    { label: '摄像头', value: 'camera' },
    { label: '其他', value: 'other' }
  ]

  const safeRows = async <T,>(tableName: string): Promise<T[]> => {
    try {
      const rows = await databaseService.getTableDataAsync(tableName, { silent: true })
      return Array.isArray(rows) ? (rows as T[]) : []
    } catch {
      return []
    }
  }

  const safeMergedRows = async <T,>(...tableNames: string[]): Promise<T[]> => {
    const groups = await Promise.all(tableNames.map((tableName) => safeRows<T>(tableName)))
    const seen = new Set<string>()
    const rows: T[] = []
    groups.flat().forEach((row: any) => {
      const key =
        textValue(row?.id) ||
        textValue(row?.code) ||
        textValue(row?.deviceId, row?.device_id) ||
        textValue(row?.recordId, row?.record_id)
      const dedupeKey = key || JSON.stringify(row)
      if (seen.has(dedupeKey)) return
      seen.add(dedupeKey)
      rows.push(row)
    })
    return rows
  }

  const normalizePercent = (value: number | undefined) => {
    const safeValue = Number(value ?? 0)
    const percent = safeValue <= 1 ? safeValue * 100 : safeValue
    return Math.max(0, Math.min(100, Math.round(percent * 10) / 10))
  }

  const onlineDevices = computed(
    () => devices.value.filter((device) => device.status === 'online').length
  )
  const activeSyncs = computed(
    () => synchronizations.value.filter((sync) => isHealthySyncStatus(sync.status)).length
  )
  const failedSyncs = computed(
    () => synchronizations.value.filter((sync) => isFailedSyncStatus(sync.status)).length
  )
  const activeAlerts = computed(() =>
    hardwareAlerts.value.filter((alert) => alert.status === 'active')
  )
  const activeAssignments = computed(() =>
    assignmentRows.value
      .filter((assignment) => assignment.status === 'active' && !assignment.releasedAt)
      .sort(
        (left, right) =>
          getRecordTime(right.raw, ['assignedAt', 'assigned_at', 'createdAt', 'created_at']) -
          getRecordTime(left.raw, ['assignedAt', 'assigned_at', 'createdAt', 'created_at'])
      )
  )
  const assignmentHistory = computed(() =>
    assignmentRows.value
      .slice()
      .sort(
        (left, right) =>
          getRecordTime(right.raw, [
            'updatedAt',
            'updated_at',
            'releasedAt',
            'released_at',
            'assignedAt',
            'assigned_at'
          ]) -
          getRecordTime(left.raw, [
            'updatedAt',
            'updated_at',
            'releasedAt',
            'released_at',
            'assignedAt',
            'assigned_at'
          ])
      )
  )
  const assignableDevices = computed(() =>
    devices.value.filter(
      (device) =>
        device.type !== 'camera' ||
        device.capabilities.some((capability) =>
          ['temperature', 'activity', 'milk_volume'].includes(capability)
        )
    )
  )
  const milkingDevices = computed(() => devices.value.filter((device) => isMilkingDevice(device)))
  const onlineMilkingDevices = computed(
    () => milkingDevices.value.filter((device) => device.status === 'online').length
  )
  const milkingProtocolIds = computed(() => {
    const ids = new Set<string>()
    protocols.value.forEach((protocol) => {
      const text =
        `${protocol.name} ${protocol.description} ${protocol.type} ${protocol.supportedDevices.join(' ')}`.toLowerCase()
      if (
        text.includes('milk') ||
        text.includes('milking') ||
        text.includes('奶') ||
        text.includes('挤奶') ||
        protocol.supportedDevices.includes('milking_robot')
      ) {
        ids.add(protocol.id)
      }
    })
    return ids
  })
  const milkingSynchronizations = computed(() =>
    synchronizations.value.filter((sync) => isMilkingSync(sync))
  )
  const milkingAlerts = computed(() =>
    activeAlerts.value.filter((alert) => {
      const device = devices.value.find((item) => item.id === alert.deviceId)
      const text =
        `${alert.title} ${alert.description} ${alert.affectedSystems?.join(' ') ?? ''}`.toLowerCase()
      return (
        (device && isMilkingDevice(device)) ||
        text.includes('milk') ||
        text.includes('milking') ||
        text.includes('奶') ||
        text.includes('挤奶')
      )
    })
  )
  const criticalMilkingAlerts = computed(
    () =>
      milkingAlerts.value.filter((alert) => ['high', 'critical'].includes(alert.severity)).length
  )
  const criticalAlerts = computed(
    () => activeAlerts.value.filter((alert) => ['high', 'critical'].includes(alert.severity)).length
  )
  const pendingMaintenance = computed(() =>
    maintenanceRecords.value.filter((item) => !['completed', 'cancelled'].includes(item.status))
  )
  const latestCommandLogs = computed(() =>
    commandLogs.value
      .slice()
      .sort(
        (left, right) =>
          getRecordTime(right, ['requestedAt', 'requested_at', 'createdAt', 'created_at']) -
          getRecordTime(left, ['requestedAt', 'requested_at', 'createdAt', 'created_at'])
      )
      .slice(0, 5)
  )

  const averageSyncRate = computed(() => {
    if (!synchronizations.value.length) return 0
    const sum = synchronizations.value.reduce(
      (total, sync) => total + normalizePercent(sync.successRate),
      0
    )
    return sum / synchronizations.value.length
  })

  const averageMilkingSyncRate = computed(() => {
    if (!milkingSynchronizations.value.length) return 0
    const sum = milkingSynchronizations.value.reduce(
      (total, sync) => total + normalizePercent(sync.successRate),
      0
    )
    return sum / milkingSynchronizations.value.length
  })

  const failedMilkingSyncs = computed(() =>
    milkingSynchronizations.value.filter((sync) => isFailedSyncStatus(sync.status))
  )

  const milkingSyncText = computed(() => {
    if (!milkingSynchronizations.value.length) return '待接入'
    return `${averageMilkingSyncRate.value.toFixed(1)}%`
  })

  const milkingSyncNote = computed(() => {
    if (!milkingSynchronizations.value.length) return '业务库暂未返回奶厅 API/MQTT 同步任务'
    if (failedMilkingSyncs.value.length)
      return `${failedMilkingSyncs.value.length} 条奶厅同步任务错误`
    return `${milkingSynchronizations.value.length} 条奶厅同步任务运行可见`
  })

  const milkingSyncMetricTone = computed(() => {
    if (!milkingSynchronizations.value.length) return 'danger'
    if (failedMilkingSyncs.value.length || averageMilkingSyncRate.value < 90) return 'warning'
    return 'teal'
  })

  const milkVolumeMappings = computed<MilkVolumeMappingItem[]>(() =>
    milkingSynchronizations.value.flatMap((sync) => {
      const configuration = getSyncConfiguration(sync)
      const mapping = configuration.mapping || {}
      const entries = Object.entries(mapping)
      const relevantEntries = entries.length
        ? entries.filter(
            ([source, target]) => isMilkMappingField(source) || isMilkMappingField(String(target))
          )
        : []
      const rows = relevantEntries.length ? relevantEntries : entries

      return rows.map(([source, target], index) => ({
        id: `${sync.id}-${source}-${index}`,
        source,
        target: String(target),
        dataType: getDataTypeLabel(sync.dataType),
        filters: configuration.filters
          ? `过滤 ${Object.keys(configuration.filters).join(', ')}`
          : '无额外过滤',
        transformations: configuration.transformations?.length
          ? `转换 ${configuration.transformations.join(', ')}`
          : '直接落库',
        status: getSyncStatusLabel(sync.status),
        tagType: getSyncStatusTagType(sync.status)
      }))
    })
  )

  const milkVolumeMappingText = computed(() => {
    if (!milkVolumeMappings.value.length) return '待配置'
    return `${milkVolumeMappings.value.length} 项`
  })

  const milkVolumeMappingNote = computed(() => {
    if (!milkVolumeMappings.value.length)
      return '业务库暂未返回 milk_volume/cow_id/timestamp 字段映射'
    return '泌乳量、个体和时间字段映射已状态正常'
  })

  const milkVolumeMappingTone = computed(() =>
    milkVolumeMappings.value.length ? 'teal' : 'warning'
  )

  const latestSensorTime = computed(() => {
    const times = sensorRows.value
      .map((row) =>
        new Date(String(row.timestamp ?? row.createdAt ?? row.created_at ?? row.ts ?? '')).getTime()
      )
      .filter(Number.isFinite)
    if (!times.length) return null
    return Math.max(...times)
  })

  const telemetryAgeMinutes = computed(() => {
    if (!latestSensorTime.value) return null
    return Math.max(0, Math.round((Date.now() - latestSensorTime.value) / 60000))
  })

  const telemetryStale = computed(
    () => telemetryAgeMinutes.value === null || telemetryAgeMinutes.value > 120
  )

  const telemetryFreshnessText = computed(() => {
    if (telemetryAgeMinutes.value === null) return '未入库'
    if (telemetryAgeMinutes.value < 60) return `${telemetryAgeMinutes.value} 分钟`
    const hours = Math.round((telemetryAgeMinutes.value / 60) * 10) / 10
    return `${hours} 小时`
  })

  const telemetryFreshnessNote = computed(() => {
    if (telemetryAgeMinutes.value === null) return '没有传感器数据进入业务库'
    if (telemetryStale.value) return `超过 120 分钟阈值，需排查 MQTT/API 入库`
    return '最近传感器数据在新鲜度阈值内'
  })

  const healthScore = computed(() => {
    if (!devices.value.length) return 0
    const onlineRate = (onlineDevices.value / devices.value.length) * 100
    const alertPenalty = Math.min(32, activeAlerts.value.length * 8 + criticalAlerts.value * 8)
    const syncPenalty = Math.min(24, failedSyncs.value * 12)
    const telemetryPenalty = telemetryStale.value ? 36 : 0
    return Math.max(0, Math.round(onlineRate - alertPenalty - syncPenalty - telemetryPenalty))
  })

  const healthScoreText = computed(() => {
    if (!devices.value.length) return '待接入'
    if (telemetryAgeMinutes.value === null) return '未入库'
    if (telemetryStale.value) return '同步阻塞'
    if (healthScore.value >= 88) return `${healthScore.value}% 稳定`
    if (healthScore.value >= 68) return `${healthScore.value}% 需关注`
    return `${healthScore.value}% 待处置`
  })

  const linkNodes = computed(() => [
    {
      label: '设备接入',
      value: `${onlineDevices.value}/${devices.value.length}`,
      note: devices.value.length ? '设备档案和在线状态正常' : '还没有设备档案',
      icon: 'ri:base-station-line',
      tone:
        onlineDevices.value === devices.value.length && devices.value.length ? 'stable' : 'warning'
    },
    {
      label: '协议层',
      value: protocols.value.length,
      note: `${protocols.value.filter((item) => item.isActive).length} 个协议启用`,
      icon: 'ri:git-branch-line',
      tone: protocols.value.length ? 'stable' : 'warning'
    },
    {
      label: '遥测入库',
      value: telemetryFreshnessText.value,
      note: telemetryFreshnessNote.value,
      icon: 'ri:database-2-line',
      tone: telemetryStale.value ? 'danger' : 'stable'
    },
    {
      label: '同步路径',
      value: `${averageSyncRate.value.toFixed(1)}%`,
      note: failedSyncs.value
        ? `${failedSyncs.value} 个任务错误`
        : `${activeSyncs.value} 个任务可用`,
      icon: 'ri:swap-2-line',
      tone: failedSyncs.value ? 'danger' : 'stable'
    },
    {
      label: '预警池',
      value: activeAlerts.value.length,
      note: criticalAlerts.value ? `${criticalAlerts.value} 条高危需要确认` : '无高危硬件预警',
      icon: 'ri:alarm-warning-line',
      tone: activeAlerts.value.length ? 'danger' : 'stable'
    }
  ])

  const filteredDevices = computed(() => {
    const keyword = deviceFilter.keyword.trim().toLowerCase()
    return devices.value.filter((device) => {
      if (deviceFilter.type && device.type !== deviceFilter.type) return false
      if (deviceFilter.status && device.status !== deviceFilter.status) return false
      if (!keyword) return true
      return [device.name, device.brand, device.model, device.serialNumber].some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(keyword)
      )
    })
  })
  const {
    containerRef: deviceGridContainerRef,
    visibleItems: visibleDevices,
    loadMore: loadMoreDevices,
    handleScroll: onDeviceGridScroll,
    handleWheel: onDeviceGridWheel
  } = useLazyGridRenderWindow(filteredDevices, {
    rowCount: 2,
    minItemWidth: 260,
    gap: 12,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })

  const workQueue = computed<QueueItem[]>(() => {
    const alertItems = activeAlerts.value
      .slice()
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
      .slice(0, 3)
      .map(
        (alert) =>
          ({
            id: `alert-${alert.id}`,
            kind: '硬件预警',
            title: alert.title,
            description: `${getDeviceName(alert.deviceId)} · ${alert.description}`,
            level: getSeverityLabel(alert.severity),
            tagType: getSeverityTagType(alert.severity),
            tone: severityRank(alert.severity) >= 3 ? 'danger' : 'warning'
          }) as QueueItem
      )

    const syncItems = synchronizations.value
      .filter((sync) => isFailedSyncStatus(sync.status))
      .slice(0, 2)
      .map(
        (sync) =>
          ({
            id: `sync-${sync.id}`,
            kind: '同步错误',
            title: `${sync.sourceDevice} → ${sync.targetSystem}`,
            description: `${sync.dataType} 同步失败，已累计 ${sync.errorCount} 次错误。`,
            level: '待诊断',
            tagType: 'danger',
            tone: 'danger'
          }) as QueueItem
      )

    const telemetryItems = telemetryStale.value
      ? [
          {
            id: 'telemetry-stale',
            kind: '同步阻塞',
            title:
              telemetryAgeMinutes.value === null
                ? '传感器数据尚未入库'
                : `传感器数据停滞 ${telemetryFreshnessText.value}`,
            description: '设备入库链路异常。',
            level: '需排查',
            tagType: 'danger',
            tone: 'danger'
          } as QueueItem
        ]
      : []

    const offlineItems = devices.value
      .filter((device) => ['offline', 'error'].includes(device.status))
      .slice(0, 2)
      .map(
        (device) =>
          ({
            id: `device-${device.id}`,
            kind: '设备离线',
            title: device.name,
            description: `${getDeviceTypeLabel(device.type)} 最后上报 ${formatRelative(device.lastSeen)}。`,
            level: getDeviceStatusLabel(device.status),
            tagType: getDeviceStatusTagType(device.status),
            tone: device.status === 'error' ? 'danger' : 'warning'
          }) as QueueItem
      )

    return [...telemetryItems, ...alertItems, ...syncItems, ...offlineItems].slice(0, 6)
  })

  const milkingWorkQueue = computed<QueueItem[]>(() => {
    const missingDeviceItems = !milkingDevices.value.length
      ? [
          {
            id: 'milking-no-device',
            kind: '奶厅设备',
            title: '奶厅设备档案待补齐',
            description: '暂无奶厅设备档案。',
            level: '待接入',
            tagType: 'danger',
            tone: 'danger'
          } as QueueItem
        ]
      : []

    const offlineDeviceItems = milkingDevices.value
      .filter((device) => ['offline', 'error'].includes(device.status))
      .slice(0, 2)
      .map(
        (device) =>
          ({
            id: `milking-device-${device.id}`,
            kind: '奶厅设备',
            title: device.name,
            description: `${getDeviceTypeLabel(device.type)} 最后上报 ${formatRelative(device.lastSeen)}。`,
            level: getDeviceStatusLabel(device.status),
            tagType: getDeviceStatusTagType(device.status),
            tone: device.status === 'error' ? 'danger' : 'warning'
          }) as QueueItem
      )

    const missingSyncItems = !milkingSynchronizations.value.length
      ? [
          {
            id: 'milking-no-sync',
            kind: '奶厅同步',
            title: '奶厅同步链路待接入',
            description: '暂无奶厅同步任务。',
            level: '待接入',
            tagType: 'danger',
            tone: 'danger'
          } as QueueItem
        ]
      : []

    const syncErrorItems = failedMilkingSyncs.value.slice(0, 3).map(
      (sync) =>
        ({
          id: `milking-sync-${sync.id}`,
          kind: '同步错误',
          title: `${getMilkingSyncSource(sync)} → ${getTargetSystemLabel(sync.targetSystem)}`,
          description: `${getDataTypeLabel(sync.dataType)} 同步失败，错误次数 ${sync.errorCount}。`,
          level: '待诊断',
          tagType: 'danger',
          tone: 'danger'
        }) as QueueItem
    )

    const mappingItems = !milkVolumeMappings.value.length
      ? [
          {
            id: 'milking-no-mapping',
            kind: '泌乳量映射',
            title: 'milk_volume 字段映射未完成',
            description: '暂无 milk_volume 字段映射。',
            level: '待配置',
            tagType: 'warning',
            tone: 'warning'
          } as QueueItem
        ]
      : []

    const alertItems = milkingAlerts.value
      .slice()
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
      .slice(0, 2)
      .map(
        (alert) =>
          ({
            id: `milking-alert-${alert.id}`,
            kind: '奶厅预警',
            title: alert.title,
            description: `${getDeviceName(alert.deviceId)} · ${alert.description}`,
            level: getSeverityLabel(alert.severity),
            tagType: getSeverityTagType(alert.severity),
            tone: severityRank(alert.severity) >= 3 ? 'danger' : 'warning'
          }) as QueueItem
      )

    return [
      ...missingDeviceItems,
      ...offlineDeviceItems,
      ...missingSyncItems,
      ...syncErrorItems,
      ...mappingItems,
      ...alertItems
    ].slice(0, 7)
  })

  const severityRank = (severity: HardwareAlert['severity']) => {
    const ranks: Record<HardwareAlert['severity'], number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4
    }
    return ranks[severity]
  }

  const getDeviceName = (deviceId: string) =>
    devices.value.find((device) => device.id === deviceId)?.name || deviceId || '未知设备'

  const getRecordTime = (row: Record<string, unknown>, keys: string[]) => {
    const value = keys.map((key) => row[key]).find(Boolean)
    const time = new Date(String(value || '')).getTime()
    return Number.isFinite(time) ? time : 0
  }

  const textValue = (...values: unknown[]) =>
    values.map((value) => String(value ?? '').trim()).find(Boolean) || ''

  const parsePayload = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {}
      } catch {
        return {}
      }
    }
    return {}
  }

  const normalizeCowOptions = (
    cows: Record<string, unknown>[],
    animals: Record<string, unknown>[]
  ): CowOption[] => {
    const byId = new Map<string, CowOption>()
    cows.forEach((row) => {
      const id = textValue(row.id, row.cowId, row.cow_id)
      if (!id) return
      byId.set(id, {
        id,
        animalId: id,
        cowNumber: textValue(row.cowNumber, row.cow_number, row.animalNumber, row.animal_number),
        earTagNumber: textValue(
          row.earTagNumber,
          row.ear_tag_number,
          row.electronicTag,
          row.electronic_tag
        ),
        currentPen: textValue(row.currentPen, row.current_pen, row.currentPenId, row.current_pen_id)
      })
    })
    animals.forEach((row) => {
      const animalId = textValue(row.id, row.animalId, row.animal_id)
      const cowNumber = textValue(
        row.cowNumber,
        row.cow_number,
        row.animalNumber,
        row.animal_number
      )
      const existing = Array.from(byId.values()).find(
        (cow) => cow.id === animalId || (cowNumber && cow.cowNumber === cowNumber)
      )
      const id = existing?.id || animalId
      if (!id) return
      byId.set(id, {
        id,
        animalId,
        cowNumber: cowNumber || existing?.cowNumber || id,
        earTagNumber: textValue(
          row.earTagNumber,
          row.ear_tag_number,
          row.electronicTag,
          row.electronic_tag,
          existing?.earTagNumber
        ),
        currentPen: textValue(
          row.currentPen,
          row.current_pen,
          row.currentPenId,
          row.current_pen_id,
          row.currentUnitId,
          row.current_unit_id,
          existing?.currentPen
        )
      })
    })
    return Array.from(byId.values()).sort((left, right) =>
      left.cowNumber.localeCompare(right.cowNumber, 'zh-CN')
    )
  }

  const normalizeAssignmentRow = (row: Record<string, unknown>): AssignmentRow => {
    const status = textValue(row.status).toLowerCase()
    const releasedAt = textValue(row.releasedAt, row.released_at)
    const cowId = textValue(row.cowId, row.cow_id, row.animalId, row.animal_id)
    return {
      id: textValue(row.id),
      cowId,
      animalId: textValue(row.animalId, row.animal_id, cowId),
      cowNumber: textValue(row.cowNumber, row.cow_number),
      deviceId: textValue(row.deviceId, row.device_id),
      channelId: textValue(row.channelId, row.channel_id),
      assignedAt: textValue(row.assignedAt, row.assigned_at, row.createdAt, row.created_at),
      releasedAt,
      reason: textValue(row.assignmentReason, row.assignment_reason, row.reason, row.notes),
      status: !releasedAt && (!status || status === 'active') ? 'active' : 'released',
      raw: row
    }
  }

  const normalizeHardwareDeviceRows = (
    hardwareRows: HardwareDevice[],
    deviceRows: Record<string, unknown>[]
  ): HardwareDevice[] => {
    const map = new Map<string, HardwareDevice>()
    hardwareRows.forEach((device) => map.set(device.id, device))
    deviceRows.forEach((row) => {
      const id = textValue(row.id, row.deviceId, row.device_id, row.code)
      if (!id || map.has(id)) return
      const locationPayload = parsePayload(row.location)
      map.set(id, {
        id,
        name: textValue(row.name, row.deviceName, row.device_name, row.code, id),
        type: normalizeDeviceType(textValue(row.type, row.deviceType, row.device_type)),
        brand: textValue(row.brand, row.vendor, row.manufacturer),
        model: textValue(row.model, row.modelNo, row.model_no),
        serialNumber: textValue(row.serialNumber, row.serial_number, row.code, id),
        location: {
          penId: textValue(
            row.unitId,
            row.unit_id,
            row.penId,
            row.pen_id,
            locationPayload.penId,
            locationPayload.pen_id
          ),
          penName: textValue(
            row.unitName,
            row.unit_name,
            row.penName,
            row.pen_name,
            locationPayload.penName,
            locationPayload.pen_name
          )
        },
        status: normalizeDeviceStatus(textValue(row.status)),
        lastSeen: textValue(
          row.lastSeen,
          row.last_seen,
          row.updatedAt,
          row.updated_at,
          row.createdAt,
          row.created_at
        ),
        firmwareVersion: textValue(row.firmwareVersion, row.firmware_version),
        capabilities: normalizeCapabilities(row)
      } as HardwareDevice)
    })
    return Array.from(map.values())
  }

  const normalizeDeviceType = (value: string): HardwareDevice['type'] => {
    const text = value.toLowerCase()
    if (/milk|milking|挤奶|奶厅/.test(text)) return 'milking_robot'
    if (/feed|饲喂|tmr/.test(text)) return 'feed_robot'
    if (/activity|collar|活动|项圈|耳标/.test(text)) return 'activity_monitor'
    if (/temp|temperature|体温|温度/.test(text)) return 'temperature_sensor'
    if (/scale|weight|称|秤/.test(text)) return 'scale'
    if (/gate|门/.test(text)) return 'gate'
    if (/camera|video|摄像/.test(text)) return 'camera'
    return 'other'
  }

  const normalizeDeviceStatus = (value: string): HardwareDevice['status'] => {
    const text = value.toLowerCase()
    if (/error|fault|故障/.test(text)) return 'error'
    if (/maint|维修|维护/.test(text)) return 'maintenance'
    if (/offline|离线|停用/.test(text)) return 'offline'
    return 'online'
  }

  const normalizeCapabilities = (row: Record<string, unknown>) => {
    const raw = row.capabilities ?? row.capability ?? parsePayload(row.configuration).capabilities
    if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
    const text =
      `${textValue(raw)} ${textValue(row.name, row.deviceName, row.device_name)} ${textValue(row.type, row.deviceType, row.device_type)}`.toLowerCase()
    const capabilities: string[] = []
    if (/temp|temperature|体温|温度|耳温/.test(text)) capabilities.push('temperature')
    if (/activity|step|步数|活动|项圈|耳标/.test(text)) capabilities.push('activity')
    if (/milk|奶|泌乳/.test(text)) capabilities.push('milk_volume')
    return capabilities
  }

  const getCowName = (cowId: string) => {
    const cow = cowOptions.value.find((item) => item.id === cowId || item.animalId === cowId)
    return cow ? `牛号 ${cow.cowNumber || cow.id}` : cowId || '未知牛只'
  }

  const getCowOptionLabel = (cow: CowOption) =>
    `牛号 ${cow.cowNumber || cow.id}${cow.earTagNumber ? ` · 耳标 ${cow.earTagNumber}` : ''}${cow.currentPen ? ` · ${cow.currentPen}` : ''}`

  const createAssignmentId = (deviceId: string, cowId: string, timestamp: string) =>
    `ada-${deviceId}-${cowId}-${timestamp.replace(/[^0-9]/g, '').slice(0, 17)}`

  const selectedCowOption = () =>
    cowOptions.value.find(
      (cow) => cow.id === assignmentForm.cowId || cow.animalId === assignmentForm.cowId
    )

  const activeAssignmentsFor = (deviceId: string, cowId = '') =>
    activeAssignments.value.filter((assignment) => {
      const cow = cowOptions.value.find((item) => item.id === cowId || item.animalId === cowId)
      const cowKeys = [cowId, cow?.id, cow?.animalId].filter(Boolean)
      return (
        assignment.deviceId === deviceId ||
        (cowKeys.length &&
          cowKeys.some((key) => [assignment.cowId, assignment.animalId].includes(String(key))))
      )
    })

  const releaseAssignment = async (
    assignment: AssignmentRow,
    releasedAt: string,
    reason: string
  ) => {
    await databaseService.updateTableRecordAsync('animal_device_assignment', assignment.id, {
      ...assignment.raw,
      releasedAt,
      released_at: releasedAt,
      status: 'released',
      assignmentReason: reason || assignment.reason || 'manual_release',
      assignment_reason: reason || assignment.reason || 'manual_release',
      updatedAt: releasedAt,
      updated_at: releasedAt
    })
  }

  const getDeviceStatusLabel = (status: HardwareDevice['status']) => {
    const labels: Record<HardwareDevice['status'], string> = {
      online: '在线',
      offline: '离线',
      maintenance: '维护中',
      error: '故障'
    }
    return labels[status]
  }

  const getDeviceStatusTagType = (status: HardwareDevice['status']): TagType => {
    const types: Record<HardwareDevice['status'], TagType> = {
      online: 'success',
      offline: 'info',
      maintenance: 'warning',
      error: 'danger'
    }
    return types[status]
  }

  const getDeviceTypeLabel = (type: HardwareDevice['type']) =>
    deviceTypes.find((item) => item.value === type)?.label || type

  const getCapabilityLabel = (capability: string) => {
    const labels: Record<string, string> = {
      temperature: '温度监测',
      activity: '活动监测',
      weight: '重量测量',
      milk_volume: '奶量测量',
      feed_consumption: '饲料消耗',
      gate_access: '门禁控制',
      image_capture: '图像采集'
    }
    return labels[capability] || capability
  }

  const getMilkingCapabilityText = (device: HardwareDevice) => {
    const capabilities = device.capabilities.filter(
      (capability) =>
        ['milk_volume', 'temperature'].includes(capability) ||
        capability.toLowerCase().includes('milk')
    )
    return capabilities.length ? capabilities.map(getCapabilityLabel).join(' / ') : '待补齐奶厅能力'
  }

  const getMilkingSyncSource = (sync: DataSynchronization) => {
    const device = devices.value.find((item) => item.id === sync.sourceDevice)
    if (device) return device.name
    return sync.sourceDevice || '奶厅设备'
  }

  const getTargetSystemLabel = (targetSystem: string) => {
    const labels: Record<string, string> = {
      milk_production_db: '奶厅泌乳记录库',
      cattle_management: '犇牛育种业务库',
      milk_records: '泌乳记录表',
      lactation_db: '泌乳数据仓'
    }
    return labels[targetSystem] || targetSystem || '目标系统'
  }

  const getDataTypeLabel = (dataType: string) => {
    const labels: Record<string, string> = {
      milk_volume: '泌乳量',
      milk_records: '班次泌乳记录',
      sensor_status: '泌乳传感器状态',
      milk_quality: '奶质',
      temperature: '温度',
      activity: '活动',
      feed_consumption: '采食量'
    }
    return labels[dataType] || dataType
  }

  const isMilkingDevice = (device: HardwareDevice) => {
    const text =
      `${device.name} ${device.type} ${device.location?.penName ?? ''} ${device.capabilities.join(' ')}`.toLowerCase()
    return (
      device.type === 'milking_robot' ||
      device.capabilities.includes('milk_volume') ||
      text.includes('milk') ||
      text.includes('milking') ||
      text.includes('挤奶') ||
      text.includes('奶厅')
    )
  }

  const isMilkingSync = (sync: DataSynchronization) => {
    const text =
      `${sync.sourceDevice} ${sync.targetSystem} ${sync.dataType} ${JSON.stringify(getSyncConfiguration(sync))}`.toLowerCase()
    return (
      text.includes('milk') ||
      text.includes('milking') ||
      text.includes('奶') ||
      text.includes('milk_volume') ||
      milkingProtocolIds.value.has(
        String((sync as unknown as Record<string, unknown>).protocolId ?? '')
      )
    )
  }

  const getSyncConfiguration = (sync: DataSynchronization): SyncConfiguration => {
    const raw = sync.configuration ?? sync.configurationJson ?? sync.configuration_json ?? {}
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : { mapping: {} }
      } catch {
        return { mapping: {} }
      }
    }
    return raw && typeof raw === 'object' ? { mapping: {}, ...raw } : { mapping: {} }
  }

  const isMilkMappingField = (field: string) => {
    const normalized = field.toLowerCase()
    return (
      normalized.includes('milk') ||
      normalized.includes('yield') ||
      normalized.includes('cow') ||
      normalized.includes('animal') ||
      normalized.includes('time') ||
      normalized.includes('date') ||
      normalized.includes('奶') ||
      normalized.includes('泌乳')
    )
  }

  const isHealthySyncStatus = (status: DataSynchronization['status']) =>
    ['active', 'running', 'completed', 'success', 'idle', 'scheduled'].includes(
      String(status || '').toLowerCase()
    )

  const isFailedSyncStatus = (status: DataSynchronization['status']) =>
    ['error', 'failed', 'failure'].includes(String(status || '').toLowerCase())

  const getProtocolTypeLabel = (type: IntegrationProtocol['type']) => {
    const labels: Record<IntegrationProtocol['type'], string> = {
      api: 'API',
      mqtt: 'MQTT',
      modbus: 'Modbus',
      opc_ua: 'OPC UA',
      custom: '自定义'
    }
    return labels[type]
  }

  const getFrequencyLabel = (frequency: DataSynchronization['syncFrequency']) => {
    const labels: Record<string, string> = {
      'real-time': '实时',
      realtime: '实时',
      per_shift: '每班次',
      hourly: '每小时',
      daily: '每日',
      weekly: '每周'
    }
    return labels[frequency] || frequency || '按任务'
  }

  const getSyncStatusLabel = (status: DataSynchronization['status']) => {
    const labels: Record<string, string> = {
      active: '运行中',
      running: '运行中',
      completed: '已完成',
      paused: '已暂停',
      error: '错误'
    }
    return labels[status] || status || '未知'
  }

  const getSyncStatusTagType = (status: DataSynchronization['status']): TagType => {
    const types: Record<string, TagType> = {
      active: 'success',
      running: 'success',
      completed: 'success',
      paused: 'warning',
      error: 'danger'
    }
    return types[status] || 'info'
  }

  const getSeverityLabel = (severity: HardwareAlert['severity']) => {
    const labels: Record<HardwareAlert['severity'], string> = {
      low: '低',
      medium: '中',
      high: '高',
      critical: '紧急'
    }
    return labels[severity]
  }

  const getSeverityTagType = (severity: HardwareAlert['severity']): TagType => {
    const types: Record<HardwareAlert['severity'], TagType> = {
      low: 'info',
      medium: 'warning',
      high: 'danger',
      critical: 'danger'
    }
    return types[severity]
  }

  const getAlertTypeLabel = (type: HardwareAlert['type']) => {
    const labels: Record<HardwareAlert['type'], string> = {
      connectivity: '连接',
      performance: '性能',
      maintenance: '维护',
      calibration: '校准',
      power: '电源',
      sensor: '传感器',
      other: '其他'
    }
    return labels[type]
  }

  const getMaintenanceTypeLabel = (type: DeviceMaintenance['type']) => {
    const labels: Record<DeviceMaintenance['type'], string> = {
      preventive: '预防性',
      corrective: '纠正性',
      predictive: '预测性'
    }
    return labels[type]
  }

  const getMaintenanceStatusLabel = (status: DeviceMaintenance['status']) => {
    const labels: Record<DeviceMaintenance['status'], string> = {
      scheduled: '已计划',
      in_progress: '进行中',
      completed: '已完成',
      cancelled: '已取消'
    }
    return labels[status]
  }

  const getMaintenanceStatusTagType = (status: DeviceMaintenance['status']): TagType => {
    const types: Record<DeviceMaintenance['status'], TagType> = {
      scheduled: 'info',
      in_progress: 'warning',
      completed: 'success',
      cancelled: 'danger'
    }
    return types[status]
  }

  const getCommandTypeLabel = (command: Record<string, unknown>) => {
    const type = String(command.commandType ?? command.command_type ?? 'control')
    const labels: Record<string, string> = {
      sync_now: '立即同步',
      control_check: '控制自检',
      parlor_sync: '奶厅同步',
      control: '控制命令'
    }
    return labels[type] || type
  }

  const getCommandStatusLabel = (command: Record<string, unknown>) => {
    const status = String(command.status || '').toLowerCase()
    const labels: Record<string, string> = {
      queued: '已排队',
      sent: '已下发',
      executed: '已执行',
      acknowledged: '已确认',
      completed: '已完成',
      failed: '失败'
    }
    return labels[status] || status || '未知'
  }

  const getCommandStatusTagType = (command: Record<string, unknown>): TagType => {
    const status = String(command.status || '').toLowerCase()
    if (['acknowledged', 'completed', 'executed', 'sent'].includes(status)) return 'success'
    if (status === 'queued') return 'warning'
    if (status === 'failed') return 'danger'
    return 'info'
  }

  const formatDate = (value: string) => {
    return formatDateOnly(value, '-')
  }

  const formatDateTime = (value: string) => {
    return formatDateOnly(value, '-')
  }

  const formatRelative = (value: string) => {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return '暂无记录'
    const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000))
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes} 分钟前`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours} 小时前`
    return `${Math.round(hours / 24)} 天前`
  }

  const loadData = async () => {
    loading.value = true
    try {
      const [
        hardwareDeviceRows,
        v2DeviceRows,
        protocolRows,
        syncRows,
        alertRows,
        maintenanceRows,
        sensorDataRows,
        commandRows,
        cowRows,
        animalRows,
        assignmentRawRows
      ] = await Promise.all([
        safeMergedRows<HardwareDevice>('hardware-devices', 'hardware_devices'),
        safeRows<Record<string, unknown>>('device'),
        safeMergedRows<IntegrationProtocol>('integration-protocols', 'integration_protocols'),
        safeMergedRows<DataSynchronization>('data-synchronizations', 'data_synchronizations'),
        safeMergedRows<HardwareAlert>('hardware-alerts', 'hardware_alerts'),
        safeMergedRows<DeviceMaintenance>('device-maintenance', 'device_maintenance'),
        safeMergedRows<Record<string, unknown>>('sensors', 'sensor_reading', 'sensor-readings'),
        safeMergedRows<Record<string, unknown>>('hardware-command-logs', 'hardware_command_logs'),
        safeRows<Record<string, unknown>>('cows'),
        safeRows<Record<string, unknown>>('animal'),
        safeRows<Record<string, unknown>>('animal_device_assignment')
      ])

      devices.value = normalizeHardwareDeviceRows(hardwareDeviceRows, v2DeviceRows)
      cowOptions.value = normalizeCowOptions(cowRows, animalRows)
      assignmentRows.value = assignmentRawRows
        .map(normalizeAssignmentRow)
        .filter((row) => row.id && row.deviceId && row.cowId)
      protocols.value = protocolRows
      synchronizations.value = syncRows
      hardwareAlerts.value = alertRows
      maintenanceRecords.value = maintenanceRows
      sensorRows.value = sensorDataRows
      commandLogs.value = commandRows
    } finally {
      loading.value = false
    }
  }

  const runDiagnostics = async () => {
    try {
      const response = await hardwareApi.runSystemDiagnostics()
      if (response.code === 200) {
        ElMessage.success('系统诊断已启动，控制台会继续跟踪设备连接')
      }
    } catch (error) {
      ElMessage.error('启动诊断失败')
      console.error(error)
    }
  }

  const resetRegisterDeviceForm = () => {
    registerDeviceForm.name = ''
    registerDeviceForm.type = 'temperature_sensor'
    registerDeviceForm.brand = ''
    registerDeviceForm.model = ''
    registerDeviceForm.serialNumber = ''
    registerDeviceForm.penName = ''
    registerDeviceForm.operator = '设备管理员'
    registerDeviceForm.connectionNote = ''
  }

  const resetAssignmentForm = () => {
    assignmentForm.deviceId = ''
    assignmentForm.cowId = ''
    assignmentForm.reason = '现场设备绑定'
  }

  const writeDeviceAssignment = async (mode: 'bind' | 'rebind') => {
    const deviceId = assignmentForm.deviceId
    const cow = selectedCowOption()
    if (!deviceId || !cow) {
      ElMessage.warning('请先选择设备和牛只')
      return
    }

    const now = new Date().toISOString()
    assignmentSaving.value = true
    try {
      const reason =
        assignmentForm.reason.trim() || (mode === 'rebind' ? 'manual_rebind' : 'manual_bind')
      const conflicts = activeAssignmentsFor(deviceId, cow.id)
      for (const assignment of conflicts) {
        await releaseAssignment(
          assignment,
          now,
          mode === 'rebind' ? `换绑关闭：${reason}` : `新绑定关闭旧记录：${reason}`
        )
      }
      await databaseService.addTableDataAsync('animal_device_assignment', {
        id: createAssignmentId(deviceId, cow.animalId || cow.id, now),
        deviceId,
        device_id: deviceId,
        animalId: cow.animalId || cow.id,
        animal_id: cow.animalId || cow.id,
        cowId: cow.id,
        cow_id: cow.id,
        cowNumber: cow.cowNumber,
        cow_number: cow.cowNumber,
        assignedAt: now,
        assigned_at: now,
        releasedAt: '',
        released_at: '',
        assignmentReason: reason,
        assignment_reason: reason,
        status: 'active',
        sourceType: mode === 'rebind' ? 'manual_rebind' : 'manual_bind',
        source_type: mode === 'rebind' ? 'manual_rebind' : 'manual_bind',
        createdAt: now,
        created_at: now,
        updatedAt: now,
        updated_at: now
      })
      ElMessage.success(mode === 'rebind' ? '设备换绑已写入历史' : '设备绑定已写入历史')
      resetAssignmentForm()
      await loadData()
    } catch (error) {
      ElMessage.error(mode === 'rebind' ? '设备换绑失败' : '设备绑定失败')
      console.error(error)
    } finally {
      assignmentSaving.value = false
    }
  }

  const bindSelectedDevice = () => writeDeviceAssignment('bind')

  const rebindSelectedDevice = () => writeDeviceAssignment('rebind')

  const unbindAssignment = async (assignment: AssignmentRow) => {
    const now = new Date().toISOString()
    assignmentSaving.value = true
    try {
      await releaseAssignment(assignment, now, assignmentForm.reason.trim() || 'manual_unbind')
      ElMessage.success('设备解绑已保留历史')
      await loadData()
    } catch (error) {
      ElMessage.error('设备解绑失败')
      console.error(error)
    } finally {
      assignmentSaving.value = false
    }
  }

  const unbindSelectedDevice = async () => {
    if (!assignmentForm.deviceId && !assignmentForm.cowId) {
      ElMessage.warning('请选择要解绑的设备或牛只')
      return
    }
    const targets = activeAssignmentsFor(assignmentForm.deviceId, assignmentForm.cowId)
    if (!targets.length) {
      ElMessage.info('当前没有匹配的活跃绑定')
      return
    }
    const now = new Date().toISOString()
    assignmentSaving.value = true
    try {
      for (const assignment of targets) {
        await releaseAssignment(assignment, now, assignmentForm.reason.trim() || 'manual_unbind')
      }
      ElMessage.success(`已解绑 ${targets.length} 条设备绑定`)
      resetAssignmentForm()
      await loadData()
    } catch (error) {
      ElMessage.error('设备解绑失败')
      console.error(error)
    } finally {
      assignmentSaving.value = false
    }
  }

  const prefillAssignment = (assignment: AssignmentRow) => {
    assignmentForm.deviceId = assignment.deviceId
    assignmentForm.cowId = assignment.cowId
    assignmentForm.reason = `换绑自 ${getCowName(assignment.cowId)}`
  }

  const handleRegisterDevice = async () => {
    if (!registerDeviceFormRef.value) return

    try {
      await registerDeviceFormRef.value.validate()
    } catch {
      return
    }

    registering.value = true
    try {
      const response = await hardwareApi.registerHardwareDevice({
        name: registerDeviceForm.name.trim(),
        type: registerDeviceForm.type,
        brand: registerDeviceForm.brand.trim(),
        model: registerDeviceForm.model.trim(),
        serialNumber: registerDeviceForm.serialNumber.trim(),
        location: { penId: '', penName: registerDeviceForm.penName.trim() },
        status: 'offline',
        lastSeen: new Date().toISOString(),
        firmwareVersion: '1.0.0',
        capabilities: [],
        configuration: {
          operator: registerDeviceForm.operator.trim(),
          connectionNote: registerDeviceForm.connectionNote.trim(),
          registeredAt: new Date().toISOString()
        }
      })

      if (response.code === 200) {
        ElMessage.success('设备注册成功')
        registerDeviceDialogVisible.value = false
        resetRegisterDeviceForm()
        await loadData()
      }
    } catch (error) {
      ElMessage.error('设备注册失败')
      console.error(error)
    } finally {
      registering.value = false
    }
  }

  const viewDeviceDetail = (device: HardwareDevice) => {
    ElMessage.info(`${device.name} 详情将进入设备侧边检查面板`)
  }

  const getDeviceCowIds = (device: HardwareDevice) => {
    const deviceRecord = device as unknown as Record<string, unknown>
    const configuredCowIds = deviceRecord.cowIds ?? deviceRecord.cow_ids
    if (Array.isArray(configuredCowIds) && configuredCowIds.length) {
      return Array.from(new Set(configuredCowIds.map(String).filter(Boolean))).slice(0, 30)
    }

    const textTokens = [
      device.id,
      device.name,
      device.serialNumber,
      device.location?.penId,
      device.location?.penName
    ]
      .map((item) => String(item || '').toLowerCase())
      .filter(Boolean)
    const matchedCowIds = sensorRows.value
      .filter((row) => {
        const text = JSON.stringify(row || {}).toLowerCase()
        return textTokens.some((token) => text.includes(token))
      })
      .map((row) => row.cowId ?? row.cow_id)
      .filter(Boolean)
      .map(String)

    if (matchedCowIds.length) return Array.from(new Set(matchedCowIds)).slice(0, 30)

    return sensorRows.value
      .map((row) => row.cowId ?? row.cow_id)
      .filter(Boolean)
      .map(String)
      .filter((value, index, rows) => rows.indexOf(value) === index)
      .slice(0, 30)
  }

  const sendDeviceCommand = async (device: HardwareDevice) => {
    const commandType = isMilkingDevice(device) ? 'parlor_sync' : 'control_check'
    const synchronizationIds = synchronizations.value
      .filter((sync) => sync.sourceDevice === device.id || isMilkingSync(sync))
      .map((sync) => sync.id)
      .slice(0, 10)
    const cowIds = getDeviceCowIds(device)

    try {
      const response = await hardwareApi.sendDeviceCommand(device.id, {
        type: commandType,
        priority: device.status === 'error' ? 'high' : 'normal',
        cowIds,
        synchronizationIds,
        parameters: {
          deviceName: device.name,
          deviceType: device.type,
          location: device.location,
          capabilities: device.capabilities,
          requestedBy: '设备管理员',
          requestedAt: new Date().toISOString()
        }
      })

      if (response.code === 200) {
        ElMessage.success(`${device.name} 控制命令已下发并写入审计`)
        await loadData()
      }
    } catch (error) {
      ElMessage.error('设备命令下发失败')
      console.error(error)
    }
  }

  const triggerSync = async (sync: DataSynchronization) => {
    try {
      const response = await hardwareApi.triggerDataSynchronization(sync.id)
      if (response.code === 200) {
        ElMessage.success('同步任务已启动')
        await loadData()
      }
    } catch (error) {
      ElMessage.error('启动同步失败')
      console.error(error)
    }
  }

  const acknowledgeAlert = async (alert: HardwareAlert) => {
    try {
      const response = await hardwareApi.acknowledgeHardwareAlert(alert.id)
      if (response.code === 200) {
        ElMessage.success('预警已确认')
        await loadData()
      }
    } catch (error) {
      ElMessage.error('确认失败')
      console.error(error)
    }
  }

  onMounted(loadData)
</script>

<style scoped lang="scss">
  .fc-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }

  .hardware-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 0.5fr);
    gap: 18px;
  }

  .hardware-layout.is-device-first {
    grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.55fr);
    align-items: start;
  }

  .link-map {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
    gap: 12px;
  }

  .link-node {
    min-height: 170px;
    padding: 15px;
    background: rgb(255 255 255 / 42%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .link-icon {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    margin-bottom: 16px;
    color: var(--fluent-primary);
    background: rgb(var(--fluent-primary-rgb) / 10%);
    border-radius: var(--fluent-radius);
  }

  .link-node.danger .link-icon {
    color: var(--fluent-danger);
    background: rgb(209 52 56 / 10%);
  }

  .link-node.warning .link-icon {
    color: var(--fluent-amber);
    background: rgb(245 165 36 / 12%);
  }

  .milking-device-grid,
  .parlor-sync-stack,
  .mapping-board {
    display: grid;
    gap: 12px;
  }

  .milking-device-grid {
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }

  .milking-device-card,
  .parlor-sync-item,
  .mapping-card {
    padding: 15px;
    background: var(--fluent-surface, #fff);
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .milking-device-card.is-offline,
  .parlor-sync-item.paused {
    border-left-color: var(--fluent-amber);
  }

  .milking-device-card.is-error,
  .parlor-sync-item.error {
    border-left-color: var(--fluent-danger);
  }

  .milking-device-meta {
    display: grid;
    grid-template-columns: 68px minmax(0, 1fr);
    gap: 8px 10px;
    margin-top: 14px;
    padding: 12px;
    background: rgb(255 255 255 / 38%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .milking-device-meta span {
    color: var(--fluent-muted);
    font-size: 12px;
  }

  .milking-device-meta strong {
    min-width: 0;
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 680;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .parlor-sync-item,
  .mapping-card {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .link-node span,
  .queue-item span,
  .alert-row span,
  .maintenance-list span,
  .sync-row span,
  .protocol-list span,
  .parlor-sync-item span,
  .mapping-card span {
    display: block;
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .link-node strong {
    display: block;
    margin-top: 8px;
    color: var(--fluent-text);
    font-size: clamp(22px, 2vw, 26px);
    font-weight: 780;
  }

  .link-node p,
  .queue-item p,
  .alert-row p,
  .maintenance-list p,
  .parlor-sync-item p {
    margin: 8px 0 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
    line-height: 1.6;
  }

  .mapping-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }

  .mapping-meta span {
    padding: 4px 8px;
    color: var(--fluent-text-soft);
    background: rgb(255 255 255 / 48%);
    border: 1px solid var(--fluent-border);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 650;
  }

  .work-queue,
  .alert-list,
  .maintenance-list,
  .command-log-list,
  .protocol-list,
  .sync-list,
  .assignment-list,
  .assignment-history,
  .side-stack {
    display: grid;
    gap: 12px;
  }

  .queue-item,
  .alert-row,
  .command-log-row,
  .assignment-row,
  .assignment-history article,
  .maintenance-list article,
  .sync-row,
  .protocol-list article {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    justify-content: space-between;
    padding: 14px;
    background: rgb(255 255 255 / 42%);
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .queue-item.danger,
  .alert-row.high,
  .alert-row.critical {
    border-left-color: var(--fluent-danger);
  }

  .queue-item.warning,
  .alert-row.medium {
    border-left-color: var(--fluent-amber);
  }

  .queue-item h3,
  .alert-row h3,
  .assignment-row h3,
  .command-log-row strong,
  .maintenance-list h3,
  .parlor-sync-item h3,
  .mapping-card h3 {
    margin: 5px 0 0;
    color: var(--fluent-text);
    font-size: 15px;
    font-weight: 760;
  }

  .device-toolbar {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) 160px 140px;
    gap: 10px;
    margin-bottom: 16px;
  }

  .assignment-toolbar {
    display: grid;
    grid-template-columns: minmax(180px, 0.9fr) minmax(180px, 0.9fr) minmax(220px, 1fr);
    gap: 10px;
    margin-bottom: 12px;
  }

  .assignment-actions,
  .assignment-row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
    margin-bottom: 14px;
  }

  .assignment-row-actions {
    margin: 0;
  }

  .assignment-history strong {
    color: var(--fluent-text);
    font-size: 14px;
    font-weight: 740;
  }

  .assignment-row span,
  .assignment-history span {
    display: block;
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .assignment-row p,
  .assignment-history p {
    margin: 6px 0 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
  }

  .device-grid-scroll {
    max-height: min(62vh, 620px);
    overflow-y: auto;
    padding-right: 4px;
  }

  .device-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }

  .device-card {
    padding: 13px;
    background: #fff;
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-muted);
    border-radius: var(--fluent-radius);
    box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
    transition:
      background-color 160ms ease,
      border-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .device-card:hover {
    background: rgb(248 250 252);
    box-shadow: inset 0 0 0 1px rgb(var(--fluent-primary-rgb) / 9%);
  }

  .device-card.is-online {
    border-left-color: var(--fluent-primary);
  }

  .device-card.is-maintenance {
    border-left-color: var(--fluent-amber);
  }

  .device-card.is-error {
    border-left-color: var(--fluent-danger);
  }

  .device-card-header {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .device-card h3 {
    margin: 0;
    color: var(--fluent-text);
    font-size: 16px;
    font-weight: 760;
  }

  .device-card p {
    margin: 5px 0 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
  }

  .device-meta {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 8px 10px;
    margin: 16px 0;
    padding: 12px;
    background: rgb(255 255 255 / 38%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .device-meta span {
    color: var(--fluent-muted);
    font-size: 12px;
  }

  .device-meta strong {
    min-width: 0;
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 680;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .capability-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 26px;
    color: var(--fluent-muted);
    font-size: 12px;
  }

  .device-actions,
  .alert-actions,
  .sync-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
    margin-top: 14px;
  }

  .sync-row,
  .protocol-list article {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .sync-actions {
    justify-content: space-between;
    margin-top: 8px;
  }

  @media (max-width: 1260px) {
    .fc-metric-grid,
    .hardware-layout,
    .hardware-layout.is-device-first,
    .link-map,
    .milking-device-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .fc-metric-grid,
    .hardware-layout,
    .hardware-layout.is-device-first,
    .link-map,
    .milking-device-grid,
    .assignment-toolbar,
    .device-toolbar {
      grid-template-columns: 1fr;
    }

    .queue-item,
    .alert-row,
    .assignment-row,
    .assignment-history article,
    .maintenance-list article,
    .parlor-sync-item,
    .mapping-card {
      display: grid;
    }

    .alert-actions,
    .assignment-row-actions {
      justify-content: flex-start;
    }
  }
</style>
