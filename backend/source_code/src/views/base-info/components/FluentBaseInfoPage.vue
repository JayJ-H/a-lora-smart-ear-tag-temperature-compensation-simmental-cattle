<template>
  <div class="fluent-page base-info-fluent">
    <section class="fluent-page-header">
      <div>
        <h1>{{ title }}</h1>
      </div>
      <div class="fluent-page-actions">
        <ElButton @click="resetFilters">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />
          重置
        </ElButton>
        <ElButton type="primary" @click="openCreateDialog">
          <ArtSvgIcon icon="ri:add-line" class="mr-1" />
          新增{{ entityLabel }}
        </ElButton>
      </div>
    </section>

    <section class="fluent-metric-grid">
      <div class="fluent-metric-card">
        <div class="metric-label">记录总数</div>
        <div class="metric-value">{{ rows.length }}</div>
        <div class="metric-note">{{ entityLabel }}档案</div>
      </div>
      <div class="fluent-metric-card is-teal">
        <div class="metric-label">{{ categoryLabel }}数量</div>
        <div class="metric-value">{{ categoryRows.length }}</div>
        <div class="metric-note">已归类管理</div>
      </div>
      <div class="fluent-metric-card is-warning">
        <div class="metric-label">启用记录</div>
        <div class="metric-value">{{ activeCount }}</div>
        <div class="metric-note">可直接参与业务流程</div>
      </div>
      <div class="fluent-metric-card is-info">
        <div class="metric-label">当前结果</div>
        <div class="metric-value">{{ filteredRows.length }}</div>
        <div class="metric-note">筛选后的{{ entityLabel }}</div>
      </div>
    </section>

    <section class="fluent-filter-panel">
      <ElForm :inline="true" class="filter-form">
        <ElFormItem label="关键词">
          <ElInput v-model="filters.keyword" clearable :placeholder="`搜索${entityLabel}`" />
        </ElFormItem>
        <ElFormItem :label="categoryLabel">
          <ElSelect v-model="filters.category" clearable :placeholder="`选择${categoryLabel}`">
            <ElOption
              v-for="item in categoryRows"
              :key="item.id"
              :label="categoryOptionLabel(item)"
              :value="item.name"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="状态">
          <ElSelect v-model="filters.status" clearable placeholder="选择状态">
            <ElOption label="正常" value="正常" />
            <ElOption label="启用" value="启用" />
            <ElOption label="停用" value="停用" />
            <ElOption label="维护中" value="维护中" />
          </ElSelect>
        </ElFormItem>
      </ElForm>
    </section>

    <section class="base-info-layout">
      <aside class="fluent-panel category-panel">
        <div class="panel-title-row">
          <div class="panel-title">{{ categoryLabel }}</div>
          <ElButton size="small" @click="openCategoryDialog">
            <ArtSvgIcon icon="ri:add-line" class="mr-1" />
            新增类别
          </ElButton>
        </div>
        <div class="category-list">
          <div
            v-for="item in categoryRows"
            :key="item.id"
            class="category-item"
            :class="[{ active: filters.category === item.name }, `level-${item.level || 1}`]"
            @click="filters.category = filters.category === item.name ? '' : item.name"
          >
            <button class="category-main" type="button">
              <span>{{ item.name }}</span>
              <small>{{ categoryDescription(item) }}</small>
            </button>
            <ElButton
              v-if="!categoryInUse(item.name)"
              class="category-delete"
              size="small"
              type="danger"
              text
              circle
              @click.stop="removeCategory(item)"
            >
              <ArtSvgIcon icon="ri:delete-bin-line" />
            </ElButton>
          </div>
        </div>
      </aside>

      <section class="fluent-table-panel table-panel">
        <div class="table-toolbar">
          <div>
            <h2>{{ entityLabel }}列表</h2>
          </div>
          <ElTag type="success" effect="light"
            >显示 {{ visibleRows.length }}/{{ filteredRows.length }} 条</ElTag
          >
        </div>
        <ElTable
          class="desktop-record-table"
          :data="visibleRows"
          table-layout="auto"
          style="width: 100%"
          height="min(62vh, 520px)"
          @wheel.passive="onTableWheel"
        >
          <ElTableColumn
            v-for="column in columns"
            :key="column.prop"
            :prop="column.prop"
            :label="column.label"
            :min-width="column.minWidth || 120"
          >
            <template #default="{ row }">
              <ElTag v-if="column.type === 'tag'" :type="getTagType(row[column.prop])">
                {{ row[column.prop] }}
              </ElTag>
              <span v-else-if="column.type === 'boolean'">
                {{ row[column.prop] ? '是' : '否' }}
              </span>
              <span v-else>{{ row[column.prop] }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn label="操作" width="220">
            <template #default="{ row }">
              <ElButton size="small" @click="openEditDialog(row)">编辑</ElButton>
              <slot name="row-actions" :row="row" />
              <ElButton size="small" type="danger" @click="removeRow(row.id)">删除</ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
        <div class="mobile-record-list">
          <article v-for="row in visibleRows" :key="row.id" class="mobile-record-row">
            <dl>
              <div v-for="column in columns" :key="column.prop" class="mobile-record-field">
                <dt>{{ column.label }}</dt>
                <dd>
                  <ElTag v-if="column.type === 'tag'" :type="getTagType(row[column.prop])">
                    {{ row[column.prop] }}
                  </ElTag>
                  <span v-else-if="column.type === 'boolean'">
                    {{ row[column.prop] ? '是' : '否' }}
                  </span>
                  <span v-else>{{ row[column.prop] || '-' }}</span>
                </dd>
              </div>
            </dl>
            <div class="mobile-record-actions">
              <ElButton size="small" @click="openEditDialog(row)">编辑</ElButton>
              <slot name="row-actions" :row="row" />
              <ElButton size="small" type="danger" @click="removeRow(row.id)">删除</ElButton>
            </div>
          </article>
          <ElEmpty v-if="visibleRows.length === 0" :description="`暂无${entityLabel}`" />
        </div>
        <div v-if="filteredRows.length > visibleRows.length" class="load-more-row">
          <ElButton @click="() => loadMoreRows()"
            >加载更多 {{ visibleRows.length }}/{{ filteredRows.length }}</ElButton
          >
        </div>
      </section>
    </section>

    <ElDialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="min(620px, calc(100vw - 32px))"
      @closed="resetForm"
    >
      <ElForm label-width="110px">
        <ElFormItem v-for="field in editableColumns" :key="field.prop" :label="field.label">
          <ElSwitch v-if="field.type === 'boolean'" v-model="form[field.prop]" />
          <ElSelect
            v-else-if="selectOptionsForField(field).length"
            v-model="form[field.prop]"
            class="w-full"
            filterable
          >
            <ElOption
              v-for="option in selectOptionsForField(field)"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </ElSelect>
          <ElInput
            v-else
            :model-value="String(form[field.prop] ?? '')"
            @update:model-value="(value) => (form[field.prop] = value)"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="submitForm">保存</ElButton>
      </template>
    </ElDialog>

    <ElDialog
      v-model="categoryDialogVisible"
      :title="`新增${categoryLabel}`"
      width="min(520px, calc(100vw - 32px))"
      @closed="resetCategoryForm"
    >
      <ElForm label-width="110px">
        <ElFormItem label="挂载位置">
          <ElSelect
            v-model="categoryForm.parentId"
            class="w-full"
            clearable
            placeholder="不选择则作为一级分类"
          >
            <ElOption label="作为一级分类" value="" />
            <ElOption
              v-for="item in topLevelCategories"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem :label="categoryLabel">
          <ElInput v-model="categoryForm.name" :placeholder="`输入新的${categoryLabel}`" />
        </ElFormItem>
        <ElFormItem label="说明">
          <ElInput v-model="categoryForm.description" type="textarea" :rows="3" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="categoryDialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="submitCategoryForm">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import * as databaseService from '@/services/database'
  import { useLazyRenderWindow } from '@/hooks'
  import {
    normalizeDiseaseCategory,
    normalizeBaseInfoStatus,
    normalizeMedicineCategory,
    normalizePenCategory,
    normalizePersonRole
  } from '@/utils/base-info-normalizers'

  interface BaseInfoColumn {
    prop: string
    label: string
    minWidth?: number | string
    type?: 'text' | 'tag' | 'boolean'
    options?: ReadonlyArray<string>
    aliases?: ReadonlyArray<string>
    defaultValue?: string | number | boolean
    required?: boolean
  }

  interface BaseInfoCategory {
    id: string
    name: string
    description: string
    parentId?: string
    parent_id?: string
    parentName?: string
    parent_name?: string
    level?: number
  }

  interface BaseInfoRow {
    id: string
    name: string
    categoryName?: string
    status?: string
    isActive?: boolean
    [key: string]: string | number | boolean | undefined
  }

  const props = defineProps<{
    title: string
    description: string
    entityLabel: string
    categoryLabel: string
    categories: ReadonlyArray<BaseInfoCategory>
    columns: ReadonlyArray<BaseInfoColumn>
    records: ReadonlyArray<BaseInfoRow>
    tableName?: string
    categoryScope?: string
    recordScope?: string
    directCategoryRecords?: boolean
    recordFilter?: (row: BaseInfoRow) => boolean
  }>()
  const emit = defineEmits<{
    saved: [row: BaseInfoRow]
    removed: [id: string]
  }>()

  const rows = ref<BaseInfoRow[]>(props.records.map((item) => ({ ...item })))
  const categoryRows = ref<BaseInfoCategory[]>(props.categories.map((item) => ({ ...item })))
  const loading = ref(false)
  const filters = reactive({
    keyword: '',
    category: '',
    status: props.directCategoryRecords ? '启用' : ''
  })
  const dialogVisible = ref(false)
  const categoryDialogVisible = ref(false)
  const editingId = ref('')
  const form = reactive<Record<string, string | number | boolean>>({})
  const categoryForm = reactive({ parentId: '', name: '', description: '' })

  const editableColumns = computed(() => props.columns.filter((item) => item.prop !== 'id'))
  const categoryField = computed(() => {
    const candidates = ['categoryName', 'category', 'role']
    return (
      candidates.find((prop) => props.columns.some((column) => column.prop === prop)) ||
      'categoryName'
    )
  })
  const dialogTitle = computed(() => `${editingId.value ? '编辑' : '新增'}${props.entityLabel}`)
  const categoryScope = computed(() => props.categoryScope || props.tableName || props.entityLabel)
  const directRecordScope = computed(() => props.recordScope || categoryScope.value)
  const activeCount = computed(
    () => rows.value.filter((item) => item.isActive !== false && item.status !== '停用').length
  )
  const topLevelCategories = computed(() =>
    categoryRows.value.filter((item) => !item.parentId && !item.parent_id)
  )

  const filteredRows = computed(() => {
    const keyword = filters.keyword.trim().toLowerCase()
    return rows.value.filter((row) => {
      const matchesKeyword =
        !keyword ||
        props.columns.some((column) =>
          String(row[column.prop] ?? '')
            .toLowerCase()
            .includes(keyword)
        )
      const matchesCategory =
        !filters.category ||
        row.categoryName === filters.category ||
        row.category === filters.category ||
        row.role === filters.category
      const matchesStatus = !filters.status || row.status === filters.status
      return matchesKeyword && matchesCategory && matchesStatus
    })
  })
  const {
    visibleItems: visibleRows,
    loadMore: loadMoreRows,
    handleWheel: onTableWheel
  } = useLazyRenderWindow(filteredRows, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const resetFilters = () => {
    filters.keyword = ''
    filters.category = ''
    filters.status = ''
  }

  const loadCategories = async () => {
    const seedRows = props.categories.map((item) => ({
      ...item,
      id: `${categoryScope.value}-category-${item.id}`,
      scope: categoryScope.value,
      parentId: item.parentId || '',
      parent_id: item.parentId || '',
      parentName: item.parentName || '',
      parent_name: item.parentName || '',
      level: item.level || 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))
    try {
      const dbRows = await databaseService.getTableDataAsync('base-info-categories', {
        silent: true
      })
      const scopedRows = dbRows
        .filter((item) => item.scope === categoryScope.value)
        .map((item) => ({
          id: String(item.id || `category-${item.name}`),
          name: String(item.name || ''),
          description: String(item.description || ''),
          parentId: String(item.parentId || item.parent_id || ''),
          parentName: String(item.parentName || item.parent_name || ''),
          level: Number(item.level || 1) || 1
        }))
        .filter((item) => item.name)

      if (props.directCategoryRecords) {
        const categorySeedRows = seedRows.map((item) => ({ ...item }))
        categoryRows.value = sortCategories(scopedRows.length ? scopedRows : categorySeedRows)
        return
      }

      if (scopedRows.length) {
        categoryRows.value = sortCategories(scopedRows)
        return
      }

      if (seedRows.length) {
        await databaseService.addTableDataAsync('base-info-categories', seedRows)
        categoryRows.value = sortCategories(seedRows)
      }
    } catch {
      categoryRows.value = sortCategories(props.categories.map((item) => ({ ...item })))
    }
  }

  const loadRows = async () => {
    if (props.directCategoryRecords) {
      loading.value = true
      try {
        const dbRows = await databaseService.getTableDataAsync('base-info-categories', {
          silent: true
        })
        const scopedRows = dbRows.filter((item) => item.scope === directRecordScope.value)
        if (scopedRows.length) {
          rows.value = normalizeRows(scopedRows.map((item) => ({ ...item })) as BaseInfoRow[])
          return
        }

        if (props.records.length) {
          const seedRows = props.records.map((item) =>
            directCategoryPayload({
              ...item,
              createdAt: item.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString()
            })
          )
          await databaseService.addTableDataAsync('base-info-categories', seedRows)
          rows.value = normalizeRows(
            (
              await databaseService.getTableDataAsync('base-info-categories', {
                silent: true
              })
            )
              .filter((item) => item.scope === directRecordScope.value)
              .map((item) => ({ ...item })) as BaseInfoRow[]
          )
        }
      } catch (error) {
        console.error(`加载${props.entityLabel}基础资料失败:`, error)
        ElMessage.error(`加载${props.entityLabel}基础资料失败`)
      } finally {
        loading.value = false
      }
      return
    }

    if (!props.tableName) return
    loading.value = true
    try {
      const dbRows = await databaseService.getTableDataAsync(props.tableName, { silent: true })
      if (dbRows.length > 0) {
        rows.value = normalizeRows(dbRows.map((item) => ({ ...item })) as BaseInfoRow[])
        await backfillNormalizedRows(dbRows as BaseInfoRow[], rows.value)
        return
      }

      if (props.records.length > 0) {
        const seedRows = props.records.map((item) => ({
          ...item,
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }))
        await databaseService.addTableDataAsync(props.tableName, seedRows)
        rows.value = normalizeRows(
          (await databaseService.getTableDataAsync(props.tableName, { silent: true })).map(
            (item) => ({ ...item })
          ) as BaseInfoRow[]
        )
      }
    } catch (error) {
      console.error(`加载${props.entityLabel}基础资料失败:`, error)
      ElMessage.error(`加载${props.entityLabel}基础资料失败`)
    } finally {
      loading.value = false
    }
  }

  const TRANSFER_REASON_CATEGORIES = ['生产管理', '健康管理', '饲养管理', '其他']
  const TRANSFER_REASON_FREQUENCIES = ['高频', '中频', '低频', '临时']

  function normalizeRows(inputRows: BaseInfoRow[]) {
    const defaults = new Map<string, BaseInfoRow>()
    props.records.forEach((record) => {
      recordIdentityKeys(record as BaseInfoRow).forEach((key) =>
        defaults.set(key, record as BaseInfoRow)
      )
    })
    return inputRows
      .map((row) => {
        const normalized = normalizeAliases(row)
        const fallback: BaseInfoRow = recordIdentityKeys(normalized)
          .map((key) => defaults.get(key))
          .find(Boolean) || { id: '', name: '' }
        const next = normalizeRowByTable({ ...fallback, ...normalized })
        editableColumns.value.forEach((column) => {
          const fallbackValue = readColumnValue(fallback, column)
          if (isBlank(next[column.prop]) && !isBlank(fallbackValue)) {
            next[column.prop] = fallbackValue
          }
          if (column.prop === 'status' && isBlank(next[column.prop])) {
            const activeValue = next.isActive ?? next.is_active
            if (activeValue !== undefined) {
              next[column.prop] = statusLabelFromActive(
                Boolean(activeValue),
                optionValuesForColumn(column)
              )
            }
          }
          if (isBlank(next[column.prop]) && column.defaultValue !== undefined) {
            next[column.prop] = column.defaultValue
          }
          const optionValues = optionValuesForColumn(column)
          if (isBlank(next[column.prop]) && optionValues.length) {
            next[column.prop] = optionValues[0]
          } else if (!isBlank(next[column.prop]) && optionValues.length) {
            next[column.prop] =
              column.prop === 'status'
                ? normalizeBaseInfoStatus(next[column.prop], optionValues)
                : canonicalOptionValue(next[column.prop], optionValues)
          }
        })
        return next
      })
      .filter((row) => !props.recordFilter || props.recordFilter(row))
  }

  function normalizeRowByTable(row: BaseInfoRow) {
    if (props.directCategoryRecords) return normalizeDirectCategoryRow(row)
    if (props.tableName === 'pens') return normalizePenRow(row)
    if (props.tableName === 'persons') return normalizePersonRow(row)
    if (props.tableName === 'diseases') return normalizeDiseaseRow(row)
    if (props.tableName === 'medicines') return normalizeMedicineRow(row)
    if (props.tableName === 'transfer-reasons') return normalizeTransferReasonRow(row)
    return row
  }

  function normalizeDirectCategoryRow(row: BaseInfoRow) {
    const next: BaseInfoRow = { ...row }
    const name = firstText(next.name, next.label, next.value, next.code)
    if (name) {
      next.name = name
      if (isBlank(next.label)) next.label = name
      if (isBlank(next.value)) next.value = name
      if (isBlank(next.code)) next.code = name
    }
    next.scope = firstText(next.scope, directRecordScope.value)
    next.categoryName = firstText(
      next.categoryName,
      next.category,
      next.parentName,
      next.parent_name
    )
    next.status =
      normalizeBaseInfoStatus(firstText(next.status, next.state), ['启用', '停用']) || '启用'
    next.isActive = next.status !== '停用'
    return next
  }

  function normalizePenRow(row: BaseInfoRow) {
    const next: BaseInfoRow = { ...row }
    const name = firstText(
      next.name,
      next.penName,
      next.unitName,
      next.unit_name,
      next.code,
      next.penCode,
      next.unitCode
    )
    if (name) next.name = name
    const rawCategory = firstText(
      next.category,
      next.categoryName,
      next.category_name,
      next.type,
      next.unitType,
      next.unit_type
    )
    next.category = categoryValueOrNormalized(rawCategory, () =>
      normalizePenCategory(rawCategory, name)
    )
    if (isBlank(next.categoryName)) next.categoryName = next.category
    next.status =
      normalizeBaseInfoStatus(firstText(next.status, next.state), ['正常', '维护中', '停用']) ||
      '正常'
    next.isActive = next.status !== '停用'
    return next
  }

  function normalizePersonRow(row: BaseInfoRow) {
    const next: BaseInfoRow = { ...row }
    const name = firstText(next.name, next.personName, next.realName, next.nickname, next.username)
    if (name) next.name = name
    const department = firstText(
      next.department,
      next.departmentName,
      next.department_name,
      next.dept
    )
    if (department) next.department = department
    const rawRole = firstText(
      next.role,
      next.roleName,
      next.role_name,
      next.position,
      next.title,
      next.category,
      next.categoryName
    )
    next.role = categoryValueOrNormalized(rawRole, () =>
      normalizePersonRole(rawRole, firstText(next.department, next.name))
    )
    next.status =
      normalizeBaseInfoStatus(firstText(next.status, next.state), ['正常', '停用', '离职']) ||
      '正常'
    next.isActive = next.status !== '停用' && next.status !== '离职'
    return next
  }

  function normalizeDiseaseRow(row: BaseInfoRow) {
    const next: BaseInfoRow = { ...row }
    const name = firstText(next.name, next.diseaseName, next.disease_name, next.diagnosis)
    if (name) next.name = name
    const rawCategory = firstText(
      next.category,
      next.categoryName,
      next.category_name,
      next.type,
      next.diseaseType,
      next.disease_type
    )
    next.category = categoryValueOrNormalized(rawCategory, () =>
      normalizeDiseaseCategory(rawCategory, firstText(next.name, next.symptoms, next.treatment))
    )
    if (isBlank(next.categoryName)) next.categoryName = next.category
    next.status =
      normalizeBaseInfoStatus(firstText(next.status, next.state), ['启用', '停用']) || '启用'
    next.isActive = next.status !== '停用'
    return next
  }

  function normalizeMedicineRow(row: BaseInfoRow) {
    const next: BaseInfoRow = { ...row }
    const name = firstText(
      next.name,
      next.medicineName,
      next.medicine_name,
      next.code,
      next.medicineCode,
      next.medicine_code
    )
    if (name) next.name = name
    const rawCategory = firstText(
      next.category,
      next.categoryName,
      next.category_name,
      next.type,
      next.medicineType,
      next.medicine_type
    )
    next.category = categoryValueOrNormalized(rawCategory, () =>
      normalizeMedicineCategory(
        rawCategory,
        firstText(next.name, next.usage, next.usageText, next.usage_text)
      )
    )
    if (isBlank(next.categoryName)) next.categoryName = next.category
    next.status =
      normalizeBaseInfoStatus(firstText(next.status, next.state), ['启用', '停用']) || '启用'
    next.isActive = next.status !== '停用'
    return next
  }

  function normalizeTransferReasonRow(row: BaseInfoRow) {
    const next: BaseInfoRow = { ...row }
    const name = firstText(
      next.name,
      next.reason,
      next.reasonName,
      next.reason_name,
      next.title,
      next.label
    )
    if (name) {
      next.name = name
      if (isBlank(next.reason)) next.reason = name
    }

    const rawCategory =
      firstText(
        next.category,
        next.categoryName,
        next.category_name,
        next.reasonType,
        next.reason_type,
        next.type
      ) || inferTransferReasonCategory(name, firstText(next.description, next.remark, next.notes))
    next.category = categoryValueOrNormalized(rawCategory, () =>
      canonicalTransferReasonCategory(rawCategory)
    )
    if (isBlank(next.categoryName)) next.categoryName = next.category

    const frequency =
      firstText(
        next.frequency,
        next.usageFrequency,
        next.usage_frequency,
        next.useFrequency,
        next.use_frequency
      ) || inferTransferReasonFrequency(name, String(next.category || ''))
    next.frequency = canonicalTransferReasonFrequency(frequency)

    const status = firstText(next.status, next.state)
    if (status) {
      next.status = canonicalOptionValue(status, ['启用', '停用'])
    } else if (next.isActive !== undefined || next.is_active !== undefined) {
      next.status = statusLabelFromActive(Boolean(next.isActive ?? next.is_active), [
        '启用',
        '停用'
      ])
    } else {
      next.status = '启用'
    }
    next.isActive = next.status !== '停用'
    return next
  }

  function normalizeAliases(row: BaseInfoRow) {
    const next: BaseInfoRow = { ...row }
    props.columns.forEach((column) => {
      const value = readColumnValue(row, column)
      if (!isBlank(value)) next[column.prop] = value
    })
    return next
  }

  function recordIdentityKeys(row: BaseInfoRow) {
    return [row.name, row.reason, row.reasonName, row.reason_name, row.code, row.id]
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
  }

  function readColumnValue(row: BaseInfoRow, column: BaseInfoColumn) {
    const keys = [column.prop, ...(column.aliases || [])]
    return keys.map((key) => row[key]).find((value) => !isBlank(value))
  }

  function firstText(...values: unknown[]) {
    return values.map((value) => String(value ?? '').trim()).find(Boolean) || ''
  }

  function isBlank(value: unknown) {
    return value === undefined || value === null || String(value).trim() === ''
  }

  const GENERIC_CATEGORY_RE = /^(general|other|others|unknown|uncategorized|未分类|其他|其它)$/i

  function categoryValueOrNormalized(value: unknown, normalize: () => string) {
    const raw = String(value ?? '').trim()
    if (!raw) return normalize()
    const matched = categoryRows.value.find(
      (item) => item.name === raw || item.name.toLowerCase() === raw.toLowerCase()
    )
    if (matched?.name) return matched.name
    return GENERIC_CATEGORY_RE.test(raw) ? normalize() : raw
  }

  function selectedFilterCategory() {
    const raw = String(filters.category || '').trim()
    if (!raw) return ''
    const matched = categoryRows.value.find(
      (item) => item.name === raw || item.name.toLowerCase() === raw.toLowerCase()
    )
    return matched?.name || ''
  }

  function selectedCategoryRow() {
    const category = selectedFilterCategory()
    return categoryRows.value.find((item) => item.name === category)
  }

  function sortCategories(input: BaseInfoCategory[]) {
    const byParent = new Map<string, BaseInfoCategory[]>()
    input.forEach((item) => {
      const parentId = String(item.parentId || item.parent_id || '')
      const normalized = {
        ...item,
        parentId,
        parentName: String(item.parentName || item.parent_name || ''),
        level: Number(item.level || (parentId ? 2 : 1)) || 1
      }
      byParent.set(parentId, [...(byParent.get(parentId) || []), normalized])
    })
    const result: BaseInfoCategory[] = []
    const visit = (parentId: string) => {
      ;(byParent.get(parentId) || [])
        .sort((left, right) => String(left.name).localeCompare(String(right.name), 'zh-CN'))
        .forEach((item) => {
          result.push(item)
          visit(item.id)
        })
    }
    visit('')
    input.forEach((item) => {
      if (!result.some((row) => row.id === item.id)) result.push(item)
    })
    return result
  }

  function categoryOptionLabel(item: BaseInfoCategory) {
    return `${Number(item.level || 1) > 1 ? '  └ ' : ''}${item.name}`
  }

  function categoryDescription(item: BaseInfoCategory) {
    if (item.parentName || item.parent_name) return `上级：${item.parentName || item.parent_name}`
    return item.description || '场内基础资料分类'
  }

  function categoryInUse(categoryName: string) {
    return rows.value.some(
      (row) =>
        row.categoryName === categoryName ||
        row.category === categoryName ||
        row.role === categoryName
    )
  }

  function selectOptionsForField(field: BaseInfoColumn) {
    return optionValuesForColumn(field).map((value) => ({ label: value, value }))
  }

  function optionValuesForColumn(column: BaseInfoColumn) {
    if (column.prop === categoryField.value) {
      return categoryRows.value.map((item) => item.name).filter(Boolean)
    }
    return Array.from(column.options || [])
  }

  function canonicalOptionValue(value: unknown, options: string[]) {
    const raw = String(value ?? '').trim()
    const exact = options.find((item) => item === raw)
    if (exact) return exact
    const byCase = options.find((item) => item.toLowerCase() === raw.toLowerCase())
    return byCase || raw
  }

  function canonicalTransferReasonCategory(value: unknown) {
    const raw = String(value ?? '').trim()
    if (/健康|疾病|隔离|治疗|疫苗|康复|防疫|检疫|乳房炎|蹄|死亡/.test(raw)) return '健康管理'
    if (
      /生产|繁殖|泌乳|干奶|妊娠|配种|分娩|断奶|出生|购入|入群|转群|阶段|品种|犊牛|育成|育肥|公牛|待产/.test(
        raw
      )
    )
      return '生产管理'
    if (/饲|料|日粮|营养|体况|采食|育肥/.test(raw)) return '饲养管理'
    if (TRANSFER_REASON_CATEGORIES.includes(raw)) return raw
    return '其他'
  }

  function canonicalTransferReasonFrequency(value: unknown) {
    const raw = String(value ?? '').trim()
    if (TRANSFER_REASON_FREQUENCIES.includes(raw)) return raw
    if (/高|常用|频繁|日常/.test(raw)) return '高频'
    if (/低|少|偶发/.test(raw)) return '低频'
    if (/临|暂|一次|应急/.test(raw)) return '临时'
    return '中频'
  }

  function inferTransferReasonCategory(name: string, description = '') {
    const text = `${name} ${description}`
    if (/疾病|隔离|治疗|疫苗|康复|防疫|检疫|乳房炎|蹄|伤|死亡|病/.test(text)) return '健康管理'
    if (
      /出生|购入|入群|转入|新购|泌乳|干奶|妊娠|配种|分娩|产犊|断奶|阶段|品种|繁殖|生产|犊牛|育成|公牛|待产/.test(
        text
      )
    )
      return '生产管理'
    if (/饲|料|日粮|营养|体况|采食|膘情|育肥/.test(text)) return '饲养管理'
    return '其他'
  }

  function inferTransferReasonFrequency(name: string, category: string) {
    const text = `${name} ${category}`
    if (/管理调整|临时/.test(text)) return '临时'
    if (/维修|场地|出售|淘汰|死亡|临时|管理调整/.test(text)) return '低频'
    if (/泌乳|断奶|出生|入群|阶段/.test(text)) return '高频'
    if (/疾病|隔离|康复|干奶|疫苗|品种|饲|分娩|妊娠|配种|体重|转群/.test(text)) return '中频'
    return '中频'
  }

  function statusLabelFromActive(active: boolean, options: string[]) {
    if (!active) return options.find((item) => ['停用', '离职', '禁用'].includes(item)) || '停用'
    return options.find((item) => ['启用', '正常', '在职'].includes(item)) || options[0] || '启用'
  }

  async function backfillNormalizedRows(
    originalRows: BaseInfoRow[],
    normalizedRows: BaseInfoRow[]
  ) {
    if (!props.tableName) return
    const originalById = new Map(originalRows.map((row) => [String(row.id), row]))
    await Promise.all(
      normalizedRows.map((row) => {
        const original = originalById.get(String(row.id))
        if (!original) return Promise.resolve()
        const changed = editableColumns.value.some(
          (column) => String(original[column.prop] ?? '') !== String(row[column.prop] ?? '')
        )
        if (!changed) return Promise.resolve()
        return databaseService
          .updateTableRecordAsync(props.tableName!, row.id, {
            ...row,
            updatedAt: new Date().toISOString()
          })
          .catch(() => undefined)
      })
    )
  }

  const resetForm = () => {
    editingId.value = ''
    Object.keys(form).forEach((key) => delete form[key])
  }

  const resetCategoryForm = () => {
    categoryForm.parentId = ''
    categoryForm.name = ''
    categoryForm.description = ''
  }

  const openCreateDialog = () => {
    resetForm()
    const selectedCategory = selectedFilterCategory()
    editableColumns.value.forEach((column) => {
      const optionValues = optionValuesForColumn(column)
      if (column.type === 'boolean') {
        form[column.prop] = Boolean(column.defaultValue)
      } else if (column.prop === categoryField.value && selectedCategory) {
        form[column.prop] = selectedCategory
      } else if (column.defaultValue !== undefined) {
        form[column.prop] = column.defaultValue
      } else if (optionValues.length) {
        form[column.prop] = optionValues[0]
      } else {
        form[column.prop] = ''
      }
    })
    dialogVisible.value = true
  }

  const openCategoryDialog = () => {
    resetCategoryForm()
    const selected = selectedCategoryRow()
    categoryForm.parentId =
      selected?.level === 1 ? selected.id : selected?.parentId || selected?.parent_id || ''
    categoryDialogVisible.value = true
  }

  const openEditDialog = (row: BaseInfoRow) => {
    resetForm()
    editingId.value = row.id
    editableColumns.value.forEach((column) => {
      const value = row[column.prop]
      form[column.prop] =
        typeof value === 'number' || typeof value === 'boolean' ? value : String(value ?? '')
    })
    dialogVisible.value = true
  }

  const submitForm = async () => {
    const missing = editableColumns.value.find(
      (column) => column.required && !String(form[column.prop] ?? '').trim()
    )
    if (missing) {
      ElMessage.warning(`${missing.label}不能为空`)
      return
    }
    const payload: BaseInfoRow = {
      id: editingId.value || `row-${Date.now()}`,
      name: String(form.name || '未命名'),
      updatedAt: new Date().toISOString()
    }
    editableColumns.value.forEach((column) => {
      payload[column.prop] = form[column.prop]
    })
    const selectedCategory = selectedFilterCategory()
    if (selectedCategory && isBlank(payload[categoryField.value])) {
      payload[categoryField.value] = selectedCategory
    }
    if (payload.status !== undefined) {
      payload.isActive = !['停用', '离职', '禁用', 'disabled', 'inactive'].includes(
        String(payload.status)
      )
    }
    if (props.directCategoryRecords) Object.assign(payload, directCategoryPayload(payload))

    try {
      if (props.directCategoryRecords) {
        const table = 'base-info-categories'
        if (editingId.value) {
          await databaseService.updateTableRecordAsync(table, editingId.value, payload)
        } else {
          await databaseService.addTableDataAsync(table, {
            ...payload,
            createdAt: new Date().toISOString()
          })
        }
        rows.value = normalizeRows(
          (await databaseService.getTableDataAsync(table, { silent: true }))
            .filter((item) => item.scope === directRecordScope.value)
            .map((item) => ({ ...item })) as BaseInfoRow[]
        )
      } else if (props.tableName) {
        if (editingId.value) {
          await databaseService.updateTableRecordAsync(props.tableName, editingId.value, payload)
        } else {
          await databaseService.addTableDataAsync(props.tableName, {
            ...payload,
            createdAt: new Date().toISOString()
          })
        }
        rows.value = normalizeRows(
          (await databaseService.getTableDataAsync(props.tableName, { silent: true })).map(
            (item) => ({ ...item })
          ) as BaseInfoRow[]
        )
      } else if (editingId.value) {
        rows.value = rows.value.map((item) => (item.id === editingId.value ? payload : item))
      } else {
        rows.value.unshift(payload)
      }
      emit('saved', payload)
      dialogVisible.value = false
      ElMessage.success(`${props.entityLabel}资料已保存`)
    } catch (error) {
      console.error(`保存${props.entityLabel}基础资料失败:`, error)
      ElMessage.error(`保存${props.entityLabel}基础资料失败`)
    }
  }

  const submitCategoryForm = async () => {
    const name = categoryForm.name.trim()
    if (!name) {
      ElMessage.warning(`${props.categoryLabel}不能为空`)
      return
    }
    if (categoryRows.value.some((item) => item.name === name)) {
      ElMessage.warning(`${props.categoryLabel}已存在`)
      return
    }
    const parent = categoryRows.value.find((item) => item.id === categoryForm.parentId)
    const payload = {
      id: `${categoryScope.value}-category-${Date.now()}`,
      scope: categoryScope.value,
      name,
      parentId: parent?.id || '',
      parent_id: parent?.id || '',
      parentName: parent?.name || '',
      parent_name: parent?.name || '',
      level: parent ? 2 : 1,
      description: categoryForm.description.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    try {
      await databaseService.addTableDataAsync('base-info-categories', payload)
    } catch (error) {
      console.error(`新增${props.categoryLabel}失败:`, error)
      ElMessage.error(`新增${props.categoryLabel}失败，请检查数据库连接`)
      return
    }
    categoryRows.value = sortCategories([
      ...categoryRows.value,
      {
        id: payload.id,
        name: payload.name,
        description: payload.description,
        parentId: payload.parentId,
        parentName: payload.parentName,
        level: payload.level
      }
    ])
    categoryDialogVisible.value = false
    ElMessage.success(`${props.categoryLabel}已新增`)
  }

  const removeCategory = async (category: BaseInfoCategory) => {
    if (categoryInUse(category.name)) {
      ElMessage.warning(`该${props.categoryLabel}下已有${props.entityLabel}，请先迁移或删除记录`)
      return
    }
    try {
      await databaseService.deleteTableRecordAsync('base-info-categories', category.id)
      categoryRows.value = categoryRows.value.filter((item) => item.id !== category.id)
      if (filters.category === category.name) filters.category = ''
      ElMessage.success(`${props.categoryLabel}已删除`)
    } catch (error) {
      console.error(`删除${props.categoryLabel}失败:`, error)
      ElMessage.error(`删除${props.categoryLabel}失败，请检查数据库连接`)
    }
  }

  const removeRow = async (id: string) => {
    try {
      if (props.directCategoryRecords) {
        await databaseService.deleteTableRecordAsync('base-info-categories', id)
        rows.value = normalizeRows(
          (await databaseService.getTableDataAsync('base-info-categories', { silent: true }))
            .filter((item) => item.scope === directRecordScope.value)
            .map((item) => ({ ...item })) as BaseInfoRow[]
        )
      } else if (props.tableName) {
        await databaseService.deleteTableRecordAsync(props.tableName, id)
        rows.value = normalizeRows(
          (await databaseService.getTableDataAsync(props.tableName, { silent: true })).map(
            (item) => ({ ...item })
          ) as BaseInfoRow[]
        )
      } else {
        rows.value = rows.value.filter((item) => item.id !== id)
      }
      emit('removed', id)
      ElMessage.success(`${props.entityLabel}资料已删除`)
    } catch (error) {
      console.error(`删除${props.entityLabel}基础资料失败:`, error)
      ElMessage.error(`删除${props.entityLabel}基础资料失败`)
    }
  }

  function directCategoryPayload(row: BaseInfoRow) {
    const name = firstText(row.name, row.label, row.value, row.code)
    const code = firstText(row.code, row.value, name)
    const value = firstText(row.value, row.code, name)
    const label = firstText(row.label, name, value)
    const status = firstText(row.status) || '启用'
    const category = firstText(row.categoryName, row.category)
    const sortOrder = Number(row.sortOrder || row.sort_order || 0) || undefined
    return {
      ...row,
      id: String(row.id || `${directRecordScope.value}-${Date.now()}`),
      scope: directRecordScope.value,
      code,
      value,
      name,
      label,
      category,
      status,
      isActive: status !== '停用',
      is_active: status !== '停用',
      sortOrder,
      sort_order: sortOrder,
      payload: {
        ...(typeof row.payload === 'object' ? row.payload : {}),
        scope: directRecordScope.value,
        code,
        value,
        name,
        label,
        category,
        status,
        sortOrder,
        isActive: status !== '停用',
        updatedAt: new Date().toISOString()
      }
    }
  }

  const getTagType = (value: unknown) => {
    const text = String(value)
    if (['重度', '停用', '高频', '隔离', '管理员'].some((item) => text.includes(item)))
      return 'danger'
    if (['中度', '维护中', '中频', '兽医'].some((item) => text.includes(item))) return 'warning'
    if (['正常', '启用', '低频', '产房', '泌乳'].some((item) => text.includes(item)))
      return 'success'
    return 'info'
  }

  onMounted(async () => {
    await loadCategories()
    await loadRows()
  })
</script>

<style scoped lang="scss">
  .base-info-layout {
    display: grid;
    grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
    gap: 18px;
    min-width: 0;
  }

  .base-info-layout > * {
    min-width: 0;
  }

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

  .filter-form {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .category-panel {
    display: grid;
    align-content: start;
    gap: 10px;
  }

  .panel-title {
    color: var(--fluent-text);
    font-size: 15px;
    font-weight: 700;
  }

  .panel-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .category-list {
    display: grid;
    gap: 10px;
  }

  .category-item {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 8px;
    width: 100%;
    padding: 12px;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius-sm);
    transition:
      border-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
      background 180ms cubic-bezier(0.16, 1, 0.3, 1);

    &:hover {
      background: rgb(var(--fluent-primary-rgb) / 10%);
      border-color: var(--fluent-border-strong);
    }

    &.active {
      background: rgb(var(--fluent-primary-rgb) / 10%);
      border-color: var(--fluent-border-strong);
    }
  }

  .category-main {
    display: grid;
    gap: 4px;
    min-width: 0;
    padding: 0;
    text-align: left;
    cursor: pointer;
    background: transparent;
    border: 0;

    span {
      color: var(--fluent-text);
      font-weight: 650;
    }

    small {
      color: var(--fluent-text-soft);
      line-height: 1.5;
    }
  }

  .category-delete {
    opacity: 0;
    transition: opacity 160ms ease;
  }

  .category-item:hover .category-delete {
    opacity: 1;
  }

  .table-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;

    h2 {
      margin: 0;
      color: var(--fluent-text);
      font-size: 18px;
    }

    p {
      margin: 4px 0 0;
      color: var(--fluent-text-soft);
    }
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 12px;
  }

  .mobile-record-list {
    display: none;
  }

  @media (max-width: 960px) {
    .base-info-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .fluent-page-header {
      align-items: stretch;
      flex-direction: column;
    }

    .fluent-page-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      width: 100%;

      :deep(.el-button) {
        width: 100%;
        margin: 0;
      }
    }

    .fluent-metric-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .filter-form {
      display: grid;
      grid-template-columns: minmax(0, 1fr);

      :deep(.el-form-item),
      :deep(.el-form-item__content),
      :deep(.el-input),
      :deep(.el-select) {
        width: 100%;
        min-width: 0;
        margin-right: 0;
      }
    }

    .desktop-record-table {
      display: none;
    }

    .mobile-record-list {
      display: grid;
    }

    .mobile-record-row {
      padding: 14px 0;
      border-bottom: 1px solid var(--fluent-border);

      &:first-child {
        padding-top: 0;
      }

      &:last-child {
        border-bottom: 0;
      }

      dl {
        display: grid;
        gap: 9px;
        margin: 0;
      }
    }

    .mobile-record-field {
      display: grid;
      grid-template-columns: minmax(72px, 0.38fr) minmax(0, 1fr);
      gap: 12px;
      align-items: start;

      dt {
        color: var(--fluent-text-soft);
      }

      dd {
        min-width: 0;
        margin: 0;
        color: var(--fluent-text);
        overflow-wrap: anywhere;
      }
    }

    .mobile-record-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 14px;

      :deep(.el-button) {
        margin: 0;
      }
    }
  }
</style>
