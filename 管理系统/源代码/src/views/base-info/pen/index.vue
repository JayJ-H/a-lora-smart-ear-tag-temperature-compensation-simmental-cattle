<template>
  <FluentBaseInfoPage
    :key="pageKey"
    title="圈舍信息管理"
    description="圈舍字典"
    entity-label="圈舍"
    category-label="圈舍类别"
    :categories="categories"
    :columns="columns"
    :records="records"
    table-name="pens"
    @saved="syncFarmUnit"
    @removed="removeFarmUnit"
  />
</template>

<script setup lang="ts">
  import { onMounted, ref } from 'vue'
  import FluentBaseInfoPage from '../components/FluentBaseInfoPage.vue'
  import {
    normalizeBaseInfoStatus,
    normalizePenCategory,
    PEN_CATEGORY_OPTIONS
  } from '@/utils/base-info-normalizers'
  import * as databaseService from '@/services/database'

  const categoryDescriptions: Record<string, string> = {
    犊牛舍: '出生至断奶阶段牛只管理',
    育成舍: '育成和后备牛只圈舍',
    育肥舍: '育肥阶段牛只圈舍',
    公牛舍: '种公牛和公牛单元管理',
    配种舍: '发情、输精和配种牛只管理',
    妊娠舍: '妊娠期牛只管理',
    产房: '分娩与围产期护理',
    泌乳舍: '泌乳牛只生产圈舍',
    干奶舍: '干奶期牛只管理',
    隔离舍: '健康异常牛只隔离观察',
    挤奶厅: '奶厅和挤奶设备所在单元',
    饲喂中心: 'TMR、饲喂和日粮作业单元',
    备用舍: '临时周转和备用圈舍'
  }

  const categories = PEN_CATEGORY_OPTIONS.map((name, index) => ({
    id: String(index + 1),
    name,
    description: categoryDescriptions[name] || '场内圈舍分类'
  }))

  const pageKey = ref(0)

  const columns = [
    {
      prop: 'name',
      label: '圈舍名称',
      minWidth: 130,
      required: true,
      aliases: ['penName', 'unitName', 'unit_name', 'code', 'penCode', 'unitCode']
    },
    {
      prop: 'category',
      label: '圈舍类别',
      type: 'tag',
      minWidth: 120,
      required: true,
      options: PEN_CATEGORY_OPTIONS,
      aliases: ['type', 'unitType', 'unit_type', 'categoryName']
    },
    { prop: 'capacity', label: '容量', minWidth: 90 },
    { prop: 'area', label: '面积', minWidth: 90 },
    {
      prop: 'manager',
      label: '负责人',
      minWidth: 110,
      aliases: ['managerName', 'keeper', 'person']
    },
    {
      prop: 'status',
      label: '状态',
      type: 'tag',
      minWidth: 100,
      required: true,
      options: ['正常', '维护中', '停用'],
      defaultValue: '正常'
    }
  ] as const

  const records = [
    {
      id: 'p1',
      name: 'A01 育成舍',
      category: '育成舍',
      capacity: 50,
      area: 200,
      manager: '张三',
      status: '正常'
    },
    {
      id: 'p2',
      name: 'B01 配种舍',
      category: '配种舍',
      capacity: 32,
      area: 150,
      manager: '李四',
      status: '正常'
    },
    {
      id: 'p3',
      name: 'D01 产房',
      category: '产房',
      capacity: 18,
      area: 96,
      manager: '赵六',
      status: '正常'
    },
    {
      id: 'p4',
      name: 'E01 隔离舍',
      category: '隔离舍',
      capacity: 10,
      area: 64,
      manager: '孙七',
      status: '维护中'
    },
    {
      id: 'p5',
      name: 'F01 备用舍',
      category: '备用舍',
      capacity: 20,
      area: 120,
      manager: '张饲',
      status: '正常'
    }
  ]

  async function syncFarmUnit(row: Record<string, any>) {
    const id = String(row.id || row.code || row.name || '').trim()
    if (!id || isVisualAcceptancePen(row)) return
    const status = String(row.status || '正常')
    const payload = {
      id,
      code: String(row.code || row.unitCode || row.unit_code || id),
      name: String(row.name || row.penName || row.pen_name || id),
      unitName: String(row.name || row.penName || row.pen_name || id),
      unit_name: String(row.name || row.penName || row.pen_name || id),
      category: String(row.category || row.categoryName || row.type || ''),
      unitType: String(row.category || row.categoryName || row.type || ''),
      unit_type: String(row.category || row.categoryName || row.type || ''),
      capacity: row.capacity || '',
      area: row.area || '',
      manager: row.manager || '',
      status,
      isActive: !['停用', '维护中', '禁用', 'disabled', 'inactive'].includes(status),
      sourceTable: 'pens',
      source_table: 'pens',
      sourceRecordId: id,
      source_record_id: id,
      updatedAt: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    const existing = await databaseService
      .getTableDataAsync('farm_unit', { silent: true })
      .catch(() => [])
    const found = existing.find((item: any) => String(item.id || '') === id)
    if (found) {
      await databaseService.updateTableRecordAsync('farm_unit', id, payload)
    } else {
      await databaseService.addTableDataAsync('farm_unit', {
        ...payload,
        createdAt: new Date().toISOString(),
        created_at: new Date().toISOString()
      })
    }
  }

  async function syncPenFromFarmUnit(row: Record<string, any>) {
    const id = text(row.id || row.code || row.name)
    const name = text(row.name || row.unitName || row.unit_name || row.code || id)
    if (!id || !name || isVisualAcceptancePen(row)) return
    const category = normalizePenCategory(
      row.category || row.categoryName || row.unitType || row.unit_type || row.locationLabel || row.location_label,
      name
    )
    const status = normalizeBaseInfoStatus(row.status, ['正常', '维护中', '停用']) || '正常'
    const payload = {
      id,
      name,
      category,
      capacity: row.capacity || '',
      area: row.area || '',
      manager: row.manager || '',
      status,
      isActive: status !== '停用',
      is_active: status !== '停用',
      createdAt: row.createdAt || row.created_at || new Date().toISOString(),
      created_at: row.created_at || row.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    const existing = await databaseService.getTableDataAsync('pens', { silent: true }).catch(() => [])
    const found = existing.find((item: any) => text(item.id) === id)
    if (found) {
      await databaseService.updateTableRecordAsync('pens', id, payload).catch(() => undefined)
    } else {
      await databaseService.addTableDataAsync('pens', payload)
    }
  }

  async function removeFarmUnit(id: string) {
    await databaseService.deleteTableRecordAsync('farm_unit', id).catch(() => undefined)
  }

  function text(value: unknown) {
    return String(value ?? '').trim()
  }

  function penIdentity(row: Record<string, any>) {
    return [
      row.id,
      row.code,
      row.name,
      row.unitName,
      row.unit_name,
      row.penName,
      row.pen_name
    ]
      .map((value) => text(value).toLowerCase())
      .filter(Boolean)
  }

  function isVisualAcceptancePen(row: Record<string, any>) {
    return penIdentity(row).some((value) => value.startsWith('vis-pen') || value.includes('可视化'))
  }

  onMounted(async () => {
    const [pens, farmUnits] = await Promise.all([
      databaseService.getTableDataAsync('pens', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('farm_unit', { silent: true }).catch(() => [])
    ])
    const existingIds = new Set((farmUnits || []).map((item: any) => String(item.id || '')))
    for (const row of pens || []) {
      const id = String(row.id || row.code || row.name || '').trim()
      if (id && !existingIds.has(id)) await syncFarmUnit(row)
    }
    const penKeys = new Set((pens || []).flatMap((item: any) => penIdentity(item)))
    for (const row of farmUnits || []) {
      if (isVisualAcceptancePen(row)) continue
      const unitKeys = penIdentity(row)
      if (unitKeys.length && !unitKeys.some((key) => penKeys.has(key))) {
        await syncPenFromFarmUnit(row)
      }
    }
    pageKey.value += 1
  })

  defineOptions({ name: 'PenInfo' })
</script>
