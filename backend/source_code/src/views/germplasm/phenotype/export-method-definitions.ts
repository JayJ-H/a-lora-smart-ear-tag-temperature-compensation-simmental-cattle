export type PhenotypeExportGroupBy =
  | 'raw'
  | 'day'
  | 'month'
  | 'year'
  | 'parity'
  | 'lactation_305'
  | 'cow'

export type PhenotypeExportAggregation = 'raw' | 'sum' | 'mean' | 'latest' | 'min' | 'max' | 'count'

export interface PhenotypeExportMethodDefinition {
  id: string
  code: string
  name: string
  category: string
  groupBy: PhenotypeExportGroupBy
  aggregation: PhenotypeExportAggregation
  timeGranularity: string
  lactationWindowDays: number
  requiredFields: string
  status: '启用' | '停用'
  description: string
}

export const DEFAULT_PHENOTYPE_EXPORT_METHODS: PhenotypeExportMethodDefinition[] = [
  {
    id: 'method-raw',
    code: 'raw',
    name: '原始采集明细',
    category: '原始记录',
    groupBy: 'raw',
    aggregation: 'raw',
    timeGranularity: '',
    lactationWindowDays: 305,
    requiredFields: '牛号、性状编码、采集日期、测定值',
    status: '启用',
    description: '逐条导出现场测定、奶厅或传感器采集记录。'
  },
  {
    id: 'method-day-sum',
    code: 'day_sum',
    name: '按日合计',
    category: '时间汇总',
    groupBy: 'day',
    aggregation: 'sum',
    timeGranularity: 'day',
    lactationWindowDays: 305,
    requiredFields: '牛号、性状编码、采集日期、测定值',
    status: '启用',
    description: '按牛号、性状和自然日汇总，适用于日产奶量等累计性状。'
  },
  {
    id: 'method-day-mean',
    code: 'day_mean',
    name: '按日均值',
    category: '时间汇总',
    groupBy: 'day',
    aggregation: 'mean',
    timeGranularity: 'day',
    lactationWindowDays: 305,
    requiredFields: '牛号、性状编码、采集日期、测定值',
    status: '启用',
    description: '按牛号、性状和自然日求均值，适用于体温、奶质、体重等连续测定性状。'
  },
  {
    id: 'method-month-mean',
    code: 'month_mean',
    name: '按月均值',
    category: '时间汇总',
    groupBy: 'month',
    aggregation: 'mean',
    timeGranularity: 'month',
    lactationWindowDays: 305,
    requiredFields: '牛号、性状编码、采集日期、测定值',
    status: '启用',
    description: '按牛号、性状和月份求均值，用于月均产奶、月均体况等口径。'
  },
  {
    id: 'method-month-sum',
    code: 'month_sum',
    name: '按月合计',
    category: '时间汇总',
    groupBy: 'month',
    aggregation: 'sum',
    timeGranularity: 'month',
    lactationWindowDays: 305,
    requiredFields: '牛号、性状编码、采集日期、测定值',
    status: '启用',
    description: '按牛号、性状和月份合计，用于月产奶量等累计口径。'
  },
  {
    id: 'method-year-mean',
    code: 'year_mean',
    name: '按年均值',
    category: '时间汇总',
    groupBy: 'year',
    aggregation: 'mean',
    timeGranularity: 'year',
    lactationWindowDays: 305,
    requiredFields: '牛号、性状编码、采集日期、测定值',
    status: '启用',
    description: '按牛号、性状和年份求均值，用于年均产奶、年均体重等口径。'
  },
  {
    id: 'method-year-sum',
    code: 'year_sum',
    name: '按年合计',
    category: '时间汇总',
    groupBy: 'year',
    aggregation: 'sum',
    timeGranularity: 'year',
    lactationWindowDays: 305,
    requiredFields: '牛号、性状编码、采集日期、测定值',
    status: '启用',
    description: '按牛号、性状和年份合计，用于年产奶量等累计口径。'
  },
  {
    id: 'method-parity-mean',
    code: 'parity_mean',
    name: '按胎次均值',
    category: '胎次汇总',
    groupBy: 'parity',
    aggregation: 'mean',
    timeGranularity: '',
    lactationWindowDays: 305,
    requiredFields: '牛号、性状编码、胎次、测定值',
    status: '启用',
    description: '按牛号、性状和胎次求均值，用于每胎次平均表现。'
  },
  {
    id: 'method-parity-sum',
    code: 'parity_sum',
    name: '按胎次合计',
    category: '胎次汇总',
    groupBy: 'parity',
    aggregation: 'sum',
    timeGranularity: '',
    lactationWindowDays: 305,
    requiredFields: '牛号、性状编码、胎次、测定值',
    status: '启用',
    description: '按牛号、性状和胎次合计，用于每胎次产奶量等累计性状。'
  },
  {
    id: 'method-lactation-305',
    code: 'lactation_305_sum',
    name: '305 天泌乳期累计',
    category: '泌乳期汇总',
    groupBy: 'lactation_305',
    aggregation: 'sum',
    timeGranularity: '',
    lactationWindowDays: 305,
    requiredFields: '牛号、性状编码、胎次、泌乳天数、测定值',
    status: '启用',
    description: '按牛号、性状和胎次汇总 1-305 泌乳天记录，适用于 305 天产奶量。'
  },
  {
    id: 'method-cow-latest',
    code: 'cow_latest',
    name: '单牛最新值',
    category: '单牛汇总',
    groupBy: 'cow',
    aggregation: 'latest',
    timeGranularity: '',
    lactationWindowDays: 305,
    requiredFields: '牛号、性状编码、采集日期、测定值',
    status: '启用',
    description: '按牛号和性状保留最近一次测定值。'
  },
  {
    id: 'method-cow-mean',
    code: 'cow_mean',
    name: '单牛均值',
    category: '单牛汇总',
    groupBy: 'cow',
    aggregation: 'mean',
    timeGranularity: '',
    lactationWindowDays: 305,
    requiredFields: '牛号、性状编码、测定值',
    status: '启用',
    description: '按牛号和性状汇总全部可用记录均值。'
  }
]
