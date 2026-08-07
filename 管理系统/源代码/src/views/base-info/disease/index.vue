<template>
  <FluentBaseInfoPage
    title="发病信息管理"
    description="疾病字典"
    entity-label="疾病"
    category-label="疾病类型"
    :categories="categories"
    :columns="columns"
    :records="records"
    table-name="diseases"
  />
</template>

<script setup lang="ts">
  import FluentBaseInfoPage from '../components/FluentBaseInfoPage.vue'
  import { DISEASE_CATEGORY_OPTIONS } from '@/utils/base-info-normalizers'

  const categoryDescriptions: Record<string, string> = {
    传染病: '具备传播风险，需要隔离与追踪',
    寄生虫病: '体内外寄生虫引起的疾病',
    代谢病: '饲喂、泌乳和营养代谢相关',
    营养缺乏病: '维生素、矿物质等缺乏风险',
    中毒: '饲草、水源或化学因素导致的中毒',
    乳房疾病: '乳房炎、乳腺损伤和奶质异常相关',
    繁殖疾病: '子宫、胎衣、流产和产后恢复相关',
    外伤: '创伤、蹄病和机械性损伤'
  }

  const categories = DISEASE_CATEGORY_OPTIONS.map((name, index) => ({
    id: String(index + 1),
    name,
    description: categoryDescriptions[name] || '疾病基础分类'
  }))

  const columns = [
    {
      prop: 'name',
      label: '疾病名称',
      minWidth: 140,
      required: true,
      aliases: ['diseaseName', 'disease_name', 'diagnosis']
    },
    {
      prop: 'category',
      label: '疾病类型',
      type: 'tag',
      minWidth: 120,
      required: true,
      options: DISEASE_CATEGORY_OPTIONS,
      aliases: ['type', 'diseaseType', 'disease_type', 'categoryName']
    },
    {
      prop: 'severity',
      label: '严重程度',
      type: 'tag',
      minWidth: 110,
      required: true,
      options: ['轻度', '中度', '重度'],
      aliases: ['level'],
      defaultValue: '中度'
    },
    { prop: 'contagious', label: '传染性', type: 'boolean', minWidth: 90 },
    { prop: 'symptoms', label: '主要症状', minWidth: 220 },
    { prop: 'treatment', label: '处置建议', minWidth: 220 },
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
      id: 'd1',
      name: '牛结节性皮肤病',
      category: '传染病',
      severity: '重度',
      contagious: true,
      status: '启用',
      symptoms: '发热、皮肤结节、淋巴结肿大',
      treatment: '隔离观察，执行免疫与消毒流程'
    },
    {
      id: 'd2',
      name: '瘤胃积食',
      category: '代谢病',
      severity: '中度',
      contagious: false,
      status: '启用',
      symptoms: '采食下降、瘤胃胀满、反刍减少',
      treatment: '调整日粮，必要时进行瘤胃处理'
    },
    {
      id: 'd3',
      name: '肝片吸虫病',
      category: '寄生虫病',
      severity: '中度',
      contagious: false,
      status: '启用',
      symptoms: '消瘦、贫血、被毛粗乱',
      treatment: '按兽医方案驱虫并复查'
    }
  ]

  defineOptions({ name: 'DiseaseInfo' })
</script>
