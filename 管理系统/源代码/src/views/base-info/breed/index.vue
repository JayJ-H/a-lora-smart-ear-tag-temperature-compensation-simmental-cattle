<template>
  <FluentBaseInfoPage
    title="品种信息管理"
    description="品种字典"
    entity-label="品种"
    category-label="品种类型"
    :categories="categories"
    :columns="columns"
    :records="records"
    :record-filter="isSupportedBreedRow"
    table-name="breed-types"
  />
</template>

<script setup lang="ts">
  import FluentBaseInfoPage from '../components/FluentBaseInfoPage.vue'
  import { SUPPORTED_CATTLE_BREEDS, normalizeCattleBreed } from '@/utils/cattle-breeds'

  const categories = [
    { id: 'beef', name: '肉用', description: '以肉用性能为主' },
    { id: 'dual', name: '兼用', description: '兼顾肉用和乳用性能' }
  ]

  const columns = [
    {
      prop: 'name',
      label: '品种名称',
      minWidth: 150,
      required: true,
      options: SUPPORTED_CATTLE_BREEDS,
      aliases: ['breedName', 'breed_name', 'code']
    },
    {
      prop: 'category',
      label: '品种类型',
      type: 'tag',
      minWidth: 110,
      required: true,
      options: categories.map((item) => item.name),
      aliases: ['type', 'breedType', 'breed_type', 'categoryName']
    },
    { prop: 'origin', label: '来源', minWidth: 120 },
    {
      prop: 'purpose',
      label: '用途',
      minWidth: 120,
      aliases: ['usage', 'direction']
    },
    {
      prop: 'status',
      label: '状态',
      type: 'tag',
      minWidth: 90,
      required: true,
      options: ['启用', '停用'],
      defaultValue: '启用'
    },
    { prop: 'notes', label: '备注', minWidth: 180 }
  ] as const

  const records = [
    {
      id: 'breed-simmental',
      name: '西门塔尔牛',
      category: '兼用',
      origin: '引进',
      purpose: '肉乳兼用',
      status: '启用'
    },
    {
      id: 'breed-huaxi',
      name: '华西牛',
      category: '肉用',
      origin: '中国',
      purpose: '肉用',
      status: '启用'
    }
  ]

  const isSupportedBreedRow = (row: Record<string, unknown>) =>
    Boolean(normalizeCattleBreed(row.name || row.breedName || row.breed_name || row.code))

  defineOptions({ name: 'BreedInfo' })
</script>
