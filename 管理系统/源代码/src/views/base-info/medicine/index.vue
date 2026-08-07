<template>
  <FluentBaseInfoPage
    title="药品信息管理"
    description="药品字典"
    entity-label="药品"
    category-label="药品类型"
    :categories="categories"
    :columns="columns"
    :records="records"
    table-name="medicines"
  />
</template>

<script setup lang="ts">
  import FluentBaseInfoPage from '../components/FluentBaseInfoPage.vue'
  import { MEDICINE_CATEGORY_OPTIONS } from '@/utils/base-info-normalizers'

  const categoryDescriptions: Record<string, string> = {
    抗生素: '细菌感染处置相关药品',
    驱虫药: '体内外寄生虫防治',
    维生素: '营养补充与代谢支持',
    疫苗: '免疫预防类生物制品',
    消毒剂: '环境、器具和创面消毒',
    解热镇痛药: '退热、镇痛和抗炎处理',
    钙磷补充剂: '低钙、矿物质和围产期补充',
    激素类: '繁殖调控和内分泌相关用药'
  }

  const categories = MEDICINE_CATEGORY_OPTIONS.map((name, index) => ({
    id: String(index + 1),
    name,
    description: categoryDescriptions[name] || '药品基础分类'
  }))

  const columns = [
    {
      prop: 'name',
      label: '药品名称',
      minWidth: 150,
      required: true,
      aliases: ['medicineName', 'medicine_name', 'code', 'medicineCode', 'medicine_code']
    },
    {
      prop: 'category',
      label: '药品类型',
      type: 'tag',
      minWidth: 120,
      required: true,
      options: MEDICINE_CATEGORY_OPTIONS,
      aliases: ['type', 'medicineType', 'medicine_type', 'categoryName']
    },
    { prop: 'dosage', label: '剂量', minWidth: 140 },
    {
      prop: 'unit',
      label: '单位',
      minWidth: 90,
      options: ['mL', 'mg', 'g', 'IU', '头份', '片', '袋'],
      aliases: ['doseUnit', 'dose_unit'],
      defaultValue: 'mL'
    },
    {
      prop: 'usage',
      label: '用法用量',
      minWidth: 220,
      aliases: ['usageText', 'usage_text', 'method', 'route']
    },
    { prop: 'storage', label: '贮存条件', minWidth: 160 },
    {
      prop: 'status',
      label: '状态',
      type: 'tag',
      minWidth: 100,
      required: true,
      options: ['启用', '停用'],
      defaultValue: '启用'
    }
  ] as const

  const records = [
    {
      id: 'm1',
      name: '阿莫西林注射液',
      category: '抗生素',
      dosage: '按体重核算',
      unit: 'ml',
      status: '启用',
      usage: '遵医嘱用于呼吸道和软组织感染',
      storage: '阴凉干燥处保存'
    },
    {
      id: 'm2',
      name: '伊维菌素',
      category: '驱虫药',
      dosage: '按体重核算',
      unit: 'ml',
      status: '启用',
      usage: '用于体内外寄生虫防治',
      storage: '避光常温保存'
    },
    {
      id: 'm3',
      name: '口蹄疫疫苗',
      category: '疫苗',
      dosage: '按说明书',
      unit: '头份',
      status: '启用',
      usage: '按免疫程序接种',
      storage: '2-8 摄氏度冷藏'
    }
  ]

  defineOptions({ name: 'MedicineInfo' })
</script>
