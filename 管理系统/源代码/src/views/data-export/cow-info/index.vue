<template>
  <div class="p-5">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">牛只信息导出</h1>
        <p class="text-gray-600 dark:text-gray-300 mt-1"
          >选择导出字段和数据范围，导出牛只信息数据</p
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
            <ElFormItem label="数据范围">
              <ElSelect v-model="exportConfig.dataRange" placeholder="选择数据范围">
                <ElOption label="全部数据" value="all" />
                <ElOption label="当前页数据" value="current" />
                <ElOption label="选中数据" value="selected" />
              </ElSelect>
            </ElFormItem>
          </ElCol>
        </ElRow>

        <ElFormItem label="导出字段" prop="fields">
          <ElCheckboxGroup v-model="exportConfig.fields" class="export-field-grid">
            <ElCheckbox label="cowNumber">牛号</ElCheckbox>
            <ElCheckbox label="breed">品种</ElCheckbox>
            <ElCheckbox label="gender">性别</ElCheckbox>
            <ElCheckbox label="birthDate">出生日期</ElCheckbox>
            <ElCheckbox label="type">类型</ElCheckbox>
            <ElCheckbox label="currentPen">当前圈舍</ElCheckbox>
            <ElCheckbox label="status">状态</ElCheckbox>
            <ElCheckbox label="pregnancy">是否预产</ElCheckbox>
            <ElCheckbox label="parity">胎次</ElCheckbox>
            <ElCheckbox label="fatherNumber">父号</ElCheckbox>
            <ElCheckbox label="motherNumber">母号</ElCheckbox>
            <ElCheckbox label="grandfatherNumber">外祖父号</ElCheckbox>
            <ElCheckbox label="grandmotherNumber">外祖母号</ElCheckbox>
            <ElCheckbox label="createdAt">创建时间</ElCheckbox>
            <ElCheckbox label="updatedAt">更新时间</ElCheckbox>
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
    <div
      v-if="previewData.length > 0"
      class="bg-white p-6 rounded-lg border border-gray-200 shadow-sm"
    >
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
              <span v-if="field === 'birthDate' || field === 'createdAt' || field === 'updatedAt'">
                {{ formatDate(scope.row[field]) }}
              </span>
              <span v-else-if="field === 'pregnancy'">
                {{ scope.row[field] ? '是' : '否' }}
              </span>
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
  import * as databaseService from '@/services/数据库'
  import { estimatePayloadSize, recordV2ExportRun } from '@/services/v2-export'
  import { useLazyRenderWindow } from '@/hooks'
  import type { CowBasic } from '@/types'
  import * as XLSX from 'xlsx'

  // 表单引用
  const formRef = ref<FormInstance>()

  // 导出配置
  const exportConfig = reactive({
    format: 'xlsx',
    dataRange: 'all',
    fields: [
      'cowNumber',
      'breed',
      'gender',
      'birthDate',
      'type',
      'currentPen',
      'status',
      'pregnancy',
      'parity'
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
  const fullPreviewData = ref<CowExportRecord[]>([])
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

  type CowExportRecord = CowBasic & {
    sourceTable?: string
    sourceRecordId?: string
    animalId?: string
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

  const roleMatches = (value: unknown, roles: string[]) => {
    const text = String(value || '').toLowerCase()
    return roles.some((role) => text.includes(role))
  }

  const loadSelectedCowRows = async (): Promise<CowExportRecord[]> => {
    const v2Animals = await readTableSafe('animal')
    if (v2Animals.length) {
      const parentageRows = await readTableSafe('animal_parentage')
      const parentageByAnimal = new Map<string, any[]>()
      parentageRows.forEach((row: any) => {
        const animalId = String(row.animalId || row.animal_id || '')
        if (!animalId) return
        parentageByAnimal.set(animalId, [...(parentageByAnimal.get(animalId) || []), row])
      })

      return v2Animals.map((row: any) => {
        const animalId = String(row.id || '')
        const parents = parentageByAnimal.get(animalId) || []
        const father = parents.find((item) =>
          roleMatches(item.parentRole || item.parent_role, ['sire', 'father', '父'])
        )
        const mother = parents.find((item) =>
          roleMatches(item.parentRole || item.parent_role, ['dam', 'mother', '母'])
        )
        const maternalGrandfather = parents.find((item) =>
          roleMatches(item.parentRole || item.parent_role, [
            'maternal_grandsire',
            'grandfather',
            '外祖父'
          ])
        )
        const maternalGrandmother = parents.find((item) =>
          roleMatches(item.parentRole || item.parent_role, [
            'maternal_granddam',
            'grandmother',
            '外祖母'
          ])
        )

        return {
          id: animalId,
          animalId,
          cowNumber: String(row.animalNumber || row.animal_number || ''),
          earTagNumber: String(
            row.earTagNumber || row.ear_tag_number || row.electronicTag || row.electronic_tag || ''
          ),
          breed: String(row.breed || ''),
          gender: String(row.sex || row.gender || ''),
          birthDate: String(row.birthDate || row.birth_date || ''),
          type: String(
            row.productionPurpose ||
              row.production_purpose ||
              row.currentStageId ||
              row.current_stage_id ||
              ''
          ),
          currentPen: String(
            row.currentPenId || row.current_pen_id || row.currentUnitId || row.current_unit_id || ''
          ),
          status: String(row.status || ''),
          pregnancy: Boolean(row.pregnancy),
          parity: Number(row.parity || 0),
          fatherNumber: String(father?.parentNumber || father?.parent_number || ''),
          motherNumber: String(mother?.parentNumber || mother?.parent_number || ''),
          grandfatherNumber: String(
            maternalGrandfather?.parentNumber || maternalGrandfather?.parent_number || ''
          ),
          grandmotherNumber: String(
            maternalGrandmother?.parentNumber || maternalGrandmother?.parent_number || ''
          ),
          createdAt: String(row.createdAt || row.created_at || ''),
          updatedAt: String(row.updatedAt || row.updated_at || ''),
          sourceTable: 'animal',
          sourceRecordId: animalId
        } as CowExportRecord
      })
    }

    const legacyRows = await readTableSafe('cows')
    return (legacyRows as CowBasic[]).map((row) => ({
      ...row,
      sourceTable: 'cows',
      sourceRecordId: row.id
    }))
  }

  const writeExportAuditLog = async (
    fileName: string,
    rows: CowExportRecord[],
    exportData: Record<string, unknown>[]
  ) => {
    const startedAt = new Date().toISOString()
    const fileHash = await hashText(JSON.stringify({ fileName, exportConfig, exportData }))
    const finishedAt = new Date().toISOString()
    const auditId = `export-cow-info-${Date.now()}`
    const cowIds = rows.map((row) => row.animalId || row.id).filter(Boolean)
    const cowNumbers = rows.map((row) => row.cowNumber).filter(Boolean)
    const sourceRecordIds = rows.reduce<Record<string, string[]>>((result, row) => {
      const table = row.sourceTable || 'cows'
      const id = String(row.sourceRecordId || row.id || '')
      if (!id) return result
      result[table] = Array.from(new Set([...(result[table] || []), id]))
      return result
    }, {})
    const relationScope = {
      domain: 'export_cow_info',
      table: rows.some((row) => row.sourceTable === 'animal') ? 'animal' : 'cows',
      cowIds,
      cowNumbers,
      sourceRecordIds
    }
    const parameters = {
      format: exportConfig.format,
      dataRange: exportConfig.dataRange,
      fields: exportConfig.fields
    }
    const resultSnapshot = {
      rowCount: rows.length,
      fileName,
      fileHash,
      exportedFields: exportConfig.fields,
      previewRows: exportData.slice(0, 5)
    }

    await databaseService.addTableDataAsync('export-audit-logs', {
      id: auditId,
      operator: getOperator(),
      action_type: 'export_cow_info',
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
      action_type: 'export_cow_info',
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
      scopeCode: 'cow_info_export',
      scopeName: '牛只信息导出',
      scopeDomain: 'animal',
      sourceType: 'cow_info_export',
      fileName,
      fileFormat: exportConfig.format,
      rowCount: rows.length,
      checksum: fileHash,
      fileSize: estimatePayloadSize(exportData),
      operatorName: getOperator(),
      startedAt,
      finishedAt,
      parameters,
      resultSnapshot,
      periods: [{ periodType: exportConfig.dataRange || 'all' }],
      scopes: [
        { scopeType: 'source_table', scopeValue: relationScope.table },
        ...cowNumbers
          .slice(0, 200)
          .map((cowNumber) => ({ scopeType: 'cow_number', scopeValue: cowNumber })),
        ...exportConfig.fields.map((field) => ({ scopeType: 'field', scopeValue: field }))
      ],
      selectableFilters: {
        dataRange: ['all', 'current', 'selected'],
        fields: Object.keys(fieldLabels)
      },
      selectableVariables: exportConfig.fields,
      defaultPeriods: [{ periodType: exportConfig.dataRange || 'all' }]
    })
    return fileHash
  }

  // 字段标签映射
  const fieldLabels: Record<string, string> = {
    cowNumber: '牛号',
    breed: '品种',
    gender: '性别',
    birthDate: '出生日期',
    type: '类型',
    currentPen: '当前圈舍',
    status: '状态',
    pregnancy: '是否预产',
    parity: '胎次',
    fatherNumber: '父号',
    motherNumber: '母号',
    grandfatherNumber: '外祖父号',
    grandmotherNumber: '外祖母号',
    createdAt: '创建时间',
    updatedAt: '更新时间'
  }

  // 获取字段标签
  const getFieldLabel = (field: string) => {
    return fieldLabels[field] || field
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
    exportConfig.dataRange = 'all'
    exportConfig.fields = [
      'cowNumber',
      'breed',
      'gender',
      'birthDate',
      'type',
      'currentPen',
      'status',
      'pregnancy',
      'parity'
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
          const allData = await loadSelectedCowRows()
          fullPreviewData.value = allData
          resetPreviewData()
          totalRecords.value = allData.length
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
          const selectedRows = await loadSelectedCowRows()

          // 筛选和处理数据
          const exportData = selectedRows.map((item: CowBasic) => {
            const row: any = {}
            exportConfig.fields.forEach((field) => {
              if (field === 'birthDate' || field === 'createdAt' || field === 'updatedAt') {
                row[getFieldLabel(field)] = formatDate(item[field as keyof CowBasic] as string)
              } else if (field === 'pregnancy') {
                row[getFieldLabel(field)] = (item[field as keyof CowBasic] as boolean) ? '是' : '否'
              } else {
                row[getFieldLabel(field)] = item[field as keyof CowBasic] || ''
              }
            })
            return row
          })

          // 生成文件名
          const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
          const fileBaseName = `牛只信息导出_${timestamp}`
          const fileName = `${fileBaseName}.${exportConfig.format}`

          if (exportConfig.format === 'xlsx') {
            // 导出为Excel
            const ws = XLSX.utils.json_to_sheet(exportData)
            const wb = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(wb, ws, '牛只信息')
            XLSX.writeFile(wb, fileName)
          } else {
            // 导出为CSV
            const csvContent = [
              Object.keys(exportData[0] || {}).join(','),
              ...exportData.map((row) => Object.values(row).join(','))
            ].join('\n')

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
            const link = document.createElement('a')
            link.href = URL.createObjectURL(blob)
            link.download = fileName
            link.click()
          }

          const fileHash = await writeExportAuditLog(fileName, selectedRows, exportData)
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
    // 页面加载时自动预览数据（如果有默认字段选择）
    if (exportConfig.fields.length > 0) {
      handlePreview()
    }
  })

  defineOptions({ name: 'CowInfoExport' })
</script>

<style scoped>
  .preview-table-scroll {
    max-width: 100%;
    max-height: 420px;
    overflow: auto;
  }
</style>
