<template>
  <div class="p-5">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">牛只事件导出</h1>
        <p class="text-gray-600 dark:text-gray-300 mt-1"
          >选择导出事件类型和时间范围，导出牛只事件数据</p
        >
      </div>
    </div>

    <!-- 导出配置表单 -->
    <div class="bg-white p-6 rounded-lg border border-gray-200 shadow-sm mb-6">
      <h2 class="text-lg font-semibold mb-4 text-gray-900 dark:text-white">导出配置</h2>

      <ElForm
        ref="formRef"
        :model="exportConfig"
        :rules="formRules"
        label-width="120px"
        class="max-w-4xl"
      >
        <ElRow :gutter="20">
          <ElCol :span="12">
            <ElFormItem label="导出格式" prop="format">
              <ElSelect v-model="exportConfig.format" placeholder="选择导出格式">
                <ElOption label="Excel (.xlsx)" value="xlsx" />
                <ElOption label="CSV (.csv)" value="csv" />
              </ElSelect>
            </ElFormItem>
          </ElCol>

          <ElCol :span="12">
            <ElFormItem label="事件类型">
              <ElSelect
                v-model="exportConfig.eventTypes"
                multiple
                placeholder="选择事件类型（可多选）"
              >
                <ElOption label="入群事件" value="entry" />
                <ElOption label="转群事件" value="transfer" />
                <ElOption label="出群事件" value="exit" />
                <ElOption label="育种事件" value="breeding" />
                <ElOption label="兽医事件" value="veterinary" />
              </ElSelect>
            </ElFormItem>
          </ElCol>
        </ElRow>

        <ElRow :gutter="20">
          <ElCol :span="12">
            <ElFormItem label="开始时间">
              <ElDatePicker
                v-model="exportConfig.startDate"
                type="date"
                placeholder="选择开始时间"
                format="YYYY-MM-DD"
                value-format="YYYY-MM-DD"
              />
            </ElFormItem>
          </ElCol>

          <ElCol :span="12">
            <ElFormItem label="结束时间">
              <ElDatePicker
                v-model="exportConfig.endDate"
                type="date"
                placeholder="选择结束时间"
                format="YYYY-MM-DD"
                value-format="YYYY-MM-DD"
              />
            </ElFormItem>
          </ElCol>
        </ElRow>

        <ElFormItem label="导出字段" prop="fields">
          <ElCheckboxGroup v-model="exportConfig.fields" class="export-field-grid">
            <ElCheckbox label="eventType">事件类型</ElCheckbox>
            <ElCheckbox label="cowNumber">牛号</ElCheckbox>
            <ElCheckbox label="eventDate">事件日期</ElCheckbox>
            <ElCheckbox label="operatorName">操作员</ElCheckbox>
            <ElCheckbox label="description">事件描述</ElCheckbox>
            <ElCheckbox label="notes">备注</ElCheckbox>
            <ElCheckbox label="cost">费用</ElCheckbox>
            <ElCheckbox label="createdAt">创建时间</ElCheckbox>
          </ElCheckboxGroup>
        </ElFormItem>

        <ElFormItem>
          <ElButton
            type="primary"
            @click="handleExport"
            :loading="exportLoading"
            :disabled="exportConfig.fields.length === 0"
          >
            <ArtSvgIcon icon="ri:download-line" class="mr-2" />
            开始导出
          </ElButton>
          <ElButton @click="handlePreview" :disabled="exportConfig.fields.length === 0">
            <ArtSvgIcon icon="ri:eye-line" class="mr-2" />
            预览数据
          </ElButton>
          <ElButton @click="resetConfig">重置配置</ElButton>
        </ElFormItem>
      </ElForm>
    </div>

    <!-- 数据预览 -->
    <div class="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">数据预览</h2>
        <ElTag type="info">共 {{ totalRecords }} 条记录，预览前 {{ previewData.length }} 条</ElTag>
      </div>

      <div
        class="preview-table-scroll"
        @scroll.passive="onPreviewScroll"
        @wheel.passive="onPreviewWheel"
      >
        <ElTable
          :data="previewData"
          style="width: 100%"
          :loading="previewLoading"
          empty-text="暂无数据"
          max-height="400"
        >
          <ElTableColumn
            v-for="field in exportConfig.fields"
            :key="field"
            :prop="field"
            :label="getFieldLabel(field)"
            min-width="120"
          >
            <template #default="scope">
              <span v-if="field === 'eventDate' || field === 'createdAt'">
                {{ formatDate(scope.row[field]) }}
              </span>
              <span v-else-if="field === 'cost'"> ¥{{ scope.row[field] || 0 }} </span>
              <span v-else>
                {{ scope.row[field] || '-' }}
              </span>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, onMounted } from 'vue'
  import type { FormInstance, FormRules } from 'element-plus'
  import * as XLSX from 'xlsx'
  import * as databaseService from '@/services/数据库'
  import { estimatePayloadSize, recordV2ExportRun } from '@/services/v2-export'
  import { useLazyRenderWindow } from '@/hooks'

  // 表单引用
  const formRef = ref<FormInstance>()

  // 导出配置
  const exportConfig = reactive({
    format: 'xlsx',
    eventTypes: [] as string[],
    startDate: '',
    endDate: '',
    fields: [
      'eventType',
      'cowNumber',
      'eventDate',
      'operatorName',
      'description',
      'notes',
      'cost'
    ] as string[]
  })

  // 表单验证规则
  const formRules: FormRules = {
    format: [{ required: true, message: '请选择导出格式', trigger: 'change' }],
    fields: [
      { type: 'array', required: true, message: '请至少选择一个导出字段', trigger: 'change' }
    ]
  }

  // 状态变量
  const exportLoading = ref(false)
  const previewLoading = ref(false)
  const fullPreviewData = ref<ExportEventRecord[]>([])
  const totalRecords = ref(0)
  const {
    visibleItems: previewData,
    resetVisibleCount: resetPreviewData,
    handleScroll: onPreviewScroll,
    handleWheel: onPreviewWheel
  } = useLazyRenderWindow(fullPreviewData, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const getOperator = () => '数据导出员'

  interface ExportEventRecord {
    id: string
    cowId?: string
    cowNumber?: string
    eventType: string
    eventDate: string
    operatorName?: string
    description?: string
    notes?: string
    cost?: number | string
    createdAt?: string
    sourceTable: string
    sourceRecordId: string
  }

  const hashText = async (value: string) => {
    if (window.crypto?.subtle) {
      const buffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
      return Array.from(new Uint8Array(buffer))
        .map((item) => item.toString(16).padStart(2, '0'))
        .join('')
    }
    let hash = 0
    for (let index = 0; index < value.length; index += 1) {
      hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0
    }
    return `fallback-${Math.abs(hash).toString(16)}`
  }

  const readTableSafe = async (tableName: string) => {
    try {
      return await databaseService.getTableDataAsync(tableName, { silent: true })
    } catch {
      return []
    }
  }

  const canonicalEventPriority = (event: ExportEventRecord) => {
    if (event.sourceTable === 'animal_event') return 1
    if (event.sourceTable === 'cow_events') return 2
    return 3
  }

  const eventBusinessKey = (event: ExportEventRecord) => {
    const sourceId = String(event.sourceRecordId || event.id || '').trim()
    const fallbackDetail = [event.description, event.notes, event.cost].map((item) => String(item || '').trim()).join('|')
    return [
      String(event.cowId || event.cowNumber || '').trim(),
      String(event.eventType || '').trim(),
      String(event.eventDate || '').replace('T', ' ').replace('Z', '').slice(0, 19),
      sourceId || fallbackDetail
    ].join('|')
  }

  const dedupeEventsByBusinessKey = (events: ExportEventRecord[]) => {
    const byKey = new Map<string, ExportEventRecord>()
    events.forEach((event) => {
      const key = eventBusinessKey(event)
      const existing = byKey.get(key)
      if (!existing || canonicalEventPriority(event) < canonicalEventPriority(existing)) {
        byKey.set(key, event)
      }
    })
    return Array.from(byKey.values())
  }

  const eventDateKeys = [
    'eventDate',
    'eventTime',
    'occurredAt',
    'occurred_at',
    'createdAt',
    'created_at',
    'entryTime',
    'transferTime',
    'exitTime',
    'milkingTime',
    'feedingTime'
  ]
  const getEventDateValue = (item: any) => {
    for (const key of eventDateKeys) {
      if (item?.[key]) return item[key]
    }
    return ''
  }

  const normalizeEventType = (value: unknown) => {
    const text = String(value || '').toLowerCase()
    if (text.includes('entry') || text.includes('入')) return 'entry'
    if (text.includes('transfer') || text.includes('movement') || text.includes('转'))
      return 'transfer'
    if (
      text.includes('exit') ||
      text.includes('cull') ||
      text.includes('离') ||
      text.includes('淘')
    )
      return 'exit'
    if (
      text.includes('breeding') ||
      text.includes('reproduction') ||
      text.includes('insemination') ||
      text.includes('pregnancy') ||
      text.includes('calving') ||
      text.includes('配') ||
      text.includes('妊') ||
      text.includes('产犊')
    ) {
      return 'breeding'
    }
    if (
      text.includes('veterinary') ||
      text.includes('health') ||
      text.includes('medicine') ||
      text.includes('disease') ||
      text.includes('treatment') ||
      text.includes('兽') ||
      text.includes('病') ||
      text.includes('药')
    ) {
      return 'veterinary'
    }
    return text || 'event'
  }

  const buildAnimalNumberMap = (animals: any[]) => {
    const map = new Map<string, string>()
    animals.forEach((row) => {
      const id = String(row.id || '')
      const number = String(
        row.animalNumber || row.animal_number || row.cowNumber || row.cow_number || ''
      )
      if (id && number) map.set(id, number)
    })
    return map
  }

  const normalizeLegacyEvent = (row: any): ExportEventRecord => {
    const eventType = normalizeEventType(
      row.eventType || row.event_type || row.type || row.eventName || row.event_name
    )
    const sourceTable = String(row.sourceTable || row.source_table || `${eventType}_events`)
    const details = row.details && typeof row.details === 'object' ? row.details : {}
    return {
      id: String(row.id || `${sourceTable}-${Date.now()}-${Math.random()}`),
      cowId: String(row.cowId || row.cow_id || ''),
      cowNumber: String(row.cowNumber || row.cow_number || ''),
      eventType,
      eventDate: String(getEventDateValue(row) || ''),
      operatorName: String(
        row.operatorName || row.operator_name || row.operator || row.technician || ''
      ),
      description: String(
        row.description || row.eventName || row.event_name || details.description || ''
      ),
      notes: String(row.notes || details.notes || ''),
      cost: row.cost ?? details.cost ?? '',
      createdAt: String(row.createdAt || row.created_at || ''),
      sourceTable,
      sourceRecordId: String(row.sourceRecordId || row.source_record_id || row.id || '')
    }
  }

  const loadSelectedEventRows = async () => {
    const [v2Events, animals, allCowEvents] = await Promise.all([
      readTableSafe('animal_event'),
      readTableSafe('animal'),
      readTableSafe('cow-events')
    ])
    const animalNumberMap = buildAnimalNumberMap(animals)
    const normalizedV2Events: ExportEventRecord[] = v2Events.map((row: any) => {
      const animalId = String(row.animalId || row.animal_id || '')
      const customValues = row.customValues || row.custom_values || {}
      return {
        id: String(row.id || ''),
        cowId: animalId,
        cowNumber: animalNumberMap.get(animalId) || String(row.cowNumber || row.cow_number || ''),
        eventType: normalizeEventType(
          row.eventType ||
            row.event_type ||
            row.eventCode ||
            row.event_code ||
            row.eventName ||
            row.event_name
        ),
        eventDate: String(
          row.occurredAt ||
            row.occurred_at ||
            row.productionDate ||
            row.production_date ||
            row.createdAt ||
            row.created_at ||
            ''
        ),
        operatorName: String(row.operatorName || row.operator_name || ''),
        description: String(
          row.eventName ||
            row.event_name ||
            row.eventCode ||
            row.event_code ||
            row.sourceType ||
            row.source_type ||
            ''
        ),
        notes: String(row.notes || ''),
        cost: customValues.cost ?? customValues.fee ?? '',
        createdAt: String(row.createdAt || row.created_at || ''),
        sourceTable: 'animal_event',
        sourceRecordId: String(row.id || '')
      }
    })

    // 兼容：同时从旧表读取（迁移期间）
    const legacyEvents: ExportEventRecord[] = (allCowEvents || []).map((row: any) => ({
      ...normalizeLegacyEvent(row),
      sourceTable: row.sourceTable || row.source_table || 'cow_events'
    }))
    if (exportConfig.eventTypes.includes('entry') || exportConfig.eventTypes.length === 0) {
      legacyEvents.push(
        ...(await readTableSafe('entry-events')).map((row: any) =>
          normalizeLegacyEvent({ ...row, eventType: 'entry', sourceTable: 'entry_events' })
        )
      )
    }
    if (exportConfig.eventTypes.includes('transfer') || exportConfig.eventTypes.length === 0) {
      legacyEvents.push(
        ...(await readTableSafe('transfer-events')).map((row: any) =>
          normalizeLegacyEvent({ ...row, eventType: 'transfer', sourceTable: 'transfer_events' })
        )
      )
    }
    if (exportConfig.eventTypes.includes('exit') || exportConfig.eventTypes.length === 0) {
      legacyEvents.push(
        ...(await readTableSafe('exit-events')).map((row: any) =>
          normalizeLegacyEvent({ ...row, eventType: 'exit', sourceTable: 'exit_events' })
        )
      )
    }
    if (exportConfig.eventTypes.includes('breeding') || exportConfig.eventTypes.length === 0) {
      legacyEvents.push(
        ...(await readTableSafe('breeding-events')).map((row: any) =>
          normalizeLegacyEvent({ ...row, eventType: 'breeding', sourceTable: 'breeding_events' })
        )
      )
    }
    if (exportConfig.eventTypes.includes('veterinary') || exportConfig.eventTypes.length === 0) {
      legacyEvents.push(
        ...(await readTableSafe('veterinary-events')).map((row: any) =>
          normalizeLegacyEvent({
            ...row,
            eventType: 'veterinary',
            sourceTable: 'veterinary_events'
          })
        )
      )
    }

    const allEventData = [...normalizedV2Events, ...legacyEvents].filter((event) => {
      if (exportConfig.eventTypes.length > 0 && !exportConfig.eventTypes.includes(event.eventType))
        return false
      return true
    })
    const seen = new Set()
    const sourceDeduped = allEventData.filter((e) => {
      const key = `${e.sourceTable}:${e.sourceRecordId || e.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const deduped = dedupeEventsByBusinessKey(sourceDeduped)

    if (!exportConfig.startDate && !exportConfig.endDate) return deduped
    return deduped.filter((item) => {
      const itemDate = new Date(getEventDateValue(item))
      const startDate = exportConfig.startDate ? new Date(exportConfig.startDate) : null
      const endDate = exportConfig.endDate ? new Date(exportConfig.endDate) : null
      if (startDate && itemDate < startDate) return false
      if (endDate && itemDate > endDate) return false
      return true
    })
  }

  const writeExportAuditLog = async (
    fileName: string,
    rows: any[],
    processedData: Record<string, unknown>[]
  ) => {
    const startedAt = new Date().toISOString()
    const fileHash = await hashText(JSON.stringify({ fileName, exportConfig, processedData }))
    const finishedAt = new Date().toISOString()
    const auditId = `export-cow-events-${Date.now()}`
    const cowIds = Array.from(
      new Set(
        rows
          .map((row) => row.cowId || row.cow_id)
          .filter(Boolean)
          .map(String)
      )
    )
    const cowNumbers = Array.from(
      new Set(
        rows
          .map((row) => row.cowNumber || row.cow_number)
          .filter(Boolean)
          .map(String)
      )
    )
    const sourceRecordIds = rows.reduce<Record<string, string[]>>((result, row) => {
      const table = String(row.sourceTable || 'cow_events')
      const id = String(row.sourceRecordId || row.id || '')
      if (!id) return result
      result[table] = Array.from(new Set([...(result[table] || []), id]))
      return result
    }, {})
    const parameters = {
      format: exportConfig.format,
      eventTypes: exportConfig.eventTypes,
      startDate: exportConfig.startDate,
      endDate: exportConfig.endDate,
      fields: exportConfig.fields
    }
    const relationScope = {
      domain: 'export_cow_events',
      cowIds,
      cowNumbers,
      sourceRecordIds
    }
    const resultSnapshot = {
      rowCount: rows.length,
      fileName,
      fileHash,
      exportedFields: exportConfig.fields,
      eventTypes: exportConfig.eventTypes.length
        ? exportConfig.eventTypes
        : ['entry', 'transfer', 'exit', 'breeding', 'veterinary'],
      previewRows: processedData.slice(0, 5)
    }

    await databaseService.addTableDataAsync('export-audit-logs', {
      id: auditId,
      operator: getOperator(),
      action_type: 'export_cow_events',
      status: 'completed',
      file_name: fileName,
      file_hash: fileHash,
      file_format: exportConfig.format,
      row_count: rows.length,
      filters_json: parameters,
      parameters_json: parameters,
      result_snapshot: resultSnapshot,
      cow_ids: cowIds,
      relation_scope: relationScope,
      source_record_ids: sourceRecordIds,
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: Math.max(1, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
      created_at: startedAt,
      updated_at: finishedAt
    })

    await databaseService.addTableDataAsync('operation-audit-logs', {
      id: `op-audit-${auditId}`,
      action_type: 'export_cow_events',
      target_type: 'export_audit_logs',
      target_id: auditId,
      operator: getOperator(),
      status: 'completed',
      request_payload: parameters,
      result_payload: resultSnapshot,
      cow_ids: cowIds,
      relation_scope: relationScope,
      source_record_ids: {
        ...sourceRecordIds,
        export_audit_logs: [auditId]
      },
      created_at: startedAt,
      updated_at: finishedAt
    })

    await recordV2ExportRun({
      scopeCode: 'cow_events_export',
      scopeName: '牛只事件导出',
      scopeDomain: 'animal_event',
      sourceType: 'cow_events_export',
      fileName,
      fileFormat: exportConfig.format,
      rowCount: rows.length,
      checksum: fileHash,
      fileSize: estimatePayloadSize(processedData),
      operatorName: getOperator(),
      startedAt,
      finishedAt,
      parameters,
      resultSnapshot,
      periods: [
        {
          periodType: 'date_range',
          startAt: exportConfig.startDate,
          endAt: exportConfig.endDate
        }
      ],
      scopes: [
        ...cowNumbers
          .slice(0, 200)
          .map((cowNumber) => ({ scopeType: 'cow_number', scopeValue: cowNumber })),
        ...(exportConfig.eventTypes.length
          ? exportConfig.eventTypes
          : Object.keys(eventTypeLabels)
        ).map((eventType) => ({ scopeType: 'event_type', scopeValue: eventType })),
        ...exportConfig.fields.map((field) => ({ scopeType: 'field', scopeValue: field })),
        ...Object.keys(sourceRecordIds).map((table) => ({
          scopeType: 'source_table',
          scopeValue: table
        }))
      ],
      selectableFilters: {
        eventTypes: Object.keys(eventTypeLabels),
        dateRange: ['startDate', 'endDate'],
        fields: Object.keys(fieldLabels)
      },
      selectableVariables: exportConfig.fields,
      defaultPeriods: [
        { periodType: 'date_range', startAt: exportConfig.startDate, endAt: exportConfig.endDate }
      ]
    })
    return fileHash
  }

  // 字段标签映射
  const fieldLabels: Record<string, string> = {
    eventType: '事件类型',
    cowNumber: '牛号',
    eventDate: '事件日期',
    operatorName: '操作员',
    description: '事件描述',
    notes: '备注',
    cost: '费用',
    createdAt: '创建时间'
  }

  // 事件类型映射
  const eventTypeLabels: Record<string, string> = {
    entry: '入群事件',
    transfer: '转群事件',
    exit: '出群事件',
    breeding: '育种事件',
    veterinary: '兽医事件'
  }

  // 获取字段标签
  const getFieldLabel = (field: string) => {
    return fieldLabels[field] || field
  }

  // 获取事件类型标签
  const getEventTypeLabel = (type: string) => {
    return eventTypeLabels[type] || type
  }

  // 格式化日期
  const formatDate = (dateString: string) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  }

  // 重置配置
  const resetConfig = () => {
    exportConfig.format = 'xlsx'
    exportConfig.eventTypes = []
    exportConfig.startDate = ''
    exportConfig.endDate = ''
    exportConfig.fields = [
      'eventType',
      'cowNumber',
      'eventDate',
      'operatorName',
      'description',
      'notes',
      'cost'
    ]
    fullPreviewData.value = []
  }

  // 预览数据
  const handlePreview = async () => {
    if (!formRef.value) return

    await formRef.value.validate(async (valid) => {
      if (valid) {
        previewLoading.value = true
        try {
          const filteredData = await loadSelectedEventRows()
          fullPreviewData.value = filteredData
          resetPreviewData()
          totalRecords.value = filteredData.length
        } catch (error) {
          console.error('预览数据失败:', error)
          ElMessage.error('预览数据失败')
        } finally {
          previewLoading.value = false
        }
      }
    })
  }

  // 导出数据
  const handleExport = async () => {
    if (!formRef.value) return

    await formRef.value.validate(async (valid) => {
      if (valid) {
        exportLoading.value = true
        try {
          const exportData = await loadSelectedEventRows()

          // 筛选和处理数据
          const processedData = exportData.map((item: any) => {
            const row: any = {}
            exportConfig.fields.forEach((field) => {
              if (field === 'eventDate' || field === 'createdAt') {
                row[getFieldLabel(field)] = formatDate(item[field])
              } else if (field === 'cost') {
                row[getFieldLabel(field)] = item[field]
              } else {
                row[getFieldLabel(field)] = item[field] || ''
              }
            })
            return row
          })

          // 生成文件名
          const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
          const fileBaseName = `牛只事件导出_${timestamp}`
          const fileName = `${fileBaseName}.${exportConfig.format}`

          if (exportConfig.format === 'xlsx') {
            // 导出为Excel
            const ws = XLSX.utils.json_to_sheet(processedData)
            const wb = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(wb, ws, '牛只事件')
            XLSX.writeFile(wb, fileName)
          } else {
            // 导出为CSV
            const csvContent = [
              Object.keys(processedData[0] || {}).join(','),
              ...processedData.map((row) => Object.values(row).join(','))
            ].join('\n')

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
            const link = document.createElement('a')
            link.href = URL.createObjectURL(blob)
            link.download = fileName
            link.click()
          }

          const fileHash = await writeExportAuditLog(fileName, exportData, processedData)
          ElMessage.success(`导出成功，审计已写入：${fileHash.slice(0, 12)}`)
        } catch (error) {
          console.error('导出数据失败:', error)
          ElMessage.error('导出失败，请重试')
        } finally {
          exportLoading.value = false
        }
      }
    })
  }

  // 生命周期
  onMounted(() => {
    handlePreview() // 页面加载时自动预览数据
  })

  defineOptions({ name: 'CowEventsExport' })
</script>

<style scoped>
  .preview-table-scroll {
    max-width: 100%;
    max-height: 420px;
    overflow: auto;
  }
</style>
