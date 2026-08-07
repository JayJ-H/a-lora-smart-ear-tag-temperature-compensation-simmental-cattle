<template>
  <FluentBaseInfoPage
    title="班次管理"
    description="班次字典"
    entity-label="班次"
    category-label="班次口径"
    category-scope="milk:shift-groups"
    record-scope="milk:shifts"
    :categories="categories"
    :columns="columns"
    :records="records"
    direct-category-records
  />
</template>

<script setup lang="ts">
  import FluentBaseInfoPage from '../components/FluentBaseInfoPage.vue'

  const categories = [
    { id: 'two-shift', name: '两班制', description: '一天两个挤奶班次' },
    { id: 'three-shift', name: '三班制', description: '一天三个挤奶班次' },
    { id: 'four-shift', name: '四班制', description: '一天四个挤奶班次' },
    { id: 'custom', name: '自定义', description: '按场内实际名称维护' }
  ]

  const columns = [
    {
      prop: 'name',
      label: '班次名称',
      minWidth: 130,
      required: true,
      aliases: ['label', 'value', 'code']
    },
    {
      prop: 'code',
      label: '班次编码',
      minWidth: 110,
      required: true,
      aliases: ['value']
    },
    {
      prop: 'categoryName',
      label: '班次口径',
      type: 'tag',
      minWidth: 110,
      required: true,
      options: categories.map((item) => item.name),
      aliases: ['category']
    },
    {
      prop: 'sortOrder',
      label: '排序',
      minWidth: 80,
      aliases: ['sort_order']
    },
    {
      prop: 'status',
      label: '状态',
      type: 'tag',
      minWidth: 90,
      required: true,
      options: ['启用', '停用'],
      defaultValue: '启用'
    }
  ] as const

  const records = [
    {
      id: 'milk-shift-1',
      scope: 'milk:shifts',
      name: '1',
      label: '1',
      value: '1',
      code: '1',
      categoryName: '两班制',
      sortOrder: 1,
      status: '启用'
    },
    {
      id: 'milk-shift-2',
      scope: 'milk:shifts',
      name: '2',
      label: '2',
      value: '2',
      code: '2',
      categoryName: '两班制',
      sortOrder: 2,
      status: '启用'
    },
    {
      id: 'milk-shift-3',
      scope: 'milk:shifts',
      name: '3',
      label: '3',
      value: '3',
      code: '3',
      categoryName: '三班制',
      sortOrder: 3,
      status: '停用'
    },
    {
      id: 'milk-shift-4',
      scope: 'milk:shifts',
      name: '4',
      label: '4',
      value: '4',
      code: '4',
      categoryName: '四班制',
      sortOrder: 4,
      status: '停用'
    }
  ]

  defineOptions({ name: 'MilkShiftManagement' })
</script>
