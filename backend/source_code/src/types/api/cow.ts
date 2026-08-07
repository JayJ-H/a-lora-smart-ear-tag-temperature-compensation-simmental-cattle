// 犇牛智能健康预警系统 API 类型定义

import type {
  CowBasic,
  TemperatureData,
  StepData,
  ExtendedSensorData,
  RuminationData,
  ActivityData,
  FeedingData,
  SensorStatus,
  DataQualityCheck,
  SensorCalibration,
  Person,
  Pen,
  Disease,
  Medicine,
  TransferReason,
  VeterinaryEvent,
  BreedingEvent,
  TransferEvent,
  ExitEvent,
  EntryEvent,
  WarningInfo,
  CowQueryParams,
  StatisticsInfo,
  ExportConfig,
  EventExportConfig,
  ReminderRule,
  KPIMetric,
  KPIValue,
  KPIDashboard,
  KPIDashboardData,
  CostItem,
  RevenueItem,
  EconomicAnalysis,
  BudgetPlan,
  ProfitabilityReport,
  PredictiveModel,
  PredictionResult,
  ForecastScenario,
  PredictiveAlert,
  PredictiveDashboard,
  ModelTrainingJob,
  AutomatedAction as AutomationTask,
  HardwareDevice,
  DeviceDataStream,
  IntegrationProtocol,
  DataSynchronization,
  DeviceMaintenance,
  HardwareAlert,
  IntegrationDashboard
} from '../cow'

// API响应基础结构
export interface ApiResponse<T = any> {
  code: number
  message: string
  data: T
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

// 牛只相关API
export interface CowApi {
  // 获取牛只列表
  getCowList(
    params?: CowQueryParams & { page?: number; pageSize?: number }
  ): Promise<PaginatedResponse<CowBasic>>

  // 获取单个牛只信息
  getCowByNumber(cowNumber: string): Promise<ApiResponse<CowBasic>>

  // 创建牛只（入群事件）
  createCow(data: Omit<EntryEvent, 'id' | 'createdAt'>): Promise<ApiResponse<CowBasic>>

  // 更新牛只信息
  updateCow(cowNumber: string, data: Partial<CowBasic>): Promise<ApiResponse<CowBasic>>

  // 删除牛只
  deleteCow(cowNumber: string): Promise<ApiResponse<boolean>>

  // 获取牛只的24小时数据
  getCowHourlyData(
    cowNumber: string,
    date: string
  ): Promise<
    ApiResponse<{
      temperature: TemperatureData[]
      steps: StepData[]
    }>
  >

  // 批量导入牛只
  importCows(data: EntryEvent[]): Promise<ApiResponse<{ success: number; failed: number }>>
}

// 测温步数相关API
export interface SensorApi {
  // 获取测温数据
  getTemperatureData(params: {
    cowNumber?: string
    startTime?: string
    endTime?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<TemperatureData>>

  // 获取步数数据
  getStepData(params: {
    cowNumber?: string
    startTime?: string
    endTime?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<StepData>>

  // 上传测温数据
  uploadTemperatureData(
    data: Omit<TemperatureData, 'id' | 'createdAt'>[]
  ): Promise<ApiResponse<boolean>>

  // 上传步数数据
  uploadStepData(data: Omit<StepData, 'id' | 'createdAt'>[]): Promise<ApiResponse<boolean>>

  // 获取扩展传感器数据
  getExtendedSensorData(params: {
    cowId?: string
    startTime?: string
    endTime?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<ExtendedSensorData>>

  // 获取反刍数据
  getRuminationData(params: {
    cowId?: string
    startTime?: string
    endTime?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<RuminationData>>

  // 获取活动数据
  getActivityData(params: {
    cowId?: string
    startTime?: string
    endTime?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<ActivityData>>

  // 获取进食数据
  getFeedingData(params: {
    cowId?: string
    startTime?: string
    endTime?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<FeedingData>>

  // 数据质量控制接口
  getSensorStatus(params: {
    cowId?: string
    status?: 'online' | 'offline' | 'error'
  }): Promise<ApiResponse<SensorStatus[]>>

  getDataQualityChecks(params: {
    cowId?: string
    dataType?: string
    isValid?: boolean
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<DataQualityCheck>>

  getSensorCalibrations(params: {
    sensorId?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<SensorCalibration>>

  calibrateSensor(data: Omit<SensorCalibration, 'id'>): Promise<ApiResponse<SensorCalibration>>

  markDataQualityIssue(data: Omit<DataQualityCheck, 'id'>): Promise<ApiResponse<DataQualityCheck>>
}

// 事件相关API
export interface EventApi {
  // 兽医事件
  getVeterinaryEvents(params: {
    cowNumber?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<VeterinaryEvent>>

  createVeterinaryEvent(
    data: Omit<VeterinaryEvent, 'id' | 'createdAt'>
  ): Promise<ApiResponse<VeterinaryEvent>>

  // 育种事件
  getBreedingEvents(params: {
    cowNumber?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<BreedingEvent>>

  createBreedingEvent(
    data: Omit<BreedingEvent, 'id' | 'createdAt'>
  ): Promise<ApiResponse<BreedingEvent>>

  // 转群事件
  getTransferEvents(params: {
    cowNumber?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<TransferEvent>>

  createTransferEvent(
    data: Omit<TransferEvent, 'id' | 'createdAt'>
  ): Promise<ApiResponse<TransferEvent>>

  // 离群事件
  getExitEvents(params: {
    cowNumber?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<ExitEvent>>

  createExitEvent(data: Omit<ExitEvent, 'id' | 'createdAt'>): Promise<ApiResponse<ExitEvent>>

  // 入群事件
  getEntryEvents(params: {
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<EntryEvent>>

  createEntryEvent(data: Omit<EntryEvent, 'id' | 'createdAt'>): Promise<ApiResponse<EntryEvent>>
}

// 基础数据API
export interface BaseDataApi {
  // 人员管理
  getPersons(params?: {
    department?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<Person>>

  createPerson(data: Omit<Person, 'id' | 'createdAt'>): Promise<ApiResponse<Person>>

  updatePerson(id: string, data: Partial<Person>): Promise<ApiResponse<Person>>

  deletePerson(id: string): Promise<ApiResponse<boolean>>

  // 圈舍管理
  getPens(params?: {
    category?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<Pen>>

  createPen(data: Omit<Pen, 'id' | 'createdAt'>): Promise<ApiResponse<Pen>>

  updatePen(id: string, data: Partial<Pen>): Promise<ApiResponse<Pen>>

  deletePen(id: string): Promise<ApiResponse<boolean>>

  // 发病信息管理
  getDiseases(params?: {
    category?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<Disease>>

  createDisease(data: Omit<Disease, 'id' | 'createdAt'>): Promise<ApiResponse<Disease>>

  updateDisease(id: string, data: Partial<Disease>): Promise<ApiResponse<Disease>>

  deleteDisease(id: string): Promise<ApiResponse<boolean>>

  // 药品信息管理
  getMedicines(params?: {
    category?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<Medicine>>

  createMedicine(data: Omit<Medicine, 'id' | 'createdAt'>): Promise<ApiResponse<Medicine>>

  updateMedicine(id: string, data: Partial<Medicine>): Promise<ApiResponse<Medicine>>

  deleteMedicine(id: string): Promise<ApiResponse<boolean>>

  // 转群原因管理
  getTransferReasons(params?: {
    category?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<TransferReason>>

  createTransferReason(
    data: Omit<TransferReason, 'id' | 'createdAt'>
  ): Promise<ApiResponse<TransferReason>>

  updateTransferReason(
    id: string,
    data: Partial<TransferReason>
  ): Promise<ApiResponse<TransferReason>>

  deleteTransferReason(id: string): Promise<ApiResponse<boolean>>
}

// 预警相关API
export interface WarningApi {
  // 获取异常预警
  getAbnormalWarnings(params?: {
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<WarningInfo>>

  // 获取发情预警
  getHeatWarnings(params?: {
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<WarningInfo>>

  // 手动刷新预警
  refreshWarnings(): Promise<ApiResponse<boolean>>
}

// 统计相关API
export interface StatisticsApi {
  // 获取统计信息
  getStatistics(): Promise<ApiResponse<StatisticsInfo>>

  // 获取各类牛只列表
  getHealthyCows(params?: {
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<CowBasic>>

  getAbnormalCows(params?: {
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<CowBasic>>

  getHeatCows(params?: { page?: number; pageSize?: number }): Promise<PaginatedResponse<CowBasic>>

  getPregnantCows(params?: {
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<CowBasic>>

  getMixedCows(params?: { page?: number; pageSize?: number }): Promise<PaginatedResponse<CowBasic>>

  getLeftCows(params?: { page?: number; pageSize?: number }): Promise<PaginatedResponse<CowBasic>>
}

// 导出相关API
export interface ExportApi {
  // 导出牛只信息
  exportCowInfo(config: ExportConfig): Promise<ApiResponse<{ url: string }>>

  // 导出牛只事件
  exportCowEvents(config: EventExportConfig): Promise<ApiResponse<{ url: string }>>

  // 获取导出历史
  getExportHistory(params?: { page?: number; pageSize?: number }): Promise<
    PaginatedResponse<{
      id: string
      type: '牛只信息' | '牛只事件'
      fileName: string
      createdAt: string
      status: 'processing' | 'completed' | 'failed'
      downloadUrl?: string
    }>
  >
}

// 育种指标评估 API
export interface KPIApi {
  // 获取所有KPI指标
  getKPIMetrics(): Promise<ApiResponse<KPIMetric[]>>

  // 获取单个KPI指标
  getKPIMetric(metricId: string): Promise<ApiResponse<KPIMetric>>

  // 获取KPI指标值
  getKPIValues(params?: {
    metricIds?: string[]
    period?: string
    startDate?: string
    endDate?: string
  }): Promise<ApiResponse<KPIValue[]>>

  // 获取仪表板列表
  getKPIDashboards(): Promise<ApiResponse<KPIDashboard[]>>

  // 获取仪表板详情
  getKPIDashboard(dashboardId: string): Promise<ApiResponse<KPIDashboard>>

  // 获取仪表板数据
  getKPIDashboardData(dashboardId: string): Promise<ApiResponse<KPIDashboardData>>

  // 创建仪表板
  createKPIDashboard(
    dashboard: Omit<KPIDashboard, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ApiResponse<KPIDashboard>>

  // 更新仪表板
  updateKPIDashboard(
    dashboardId: string,
    updates: Partial<KPIDashboard>
  ): Promise<ApiResponse<KPIDashboard>>

  // 删除仪表板
  deleteKPIDashboard(dashboardId: string): Promise<ApiResponse<boolean>>
}

// 经济效益分析API
export interface EconomicApi {
  // 获取成本记录
  getCostRecords(params?: {
    startDate?: string
    endDate?: string
    category?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<CostItem>>

  // 获取收入记录
  getRevenueRecords(params?: {
    startDate?: string
    endDate?: string
    category?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<RevenueItem>>

  // 创建成本记录
  createCostRecord(record: Omit<CostItem, 'id' | 'createdAt'>): Promise<ApiResponse<CostItem>>

  // 创建收入记录
  createRevenueRecord(
    record: Omit<RevenueItem, 'id' | 'createdAt'>
  ): Promise<ApiResponse<RevenueItem>>

  // 删除成本记录
  deleteCostRecord(id: string): Promise<ApiResponse<boolean>>

  // 删除收入记录
  deleteRevenueRecord(id: string): Promise<ApiResponse<boolean>>

  // 获取经济效益分析
  getEconomicAnalysis(params: {
    startDate: string
    endDate: string
    periodType?: 'monthly' | 'quarterly' | 'yearly'
  }): Promise<ApiResponse<EconomicAnalysis>>

  // 获取预算计划列表
  getBudgetPlans(): Promise<ApiResponse<BudgetPlan[]>>

  // 创建预算计划
  createBudgetPlan(
    plan: Omit<BudgetPlan, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ApiResponse<BudgetPlan>>

  // 更新预算计划
  updateBudgetPlan(id: string, updates: Partial<BudgetPlan>): Promise<ApiResponse<BudgetPlan>>

  // 删除预算计划
  deleteBudgetPlan(id: string): Promise<ApiResponse<boolean>>

  // 生成盈利能力报告
  generateProfitabilityReport(params: {
    startDate: string
    endDate: string
    title?: string
  }): Promise<ApiResponse<ProfitabilityReport>>
}

// 预测分析API
export interface PredictiveApi {
  // 获取预测模型列表
  getPredictiveModels(params?: {
    type?: string
    status?: string
  }): Promise<ApiResponse<PredictiveModel[]>>

  // 获取单个预测模型
  getPredictiveModel(modelId: string): Promise<ApiResponse<PredictiveModel>>

  // 创建预测模型
  createPredictiveModel(
    model: Omit<PredictiveModel, 'id' | 'createdAt' | 'performance' | 'status' | 'lastTrained'>
  ): Promise<ApiResponse<PredictiveModel>>

  // 更新预测模型
  updatePredictiveModel(
    modelId: string,
    updates: Partial<PredictiveModel>
  ): Promise<ApiResponse<PredictiveModel>>

  // 删除预测模型
  deletePredictiveModel(modelId: string): Promise<ApiResponse<boolean>>

  // 训练预测模型
  trainPredictiveModel(
    modelId: string,
    trainingData: {
      startDate: string
      endDate: string
      features: string[]
    }
  ): Promise<ApiResponse<ModelTrainingJob>>

  // 获取训练作业状态
  getTrainingJobStatus(jobId: string): Promise<ApiResponse<ModelTrainingJob>>

  // 获取预测结果
  getPredictionResults(params: {
    modelId?: string
    startDate?: string
    endDate?: string
    limit?: number
  }): Promise<ApiResponse<PredictionResult[]>>

  // 生成预测
  generatePrediction(
    modelId: string,
    targetDate: string,
    features: Record<string, number>
  ): Promise<ApiResponse<PredictionResult>>

  // 获取预测情景列表
  getForecastScenarios(): Promise<ApiResponse<ForecastScenario[]>>

  // 创建预测情景
  createForecastScenario(
    scenario: Omit<ForecastScenario, 'id' | 'results' | 'createdAt'>
  ): Promise<ApiResponse<ForecastScenario>>

  // 更新预测情景
  updateForecastScenario(
    scenarioId: string,
    updates: Partial<ForecastScenario>
  ): Promise<ApiResponse<ForecastScenario>>

  // 删除预测情景
  deleteForecastScenario(scenarioId: string): Promise<ApiResponse<boolean>>

  // 获取预测预警
  getPredictiveAlerts(params?: {
    status?: string
    severity?: string
    type?: string
  }): Promise<ApiResponse<PredictiveAlert[]>>

  // 确认预测预警
  acknowledgePredictiveAlert(alertId: string): Promise<ApiResponse<boolean>>

  // 解决预测预警
  resolvePredictiveAlert(alertId: string, resolution: string): Promise<ApiResponse<boolean>>

  // 获取预测仪表板
  getPredictiveDashboard(dashboardId: string): Promise<ApiResponse<PredictiveDashboard>>

  // 创建预测仪表板
  createPredictiveDashboard(
    dashboard: Omit<PredictiveDashboard, 'id' | 'summary'>
  ): Promise<ApiResponse<PredictiveDashboard>>

  // 更新预测仪表板
  updatePredictiveDashboard(
    dashboardId: string,
    updates: Partial<PredictiveDashboard>
  ): Promise<ApiResponse<PredictiveDashboard>>

  // 删除预测仪表板
  deletePredictiveDashboard(dashboardId: string): Promise<ApiResponse<boolean>>
}

// 自动化引擎API
export interface AutomationApi {
  // 获取自动化任务列表
  getAutomationTasks(params?: {
    status?: 'active' | 'inactive'
    type?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResponse<AutomationTask>>

  // 获取提醒规则列表
  getReminderRules(params?: {
    reminderType?: string
    isActive?: boolean
  }): Promise<ApiResponse<ReminderRule[]>>

  // 创建自动化任务
  createAutomationTask(
    task: Omit<AutomationTask, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ApiResponse<AutomationTask>>

  // 更新自动化任务
  updateAutomationTask(
    taskId: string,
    updates: Partial<AutomationTask>
  ): Promise<ApiResponse<AutomationTask>>

  // 删除自动化任务
  deleteAutomationTask(taskId: string): Promise<ApiResponse<boolean>>

  // 创建提醒规则
  createReminderRule(
    rule: Omit<ReminderRule, 'id' | 'createdAt' | 'triggerCount'>
  ): Promise<ApiResponse<ReminderRule>>

  // 更新提醒规则
  updateReminderRule(
    ruleId: string,
    updates: Partial<ReminderRule>
  ): Promise<ApiResponse<ReminderRule>>

  // 删除提醒规则
  deleteReminderRule(ruleId: string): Promise<ApiResponse<boolean>>

  // 触发提醒
  triggerReminder(ruleId: string, cowIds: string[]): Promise<ApiResponse<boolean>>

  // 执行自动化检查
  executeAutomationCheck(): Promise<
    ApiResponse<{
      triggeredActions: number
      triggeredTransfers: number
      sentReminders: number
      createdTasks: number
    }>
  >
}

// 硬件集成API
export interface HardwareApi {
  // 获取设备列表
  getHardwareDevices(params?: {
    type?: string
    brand?: string
    status?: string
    penId?: string
  }): Promise<PaginatedResponse<HardwareDevice>>

  // 获取单个设备
  getHardwareDevice(deviceId: string): Promise<ApiResponse<HardwareDevice>>

  // 注册新设备
  registerHardwareDevice(
    device: Omit<HardwareDevice, 'id' | 'installedAt'>
  ): Promise<ApiResponse<HardwareDevice>>

  // 更新设备信息
  updateHardwareDevice(
    deviceId: string,
    updates: Partial<HardwareDevice>
  ): Promise<ApiResponse<HardwareDevice>>

  // 删除设备
  deleteHardwareDevice(deviceId: string): Promise<ApiResponse<boolean>>

  // 获取设备数据流
  getDeviceDataStream(params: {
    deviceId?: string
    dataType?: string
    startDate?: string
    endDate?: string
    limit?: number
  }): Promise<ApiResponse<DeviceDataStream[]>>

  // 发送设备命令
  sendDeviceCommand(
    deviceId: string,
    command: {
      type: string
      parameters: Record<string, any>
      priority: 'low' | 'normal' | 'high'
      qos?: number
      retain?: boolean
      topic?: string
      payload?: Record<string, any>
      cowIds?: string[]
      sensorStatusIds?: string[]
      synchronizationIds?: string[]
    }
  ): Promise<ApiResponse<{ commandId: string; status: 'queued' | 'sent' | 'executed' }>>

  // 获取集成协议列表
  getIntegrationProtocols(): Promise<ApiResponse<IntegrationProtocol[]>>

  // 创建集成协议
  createIntegrationProtocol(
    protocol: Omit<IntegrationProtocol, 'id' | 'lastUsed' | 'successRate'>
  ): Promise<ApiResponse<IntegrationProtocol>>

  // 更新集成协议
  updateIntegrationProtocol(
    protocolId: string,
    updates: Partial<IntegrationProtocol>
  ): Promise<ApiResponse<IntegrationProtocol>>

  // 删除集成协议
  deleteIntegrationProtocol(protocolId: string): Promise<ApiResponse<boolean>>

  // 测试协议连接
  testProtocolConnection(protocolId: string): Promise<
    ApiResponse<{
      success: boolean
      responseTime: number
      errorMessage?: string
    }>
  >

  // 获取数据同步配置
  getDataSynchronizations(): Promise<ApiResponse<DataSynchronization[]>>

  // 创建数据同步
  createDataSynchronization(
    sync: Omit<
      DataSynchronization,
      'id' | 'lastSync' | 'nextSync' | 'recordsProcessed' | 'successRate' | 'errorCount'
    >
  ): Promise<ApiResponse<DataSynchronization>>

  // 更新数据同步
  updateDataSynchronization(
    syncId: string,
    updates: Partial<DataSynchronization>
  ): Promise<ApiResponse<DataSynchronization>>

  // 删除数据同步
  deleteDataSynchronization(syncId: string): Promise<ApiResponse<boolean>>

  // 手动触发同步
  triggerDataSynchronization(syncId: string): Promise<
    ApiResponse<{
      syncId: string
      status: 'started' | 'running' | 'completed' | 'failed'
      recordsProcessed: number
    }>
  >

  // 获取设备维护记录
  getDeviceMaintenance(params?: {
    deviceId?: string
    type?: string
    status?: string
    startDate?: string
    endDate?: string
  }): Promise<PaginatedResponse<DeviceMaintenance>>

  // 创建维护记录
  createDeviceMaintenance(
    maintenance: Omit<DeviceMaintenance, 'id'>
  ): Promise<ApiResponse<DeviceMaintenance>>

  // 更新维护记录
  updateDeviceMaintenance(
    maintenanceId: string,
    updates: Partial<DeviceMaintenance>
  ): Promise<ApiResponse<DeviceMaintenance>>

  // 获取硬件预警
  getHardwareAlerts(params?: {
    deviceId?: string
    type?: string
    severity?: string
    status?: string
  }): Promise<ApiResponse<HardwareAlert[]>>

  // 确认硬件预警
  acknowledgeHardwareAlert(alertId: string): Promise<ApiResponse<boolean>>

  // 解决硬件预警
  resolveHardwareAlert(alertId: string, resolution: string): Promise<ApiResponse<boolean>>

  // 获取硬件集成仪表板
  getHardwareIntegrationDashboard(): Promise<ApiResponse<IntegrationDashboard>>

  // 获取系统健康报告
  getSystemHealthReport(timeRange?: string): Promise<
    ApiResponse<{
      overallHealth: number
      componentHealth: Record<string, number>
      uptime: number
      incidents: number
      recommendations: string[]
    }>
  >

  // 执行系统诊断
  runSystemDiagnostics(): Promise<
    ApiResponse<{
      diagnosticId: string
      status: 'running' | 'completed' | 'failed'
      results: {
        component: string
        status: 'healthy' | 'warning' | 'error'
        details: string
        recommendations?: string[]
      }[]
    }>
  >

}
