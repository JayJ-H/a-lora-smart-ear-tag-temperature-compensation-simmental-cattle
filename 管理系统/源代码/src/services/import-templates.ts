import * as XLSX from 'xlsx'

import { DEFAULT_CATTLE_BREED } from '@/utils/cattle-breeds'

export type ImportMode = 'single' | 'batch'
export type ImportAction = 'dry_run' | 'commit'
export type ImportTarget =
  | 'animal_profile'
  | 'pedigree'
  | 'trait_observation'
  | 'milk_measurement'
  | 'milk_summary'
  | 'animal_event'
  | 'reproduction_event'
  | 'health_medicine'
  | 'omics_sample'
  | 'omics_dataset'
  | 'device_sensor'

export type ImportColumnType = 'text' | 'number' | 'date' | 'datetime' | 'select' | 'json'
export type ImportOptionSource =
  | 'static'
  | 'operator'
  | 'pen'
  | 'breed'
  | 'transferReason'
  | 'disease'
  | 'medicine'
  | 'medicineBatch'
  | 'medicineUnit'
  | 'vaccine'
  | 'trait'
  | 'event'
  | 'severity'
  | 'eventStatus'
  | 'milkShift'
  | 'sex'
  | 'animalStatus'
  | 'animalStage'
  | 'quality'
  | 'reproductionAction'
  | 'pregnancyResult'
  | 'calvingResult'
  | 'sampleType'
  | 'sampleStatus'
  | 'omicsType'
  | 'markerType'
  | 'deviceType'
  | 'medicineRoute'

export interface ImportTemplateColumn {
  key: string
  label: string
  targetField: string
  type: ImportColumnType
  section?: string
  required?: boolean
  aliases?: string[]
  options?: string[]
  optionSource?: ImportOptionSource
  example?: unknown
  description?: string
}

export interface ImportTemplateValueOption {
  fieldKey: string
  fieldLabel: string
  targetField: string
  fieldSection: string
  source: ImportOptionSource
  number: string
  value: string
  label: string
  aliases?: string[]
  description?: string
}

export interface ImportTemplate {
  code: string
  name: string
  group: string
  target: ImportTarget
  description: string
  visibility?: 'user' | 'legacy' | 'internal'
  columns: ImportTemplateColumn[]
  requiredColumns: string[]
  defaultMapping: Record<string, string>
  duplicateKeys: string[]
  conflictStrategy: 'skip' | 'update' | 'reject'
  targetTables: string[]
}

const cowRefColumns: ImportTemplateColumn[] = [
  column('animal_number', '牛号', 'animal_number', 'text', true, [
    'cow_number',
    'cowNumber',
    'animalNumber',
    '个体编号'
  ])
]

const workOperatorColumn: ImportTemplateColumn = column(
  'work_operator_name',
  '操作人',
  'work_operator_name',
  'select',
  false,
  [
    'workOperator',
    'workOperatorName',
    'fieldOperator',
    'fieldOperatorName',
    'collectorName',
    'collector',
    'sampler',
    'milker',
    'technician',
    '技术员',
    '操作员',
    '现场操作人',
    '执行人',
    '兽医',
    '育种员',
    '采样人',
    '测定人',
    '挤奶员',
    '采集人'
  ]
)

function column(
  key: string,
  label: string,
  targetField: string,
  type: ImportColumnType,
  required = false,
  aliases: string[] = [],
  example: unknown = '',
  description = '',
  options?: string[],
  section = inferImportColumnSection(key, label, targetField),
  optionSource = inferImportColumnOptionSource(key, label, targetField, options)
): ImportTemplateColumn {
  return {
    key,
    label,
    targetField,
    type,
    section,
    required,
    aliases,
    example,
    description,
    options,
    optionSource
  }
}

function inferImportColumnOptionSource(
  key: string,
  label: string,
  targetField: string,
  options?: string[]
): ImportOptionSource | undefined {
  const raw = `${key} ${label} ${targetField}`.toLowerCase()
  if (/operator|记录人|操作人|collector|采集人|采样人|测定人|挤奶员|technician/.test(raw))
    return 'operator'
  if (/shift|班次/.test(raw)) return 'milkShift'
  if (/severity|级别|level/.test(raw)) return 'severity'
  if (/event[_-]?status|事件状态/.test(raw)) return 'eventStatus'
  if (/event[_-]?type|事件类型|健康事件/.test(raw)) return 'event'
  if (/reproduction[_-]?action|繁殖动作/.test(raw)) return 'reproductionAction'
  if (/pregnancy[_-]?result|妊检结果/.test(raw)) return 'pregnancyResult'
  if (/calving[_-]?result|产犊结果/.test(raw)) return 'calvingResult'
  if (
    /quality[_-]?(flag|grade)|qualityflag|qualitygrade|qc[_-]?status|qcstatus|质量标记|质量状态/.test(
      raw
    )
  )
    return 'quality'
  if (/^sex$|性别|gender/.test(raw)) return 'sex'
  if (/current[_-]?stage|生产阶段|stage/.test(raw)) return 'animalStage'
  if (/^status$|状态|cowstatus/.test(raw)) {
    if (/sample/.test(raw) || /样本/.test(raw)) return 'sampleStatus'
    return 'animalStatus'
  }
  if (/breed|品种/.test(raw)) return 'breed'
  if (/current[_-]?pen|初始圈舍|to[_-]?unit|targetpen|目标圈舍|圈舍/.test(raw)) return 'pen'
  if (/reason|原因/.test(raw)) return 'transferReason'
  if (/diagnosis|诊断|disease|疾病/.test(raw)) return 'disease'
  if (/semen|精液|公牛/.test(raw)) return undefined
  if (/medicine[_-]?batch|药品批号|批号/.test(raw)) return 'medicineBatch'
  if (/medicine|药品|疫苗/.test(raw)) return /vaccine|疫苗/.test(raw) ? 'vaccine' : 'medicine'
  if (/dose[_-]?unit|剂量单位/.test(raw)) return 'medicineUnit'
  if (/route|给药方式/.test(raw)) return 'medicineRoute'
  if (/trait[_-]?code|性状编码|关联性状/.test(raw)) return 'trait'
  if (/sample[_-]?type|样本类型/.test(raw)) return 'sampleType'
  if (/data[_-]?type|组学类型/.test(raw)) return 'omicsType'
  if (/marker[_-]?type|标记类型/.test(raw)) return 'markerType'
  if (/device[_-]?type|设备类型/.test(raw)) return 'deviceType'
  return options?.length ? 'static' : undefined
}

function inferImportColumnSection(key: string, label: string, targetField: string) {
  const text = `${key} ${label} ${targetField}`.toLowerCase()
  if (
    /animal|cow|牛号|牛只|耳|编号|name|名称|sex|性别|breed|品种|birth|出生|entry|入群|stage|阶段|status|状态|herd|牛群|line|家系|purpose|用途/.test(
      text
    )
  ) {
    return '牛只身份'
  }
  if (/sire|dam|父|母|祖|系谱|亲缘|parent|pedigree|confidence|可信/.test(text)) {
    return '系谱关系'
  }
  if (
    /parity|胎次|calving|产犊|lactation|泌乳|开产|开采|停产|dry|dim|产奶天数|305|shift|班次|session|挤奶时间|采集时间|发生时间|measured|observed|occurred|date|time|日期|时间/.test(
      text
    )
  ) {
    return '生产周期'
  }
  if (
    /trait|性状|value|数值|unit|单位|milk|奶|乳|fat|protein|lactose|scc|体细胞|质量|quality|读数|metric|指标/.test(
      text
    )
  ) {
    return '测量与性状'
  }
  if (
    /event|事件|diagnosis|诊断|medicine|药|dose|剂量|route|给药|withdrawal|休药|severity|级别|result|结果|target|目标|圈舍|unit|pen/.test(
      text
    )
  ) {
    return '事件业务'
  }
  if (/sample|样本|omics|组学|dataset|数据集|marker|标记|gene|基因|platform|平台/.test(text)) {
    return '样本与组学'
  }
  if (/device|设备|sensor|传感器|绑定|assigned|reading/.test(text)) {
    return '设备与传感器'
  }
  if (/operator|记录人|操作人|collector|technician|notes|备注|source|来源|remark|说明/.test(text)) {
    return '采集与追溯'
  }
  return '其他字段'
}

function sectionDescription(section: string) {
  const map: Record<string, string> = {
    牛只身份: '用于确认记录最终归属到哪一头牛。',
    系谱关系: '父母、祖代和亲缘可信度字段。',
    生产周期: '只填写发生日期、测量日期和班次等原始事实；周期统计由系统自动计算并在导出中查看。',
    测量与性状: '正式写入性状、泌乳、传感器或质量记录的业务值。',
    事件业务: '事件类型、原因、结果、圈舍流转和健康用药业务字段。',
    样本与组学: '组学样本、数据集、标记和性状关联字段。',
    设备与传感器: '设备主档、绑定关系和传感器读数字段。',
    采集与追溯: '现场执行人可填写；上传账号、任务来源和审计信息由系统自动生成。',
    其他字段: '未归入固定业务域的补充字段。'
  }
  return map[section] || ''
}

function groupedTemplateColumns(columns: ImportTemplateColumn[]) {
  const order = [
    '牛只身份',
    '系谱关系',
    '生产周期',
    '测量与性状',
    '事件业务',
    '样本与组学',
    '设备与传感器',
    '采集与追溯',
    '其他字段'
  ]
  const groups = new Map<string, ImportTemplateColumn[]>()
  columns.forEach((item) => {
    const section = item.section || inferImportColumnSection(item.key, item.label, item.targetField)
    if (!groups.has(section)) groups.set(section, [])
    groups.get(section)!.push(item)
  })
  return order
    .filter((section) => groups.has(section))
    .map((section) => ({ section, columns: groups.get(section)! }))
}

function buildMapping(columns: ImportTemplateColumn[]) {
  return Object.fromEntries(columns.map((item) => [item.label, item.targetField]))
}

export function getTemplateSystemFieldOptions(template: ImportTemplate) {
  return template.columns.map((item, index) => ({
    number: String(index + 1),
    targetField: item.targetField,
    key: item.key,
    label: item.label,
    section: item.section || inferImportColumnSection(item.key, item.label, item.targetField),
    type: item.type,
    required: !!item.required,
    aliases: item.aliases || [],
    description: item.description || ''
  }))
}

export function resolveTemplateSystemField(template: ImportTemplate, value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const options = getTemplateSystemFieldOptions(template)
  const normalized = normalizeColumnName(raw)
  const byNumber = options.find((item) => item.number === raw)
  if (byNumber) return byNumber.targetField
  const byField = options.find((item) =>
    [item.targetField, item.key, item.label, ...item.aliases].some(
      (candidate) => normalizeColumnName(candidate) === normalized
    )
  )
  return byField?.targetField || ''
}

export function getTemplateStaticValueOptions(
  template: ImportTemplate
): ImportTemplateValueOption[] {
  return template.columns.flatMap((columnItem) =>
    (columnItem.options || []).map((option, index) => ({
      fieldKey: columnItem.key,
      fieldLabel: columnItem.label,
      targetField: columnItem.targetField,
      fieldSection:
        columnItem.section ||
        inferImportColumnSection(columnItem.key, columnItem.label, columnItem.targetField),
      source: columnItem.optionSource || 'static',
      number: String(index + 1),
      value: String(option),
      label: String(option),
      aliases: [String(option)]
    }))
  )
}

function template(
  input: Omit<ImportTemplate, 'requiredColumns' | 'defaultMapping'>
): ImportTemplate {
  const columns = input.columns
  const requiredColumns = columns.filter((item) => item.required).map((item) => item.key)
  return {
    ...input,
    columns,
    requiredColumns,
    defaultMapping: buildMapping(columns)
  }
}

export const EVENT_GROUPS = [
  {
    group: '生产',
    events: [
      ['milking', '泌乳'],
      ['milking_session', '采奶'],
      ['milk_quality', '奶质检测'],
      ['dhi_test', 'DHI'],
      ['feeding', '饲喂'],
      ['feed_delivery', '投料'],
      ['feed_adjustment', '日粮调整'],
      ['weighing', '称重'],
      ['body_measurement', '体尺测定'],
      ['dry_off', '停产']
    ]
  },
  {
    group: '繁殖',
    events: [
      ['heat', '发情'],
      ['insemination', '输精/配种'],
      ['pregnancy_check', '妊检'],
      ['calving', '产犊'],
      ['abortion', '流产'],
      ['postpartum_check', '产后检查'],
      ['embryo_transfer', '胚胎移植'],
      ['reproduction_status_snapshot', '繁殖状态快照']
    ]
  },
  {
    group: '健康',
    events: [
      ['diagnosis', '诊断'],
      ['treatment', '治疗'],
      ['medication', '用药'],
      ['vaccination', '疫苗'],
      ['deworming', '驱虫'],
      ['quarantine', '隔离'],
      ['disinfection', '消毒'],
      ['lab_test', '实验室检测'],
      ['hoof_trim', '修蹄'],
      ['mastitis_check', '乳房炎检查'],
      ['death', '死亡']
    ]
  },
  {
    group: '转群',
    events: [
      ['entry', '入群'],
      ['transfer', '转群'],
      ['exit', '离群/淘汰']
    ]
  },
  {
    group: '采样',
    events: [['sample_collection', '样本采集']]
  },
  {
    group: '设备',
    events: [
      ['sensor_alert', '传感器告警'],
      ['device_maintenance', '设备维护'],
      ['device_assignment', '设备绑定'],
      ['device_unassignment', '设备解绑']
    ]
  },
  {
    group: '育种科研',
    events: [
      ['mating_plan', '选配方案'],
      ['semen_check', '精液检查'],
      ['genotyping', '基因分型'],
      ['sequencing', '测序'],
      ['omics_assay', '组学检测'],
      ['breeding_value_run', '育种值计算'],
      ['selection_index_update', '选择指数更新']
    ]
  }
] as const

export const EVENT_OPTIONS = EVENT_GROUPS.flatMap((group) =>
  group.events.map(([code, label]) => ({ group: group.group, code, label }))
)

const SEX_OPTIONS = ['公', '母', 'male', 'female']
const ANIMAL_STATUS_OPTIONS = [
  '在群',
  '转群',
  '离群',
  '淘汰',
  '死亡',
  'active',
  'transferred',
  'exited',
  'culled',
  'dead'
]
const STAGE_OPTIONS = [
  '犊牛',
  '育成',
  '育肥',
  '公牛',
  '泌乳',
  '干奶',
  '后备',
  '淘汰',
  'calf',
  'heifer',
  'fattening',
  'bull',
  'lactating',
  'dry'
]
const QUALITY_OPTIONS = ['正常', '复核', '异常', '剔除', 'normal', 'review', 'abnormal', 'rejected']
const UNIT_OPTIONS = [
  'kg',
  'g',
  'mL',
  'cm',
  'mm',
  'score',
  '%',
  'cells/mL',
  'uS/cm',
  'steps',
  '步',
  '次',
  '头',
  '天',
  '月',
  'kg/min',
  'C',
  '摄氏度',
  '°C'
]
const MILK_SHIFT_OPTIONS = [
  '早班',
  '中班',
  '晚班',
  '夜班',
  '半夜班',
  '1',
  '2',
  '3',
  '4',
  'morning',
  'noon',
  'evening',
  'night'
]
const EVENT_CODE_OPTIONS = EVENT_OPTIONS.flatMap((item) => [item.code, item.label])
const SEVERITY_OPTIONS = ['正常', '提示', '关注', '严重', 'normal', 'info', 'warning', 'critical']
const EVENT_STATUS_OPTIONS = [
  '已记录',
  '待复核',
  '已确认',
  '已作废',
  'recorded',
  'pending_review',
  'confirmed',
  'voided'
]
const REPRODUCTION_ACTION_OPTIONS = [
  'heat',
  'insemination',
  'pregnancy_check',
  'calving',
  'abortion',
  'postpartum_check',
  'embryo_transfer',
  'reproduction_status_snapshot',
  '发情',
  '输精/配种',
  '妊检',
  '产犊',
  '流产',
  '产后检查',
  '胚胎移植',
  '繁殖状态快照'
]
const REPRODUCTION_STATUS_OPTIONS = ['尚未配种', '已配未检', '初检已孕', '空怀', '妊娠', '待产']
const PREGNANCY_RESULT_OPTIONS = ['阴性', '阳性']
const CALVING_RESULT_OPTIONS = [
  '顺产',
  '助产',
  '难产',
  '死胎',
  'natural',
  'assisted',
  'dystocia',
  'stillbirth'
]
const SAMPLE_TYPE_OPTIONS = [
  '血液',
  '乳样',
  '毛囊',
  '组织',
  '粪样',
  'blood',
  'milk',
  'hair_follicle',
  'tissue',
  'feces'
]
const SAMPLE_TISSUE_OPTIONS = [
  '血液',
  '乳样',
  '毛囊',
  '组织',
  '粪样',
  '耳组织',
  '颈静脉血',
  'blood',
  'milk',
  'hair_follicle',
  'tissue',
  'feces',
  'ear_tissue'
]
const SAMPLE_STATUS_OPTIONS = [
  '已入库',
  '待检测',
  '检测中',
  '已检测',
  '已废弃',
  'stored',
  'pending',
  'testing',
  'tested',
  'discarded'
]
const OMICS_TYPE_OPTIONS = [
  'SNP',
  'WGS',
  'RNA-seq',
  'metabolomics',
  'proteomics',
  'microbiome',
  'transcriptomics'
]
const MARKER_TYPE_OPTIONS = ['SNP', 'Indel', 'SV', 'gene', 'metabolite', 'protein', 'pathway']
const SENSOR_METRIC_OPTIONS = [
  'body_temperature',
  'steps',
  'activity',
  'rumination',
  'rfid_seen',
  'location',
  'milk_yield',
  'body_weight',
  '体温',
  '步数',
  '活动量',
  '反刍',
  'RFID巡检',
  '定位',
  '产奶量',
  '体重'
]
const DEVICE_TYPE_OPTIONS = [
  '奶厅',
  '项圈',
  '耳标',
  '称重栏',
  '环境传感器',
  'milking_parlor',
  'collar',
  'ear_tag',
  'scale',
  'environment'
]

export const IMPORT_TEMPLATES: ImportTemplate[] = [
  template({
    code: 'animal-profile',
    name: '个体建档/入群',
    group: '基础主档',
    target: 'animal_profile',
    description: '只导入牛号和入群原始事实；品种、出生、父母和产犊走系谱，阶段和状态由事件推导。',
    columns: [
      ...cowRefColumns,
      column('entry_date', '入群日期', 'entry_date', 'date', false, ['entryDate']),
      column(
        'entry_type',
        '入群类型',
        'entry_type',
        'select',
        false,
        ['entryReason', 'movement_reason', 'movementReason', '入群原因'],
        '出生入群',
        '',
        undefined,
        undefined,
        'transferReason'
      ),
      column(
        'entry_unit_id',
        '入群圈舍',
        'entry_unit_id',
        'select',
        false,
        [
          'to_unit_code',
          'toUnitCode',
          'to_unit_id',
          'toUnitId',
          'unit_id',
          'unitId',
          'targetPen',
          'targetUnit',
          '入群圈舍单元',
          '目标圈舍'
        ],
        '',
        '随入群日期记录该牛进入的圈舍单元；导入时同步生成入群事件。',
        undefined,
        undefined,
        'pen'
      )
    ],
    duplicateKeys: ['animal_number'],
    conflictStrategy: 'update',
    targetTables: [
      'animal',
      'cows',
      'animal_event',
      'cow-events',
      'event_movement_detail',
      'entry-events'
    ]
  }),
  template({
    code: 'pedigree',
    name: '系谱/出生/产犊',
    group: '基础主档',
    target: 'pedigree',
    description: '导入牛只出生、父母、胎次产犊日和犊牛号；带产犊日和犊牛号时同步产犊事件。',
    columns: [
      ...cowRefColumns,
      column('sex', '性别', 'sex', 'select', false, ['gender'], '母', '', SEX_OPTIONS),
      column(
        'breed',
        '品种',
        'breed',
        'select',
        false,
        ['breedName'],
        DEFAULT_CATTLE_BREED,
        '',
        undefined,
        undefined,
        'breed'
      ),
      column('birth_date', '出生日期', 'birth_date', 'date', false, ['birthDate']),
      column('sire_number', '父号', 'sire_number', 'text', false, ['fatherNumber', '公牛号']),
      column(
        'sire_breed',
        '父号品种',
        'sire_breed',
        'select',
        false,
        ['fatherBreed', 'sireBreed', '父品种'],
        '',
        '',
        undefined,
        undefined,
        'breed'
      ),
      column('dam_number', '母号', 'dam_number', 'text', false, ['motherNumber', '母牛号']),
      column(
        'dam_breed',
        '母号品种',
        'dam_breed',
        'select',
        false,
        ['motherBreed', 'damBreed', '母品种'],
        '',
        '',
        undefined,
        undefined,
        'breed'
      ),
      column(
        'parity_no',
        '胎次',
        'parity_no',
        'number',
        false,
        ['parityNo', 'parity', '产犊胎次'],
        '',
        '同一头牛多次产犊时用于区分胎次；不填时系统按产犊日期顺序推导。'
      ),
      column(
        'parity_calving_date',
        '产犊日期',
        'parity_calving_date',
        'date',
        false,
        ['calvingDate', 'latestCalvingDate', '产犊日'],
        '',
        '系谱行带产犊日和犊牛号时，同步生成产犊事件；生产周期由系统按产犊日期序列计算。'
      ),
      column(
        'calf_number',
        '犊牛号',
        'calf_number',
        'text',
        false,
        ['calfNumber', 'childNumber', '子代号', '子女号', '孩子号码'],
        '',
        '同胎多头用逗号、顿号、空格或分号分隔；同步到产犊事件和犊牛系谱。'
      ),
      column(
        'calf_sex',
        '犊牛性别',
        'calf_sex',
        'select',
        false,
        ['calfSex', 'childSex', '犊牛公母'],
        '',
        '',
        SEX_OPTIONS
      ),
      column(
        'calf_breed',
        '犊牛品种',
        'calf_breed',
        'select',
        false,
        ['calfBreed', 'childBreed', '子代品种'],
        '',
        '',
        undefined,
        undefined,
        'breed'
      )
    ],
    duplicateKeys: ['animal_number', 'parity_no', 'parity_calving_date', 'calf_number'],
    conflictStrategy: 'update',
    targetTables: [
      'animal',
      'cows',
      'animal_parentage',
      'animal_event',
      'cow-events',
      'event_reproduction_detail'
    ]
  }),
  template({
    code: 'trait-observation',
    name: '表型观测',
    group: '生产表型',
    target: 'trait_observation',
    description: '导入单牛表型原始观测；性状名称、质控和生产周期由系统按字典与规则计算。',
    columns: [
      ...cowRefColumns,
      column(
        'trait_code',
        '性状编码',
        'trait_code',
        'select',
        true,
        ['traitCode'],
        '',
        '',
        undefined,
        undefined,
        'trait'
      ),
      column('observed_at', '采集日期', 'observed_at', 'date', true, [
        'collectionDate',
        '采集时间',
        '采集日期'
      ]),
      column('numeric_value', '数值', 'numeric_value', 'number', false, ['value', '测定值']),
      column('text_value', '文本值', 'text_value', 'text', false, ['textValue']),
      column('unit', '单位', 'unit', 'select', false, ['unit'], '', '', UNIT_OPTIONS),
      workOperatorColumn
    ],
    duplicateKeys: ['animal_number', 'trait_code', 'observed_at'],
    conflictStrategy: 'update',
    targetTables: ['trait_observation_batch', 'trait_observation', 'phenotype-records']
  }),
  template({
    code: 'milk-measurement',
    name: '泌乳/奶厅测量',
    group: '生产表型',
    target: 'milk_measurement',
    description: '导入奶厅原始测量；胎次、DIM、泌乳月、305天和均值由系统按产犊周期计算。',
    columns: [
      ...cowRefColumns,
      column(
        'shift_name',
        '班次',
        'shift_name',
        'select',
        false,
        ['shift', 'shiftName', 'shift_id', 'shiftId', '班次名称', '挤奶班次'],
        '早班',
        '一天两班或多班挤奶时用于区分同日产奶记录',
        MILK_SHIFT_OPTIONS
      ),
      column('measured_at', '挤奶日期', 'measured_at', 'date', true, [
        'milkingTime',
        'measuredAt',
        '挤奶时间'
      ]),
      column('milk_yield', '产奶量', 'milk_yield', 'number', false, ['volume', 'milkVolume']),
      column(
        'unit_id',
        '当前圈舍单元',
        'unit_id',
        'select',
        false,
        [
          'currentUnitId',
          'current_unit',
          'current_pen_id',
          'currentPenId',
          '当前圈舍',
          'milkingHall',
          'milking_hall',
          'hall',
          'parlor',
          '奶厅'
        ],
        '',
        '按挤奶日期判断该牛所在圈舍；与系统当前圈舍不一致时自动生成入群或转群事件。',
        undefined,
        undefined,
        'pen'
      ),
      column('stall_no', '挤奶位', 'stall_no', 'text', false, [
        'stallNo',
        'milkingPosition',
        'milking_position',
        'position'
      ]),
      column(
        'milking_duration_minutes',
        '挤奶持续时间(分钟)',
        'milking_duration_minutes',
        'number',
        false,
        ['milkingDuration', 'milking_duration', 'durationMinutes']
      ),
      column('milk_flow_avg', '平均奶流速', 'milk_flow_avg', 'number', false, [
        'avgFlow',
        'milkFlowAvg',
        'milk_flow_average'
      ]),
      column('milk_flow_peak', '峰值奶流速', 'milk_flow_peak', 'number', false, [
        'peakFlow',
        'milkFlowPeak'
      ]),
      column('conductivity', '电导率', 'conductivity', 'number', false, [
        'milkConductivity',
        'milk_conductivity'
      ]),
      column('fat_percent', '乳脂率', 'fat_percent', 'number', false, ['fat']),
      column('protein_percent', '乳蛋白率', 'protein_percent', 'number', false, ['protein']),
      column('lactose_percent', '乳糖率', 'lactose_percent', 'number', false, ['lactose']),
      column('somatic_cell_count', '体细胞数', 'somatic_cell_count', 'number', false, ['scc']),
      workOperatorColumn
    ],
    duplicateKeys: ['animal_number', 'measured_at', 'shift_name'],
    conflictStrategy: 'update',
    targetTables: ['milking_session', 'milking_visit', 'milk_measurement', 'milk-records']
  }),
  template({
    code: 'animal-event',
    name: '统一事件',
    group: '事件繁殖',
    target: 'animal_event',
    description: '导入入群、转群、离群、繁殖、健康、用药、停产等通用事件。',
    columns: [
      ...cowRefColumns,
      column(
        'event_type',
        '事件类型',
        'event_type',
        'select',
        true,
        ['eventType', 'event_code'],
        'insemination',
        '',
        EVENT_CODE_OPTIONS
      ),
      column('event_name', '事件名称', 'event_name', 'text', false, ['eventName']),
      column('occurred_at', '发生日期', 'occurred_at', 'date', true, [
        'eventTime',
        'eventDate',
        '发生时间'
      ]),
      column(
        'dry_reason',
        '停产原因',
        'dry_reason',
        'select',
        false,
        ['dryReason', '停产原因', '干奶原因'],
        '',
        '',
        ['预产期前停产', '产奶下降', '健康调整', '治疗需要']
      ),
      column(
        'to_unit_code',
        '目标圈舍（仅入群/转群）',
        'to_unit_code',
        'select',
        false,
        ['unit_code', 'targetPen', 'toPen', 'pen'],
        '',
        '',
        undefined,
        undefined,
        'pen'
      ),
      column(
        'severity',
        '级别',
        'severity',
        'select',
        false,
        ['level'],
        '正常',
        '',
        SEVERITY_OPTIONS
      ),
      column(
        'event_result',
        '事件结果',
        'event_result',
        'select',
        false,
        [
          'result',
          'check_result',
          'pregnancy_result',
          'pregnancyResult',
          'diagnosis_name',
          'diagnosis',
          '妊检结果',
          '诊断'
        ],
        '',
        '例如妊检阳性、妊检阴性、乳房炎、治疗完成等，按事件类型解释。',
        ['妊检阳性', '妊检阴性', '阳性', '阴性', '正常', '需复查', '治疗完成']
      ),
      column(
        'medicine_code',
        '药品编码/名称',
        'medicine_code',
        'select',
        false,
        ['medicine'],
        '',
        '',
        undefined,
        undefined,
        'medicine'
      ),
      column(
        'medicine_batch_no',
        '药品批号',
        'medicine_batch_no',
        'select',
        false,
        ['batchNo'],
        '',
        '',
        undefined,
        undefined,
        'medicineBatch'
      ),
      column('dose', '剂量', 'dose', 'number', false, ['dosage']),
      column(
        'dose_unit',
        '剂量单位',
        'dose_unit',
        'select',
        false,
        ['dosageUnit'],
        '',
        '',
        undefined,
        undefined,
        'medicineUnit'
      ),
      column(
        'route',
        '给药方式',
        'route',
        'select',
        false,
        ['method'],
        '',
        '',
        undefined,
        undefined,
        'medicineRoute'
      ),
      column('bull_or_semen_ref', '公牛号/精液批号', 'bull_or_semen_ref', 'text', false, [
        'bull_number',
        'bullNumber',
        'bullNumber',
        'semen_batch',
        'semenBatch',
        '精液批号',
        '公牛号'
      ]),
      column('calf_number', '犊牛号', 'calf_number', 'text', false, [
        'calfNumber',
        'childNumber',
        '子代号'
      ]),
      workOperatorColumn
    ],
    duplicateKeys: ['animal_number', 'event_type', 'occurred_at'],
    conflictStrategy: 'skip',
    targetTables: ['animal_event', 'cow-events']
  }),
  template({
    code: 'reproduction-event',
    name: '繁殖事件',
    group: '事件繁殖',
    target: 'reproduction_event',
    visibility: 'legacy',
    description: '导入配种、妊检、产犊、流产、胚胎移植等繁殖事件。',
    columns: [
      ...cowRefColumns,
      column(
        'reproduction_action',
        '繁殖动作',
        'reproduction_action',
        'select',
        true,
        ['event_type', 'eventType'],
        'insemination',
        '',
        REPRODUCTION_ACTION_OPTIONS
      ),
      column('occurred_at', '发生日期', 'occurred_at', 'date', true, ['eventTime', '发生时间']),
      column(
        'shift_name',
        '班次',
        'shift_name',
        'select',
        false,
        ['shift', 'shiftName', 'shift_id', 'shiftId', '事件班次'],
        '',
        '同日多次繁殖处理或采样时用于区分记录。',
        MILK_SHIFT_OPTIONS
      ),
      column('bull_number', '公牛号', 'bull_number', 'text', false, ['bullNumber']),
      column('semen_batch', '精液批号', 'semen_batch', 'text', false, ['semenNumber']),
      column(
        'pregnancy_result',
        '妊检结果',
        'pregnancy_result',
        'select',
        false,
        ['pregnancyResult'],
        '',
        '',
        PREGNANCY_RESULT_OPTIONS
      ),
      column(
        'reproduction_status_snapshot',
        '繁殖状态快照',
        'reproduction_status_snapshot',
        'select',
        false,
        ['reproductionStatus', 'reproduction_status', '繁殖状态'],
        '',
        '源表只有状态、没有真实输精或妊检日期时，用作待复核状态快照，不替代正式繁殖事件。',
        REPRODUCTION_STATUS_OPTIONS
      ),
      column(
        'calving_result',
        '产犊结果',
        'calving_result',
        'select',
        false,
        ['calvingResult'],
        '',
        '',
        CALVING_RESULT_OPTIONS
      ),
      column('calf_number', '犊牛号', 'calf_number', 'text', false, ['calfNumber'])
    ],
    duplicateKeys: ['animal_number', 'reproduction_action', 'occurred_at'],
    conflictStrategy: 'skip',
    targetTables: ['animal_event', 'event_reproduction_detail', 'breeding-events']
  }),
  template({
    code: 'health-medicine',
    name: '药品/防疫/用药',
    group: '事件繁殖',
    target: 'health_medicine',
    visibility: 'legacy',
    description: '导入诊断、治疗、免疫、用药和休药期相关记录。',
    columns: [
      ...cowRefColumns,
      column(
        'event_type',
        '健康事件',
        'event_type',
        'select',
        true,
        ['eventType'],
        'treatment',
        '',
        EVENT_CODE_OPTIONS
      ),
      column('occurred_at', '发生日期', 'occurred_at', 'date', true, ['eventTime', '发生时间']),
      column(
        'shift_name',
        '班次',
        'shift_name',
        'select',
        false,
        ['shift', 'shiftName', 'shift_id', 'shiftId', '事件班次'],
        '',
        '同日多次诊疗、用药或检测时用于区分记录。',
        MILK_SHIFT_OPTIONS
      ),
      column(
        'diagnosis_name',
        '诊断',
        'diagnosis_name',
        'select',
        false,
        ['diagnosis'],
        '',
        '',
        undefined,
        undefined,
        'disease'
      ),
      column(
        'medicine_code',
        '药品编码/名称',
        'medicine_code',
        'select',
        false,
        ['medicine'],
        '',
        '',
        undefined,
        undefined,
        'medicine'
      ),
      column(
        'medicine_batch_no',
        '药品批号',
        'medicine_batch_no',
        'select',
        false,
        ['batchNo'],
        '',
        '',
        undefined,
        undefined,
        'medicineBatch'
      ),
      column('dose', '剂量', 'dose', 'number', false, ['dosage']),
      column(
        'dose_unit',
        '剂量单位',
        'dose_unit',
        'select',
        false,
        ['dosageUnit'],
        '',
        '',
        undefined,
        undefined,
        'medicineUnit'
      ),
      column(
        'route',
        '给药方式',
        'route',
        'select',
        false,
        ['method'],
        '',
        '',
        undefined,
        undefined,
        'medicineRoute'
      ),
      column('withdrawal_days', '休药天数', 'withdrawal_days', 'number', false, ['withdrawalDays'])
    ],
    duplicateKeys: ['animal_number', 'event_type', 'occurred_at'],
    conflictStrategy: 'skip',
    targetTables: [
      'animal_event',
      'event_health_detail',
      'event_medicine_detail',
      'veterinary-events'
    ]
  }),
  template({
    code: 'omics-sample',
    name: '组学样本',
    group: '科研组学',
    target: 'omics_sample',
    description: '导入组学样本最小原始事实；保存位置、质控和状态由科研流程维护。',
    columns: [
      column('sample_code', '样本编号', 'sample_code', 'text', true, ['sampleCode']),
      ...cowRefColumns,
      column(
        'sample_type',
        '样本类型',
        'sample_type',
        'select',
        true,
        ['sampleType'],
        '血液',
        '',
        SAMPLE_TYPE_OPTIONS
      ),
      column('collection_date', '采样日期', 'collection_date', 'date', false, ['collectionDate']),
      column(
        'source_tissue',
        '样本来源',
        'source_tissue',
        'select',
        false,
        ['tissue'],
        '',
        '',
        SAMPLE_TISSUE_OPTIONS
      )
    ],
    duplicateKeys: ['sample_code'],
    conflictStrategy: 'update',
    targetTables: ['omics_samples']
  }),
  template({
    code: 'omics-dataset',
    name: '组学数据集/标记',
    group: '科研组学',
    target: 'omics_dataset',
    description: '导入组学数据集、标记、特征和性状关联。',
    columns: [
      column('dataset_code', '数据集编号', 'dataset_code', 'text', true, ['datasetCode']),
      column('dataset_name', '数据集名称', 'dataset_name', 'text', false, ['datasetName']),
      column(
        'data_type',
        '组学类型',
        'data_type',
        'select',
        false,
        ['dataType'],
        'SNP',
        '',
        OMICS_TYPE_OPTIONS
      ),
      column('platform', '检测平台', 'platform', 'text', false, ['platformName']),
      column('sample_code', '样本编号', 'sample_code', 'text', false, ['sampleCode']),
      column('marker_code', '标记编号', 'marker_code', 'text', false, ['markerCode']),
      column(
        'marker_type',
        '标记类型',
        'marker_type',
        'select',
        false,
        ['markerType'],
        '',
        '',
        MARKER_TYPE_OPTIONS
      ),
      column('gene_symbol', '基因', 'gene_symbol', 'text', false, ['geneSymbol']),
      column(
        'trait_code',
        '关联性状',
        'trait_code',
        'select',
        false,
        ['traitCode'],
        '',
        '',
        undefined,
        undefined,
        'trait'
      ),
      column('p_value', 'P值', 'p_value', 'number', false, ['pValue']),
      column('effect_size', '效应值', 'effect_size', 'number', false, ['effectSize'])
    ],
    duplicateKeys: ['dataset_code', 'marker_code', 'trait_code'],
    conflictStrategy: 'update',
    targetTables: ['omics_datasets', 'omics_dataset_sample', 'omics_markers', 'omics_trait_link']
  }),
  template({
    code: 'device-sensor',
    name: '设备与传感器',
    group: '设备接入',
    target: 'device_sensor',
    description: '导入设备绑定和传感器原始读数；指标类型内部映射到标准指标编码。',
    columns: [
      column('device_code', '设备编号', 'device_code', 'text', false, ['deviceCode']),
      column(
        'device_type',
        '设备类型',
        'device_type',
        'select',
        false,
        ['deviceType'],
        '',
        '',
        DEVICE_TYPE_OPTIONS
      ),
      ...cowRefColumns,
      column('assigned_at', '绑定日期', 'assigned_at', 'date', false, ['assignedAt', '绑定时间']),
      column('measured_at', '测量日期', 'measured_at', 'date', true, [
        'timestamp',
        'measuredAt',
        '测量时间'
      ]),
      column(
        'metric_code',
        '指标类型',
        'metric_code',
        'select',
        true,
        ['metric', 'metricType', 'indicator', '指标编码'],
        '',
        '',
        SENSOR_METRIC_OPTIONS
      ),
      column('reading_value', '读数', 'reading_value', 'text', false, [
        'value',
        'readingText',
        'textValue'
      ]),
      column('unit', '单位', 'unit', 'select', false, ['unit'], '', '', UNIT_OPTIONS)
    ],
    duplicateKeys: ['device_code', 'animal_number', 'metric_code', 'measured_at'],
    conflictStrategy: 'update',
    targetTables: ['device', 'animal_device_assignment', 'sensor_reading', 'sensor-readings']
  })
]

export function getImportTemplates() {
  return IMPORT_TEMPLATES.filter((item) => !item.visibility || item.visibility === 'user')
}

export function getAllImportTemplates() {
  return IMPORT_TEMPLATES
}

export function getImportTemplate(code: string) {
  return IMPORT_TEMPLATES.find((item) => item.code === code) || IMPORT_TEMPLATES[0]
}

export function getColumnLookup(template: ImportTemplate) {
  const lookup = new Map<string, ImportTemplateColumn>()
  template.columns.forEach((columnItem) => {
    ;[
      columnItem.key,
      columnItem.label,
      columnItem.targetField,
      ...(columnItem.aliases || [])
    ].forEach((key) => {
      const normalized = normalizeColumnName(key)
      if (normalized) lookup.set(normalized, columnItem)
    })
  })
  return lookup
}

export function normalizeColumnName(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

export function generateTemplateWorkbook(
  template: ImportTemplate,
  valueOptions: ImportTemplateValueOption[] = getTemplateStaticValueOptions(template)
) {
  const systemFieldOptions = getTemplateSystemFieldOptions(template)
  const blankHeader = Object.fromEntries(template.columns.map((item) => [item.label, '']))
  const exampleHeader = Object.fromEntries(
    template.columns.map((item) => [item.label, templateExampleValue(item, valueOptions)])
  )
  const instructionRows = groupedTemplateColumns(template.columns).flatMap((group) => [
    {
      字段分组: `【${group.section}】`,
      列名: '',
      系统字段编号: '',
      字段编码: '',
      是否必填: '',
      类型: '',
      说明: sectionDescription(group.section),
      可识别别名: ''
    },
    ...group.columns.map((item) => ({
      字段分组: group.section,
      列名: item.label,
      系统字段编号:
        systemFieldOptions.find((option) => option.targetField === item.targetField)?.number || '',
      字段编码: item.key,
      是否必填: item.required ? '是' : '否',
      类型: item.type,
      说明: item.description || '',
      可识别别名: ''
    }))
  ])
  const dictionaryRows = valueOptions.map((option) => ({
    字段分组: option.fieldSection,
    字段: option.fieldLabel,
    填写编号: option.number,
    实际值: option.value,
    显示名: option.label,
    字典来源: option.source,
    可识别别名: (option.aliases || []).join(' / '),
    说明: option.description || ''
  }))
  const errorRows = template.columns
    .filter((item) => item.required)
    .map((item) => ({
      行号: 2,
      字段分组: item.section || inferImportColumnSection(item.key, item.label, item.targetField),
      列名: item.label,
      错误说明: `${item.label}不能为空`
    }))
  const systemFieldRows = systemFieldOptions.map((item) => ({
    编号: item.number,
    系统内字段: item.targetField,
    模板列名: item.label,
    字段编码: item.key,
    字段分组: item.section,
    类型: item.type,
    是否必填: item.required ? '是' : '否',
    可识别别名: '',
    说明: item.description
  }))
  const mappingRows = template.columns.map((item) => {
    const option = systemFieldOptions.find((field) => field.targetField === item.targetField)
    return {
      外部列名: item.label,
      系统字段编号: option?.number || '',
      系统字段说明: option ? `${option.label} / ${option.targetField}` : '',
      是否启用: '是'
    }
  })

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([blankHeader]), '数据填写')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(mappingRows), '字段映射')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(instructionRows), '字段说明')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(systemFieldRows), '系统字段编号')
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      dictionaryRows.length ? dictionaryRows : [{ 字段: '无', 可选值: '无固定字典' }]
    ),
    '字典值'
  )
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([exampleHeader]), '示例行')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(errorRows), '错误示例')
  return workbook
}

function templateExampleValue(
  columnItem: ImportTemplateColumn,
  valueOptions: ImportTemplateValueOption[]
) {
  if (columnItem.type !== 'select') return columnItem.example ?? ''
  const options = valueOptions.filter(
    (option) => option.targetField === columnItem.targetField || option.fieldKey === columnItem.key
  )
  if (!options.length) return columnItem.example ?? ''
  const rawExample = String(columnItem.example ?? '').trim()
  if (rawExample) {
    const normalized = normalizeColumnName(rawExample)
    const matched = options.find((option) =>
      [option.value, option.label, ...(option.aliases || [])].some(
        (candidate) => normalizeColumnName(candidate) === normalized
      )
    )
    if (matched) return matched.number
  }
  return options[0].number
}

export function downloadImportTemplate(template: ImportTemplate) {
  const workbook = generateTemplateWorkbook(template)
  XLSX.writeFile(workbook, `${template.name}_导入模板.xlsx`)
}
