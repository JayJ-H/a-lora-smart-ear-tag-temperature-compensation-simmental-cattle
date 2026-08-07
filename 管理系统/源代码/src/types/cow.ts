// 犇牛智能健康预警系统类型定义

// 牛只类型枚举
export enum CowType {
  CALF = '犊牛', // 犊牛
  SMALL_GROWING = '小育成', // 小育成
  LARGE_GROWING = '大育成', // 大育成
  YOUNG = '青年牛', // 青年牛
  ADULT_FEMALE = '成母牛', // 成母牛
  BREEDING_BULL = '种公牛', // 种公牛
  YOUNG_BULL = '育成公牛' // 育成公牛
}

// 牛只性别
export enum CowGender {
  MALE = '公',
  FEMALE = '母'
}

// 牛只状态
export enum CowStatus {
  HEALTHY = '健康',
  ABNORMAL = '异常',
  HEAT = '发情',
  PREGNANT = '预产',
  MIXED = '混群',
  LEFT = '离群'
}

// 事件类型
export enum EventType {
  VETERINARY = '兽医',
  BREEDING = '育种',
  TRANSFER = '转群',
  ENTRY = '入群',
  EXIT = '离群'
}

// 离群原因
export enum ExitReason {
  DEATH = '死亡',
  SALE = '卖出',
  TRANSFER_OUT = '转出他场'
}

// 入群原因
export enum EntryReason {
  BIRTH = '出生',
  PURCHASE = '购买',
  TRANSFER_IN = '他场转入'
}

// 妊检结果
export enum PregnancyTestResult {
  POSITIVE = '阳性',
  NEGATIVE = '阴性'
}

// 产犊结果
export enum CalvingResult {
  NORMAL = '顺产',
  DIFFICULT = '难产',
  ABORTION = '流产'
}

// 基础牛只信息
export interface CowBasic {
  id: string
  cowNumber: string // 牛号
  earTagNumber?: string // 耳标号
  fatherNumber?: string // 父号
  motherNumber?: string // 母号
  grandfatherNumber?: string // 外祖父号
  grandmotherNumber?: string // 外祖母号
  breed: string // 品种
  gender: CowGender // 性别
  birthDate: string // 出生日期
  type: CowType // 牛只类型
  currentPen?: string // 当前圈舍
  status: CowStatus // 状态
  pregnancy?: boolean // 是否预产
  mixing?: boolean // 是否混群
  parity: number // 胎次（总产犊次数）
  createdAt: string
  updatedAt: string
}

// 测温信息
export interface TemperatureData {
  id: string
  cowNumber: string
  temperature: number // 温度
  recordTime: string // 记录时间
  createdAt: string
}

// 步数信息
export interface StepData {
  id: string
  cowNumber: string
  steps: number // 步数
  recordTime: string // 记录时间
  createdAt: string
}

// 扩展传感器数据接口 - 支持多维度监测
export interface ExtendedSensorData {
  id: string
  cowId: string
  cowNumber?: string
  animalId?: string
  timestamp: string

  // 基础传感器数据
  temperature: number // 体温(°C)
  steps: number // 步数
  activityIndex?: number // 活动量/活动指数

  // 反刍监测数据
  rumination: {
    count: number // 反刍次数
    duration: number // 反刍时长(分钟)
    efficiency: number // 反刍效率评分(0-100)
  }

  // 活动行为数据
  activity: {
    lyingTime: number // 躺卧时间(分钟)
    standingTime: number // 站立时间(分钟)
    walkingDistance: number // 步行距离(米)
    activeTime: number // 活跃时间(分钟)
  }

  // 进食行为数据
  feeding: {
    eatingTime: number // 采食时间(分钟)
    estimatedIntake: number // 估算采食量(kg)
    feedingEfficiency: number // 采食效率评分(0-100)
  }

  // 体征数据
  vitalSigns: {
    respiratoryRate: number // 呼吸频率(次/分钟)
    heartRate: number // 心率(次/分钟)
    bodyScore: number // 体况评分(1-5)
  }

  // 环境数据
  environment: {
    ambientTemp: number // 环境温度(°C)
    humidity: number // 湿度(%)
    ammonia: number // 氨气浓度(ppm)
    lightLevel: number // 光照强度(lux)
  }

  createdAt: string
}

// 反刍数据
export interface RuminationData {
  id: string
  cowId: string
  timestamp: string
  count: number
  duration: number
  efficiency: number
  createdAt: string
}

// 活动数据
export interface ActivityData {
  id: string
  cowId: string
  timestamp: string
  lyingTime: number
  standingTime: number
  walkingDistance: number
  activeTime: number
  createdAt: string
}

// 进食数据
export interface FeedingData {
  id: string
  cowId: string
  timestamp: string
  eatingTime: number
  estimatedIntake: number
  feedingEfficiency: number
  createdAt: string
}

// 繁殖效率追踪接口
export interface BreedingRecord {
  id: string
  cowId: string
  eventType: 'heat' | 'insemination' | 'pregnancy_check' | 'calving'
  eventDate: string
  technicianId?: string
  bullId?: string // 种公牛ID
  semenBatch?: string // 精液批号
  pregnancyResult?: 'positive' | 'negative' | 'unclear'
  calvingResult?: {
    calfCount: number // 产犊数量
    calfGender: ('male' | 'female')[]
    calfWeight: number[] // 犊牛体重
    calvingDifficulty: 'easy' | 'moderate' | 'difficult' | 'cesarean'
    calfSurvival: boolean[] // 犊牛成活情况
  }
  notes?: string
  createdAt: string
}

export interface ReproductionCycle {
  id: string
  cowId: string
  cycleStartDate: string // 发情周期开始日期
  heatDetectedDate?: string // 发情检测日期
  inseminationDate?: string // 配种日期
  pregnancyConfirmedDate?: string // 妊娠确认日期
  expectedCalvingDate?: string // 预产日期
  actualCalvingDate?: string // 实际分娩日期
  cycleResult: 'pregnant' | 'not_pregnant' | 'aborted' | 'ongoing'
  inseminationCount: number // 配种次数
  cycleLength: number // 发情周期长度(天)
  notes?: string
}

export interface ReproductionKPI {
  id: string
  period: string // 统计周期 (月度/季度/年度)
  periodStart: string
  periodEnd: string

  // 发情指标
  heatDetectionRate: number // 发情检测率 (%)
  heatInterval: number // 发情间隔 (天)

  // 配种指标
  conceptionRate: number // 受胎率 (%)
  inseminationCount: number // 平均配种次数
  firstServiceRate: number // 一次性受胎率 (%)

  // 妊娠指标
  pregnancyRate: number // 妊娠率 (%)
  abortionRate: number // 流产率 (%)

  // 分娩指标
  calvingInterval: number // 分娩间隔 (天)
  calvingRate: number // 分娩率 (%)
  calfSurvivalRate: number // 犊牛成活率 (%)
  twinningRate: number // 双胞胎率 (%)

  // 繁殖效率综合指标
  reproductiveEfficiency: number // 繁殖效率评分 (0-100)
  targetAchievement: number // 目标达成率 (%)
}

// 自动化流程引擎接口
export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  category: 'health' | 'reproduction' | 'production' | 'maintenance'
  triggerType: 'manual' | 'scheduled' | 'event' | 'condition'
  triggerCondition: {
    eventType?: string
    condition?: string
    schedule?: string
    threshold?: number
  }
  steps: WorkflowStep[]
  isActive: boolean
  priority: 'low' | 'medium' | 'high' | 'critical'
  createdAt: string
  updatedAt: string
}

export interface WorkflowStep {
  id: string
  name: string
  description: string
  stepType: 'notification' | 'transfer' | 'treatment' | 'inspection' | 'feeding' | 'custom'
  config: {
    // 通知步骤
    notification?: {
      recipients: string[]
      message: string
      urgency: 'low' | 'medium' | 'high'
      channels: ('sms' | 'email' | 'app' | 'voice')[]
    }
    // 转群步骤
    transfer?: {
      targetPen: string
      reason: string
      priority: 'normal' | 'urgent'
    }
    // 治疗步骤
    treatment?: {
      medicineId: string
      dosage: number
      frequency: string
      duration: number
      veterinarian: string
    }
    // 检查步骤
    inspection?: {
      checkType: string
      schedule: string
      responsiblePerson: string
    }
    // 饲喂步骤
    feeding?: {
      formulaId: string
      amount: number
      schedule: string
    }
    // 自定义步骤
    custom?: {
      action: string
      parameters: Record<string, any>
    }
  }
  dependencies: string[] // 前置步骤ID
  timeout: number // 超时时间(分钟)
  retryCount: number // 重试次数
  onFailure: 'skip' | 'retry' | 'abort'
}

export interface WorkflowInstance {
  id: string
  templateId: string
  cowId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  currentStep: string
  stepStatus: Record<string, 'pending' | 'running' | 'completed' | 'failed' | 'skipped'>
  variables: Record<string, any> // 流程变量
  triggerEvent?: {
    eventType: string
    eventData: any
    timestamp: string
  }
  startedAt: string
  completedAt?: string
  createdAt: string
}

export interface AutomatedAction {
  id: string
  name: string
  description: string
  actionType: 'transfer' | 'notification' | 'treatment' | 'feeding' | 'inspection'
  triggerCondition: {
    eventType?: string
    sensorThreshold?: {
      metric: string
      operator: '>' | '<' | '>=' | '<=' | '==' | '!='
      value: number
      duration: number // 持续时间(分钟)
    }
    timeCondition?: {
      schedule: string
      timezone: string
    }
    customCondition?: string
  }
  targetConfig: {
    // 转群配置
    transfer?: {
      targetPen: string
      reason: string
      autoConfirm: boolean
    }
    // 通知配置
    notification?: {
      recipients: string[]
      template: string
      priority: 'low' | 'medium' | 'high'
    }
    // 治疗配置
    treatment?: {
      protocolId: string
      autoStart: boolean
    }
    // 饲喂配置
    feeding?: {
      formulaId: string
      amount: number
    }
    // 检查配置
    inspection?: {
      type: string
      schedule: string
    }
  }
  isActive: boolean
  priority: 'low' | 'medium' | 'high' | 'critical'
  cooldown: number // 冷却时间(分钟)
  lastExecuted?: string
  executionCount: number
  successRate: number
  createdAt: string
}

export interface SmartTransferRule {
  id: string
  name: string
  description: string
  triggerCondition: {
    eventType:
      | 'pregnancy_confirmed'
      | 'calving_due'
      | 'heat_detected'
      | 'health_alert'
      | 'production_drop'
    parameters?: Record<string, any>
  }
  sourcePens: string[]
  targetPen: string
  transferReason: string
  autoExecute: boolean
  requiresApproval: boolean
  priority: 'low' | 'medium' | 'high'
  isActive: boolean
  executionCount: number
  lastExecuted?: string
  createdAt: string
}

export interface ReminderRule {
  id: string
  name: string
  description: string
  reminderType:
    | 'vaccination'
    | 'pregnancy_check'
    | 'dry_period'
    | 'heat_cycle'
    | 'treatment'
    | 'inspection'
  targetCondition: {
    cowType?: string[]
    parity?: { min: number; max: number }
    daysInMilk?: { min: number; max: number }
    pregnancyStatus?: string[]
    healthStatus?: string[]
  }
  schedule: {
    type: 'fixed' | 'relative' | 'conditional'
    fixedDate?: string
    relativeTo?: string // 相对事件
    offset: number // 偏移天数
    interval?: number // 重复间隔(天)
    condition?: string // 条件表达式
  }
  notification: {
    recipients: string[]
    message: string
    priority: 'low' | 'medium' | 'high'
    channels: ('sms' | 'email' | 'app' | 'voice')[]
    advanceNotice: number // 提前通知天数
  }
  actions: {
    autoCreateTask: boolean
    assignTo?: string
    deadline?: number // 截止天数
    followUpActions?: string[]
  }
  isActive: boolean
  lastTriggered?: string
  triggerCount: number
  createdAt: string
}

// 育种指标评估看板接口
export interface KPIMetric {
  id: string
  name: string
  displayName: string
  description: string
  category: 'production' | 'reproduction' | 'health' | 'economic' | 'efficiency'
  unit: string
  targetValue?: number
  warningThreshold?: number
  criticalThreshold?: number
  trend: 'up' | 'down' | 'stable'
  calculationMethod: string
  dataSource: string[]
  updateFrequency: 'real-time' | 'hourly' | 'daily' | 'weekly' | 'monthly'
  lastUpdated: string
}

export interface KPIValue {
  metricId: string
  value: number
  timestamp: string
  period?: string // 统计周期
  comparedTo?: {
    previousValue: number
    change: number
    changePercent: number
  }
  benchmark?: {
    industryAvg: number
    farmBest: number
    target: number
  }
}

export interface KPIDashboard {
  id: string
  name: string
  description: string
  category: 'overview' | 'production' | 'reproduction' | 'health' | 'economic'
  metrics: string[] // KPI指标ID列表
  layout: {
    type: 'grid' | 'custom'
    columns: number
    widgets: DashboardWidget[]
  }
  isPublic: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface DashboardWidget {
  id: string
  type: 'metric' | 'chart' | 'table' | 'text' | 'alert'
  title: string
  position: {
    x: number
    y: number
    width: number
    height: number
  }
  config: {
    // 指标组件配置
    metricId?: string
    showTrend?: boolean
    showBenchmark?: boolean

    // 图表组件配置
    chartType?: 'line' | 'bar' | 'pie' | 'gauge' | 'radar'
    timeRange?: string

    // 表格组件配置
    columns?: string[]
    dataSource?: string

    // 文本组件配置
    content?: string
    contentType?: 'markdown' | 'html'

    // 预警组件配置
    alertType?: string
    severity?: 'low' | 'medium' | 'high' | 'critical'
  }
}

export interface KPIDashboardData {
  dashboard: KPIDashboard
  widgetsData: {
    [widgetId: string]: {
      type: string
      data: any
      lastUpdated: string
    }
  }
  summary: {
    totalMetrics: number
    alertsCount: number
    lastUpdated: string
  }
}

// 经济效益分析系统接口
export interface CostItem {
  id: string
  category: 'feed' | 'veterinary' | 'labor' | 'equipment' | 'utilities' | 'other'
  name: string
  amount: number
  unit: string
  date: string
  cowId?: string
  description?: string
  createdAt: string
}

export interface RevenueItem {
  id: string
  category: 'milk_sales' | 'cow_sales' | 'calf_sales' | 'manure_sales' | 'other'
  name: string
  amount: number
  unit: string
  quantity: number
  unitPrice: number
  date: string
  cowId?: string
  description?: string
  createdAt: string
}

export interface EconomicAnalysis {
  period: {
    startDate: string
    endDate: string
    type: 'monthly' | 'quarterly' | 'yearly'
  }
  summary: {
    totalRevenue: number
    totalCost: number
    grossProfit: number
    netProfit: number
    profitMargin: number
    roi: number
    breakEvenPoint: number
  }
  costBreakdown: {
    [key: string]: {
      amount: number
      percentage: number
      trend: 'up' | 'down' | 'stable'
    }
  }
  revenueBreakdown: {
    [key: string]: {
      amount: number
      percentage: number
      trend: 'up' | 'down' | 'stable'
    }
  }
  keyMetrics: {
    costPerKgMilk: number // 每千克奶成本
    revenuePerCow: number // 每头牛收入
    feedCostRatio: number // 饲料成本占比
    veterinaryCostRatio: number // 兽医成本占比
    laborCostRatio: number // 人工成本占比
  }
  trends: {
    revenue: Array<{ date: string; amount: number }>
    costs: Array<{ date: string; amount: number }>
    profit: Array<{ date: string; amount: number }>
  }
  benchmarks: {
    industryAvgProfitMargin: number
    farmHistoricalAvg: number
    targetProfitMargin: number
  }
}

export interface BudgetPlan {
  id: string
  name: string
  period: {
    startDate: string
    endDate: string
  }
  budgetItems: {
    category: string
    plannedAmount: number
    actualAmount?: number
    variance?: number
    variancePercent?: number
  }[]
  totalPlanned: number
  totalActual?: number
  status: 'draft' | 'approved' | 'active' | 'completed'
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface ProfitabilityReport {
  id: string
  title: string
  period: string
  summary: {
    totalRevenue: number
    totalCosts: number
    grossMargin: number
    netProfit: number
    roi: number
  }
  recommendations: string[]
  risks: string[]
  opportunities: string[]
  generatedAt: string
}

// 预测分析系统接口
export interface PredictiveModel {
  id: string
  name: string
  description: string
  type: 'production' | 'health' | 'economic' | 'reproduction'
  algorithm: 'linear_regression' | 'random_forest' | 'neural_network' | 'time_series'
  targetVariable: string
  featureVariables: string[]
  trainingData: {
    startDate: string
    endDate: string
    sampleSize: number
  }
  performance: {
    accuracy: number
    precision: number
    recall: number
    f1Score: number
    mse?: number
    rmse?: number
  }
  status: 'training' | 'ready' | 'failed'
  lastTrained: string
  nextTraining?: string
  createdAt: string
}

export interface PredictionResult {
  id: string
  modelId: string
  targetDate: string
  predictedValue: number
  confidenceInterval: {
    lower: number
    upper: number
    confidence: number
  }
  actualValue?: number
  accuracy?: number
  factors: {
    variable: string
    value: number
    impact: number
    contribution: number
  }[]
  generatedAt: string
}

export interface ForecastScenario {
  id: string
  name: string
  description: string
  baseDate: string
  timeHorizon: number // 预测天数
  assumptions: {
    variable: string
    currentValue: number
    assumedValue: number
    changePercent: number
  }[]
  results: {
    date: string
    predictedValue: number
    confidenceLower: number
    confidenceUpper: number
  }[]
  riskLevel: 'low' | 'medium' | 'high'
  recommendations: string[]
  createdAt: string
}

export interface PredictiveAlert {
  id: string
  type: 'production_drop' | 'health_risk' | 'economic_warning' | 'reproduction_issue'
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  predictedDate: string
  probability: number
  impact: {
    affectedCows?: number
    potentialLoss?: number
    timeToImpact: number
  }
  recommendations: string[]
  modelId: string
  status: 'active' | 'acknowledged' | 'resolved'
  createdAt: string
  acknowledgedAt?: string
  resolvedAt?: string
}

// 硬件集成平台接口
export interface HardwareDevice {
  id: string
  name: string
  type:
    | 'milking_robot'
    | 'feed_robot'
    | 'temperature_sensor'
    | 'activity_monitor'
    | 'scale'
    | 'gate'
    | 'camera'
    | 'other'
  brand: string
  model: string
  serialNumber: string
  location: {
    penId?: string
    penName?: string
    coordinates?: {
      latitude: number
      longitude: number
    }
  }
  status: 'online' | 'offline' | 'maintenance' | 'error'
  lastSeen: string
  firmwareVersion: string
  capabilities: string[]
  configuration: Record<string, any>
  installedAt: string
  warrantyExpiry?: string
  maintenanceSchedule?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
    nextMaintenance: string
    tasks: string[]
  }
}

export interface DeviceDataStream {
  deviceId: string
  dataType:
    | 'temperature'
    | 'activity'
    | 'weight'
    | 'milk_volume'
    | 'feed_consumption'
    | 'gate_access'
    | 'image'
    | 'other'
  timestamp: string
  value: number | string | Record<string, any>
  unit?: string
  quality: 'good' | 'fair' | 'poor'
  metadata?: Record<string, any>
}

export interface IntegrationProtocol {
  id: string
  name: string
  type: 'api' | 'mqtt' | 'modbus' | 'opc_ua' | 'custom'
  version: string
  description: string
  endpoints: {
    url: string
    method: 'GET' | 'POST' | 'PUT' | 'DELETE'
    authentication: {
      type: 'none' | 'basic' | 'bearer' | 'api_key' | 'oauth'
      credentials?: Record<string, any>
    }
  }[]
  dataFormat: 'json' | 'xml' | 'binary' | 'csv'
  supportedDevices: string[]
  isActive: boolean
  lastUsed: string
  successRate: number
}

export interface DataSynchronization {
  id: string
  protocolId?: string
  sourceDevice: string
  targetSystem: string
  dataType: string
  syncFrequency: 'real-time' | 'realtime' | 'per_shift' | 'hourly' | 'daily' | 'weekly' | string
  lastSync: string
  nextSync: string
  status: 'active' | 'paused' | 'error' | 'running' | 'completed' | string
  recordsProcessed: number
  successRate: number
  errorCount: number
  configuration?: {
    mapping: Record<string, string>
    filters?: Record<string, any>
    transformations?: string[]
  }
  configurationJson?: DataSynchronization['configuration']
  configuration_json?: DataSynchronization['configuration']
}

export interface DeviceMaintenance {
  id: string
  deviceId: string
  type: 'preventive' | 'corrective' | 'predictive'
  title: string
  description: string
  scheduledDate: string
  completedDate?: string
  technician: string
  partsUsed: {
    partId: string
    name: string
    quantity: number
    cost: number
  }[]
  laborHours: number
  totalCost: number
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'low' | 'medium' | 'high' | 'critical'
  notes?: string
}

export interface HardwareAlert {
  id: string
  deviceId: string
  type:
    | 'connectivity'
    | 'performance'
    | 'maintenance'
    | 'calibration'
    | 'power'
    | 'sensor'
    | 'other'
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  detectedAt: string
  createdAt?: string
  acknowledgedAt?: string
  resolvedAt?: string
  resolution?: string
  autoResolved?: boolean
  impact?: {
    affectedCows?: number
    potentialLoss?: number
    timeToImpact?: number
  }
  recommendations?: string[]
  recommendedActions?: string[]
  affectedSystems?: string[]
  status: 'active' | 'acknowledged' | 'resolved'
}

export interface IntegrationDashboard {
  id: string
  name: string
  description: string
  devices: string[]
  alerts: HardwareAlert[]
  syncStatus: {
    totalSyncs: number
    activeSyncs: number
    failedSyncs: number
    successRate: number
  }
  systemHealth: {
    totalDevices: number
    onlineDevices: number
    offlineDevices: number
    maintenanceDevices: number
    uptimePercentage: number
  }
  dataFlow: {
    totalRecords: number
    recordsPerHour: number
    dataQualityScore: number
    processingLatency: number
  }
  lastUpdated: string
}

export interface PredictiveDashboard {
  id: string
  name: string
  description: string
  timeRange: {
    start: string
    end: string
  }
  models: string[]
  scenarios: string[]
  alerts: PredictiveAlert[]
  summary: {
    totalPredictions: number
    activeAlerts: number
    accuracyRate: number
    lastUpdated: string
  }
}

export interface ModelTrainingJob {
  id: string
  modelId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  startTime: string
  endTime?: string
  errorMessage?: string
  metrics?: {
    trainingTime: number
    dataProcessed: number
    modelSize: number
  }
}

// 健康预警系统接口
export interface HealthScore {
  id: string
  cowId: string
  timestamp: string

  // 综合健康评分
  overallScore: number // 综合健康评分 (0-100)
  riskLevel: 'low' | 'medium' | 'high' | 'critical' // 风险等级

  // 各维度评分
  dimensions: {
    temperature: number // 体温评分
    activity: number // 活动评分
    rumination: number // 反刍评分
    feeding: number // 进食评分
    reproduction: number // 繁殖评分
    vitalSigns: number // 生命体征评分
  }

  // 预警信息
  alerts: HealthAlert[]

  // 建议措施
  recommendations: string[]

  // 预测信息
  predictions: {
    next24Hours: number // 24小时内健康趋势预测
    next7Days: number // 7天内健康趋势预测
  }

  createdAt: string
}

export interface HealthAlert {
  id: string
  cowId: string
  alertType: 'temperature' | 'activity' | 'rumination' | 'feeding' | 'vital_signs' | 'behavior'
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  triggerValue: number
  threshold: number
  status: 'active' | 'resolved' | 'acknowledged'
  acknowledgedBy?: string
  acknowledgedAt?: string
  resolvedAt?: string
  createdAt: string
}

export interface HealthModel {
  id: string
  modelType: 'anomaly_detection' | 'trend_prediction' | 'disease_prediction'
  name: string
  description: string
  algorithm: string // 使用的算法
  features: string[] // 输入特征
  target: string // 预测目标
  accuracy: number // 模型准确率
  precision: number // 精确率
  recall: number // 召回率
  f1Score: number // F1分数
  trainingDataSize: number // 训练数据量
  lastTrained: string // 最后训练时间
  isActive: boolean
  version: string
}

export interface HealthPrediction {
  id: string
  cowId: string
  predictionType: 'disease_risk' | 'health_trend' | 'treatment_effect'
  predictionDate: string
  confidence: number // 置信度 (0-1)
  predictedValue: number // 预测值
  upperBound: number // 上界
  lowerBound: number // 下界
  factors: Array<{
    factor: string
    impact: number // 影响程度
    contribution: number // 贡献度
  }>
  recommendations: string[]
  createdAt: string
}

export interface HealthThreshold {
  id: string
  metric: string // 监测指标
  cowType: string // 牛只类型
  season: 'spring' | 'summer' | 'autumn' | 'winter' // 季节
  physiologicalStage: string // 生理阶段

  // 阈值设置
  warningLow: number // 警告下限
  warningHigh: number // 警告上限
  criticalLow: number // 危险下限
  criticalHigh: number // 危险上限

  // 动态调整参数
  baselinePeriod: number // 基准期(天)
  adaptationRate: number // 适应率
  sensitivity: number // 敏感度

  isActive: boolean
  lastUpdated: string
}

// 产奶数据管理接口
export interface MilkRecord {
  id: string
  cowId: string
  milkingTime: string // 挤奶时间
  volume: number // 产奶量(kg)
  milkQuality: {
    fat: number // 乳脂率(%)
    protein: number // 蛋白质(%)
    lactose: number // 乳糖(%)
    scc: number // 体细胞数(个/ml)
    urea: number // 尿素(mg/dl)
    freezingPoint: number // 冰点(°C)
    grade: 'A' | 'B' | 'C' // 奶质等级
  }
  milkingMethod: 'manual' | 'automatic' // 挤奶方式
  milkerId?: string // 挤奶员ID
  equipmentId?: string // 设备ID
  notes?: string // 备注
  createdAt: string
}

export interface MilkQualityStandard {
  id: string
  name: string
  fat: { min: number; max: number } // 乳脂率标准范围
  protein: { min: number; max: number } // 蛋白质标准范围
  lactose: { min: number; max: number } // 乳糖标准范围
  scc: { max: number } // 体细胞数最大值
  urea: { max: number } // 尿素最大值
  freezingPoint: { min: number; max: number } // 冰点范围
  description: string
  isActive: boolean
}

export interface LactationCurve {
  id: string
  cowId: string
  lactationNumber: number // 胎次
  startDate: string // 泌乳开始日期
  endDate?: string // 泌乳结束日期
  peakProduction: number // 峰值产奶量
  peakDate: string // 峰值日期
  totalProduction: number // 总产奶量
  averageProduction: number // 日均产奶量
  persistency: number // 泌乳持久性(%)
  milkRecords: MilkRecord[] // 关联的产奶记录
}

// 组学数据管理接口
export type OmicsSampleType =
  | 'blood'
  | 'milk'
  | 'hair_follicle'
  | 'tissue'
  | 'semen'
  | 'rumen_fluid'
  | 'other'

export type OmicsSampleStatus = 'planned' | 'collected' | 'processing' | 'sequenced' | 'archived'

export type OmicsDatasetType =
  | 'genome'
  | 'genotype'
  | 'transcriptome'
  | 'metabolome'
  | 'microbiome'
  | 'phenotype'

export type OmicsPlatform = 'wgs' | 'chip' | 'rna_seq' | 'lc_ms' | '16s' | 'custom'

export type OmicsDatasetStatus = 'draft' | 'processing' | 'ready' | 'published'

export type OmicsMarkerType = 'snp' | 'indel' | 'gene' | 'transcript' | 'cnv' | 'protein'

export type OmicsEvidenceLevel = 'candidate' | 'validated' | 'reported'

export type MultiOmicsAssociationType =
  | 'genome_transcriptome'
  | 'genome_phenotype'
  | 'transcriptome_phenotype'
  | 'multi_trait'

export type OmicsVisualizationType = 'network' | 'heatmap' | 'manhattan' | 'scatter'

export type BreedingAnalysisModel = 'gblup' | 'ssgblup' | 'bayes' | 'random_forest' | 'custom'

export type BreedingAnalysisStatus = 'draft' | 'running' | 'completed'

export interface ResearchTraitLink {
  trait: string
  value?: number
  unit?: string
  recordDate?: string
}

export interface OmicsQualityMetrics {
  callRate?: number
  mappingRate?: number
  q30?: number
  completeness?: number
  missingRate?: number
  duplicateRate?: number
  expressionCoverage?: number
  notes?: string
  [key: string]: number | string | null | undefined
}

export interface OmicsSample {
  id: string
  sampleCode: string
  cowId?: string
  cowNumber?: string
  sampleType: OmicsSampleType
  collectionDate?: string
  receivedDate?: string
  storageLocation?: string
  sourceTissue?: string
  collector?: string
  status: OmicsSampleStatus
  qualityScore?: number
  integrityScore?: number
  phenotypeLinks?: ResearchTraitLink[]
  metadataJson?: Record<string, any>
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface OmicsDataset {
  id: string
  datasetCode: string
  name: string
  dataType: OmicsDatasetType
  platform: OmicsPlatform
  referenceGenome?: string
  sourceLab?: string
  sampleIds: string[]
  sampleCount: number
  recordCount?: number
  releaseVersion?: string
  qualityMetrics?: OmicsQualityMetrics
  tags?: string[]
  status: OmicsDatasetStatus
  generatedAt?: string
  publishedAt?: string
  createdAt: string
  updatedAt: string
}

export interface OmicsMarker {
  id: string
  datasetId: string
  markerCode: string
  markerType: OmicsMarkerType
  chromosome?: string
  positionBp?: number
  geneSymbol?: string
  referenceAllele?: string
  alternateAllele?: string
  effectType?: string
  trait?: string
  maf?: number
  pValue?: number
  effectSize?: number
  evidenceLevel?: OmicsEvidenceLevel
  payload?: Record<string, any>
  createdAt: string
  updatedAt: string
}

export interface MultiOmicsAssociation {
  id: string
  title: string
  trait: string
  primaryDatasetId: string
  secondaryDatasetId?: string
  associationType: MultiOmicsAssociationType
  method?: string
  sampleSize?: number
  significance?: number
  effectSize?: number
  candidateGenes?: string[]
  candidateMarkers?: string[]
  visualizationType?: OmicsVisualizationType
  conclusion?: string
  payload?: Record<string, any>
  createdAt: string
  updatedAt: string
}

export interface BreedingCandidateRank {
  cowId?: string
  cowNumber: string
  rank: number
  genomicEstimate: number
  phenotypeScore?: number
  compositeScore: number
  notes?: string
}

export interface BreedingSelectionIndex {
  milkYieldWeight?: number
  milkProteinWeight?: number
  fertilityWeight?: number
  diseaseResistanceWeight?: number
  growthWeight?: number
  finalScore?: number
}

export interface BreedingAnalysis {
  id: string
  analysisCode: string
  name: string
  targetTrait: string
  datasetIds: string[]
  modelType: BreedingAnalysisModel
  populationSize: number
  heritability?: number
  reliability?: number
  predictedGain?: number
  selectionIndex?: BreedingSelectionIndex
  topCandidates?: BreedingCandidateRank[]
  status: BreedingAnalysisStatus
  summary?: string
  executedAt?: string
  createdAt: string
  updatedAt: string
}

// 饲料管理接口
export interface FeedFormula {
  id: string
  name: string
  description: string
  targetGroup: 'dry' | 'fresh' | 'lactating' | 'heifer' // 目标群体
  nutritionalContent: {
    energy: number // 能量(Mcal/kg)
    protein: number // 粗蛋白(%)
    fiber: number // 粗纤维(%)
    calcium: number // 钙(%)
    phosphorus: number // 磷(%)
    vitamins: Record<string, number> // 维生素含量
    minerals: Record<string, number> // 矿物质含量
  }
  ingredients: Array<{
    feedId: string
    feedName: string
    proportion: number // 比例(%)
    cost: number // 成本(元/kg)
  }>
  totalCost: number // 配方总成本(元/kg)
  expectedProduction: number // 预期产奶量提升(%)
  isActive: boolean
  createdAt: string
}

export interface FeedRecord {
  id: string
  penId: string // 圈舍ID
  formulaId: string // 配方ID
  feedingTime: string // 投喂时间
  plannedAmount: number // 计划投喂量(kg)
  actualAmount: number // 实际投喂量(kg)
  feederId: string // 饲喂员ID
  feedQuality: {
    moisture: number // 水分(%)
    contamination: number // 污染度(0-10)
    palatability: number // 适口性(0-10)
  }
  notes?: string
  createdAt: string
}

export interface FeedInventory {
  id: string
  feedId: string
  feedName: string
  currentStock: number // 当前库存(kg)
  minimumStock: number // 最低库存(kg)
  unitCost: number // 单价(元/kg)
  supplier: string // 供应商
  expiryDate: string // 过期日期
  qualityGrade: 'A' | 'B' | 'C' // 质量等级
  lastUpdated: string
}

// 数据质量控制相关接口
export interface SensorStatus {
  id: string
  cowId: string
  sensorId: string
  batteryLevel: number // 电池电量(%)
  signalStrength: number // 信号强度(0-100)
  lastUpdateTime: string
  status: 'online' | 'offline' | 'error' // 传感器状态
  errorCode?: string
  location?: {
    latitude: number
    longitude: number
  }
}

export interface DataQualityCheck {
  id: string
  cowId: string
  timestamp: string
  dataType: 'temperature' | 'steps' | 'rumination' | 'activity' | 'feeding' | 'vitalSigns'
  originalValue: number
  qualityScore: number // 数据质量评分(0-100)
  isValid: boolean
  issues: string[] // 质量问题列表
  correctedValue?: number // 校正后的值
  correctionMethod?: string // 校正方法
}

export interface SensorCalibration {
  id: string
  sensorId: string
  calibrationType: 'offset' | 'scale' | 'linear' | 'polynomial'
  parameters: Record<string, number>
  calibrationDate: string
  validUntil: string
  accuracy: number // 校准精度
  technician: string
}

// 人员信息
export interface Person {
  id: string
  name: string // 姓名
  department?: string // 部门
  role: string // 角色
  phone: string // 联系电话
  email: string // 邮箱
  status: string // 状态
  hireDate: string // 入职日期
  notes?: string // 备注
  createdAt: string
  updatedAt: string
}

// 圈舍信息
export interface Pen {
  id: string
  name: string // 圈舍名称
  category: string // 类别
  capacity?: number
  area?: number
  manager?: string
  status?: string
  isActive?: boolean
  createdAt: string
  updatedAt?: string
}

// 发病信息
export interface Disease {
  id: string
  name: string // 病名
  category: string // 类别
  severity?: string
  contagious?: boolean
  symptoms?: string
  treatment?: string
  status?: string
  isActive?: boolean
  createdAt: string
  updatedAt?: string
}

// 药品信息
export interface Medicine {
  id: string
  name: string // 药品名称
  category: string // 类别
  dosage?: string
  unit?: string
  usage?: string
  usageText?: string
  storage?: string
  status?: string
  isActive?: boolean
  createdAt: string
  updatedAt?: string
}

// 转群原因信息
export interface TransferReason {
  id: string
  name?: string // 当前页面使用的名称字段
  reason?: string // 兼容旧原因字段
  categoryId?: string
  categoryName?: string
  category?: string // 兼容旧类别字段
  frequency?: string
  status?: string
  description?: string
  isActive?: boolean
  createdAt: string
  updatedAt?: string
}

// 品种字典
export interface BreedType {
  id: string
  name: string
  category?: string
  origin?: string
  description?: string
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
}

// 兽医事件
export interface VeterinaryEvent {
  id: string
  cowNumber: string
  eventType: '发病' | '用药' | '疾病诊断' | '治疗记录' | '疫苗接种' | '手术' | '检查'
  eventDate?: string
  disease?: string // 具体病例（发病时）
  medicine?: string // 具体药品（用药时）
  eventTime: string // 事件时间
  person: string // 诊断/治疗人员
  diagnosisResult?: string
  symptoms?: string
  treatmentMethod?: string
  treatmentResult?: string
  medicationName?: string
  dosage?: string
  vaccineName?: string
  vaccineBatch?: string
  vaccineDosage?: string
  nextVaccinationDate?: string
  surgeryType?: string
  surgeryResult?: string
  surgeryDescription?: string
  examinationType?: string
  examinationResult?: string
  examinationContent?: string
  cost?: number
  notes?: string // 备注
  createdAt: string
}

// 育种事件
export interface BreedingEvent {
  id: string
  cowNumber: string
  eventType: '配种' | '人工授精' | '妊检' | '妊娠检查' | '产犊' | '分娩' | '流产'
  eventDate?: string
  semenNumber?: string // 精子号（配种时）
  bullNumber?: string
  breedingMethod?: string
  pregnancyResult?: PregnancyTestResult | '妊娠' | '未妊娠' | '可疑' // 妊检结果
  dueDate?: string
  calvingResult?: CalvingResult // 产犊结果
  deliveryResult?: string
  offspringCount?: number
  offspringGender?: string
  offspringStatus?: string
  abortionReason?: string
  gestationDays?: number
  eventTime: string // 事件时间
  person: string // 人员
  notes?: string // 备注
  createdAt: string
}

// 转群事件
export interface TransferEvent {
  id: string
  cowNumber: string
  reason: string // 转群原因
  fromPen: string // 原圈舍
  toPen: string // 目标圈舍
  transferTime: string // 转群时间
  recorder: string // 记录人员
  notes?: string // 备注
  createdAt: string
}

// 离群事件
export interface ExitEvent {
  id: string
  cowNumber: string
  reason: ExitReason // 离群原因
  exitTime: string // 离群时间
  recorder: string // 记录人员
  notes?: string // 备注
  createdAt: string
}

// 入群事件
export interface EntryEvent {
  id: string
  cowNumber: string
  earTagNumber?: string // 耳标号
  breed: string // 品种
  gender: CowGender // 性别
  birthDate: string // 出生日期
  reason: EntryReason // 入群原因
  pen: string // 入群圈舍
  entryTime: string // 入群时间
  recorder: string // 记录人员
  notes?: string // 备注
  createdAt: string
}

// ====== 统一事件模型（V2） ======

// 统一事件类型枚举
export enum UnifiedEventType {
  ENTRY = 'entry', // 入群
  TRANSFER = 'transfer', // 转群
  EXIT = 'exit', // 离场
  BREEDING = 'breeding', // 配种
  PREGNANCY_CHECK = 'pregnancy_check', // 妊检
  CALVING = 'calving', // 产犊
  DRY_OFF = 'dry_off', // 干奶
  VETERINARY = 'veterinary', // 兽医
  VACCINATION = 'vaccination', // 疫苗
  HEALTH_CHECK = 'health_check', // 健康检查
  DEATH = 'death', // 死亡
  WEIGHT = 'weight', // 称重
  CUSTOM = 'custom' // 自定义
}

// 统一事件接口
export interface CowEvent {
  id: string
  cowId: string // 关联 cows.id
  cowNumber: string // 冗余存储，方便查询
  eventType: UnifiedEventType // 事件类型
  eventTime: string // 统一时间字段 (ISO datetime)
  operatorId?: string // 操作人ID
  operatorName?: string // 操作人姓名（冗余）

  // 事件详情 JSON — 不同 eventType 存不同字段
  details: CowEventDetails

  cost?: number // 事件费用
  notes?: string

  createdAt: string
}

// 事件详情联合类型
export type CowEventDetails =
  | EntryEventDetails
  | TransferEventDetails
  | ExitEventDetails
  | BreedingEventDetails
  | PregnancyCheckEventDetails
  | CalvingEventDetails
  | DryOffEventDetails
  | VeterinaryEventDetails
  | VaccinationEventDetails
  | HealthCheckEventDetails
  | DeathEventDetails
  | WeightEventDetails
  | CustomEventDetails

// 入群事件详情
export interface EntryEventDetails {
  entryReason: EntryReason // 入群原因
  entryWeight?: number // 入场体重(kg)
  sourceFarm?: string // 来源牧场
  birthType?: '自然' | '人工'
  earTagNumber?: string
}

// 转群事件详情
export interface TransferEventDetails {
  fromPenId: string
  fromPenName?: string
  toPenId: string
  toPenName?: string
  transferReason: string
}

// 离场事件详情
export interface ExitEventDetails {
  exitReason: ExitReason
  exitWeight?: number
  destination?: string // 去向（无害化处理/屠宰场/他场）
}

// 配种事件详情
export interface BreedingEventDetails {
  bullId?: string
  bullNumber?: string
  method: '自然交配' | '人工授精'
  semenBatch?: string // 精液批号
  technicianId?: string
}

// 妊检事件详情
export interface PregnancyCheckEventDetails {
  checkMethod: 'B超' | '直肠检查' | '激素检测'
  result: PregnancyTestResult | '可疑'
  expectedDueDate?: string
}

// 产犊事件详情
export interface CalvingEventDetails {
  calfCount: number
  calfDetails: Array<{
    gender: '公' | '母'
    weight: number
    status: '存活' | '死亡'
  }>
  deliveryMethod: '顺产' | '难产' | '剖腹产'
  gestationDays?: number
}

// 干奶事件详情
export interface DryOffEventDetails {
  reason: '自然干奶' | '强制干奶' | '疾病干奶'
  lastMilkingDate?: string
  expectedCalvingDate?: string
}

// 兽医事件详情
export interface VeterinaryEventDetails {
  diseaseId?: string
  diagnosis: string
  symptoms?: string
  treatment?: string
  medicineIds?: string[]
  cost?: number
  result?: string
}

// 疫苗事件详情
export interface VaccinationEventDetails {
  vaccineName: string
  vaccineBatch?: string
  dosage?: string
  nextVaccinationDate?: string
}

// 健康检查事件详情
export interface HealthCheckEventDetails {
  checkType: string
  findings?: string
  recommendations?: string
}

// 死亡事件详情
export interface DeathEventDetails {
  cause: string
  disposalMethod?: string
}

// 称重事件详情
export interface WeightEventDetails {
  weight: number
  bodyScore?: number // 体况评分(1-5)
}

// 自定义事件详情
export interface CustomEventDetails {
  title: string
  description?: string
  [key: string]: any
}

// 预警信息
export interface WarningInfo {
  id: string
  cowNumber: string
  type: '异常预警' | '发情预警'
  reason: string // 预警原因
  temperatureData: TemperatureData[] // 24小时温度数据
  stepData: StepData[] // 24小时步数数据
  cowInfo: CowBasic // 牛只信息
  detectedAt: string // 检测时间
}

// 查询参数
export interface CowQueryParams {
  cowNumber?: string
  type?: CowType
  status?: CowStatus
  pen?: string
  dateRange?: [string, string]
  eventType?: EventType
  subEventType?: string
}

// 统计信息
export interface StatisticsInfo {
  totalCows: number
  healthyCows: number
  abnormalCows: number
  heatCows: number
  pregnantCows: number
  mixedCows: number
  leftCows: number
}

// 24小时数据
export interface HourlyData {
  time: string
  temperature: number
  steps: number
}

// 导出配置
export interface ExportConfig {
  columns: string[]
  filters: {
    types?: CowType[]
    dateRange?: [string, string]
  }
}

// 事件导出配置
export interface EventExportConfig {
  columns: string[]
  filters: {
    eventTypes?: EventType[]
    dateRange?: [string, string]
    cowNumber?: string
  }
}
