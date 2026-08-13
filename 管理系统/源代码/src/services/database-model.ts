/**
 * 数据库模型定义
 * 使用 Dexie.js 定义 IndexedDB 数据库结构
 */

import Dexie, { Table } from 'dexie'
import type {
  CowBasic,
  Person,
  Pen,
  Disease,
  Medicine,
  TransferReason,
  BreedType,
  MilkRecord,
  FeedRecord,
  BreedingRecord,
  MilkQualityStandard,
  FeedFormula,
  FeedInventory,
  ReproductionCycle,
  HealthAlert,
  LactationCurve,
  WorkflowTemplate,
  WorkflowInstance,
  AutomatedAction,
  SmartTransferRule,
  ReminderRule,
  KPIDashboard,
  KPIDashboardData,
  EconomicAnalysis,
  CostItem,
  RevenueItem,
  BudgetPlan,
  OmicsSample,
  OmicsDataset,
  OmicsMarker,
  MultiOmicsAssociation,
  BreedingAnalysis,
  PredictiveModel,
  PredictionResult,
  ForecastScenario,
  PredictiveAlert,
  SensorStatus,
  DataQualityCheck,
  SensorCalibration,
  HardwareDevice,
  IntegrationProtocol,
  DataSynchronization,
  HardwareAlert,
  DeviceMaintenance,
  IntegrationDashboard,
  EntryEvent,
  TransferEvent,
  ExitEvent,
  BreedingEvent,
  VeterinaryEvent,
  ExtendedSensorData
} from '@/types'
import { V2_DATABASE_STORE_SCHEMA, V2_DATABASE_TABLES } from './v2-database-tables'

/**
 * 犇牛智能健康预警系统数据库
 */
export class CattleDatabase extends Dexie {
  [tableName: string]: any

  // 核心数据表
  cows!: Table<CowBasic, string>
  sensors!: Table<ExtendedSensorData, string>
  'sensor-readings'!: Table<any, string>
  persons!: Table<Person, string>
  pens!: Table<Pen, string>
  diseases!: Table<Disease, string>
  medicines!: Table<Medicine, string>
  'transfer-reasons'!: Table<TransferReason, string>
  'breed-types'!: Table<BreedType, string>

  // 生产管理
  'milk-records'!: Table<MilkRecord, string>
  'milk-quality-standards'!: Table<MilkQualityStandard, string>
  'lactation-curves'!: Table<LactationCurve, string>
  'feed-records'!: Table<FeedRecord, string>
  'feed-formulas'!: Table<FeedFormula, string>
  'feed-inventory'!: Table<FeedInventory, string>
  'breeding-records'!: Table<BreedingRecord, string>
  'reproduction-cycles'!: Table<ReproductionCycle, string>
  'breeding-bulls'!: Table<any, string>
  'reproduction-kpis'!: Table<any, string>
  alerts!: Table<HealthAlert, string>

  // 运营分析
  'workflow-templates'!: Table<WorkflowTemplate, string>
  'workflow-instances'!: Table<WorkflowInstance, string>
  'automated-actions'!: Table<AutomatedAction, string>
  'smart-transfer-rules'!: Table<SmartTransferRule, string>
  'reminder-rules'!: Table<ReminderRule, string>
  'kpi-dashboards'!: Table<KPIDashboard, string>
  'kpi-dashboard-data'!: Table<KPIDashboardData, string>
  'economic-analysis'!: Table<EconomicAnalysis, string>
  'cost-items'!: Table<CostItem, string>
  'revenue-items'!: Table<RevenueItem, string>
  'budget-plans'!: Table<BudgetPlan, string>
  'omics-samples'!: Table<OmicsSample, string>
  'omics-datasets'!: Table<OmicsDataset, string>
  'omics-markers'!: Table<OmicsMarker, string>
  'multi-omics-associations'!: Table<MultiOmicsAssociation, string>
  'breeding-analyses'!: Table<BreedingAnalysis, string>
  'phenotype-trait-definitions'!: Table<any, string>
  'phenotype-records'!: Table<any, string>
  'phenotype-export-methods'!: Table<any, string>
  'logical-trait-rules'!: Table<any, string>
  'base-info-categories'!: Table<any, string>
  'predictive-models'!: Table<PredictiveModel, string>
  'prediction-results'!: Table<PredictionResult, string>
  'forecast-scenarios'!: Table<ForecastScenario, string>
  'predictive-alerts'!: Table<PredictiveAlert, string>

  // 数据与设备
  'sensor-status'!: Table<SensorStatus, string>
  'data-quality-checks'!: Table<DataQualityCheck, string>
  'sensor-calibrations'!: Table<SensorCalibration, string>
  'hardware-devices'!: Table<HardwareDevice, string>
  'integration-protocols'!: Table<IntegrationProtocol, string>
  'data-synchronizations'!: Table<DataSynchronization, string>
  'hardware-alerts'!: Table<HardwareAlert, string>
  'device-maintenance'!: Table<DeviceMaintenance, string>
  'integration-dashboards'!: Table<IntegrationDashboard, string>

  // 事件录入（统一事件模型）
  'cow-events'!: Table<any, string>
  // 旧事件表（保留用于数据迁移）
  'entry-events'!: Table<EntryEvent, string>
  'transfer-events'!: Table<TransferEvent, string>
  'exit-events'!: Table<ExitEvent, string>
  'breeding-events'!: Table<BreedingEvent, string>
  'veterinary-events'!: Table<VeterinaryEvent, string>
  'health-scores'!: Table<any, string>
  // 灵活导出/导入/自定义字段系统（对标阿菲金）
  'export-configs'!: Table<any, string>
  'custom-fields'!: Table<any, string>
  'import-configs'!: Table<any, string>
  'export-audit-logs'!: Table<any, string>
  'hardware-command-logs'!: Table<any, string>
  'breeding-decision-runs'!: Table<any, string>
  'operation-audit-logs'!: Table<any, string>

  constructor() {
    super('CattleManagementDB')

    const baseStores = {
      cows: 'id, cowNumber, earTagNumber, status, breed, gender, currentPen, birthDate',
      sensors: 'id, cowId, timestamp, [cowId+timestamp]',
      // 传感器长表（新）
      'sensor-readings':
        'id, cowId, timestamp, metric, [cowId+metric+timestamp], [cowId+timestamp]',
      persons: 'id, name, department',
      pens: 'id, name, category',
      diseases: 'id, name, category',
      medicines: 'id, name, category',
      'transfer-reasons': 'id, name, category',
      'breed-types': 'id, name, category, isActive',
      'milk-records': 'id, cowId, milkingTime, [cowId+milkingTime]',
      'milk-quality-standards': 'id, name',
      'lactation-curves': 'id, cowId, [cowId+day]',
      'feed-records': 'id, cowId, feedTime, [cowId+feedTime]',
      'feed-formulas': 'id, name, targetGroup',
      'feed-inventory': 'id, feedType',
      'breeding-records': 'id, cowId, eventTime, [cowId+eventTime]',
      // 繁殖链条（完整）
      'reproduction-cycles':
        'id, cowId, cycleNumber, cycleStartDate, inseminationDate, pregnancyCheckDate, actualCalvingDate, dryOffDate, cycleResult, [cowId+cycleNumber], [inseminationDate], [actualCalvingDate]',
      'breeding-bulls':
        'id, cowId, bullNumber, geneticMerit, isActive, [bullNumber], [geneticMerit]',
      'reproduction-kpis': 'id, period, periodStart, periodEnd, [period], [periodStart+periodEnd]',
      alerts: 'id, cowId, alertTime, severity, [cowId+alertTime]',
      'workflow-templates': 'id, name',
      'workflow-instances': 'id, templateId, status, createdAt',
      'automated-actions': 'id, workflowInstanceId, status',
      'smart-transfer-rules': 'id, name, enabled',
      'reminder-rules': 'id, name, enabled',
      'kpi-dashboards': 'id, name',
      'kpi-dashboard-data': 'id, dashboardId, timestamp',
      'economic-analysis': 'id, period, [period+type]',
      'cost-items': 'id, date, category, [date+category]',
      'revenue-items': 'id, date, category, [date+category]',
      'budget-plans': 'id, period, status',
      'predictive-models': 'id, name, type, status',
      'prediction-results': 'id, modelId, timestamp, [modelId+timestamp]',
      'forecast-scenarios': 'id, name, baseDate',
      'predictive-alerts': 'id, modelId, alertTime, severity',
      'sensor-status': 'id, deviceId, timestamp',
      'data-quality-checks': 'id, checkTime, status',
      'sensor-calibrations': 'id, deviceId, calibrationTime',
      'hardware-devices': 'id, name, type, status',
      'integration-protocols': 'id, name, type',
      'data-synchronizations': 'id, protocolId, status, syncTime',
      'hardware-alerts': 'id, deviceId, alertTime, severity',
      'device-maintenance': 'id, deviceId, maintenanceDate, status',
      'integration-dashboards': 'id, name',
      // 统一事件表
      'cow-events':
        'id, cowId, cowNumber, eventType, eventTime, operatorId, [cowId+eventTime], [eventType+eventTime]',
      // 旧事件表（保留用于数据迁移）
      'entry-events': 'id, cowNumber, entryTime, [cowNumber+entryTime]',
      'transfer-events': 'id, cowNumber, transferTime, [cowNumber+transferTime]',
      'exit-events': 'id, cowNumber, exitTime, [cowNumber+exitTime]',
      'breeding-events': 'id, cowNumber, eventTime, [cowNumber+eventTime]',
      'veterinary-events': 'id, cowNumber, eventTime, [cowNumber+eventTime]',
      'export-audit-logs': 'id, action_type, operator, status, created_at',
      'hardware-command-logs': 'id, device_id, command_type, operator, status, requested_at',
      'breeding-decision-runs': 'id, run_type, operator, status, created_at',
      'operation-audit-logs':
        'id, action_type, target_type, target_id, operator, status, created_at',
      // 灵活导出/导入/自定义字段系统
      'export-configs': 'id, name, scope, targetType, createdAt, [scope+targetType]',
      'custom-fields': 'id, fieldName, scope, isActive, createdAt, [scope+fieldName]',
      'import-configs': 'id, name, scope, createdAt, [scope]'
    }
    const v2Stores = Object.fromEntries(
      V2_DATABASE_TABLES.map((table) => [table.key, V2_DATABASE_STORE_SCHEMA])
    )

    this.version(1).stores(baseStores)
    this.version(2).stores({
      ...baseStores,
      'omics-samples':
        'id, sampleCode, cowId, cowNumber, sampleType, status, collectionDate, [cowId+collectionDate]',
      'omics-datasets': 'id, datasetCode, name, dataType, platform, status, generatedAt',
      'omics-markers':
        'id, datasetId, markerCode, markerType, trait, geneSymbol, [datasetId+markerCode]',
      'multi-omics-associations':
        'id, trait, primaryDatasetId, secondaryDatasetId, associationType, significance',
      'breeding-analyses': 'id, analysisCode, targetTrait, modelType, status, executedAt',
      'phenotype-trait-definitions': 'id, code, category, status',
      'phenotype-records': 'id, cowId, cowNumber, traitCode, collectionDate, [cowId+traitCode]',
      'phenotype-export-methods': 'id, code, groupBy, status',
      'base-info-categories': 'id, scope, name'
    })
    this.version(3).stores({
      ...baseStores,
      'omics-samples':
        'id, sampleCode, cowId, cowNumber, sampleType, status, collectionDate, [cowId+collectionDate]',
      'omics-datasets': 'id, datasetCode, name, dataType, platform, status, generatedAt',
      'omics-markers':
        'id, datasetId, markerCode, markerType, trait, geneSymbol, [datasetId+markerCode]',
      'multi-omics-associations':
        'id, trait, primaryDatasetId, secondaryDatasetId, associationType, significance',
      'breeding-analyses': 'id, analysisCode, targetTrait, modelType, status, executedAt',
      'phenotype-trait-definitions': 'id, code, category, status',
      'phenotype-records': 'id, cowId, cowNumber, traitCode, collectionDate, [cowId+traitCode]',
      'phenotype-export-methods': 'id, code, groupBy, status',
      'base-info-categories': 'id, scope, name'
    })
    this.version(4).stores({
      ...baseStores,
      'omics-samples':
        'id, sampleCode, cowId, cowNumber, sampleType, status, collectionDate, [cowId+collectionDate]',
      'omics-datasets': 'id, datasetCode, name, dataType, platform, status, generatedAt',
      'omics-markers':
        'id, datasetId, markerCode, markerType, trait, geneSymbol, [datasetId+markerCode]',
      'multi-omics-associations':
        'id, trait, primaryDatasetId, secondaryDatasetId, associationType, significance',
      'breeding-analyses': 'id, analysisCode, targetTrait, modelType, status, executedAt',
      'phenotype-trait-definitions': 'id, code, category, status',
      'phenotype-records': 'id, cowId, cowNumber, traitCode, collectionDate, [cowId+traitCode]',
      'phenotype-export-methods': 'id, code, groupBy, status',
      'base-info-categories': 'id, scope, name'
    })
    this.version(5).stores({
      ...baseStores,
      'omics-samples':
        'id, sampleCode, cowId, cowNumber, sampleType, status, collectionDate, [cowId+collectionDate]',
      'omics-datasets': 'id, datasetCode, name, dataType, platform, status, generatedAt',
      'omics-markers':
        'id, datasetId, markerCode, markerType, trait, geneSymbol, [datasetId+markerCode]',
      'multi-omics-associations':
        'id, trait, primaryDatasetId, secondaryDatasetId, associationType, significance',
      'breeding-analyses': 'id, analysisCode, targetTrait, modelType, status, executedAt',
      'phenotype-trait-definitions': 'id, code, category, status',
      'phenotype-records': 'id, cowId, cowNumber, traitCode, collectionDate, [cowId+traitCode]',
      'phenotype-export-methods': 'id, code, groupBy, status',
      'base-info-categories': 'id, scope, name'
    })
    this.version(6).stores({
      ...baseStores,
      'omics-samples':
        'id, sampleCode, cowId, cowNumber, sampleType, status, collectionDate, [cowId+collectionDate]',
      'omics-datasets': 'id, datasetCode, name, dataType, platform, status, generatedAt',
      'omics-markers':
        'id, datasetId, markerCode, markerType, trait, geneSymbol, [datasetId+markerCode]',
      'multi-omics-associations':
        'id, trait, primaryDatasetId, secondaryDatasetId, associationType, significance',
      'breeding-analyses': 'id, analysisCode, targetTrait, modelType, status, executedAt',
      'phenotype-trait-definitions': 'id, &code, category, status',
      'phenotype-records': 'id, cowId, cowNumber, traitCode, collectionDate, [cowId+traitCode]',
      'phenotype-export-methods': 'id, &code, groupBy, status',
      'base-info-categories': 'id, scope, name'
    })
    this.version(7).stores({
      ...baseStores,
      'omics-samples':
        'id, sampleCode, cowId, cowNumber, sampleType, status, collectionDate, [cowId+collectionDate]',
      'omics-datasets': 'id, datasetCode, name, dataType, platform, status, generatedAt',
      'omics-markers':
        'id, datasetId, markerCode, markerType, trait, geneSymbol, [datasetId+markerCode]',
      'multi-omics-associations':
        'id, trait, primaryDatasetId, secondaryDatasetId, associationType, significance',
      'breeding-analyses': 'id, analysisCode, targetTrait, modelType, status, executedAt',
      'phenotype-trait-definitions': 'id, &code, category, status',
      'phenotype-records': 'id, cowId, cowNumber, traitCode, collectionDate, [cowId+traitCode]',
      'phenotype-export-methods': 'id, &code, groupBy, status',
      'base-info-categories': 'id, scope, name',
      ...v2Stores
    })
    this.version(8).stores({
      ...baseStores,
      'omics-samples':
        'id, sampleCode, cowId, cowNumber, sampleType, status, collectionDate, [cowId+collectionDate]',
      'omics-datasets': 'id, datasetCode, name, dataType, platform, status, generatedAt',
      'omics-markers':
        'id, datasetId, markerCode, markerType, trait, geneSymbol, [datasetId+markerCode]',
      'multi-omics-associations':
        'id, trait, primaryDatasetId, secondaryDatasetId, associationType, significance',
      'breeding-analyses': 'id, analysisCode, targetTrait, modelType, status, executedAt',
      'phenotype-trait-definitions': 'id, &code, category, status',
      'phenotype-records': 'id, cowId, cowNumber, traitCode, collectionDate, [cowId+traitCode]',
      'phenotype-export-methods': 'id, &code, groupBy, status',
      'logical-trait-rules': 'id, &code, category, status, sourceTable',
      'base-info-categories': 'id, scope, name',
      ...v2Stores
    })
  }
}

// 创建数据库实例
export const db = new CattleDatabase()
