import { AppRouteRecord } from '@/types/router'

const platformRoles = ['R_SUPER', 'R_ADMIN']

export const informationEntryRoutes: AppRouteRecord = {
  name: 'InformationEntry',
  path: '/information-entry',
  component: '/index/index',
  meta: {
    title: 'menus.informationEntry.title',
    icon: 'ri:clipboard-line',
    roles: platformRoles
  },
  children: [
    {
      path: 'production',
      name: 'InformationEntryProduction',
      component: '/data-import/information/index',
      meta: {
        title: 'menus.informationEntry.productionEvent',
        keepAlive: false,
        activePath: '/information-entry/production',
        eventGroup: '生产'
      }
    },
    {
      path: 'reproduction',
      name: 'InformationEntryReproduction',
      component: '/data-import/information/index',
      meta: {
        title: 'menus.informationEntry.reproductionEvent',
        keepAlive: false,
        activePath: '/information-entry/reproduction',
        eventGroup: '繁殖'
      }
    },
    {
      path: 'health',
      name: 'InformationEntryHealth',
      component: '/data-import/information/index',
      meta: {
        title: 'menus.informationEntry.healthEvent',
        keepAlive: false,
        activePath: '/information-entry/health',
        eventGroup: '健康'
      }
    },
    {
      path: 'movement',
      name: 'InformationEntryMovement',
      component: '/data-import/information/index',
      meta: {
        title: 'menus.informationEntry.movementEvent',
        keepAlive: false,
        activePath: '/information-entry/movement',
        eventGroup: '转群'
      }
    },
    {
      path: 'sampling',
      name: 'InformationEntrySampling',
      component: '/data-import/information/index',
      meta: {
        title: 'menus.informationEntry.samplingEvent',
        keepAlive: false,
        activePath: '/information-entry/sampling',
        eventGroup: '采样'
      }
    },
    {
      path: 'device',
      name: 'InformationEntryDevice',
      component: '/data-import/information/index',
      meta: {
        title: 'menus.informationEntry.deviceEvent',
        keepAlive: false,
        isHide: true,
        activePath: '/information-entry/device',
        eventGroup: '设备'
      }
    },
    {
      path: 'research',
      name: 'InformationEntryResearch',
      component: '/data-import/information/index',
      meta: {
        title: 'menus.informationEntry.researchEvent',
        keepAlive: false,
        isHide: true,
        activePath: '/information-entry/research',
        eventGroup: '育种科研'
      }
    },
    {
      path: 'entry',
      alias: '/event-entry/entry',
      name: 'InformationEntryEntry',
      component: '/data-import/information/index',
      meta: {
        title: 'menus.informationEntry.entryEvent',
        keepAlive: false,
        isHide: true,
        activePath: '/information-entry/movement',
        eventGroup: '转群',
        eventType: 'entry'
      }
    },
    {
      path: 'transfer',
      alias: '/event-entry/transfer',
      name: 'InformationEntryTransfer',
      component: '/data-import/information/index',
      meta: {
        title: 'menus.informationEntry.transferEvent',
        keepAlive: false,
        isHide: true,
        activePath: '/information-entry/movement',
        eventGroup: '转群',
        eventType: 'transfer'
      }
    },
    {
      path: 'exit',
      alias: '/event-entry/exit',
      name: 'InformationEntryExit',
      component: '/data-import/information/index',
      meta: {
        title: 'menus.informationEntry.exitEvent',
        keepAlive: false,
        isHide: true,
        activePath: '/information-entry/movement',
        eventGroup: '转群',
        eventType: 'exit'
      }
    },
    {
      path: 'breeding',
      alias: '/event-entry/breeding',
      name: 'InformationEntryBreeding',
      component: '/data-import/information/index',
      meta: {
        title: 'menus.informationEntry.breedingEvent',
        keepAlive: false,
        isHide: true,
        activePath: '/information-entry/reproduction',
        eventGroup: '繁殖',
        eventType: 'insemination'
      }
    },
    {
      path: 'veterinary',
      alias: '/event-entry/veterinary',
      name: 'InformationEntryVeterinary',
      component: '/data-import/information/index',
      meta: {
        title: 'menus.informationEntry.veterinaryEvent',
        keepAlive: false,
        isHide: true,
        activePath: '/information-entry/health',
        eventGroup: '健康',
        eventType: 'treatment'
      }
    }
  ]
}

export const informationEditRoutes: AppRouteRecord = {
  name: 'InformationEdit',
  path: '/information-edit',
  component: '/index/index',
  meta: {
    title: 'menus.informationEdit.title',
    icon: 'ri:edit-2-line',
    roles: platformRoles
  },
  children: [
    {
      path: 'production',
      name: 'InformationEditProduction',
      component: '/data-edit/information/index',
      meta: {
        title: 'menus.informationEdit.productionEvent',
        keepAlive: false,
        activePath: '/information-edit/production',
        eventGroup: '生产'
      }
    },
    {
      path: 'reproduction',
      name: 'InformationEditReproduction',
      component: '/data-edit/information/index',
      meta: {
        title: 'menus.informationEdit.reproductionEvent',
        keepAlive: false,
        activePath: '/information-edit/reproduction',
        eventGroup: '繁殖'
      }
    },
    {
      path: 'health',
      name: 'InformationEditHealth',
      component: '/data-edit/information/index',
      meta: {
        title: 'menus.informationEdit.healthEvent',
        keepAlive: false,
        activePath: '/information-edit/health',
        eventGroup: '健康'
      }
    },
    {
      path: 'movement',
      name: 'InformationEditMovement',
      component: '/data-edit/information/index',
      meta: {
        title: 'menus.informationEdit.movementEvent',
        keepAlive: false,
        activePath: '/information-edit/movement',
        eventGroup: '转群'
      }
    },
    {
      path: 'sampling',
      name: 'InformationEditSampling',
      component: '/data-edit/information/index',
      meta: {
        title: 'menus.informationEdit.samplingEvent',
        keepAlive: false,
        activePath: '/information-edit/sampling',
        eventGroup: '采样'
      }
    },
    {
      path: 'device',
      name: 'InformationEditDevice',
      component: '/data-edit/information/index',
      meta: {
        title: 'menus.informationEdit.deviceEvent',
        keepAlive: false,
        activePath: '/information-edit/device',
        eventGroup: '设备'
      }
    },
    {
      path: 'research',
      name: 'InformationEditResearch',
      component: '/data-edit/information/index',
      meta: {
        title: 'menus.informationEdit.researchEvent',
        keepAlive: false,
        activePath: '/information-edit/research',
        eventGroup: '育种科研'
      }
    },
    {
      path: 'pedigree',
      name: 'InformationEditPedigree',
      component: '/data-edit/information/index',
      meta: {
        title: 'menus.informationEdit.pedigreeEvent',
        keepAlive: false,
        activePath: '/information-edit/pedigree',
        eventGroup: '系谱'
      }
    }
  ]
}

export const germplasmRoutes: AppRouteRecord = {
  name: 'GermplasmResources',
  path: '/germplasm-resources',
  component: '/index/index',
  meta: {
    title: 'menus.germplasmResources.title',
    icon: 'ri:archive-drawer-line',
    roles: platformRoles
  },
  children: [
    {
      path: 'individual-profile',
      name: 'IndividualProfile',
      component: '/germplasm/archive/index',
      meta: {
        title: 'menus.germplasmResources.individualProfile',
        keepAlive: false
      }
    },
    {
      path: 'individual-query',
      alias: '/cow-info/query',
      name: 'IndividualQuery',
      component: '/cow-info/query/index',
      meta: {
        title: 'menus.germplasmResources.individualQuery',
        keepAlive: false
      }
    },
    {
      path: 'individual-filter',
      alias: ['/cow-info/filter', '/production/smart-alert'],
      name: 'IndividualFilter',
      component: '/cow-info/filter/index',
      meta: {
        title: 'menus.germplasmResources.individualFilter',
        keepAlive: false
      }
    },
    {
      path: 'pedigree-management',
      name: 'PedigreeManagement',
      component: '/germplasm/pedigree/index',
      meta: {
        title: 'menus.germplasmResources.pedigreeManagement',
        keepAlive: false
      }
    },
    {
      path: 'phenotype-records',
      alias: '/cow-status/healthy',
      name: 'PhenotypeRecords',
      component: '/germplasm/phenotype/index',
      meta: {
        title: 'menus.germplasmResources.phenotypeRecords',
        keepAlive: false
      }
    },
    {
      path: 'lactation-performance',
      name: 'LactationPerformance',
      component: '/germplasm/phenotype/index',
      meta: {
        title: 'menus.germplasmResources.lactationPerformance',
        keepAlive: false,
        isHide: true,
        activePath: '/germplasm-resources/phenotype-records'
      }
    },
    {
      path: 'lactation-missing-review',
      name: 'LactationMissingReview',
      component: '/germplasm/lactation-review/index',
      meta: {
        title: 'menus.germplasmResources.lactationMissingReview',
        keepAlive: false
      }
    },
    {
      path: 'breeding-records',
      alias: '/production/reproduction-tracking',
      name: 'BreedingRecords',
      component: '/reproduction-tracking/index',
      meta: {
        title: 'menus.germplasmResources.breedingRecords',
        keepAlive: false
      }
    },
    {
      path: 'legacy-feed-management',
      alias: '/production/feed-management',
      name: 'FeedManagementLegacy',
      component: '/feed-management/index',
      meta: {
        title: 'menus.legacy.feedManagement',
        keepAlive: false,
        isHide: true,
        activePath: '/germplasm-resources/phenotype-records'
      }
    },
    {
      path: 'legacy-milk-management',
      alias: ['/production/milk-management', '/milk-management'],
      name: 'MilkManagementLegacy',
      component: '/milk-management/index',
      meta: {
        title: 'menus.germplasmResources.lactationPerformance',
        keepAlive: false,
        isHide: true,
        activePath: '/germplasm-resources/phenotype-records'
      }
    }
  ]
}

export const omicsAnalysisRoutes: AppRouteRecord = {
  name: 'OmicsAnalysis',
  path: '/omics-analysis',
  component: '/index/index',
  meta: {
    title: 'menus.omicsAnalysis.title',
    icon: 'ri:flask-line',
    roles: platformRoles
  },
  children: [
    {
      path: 'data-repositories',
      alias: [
        'sample-management',
        'dataset-management',
        'genomic-data',
        'transcriptomics-data',
        '/operation/transcriptomics-data'
      ],
      name: 'OmicsDataRepositories',
      component: '/statistics/data-analysis/index',
      meta: {
        title: 'menus.omicsAnalysis.dataRepositories',
        keepAlive: false
      }
    },
    {
      path: 'modules',
      alias: 'snp-genotyping',
      name: 'OmicsModules',
      component: '/statistics/data-analysis/index',
      meta: {
        title: 'menus.omicsAnalysis.modules',
        keepAlive: false
      }
    },
    {
      path: 'module-results',
      alias: 'multi-omics-association',
      name: 'OmicsModuleResults',
      component: '/statistics/data-analysis/index',
      meta: {
        title: 'menus.omicsAnalysis.moduleResults',
        keepAlive: false
      }
    },
    {
      path: 'workflow',
      name: 'OmicsWorkflow',
      component: '/statistics/data-analysis/index',
      meta: {
        title: 'menus.omicsAnalysis.workflow',
        keepAlive: false
      }
    },
    {
      path: 'workflow-results',
      alias: 'breeding-analysis',
      name: 'OmicsWorkflowResults',
      component: '/statistics/data-analysis/index',
      meta: {
        title: 'menus.omicsAnalysis.workflowResults',
        keepAlive: false
      }
    },
    {
      path: 'user-guide',
      name: 'OmicsUserGuide',
      component: '/statistics/data-analysis/index',
      meta: {
        title: 'menus.omicsAnalysis.userGuide',
        keepAlive: false
      }
    }
  ]
}

export const intelligentBreedingRoutes: AppRouteRecord = {
  name: 'IntelligentBreeding',
  path: '/intelligent-breeding',
  component: '/index/index',
  meta: {
    title: 'menus.intelligentBreeding.title',
    icon: 'ri:seedling-line',
    roles: platformRoles
  },
  children: [
    {
      path: 'candidate-bull-selection',
      name: 'CandidateBullSelection',
      component: '/intelligent-breeding/bull-candidates/index',
      meta: {
        title: 'menus.intelligentBreeding.candidateBullSelection',
        keepAlive: false
      }
    },
    {
      path: 'candidate-cow-selection',
      name: 'CandidateCowSelection',
      component: '/intelligent-breeding/female-candidates/index',
      meta: {
        title: 'menus.intelligentBreeding.candidateCowSelection',
        keepAlive: false
      }
    },
    {
      path: 'mating-plan',
      name: 'MatingPlan',
      component: '/intelligent-breeding/mating-plan/index',
      meta: {
        title: 'menus.intelligentBreeding.matingPlan',
        keepAlive: false
      }
    },
    {
      path: 'breeding-index-evaluation',
      alias: '/operation/kpi-dashboard',
      name: 'BreedingIndexEvaluation',
      component: '/kpi-dashboard/index',
      meta: {
        title: 'menus.intelligentBreeding.breedingIndexEvaluation',
        keepAlive: false
      }
    },
    {
      path: 'germplasm-evaluation',
      alias: '/germplasm-resources/germplasm-evaluation',
      name: 'GermplasmEvaluation',
      component: '/germplasm/evaluation/index',
      meta: {
        title: 'menus.intelligentBreeding.germplasmEvaluation',
        keepAlive: false
      }
    },
    {
      path: 'legacy-economic-analysis',
      alias: '/operation/economic-analysis',
      name: 'EconomicAnalysisLegacy',
      component: '/economic-analysis/index',
      meta: {
        title: 'menus.legacy.economicAnalysis',
        keepAlive: false,
        isHide: true,
        activePath: '/intelligent-breeding/breeding-index-evaluation'
      }
    },
    {
      path: 'legacy-predictive-analysis',
      alias: '/operation/predictive-analytics',
      name: 'PredictiveAnalysisLegacy',
      component: '/predictive-analytics/index',
      meta: {
        title: 'menus.legacy.predictiveAnalysis',
        keepAlive: false,
        isHide: true,
        activePath: '/intelligent-breeding/mating-plan'
      }
    },
    {
      path: 'legacy-abnormal-status',
      alias: '/cow-status/abnormal',
      name: 'AbnormalStatusLegacy',
      component: '/statistics/abnormal/index',
      meta: {
        title: 'menus.legacy.abnormalStatus',
        keepAlive: false,
        isHide: true,
        activePath: '/germplasm-resources/individual-filter'
      }
    },
    {
      path: 'legacy-heat-status',
      alias: '/cow-status/heat',
      name: 'HeatStatusLegacy',
      component: '/statistics/heat/index',
      meta: {
        title: 'menus.legacy.heatStatus',
        keepAlive: false,
        isHide: true,
        activePath: '/intelligent-breeding/mating-plan'
      }
    },
    {
      path: 'legacy-pregnant-status',
      alias: '/cow-status/pregnant',
      name: 'PregnantStatusLegacy',
      component: '/statistics/pregnant/index',
      meta: {
        title: 'menus.legacy.pregnantStatus',
        keepAlive: false,
        isHide: true,
        activePath: '/intelligent-breeding/candidate-cow-selection'
      }
    },
    {
      path: 'legacy-mixed-status',
      alias: '/cow-status/mixed',
      name: 'MixedStatusLegacy',
      component: '/statistics/mixed/index',
      meta: {
        title: 'menus.legacy.mixedStatus',
        keepAlive: false,
        isHide: true,
        activePath: '/intelligent-breeding/germplasm-evaluation'
      }
    },
    {
      path: 'legacy-left-status',
      alias: '/cow-status/left',
      name: 'LeftStatusLegacy',
      component: '/statistics/left/index',
      meta: {
        title: 'menus.legacy.leftStatus',
        keepAlive: false,
        isHide: true,
        activePath: '/intelligent-breeding/germplasm-evaluation'
      }
    }
  ]
}

export const dataDeviceRoutes: AppRouteRecord = {
  name: 'DataDevice',
  path: '/data-and-devices',
  component: '/index/index',
  meta: {
    title: 'menus.dataDevice.title',
    icon: 'ri:database-line',
    roles: platformRoles
  },
  children: [
    {
      path: 'sensor-quality',
      alias: '/data-device/sensor-quality',
      name: 'SensorQuality',
      component: '/statistics/sensor-quality/index',
      meta: {
        title: 'menus.dataDevice.sensorQuality',
        keepAlive: false
      }
    },
    {
      path: 'hardware-integration',
      alias: '/data-device/hardware-integration',
      name: 'HardwareIntegration',
      component: '/hardware-integration/index',
      meta: {
        title: 'menus.dataDevice.hardwareIntegration',
        keepAlive: false
      }
    },
    {
      path: 'ear-tag-uplinks',
      alias: '/data-device/ear-tag-uplinks',
      name: 'EarTagUplinks',
      component: '/data-device/ear-tag-uplinks/index',
      meta: {
        title: 'menus.dataDevice.earTagUplinks',
        keepAlive: false
      }
    },
    {
      path: 'data-analysis',
      alias: '/data-device/data-analysis',
      name: 'DataAnalysis',
      component: '/database/index',
      meta: {
        title: 'menus.dataDevice.dataAnalysis',
        keepAlive: false
      }
    },
    {
      path: 'information-import',
      alias: ['/data-import/information', '/data-device/information-import'],
      name: 'InformationImport',
      component: '/data-import/information/index',
      meta: {
        title: 'menus.dataDevice.informationImport',
        keepAlive: false,
        icon: 'ri:file-upload-line'
      }
    },
    {
      path: 'information-export',
      alias: '/data-export/information',
      name: 'InformationExport',
      component: '/data-export/information/index',
      meta: {
        title: 'menus.dataDevice.informationExport',
        keepAlive: false,
        icon: 'ri:file-download-line'
      }
    },
    {
      path: 'cow-info-export',
      alias: '/data-export/cow-info',
      name: 'CowInfoExport',
      redirect: '/data-and-devices/information-export?strategy=animal-profile',
      meta: {
        title: 'menus.dataDevice.cowInfoExport',
        keepAlive: false,
        isHide: true
      }
    },
    {
      path: 'cow-events-export',
      alias: '/data-export/cow-events',
      name: 'CowEventsExport',
      redirect: '/data-and-devices/information-export?strategy=animal-events',
      meta: {
        title: 'menus.dataDevice.cowEventsExport',
        keepAlive: false,
        isHide: true
      }
    },
    {
      path: 'phenotype-export',
      alias: '/data-export/phenotype',
      name: 'PhenotypeDataExport',
      redirect: '/data-and-devices/information-export?strategy=phenotype-lactation',
      meta: {
        title: 'menus.dataDevice.phenotypeExport',
        keepAlive: false,
        isHide: true
      }
    },
    {
      path: 'database',
      alias: '/database',
      name: 'Database',
      component: '/database/index',
      meta: {
        title: 'menus.dataDevice.database',
        keepAlive: false
      }
    },
    {
      path: 'flexible-analysis',
      alias: '/statistics/flexible-analysis',
      name: 'FlexibleAnalysis',
      component: '/statistics/flexible-analysis/index',
      meta: {
        title: 'menus.dataDevice.flexibleAnalysis',
        keepAlive: false,
        icon: 'ri:bar-chart-grouped-line',
        isHide: true
      }
    },
    {
      path: 'legacy-automation-engine',
      alias: '/operation/automation-engine',
      name: 'AutomationEngineLegacy',
      component: '/automation-engine/index',
      meta: {
        title: 'menus.legacy.automationEngine',
        keepAlive: false,
        isHide: true,
        activePath: '/data-and-devices/database'
      }
    }
  ]
}

export const platformManagementRoutes: AppRouteRecord = {
  name: 'PlatformManagement',
  path: '/platform-management',
  component: '/index/index',
  meta: {
    title: 'menus.platformManagement.title',
    icon: 'ri:settings-3-line',
    roles: platformRoles
  },
  children: [
    {
      path: 'person-management',
      alias: '/base-info/person',
      name: 'PersonManagement',
      component: '/base-info/person/index',
      meta: {
        title: 'menus.platformManagement.personManagement',
        keepAlive: false
      }
    },
    {
      path: 'pen-management',
      alias: '/base-info/pen',
      name: 'PenManagement',
      component: '/base-info/pen/index',
      meta: {
        title: 'menus.platformManagement.penManagement',
        keepAlive: false
      }
    },
    {
      path: 'breed-management',
      alias: '/base-info/breed',
      name: 'BreedManagement',
      component: '/base-info/breed/index',
      meta: {
        title: '品种管理',
        keepAlive: false
      }
    },
    {
      path: 'disease-management',
      alias: '/base-info/disease',
      name: 'DiseaseManagement',
      component: '/base-info/disease/index',
      meta: {
        title: 'menus.platformManagement.diseaseManagement',
        keepAlive: false
      }
    },
    {
      path: 'medicine-management',
      alias: '/base-info/medicine',
      name: 'MedicineManagement',
      component: '/base-info/medicine/index',
      meta: {
        title: 'menus.platformManagement.medicineManagement',
        keepAlive: false
      }
    },
    {
      path: 'transfer-reason-management',
      alias: '/base-info/transfer-reason',
      name: 'TransferReasonManagement',
      component: '/base-info/transfer-reason/index',
      meta: {
        title: 'menus.platformManagement.transferReasonManagement',
        keepAlive: false
      }
    },
    {
      path: 'milk-shift-management',
      alias: '/base-info/milk-shift',
      name: 'MilkShiftManagement',
      component: '/base-info/milk-shift/index',
      meta: {
        title: 'menus.platformManagement.milkShiftManagement',
        keepAlive: false
      }
    },
    {
      path: 'trait-dictionary',
      name: 'TraitDictionary',
      component: '/index/route-view',
      meta: {
        title: 'menus.platformManagement.traitDictionary',
        icon: 'ri:book-2-line',
        keepAlive: false
      },
      children: [
        {
          path: 'numeric-traits',
          alias: ['/base-info/phenotype-trait', '/platform-management/phenotype-trait-management'],
          name: 'PhenotypeTraitManagement',
          component: '/base-info/phenotype-trait/index',
          meta: {
            title: 'menus.platformManagement.numericTraitManagement',
            keepAlive: false,
            activePath: '/platform-management/trait-dictionary/numeric-traits'
          }
        },
        {
          path: 'logical-traits',
          alias: ['/base-info/logical-trait', '/platform-management/logical-trait-management'],
          name: 'LogicalTraitManagement',
          component: '/base-info/logical-trait/index',
          meta: {
            title: 'menus.platformManagement.logicalTraitManagement',
            keepAlive: false,
            activePath: '/platform-management/trait-dictionary/logical-traits'
          }
        },
        {
          path: 'export-methods',
          alias: [
            '/base-info/phenotype-export-method',
            '/platform-management/phenotype-export-method-management'
          ],
          name: 'PhenotypeExportMethodManagement',
          component: '/base-info/phenotype-export-method/index',
          meta: {
            title: 'menus.platformManagement.traitExportMethodManagement',
            keepAlive: false,
            activePath: '/platform-management/trait-dictionary/export-methods'
          }
        }
      ]
    },
    {
      path: 'service-status',
      alias: '/operation/server-status',
      name: 'ServiceStatus',
      component: '/server-status/index',
      meta: {
        title: 'menus.platformManagement.serviceStatus',
        keepAlive: false
      }
    },
    {
      path: 'custom-fields',
      name: 'CustomFieldsManagement',
      component: '/platform-management/custom-fields/index',
      meta: {
        title: 'menus.platformManagement.customFields',
        keepAlive: false
      }
    },
    {
      path: 'export-configs',
      name: 'ExportConfigsManagement',
      component: '/platform-management/export-configs/index',
      meta: {
        title: 'menus.platformManagement.exportConfigs',
        keepAlive: false
      }
    },
    {
      path: 'import-configs',
      name: 'ImportConfigsManagement',
      component: '/platform-management/import-configs/index',
      meta: {
        title: 'menus.platformManagement.importConfigs',
        keepAlive: false
      }
    }
  ]
}
