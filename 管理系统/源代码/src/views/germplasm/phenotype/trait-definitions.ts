export type PhenotypeTraitCategory = string

export interface PhenotypeTraitDefinition {
  id: string
  code: string
  name: string
  category: PhenotypeTraitCategory
  unit: string
  dataType: '数值' | '等级' | '文本'
  source: '人工采集' | '传感器导入' | '奶厅导入' | '批量导入' | '实验检测' | '系统计算'
  sourceTable?: string
  sourceAnimalField?: string
  sourceTraitField?: string
  sourceValueField?: string
  sourceDateField?: string
  sourceParityField?: string
  sourceDimField?: string
  requiredFields: string
  linkedDomains: string
  status: '启用' | '停用'
  description: string
}

export const BODY_MEASUREMENT_TRAITS: PhenotypeTraitDefinition[] = [
  ['body_height', '体高'],
  ['body_length', '体斜长'],
  ['heart_girth', '胸围'],
  ['cannon_circumference', '管围'],
  ['chest_depth', '胸深'],
  ['chest_width', '胸宽'],
  ['rump_length', '尻长'],
  ['rump_width', '尻宽'],
  ['hip_width', '髋宽'],
  ['pin_bone_width', '坐骨端宽'],
  ['hook_bone_width', '腰角宽'],
  ['sacral_height', '十字部高'],
  ['rump_height', '尻高'],
  ['head_length', '头长'],
  ['forehead_width', '额宽'],
  ['horn_spacing', '角间距'],
  ['ear_length', '耳长'],
  ['tail_head_height', '尾根高'],
  ['abdomen_girth', '腹围'],
  ['udder_depth', '乳房深'],
  ['front_teat_length', '前乳头长'],
  ['rear_teat_length', '后乳头长'],
  ['teat_spacing', '乳头间距'],
  ['hoof_circumference', '后肢蹄围']
].map(([code, name]) => ({
  id: `body-${code}`,
  code,
  name,
  category: '体尺性状',
  unit: 'cm',
  dataType: '数值',
  source: '人工采集',
  requiredFields: '牛号、采集日期、采集人、测量值',
  linkedDomains: '个体档案、系谱、组学样本',
  status: '启用',
  description: '牛只体尺测量性状，用于体型结构、组选和遗传评估。'
})) as PhenotypeTraitDefinition[]

export const DEFAULT_PHENOTYPE_TRAITS: PhenotypeTraitDefinition[] = [
  {
    id: 'milk-yield',
    code: 'milk_yield',
    name: '单次产奶量',
    category: '泌乳性能',
    unit: 'kg',
    dataType: '数值',
    source: '奶厅导入',
    requiredFields: '牛号、采集日期、奶厅设备、产奶量',
    linkedDomains: '个体档案、系谱、组学样本、奶厅设备',
    status: '启用',
    description: '奶厅或泌乳记录导入的核心泌乳性状。'
  },
  {
    id: 'milk-fat',
    code: 'milk_fat',
    name: '乳脂率',
    category: '泌乳性能',
    unit: '%',
    dataType: '数值',
    source: '奶厅导入',
    requiredFields: '牛号、采集日期、奶样编号、乳脂率',
    linkedDomains: '个体档案、系谱、组学样本、奶质记录',
    status: '启用',
    description: '用于泌乳品质、营养和组学关联分析。'
  },
  {
    id: 'milk-protein',
    code: 'milk_protein',
    name: '乳蛋白率',
    category: '泌乳性能',
    unit: '%',
    dataType: '数值',
    source: '奶厅导入',
    requiredFields: '牛号、采集日期、奶样编号、乳蛋白率',
    linkedDomains: '个体档案、系谱、组学样本、奶质记录',
    status: '启用',
    description: '用于乳品质评价和候选基因关联。'
  },
  {
    id: 'milk-lactose',
    code: 'milk_lactose',
    name: '乳糖率',
    category: '泌乳性能',
    unit: '%',
    dataType: '数值',
    source: '奶厅导入',
    requiredFields: '牛号、采集日期、奶样编号、乳糖率',
    linkedDomains: '个体档案、系谱、组学样本、奶质记录',
    status: '启用',
    description: '用于奶质稳定性和代谢状态评价。'
  },
  {
    id: 'somatic-cell-count',
    code: 'somatic_cell_count',
    name: '体细胞数',
    category: '泌乳性能',
    unit: 'cells/mL',
    dataType: '数值',
    source: '奶厅导入',
    requiredFields: '牛号、采集日期、奶样编号、体细胞数',
    linkedDomains: '个体档案、健康记录、组学样本',
    status: '启用',
    description: '用于乳房健康、样本剔除和抗病性状分析。'
  },
  {
    id: 'body-weight',
    code: 'body_weight',
    name: '体重',
    category: '生长体重',
    unit: 'kg',
    dataType: '数值',
    source: '传感器导入',
    requiredFields: '牛号、采集日期、称重设备、体重',
    linkedDomains: '个体档案、系谱、组学样本、饲喂记录',
    status: '启用',
    description: '用于生长性能、饲喂效率和选育分层。'
  },
  {
    id: 'body-temperature',
    code: 'body_temperature',
    name: '体温',
    category: '健康繁殖',
    unit: '°C',
    dataType: '数值',
    source: '传感器导入',
    requiredFields: '牛号、采集日期、传感器编号、体温',
    linkedDomains: '个体档案、健康记录、组学样本',
    status: '启用',
    description: '用于异常样本剔除、健康状态和热应激判断。'
  },
  ...BODY_MEASUREMENT_TRAITS
]
