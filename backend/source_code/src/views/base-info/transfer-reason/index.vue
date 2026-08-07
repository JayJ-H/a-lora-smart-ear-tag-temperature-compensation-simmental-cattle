<template>
  <FluentBaseInfoPage
    title="转群原因管理"
    description="转群原因字典"
    entity-label="转群原因"
    category-label="原因类型"
    :categories="categories"
    :columns="columns"
    :records="records"
    table-name="transfer-reasons"
  />
</template>

<script setup lang="ts">
  import FluentBaseInfoPage from '../components/FluentBaseInfoPage.vue'

  const categories = [
    { id: '1', name: '生产管理', description: '生产阶段变化引起的转群' },
    { id: '2', name: '健康管理', description: '隔离、康复和治疗相关转群' },
    { id: '3', name: '饲养管理', description: '饲喂策略或体况调整' },
    { id: '4', name: '其他', description: '场地维修或临时安排' }
  ]

  const columns = [
    {
      prop: 'name',
      label: '原因名称',
      minWidth: 150,
      required: true,
      aliases: ['reason', 'reasonName', 'reason_name']
    },
    {
      prop: 'category',
      label: '原因类型',
      type: 'tag',
      minWidth: 120,
      required: true,
      options: categories.map((item) => item.name),
      aliases: ['reasonType', 'reason_type', 'categoryName', 'category_name']
    },
    {
      prop: 'frequency',
      label: '使用频率',
      type: 'tag',
      minWidth: 110,
      required: true,
      options: ['高频', '中频', '低频', '临时'],
      aliases: ['usageFrequency', 'usage_frequency', 'useFrequency', 'use_frequency'],
      defaultValue: '中频'
    },
    { prop: 'description', label: '原因描述', minWidth: 260, aliases: ['remark', 'notes'] },
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
      id: 'r0b',
      name: '购入入群',
      category: '生产管理',
      frequency: '低频',
      description: '外购或引种牛只入群',
      status: '启用',
      isActive: true
    },
    {
      id: 'r0c',
      name: '胚胎移植入群',
      category: '生产管理',
      frequency: '低频',
      description: '胚胎移植来源个体进入本场管理',
      status: '启用',
      isActive: true
    },
    {
      id: 'r1',
      name: '断奶转群',
      category: '生产管理',
      frequency: '高频',
      description: '犊牛达到断奶条件后转入育成舍',
      status: '启用',
      isActive: true
    },
    {
      id: 'r2',
      name: '妊娠转群',
      category: '生产管理',
      frequency: '中频',
      description: '确认妊娠后转入妊娠舍',
      status: '启用',
      isActive: true
    },
    {
      id: 'r3',
      name: '疾病隔离',
      category: '健康管理',
      frequency: '中频',
      description: '异常牛只进入隔离舍观察和处置',
      status: '启用',
      isActive: true
    },
    {
      id: 'r4',
      name: '场地维修',
      category: '其他',
      frequency: '低频',
      description: '原圈舍维护期间临时调整',
      status: '启用',
      isActive: true
    },
    {
      id: 'r5',
      name: '泌乳转群',
      category: '生产管理',
      frequency: '高频',
      description: '牛只进入泌乳期，需要转入泌乳圈',
      status: '启用',
      isActive: true
    },
    {
      id: 'r6',
      name: '干奶转群',
      category: '生产管理',
      frequency: '中频',
      description: '牛只停止泌乳，需要转入干奶圈',
      status: '启用',
      isActive: true
    },
    {
      id: 'r7',
      name: '配种转群',
      category: '生产管理',
      frequency: '中频',
      description: '牛只发情或进入配种流程，需要转入配种圈',
      status: '启用',
      isActive: true
    },
    {
      id: 'r8',
      name: '分娩转群',
      category: '生产管理',
      frequency: '中频',
      description: '牛只临近分娩，转入产房',
      status: '启用',
      isActive: true
    },
    {
      id: 'r9',
      name: '康复转群',
      category: '健康管理',
      frequency: '中频',
      description: '牛只康复后转回正常圈舍',
      status: '启用',
      isActive: true
    },
    {
      id: 'r10',
      name: '疫苗接种',
      category: '健康管理',
      frequency: '低频',
      description: '疫苗接种期间临时隔离或集中管理',
      status: '启用',
      isActive: true
    },
    {
      id: 'r11',
      name: '饲养调整',
      category: '饲养管理',
      frequency: '中频',
      description: '按体况、采食或日粮策略调整圈舍',
      status: '启用',
      isActive: true
    },
    {
      id: 'r12',
      name: '品种管理',
      category: '生产管理',
      frequency: '低频',
      description: '按品种分类管理',
      status: '启用',
      isActive: true
    },
    {
      id: 'r13',
      name: '管理调整',
      category: '其他',
      frequency: '临时',
      description: '牧场管理结构调整',
      status: '启用',
      isActive: true
    },
    {
      id: 'r14',
      name: '淘汰离群',
      category: '其他',
      frequency: '低频',
      description: '生产或健康原因淘汰离群',
      status: '启用',
      isActive: true
    },
    {
      id: 'r15',
      name: '出售离群',
      category: '其他',
      frequency: '低频',
      description: '牛只出售后离群',
      status: '启用',
      isActive: true
    },
    {
      id: 'r16',
      name: '死亡离群',
      category: '健康管理',
      frequency: '低频',
      description: '死亡事件形成离群记录',
      status: '启用',
      isActive: true
    },
    {
      id: 'r17',
      name: '转场离群',
      category: '其他',
      frequency: '临时',
      description: '跨牧场调拨或外转',
      status: '启用',
      isActive: true
    }
  ]

  defineOptions({ name: 'TransferReasonInfo' })
</script>
