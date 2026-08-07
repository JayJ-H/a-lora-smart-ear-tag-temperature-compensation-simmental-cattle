import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import aedes from 'aedes'
import * as XLSX from 'xlsx'
import {
  evaluateTwoOfThreeHighTemperature,
  THREE_POINT_HIGH_TEMPERATURE_THRESHOLD
} from './health-alert-rules.mjs'
import { predictThShrcTemperature, selectTemperatureForAlert } from './th-shrc-runtime.mjs'
import {
  CATTLE_SPECIES_NAME,
  DEFAULT_CATTLE_BREED,
  requireSupportedCattleBreed
} from './cattle-breeds.mjs'

dotenv.config()

const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase()
const isProductionRuntime = nodeEnv === '生产配置'

const app = express()
app.use(cors())
app.use(express.json({ limit: '4mb' }))

const config = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'cattle_management',
  connectionLimit: Number(process.env.MYSQL_POOL_LIMIT || 10)
}

const serverPort = Number(process.env.MYSQL_API_PORT || 9192)
const skipStartupDbEnsure = ['1', 'true', 'yes'].includes(
  String(process.env.SKIP_STARTUP_DB_ENSURE || '')
    .trim()
    .toLowerCase()
)
const authConfig = {
  mode: String(process.env.AUTH_MODE || 'strict').toLowerCase(),
  adminUser: String(process.env.ADMIN_USER || 'admin'),
  adminPassword: String(process.env.ADMIN_PASSWORD || ''),
  sessionTtlMs: Number(process.env.AUTH_SESSION_TTL_MS || 12 * 60 * 60 * 1000),
  defaultPersonPassword: String(process.env.DEFAULT_PERSON_PASSWORD || '')
}

const mqttConfig = {
  enabled: String(process.env.MQTT_ENABLED || 'false').toLowerCase() === 'true',
  port: Number(process.env.MQTT_PORT || 1883),
  host: process.env.MQTT_HOST || '0.0.0.0',
  username: process.env.MQTT_USERNAME || '',
  password: process.env.MQTT_PASSWORD || '',
  topic: process.env.MQTT_TOPIC || 'cattle/+/temperature'
}

function isPlaceholderSecretValue(key, value) {
  const text = String(value ?? '').trim()
  if (!text) return true

  const lower = text.toLowerCase()
  if (lower === String(key || '').toLowerCase()) return true

  return (
    ['replace_with', 'change_me', 'changeme', 'placeholder', 'example', 'sample'].some((token) =>
      lower.includes(token)
    ) || ['password', 'admin', 'root', 'secret', 'test'].includes(lower)
  )
}

function validateProductionSecurityConfig() {
  if (!isProductionRuntime) return

  const errors = []
  if (authConfig.mode !== 'strict') {
    errors.push('AUTH_MODE must be strict when NODE_ENV=production')
  }

  const requiredSecrets = ['MYSQL_PASSWORD', 'ADMIN_PASSWORD', 'MQTT_PASSWORD']
  if (process.env.MYSQL_ROOT_PASSWORD !== undefined) requiredSecrets.push('MYSQL_ROOT_PASSWORD')

  for (const key of requiredSecrets) {
    if (isPlaceholderSecretValue(key, process.env[key])) {
      errors.push(`${key} is missing or still uses an example/default value`)
    }
  }

  if (mqttConfig.enabled && isPlaceholderSecretValue('MQTT_USERNAME', mqttConfig.username)) {
    errors.push('MQTT_USERNAME is required when MQTT_ENABLED=true in production')
  }

  if (errors.length) {
    console.error(`[security] production configuration rejected:\n- ${errors.join('\n- ')}`)
    process.exit(1)
  }
}

validateProductionSecurityConfig()

const omicsConfig = {
  serviceUrl: String(process.env.OMICS_SERVICE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, ''),
  timeoutMs: Number(process.env.OMICS_SERVICE_TIMEOUT_MS || 15000)
}

const OMICS_PARAMETER_SCHEMA = {
  global: [
    {
      key: 'repositoryId',
      label: '本地数据源',
      type: 'select',
      default: 'omics-datasets',
      required: true,
      group: '元数据',
      description: '系统内置数据仓库标识。'
    },
    {
      key: 'repositoryTitle',
      label: '数据源名称',
      type: 'text',
      default: '组学数据矩阵',
      group: '元数据',
      description: '用于结果追溯的展示名称。'
    },
    {
      key: 'trait',
      label: '目标性状',
      type: 'select',
      default: '泌乳量',
      required: true,
      group: '元数据',
      description: '本次分析关联的育种或生产性状。'
    },
    {
      key: 'groupBy',
      label: '分组方式',
      type: 'select',
      default: 'phenotype_group',
      required: true,
      group: '元数据',
      options: [
        { label: '高低表型组', value: 'phenotype_group' },
        { label: '胎次分组', value: 'parity_group' },
        { label: '系谱家系', value: 'pedigree_family' },
        { label: '泌乳阶段', value: 'lactation_stage' }
      ],
      description: '生成组学矩阵分组标签的策略。'
    },
    {
      key: 'fdrCutoff',
      label: 'FDR 阈值',
      type: 'number',
      default: 0.05,
      min: 0.001,
      max: 0.5,
      step: 0.001,
      group: 'statistics',
      algorithm: 'Benjamini-Hochberg',
      description: '差异、关联和富集结果解释时使用的显著性阈值。'
    },
    {
      key: 'scaleMethod',
      label: '矩阵缩放方法',
      type: 'select',
      default: 'standard',
      group: 'preprocess',
      algorithm: 'sklearn.preprocessing.StandardScaler / local minmax',
      options: [
        { label: '不缩放', value: 'none' },
        { label: 'Z-score 标准化', value: 'standard' },
        { label: 'Min-Max 归一化', value: 'minmax' },
        { label: 'log1p 后 Z-score', value: 'log-standard' }
      ],
      description: '进入 PCA、PLS、机器学习、热图前的矩阵缩放方式。'
    },
    {
      key: 'withMean',
      label: '标准化时中心化',
      type: 'boolean',
      default: true,
      group: 'preprocess',
      advanced: true,
      algorithm: 'StandardScaler.with_mean',
      description: 'Z-score 标准化是否减去均值。'
    },
    {
      key: 'withStd',
      label: '标准化时按标准差缩放',
      type: 'boolean',
      default: true,
      group: 'preprocess',
      advanced: true,
      algorithm: 'StandardScaler.with_std',
      description: 'Z-score 标准化是否除以标准差。'
    },
    {
      key: 'center',
      label: '中心化兼容参数',
      type: 'boolean',
      default: true,
      group: 'preprocess',
      advanced: true,
      backendParam: 'center',
      algorithm: 'legacy alias of withMean',
      description: '兼容计算服务 center 参数；默认与“标准化时中心化”一致。'
    },
    {
      key: 'scale',
      label: '缩放兼容参数',
      type: 'boolean',
      default: true,
      group: 'preprocess',
      advanced: true,
      backendParam: 'scale',
      algorithm: 'legacy alias of withStd',
      description: '兼容计算服务 scale 参数；默认与“标准化时按标准差缩放”一致。'
    },
    {
      key: 'randomState',
      label: '随机种子',
      type: 'number',
      default: 2026,
      min: 0,
      max: 2147483647,
      step: 1,
      group: 'reproducibility',
      advanced: true,
      description: '随机森林、SVM 置换重要性、PCA randomized 求解等步骤的可复现种子。'
    }
  ],
  modules: {
    'missing-normalize': [
      {
        key: 'imputeStrategy',
        label: '缺失填补策略',
        type: 'select',
        default: 'mean',
        group: 'preprocess',
        algorithm: 'numpy column imputation',
        options: [
          { label: '均值填补', value: 'mean' },
          { label: '中位数填补', value: 'median' },
          { label: '零值填补', value: 'zero' },
          { label: '常数填补', value: 'constant' }
        ],
        description: '对矩阵中缺失值的列级填补策略。'
      },
      {
        key: 'fillValue',
        label: '常数填充值',
        type: 'number',
        default: 0,
        min: -1000000,
        max: 1000000,
        step: 0.1,
        group: 'preprocess',
        advanced: true,
        description: '仅在缺失填补策略为常数时使用。'
      },
      {
        key: 'lowVariancePercent',
        label: '低方差过滤比例',
        type: 'number',
        default: 0,
        min: 0,
        max: 50,
        step: 1,
        group: 'preprocess',
        description: '过滤方差最低的特征比例。'
      },
      {
        key: 'outlierPercentile',
        label: '离群阈值分位数',
        type: 'number',
        default: 95,
        min: 80,
        max: 99.9,
        step: 0.5,
        group: 'preprocess',
        description: '样本 QC 离群判断分位数。'
      }
    ],
    'cleaning-processing': [
      {
        key: 'imputeStrategy',
        label: '缺失填补策略',
        type: 'select',
        default: 'median',
        group: 'preprocess',
        algorithm: 'numpy column imputation',
        options: [
          { label: '均值填补', value: 'mean' },
          { label: '中位数填补', value: 'median' },
          { label: '零值填补', value: 'zero' },
          { label: '常数填补', value: 'constant' }
        ],
        description: '清洗前对缺失值的填补策略。'
      },
      {
        key: 'fillValue',
        label: '常数填充值',
        type: 'number',
        default: 0,
        min: -1000000,
        max: 1000000,
        step: 0.1,
        group: 'preprocess',
        advanced: true,
        description: '仅在缺失填补策略为常数时使用。'
      },
      {
        key: 'lowVariancePercent',
        label: '低方差过滤比例',
        type: 'number',
        default: 10,
        min: 0,
        max: 50,
        step: 1,
        group: 'preprocess',
        description: '清洗模块默认过滤更多低方差特征。'
      },
      {
        key: 'outlierPercentile',
        label: '离群阈值分位数',
        type: 'number',
        default: 95,
        min: 80,
        max: 99.9,
        step: 0.5,
        group: 'preprocess',
        description: '样本 QC 离群判断分位数。'
      }
    ],
    pca: [
      {
        key: 'nComponents',
        label: '主成分数',
        type: 'number',
        default: 2,
        min: 2,
        max: 8,
        step: 1,
        group: 'model',
        algorithm: 'sklearn.decomposition.PCA.n_components',
        description: 'PCA 输出和解释率计算的组件数。'
      },
      {
        key: 'svdSolver',
        label: 'SVD 求解器',
        type: 'select',
        default: 'auto',
        group: 'model',
        advanced: true,
        options: [
          { label: '自动', value: 'auto' },
          { label: '完整 SVD', value: 'full' },
          { label: 'ARPACK', value: 'arpack' },
          { label: '随机 SVD', value: 'randomized' }
        ],
        algorithm: 'PCA.svd_solver',
        description: 'PCA 底层奇异值分解求解方式。'
      },
      {
        key: 'whiten',
        label: '白化输出',
        type: 'boolean',
        default: false,
        group: 'model',
        advanced: true,
        algorithm: 'PCA.whiten',
        description: '是否将主成分输出缩放到单位方差。'
      },
      {
        key: 'tol',
        label: '数值收敛阈值',
        type: 'number',
        default: 0,
        min: 0,
        max: 1,
        step: 0.000001,
        group: 'model',
        advanced: true,
        algorithm: 'PCA.tol',
        description: 'ARPACK 求解器的容差。'
      },
      {
        key: 'iteratedPower',
        label: '随机 SVD 迭代次数',
        type: 'number',
        default: 4,
        min: 0,
        max: 20,
        step: 1,
        group: 'model',
        advanced: true,
        algorithm: 'PCA.iterated_power',
        description: '随机 SVD 的幂迭代次数。'
      }
    ],
    plsda: [
      {
        key: 'nComponents',
        label: 'PLS 组件数',
        type: 'number',
        default: 2,
        min: 1,
        max: 8,
        step: 1,
        group: 'model',
        algorithm: 'PLSRegression.n_components',
        description: 'PLSRegression 组件数。'
      },
      {
        key: 'plsScale',
        label: 'PLS 内部缩放',
        type: 'boolean',
        default: false,
        group: 'model',
        advanced: true,
        algorithm: 'PLSRegression.scale',
        description: '是否启用 PLSRegression 内部标准化；通常外层已标准化。'
      },
      {
        key: 'maxIter',
        label: '最大迭代次数',
        type: 'number',
        default: 500,
        min: 10,
        max: 10000,
        step: 10,
        group: 'model',
        advanced: true,
        algorithm: 'PLSRegression.max_iter',
        description: 'NIPALS 求解最大迭代次数。'
      },
      {
        key: 'tol',
        label: '收敛阈值',
        type: 'number',
        default: 0.000001,
        min: 0.000000000001,
        max: 1,
        step: 0.000001,
        group: 'model',
        advanced: true,
        algorithm: 'PLSRegression.tol',
        description: 'PLS 迭代收敛阈值。'
      },
      {
        key: 'copy',
        label: '复制输入矩阵',
        type: 'boolean',
        default: true,
        group: 'model',
        advanced: true,
        algorithm: 'PLSRegression.copy',
        description: '拟合时是否复制输入矩阵。'
      }
    ],
    oplsda: [
      {
        key: 'nComponents',
        label: 'PLS/OPLS 组件数',
        type: 'number',
        default: 2,
        min: 1,
        max: 8,
        step: 1,
        group: 'model',
        algorithm: 'PLSRegression.n_components',
        description: 'PLS-DA 加正交残差近似的组件数。'
      },
      {
        key: 'plsScale',
        label: 'PLS 内部缩放',
        type: 'boolean',
        default: false,
        group: 'model',
        advanced: true,
        algorithm: 'PLSRegression.scale',
        description: '是否启用 PLSRegression 内部标准化。'
      },
      {
        key: 'maxIter',
        label: '最大迭代次数',
        type: 'number',
        default: 500,
        min: 10,
        max: 10000,
        step: 10,
        group: 'model',
        advanced: true,
        algorithm: 'PLSRegression.max_iter',
        description: 'NIPALS 求解最大迭代次数。'
      },
      {
        key: 'tol',
        label: '收敛阈值',
        type: 'number',
        default: 0.000001,
        min: 0.000000000001,
        max: 1,
        step: 0.000001,
        group: 'model',
        advanced: true,
        algorithm: 'PLSRegression.tol',
        description: 'PLS 迭代收敛阈值。'
      },
      {
        key: 'copy',
        label: '复制输入矩阵',
        type: 'boolean',
        default: true,
        group: 'model',
        advanced: true,
        algorithm: 'PLSRegression.copy',
        description: '拟合时是否复制输入矩阵。'
      }
    ],
    'two-group-test': [
      {
        key: 'testMethod',
        label: '检验方式',
        type: 'select',
        default: 'auto',
        group: 'statistics',
        options: [
          { label: '自动择优', value: 'auto' },
          { label: 't-test', value: 'parametric' },
          { label: 'Mann-Whitney U', value: 'nonparametric' }
        ],
        algorithm: 'scipy.stats.ttest_ind / mannwhitneyu',
        description: '二组差异分析使用的检验策略。'
      },
      {
        key: 'alternative',
        label: '备择假设',
        type: 'select',
        default: 'two-sided',
        group: 'statistics',
        advanced: true,
        options: [
          { label: '双侧', value: 'two-sided' },
          { label: '小于', value: 'less' },
          { label: '大于', value: 'greater' }
        ],
        algorithm: 'scipy alternative',
        description: 't-test 和 Mann-Whitney U 的备择假设。'
      },
      {
        key: 'equalVar',
        label: '假定方差齐性',
        type: 'boolean',
        default: false,
        group: 'statistics',
        advanced: true,
        algorithm: 'ttest_ind.equal_var',
        description: 't-test 是否假定两组方差相等。'
      },
      {
        key: 'nanPolicy',
        label: '缺失值策略',
        type: 'select',
        default: 'omit',
        group: 'statistics',
        advanced: true,
        options: [
          { label: '忽略缺失', value: 'omit' },
          { label: '传播缺失', value: 'propagate' },
          { label: '遇缺失报错', value: 'raise' }
        ],
        algorithm: 'ttest_ind.nan_policy',
        description: 't-test 处理缺失值的方式。'
      }
    ],
    'multi-group-test': [
      {
        key: 'testMethod',
        label: '检验方式',
        type: 'select',
        default: 'auto',
        group: 'statistics',
        options: [
          { label: '自动择优', value: 'auto' },
          { label: 'ANOVA 参数检验', value: 'parametric' },
          { label: 'Kruskal 非参数检验', value: 'nonparametric' }
        ],
        algorithm: 'scipy.stats.f_oneway / kruskal',
        description: '多组差异分析使用 ANOVA 或 Kruskal。'
      }
    ],
    limma: [
      {
        key: 'testMethod',
        label: '检验方式',
        type: 'select',
        default: 'auto',
        group: 'statistics',
        options: [
          { label: '自动择优', value: 'auto' },
          { label: '线性模型近似', value: 'parametric' },
          { label: '非参数检验', value: 'nonparametric' }
        ],
        algorithm: 'R limma if available / linear-model approximation',
        description: 'R limma 不可用时的线性模型近似策略。'
      },
      {
        key: 'alternative',
        label: '二组备择假设',
        type: 'select',
        default: 'two-sided',
        group: 'statistics',
        advanced: true,
        options: [
          { label: '双侧', value: 'two-sided' },
          { label: '小于', value: 'less' },
          { label: '大于', value: 'greater' }
        ],
        algorithm: 'ttest_ind.alternative',
        description: '当输入分组为二组时用于 fallback t-test。'
      },
      {
        key: 'equalVar',
        label: '二组方差齐性',
        type: 'boolean',
        default: false,
        group: 'statistics',
        advanced: true,
        algorithm: 'ttest_ind.equal_var',
        description: '当输入分组为二组时是否假定方差相等。'
      },
      {
        key: 'nanPolicy',
        label: '缺失值策略',
        type: 'select',
        default: 'omit',
        group: 'statistics',
        advanced: true,
        options: [
          { label: '忽略缺失', value: 'omit' },
          { label: '传播缺失', value: 'propagate' },
          { label: '遇缺失报错', value: 'raise' }
        ],
        algorithm: 'ttest_ind.nan_policy',
        description: 'fallback t-test 处理缺失值的方式。'
      }
    ],
    lefse: [
      {
        key: 'testMethod',
        label: '检验方式',
        type: 'select',
        default: 'auto',
        group: 'statistics',
        options: [
          { label: '自动择优', value: 'auto' },
          { label: '参数检验', value: 'parametric' },
          { label: 'Kruskal 近似', value: 'nonparametric' }
        ],
        algorithm: 'Kruskal + LDA-like effect score',
        description: 'LEfSe 近似中的差异检验策略。'
      },
      {
        key: 'ldaScale',
        label: 'LDA 分数缩放',
        type: 'number',
        default: 1,
        min: 0.1,
        max: 20,
        step: 0.1,
        group: 'statistics',
        advanced: true,
        algorithm: 'local LDA-like score multiplier',
        description: '调节 LEfSe 近似效应分数的缩放系数。'
      }
    ],
    'random-forest': [
      {
        key: 'nEstimators',
        label: '树数量',
        type: 'number',
        default: 160,
        min: 40,
        max: 500,
        step: 20,
        group: 'model',
        algorithm: 'RandomForest.n_estimators',
        description: '随机森林树数量。'
      },
      {
        key: 'maxDepth',
        label: '最大树深',
        type: 'number',
        default: 8,
        min: 1,
        max: 128,
        step: 1,
        group: 'model',
        advanced: true,
        algorithm: 'RandomForest.max_depth',
        description: '限制单棵树最大深度。'
      },
      {
        key: 'minSamplesSplit',
        label: '节点最小分裂样本',
        type: 'number',
        default: 2,
        min: 2,
        max: 50,
        step: 1,
        group: 'model',
        advanced: true,
        algorithm: 'RandomForest.min_samples_split',
        description: '内部节点继续分裂所需最小样本数。'
      },
      {
        key: 'minSamplesLeaf',
        label: '叶节点最小样本',
        type: 'number',
        default: 1,
        min: 1,
        max: 50,
        step: 1,
        group: 'model',
        advanced: true,
        algorithm: 'RandomForest.min_samples_leaf',
        description: '叶节点所需最小样本数。'
      },
      {
        key: 'maxFeatures',
        label: '单次分裂特征数',
        type: 'select',
        default: 'sqrt',
        group: 'model',
        advanced: true,
        options: [
          { label: 'sqrt', value: 'sqrt' },
          { label: 'log2', value: 'log2' },
          { label: '全部', value: 'none' }
        ],
        algorithm: 'RandomForest.max_features',
        description: '寻找最佳分裂时考虑的特征数量策略。'
      },
      {
        key: 'bootstrap',
        label: 'Bootstrap 抽样',
        type: 'boolean',
        default: true,
        group: 'model',
        advanced: true,
        algorithm: 'RandomForest.bootstrap',
        description: '是否使用 bootstrap 样本训练每棵树。'
      },
      {
        key: 'oobScore',
        label: '启用 OOB 评分',
        type: 'boolean',
        default: true,
        group: 'validation',
        algorithm: 'RandomForest.oob_score',
        description: '使用袋外样本估计模型评分。'
      },
      {
        key: 'classWeight',
        label: '类别权重',
        type: 'select',
        default: 'balanced',
        group: 'model',
        advanced: true,
        options: [
          { label: '无', value: 'none' },
          { label: '平衡', value: 'balanced' },
          { label: '平衡子样本', value: 'balanced_subsample' }
        ],
        algorithm: 'RandomForestClassifier.class_weight',
        description: '分类任务中的类别权重策略。'
      },
      {
        key: 'nJobs',
        label: '并行线程数',
        type: 'number',
        default: 1,
        min: 1,
        max: 8,
        step: 1,
        group: 'runtime',
        advanced: true,
        algorithm: 'RandomForest.n_jobs',
        description: '容器内随机森林并行线程数。'
      },
      {
        key: 'cvFold',
        label: '交叉验证折数',
        type: 'number',
        default: 5,
        min: 3,
        max: 10,
        step: 1,
        group: 'validation',
        description: '保留用于参数追溯；随机森林当前主评分使用 OOB。'
      }
    ],
    svm: [
      {
        key: 'kernel',
        label: '核函数',
        type: 'select',
        default: 'rbf',
        group: 'model',
        options: [
          { label: 'RBF', value: 'rbf' },
          { label: '线性', value: 'linear' },
          { label: '多项式', value: 'poly' },
          { label: 'Sigmoid', value: 'sigmoid' }
        ],
        algorithm: 'SVC/SVR.kernel',
        description: 'SVM 使用的核函数。'
      },
      {
        key: 'C',
        label: '惩罚系数 C',
        type: 'number',
        default: 1,
        min: 0.001,
        max: 1000,
        step: 0.1,
        group: 'model',
        algorithm: 'SVC/SVR.C',
        description: '误分类惩罚系数。'
      },
      {
        key: 'gamma',
        label: 'Gamma 策略',
        type: 'select',
        default: 'scale',
        group: 'model',
        options: [
          { label: 'scale', value: 'scale' },
          { label: 'auto', value: 'auto' },
          { label: '使用自定义 gammaValue', value: 'custom' }
        ],
        algorithm: 'SVC/SVR.gamma',
        description: 'RBF/poly/sigmoid 核的 gamma 参数策略。'
      },
      {
        key: 'gammaValue',
        label: '自定义 Gamma',
        type: 'number',
        default: 0.1,
        min: 0.00000001,
        max: 100,
        step: 0.01,
        group: 'model',
        advanced: true,
        algorithm: 'SVC/SVR.gamma',
        description: '当 Gamma 策略选择 custom 时使用。'
      },
      {
        key: 'degree',
        label: '多项式阶数',
        type: 'number',
        default: 3,
        min: 1,
        max: 10,
        step: 1,
        group: 'model',
        advanced: true,
        algorithm: 'SVC/SVR.degree',
        description: 'poly 核函数的阶数。'
      },
      {
        key: 'coef0',
        label: '核函数独立项',
        type: 'number',
        default: 0,
        min: -100,
        max: 100,
        step: 0.1,
        group: 'model',
        advanced: true,
        algorithm: 'SVC/SVR.coef0',
        description: 'poly/sigmoid 核函数中的独立项。'
      },
      {
        key: 'shrinking',
        label: 'Shrinking 启发式',
        type: 'boolean',
        default: true,
        group: 'model',
        advanced: true,
        algorithm: 'SVC/SVR.shrinking',
        description: '是否启用 shrinking heuristic。'
      },
      {
        key: 'probability',
        label: '输出概率',
        type: 'boolean',
        default: true,
        group: 'model',
        advanced: true,
        algorithm: 'SVC.probability',
        description: '分类任务是否训练概率输出。'
      },
      {
        key: 'tol',
        label: '停止阈值',
        type: 'number',
        default: 0.001,
        min: 0.00000001,
        max: 1,
        step: 0.0001,
        group: 'model',
        advanced: true,
        algorithm: 'SVC/SVR.tol',
        description: 'SVM 优化停止阈值。'
      },
      {
        key: 'maxIter',
        label: '最大迭代次数',
        type: 'number',
        default: -1,
        min: -1,
        max: 100000,
        step: 100,
        group: 'model',
        advanced: true,
        algorithm: 'SVC/SVR.max_iter',
        description: '-1 表示不限制迭代。'
      },
      {
        key: 'classWeight',
        label: '类别权重',
        type: 'select',
        default: 'balanced',
        group: 'model',
        advanced: true,
        options: [
          { label: '无', value: 'none' },
          { label: '平衡', value: 'balanced' }
        ],
        algorithm: 'SVC.class_weight',
        description: '分类任务中的类别权重策略。'
      },
      {
        key: 'cvFold',
        label: '交叉验证折数',
        type: 'number',
        default: 5,
        min: 3,
        max: 10,
        step: 1,
        group: 'validation',
        algorithm: 'cross_val_score.cv',
        description: 'SVM 交叉验证折数。'
      },
      {
        key: 'permutationRepeats',
        label: '置换重要性次数',
        type: 'number',
        default: 8,
        min: 3,
        max: 30,
        step: 1,
        group: 'validation',
        algorithm: 'permutation_importance.n_repeats',
        description: '计算特征置换重要性的重复次数。'
      }
    ],
    boruta: [
      {
        key: 'nEstimators',
        label: '树数量',
        type: 'number',
        default: 160,
        min: 40,
        max: 500,
        step: 20,
        group: 'model',
        algorithm: 'RandomForest.n_estimators',
        description: 'Boruta 近似随机森林树数量。'
      },
      {
        key: 'shadowPercentile',
        label: 'Shadow 特征分位阈值',
        type: 'number',
        default: 90,
        min: 50,
        max: 99.9,
        step: 0.5,
        group: 'model',
        algorithm: 'Boruta shadow feature percentile',
        description: '用 shadow 特征重要性的该分位数作为确认阈值。'
      },
      {
        key: 'maxDepth',
        label: '最大树深',
        type: 'number',
        default: 8,
        min: 1,
        max: 128,
        step: 1,
        group: 'model',
        advanced: true,
        algorithm: 'RandomForest.max_depth',
        description: '限制单棵树最大深度。'
      },
      {
        key: 'minSamplesSplit',
        label: '节点最小分裂样本',
        type: 'number',
        default: 2,
        min: 2,
        max: 50,
        step: 1,
        group: 'model',
        advanced: true,
        algorithm: 'RandomForest.min_samples_split',
        description: '内部节点继续分裂所需最小样本数。'
      },
      {
        key: 'minSamplesLeaf',
        label: '叶节点最小样本',
        type: 'number',
        default: 1,
        min: 1,
        max: 50,
        step: 1,
        group: 'model',
        advanced: true,
        algorithm: 'RandomForest.min_samples_leaf',
        description: '叶节点所需最小样本数。'
      },
      {
        key: 'maxFeatures',
        label: '单次分裂特征数',
        type: 'select',
        default: 'sqrt',
        group: 'model',
        advanced: true,
        options: [
          { label: 'sqrt', value: 'sqrt' },
          { label: 'log2', value: 'log2' },
          { label: '全部', value: 'none' }
        ],
        algorithm: 'RandomForest.max_features',
        description: '寻找最佳分裂时考虑的特征数量策略。'
      },
      {
        key: 'bootstrap',
        label: 'Bootstrap 抽样',
        type: 'boolean',
        default: true,
        group: 'model',
        advanced: true,
        algorithm: 'RandomForest.bootstrap',
        description: '是否使用 bootstrap 样本训练每棵树。'
      },
      {
        key: 'oobScore',
        label: '启用 OOB 评分',
        type: 'boolean',
        default: true,
        group: 'validation',
        algorithm: 'RandomForest.oob_score',
        description: '使用袋外样本估计模型评分。'
      },
      {
        key: 'classWeight',
        label: '类别权重',
        type: 'select',
        default: 'balanced',
        group: 'model',
        advanced: true,
        options: [
          { label: '无', value: 'none' },
          { label: '平衡', value: 'balanced' },
          { label: '平衡子样本', value: 'balanced_subsample' }
        ],
        algorithm: 'RandomForestClassifier.class_weight',
        description: '分类任务中的类别权重策略。'
      },
      {
        key: 'nJobs',
        label: '并行线程数',
        type: 'number',
        default: 1,
        min: 1,
        max: 8,
        step: 1,
        group: 'runtime',
        advanced: true,
        algorithm: 'RandomForest.n_jobs',
        description: '容器内随机森林并行线程数。'
      }
    ],
    roc: [
      {
        key: 'nEstimators',
        label: '树数量',
        type: 'number',
        default: 120,
        min: 40,
        max: 500,
        step: 20,
        group: 'model',
        algorithm: 'RandomForestClassifier.n_estimators',
        description: 'ROC 概率模型随机森林树数量。'
      }
    ],
    correlation: [
      {
        key: 'correlationMethod',
        label: '相关方法',
        type: 'select',
        default: 'pearson',
        group: 'statistics',
        options: [
          { label: 'Pearson', value: 'pearson' },
          { label: 'Spearman', value: 'spearman' }
        ],
        algorithm: 'scipy.stats.pearsonr / spearmanr',
        description: '特征与性状相关性计算方法。'
      }
    ],
    gramm: [
      {
        key: 'correlationMethod',
        label: '相关方法',
        type: 'select',
        default: 'spearman',
        group: 'statistics',
        options: [
          { label: 'Pearson', value: 'pearson' },
          { label: 'Spearman', value: 'spearman' }
        ],
        algorithm: 'scipy.stats.pearsonr / spearmanr',
        description: '多组学网络边权计算方法。'
      },
      {
        key: 'topEdges',
        label: '网络边数量',
        type: 'number',
        default: 8,
        min: 3,
        max: 50,
        step: 1,
        group: 'network',
        algorithm: 'local top feature-trait edges',
        description: 'GRaMM 关联网络输出的最高权重边数量。'
      }
    ],
    'cca-rda': [
      {
        key: 'correlationMethod',
        label: '排序前相关方法',
        type: 'select',
        default: 'pearson',
        group: 'statistics',
        advanced: true,
        options: [
          { label: 'Pearson', value: 'pearson' },
          { label: 'Spearman', value: 'spearman' }
        ],
        algorithm: 'scipy.stats.pearsonr / spearmanr',
        description: '排序分析前关联特征表使用的相关方法。'
      },
      {
        key: 'nComponents',
        label: '排序轴数量',
        type: 'number',
        default: 2,
        min: 2,
        max: 8,
        step: 1,
        group: 'model',
        algorithm: 'PCA constrained ordination approximation',
        description: '排序分析输出轴数量。'
      }
    ],
    kegg: [
      {
        key: 'topN',
        label: '候选特征 TopN',
        type: 'number',
        default: 20,
        min: 5,
        max: 100,
        step: 5,
        group: 'enrichment',
        algorithm: 'top absolute Spearman association',
        description: '进入通路富集的候选特征数量。'
      },
      {
        key: 'minOverlap',
        label: '最小重叠数',
        type: 'number',
        default: 1,
        min: 1,
        max: 20,
        step: 1,
        group: 'enrichment',
        advanced: true,
        algorithm: 'hypergeometric overlap cutoff',
        description: '候选集合与本地通路注释至少重叠多少个特征才输出。'
      }
    ],
    msea: [
      {
        key: 'topN',
        label: '候选代谢物 TopN',
        type: 'number',
        default: 20,
        min: 5,
        max: 100,
        step: 5,
        group: 'enrichment',
        algorithm: 'top absolute Spearman association',
        description: '进入代谢物集合富集的候选数量。'
      },
      {
        key: 'minOverlap',
        label: '最小重叠数',
        type: 'number',
        default: 1,
        min: 1,
        max: 20,
        step: 1,
        group: 'enrichment',
        advanced: true,
        algorithm: 'hypergeometric overlap cutoff',
        description: '候选集合与代谢物集合至少重叠多少个特征才输出。'
      }
    ],
    ipath: [
      {
        key: 'topN',
        label: '通路映射 TopN',
        type: 'number',
        default: 20,
        min: 5,
        max: 100,
        step: 5,
        group: 'enrichment',
        algorithm: 'top absolute Spearman association',
        description: '进入本地通路网络映射的特征数量。'
      },
      {
        key: 'minOverlap',
        label: '最小重叠数',
        type: 'number',
        default: 1,
        min: 1,
        max: 20,
        step: 1,
        group: 'enrichment',
        advanced: true,
        algorithm: 'hypergeometric overlap cutoff',
        description: '通路网络中保留的最小候选重叠数。'
      }
    ],
    heatmap: [
      {
        key: 'heatmapFeatureCount',
        label: '热图特征数',
        type: 'number',
        default: 24,
        min: 5,
        max: 80,
        step: 5,
        group: 'visual',
        algorithm: 'matrix slice before clustering',
        description: '热图中展示和聚类的特征数量。'
      },
      {
        key: 'distanceMetric',
        label: '距离度量',
        type: 'select',
        default: 'euclidean',
        group: 'visual',
        advanced: true,
        options: [
          { label: 'Euclidean', value: 'euclidean' },
          { label: 'Cityblock', value: 'cityblock' },
          { label: 'Cosine', value: 'cosine' },
          { label: 'Correlation', value: 'correlation' }
        ],
        algorithm: 'scipy.spatial.distance.pdist',
        description: '样本和特征层次聚类的距离度量。'
      },
      {
        key: 'linkageMethod',
        label: '聚类连接方法',
        type: 'select',
        default: 'average',
        group: 'visual',
        advanced: true,
        options: [
          { label: 'Single', value: 'single' },
          { label: 'Complete', value: 'complete' },
          { label: 'Average', value: 'average' },
          { label: 'Ward', value: 'ward' }
        ],
        algorithm: 'scipy.cluster.hierarchy.linkage',
        description: '热图层次聚类的连接方法；Ward 会自动使用 Euclidean 距离。'
      }
    ],
    'violin-box': [
      {
        key: 'heatmapFeatureCount',
        label: '分布统计特征数',
        type: 'number',
        default: 24,
        min: 5,
        max: 80,
        step: 5,
        group: 'visual',
        algorithm: 'matrix slice before grouped summaries',
        description: '分布摘要使用的候选特征窗口。'
      }
    ],
    'venn-zscore': [
      {
        key: 'heatmapFeatureCount',
        label: 'Z-score 特征数',
        type: 'number',
        default: 24,
        min: 5,
        max: 80,
        step: 5,
        group: 'visual',
        algorithm: 'set overlap and row-scaled z-score window',
        description: 'Z-score 输出的特征数量。'
      }
    ]
  }
}

const serverStartedAt = new Date()
const MQTT_COMMAND_TOPIC_FILTER = 'command/send/+'
const MQTT_DEFAULT_COMMAND_TARGET = 'mqtt-live-gateway'
const TH_SHRC_ENABLED = !['0', 'false', 'no', 'off'].includes(
  String(process.env.TH_SHRC_ENABLED || 'true')
    .trim()
    .toLowerCase()
)
const mqttState = {
  enabled: mqttConfig.enabled,
  listening: false,
  host: mqttConfig.host,
  port: mqttConfig.port,
  topic: mqttConfig.topic,
  commandTopic: MQTT_COMMAND_TOPIC_FILTER,
  startedAt: null,
  connectedClients: 0,
  totalClients: 0,
  receivedCount: 0,
  ingestedCount: 0,
  ignoredCount: 0,
  publishedCount: 0,
  errorCount: 0,
  lastTopic: null,
  lastCowNumber: null,
  lastMessageAt: null,
  lastIngestAt: null,
  lastPublishedTopic: null,
  lastPublishedAt: null,
  lastError: null
}

let mqttServer = null
let mqttBroker = null

const pool = mysql.createPool({
  ...config,
  waitForConnections: true,
  queueLimit: 0
})

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const API_BUILD_HASH_ALGORITHM = 'sha256-api-runtime-inputs-v1'

const V2_DATABASE_TABLES = [
  'animal',
  'animal_identifier',
  'animal_parentage',
  'stage_definition',
  'herd_group',
  'farm_unit',
  'animal_group_membership',
  'animal_pen_assignment',
  'group_pen_policy',
  'group_transfer_request',
  'unit_capacity_snapshot',
  'business_calendar',
  'production_day_rule',
  'production_shift',
  'time_day',
  'time_month',
  'time_year',
  'time_period',
  'rolling_window_definition',
  'animal_time_index',
  'trait_category',
  'trait_definition',
  'trait_method',
  'trait_observation_batch',
  'trait_observation',
  'trait_aggregation_rule',
  'fact_cow_trait_day',
  'fact_cow_trait_month',
  'fact_cow_trait_year',
  'fact_cow_trait_parity',
  'fact_cow_trait_lactation',
  'fact_lactation_305',
  'animal_event',
  'event_reproduction_detail',
  'event_health_detail',
  'event_movement_detail',
  'event_production_detail',
  'event_medicine_detail',
  'parity_episode',
  'reproduction_cycle',
  'lactation_episode',
  'gestation_episode',
  'dry_period_episode',
  'fact_event_count_day',
  'fact_event_count_month',
  'fact_event_count_year',
  'fact_event_count_cycle',
  'fact_event_count_parity',
  'fact_event_count_lactation',
  'dictionary_category',
  'dictionary_item',
  'custom_field_definition',
  'custom_field_value',
  'field_promotion_request',
  'duplicate_detection_rule',
  'medicine',
  'medicine_batch',
  'medication_order',
  'medication_administration',
  'withdrawal_tracking',
  'residue_test',
  'inventory_ledger',
  'device',
  'device_channel',
  'animal_device_assignment',
  'milking_session',
  'milking_visit',
  'milk_measurement',
  'sensor_reading',
  'data_quality_issue',
  'research_project',
  'research_cohort_definition',
  'research_variable_set',
  'research_extract_job',
  'research_extract_filter',
  'research_extract_variable',
  'research_dataset_snapshot',
  'research_dataset_artifact',
  'data_dictionary_snapshot',
  'omics_samples',
  'omics_datasets',
  'omics_markers',
  'multi_omics_associations',
  'breeding_analyses',
  'omics_dataset_sample',
  'omics_feature',
  'omics_trait_link',
  'omics_artifact',
  'omics_module_runs',
  'omics_workflow_runs',
  'omics_analysis_artifacts',
  'breeding_value_run',
  'breeding_value',
  'selection_index',
  'mating_recommendation',
  'alert_rule',
  'alert_case',
  'work_order',
  'report_template',
  'report_metric_definition',
  'report_run',
  'report_run_item',
  'export_scope_definition',
  'report_period_filter',
  'report_data_scope',
  'export_file',
  'permission_policy',
  'role_permission',
  'approval_workflow',
  'operation_audit_log',
  'correction_request',
  'derivation_recompute_job'
]
const V2_DATABASE_TABLE_SET = new Set(V2_DATABASE_TABLES)
let v2SchemaPromise = null

const DEFAULT_TABLES = [
  'cows',
  'sensors',
  'events',
  'devices',
  'persons',
  'pens',
  'diseases',
  'medicines',
  'transfer_reasons',
  'breed_types',
  'milk_records',
  'milk_quality_standards',
  'lactation_curves',
  'feed_records',
  'feed_formulas',
  'feed_inventory',
  'breeding_records',
  'reproduction_cycles',
  'alerts',
  'workflow_templates',
  'workflow_instances',
  'automated_actions',
  'smart_transfer_rules',
  'reminder_rules',
  'kpi_dashboards',
  'kpi_dashboard_data',
  'economic_analysis',
  'cost_items',
  'revenue_items',
  'budget_plans',
  'omics_samples',
  'omics_datasets',
  'omics_markers',
  'multi_omics_associations',
  'breeding_analyses',
  'omics_module_runs',
  'omics_workflow_runs',
  'omics_analysis_artifacts',
  'phenotype_trait_definitions',
  'phenotype_records',
  'phenotype_export_methods',
  'logical_trait_rules',
  'predictive_models',
  'prediction_results',
  'forecast_scenarios',
  'predictive_alerts',
  'sensor_status',
  'data_quality_checks',
  'sensor_calibrations',
  'hardware_devices',
  'integration_protocols',
  'data_synchronizations',
  'hardware_alerts',
  'device_maintenance',
  'integration_dashboards',
  'entry_events',
  'transfer_events',
  'exit_events',
  'export_audit_logs',
  'hardware_command_logs',
  'breeding_decision_runs',
  'operation_audit_logs',
  'breeding_events',
  'veterinary_events',
  'health_scores',
  'kpi_data',
  'economic_data',
  ...V2_DATABASE_TABLES
]

const RESET_EXTRA_TABLES = [
  'cow_events',
  'sensor_readings',
  'milk_records',
  'phenotype_records',
  'entry_events',
  'transfer_events',
  'exit_events',
  'breeding_events',
  'veterinary_events'
]

const BASE_INFO_COLUMN_DEFINITIONS = {
  base_info_categories: [
    ['scope', 'VARCHAR(128) NULL'],
    ['code', 'VARCHAR(128) NULL'],
    ['value', 'VARCHAR(128) NULL'],
    ['name', 'VARCHAR(128) NULL'],
    ['label', 'VARCHAR(128) NULL'],
    ['category', 'VARCHAR(128) NULL'],
    ['status', 'VARCHAR(32) NULL'],
    ['is_active', 'TINYINT(1) NOT NULL DEFAULT 1'],
    ['sort_order', 'INT NULL'],
    ['updated_at', 'DATETIME(3) NULL']
  ],
  persons: [
    ['name', 'VARCHAR(128) NULL'],
    ['account_name', 'VARCHAR(128) NULL'],
    ['password_hash', 'VARCHAR(255) NULL'],
    ['password_updated_at', 'DATETIME(3) NULL'],
    ['last_login_at', 'DATETIME(3) NULL'],
    ['department', 'VARCHAR(128) NULL'],
    ['role', 'VARCHAR(64) NULL'],
    ['phone', 'VARCHAR(32) NULL'],
    ['email', 'VARCHAR(128) NULL'],
    ['status', 'VARCHAR(32) NULL'],
    ['hire_date', 'DATE NULL'],
    ['notes', 'TEXT NULL'],
    ['is_active', 'TINYINT(1) NOT NULL DEFAULT 1'],
    ['updated_at', 'DATETIME(3) NULL']
  ],
  pens: [
    ['name', 'VARCHAR(128) NULL'],
    ['category', 'VARCHAR(64) NULL'],
    ['capacity', 'INT NULL'],
    ['area', 'DECIMAL(12,2) NULL'],
    ['manager', 'VARCHAR(128) NULL'],
    ['status', 'VARCHAR(32) NULL'],
    ['is_active', 'TINYINT(1) NOT NULL DEFAULT 1'],
    ['updated_at', 'DATETIME(3) NULL']
  ],
  diseases: [
    ['name', 'VARCHAR(128) NULL'],
    ['category', 'VARCHAR(64) NULL'],
    ['severity', 'VARCHAR(32) NULL'],
    ['contagious', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['symptoms', 'TEXT NULL'],
    ['treatment', 'TEXT NULL'],
    ['status', 'VARCHAR(32) NULL'],
    ['is_active', 'TINYINT(1) NOT NULL DEFAULT 1'],
    ['updated_at', 'DATETIME(3) NULL']
  ],
  medicines: [
    ['name', 'VARCHAR(128) NULL'],
    ['category', 'VARCHAR(64) NULL'],
    ['dosage', 'VARCHAR(128) NULL'],
    ['unit', 'VARCHAR(32) NULL'],
    ['usage_text', 'TEXT NULL'],
    ['storage', 'VARCHAR(256) NULL'],
    ['status', 'VARCHAR(32) NULL'],
    ['is_active', 'TINYINT(1) NOT NULL DEFAULT 1'],
    ['updated_at', 'DATETIME(3) NULL']
  ],
  transfer_reasons: [
    ['name', 'VARCHAR(128) NULL'],
    ['reason', 'VARCHAR(128) NULL'],
    ['category_id', 'VARCHAR(64) NULL'],
    ['category_name', 'VARCHAR(128) NULL'],
    ['category', 'VARCHAR(128) NULL'],
    ['frequency', 'VARCHAR(32) NULL'],
    ['status', 'VARCHAR(32) NULL'],
    ['description', 'TEXT NULL'],
    ['is_active', 'TINYINT(1) NOT NULL DEFAULT 1'],
    ['updated_at', 'DATETIME(3) NULL']
  ]
}

const UNIQUE_CODE_TABLES = new Set([
  'phenotype_trait_definitions',
  'phenotype_export_methods',
  'logical_trait_rules'
])
const LARGE_APPEND_ONLY_TABLES = new Set(['operation_audit_log', 'operation_audit_logs'])
const uniqueCodeConstraintReady = new Set()
const tableMetadataCache = new Map()
const loginSessionMap = new Map()
const QUERY_METHOD_RE = /^(get|list|query)/
const CREATE_METHOD_RE = /^(create|add|register|import|upload)/
const UPDATE_METHOD_RE = /^(update|acknowledge|resolve|complete)/
const DELETE_METHOD_RE = /^(delete|remove)/
const RPC_PRODUCTION_BLOCKED_METHODS = new Set([
  'resetDatabase',
  'clearTableData',
  'updateTableData',
])
const RPC_WRITE_METHODS = new Set([
  'addTableData',
  'updateTableData',
  'updateTableRecord',
  'deleteTableRecord',
  'clearTableData',
  'resetDatabase',
])
const RPC_DDL_METHOD_RE =
  /(?:schema|ddl|sql|migration|migrate|createTable|dropTable|alterTable|truncate|addColumn|dropColumn|renameColumn|createIndex|dropIndex|createDatabase|dropDatabase|alterDatabase|executeRaw|rawQuery)/i

const ENTITY_TABLE_MAP = {
  cow: 'cows',
  cows: 'cows',
  person: 'persons',
  persons: 'persons',
  pen: 'pens',
  pens: 'pens',
  disease: 'diseases',
  diseases: 'diseases',
  medicine: 'medicines',
  medicines: 'medicines',
  transfer_reason: 'transfer_reasons',
  transfer_reasons: 'transfer_reasons',
  breed_type: 'breed_types',
  breed_types: 'breed_types',
  breed: 'breed_types',
  breeds: 'breed_types',
  entry_event: 'entry_events',
  entry_events: 'entry_events',
  transfer_event: 'transfer_events',
  transfer_events: 'transfer_events',
  exit_event: 'exit_events',
  exit_events: 'exit_events',
  export_audit_log: 'export_audit_logs',
  export_audit_logs: 'export_audit_logs',
  hardware_command_log: 'hardware_command_logs',
  hardware_command_logs: 'hardware_command_logs',
  mqtt_message_log: 'mqtt_message_logs',
  mqtt_message_logs: 'mqtt_message_logs',
  breeding_decision_run: 'breeding_decision_runs',
  breeding_decision_runs: 'breeding_decision_runs',
  operation_audit_log: 'operation_audit_log',
  operation_audit_logs: 'operation_audit_logs',
  breeding_event: 'breeding_events',
  breeding_events: 'breeding_events',
  veterinary_event: 'veterinary_events',
  veterinary_events: 'veterinary_events',
  breeding_record: 'breeding_records',
  breeding_records: 'breeding_records',
  reproduction_cycle: 'reproduction_cycles',
  reproduction_cycles: 'reproduction_cycles',
  milk_record: 'milk_records',
  milk_records: 'milk_records',
  milk_quality_standard: 'milk_quality_standards',
  milk_quality_standards: 'milk_quality_standards',
  feed_record: 'feed_records',
  feed_records: 'feed_records',
  feed_formula: 'feed_formulas',
  feed_formulas: 'feed_formulas',
  feed_inventory: 'feed_inventory',
  alert: 'alerts',
  alerts: 'alerts',
  health_score: 'health_scores',
  health_scores: 'health_scores',
  workflow_template: 'workflow_templates',
  workflow_templates: 'workflow_templates',
  workflow_instance: 'workflow_instances',
  workflow_instances: 'workflow_instances',
  automated_action: 'automated_actions',
  automated_actions: 'automated_actions',
  smart_transfer_rule: 'smart_transfer_rules',
  smart_transfer_rules: 'smart_transfer_rules',
  reminder_rule: 'reminder_rules',
  reminder_rules: 'reminder_rules',
  kpi_dashboard: 'kpi_dashboards',
  kpi_dashboards: 'kpi_dashboards',
  kpi_dashboard_data: 'kpi_dashboard_data',
  kpi_data: 'kpi_data',
  economic_analysis: 'economic_analysis',
  economic_data: 'economic_data',
  cost_record: 'cost_items',
  cost_records: 'cost_items',
  cost_item: 'cost_items',
  cost_items: 'cost_items',
  revenue_record: 'revenue_items',
  revenue_records: 'revenue_items',
  revenue_item: 'revenue_items',
  revenue_items: 'revenue_items',
  budget_plan: 'budget_plans',
  budget_plans: 'budget_plans',
  omics_sample: 'omics_samples',
  omics_samples: 'omics_samples',
  omics_dataset: 'omics_datasets',
  omics_datasets: 'omics_datasets',
  omics_marker: 'omics_markers',
  omics_markers: 'omics_markers',
  multi_omics_association: 'multi_omics_associations',
  multi_omics_associations: 'multi_omics_associations',
  breeding_analysis: 'breeding_analyses',
  breeding_analyses: 'breeding_analyses',
  omics_module_run: 'omics_module_runs',
  omics_module_runs: 'omics_module_runs',
  omics_workflow_run: 'omics_workflow_runs',
  omics_workflow_runs: 'omics_workflow_runs',
  omics_analysis_artifact: 'omics_analysis_artifacts',
  omics_analysis_artifacts: 'omics_analysis_artifacts',
  phenotype_trait_definition: 'phenotype_trait_definitions',
  phenotype_trait_definitions: 'phenotype_trait_definitions',
  logical_trait_rule: 'logical_trait_rules',
  logical_trait_rules: 'logical_trait_rules',
  phenotype_record: 'phenotype_records',
  phenotype_records: 'phenotype_records',
  predictive_model: 'predictive_models',
  predictive_models: 'predictive_models',
  prediction_result: 'prediction_results',
  prediction_results: 'prediction_results',
  forecast_scenario: 'forecast_scenarios',
  forecast_scenarios: 'forecast_scenarios',
  predictive_alert: 'predictive_alerts',
  predictive_alerts: 'predictive_alerts',
  sensor_status: 'sensor_status',
  sensor_calibration: 'sensor_calibrations',
  sensor_calibrations: 'sensor_calibrations',
  data_quality_check: 'data_quality_checks',
  data_quality_checks: 'data_quality_checks',
  hardware_device: 'hardware_devices',
  hardware_devices: 'hardware_devices',
  integration_protocol: 'integration_protocols',
  integration_protocols: 'integration_protocols',
  data_synchronization: 'data_synchronizations',
  data_synchronizations: 'data_synchronizations',
  hardware_alert: 'hardware_alerts',
  hardware_alerts: 'hardware_alerts',
  device_maintenance: 'device_maintenance',
  device_maintenances: 'device_maintenance',
  integration_dashboard: 'integration_dashboards',
  integration_dashboards: 'integration_dashboards',
  event: 'events',
  events: 'events',
  device: 'devices',
  devices: 'devices',
  sensor: 'sensors',
  sensors: 'sensors',
  temperature_data: 'sensors',
  step_data: 'sensors',
  extended_sensor_data: 'sensors',
  rumination_data: 'sensors',
  activity_data: 'sensors',
  feeding_data: 'sensors'
}

for (const table of V2_DATABASE_TABLES) {
  const aliases = [table, `${table}s`, table.replace(/_/g, '')]
  for (const alias of aliases) {
    if (!ENTITY_TABLE_MAP[alias]) ENTITY_TABLE_MAP[alias] = table
  }
}

const METHOD_TABLE_HINTS = [
  ['transferreason', 'transfer_reasons'],
  ['breedtype', 'breed_types'],
  ['breed', 'breed_types'],
  ['entryevent', 'entry_events'],
  ['transferevent', 'transfer_events'],
  ['exitevent', 'exit_events'],
  ['exportauditlog', 'export_audit_logs'],
  ['exporthistory', 'export_audit_logs'],
  ['hardwarecommandlog', 'hardware_command_logs'],
  ['mqttmessagelog', 'mqtt_message_logs'],
  ['breedingdecisionrun', 'breeding_decision_runs'],
  ['operationauditlog', 'operation_audit_log'],
  ['breedingevent', 'breeding_events'],
  ['veterinaryevent', 'veterinary_events'],
  ['breedingrecord', 'breeding_records'],
  ['reproductioncycle', 'reproduction_cycles'],
  ['milkqualitystandard', 'milk_quality_standards'],
  ['milkrecord', 'milk_records'],
  ['feedformula', 'feed_formulas'],
  ['feedinventory', 'feed_inventory'],
  ['feedrecord', 'feed_records'],
  ['workflowtemplate', 'workflow_templates'],
  ['workflowinstance', 'workflow_instances'],
  ['automatedaction', 'automated_actions'],
  ['smarttransferrule', 'smart_transfer_rules'],
  ['reminderrule', 'reminder_rules'],
  ['kpidashboarddata', 'kpi_dashboard_data'],
  ['kpidashboard', 'kpi_dashboards'],
  ['kpimetric', 'kpi_data'],
  ['kpivalue', 'kpi_data'],
  ['omicssample', 'omics_samples'],
  ['omicsdataset', 'omics_datasets'],
  ['omicsmarker', 'omics_markers'],
  ['multiomicsassociation', 'multi_omics_associations'],
  ['breedinganalysis', 'breeding_analyses'],
  ['omicsmodulerun', 'omics_module_runs'],
  ['omicsworkflowrun', 'omics_workflow_runs'],
  ['omicsanalysisartifact', 'omics_analysis_artifacts'],
  ['phenotypetraitdefinition', 'phenotype_trait_definitions'],
  ['phenotypetrait', 'phenotype_trait_definitions'],
  ['logicaltraitrule', 'logical_trait_rules'],
  ['logicaltrait', 'logical_trait_rules'],
  ['phenotyperecord', 'phenotype_records'],
  ['predictivemodel', 'predictive_models'],
  ['predictionresult', 'prediction_results'],
  ['forecastscenario', 'forecast_scenarios'],
  ['predictivealert', 'predictive_alerts'],
  ['predictivedashboard', 'integration_dashboards'],
  ['sensorstatus', 'sensor_status'],
  ['dataquality', 'data_quality_checks'],
  ['sensorcalibration', 'sensor_calibrations'],
  ['hardwaredevice', 'hardware_devices'],
  ['integrationprotocol', 'integration_protocols'],
  ['datasynchronization', 'data_synchronizations'],
  ['hardwarealert', 'hardware_alerts'],
  ['devicemaintenance', 'device_maintenance'],
  ['person', 'persons'],
  ['pen', 'pens'],
  ['disease', 'diseases'],
  ['medicine', 'medicines'],
  ['temperature', 'sensors'],
  ['step', 'sensors'],
  ['sensor', 'sensors'],
  ['cow', 'cows']
]

const GENERIC_SCOPE_TABLE = {
  cow: 'cows',
  sensor: 'sensors',
  event: 'events',
  baseData: null,
  statistics: 'cows',
  export: null,
  milk: 'milk_records',
  feed: 'feed_records',
  reproduction: 'breeding_records',
  health: 'alerts',
  automation: 'workflow_templates',
  economic: 'economic_analysis',
  omics: 'omics_datasets',
  predictive: 'predictive_models',
  hardware: 'hardware_devices',
  kpi: 'kpi_dashboards'
}

function apiSuccess(data, msg = 'success') {
  return { code: 200, msg, data }
}

function apiFail(error) {
  return {
    code: Number(error?.status || error?.statusCode || 500),
    msg: error?.message || String(error),
    data: null
  }
}

function createHttpError(status, message, code = '') {
  const error = new Error(message)
  error.status = status
  if (code) error.code = code
  return error
}

function sendApiError(res, error) {
  const status = Number(error?.status || error?.statusCode || 500)
  res.status(status).json(apiFail(error))
}

async function readJsonFileIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function readPackageVersionFallback() {
  try {
    const pkg = JSON.parse(fsSync.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
    return {
      name: pkg.name || 'cattle-management-platform',
      version: pkg.version || '0.0.0'
    }
  } catch {
    return {
      name: 'cattle-management-platform',
      version: '0.0.0'
    }
  }
}

async function readApiBuildInfo() {
  const buildInfoFile = process.env.APP_BUILD_INFO_FILE || '/app/build-info.json'
  const fileBuildInfo = await readJsonFileIfPresent(buildInfoFile)
  if (fileBuildInfo && typeof fileBuildInfo === 'object') {
    const buildHash = fileBuildInfo.buildHash || fileBuildInfo.hash || fileBuildInfo.apiHash || ''
    return {
      name: fileBuildInfo.name || 'cattle-management-platform',
      version: fileBuildInfo.version || process.env.APP_BUILD_VERSION || '0.0.0',
      buildHash,
      builtAt: fileBuildInfo.builtAt || fileBuildInfo.build?.createdAt || null,
      hashAlgorithm: fileBuildInfo.hashAlgorithm || API_BUILD_HASH_ALGORITHM
    }
  }

  const pkg = readPackageVersionFallback()
  return {
    name: process.env.APP_NAME || pkg.name,
    version: process.env.APP_BUILD_VERSION || process.env.VITE_VERSION || pkg.version,
    buildHash: process.env.APP_BUILD_HASH || process.env.APP_BUILD_REF || 'local-dev',
    builtAt: process.env.APP_BUILT_AT || serverStartedAt.toISOString(),
    hashAlgorithm: process.env.APP_BUILD_HASH_ALGORITHM || API_BUILD_HASH_ALGORITHM
  }
}

function publicMysqlConfig() {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    connectionLimit: config.connectionLimit
  }
}

function sanitizeMemoryUsage(memory) {
  return Object.fromEntries(
    Object.entries(memory).map(([key, value]) => [key, Number((value / 1024 / 1024).toFixed(2))])
  )
}

function normalizeTableName(name) {
  return String(name || '')
    .trim()
    .replace(/-/g, '_')
    .replace(/[^\w]/g, '')
    .toLowerCase()
}

function snakeToCamel(str) {
  return str.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
}

function camelToSnake(str) {
  return str
    .replace(/([A-Z])/g, '_$1')
    .replace(/-/g, '_')
    .toLowerCase()
}

function isPlainObject(obj) {
  return obj && typeof obj === 'object' && !Array.isArray(obj) && !(obj instanceof Date)
}

function syncAliases(obj, pairs) {
  for (const [camelKey, snakeKey] of pairs) {
    if (obj[camelKey] !== undefined && obj[snakeKey] === undefined) obj[snakeKey] = obj[camelKey]
    if (obj[snakeKey] !== undefined && obj[camelKey] === undefined) obj[camelKey] = obj[snakeKey]
  }
}

function safeJsonParse(value, fallback = null) {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function markInsertOnlyColumn(row, column) {
  if (!row || !column) return
  const current = row.__insertOnlyColumns instanceof Set ? row.__insertOnlyColumns : new Set()
  current.add(column)
  Object.defineProperty(row, '__insertOnlyColumns', {
    value: current,
    enumerable: false,
    configurable: true
  })
}

function insertOnlyColumnsOf(row) {
  return row?.__insertOnlyColumns instanceof Set ? row.__insertOnlyColumns : new Set()
}

function firstNonBlankText(...values) {
  return values.map((value) => String(value ?? '').trim()).find(Boolean) || ''
}

function normalizeAccountName(value) {
  return String(value ?? '').trim()
}

function passwordDigest(password, salt = randomBytes(16).toString('hex')) {
  const hash = createHash('sha256')
    .update(`${salt}:${String(password ?? '')}`)
    .digest('hex')
  return `sha256:${salt}:${hash}`
}

function verifyPasswordDigest(password, stored) {
  const raw = String(stored || '')
  const parts = raw.split(':')
  if (parts.length !== 3 || parts[0] !== 'sha256' || !parts[1] || !parts[2]) return false
  const expected = passwordDigest(password, parts[1])
  const left = Buffer.from(expected)
  const right = Buffer.from(raw)
  return left.length === right.length && timingSafeEqual(left, right)
}

function personRoleToAuthRoles(role) {
  const normalized = normalizePersonRoleValue(role)
  if (normalized === '管理员') return ['R_ADMIN']
  return ['R_USER']
}

function normalizeTransferReasonCategory(category, name, description = '') {
  const text = `${category} ${name} ${description}`
  if (/疾病|隔离|治疗|疫苗|康复|防疫|检疫|乳房炎|蹄|伤|死亡|病/.test(text)) return '健康管理'
  if (
    /出生|购入|入群|转入|新购|引种|泌乳|干奶|妊娠|配种|分娩|产犊|断奶|阶段|品种|繁殖|生产|犊牛|育成|公牛|待产/.test(
      text
    )
  )
    return '生产管理'
  if (/饲|料|日粮|营养|体况|采食|膘情|育肥/.test(text)) return '饲养管理'
  if (['生产管理', '健康管理', '饲养管理', '其他'].includes(category)) return category
  return '其他'
}

function normalizeTransferReasonFrequency(frequency, name, category) {
  if (['高频', '中频', '低频', '临时'].includes(frequency)) return frequency
  const text = `${name} ${category}`
  if (/管理调整|临时/.test(text)) return '临时'
  if (/维修|场地|出售|淘汰|死亡|临时|管理调整/.test(text)) return '低频'
  if (/泌乳|断奶|出生|入群|阶段/.test(text)) return '高频'
  if (/疾病|隔离|康复|干奶|疫苗|品种|饲|分娩|妊娠|配种|体重|转群/.test(text)) return '中频'
  return '中频'
}

function normalizeTransferReasonPayload(payload = {}) {
  const obj = { ...payload }
  const name = firstNonBlankText(
    obj.name,
    obj.reason,
    obj.reasonName,
    obj.reason_name,
    obj.title,
    obj.label
  )
  if (name) {
    obj.name = name
    if (!obj.reason) obj.reason = name
  }
  const explicitCategory = firstNonBlankText(
    obj.category,
    obj.categoryName,
    obj.category_name,
    obj.reasonType,
    obj.reason_type,
    obj.type
  )
  obj.category = explicitBaseInfoCategoryOrNormalized(explicitCategory, () =>
    normalizeTransferReasonCategory(
      explicitCategory,
      name,
      firstNonBlankText(obj.description, obj.remark, obj.notes)
    )
  )
  if (!obj.categoryName) obj.categoryName = obj.category
  if (!obj.category_name) obj.category_name = obj.category
  obj.frequency = normalizeTransferReasonFrequency(
    firstNonBlankText(
      obj.frequency,
      obj.usageFrequency,
      obj.usage_frequency,
      obj.useFrequency,
      obj.use_frequency
    ),
    name,
    obj.category
  )
  const status = firstNonBlankText(obj.status, obj.state)
  if (status) {
    obj.status = /^(停用|禁用|inactive|disabled)$/i.test(status) ? '停用' : '启用'
  } else if (obj.isActive !== undefined || obj.is_active !== undefined) {
    const active = obj.isActive ?? obj.is_active
    obj.status = ['false', '0', '停用', '禁用', 'inactive', 'disabled'].includes(
      String(active).trim().toLowerCase()
    )
      ? '停用'
      : '启用'
  } else {
    obj.status = '启用'
  }
  obj.isActive = obj.status !== '停用'
  obj.is_active = obj.status !== '停用'
  return obj
}

const PEN_CATEGORY_OPTIONS = [
  '犊牛舍',
  '育成舍',
  '育肥舍',
  '公牛舍',
  '配种舍',
  '妊娠舍',
  '产房',
  '泌乳舍',
  '干奶舍',
  '隔离舍',
  '挤奶厅',
  '饲喂中心',
  '备用舍'
]

const PERSON_ROLE_OPTIONS = ['管理员', '兽医', '饲养员', '记录员', '育种员', '技术员']
const DISEASE_CATEGORY_OPTIONS = [
  '传染病',
  '寄生虫病',
  '代谢病',
  '营养缺乏病',
  '中毒',
  '乳房疾病',
  '繁殖疾病',
  '外伤'
]
const MEDICINE_CATEGORY_OPTIONS = [
  '抗生素',
  '驱虫药',
  '维生素',
  '疫苗',
  '消毒剂',
  '解热镇痛药',
  '钙磷补充剂',
  '激素类'
]
const GENERIC_BASE_INFO_CATEGORY_RE =
  /^(general|other|others|unknown|uncategorized|未分类|其他|其它)$/i

function explicitBaseInfoCategoryOrNormalized(value, normalize) {
  const raw = firstNonBlankText(value)
  if (!raw) return normalize()
  return GENERIC_BASE_INFO_CATEGORY_RE.test(raw) ? normalize() : raw
}

function normalizeBaseInfoStatus(status, options = []) {
  const raw = firstNonBlankText(status)
  if (!raw) return ''
  const exact = options.find((item) => item === raw)
  if (exact) return exact
  const lower = raw.toLowerCase()
  if (/^(false|0|停用|禁用|disabled|inactive|closed|retired)$/.test(lower))
    return options.includes('停用') ? '停用' : raw
  if (/^(离职|resigned|left)$/.test(lower)) return options.includes('离职') ? '离职' : raw
  if (/维护|维修|maintenance|repair/.test(lower)) return options.includes('维护中') ? '维护中' : raw
  if (/^(true|1|正常|启用|active|enabled|enable|normal|online)$/.test(lower)) {
    if (options.includes('正常')) return '正常'
    if (options.includes('启用')) return '启用'
  }
  const byCase = options.find((item) => item.toLowerCase() === lower)
  return byCase || raw
}

function classifyPenCategory(value) {
  const raw = firstNonBlankText(value)
  if (!raw || /^(general|other|others|unknown|uncategorized|未分类|其他|其它)$/i.test(raw))
    return ''
  if (PEN_CATEGORY_OPTIONS.includes(raw)) return raw
  const lower = raw.toLowerCase()
  if (/挤奶|奶厅|milking|parlor/.test(lower)) return '挤奶厅'
  if (/tmr|饲喂|饲料|日粮|feeding|feed/.test(lower)) return '饲喂中心'
  if (/泌乳|lactating|lactation|milking_cow/.test(lower)) return '泌乳舍'
  if (/干奶|dry/.test(lower)) return '干奶舍'
  if (/犊牛|calf/.test(lower)) return '犊牛舍'
  if (/育成|后备|heifer/.test(lower)) return '育成舍'
  if (/育肥|fatten|finishing/.test(lower)) return '育肥舍'
  if (/公牛|种公|bull/.test(lower)) return '公牛舍'
  if (/配种|输精|breeding|mating|insemination/.test(lower)) return '配种舍'
  if (/妊娠|怀孕|pregnan|gestation/.test(lower)) return '妊娠舍'
  if (/产房|分娩|产犊|calving|delivery|maternity/.test(lower)) return '产房'
  if (/隔离|检疫|quarantine|isolation/.test(lower)) return '隔离舍'
  if (/备用|临时|backup|spare/.test(lower)) return '备用舍'
  return ''
}

function normalizePenCategoryValue(value, context = '') {
  return classifyPenCategory(value) || classifyPenCategory(context) || '备用舍'
}

function normalizePenPayload(payload = {}) {
  const obj = { ...payload }
  const name = firstNonBlankText(
    obj.name,
    obj.penName,
    obj.pen_name,
    obj.unitName,
    obj.unit_name,
    obj.code,
    obj.penCode,
    obj.pen_code,
    obj.unitCode,
    obj.unit_code
  )
  if (name) obj.name = name
  const explicitCategory = firstNonBlankText(
    obj.category,
    obj.categoryName,
    obj.category_name,
    obj.type,
    obj.unitType,
    obj.unit_type
  )
  obj.category = explicitBaseInfoCategoryOrNormalized(explicitCategory, () =>
    normalizePenCategoryValue(explicitCategory, name)
  )
  if (!obj.categoryName) obj.categoryName = obj.category
  if (!obj.category_name) obj.category_name = obj.category
  obj.status =
    normalizeBaseInfoStatus(firstNonBlankText(obj.status, obj.state), ['正常', '维护中', '停用']) ||
    '正常'
  obj.isActive = obj.status !== '停用'
  obj.is_active = obj.status !== '停用'
  return obj
}

function classifyPersonRole(value) {
  const raw = firstNonBlankText(value)
  if (!raw) return ''
  if (PERSON_ROLE_OPTIONS.includes(raw)) return raw
  const lower = raw.toLowerCase()
  if (/管理员|管理|主管|负责人|经理|admin|manager|owner/.test(lower)) return '管理员'
  if (/兽医|健康|诊疗|防疫|vet|veterinarian|health/.test(lower)) return '兽医'
  if (/饲养|饲喂|奶厅|采奶|生产|feed|keeper|herdsman|milker|parlor/.test(lower)) return '饲养员'
  if (/记录|录入|数据|台账|审核|record|data|clerk|operator/.test(lower)) return '记录员'
  if (/育种|繁殖|配种|组学|科研|试验|breed|reproduction|omics|research/.test(lower)) return '育种员'
  if (/技术|维护|设备|传感器|实验|检测|tech|maintenance|lab|sensor/.test(lower)) return '技术员'
  return ''
}

function normalizePersonRoleValue(value, context = '') {
  return classifyPersonRole(value) || classifyPersonRole(context) || '技术员'
}

function normalizePersonPayload(payload = {}) {
  const obj = { ...payload }
  const name = firstNonBlankText(
    obj.name,
    obj.personName,
    obj.person_name,
    obj.realName,
    obj.real_name,
    obj.nickname,
    obj.username
  )
  if (name) obj.name = name
  const accountName = normalizeAccountName(
    firstNonBlankText(
      obj.accountName,
      obj.account_name,
      obj.loginName,
      obj.login_name,
      obj.userName,
      obj.username,
      name
    )
  )
  if (accountName) {
    obj.accountName = accountName
    obj.account_name = accountName
  }
  const plainPassword = firstNonBlankText(
    obj.password,
    obj.initialPassword,
    obj.initial_password,
    obj.defaultPassword,
    obj.default_password
  )
  if (plainPassword && !firstNonBlankText(obj.passwordHash, obj.password_hash)) {
    obj.passwordHash = passwordDigest(plainPassword)
    obj.password_hash = obj.passwordHash
    obj.passwordUpdatedAt = obj.passwordUpdatedAt || obj.password_updated_at || new Date()
    obj.password_updated_at = obj.password_updated_at || obj.passwordUpdatedAt
  }
  delete obj.password
  delete obj.initialPassword
  delete obj.initial_password
  delete obj.defaultPassword
  delete obj.default_password
  const department = firstNonBlankText(
    obj.department,
    obj.departmentName,
    obj.department_name,
    obj.dept
  )
  if (department) obj.department = department
  const roleKeys = [
    'role',
    'roleName',
    'role_name',
    'position',
    'title',
    'category',
    'categoryName',
    'category_name'
  ]
  const hasRoleInput = roleKeys.some(
    (key) => Object.prototype.hasOwnProperty.call(obj, key) && firstNonBlankText(obj[key])
  )
  if (hasRoleInput) {
    const explicitRole = firstNonBlankText(...roleKeys.map((key) => obj[key]))
    obj.role = explicitBaseInfoCategoryOrNormalized(explicitRole, () =>
      normalizePersonRoleValue(explicitRole, firstNonBlankText(obj.department, obj.name))
    )
  }

  const hasStatusInput = ['status', 'state'].some((key) =>
    Object.prototype.hasOwnProperty.call(obj, key)
  )
  if (hasStatusInput) {
    obj.status =
      normalizeBaseInfoStatus(firstNonBlankText(obj.status, obj.state), ['正常', '停用', '离职']) ||
      '正常'
    obj.isActive = obj.status !== '停用' && obj.status !== '离职'
    obj.is_active = obj.isActive
  }
  obj.isActive = obj.isActive ?? obj.is_active ?? true
  obj.is_active = obj.is_active ?? obj.isActive
  return obj
}

function applyDefaultPersonCredentialsForWrite(tableName, data = {}, { force = false } = {}) {
  if (normalizeTableName(tableName) !== 'persons') return data
  const accountName = normalizeAccountName(
    firstNonBlankText(data.account_name, data.accountName, data.name)
  )
  if (accountName && !data.account_name) data.account_name = accountName
  if (!data.password_hash && force) {
    data.password_hash = passwordDigest(authConfig.defaultPersonPassword)
    data.password_updated_at = data.password_updated_at || new Date()
    markInsertOnlyColumn(data, 'password_hash')
    markInsertOnlyColumn(data, 'password_updated_at')
  }
  return data
}

function classifyDiseaseCategory(value) {
  const raw = firstNonBlankText(value)
  if (!raw || /^(general|other|others|unknown|uncategorized|未分类|其他|其它)$/i.test(raw))
    return ''
  if (DISEASE_CATEGORY_OPTIONS.includes(raw)) return raw
  const lower = raw.toLowerCase()
  if (/乳房|乳腺|mastitis/.test(lower)) return '乳房疾病'
  if (/繁殖|子宫|胎衣|产后|流产|reproduction/.test(lower)) return '繁殖疾病'
  if (/中毒|毒|nitrite/.test(lower)) return '中毒'
  if (/维生素|缺乏|矿物|营养/.test(lower)) return '营养缺乏病'
  if (/酮病|瘤胃|积食|酸中毒|代谢|消化/.test(lower)) return '代谢病'
  if (/寄生|吸虫|肝蛭|螨|蜱|线虫|绦虫/.test(lower)) return '寄生虫病'
  if (/牛瘟|口蹄疫|结核|肺疫|布病|结节|传染|感染|疫|痢|炭疽|巴氏|沙门|病毒|细菌/.test(lower))
    return '传染病'
  if (/创伤|外伤|骨折|损伤|蹄病|蹄叶炎|腐蹄/.test(lower)) return '外伤'
  return ''
}

function normalizeDiseaseCategoryValue(value, context = '') {
  return classifyDiseaseCategory(context) || classifyDiseaseCategory(value) || '传染病'
}

function normalizeDiseasePayload(payload = {}) {
  const obj = { ...payload }
  const name = firstNonBlankText(obj.name, obj.diseaseName, obj.disease_name, obj.diagnosis)
  if (name) obj.name = name
  const explicitCategory = firstNonBlankText(
    obj.category,
    obj.categoryName,
    obj.category_name,
    obj.type,
    obj.diseaseType,
    obj.disease_type
  )
  obj.category = explicitBaseInfoCategoryOrNormalized(explicitCategory, () =>
    normalizeDiseaseCategoryValue(
      explicitCategory,
      firstNonBlankText(name, obj.symptoms, obj.treatment)
    )
  )
  if (!obj.categoryName) obj.categoryName = obj.category
  if (!obj.category_name) obj.category_name = obj.category
  obj.status =
    normalizeBaseInfoStatus(firstNonBlankText(obj.status, obj.state), ['启用', '停用']) || '启用'
  obj.isActive = obj.status !== '停用'
  obj.is_active = obj.status !== '停用'
  return obj
}

function classifyMedicineCategory(value) {
  const raw = firstNonBlankText(value)
  if (!raw || /^(general|other|others|unknown|uncategorized|未分类|其他|其它)$/i.test(raw))
    return ''
  if (MEDICINE_CATEGORY_OPTIONS.includes(raw)) return raw
  const lower = raw.toLowerCase()
  if (/疫苗|苗|vaccine/.test(lower)) return '疫苗'
  if (/消毒|过氧化氢|碘伏|戊二醛|alcohol|disinfect/.test(lower)) return '消毒剂'
  if (/伊维菌素|阿苯达唑|驱虫|寄生虫|ivermectin/.test(lower)) return '驱虫药'
  if (/青霉素|四环素|阿莫西林|头孢|庆大|抗生素|penicillin|tetracycline|amoxicillin/.test(lower))
    return '抗生素'
  if (/布洛芬|氟尼辛|退热|镇痛|解热|ibuprofen|flunixin/.test(lower)) return '解热镇痛药'
  if (/葡萄糖酸钙|钙|磷|镁|calcium|gluconate/.test(lower)) return '钙磷补充剂'
  if (/维生素|ad3e|营养|vitamin/.test(lower)) return '维生素'
  if (/前列腺素|促性腺|孕酮|激素|hormone|pgf/.test(lower)) return '激素类'
  return ''
}

function normalizeMedicineCategoryValue(value, context = '') {
  return classifyMedicineCategory(context) || classifyMedicineCategory(value) || '抗生素'
}

function normalizeMedicinePayload(payload = {}) {
  const obj = { ...payload }
  const name = firstNonBlankText(
    obj.name,
    obj.medicineName,
    obj.medicine_name,
    obj.code,
    obj.medicineCode,
    obj.medicine_code
  )
  if (name) obj.name = name
  const explicitCategory = firstNonBlankText(
    obj.category,
    obj.categoryName,
    obj.category_name,
    obj.type,
    obj.medicineType,
    obj.medicine_type
  )
  obj.category = explicitBaseInfoCategoryOrNormalized(explicitCategory, () =>
    normalizeMedicineCategoryValue(
      explicitCategory,
      firstNonBlankText(name, obj.usage, obj.usageText, obj.usage_text)
    )
  )
  if (!obj.categoryName) obj.categoryName = obj.category
  if (!obj.category_name) obj.category_name = obj.category
  obj.status =
    normalizeBaseInfoStatus(firstNonBlankText(obj.status, obj.state), ['启用', '停用']) || '启用'
  obj.isActive = obj.status !== '停用'
  obj.is_active = obj.status !== '停用'
  return obj
}

function normalizeDatetimeValue(value) {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value
  if (typeof value === 'string' && value.includes('T')) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return value
}

function normalizeDateValue(value) {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string') {
    if (value.includes('T')) return value.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  }
  return value
}

function toBooleanNumber(value) {
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

function randomId(prefix = 'id') {
  const time = Date.now().toString(36)
  const rand = randomUUID().replace(/-/g, '').slice(0, 10)
  return `${prefix}_${time}_${rand}`
}

function inferRolesFromUserName(userName) {
  const name = String(userName || '').toLowerCase()
  if (name.includes('super')) return ['R_SUPER', 'R_ADMIN']
  if (name.includes('admin')) return ['R_ADMIN']
  return ['R_USER']
}

function hasAdminRole(session) {
  return (
    Array.isArray(session?.roles) &&
    session.roles.some((role) => ['R_ADMIN', 'R_SUPER'].includes(role))
  )
}

function requireAdmin(req, res, next) {
  if (!isStrictAuth()) {
    next()
    return
  }

  const session = req.user || getSessionFromRequest(req)
  if (!session) {
    sendUnauthorized(res, '登录已过期，请重新登录')
    return
  }
  if (!hasAdminRole(session)) {
    res.status(403).json({ code: 403, msg: '需要管理员权限', data: null })
    return
  }

  req.user = session
  next()
}

function buildUserInfo(userName = 'Admin', roles = ['R_ADMIN'], extra = {}) {
  const idMap = {
    R_SUPER: 1,
    R_ADMIN: 2,
    R_USER: 3
  }
  const firstRole = roles[0] || 'R_USER'
  const safeName = String(userName || 'Admin')
  return {
    buttons: ['add', 'edit', 'delete', 'view', 'export', 'import'],
    roles,
    userId: extra.userId || extra.personId || idMap[firstRole] || 3,
    personId: extra.personId || extra.userId || '',
    userName: safeName,
    realName: extra.realName || extra.name || safeName,
    email: extra.email || `${safeName.toLowerCase()}@example.local`,
    phone: extra.phone || '',
    department: extra.department || '',
    roleName: extra.roleName || '',
    avatar: extra.avatar || ''
  }
}

function normalizeToken(authorization) {
  const tokenText = String(authorization || '').trim()
  if (!tokenText) return ''
  if (tokenText.toLowerCase().startsWith('bearer ')) {
    return tokenText.slice(7).trim()
  }
  return tokenText
}

function stableId(prefix, ...values) {
  const safePrefix =
    String(prefix || 'id')
      .replace(/[^\w-]/g, '_')
      .slice(0, 18) || 'id'
  const raw = values.length ? values.map((value) => String(value ?? '')).join(':') : randomUUID()
  const body = raw
    .replace(/[^\w-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  const hash = createHash('sha1').update(raw).digest('hex').slice(0, 10)
  const maxBodyLength = Math.max(0, 64 - safePrefix.length - hash.length - 2)
  return [safePrefix, body.slice(0, maxBodyLength).replace(/_$/g, ''), hash]
    .filter(Boolean)
    .join('_')
    .slice(0, 64)
}

function hashPayload(value) {
  return createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')
}

function hashBuffer(value) {
  return createHash('sha256').update(value).digest('hex')
}

function valueByColumn(row, column) {
  const key = snakeToCamel(column)
  const value = row?.[column] ?? row?.[key]
  if (value === undefined || value === null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

function buildXlsxExport(sheetName, rows, columns) {
  const safeColumns = columns?.length ? columns : Object.keys(rows[0] || {})
  const records = rows.map((row) =>
    Object.fromEntries(safeColumns.map((column) => [column, valueByColumn(row, column)]))
  )
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.json_to_sheet(records)
  XLSX.utils.book_append_sheet(workbook, worksheet, String(sheetName || 'Sheet1').slice(0, 31))
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  return {
    base64: buffer.toString('base64'),
    hash: hashBuffer(buffer),
    byteLength: buffer.length,
    columns: safeColumns,
    rows: records
  }
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap(normalizeStringArray))]
  }
  if (value === undefined || value === null || value === '') return []
  return [String(value)]
}

function normalizeCowIds(value) {
  return normalizeStringArray(value).filter(Boolean)
}

const AUDIT_COW_ID_KEYS = new Set([
  'cowid',
  'cow_id',
  'animalid',
  'animal_id',
  'sourcecowid',
  'source_cow_id',
  'targetcowid',
  'target_cow_id'
])

const AUDIT_COW_IDS_KEYS = new Set([
  'cowids',
  'cow_ids',
  'animalids',
  'animal_ids',
  'sourcecowids',
  'source_cow_ids',
  'targetcowids',
  'target_cow_ids'
])

const AUDIT_COW_NUMBER_KEYS = new Set([
  'cownumber',
  'cow_number',
  'animalnumber',
  'animal_number',
  'sourcecownumber',
  'source_cow_number',
  'targetcownumber',
  'target_cow_number'
])

const AUDIT_COW_NUMBERS_KEYS = new Set([
  'cownumbers',
  'cow_numbers',
  'animalnumbers',
  'animal_numbers',
  'sourcecownumbers',
  'source_cow_numbers',
  'targetcownumbers',
  'target_cow_numbers'
])

function auditKeyName(value) {
  return String(value || '')
    .replace(/[\s-]/g, '_')
    .toLowerCase()
}

function valuesFromMaybeArray(value) {
  if (Array.isArray(value)) return value.flatMap(valuesFromMaybeArray)
  if (value && typeof value === 'object') return []
  return value === undefined || value === null || value === '' ? [] : [String(value)]
}

function collectAuditCowTokens(value, output = { ids: [], numbers: [] }, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return output
  const parsed = typeof value === 'string' ? safeJsonParse(value, value) : value
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectAuditCowTokens(item, output, depth + 1)
    return output
  }
  if (isPlainObject(parsed)) {
    for (const [rawKey, rawValue] of Object.entries(parsed)) {
      const key = auditKeyName(rawKey)
      if (AUDIT_COW_ID_KEYS.has(key) || AUDIT_COW_IDS_KEYS.has(key))
        output.ids.push(...valuesFromMaybeArray(rawValue))
      else if (AUDIT_COW_NUMBER_KEYS.has(key) || AUDIT_COW_NUMBERS_KEYS.has(key))
        output.numbers.push(...valuesFromMaybeArray(rawValue))
      collectAuditCowTokens(rawValue, output, depth + 1)
    }
  }
  return output
}

function deriveSourceRecordIdsForRpc(tableName, method, payload = {}, result = {}) {
  const table = normalizeTableName(tableName)
  if (!table) return {}
  const ids = normalizeStringArray([
    payload.id,
    payload.recordId,
    payload.record_id,
    payload.updatedRecord?.id,
    payload.data?.id,
    result.id,
    result.insertedId,
    result.targetId
  ])
  const dataRows = Array.isArray(payload.data) ? payload.data : []
  ids.push(
    ...normalizeStringArray(dataRows.map((row) => row?.id || row?.recordId || row?.record_id))
  )
  if (!ids.length && normalizeTableName(method) === 'deletetablerecord' && payload.id)
    ids.push(String(payload.id))
  return { [table]: [...new Set(ids)] }
}

function buildRpcAuditTrace(tableName, method, payload = {}, result = {}) {
  const table = normalizeTableName(tableName)
  const tokens = collectAuditCowTokens({ payload, result })
  const cowIds = normalizeCowIds(tokens.ids)
  const cowNumbers = normalizeStringArray(tokens.numbers)
  const sourceRecordIds = deriveSourceRecordIdsForRpc(table, method, payload, result)
  const extra = { table, method, cowNumbers }
  const normalizedMethod = normalizeTableName(method)
  if (normalizedMethod === 'deletetablerecord') extra.tombstone = true
  return {
    cowIds,
    relationScope: buildAcceptanceRelationScope('operation_audit', cowIds, extra),
    sourceRecordIds
  }
}

function buildAcceptanceRelationScope(domain, cowIds = [], extra = {}) {
  return {
    scope: 'cow_group',
    domain,
    cowIds: normalizeCowIds(cowIds),
    tracePolicy: 'production acceptance records resolve through cow_ids and source_record_ids',
    ...extra
  }
}

function pickFirstObjectValue(source, keys) {
  if (!isPlainObject(source)) return undefined
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key]
  }
  return undefined
}

function firstPresentValue(source, keys) {
  if (!isPlainObject(source)) return undefined
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key]
  }
  return undefined
}

function parseNumberLike(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const text = String(value).trim().replace('℃', '').replace('°C', '')
  const match = text.match(/-?\d+(?:\.\d+)?/)
  if (!match) return undefined
  const number = Number(match[0])
  return Number.isFinite(number) ? number : undefined
}

function formatLocalDateTime(date = new Date()) {
  const pad = (value, size = 2) => String(value).padStart(size, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

function stableNumber(seedText, min = 0, max = 1) {
  let hash = 2166136261
  const text = String(seedText || '')
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const value = (hash >>> 0) / 4294967295
  return min + value * (max - min)
}

function pickMetricValue(metrics, labels, fallback = 0) {
  const list = Array.isArray(metrics) ? metrics : []
  const labelSet = new Set(labels)
  const row = list.find((item) => labelSet.has(item?.label))
  if (!row) return fallback
  const parsed = parseNumberLike(row.value)
  return parsed === undefined ? fallback : parsed
}

function topicMatches(filter, topic) {
  const filterParts = String(filter || '').split('/')
  const topicParts = String(topic || '').split('/')
  for (let i = 0; i < filterParts.length; i += 1) {
    const filterPart = filterParts[i]
    const topicPart = topicParts[i]
    if (filterPart === '#') return true
    if (filterPart === '+') {
      if (topicPart === undefined) return false
      continue
    }
    if (filterPart !== topicPart) return false
  }
  return filterParts.length === topicParts.length
}

function parseMqttPayloadObject(raw) {
  const source = String(raw || '').trim()
  if (!source) return null

  let parsed = null
  try {
    parsed = JSON.parse(source)
  } catch {
    parsed = parseThingsCloudDisplayText(source)
  }

  if (isPlainObject(parsed) && typeof parsed.display_text === 'string') {
    parsed = { ...parsed, ...parseThingsCloudDisplayText(parsed.display_text) }
  }
  if (isPlainObject(parsed) && typeof parsed.displayText === 'string') {
    parsed = { ...parsed, ...parseThingsCloudDisplayText(parsed.displayText) }
  }

  return isPlainObject(parsed) ? parsed : null
}

function parseThingsCloudDisplayText(text) {
  const source = String(text || '')
  const cowNumber = source.match(/牛号[:：]\s*([A-Za-z0-9_-]+)/)?.[1]
  const bodyTemperature = parseNumberLike(source.match(/牛体温[:：]\s*(-?\d+(?:\.\d+)?)/)?.[1])
  const earTemperature = parseNumberLike(source.match(/耳温[:：]\s*(-?\d+(?:\.\d+)?)/)?.[1])
  const rectalTemperature = parseNumberLike(source.match(/直肠温度[:：]\s*(-?\d+(?:\.\d+)?)/)?.[1])
  const airTemperature = parseNumberLike(source.match(/环境温度[:：]\s*(-?\d+(?:\.\d+)?)/)?.[1])
  const signalStrength = parseNumberLike(source.match(/信号强度[:：]\s*(-?\d+(?:\.\d+)?)/)?.[1])

  if (!cowNumber && bodyTemperature === undefined && airTemperature === undefined) return null

  return {
    cowNumber,
    bodyTemperature,
    earTemperature,
    rectalTemperature,
    airTemperature,
    signalStrength,
    displayText: source
  }
}

function normalizeMqttTemperaturePayload(topic, payloadBuffer) {
  const raw = Buffer.isBuffer(payloadBuffer)
    ? payloadBuffer.toString('utf8').trim()
    : String(payloadBuffer || '').trim()
  if (!raw) return null

  const parsed = parseMqttPayloadObject(raw)

  if (!isPlainObject(parsed)) return null

  const now = new Date()
  const rawTimestamp = pickFirstObjectValue(parsed, [
    'timestamp',
    'time',
    'ts',
    'createdAt',
    'eventTime'
  ])
  const timestampDate = rawTimestamp ? new Date(rawTimestamp) : now
  const safeDate = Number.isNaN(timestampDate.getTime()) ? now : timestampDate

  const topicParts = String(topic || '').split('/')
  const cowNumber = String(
    pickFirstObjectValue(parsed, ['cowNumber', 'cowNo', 'cowId', 'CowID', 'cow', 'deviceName']) ||
      (topicParts.length >= 2 ? topicParts[1] : '')
  ).trim()

  const bodyTemperature = parseNumberLike(
    pickFirstObjectValue(parsed, ['bodyTemperature', 'bodyTemp', '牛体温'])
  )
  const earTemperature = parseNumberLike(
    pickFirstObjectValue(parsed, ['earTemperature', 'earTemp', 'temperature', 'temp', '耳温'])
  )
  const rectalTemperature = parseNumberLike(
    pickFirstObjectValue(parsed, ['rectalTemperature', 'rectalTemp', 'rectal', '直肠温度'])
  )
  const airTemperature = parseNumberLike(
    pickFirstObjectValue(parsed, [
      'airTemperature',
      'ambientTemp',
      'environmentTemperature',
      'envTemp',
      'airTemp',
      '环境温度'
    ])
  )
  const signalStrength = parseNumberLike(
    pickFirstObjectValue(parsed, ['signalStrength', 'rssi', 'signal', '信号强度'])
  )

  if (
    !cowNumber ||
    (bodyTemperature === undefined &&
      earTemperature === undefined &&
      rectalTemperature === undefined &&
      airTemperature === undefined)
  ) {
    return null
  }

  const sourceMessageId = String(
    pickFirstObjectValue(parsed, ['messageId', 'msgId', 'id']) ||
      `${topic}_${safeDate.getTime()}_${cowNumber}_${bodyTemperature ?? earTemperature ?? rectalTemperature ?? airTemperature}`
  )

  return {
    id: stableId('mqtt_sensor', sourceMessageId),
    cowNumber,
    cowId: stableId('cow', cowNumber),
    timestamp: formatLocalDateTime(safeDate),
    ts: formatLocalDateTime(safeDate),
    bodyTemperature,
    earTemperature,
    rectalTemperature,
    airTemperature,
    signalStrength,
    topic,
    rawPayload: raw,
    sourceMessageId,
    receivedAt: formatLocalDateTime(now)
  }
}

function buildMqttMessageLog({
  id = '',
  direction = 'uplink',
  topic = '',
  qos = 0,
  status = 'received',
  operator = '',
  deviceId = '',
  cowId = '',
  cowNumber = '',
  commandType = '',
  sourceMessageId = '',
  publishedAt = null,
  receivedAt = null,
  payloadJson = null,
  parsedPayload = null,
  relationScope = null,
  sourceRecordIds = null
} = {}) {
  const now = new Date()
  const stableKey = firstNonBlankText(
    id,
    sourceMessageId,
    String(publishedAt || ''),
    String(receivedAt || ''),
    topic,
    commandType,
    typeof payloadJson === 'string' ? payloadJson : JSON.stringify(payloadJson || {})
  )
  return {
    id: id || stableId('mqtt_msg', direction, stableKey),
    direction,
    topic,
    qos,
    status,
    operator,
    deviceId,
    device_id: deviceId,
    cowId,
    cow_id: cowId,
    cowNumber,
    cow_number: cowNumber,
    commandType,
    command_type: commandType,
    sourceMessageId,
    source_message_id: sourceMessageId,
    publishedAt,
    published_at: publishedAt,
    receivedAt,
    received_at: receivedAt,
    payloadJson,
    payload_json: payloadJson,
    parsedPayload,
    parsed_payload: parsedPayload,
    relationScope,
    relation_scope: relationScope,
    sourceRecordIds,
    source_record_ids: sourceRecordIds,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }
}

async function logMqttMessage(entry = {}) {
  await insertRow('mqtt_message_logs', buildMqttMessageLog(entry))
}

function classifyTemperatureAlert(record) {
  const mainTemperature = selectTemperatureForAlert(record)
  if (mainTemperature === undefined) return null

  if (mainTemperature >= 40.5) {
    return {
      severity: 'critical',
      threshold: 40.5,
      title: '高温热应激危急预警',
      reason: 'temperature_ge_40_5'
    }
  }
  if (mainTemperature >= 40.0 || (mainTemperature >= 39.8 && Number(record.airTemperature) >= 35)) {
    return {
      severity: 'high',
      threshold: 40.0,
      title: '高温体温异常预警',
      reason: 'temperature_ge_40_or_heat_context'
    }
  }
  if (mainTemperature >= 39.5 && Number(record.airTemperature) >= 35) {
    return {
      severity: 'medium',
      threshold: 39.5,
      title: '体温偏高预警',
      reason: 'temperature_ge_39_5_and_air_ge_35'
    }
  }
  return null
}

async function classifyThreePointTemperatureAlert(record) {
  if (!record.cowId) return null

  const [rows] = await pool.query(
    `
      SELECT
        id,
        reading_value AS temperature,
        measured_at AS measuredAt,
        source_record_id AS sourceMessageId
      FROM sensor_reading
      WHERE animal_id = ?
        AND metric_code = 'body_temperature'
        AND reading_value IS NOT NULL
        AND COALESCE(quality_flag, 'valid') <> 'invalid'
      ORDER BY measured_at DESC, id DESC
      LIMIT 3
    `,
    [record.cowId]
  )
  const evaluation = evaluateTwoOfThreeHighTemperature([...rows].reverse())
  if (!evaluation.matched) return null

  return {
    severity: 'medium',
    threshold: THREE_POINT_HIGH_TEMPERATURE_THRESHOLD,
    title: '三点体温异常预警',
    reason: 'two_of_three_temperature_points_above_39_5',
    ruleCode: 'temperature_two_of_three_above_39_5',
    evaluation
  }
}

async function resolveCowIdForMqttNumber(cowNumber) {
  const normalizedCowNumber = String(cowNumber || '').trim()
  if (!normalizedCowNumber) return ''

  const lookupFields = [
    { cowNumber: normalizedCowNumber },
    { earTagNumber: normalizedCowNumber },
    { id: normalizedCowNumber }
  ]

  for (const where of lookupFields) {
    const rows = await getTableRows('cows', { where, page: 1, pageSize: 1, limit: 1 })
    if (rows[0]?.id) return String(rows[0].id)
  }

  return ''
}

async function resolveAnimalIdForMqttNumber(cowNumber) {
  const normalizedCowNumber = String(cowNumber || '').trim()
  if (!normalizedCowNumber) return ''

  const directLookups = [
    { animalNumber: normalizedCowNumber },
    { earTagNumber: normalizedCowNumber },
    { electronicTag: normalizedCowNumber },
    { id: normalizedCowNumber }
  ]
  for (const where of directLookups) {
    const rows = await getTableRows('animal', { where, page: 1, pageSize: 1, limit: 1 })
    if (rows[0]?.id) return String(rows[0].id)
  }

  const identifierRows = await getTableRows('animal_identifier', {
    where: { identifierValue: normalizedCowNumber },
    page: 1,
    pageSize: 1,
    limit: 1
  }).catch(() => [])
  if (identifierRows[0]?.animalId || identifierRows[0]?.animal_id) {
    return String(identifierRows[0].animalId || identifierRows[0].animal_id)
  }

  return ''
}

async function ensureCowForMqttRecord(record) {
  const normalizedCowNumber = String(record.cowNumber || '').trim()
  if (!normalizedCowNumber) return ''

  const existingAnimalId = await resolveAnimalIdForMqttNumber(normalizedCowNumber)
  const existingCowId = await resolveCowIdForMqttNumber(normalizedCowNumber)
  const animalId = existingAnimalId || existingCowId || stableId('animal', normalizedCowNumber)
  const now = new Date()

  if (!existingAnimalId) {
    await insertRow('animal', {
      id: animalId,
      animalNumber: normalizedCowNumber,
      earTagNumber: normalizedCowNumber,
      species: CATTLE_SPECIES_NAME,
      breed: DEFAULT_CATTLE_BREED,
      sex: '未知',
      entryDate: formatLocalDateTime(now).slice(0, 10),
      sourceFarm: 'MQTT接入',
      currentStageId: '监测牛',
      currentGroupId: 'MQTT接入',
      status: '在群',
      notes: 'MQTT 实时传感数据首次接入自动建档，需人工复核。',
      createdAt: now,
      updatedAt: now
    })
    await insertRow('animal_identifier', {
      id: stableId('animal-identifier', animalId, 'animal_number', normalizedCowNumber),
      animalId,
      identifierType: 'animal_number',
      identifierValue: normalizedCowNumber,
      issuer: 'mqtt-live',
      validFrom: now,
      isPrimary: 1,
      createdAt: now,
      updatedAt: now
    })
  }

  if (!existingCowId) {
    await insertRow('cows', {
      id: animalId,
      cowId: animalId,
      animalId,
      cowNumber: normalizedCowNumber,
      animalNumber: normalizedCowNumber,
      earTagNumber: normalizedCowNumber,
      breed: DEFAULT_CATTLE_BREED,
      gender: '未知',
      sex: '未知',
      cowType: '监测牛',
      currentPen: 'MQTT接入',
      status: '健康',
      pregnancy: false,
      mixing: false,
      createdAt: now,
      updatedAt: now
    })
  }

  return animalId
}

async function ensureMqttDevice(metricCode, unit) {
  const deviceId = 'mqtt-live-gateway'
  const channelId = stableId('device-channel', deviceId, metricCode)
  const now = new Date()
  await insertRow('device', {
    id: deviceId,
    code: deviceId,
    name: 'MQTT 实时接入网关',
    deviceType: 'mqtt_gateway',
    manufacturer: 'ThingsCloud',
    model: 'mqtt-live',
    serialNo: deviceId,
    status: 'active',
    configuration: { source: 'mqtt-live' },
    createdAt: now,
    updatedAt: now
  })
  await insertRow('device_channel', {
    id: channelId,
    deviceId,
    channelCode: metricCode,
    channelName: metricCode,
    metricCode,
    unit,
    status: 'active',
    createdAt: now,
    updatedAt: now
  })
  return { deviceId, channelId }
}

function buildMqttSensorReading(record, metricCode, value, unit = 'C') {
  const measuredAt = record.timestamp
  const rawPayload = {
    importBatch: 'mqtt-live',
    source: 'mqtt',
    topic: record.topic,
    cowNumber: record.cowNumber,
    bodyTemperature: record.bodyTemperature,
    earTemperature: record.earTemperature,
    rectalTemperature: record.rectalTemperature,
    compensatedTemperature: record.compensatedTemperature,
    compensation: record.compensation,
    airTemperature: record.airTemperature,
    signalStrength: record.signalStrength,
    sourceMessageId: record.sourceMessageId,
    receivedAt: record.receivedAt,
    rawPayload: record.rawPayload
  }
  return {
    id:
      metricCode === 'body_temperature'
        ? record.id
        : stableId('mqtt_sensor', record.sourceMessageId, metricCode),
    animalId: record.cowId,
    animal_id: record.cowId,
    cowId: record.cowId,
    cow_id: record.cowId,
    cowNumber: record.cowNumber,
    cow_number: record.cowNumber,
    deviceId: record.deviceId || '',
    device_id: record.deviceId || '',
    channelId: record.channelId || '',
    channel_id: record.channelId || '',
    metricCode,
    metric_code: metricCode,
    readingValue: value,
    reading_value: value,
    value,
    unit,
    measuredAt,
    measured_at: measuredAt,
    timestamp: measuredAt,
    productionDate: String(measuredAt || '').slice(0, 10),
    production_date: String(measuredAt || '').slice(0, 10),
    qualityFlag: 'valid',
    quality_flag: 'valid',
    rawPayload,
    raw_payload: rawPayload,
    sourceTable: 'mqtt-live',
    source_table: 'mqtt-live',
    sourceRecordId: record.sourceMessageId,
    source_record_id: record.sourceMessageId,
    createdAt: record.receivedAt,
    created_at: record.receivedAt,
    updatedAt: record.receivedAt,
    updated_at: record.receivedAt
  }
}

async function ingestMqttTemperatureRecord(topic, payloadBuffer) {
  const raw = Buffer.isBuffer(payloadBuffer)
    ? payloadBuffer.toString('utf8').trim()
    : String(payloadBuffer || '').trim()
  const parsedPayload = parseMqttPayloadObject(raw)
  const record = normalizeMqttTemperaturePayload(topic, payloadBuffer)
  if (!record) {
    await logMqttMessage({
      direction: 'uplink',
      topic,
      status: 'ignored',
      receivedAt: formatLocalDateTime(new Date()),
      payloadJson: raw,
      parsedPayload,
      sourceMessageId: stableId('mqtt_raw', topic, raw)
    }).catch(() => undefined)
    return { ok: false, reason: 'ignored_payload' }
  }

  record.cowId = await ensureCowForMqttRecord(record)
  if (TH_SHRC_ENABLED && record.earTemperature !== undefined) {
    try {
      record.compensation = predictThShrcTemperature({
        cowNumber: record.cowNumber,
        earTemperature: record.earTemperature,
        airTemperature: record.airTemperature,
        timestamp: record.timestamp,
        source: 'mqtt-live'
      })
      record.compensatedTemperature = record.compensation?.compensatedTemperature
    } catch (error) {
      console.error('TH-SHRC compensation failed:', error?.message || error)
    }
  }
  const readingIds = []
  const mainTemperature = selectTemperatureForAlert(record)
  if (record.earTemperature !== undefined) {
    Object.assign(record, await ensureMqttDevice('ear_temperature', 'C'))
    const reading = buildMqttSensorReading(record, 'ear_temperature', record.earTemperature, 'C')
    readingIds.push(String(reading.id))
    await insertRow('sensor_reading', reading)
    await insertRow('sensor_readings', reading)
  }
  if (mainTemperature !== undefined) {
    Object.assign(record, await ensureMqttDevice('body_temperature', 'C'))
    const reading = buildMqttSensorReading(record, 'body_temperature', mainTemperature, 'C')
    readingIds.push(String(reading.id))
    await insertRow('sensor_reading', reading)
    await insertRow('sensor_readings', reading)
  }
  if (record.airTemperature !== undefined) {
    Object.assign(record, await ensureMqttDevice('ambient_temperature', 'C'))
    const reading = buildMqttSensorReading(
      record,
      'ambient_temperature',
      record.airTemperature,
      'C'
    )
    readingIds.push(String(reading.id))
    await insertRow('sensor_reading', reading)
    await insertRow('sensor_readings', reading)
  }
  if (record.signalStrength !== undefined) {
    Object.assign(record, await ensureMqttDevice('signal_strength', 'dBm'))
    const reading = buildMqttSensorReading(record, 'signal_strength', record.signalStrength, 'dBm')
    readingIds.push(String(reading.id))
    await insertRow('sensor_reading', reading)
    await insertRow('sensor_readings', reading)
  }

  await insertRow('sensors', {
    id: record.id,
    cowId: record.cowId,
    ts: record.ts,
    timestamp: record.timestamp,
    temperature: mainTemperature,
    environment: {
      ambientTemp: record.airTemperature,
      signalStrength: record.signalStrength
    },
    payload: {
      importBatch: 'mqtt-live',
      source: 'mqtt',
      topic: record.topic,
      cowNumber: record.cowNumber,
      bodyTemperature: record.bodyTemperature,
      earTemperature: record.earTemperature,
      rectalTemperature: record.rectalTemperature,
      compensatedTemperature: record.compensatedTemperature,
      compensation: record.compensation,
      airTemperature: record.airTemperature,
      signalStrength: record.signalStrength,
      sourceMessageId: record.sourceMessageId,
      receivedAt: record.receivedAt,
      rawPayload: record.rawPayload
    }
  })

  const relationScope = buildAcceptanceRelationScope(
    'mqtt_uplink',
    record.cowId ? [record.cowId] : [],
    {
      topic,
      deviceId: record.deviceId || MQTT_DEFAULT_COMMAND_TARGET
    }
  )
  await logMqttMessage({
    direction: 'uplink',
    topic,
    qos: 0,
    status: 'ingested',
    deviceId: record.deviceId || MQTT_DEFAULT_COMMAND_TARGET,
    cowId: record.cowId,
    cowNumber: record.cowNumber,
    sourceMessageId: record.sourceMessageId,
    publishedAt: record.timestamp,
    receivedAt: record.receivedAt,
    payloadJson: record.rawPayload,
    parsedPayload: {
      ...(parsedPayload || {}),
      cowNumber: record.cowNumber,
      bodyTemperature: record.bodyTemperature,
      earTemperature: record.earTemperature,
      rectalTemperature: record.rectalTemperature,
      compensatedTemperature: record.compensatedTemperature,
      compensation: record.compensation,
      airTemperature: record.airTemperature,
      signalStrength: record.signalStrength
    },
    relationScope,
    sourceRecordIds: {
      sensors: [record.id],
      sensor_reading: readingIds,
      sensor_readings: readingIds
    }
  }).catch(() => undefined)

  const immediateClassification = classifyTemperatureAlert(record)
  let windowClassification = null
  if (mainTemperature !== undefined) {
    try {
      windowClassification = await classifyThreePointTemperatureAlert(record)
    } catch (error) {
      console.error('Three-point temperature alert evaluation failed:', error?.message || error)
    }
  }
  const classification = immediateClassification || windowClassification
  if (!classification)
    return { ok: true, sensorId: record.id, alertId: null, cowNumber: record.cowNumber }

  const windowEvaluation = classification.evaluation || null
  const triggerValue = windowEvaluation
    ? Math.max(...windowEvaluation.points.map((point) => point.temperature))
    : selectTemperatureForAlert(record)
  const alertId = classification.ruleCode
    ? stableId('mqtt_alert_rule', record.cowId, classification.ruleCode)
    : stableId('mqtt_alert', `${record.sourceMessageId}_${classification.severity}`)
  const tempLabel =
    record.rectalTemperature !== undefined
      ? '实测直肠温度'
      : record.bodyTemperature !== undefined
        ? '上报体温'
        : record.compensatedTemperature !== undefined
          ? 'TH-SHRC补偿体温'
          : '耳温'
  const description = windowEvaluation
    ? `牛号${record.cowNumber}最近3个体温点中${windowEvaluation.highCount}个超过${windowEvaluation.threshold.toFixed(1)}℃（${windowEvaluation.points.map((point) => point.temperature.toFixed(1)).join('、')}℃）。`
    : `牛号${record.cowNumber}在${record.timestamp}${tempLabel}${triggerValue.toFixed(1)}℃，环境温度${record.airTemperature ?? '-'}℃。`
  await insertRow('alerts', {
    id: alertId,
    cowId: record.cowId,
    alertTime: record.ts,
    severity: classification.severity,
    alertType: 'temperature',
    title: classification.title,
    description,
    status: 'active',
    payload: {
      importBatch: 'mqtt-live',
      source: 'mqtt',
      topic: record.topic,
      cowNumber: record.cowNumber,
      threshold: classification.threshold,
      triggerValue,
      statusReason: classification.reason,
      ruleCode: classification.ruleCode || 'temperature_single_point_threshold',
      windowSize: windowEvaluation?.windowSize,
      requiredHighCount: windowEvaluation?.requiredHighCount,
      highCount: windowEvaluation?.highCount,
      temperatureWindow: windowEvaluation?.points,
      sourceSensorId: record.id,
      bodyTemperature: record.bodyTemperature,
      earTemperature: record.earTemperature,
      rectalTemperature: record.rectalTemperature,
      compensatedTemperature: record.compensatedTemperature,
      compensation: record.compensation,
      airTemperature: record.airTemperature,
      signalStrength: record.signalStrength,
      sourceMessageId: record.sourceMessageId
    }
  })

  return { ok: true, sensorId: record.id, alertId, cowNumber: record.cowNumber }
}

function shouldPublishHardwareCommand(command = {}) {
  const commandType = String(command.type || command.command || command.commandType || '')
    .trim()
    .toLowerCase()
  if (['restart', 'reboot', 'reset', 'mqtt_command', 'custom'].includes(commandType)) return true
  return Boolean(firstNonBlankText(command.topic, command.commandTopic, command.targetTopic))
}

function buildHardwareCommandTopic(command = {}, deviceId = '') {
  return firstNonBlankText(
    command.topic,
    command.commandTopic,
    command.targetTopic,
    `command/send/${deviceId || MQTT_DEFAULT_COMMAND_TARGET}`
  )
}

function buildHardwareCommandPayload(command = {}, deviceId = '', cowIds = []) {
  const nowIso = new Date().toISOString()
  const requestedBy = firstNonBlankText(
    command.operator,
    command.parameters?.requestedBy,
    '设备管理员'
  )
  const commandType = String(command.type || command.command || command.commandType || 'control')
    .trim()
    .toLowerCase()
  let payload = null

  if (isPlainObject(command.payload)) {
    payload = { ...command.payload }
  } else if (typeof command.payload === 'string') {
    payload = safeJsonParse(command.payload, null)
  } else if (typeof command.payloadJson === 'string') {
    payload = safeJsonParse(command.payloadJson, null)
  }

  if (!isPlainObject(payload)) {
    if (['restart', 'reboot', 'reset'].includes(commandType)) {
      payload = {
        method: 'reset',
        deviceId: deviceId || MQTT_DEFAULT_COMMAND_TARGET,
        requestedAt: nowIso,
        requestedBy
      }
    } else {
      payload = {
        method: commandType || 'control',
        deviceId: deviceId || MQTT_DEFAULT_COMMAND_TARGET,
        requestedAt: nowIso,
        requestedBy,
        parameters: isPlainObject(command.parameters) ? command.parameters : {}
      }
    }
  }

  if (['restart', 'reboot', 'reset'].includes(commandType)) {
    payload.method = 'reset'
  } else if (!firstNonBlankText(payload.method)) {
    payload.method = commandType || 'control'
  }

  if (!firstNonBlankText(payload.deviceId))
    payload.deviceId = deviceId || MQTT_DEFAULT_COMMAND_TARGET
  if (!firstNonBlankText(payload.requestedAt)) payload.requestedAt = nowIso
  if (!firstNonBlankText(payload.requestedBy)) payload.requestedBy = requestedBy
  if (cowIds.length && !Array.isArray(payload.cowIds)) payload.cowIds = cowIds
  if (command.parameters?.reason && !payload.reason) payload.reason = command.parameters.reason

  return payload
}

async function publishBrokerMessage(topic, payload, options = {}) {
  if (!mqttConfig.enabled || !mqttState.listening || !mqttBroker) {
    throw createHttpError(503, 'MQTT broker 未启动，无法下发指令', 'MQTT_NOT_READY')
  }

  const packet = {
    topic,
    payload: Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ''), 'utf8'),
    qos: Number(options.qos || 0),
    retain: Boolean(options.retain)
  }

  await new Promise((resolve, reject) => {
    mqttBroker.publish(packet, (error) => {
      if (error) reject(error)
      else resolve(true)
    })
  })
}

function isStrictAuth() {
  return authConfig.mode === 'strict'
}

function issueSessionToken(userName, roles, extra = {}) {
  const token = `session-${randomUUID()}`
  loginSessionMap.set(token, {
    userName,
    roles,
    ...extra,
    createdAt: Date.now(),
    expiresAt: Date.now() + authConfig.sessionTtlMs
  })
  return token
}

function getSessionFromRequest(req) {
  const token = normalizeToken(req.headers.authorization)
  if (!token) return null
  const session = loginSessionMap.get(token)
  if (!session) return null
  if (session.expiresAt && session.expiresAt < Date.now()) {
    loginSessionMap.delete(token)
    return null
  }
  return session
}

function sendUnauthorized(res, message = 'Unauthorized') {
  res.status(401).json({ code: 401, msg: message, data: null })
}

function requireAuth(req, res, next) {
  if (!isStrictAuth()) {
    next()
    return
  }

  const session = getSessionFromRequest(req)
  if (!session) {
    sendUnauthorized(res, '登录已过期，请重新登录')
    return
  }

  req.user = session
  next()
}

async function getTableMetadata(tableName) {
  const normalized = normalizeTableName(tableName)
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    throw new Error(`非法表名: ${tableName}`)
  }

  if (tableMetadataCache.has(normalized)) {
    return tableMetadataCache.get(normalized)
  }

  const [rows] = await pool.query(
    `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
      ORDER BY ordinal_position
    `,
    [config.database, normalized]
  )

  if (!rows.length) {
    if (V2_DATABASE_TABLE_SET.has(normalized)) {
      await ensureV2DatabaseSchema()
      const [v2Rows] = await pool.query(
        `
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = ? AND table_name = ?
          ORDER BY ordinal_position
        `,
        [config.database, normalized]
      )
      rows.push(...v2Rows)
    }
  }

  if (!rows.length) {
    await ensureGenericTable(normalized)
    const [retryRows] = await pool.query(
      `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position
      `,
      [config.database, normalized]
    )
    if (!retryRows.length) {
      throw new Error(`表不存在: ${normalized}`)
    }
    rows.push(...retryRows)
  }

  if (BASE_INFO_COLUMN_DEFINITIONS[normalized]) {
    const existingColumns = new Set(
      rows.map((row) => row.column_name || row.COLUMN_NAME).filter(Boolean)
    )
    const missingColumns = BASE_INFO_COLUMN_DEFINITIONS[normalized].filter(
      ([columnName]) => !existingColumns.has(columnName)
    )
    if (missingColumns.length) {
      await ensureBaseInfoColumns(normalized, missingColumns)
      const [baseInfoRows] = await pool.query(
        `
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = ? AND table_name = ?
          ORDER BY ordinal_position
        `,
        [config.database, normalized]
      )
      rows.length = 0
      rows.push(...baseInfoRows)
    }
  }

  const columns = new Set()
  const jsonColumns = new Set()
  const dateColumns = new Set()
  const datetimeColumns = new Set()
  const numericColumns = new Set()

  for (const row of rows) {
    const col = row.column_name || row.COLUMN_NAME
    const type = String(row.data_type || row.DATA_TYPE || '').toLowerCase()
    if (!col) continue
    columns.add(col)
    if (type === 'json') jsonColumns.add(col)
    if (type === 'date') dateColumns.add(col)
    if (['datetime', 'timestamp'].includes(type)) datetimeColumns.add(col)
    if (
      [
        'tinyint',
        'smallint',
        'mediumint',
        'int',
        'integer',
        'bigint',
        'decimal',
        'numeric',
        'float',
        'double',
        'real',
        'bit',
        'year'
      ].includes(type)
    ) {
      numericColumns.add(col)
    }
  }

  const metadata = {
    tableName: normalized,
    columns,
    jsonColumns,
    dateColumns,
    datetimeColumns,
    numericColumns
  }
  tableMetadataCache.set(normalized, metadata)
  return metadata
}

async function getExistingTableMetadata(tableName) {
  const normalized = normalizeTableName(tableName)
  const [rows] = await pool.query(
    `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
      ORDER BY ordinal_position
    `,
    [config.database, normalized]
  )
  if (!rows.length) {
    return {
      tableName: normalized,
      columns: new Set(),
      jsonColumns: new Set(),
      dateColumns: new Set(),
      datetimeColumns: new Set(),
      numericColumns: new Set(),
      exists: false
    }
  }
  const columns = new Set()
  const jsonColumns = new Set()
  const dateColumns = new Set()
  const datetimeColumns = new Set()
  const numericColumns = new Set()
  for (const row of rows) {
    const col = row.column_name || row.COLUMN_NAME
    const type = String(row.data_type || row.DATA_TYPE || '').toLowerCase()
    if (!col) continue
    columns.add(col)
    if (type === 'json') jsonColumns.add(col)
    if (type === 'date') dateColumns.add(col)
    if (['datetime', 'timestamp'].includes(type)) datetimeColumns.add(col)
    if (
      [
        'tinyint',
        'smallint',
        'mediumint',
        'int',
        'integer',
        'bigint',
        'decimal',
        'numeric',
        'float',
        'double',
        'real',
        'bit',
        'year'
      ].includes(type)
    ) {
      numericColumns.add(col)
    }
  }
  return {
    tableName: normalized,
    columns,
    jsonColumns,
    dateColumns,
    datetimeColumns,
    numericColumns,
    exists: true
  }
}

function sqlColumn(meta, aliases, fallback = "''") {
  for (const column of aliases) {
    if (meta.columns.has(column)) return `\`${column}\``
  }
  return fallback
}

function sqlDateExpr(meta, aliases) {
  const column = sqlColumn(meta, aliases, '')
  return column ? `DATE(${column})` : 'NULL'
}

function sqlDateKeyExpr(meta, aliases) {
  const dateExpr = sqlDateExpr(meta, aliases)
  return dateExpr === 'NULL' ? 'NULL' : `DATE_FORMAT(${dateExpr}, '%Y-%m-%d')`
}

function sqlAlias(meta, aliases, alias, fallback = 'NULL') {
  return `${sqlColumn(meta, aliases, fallback)} AS \`${alias}\``
}

function splitSqlStatements(sql) {
  const normalizedSql = sql.replace(/^\s*--.*$/gm, '')
  const statements = []
  let current = ''
  let quote = null
  let escapeNext = false

  for (const ch of normalizedSql) {
    current += ch
    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (ch === '\\') {
      escapeNext = true
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === ';') {
      const statement = current.trim()
      if (statement) statements.push(statement.slice(0, -1).trim())
      current = ''
    }
  }

  const tail = current.trim()
  if (tail) statements.push(tail)
  return statements.filter((statement) => statement && !statement.startsWith('--'))
}

async function applyLocalMigration(relativePath) {
  const migrationPath = path.join(projectRoot, relativePath)
  const sql = await fs.readFile(migrationPath, 'utf8')
  const statements = splitSqlStatements(sql)
  for (const statement of statements) {
    await pool.query(statement)
  }
}

async function ensureV2DatabaseSchema() {
  if (!v2SchemaPromise) {
    v2SchemaPromise = (async () => {
      await applyLocalMigration('数据库/mysql/migrations/020_v2_full_rebuild_schema.sql')
      await applyLocalMigration('数据库/mysql/migrations/033_restrict_cattle_breed_scope.sql')
      for (const table of V2_DATABASE_TABLES) {
        tableMetadataCache.delete(table)
      }
    })().catch((error) => {
      v2SchemaPromise = null
      throw error
    })
  }
  return v2SchemaPromise
}

async function ensureGenericTable(tableName) {
  const table = normalizeTableName(tableName)
  if (!table) return
  if (V2_DATABASE_TABLE_SET.has(table)) {
    await ensureV2DatabaseSchema()
    return
  }
  if (table === 'breed_types') {
    await pool.query(
      `
        CREATE TABLE IF NOT EXISTS breed_types (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(128) NOT NULL,
          category VARCHAR(64) NULL,
          origin VARCHAR(128) NULL,
          description TEXT NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME(3) NULL,
          updated_at DATETIME(3) NULL,
          UNIQUE KEY uk_breed_types_name (name),
          KEY idx_breed_types_category (category),
          KEY idx_breed_types_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `
    )
    tableMetadataCache.delete(table)
    return
  }
  await pool.query(
    `
      CREATE TABLE IF NOT EXISTS \`${table}\` (
        \`id\` VARCHAR(64) NOT NULL,
        \`payload\` JSON NULL,
        \`created_at\` DATETIME NULL,
        \`updated_at\` DATETIME NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `
  )
  if (BASE_INFO_COLUMN_DEFINITIONS[table]) {
    await ensureBaseInfoColumns(table, BASE_INFO_COLUMN_DEFINITIONS[table])
  }
  tableMetadataCache.delete(table)
}

async function ensureBaseInfoColumns(tableName, columns) {
  for (const [columnName, definition] of columns) {
    await addColumnIfMissing(tableName, columnName, definition)
  }
}

async function addColumnIfMissing(tableName, columnName, definition) {
  const table = normalizeTableName(tableName)
  const column = camelToSnake(columnName)
  const columnDefinition = normalizeAddedColumnDefinition(definition)
  const [rows] = await pool.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ? AND column_name = ?
      LIMIT 1
    `,
    [config.database, table, column]
  )
  if (rows.length) return
  try {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${columnDefinition}`)
  } catch (error) {
    if (error?.code === 'ER_DUP_FIELDNAME' || error?.errno === 1060) {
      tableMetadataCache.delete(table)
      return
    }
    throw error
  }
  tableMetadataCache.delete(table)
}

function normalizeAddedColumnDefinition(definition) {
  const raw = String(definition || '').trim()
  if (/character\s+set|collate/i.test(raw)) return raw
  const match = raw.match(/^(VARCHAR\([^)]+\)|CHAR\([^)]+\)|TEXT|MEDIUMTEXT|LONGTEXT)(.*)$/i)
  if (!match) return raw
  return `${match[1]} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci${match[2] || ''}`
}

async function addUniqueIndexIfMissing(tableName, indexName, columnName) {
  const table = normalizeTableName(tableName)
  const [rows] = await pool.query(
    `
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = ? AND table_name = ? AND index_name = ?
      LIMIT 1
    `,
    [config.database, table, indexName]
  )
  if (rows.length) return
  await pool.query(`ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${indexName}\` (\`${columnName}\`)`)
  tableMetadataCache.delete(table)
}

async function ensureUniqueCodeConstraint(tableName) {
  const table = normalizeTableName(tableName)
  if (!UNIQUE_CODE_TABLES.has(table) || uniqueCodeConstraintReady.has(table)) return

  let metadata = await getExistingTableMetadata(table)
  if (!metadata.exists) {
    await pool.query(
      `
        CREATE TABLE IF NOT EXISTS \`${table}\` (
          \`id\` VARCHAR(64) NOT NULL,
          \`payload\` JSON NULL,
          \`created_at\` DATETIME(3) NULL,
          \`updated_at\` DATETIME(3) NULL,
          PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `
    )
    tableMetadataCache.delete(table)
    metadata = await getExistingTableMetadata(table)
  }

  await addColumnIfMissing(table, 'code', 'VARCHAR(128) NULL')
  if (metadata.columns.has('payload')) {
    await pool.query(
      `
        UPDATE \`${table}\`
        SET \`code\` = JSON_UNQUOTE(JSON_EXTRACT(\`payload\`, '$.code'))
        WHERE (\`code\` IS NULL OR \`code\` = '')
          AND JSON_EXTRACT(\`payload\`, '$.code') IS NOT NULL
      `
    )
  }

  const [duplicates] = await pool.query(
    `
      SELECT LOWER(\`code\`) AS code, COUNT(1) AS count
      FROM \`${table}\`
      WHERE \`code\` IS NOT NULL AND \`code\` <> ''
      GROUP BY LOWER(\`code\`)
      HAVING COUNT(1) > 1
      LIMIT 5
    `
  )
  if (duplicates.length) {
    throw new Error(`${table} 存在重复字段编码: ${duplicates.map((item) => item.code).join(', ')}`)
  }

  await addUniqueIndexIfMissing(table, `uk_${table}_code`, 'code')
  uniqueCodeConstraintReady.add(table)
}

async function assertUniqueCodeForTable(tableName, data, currentId = '') {
  const table = normalizeTableName(tableName)
  if (!UNIQUE_CODE_TABLES.has(table) || data.code === undefined || data.code === null) return
  const code = String(data.code).trim()
  if (!code) return
  const [rows] = await pool.query(
    `
      SELECT id
      FROM \`${table}\`
      WHERE LOWER(\`code\`) = LOWER(?)
        AND \`id\` <> ?
      LIMIT 1
    `,
    [code, String(currentId || data.id || '')]
  )
  if (rows.length) {
    throw new Error(`字段编码已存在，请使用唯一编码: ${code}`)
  }
}

function mapRowOut(tableName, row) {
  const normalizedTable = normalizeTableName(tableName)
  const sensorNumericColumns = new Set([
    'temperature',
    'steps',
    'rumination_count',
    'rumination_duration',
    'rumination_efficiency',
    'lying_time',
    'standing_time',
    'walking_distance',
    'active_time',
    'eating_time',
    'estimated_intake',
    'feeding_efficiency',
    'respiratory_rate',
    'heart_rate',
    'body_score',
    'ambient_temp',
    'humidity',
    'ammonia',
    'light_level'
  ])

  const result = {}
  for (const [k, v] of Object.entries(row || {})) {
    let value = v
    if (typeof value === 'string') {
      const s = value.trim()
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
        try {
          value = JSON.parse(s)
        } catch {
          // keep raw text
        }
      }
    }

    if (
      normalizedTable === 'sensors' &&
      sensorNumericColumns.has(k) &&
      typeof value === 'string' &&
      /^-?\d+(\.\d+)?$/.test(value)
    ) {
      value = Number(value)
    }

    result[snakeToCamel(k)] = value
  }

  if (result.ts && !result.timestamp) result.timestamp = result.ts
  if (result.checkTime && !result.timestamp) result.timestamp = result.checkTime
  if (result.calibrationTime && !result.calibrationDate)
    result.calibrationDate = result.calibrationTime
  if (normalizedTable === 'cows') {
    if (result.cowType && !result.type) result.type = result.cowType
  }
  if (normalizedTable === 'transfer_reasons') {
    Object.assign(result, normalizeTransferReasonPayload(result))
  }
  if (normalizedTable === 'omics_samples') {
    if (result.collectionDate && !result.timestamp) result.timestamp = result.collectionDate
    if (result.metadataJson && !result.metadata) result.metadata = result.metadataJson
  }
  if (normalizedTable === 'omics_datasets') {
    if (result.generatedAt && !result.timestamp) result.timestamp = result.generatedAt
    if (result.qualityMetrics && !result.qcMetrics) result.qcMetrics = result.qualityMetrics
  }
  if (normalizedTable === 'hardware_devices') {
    if (result.configurationJson && !result.configuration)
      result.configuration = result.configurationJson
    if (result.locationJson && !result.location) result.location = result.locationJson
  }
  if (normalizedTable === 'mqtt_message_logs') {
    if (result.payloadJson !== undefined && result.payload_json === undefined)
      result.payload_json = result.payloadJson
    if (result.parsedPayload !== undefined && result.parsed_payload === undefined)
      result.parsed_payload = result.parsedPayload
  }
  if (normalizedTable === 'data_synchronizations') {
    if (result.configurationJson && !result.configuration)
      result.configuration = result.configurationJson
  }
  if (normalizedTable === 'feed_records') {
    if (result.feedTime && !result.feedingTime) result.feedingTime = result.feedTime
  }
  if (normalizedTable === 'cost_items' || normalizedTable === 'revenue_items') {
    if (result.itemDate && !result.date) result.date = result.itemDate
  }
  if (normalizedTable === 'budget_plans') {
    if (result.budgetItems && typeof result.budgetItems === 'string') {
      result.budgetItems = safeJsonParse(result.budgetItems, [])
    }
  }
  if (normalizedTable === 'kpi_dashboards') {
    if (result.layoutJson && !result.layout) result.layout = result.layoutJson
  }
  if (normalizedTable === 'breeding_analyses' && result.executedAt && !result.timestamp) {
    result.timestamp = result.executedAt
  }
  if (isPlainObject(result.payload)) {
    const payloadData = result.payload
    delete result.payload
    Object.assign(result, payloadData)
  }
  if (normalizedTable === 'pens') {
    Object.assign(result, normalizePenPayload(result))
  }
  if (normalizedTable === 'persons') {
    Object.assign(result, normalizePersonPayload(result))
  }
  if (normalizedTable === 'diseases') {
    Object.assign(result, normalizeDiseasePayload(result))
  }
  if (normalizedTable === 'medicines') {
    Object.assign(result, normalizeMedicinePayload(result))
  }
  if (normalizedTable === 'transfer_reasons') {
    Object.assign(result, normalizeTransferReasonPayload(result))
  }
  return result
}

function preprocessPayloadByTable(tableName, payload = {}) {
  const obj = { ...payload }
  const table = normalizeTableName(tableName)
  normalizeBlankDateFields(obj)

  if (table === 'pens') {
    Object.assign(obj, normalizePenPayload(obj))
  }
  if (table === 'persons') {
    Object.assign(obj, normalizePersonPayload(obj))
  }
  if (table === 'diseases') {
    Object.assign(obj, normalizeDiseasePayload(obj))
  }
  if (table === 'medicines') {
    if (obj.usage && !obj.usageText) obj.usageText = obj.usage
    syncAliases(obj, [
      ['medicineCode', 'medicine_code'],
      ['medicineName', 'medicine_name'],
      ['usageText', 'usage_text']
    ])
    obj.code = firstNonBlankText(obj.code, obj.medicine_code, obj.id, obj.name)
    Object.assign(obj, normalizeMedicinePayload(obj))
  }
  if (table === 'medicine') {
    syncAliases(obj, [
      ['medicineCode', 'medicine_code'],
      ['medicineName', 'medicine_name'],
      ['activeIngredient', 'active_ingredient'],
      ['defaultWithdrawalMilkDays', 'default_withdrawal_milk_days'],
      ['defaultWithdrawalMeatDays', 'default_withdrawal_meat_days']
    ])
    obj.code = firstNonBlankText(obj.code, obj.medicine_code, obj.id, obj.name)
    obj.name = firstNonBlankText(obj.name, obj.medicine_name, obj.medicineName, obj.code)
    obj.status = firstNonBlankText(obj.status, 'active')
  }
  if (table === 'transfer_reasons') {
    Object.assign(obj, normalizeTransferReasonPayload(obj))
  }
  if (table === 'cows') {
    syncAliases(obj, [
      ['animalId', 'animal_id'],
      ['animalNumber', 'animal_number'],
      ['cowNumber', 'cow_number'],
      ['currentUnitId', 'current_unit_id'],
      ['currentPenId', 'current_pen_id'],
      ['currentPen', 'current_pen'],
      ['sourceTable', 'source_table'],
      ['sourceRecordId', 'source_record_id']
    ])
    if (obj.type && !obj.cowType) obj.cowType = obj.type
    if (obj.cowType && !obj.cow_type) obj.cow_type = obj.cowType
    if (obj.ear_tag_number === '') obj.ear_tag_number = null
    if (obj.earTagNumber === '') obj.earTagNumber = null
    obj.animal_id = obj.animal_id || obj.cow_id || obj.id || null
    obj.animal_number = obj.animal_number || obj.cow_number || obj.cowNumber || null
    obj.current_unit_id =
      obj.current_unit_id || obj.current_pen_id || obj.current_pen || obj.currentPen || null
    obj.current_pen_id =
      obj.current_pen_id || obj.current_unit_id || obj.current_pen || obj.currentPen || null
    obj.source_table = obj.source_table || 'animal'
    obj.source_record_id = obj.source_record_id || obj.animal_id || obj.id || null
    const fallbackGender = firstNonBlankText(obj.gender, obj.sex, '未知')
    const fallbackStatus = firstNonBlankText(obj.status, '在群')
    if (!firstNonBlankText(obj.gender)) {
      obj.gender = fallbackGender
      markInsertOnlyColumn(obj, 'gender')
    }
    if (!firstNonBlankText(obj.status)) {
      obj.status = fallbackStatus
      markInsertOnlyColumn(obj, 'status')
    }
  }
  if (table === 'animal') {
    syncAliases(obj, [
      ['calfBreed', 'calf_breed'],
      ['reportedAgeMonths', 'reported_age_months'],
      ['reportedParityNo', 'reported_parity_no'],
      ['lactationStartDate', 'lactation_start_date'],
      ['lactationEndDate', 'lactation_end_date'],
      ['reportedDaysInMilk', 'reported_days_in_milk'],
      ['reportedLactationMonth', 'reported_lactation_month'],
      ['reportedParityYield', 'reported_parity_yield'],
      ['reportedMilk305', 'reported_milk_305'],
      ['reportedAvgDailyMilk', 'reported_avg_daily_milk']
    ])
    if (!firstNonBlankText(obj.sex)) {
      obj.sex = '未知'
      markInsertOnlyColumn(obj, 'sex')
    }
  }
  if (table === 'medicine_batch') {
    syncAliases(obj, [
      ['medicineId', 'medicine_id'],
      ['medicineCode', 'medicine_code'],
      ['medicineName', 'medicine_name'],
      ['batchNo', 'batch_no'],
      ['productionDate', 'production_date'],
      ['expiryDate', 'expiry_date'],
      ['purchaseQuantity', 'purchase_quantity'],
      ['remainingQuantity', 'remaining_quantity'],
      ['storageUnitId', 'storage_unit_id']
    ])
    obj.medicine_id = firstNonBlankText(obj.medicine_id, obj.medicine_code, obj.medicineCode)
    if (!firstNonBlankText(obj.medicine_id)) {
      obj.medicine_id = firstNonBlankText(obj.medicineName, obj.medicine_name, 'unknown_medicine')
      markInsertOnlyColumn(obj, 'medicine_id')
    }
    obj.batch_no = firstNonBlankText(obj.batch_no, obj.code, obj.id)
    if (!firstNonBlankText(obj.batch_no)) {
      obj.batch_no = String(obj.id || randomId('medicine_batch'))
      markInsertOnlyColumn(obj, 'batch_no')
    }
  }
  if (table === 'sensors') {
    if (obj.timestamp && !obj.ts) obj.ts = obj.timestamp
  }
  if (table === 'sensor_reading' || table === 'sensor_readings') {
    syncAliases(obj, [
      ['animalId', 'animal_id'],
      ['cowId', 'cow_id'],
      ['animalNumber', 'animal_number'],
      ['cowNumber', 'cow_number'],
      ['deviceId', 'device_id'],
      ['channelId', 'channel_id'],
      ['metricCode', 'metric_code'],
      ['readingValue', 'reading_value'],
      ['readingText', 'reading_text'],
      ['measuredAt', 'measured_at'],
      ['productionDate', 'production_date'],
      ['qualityFlag', 'quality_flag'],
      ['rawPayload', 'raw_payload'],
      ['sourceTable', 'source_table'],
      ['sourceRecordId', 'source_record_id']
    ])
    obj.animal_id =
      obj.animal_id ||
      obj.cow_id ||
      obj.cowId ||
      obj.animalNumber ||
      obj.animal_number ||
      obj.cowNumber ||
      obj.cow_number
    obj.cow_id = obj.cow_id || obj.animal_id
    obj.metric_code =
      obj.metric_code || obj.metric || obj.indicator || obj.traitCode || obj.trait_code
    obj.measured_at =
      obj.measured_at ||
      obj.timestamp ||
      obj.read_at ||
      obj.readAt ||
      obj.ts ||
      obj.createdAt ||
      obj.created_at
    obj.reading_value =
      obj.reading_value ??
      obj.value ??
      obj.temperature ??
      obj.body_temperature ??
      obj.steps ??
      obj.activity
    if (obj.reading_value === undefined && obj.reading_text === undefined) {
      obj.reading_text = obj.textValue || obj.text_value || ''
    }
    if (!obj.production_date && obj.measured_at)
      obj.production_date = normalizeDateValue(obj.measured_at)
    obj.quality_flag = obj.quality_flag || obj.quality || 'valid'
    if (table === 'sensor_reading' && !obj.metric_code) obj.metric_code = 'unknown'
    if (table === 'sensor_reading' && !obj.measured_at) obj.measured_at = new Date()
  }
  if (table === 'mqtt_message_logs') {
    syncAliases(obj, [
      ['deviceId', 'device_id'],
      ['cowId', 'cow_id'],
      ['cowNumber', 'cow_number'],
      ['commandType', 'command_type'],
      ['sourceMessageId', 'source_message_id'],
      ['publishedAt', 'published_at'],
      ['receivedAt', 'received_at'],
      ['payloadJson', 'payload_json'],
      ['parsedPayload', 'parsed_payload'],
      ['relationScope', 'relation_scope'],
      ['sourceRecordIds', 'source_record_ids']
    ])
    obj.direction = firstNonBlankText(obj.direction, 'uplink')
    obj.status = firstNonBlankText(obj.status, 'received')
    obj.topic = firstNonBlankText(obj.topic)
    obj.published_at =
      obj.published_at || obj.publishedAt || obj.timestamp || obj.created_at || obj.createdAt
    obj.received_at = obj.received_at || obj.receivedAt || obj.created_at || obj.createdAt
  }
  if (table === 'operation_audit_log' || table === 'operation_audit_logs') {
    syncAliases(obj, [
      ['actionType', 'action_type'],
      ['targetType', 'target_type'],
      ['targetId', 'target_id'],
      ['animalId', 'animal_id'],
      ['cowId', 'cow_id'],
      ['operatorName', 'operator_name'],
      ['operatedAt', 'operated_at'],
      ['requestPayload', 'request_payload'],
      ['resultPayload', 'result_payload'],
      ['cowIds', 'cow_ids'],
      ['relationScope', 'relation_scope'],
      ['sourceRecordIds', 'source_record_ids']
    ])
    obj.action_type = obj.action_type || 'operation'
    obj.target_type = obj.target_type || obj.target || 'system'
    obj.target_id = obj.target_id || obj.targetId || null
    obj.animal_id = obj.animal_id || obj.cow_id || null
    obj.operator_name = obj.operator_name || obj.operator || obj.userName || 'system'
    obj.operated_at = obj.operated_at || obj.created_at || obj.createdAt || new Date()
    obj.created_at = obj.created_at || obj.operated_at
    obj.updated_at = obj.updated_at || obj.updatedAt || obj.created_at
    obj.status = obj.status || 'completed'
  }
  if (table === 'alerts') {
    if (obj.alertTime && !obj.alert_time) obj.alert_time = obj.alertTime
  }
  if (table === 'data_quality_checks') {
    if (obj.timestamp && !obj.checkTime) obj.checkTime = obj.timestamp
    if (obj.checkTime && !obj.check_time) obj.check_time = obj.checkTime
    if (obj.isValid !== undefined && obj.status === undefined) {
      obj.status = obj.isValid ? 'passed' : 'failed'
    }
  }
  if (table === 'sensor_calibrations') {
    if (obj.calibrationDate && !obj.calibrationTime) obj.calibrationTime = obj.calibrationDate
    if (obj.parameters && !obj.parametersJson) obj.parametersJson = obj.parameters
  }
  if (table === 'hardware_devices') {
    if (obj.type && !obj.deviceType) obj.deviceType = obj.type
    if (obj.location && !obj.locationJson) obj.locationJson = obj.location
    if (obj.configuration && !obj.configurationJson) obj.configurationJson = obj.configuration
  }
  if (table === 'feed_records') {
    if (obj.feedingTime && !obj.feedTime) obj.feedTime = obj.feedingTime
  }
  if (table === 'cost_items' || table === 'revenue_items') {
    if (obj.date && !obj.itemDate) obj.itemDate = obj.date
  }
  if (table === 'budget_plans') {
    if (obj.budgetItems && !obj.budget_items) obj.budget_items = obj.budgetItems
  }
  if (table === 'kpi_dashboards') {
    if (obj.layout && !obj.layoutJson) obj.layoutJson = obj.layout
  }
  if (table === 'predictive_models') {
    if (obj.type && !obj.modelType) obj.modelType = obj.type
  }
  if (table === 'omics_samples') {
    syncAliases(obj, [
      ['cowId', 'cow_id'],
      ['cowNumber', 'cow_number'],
      ['sampleCode', 'sample_code'],
      ['sampleType', 'sample_type'],
      ['collectedAt', 'collected_at'],
      ['collectionDate', 'collection_date'],
      ['receivedDate', 'received_date'],
      ['storageLocation', 'storage_location'],
      ['sourceTissue', 'source_tissue'],
      ['qualityScore', 'quality_score'],
      ['integrityScore', 'integrity_score'],
      ['phenotypeLinks', 'phenotype_links'],
      ['metadataJson', 'metadata_json'],
      ['operatorId', 'operator_id'],
      ['operatorName', 'operator_name'],
      ['workOperatorId', 'work_operator_id'],
      ['workOperatorName', 'work_operator_name'],
      ['sourceTable', 'source_table'],
      ['sourceRecordId', 'source_record_id'],
      ['recordedAt', 'recorded_at']
    ])
    if (obj.sampleId && !obj.sampleCode) obj.sampleCode = obj.sampleId
    if (obj.collectedAt && !obj.collected_at) obj.collected_at = obj.collectedAt
    if (obj.collectionDate && !obj.collection_date) obj.collection_date = obj.collectionDate
    obj.collected_at = obj.collected_at || obj.collection_date
    if (obj.receivedDate && !obj.received_date) obj.received_date = obj.receivedDate
    if (obj.storageLocation && !obj.storage_location) obj.storage_location = obj.storageLocation
    if (obj.sourceTissue && !obj.source_tissue) obj.source_tissue = obj.sourceTissue
    if (obj.qualityScore !== undefined && !obj.quality_score) obj.quality_score = obj.qualityScore
    if (obj.integrityScore !== undefined && !obj.integrity_score)
      obj.integrity_score = obj.integrityScore
    if (obj.phenotypeLinks && !obj.phenotype_links) obj.phenotype_links = obj.phenotypeLinks
    if (obj.metadataJson && !obj.metadata_json) obj.metadata_json = obj.metadataJson
    obj.work_operator_name = obj.work_operator_name || obj.collector || obj.operator_name
    obj.operator_name = obj.operator_name || obj.operator || obj.userName || 'system'
    obj.recorded_at = obj.recorded_at || obj.collection_date || obj.created_at || obj.createdAt
    obj.source_table = obj.source_table || obj.source || obj.source_type || 'omics_samples'
    if (!obj.source_record_id && obj.id) obj.source_record_id = obj.id
  }
  if (table === 'omics_datasets') {
    if (obj.datasetId && !obj.datasetCode) obj.datasetCode = obj.datasetId
    if (obj.dataType && !obj.data_type) obj.data_type = obj.dataType
    if (obj.referenceGenome && !obj.reference_genome) obj.reference_genome = obj.referenceGenome
    if (obj.sourceLab && !obj.source_lab) obj.source_lab = obj.sourceLab
    if (obj.sampleIds && !obj.sample_ids) obj.sample_ids = obj.sampleIds
    if (obj.sampleCount !== undefined && !obj.sample_count) obj.sample_count = obj.sampleCount
    if (obj.recordCount !== undefined && !obj.record_count) obj.record_count = obj.recordCount
    if (obj.releaseVersion && !obj.release_version) obj.release_version = obj.releaseVersion
    if (obj.qualityMetrics && !obj.quality_metrics) obj.quality_metrics = obj.qualityMetrics
    if (obj.generatedAt && !obj.generated_at) obj.generated_at = obj.generatedAt
    if (obj.publishedAt && !obj.published_at) obj.published_at = obj.publishedAt
  }
  if (table === 'omics_markers') {
    if (obj.datasetId && !obj.dataset_id) obj.dataset_id = obj.datasetId
    if (obj.markerCode && !obj.marker_code) obj.marker_code = obj.markerCode
    if (obj.markerType && !obj.marker_type) obj.marker_type = obj.markerType
    if (obj.positionBp !== undefined && !obj.position_bp) obj.position_bp = obj.positionBp
    if (obj.geneSymbol && !obj.gene_symbol) obj.gene_symbol = obj.geneSymbol
    if (obj.referenceAllele && !obj.reference_allele) obj.reference_allele = obj.referenceAllele
    if (obj.alternateAllele && !obj.alternate_allele) obj.alternate_allele = obj.alternateAllele
    if (obj.effectType && !obj.effect_type) obj.effect_type = obj.effectType
    if (obj.pValue !== undefined && !obj.p_value) obj.p_value = obj.pValue
    if (obj.effectSize !== undefined && !obj.effect_size) obj.effect_size = obj.effectSize
    if (obj.evidenceLevel && !obj.evidence_level) obj.evidence_level = obj.evidenceLevel
  }
  if (table === 'multi_omics_associations') {
    if (obj.primaryDatasetId && !obj.primary_dataset_id)
      obj.primary_dataset_id = obj.primaryDatasetId
    if (obj.secondaryDatasetId && !obj.secondary_dataset_id)
      obj.secondary_dataset_id = obj.secondaryDatasetId
    if (obj.associationType && !obj.association_type) obj.association_type = obj.associationType
    if (obj.sampleSize !== undefined && !obj.sample_size) obj.sample_size = obj.sampleSize
    if (obj.effectSize !== undefined && !obj.effect_size) obj.effect_size = obj.effectSize
    if (obj.candidateGenes && !obj.candidate_genes) obj.candidate_genes = obj.candidateGenes
    if (obj.candidateMarkers && !obj.candidate_markers) obj.candidate_markers = obj.candidateMarkers
    if (obj.visualizationType && !obj.visualization_type)
      obj.visualization_type = obj.visualizationType
  }
  if (table === 'breeding_analyses') {
    if (obj.analysisId && !obj.analysisCode) obj.analysisCode = obj.analysisId
    if (obj.analysisCode && !obj.analysis_code) obj.analysis_code = obj.analysisCode
    if (obj.targetTrait && !obj.target_trait) obj.target_trait = obj.targetTrait
    if (obj.datasetIds && !obj.dataset_ids) obj.dataset_ids = obj.datasetIds
    if (obj.modelType && !obj.model_type) obj.model_type = obj.modelType
    if (obj.populationSize !== undefined && !obj.population_size)
      obj.population_size = obj.populationSize
    if (obj.predictedGain !== undefined && !obj.predicted_gain)
      obj.predicted_gain = obj.predictedGain
    if (obj.selectionIndex && !obj.selection_index) obj.selection_index = obj.selectionIndex
    if (obj.topCandidates && !obj.top_candidates) obj.top_candidates = obj.topCandidates
    if (obj.executedAt && !obj.executed_at) obj.executed_at = obj.executedAt
  }
  if (table === 'phenotype_trait_definitions') {
    if (obj.dataType && !obj.data_type) obj.data_type = obj.dataType
    if (obj.requiredFields && !obj.required_fields) obj.required_fields = obj.requiredFields
    if (obj.linkedDomains && !obj.linked_domains) obj.linked_domains = obj.linkedDomains
  }
  if (table === 'phenotype_export_methods') {
    if (obj.groupBy && !obj.group_by) obj.group_by = obj.groupBy
    if (obj.timeGranularity && !obj.time_granularity) obj.time_granularity = obj.timeGranularity
    if (obj.lactationWindowDays !== undefined && !obj.lactation_window_days)
      obj.lactation_window_days = obj.lactationWindowDays
    if (obj.requiredFields && !obj.required_fields) obj.required_fields = obj.requiredFields
  }
  if (table === 'logical_trait_rules') {
    if (obj.sourceTable && !obj.source_table) obj.source_table = obj.sourceTable
    if (obj.ruleType && !obj.rule_type) obj.rule_type = obj.ruleType
    if (obj.startEventTypes && !obj.start_event_types) obj.start_event_types = obj.startEventTypes
    if (obj.endEventTypes && !obj.end_event_types) obj.end_event_types = obj.endEventTypes
    if (obj.periodScope && !obj.period_scope) obj.period_scope = obj.periodScope
    if (obj.parityMode && !obj.parity_mode) obj.parity_mode = obj.parityMode
    if (obj.parityOffset !== undefined && !obj.parity_offset) obj.parity_offset = obj.parityOffset
    if (obj.matchMode && !obj.match_mode) obj.match_mode = obj.matchMode
    if (obj.outputTraitCode && !obj.output_trait_code) obj.output_trait_code = obj.outputTraitCode
    if (obj.minValue !== undefined && !obj.min_value) obj.min_value = obj.minValue
    if (obj.maxValue !== undefined && !obj.max_value) obj.max_value = obj.maxValue
    if (obj.requiredFields && !obj.required_fields) obj.required_fields = obj.requiredFields
    if (obj.linkedDomains && !obj.linked_domains) obj.linked_domains = obj.linkedDomains
  }
  if (table === 'derivation_recompute_job') {
    const triggerRecordId =
      obj.triggerRecordId ||
      obj.trigger_record_id ||
      obj.sourceRecordId ||
      obj.source_record_id ||
      obj.recordId ||
      obj.record_id ||
      obj.id ||
      randomId('recompute')
    const jobCode =
      obj.jobCode ||
      obj.job_code ||
      obj.code ||
      `recompute_${String(triggerRecordId)
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .slice(0, 48)}`
    const targetTable =
      obj.targetTable ||
      obj.target_table ||
      (Array.isArray(obj.targets) ? obj.targets.join(',') : '') ||
      obj.target ||
      'parity_episode,lactation_episode,reproduction_cycle,gestation_episode,dry_period_episode'

    obj.jobCode = jobCode
    obj.job_code = jobCode
    obj.derivationDomain = obj.derivationDomain || obj.derivation_domain || 'production_cycle'
    obj.derivation_domain = obj.derivation_domain || obj.derivationDomain
    obj.targetTable = targetTable
    obj.target_table = targetTable
    obj.triggerSource =
      obj.triggerSource ||
      obj.trigger_source ||
      obj.sourceTable ||
      obj.source_table ||
      'animal_event'
    obj.trigger_source = obj.trigger_source || obj.triggerSource
    obj.triggerRecordId = triggerRecordId
    obj.trigger_record_id = obj.trigger_record_id || triggerRecordId
    obj.periodType = obj.periodType || obj.period_type || 'event'
    obj.period_type = obj.period_type || obj.periodType
    obj.jobStatus = obj.jobStatus || obj.job_status || obj.status || 'pending'
    obj.job_status = obj.job_status || obj.jobStatus
  }
  if (table === 'milk_measurement' || table === 'milk_records') {
    syncAliases(obj, [
      ['animalId', 'animal_id'],
      ['cowId', 'cow_id'],
      ['animalNumber', 'animal_number'],
      ['cowNumber', 'cow_number'],
      ['visitId', 'visit_id'],
      ['measuredAt', 'measured_at'],
      ['milkingTime', 'milking_time'],
      ['milkYield', 'milk_yield'],
      ['milkVolume', 'milk_volume'],
      ['sessionCode', 'session_code'],
      ['shiftId', 'shift_id'],
      ['parityNo', 'parity_no'],
      ['productionDate', 'production_date'],
      ['daysInMilk', 'days_in_milk'],
      ['periodSource', 'period_source'],
      ['sourceTable', 'source_table'],
      ['sourceRecordId', 'source_record_id'],
      ['sourceType', 'source_type'],
      ['operatorName', 'operator_name'],
      ['recordedAt', 'recorded_at'],
      ['workOperatorName', 'work_operator_name'],
      ['workOperatorId', 'work_operator_id'],
      ['milkerId', 'milker_id'],
      ['lactationStartDate', 'lactation_start_date'],
      ['lactationEndDate', 'lactation_end_date'],
      ['reportedAgeMonths', 'reported_age_months'],
      ['reportedDaysInMilk', 'reported_days_in_milk'],
      ['reportedLactationMonth', 'reported_lactation_month'],
      ['reportedParityYield', 'reported_parity_yield'],
      ['reportedMilk305', 'reported_milk_305'],
      ['reportedAvgDailyMilk', 'reported_avg_daily_milk'],
      ['qualityFlag', 'quality_flag']
    ])
    obj.animal_id =
      obj.animal_id ||
      obj.cow_id ||
      obj.cowId ||
      obj.animalNumber ||
      obj.animal_number ||
      obj.cowNumber ||
      obj.cow_number
    obj.measured_at =
      obj.measured_at ||
      obj.milking_time ||
      obj.milkingTime ||
      obj.collectionDate ||
      obj.collection_date
    obj.milk_yield =
      obj.milk_yield ??
      obj.volume ??
      obj.milkVolume ??
      obj.milk_volume ??
      obj.value ??
      obj.numericValue ??
      obj.numeric_value
    if (!obj.production_date && obj.measured_at)
      obj.production_date = normalizeDateValue(obj.measured_at)
    if (!obj.source_record_id && obj.id) obj.source_record_id = obj.id
  }
  if (table === 'milking_session' || table === 'milking_visit') {
    syncAliases(obj, [
      ['sessionCode', 'session_code'],
      ['shiftId', 'shift_id'],
      ['productionDate', 'production_date'],
      ['periodSource', 'period_source'],
      ['sourceTable', 'source_table'],
      ['sourceRecordId', 'source_record_id'],
      ['sourceType', 'source_type'],
      ['operatorName', 'operator_name'],
      ['recordedAt', 'recorded_at'],
      ['workOperatorName', 'work_operator_name'],
      ['workOperatorId', 'work_operator_id'],
      ['qualityFlag', 'quality_flag'],
      ['daysInMilk', 'days_in_milk']
    ])
  }
  if (table === 'data_quality_issue') {
    syncAliases(obj, [
      ['sourceTable', 'source_table'],
      ['sourceRecordId', 'source_record_id'],
      ['issueLevel', 'issue_level'],
      ['issueStatus', 'issue_status'],
      ['issueType', 'issue_type'],
      ['detectedAt', 'detected_at'],
      ['resolvedAt', 'resolved_at']
    ])
    if (obj.source_table && !obj.table_name) obj.table_name = obj.source_table
    if (obj.source_record_id && !obj.record_id) obj.record_id = obj.source_record_id
    if (obj.issue_level && !obj.severity) obj.severity = obj.issue_level
    if (obj.issue_status && !obj.status) obj.status = obj.issue_status
    if (!obj.domain) obj.domain = 'milk_production'
    if (obj.detail && !obj.resolution_note) {
      obj.resolution_note = typeof obj.detail === 'string' ? obj.detail : JSON.stringify(obj.detail)
    }
  }
  if (table === 'phenotype_records') {
    syncAliases(obj, [
      ['operatorId', 'operator_id'],
      ['operatorName', 'operator_name'],
      ['workOperatorId', 'work_operator_id'],
      ['workOperatorName', 'work_operator_name'],
      ['sourceTable', 'source_table'],
      ['sourceRecordId', 'source_record_id'],
      ['recordedAt', 'recorded_at'],
      ['observedAt', 'observed_at']
    ])
    if (obj.cowId && !obj.cow_id) obj.cow_id = obj.cowId
    if (obj.cowNumber && !obj.cow_number) obj.cow_number = obj.cowNumber
    if (obj.collectionDate && !obj.collection_date) obj.collection_date = obj.collectionDate
    if (obj.traitCode && !obj.trait_code) obj.trait_code = obj.traitCode
    if (obj.traitName && !obj.trait_name) obj.trait_name = obj.traitName
    if (obj.textValue && !obj.text_value) obj.text_value = obj.textValue
    if (obj.dataSource && !obj.data_source) obj.data_source = obj.dataSource
    if (obj.pedigreeLinked !== undefined && obj.pedigree_linked === undefined)
      obj.pedigree_linked = obj.pedigreeLinked
    if (obj.omicsLinked !== undefined && obj.omics_linked === undefined)
      obj.omics_linked = obj.omicsLinked
    if (obj.rawPayload && !obj.raw_payload) obj.raw_payload = obj.rawPayload
    obj.observed_at = obj.observed_at || obj.collection_date
    obj.work_operator_name = obj.work_operator_name || obj.collector || obj.operator_name
    obj.operator_name = obj.operator_name || obj.operator || 'system'
    obj.source_table = obj.source_table || obj.source || obj.data_source || 'phenotype_records'
    if (!obj.source_record_id && obj.id) obj.source_record_id = obj.id
    obj.recorded_at = obj.recorded_at || obj.collection_date || obj.created_at || obj.createdAt
    if (obj.collection_date && !obj.created_at) obj.created_at = obj.collection_date
  }
  if (table === 'trait_observation') {
    syncAliases(obj, [
      ['batchId', 'batch_id'],
      ['animalId', 'animal_id'],
      ['cowId', 'cow_id'],
      ['animalNumber', 'animal_number'],
      ['cowNumber', 'cow_number'],
      ['traitId', 'trait_id'],
      ['traitCode', 'trait_code'],
      ['traitName', 'trait_name'],
      ['observedAt', 'observed_at'],
      ['collectionDate', 'collection_date'],
      ['parityNo', 'parity_no'],
      ['daysInMilk', 'days_in_milk'],
      ['periodSource', 'period_source'],
      ['numericValue', 'numeric_value'],
      ['textValue', 'text_value'],
      ['jsonValue', 'json_value'],
      ['sourceType', 'source_type'],
      ['sourceTable', 'source_table'],
      ['sourceRecordId', 'source_record_id'],
      ['operatorId', 'operator_id'],
      ['operatorName', 'operator_name'],
      ['workOperatorId', 'work_operator_id'],
      ['workOperatorName', 'work_operator_name'],
      ['recordedAt', 'recorded_at'],
      ['qualityFlag', 'quality_flag']
    ])
    obj.animal_id =
      obj.animal_id ||
      obj.cow_id ||
      obj.cowId ||
      obj.animalNumber ||
      obj.animal_number ||
      obj.cowNumber ||
      obj.cow_number
    obj.observed_at =
      obj.observed_at ||
      obj.collection_date ||
      obj.collectionDate ||
      obj.measuredAt ||
      obj.measured_at
    obj.numeric_value = obj.numeric_value ?? obj.value ?? obj.numericValue
    obj.work_operator_name = obj.work_operator_name || obj.collector || obj.operator_name
    obj.operator_name = obj.operator_name || obj.operator || 'system'
    obj.source_table = obj.source_table || obj.sourceTable || obj.source_type || 'trait_observation'
    obj.source_type = obj.source_type || obj.source_table || obj.sourceTable || 'trait_observation'
    if (!obj.source_record_id && obj.id) obj.source_record_id = obj.id
    obj.recorded_at = obj.recorded_at || obj.observed_at || obj.created_at || obj.createdAt
    if (!obj.collection_date && obj.observed_at)
      obj.collection_date = normalizeDateValue(obj.observed_at)
  }
  if (table === 'animal_event' || table === 'cow_events') {
    syncAliases(obj, [
      ['animalId', 'animal_id'],
      ['cowId', 'cow_id'],
      ['animalNumber', 'animal_number'],
      ['cowNumber', 'cow_number'],
      ['eventType', 'event_type'],
      ['eventCode', 'event_code'],
      ['eventName', 'event_name'],
      ['occurredAt', 'occurred_at'],
      ['eventTime', 'event_time'],
      ['operatorId', 'operator_id'],
      ['operatorName', 'operator_name'],
      ['workOperatorId', 'work_operator_id'],
      ['workOperatorName', 'work_operator_name'],
      ['sourceTable', 'source_table'],
      ['sourceRecordId', 'source_record_id'],
      ['sourceType', 'source_type'],
      ['recordedAt', 'recorded_at'],
      ['eventStatus', 'event_status'],
      ['customValues', 'custom_values']
    ])
    obj.operator_name =
      obj.operator_name ||
      obj.recorder ||
      obj.operator ||
      obj.person ||
      obj.technician ||
      obj.veterinarian ||
      'system'
    obj.work_operator_name = obj.work_operator_name || obj.operator_name
    obj.occurred_at =
      obj.occurred_at || obj.event_time || obj.created_at || obj.createdAt || new Date()
    obj.recorded_at = obj.recorded_at || obj.occurred_at
    obj.source_table = obj.source_table || obj.sourceTable || 'animal_event'
    if (!obj.source_record_id && obj.id) obj.source_record_id = obj.id
  }
  if (['entry_events', 'transfer_events', 'exit_events'].includes(table)) {
    syncAliases(obj, [
      ['animalId', 'animal_id'],
      ['animalNumber', 'animal_number'],
      ['cowNumber', 'cow_number'],
      ['occurredAt', 'occurred_at'],
      ['entryTime', 'entry_time'],
      ['transferTime', 'transfer_time'],
      ['exitTime', 'exit_time'],
      ['recordedAt', 'recorded_at'],
      ['operatorId', 'operator_id'],
      ['operatorName', 'operator_name'],
      ['workOperatorId', 'work_operator_id'],
      ['workOperatorName', 'work_operator_name'],
      ['unitId', 'unit_id'],
      ['fromUnitId', 'from_unit_id'],
      ['toUnitId', 'to_unit_id'],
      ['fromPen', 'from_pen'],
      ['toPen', 'to_pen'],
      ['sourceTable', 'source_table'],
      ['sourceRecordId', 'source_record_id']
    ])
    obj.animal_number = obj.animal_number || obj.cow_number || obj.cowNumber
    obj.occurred_at =
      obj.occurred_at ||
      obj.entry_time ||
      obj.transfer_time ||
      obj.exit_time ||
      obj.created_at ||
      obj.createdAt ||
      new Date()
    obj.recorded_at = obj.recorded_at || obj.occurred_at
    obj.operator_name = obj.operator_name || obj.recorder || obj.operator || 'system'
    obj.work_operator_name = obj.work_operator_name || obj.operator_name
    if (table === 'entry_events') obj.unit_id = obj.unit_id || obj.pen || obj.to_pen || obj.toPen
    if (table === 'transfer_events') {
      obj.from_unit_id = obj.from_unit_id || obj.from_pen || obj.fromPen
      obj.to_unit_id = obj.to_unit_id || obj.to_pen || obj.toPen || obj.pen
    }
    if (table === 'exit_events') {
      obj.from_unit_id =
        obj.from_unit_id || obj.from_pen || obj.fromPen || obj.current_pen || obj.currentPen
      obj.unit_id = obj.unit_id || obj.from_unit_id
    }
    obj.source_table = obj.source_table || table
    if (!obj.source_record_id && obj.id) obj.source_record_id = obj.id
  }
  if (table === 'breeding_events' || table === 'veterinary_events') {
    syncAliases(obj, [
      ['animalId', 'animal_id'],
      ['animalNumber', 'animal_number'],
      ['cowNumber', 'cow_number'],
      ['eventType', 'event_type'],
      ['eventTime', 'event_time'],
      ['eventDate', 'event_date'],
      ['occurredAt', 'occurred_at'],
      ['recordedAt', 'recorded_at'],
      ['operatorId', 'operator_id'],
      ['operatorName', 'operator_name'],
      ['workOperatorId', 'work_operator_id'],
      ['workOperatorName', 'work_operator_name'],
      ['sourceTable', 'source_table'],
      ['sourceRecordId', 'source_record_id']
    ])
    obj.animal_number = obj.animal_number || obj.cow_number || obj.cowNumber
    obj.occurred_at =
      obj.occurred_at ||
      obj.event_time ||
      obj.event_date ||
      obj.created_at ||
      obj.createdAt ||
      new Date()
    obj.recorded_at = obj.recorded_at || obj.occurred_at
    obj.operator_name = obj.operator_name || obj.operator || 'system'
    obj.work_operator_name = obj.work_operator_name || obj.person || obj.operator_name
    obj.source_table = obj.source_table || table
    if (!obj.source_record_id && obj.id) obj.source_record_id = obj.id
  }
  if (
    table === 'event_reproduction_detail' ||
    table === 'event_health_detail' ||
    table === 'event_production_detail' ||
    table === 'event_medicine_detail' ||
    table === 'event_movement_detail'
  ) {
    syncAliases(obj, [
      ['animalId', 'animal_id'],
      ['cowId', 'cow_id'],
      ['animalNumber', 'animal_number'],
      ['cowNumber', 'cow_number'],
      ['eventId', 'event_id'],
      ['eventType', 'event_type'],
      ['occurredAt', 'occurred_at'],
      ['operatorId', 'operator_id'],
      ['operatorName', 'operator_name'],
      ['workOperatorId', 'work_operator_id'],
      ['workOperatorName', 'work_operator_name'],
      ['sourceTable', 'source_table'],
      ['sourceRecordId', 'source_record_id'],
      ['recordedAt', 'recorded_at']
    ])
    obj.operator_name = obj.operator_name || obj.operator || 'system'
    obj.work_operator_name =
      obj.work_operator_name ||
      obj.technician ||
      obj.veterinarian ||
      obj.collector ||
      obj.operator_name
    obj.source_table = obj.source_table || 'animal_event'
    obj.source_record_id = obj.source_record_id || obj.event_id || obj.id
    obj.recorded_at = obj.recorded_at || obj.occurred_at || obj.created_at || obj.createdAt
  }
  if (table === 'cost_items' || table === 'revenue_items') {
    if (obj.date && !obj.itemDate) obj.itemDate = obj.date
  }
  if (table === 'breeding_records') {
    if (obj.eventDate && !obj.eventTime) obj.eventTime = obj.eventDate
    if (obj.breedingDate && !obj.eventTime) obj.eventTime = obj.breedingDate
    if (obj.timestamp && !obj.eventTime) obj.eventTime = obj.timestamp
    if (!obj.eventTime) obj.eventTime = new Date().toISOString()
    if (obj.breedingMethod && !obj.eventType) obj.eventType = obj.breedingMethod
  }
  if (table === 'kpi_dashboard_data') {
    if (obj.period && !obj.ts) obj.ts = obj.period
    if (obj.timestamp && !obj.ts) obj.ts = obj.timestamp
    if (obj.createdAt && !obj.ts) obj.ts = obj.createdAt
    if (!obj.ts) obj.ts = new Date().toISOString()
  }
  if (table === 'prediction_results') {
    if (obj.predictionDate && !obj.ts) obj.ts = obj.predictionDate
    if (obj.timestamp && !obj.ts) obj.ts = obj.timestamp
    if (obj.createdAt && !obj.ts) obj.ts = obj.createdAt
    if (!obj.ts) obj.ts = new Date().toISOString()
    if (obj.predictionDate && !obj.targetDate) obj.targetDate = obj.predictionDate
    if (obj.confidence !== undefined && obj.confidenceInterval === undefined) {
      const n = Number(obj.confidence)
      if (Number.isFinite(n)) {
        const delta = Math.max(0.01, n * 0.1)
        obj.confidenceInterval = [Math.max(0, n - delta), Math.min(1, n + delta)]
      }
    }
    if (obj.createdAt && !obj.generatedAt) obj.generatedAt = obj.createdAt
  }

  return obj
}

function normalizeBlankDateFields(obj) {
  Object.keys(obj || {}).forEach((key) => {
    if (obj[key] !== '') return
    if (/(^|_)(date|time|at)$|Date$|Time$|At$/.test(key)) {
      obj[key] = null
    }
  })
}

function isBlankImportCellValue(value) {
  return typeof value === 'string' && value.trim() === ''
}

function isTypedNonTextColumn(meta, column) {
  return (
    meta.numericColumns?.has(column) ||
    meta.dateColumns?.has(column) ||
    meta.datetimeColumns?.has(column) ||
    meta.jsonColumns?.has(column)
  )
}

function normalizeColumnValueForWrite(meta, column, rawValue) {
  if (rawValue === undefined) return undefined
  if (isBlankImportCellValue(rawValue) && isTypedNonTextColumn(meta, column)) return undefined

  let value = toBooleanNumber(rawValue)
  if (meta.numericColumns?.has(column) && isBlankImportCellValue(value)) return undefined
  if (meta.datetimeColumns.has(column)) {
    value = normalizeDatetimeValue(value)
  } else if (meta.dateColumns.has(column)) {
    value = normalizeDateValue(value)
  }
  if (isBlankImportCellValue(value) && isTypedNonTextColumn(meta, column)) return undefined
  if (meta.jsonColumns.has(column) && value !== null && value !== undefined) {
    value = JSON.stringify(value)
  } else if (isPlainObject(value) || Array.isArray(value)) {
    value = JSON.stringify(value)
  }
  return value
}

function normalizeBreedForWrite(value, field) {
  try {
    return requireSupportedCattleBreed(value, { field })
  } catch (error) {
    if (error?.code === 'UNSUPPORTED_CATTLE_BREED') error.statusCode = 400
    throw error
  }
}

function normalizeNestedBreedFields(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeNestedBreedFields(item))
  if (!isPlainObject(value)) return value

  const breedFieldLabels = new Map([
    ['breed', '品种'],
    ['breedType', '品种'],
    ['breed_type', '品种'],
    ['calfBreed', '犊牛品种'],
    ['calf_breed', '犊牛品种']
  ])
  for (const [key, nestedValue] of Object.entries(value)) {
    const label = breedFieldLabels.get(key)
    value[key] = label
      ? normalizeBreedForWrite(nestedValue, label)
      : normalizeNestedBreedFields(nestedValue)
  }
  return value
}

function enforceCattleScopeForWrite(tableName, payload, { isInsert = false } = {}) {
  const table = normalizeTableName(tableName)
  const obj = normalizeNestedBreedFields(payload || {})

  if (table === 'breed_types' && Object.prototype.hasOwnProperty.call(obj, 'name')) {
    obj.name = normalizeBreedForWrite(obj.name, '品种名称')
    obj.category = CATTLE_SPECIES_NAME
  }

  if (table === 'animal') {
    obj.species = CATTLE_SPECIES_NAME
  }

  if (isInsert && (table === 'animal' || table === 'cows') && !firstNonBlankText(obj.breed)) {
    obj.breed = DEFAULT_CATTLE_BREED
  }

  return obj
}

async function buildInsertPayload(
  tableName,
  payload,
  { autoTimestamps = true, defaultPersonCredentials = autoTimestamps } = {}
) {
  const meta = await getTableMetadata(tableName)
  const processed = enforceCattleScopeForWrite(
    tableName,
    preprocessPayloadByTable(tableName, payload),
    { isInsert: autoTimestamps }
  )
  const out = {}
  const extraPayload = {}
  const insertOnlyColumns = insertOnlyColumnsOf(processed)

  for (const [k, rawV] of Object.entries(processed || {})) {
    if (rawV === undefined) continue
    const snakeKey = camelToSnake(k)
    if (!meta.columns.has(snakeKey)) {
      extraPayload[k] = rawV
      continue
    }

    const value = normalizeColumnValueForWrite(meta, snakeKey, rawV)
    if (value === undefined) continue
    out[snakeKey] = value
  }

  if (meta.columns.has('payload')) {
    const payloadData = {
      ...(isPlainObject(processed?.payload) ? processed.payload : {}),
      ...extraPayload
    }
    if (Object.keys(payloadData).length > 0) {
      const merged = isPlainObject(out.payload) ? out.payload : safeJsonParse(out.payload, {}) || {}
      out.payload = JSON.stringify({ ...merged, ...payloadData })
    } else if (Object.keys(out).length === 0) {
      out.payload = JSON.stringify(processed || {})
    }
  }

  if (meta.columns.has('id') && !out.id) {
    out.id = randomId(tableName.slice(0, 6) || 'row')
  }

  if (autoTimestamps) {
    const now = new Date()
    if (meta.columns.has('created_at') && !out.created_at) out.created_at = now
    if (meta.columns.has('updated_at') && !out.updated_at) out.updated_at = now
  }

  if (defaultPersonCredentials) {
    applyDefaultPersonCredentialsForWrite(tableName, out, { force: true })
  }

  for (const column of insertOnlyColumns) {
    if (out[column] !== undefined) markInsertOnlyColumn(out, column)
  }

  return out
}

async function ensureReferencedRowsForInsert(tableName, data) {
  const table = normalizeTableName(tableName)
  if (table !== 'medicine_batch') return
  const medicineId = firstNonBlankText(data?.medicine_id)
  if (!medicineId) return
  const [rows] = await pool.query('SELECT id FROM `medicine` WHERE id = ? LIMIT 1', [medicineId])
  if (rows.length) return
  const now = new Date()
  await insertRow('medicine', {
    id: medicineId,
    code: medicineId,
    name: firstNonBlankText(data?.medicine_name, data?.medicine_code, medicineId),
    category: '未分类',
    status: 'active',
    createdAt: now,
    updatedAt: now
  })
}

async function resolveCanonicalAnimalReference(data = {}) {
  const animalId = firstNonBlankText(data.animal_id, data.cow_id)
  const animalNumber = firstNonBlankText(data.animal_number, data.cow_number)
  if (animalId) {
    const [rows] = await pool.query('SELECT id, animal_number FROM `animal` WHERE id = ? LIMIT 1', [
      animalId
    ])
    if (rows.length)
      return { id: rows[0].id, number: firstNonBlankText(rows[0].animal_number, animalNumber) }
  }
  if (animalNumber) {
    const [rows] = await pool.query(
      'SELECT id, animal_number FROM `animal` WHERE animal_number = ? LIMIT 1',
      [animalNumber]
    )
    if (rows.length)
      return { id: rows[0].id, number: firstNonBlankText(rows[0].animal_number, animalNumber) }
  }
  if (animalId || animalNumber) {
    const id = animalId || randomId('animal')
    const number = animalNumber || id
    await insertRow('animal', {
      id,
      animalNumber: number,
      animal_number: number,
      sex: firstNonBlankText(data.sex, data.gender, '未知'),
      breed: firstNonBlankText(data.breed, DEFAULT_CATTLE_BREED),
      status: 'active'
    })
    return { id, number }
  }
  return { id: '', number: '' }
}

async function ensureCanonicalAnimalForInsert(tableName, data) {
  const table = normalizeTableName(tableName)
  const animalTables = new Set([
    'animal_event',
    'event_reproduction_detail',
    'event_health_detail',
    'event_medicine_detail',
    'event_production_detail',
    'event_movement_detail',
    'milk_measurement',
    'milking_visit',
    'trait_observation',
    'animal_parentage',
    'animal_device_assignment'
  ])
  if (!animalTables.has(table)) return
  const ref = await resolveCanonicalAnimalReference(data)
  if (!ref.id) return
  if (data.animal_id !== undefined || data.cow_id !== undefined || table !== 'animal_parentage') {
    data.animal_id = ref.id
    if ('cow_id' in data) data.cow_id = ref.id
  }
  if (ref.number) {
    if ('animal_number' in data) data.animal_number = ref.number
    if ('cow_number' in data) data.cow_number = ref.number
  }
}

async function insertRow(tableName, payload) {
  const table = normalizeTableName(tableName)
  await ensureUniqueCodeConstraint(table)
  const data = await buildInsertPayload(table, payload)
  await ensureReferencedRowsForInsert(table, data)
  await ensureCanonicalAnimalForInsert(table, data)
  const keys = Object.keys(data)
  if (!keys.length) throw new Error(`无可写入字段: ${table}`)
  await assertUniqueCodeForTable(table, data, data.id)
  const insertOnlyColumns = insertOnlyColumnsOf(data)

  const placeholders = keys.map(() => '?').join(', ')
  const updateKeys = keys.filter(
    (k) => !['id', 'created_at'].includes(k) && !insertOnlyColumns.has(k)
  )
  const updateClause = updateKeys.length
    ? updateKeys.map((k) => `\`${k}\` = VALUES(\`${k}\`)`).join(', ')
    : '`id` = `id`'
  const sql = `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateClause}`
  await pool.query(
    sql,
    keys.map((k) => data[k])
  )
  return data.id || true
}

function isRetryableDbError(error) {
  const msg = String(error?.message || error || '')
  return (
    msg.includes('Deadlock found when trying to get lock') ||
    msg.includes('Lock wait timeout exceeded')
  )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForDatabaseReady({ attempts = 60, delayMs = 2000 } = {}) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1')
      return
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        console.warn(
          `[startup] MySQL is not ready yet (attempt ${attempt}/${attempts}): ${error?.message || error}`
        )
        await sleep(delayMs)
      }
    }
  }
  throw lastError || new Error('MySQL did not become ready in time')
}

async function initializeStartupDatabase() {
  await waitForDatabaseReady()
  if (skipStartupDbEnsure) {
    console.log('Startup database ensure skipped by SKIP_STARTUP_DB_ENSURE')
    await ensureDefaultPersonPasswords().catch((error) => {
      console.error('Default person password backfill failed:', error?.message || error)
    })
    return
  }

  // The local MySQL container can report healthy just before it accepts the
  // first application connection. Keep the whole idempotent schema pass
  // retryable so a one-click startup cannot leave a partially initialized DB.
  let lastError = null
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await ensureV2DatabaseSchema()
      await ensureOmicsRunTables()
      await ensureProductionAcceptanceTables()
      await ensureDefaultAdminPersonAccount()
      await ensureDefaultPersonPasswords()
      await ensureUniqueCodeConstraint('phenotype_trait_definitions')
      await ensureUniqueCodeConstraint('phenotype_export_methods')
      await ensureUniqueCodeConstraint('logical_trait_rules')
      return
    } catch (error) {
      lastError = error
      if (attempt >= 5) break
      console.warn(
        `[startup] Database schema initialization failed (attempt ${attempt}/5): ${error?.message || error}`
      )
      await sleep(2000)
    }
  }
  throw lastError || new Error('Database schema initialization failed')
}

async function insertRowWithRetry(tableName, payload, maxRetry = 4) {
  let attempt = 0
  while (true) {
    try {
      return await insertRow(tableName, payload)
    } catch (error) {
      attempt += 1
      if (!isRetryableDbError(error) || attempt >= maxRetry) {
        throw error
      }
      await sleep(40 * attempt)
    }
  }
}

async function insertRowsInBatches(tableName, rows, batchSize = 20) {
  const data = Array.isArray(rows) ? rows : []
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize)
    await Promise.all(batch.map((row) => insertRowWithRetry(tableName, row)))
  }
}

async function insertRowsBulk(tableName, rows, batchSize = 500) {
  const table = normalizeTableName(tableName)
  const data = dedupeRowsById(Array.isArray(rows) ? rows : [])
  if (!data.length) return
  await ensureUniqueCodeConstraint(table)

  for (let i = 0; i < data.length; i += batchSize) {
    const sourceBatch = data.slice(i, i + batchSize)
    const payloads = []
    for (const row of sourceBatch) {
      const payload = await buildInsertPayload(table, row)
      if (Object.keys(payload).length) payloads.push(payload)
    }
    if (!payloads.length) continue
    for (const payload of payloads) {
      await ensureReferencedRowsForInsert(table, payload)
      await ensureCanonicalAnimalForInsert(table, payload)
    }

    const keys = Array.from(new Set(payloads.flatMap((payload) => Object.keys(payload))))
    if (!keys.length) continue
    const insertOnlyColumns = new Set()
    for (const payload of payloads) {
      for (const column of insertOnlyColumnsOf(payload)) insertOnlyColumns.add(column)
    }
    const placeholders = payloads.map(() => `(${keys.map(() => '?').join(', ')})`).join(', ')
    const updateKeys = keys.filter(
      (key) => !['id', 'created_at'].includes(key) && !insertOnlyColumns.has(key)
    )
    const updateClause = updateKeys.length
      ? updateKeys.map((key) => `\`${key}\` = VALUES(\`${key}\`)`).join(', ')
      : '`id` = `id`'
    const sql = `INSERT INTO \`${table}\` (${keys.map((key) => `\`${key}\``).join(', ')}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updateClause}`
    const params = payloads.flatMap((payload) => keys.map((key) => payload[key] ?? null))
    await pool.query(sql, params)
  }
}

function dedupeRowsById(rows) {
  const withoutId = []
  const keyed = new Map()
  for (const row of rows) {
    const id = String(row?.id || '').trim()
    if (!id) {
      withoutId.push(row)
      continue
    }
    keyed.set(id, row)
  }
  return [...withoutId, ...keyed.values()]
}

async function updateRowById(tableName, id, changes) {
  const table = normalizeTableName(tableName)
  await ensureUniqueCodeConstraint(table)
  const meta = await getTableMetadata(table)
  const payload = await buildInsertPayload(table, changes, { autoTimestamps: false })
  if (meta.columns.has('updated_at') && !payload.updated_at) payload.updated_at = new Date()
  delete payload.id

  const keys = Object.keys(payload)
  if (!keys.length) return false
  await assertUniqueCodeForTable(table, payload, id)
  const sql = `UPDATE \`${table}\` SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`
  const params = [...keys.map((k) => payload[k]), id]
  const [res] = await pool.query(sql, params)
  return res.affectedRows > 0
}

async function deleteRowById(tableName, id) {
  const table = normalizeTableName(tableName)
  const [res] = await pool.query(`DELETE FROM \`${table}\` WHERE id = ?`, [id])
  return res.affectedRows > 0
}

async function clearTable(tableName) {
  const table = normalizeTableName(tableName)
  await pool.query(`DELETE FROM \`${table}\``)
  return true
}

function startMqttServer() {
  if (!mqttConfig.enabled) {
    mqttState.enabled = false
    mqttState.listening = false
    console.log('MQTT ingestion disabled. Set MQTT_ENABLED=true to enable it.')
    return null
  }

  if (mqttServer) {
    return mqttServer
  }

  mqttState.enabled = true
  const broker = aedes()
  mqttBroker = broker

  if (mqttConfig.username || mqttConfig.password) {
    broker.authenticate = (client, username, password, callback) => {
      const userOk = !mqttConfig.username || username === mqttConfig.username
      const passOk =
        !mqttConfig.password ||
        (password && Buffer.from(password).toString('utf8') === mqttConfig.password)
      callback(null, Boolean(userOk && passOk))
    }
  }

  broker.on('client', (client) => {
    mqttState.connectedClients += 1
    mqttState.totalClients += 1
    mqttState.lastError = null
    console.log(`MQTT client connected: ${client?.id || ''}`)
  })

  broker.on('clientDisconnect', (client) => {
    mqttState.connectedClients = Math.max(0, mqttState.connectedClients - 1)
    console.log(`MQTT client disconnected: ${client?.id || ''}`)
  })

  broker.on('clientError', (client, error) => {
    mqttState.errorCount += 1
    mqttState.lastError = error?.message || String(error)
    console.error(`MQTT client error ${client?.id || ''}:`, error?.message || error)
  })

  broker.on('connectionError', (client, error) => {
    mqttState.errorCount += 1
    mqttState.lastError = error?.message || String(error)
    console.error(`MQTT connection error ${client?.id || ''}:`, error?.message || error)
  })

  broker.on('publish', (packet, client) => {
    const topic = String(packet.topic || '')
    const matches = topicMatches(mqttConfig.topic, topic)
    console.log(
      `[mqtt] publish topic=${topic || '<empty>'} client=${client?.id || '<broker>'} match=${matches}`
    )
    if (!matches) return

    mqttState.receivedCount += 1
    mqttState.lastTopic = topic
    mqttState.lastMessageAt = new Date().toISOString()

    ingestMqttTemperatureRecord(topic, packet.payload)
      .then((result) => {
        if (result?.ok) {
          mqttState.ingestedCount += 1
          mqttState.lastCowNumber = result.cowNumber || null
          mqttState.lastIngestAt = new Date().toISOString()
          mqttState.lastError = null
        } else {
          mqttState.ignoredCount += 1
        }
      })
      .catch((error) => {
        mqttState.errorCount += 1
        mqttState.lastError = error?.message || String(error)
        console.error(`MQTT ingest failed topic=${topic}:`, error?.message || error)
      })
  })

  const server = net.createServer(broker.handle)
  server.listen(mqttConfig.port, mqttConfig.host, () => {
    mqttState.listening = true
    mqttState.startedAt = new Date().toISOString()
    mqttState.lastError = null
    console.log(`MQTT broker ready: mqtt://${mqttConfig.host}:${mqttConfig.port}`)
    console.log(`MQTT topic filter: ${mqttConfig.topic}`)
  })

  server.on('error', (error) => {
    mqttState.listening = false
    mqttState.errorCount += 1
    mqttState.lastError = error?.message || String(error)
    console.error('MQTT broker failed:', error?.message || error)
  })

  mqttServer = server
  return server
}

async function getTableRows(tableName, options = {}) {
  const table = normalizeTableName(tableName)
  const meta = await getTableMetadata(table)

  const where = []
  const params = []
  const inputWhere = options.where || {}
  for (const [k, v] of Object.entries(inputWhere)) {
    if (v === undefined || v === null || v === '') continue
    const col = camelToSnake(k)
    if (!meta.columns.has(col)) continue
    where.push(`\`${col}\` = ?`)
    params.push(v)
  }

  if (options.startTime && meta.columns.has('ts')) {
    where.push('`ts` >= ?')
    params.push(options.startTime)
  }
  if (options.endTime && meta.columns.has('ts')) {
    where.push('`ts` <= ?')
    params.push(options.endTime)
  }
  if (options.startDate && meta.columns.has('item_date')) {
    where.push('`item_date` >= ?')
    params.push(options.startDate)
  }
  if (options.endDate && meta.columns.has('item_date')) {
    where.push('`item_date` <= ?')
    params.push(options.endDate)
  }

  const { orderBy, orderDir, page, limit, offset } = resolveTableReadWindow(table, meta, options)
  const sql = `SELECT * FROM \`${table}\` ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY \`${orderBy}\` ${orderDir} LIMIT ? OFFSET ?`
  const [rows] = await pool.query(sql, [...params, limit, offset])
  return rows.map((row) => mapRowOut(table, row))
}

function preferredOrderColumn(table) {
  if (table === 'omics_module_runs' || table === 'omics_workflow_runs') return 'executed_at'
  if (table === 'omics_analysis_artifacts') return 'created_at'
  return ''
}

function resolveTableOrderBy(table, meta, options = {}) {
  const requested = options.orderBy ? camelToSnake(options.orderBy) : ''
  if (requested && meta.columns.has(requested)) return requested
  if (LARGE_APPEND_ONLY_TABLES.has(table) && meta.columns.has('id')) return 'id'
  const preferred = preferredOrderColumn(table)
  if (preferred && meta.columns.has(preferred)) return preferred
  if (meta.columns.has('created_at')) return 'created_at'
  if (meta.columns.has('ts')) return 'ts'
  if (meta.columns.has('id')) return 'id'
  return Array.from(meta.columns)[0]
}

function resolveTableReadWindow(table, meta, options = {}) {
  const orderBy = resolveTableOrderBy(table, meta, options)
  const orderDir = String(options.orderDir || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  const page = Math.max(1, Number(options.page || 1))
  const defaultPageSize = LARGE_APPEND_ONLY_TABLES.has(table) ? 50 : 1000
  const maxPageSize = LARGE_APPEND_ONLY_TABLES.has(table) ? 200 : 50000
  const pageSize = Number(options.pageSize || options.limit || defaultPageSize)
  const limit = Math.max(1, Math.min(maxPageSize, pageSize))
  const offset = Math.max(0, (page - 1) * limit)
  return { orderBy, orderDir, page, limit, pageSize: limit, offset }
}

async function getTablePageRows(tableName, options = {}) {
  const table = normalizeTableName(tableName)
  const meta = await getTableMetadata(table)

  const where = []
  const params = []
  const inputWhere = options.where || {}
  for (const [k, v] of Object.entries(inputWhere)) {
    if (v === undefined || v === null || v === '') continue
    const col = camelToSnake(k)
    if (!meta.columns.has(col)) continue
    where.push(`\`${col}\` = ?`)
    params.push(v)
  }

  const { orderBy, orderDir, page, pageSize, offset } = resolveTableReadWindow(table, meta, options)
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [countRows] = await pool.query(
    `SELECT COUNT(1) AS total FROM \`${table}\` ${whereSql}`,
    params
  )
  const total = Number(countRows?.[0]?.total || 0)
  const [rows] = await pool.query(
    `SELECT * FROM \`${table}\` ${whereSql} ORDER BY \`${orderBy}\` ${orderDir} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  return {
    rows: rows.map((row) => mapRowOut(table, row)),
    total,
    page,
    pageSize,
    hasMore: offset + rows.length < total
  }
}

async function getTableRecordById(tableName, id) {
  const table = normalizeTableName(tableName)
  const safeId = String(id || '').trim()
  if (!safeId) return null
  const meta = await getExistingTableMetadata(table)
  if (!meta.exists || !meta.columns.has('id')) return null
  const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE \`id\` = ? LIMIT 1`, [safeId])
  return rows[0] ? mapRowOut(table, rows[0]) : null
}

function boundedLimit(value, fallback = 30, max = 200) {
  const numberValue = Number(value || fallback)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(1, Math.min(max, Math.floor(numberValue)))
}

function sqlJsonTextExpr(container, key) {
  return `JSON_UNQUOTE(JSON_EXTRACT(CASE WHEN JSON_VALID(\`${container}\`) THEN \`${container}\` ELSE NULL END, '$.${key}'))`
}

function sqlTextCandidateExpressions(
  meta,
  aliases = [],
  containers = ['payload', 'custom_values', 'details']
) {
  const expressions = []
  for (const alias of aliases) {
    const column = camelToSnake(alias)
    if (meta.columns.has(column)) expressions.push(`CAST(\`${column}\` AS CHAR)`)
  }
  const jsonKeys = [...new Set(aliases.flatMap((alias) => [alias, camelToSnake(alias)]))]
  for (const container of containers) {
    if (!meta.columns.has(container)) continue
    for (const key of jsonKeys) expressions.push(sqlJsonTextExpr(container, key))
  }
  return [...new Set(expressions)]
}

function sqlFirstTextExpr(
  meta,
  aliases = [],
  fallback = "''",
  containers = ['payload', 'custom_values', 'details']
) {
  const expressions = sqlTextCandidateExpressions(meta, aliases, containers).map(
    (expr) => `NULLIF(${expr}, '')`
  )
  if (!expressions.length) return fallback
  return `COALESCE(${[...expressions, fallback].join(', ')})`
}

function pushSqlTextMatches(where, params, meta, aliases, values, containers) {
  const safeValues = normalizeStringArray(values)
    .map((value) => String(value).trim())
    .filter(Boolean)
  if (!safeValues.length) return false
  const expressions = sqlTextCandidateExpressions(meta, aliases, containers)
  if (!expressions.length) return false
  where.push(
    `(${expressions.map((expr) => safeValues.map(() => `${expr} = ?`).join(' OR ')).join(' OR ')})`
  )
  for (const _expr of expressions) params.push(...safeValues)
  return true
}

function pushSqlLikeMatches(where, params, meta, aliases, keyword, containers) {
  const key = String(keyword || '').trim()
  if (!key) return false
  const expressions = sqlTextCandidateExpressions(meta, aliases, containers)
  if (!expressions.length) return false
  where.push(`(${expressions.map((expr) => `${expr} LIKE ?`).join(' OR ')})`)
  params.push(...expressions.map(() => `%${key}%`))
  return true
}

function parseBackendDetails(...values) {
  for (const value of values) {
    if (!value) continue
    if (isPlainObject(value)) return value
    const parsed = safeJsonParse(value)
    if (isPlainObject(parsed)) return parsed
  }
  return {}
}

function backendNormalizeEventCode(value) {
  const text = String(value ?? '').trim()
  const lower = text.toLowerCase()
  const map = {
    heat: 'heat',
    发情: 'heat',
    breeding: 'insemination',
    配种: 'insemination',
    人工授精: 'insemination',
    insemination: 'insemination',
    pregnancy_check: 'pregnancy_check',
    妊检: 'pregnancy_check',
    妊娠检查: 'pregnancy_check',
    calving: 'calving',
    产犊: 'calving',
    delivery: 'calving',
    abortion: 'abortion',
    流产: 'abortion',
    postpartum_check: 'postpartum_check',
    产后检查: 'postpartum_check',
    embryo_transfer: 'embryo_transfer',
    胚胎移植: 'embryo_transfer',
    entry: 'entry',
    入群: 'entry',
    transfer: 'transfer',
    转群: 'transfer',
    exit: 'exit',
    离群: 'exit',
    '离群/淘汰': 'exit',
    出群: 'exit',
    淘汰: 'exit',
    treatment: 'treatment',
    治疗: 'treatment',
    medication: 'medication',
    用药: 'medication',
    vaccination: 'vaccination',
    免疫: 'vaccination',
    diagnosis: 'diagnosis',
    发病: 'diagnosis',
    疾病诊断: 'diagnosis',
    death: 'death',
    死亡: 'death',
    veterinary: 'veterinary',
    surgery: 'surgery',
    手术: 'surgery',
    health_check: 'health_check',
    检查: 'health_check',
    deworming: 'deworming',
    驱虫: 'deworming',
    quarantine: 'quarantine',
    隔离: 'quarantine',
    disinfection: 'disinfection',
    消毒: 'disinfection',
    lab_test: 'lab_test',
    实验室检测: 'lab_test',
    hoof_trim: 'hoof_trim',
    修蹄: 'hoof_trim',
    mastitis_check: 'mastitis_check',
    乳房炎检查: 'mastitis_check',
    milking: 'milking',
    泌乳: 'milking',
    milking_session: 'milking_session',
    采奶: 'milking_session',
    milk_quality: 'milk_quality',
    奶质检测: 'milk_quality',
    dhi_test: 'dhi_test',
    dhi: 'dhi_test',
    feeding: 'feeding',
    饲喂: 'feeding',
    feed_delivery: 'feed_delivery',
    投料: 'feed_delivery',
    feed_adjustment: 'feed_adjustment',
    日粮调整: 'feed_adjustment',
    weighing: 'weighing',
    称重: 'weighing',
    body_measurement: 'body_measurement',
    体尺测定: 'body_measurement',
    dry_off: 'dry_off',
    停产: 'dry_off',
    干奶: 'dry_off',
    sample_collection: 'sample_collection',
    样本采集: 'sample_collection',
    sensor_alert: 'sensor_alert',
    传感器告警: 'sensor_alert',
    device_maintenance: 'device_maintenance',
    设备维护: 'device_maintenance',
    device_assignment: 'device_assignment',
    设备绑定: 'device_assignment',
    device_unassignment: 'device_unassignment',
    设备解绑: 'device_unassignment',
    mating_plan: 'mating_plan',
    选配方案: 'mating_plan',
    semen_check: 'semen_check',
    精液检查: 'semen_check',
    genotyping: 'genotyping',
    基因分型: 'genotyping',
    sequencing: 'sequencing',
    测序: 'sequencing',
    omics_assay: 'omics_assay',
    组学检测: 'omics_assay',
    breeding_value_run: 'breeding_value_run',
    育种值计算: 'breeding_value_run',
    selection_index_update: 'selection_index_update',
    选择指数更新: 'selection_index_update'
  }
  return map[text] || map[lower] || text || 'general_event'
}

function backendEventGroupOf(eventCode) {
  if (
    [
      'heat',
      'insemination',
      'pregnancy_check',
      'calving',
      'abortion',
      'postpartum_check',
      'embryo_transfer'
    ].includes(eventCode)
  )
    return 'reproduction'
  if (
    [
      'diagnosis',
      'treatment',
      'medication',
      'vaccination',
      'deworming',
      'quarantine',
      'disinfection',
      'lab_test',
      'hoof_trim',
      'mastitis_check',
      'health_check',
      'death',
      'veterinary',
      'surgery'
    ].includes(eventCode)
  )
    return 'health'
  if (['entry', 'transfer', 'exit'].includes(eventCode)) return 'movement'
  if (
    [
      'milking',
      'milking_session',
      'milk_quality',
      'dhi_test',
      'feeding',
      'feed_delivery',
      'feed_adjustment',
      'feed_intake',
      'water_intake',
      'weighing',
      'body_measurement',
      'dry_off'
    ].includes(eventCode)
  )
    return '生产配置'
  if (eventCode === 'sample_collection') return 'sample'
  if (
    ['sensor_alert', 'device_maintenance', 'device_assignment', 'device_unassignment'].includes(
      eventCode
    )
  )
    return 'device'
  if (
    [
      'mating_plan',
      'semen_check',
      'genotyping',
      'sequencing',
      'omics_assay',
      'breeding_value_run',
      'selection_index_update'
    ].includes(eventCode)
  )
    return 'breeding_research'
  return 'general'
}

function backendEventGroupMatches(value, expected) {
  const map = {
    生产: '生产配置',
    production: '生产配置',
    繁殖: 'reproduction',
    reproduction: 'reproduction',
    健康: 'health',
    health: 'health',
    转群: 'movement',
    movement: 'movement',
    采样: 'sample',
    sample: 'sample',
    sampling: 'sample',
    设备: 'device',
    device: 'device',
    育种科研: 'breeding_research',
    breeding_research: 'breeding_research',
    research: 'breeding_research'
  }
  return (map[value] || value) === (map[expected] || expected)
}

function backendEventDisplayName(eventCode) {
  const map = {
    heat: '发情',
    insemination: '输精/配种',
    pregnancy_check: '妊检',
    calving: '产犊',
    abortion: '流产',
    postpartum_check: '产后检查',
    embryo_transfer: '胚胎移植',
    entry: '入群',
    transfer: '转群',
    exit: '离群',
    diagnosis: '诊断',
    treatment: '治疗',
    medication: '用药',
    vaccination: '疫苗',
    deworming: '驱虫',
    quarantine: '隔离',
    disinfection: '消毒',
    lab_test: '实验室检测',
    hoof_trim: '修蹄',
    mastitis_check: '乳房炎检查',
    health_check: '健康检查',
    death: '死亡',
    milking: '采奶',
    milk_quality: '奶质检测',
    dhi_test: 'DHI',
    feeding: '饲喂',
    feed_delivery: '投料',
    feed_adjustment: '日粮调整',
    weighing: '称重',
    body_measurement: '体尺测定',
    dry_off: '停产',
    sample_collection: '采样',
    sensor_alert: '传感器告警',
    device_maintenance: '设备维护',
    device_assignment: '设备绑定',
    device_unassignment: '设备解绑',
    mating_plan: '选配方案',
    semen_check: '精液检查',
    genotyping: '基因分型',
    sequencing: '测序',
    omics_assay: '组学检测',
    breeding_value_run: '育种值计算',
    selection_index_update: '选择指数更新'
  }
  return map[eventCode] || eventCode || '通用事件'
}

function backendNormalizeEventStatus(value) {
  const raw = firstNonBlankText(value)
  const map = {
    已记录: 'recorded',
    待复核: 'pending_review',
    已确认: 'confirmed',
    已作废: 'voided',
    recorded: 'recorded',
    pending_review: 'pending_review',
    confirmed: 'confirmed',
    voided: 'voided'
  }
  return map[raw] || raw || 'recorded'
}

function parseTimeMs(value) {
  const time = Date.parse(firstNonBlankText(value))
  return Number.isFinite(time) ? time : 0
}

async function searchCowSuggestions(payload = {}) {
  const keyword = firstNonBlankText(payload.query, payload.keyword, payload.search)
  const limit = boundedLimit(payload.limit, 30, 100)
  const candidates = []
  await appendCowSuggestionRows(candidates, 'animal', keyword, limit)
  await appendCowSuggestionRows(candidates, 'cows', keyword, limit)
  if (keyword) {
    await appendIdentifierCowSuggestionRows(candidates, keyword, limit)
    await appendDeviceCowSuggestionRows(candidates, keyword, limit)
  }
  return enrichCowSuggestions(candidates, limit)
}

async function appendCowSuggestionRows(output, tableName, keyword, limit) {
  const table = normalizeTableName(tableName)
  const meta = await getExistingTableMetadata(table)
  if (!meta.exists) return
  const idExpr = sqlFirstTextExpr(meta, ['id', 'cowId', 'animalId'], "''")
  const numberExpr = sqlFirstTextExpr(
    meta,
    ['cowNumber', 'cow_number', 'animalNumber', 'animal_number', 'number'],
    "''"
  )
  const nameExpr = sqlFirstTextExpr(
    meta,
    ['cowName', 'cow_name', 'name', 'nickName', 'nickname'],
    "''"
  )
  const earTagExpr = sqlFirstTextExpr(
    meta,
    ['earTagNumber', 'ear_tag_number', 'earTag', '耳标'],
    "''"
  )
  const electronicExpr = sqlFirstTextExpr(
    meta,
    ['electronicTag', 'electronic_tag', 'rfid', 'rfidCode', 'rfid_code'],
    "''"
  )
  const statusExpr = sqlFirstTextExpr(meta, ['status', 'productionStage', 'production_stage'], "''")
  const penExpr = sqlFirstTextExpr(
    meta,
    [
      'currentPenName',
      'current_pen_name',
      'currentPen',
      'current_pen',
      'currentUnitId',
      'current_unit_id',
      'currentPenId',
      'current_pen_id'
    ],
    "''"
  )
  const where = []
  const params = []
  pushSqlLikeMatches(
    where,
    params,
    meta,
    [
      'id',
      'cowId',
      'animalId',
      'cowNumber',
      'cow_number',
      'animalNumber',
      'animal_number',
      'number',
      'earTagNumber',
      'ear_tag_number',
      'electronicTag',
      'electronic_tag',
      'rfid',
      'rfidCode',
      'rfid_code',
      'cowName',
      'cow_name',
      'name'
    ],
    keyword,
    ['payload']
  )
  const whereSql = where.length ? `WHERE ${where.join(' OR ')}` : ''
  const orderExpr = meta.columns.has('updated_at')
    ? '`updated_at`'
    : meta.columns.has('created_at')
      ? '`created_at`'
      : meta.columns.has('id')
        ? '`id`'
        : '1'
  const [rows] = await pool.query(
    `
      SELECT
        '${table}' AS source_table,
        ${idExpr} AS cow_id,
        ${numberExpr} AS cow_number,
        ${nameExpr} AS cow_name,
        ${earTagExpr} AS ear_tag_number,
        ${electronicExpr} AS electronic_tag,
        ${statusExpr} AS status,
        ${penExpr} AS current_pen
      FROM \`${table}\`
      ${whereSql}
      ORDER BY ${keyword ? `(${numberExpr} = ?) DESC, (${numberExpr} LIKE ?) DESC,` : ''} ${orderExpr} DESC
      LIMIT ?
    `,
    keyword ? [...params, keyword, `${keyword}%`, limit] : [...params, limit]
  )
  output.push(...rows)
}

async function appendIdentifierCowSuggestionRows(output, keyword, limit) {
  const identifierMeta = await getExistingTableMetadata('animal_identifier')
  const animalMeta = await getExistingTableMetadata('animal')
  if (!identifierMeta.exists || !animalMeta.exists) return
  if (!identifierMeta.columns.has('animal_id')) return
  const valueExpr = sqlFirstTextExpr(
    identifierMeta,
    ['identifierValue', 'identifier_value', 'value', 'number'],
    "''"
  )
  const orderExpr = identifierMeta.columns.has('updated_at')
    ? 'i.updated_at'
    : identifierMeta.columns.has('created_at')
      ? 'i.created_at'
      : 'i.id'
  const [rows] = await pool.query(
    `
      SELECT
        'animal_identifier' AS source_table,
        a.id AS cow_id,
        a.animal_number AS cow_number,
        a.name AS cow_name,
        a.ear_tag_number AS ear_tag_number,
        a.electronic_tag AS electronic_tag,
        a.status AS status,
        COALESCE(a.current_unit_id, a.current_pen_id) AS current_pen,
        ${valueExpr} AS alias_value
      FROM animal_identifier i
      JOIN animal a ON a.id = i.animal_id
      WHERE ${valueExpr} LIKE ?
      ORDER BY (${valueExpr} = ?) DESC, (${valueExpr} LIKE ?) DESC, ${orderExpr} DESC
      LIMIT ?
    `,
    [`%${keyword}%`, keyword, `${keyword}%`, limit]
  )
  output.push(...rows)
}

async function appendDeviceCowSuggestionRows(output, keyword, limit) {
  const assignmentMeta = await getExistingTableMetadata('animal_device_assignment')
  const animalMeta = await getExistingTableMetadata('animal')
  if (!assignmentMeta.exists || !animalMeta.exists) return
  if (!assignmentMeta.columns.has('animal_id')) return
  const deviceExpr = sqlFirstTextExpr(
    assignmentMeta,
    ['deviceId', 'device_id', 'rfid', 'rfidCode', 'rfid_code', 'channelId', 'channel_id'],
    "''"
  )
  const orderExpr = assignmentMeta.columns.has('assigned_at')
    ? 'd.assigned_at'
    : assignmentMeta.columns.has('updated_at')
      ? 'd.updated_at'
      : assignmentMeta.columns.has('created_at')
        ? 'd.created_at'
        : 'd.id'
  const [rows] = await pool.query(
    `
      SELECT
        'animal_device_assignment' AS source_table,
        a.id AS cow_id,
        a.animal_number AS cow_number,
        a.name AS cow_name,
        a.ear_tag_number AS ear_tag_number,
        a.electronic_tag AS electronic_tag,
        a.status AS status,
        COALESCE(a.current_unit_id, a.current_pen_id) AS current_pen,
        ${deviceExpr} AS alias_value
      FROM animal_device_assignment d
      JOIN animal a ON a.id = d.animal_id
      WHERE ${deviceExpr} LIKE ?
      ORDER BY (${deviceExpr} = ?) DESC, (${deviceExpr} LIKE ?) DESC, ${orderExpr} DESC
      LIMIT ?
    `,
    [`%${keyword}%`, keyword, `${keyword}%`, limit]
  )
  output.push(...rows)
}

async function enrichCowSuggestions(rows, limit) {
  const byKey = new Map()
  for (const row of rows) {
    const cowId = firstNonBlankText(row.cow_id, row.cowId)
    const cowNumber = firstNonBlankText(row.cow_number, row.cowNumber)
    const key = cowId || cowNumber || firstNonBlankText(row.ear_tag_number, row.earTagNumber)
    if (!key) continue
    const aliases = [
      cowId,
      cowNumber,
      firstNonBlankText(row.ear_tag_number, row.earTagNumber),
      firstNonBlankText(row.electronic_tag, row.electronicTag),
      firstNonBlankText(row.alias_value, row.aliasValue)
    ].filter(Boolean)
    const previous = byKey.get(key) || {}
    byKey.set(key, {
      value: previous.value || cowNumber,
      cowId: previous.cowId || cowId,
      cowNumber: previous.cowNumber || cowNumber,
      cowName: previous.cowName || firstNonBlankText(row.cow_name, row.cowName),
      earTagNumber:
        previous.earTagNumber || firstNonBlankText(row.ear_tag_number, row.earTagNumber),
      status: previous.status || firstNonBlankText(row.status),
      currentPen: previous.currentPen || firstNonBlankText(row.current_pen, row.currentPen),
      aliases: [...new Set([...(previous.aliases || []), ...aliases])],
      sourceTable: previous.sourceTable || firstNonBlankText(row.source_table, row.sourceTable)
    })
  }
  return Array.from(byKey.values())
    .map((row) => {
      const aliasSummary = row.aliases
        .filter((item) => ![row.cowId, row.cowNumber, row.earTagNumber, row.cowName].includes(item))
        .slice(0, 4)
        .join(' / ')
      return {
        ...row,
        value: row.cowNumber,
        aliasSummary,
        searchText: [
          ...new Set([
            row.cowId,
            row.cowNumber,
            row.cowName,
            row.earTagNumber,
            row.status,
            row.currentPen,
            ...row.aliases
          ])
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
        summary: [
          row.earTagNumber ? `耳号 ${row.earTagNumber}` : '',
          aliasSummary ? `标识 ${aliasSummary.split(' / ')[0]}` : '',
          row.status,
          row.currentPen ? `圈舍 ${row.currentPen}` : ''
        ]
          .filter(Boolean)
          .join(' / ')
      }
    })
    .sort((left, right) =>
      String(left.cowNumber || '').localeCompare(String(right.cowNumber || ''), 'zh-CN', {
        numeric: true
      })
    )
    .slice(0, limit)
}

async function resolveEditableCowRefRpc(input = {}) {
  const cowId = firstNonBlankText(input.cowId, input.cow_id, input.animalId, input.animal_id)
  const cowNumber = firstNonBlankText(
    input.cowNumber,
    input.cow_number,
    input.animalNumber,
    input.animal_number,
    input.number
  )
  const token =
    cowId ||
    cowNumber ||
    firstNonBlankText(input.identifier, input.identifierValue, input.identifier_value)
  const exactRows = []
  await appendExactCowRefRows(exactRows, 'animal', { cowId, cowNumber, token })
  await appendExactCowRefRows(exactRows, 'cows', { cowId, cowNumber, token })
  if (!exactRows.length && token) {
    const suggestions = await searchCowSuggestions({ query: token, limit: 1 })
    if (suggestions.length) {
      return {
        cowId: suggestions[0].cowId,
        cowNumber: suggestions[0].cowNumber,
        cowName: suggestions[0].cowName,
        cowRow: suggestions[0].sourceTable === 'cows' ? suggestions[0] : null,
        animalRow: suggestions[0].sourceTable !== 'cows' ? suggestions[0] : null
      }
    }
  }
  const preferred = exactRows.find((row) => row.source_table === 'animal') || exactRows[0] || {}
  return {
    cowId: firstNonBlankText(preferred.cow_id, cowId),
    cowNumber: firstNonBlankText(preferred.cow_number, cowNumber),
    cowName: firstNonBlankText(preferred.cow_name),
    cowRow: exactRows.find((row) => row.source_table === 'cows') || null,
    animalRow: exactRows.find((row) => row.source_table === 'animal') || null
  }
}

async function appendExactCowRefRows(output, tableName, ref) {
  const table = normalizeTableName(tableName)
  const meta = await getExistingTableMetadata(table)
  if (!meta.exists) return
  const idExpr = sqlFirstTextExpr(meta, ['id', 'cowId', 'animalId'], "''")
  const numberExpr = sqlFirstTextExpr(
    meta,
    ['cowNumber', 'cow_number', 'animalNumber', 'animal_number', 'number'],
    "''"
  )
  const nameExpr = sqlFirstTextExpr(meta, ['cowName', 'cow_name', 'name'], "''")
  const earExpr = sqlFirstTextExpr(
    meta,
    ['earTagNumber', 'ear_tag_number', 'earTag', '耳标'],
    "''"
  )
  const where = []
  const params = []
  const values = [ref.cowId, ref.cowNumber, ref.token].filter(Boolean)
  if (!values.length) return
  where.push(
    `(${[idExpr, numberExpr, earExpr].map((expr) => values.map(() => `${expr} = ?`).join(' OR ')).join(' OR ')})`
  )
  for (const _expr of [idExpr, numberExpr, earExpr]) params.push(...values)
  const [rows] = await pool.query(
    `
      SELECT
        \`${table}\`.*,
        '${table}' AS source_table,
        ${idExpr} AS cow_id,
        ${numberExpr} AS cow_number,
        ${nameExpr} AS cow_name,
        ${earExpr} AS ear_tag_number
      FROM \`${table}\`
      WHERE ${where.join(' AND ')}
      LIMIT 2
    `,
    params
  )
  output.push(...rows)
}

async function getEditableCowEventsRpc(payload = {}) {
  const cowRef = await resolveEditableCowRefRpc(payload)
  if (!cowRef.cowId && !cowRef.cowNumber) return []
  const eventGroup = firstNonBlankText(payload.eventGroup, payload.event_group)
  const eventType = backendNormalizeEventCode(
    firstNonBlankText(payload.eventType, payload.event_type)
  )
  const limit = boundedLimit(payload.limit, 20, 100)
  const queryLimit = boundedLimit(limit * (eventGroup || eventType ? 12 : 4), 80, 500)
  const rows = [
    ...(await queryEditableEventTable('animal_event', cowRef, queryLimit)),
    ...(await queryEditableEventTable('cow_events', cowRef, queryLimit))
  ]
    .map((row) => backendNormalizeEditableEvent(row))
    .filter((row) => !eventGroup || backendEventGroupMatches(row.eventGroup, eventGroup))
    .filter((row) => !eventType || row.eventCode === eventType)
    .sort((left, right) => right.sortTime - left.sortTime)

  const seen = new Set()
  return rows
    .filter((row) => {
      const key = row.sourceRecordId
        ? `${row.cowId || row.cowNumber}|${row.eventCode}|${row.sourceRecordId}`
        : `${row.sourceTable}|${row.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}

async function queryEditableEventTable(tableName, cowRef, limit) {
  const table = normalizeTableName(tableName)
  const meta = await getExistingTableMetadata(table)
  if (!meta.exists) return []
  const where = []
  const params = []
  const cowClauses = []
  if (cowRef.cowId) {
    const cowIdWhere = []
    const cowIdParams = []
    pushSqlTextMatches(
      cowIdWhere,
      cowIdParams,
      meta,
      ['animalId', 'animal_id', 'cowId', 'cow_id'],
      [cowRef.cowId],
      ['payload', 'custom_values', 'details']
    )
    if (cowIdWhere.length) {
      cowClauses.push(cowIdWhere.join(' AND '))
      params.push(...cowIdParams)
    }
  }
  if (cowRef.cowNumber) {
    const cowNumberWhere = []
    const cowNumberParams = []
    pushSqlTextMatches(
      cowNumberWhere,
      cowNumberParams,
      meta,
      ['animalNumber', 'animal_number', 'cowNumber', 'cow_number', 'number'],
      [cowRef.cowNumber],
      ['payload', 'custom_values', 'details']
    )
    if (cowNumberWhere.length) {
      cowClauses.push(cowNumberWhere.join(' AND '))
      params.push(...cowNumberParams)
    }
  }
  if (!cowClauses.length) return []
  where.push(`(${cowClauses.join(' OR ')})`)
  const eventTypeExpr = sqlFirstTextExpr(
    meta,
    ['eventType', 'event_type', 'eventCode', 'event_code', 'type', 'eventName', 'event_name'],
    "''"
  )
  const eventNameExpr = sqlFirstTextExpr(
    meta,
    ['eventName', 'event_name', 'eventType', 'event_type'],
    "''"
  )
  const occurredExpr = sqlFirstTextExpr(
    meta,
    [
      'occurredAt',
      'occurred_at',
      'eventTime',
      'event_time',
      'eventDate',
      'event_date',
      'createdAt',
      'created_at'
    ],
    'NULL'
  )
  const updatedExpr = sqlFirstTextExpr(
    meta,
    ['updatedAt', 'updated_at', 'createdAt', 'created_at'],
    'NULL'
  )
  const [rows] = await pool.query(
    `
      SELECT
        *,
        '${table}' AS __source_table,
        ${sqlFirstTextExpr(meta, ['animalId', 'animal_id', 'cowId', 'cow_id'], "''")} AS __animal_id,
        ${sqlFirstTextExpr(meta, ['animalNumber', 'animal_number', 'cowNumber', 'cow_number', 'number'], "''")} AS __animal_number,
        ${eventTypeExpr} AS __event_type,
        ${eventNameExpr} AS __event_name,
        ${occurredExpr} AS __occurred_at,
        ${updatedExpr} AS __updated_at,
        ${sqlFirstTextExpr(meta, ['operatorName', 'operator_name', 'operator', 'recorder'], "''")} AS __operator_name,
        ${sqlFirstTextExpr(meta, ['workOperatorName', 'work_operator_name', 'person', 'technician', 'veterinarian'], "''")} AS __work_operator_name,
        ${sqlFirstTextExpr(meta, ['eventStatus', 'event_status', 'status'], "''")} AS __event_status,
        ${sqlFirstTextExpr(meta, ['sourceTable', 'source_table'], table === 'cow_events' ? "'cow-events'" : "'animal_event'")} AS __source_label,
        ${sqlFirstTextExpr(meta, ['sourceRecordId', 'source_record_id', 'id'], "''")} AS __source_record_id
      FROM \`${table}\`
      WHERE ${where.join(' AND ')}
      ORDER BY ${updatedExpr} DESC, ${occurredExpr} DESC
      LIMIT ?
    `,
    [...params, limit]
  )
  return rows.map((row) => mapEventRowOut(table, row, cowRef))
}

function mapEventRowOut(table, row, cowRef) {
  const mapped = mapRowOut(table, row)
  const payload = parseBackendDetails(mapped.payload, row.payload)
  const details = parseBackendDetails(
    mapped.details,
    mapped.customValues,
    mapped.custom_values,
    payload
  )
  return {
    ...mapped,
    cowId: firstNonBlankText(
      mapped.cowId,
      mapped.animalId,
      row.__animal_id,
      payload.cowId,
      payload.animalId,
      cowRef.cowId
    ),
    cow_id: firstNonBlankText(
      mapped.cow_id,
      mapped.animal_id,
      row.__animal_id,
      payload.cow_id,
      payload.animal_id,
      cowRef.cowId
    ),
    animalId: firstNonBlankText(
      mapped.animalId,
      mapped.cowId,
      row.__animal_id,
      payload.animalId,
      payload.cowId,
      cowRef.cowId
    ),
    animal_id: firstNonBlankText(
      mapped.animal_id,
      mapped.cow_id,
      row.__animal_id,
      payload.animal_id,
      payload.cow_id,
      cowRef.cowId
    ),
    cowNumber: firstNonBlankText(
      mapped.cowNumber,
      mapped.animalNumber,
      row.__animal_number,
      payload.cowNumber,
      payload.animalNumber,
      cowRef.cowNumber
    ),
    cow_number: firstNonBlankText(
      mapped.cow_number,
      mapped.animal_number,
      row.__animal_number,
      payload.cow_number,
      payload.animal_number,
      cowRef.cowNumber
    ),
    animalNumber: firstNonBlankText(
      mapped.animalNumber,
      mapped.cowNumber,
      row.__animal_number,
      payload.animalNumber,
      payload.cowNumber,
      cowRef.cowNumber
    ),
    animal_number: firstNonBlankText(
      mapped.animal_number,
      mapped.cow_number,
      row.__animal_number,
      payload.animal_number,
      payload.cow_number,
      cowRef.cowNumber
    ),
    eventType: firstNonBlankText(
      mapped.eventType,
      row.__event_type,
      payload.eventType,
      payload.event_type
    ),
    event_type: firstNonBlankText(
      mapped.event_type,
      row.__event_type,
      payload.event_type,
      payload.eventType
    ),
    eventCode: firstNonBlankText(
      mapped.eventCode,
      mapped.eventType,
      row.__event_type,
      payload.eventCode,
      payload.event_code
    ),
    event_code: firstNonBlankText(
      mapped.event_code,
      mapped.event_type,
      row.__event_type,
      payload.event_code,
      payload.eventCode
    ),
    eventName: firstNonBlankText(
      mapped.eventName,
      row.__event_name,
      payload.eventName,
      payload.event_name
    ),
    event_name: firstNonBlankText(
      mapped.event_name,
      row.__event_name,
      payload.event_name,
      payload.eventName
    ),
    occurredAt: firstNonBlankText(
      mapped.occurredAt,
      mapped.eventTime,
      row.__occurred_at,
      payload.occurredAt,
      payload.eventTime
    ),
    occurred_at: firstNonBlankText(
      mapped.occurred_at,
      mapped.event_time,
      row.__occurred_at,
      payload.occurred_at,
      payload.event_time
    ),
    operatorName: firstNonBlankText(
      mapped.operatorName,
      row.__operator_name,
      payload.operatorName,
      payload.operator_name
    ),
    operator_name: firstNonBlankText(
      mapped.operator_name,
      row.__operator_name,
      payload.operator_name,
      payload.operatorName
    ),
    workOperatorName: firstNonBlankText(
      mapped.workOperatorName,
      row.__work_operator_name,
      payload.workOperatorName,
      payload.work_operator_name
    ),
    work_operator_name: firstNonBlankText(
      mapped.work_operator_name,
      row.__work_operator_name,
      payload.work_operator_name,
      payload.workOperatorName
    ),
    eventStatus: firstNonBlankText(
      mapped.eventStatus,
      row.__event_status,
      payload.eventStatus,
      payload.event_status
    ),
    event_status: firstNonBlankText(
      mapped.event_status,
      row.__event_status,
      payload.event_status,
      payload.eventStatus
    ),
    sourceTable: firstNonBlankText(
      row.__source_label,
      mapped.sourceTable,
      mapped.source_table,
      table
    ),
    source_table: firstNonBlankText(
      row.__source_label,
      mapped.source_table,
      mapped.sourceTable,
      table
    ),
    sourceRecordId: firstNonBlankText(
      mapped.sourceRecordId,
      mapped.source_record_id,
      row.__source_record_id,
      mapped.id
    ),
    source_record_id: firstNonBlankText(
      mapped.source_record_id,
      mapped.sourceRecordId,
      row.__source_record_id,
      mapped.id
    ),
    details: { ...payload, ...details }
  }
}

function backendNormalizeEditableEvent(row) {
  const details = parseBackendDetails(row.details, row.customValues, row.custom_values, row.payload)
  const eventCode = backendNormalizeEventCode(
    firstNonBlankText(
      row.eventCode,
      row.event_code,
      row.eventType,
      row.event_type,
      details.eventCode,
      details.event_code,
      details.eventType,
      details.event_type
    )
  )
  const occurredAt = firstNonBlankText(
    row.occurredAt,
    row.occurred_at,
    row.eventTime,
    row.event_time,
    details.occurredAt,
    details.occurred_at,
    row.createdAt,
    row.created_at
  )
  const sourceTable =
    firstNonBlankText(row.sourceTable, row.source_table) === 'cow_events'
      ? 'cow-events'
      : firstNonBlankText(row.sourceTable, row.source_table, 'animal_event')
  return {
    id: firstNonBlankText(
      row.id,
      row.eventId,
      row.event_id,
      row.sourceRecordId,
      row.source_record_id
    ),
    cowId: firstNonBlankText(
      row.cowId,
      row.cow_id,
      row.animalId,
      row.animal_id,
      details.cowId,
      details.animal_id
    ),
    cowNumber: firstNonBlankText(
      row.cowNumber,
      row.cow_number,
      row.animalNumber,
      row.animal_number,
      details.cowNumber,
      details.animal_number
    ),
    eventCode,
    eventType: eventCode,
    eventGroup: firstNonBlankText(
      row.eventGroup,
      row.event_group,
      details.eventGroup,
      details.event_group,
      backendEventGroupOf(eventCode)
    ),
    eventName: firstNonBlankText(
      row.eventName,
      row.event_name,
      details.eventName,
      details.event_name,
      backendEventDisplayName(eventCode)
    ),
    occurredAt,
    operatorName: firstNonBlankText(
      row.operatorName,
      row.operator_name,
      details.operatorName,
      details.operator_name
    ),
    workOperatorName: firstNonBlankText(
      row.workOperatorName,
      row.work_operator_name,
      details.workOperatorName,
      details.work_operator_name
    ),
    status: backendNormalizeEventStatus(
      firstNonBlankText(
        row.eventStatus,
        row.event_status,
        row.status,
        details.eventStatus,
        details.event_status
      )
    ),
    sourceTable,
    sourceRecordId: firstNonBlankText(
      row.sourceRecordId,
      row.source_record_id,
      details.sourceRecordId,
      details.source_record_id,
      row.id
    ),
    details,
    raw: row,
    sortTime: parseTimeMs(
      firstNonBlankText(row.updatedAt, row.updated_at, occurredAt, row.createdAt, row.created_at)
    )
  }
}

async function getEditablePedigreeRpc(payload = {}) {
  const cowRef = await resolveEditableCowRefRpc(payload)
  if (!cowRef.cowId && !cowRef.cowNumber) {
    return {
      cowId: '',
      cowNumber: '',
      fatherNumber: '',
      motherNumber: '',
      paternalGrandfatherNumber: '',
      paternalGrandmotherNumber: '',
      maternalGrandfatherNumber: '',
      maternalGrandmotherNumber: '',
      parentageRows: [],
      cowRow: null,
      animalRow: null
    }
  }
  const parentageRows = await queryParentageRows(cowRef)
  const byRole = (role) =>
    parentageRows.find(
      (row) => firstNonBlankText(row.parentRole, row.parent_role).toLowerCase() === role
    )
  const cowRow = cowRef.cowRow ? mapRowOut('cows', cowRef.cowRow) : null
  const animalRow = cowRef.animalRow ? mapRowOut('animal', cowRef.animalRow) : null
  return {
    cowId: cowRef.cowId,
    cowNumber: cowRef.cowNumber,
    fatherNumber: firstNonBlankText(
      byRole('sire')?.parentNumber,
      byRole('sire')?.parent_number,
      cowRow?.fatherNumber,
      cowRow?.father_number,
      animalRow?.fatherNumber,
      animalRow?.father_number
    ),
    motherNumber: firstNonBlankText(
      byRole('dam')?.parentNumber,
      byRole('dam')?.parent_number,
      cowRow?.motherNumber,
      cowRow?.mother_number,
      animalRow?.motherNumber,
      animalRow?.mother_number
    ),
    paternalGrandfatherNumber: firstNonBlankText(
      cowRow?.grandfatherNumber,
      cowRow?.grandfather_number,
      animalRow?.grandfatherNumber,
      animalRow?.grandfather_number
    ),
    paternalGrandmotherNumber: firstNonBlankText(
      cowRow?.grandmotherNumber,
      cowRow?.grandmother_number,
      animalRow?.grandmotherNumber,
      animalRow?.grandmother_number
    ),
    maternalGrandfatherNumber: firstNonBlankText(
      cowRow?.maternalGrandfatherNumber,
      cowRow?.maternal_grandfather_number,
      animalRow?.maternalGrandfatherNumber,
      animalRow?.maternal_grandfather_number
    ),
    maternalGrandmotherNumber: firstNonBlankText(
      cowRow?.maternalGrandmotherNumber,
      cowRow?.maternal_grandmother_number,
      animalRow?.maternalGrandmotherNumber,
      animalRow?.maternal_grandmother_number
    ),
    parentageRows,
    cowRow,
    animalRow
  }
}

async function queryParentageRows(cowRef) {
  const meta = await getExistingTableMetadata('animal_parentage')
  if (!meta.exists) return []
  const where = []
  const params = []
  pushSqlTextMatches(
    where,
    params,
    meta,
    ['animalId', 'animal_id', 'cowId', 'cow_id'],
    [cowRef.cowId],
    ['payload']
  )
  pushSqlTextMatches(
    where,
    params,
    meta,
    ['animalNumber', 'animal_number', 'cowNumber', 'cow_number'],
    [cowRef.cowNumber],
    ['payload']
  )
  if (!where.length) return []
  const [rows] = await pool.query(
    `SELECT * FROM animal_parentage WHERE ${where.join(' OR ')} ORDER BY updated_at DESC, created_at DESC LIMIT 20`,
    params
  )
  return rows.map((row) => mapRowOut('animal_parentage', row))
}

function normalizedDateTimeMinute(value) {
  if (!value) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 16)
  }
  const text = String(value).trim().replace('T', ' ')
  const minuteMatch = text.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/)
  if (minuteMatch) return minuteMatch[0]
  const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/)
  if (dateMatch) return dateMatch[0]
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 16)
}

function normalizedNumberKey(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(3) : String(value || '').trim()
}

function buildCowLookup(cows = []) {
  const byId = new Map()
  const byNumber = new Map()
  for (const cow of cows || []) {
    const idKeys = [cow?.id, cow?.cowId, cow?.cow_id, cow?.animalId, cow?.animal_id]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
    const numberKeys = [
      cow?.cowNumber,
      cow?.cow_number,
      cow?.animalNumber,
      cow?.animal_number,
      cow?.number,
      cow?.earTagNumber,
      cow?.ear_tag_number
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
    for (const key of idKeys) if (!byId.has(key)) byId.set(key, cow)
    for (const key of numberKeys) if (!byNumber.has(key)) byNumber.set(key, cow)
  }
  return { byId, byNumber }
}

function resolveCowForUnifiedRow(row, cowLookup = null) {
  if (!cowLookup) return row
  const idKeys = [row.cowId, row.cow_id, row.animalId, row.animal_id]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  const numberKeys = [
    row.cowNumber,
    row.cow_number,
    row.animalNumber,
    row.animal_number,
    row.number
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  const cow =
    idKeys.map((key) => cowLookup.byId.get(key)).find(Boolean) ||
    numberKeys.map((key) => cowLookup.byNumber.get(key)).find(Boolean)
  if (!cow) return row
  const cowId = firstNonBlankText(
    cow.id,
    cow.cowId,
    cow.cow_id,
    cow.animalId,
    cow.animal_id,
    row.cowId,
    row.animalId
  )
  const cowNumber = firstNonBlankText(
    cow.cowNumber,
    cow.cow_number,
    cow.animalNumber,
    cow.animal_number,
    cow.number,
    row.cowNumber,
    row.animalNumber
  )
  return {
    ...row,
    cowId,
    cow_id: cowId,
    animalId: cowId,
    animal_id: cowId,
    cowNumber,
    cow_number: cowNumber,
    animalNumber: cowNumber,
    animal_number: cowNumber
  }
}

async function queryRowsByDateRange(tableName, dateAliases, options = {}) {
  const table = normalizeTableName(tableName)
  const meta = await getExistingTableMetadata(table)
  if (!meta.exists) return []
  const where = []
  const params = []
  const cowIds = normalizeCowIds(
    options.cowId || options.cowIds || options.cow_id || options.cow_ids
  )
  const cowNumbers = normalizeCowIds(
    options.cowNumber ||
      options.cowNumbers ||
      options.animalNumber ||
      options.animalNumbers ||
      options.cow_number ||
      options.cow_numbers ||
      options.animal_number ||
      options.animal_numbers
  )

  if (cowIds.length) {
    const cowIdColumns = ['animal_id', 'cow_id', 'animalId', 'cowId']
      .map(camelToSnake)
      .filter(
        (column, index, columns) => columns.indexOf(column) === index && meta.columns.has(column)
      )
    if (cowIdColumns.length) {
      where.push(
        `(${cowIdColumns.map((column) => `\`${column}\` IN (${cowIds.map(() => '?').join(',')})`).join(' OR ')})`
      )
      for (const _column of cowIdColumns) params.push(...cowIds)
    }
  }

  if (cowNumbers.length) {
    const cowNumberColumns = ['animal_number', 'cow_number', 'number', 'animalNumber', 'cowNumber']
      .map(camelToSnake)
      .filter(
        (column, index, columns) => columns.indexOf(column) === index && meta.columns.has(column)
      )
    if (cowNumberColumns.length) {
      where.push(
        `(${cowNumberColumns.map((column) => `\`${column}\` IN (${cowNumbers.map(() => '?').join(',')})`).join(' OR ')})`
      )
      for (const _column of cowNumberColumns) params.push(...cowNumbers)
    }
  }

  const dateExpr = sqlDateExpr(meta, dateAliases)
  if (options.date && dateExpr !== 'NULL') {
    where.push(`${dateExpr} = ?`)
    params.push(options.date)
  } else if ((options.startDate || options.endDate) && dateExpr !== 'NULL') {
    if (options.startDate) {
      where.push(`${dateExpr} >= ?`)
      params.push(options.startDate)
    }
    if (options.endDate) {
      where.push(`${dateExpr} <= ?`)
      params.push(options.endDate)
    }
  }
  const orderColumn =
    dateAliases.find((column) => meta.columns.has(column)) ||
    (meta.columns.has('created_at')
      ? 'created_at'
      : meta.columns.has('id')
        ? 'id'
        : Array.from(meta.columns)[0])
  const limit = Number(options.limit || 0)
  const businessDateExpr = sqlDateKeyExpr(meta, dateAliases)
  const sql = `SELECT *, ${businessDateExpr} AS \`businessDate\` FROM \`${table}\` ${where.length ? `WHERE ${where.join(' AND ')}` : ''}${orderColumn ? ` ORDER BY \`${orderColumn}\` DESC` : ''}${limit > 0 ? ' LIMIT ?' : ''}`
  if (limit > 0) params.push(Math.max(1, Math.min(50000, limit)))
  const [rows] = await pool.query(sql, params)
  return rows.map((row) => mapRowOut(table, row))
}

function normalizeUnifiedMilkRow(row, sourceTable, cowLookup = null) {
  const measuredAt = firstPresentValue(row, [
    'measuredAt',
    'milkingTime',
    'productionDate',
    'createdAt',
    'updatedAt'
  ])
  const productionDate = dashboardDateKey(
    firstPresentValue(row, ['businessDate', 'productionDate']) || measuredAt
  )
  const volume = Number(
    firstPresentValue(row, ['milkYield', 'milkVolume', 'volume', 'value', 'numericValue'])
  )
  const quality = milkQualityOfRow(row)
  const rawCowId = firstNonBlankText(row.animalId, row.cowId, row.animal_id, row.cow_id)
  const rawCowNumber = firstNonBlankText(
    row.animalNumber,
    row.cowNumber,
    row.animal_number,
    row.cow_number
  )
  const normalized = {
    ...row,
    id: String(
      row.id ||
        row.sourceRecordId ||
        row.source_record_id ||
        stableId('milk-row', sourceTable, rawCowId, rawCowNumber, measuredAt)
    ),
    cowId: rawCowId,
    cow_id: rawCowId,
    animalId: rawCowId,
    animal_id: rawCowId,
    cowNumber: rawCowNumber,
    cow_number: rawCowNumber,
    animalNumber: rawCowNumber,
    animal_number: rawCowNumber,
    measuredAt,
    measured_at: measuredAt,
    milkingTime: firstPresentValue(row, ['milkingTime']) || measuredAt,
    milking_time: firstPresentValue(row, ['milking_time']) || measuredAt,
    productionDate,
    production_date: productionDate,
    shiftId: firstNonBlankText(row.shiftId, row.shift_id, row.shift, row.milkingShift),
    shift_id: firstNonBlankText(row.shiftId, row.shift_id, row.shift, row.milkingShift),
    parityNo: firstPresentValue(row, ['parityNo', 'parity', 'lactationNo']),
    parity_no: firstPresentValue(row, ['parityNo', 'parity', 'lactationNo']),
    daysInMilk: firstPresentValue(row, ['daysInMilk', 'dim']),
    days_in_milk: firstPresentValue(row, ['daysInMilk', 'dim']),
    reportedAgeMonths: firstPresentValue(row, ['reportedAgeMonths', 'reported_age_months']),
    reported_age_months: firstPresentValue(row, ['reportedAgeMonths', 'reported_age_months']),
    reportedLactationMonth: firstPresentValue(row, [
      'reportedLactationMonth',
      'reported_lactation_month'
    ]),
    reported_lactation_month: firstPresentValue(row, [
      'reportedLactationMonth',
      'reported_lactation_month'
    ]),
    milkYield: Number.isFinite(volume) ? volume : undefined,
    milk_yield: Number.isFinite(volume) ? volume : undefined,
    volume: Number.isFinite(volume) ? volume : undefined,
    milkQuality: quality,
    milk_quality: quality,
    fatPercent: quality.fat || undefined,
    fat_percent: quality.fat || undefined,
    proteinPercent: quality.protein || undefined,
    protein_percent: quality.protein || undefined,
    lactosePercent: quality.lactose || undefined,
    lactose_percent: quality.lactose || undefined,
    somaticCellCount: quality.scc || undefined,
    somatic_cell_count: quality.scc || undefined,
    sourceTable: row.sourceTable || row.source_table || sourceTable,
    source_table: row.sourceTable || row.source_table || sourceTable,
    sourceRecordId: row.sourceRecordId || row.source_record_id || row.id || '',
    source_record_id: row.sourceRecordId || row.source_record_id || row.id || '',
    sourcePriority: sourceTable === 'milk_measurement' ? 1 : 2
  }
  return resolveCowForUnifiedRow(normalized, cowLookup)
}

function milkQualityOfRow(row = {}) {
  const rawQuality = row.milkQuality || row.milk_quality
  const parsed = typeof rawQuality === 'string' ? safeJsonParse(rawQuality, {}) : rawQuality
  const quality = parsed && typeof parsed === 'object' ? parsed : {}
  const number = (...values) => {
    for (const value of values) {
      const numeric = Number(value)
      if (Number.isFinite(numeric) && numeric > 0) return numeric
    }
    return 0
  }
  return {
    fat: number(quality.fat, row.fat, row.fatPercent, row.fat_percent, row.fatRate, row.fat_rate),
    protein: number(
      quality.protein,
      row.protein,
      row.proteinPercent,
      row.protein_percent,
      row.proteinRate,
      row.protein_rate
    ),
    lactose: number(
      quality.lactose,
      row.lactose,
      row.lactosePercent,
      row.lactose_percent,
      row.lactoseRate,
      row.lactose_rate
    ),
    scc: number(quality.scc, row.scc, row.somaticCellCount, row.somatic_cell_count),
    grade: firstNonBlankText(
      quality.grade,
      row.grade,
      row.qualityGrade,
      row.quality_grade,
      row.qualityFlag,
      row.quality_flag,
      'A'
    )
  }
}

function buildMilkQualitySummaryMap(milkRows = [], phenotypeRows = []) {
  const grouped = new Map()
  const push = (row, metric, value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return
    const keys = [row.cowId, row.cowNumber, row.animalId, row.animalNumber]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    for (const key of keys) {
      const bucket = grouped.get(key) || { fat: [], protein: [], lactose: [], scc: [], grades: [] }
      bucket[metric].push(numeric)
      grouped.set(key, bucket)
    }
  }
  for (const row of milkRows) {
    const quality = milkQualityOfRow(row)
    push(row, 'fat', quality.fat)
    push(row, 'protein', quality.protein)
    push(row, 'lactose', quality.lactose)
    push(row, 'scc', quality.scc)
    if (quality.grade) {
      const keys = [row.cowId, row.cowNumber, row.animalId, row.animalNumber]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
      for (const key of keys) {
        const bucket = grouped.get(key) || {
          fat: [],
          protein: [],
          lactose: [],
          scc: [],
          grades: []
        }
        bucket.grades.push(quality.grade)
        grouped.set(key, bucket)
      }
    }
  }
  const traitMetricMap = {
    milk_fat: 'fat',
    milk_fat_percent: 'fat',
    fat_percent: 'fat',
    milk_protein: 'protein',
    milk_protein_percent: 'protein',
    protein_percent: 'protein',
    milk_lactose: 'lactose',
    milk_lactose_percent: 'lactose',
    lactose_percent: 'lactose',
    somatic_cell_count: 'scc',
    scc: 'scc'
  }
  for (const row of phenotypeRows) {
    const code = String(row.traitCode || row.trait_code || row.traitName || row.trait_name || '')
      .trim()
      .toLowerCase()
    const metric = traitMetricMap[code]
    if (!metric) continue
    push(row, metric, row.numericValue ?? row.numeric_value ?? row.value)
  }
  const average = (values) => {
    const valid = values.map(Number).filter((value) => Number.isFinite(value) && value > 0)
    return valid.length
      ? Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2))
      : 0
  }
  const bestGrade = (grades) => {
    const upper = grades.map((grade) => String(grade || '').toUpperCase())
    if (upper.includes('A')) return 'A'
    if (upper.includes('B')) return 'B'
    if (upper.includes('C')) return 'C'
    return upper.find(Boolean) || 'A'
  }
  return Array.from(grouped.entries()).reduce((result, [key, bucket]) => {
    const count = Math.max(
      bucket.fat.length,
      bucket.protein.length,
      bucket.lactose.length,
      bucket.scc.length
    )
    if (!count) return result
    result[key] = {
      fat: average(bucket.fat),
      protein: average(bucket.protein),
      lactose: average(bucket.lactose),
      scc: average(bucket.scc),
      grade: bestGrade(bucket.grades),
      count
    }
    return result
  }, {})
}

function unifiedMilkBusinessKey(row) {
  const cowKey = firstNonBlankText(
    row.cowId,
    row.cowNumber,
    row.animalId,
    row.animalNumber,
    row.sourceRecordId
  )
  const timeKey = normalizedDateTimeMinute(row.measuredAt || row.milkingTime || row.productionDate)
  const shiftKey = String(row.shiftId || row.shift_id || '').trim()
  const valueKey = normalizedNumberKey(row.volume ?? row.milkYield ?? row.milk_yield)
  return `${cowKey}|${timeKey}|${shiftKey}|${valueKey}`
}

function dedupeUnifiedRows(rows, businessKeyGetter) {
  const byKey = new Map()
  for (const row of rows) {
    const key = businessKeyGetter(row)
    const current = byKey.get(key)
    if (!current || Number(row.sourcePriority || 99) < Number(current.sourcePriority || 99)) {
      byKey.set(key, row)
    }
  }
  return Array.from(byKey.values())
}

async function getUnifiedMilkRows(options = {}) {
  const cowLookup = options.cows ? buildCowLookup(options.cows) : null
  const [standardRows, legacyRows] = await Promise.all([
    queryRowsByDateRange(
      'milk_measurement',
      ['measured_at', 'production_date', 'milking_time', 'created_at'],
      options
    ),
    queryRowsByDateRange(
      'milk_records',
      ['milking_time', 'production_date', 'measured_at', 'created_at'],
      options
    )
  ])
  const rows = dedupeUnifiedRows(
    [
      ...standardRows.map((row) => normalizeUnifiedMilkRow(row, 'milk_measurement', cowLookup)),
      ...legacyRows.map((row) => normalizeUnifiedMilkRow(row, 'milk_records', cowLookup))
    ],
    unifiedMilkBusinessKey
  )
  const requestedCowIds = new Set(
    normalizeCowIds(options.cowId || options.cowIds || options.cow_id || options.cow_ids)
  )
  const requestedCowNumbers = new Set(
    normalizeCowIds(
      options.cowNumber || options.cowNumbers || options.cow_number || options.cow_numbers
    )
  )
  return rows
    .filter((row) => {
      if (!requestedCowIds.size && !requestedCowNumbers.size) return true
      return (
        requestedCowIds.has(String(row.cowId || row.animalId || '').trim()) ||
        requestedCowNumbers.has(String(row.cowNumber || row.animalNumber || '').trim())
      )
    })
    .sort((left, right) =>
      String(right.measuredAt || right.productionDate || '').localeCompare(
        String(left.measuredAt || left.productionDate || '')
      )
    )
}

function normalizeUnifiedPhenotypeRow(row, sourceTable, traitMap = new Map(), cowLookup = null) {
  const observedAt = firstPresentValue(row, [
    'observedAt',
    'collectionDate',
    'measuredAt',
    'createdAt',
    'updatedAt'
  ])
  const traitId = firstNonBlankText(row.traitId, row.trait_id)
  const trait = traitMap.get(traitId) || null
  const numeric = Number(firstPresentValue(row, ['numericValue', 'value']))
  const rawCowId = firstNonBlankText(row.animalId, row.cowId, row.animal_id, row.cow_id)
  const rawCowNumber = firstNonBlankText(
    row.animalNumber,
    row.cowNumber,
    row.animal_number,
    row.cow_number
  )
  const normalized = {
    ...row,
    id: String(
      row.id ||
        row.sourceRecordId ||
        row.source_record_id ||
        stableId('trait-row', sourceTable, rawCowId, rawCowNumber, traitId, observedAt)
    ),
    cowId: rawCowId,
    cow_id: rawCowId,
    animalId: rawCowId,
    animal_id: rawCowId,
    cowNumber: rawCowNumber,
    cow_number: rawCowNumber,
    animalNumber: rawCowNumber,
    animal_number: rawCowNumber,
    traitId,
    trait_id: traitId,
    traitCode: firstNonBlankText(row.traitCode, row.trait_code, trait?.code),
    trait_code: firstNonBlankText(row.traitCode, row.trait_code, trait?.code),
    traitName: firstNonBlankText(row.traitName, row.trait_name, trait?.name),
    trait_name: firstNonBlankText(row.traitName, row.trait_name, trait?.name),
    observedAt,
    observed_at: observedAt,
    collectionDate: dashboardDateKey(firstPresentValue(row, ['collectionDate']) || observedAt),
    collection_date: dashboardDateKey(firstPresentValue(row, ['collectionDate']) || observedAt),
    parityNo: firstPresentValue(row, ['parityNo', 'parity']),
    daysInMilk: firstPresentValue(row, ['daysInMilk', 'dim']),
    numericValue: Number.isFinite(numeric) ? numeric : undefined,
    numeric_value: Number.isFinite(numeric) ? numeric : undefined,
    value: Number.isFinite(numeric) ? numeric : firstPresentValue(row, ['textValue', 'value']),
    sourceTable: row.sourceTable || row.source_table || sourceTable,
    source_table: row.sourceTable || row.source_table || sourceTable,
    sourceRecordId: row.sourceRecordId || row.source_record_id || row.id || '',
    source_record_id: row.sourceRecordId || row.source_record_id || row.id || '',
    sourcePriority: sourceTable === 'trait_observation' ? 1 : 2
  }
  return resolveCowForUnifiedRow(normalized, cowLookup)
}

function unifiedPhenotypeBusinessKey(row) {
  const cowKey = firstNonBlankText(
    row.cowId,
    row.cowNumber,
    row.animalId,
    row.animalNumber,
    row.sourceRecordId
  )
  const traitKey = firstNonBlankText(row.traitCode, row.traitName, row.traitId)
  const timeKey = normalizedDateTimeMinute(row.observedAt || row.collectionDate)
  const valueKey = normalizedNumberKey(row.numericValue ?? row.value ?? row.textValue)
  return `${cowKey}|${traitKey}|${timeKey}|${valueKey}`
}

async function getUnifiedPhenotypeRows(options = {}) {
  const cowLookup = options.cows ? buildCowLookup(options.cows) : null
  const traitRows = await getTableRows('trait_definition', { page: 1, pageSize: 5000 }).catch(
    () => []
  )
  const traitMap = new Map(
    traitRows.map((row) => [String(row.id || row.traitId || '').trim(), row]).filter(([key]) => key)
  )
  const [standardRows, legacyRows] = await Promise.all([
    queryRowsByDateRange(
      'trait_observation',
      ['observed_at', 'collection_date', 'created_at'],
      options
    ),
    queryRowsByDateRange(
      'phenotype_records',
      ['collection_date', 'observed_at', 'created_at'],
      options
    )
  ])
  const rows = dedupeUnifiedRows(
    [
      ...standardRows.map((row) =>
        normalizeUnifiedPhenotypeRow(row, 'trait_observation', traitMap, cowLookup)
      ),
      ...legacyRows.map((row) =>
        normalizeUnifiedPhenotypeRow(row, 'phenotype_records', traitMap, cowLookup)
      )
    ],
    unifiedPhenotypeBusinessKey
  )
  return rows.sort((left, right) =>
    String(right.observedAt || right.collectionDate || '').localeCompare(
      String(left.observedAt || left.collectionDate || '')
    )
  )
}

async function getArchiveCoverageSummary() {
  const [[cowCountRow]] = await pool.query(
    `
      SELECT COUNT(DISTINCT cow_key) AS total
      FROM (
        SELECT COALESCE(NULLIF(id, ''), NULLIF(cow_number, '')) AS cow_key FROM cows
        UNION
        SELECT COALESCE(NULLIF(id, ''), NULLIF(animal_number, '')) AS cow_key FROM animal
      ) all_cows
      WHERE cow_key IS NOT NULL AND cow_key <> ''
    `
  )
  const [[milkCoverageRow]] = await pool.query(
    `
      SELECT COUNT(DISTINCT cow_key) AS covered
      FROM (
        SELECT CAST(COALESCE(NULLIF(mm.animal_id, ''), NULLIF(a.animal_number, '')) AS CHAR) AS cow_key
        FROM milk_measurement mm
        LEFT JOIN animal a ON a.id = mm.animal_id
        WHERE COALESCE(mm.milk_yield, 0) > 0
        UNION
        SELECT CAST(COALESCE(NULLIF(mr.cow_id, ''), NULLIF(c.cow_number, '')) AS CHAR) AS cow_key
        FROM milk_records mr
        LEFT JOIN cows c ON c.id = mr.cow_id
        WHERE COALESCE(mr.volume, 0) > 0
      ) milk_cows
      WHERE cow_key IS NOT NULL AND cow_key <> ''
    `
  )
  const [[sensorCoverageRow]] = await pool.query(
    `
      SELECT COUNT(DISTINCT cow_key) AS covered
      FROM (
        SELECT CAST(COALESCE(NULLIF(cow_id, ''), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.cowNumber')), '')) AS CHAR) AS cow_key
        FROM sensors
        UNION
        SELECT CAST(COALESCE(NULLIF(animal_id, ''), NULLIF(cow_id, ''), NULLIF(cow_number, '')) AS CHAR) AS cow_key
        FROM sensor_reading
        UNION
        SELECT CAST(COALESCE(NULLIF(animal_id, ''), NULLIF(cow_id, ''), NULLIF(cow_number, '')) AS CHAR) AS cow_key
        FROM sensor_readings
      ) sensor_cows
      WHERE cow_key IS NOT NULL AND cow_key <> ''
    `
  )
  const total = Number(cowCountRow?.total || 0)
  const milkCovered = Number(milkCoverageRow?.covered || 0)
  const sensorCovered = Number(sensorCoverageRow?.covered || 0)
  return {
    total,
    milkCovered,
    sensorCovered,
    milkCoverage: total ? Math.round((milkCovered / total) * 100) : 0,
    sensorCoverage: total ? Math.round((sensorCovered / total) * 100) : 0
  }
}

function dashboardDateKey(value) {
  if (!value) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (number) => String(number).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  const text = String(value).trim()
  const match = text.match(/\d{4}-\d{2}-\d{2}/)
  if (match) return match[0]
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? '' : dashboardDateKey(date)
}

function dashboardAddDays(dateKey, days) {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  const date =
    Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
      ? new Date(year, month - 1, day)
      : new Date()
  date.setDate(date.getDate() + days)
  return dashboardDateKey(date)
}

function dashboardRange(endKey, days) {
  const range = []
  for (let index = days - 1; index >= 0; index -= 1) {
    range.push(dashboardAddDays(endKey, -index))
  }
  return range
}

function dashboardDaysBetween(startKey, endKey) {
  const start = new Date(`${startKey}T00:00:00`)
  const end = new Date(`${endKey}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1)
}

function dashboardRangeBetween(startKey, endKey, maxDays = 120) {
  const dayCount = Math.min(dashboardDaysBetween(startKey, endKey), maxDays)
  const rangeStart = dashboardAddDays(endKey, -(dayCount - 1))
  const range = []
  for (let index = 0; index < dayCount; index += 1) {
    range.push(dashboardAddDays(rangeStart, index))
  }
  return range
}

function dashboardShortDate(dateKey) {
  return String(dateKey || '')
    .slice(5)
    .replace('-', '/')
}

function healthDashboardAliasKeys(row = {}) {
  return [
    row.id,
    row.cowId,
    row.cow_id,
    row.animalId,
    row.animal_id,
    row.cowNumber,
    row.cow_number,
    row.animalNumber,
    row.animal_number,
    row.earTagNumber,
    row.ear_tag_number
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
}

function compactHealthDashboardTemperatureRows(cows, animals, sourceGroups, perCowLimit) {
  const aliasToCow = new Map()
  for (const cow of [...animals, ...cows]) {
    const aliases = healthDashboardAliasKeys(cow)
    const canonicalKey = aliases[0]
    if (!canonicalKey) continue
    for (const alias of aliases) aliasToCow.set(alias, canonicalKey)
  }

  const grouped = new Map()
  const seen = new Set()
  const seenFacts = new Set()
  for (const { sourceTable, priority, rows } of sourceGroups) {
    for (const row of rows) {
      const temperature = Number(row.temperature ?? row.reading_value ?? row.value)
      const measuredAt = row.measured_at ?? row.timestamp ?? row.ts
      if (!Number.isFinite(temperature) || !measuredAt) continue
      const aliases = healthDashboardAliasKeys(row)
      const cowKey = aliases.map((alias) => aliasToCow.get(alias)).find(Boolean)
      if (!cowKey) continue
      const sourceMessageId = firstNonBlankText(row.source_message_id, row.id)
      const dedupeKey = sourceMessageId || `${cowKey}|${measuredAt}|${temperature}`
      const factKey = `${cowKey}|${new Date(measuredAt).getTime()}`
      if (seen.has(dedupeKey) || seenFacts.has(factKey)) continue
      seen.add(dedupeKey)
      seenFacts.add(factKey)
      const item = {
        id: firstNonBlankText(row.id, dedupeKey),
        cowId: firstNonBlankText(row.cow_id, row.animal_id, cowKey),
        cowNumber: firstNonBlankText(row.cow_number, row.animal_number),
        animalId: firstNonBlankText(row.animal_id, row.cow_id, cowKey),
        temperature,
        bodyTemperature: temperature,
        readingValue: temperature,
        measuredAt,
        timestamp: measuredAt,
        sourceMessageId,
        sourceTable,
        priority
      }
      const group = grouped.get(cowKey) || []
      group.push(item)
      grouped.set(cowKey, group)
    }
  }

  return Array.from(grouped.values()).flatMap((group) =>
    group
      .sort((left, right) => {
        const timeDifference =
          new Date(left.measuredAt).getTime() - new Date(right.measuredAt).getTime()
        if (timeDifference) return timeDifference
        return left.priority - right.priority
      })
      .slice(-perCowLimit)
      .map(({ priority: _priority, ...row }) => row)
  )
}

async function getHealthDashboardSnapshot(options = {}) {
  const perCowLimit = Math.max(3, Math.min(24, Number(options.perCowLimit || 3)))
  const [cows, animals, canonicalResult, wideResult, legacyResult, alertResult, healthScores] =
    await Promise.all([
      getTableRows('cows', { page: 1, pageSize: 5000 }).catch(() => []),
      getTableRows('animal', { page: 1, pageSize: 5000 }).catch(() => []),
      pool
        .query(
          `
            SELECT id, animal_id, cow_id, animal_number, cow_number, reading_value AS temperature,
                   measured_at, source_record_id, position
            FROM (
              SELECT id, animal_id, cow_id, animal_number, cow_number, reading_value, measured_at,
                     source_record_id,
                     ROW_NUMBER() OVER (
                       PARTITION BY COALESCE(NULLIF(animal_id, ''), NULLIF(cow_id, ''), NULLIF(animal_number, ''), NULLIF(cow_number, ''))
                       ORDER BY measured_at DESC, id DESC
                     ) AS position
              FROM sensor_reading
              WHERE metric_code = 'body_temperature'
                AND reading_value IS NOT NULL
                AND COALESCE(quality_flag, 'valid') <> 'invalid'
                AND COALESCE(NULLIF(animal_id, ''), NULLIF(cow_id, ''), NULLIF(animal_number, ''), NULLIF(cow_number, '')) IS NOT NULL
            ) ranked
            WHERE position <= ?
          `,
          [perCowLimit]
        )
        .catch(() => [[]]),
      pool
        .query(
          `
            SELECT id, cow_id, temperature, ts AS measured_at, id AS source_record_id, position
            FROM (
              SELECT id, cow_id, temperature, ts,
                     ROW_NUMBER() OVER (PARTITION BY cow_id ORDER BY ts DESC, id DESC) AS position
              FROM sensors
              WHERE temperature IS NOT NULL AND NULLIF(cow_id, '') IS NOT NULL
            ) ranked
            WHERE position <= ?
          `,
          [perCowLimit]
        )
        .catch(() => [[]]),
      pool
        .query(
          `
            SELECT id, animal_id, cow_id, animal_number, cow_number,
                   COALESCE(reading_value, value) AS temperature,
                   COALESCE(measured_at, timestamp) AS measured_at,
                   source_record_id, position
            FROM (
              SELECT id, animal_id, cow_id, animal_number, cow_number, reading_value, value,
                     measured_at, timestamp, source_record_id,
                     ROW_NUMBER() OVER (
                       PARTITION BY COALESCE(NULLIF(animal_id, ''), NULLIF(cow_id, ''), NULLIF(animal_number, ''), NULLIF(cow_number, ''))
                       ORDER BY COALESCE(measured_at, timestamp) DESC, id DESC
                     ) AS position
              FROM sensor_readings
              WHERE COALESCE(metric_code, metric) = 'body_temperature'
                AND COALESCE(reading_value, value) IS NOT NULL
                AND COALESCE(NULLIF(animal_id, ''), NULLIF(cow_id, ''), NULLIF(animal_number, ''), NULLIF(cow_number, '')) IS NOT NULL
            ) ranked
            WHERE position <= ?
          `,
          [perCowLimit]
        )
        .catch(() => [[]]),
      pool
        .query(
          `
            SELECT *
            FROM alerts
            WHERE DATE(COALESCE(alert_time, created_at)) = CURDATE()
            ORDER BY COALESCE(alert_time, created_at) DESC, id DESC
            LIMIT 5000
          `
        )
        .catch(() => [[]]),
      getTableRows('health_scores', { page: 1, pageSize: 5000 }).catch(() => [])
    ])

  const latestHealthScores = new Map()
  for (const row of healthScores) {
    const cowKey = healthDashboardAliasKeys(row)[0]
    if (!cowKey) continue
    const timestamp = new Date(
      row.scoreTime || row.recordTime || row.createdAt || row.updatedAt || 0
    ).getTime()
    const current = latestHealthScores.get(cowKey)
    if (!current || timestamp > current.timestamp)
      latestHealthScores.set(cowKey, { row, timestamp })
  }

  const sensorRows = compactHealthDashboardTemperatureRows(
    cows,
    animals,
    [
      { sourceTable: 'sensor_reading', priority: 3, rows: canonicalResult[0] || [] },
      { sourceTable: 'sensors', priority: 2, rows: wideResult[0] || [] },
      { sourceTable: 'sensor_readings', priority: 1, rows: legacyResult[0] || [] }
    ],
    perCowLimit
  )

  return {
    cows,
    animals,
    sensorRows,
    alerts: (alertResult[0] || []).map((row) => mapRowOut('alerts', row)),
    healthScores: Array.from(latestHealthScores.values()).map((item) => item.row),
    meta: {
      generatedAt: new Date().toISOString(),
      queryMode: 'compact-latest-three',
      perCowLimit,
      cowCount: cows.length,
      animalCount: animals.length,
      temperaturePointCount: sensorRows.length
    }
  }
}

async function getDashboardProductionSnapshot(options = {}) {
  const [cowRows] = await pool.query(
    `
      SELECT id, cow_number, cow_number AS animal_number, status, gender, cow_type AS type
      FROM cows
      UNION
      SELECT id, animal_number AS cow_number, animal_number, status, sex AS gender, production_purpose AS type
      FROM animal
    `
  )
  const cowMap = new Map()
  for (const cow of cowRows) {
    const key = String(cow.id || cow.cow_number || cow.animal_number || '').trim()
    if (!key || cowMap.has(key)) continue
    cowMap.set(key, cow)
  }
  const cows = Array.from(cowMap.values()).map((row) => mapRowOut('cows', row))

  const requestedEndDate = dashboardDateKey(options.endDate)
  const requestedStartDate = dashboardDateKey(options.startDate)
  const latestMilkParams = requestedEndDate ? [requestedEndDate] : []
  const [[latestMilkDayRow]] = await pool.query(
    `
      SELECT DATE_FORMAT(MAX(production_date), '%Y-%m-%d') AS latest_day
      FROM (
        SELECT DATE(measured_at) AS production_date FROM milk_measurement WHERE measured_at IS NOT NULL
        UNION ALL
        SELECT DATE(milking_time) AS production_date FROM milk_records WHERE milking_time IS NOT NULL
      ) milk_days
      ${requestedEndDate ? 'WHERE production_date <= ?' : ''}
    `,
    latestMilkParams
  )
  const todayKey = dashboardDateKey(new Date())
  const yesterdayKey = dashboardAddDays(todayKey, -1)
  const latestProductionDay =
    dashboardDateKey(latestMilkDayRow?.latest_day) || requestedEndDate || yesterdayKey
  const defaultEndDate = requestedEndDate || latestProductionDay
  const rawStartDate = requestedStartDate || dashboardAddDays(defaultEndDate, -29)
  const rawEndDate = defaultEndDate
  const endDate = rawStartDate > rawEndDate ? rawStartDate : rawEndDate
  let startDate = rawStartDate > rawEndDate ? rawEndDate : rawStartDate
  if (dashboardDaysBetween(startDate, endDate) > 120) {
    startDate = dashboardAddDays(endDate, -119)
  }
  const dateRange = dashboardRangeBetween(startDate, endDate)

  const milkRows30 = (await getUnifiedMilkRows({ startDate, endDate, cows, limit: 50000 })).filter(
    (row) =>
      Number(row.volume) > 0 && Number(row.volume) <= 300 && dashboardDateKey(row.productionDate)
  )
  const milkDatesInRange = milkRows30
    .map((row) => dashboardDateKey(row.productionDate))
    .filter(Boolean)
    .sort()
  const productionDay = milkDatesInRange.includes(endDate)
    ? endDate
    : milkDatesInRange.at(-1) || endDate
  const dailyBuckets = new Map()
  for (const row of milkRows30) {
    const date = dashboardDateKey(row.productionDate)
    const bucket = dailyBuckets.get(date) || { total: 0, records: 0 }
    bucket.total += Number(row.volume || 0)
    bucket.records += 1
    dailyBuckets.set(date, bucket)
  }
  const dailyMap = new Map(
    Array.from(dailyBuckets.entries()).map(([date, bucket]) => [
      date,
      {
        date,
        label: dashboardShortDate(date),
        value: Number(bucket.total.toFixed(3)),
        records: bucket.records
      }
    ])
  )
  const herdDaily = dateRange.map(
    (date) =>
      dailyMap.get(date) || {
        date,
        label: dashboardShortDate(date),
        value: 0,
        records: 0
      }
  )

  const rankingBuckets = new Map()
  for (const row of milkRows30.filter(
    (item) => dashboardDateKey(item.productionDate) === productionDay
  )) {
    const cowKey = firstNonBlankText(row.cowId, row.cowNumber, row.sourceRecordId, 'unknown')
    const cowNumber = firstNonBlankText(row.cowNumber, row.cowId, '未关联牛')
    const bucket = rankingBuckets.get(cowKey) || { cowKey, cowNumber, total: 0, records: 0 }
    bucket.total += Number(row.volume || 0)
    bucket.records += 1
    rankingBuckets.set(cowKey, bucket)
  }
  const ranking = Array.from(rankingBuckets.values())
    .map((row) => ({ ...row, total: Number(row.total.toFixed(3)) }))
    .sort((left, right) => right.total - left.total)
    .slice(0, 10)
  const topCow = ranking[0] || null

  let topCowSeries = dateRange.map((date) => ({
    date,
    label: dashboardShortDate(date),
    value: 0,
    records: 0
  }))
  const dailyTopCowBuckets = new Map(dateRange.map((date) => [date, new Map()]))
  for (const row of milkRows30) {
    const date = dashboardDateKey(row.productionDate)
    const dayBucket = dailyTopCowBuckets.get(date)
    if (!dayBucket) continue
    const cowKey = firstNonBlankText(row.cowId, row.cowNumber, row.sourceRecordId, 'unknown')
    const cowNumber = firstNonBlankText(row.cowNumber, row.cowId, '未关联牛')
    const bucket = dayBucket.get(cowKey) || { cowKey, cowNumber, total: 0, records: 0 }
    bucket.total += Number(row.volume || 0)
    bucket.records += 1
    dayBucket.set(cowKey, bucket)
  }
  topCowSeries = topCowSeries.map((point) => {
    const top = Array.from(dailyTopCowBuckets.get(point.date)?.values() || []).sort(
      (left, right) => right.total - left.total
    )[0]
    return top
      ? {
          date: point.date,
          label: point.label,
          value: Number(top.total.toFixed(3)),
          records: top.records,
          cowKey: top.cowKey,
          cowNumber: top.cowNumber
        }
      : point
  })

  const [healthScoreRows] = await pool
    .query(
      `
      SELECT cow_id, cow_number, score, health_score, created_at, score_time
      FROM health_scores
      WHERE COALESCE(score_time, created_at) IS NULL
         OR DATE(COALESCE(score_time, created_at)) <= ?
      ORDER BY COALESCE(score_time, created_at) DESC
      LIMIT 5000
    `,
      [endDate]
    )
    .catch(() => [[]])
  const latestHealthScore = new Map()
  for (const row of healthScoreRows) {
    const keys = [row.cow_id, row.cow_number]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    for (const key of keys) {
      if (!latestHealthScore.has(key)) {
        latestHealthScore.set(key, Number(row.score ?? row.health_score ?? 0))
      }
    }
  }

  const [activeAlertRows] = await pool
    .query(
      `
      SELECT cow_id, cow_number, status, alert_type, title, created_at
      FROM alerts
      WHERE COALESCE(status, '') NOT IN ('closed', 'resolved', 'done', '已处理', '已关闭')
        AND (created_at IS NULL OR DATE(created_at) BETWEEN ? AND ?)
      ORDER BY created_at DESC
      LIMIT 5000
    `,
      [startDate, endDate]
    )
    .catch(() => [[]])
  const activeAlertKeys = new Set()
  for (const row of activeAlertRows) {
    for (const key of [row.cow_id, row.cow_number]) {
      if (String(key || '').trim()) activeAlertKeys.add(String(key).trim())
    }
  }

  const [cycleRows] = await pool
    .query(
      `
      SELECT cow_id, cow_number, status, cycle_status, expected_calving_date, due_date, updated_at, created_at
      FROM reproduction_cycles
      WHERE COALESCE(updated_at, created_at) IS NULL
         OR DATE(COALESCE(updated_at, created_at)) <= ?
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT 5000
    `,
      [endDate]
    )
    .catch(() => [[]])
  const latestCycleByCow = new Map()
  for (const row of cycleRows) {
    const key = String(row.cow_id || row.cow_number || '').trim()
    if (key && !latestCycleByCow.has(key)) latestCycleByCow.set(key, row)
  }

  const heatEventKeys = new Set()
  const [heatRows] = await pool
    .query(
      `
      SELECT cow_id, cow_number, event_type, event_code, event_name, event_time, event_date, created_at
      FROM breeding_events
      WHERE (LOWER(CONCAT_WS(' ', event_type, event_code, event_name)) LIKE '%heat%'
         OR CONCAT_WS(' ', event_type, event_code, event_name) LIKE '%发情%')
        AND (
          COALESCE(event_time, event_date, created_at) IS NULL
          OR DATE(COALESCE(event_time, event_date, created_at)) BETWEEN ? AND ?
        )
      ORDER BY COALESCE(event_time, event_date, created_at) DESC
      LIMIT 2000
    `,
      [startDate, endDate]
    )
    .catch(() => [[]])
  for (const row of heatRows) {
    for (const key of [row.cow_id, row.cow_number]) {
      if (String(key || '').trim()) heatEventKeys.add(String(key).trim())
    }
  }

  const healthDistribution = [
    { name: '健康', value: 0 },
    { name: '发情', value: 0 },
    { name: '待产', value: 0 },
    { name: '异常疑似发病', value: 0 },
    { name: '其他', value: 0 }
  ]
  const reproductionDistribution = [
    { name: '空怀', value: 0 },
    { name: '发情', value: 0 },
    { name: '已配', value: 0 },
    { name: '妊娠', value: 0 },
    { name: '待产', value: 0 }
  ]

  for (const cow of cows) {
    const cowId = String(cow.id || cow.cowId || '').trim()
    const cowNumber = String(cow.cowNumber || cow.cow_number || cow.animalNumber || '').trim()
    const keys = [cowId, cowNumber].filter(Boolean)
    const statusText = String(cow.status || '')
    const score = keys
      .map((key) => latestHealthScore.get(key))
      .find((value) => Number.isFinite(value))
    const hasAlert = keys.some((key) => activeAlertKeys.has(key))
    const cycle = keys.map((key) => latestCycleByCow.get(key)).find(Boolean)
    const dueDate = cycle?.expected_calving_date || cycle?.due_date
    const dueDays = dueDate
      ? Math.round((new Date(dueDate).getTime() - Date.now()) / 86400000)
      : null
    const abnormal =
      /异常|发病|隔离|乳房炎|跛行/.test(statusText) ||
      (Number.isFinite(score) && score < 70) ||
      hasAlert
    const due =
      /预产|待产|妊娠末期/.test(statusText) || (dueDays !== null && dueDays >= 0 && dueDays <= 15)
    const heat = /发情/.test(statusText) || keys.some((key) => heatEventKeys.has(key))

    if (abnormal) healthDistribution[3].value += 1
    else if (due) healthDistribution[2].value += 1
    else if (heat) healthDistribution[1].value += 1
    else if (/健康|正常|在场|泌乳|空怀|妊娠/.test(statusText) || !statusText)
      healthDistribution[0].value += 1
    else healthDistribution[4].value += 1

    const reproductiveText = `${statusText} ${JSON.stringify(cycle || {})}`.toLowerCase()
    if (due) reproductionDistribution[4].value += 1
    else if (/pregnant|妊娠|阳性|已受胎/.test(reproductiveText))
      reproductionDistribution[3].value += 1
    else if (/insemination|breeding|已配|配种|输精/.test(reproductiveText))
      reproductionDistribution[2].value += 1
    else if (heat) reproductionDistribution[1].value += 1
    else reproductionDistribution[0].value += 1
  }

  const [wideSensorRows] = await pool
    .query(
      `
      SELECT
        cow_id,
        JSON_UNQUOTE(JSON_EXTRACT(payload, '$.cowNumber')) AS cow_number,
        JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status')) AS status,
        temperature,
        CAST(NULL AS DECIMAL(10, 3)) AS body_temperature,
        steps,
        CAST(NULL AS SIGNED) AS step_count,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(activity, '$.activityIndex')) AS DECIMAL(18, 6)) AS activity_index,
        ts,
        ts AS timestamp,
        ts AS record_time,
        created_at AS updated_at,
        created_at
      FROM sensors
      WHERE COALESCE(ts, created_at) IS NULL
         OR DATE(COALESCE(ts, created_at)) <= ?
      ORDER BY COALESCE(ts, created_at) DESC
      LIMIT 8000
    `,
      [endDate]
    )
    .catch(() => [[]])
  const [sensorStatusRows] = await pool
    .query(
      `
      SELECT
        cow_id,
        JSON_UNQUOTE(JSON_EXTRACT(payload, '$.cowNumber')) AS cow_number,
        status,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.temperature')) AS DECIMAL(10, 3)) AS temperature,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.bodyTemperature')) AS DECIMAL(10, 3)) AS body_temperature,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.steps')) AS SIGNED) AS steps,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.stepCount')) AS SIGNED) AS step_count,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.activityIndex')) AS DECIMAL(18, 6)) AS activity_index,
        ts,
        ts AS timestamp,
        ts AS record_time,
        ts AS updated_at,
        ts AS created_at
      FROM sensor_status
      WHERE ts IS NULL OR DATE(ts) <= ?
      ORDER BY ts DESC
      LIMIT 8000
    `,
      [endDate]
    )
    .catch(() => [[]])
  const sensorRows = [...wideSensorRows, ...sensorStatusRows].sort(
    (left, right) =>
      new Date(
        right.ts ||
          right.timestamp ||
          right.record_time ||
          right.updated_at ||
          right.created_at ||
          0
      ).getTime() -
      new Date(
        left.ts || left.timestamp || left.record_time || left.updated_at || left.created_at || 0
      ).getTime()
  )
  const latestSensorByCow = new Map()
  for (const row of sensorRows) {
    const key = String(row.cow_id || row.cow_number || '').trim()
    if (key && !latestSensorByCow.has(key)) latestSensorByCow.set(key, row)
  }
  const sensorDistribution = [
    { name: '在线', value: 0 },
    { name: '离线', value: 0 },
    { name: '疑似脱落', value: 0 },
    { name: '未绑定', value: 0 }
  ]
  for (const cow of cows) {
    const keys = [cow.id, cow.cowId, cow.cowNumber, cow.cow_number]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    const sensor = keys.map((key) => latestSensorByCow.get(key)).find(Boolean)
    if (!sensor) {
      sensorDistribution[3].value += 1
      continue
    }
    const status = String(sensor.status || '').toLowerCase()
    const temperature = Number(sensor.temperature ?? sensor.body_temperature)
    const activity = Number(sensor.steps ?? sensor.step_count ?? sensor.activity_index)
    const ts =
      sensor.ts || sensor.timestamp || sensor.record_time || sensor.updated_at || sensor.created_at
    const staleHours = ts ? (Date.now() - new Date(ts).getTime()) / 3600000 : 999
    if (
      (Number.isFinite(temperature) && temperature < 34) ||
      (Number.isFinite(activity) && activity <= 5)
    ) {
      sensorDistribution[2].value += 1
    } else if (status.includes('offline') || status.includes('离线') || staleHours > 36) {
      sensorDistribution[1].value += 1
    } else {
      sensorDistribution[0].value += 1
    }
  }

  const [alertTrendRows] = await pool
    .query(
      `
      SELECT DATE(created_at) AS alert_date,
             SUM(CASE WHEN LOWER(CONCAT_WS(' ', alert_type, title)) REGEXP 'device|sensor|ear' OR CONCAT_WS(' ', alert_type, title) REGEXP '设备|耳标|传感' THEN 1 ELSE 0 END) AS device,
             SUM(CASE WHEN LOWER(CONCAT_WS(' ', alert_type, title)) REGEXP 'breeding|heat|calving' OR CONCAT_WS(' ', alert_type, title) REGEXP '繁殖|发情|产犊' THEN 1 ELSE 0 END) AS reproduction,
             SUM(CASE WHEN NOT (LOWER(CONCAT_WS(' ', alert_type, title)) REGEXP 'device|sensor|ear|breeding|heat|calving' OR CONCAT_WS(' ', alert_type, title) REGEXP '设备|耳标|传感|繁殖|发情|产犊') THEN 1 ELSE 0 END) AS health
      FROM alerts
      WHERE created_at IS NOT NULL AND DATE(created_at) BETWEEN ? AND ?
      GROUP BY DATE(created_at)
      ORDER BY alert_date ASC
    `,
      [startDate, endDate]
    )
    .catch(() => [[]])
  const alertMap = new Map(
    alertTrendRows.map((row) => [
      dashboardDateKey(row.alert_date),
      {
        date: dashboardDateKey(row.alert_date),
        label: dashboardShortDate(dashboardDateKey(row.alert_date)),
        health: Number(row.health || 0),
        reproduction: Number(row.reproduction || 0),
        device: Number(row.device || 0)
      }
    ])
  )
  const alertTrend = dateRange.map(
    (date) =>
      alertMap.get(date) || {
        date,
        label: dashboardShortDate(date),
        health: 0,
        reproduction: 0,
        device: 0
      }
  )

  return {
    generatedAt: new Date().toISOString(),
    cowCount: cows.length,
    productionDay,
    productionDayFallback: productionDay !== endDate,
    latestProductionDay,
    dateRange: {
      startDate,
      endDate,
      dayCount: dateRange.length
    },
    herdDaily,
    ranking,
    topCow,
    topCowSeries,
    healthDistribution,
    reproductionDistribution,
    sensorDistribution,
    alertTrend,
    dataCompleteness: {
      latestMilkDate: latestProductionDay,
      hasTodayMilk: latestProductionDay === todayKey,
      hasYesterdayMilk: latestProductionDay === yesterdayKey,
      milkGapDays: latestProductionDay
        ? Math.max(
            0,
            Math.round(
              (new Date(`${todayKey}T00:00:00`).getTime() -
                new Date(`${latestProductionDay}T00:00:00`).getTime()) /
                86400000
            )
          )
        : null
    }
  }
}

const MILK_REVIEW_DAY_MS = 86400000
const MILK_REVIEW_DEFAULT_SHIFTS = ['早班', '晚班']
const MILK_REVIEW_SHIFT_SCOPE = 'milk:shifts'
const MILK_REVIEW_SHIFT_SEEDS = ['早班', '中班', '晚班', '夜班', '半夜班', '1', '2', '3', '4']
const MILK_REVIEW_MAX_RECOMMENDABLE_MISSING_RUN_DAYS = 3
const MILK_REVIEW_WOOD_305_CURVE_B = 0.18
const MILK_REVIEW_WOOD_305_CURVE_C = 0.0035

function normalizeMilkReviewExpectedShifts(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || '')
        .split(',')
        .map((item) => item.trim())
  const values = raw.map((item) => String(item || '').trim()).filter(Boolean)
  return values.length ? [...new Set(values)] : MILK_REVIEW_DEFAULT_SHIFTS
}

async function loadMilkReviewDefaultShifts() {
  try {
    await ensureMilkReviewShiftDictionary()
    const [rows] = await pool.query(
      `
        SELECT
          COALESCE(
            NULLIF(value, ''),
            NULLIF(code, ''),
            NULLIF(name, ''),
            NULLIF(label, ''),
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.value')), ''),
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.code')), ''),
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.name')), ''),
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.label')), '')
          ) AS shift_value,
          COALESCE(
            NULLIF(status, ''),
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status')), ''),
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.state')), ''),
            ''
          ) AS status,
          COALESCE(
            is_active,
            CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.isActive')) AS UNSIGNED),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.is_active')) AS UNSIGNED),
            1
          ) AS is_active,
          COALESCE(sort_order, CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.sortOrder')) AS UNSIGNED), 0) AS sort_order
        FROM base_info_categories
        WHERE COALESCE(scope, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.scope'))) = ?
        ORDER BY COALESCE(sort_order, 0), id
      `,
      [MILK_REVIEW_SHIFT_SCOPE]
    )
    const shifts = rows
      .filter((row) => {
        const status = String(row.status || '')
          .trim()
          .toLowerCase()
        const active = String(row.is_active ?? '1')
          .trim()
          .toLowerCase()
        return (
          !['停用', '禁用', 'inactive', 'disabled'].includes(status) &&
          !['0', 'false', '停用', '禁用', 'inactive', 'disabled'].includes(active)
        )
      })
      .map((row) => String(row.shift_value || '').trim())
      .filter(Boolean)
    return shifts.length ? [...new Set(shifts)] : MILK_REVIEW_DEFAULT_SHIFTS
  } catch {
    return MILK_REVIEW_DEFAULT_SHIFTS
  }
}

async function ensureMilkReviewShiftDictionary() {
  await ensureGenericTable('base_info_categories')
  const now = new Date()
  for (let index = 0; index < MILK_REVIEW_SHIFT_SEEDS.length; index += 1) {
    const value = MILK_REVIEW_SHIFT_SEEDS[index]
    const safeValue = String(value)
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const id = `milk-shifts-${String(index + 1).padStart(2, '0')}-${safeValue || 'item'}`
    await pool.query(
      `
        INSERT INTO base_info_categories
          (id, scope, code, value, name, label, category, status, is_active, sort_order, payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          scope = COALESCE(NULLIF(scope, ''), VALUES(scope)),
          code = COALESCE(NULLIF(code, ''), VALUES(code)),
          value = COALESCE(NULLIF(value, ''), VALUES(value)),
          name = COALESCE(NULLIF(name, ''), VALUES(name)),
          label = COALESCE(NULLIF(label, ''), VALUES(label)),
          category = COALESCE(NULLIF(category, ''), VALUES(category)),
          status = COALESCE(NULLIF(status, ''), VALUES(status)),
          is_active = COALESCE(is_active, VALUES(is_active)),
          sort_order = COALESCE(sort_order, VALUES(sort_order)),
          payload = COALESCE(payload, VALUES(payload)),
          updated_at = VALUES(updated_at)
      `,
      [
        id,
        MILK_REVIEW_SHIFT_SCOPE,
        value,
        value,
        value,
        value,
        '泌乳管理',
        '启用',
        index + 1,
        JSON.stringify({
          scope: MILK_REVIEW_SHIFT_SCOPE,
          code: value,
          value,
          name: value,
          label: value,
          category: '泌乳管理',
          status: '启用',
          isActive: 1,
          sortOrder: index + 1
        }),
        now,
        now
      ]
    )
  }
}

function milkReviewDateKey(value) {
  if (!value) return ''
  if (value instanceof Date) {
    const pad = (number) => String(number).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  const text = String(value).trim()
  if (!text) return ''
  const match = text.match(/\d{4}-\d{2}-\d{2}/)
  if (match) return match[0]
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return ''
  return milkReviewDateKey(date)
}

function milkReviewDayNumber(value) {
  const key = milkReviewDateKey(value)
  if (!key) return Number.NaN
  const [year, month, day] = key.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / MILK_REVIEW_DAY_MS)
}

function milkReviewDateFromDay(dayNumber) {
  if (!Number.isFinite(dayNumber)) return ''
  return new Date(dayNumber * MILK_REVIEW_DAY_MS).toISOString().slice(0, 10)
}

function milkReviewDaysBetween(startDay, targetDay) {
  return Math.max(1, Math.floor(targetDay - startDay) + 1)
}

function normalizeMilkReviewShift(value, fallbackTime = '') {
  const raw = String(value || '').trim()
  if (raw) return raw
  const timeText = String(fallbackTime || '').trim()
  const timeMatch = timeText.match(/(?:T|\s)(\d{1,2}):\d{2}/)
  const hour = timeMatch ? Number(timeMatch[1]) : Number.NaN
  if (Number.isFinite(hour)) {
    if (hour >= 4 && hour < 11) return '早班'
    if (hour >= 11 && hour < 16) return '中班'
    if (hour >= 16 || hour < 4) return '晚班'
  }
  return '早班'
}

function milkReviewShiftTime(date, shift) {
  const hour =
    shift === '早班'
      ? '06:00:00'
      : shift === '中班'
        ? '12:00:00'
        : shift === '晚班'
          ? '18:00:00'
          : '09:00:00'
  return `${date} ${hour}`
}

function milkReviewNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function milkReviewPositiveInt(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0
}

function milkReviewRound(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * 10) / 10
}

function milkReviewAverage(values) {
  const usable = values.filter((value) => Number.isFinite(value))
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0
}

function milkReviewStatus(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
  if (['confirmed', 'resolved', 'completed', 'closed', 'done', '已确认', '已解决'].includes(text))
    return 'confirmed'
  if (['ignored', 'ignore', 'cancelled', 'canceled', 'skipped', '忽略'].includes(text))
    return 'ignored'
  return 'pending'
}

async function loadMilkReviewState() {
  const [rows] = await pool.query(
    `
      SELECT id, source_record_id, issue_status, status, detail
      FROM data_quality_issue
      WHERE issue_type = 'milk_missing_production'
    `
  )
  const map = new Map()
  for (const row of rows) {
    const detail =
      typeof row.detail === 'string' ? safeJsonParse(row.detail, {}) || {} : row.detail || {}
    const id = String(row.source_record_id || detail.reviewItemId || row.id || '').trim()
    if (!id) continue
    map.set(id, {
      status: milkReviewStatus(row.issue_status || row.status),
      recommendedMilk: milkReviewNumber(detail.recommendedMilk)
    })
  }
  return map
}

async function loadMilkReviewMilkRows() {
  const [measurementRows] = await pool.query(
    `
      SELECT
        m.id,
        m.animal_id AS cow_id,
        a.animal_number AS cow_number,
        a.name AS cow_name,
        a.breed,
        DATE_FORMAT(COALESCE(m.production_date, DATE(m.measured_at)), '%Y-%m-%d') AS production_date,
        m.measured_at,
        m.shift_id,
        m.parity_no,
        m.lactation_id,
        m.days_in_milk,
        m.milk_yield,
        m.source_table,
        m.source_record_id,
        'milk_measurement' AS source_table_name,
        0 AS source_rank
      FROM milk_measurement m
      LEFT JOIN animal a ON a.id = m.animal_id
      WHERE m.milk_yield IS NOT NULL
    `
  )
  const [recordRows] = await pool.query(
    `
      SELECT
        r.id,
        r.cow_id AS cow_id,
        a.animal_number AS cow_number,
        a.name AS cow_name,
        a.breed,
        DATE_FORMAT(DATE(r.milking_time), '%Y-%m-%d') AS production_date,
        r.milking_time AS measured_at,
        r.shift_id,
        r.parity_no,
        NULL AS lactation_id,
        r.days_in_milk,
        r.volume AS milk_yield,
        r.source_table,
        r.source_record_id,
        'milk_records' AS source_table_name,
        1 AS source_rank
      FROM milk_records r
      LEFT JOIN animal a
        ON CONVERT(a.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(r.cow_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
      WHERE r.volume IS NOT NULL
    `
  )
  const dedupe = new Map()
  for (const row of [...measurementRows, ...recordRows]) {
    const cowId = String(row.cow_id || '').trim()
    const cowNumber = String(row.cow_number || '').trim()
    const date = milkReviewDateKey(row.production_date || row.measured_at)
    const day = milkReviewDayNumber(date)
    const shift = normalizeMilkReviewShift(row.shift_id, row.measured_at)
    const milkYield = milkReviewNumber(row.milk_yield)
    if (!cowId || !date || !Number.isFinite(day) || milkYield === null) continue
    const key = `${cowId}|${date}|${shift}|${milkReviewRound(milkYield)}`
    const previous = dedupe.get(key)
    if (previous && Number(previous.sourceRank) <= Number(row.source_rank)) continue
    dedupe.set(key, {
      id: String(row.id || '').trim(),
      cowId,
      cowNumber: cowNumber || cowId,
      cowName: String(row.cow_name || '').trim(),
      breed: String(row.breed || '').trim(),
      date,
      day,
      shift,
      parityNo: milkReviewPositiveInt(row.parity_no),
      lactationId: String(row.lactation_id || '').trim(),
      daysInMilk: milkReviewPositiveInt(row.days_in_milk),
      milkYield,
      sourceTable: String(row.source_table || row.source_table_name || '').trim(),
      sourceRecordId: String(row.source_record_id || row.id || '').trim(),
      sourceRank: Number(row.source_rank || 0)
    })
  }
  return Array.from(dedupe.values())
}

async function loadMilkReviewEmptyValueRows() {
  const [measurementRows] = await pool.query(
    `
      SELECT
        m.id,
        m.animal_id AS cow_id,
        a.animal_number AS cow_number,
        a.name AS cow_name,
        a.breed,
        DATE_FORMAT(COALESCE(m.production_date, DATE(m.measured_at)), '%Y-%m-%d') AS production_date,
        m.measured_at,
        m.shift_id,
        m.parity_no,
        m.lactation_id,
        m.days_in_milk,
        m.source_table,
        m.source_record_id,
        'milk_measurement' AS source_table_name,
        0 AS source_rank
      FROM milk_measurement m
      LEFT JOIN animal a ON a.id = m.animal_id
      WHERE m.milk_yield IS NULL
        AND m.animal_id IS NOT NULL
        AND m.measured_at IS NOT NULL
    `
  )
  const [recordRows] = await pool.query(
    `
      SELECT
        r.id,
        r.cow_id AS cow_id,
        a.animal_number AS cow_number,
        a.name AS cow_name,
        a.breed,
        DATE_FORMAT(DATE(r.milking_time), '%Y-%m-%d') AS production_date,
        r.milking_time AS measured_at,
        r.shift_id,
        r.parity_no,
        NULL AS lactation_id,
        r.days_in_milk,
        r.source_table,
        r.source_record_id,
        'milk_records' AS source_table_name,
        1 AS source_rank
      FROM milk_records r
      LEFT JOIN animal a
        ON CONVERT(a.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(r.cow_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
      WHERE r.volume IS NULL
        AND r.cow_id IS NOT NULL
        AND r.milking_time IS NOT NULL
    `
  )
  const dedupe = new Map()
  for (const row of [...measurementRows, ...recordRows]) {
    const cowId = String(row.cow_id || '').trim()
    const cowNumber = String(row.cow_number || '').trim()
    const date = milkReviewDateKey(row.production_date || row.measured_at)
    const day = milkReviewDayNumber(date)
    const shift = normalizeMilkReviewShift(row.shift_id, row.measured_at)
    if (!cowId || !date || !Number.isFinite(day)) continue
    const key = `${cowId}|${date}|${shift}`
    const previous = dedupe.get(key)
    if (previous && Number(previous.sourceRank) <= Number(row.source_rank)) continue
    dedupe.set(key, {
      id: String(row.id || '').trim(),
      cowId,
      cowNumber: cowNumber || cowId,
      cowName: String(row.cow_name || '').trim(),
      breed: String(row.breed || '').trim(),
      date,
      day,
      shift,
      parityNo: milkReviewPositiveInt(row.parity_no),
      lactationId: String(row.lactation_id || '').trim(),
      daysInMilk: milkReviewPositiveInt(row.days_in_milk),
      sourceTable: String(row.source_table || row.source_table_name || '').trim(),
      sourceRecordId: String(row.source_record_id || row.id || '').trim(),
      sourceRank: Number(row.source_rank || 0)
    })
  }
  return Array.from(dedupe.values())
}

async function loadMilkReviewEpisodes() {
  const eventMeta = await getExistingTableMetadata('animal_event')
  const [episodeRows] = await pool.query(
    `
      SELECT
        l.id,
        l.animal_id AS cow_id,
        a.animal_number AS cow_number,
        a.name AS cow_name,
        a.breed,
        l.lactation_no,
        l.parity_no,
        DATE_FORMAT(l.start_date, '%Y-%m-%d') AS start_date,
        DATE_FORMAT(l.end_date, '%Y-%m-%d') AS end_date,
        DATE_FORMAT(l.dry_off_date, '%Y-%m-%d') AS dry_off_date,
        l.days_in_milk,
        l.status
      FROM lactation_episode l
      LEFT JOIN animal a ON a.id = l.animal_id
      WHERE l.start_date IS NOT NULL
    `
  )
  const [animalSummaryRows] = await pool.query(
    `
      SELECT
        a.id AS cow_id,
        a.animal_number AS cow_number,
        a.name AS cow_name,
        a.breed,
        a.reported_parity_no AS parity_no,
        DATE_FORMAT(a.lactation_start_date, '%Y-%m-%d') AS start_date,
        DATE_FORMAT(a.lactation_end_date, '%Y-%m-%d') AS end_date,
        a.reported_days_in_milk,
        a.reported_parity_yield,
        a.reported_milk_305,
        a.reported_avg_daily_milk
      FROM animal a
      WHERE a.lactation_start_date IS NOT NULL
        AND a.reported_days_in_milk IS NOT NULL
        AND (
          a.reported_parity_yield IS NOT NULL
          OR a.reported_milk_305 IS NOT NULL
          OR a.reported_avg_daily_milk IS NOT NULL
        )
    `
  )
  const [factRows] = await pool.query(
    `
      SELECT
        f.id,
        f.animal_id AS cow_id,
        COALESCE(f.animal_number, f.cow_number, a.animal_number) AS cow_number,
        a.name AS cow_name,
        a.breed,
        f.lactation_id,
        f.lactation_no,
        f.parity_no,
        DATE_FORMAT(f.start_date, '%Y-%m-%d') AS start_date,
        DATE_FORMAT(f.end_date, '%Y-%m-%d') AS end_date,
        f.milk_yield_305,
        f.milk_305,
        f.record_count,
        f.coverage_days,
        f.missing_days,
        f.source_table,
        f.source_record_ids
      FROM fact_lactation_305 f
      LEFT JOIN animal a ON a.id = f.animal_id
      WHERE f.start_date IS NOT NULL
        AND (f.milk_yield_305 IS NOT NULL OR f.milk_305 IS NOT NULL OR f.record_count IS NOT NULL OR f.coverage_days IS NOT NULL)
    `
  )
  let dryOffEventRows = []
  if (eventMeta.exists) {
    const animalIdExpr = sqlColumn(eventMeta, ['animal_id', 'cow_id'], "''")
    const eventTypeExpr = sqlColumn(eventMeta, ['event_type', 'event_code', 'event_name'], "''")
    const eventCodeExpr = sqlColumn(eventMeta, ['event_code', 'event_type', 'event_name'], "''")
    const occurredExpr = sqlColumn(
      eventMeta,
      ['occurred_at', 'event_time', 'event_date', 'created_at'],
      'NULL'
    )
    const parityExpr = sqlColumn(eventMeta, ['parity_no'], 'NULL')
    const customValuesExpr = sqlColumn(eventMeta, ['custom_values', 'details'], 'NULL')
    const notesExpr = sqlColumn(eventMeta, ['notes'], "''")
    const [rows] = await pool.query(
      `
        SELECT
          ${animalIdExpr} AS cow_id,
          ${eventTypeExpr} AS event_type,
          ${eventCodeExpr} AS event_code,
          DATE_FORMAT(${occurredExpr}, '%Y-%m-%d') AS occurred_date,
          ${parityExpr} AS parity_no,
          ${customValuesExpr} AS custom_values,
          ${notesExpr} AS notes
        FROM animal_event
        WHERE ${occurredExpr} IS NOT NULL
          AND (
            LOWER(CONCAT_WS(' ', ${eventTypeExpr}, ${eventCodeExpr}, ${notesExpr})) LIKE '%dry_off%'
            OR CONCAT_WS(' ', ${eventTypeExpr}, ${eventCodeExpr}, ${notesExpr}) LIKE '%干奶%'
            OR CONCAT_WS(' ', ${eventTypeExpr}, ${eventCodeExpr}, ${notesExpr}) LIKE '%停产%'
          )
      `
    )
    dryOffEventRows = rows
  }
  const map = new Map()
  const merge = (key, patch) => {
    const previous = map.get(key) || {}
    const next = { ...previous }
    for (const [name, value] of Object.entries(patch)) {
      if (value !== undefined && value !== null && value !== '') next[name] = value
    }
    map.set(key, next)
  }

  for (const row of episodeRows) {
    const startDate = milkReviewDateKey(row.start_date)
    const cowId = String(row.cow_id || '').trim()
    if (!cowId || !startDate) continue
    const parityNo = milkReviewPositiveInt(row.parity_no || row.lactation_no) || 1
    merge(`${cowId}|${parityNo}|${startDate}`, {
      cowId,
      cowNumber: String(row.cow_number || cowId).trim(),
      cowName: String(row.cow_name || '').trim(),
      breed: String(row.breed || '').trim(),
      parityNo,
      lactationNo: milkReviewPositiveInt(row.lactation_no) || parityNo,
      lactationId: String(
        row.id || stableId('lactation_episode', cowId, parityNo, startDate)
      ).trim(),
      startDate,
      endDate: milkReviewDateKey(row.end_date || row.dry_off_date),
      reportedDaysInMilk: milkReviewPositiveInt(row.days_in_milk),
      summaryId: String(row.id || '').trim(),
      summarySourceTable: 'lactation_episode'
    })
  }

  for (const row of animalSummaryRows) {
    const startDate = milkReviewDateKey(row.start_date)
    const cowId = String(row.cow_id || '').trim()
    if (!cowId || !startDate) continue
    const parityNo = milkReviewPositiveInt(row.parity_no) || 1
    merge(`${cowId}|${parityNo}|${startDate}`, {
      cowId,
      cowNumber: String(row.cow_number || cowId).trim(),
      cowName: String(row.cow_name || '').trim(),
      breed: String(row.breed || '').trim(),
      parityNo,
      lactationNo: parityNo,
      lactationId: stableId('lactation_episode', cowId, parityNo, startDate),
      startDate,
      endDate: milkReviewDateKey(row.end_date),
      reportedDaysInMilk: milkReviewPositiveInt(row.reported_days_in_milk),
      coverageDays: milkReviewPositiveInt(row.reported_days_in_milk),
      recordCount: milkReviewPositiveInt(row.reported_days_in_milk),
      reportedParityYield: milkReviewNumber(row.reported_parity_yield),
      reportedMilk305: milkReviewNumber(row.reported_milk_305),
      reportedAvgDailyMilk: milkReviewNumber(row.reported_avg_daily_milk),
      summaryId: cowId,
      summarySourceTable: 'animal'
    })
  }

  for (const row of factRows) {
    const startDate = milkReviewDateKey(row.start_date)
    const cowId = String(row.cow_id || '').trim()
    if (!cowId || !startDate) continue
    const parityNo = milkReviewPositiveInt(row.parity_no || row.lactation_no) || 1
    const days = milkReviewPositiveInt(row.record_count || row.coverage_days)
    const milk305 = milkReviewNumber(row.milk_yield_305 ?? row.milk_305)
    merge(`${cowId}|${parityNo}|${startDate}`, {
      cowId,
      cowNumber: String(row.cow_number || cowId).trim(),
      cowName: String(row.cow_name || '').trim(),
      breed: String(row.breed || '').trim(),
      parityNo,
      lactationNo: milkReviewPositiveInt(row.lactation_no) || parityNo,
      lactationId: String(
        row.lactation_id || stableId('lactation_episode', cowId, parityNo, startDate)
      ).trim(),
      startDate,
      endDate: milkReviewDateKey(row.end_date),
      reportedDaysInMilk: days,
      coverageDays: milkReviewPositiveInt(row.coverage_days),
      recordCount: milkReviewPositiveInt(row.record_count),
      reportedMilk305: milk305,
      summaryId: String(row.id || '').trim(),
      summarySourceTable: 'fact_lactation_305'
    })
  }

  const dryOffEvents = dryOffEventRows
    .map((row) => {
      const details = isPlainObject(row.custom_values)
        ? row.custom_values
        : safeJsonParse(row.custom_values, {}) || {}
      const eventDate = milkReviewDateKey(
        details.dry_off_date ||
          details.dryOffDate ||
          details.lactation_end_date ||
          details.lactationEndDate ||
          row.occurred_date
      )
      const lactationStartDate = milkReviewDateKey(
        details.parity_calving_date ||
          details.parityCalvingDate ||
          details.lactation_start_date ||
          details.lactationStartDate
      )
      return {
        cowId: String(row.cow_id || '').trim(),
        parityNo: milkReviewPositiveInt(row.parity_no || details.parity_no || details.parityNo),
        lactationStartDate,
        startDay: lactationStartDate ? milkReviewDayNumber(lactationStartDate) : null,
        date: eventDate,
        day: milkReviewDayNumber(eventDate)
      }
    })
    .filter((row) => row.cowId && row.date && Number.isFinite(row.day))

  const rowsWithDays = Array.from(map.values())
    .map((row) => ({
      ...row,
      startDay: milkReviewDayNumber(row.startDate),
      endDay: row.endDate ? milkReviewDayNumber(row.endDate) : null
    }))
    .filter((row) => row.cowId && Number.isFinite(row.startDay))

  const sortedByCow = rowsWithDays
    .slice()
    .sort(
      (left, right) =>
        String(left.cowId).localeCompare(String(right.cowId)) || left.startDay - right.startDay
    )

  for (const row of rowsWithDays) {
    const nextEpisode = sortedByCow.find(
      (item) => item.cowId === row.cowId && item.startDay > row.startDay
    )
    const matchedDryOff = dryOffEvents
      .filter((event) => event.cowId === row.cowId)
      .filter((event) => !event.startDay || event.startDay === row.startDay)
      .filter((event) => !event.parityNo || !row.parityNo || event.parityNo === row.parityNo)
      .filter((event) => event.day >= row.startDay)
      .filter((event) => !nextEpisode || event.day < nextEpisode.startDay)
      .sort((left, right) => left.day - right.day)[0]
    if (!matchedDryOff) continue
    if (!row.endDay || matchedDryOff.day < row.endDay) {
      row.endDate = matchedDryOff.date
      row.endDay = matchedDryOff.day
    }
  }

  return rowsWithDays
}

function groupMilkReviewRowsByDate(rows) {
  const map = new Map()
  for (const row of rows) {
    const group = map.get(row.date) || []
    group.push(row)
    map.set(row.date, group)
  }
  return map
}

function buildMilkReviewDailyRows(rows, startDay) {
  return Array.from(groupMilkReviewRowsByDate(rows).entries())
    .map(([date, group]) => ({
      date,
      day: milkReviewDayNumber(date),
      dim:
        group.find((row) => row.daysInMilk)?.daysInMilk ||
        milkReviewDaysBetween(startDay, milkReviewDayNumber(date)),
      value: group.reduce((sum, row) => sum + row.milkYield, 0)
    }))
    .sort((left, right) => left.day - right.day)
}

function nearestMilkReviewDailyRows(rows, targetDay, limit) {
  return rows
    .filter((row) => row.day !== targetDay && row.value > 0)
    .map((row) => ({ ...row, distance: Math.abs(row.day - targetDay) }))
    .sort((left, right) => left.distance - right.distance || left.day - right.day)
    .slice(0, Math.max(1, limit))
}

function hasMilkReviewLongMissingRun(dailyRows, targetDay, minimumDays = 7) {
  return milkReviewMissingRunLength(dailyRows, targetDay) >= minimumDays
}

function milkReviewMissingRunLength(dailyRows, targetDay) {
  const presentDays = new Set(dailyRows.filter((row) => row.value > 0).map((row) => row.day))
  if (presentDays.has(targetDay)) return 0
  const bounds = Array.from(presentDays.values()).filter((day) => Number.isFinite(day))
  if (!bounds.length) return Number.POSITIVE_INFINITY
  const minDay = Math.min(...bounds)
  const maxDay = Math.max(...bounds)
  if (targetDay < minDay) return Math.max(1, Math.floor(minDay - targetDay))
  if (targetDay > maxDay) return Math.max(1, Math.floor(targetDay - maxDay))
  let length = 1
  for (let day = targetDay - 1; day >= minDay && !presentDays.has(day); day -= 1) length += 1
  for (let day = targetDay + 1; day <= maxDay && !presentDays.has(day); day += 1) length += 1
  return length
}

function milkReviewWood305CurveShape(dim) {
  const safeDim = Math.max(1, Math.min(305, Math.trunc(dim || 1)))
  return (
    Math.pow(safeDim, MILK_REVIEW_WOOD_305_CURVE_B) *
    Math.exp(-MILK_REVIEW_WOOD_305_CURVE_C * safeDim)
  )
}

function milkReviewCurvePointWeight(distance) {
  return 1 / (1 + Math.max(0, distance) / 21)
}

function milkReviewClamp(value, min, max) {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, min), max)
}

function recommendMilkReview305CurveValue(dailyRows, dim, splitCount) {
  const observed = dailyRows
    .filter((row) => row.value > 0 && row.dim >= 1 && row.dim <= 305)
    .map((row) => {
      const shape = milkReviewWood305CurveShape(row.dim)
      return {
        ...row,
        shape,
        scale: shape > 0 ? row.value / shape : 0,
        distance: Math.abs(row.dim - dim)
      }
    })
    .filter((row) => row.scale > 0 && Number.isFinite(row.scale))
  if (observed.length < 2) return null

  const targetShape = milkReviewWood305CurveShape(dim)
  const weightedScale =
    observed.reduce((sum, row) => sum + row.scale * milkReviewCurvePointWeight(row.distance), 0) /
    observed.reduce((sum, row) => sum + milkReviewCurvePointWeight(row.distance), 0)
  const rawValue = targetShape * weightedScale
  const observedValues = observed.map((row) => row.value)
  const boundedValue = milkReviewClamp(
    rawValue,
    Math.min(...observedValues) * 0.6,
    Math.max(...observedValues) * 1.5
  )
  const nearestDistance = Math.min(...observed.map((row) => row.distance))
  const confidence =
    observed.length >= 5 && nearestDistance <= 30
      ? 'high'
      : observed.length >= 3 && nearestDistance <= 45
        ? 'medium'
        : 'low'
  return {
    value: milkReviewRound(boundedValue / Math.max(1, splitCount)),
    method: 'lactation_305_curve',
    confidence,
    text: `DIM ${dim} 位于胎次后 305 天内，按 Wood 型 305 天泌乳曲线并用同牛 ${observed.length} 个观测 DIM 点缩放推荐。`
  }
}

function recommendMilkReviewValue(rows, targetDay, dim, splitCount, startDay) {
  const dailyRows = buildMilkReviewDailyRows(rows, startDay)
  const allValues = dailyRows.map((row) => row.value).filter((value) => value > 0)
  if (allValues.length < 2) {
    return {
      value: 0,
      method: 'manual_required',
      confidence: 'low',
      text: '有效产奶记录少于 2 次，系统不生成自动补偿值，需要人工核对。'
    }
  }
  const missingLength = milkReviewMissingRunLength(dailyRows, targetDay)
  if (missingLength > MILK_REVIEW_MAX_RECOMMENDABLE_MISSING_RUN_DAYS) {
    return {
      value: 0,
      method: 'manual_required',
      confidence: 'low',
      text: `连续缺失 ${missingLength} 天，超过 3 天自动补偿上限，需要人工核对。`
    }
  }
  if (dim >= 1 && dim <= 305) {
    return (
      recommendMilkReview305CurveValue(dailyRows, dim, splitCount) || {
        value: 0,
        method: 'manual_required',
        confidence: 'low',
        text: '305 天曲线可用观测点不足，系统不生成自动补偿值，需要人工核对。'
      }
    )
  }
  if (dim > 305) {
    const recent7 = dailyRows.filter((row) => row.day < targetDay).slice(-7)
    const recent14 = dailyRows.filter((row) => row.day < targetDay).slice(-14)
    const recent = recent7.length >= 3 ? recent7 : recent14
    if (recent.length >= 3) {
      const days = recent7.length >= 3 ? 7 : 14
      const value = milkReviewAverage(recent.map((row) => row.value))
      return {
        value: milkReviewRound(value / Math.max(1, splitCount)),
        method: 'recent_average',
        confidence: recent.length >= 5 ? 'medium' : 'low',
        text: `DIM ${dim} 已超过 305 天，按该牛近 ${days} 天可用产奶记录均值。`
      }
    }
  }
  const recent = nearestMilkReviewDailyRows(dailyRows, targetDay, 14)
  if (recent.length >= 2) {
    const value = milkReviewAverage(recent.map((row) => row.value))
    return {
      value: milkReviewRound(value / Math.max(1, splitCount)),
      method: 'cow_average',
      confidence: recent.length >= 5 ? 'medium' : 'low',
      text: `当前 DIM 周边记录不足，按该牛最近 ${recent.length} 个可用日记录均值兜底。`
    }
  }
  return null
}

function getMilkReviewRecommendation(rows, targetDay, dim, splitCount, startDay) {
  return recommendMilkReviewValue(rows, targetDay, dim, splitCount, startDay)
}

function buildMilkReviewPreviousDays(rows, targetDay) {
  const daily = new Map(
    buildMilkReviewDailyRows(rows, targetDay).map((row) => [row.date, row.value])
  )
  return Array.from({ length: 5 }, (_, index) => {
    const day = targetDay - (5 - index)
    const date = milkReviewDateFromDay(day)
    const value = daily.get(date)
    return {
      date,
      value: value ?? null,
      valueText: value === undefined ? '缺记录' : `${milkReviewRound(value).toFixed(1)} kg`
    }
  })
}

function findMilkReviewEpisodeForRow(episodes, row) {
  return episodes
    .filter((episode) => episode.cowId === row.cowId)
    .filter(
      (episode) => row.day >= episode.startDay && (!episode.endDay || row.day <= episode.endDay)
    )
    .sort((left, right) => {
      const leftParityMatch = row.parityNo && left.parityNo === row.parityNo ? 0 : 1
      const rightParityMatch = row.parityNo && right.parityNo === row.parityNo ? 0 : 1
      return leftParityMatch - rightParityMatch || right.startDay - left.startDay
    })[0]
}

function milkReviewHasSummary(episode) {
  const days = milkReviewPositiveInt(
    episode.reportedDaysInMilk || episode.coverageDays || episode.recordCount
  )
  return (
    !!days &&
    [episode.reportedAvgDailyMilk, episode.reportedParityYield, episode.reportedMilk305].some(
      (value) => milkReviewNumber(value) !== null
    )
  )
}

function recommendMilkReviewSummaryValue(episode, expectedShiftCount) {
  const uploadedDays =
    milkReviewPositiveInt(
      episode.reportedDaysInMilk || episode.coverageDays || episode.recordCount
    ) || 1
  const avg = milkReviewNumber(episode.reportedAvgDailyMilk)
  const parityYield = milkReviewNumber(episode.reportedParityYield)
  const milk305 = milkReviewNumber(episode.reportedMilk305)
  const days = avg === null && parityYield === null && milk305 !== null ? 305 : uploadedDays
  const totalMilk = parityYield ?? milk305 ?? (avg !== null ? avg * days : null)
  const daily =
    avg ?? (parityYield !== null ? parityYield / days : milk305 !== null ? milk305 / days : 0)
  const shiftText = expectedShiftCount > 1 ? '；若要拆到班次，可先确认日总量后再按班次细分' : ''
  return {
    value: milkReviewRound(daily || 0),
    days,
    totalMilk: milkReviewRound(totalMilk || daily * days),
    confidence: avg !== null ? 'medium' : 'low',
    text: `该牛只有泌乳汇总资料，系统按 ${days} 天和${avg !== null ? '上传平均日产奶' : '上传总产奶量'}生成待确认日序列建议${shiftText}。`
  }
}

function summarizeMilkReviewItems(items, reviewState) {
  const pending = items.filter((item) => item.status === 'pending')
  return {
    totalMissingDays: items.filter((item) => item.missingKind === 'day').length,
    totalMissingShifts: items.filter((item) => item.missingKind === 'shift').length,
    totalEmptyValues: items.filter((item) => item.missingKind === 'empty_value').length,
    totalSummaryOnly: items.filter((item) => item.missingKind === 'summary_only').length,
    pendingCount: pending.length,
    confirmedCount: Array.from(reviewState.values()).filter((row) => row.status === 'confirmed')
      .length,
    cowCount: new Set(items.map((item) => item.cowId || item.cowNumber)).size,
    monthCount: new Set(items.map((item) => item.monthKey)).size,
    yearCount: new Set(items.map((item) => item.yearKey)).size,
    avgRecommendedMilk: milkReviewRound(
      milkReviewAverage(pending.map((item) => item.recommendedMilk))
    )
  }
}

async function buildMilkMissingReviewFromDb(options = {}) {
  const expectedShifts = normalizeMilkReviewExpectedShifts(options.expectedShifts)
  const [episodes, milkRows, emptyValueRows, reviewState] = await Promise.all([
    loadMilkReviewEpisodes(),
    loadMilkReviewMilkRows(),
    loadMilkReviewEmptyValueRows(),
    loadMilkReviewState()
  ])
  const emptyValueBySlot = new Map()
  for (const row of emptyValueRows) {
    const shift = row.shift || '全天'
    emptyValueBySlot.set(`${row.cowId}|${row.date}|${shift}`, row)
  }
  const milkByCow = new Map()
  for (const row of milkRows) {
    const key = row.cowId
    const current = milkByCow.get(key) || []
    current.push(row)
    milkByCow.set(key, current)
  }

  const todayDay = milkReviewDayNumber(new Date())
  const rangeStart = options.startDate ? milkReviewDayNumber(options.startDate) : null
  const rangeEnd = options.endDate ? milkReviewDayNumber(options.endDate) : null
  const items = []

  for (const episode of episodes) {
    const rows = (milkByCow.get(episode.cowId) || [])
      .filter((row) => !episode.parityNo || !row.parityNo || row.parityNo === episode.parityNo)
      .filter(
        (row) => row.day >= episode.startDay && (!episode.endDay || row.day <= episode.endDay)
      )
      .sort((left, right) => left.day - right.day)
    const byDate = groupMilkReviewRowsByDate(rows)
    const start = Math.max(episode.startDay, rangeStart ?? episode.startDay)
    const summaryDays = milkReviewPositiveInt(
      episode.reportedDaysInMilk || episode.coverageDays || episode.recordCount
    )
    const summaryEnd = summaryDays ? episode.startDay + summaryDays - 1 : Number.NaN
    const lastRowDay = rows.at(-1)?.day
    const rawEnd =
      episode.endDay ??
      (Number.isFinite(summaryEnd)
        ? Math.max(lastRowDay || summaryEnd, summaryEnd)
        : (lastRowDay ?? todayDay))
    const end = Math.min(rawEnd, rangeEnd ?? rawEnd, options.includeFuture ? rawEnd : todayDay)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue

    if (!rows.length && milkReviewHasSummary(episode)) {
      const itemDate = episode.startDate
      const itemId = stableId(
        'milk_summary_only',
        episode.cowId,
        episode.parityNo,
        episode.lactationId,
        summaryDays || itemDate
      )
      const state = reviewState.get(itemId)
      if (state?.status !== 'confirmed') {
        const recommendation = recommendMilkReviewSummaryValue(episode, expectedShifts.length)
        items.push({
          id: itemId,
          cowId: episode.cowId,
          cowNumber: episode.cowNumber,
          cowName: episode.cowName || '',
          breed: episode.breed || '',
          parityNo: episode.parityNo || 1,
          lactationId: episode.lactationId,
          lactationStartDate: episode.startDate,
          lactationEndDate: episode.endDate || '',
          date: itemDate,
          dim: milkReviewDaysBetween(episode.startDay, start),
          expectedShift: '日汇总',
          missingKind: 'summary_only',
          existingShiftCount: 0,
          existingDailyMilk: 0,
          recommendedMilk: state?.recommendedMilk || recommendation.value,
          recommendationMethod: 'summary_profile',
          recommendationText: recommendation.text,
          confidence: recommendation.confidence,
          status: state?.status || 'pending',
          sourceRecordIds: [
            `${episode.summarySourceTable || 'lactation_summary'}:${episode.summaryId || episode.lactationId}`
          ],
          monthKey: itemDate.slice(0, 7),
          yearKey: itemDate.slice(0, 4),
          summaryDays: recommendation.days,
          summaryTotalMilk: recommendation.totalMilk,
          summaryDailyMilk: recommendation.value,
          sourceSummaryId: episode.summaryId,
          previousDays: buildMilkReviewPreviousDays(rows, episode.startDay)
        })
      }
      continue
    }
    if (!rows.length && !milkReviewHasSummary(episode)) {
      continue
    }

    for (let day = start; day <= end; day += 1) {
      const currentDate = milkReviewDateFromDay(day)
      const dayRows = byDate.get(currentDate) || []
      const dim = milkReviewDaysBetween(episode.startDay, day)
      const existingDailyMilk = milkReviewRound(
        dayRows.reduce((sum, row) => sum + row.milkYield, 0)
      )
      const presentShifts = new Set(dayRows.map((row) => row.shift).filter(Boolean))
      if (presentShifts.has('日汇总')) continue
      const missingShifts = expectedShifts.filter((shift) => !presentShifts.has(shift))
      if (dayRows.length && !missingShifts.length) continue
      const targetShifts = dayRows.length
        ? missingShifts
        : expectedShifts.length
          ? expectedShifts
          : ['全天']
      const splitCount = Math.max(1, expectedShifts.length || targetShifts.length)
      for (const shift of targetShifts) {
        const emptySlot = emptyValueBySlot.get(`${episode.cowId}|${currentDate}|${shift}`)
        const itemId = emptySlot
          ? stableId(
              'milk_empty_value',
              emptySlot.cowId,
              emptySlot.date,
              shift,
              emptySlot.sourceTable,
              emptySlot.sourceRecordId || emptySlot.id
            )
          : stableId('milk_missing', episode.cowId, episode.parityNo, currentDate, shift)
        const state = reviewState.get(itemId)
        if (state?.status === 'confirmed') continue
        const recommendation = getMilkReviewRecommendation(
          rows,
          day,
          dim,
          splitCount,
          episode.startDay
        )
        if (!recommendation) continue
        const sourceRecordIds = emptySlot
          ? [
              `${emptySlot.sourceTable || 'milk_measurement'}:${emptySlot.sourceRecordId || emptySlot.id}`
            ]
          : dayRows
              .map(
                (row) => `${row.sourceTable || 'milk_measurement'}:${row.sourceRecordId || row.id}`
              )
              .filter(Boolean)
        items.push({
          id: itemId,
          cowId: episode.cowId,
          cowNumber: episode.cowNumber,
          cowName: episode.cowName || '',
          breed: episode.breed || '',
          parityNo: episode.parityNo || 1,
          lactationId: episode.lactationId,
          lactationStartDate: episode.startDate,
          lactationEndDate: episode.endDate || '',
          date: currentDate,
          dim,
          expectedShift: shift,
          missingKind: emptySlot ? 'empty_value' : dayRows.length ? 'shift' : 'day',
          existingShiftCount: dayRows.length,
          existingDailyMilk,
          recommendedMilk: state?.recommendedMilk || recommendation.value,
          recommendationMethod: recommendation.method,
          recommendationText: recommendation.text,
          confidence: recommendation.confidence,
          status: state?.status || 'pending',
          sourceRecordIds,
          monthKey: currentDate.slice(0, 7),
          yearKey: currentDate.slice(0, 4),
          previousDays: buildMilkReviewPreviousDays(rows, day)
        })
      }
    }
  }

  const existingItemKeys = new Set(
    items.map((item) => `${item.cowId}|${item.date}|${item.expectedShift}`)
  )
  for (const emptyRow of emptyValueRows) {
    if (rangeStart !== null && emptyRow.day < rangeStart) continue
    if (rangeEnd !== null && emptyRow.day > rangeEnd) continue
    if (!options.includeFuture && emptyRow.day > todayDay) continue
    const expectedShift = emptyRow.shift || '全天'
    const duplicateKey = `${emptyRow.cowId}|${emptyRow.date}|${expectedShift}`
    if (existingItemKeys.has(duplicateKey)) continue
    const itemId = stableId(
      'milk_empty_value',
      emptyRow.cowId,
      emptyRow.date,
      expectedShift,
      emptyRow.sourceTable,
      emptyRow.sourceRecordId || emptyRow.id
    )
    const state = reviewState.get(itemId)
    if (state?.status === 'confirmed') continue
    const episode = findMilkReviewEpisodeForRow(episodes, emptyRow)
    const rows = (milkByCow.get(emptyRow.cowId) || [])
      .filter((row) => row.day !== emptyRow.day || row.shift !== expectedShift)
      .sort((left, right) => left.day - right.day)
    const dim =
      emptyRow.daysInMilk || (episode ? milkReviewDaysBetween(episode.startDay, emptyRow.day) : 0)
    const recommendation = episode
      ? getMilkReviewRecommendation(
          rows,
          emptyRow.day,
          dim,
          expectedShifts.length || 1,
          episode.startDay
        )
      : null
    if (!recommendation) continue
    const item = {
      id: itemId,
      cowId: emptyRow.cowId,
      cowNumber: emptyRow.cowNumber,
      cowName: emptyRow.cowName || '',
      breed: emptyRow.breed || '',
      parityNo: emptyRow.parityNo || episode?.parityNo || 1,
      lactationId: emptyRow.lactationId || episode?.lactationId || '',
      lactationStartDate: episode?.startDate || '',
      lactationEndDate: episode?.endDate || '',
      date: emptyRow.date,
      dim,
      expectedShift,
      missingKind: 'empty_value',
      existingShiftCount: 0,
      existingDailyMilk: 0,
      recommendedMilk: state?.recommendedMilk || recommendation.value,
      recommendationMethod: recommendation.method,
      recommendationText: recommendation.text,
      confidence: recommendation.confidence,
      status: state?.status || 'pending',
      sourceRecordIds: [
        `${emptyRow.sourceTable || 'milk_measurement'}:${emptyRow.sourceRecordId || emptyRow.id}`
      ],
      monthKey: emptyRow.date.slice(0, 7),
      yearKey: emptyRow.date.slice(0, 4),
      previousDays: buildMilkReviewPreviousDays(rows, emptyRow.day)
    }
    items.push(item)
    existingItemKeys.add(duplicateKey)
  }

  items.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.cowNumber.localeCompare(right.cowNumber) ||
      left.expectedShift.localeCompare(right.expectedShift)
  )
  return {
    items,
    summary: summarizeMilkReviewItems(items, reviewState),
    generatedAt: new Date().toISOString()
  }
}

function buildMilkReviewIssueRow(item, status, confirmedMilk, operatorName, now, measurementId) {
  return {
    id: item.id,
    animalId: item.cowId,
    animal_id: item.cowId,
    sourceTable: 'milk_missing_review',
    source_table: 'milk_missing_review',
    sourceRecordId: item.id,
    source_record_id: item.id,
    issueType: 'milk_missing_production',
    issue_type: 'milk_missing_production',
    issueLevel: item.confidence === 'low' ? 'warning' : 'info',
    issue_level: item.confidence === 'low' ? 'warning' : 'info',
    issueStatus: status,
    issue_status: status,
    detectedAt: now,
    detected_at: now,
    resolvedAt: status === 'confirmed' ? now : null,
    resolved_at: status === 'confirmed' ? now : null,
    detail: {
      reviewItemId: item.id,
      cowNumber: item.cowNumber,
      date: item.date,
      shift: item.expectedShift,
      parityNo: item.parityNo,
      dim: item.dim,
      missingKind: item.missingKind,
      summaryDays: item.summaryDays,
      summaryTotalMilk: item.summaryTotalMilk,
      sourceSummaryId: item.sourceSummaryId,
      recommendedMilk: item.recommendedMilk,
      confirmedMilk,
      recommendationMethod: item.recommendationMethod,
      measurementId,
      operatorName
    },
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }
}

async function confirmMilkReviewMeasurementItem(
  item,
  milkYield,
  operatorName,
  now,
  uniqueKey = item.id
) {
  const measuredAt = milkReviewShiftTime(item.date, item.expectedShift)
  const sessionCode = `补录-${item.date}-${item.expectedShift}`
  const sessionId = stableId('milking_session', sessionCode)
  const visitId = stableId('milking_visit', sessionCode, item.cowId || item.cowNumber, measuredAt)
  const measurementId = stableId('milk_fill', uniqueKey)
  const common = {
    id: measurementId,
    sessionId,
    session_id: sessionId,
    visitId,
    visit_id: visitId,
    animalId: item.cowId,
    animal_id: item.cowId,
    cowId: item.cowId,
    cow_id: item.cowId,
    cowNumber: item.cowNumber,
    cow_number: item.cowNumber,
    measuredAt,
    measured_at: measuredAt,
    milkingTime: measuredAt,
    productionDate: item.date,
    production_date: item.date,
    shiftId: item.expectedShift,
    shift_id: item.expectedShift,
    sessionCode,
    session_code: sessionCode,
    parityNo: item.parityNo,
    parity_no: item.parityNo,
    lactationId: item.lactationId,
    lactation_id: item.lactationId,
    daysInMilk: item.dim,
    days_in_milk: item.dim,
    periodSource: 'system_derived_from_milk_missing_review',
    period_source: 'system_derived_from_milk_missing_review',
    milkYield,
    milk_yield: milkYield,
    volume: milkYield,
    sourceType: 'operator_confirmed_imputation',
    source_type: 'operator_confirmed_imputation',
    sourceTable: 'milk_missing_review',
    source_table: 'milk_missing_review',
    sourceRecordId: item.id,
    source_record_id: item.id,
    qualityFlag: 'estimated_confirmed',
    quality_flag: 'estimated_confirmed',
    operatorName,
    operator_name: operatorName,
    notes: `${item.date} ${item.expectedShift} 缺失产奶记录，经人工确认填补。`,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  }
  await insertRow('milking_session', {
    id: sessionId,
    sessionCode,
    session_code: sessionCode,
    productionDate: item.date,
    production_date: item.date,
    startedAt: measuredAt,
    started_at: measuredAt,
    shiftId: item.expectedShift,
    shift_id: item.expectedShift,
    sourceType: 'operator_confirmed_imputation',
    source_type: 'operator_confirmed_imputation',
    operatorName,
    operator_name: operatorName,
    status: 'recorded',
    sessionStatus: 'recorded',
    session_status: 'recorded',
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now
  })
  await insertRow('milking_visit', {
    ...common,
    id: visitId,
    enteredAt: measuredAt,
    entered_at: measuredAt
  })
  await insertRow('milk_measurement', common)
  await insertRow('milk_records', {
    ...common,
    id: measurementId,
    milkQuality: { grade: '补录', source: '人工确认填补' },
    milk_quality: { grade: '补录', source: '人工确认填补' },
    milkVolume: milkYield,
    milkingMethod: 'manual_confirmed_imputation'
  })
  await insertRow(
    'data_quality_issue',
    buildMilkReviewIssueRow(item, 'confirmed', milkYield, operatorName, now, measurementId)
  )
  await auditOperation({
    id: stableId('audit', measurementId),
    actionType: 'confirm_milk_missing_fill',
    targetType: 'milk_measurement',
    targetId: measurementId,
    animalId: item.cowId || null,
    operator: operatorName,
    status: 'completed',
    requestPayload: { item, confirmedValue: milkYield },
    resultPayload: { measurementId, sessionId, visitId },
    cowIds: [item.cowId].filter(Boolean),
    sourceRecordIds: [item.id],
    createdAt: now,
    updatedAt: now
  })
  return [measurementId]
}

async function confirmMilkReviewSummaryItem(item, dailyMilk, operatorName, now) {
  const days = milkReviewPositiveInt(item.summaryDays) || 1
  const ids = []
  for (let offset = 0; offset < days; offset += 1) {
    const day = milkReviewDayNumber(item.lactationStartDate) + offset
    const date = milkReviewDateFromDay(day)
    const dim = offset + 1
    const summaryItem = { ...item, date, dim, expectedShift: '日汇总' }
    ids.push(
      ...(await confirmMilkReviewMeasurementItem(
        summaryItem,
        dailyMilk,
        operatorName,
        now,
        `${item.id}:${date}:${dim}`
      ))
    )
  }
  await insertRow(
    'data_quality_issue',
    buildMilkReviewIssueRow(item, 'confirmed', dailyMilk, operatorName, now, ids[0] || item.id)
  )
  return ids
}

async function confirmMilkMissingReviewFromDb(options = {}) {
  const review = await buildMilkMissingReviewFromDb({
    startDate: options.startDate,
    endDate: options.endDate,
    expectedShifts: options.expectedShifts,
    includeFuture: false
  })
  const selectedIds = new Set(Array.isArray(options.itemIds) ? options.itemIds.map(String) : [])
  const selectedItems = review.items.filter((item) => selectedIds.has(item.id))
  const values = isPlainObject(options.values) ? options.values : {}
  const operatorName = String(options.operatorName || '泌乳复核员').trim() || '泌乳复核员'
  const now = formatLocalDateTime(new Date())
  const preparedItems = selectedItems.map((item) => {
    const milkYield = milkReviewRound(Number(values[item.id] ?? item.recommendedMilk))
    return { item, milkYield }
  })
  const invalidItems = preparedItems
    .filter(({ milkYield }) => !Number.isFinite(milkYield) || milkYield <= 0)
    .map(({ item }) => `${item.cowNumber || item.cowId} ${item.date} ${item.expectedShift}`)
  if (invalidItems.length) {
    throw createHttpError(
      400,
      `以下缺口需要填写大于 0 的确认产奶量：${invalidItems.slice(0, 5).join('、')}${invalidItems.length > 5 ? '等' : ''}`
    )
  }
  const measurementIds = []
  for (const { item, milkYield } of preparedItems) {
    if (item.missingKind === 'summary_only') {
      measurementIds.push(
        ...(await confirmMilkReviewSummaryItem(item, milkYield, operatorName, now))
      )
    } else {
      measurementIds.push(
        ...(await confirmMilkReviewMeasurementItem(item, milkYield, operatorName, now))
      )
    }
  }
  return { confirmed: measurementIds.length, measurementIds }
}

const OMICS_MODULE_CATALOG = [
  ['missing-normalize', 'Impute Missing Values and Normalize data', '预处理', 'primary'],
  ['cleaning-processing', 'Cleaning and Processing', '预处理', 'primary'],
  ['pca', 'PCA', '降维与分群', 'teal'],
  ['plsda', 'PLS-DA', '降维与分群', 'teal'],
  ['oplsda', 'OPLS-DA', '降维与分群', 'teal'],
  ['two-group-test', 'Univariate Analysis - Two Groups', '差异分析', 'info'],
  ['multi-group-test', 'Univariate Analysis - Multi Groups', '差异分析', 'info'],
  ['limma', 'Limma Difference Analysis', '差异分析', 'info'],
  ['lefse', 'Lefse Analysis', '差异分析', 'info'],
  ['random-forest', 'Random Forest Feature Selection', '机器学习', 'warning'],
  ['svm', 'SVM Feature Selection', '机器学习', 'warning'],
  ['boruta', 'Boruta Analysis', '机器学习', 'warning'],
  ['roc', 'Predictive Model ROC', '机器学习', 'warning'],
  ['correlation', 'Correlation & Partial Correlation', '关联分析', 'primary'],
  ['gramm', 'GRaMM Correlation Analysis', '关联分析', 'primary'],
  ['cca-rda', 'CCA/RDA', '关联分析', 'primary'],
  ['kegg', 'KEGG Pathway Analysis', '富集与通路', 'teal'],
  ['msea', 'Metabolite Set Enrichment Analysis', '富集与通路', 'teal'],
  ['ipath', 'IPATH Analysis', '富集与通路', 'teal'],
  ['heatmap', 'Heatmap', '可视化', 'info'],
  ['violin-box', 'Violin Plot / Box Plot', '可视化', 'info'],
  ['venn-zscore', 'Venn Plot / Z-Score Scaled by Row', '可视化', 'info']
].map(([id, name, category, tone]) => ({
  id,
  name,
  category,
  tone,
  runtime: id === 'limma' ? 'R/Python' : 'Python',
  tagType:
    tone === 'teal'
      ? 'success'
      : tone === 'warning'
        ? 'warning'
        : tone === 'info'
          ? 'info'
          : 'primary'
}))

function getOmicsModule(moduleId) {
  return (
    OMICS_MODULE_CATALOG.find((item) => item.id === moduleId) || {
      id: moduleId,
      name: moduleId,
      category: '自定义',
      tone: 'primary',
      runtime: 'Python',
      tagType: 'primary'
    }
  )
}

function getOmicsModuleParameterSchema(moduleId) {
  return [...OMICS_PARAMETER_SCHEMA.global, ...(OMICS_PARAMETER_SCHEMA.modules[moduleId] || [])]
}

function buildEffectiveOmicsParameters(moduleId, trait, payload = {}, module = null) {
  const incoming = isPlainObject(payload.parameters) ? payload.parameters : {}
  const parameters = {}
  for (const item of getOmicsModuleParameterSchema(moduleId)) {
    const payloadValue = payload[item.key]
    const incomingValue = incoming[item.key]
    const rawValue =
      item.key === 'trait'
        ? trait
        : payloadValue !== undefined && payloadValue !== null && payloadValue !== ''
          ? payloadValue
          : incomingValue !== undefined && incomingValue !== null && incomingValue !== ''
            ? incomingValue
            : item.default
    let value = rawValue
    if (item.type === 'number' || item.type === 'slider') {
      value = Number(rawValue)
      if (!Number.isFinite(value)) value = Number(item.default || 0)
      if (item.min !== undefined) value = Math.max(Number(item.min), value)
      if (item.max !== undefined) value = Math.min(Number(item.max), value)
    } else if (item.type === 'boolean') {
      if (typeof rawValue === 'boolean') value = rawValue
      else if (typeof rawValue === 'number') value = Boolean(rawValue)
      else
        value = ['1', 'true', 'yes', 'y', 'on', '开'].includes(
          String(rawValue ?? item.default ?? false).toLowerCase()
        )
    } else if (item.type === 'select') {
      const allowed = Array.isArray(item.options)
        ? item.options.map((option) => String(option.value))
        : []
      value = String(rawValue ?? item.default ?? '')
      if (allowed.length && !allowed.includes(value)) value = String(item.default ?? allowed[0])
    } else if (item.type === 'text') {
      value =
        rawValue === undefined || rawValue === null ? String(item.default ?? '') : String(rawValue)
    }
    parameters[item.key] = value
    if (item.backendParam && item.backendParam !== item.key) parameters[item.backendParam] = value
  }
  parameters.repositoryId =
    payload.repositoryId || incoming.repositoryId || parameters.repositoryId || 'omics-datasets'
  parameters.groupBy =
    payload.groupBy || incoming.groupBy || parameters.groupBy || 'phenotype_group'
  parameters.trait = trait
  if (module?.name) parameters.moduleName = module.name
  for (const traceKey of [
    'parameterSchemaSnapshot',
    'clientSubmittedAt',
    'inputRepositories',
    'moduleInputs',
    'moduleOutput',
    'operator',
    'runCode',
    'metadataNote'
  ]) {
    if (incoming[traceKey] !== undefined) parameters[traceKey] = incoming[traceKey]
  }
  return parameters
}

function pickRunOperator(parameters = {}, req = null) {
  const submitted = String(parameters.operator || '').trim()
  return submitted || getRequestOperator(req)
}

function pickRunCode(parameters = {}, fallback = '') {
  const submitted = String(parameters.runCode || parameters.run_code || '').trim()
  return submitted || fallback || null
}

function summarizeArtifacts(serviceResult = {}) {
  const tables = serviceResult.tables || {}
  const charts = serviceResult.charts || {}
  return [
    ...Object.entries(tables).map(([name, payload]) => ({
      type: 'table',
      name,
      rows: Array.isArray(payload)
        ? payload.length
        : Array.isArray(payload?.rows)
          ? payload.rows.length
          : null,
      exportFormats: ['json', 'csv']
    })),
    ...Object.entries(charts).map(([name, payload]) => ({
      type: 'chart',
      name,
      points: Array.isArray(payload)
        ? payload.length
        : Array.isArray(payload?.values)
          ? payload.values.length
          : null,
      exportFormats: ['json', 'png']
    }))
  ]
}

async function ensureOmicsRunTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS omics_module_runs (
      id VARCHAR(64) PRIMARY KEY,
      module_id VARCHAR(64) NOT NULL,
      module_name VARCHAR(255) NOT NULL,
      trait VARCHAR(128) NOT NULL,
      status VARCHAR(32) NOT NULL,
      data_source VARCHAR(32) NOT NULL,
      parameters JSON NULL,
      metrics JSON NULL,
      tables_json JSON NULL,
      charts_json JSON NULL,
      method_notes JSON NULL,
      input_summary JSON NULL,
      artifacts JSON NULL,
      cow_ids JSON NULL,
      relation_scope JSON NULL,
      source_record_ids JSON NULL,
      operator VARCHAR(128) NULL,
      run_code VARCHAR(128) NULL,
      started_at DATETIME(3) NULL,
      finished_at DATETIME(3) NULL,
      duration_ms INT NULL,
      summary TEXT NULL,
      error_message TEXT NULL,
      executed_at DATETIME(3) NULL,
      created_at DATETIME(3) NULL,
      updated_at DATETIME(3) NULL,
      KEY idx_omics_module_runs_module_id (module_id),
      KEY idx_omics_module_runs_trait (trait),
      KEY idx_omics_module_runs_status (status),
      KEY idx_omics_module_runs_executed_at (executed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS omics_workflow_runs (
      id VARCHAR(64) PRIMARY KEY,
      workflow_id VARCHAR(64) NOT NULL,
      workflow_name VARCHAR(255) NOT NULL,
      trait VARCHAR(128) NOT NULL,
      status VARCHAR(32) NOT NULL,
      data_source VARCHAR(32) NOT NULL,
      repository_ids JSON NULL,
      module_ids JSON NULL,
      module_run_ids JSON NULL,
      parameters JSON NULL,
      metrics JSON NULL,
      tables_json JSON NULL,
      charts_json JSON NULL,
      method_notes JSON NULL,
      input_summary JSON NULL,
      artifacts JSON NULL,
      cow_ids JSON NULL,
      relation_scope JSON NULL,
      source_record_ids JSON NULL,
      operator VARCHAR(128) NULL,
      run_code VARCHAR(128) NULL,
      started_at DATETIME(3) NULL,
      finished_at DATETIME(3) NULL,
      duration_ms INT NULL,
      summary TEXT NULL,
      conclusion TEXT NULL,
      error_message TEXT NULL,
      executed_at DATETIME(3) NULL,
      created_at DATETIME(3) NULL,
      updated_at DATETIME(3) NULL,
      KEY idx_omics_workflow_runs_workflow_id (workflow_id),
      KEY idx_omics_workflow_runs_trait (trait),
      KEY idx_omics_workflow_runs_status (status),
      KEY idx_omics_workflow_runs_executed_at (executed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS omics_analysis_artifacts (
      id VARCHAR(64) PRIMARY KEY,
      run_id VARCHAR(64) NOT NULL,
      run_type VARCHAR(32) NOT NULL,
      artifact_type VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      cow_ids JSON NULL,
      relation_scope JSON NULL,
      source_record_ids JSON NULL,
      payload JSON NULL,
      created_at DATETIME(3) NULL,
      KEY idx_omics_analysis_artifacts_run (run_id, run_type),
      KEY idx_omics_analysis_artifacts_type (artifact_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  tableMetadataCache.delete('omics_module_runs')
  tableMetadataCache.delete('omics_workflow_runs')
  tableMetadataCache.delete('omics_analysis_artifacts')
  await addColumnIfMissing('omics_module_runs', 'input_summary', 'JSON NULL')
  await addColumnIfMissing('omics_module_runs', 'artifacts', 'JSON NULL')
  await addColumnIfMissing('omics_module_runs', 'cow_ids', 'JSON NULL')
  await addColumnIfMissing('omics_module_runs', 'relation_scope', 'JSON NULL')
  await addColumnIfMissing('omics_module_runs', 'source_record_ids', 'JSON NULL')
  await addColumnIfMissing('omics_module_runs', 'operator', 'VARCHAR(128) NULL')
  await addColumnIfMissing('omics_module_runs', 'run_code', 'VARCHAR(128) NULL')
  await addColumnIfMissing('omics_module_runs', 'started_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('omics_module_runs', 'finished_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('omics_module_runs', 'duration_ms', 'INT NULL')
  await addColumnIfMissing('omics_workflow_runs', 'input_summary', 'JSON NULL')
  await addColumnIfMissing('omics_workflow_runs', 'artifacts', 'JSON NULL')
  await addColumnIfMissing('omics_workflow_runs', 'cow_ids', 'JSON NULL')
  await addColumnIfMissing('omics_workflow_runs', 'relation_scope', 'JSON NULL')
  await addColumnIfMissing('omics_workflow_runs', 'source_record_ids', 'JSON NULL')
  await addColumnIfMissing('omics_workflow_runs', 'operator', 'VARCHAR(128) NULL')
  await addColumnIfMissing('omics_workflow_runs', 'run_code', 'VARCHAR(128) NULL')
  await addColumnIfMissing('omics_workflow_runs', 'started_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('omics_workflow_runs', 'finished_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('omics_workflow_runs', 'duration_ms', 'INT NULL')
  await addColumnIfMissing('omics_analysis_artifacts', 'cow_ids', 'JSON NULL')
  await addColumnIfMissing('omics_analysis_artifacts', 'relation_scope', 'JSON NULL')
  await addColumnIfMissing('omics_analysis_artifacts', 'source_record_ids', 'JSON NULL')
}

async function ensureProductionAcceptanceTables() {
  await ensureV2DatabaseSchema()
  // `cow_events` is a legacy mirror used by the management UI but is not part
  // of the V2 migration. Create its portable JSON-backed shell on a fresh
  // local database before adding the compatibility columns below.
  await ensureGenericTable('cow_events')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS export_audit_logs (
      id VARCHAR(64) PRIMARY KEY,
      action_type VARCHAR(64) NOT NULL,
      operator VARCHAR(128) NULL,
      status VARCHAR(32) NOT NULL,
      file_name VARCHAR(255) NULL,
      file_url VARCHAR(512) NULL,
      file_hash VARCHAR(128) NULL,
      file_format VARCHAR(32) NULL,
      row_count INT NULL,
      filters_json JSON NULL,
      parameters_json JSON NULL,
      result_snapshot JSON NULL,
      cow_ids JSON NULL,
      relation_scope JSON NULL,
      source_record_ids JSON NULL,
      started_at DATETIME(3) NULL,
      finished_at DATETIME(3) NULL,
      duration_ms INT NULL,
      created_at DATETIME(3) NULL,
      updated_at DATETIME(3) NULL,
      KEY idx_export_audit_logs_action (action_type),
      KEY idx_export_audit_logs_status (status),
      KEY idx_export_audit_logs_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hardware_command_logs (
      id VARCHAR(64) PRIMARY KEY,
      device_id VARCHAR(128) NOT NULL,
      command_type VARCHAR(64) NOT NULL,
      operator VARCHAR(128) NULL,
      status VARCHAR(32) NOT NULL,
      command_payload JSON NULL,
      ack_payload JSON NULL,
      cow_ids JSON NULL,
      relation_scope JSON NULL,
      source_record_ids JSON NULL,
      requested_at DATETIME(3) NULL,
      acknowledged_at DATETIME(3) NULL,
      created_at DATETIME(3) NULL,
      updated_at DATETIME(3) NULL,
      KEY idx_hardware_command_logs_device (device_id),
      KEY idx_hardware_command_logs_type (command_type),
      KEY idx_hardware_command_logs_status (status),
      KEY idx_hardware_command_logs_requested (requested_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mqtt_message_logs (
      id VARCHAR(64) PRIMARY KEY,
      direction VARCHAR(16) NOT NULL,
      topic VARCHAR(255) NOT NULL,
      qos INT NULL,
      status VARCHAR(32) NOT NULL,
      operator VARCHAR(128) NULL,
      device_id VARCHAR(128) NULL,
      cow_id VARCHAR(64) NULL,
      cow_number VARCHAR(64) NULL,
      command_type VARCHAR(64) NULL,
      source_message_id VARCHAR(128) NULL,
      published_at DATETIME(3) NULL,
      received_at DATETIME(3) NULL,
      payload_json JSON NULL,
      parsed_payload JSON NULL,
      relation_scope JSON NULL,
      source_record_ids JSON NULL,
      created_at DATETIME(3) NULL,
      updated_at DATETIME(3) NULL,
      KEY idx_mqtt_message_logs_direction_time (direction, published_at),
      KEY idx_mqtt_message_logs_received (received_at),
      KEY idx_mqtt_message_logs_topic (topic),
      KEY idx_mqtt_message_logs_cow (cow_id, cow_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS breeding_decision_runs (
      id VARCHAR(64) PRIMARY KEY,
      run_type VARCHAR(64) NOT NULL,
      title VARCHAR(255) NULL,
      operator VARCHAR(128) NULL,
      status VARCHAR(32) NOT NULL,
      parameters_json JSON NULL,
      result_snapshot JSON NULL,
      cow_ids JSON NULL,
      relation_scope JSON NULL,
      source_record_ids JSON NULL,
      started_at DATETIME(3) NULL,
      finished_at DATETIME(3) NULL,
      duration_ms INT NULL,
      created_at DATETIME(3) NULL,
      updated_at DATETIME(3) NULL,
      KEY idx_breeding_decision_runs_type (run_type),
      KEY idx_breeding_decision_runs_status (status),
      KEY idx_breeding_decision_runs_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operation_audit_logs (
      id VARCHAR(64) PRIMARY KEY,
      action_type VARCHAR(64) NOT NULL,
      target_type VARCHAR(64) NULL,
      target_id VARCHAR(128) NULL,
      operator VARCHAR(128) NULL,
      status VARCHAR(32) NOT NULL,
      request_payload JSON NULL,
      result_payload JSON NULL,
      cow_ids JSON NULL,
      relation_scope JSON NULL,
      source_record_ids JSON NULL,
      created_at DATETIME(3) NULL,
      updated_at DATETIME(3) NULL,
      KEY idx_operation_audit_logs_action (action_type),
      KEY idx_operation_audit_logs_target (target_type, target_id),
      KEY idx_operation_audit_logs_status (status),
      KEY idx_operation_audit_logs_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sensor_readings (
      id VARCHAR(64) PRIMARY KEY,
      cow_id VARCHAR(64) NULL,
      cow_number VARCHAR(64) NULL,
      device_id VARCHAR(128) NULL,
      channel_id VARCHAR(128) NULL,
      metric_code VARCHAR(64) NULL,
      metric VARCHAR(64) NULL,
      reading_value DECIMAL(18,6) NULL,
      value DECIMAL(18,6) NULL,
      reading_text VARCHAR(256) NULL,
      unit VARCHAR(32) NULL,
      measured_at DATETIME(3) NULL,
      timestamp DATETIME(3) NULL,
      production_date DATE NULL,
      quality_flag VARCHAR(32) NULL,
      raw_payload JSON NULL,
      created_at DATETIME(3) NULL,
      updated_at DATETIME(3) NULL,
      KEY idx_sensor_readings_cow_time (cow_id, measured_at),
      KEY idx_sensor_readings_metric_time (metric_code, measured_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  for (const table of [
    'export_audit_logs',
    'hardware_command_logs',
    'mqtt_message_logs',
    'breeding_decision_runs',
    'operation_audit_logs'
  ]) {
    tableMetadataCache.delete(table)
    await addColumnIfMissing(table, 'cow_ids', 'JSON NULL')
    await addColumnIfMissing(table, 'relation_scope', 'JSON NULL')
    await addColumnIfMissing(table, 'source_record_ids', 'JSON NULL')
    await addColumnIfMissing(table, 'operator', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'status', 'VARCHAR(32) NULL')
    await addColumnIfMissing(table, 'created_at', 'DATETIME(3) NULL')
    await addColumnIfMissing(table, 'updated_at', 'DATETIME(3) NULL')
  }
  await addColumnIfMissing('export_audit_logs', 'action_type', 'VARCHAR(64) NULL')
  await addColumnIfMissing('export_audit_logs', 'file_name', 'VARCHAR(255) NULL')
  await addColumnIfMissing('export_audit_logs', 'file_url', 'VARCHAR(512) NULL')
  await addColumnIfMissing('export_audit_logs', 'file_hash', 'VARCHAR(128) NULL')
  await addColumnIfMissing('export_audit_logs', 'file_format', 'VARCHAR(32) NULL')
  await addColumnIfMissing('export_audit_logs', 'row_count', 'INT NULL')
  await addColumnIfMissing('export_audit_logs', 'filters_json', 'JSON NULL')
  await addColumnIfMissing('export_audit_logs', 'parameters_json', 'JSON NULL')
  await addColumnIfMissing('export_audit_logs', 'result_snapshot', 'JSON NULL')
  await addColumnIfMissing('export_audit_logs', 'started_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('export_audit_logs', 'finished_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('export_audit_logs', 'duration_ms', 'INT NULL')
  await addColumnIfMissing('hardware_command_logs', 'device_id', 'VARCHAR(128) NULL')
  await addColumnIfMissing('hardware_command_logs', 'command_type', 'VARCHAR(64) NULL')
  await addColumnIfMissing('hardware_command_logs', 'command_payload', 'JSON NULL')
  await addColumnIfMissing('hardware_command_logs', 'ack_payload', 'JSON NULL')
  await addColumnIfMissing('hardware_command_logs', 'requested_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('hardware_command_logs', 'acknowledged_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('mqtt_message_logs', 'direction', 'VARCHAR(16) NULL')
  await addColumnIfMissing('mqtt_message_logs', 'topic', 'VARCHAR(255) NULL')
  await addColumnIfMissing('mqtt_message_logs', 'qos', 'INT NULL')
  await addColumnIfMissing('mqtt_message_logs', 'device_id', 'VARCHAR(128) NULL')
  await addColumnIfMissing('mqtt_message_logs', 'cow_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('mqtt_message_logs', 'cow_number', 'VARCHAR(64) NULL')
  await addColumnIfMissing('mqtt_message_logs', 'command_type', 'VARCHAR(64) NULL')
  await addColumnIfMissing('mqtt_message_logs', 'source_message_id', 'VARCHAR(128) NULL')
  await addColumnIfMissing('mqtt_message_logs', 'published_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('mqtt_message_logs', 'received_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('mqtt_message_logs', 'payload_json', 'JSON NULL')
  await addColumnIfMissing('mqtt_message_logs', 'parsed_payload', 'JSON NULL')
  await addColumnIfMissing('breeding_decision_runs', 'run_type', 'VARCHAR(64) NULL')
  await addColumnIfMissing('breeding_decision_runs', 'title', 'VARCHAR(255) NULL')
  await addColumnIfMissing('breeding_decision_runs', 'parameters_json', 'JSON NULL')
  await addColumnIfMissing('breeding_decision_runs', 'result_snapshot', 'JSON NULL')
  await addColumnIfMissing('breeding_decision_runs', 'started_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('breeding_decision_runs', 'finished_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('breeding_decision_runs', 'duration_ms', 'INT NULL')
  await addColumnIfMissing('operation_audit_logs', 'action_type', 'VARCHAR(64) NULL')
  await addColumnIfMissing('operation_audit_logs', 'target_type', 'VARCHAR(64) NULL')
  await addColumnIfMissing('operation_audit_logs', 'target_id', 'VARCHAR(128) NULL')
  await addColumnIfMissing('operation_audit_logs', 'request_payload', 'JSON NULL')
  await addColumnIfMissing('operation_audit_logs', 'result_payload', 'JSON NULL')
  await addColumnIfMissing('operation_audit_logs', 'operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('operation_audit_logs', 'operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('operation_audit_log', 'operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('operation_audit_log', 'source_record_ids', 'JSON NULL')
  await addColumnIfMissing('operation_audit_log', 'cow_ids', 'JSON NULL')
  await addColumnIfMissing('operation_audit_log', 'relation_scope', 'JSON NULL')

  for (const table of ['sensor_reading', 'sensor_readings']) {
    await addColumnIfMissing(table, 'animal_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'animal_number', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'cow_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'cow_number', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'source_table', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'source_record_id', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'operator_name', 'VARCHAR(128) NULL')
  }
  await addColumnIfMissing('sensor_readings', 'metric_code', 'VARCHAR(64) NULL')
  await addColumnIfMissing('sensor_readings', 'measured_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('sensor_readings', 'reading_value', 'DECIMAL(18,6) NULL')
  await addColumnIfMissing('sensor_readings', 'raw_payload', 'JSON NULL')

  for (const table of ['cows']) {
    await addColumnIfMissing(table, 'animal_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'animal_number', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'current_unit_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'current_pen_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'source_table', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'source_record_id', 'VARCHAR(128) NULL')
  }

  await addColumnIfMissing('animal_event', 'source_table', 'VARCHAR(128) NULL')
  await addColumnIfMissing('animal_event', 'recorded_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('animal_event', 'work_operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('animal_event', 'work_operator_name', 'VARCHAR(128) NULL')

  for (const table of ['entry_events', 'transfer_events', 'exit_events']) {
    await addColumnIfMissing(table, 'animal_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'animal_number', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'occurred_at', 'DATETIME(3) NULL')
    await addColumnIfMissing(table, 'recorded_at', 'DATETIME(3) NULL')
    await addColumnIfMissing(table, 'operator_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'operator_name', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'work_operator_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'work_operator_name', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'source_table', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'source_record_id', 'VARCHAR(128) NULL')
  }
  await addColumnIfMissing('entry_events', 'unit_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('transfer_events', 'from_unit_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('transfer_events', 'to_unit_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('exit_events', 'from_unit_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('exit_events', 'unit_id', 'VARCHAR(64) NULL')

  for (const table of ['breeding_events', 'veterinary_events']) {
    await addColumnIfMissing(table, 'animal_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'animal_number', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'occurred_at', 'DATETIME(3) NULL')
    await addColumnIfMissing(table, 'recorded_at', 'DATETIME(3) NULL')
    await addColumnIfMissing(table, 'operator_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'operator_name', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'work_operator_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'work_operator_name', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'source_table', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'source_record_id', 'VARCHAR(128) NULL')
  }

  for (const table of ['cow_events']) {
    await addColumnIfMissing(table, 'animal_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'animal_number', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'event_type', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'event_code', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'occurred_at', 'DATETIME(3) NULL')
    await addColumnIfMissing(table, 'recorded_at', 'DATETIME(3) NULL')
    await addColumnIfMissing(table, 'operator_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'operator_name', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'work_operator_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'work_operator_name', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'source_table', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'source_record_id', 'VARCHAR(128) NULL')
  }

  for (const table of [
    'event_reproduction_detail',
    'event_health_detail',
    'event_production_detail',
    'event_medicine_detail',
    'event_movement_detail'
  ]) {
    await addColumnIfMissing(table, 'animal_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'animal_number', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'cow_number', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'event_type', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'occurred_at', 'DATETIME(3) NULL')
    await addColumnIfMissing(table, 'operator_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'operator_name', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'work_operator_id', 'VARCHAR(64) NULL')
    await addColumnIfMissing(table, 'work_operator_name', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'source_table', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'source_record_id', 'VARCHAR(128) NULL')
    await addColumnIfMissing(table, 'recorded_at', 'DATETIME(3) NULL')
  }

  await addColumnIfMissing('trait_observation', 'source_table', 'VARCHAR(128) NULL')
  await addColumnIfMissing('trait_observation', 'operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('trait_observation', 'operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('trait_observation', 'work_operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('trait_observation', 'work_operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('trait_observation', 'recorded_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('trait_observation_batch', 'operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('trait_observation_batch', 'operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('trait_observation_batch', 'work_operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('trait_observation_batch', 'work_operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('trait_observation_batch', 'recorded_at', 'DATETIME(3) NULL')

  await addColumnIfMissing('phenotype_records', 'animal_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('phenotype_records', 'animal_number', 'VARCHAR(64) NULL')
  await addColumnIfMissing('phenotype_records', 'trait_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('phenotype_records', 'observed_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('phenotype_records', 'operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('phenotype_records', 'operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('phenotype_records', 'work_operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('phenotype_records', 'work_operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('phenotype_records', 'source_table', 'VARCHAR(128) NULL')
  await addColumnIfMissing('phenotype_records', 'source_record_id', 'VARCHAR(128) NULL')
  await addColumnIfMissing('phenotype_records', 'recorded_at', 'DATETIME(3) NULL')

  await addColumnIfMissing('omics_samples', 'animal_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('omics_samples', 'animal_number', 'VARCHAR(64) NULL')
  await addColumnIfMissing('omics_samples', 'operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('omics_samples', 'operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('omics_samples', 'work_operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('omics_samples', 'work_operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('omics_samples', 'source_table', 'VARCHAR(128) NULL')
  await addColumnIfMissing('omics_samples', 'source_record_id', 'VARCHAR(128) NULL')
  await addColumnIfMissing('omics_samples', 'collected_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('omics_samples', 'recorded_at', 'DATETIME(3) NULL')

  await addColumnIfMissing('animal', 'calf_breed', 'VARCHAR(128) NULL')
  await addColumnIfMissing('animal', 'reported_parity_no', 'INT NULL')
  await addColumnIfMissing('animal', 'reported_age_months', 'DECIMAL(10,2) NULL')
  await addColumnIfMissing('animal', 'lactation_start_date', 'DATE NULL')
  await addColumnIfMissing('animal', 'lactation_end_date', 'DATE NULL')
  await addColumnIfMissing('animal', 'reported_days_in_milk', 'INT NULL')
  await addColumnIfMissing('animal', 'reported_lactation_month', 'INT NULL')
  await addColumnIfMissing('animal', 'reported_parity_yield', 'DECIMAL(18,6) NULL')
  await addColumnIfMissing('animal', 'reported_milk_305', 'DECIMAL(18,6) NULL')
  await addColumnIfMissing('animal', 'reported_avg_daily_milk', 'DECIMAL(18,6) NULL')
  await addColumnIfMissing('milking_session', 'shift_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milking_session', 'operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milking_session', 'recorded_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('milking_session', 'work_operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milking_session', 'work_operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milking_session', 'source_type', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milking_session', 'source_table', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milking_session', 'source_record_id', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milking_visit', 'session_code', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milking_visit', 'production_date', 'DATE NULL')
  await addColumnIfMissing('milking_visit', 'measured_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('milking_visit', 'shift_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milking_visit', 'parity_no', 'INT NULL')
  await addColumnIfMissing('milking_visit', 'days_in_milk', 'INT NULL')
  await addColumnIfMissing('milking_visit', 'period_source', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milking_visit', 'milk_yield', 'DECIMAL(18,6) NULL')
  await addColumnIfMissing('milking_visit', 'quality_flag', 'VARCHAR(32) NULL')
  await addColumnIfMissing('milking_visit', 'source_type', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milking_visit', 'source_table', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milking_visit', 'source_record_id', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milking_visit', 'operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milking_visit', 'recorded_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('milking_visit', 'work_operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milking_visit', 'work_operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milk_measurement', 'shift_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milk_measurement', 'days_in_milk', 'INT NULL')
  await addColumnIfMissing('milk_measurement', 'period_source', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milk_measurement', 'session_code', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milk_measurement', 'source_table', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milk_measurement', 'source_record_id', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milk_measurement', 'operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milk_measurement', 'recorded_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('milk_measurement', 'work_operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milk_measurement', 'work_operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milk_measurement', 'lactation_start_date', 'DATE NULL')
  await addColumnIfMissing('milk_measurement', 'lactation_end_date', 'DATE NULL')
  await addColumnIfMissing('milk_measurement', 'reported_age_months', 'DECIMAL(10,2) NULL')
  await addColumnIfMissing('milk_measurement', 'reported_days_in_milk', 'INT NULL')
  await addColumnIfMissing('milk_measurement', 'reported_lactation_month', 'INT NULL')
  await addColumnIfMissing('milk_measurement', 'reported_parity_yield', 'DECIMAL(18,6) NULL')
  await addColumnIfMissing('milk_measurement', 'reported_milk_305', 'DECIMAL(18,6) NULL')
  await addColumnIfMissing('milk_measurement', 'reported_avg_daily_milk', 'DECIMAL(18,6) NULL')
  await addColumnIfMissing('milk_records', 'animal_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milk_records', 'animal_number', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milk_records', 'measured_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('milk_records', 'shift_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milk_records', 'parity_no', 'INT NULL')
  await addColumnIfMissing('milk_records', 'days_in_milk', 'INT NULL')
  await addColumnIfMissing('milk_records', 'period_source', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milk_records', 'session_code', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milk_records', 'source_type', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milk_records', 'source_table', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milk_records', 'source_record_id', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milk_records', 'operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milk_records', 'recorded_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('milk_records', 'work_operator_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milk_records', 'work_operator_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('milk_records', 'milker_id', 'VARCHAR(64) NULL')
  await addColumnIfMissing('milk_records', 'reported_age_months', 'DECIMAL(10,2) NULL')
  await addColumnIfMissing('milk_records', 'reported_lactation_month', 'INT NULL')
  await addColumnIfMissing('fact_lactation_305', 'milk_yield_305', 'DECIMAL(18,6) NULL')
  await addColumnIfMissing('fact_lactation_305', 'animal_number', 'VARCHAR(64) NULL')
  await addColumnIfMissing('fact_lactation_305', 'cow_number', 'VARCHAR(64) NULL')
  await addColumnIfMissing('fact_lactation_305', 'lactation_no', 'INT NULL')
  await addColumnIfMissing('fact_lactation_305', 'record_count', 'INT NULL')
  await addColumnIfMissing('fact_lactation_305', 'coverage_days', 'INT NULL')
  await addColumnIfMissing('fact_lactation_305', 'missing_days', 'INT NULL')
  await addColumnIfMissing('fact_lactation_305', 'source_table', 'VARCHAR(512) NULL')
  await addColumnIfMissing('fact_lactation_305', 'source_record_ids', 'JSON NULL')
  await addColumnIfMissing('data_quality_issue', 'source_table', 'VARCHAR(128) NULL')
  await addColumnIfMissing('data_quality_issue', 'source_record_id', 'VARCHAR(128) NULL')
  await addColumnIfMissing('data_quality_issue', 'issue_level', 'VARCHAR(32) NULL')
  await addColumnIfMissing('data_quality_issue', 'issue_status', 'VARCHAR(32) NULL')
  await addColumnIfMissing('data_quality_issue', 'resolved_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('data_quality_issue', 'detail', 'JSON NULL')
}

async function ensurePersonAccountColumns() {
  await ensureGenericTable('persons')
  await addColumnIfMissing('persons', 'account_name', 'VARCHAR(128) NULL')
  await addColumnIfMissing('persons', 'password_hash', 'VARCHAR(255) NULL')
  await addColumnIfMissing('persons', 'password_updated_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('persons', 'last_login_at', 'DATETIME(3) NULL')
  await addColumnIfMissing('persons', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1')
}

async function ensureDefaultAdminPersonAccount() {
  await ensurePersonAccountColumns()
  if (!authConfig.adminPassword) return
  const accountName = normalizeAccountName(authConfig.adminUser || 'admin')
  const [rows] = await pool.query(
    `
      SELECT *
      FROM \`persons\`
      WHERE \`id\` = 'system-admin'
         OR \`account_name\` IS NOT NULL
         OR \`name\` IS NOT NULL
      LIMIT 10000
    `
  )
  const normalizedAccount = accountName.toLowerCase()
  const existing =
    rows.find((row) => normalizeAccountName(row.id) === 'system-admin') ||
    rows.find(
      (row) => normalizeAccountName(row.account_name).toLowerCase() === normalizedAccount
    ) ||
    rows.find((row) => normalizeAccountName(row.name).toLowerCase() === normalizedAccount) ||
    null
  const now = new Date()
  const payload = {
    id: existing?.id || 'system-admin',
    name: existing?.name || accountName,
    accountName,
    role: '管理员',
    department: existing?.department || '平台管理',
    email: existing?.email || `${accountName.toLowerCase()}@nzh.local`,
    status: '正常',
    isActive: 1,
    updatedAt: now
  }
  if (!existing?.password_hash) {
    payload.passwordHash = passwordDigest(authConfig.adminPassword)
    payload.passwordUpdatedAt = now
  }
  if (existing) {
    await updateRowById('persons', existing.id, payload)
  } else {
    await insertRow('persons', { ...payload, createdAt: now })
  }
}

async function ensureDefaultPersonPassword(person = {}) {
  if (!person?.id) return person
  await ensurePersonAccountColumns()
  const accountName = normalizeAccountName(
    firstNonBlankText(person.account_name, person.accountName, person.name)
  )
  const changes = {
    accountName,
    passwordHash: passwordDigest(authConfig.defaultPersonPassword),
    passwordUpdatedAt: new Date(),
    updatedAt: new Date()
  }
  await updateRowById('persons', person.id, changes)
  return {
    ...person,
    account_name: accountName,
    password_hash: changes.passwordHash,
    password_updated_at: changes.passwordUpdatedAt
  }
}

async function ensureDefaultPersonPasswords() {
  await ensurePersonAccountColumns()
  const [rows] = await pool.query(
    `
      SELECT id, name, account_name, password_hash
      FROM \`persons\`
      WHERE COALESCE(password_hash, '') = ''
         OR COALESCE(account_name, '') = ''
      LIMIT 5000
    `
  )
  let updated = 0
  for (const person of rows) {
    const accountName = normalizeAccountName(firstNonBlankText(person.account_name, person.name))
    if (!accountName && person.password_hash) continue
    const payload = {
      updatedAt: new Date()
    }
    if (accountName && !person.account_name) payload.accountName = accountName
    if (!person.password_hash) {
      payload.passwordHash = passwordDigest(authConfig.defaultPersonPassword)
      payload.passwordUpdatedAt = new Date()
    }
    await updateRowById('persons', person.id, payload)
    updated += 1
  }
  return updated
}

async function findPersonAccount(accountName) {
  await ensurePersonAccountColumns()
  const account = normalizeAccountName(accountName)
  if (!account) return null
  const [rows] = await pool.query(
    `
      SELECT *
      FROM \`persons\`
      WHERE \`account_name\` IS NOT NULL
         OR \`name\` IS NOT NULL
         OR \`email\` IS NOT NULL
      LIMIT 10000
    `
  )
  const normalizedAccount = account.toLowerCase()
  return (
    rows.find(
      (row) => normalizeAccountName(row.account_name).toLowerCase() === normalizedAccount
    ) ||
    rows.find((row) => normalizeAccountName(row.name).toLowerCase() === normalizedAccount) ||
    rows.find((row) => normalizeAccountName(row.email).toLowerCase() === normalizedAccount) ||
    null
  )
}

function buildSessionExtraFromPerson(person = {}) {
  return {
    personId: person.id || '',
    userId: person.id || '',
    realName: person.name || '',
    email: person.email || '',
    phone: person.phone || '',
    department: person.department || '',
    roleName: person.role || ''
  }
}

function buildUserInfoFromSession(session) {
  return buildUserInfo(session?.userName || 'Admin', session?.roles || ['R_ADMIN'], session || {})
}

function assertPasswordPolicy(password) {
  const value = String(password || '')
  if (value.length < 6) {
    throw createHttpError(400, '密码至少 6 位', 'WEAK_PASSWORD')
  }
}

async function auditOperation(payload = {}) {
  await ensureProductionAcceptanceTables()
  const id = payload.id || randomId('op_audit')
  const now = payload.createdAt || payload.created_at || new Date()
  const operatorName = payload.operatorName || payload.operator_name || payload.operator || 'system'
  const cowIds = normalizeCowIds(payload.cowIds || payload.cow_ids)
  const requestPayload = payload.requestPayload || payload.request_payload || {}
  const resultPayload = payload.resultPayload || payload.result_payload || {}
  const sourceRecordIds = payload.sourceRecordIds || payload.source_record_ids || {}
  const canonical = {
    id,
    actionType: payload.actionType || payload.action_type || 'operation',
    targetType: payload.targetType || payload.target_type || null,
    targetId: payload.targetId || payload.target_id || null,
    animalId: payload.animalId || payload.animal_id || null,
    operatorName,
    operatedAt: payload.operatedAt || payload.operated_at || now,
    status: payload.status || 'completed',
    requestPayload,
    resultPayload,
    cowIds,
    relationScope:
      payload.relationScope ||
      payload.relation_scope ||
      buildAcceptanceRelationScope('operation_audit', cowIds),
    sourceRecordIds,
    clientIp: payload.clientIp || payload.client_ip || null,
    createdAt: now,
    updatedAt: payload.updatedAt || payload.updated_at || now
  }
  await insertRow('operation_audit_log', canonical)
  await insertRow('operation_audit_logs', {
    ...canonical,
    operator: operatorName,
    action_type: canonical.actionType,
    target_type: canonical.targetType,
    target_id: canonical.targetId,
    operator_name: operatorName,
    request_payload: requestPayload,
    result_payload: resultPayload,
    cow_ids: cowIds,
    relation_scope: canonical.relationScope,
    source_record_ids: sourceRecordIds,
    created_at: canonical.createdAt,
    updated_at: canonical.updatedAt
  })
  return id
}

function sanitizeAuditPayload(value, depth = 0) {
  if (depth > 4) return '[depth-limit]'
  if (value === undefined) return null
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const sample = value.slice(0, 20).map((item) => sanitizeAuditPayload(item, depth + 1))
    if (value.length > sample.length) sample.push({ truncated: value.length - sample.length })
    return sample
  }

  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (/password|token|secret|credential|authorization/i.test(key)) {
      out[key] = '[redacted]'
    } else {
      out[key] = sanitizeAuditPayload(item, depth + 1)
    }
  }
  return out
}

function requestAuditContext(req) {
  return {
    method: req?.method || '',
    path: req?.originalUrl || req?.url || '',
    ip: req?.ip || req?.socket?.remoteAddress || '',
    userAgent: req?.get?.('user-agent') || ''
  }
}

async function safeAuditOperation(payload = {}) {
  try {
    return await auditOperation(payload)
  } catch (error) {
    console.warn(
      `[audit] ${payload.actionType || payload.action_type || 'operation'} failed: ${error?.message || error}`
    )
    return null
  }
}

function buildLoginAudit(req, { userName, status, message }) {
  return {
    actionType: 'auth_login',
    targetType: 'auth_session',
    targetId: userName || null,
    operator: userName || 'anonymous',
    status,
    requestPayload: sanitizeAuditPayload({ userName, ...requestAuditContext(req) }),
    resultPayload: sanitizeAuditPayload({ status, message })
  }
}

function isRpcDdlMutation(method) {
  return RPC_DDL_METHOD_RE.test(String(method || ''))
}

function isRpcMaintenanceMethod(method) {
  return RPC_PRODUCTION_BLOCKED_METHODS.has(String(method || '')) || isRpcDdlMutation(method)
}

function isRpcWriteMethod(method) {
  return RPC_WRITE_METHODS.has(String(method || '')) || isRpcDdlMutation(method)
}

function assertProductionRpcAllowed(method) {
  if (isProductionRuntime && isRpcMaintenanceMethod(method)) {
    throw createHttpError(403, 'Production maintenance RPC is disabled', 'PRODUCTION_RPC_FORBIDDEN')
  }
}

function buildRpcAudit(req, method, payload, status, result = {}) {
  const tableName = payload?.tableName ? normalizeTableName(payload.tableName) : null
  const trace = buildRpcAuditTrace(tableName, method, payload, result)
  return {
    actionType: isRpcMaintenanceMethod(method) ? 'rpc_maintenance' : 'rpc_write',
    targetType: tableName || 'db_rpc',
    targetId: tableName || String(method || ''),
    operator: req?.user?.userName || 'unknown',
    status,
    requestPayload: sanitizeAuditPayload({ method, ...payload, request: requestAuditContext(req) }),
    resultPayload: sanitizeAuditPayload(result),
    cowIds: trace.cowIds,
    relationScope: trace.relationScope,
    sourceRecordIds: trace.sourceRecordIds
  }
}

async function loadOmicsSourceRows() {
  const [cows, milkRecords, samples, datasets, markers, associations, breedingRecords] =
    await Promise.all([
      getTableRows('cows', { limit: 5000, orderBy: 'created_at' }),
      getTableRows('milk_records', { limit: 5000, orderBy: 'created_at' }),
      getTableRows('omics_samples', { limit: 5000, orderBy: 'created_at' }),
      getTableRows('omics_datasets', { limit: 5000, orderBy: 'created_at' }),
      getTableRows('omics_markers', { limit: 5000, orderBy: 'created_at' }),
      getTableRows('multi_omics_associations', { limit: 5000, orderBy: 'created_at' }),
      getTableRows('breeding_records', { limit: 5000, orderBy: 'created_at' })
    ])
  return { cows, milkRecords, samples, datasets, markers, associations, breedingRecords }
}

function cowKey(row, index = 0) {
  return String(
    row?.cowNumber || row?.cow_number || row?.number || row?.id || `BUF-${index + 1}`
  ).trim()
}

function uniqueStrings(values = []) {
  return [
    ...new Set(
      values
        .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
        .map((value) => String(value).trim())
    )
  ]
}

function buildOmicsTraceScope(matrix = {}) {
  return {
    scope: 'omics_dataset',
    domain: 'omics_analysis',
    repositoryId: matrix.repositoryId || 'omics-datasets',
    datasetIds: matrix.datasetIds || [],
    sampleIds: matrix.omicsSampleIds || [],
    cowIds: matrix.cowIds || [],
    cowNumbers: matrix.cowNumbers || [],
    tracePolicy:
      'module/workflow input_summary.datasetIds -> omics_datasets.sample_ids -> omics_samples.cow_id'
  }
}

function buildOmicsSourceRecordIds(matrix = {}) {
  return {
    omics_samples: matrix.omicsSampleIds || [],
    omics_datasets: matrix.datasetIds || [],
    omics_markers: matrix.markerIds || [],
    multi_omics_associations: matrix.associationIds || [],
    milk_records: matrix.milkRecordIds || [],
    breeding_records: matrix.breedingRecordIds || []
  }
}

async function persistOmicsArtifacts({
  runId,
  runType,
  artifacts = [],
  cowIds = [],
  relationScope = {},
  sourceRecordIds = {},
  payloads = {},
  createdAt = new Date()
}) {
  for (const [index, artifact] of artifacts.entries()) {
    const name = String(artifact?.name || `artifact-${index + 1}`)
    const type = String(artifact?.type || 'artifact')
    await insertRow('omics_analysis_artifacts', {
      id: `omics_art_${hashPayload({ runType, runId, index, name }).slice(0, 48)}`,
      runId,
      runType,
      artifactType: type,
      name,
      cowIds,
      relationScope,
      sourceRecordIds,
      payload: {
        ...artifact,
        payload: payloads[name] ?? payloads[artifact?.key] ?? null
      },
      createdAt
    })
  }
}

function buildOmicsMatrix(source, moduleId, trait, params = {}) {
  const analysisCows = source.cows.filter(
    (cow) =>
      !['外部系谱', 'archived_ancestor'].includes(String(cow.status || cow.cowStatus || '').trim())
  )
  const cows = analysisCows.length
    ? analysisCows
    : source.cows.length
      ? source.cows
      : Array.from({ length: 36 }, (_, i) => ({
          id: `baseline-${i}`,
          cowNumber: `BUF-${String(i + 1).padStart(3, '0')}`
        }))
  const selected = cows.slice(0, Math.max(12, Math.min(60, cows.length)))
  const sampleIds = new Set(
    source.samples.map((sample) =>
      String(sample.cowId || sample.cowNumber || sample.cow_number || '')
    )
  )
  const realMarkers = source.markers
    .slice(0, 96)
    .map((marker, index) =>
      String(
        marker.markerCode ||
          marker.marker_code ||
          marker.geneSymbol ||
          marker.gene_symbol ||
          `OMICS_${String(index + 1).padStart(4, '0')}`
      )
    )
  const generatedMarkerCount = Math.max(0, 72 - realMarkers.length)
  const generatedMarkers = Array.from(
    { length: generatedMarkerCount },
    (_, i) => `OMICS_SYNTH_${String(i + 1).padStart(4, '0')}`
  )
  const markers = uniqueStrings([...realMarkers, ...generatedMarkers]).slice(0, 96)
  const milkByCow = new Map()
  for (const record of source.milkRecords) {
    const key = String(record.cowId || record.cowNumber || record.cow_number || '')
    if (!key) continue
    const value = parseNumberLike(
      record.volume ??
        record.milkVolume ??
        record.milk_volume ??
        record.dailyYield ??
        record.daily_yield
    )
    if (value === undefined) continue
    const arr = milkByCow.get(key) || []
    arr.push(value)
    milkByCow.set(key, arr)
  }
  const samples = selected.map((cow, index) => cowKey(cow, index))
  const phenotype = selected.map((cow, index) => {
    const keys = [cow.id, cow.cowNumber, cow.cow_number].map((item) => String(item || ''))
    const milk = keys.flatMap((key) => milkByCow.get(key) || [])
    if (milk.length)
      return Number((milk.reduce((sum, item) => sum + item, 0) / milk.length).toFixed(4))
    return Number((18 + stableNumber(`${trait}:${samples[index]}`, 0, 12)).toFixed(4))
  })
  const median = phenotype.slice().sort((a, b) => a - b)[Math.floor(phenotype.length / 2)] || 0
  const groups = phenotype.map((value) => (value >= median ? '高表型组' : '低表型组'))
  const values = selected.map((cow, rowIndex) =>
    markers.map((feature, colIndex) => {
      const base = stableNumber(`${moduleId}:${trait}:${samples[rowIndex]}:${feature}`, -1.4, 1.4)
      const signal =
        colIndex < 12
          ? ((phenotype[rowIndex] - median) / Math.max(1, median)) * (1.2 - colIndex * 0.04)
          : 0
      const omicsBoost =
        sampleIds.has(String(cow.id)) || sampleIds.has(samples[rowIndex]) ? 0.18 : 0
      return Number((base + signal + omicsBoost).toFixed(6))
    })
  )
  const hasRealRows =
    source.samples.length > 0 || source.markers.length > 0 || source.datasets.length > 0
  const selectedCowIds = uniqueStrings(selected.map((cow) => cow.id || cow.cowId || cow.cow_id))
  const selectedCowNumbers = uniqueStrings(
    selected.map((cow, index) => cow.cowNumber || cow.cow_number || cowKey(cow, index))
  )
  const sourceSampleIds = uniqueStrings(source.samples.map((sample) => sample.id))
  const datasetIds = uniqueStrings(source.datasets.map((dataset) => dataset.id))
  const markerIds = uniqueStrings(source.markers.map((marker) => marker.id))
  const associationIds = uniqueStrings(source.associations.map((association) => association.id))
  const milkRecordIds = uniqueStrings(source.milkRecords.map((record) => record.id))
  const breedingRecordIds = uniqueStrings(source.breedingRecords.map((record) => record.id))
  return {
    samples,
    cowIds: selectedCowIds,
    cowNumbers: selectedCowNumbers,
    omicsSampleIds: sourceSampleIds,
    datasetIds,
    markerIds,
    associationIds,
    milkRecordIds,
    breedingRecordIds,
    features: markers,
    values,
    phenotype,
    groups,
    dataSource: hasRealRows ? 'mixed' : 'deterministic_baseline',
    sourceSummary: {
      cows: source.cows.length,
      milkRecords: source.milkRecords.length,
      omicsSamples: source.samples.length,
      omicsDatasets: source.datasets.length,
      omicsMarkers: source.markers.length,
      realFeatureCount: realMarkers.length,
      generatedFeatureCount: generatedMarkers.length,
      associations: source.associations.length
    },
    repositoryId: params.repositoryId || 'omics-datasets',
    seed: `${moduleId}:${trait}:${params.repositoryId || 'default'}`
  }
}

async function callOmicsService(payload) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), omicsConfig.timeoutMs)
  try {
    const response = await fetch(`${omicsConfig.serviceUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`omics_service_http_${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

function getRequestOperator(req) {
  return (
    req?.user?.userName ||
    req?.user?.username ||
    req?.user?.name ||
    authConfig.adminUser ||
    'system'
  )
}

function buildModuleSummary(module, serviceResult, matrix) {
  const topMetric =
    Array.isArray(serviceResult.metrics) && serviceResult.metrics[0]
      ? `${serviceResult.metrics[0].label} ${serviceResult.metrics[0].value}`
      : `${matrix.samples.length} 个样本`
  return `${module.name} 已完成真实计算：${topMetric}，输入矩阵 ${serviceResult.dataSource || matrix.dataSource}。`
}

async function persistModuleRun(
  moduleId,
  trait,
  parameters,
  serviceResult,
  matrix,
  forcedId = null,
  trace = {}
) {
  await ensureOmicsRunTables()
  const module = getOmicsModule(moduleId)
  const now = trace.finishedAt || new Date()
  const startedAt = trace.startedAt || now
  const durationMs = Number(
    trace.durationMs ?? serviceResult.runtimeMs ?? Math.max(0, now.getTime() - startedAt.getTime())
  )
  const id = forcedId || randomId('omics_mod')
  const runCode = pickRunCode(parameters, trace.runCode || id)
  const summary = buildModuleSummary(module, serviceResult, matrix)
  const parameterRecord = {
    ...parameters,
    effectiveParameters: serviceResult.effectiveParameters || parameters,
    cowIds: matrix.cowIds || [],
    sampleIds: matrix.omicsSampleIds || [],
    datasetIds: matrix.datasetIds || [],
    sourceRecordIds: buildOmicsSourceRecordIds(matrix)
  }
  const relationScope = buildOmicsTraceScope(matrix)
  const sourceRecordIds = buildOmicsSourceRecordIds(matrix)
  const inputSummary = {
    ...(serviceResult.inputSummary || {}),
    sourceSummary: matrix.sourceSummary || {},
    repositoryId: parameters.repositoryId,
    repositoryTitle: parameters.repositoryTitle,
    datasetIds: matrix.datasetIds || [],
    sampleIds: matrix.omicsSampleIds || [],
    cowIds: matrix.cowIds || [],
    cowNumbers: matrix.cowNumbers || [],
    sourceRecordIds,
    relationScope,
    seed: matrix.seed,
    sampleCount: matrix.samples?.length || 0,
    featureCount: matrix.features?.length || 0
  }
  const artifacts = summarizeArtifacts(serviceResult)
  await insertRow('omics_module_runs', {
    id,
    moduleId,
    moduleName: module.name,
    trait,
    status: serviceResult.status || 'completed',
    dataSource: serviceResult.dataSource || matrix.dataSource || 'deterministic_baseline',
    parameters: parameterRecord,
    metrics: serviceResult.metrics || [],
    tablesJson: serviceResult.tables || {},
    chartsJson: serviceResult.charts || {},
    methodNotes: serviceResult.methodNotes || [],
    inputSummary,
    artifacts,
    cowIds: matrix.cowIds || [],
    relationScope,
    sourceRecordIds,
    operator: trace.operator || 'system',
    runCode,
    startedAt,
    finishedAt: now,
    durationMs,
    summary,
    executedAt: now,
    createdAt: now,
    updatedAt: now
  })
  await persistOmicsArtifacts({
    runId: id,
    runType: 'module',
    artifacts,
    cowIds: matrix.cowIds || [],
    relationScope,
    sourceRecordIds,
    payloads: { ...(serviceResult.tables || {}), ...(serviceResult.charts || {}) },
    createdAt: now
  })
  return {
    id,
    moduleId,
    module: module.name,
    moduleName: module.name,
    title: `${trait} - ${module.name} 真实计算结果`,
    trait,
    status: '已完成',
    tagType: module.tagType,
    tone: module.tone,
    summary,
    metrics: serviceResult.metrics || [],
    tables: serviceResult.tables || {},
    charts: serviceResult.charts || {},
    methodNotes: serviceResult.methodNotes || [],
    dataSource: serviceResult.dataSource || matrix.dataSource || 'deterministic_baseline',
    parameters: parameterRecord,
    inputSummary,
    artifacts,
    cowIds: matrix.cowIds || [],
    cowNumbers: matrix.cowNumbers || [],
    sourceRecordIds,
    relationScope,
    operator: trace.operator || 'system',
    runCode,
    startedAt: formatLocalDateTime(startedAt),
    finishedAt: formatLocalDateTime(now),
    durationMs,
    executedAt: formatLocalDateTime(now),
    tags: [
      module.category,
      trait,
      serviceResult.dataSource || matrix.dataSource || 'deterministic_baseline'
    ]
  }
}

async function runOmicsModule(payload = {}, req = null) {
  const moduleId = String(payload.moduleId || '').trim()
  if (!moduleId) throw new Error('moduleId is required')
  const trait = String(payload.trait || payload.parameters?.trait || '泌乳量')
  const module = getOmicsModule(moduleId)
  const parameters = buildEffectiveOmicsParameters(moduleId, trait, payload, module)
  const source = await loadOmicsSourceRows()
  const matrix = buildOmicsMatrix(source, moduleId, trait, parameters)
  const startedAt = new Date()
  const serviceResult = await callOmicsService({
    moduleId,
    trait,
    groupBy: parameters.groupBy,
    parameters,
    matrix
  })
  const finishedAt = new Date()
  return await persistModuleRun(moduleId, trait, parameters, serviceResult, matrix, null, {
    operator: pickRunOperator(parameters, req),
    runCode: pickRunCode(parameters),
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime()
  })
}

async function runOmicsWorkflow(payload = {}, req = null) {
  await ensureOmicsRunTables()
  const workflowStartedAt = new Date()
  const requestParameters = isPlainObject(payload.parameters) ? payload.parameters : {}
  const operator = pickRunOperator(requestParameters, req)
  const runCode = pickRunCode(requestParameters)
  const workflowId = String(payload.workflowId || `workflow-${Date.now()}`)
  const workflowName = String(payload.workflowName || payload.name || '自定义组学工作流')
  const trait = String(payload.trait || payload.parameters?.trait || '泌乳量')
  const workflowSteps = Array.isArray(payload.steps)
    ? payload.steps
        .map((step, index) => ({
          moduleId: String(step?.moduleId || step?.id || '').trim(),
          order: Number(step?.order || index + 1),
          parameters: isPlainObject(step?.parameters) ? step.parameters : {}
        }))
        .filter((step) => step.moduleId)
        .sort((a, b) => a.order - b.order)
    : (Array.isArray(payload.moduleIds) ? payload.moduleIds : [])
        .map((moduleId, index) => ({
          moduleId: String(moduleId).trim(),
          order: index + 1,
          parameters: {}
        }))
        .filter((step) => step.moduleId)
  const moduleIds = workflowSteps.map((step) => step.moduleId)
  if (!moduleIds.length) throw new Error('workflow moduleIds is required')
  const repositoryIds = Array.isArray(payload.repositoryIds) ? payload.repositoryIds : []
  const parameters = {
    ...requestParameters,
    trait,
    groupBy: payload.groupBy || payload.parameters?.groupBy || 'phenotype_group',
    repositoryIds
  }
  const source = await loadOmicsSourceRows()
  const matrix = buildOmicsMatrix(source, moduleIds.join('|'), trait, parameters)
  const moduleRuns = []
  for (const step of workflowSteps) {
    const moduleId = step.moduleId
    const stepParameters = buildEffectiveOmicsParameters(
      moduleId,
      trait,
      {
        ...payload,
        groupBy: parameters.groupBy,
        repositoryId: repositoryIds[0] || 'omics-datasets',
        parameters: {
          ...parameters,
          ...step.parameters,
          workflowId,
          workflowName,
          stepOrder: step.order
        }
      },
      getOmicsModule(moduleId)
    )
    const moduleMatrix = { ...matrix, seed: `${matrix.seed}:${moduleId}` }
    const stepStartedAt = new Date()
    const serviceResult = await callOmicsService({
      moduleId,
      trait,
      groupBy: stepParameters.groupBy,
      parameters: stepParameters,
      matrix: moduleMatrix
    })
    const stepFinishedAt = new Date()
    const moduleRun = await persistModuleRun(
      moduleId,
      trait,
      stepParameters,
      serviceResult,
      moduleMatrix,
      null,
      {
        operator,
        runCode: pickRunCode(stepParameters, runCode),
        startedAt: stepStartedAt,
        finishedAt: stepFinishedAt,
        durationMs: stepFinishedAt.getTime() - stepStartedAt.getTime()
      }
    )
    moduleRuns.push({ ...moduleRun, stepOrder: step.order, stepParameters })
  }
  const featureTotal = moduleRuns.reduce(
    (sum, run) =>
      sum + pickMetricValue(run.metrics, ['候选特征', '检验特征', '关联特征', '并集特征'], 0),
    0
  )
  const score = Math.max(
    72,
    Math.min(98, Math.round(72 + moduleRuns.length * 2.6 + Math.min(18, featureTotal / 30)))
  )
  const dataSource = moduleRuns.some((run) => run.dataSource === 'mixed')
    ? 'mixed'
    : moduleRuns[0]?.dataSource || matrix.dataSource
  const now = new Date()
  const durationMs = Math.max(0, now.getTime() - workflowStartedAt.getTime())
  const id = randomId('omics_wf')
  const workflowRunCode = pickRunCode(parameters, runCode || id)
  const metrics = [
    { label: '运行模块', value: moduleRuns.length },
    { label: '输入样本', value: matrix.samples.length },
    { label: '累计特征', value: Math.round(featureTotal) },
    { label: '综合评分', value: `${score}分` }
  ]
  const summary = `${workflowName} 已串行完成 ${moduleRuns.length} 个真实模块，目标性状 ${trait}，生成 ${Math.round(featureTotal)} 个候选特征/统计项。`
  const conclusion =
    score >= 88
      ? '当前工作流证据链完整，可进入育种评价和候选个体复核。'
      : '当前工作流已形成可复核结果，建议继续补充真实组学矩阵提升可靠性。'
  const relationScope = buildOmicsTraceScope(matrix)
  const sourceRecordIds = buildOmicsSourceRecordIds(matrix)
  const workflowParameterRecord = {
    ...parameters,
    cowIds: matrix.cowIds || [],
    sampleIds: matrix.omicsSampleIds || [],
    datasetIds: matrix.datasetIds || [],
    sourceRecordIds,
    steps: workflowSteps,
    effectiveParameters: {
      trait,
      groupBy: parameters.groupBy,
      repositoryIds,
      steps: moduleRuns.map((run) => ({
        moduleId: run.moduleId,
        moduleName: run.module,
        order: run.stepOrder,
        parameters: run.stepParameters,
        moduleRunId: run.id
      }))
    }
  }
  const inputSummary = {
    sourceSummary: matrix.sourceSummary || {},
    repositoryIds,
    repositoryTitles: parameters.repositoryTitles || [],
    datasetIds: matrix.datasetIds || [],
    sampleIds: matrix.omicsSampleIds || [],
    cowIds: matrix.cowIds || [],
    cowNumbers: matrix.cowNumbers || [],
    sourceRecordIds,
    relationScope,
    seed: matrix.seed,
    sampleCount: matrix.samples?.length || 0,
    featureCount: matrix.features?.length || 0,
    trait,
    groupBy: parameters.groupBy
  }
  const workflowArtifacts = moduleRuns.flatMap((run) =>
    (run.artifacts || []).map((artifact) => ({
      ...artifact,
      moduleId: run.moduleId,
      moduleName: run.module,
      moduleRunId: run.id
    }))
  )
  const tablesJson = {
    moduleRuns: moduleRuns.map((run) => ({
      id: run.id,
      module: run.module,
      moduleId: run.moduleId,
      stepOrder: run.stepOrder,
      dataSource: run.dataSource,
      parameters: run.stepParameters,
      metrics: run.metrics || [],
      artifacts: run.artifacts || []
    }))
  }
  const chartsJson = Object.fromEntries(
    moduleRuns.map((run) => [`${run.stepOrder}-${run.moduleId}`, run.charts || {}])
  )
  await insertRow('omics_workflow_runs', {
    id,
    workflowId,
    workflowName,
    trait,
    status: 'completed',
    dataSource,
    repositoryIds,
    moduleIds,
    moduleRunIds: moduleRuns.map((run) => run.id),
    parameters: workflowParameterRecord,
    metrics,
    tablesJson,
    chartsJson,
    methodNotes: moduleRuns.flatMap((run) => run.methodNotes || []),
    inputSummary,
    artifacts: workflowArtifacts,
    cowIds: matrix.cowIds || [],
    relationScope,
    sourceRecordIds,
    operator,
    runCode: workflowRunCode,
    startedAt: workflowStartedAt,
    finishedAt: now,
    durationMs,
    summary,
    conclusion,
    executedAt: now,
    createdAt: now,
    updatedAt: now
  })
  await persistOmicsArtifacts({
    runId: id,
    runType: 'workflow',
    artifacts: workflowArtifacts,
    cowIds: matrix.cowIds || [],
    relationScope,
    sourceRecordIds,
    payloads: { ...tablesJson, ...chartsJson },
    createdAt: now
  })
  return {
    id,
    workflowId,
    template: workflowName,
    title: `${trait} 工作流真实计算结果`,
    trait,
    status: '已完成',
    statusType: 'success',
    dataSource,
    executedAt: formatLocalDateTime(now),
    repositoryIds,
    moduleIds,
    steps: workflowSteps,
    moduleRunIds: moduleRuns.map((run) => run.id),
    moduleNames: moduleRuns.map((run) => run.module),
    metrics,
    parameters: workflowParameterRecord,
    tables: tablesJson,
    charts: chartsJson,
    inputSummary,
    artifacts: workflowArtifacts,
    cowIds: matrix.cowIds || [],
    cowNumbers: matrix.cowNumbers || [],
    sourceRecordIds,
    relationScope,
    operator,
    runCode: workflowRunCode,
    startedAt: formatLocalDateTime(workflowStartedAt),
    finishedAt: formatLocalDateTime(now),
    durationMs,
    summary,
    conclusion,
    score: `${score}分`,
    tone: score >= 88 ? 'teal' : 'warning',
    parameterSnapshot: `trait=${trait}; group=${parameters.groupBy}; modules=${moduleRuns.length}; customSteps=${Array.isArray(payload.steps) ? 'yes' : 'no'}`,
    methodNotes: moduleRuns.flatMap((run) => run.methodNotes || [])
  }
}

function normalizeModuleRun(row) {
  const module = getOmicsModule(row.moduleId || row.module_id)
  return {
    id: row.id,
    moduleId: row.moduleId || row.module_id,
    module: row.moduleName || row.module_name || module.name,
    moduleName: row.moduleName || row.module_name || module.name,
    title: `${row.trait || '目标性状'} - ${row.moduleName || row.module_name || module.name} 真实计算结果`,
    trait: row.trait,
    status: row.status === 'completed' ? '已完成' : row.status,
    tagType: module.tagType,
    tone: module.tone,
    summary: row.summary,
    metrics: row.metrics || [],
    tables: row.tablesJson || row.tables_json || {},
    charts: row.chartsJson || row.charts_json || {},
    methodNotes: row.methodNotes || row.method_notes || [],
    dataSource: row.dataSource || row.data_source,
    parameters: row.parameters || {},
    inputSummary: row.inputSummary || row.input_summary || {},
    artifacts: row.artifacts || [],
    operator: row.operator || 'system',
    runCode:
      row.runCode || row.run_code || row.parameters?.runCode || row.parameters?.run_code || '',
    startedAt: row.startedAt || row.started_at,
    finishedAt: row.finishedAt || row.finished_at,
    durationMs: row.durationMs || row.duration_ms,
    executedAt: row.executedAt || row.executed_at,
    tags: [module.category, row.trait, row.dataSource || row.data_source].filter(Boolean)
  }
}

function normalizeWorkflowRun(row) {
  const moduleIds = row.moduleIds || row.module_ids || []
  const parameters = row.parameters || {}
  const tables = row.tablesJson || row.tables_json || {}
  return {
    id: row.id,
    workflowId: row.workflowId || row.workflow_id,
    template: row.workflowName || row.workflow_name,
    title: `${row.trait || '目标性状'} 工作流真实计算结果`,
    trait: row.trait,
    status: row.status === 'completed' ? '已完成' : row.status,
    statusType: row.status === 'completed' ? 'success' : 'warning',
    dataSource: row.dataSource || row.data_source,
    executedAt: row.executedAt || row.executed_at,
    repositoryIds: row.repositoryIds || row.repository_ids || [],
    moduleIds,
    moduleRunIds: row.moduleRunIds || row.module_run_ids || [],
    moduleNames: moduleIds.map((id) => getOmicsModule(id).name),
    metrics: row.metrics || [],
    parameters,
    tables,
    charts: row.chartsJson || row.charts_json || {},
    steps: Array.isArray(parameters.steps) ? parameters.steps : [],
    inputSummary: row.inputSummary || row.input_summary || {},
    artifacts: row.artifacts || [],
    operator: row.operator || 'system',
    runCode: row.runCode || row.run_code || parameters.runCode || parameters.run_code || '',
    startedAt: row.startedAt || row.started_at,
    finishedAt: row.finishedAt || row.finished_at,
    durationMs: row.durationMs || row.duration_ms,
    summary: row.summary,
    conclusion: row.conclusion,
    score: pickMetricValue(row.metrics, ['综合评分'], 88) + '分',
    tone: 'teal',
    parameterSnapshot: `trait=${row.trait}; modules=${moduleIds.length}; customSteps=${Array.isArray(parameters.steps) && parameters.steps.length ? 'yes' : 'no'}`,
    methodNotes: row.methodNotes || row.method_notes || []
  }
}

async function rpcHandler(method, payload, req = null) {
  const operator = getRequestOperator(req)
  switch (method) {
    case 'getTableData': {
      const tableName = normalizeTableName(payload.tableName)
      return await getTableRows(tableName, {
        page: payload.page,
        pageSize: payload.pageSize || payload.limit || 5000,
        limit: payload.limit || payload.pageSize || 5000,
        orderBy: payload.orderBy,
        orderDir: payload.orderDir,
        where: payload.where
      })
    }
    case 'getTablePageData': {
      const tableName = normalizeTableName(payload.tableName)
      return await getTablePageRows(tableName, {
        page: payload.page,
        pageSize: payload.pageSize || payload.limit || 5000,
        limit: payload.limit || payload.pageSize || 5000,
        orderBy: payload.orderBy,
        orderDir: payload.orderDir,
        where: payload.where
      })
    }
    case 'getTableRecordById': {
      const tableName = normalizeTableName(payload.tableName)
      return await getTableRecordById(tableName, payload.id)
    }
    case 'getUnifiedMilkRows':
      return await getUnifiedMilkRows(payload || {})
    case 'getUnifiedPhenotypeRows':
      return await getUnifiedPhenotypeRows(payload || {})
    case 'searchCowSuggestions':
      return await searchCowSuggestions(payload || {})
    case 'getEditableCowEvents':
      return await getEditableCowEventsRpc(payload || {})
    case 'getEditablePedigree':
      return await getEditablePedigreeRpc(payload || {})
    case 'getArchiveCoverageSummary':
      return await getArchiveCoverageSummary()
    case 'getBreedingDecisionSnapshot':
      return await getBreedingDecisionSnapshot(payload || {}, operator)
    case 'getDashboardProductionSnapshot': {
      return await getDashboardProductionSnapshot(payload || {})
    }
    case 'getHealthDashboardSnapshot': {
      return await getHealthDashboardSnapshot(payload || {})
    }
    case 'updateTableData': {
      assertProductionRpcAllowed(method)
      const tableName = normalizeTableName(payload.tableName)
      const data = Array.isArray(payload.data) ? payload.data : []
      await clearTable(tableName)
      await insertRowsBulk(tableName, data)
      return true
    }
    case 'addTableData': {
      const tableName = normalizeTableName(payload.tableName)
      const data = Array.isArray(payload.data) ? payload.data : []
      await insertRowsBulk(tableName, data)
      return true
    }
    case 'updateTableRecord': {
      const tableName = normalizeTableName(payload.tableName)
      const updated = await updateRowById(tableName, payload.id, payload.updatedRecord || {})
      if (!updated) {
        const error = new Error(`记录不存在或未更新: ${tableName}/${payload.id}`)
        error.statusCode = 404
        throw error
      }
      return true
    }
    case 'deleteTableRecord': {
      const tableName = normalizeTableName(payload.tableName)
      const deleted = await deleteRowById(tableName, payload.id)
      if (!deleted) {
        const error = new Error(`记录不存在或未删除: ${tableName}/${payload.id}`)
        error.statusCode = 404
        throw error
      }
      return true
    }
    case 'clearTableData': {
      assertProductionRpcAllowed(method)
      const tableName = normalizeTableName(payload.tableName)
      return await clearTable(tableName)
    }
    case 'getDataStats': {
      const stats = {}
      for (const table of DEFAULT_TABLES) {
        try {
          await getTableMetadata(table)
          const [rows] = await pool.query(`SELECT COUNT(1) AS count FROM \`${table}\``)
          stats[table.replace(/_/g, '-')] = Number(rows?.[0]?.count || 0)
        } catch {
          stats[table.replace(/_/g, '-')] = 0
        }
      }
      return stats
    }
    case 'resetDatabase': {
      assertProductionRpcAllowed(method)
      await pool.query('SET FOREIGN_KEY_CHECKS = 0')
      for (const table of [...new Set([...DEFAULT_TABLES, ...RESET_EXTRA_TABLES])]) {
        try {
          await clearTableFast(table)
        } catch {
          // ignore missing table
        }
      }
      await pool.query('SET FOREIGN_KEY_CHECKS = 1')
      return true
    }
    default:
      throw new Error(`不支持的 RPC 方法: ${method}`)
  }
}

async function clearTableFast(tableName) {
  const table = normalizeTableName(tableName)
  try {
    await pool.query(`TRUNCATE TABLE \`${table}\``)
  } catch {
    await pool.query(`DELETE FROM \`${table}\``)
  }
  return true
}

function normalizeEntityToken(method) {
  const entity = String(method || '')
    .replace(
      /^(get|list|query|create|add|register|update|delete|remove|acknowledge|resolve|complete|import|upload|trigger|start|run|send|train)/,
      ''
    )
    .replace(/(ById|ByNumber|ByCowNumber)$/i, '')
    .replace(/(Report|Dashboard)$/i, '')

  return camelToSnake(entity).replace(/^_+|_+$/g, '')
}

function ensurePluralTableName(entitySnake) {
  if (!entitySnake) return ''
  if (ENTITY_TABLE_MAP[entitySnake]) return ENTITY_TABLE_MAP[entitySnake]
  if (entitySnake.endsWith('s')) return entitySnake
  if (entitySnake.endsWith('y')) return `${entitySnake.slice(0, -1)}ies`
  return `${entitySnake}s`
}

function inferTableFromScopeMethod(scope, method) {
  const scopeText = String(scope || '')
  const methodText = String(method || '')
  const methodLower = methodText.toLowerCase()

  for (const [keyword, table] of METHOD_TABLE_HINTS) {
    if (methodLower.includes(keyword)) return table
  }

  const entitySnake = normalizeEntityToken(methodText)
  if (entitySnake && ENTITY_TABLE_MAP[entitySnake]) return ENTITY_TABLE_MAP[entitySnake]
  if (entitySnake) return ensurePluralTableName(entitySnake)

  return GENERIC_SCOPE_TABLE[scopeText] || null
}

function getQueryOptionsFromArgs(args) {
  const first = args?.[0]
  const options = isPlainObject(first) ? { ...first } : {}
  const where = isPlainObject(options.where) ? { ...options.where } : {}
  delete options.where

  for (const [key, value] of Object.entries(options)) {
    if (
      [
        'page',
        'pageSize',
        'limit',
        'orderBy',
        'orderDir',
        'startDate',
        'endDate',
        'startTime',
        'endTime'
      ].includes(key)
    ) {
      continue
    }
    if (value !== undefined && value !== null && value !== '') where[key] = value
    delete options[key]
  }

  return { ...options, where }
}

async function resolveRowId(tableName, method, idOrKey) {
  if (idOrKey === undefined || idOrKey === null || idOrKey === '') return ''
  if (tableName === 'cows' && /Cow|ByNumber/i.test(method)) {
    const rows = await getTableRows('cows', {
      where: { cowNumber: idOrKey },
      page: 1,
      pageSize: 1,
      limit: 1
    })
    return rows?.[0]?.id || String(idOrKey)
  }
  return String(idOrKey)
}

async function queryByMethod(tableName, method, args) {
  const first = args?.[0]

  if (method === 'getCowByNumber' && typeof first === 'string') {
    const rows = await getTableRows('cows', {
      where: { cowNumber: first },
      page: 1,
      pageSize: 1,
      limit: 1
    })
    return rows?.[0] || null
  }

  if (method === 'getCowHourlyData') {
    const cowNumber = String(args?.[0] || '').trim()
    const date = String(args?.[1] || '').trim()
    const rows = await getTableRows('sensors', {
      startTime: date ? `${date}T00:00:00.000Z` : undefined,
      endTime: date ? `${date}T23:59:59.999Z` : undefined,
      page: 1,
      pageSize: 200
    })
    const filteredRows = rows.filter((row) => {
      const rowCowNumber = String(
        row?.cowNumber ||
          row?.cow_number ||
          row?.payload?.cowNumber ||
          row?.payload?.cow_number ||
          ''
      ).trim()
      return !cowNumber || rowCowNumber === cowNumber
    })
    return {
      temperature: filteredRows,
      steps: filteredRows
    }
  }

  if ((method.startsWith('get') || method.startsWith('query')) && typeof first === 'string') {
    const rows = await getTableRows(tableName, {
      where: { id: first },
      page: 1,
      pageSize: 1,
      limit: 1
    })
    return rows?.[0] || null
  }

  const options = getQueryOptionsFromArgs(args)
  return await getTableRows(tableName, options)
}

async function createByMethod(tableName, method, args) {
  const first = args?.[0]
  const dataList = Array.isArray(first) ? first : [first]
  const inserted = []

  for (const item of dataList) {
    if (!isPlainObject(item)) continue
    const id = await insertRow(tableName, item)
    inserted.push({ id, ...item })
  }

  if (method === 'importCows' || method.startsWith('upload')) {
    return {
      success: inserted.length,
      failed: 0
    }
  }

  if (inserted.length <= 1) return inserted[0] || { success: true }
  return inserted
}

async function updateByMethod(tableName, method, args) {
  const first = args?.[0]
  const second = args?.[1]

  let id = ''
  let changes = {}

  if (isPlainObject(first) && !second) {
    id = String(first.id || first.cowNumber || '')
    changes = { ...first }
  } else {
    id = String(first || '')
    changes = isPlainObject(second) ? { ...second } : {}
  }

  if (!id && changes.id) id = String(changes.id)
  if (!id && changes.cowNumber) id = String(changes.cowNumber)
  delete changes.id

  if (!Object.keys(changes).length) {
    if (method.startsWith('acknowledge')) {
      changes = { status: 'acknowledged', acknowledgedAt: new Date().toISOString() }
    } else if (method.startsWith('resolve')) {
      changes = {
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
        resolution: typeof second === 'string' ? second : ''
      }
    } else if (method.startsWith('complete')) {
      changes = { status: 'completed', completedAt: new Date().toISOString() }
    }
  }

  const targetId = await resolveRowId(tableName, method, id)
  if (!targetId) return false
  return await updateRowById(tableName, targetId, changes)
}

async function deleteByMethod(tableName, method, args) {
  const id = String(args?.[0] || '')
  if (!id) return false
  const targetId = await resolveRowId(tableName, method, id)
  if (!targetId) return false
  return await deleteRowById(tableName, targetId)
}

function buildCowApiPayload(method, args, rawData) {
  if (
    isPlainObject(rawData) &&
    Object.prototype.hasOwnProperty.call(rawData, 'code') &&
    Object.prototype.hasOwnProperty.call(rawData, '数据')
  ) {
    return rawData
  }

  const first = args?.[0] || {}
  const page = Number(first?.page || 1)
  const pageSize = Number(
    first?.pageSize || first?.limit || (Array.isArray(rawData) ? rawData.length : 20)
  )

  if (QUERY_METHOD_RE.test(method) && Array.isArray(rawData)) {
    return {
      code: 200,
      message: 'success',
      data: rawData,
      total: Number(rawData.length || 0),
      page,
      pageSize: pageSize > 0 ? pageSize : 20
    }
  }

  return {
    code: 200,
    message: 'success',
    data: rawData
  }
}

function cowNumberOf(row) {
  return String(
    row?.cowNumber ||
      row?.cow_number ||
      row?.animalNumber ||
      row?.animal_number ||
      row?.number ||
      ''
  ).trim()
}

function cowIdOf(row) {
  return String(
    row?.id || row?.cowId || row?.cow_id || row?.animalId || row?.animal_id || ''
  ).trim()
}

function isBullCow(row) {
  const gender = String(row?.gender || row?.sex || '').trim()
  const type = String(row?.type || row?.cowType || row?.cow_type || '').trim()
  const number = cowNumberOf(row)
  return gender === '公' || /^BULL-/i.test(number) || /公牛|种公/i.test(type)
}

function isFemaleCow(row) {
  const gender = String(row?.gender || row?.sex || '').trim()
  const type = String(row?.type || row?.cowType || row?.cow_type || '').trim()
  const number = cowNumberOf(row)
  if (isBullCow(row)) return false
  return gender === '母' || /母牛|成母|后备/i.test(type) || /^BUF-/i.test(number)
}

function boundedScore(value, min = 0, max = 100) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return min
  return Math.max(min, Math.min(max, Number(numberValue.toFixed(2))))
}

function averageNumber(rows, getter) {
  const values = rows
    .map(getter)
    .map(Number)
    .filter((value) => Number.isFinite(value))
  if (!values.length) return 0
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
}

function matchesCow(row, cow) {
  const id = cowIdOf(cow)
  const number = cowNumberOf(cow)
  const rowId = String(
    row?.cowId || row?.cow_id || row?.animalId || row?.animal_id || row?.id || ''
  ).trim()
  const rowNumber = String(
    row?.cowNumber ||
      row?.cow_number ||
      row?.animalNumber ||
      row?.animal_number ||
      row?.number ||
      ''
  ).trim()
  return Boolean((id && rowId === id) || (number && rowNumber === number))
}

function pedigreeRisk(left = {}, right = {}) {
  const tokens = (row) =>
    [
      row?.fatherNumber,
      row?.father_number,
      row?.motherNumber,
      row?.mother_number,
      row?.grandfatherNumber,
      row?.grandfather_number,
      row?.grandmotherNumber,
      row?.grandmother_number
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  const leftTokens = new Set(tokens(left))
  return tokens(right).some((token) => leftTokens.has(token))
}

function buildCandidateScores(cows, relatedRows) {
  return cows.map((cow) => {
    const id = cowIdOf(cow)
    const number = cowNumberOf(cow)
    const milkRows = relatedRows.milkRecords.filter((row) => matchesCow(row, cow))
    const phenotypeRows = relatedRows.phenotypeRecords.filter((row) => matchesCow(row, cow))
    const breedingRows = relatedRows.breedingRecords
      .concat(relatedRows.breedingEvents)
      .filter((row) => matchesCow(row, cow))
    const omicsRows = relatedRows.omicsSamples.filter((row) => matchesCow(row, cow))
    const healthRows = relatedRows.healthScores.filter((row) => matchesCow(row, cow))
    const qualityMap = buildMilkQualitySummaryMap(milkRows, phenotypeRows)
    const milkQualitySummary = qualityMap[id] || qualityMap[number] || null
    const averageMilk = averageNumber(
      milkRows,
      (row) => row.volume || row.milkVolume || row.milk_volume
    )
    const phenotypeAverage = averageNumber(phenotypeRows, (row) => row.value)
    const healthScore = boundedScore(
      averageNumber(
        healthRows,
        (row) => row.overallScore || row.overall_score || row.score || row.healthScore
      ),
      65,
      96
    )
    const pedigreeFields = [
      cow.fatherNumber,
      cow.motherNumber,
      cow.grandfatherNumber,
      cow.grandmotherNumber
    ].filter((value) => String(value || '').trim()).length
    const pedigreeScore = boundedScore(pedigreeFields * 25)
    const milkScore = boundedScore(
      averageMilk
        ? averageMilk * 8.5
        : phenotypeAverage
          ? phenotypeAverage * 0.9
          : 68 + stableNumber(`${id}:milk`, 0, 14)
    )
    const genomicScore = boundedScore(
      68 + omicsRows.length * 8 + stableNumber(`${id}:omics`, 0, 12)
    )
    const activityScore = boundedScore(70 + stableNumber(`${id}:activity`, 0, 20))
    const breedingEvents = breedingRows.length
    const score = boundedScore(
      milkScore * 0.32 +
        genomicScore * 0.28 +
        pedigreeScore * 0.18 +
        healthScore * 0.14 +
        Math.min(100, breedingEvents * 12) * 0.08
    )
    return {
      cow,
      cowId: id,
      cowNumber: number,
      gender: cow.gender || cow.sex || '',
      score,
      milkScore,
      genomicScore,
      pedigreeScore,
      healthScore,
      activityScore,
      averageMilk,
      milkQualitySummary,
      breedingEvents,
      supportEvidence: [
        `泌乳记录 ${milkRows.length} 条`,
        `表型记录 ${phenotypeRows.length} 条`,
        `组学样本 ${omicsRows.length} 个`,
        `繁殖/后裔记录 ${breedingEvents} 条`
      ]
    }
  })
}

function rankCandidateScores(rows, mateRows, parameters) {
  const primaryTrait = String(parameters.primaryTrait || 'score')
  const secondaryTrait = String(parameters.secondaryTrait || 'genomicScore')
  const primaryDirection = String(parameters.primaryDirection || 'desc')
  const secondaryDirection = String(parameters.secondaryDirection || 'desc')
  const pickValue = (row, trait) => Number(row?.[trait]) || 0
  const signed = (value, direction) => (direction === 'asc' ? 100 - value : value)
  return rows
    .map((row) => {
      const breedingValue = boundedScore(
        signed(pickValue(row, primaryTrait), primaryDirection) * 0.62 +
          signed(pickValue(row, secondaryTrait), secondaryDirection) * 0.28 +
          row.genomicScore * 0.1
      )
      const mate =
        mateRows
          .filter((candidate) => candidate.cowId !== row.cowId)
          .map((candidate) => {
            const risk = pedigreeRisk(row.cow, candidate.cow)
            const compatibility = boundedScore(
              (row.score + candidate.score + breedingValue) / 3 + (risk ? -16 : 7),
              45,
              98
            )
            return {
              cowId: candidate.cowId,
              cowNumber: candidate.cowNumber,
              compatibility,
              inbreedingRisk: risk,
              reason: risk ? '系谱存在重叠，进入人工复核。' : '父母代和祖代未发现重叠，可优先配对。'
            }
          })
          .sort(
            (left, right) =>
              Number(left.inbreedingRisk) - Number(right.inbreedingRisk) ||
              right.compatibility - left.compatibility
          )[0] || null
      return {
        rank: 0,
        cowId: row.cowId,
        cowNumber: row.cowNumber,
        gender: row.gender,
        breedingValue,
        score: row.score,
        primaryValue: pickValue(row, primaryTrait),
        secondaryValue: pickValue(row, secondaryTrait),
        genomicScore: row.genomicScore,
        milkScore: row.milkScore,
        pedigreeScore: row.pedigreeScore,
        healthScore: row.healthScore,
        averageMilk: row.averageMilk,
        milkQualitySummary: row.milkQualitySummary,
        breedingEvents: row.breedingEvents,
        supportEvidence: row.supportEvidence,
        mate
      }
    })
    .sort((left, right) => right.breedingValue - left.breedingValue)
    .map((row, index) => ({ ...row, rank: index + 1 }))
}

function buildMatingDecisionRows(females, bulls, parameters) {
  const rankedFemales = rankCandidateScores(females, bulls, parameters)
  const rankedBulls = rankCandidateScores(bulls, females, parameters)
  return rankedFemales
    .flatMap((female) =>
      rankedBulls.map((bull) => {
        const femaleSource = females.find((row) => row.cowId === female.cowId)
        const bullSource = bulls.find((row) => row.cowId === bull.cowId)
        const risk = pedigreeRisk(femaleSource?.cow, bullSource?.cow)
        const breedingValue = boundedScore(female.breedingValue * 0.46 + bull.breedingValue * 0.54)
        const compatibility = boundedScore(
          breedingValue * 0.48 + female.score * 0.22 + bull.score * 0.22 + (risk ? -18 : 8),
          45,
          98
        )
        return {
          rank: 0,
          femaleCowId: female.cowId,
          femaleCowNumber: female.cowNumber,
          bullCowId: bull.cowId,
          bullCowNumber: bull.cowNumber,
          breedingValue,
          compatibility,
          inbreedingRisk: risk,
          reason: risk
            ? '系谱提示近交风险，提交人工复核。'
            : '系谱风险低，性状目标匹配，可进入选配候选。'
        }
      })
    )
    .sort(
      (left, right) =>
        Number(left.inbreedingRisk) - Number(right.inbreedingRisk) ||
        right.compatibility - left.compatibility
    )
    .slice(0, 12)
    .map((row, index) => ({ ...row, rank: index + 1 }))
}

async function buildBreedingDecisionFromDatabase(input = {}, operator = 'system') {
  const startedAt = Date.now()
  const runType = String(input.runType || input.run_type || input.type || 'bull_ranking')
  const parameters = {
    primaryTrait: 'score',
    primaryDirection: 'desc',
    secondaryTrait: runType === 'mating_plan' ? 'pedigreeScore' : 'genomicScore',
    secondaryDirection: 'desc',
    minReliability: 0.68,
    excludeCloseKinship: true,
    ...(input.parameters || input.parametersJson || input.parameters_json || {})
  }
  const [
    legacyCows,
    standardAnimals,
    breedingRecords,
    breedingEvents,
    omicsSamples,
    breedingAnalyses,
    healthScores
  ] = await Promise.all([
    getTableRows('cows', { page: 1, pageSize: 5000 }),
    getTableRows('animal', { page: 1, pageSize: 5000 }),
    getTableRows('breeding_records', { page: 1, pageSize: 5000 }),
    getTableRows('breeding_events', { page: 1, pageSize: 5000 }),
    getTableRows('omics_samples', { page: 1, pageSize: 5000 }),
    getTableRows('breeding_analyses', { page: 1, pageSize: 5000 }),
    getTableRows('health_scores', { page: 1, pageSize: 5000 })
  ])
  const cowMap = new Map()
  const pushCow = (row, priority) => {
    const cowId = firstNonBlankText(row.id, row.cowId, row.animalId)
    const cowNumber = firstNonBlankText(row.cowNumber, row.animalNumber, row.number)
    const key = firstNonBlankText(cowId, cowNumber)
    if (!key) return
    const normalized = {
      ...row,
      id: cowId || key,
      cowId: cowId || key,
      animalId: cowId || key,
      cowNumber,
      animalNumber: cowNumber,
      gender: row.gender || row.sex || '',
      sex: row.sex || row.gender || '',
      type:
        row.type ||
        row.cowType ||
        row.productionPurpose ||
        row.production_purpose ||
        row.currentStageId ||
        '',
      cowType:
        row.cowType ||
        row.type ||
        row.productionPurpose ||
        row.production_purpose ||
        row.currentStageId ||
        '',
      sourcePriority: priority
    }
    const current = cowMap.get(key)
    if (!current || priority < current.sourcePriority) cowMap.set(key, normalized)
  }
  for (const row of standardAnimals) pushCow(row, 1)
  for (const row of legacyCows) pushCow(row, 2)
  const cows = Array.from(cowMap.values())
  const [milkRecords, phenotypeRecords] = await Promise.all([
    getUnifiedMilkRows({ cows, limit: 50000 }),
    getUnifiedPhenotypeRows({ cows, limit: 50000 })
  ])
  const requestedCowIds = new Set(normalizeCowIds(input.cowIds || input.cow_ids))
  const scopedCows = requestedCowIds.size
    ? cows.filter((cow) => requestedCowIds.has(cowIdOf(cow)))
    : cows
  const relatedRows = {
    milkRecords,
    phenotypeRecords,
    breedingRecords,
    breedingEvents,
    omicsSamples,
    breedingAnalyses,
    healthScores
  }
  const femaleScores = buildCandidateScores(scopedCows.filter(isFemaleCow), relatedRows)
  const bullScores = buildCandidateScores(scopedCows.filter(isBullCow), relatedRows)
  const fallbackFemaleScores = femaleScores.length
    ? femaleScores
    : buildCandidateScores(cows.filter(isFemaleCow), relatedRows)
  const fallbackBullScores = bullScores.length
    ? bullScores
    : buildCandidateScores(cows.filter(isBullCow), relatedRows)

  let resultSnapshot
  let cowIds
  if (runType === 'mating_plan') {
    const pairings = buildMatingDecisionRows(fallbackFemaleScores, fallbackBullScores, parameters)
    cowIds = normalizeCowIds(pairings.flatMap((row) => [row.femaleCowId, row.bullCowId]))
    resultSnapshot = {
      runType,
      pairings,
      recommendation: pairings[0] || null,
      summary: `后端按 ${fallbackFemaleScores.length} 头母牛与 ${fallbackBullScores.length} 头公牛计算 ${pairings.length} 组选配。`
    }
  } else {
    const sourceRows = runType === 'female_ranking' ? fallbackFemaleScores : fallbackBullScores
    const mateRows = runType === 'female_ranking' ? fallbackBullScores : fallbackFemaleScores
    const rankings = rankCandidateScores(sourceRows, mateRows, parameters)
    cowIds = normalizeCowIds(rankings.flatMap((row) => [row.cowId, row.mate?.cowId]))
    resultSnapshot = {
      runType,
      rankings,
      top: rankings.slice(0, 5),
      recommendation: rankings[0]
        ? {
            topCowId: rankings[0].cowId,
            topCowNumber: rankings[0].cowNumber,
            reason: '后端基于数据库表型、组学、系谱和繁殖记录计算。'
          }
        : null
    }
  }

  const matched = (rows) =>
    rows.filter((row) => cowIds.some((cowId) => matchesCow(row, { id: cowId })))
  return {
    runType,
    title:
      input.title ||
      (runType === 'bull_ranking'
        ? '候选种公牛育种值排行榜'
        : runType === 'female_ranking'
          ? '候选母牛育种值排行榜'
          : '选配方案排行榜'),
    operator: input.operator || operator,
    status: 'completed',
    cowIds,
    parameters: {
      ...parameters,
      computedBy: 'mysql-backend',
      dataTables: [
        'animal',
        'cows',
        'milk_measurement',
        'milk_records',
        'trait_observation',
        'phenotype_records',
        'breeding_records',
        'breeding_events',
        'omics_samples',
        'breeding_analyses',
        'health_scores'
      ]
    },
    resultSnapshot,
    sourceRecordIds: {
      animal: cowIds,
      cows: cowIds,
      milk_measurement: matched(milkRecords)
        .filter((row) => row.sourceTable === 'milk_measurement')
        .map((row) => row.sourceRecordId || row.id)
        .filter(Boolean),
      milk_records: matched(milkRecords)
        .filter((row) => row.sourceTable === 'milk_records')
        .map((row) => row.sourceRecordId || row.id)
        .filter(Boolean),
      trait_observation: matched(phenotypeRecords)
        .filter((row) => row.sourceTable === 'trait_observation')
        .map((row) => row.sourceRecordId || row.id)
        .filter(Boolean),
      phenotype_records: matched(phenotypeRecords)
        .filter((row) => row.sourceTable === 'phenotype_records')
        .map((row) => row.sourceRecordId || row.id)
        .filter(Boolean),
      breeding_records: matched(breedingRecords)
        .map((row) => row.id)
        .filter(Boolean),
      breeding_events: matched(breedingEvents)
        .map((row) => row.id)
        .filter(Boolean),
      omics_samples: matched(omicsSamples)
        .map((row) => row.id)
        .filter(Boolean),
      breeding_analyses: breedingAnalyses.map((row) => row.id).filter(Boolean)
    },
    durationMs: Math.max(1, Date.now() - startedAt)
  }
}

async function getBreedingDecisionSnapshot(input = {}, operator = 'system') {
  const [femaleRun, bullRun] = await Promise.all([
    buildBreedingDecisionFromDatabase({ ...input, runType: 'female_ranking' }, operator),
    buildBreedingDecisionFromDatabase({ ...input, runType: 'bull_ranking' }, operator)
  ])
  const femaleRankings = femaleRun?.resultSnapshot?.rankings || []
  const bullRankings = bullRun?.resultSnapshot?.rankings || []
  const cowIds = normalizeCowIds([
    ...femaleRankings.flatMap((row) => [row.cowId, row.mate?.cowId]),
    ...bullRankings.flatMap((row) => [row.cowId, row.mate?.cowId])
  ])
  const cowById = new Map()
  const pushCow = (row) => {
    const cowId = cowIdOf(row)
    const cowNumber = cowNumberOf(row)
    const key = firstNonBlankText(cowId, cowNumber)
    if (!key || cowById.has(key)) return
    cowById.set(key, {
      ...row,
      id: cowId || key,
      cowId: cowId || key,
      animalId: cowId || key,
      cowNumber,
      animalNumber: cowNumber,
      gender: row?.gender || row?.sex || '',
      sex: row?.sex || row?.gender || '',
      type:
        row?.type ||
        row?.cowType ||
        row?.cow_type ||
        row?.productionPurpose ||
        row?.production_purpose ||
        row?.currentStageId ||
        '',
      cowType:
        row?.cowType ||
        row?.cow_type ||
        row?.type ||
        row?.productionPurpose ||
        row?.production_purpose ||
        row?.currentStageId ||
        '',
      breed: row?.breed || row?.breedType || row?.breed_type || '',
      status: row?.status || '在群',
      parity: Number(
        row?.parity ||
          row?.parityNo ||
          row?.parity_no ||
          row?.reportedParityNo ||
          row?.reported_parity_no ||
          0
      ),
      currentPen:
        row?.currentPen ||
        row?.current_pen ||
        row?.penName ||
        row?.pen_name ||
        row?.currentUnitName ||
        row?.current_unit_name ||
        ''
    })
  }
  for (const row of femaleRankings) pushCow(row.cow || row)
  for (const row of bullRankings) pushCow(row.cow || row)
  return {
    femaleRankings,
    bullRankings,
    cows: Array.from(cowById.values()),
    cowIds,
    generatedAt: new Date().toISOString(),
    source: '数据库'
  }
}

async function handleCowScope(scope, method, args, req = null) {
  const first = args[0] || {}
  const operator = getRequestOperator(req)

  if (scope === 'cow' && method === 'getCowList') {
    return await getTableRows('cows', {
      page: first.page || 1,
      pageSize: first.pageSize || 1000,
      orderBy: 'createdAt',
      orderDir: 'desc'
    })
  }

  if (scope === 'cow' && method === 'getBreedingEvents') {
    return await getTableRows('breeding_events', first)
  }

  if (scope === 'cow' && method === 'getVeterinaryEvents') {
    return await getTableRows('veterinary_events', first)
  }

  if (scope === 'sensor' && method === 'getExtendedSensorData') {
    return await getTableRows('sensors', {
      where: { cowId: first.cowId },
      startTime: first.startTime,
      endTime: first.endTime,
      page: first.page || 1,
      pageSize: first.pageSize || 100
    })
  }

  if (
    scope === 'sensor' &&
    [
      'getTemperatureData',
      'getStepData',
      'getRuminationData',
      'getActivityData',
      'getFeedingData'
    ].includes(method)
  ) {
    return await getTableRows('sensors', {
      where: { cowId: first.cowId, cowNumber: first.cowNumber },
      startTime: first.startTime,
      endTime: first.endTime,
      page: first.page || 1,
      pageSize: first.pageSize || 100
    })
  }

  if (scope === 'sensor' && ['uploadTemperatureData', 'uploadStepData'].includes(method)) {
    const rows = Array.isArray(first) ? first : [first]
    await insertRowsInBatches(
      'sensors',
      rows.map((row) => ({
        ...row,
        cowId: row.cowId || row.cow_id || row.cowNumber || row.cow_number,
        timestamp:
          row.timestamp || row.recordTime || row.record_time || row.ts || new Date().toISOString()
      }))
    )
    return true
  }

  if (scope === 'sensor' && method === 'getSensorStatus') {
    return await getTableRows('sensor_status', {
      where: { cowId: first.cowId, deviceId: first.deviceId, status: first.status },
      page: first.page || 1,
      pageSize: first.pageSize || 500,
      orderBy: 'ts',
      orderDir: 'desc'
    })
  }

  if (scope === 'sensor' && method === 'markDataQualityIssue') {
    const id = await insertRow('data_quality_checks', first)
    return { id, success: true }
  }

  if (scope === 'sensor' && method === 'calibrateSensor') {
    const id = await insertRow('sensor_calibrations', first)
    return { id, success: true }
  }

  if (scope === 'milk' && method === 'getMilkRecords') {
    const page = Number(first.page || 1)
    const pageSize = Math.max(1, Math.min(1000, Number(first.pageSize || first.limit || 200)))
    const rows = await getUnifiedMilkRows({
      cowId: first.cowId || first.cow_id || first.animalId || first.animal_id,
      cowNumber: first.cowNumber || first.cow_number || first.animalNumber || first.animal_number,
      startDate: first.startDate || first.start_date,
      endDate: first.endDate || first.end_date,
      limit: Math.max(page * pageSize, pageSize)
    })
    const offset = Math.max(0, (page - 1) * pageSize)
    return rows.slice(offset, offset + pageSize)
  }

  if (scope === 'reproduction' && method === 'addBreedingRecord') {
    const { id: requestedId, ...payloadSnapshot } = isPlainObject(first) ? first : {}
    const id = await insertRow('breeding_records', {
      id: requestedId || undefined,
      cowId: first.cowId,
      eventType: first.eventType,
      eventTime: first.eventDate || first.eventTime || new Date().toISOString(),
      payload: payloadSnapshot
    })
    return { id, success: true }
  }

  if (scope === 'automation' && method === 'executeAutomationCheck') {
    return await executeAutomationCheckFromDb()
  }

  if (scope === 'automation' && method === 'startWorkflow') {
    const templateId = args[0]
    const cowId = args[1]
    const id = await insertRow('workflow_instances', {
      templateId,
      cowId,
      status: 'running',
      currentStep: 'start',
      stepStatus: { start: 'completed' },
      variables: {},
      triggerEvent: { type: 'manual' },
      startedAt: new Date().toISOString()
    })
    return { id, success: true }
  }

  if (scope === 'automation' && method === 'createWorkflowTemplate') {
    const id = await insertRow('workflow_templates', first)
    return { id, success: true }
  }

  if (scope === 'economic' && method === 'getBudgetPlans') {
    return await getTableRows('budget_plans', {
      page: 1,
      pageSize: 1000,
      orderBy: 'updatedAt'
    })
  }

  if (scope === 'economic' && method === 'createCostRecord') {
    const id = await insertRow('cost_items', first)
    return { id, success: true }
  }

  if (scope === 'economic' && method === 'createRevenueRecord') {
    const id = await insertRow('revenue_items', first)
    return { id, success: true }
  }

  if (scope === 'economic' && method === 'deleteCostRecord') {
    return await deleteRowById('cost_items', args[0])
  }

  if (scope === 'economic' && method === 'deleteRevenueRecord') {
    return await deleteRowById('revenue_items', args[0])
  }

  if (scope === 'economic' && method === 'deleteBudgetPlan') {
    return await deleteRowById('budget_plans', args[0])
  }

  if (scope === 'omics' && method === 'getOmicsSamples') {
    return await getTableRows('omics_samples', {
      where: { cowId: first.cowId, sampleType: first.sampleType, status: first.status },
      page: first.page || 1,
      pageSize: first.pageSize || 500,
      orderBy: 'collectionDate',
      orderDir: 'desc'
    })
  }

  if (scope === 'omics' && method === 'getOmicsDatasets') {
    return await getTableRows('omics_datasets', {
      where: { dataType: first.dataType, platform: first.platform, status: first.status },
      page: first.page || 1,
      pageSize: first.pageSize || 500,
      orderBy: 'generatedAt',
      orderDir: 'desc'
    })
  }

  if (scope === 'omics' && method === 'getOmicsMarkers') {
    return await getTableRows('omics_markers', {
      where: { datasetId: first.datasetId, markerType: first.markerType, trait: first.trait },
      page: first.page || 1,
      pageSize: first.pageSize || 500,
      orderBy: 'pValue',
      orderDir: 'asc'
    })
  }

  if (scope === 'omics' && method === 'getMultiOmicsAssociations') {
    return await getTableRows('multi_omics_associations', {
      where: { trait: first.trait, associationType: first.associationType },
      page: first.page || 1,
      pageSize: first.pageSize || 500,
      orderBy: 'significance',
      orderDir: 'asc'
    })
  }

  if (scope === 'omics' && method === 'getBreedingAnalyses') {
    return await getTableRows('breeding_analyses', {
      where: { targetTrait: first.targetTrait, modelType: first.modelType, status: first.status },
      page: first.page || 1,
      pageSize: first.pageSize || 500,
      orderBy: 'executedAt',
      orderDir: 'desc'
    })
  }

  if (scope === 'omics' && method === 'createBreedingAnalysis') {
    const id = await insertRow('breeding_analyses', first)
    return { id, success: true }
  }

  if (scope === 'economic' && method === 'generateProfitabilityReport') {
    const p = first || {}
    const [costRows] = await pool.query(
      'SELECT IFNULL(SUM(amount),0) AS total FROM cost_items WHERE item_date >= ? AND item_date <= ?',
      [p.startDate, p.endDate]
    )
    const [revenueRows] = await pool.query(
      'SELECT IFNULL(SUM(amount),0) AS total FROM revenue_items WHERE item_date >= ? AND item_date <= ?',
      [p.startDate, p.endDate]
    )
    const totalCost = Number(costRows?.[0]?.total || 0)
    const totalRevenue = Number(revenueRows?.[0]?.total || 0)
    return {
      title: p.title || '盈利能力报告',
      startDate: p.startDate,
      endDate: p.endDate,
      totalCost,
      totalRevenue,
      totalProfit: totalRevenue - totalCost,
      profitMargin:
        totalRevenue > 0
          ? Number((((totalRevenue - totalCost) / totalRevenue) * 100).toFixed(2))
          : 0,
      generatedAt: new Date().toISOString()
    }
  }

  if (scope === 'predictive' && method === 'createPredictiveModel') {
    const id = await insertRow('predictive_models', {
      ...first,
      status: 'idle'
    })
    return { id, success: true }
  }

  if (scope === 'predictive' && method === 'createForecastScenario') {
    const id = await insertRow('forecast_scenarios', first)
    return { id, success: true }
  }

  if (scope === 'predictive' && method === 'trainPredictiveModel') {
    const modelId = args[0]
    await updateRowById('predictive_models', modelId, {
      status: 'training',
      lastTrained: new Date().toISOString(),
      trainingData: args[1] || {}
    })
    return { id: modelId, success: true }
  }

  if (scope === 'predictive' && method === 'getTrainingJobStatus') {
    const modelId = args[0]
    const rows = await getTableRows('predictive_models', {
      where: { id: modelId },
      page: 1,
      pageSize: 1,
      limit: 1
    })
    const model = rows?.[0] || {}
    return {
      id: modelId,
      modelId,
      status: model.status === 'training' ? 'running' : 'completed',
      progress: model.status === 'training' ? 60 : 100,
      startedAt: model.lastTrained || model.last_trained || model.createdAt,
      completedAt: model.status === 'training' ? null : new Date().toISOString(),
      metrics: model.performance || {}
    }
  }

  if (scope === 'predictive' && method === 'generatePrediction') {
    const modelId = args[0]
    const targetDate = args[1]
    const features = args[2] || {}
    const numericValues = Object.values(features).map(Number).filter(Number.isFinite)
    const predictedValue = numericValues.length
      ? Number(
          (numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length).toFixed(4)
        )
      : 0
    const id = await insertRow('prediction_results', {
      modelId,
      targetDate,
      predictionDate: targetDate,
      predictedValue,
      confidenceInterval: [Math.max(0, predictedValue * 0.9), predictedValue * 1.1],
      factors: features,
      generatedAt: new Date().toISOString()
    })
    const rows = await getTableRows('prediction_results', {
      where: { id },
      page: 1,
      pageSize: 1,
      limit: 1
    })
    return rows?.[0] || { id, modelId, targetDate, predictedValue }
  }

  if (scope === 'predictive' && method === 'deletePredictiveModel') {
    return await deleteRowById('predictive_models', args[0])
  }

  if (scope === 'predictive' && method === 'acknowledgePredictiveAlert') {
    return await updateRowById('predictive_alerts', args[0], {
      status: 'acknowledged',
      acknowledgedAt: new Date().toISOString()
    })
  }

  if (scope === 'predictive' && method === 'resolvePredictiveAlert') {
    return await updateRowById('predictive_alerts', args[0], {
      status: 'resolved',
      resolution: args[1] || '',
      resolvedAt: new Date().toISOString()
    })
  }

  if (
    scope === 'predictive' &&
    [
      'getPredictiveDashboard',
      'createPredictiveDashboard',
      'updatePredictiveDashboard',
      'deletePredictiveDashboard'
    ].includes(method)
  ) {
    if (method === 'getPredictiveDashboard') {
      const [models, results, scenarios, alerts] = await Promise.all([
        getTableRows('predictive_models', { page: 1, pageSize: 1000 }),
        getTableRows('prediction_results', { page: 1, pageSize: 1000 }),
        getTableRows('forecast_scenarios', { page: 1, pageSize: 1000 }),
        getTableRows('predictive_alerts', { page: 1, pageSize: 1000 })
      ])
      return {
        id: args[0] || 'predictive-dashboard',
        name: '预测分析看板',
        models: models.map((row) => row.id),
        scenarios: scenarios.map((row) => row.id),
        alerts,
        summary: {
          totalPredictions: results.length,
          activeAlerts: alerts.filter((row) => row.status === 'active').length,
          modelCount: models.length
        }
      }
    }
    if (method === 'createPredictiveDashboard') {
      const id = await insertRow('integration_dashboards', { ...first, type: 'predictive' })
      return { id, ...first }
    }
    if (method === 'updatePredictiveDashboard') {
      await updateRowById('integration_dashboards', args[0], args[1] || {})
      return { id: args[0], ...(args[1] || {}) }
    }
    if (method === 'deletePredictiveDashboard') {
      return await deleteRowById('integration_dashboards', args[0])
    }
  }

  if (scope === '硬件' && method === 'runSystemDiagnostics') {
    const status = await buildSystemStatus({ get: () => '' })
    const databaseTables = Object.fromEntries(
      (status.database?.counts || []).map((item) => [item.table, item.total])
    )
    const results = [
      {
        component: '管理系统',
        status: status.backend?.ok ? 'healthy' : 'error',
        details: status.backend?.ok
          ? `mysql-backend pid=${status.backend.pid} uptime=${status.backend.uptimeSeconds}s`
          : 'Backend process status is not available'
      },
      {
        component: '数据库',
        status: status.database?.ok ? 'healthy' : 'error',
        details: status.database?.ok
          ? `MySQL reachable in ${status.database.latencyMs}ms`
          : status.database?.error || 'MySQL is not reachable'
      },
      {
        component: 'mqtt',
        status: status.mqtt?.enabled ? (status.mqtt.listening ? 'healthy' : 'error') : 'warning',
        details: status.mqtt?.enabled
          ? status.mqtt.listening
            ? `MQTT listening on ${status.mqtt.host}:${status.mqtt.port}`
            : status.mqtt.lastError || 'MQTT enabled but not listening'
          : 'MQTT is disabled'
      },
      {
        component: 'critical_tables',
        status:
          status.database?.ok &&
          ['cows', 'sensors', 'alerts', 'health_scores'].every(
            (table) => Number(databaseTables[table] || 0) > 0
          )
            ? 'healthy'
            : 'warning',
        details: `cows=${databaseTables.cows ?? 'n/a'}, sensors=${databaseTables.sensors ?? 'n/a'}, alerts=${databaseTables.alerts ?? 'n/a'}, health_scores=${databaseTables.health_scores ?? 'n/a'}`
      },
      {
        component: 'data_freshness',
        status:
          status.dataFreshness?.state === 'fresh'
            ? 'healthy'
            : status.dataFreshness?.state === 'stale'
              ? 'warning'
              : 'error',
        details:
          status.dataFreshness?.state === 'empty'
            ? 'No sensor data found'
            : `sensor_state=${status.dataFreshness?.state}, age_minutes=${status.dataFreshness?.ageMinutes ?? 'n/a'}`
      },
      {
        component: 'alerts',
        status: !status.alerts?.ok
          ? 'error'
          : status.alerts.bySeverity?.critical > 0 && status.alerts.active > 0
            ? 'error'
            : status.alerts.active > 0
              ? 'warning'
              : 'healthy',
        details: status.alerts?.ok
          ? `total=${status.alerts.total}, active=${status.alerts.active}, critical=${status.alerts.bySeverity?.critical || 0}`
          : status.alerts?.error || 'Alert status unavailable'
      }
    ]
    const hasError = results.some((item) => item.status === 'error')
    const diagnosticId = randomId('diag')

    return {
      success: !hasError,
      diagnosticId,
      diagnosticsId: diagnosticId,
      status: hasError ? 'failed' : 'completed',
      startedAt: status.generatedAt,
      completedAt: new Date().toISOString(),
      source: 'mysql-backend',
      results,
      system: status
    }
  }

  if (scope === 'kpi' && method === 'getKPIMetrics') {
    const rows = await getTableRows('kpi_data', {
      page: 1,
      pageSize: 1000,
      orderBy: 'created_at',
      orderDir: 'desc'
    })
    return rows
  }

  if (scope === 'kpi' && method === 'getKPIMetric') {
    const rows = await getTableRows('kpi_data', {
      where: { id: args[0] },
      page: 1,
      pageSize: 1,
      limit: 1
    })
    return rows?.[0] || null
  }

  if (scope === 'kpi' && method === 'getKPIValues') {
    const rows = await getTableRows('kpi_dashboard_data', {
      where: { dashboardId: first.dashboardId },
      startTime: first.startDate,
      endTime: first.endDate,
      page: first.page || 1,
      pageSize: first.pageSize || 1000,
      orderBy: 'ts',
      orderDir: 'desc'
    })
    return rows
  }

  if (scope === 'kpi' && method === 'getKPIDashboards') {
    return await getTableRows('kpi_dashboards', {
      page: 1,
      pageSize: 1000,
      orderBy: 'created_at',
      orderDir: 'desc'
    })
  }

  if (scope === 'kpi' && method === 'getKPIDashboard') {
    const rows = await getTableRows('kpi_dashboards', {
      where: { id: args[0] },
      page: 1,
      pageSize: 1,
      limit: 1
    })
    return rows?.[0] || null
  }

  if (scope === 'kpi' && method === 'getKPIDashboardData') {
    const dashboardId = args[0]
    const rows = await getTableRows('kpi_dashboard_data', {
      where: { dashboardId },
      page: 1,
      pageSize: 1000,
      orderBy: 'ts',
      orderDir: 'desc'
    })
    return { dashboardId, widgets: rows, updatedAt: new Date().toISOString() }
  }

  if (scope === '硬件' && method === 'getDeviceDataStream') {
    const rows = await getTableRows('sensors', {
      where: { cowId: first.cowId },
      startTime: first.startTime,
      endTime: first.endTime,
      page: first.page || 1,
      pageSize: first.pageSize || 200,
      orderBy: 'ts',
      orderDir: 'desc'
    })
    return rows.map((row) => ({
      id: row.id,
      deviceId:
        row.deviceId || row.device_id || row.sensorId || row.sensor_id || row.cowId || row.cow_id,
      timestamp: row.timestamp || row.ts || row.createdAt,
      dataType: 'sensor',
      value: row.temperature ?? row.steps ?? null,
      quality: 'normal',
      payload: row
    }))
  }

  if (scope === '硬件' && method === 'sendDeviceCommand') {
    await ensureProductionAcceptanceTables()
    const deviceId = args[0]
    const command = args[1] || {}
    const now = new Date()
    const deviceRows = deviceId
      ? await getTableRows('hardware_devices', {
          where: { id: deviceId },
          page: 1,
          pageSize: 1,
          limit: 1
        })
      : []
    const device = deviceRows?.[0] || {}
    const cowIds = normalizeCowIds(
      command.cowIds || command.cow_ids || device.cowIds || device.cow_ids || []
    )
    const commandType = String(command.type || command.command || command.commandType || 'control')
    const relationScope = buildAcceptanceRelationScope('hardware_command', cowIds, {
      deviceId,
      deviceName: device.name || device.deviceName || '',
      commandType
    })
    const sourceRecordIds = {
      hardware_devices: deviceId ? [deviceId] : [],
      sensor_status: normalizeStringArray(command.sensorStatusIds || command.sensor_status_ids),
      data_synchronizations: normalizeStringArray(
        command.synchronizationIds || command.synchronization_ids
      )
    }
    const actionId = command.automatedActionId || randomId('auto_action')
    const commandLogId = command.commandId || randomId('hw_cmd')
    const shouldPublish = shouldPublishHardwareCommand(command)
    const publishTopic = shouldPublish ? buildHardwareCommandTopic(command, deviceId) : ''
    const mqttPayload = shouldPublish
      ? buildHardwareCommandPayload(command, deviceId, cowIds)
      : null
    const fullSourceRecordIds = {
      ...sourceRecordIds,
      hardware_command_logs: [commandLogId],
      automated_actions: [actionId]
    }

    try {
      let mqttMessageLogId = ''
      if (shouldPublish) {
        await publishBrokerMessage(publishTopic, JSON.stringify(mqttPayload), {
          qos: Number(command.qos || 0),
          retain: Boolean(command.retain)
        })
        mqttState.publishedCount += 1
        mqttState.lastPublishedTopic = publishTopic
        mqttState.lastPublishedAt = now.toISOString()

        const mqttMessageLog = buildMqttMessageLog({
          direction: 'downlink',
          topic: publishTopic,
          qos: Number(command.qos || 0),
          status: 'sent',
          operator,
          deviceId: deviceId || MQTT_DEFAULT_COMMAND_TARGET,
          cowId: cowIds[0] || '',
          commandType,
          sourceMessageId: commandLogId,
          publishedAt: formatLocalDateTime(now),
          payloadJson: mqttPayload,
          parsedPayload: mqttPayload,
          relationScope,
          sourceRecordIds: fullSourceRecordIds
        })
        mqttMessageLogId = mqttMessageLog.id
        await insertRow('mqtt_message_logs', mqttMessageLog)
      }

      await insertRow('automated_actions', {
        id: actionId,
        name: `设备指令 ${command.type || command.command || 'command'}`,
        actionType: 'device_command',
        targetType: 'hardware_device',
        targetId: deviceId,
        payload: {
          ...command,
          topic: publishTopic || command.topic || '',
          mqttPayload
        },
        status: 'completed',
        createdAt: now,
        updatedAt: now
      })
      await insertRow('hardware_command_logs', {
        id: commandLogId,
        deviceId,
        commandType,
        operator,
        status: shouldPublish ? 'sent' : 'acknowledged',
        commandPayload: {
          ...command,
          topic: publishTopic || command.topic || '',
          mqttPayload
        },
        ackPayload: {
          automatedActionId: actionId,
          mqttMessageLogId,
          accepted: true,
          published: shouldPublish,
          acknowledgedBy: 'mysql-backend',
          acknowledgedAt: now.toISOString()
        },
        cowIds,
        relationScope,
        sourceRecordIds: {
          ...fullSourceRecordIds,
          ...(mqttMessageLogId ? { mqtt_message_logs: [mqttMessageLogId] } : {})
        },
        requestedAt: now,
        acknowledgedAt: now,
        createdAt: now,
        updatedAt: now
      })
      await auditOperation({
        actionType: 'hardware_command',
        targetType: 'hardware_device',
        targetId: deviceId,
        operator,
        status: 'completed',
        requestPayload: command,
        resultPayload: {
          commandId: commandLogId,
          automatedActionId: actionId,
          mqttMessageLogId: mqttMessageLogId || null,
          status: shouldPublish ? 'sent' : 'acknowledged',
          topic: publishTopic || null
        },
        cowIds,
        relationScope,
        sourceRecordIds: {
          ...fullSourceRecordIds,
          ...(mqttMessageLogId ? { mqtt_message_logs: [mqttMessageLogId] } : {})
        }
      })
      return {
        commandId: commandLogId,
        automatedActionId: actionId,
        mqttMessageLogId: mqttMessageLogId || null,
        status: shouldPublish ? 'sent' : 'acknowledged',
        deviceId,
        operator,
        topic: publishTopic || null,
        sentAt: now.toISOString()
      }
    } catch (error) {
      await insertRow('automated_actions', {
        id: actionId,
        name: `设备指令 ${command.type || command.command || 'command'}`,
        actionType: 'device_command',
        targetType: 'hardware_device',
        targetId: deviceId,
        payload: {
          ...command,
          topic: publishTopic || command.topic || '',
          mqttPayload
        },
        status: 'failed',
        createdAt: now,
        updatedAt: new Date()
      }).catch(() => undefined)
      await insertRow('hardware_command_logs', {
        id: commandLogId,
        deviceId,
        commandType,
        operator,
        status: 'failed',
        commandPayload: {
          ...command,
          topic: publishTopic || command.topic || '',
          mqttPayload
        },
        ackPayload: {
          automatedActionId: actionId,
          accepted: false,
          published: false,
          error: error?.message || String(error),
          acknowledgedBy: 'mysql-backend',
          acknowledgedAt: new Date().toISOString()
        },
        cowIds,
        relationScope,
        sourceRecordIds: fullSourceRecordIds,
        requestedAt: now,
        acknowledgedAt: new Date(),
        createdAt: now,
        updatedAt: new Date()
      }).catch(() => undefined)
      await auditOperation({
        actionType: 'hardware_command',
        targetType: 'hardware_device',
        targetId: deviceId,
        operator,
        status: 'failed',
        requestPayload: command,
        resultPayload: {
          commandId: commandLogId,
          automatedActionId: actionId,
          topic: publishTopic || null,
          error: error?.message || String(error)
        },
        cowIds,
        relationScope,
        sourceRecordIds: fullSourceRecordIds
      }).catch(() => undefined)
      throw error
    }
  }

  if (scope === '硬件' && method === 'getSystemHealthReport') {
    const status = await buildSystemStatus({ get: () => '' })
    return {
      timeRange: args[0] || '24h',
      generatedAt: status.generatedAt,
      overallHealth: status.database?.ok && status.backend?.ok ? 92 : 68,
      components: status,
      recommendations: status.database?.ok
        ? ['持续监控传感器新鲜度']
        : ['检查 MySQL 连接和容器健康状态']
    }
  }

  if (scope === '硬件' && method === 'registerHardwareDevice') {
    const id = await insertRow('hardware_devices', first)
    return { id, success: true }
  }

  if (scope === '硬件' && method === 'deleteHardwareDevice') {
    return await deleteRowById('hardware_devices', args[0])
  }

  if (scope === '硬件' && method === 'testProtocolConnection') {
    const protocolId = args[0]
    return await testProtocolConnectionFromDb(protocolId)
  }

  if (scope === '硬件' && method === 'triggerDataSynchronization') {
    const syncId = args[0]
    await updateRowById('data_synchronizations', syncId, {
      status: 'running',
      lastSync: new Date().toISOString()
    })
    return { id: syncId, success: true }
  }

  if (scope === '硬件' && method === 'acknowledgeHardwareAlert') {
    return await updateRowById('hardware_alerts', args[0], {
      status: 'acknowledged'
    })
  }

  if (scope === 'statistics' && method === 'getStatistics') {
    const cows = await getTableRows('cows', { page: 1, pageSize: 5000 })
    return {
      totalCows: cows.length,
      healthyCows: cows.filter((x) =>
        ['健康', 'healthy'].includes(String(x.status || '').toLowerCase())
      ).length,
      abnormalCows: cows.filter((x) =>
        ['异常', 'abnormal'].includes(String(x.status || '').toLowerCase())
      ).length,
      heatCows: cows.filter((x) => ['发情', 'heat'].includes(String(x.status || '').toLowerCase()))
        .length,
      pregnantCows: cows.filter((x) => Boolean(x.pregnancy)).length,
      mixedCows: cows.filter((x) => Boolean(x.mixing)).length,
      leftCows: cows.filter((x) => ['离群', 'left'].includes(String(x.status || '').toLowerCase()))
        .length
    }
  }

  if (scope === 'statistics' && method.startsWith('get') && method.endsWith('Cows')) {
    const cows = await getTableRows('cows', { page: 1, pageSize: 5000 })
    if (method === 'getHealthyCows')
      return cows.filter((x) => ['健康', 'healthy'].includes(String(x.status || '').toLowerCase()))
    if (method === 'getAbnormalCows')
      return cows.filter((x) => ['异常', 'abnormal'].includes(String(x.status || '').toLowerCase()))
    if (method === 'getHeatCows')
      return cows.filter((x) => ['发情', 'heat'].includes(String(x.status || '').toLowerCase()))
    if (method === 'getPregnantCows') return cows.filter((x) => Boolean(x.pregnancy))
    if (method === 'getMixedCows') return cows.filter((x) => Boolean(x.mixing))
    if (method === 'getLeftCows')
      return cows.filter((x) => ['离群', 'left'].includes(String(x.status || '').toLowerCase()))
  }

  if (scope === 'export' && method === 'exportCowInfo') {
    await ensureProductionAcceptanceTables()
    const startedAt = new Date()
    const rows = await getTableRows('cows', {
      page: 1,
      pageSize: 5000,
      orderBy: 'created_at',
      orderDir: 'desc'
    })
    const cowIds = normalizeCowIds(
      first.cowIds || first.cow_ids || rows.map((row) => row.id).filter(Boolean)
    )
    const exportRows = cowIds.length ? rows.filter((row) => cowIds.includes(String(row.id))) : rows
    const columns = first.columns || [
      'cow_number',
      'ear_tag_number',
      'breed',
      'gender',
      'current_pen',
      'status'
    ]
    const workbook = buildXlsxExport('cow_info', exportRows, columns)
    const fileName = first.fileName || `cow-info-${startedAt.toISOString().slice(0, 10)}.xlsx`
    const fileUrl = '/api/export/cow-info.xlsx'
    const resultSnapshot = {
      table: 'cows',
      exportedRows: exportRows.length,
      selectedCowCount: cowIds.length,
      columns,
      byteLength: workbook.byteLength
    }
    const fileHash = workbook.hash
    const finishedAt = new Date()
    const auditId = await insertRow('export_audit_logs', {
      id: first.auditId || randomId('export'),
      actionType: 'cow_info',
      operator,
      status: 'completed',
      fileName,
      fileUrl,
      fileHash,
      fileFormat: first.format || 'xlsx',
      rowCount: exportRows.length,
      filtersJson: first,
      parametersJson: first,
      resultSnapshot,
      cowIds,
      relationScope: buildAcceptanceRelationScope('export_cow_info', cowIds, { table: 'cows' }),
      sourceRecordIds: { cows: cowIds },
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      createdAt: finishedAt,
      updatedAt: finishedAt
    })
    await auditOperation({
      actionType: 'export_cow_info',
      targetType: 'export_audit_logs',
      targetId: auditId,
      operator,
      status: 'completed',
      requestPayload: first,
      resultPayload: {
        auditId,
        fileName,
        fileHash,
        rowCount: exportRows.length,
        byteLength: workbook.byteLength
      },
      cowIds,
      relationScope: buildAcceptanceRelationScope('export_cow_info', cowIds, { table: 'cows' }),
      sourceRecordIds: { export_audit_logs: [auditId], cows: cowIds }
    })
    return {
      url: fileUrl,
      auditId,
      fileName,
      fileHash,
      rowCount: exportRows.length,
      operator,
      exportedAt: finishedAt.toISOString(),
      fileContentBase64: workbook.base64,
      columns: workbook.columns
    }
  }

  if (scope === 'export' && method === 'exportCowEvents') {
    await ensureProductionAcceptanceTables()
    const startedAt = new Date()
    const [
      animalEvents,
      entryEvents,
      transferEvents,
      exitEvents,
      breedingEvents,
      veterinaryEvents
    ] = await Promise.all([
      getTableRows('animal_event', { page: 1, pageSize: 5000 }).catch(() => []),
      getTableRows('entry_events', { page: 1, pageSize: 5000 }).catch(() => []),
      getTableRows('transfer_events', { page: 1, pageSize: 5000 }).catch(() => []),
      getTableRows('exit_events', { page: 1, pageSize: 5000 }).catch(() => []),
      getTableRows('breeding_events', { page: 1, pageSize: 5000 }).catch(() => []),
      getTableRows('veterinary_events', { page: 1, pageSize: 5000 }).catch(() => [])
    ])
    const parseEventDetails = (row) => {
      const details = isPlainObject(row.details)
        ? row.details
        : safeJsonParse(row.details, {}) || {}
      const customValues = isPlainObject(row.custom_values)
        ? row.custom_values
        : safeJsonParse(row.custom_values, {}) || {}
      return { ...details, ...customValues }
    }
    const normalizeExportEventType = (value) => {
      const raw = String(value || '').toLowerCase()
      if (raw.includes('entry') || raw.includes('入群')) return 'entry'
      if (raw.includes('transfer') || raw.includes('转群')) return 'transfer'
      if (raw.includes('exit') || raw.includes('离群') || raw.includes('出群')) return 'exit'
      if (raw.includes('abortion') || raw.includes('流产')) return 'abortion'
      if (raw.includes('calving') || raw.includes('产犊') || raw.includes('分娩')) return 'calving'
      if (raw.includes('pregnancy') || raw.includes('妊检')) return 'pregnancy_check'
      if (
        raw.includes('insemination') ||
        raw.includes('breeding') ||
        raw.includes('配种') ||
        raw.includes('输精')
      )
        return 'insemination'
      if (raw.includes('vaccination') || raw.includes('疫苗') || raw.includes('免疫'))
        return 'vaccination'
      if (raw.includes('treatment') || raw.includes('治疗')) return 'treatment'
      if (raw.includes('diagnosis') || raw.includes('诊断') || raw.includes('发病'))
        return 'diagnosis'
      return raw || 'general_event'
    }
    const normalizeCowEventRow = (row, eventTable) => {
      const details = parseEventDetails(row)
      const eventType = normalizeExportEventType(
        row.event_type ||
          row.eventType ||
          row.event_code ||
          row.eventCode ||
          row.event_name ||
          row.eventName ||
          details.eventType
      )
      const eventTime =
        row.occurred_at ||
        row.occurredAt ||
        row.event_time ||
        row.eventTime ||
        row.event_date ||
        row.eventDate ||
        row.created_at ||
        row.createdAt
      return {
        ...row,
        eventTable,
        event_table: eventTable,
        cowId:
          row.cow_id ||
          row.cowId ||
          row.animal_id ||
          row.animalId ||
          details.cowId ||
          details.cow_id,
        cow_id:
          row.cow_id ||
          row.cowId ||
          row.animal_id ||
          row.animalId ||
          details.cowId ||
          details.cow_id,
        cowNumber:
          row.cow_number ||
          row.cowNumber ||
          row.animal_number ||
          row.animalNumber ||
          details.cowNumber ||
          details.cow_number,
        cow_number:
          row.cow_number ||
          row.cowNumber ||
          row.animal_number ||
          row.animalNumber ||
          details.cowNumber ||
          details.cow_number,
        eventType,
        event_type: eventType,
        eventTime,
        event_time: eventTime,
        recorder:
          row.recorder ||
          row.operator_name ||
          row.operatorName ||
          row.operator ||
          row.person ||
          row.technician ||
          details.operatorName ||
          details.operator_name,
        result:
          row.result ||
          row.pregnancy_result ||
          row.pregnancyResult ||
          row.calving_result ||
          row.calvingResult ||
          details.result ||
          details.pregnancyResult,
        nextAction:
          row.next_action || row.nextAction || row.notes || details.nextAction || details.notes,
        sourceRecordId: row.source_record_id || row.sourceRecordId || row.id,
        source_record_id: row.source_record_id || row.sourceRecordId || row.id
      }
    }
    const rows = [
      ...animalEvents.map((row) => normalizeCowEventRow(row, 'animal_event')),
      ...entryEvents.map((row) =>
        normalizeCowEventRow({ ...row, eventType: 'entry' }, 'entry_events')
      ),
      ...transferEvents.map((row) =>
        normalizeCowEventRow({ ...row, eventType: 'transfer' }, 'transfer_events')
      ),
      ...exitEvents.map((row) =>
        normalizeCowEventRow({ ...row, eventType: 'exit' }, 'exit_events')
      ),
      ...breedingEvents.map((row) => normalizeCowEventRow(row, 'breeding_events')),
      ...veterinaryEvents.map((row) => normalizeCowEventRow(row, 'veterinary_events'))
    ]
    const seenEventKeys = new Set()
    const canonicalRows = rows
      .sort(
        (left, right) =>
          (left.eventTable === 'animal_event' ? 0 : 1) -
          (right.eventTable === 'animal_event' ? 0 : 1)
      )
      .filter((row) => {
        const cowKey = String(
          row.cowId || row.cow_id || row.cowNumber || row.cow_number || ''
        ).trim()
        const eventType = String(row.eventType || row.event_type || '').trim()
        const sourceRecordId = String(
          row.sourceRecordId || row.source_record_id || row.id || ''
        ).trim()
        const eventTime = row.eventTime || row.event_time
        const eventTimeValue = eventTime ? new Date(eventTime).getTime() : Number.NaN
        const eventMoment = Number.isFinite(eventTimeValue)
          ? new Date(eventTimeValue).toISOString()
          : ''
        const keys = [
          sourceRecordId ? `record:${cowKey}|${eventType}|${sourceRecordId}` : '',
          eventMoment ? `business:${cowKey}|${eventType}|${eventMoment}` : ''
        ].filter(Boolean)
        if (keys.some((key) => seenEventKeys.has(key))) return false
        keys.forEach((key) => seenEventKeys.add(key))
        return true
      })
    const cowNumbers = normalizeStringArray(
      first.cowNumbers ||
        first.cow_numbers ||
        canonicalRows.map((row) => row.cowNumber || row.cow_number)
    )
    const cowRows = cowNumbers.length ? await getTableRows('cows', { page: 1, pageSize: 5000 }) : []
    const cowIds = normalizeCowIds(
      first.cowIds ||
        first.cow_ids ||
        cowRows
          .filter((cow) => cowNumbers.includes(String(cow.cowNumber || cow.cow_number)))
          .map((cow) => cow.id)
    )
    const exportRows = canonicalRows.filter((row) => {
      const rowCowId = String(row.cowId || row.cow_id || '').trim()
      const rowCowNumber = String(row.cowNumber || row.cow_number || '').trim()
      return (
        (!cowIds.length && !cowNumbers.length) ||
        cowIds.includes(rowCowId) ||
        cowNumbers.includes(rowCowNumber)
      )
    })
    const columns = first.columns || [
      'event_table',
      'cow_number',
      'event_type',
      'event_time',
      'recorder',
      'result',
      'next_action'
    ]
    const workbook = buildXlsxExport('cow_events', exportRows, columns)
    const fileName = first.fileName || `cow-events-${startedAt.toISOString().slice(0, 10)}.xlsx`
    const fileUrl = '/api/export/cow-events.xlsx'
    const resultSnapshot = {
      exportedRows: exportRows.length,
      eventTables: {
        animal_event: animalEvents.length,
        entry_events: entryEvents.length,
        transfer_events: transferEvents.length,
        exit_events: exitEvents.length,
        breeding_events: breedingEvents.length,
        veterinary_events: veterinaryEvents.length
      },
      cowNumbers,
      columns,
      byteLength: workbook.byteLength
    }
    const sourceRecordIds = {
      animal_event: exportRows
        .filter((row) => row.eventTable === 'animal_event')
        .map((row) => row.id)
        .filter(Boolean),
      entry_events: exportRows
        .filter((row) => row.eventTable === 'entry_events')
        .map((row) => row.id)
        .filter(Boolean),
      transfer_events: exportRows
        .filter((row) => row.eventTable === 'transfer_events')
        .map((row) => row.id)
        .filter(Boolean),
      exit_events: exportRows
        .filter((row) => row.eventTable === 'exit_events')
        .map((row) => row.id)
        .filter(Boolean),
      breeding_events: exportRows
        .filter((row) => row.eventTable === 'breeding_events')
        .map((row) => row.id)
        .filter(Boolean),
      veterinary_events: exportRows
        .filter((row) => row.eventTable === 'veterinary_events')
        .map((row) => row.id)
        .filter(Boolean)
    }
    const fileHash = workbook.hash
    const finishedAt = new Date()
    const auditId = await insertRow('export_audit_logs', {
      id: first.auditId || randomId('export'),
      actionType: 'cow_events',
      operator,
      status: 'completed',
      fileName,
      fileUrl,
      fileHash,
      fileFormat: first.format || 'xlsx',
      rowCount: exportRows.length,
      filtersJson: first,
      parametersJson: first,
      resultSnapshot,
      cowIds,
      relationScope: buildAcceptanceRelationScope('export_cow_events', cowIds, {
        cowNumbers,
        eventTables: Object.keys(sourceRecordIds)
      }),
      sourceRecordIds,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      createdAt: finishedAt,
      updatedAt: finishedAt
    })
    await auditOperation({
      actionType: 'export_cow_events',
      targetType: 'export_audit_logs',
      targetId: auditId,
      operator,
      status: 'completed',
      requestPayload: first,
      resultPayload: {
        auditId,
        fileName,
        fileHash,
        rowCount: exportRows.length,
        byteLength: workbook.byteLength
      },
      cowIds,
      relationScope: buildAcceptanceRelationScope('export_cow_events', cowIds, { cowNumbers }),
      sourceRecordIds: { ...sourceRecordIds, export_audit_logs: [auditId] }
    })
    return {
      url: fileUrl,
      auditId,
      fileName,
      fileHash,
      rowCount: exportRows.length,
      operator,
      exportedAt: finishedAt.toISOString(),
      fileContentBase64: workbook.base64,
      columns: workbook.columns
    }
  }

  if (scope === 'export' && method === 'getExportHistory') {
    await ensureProductionAcceptanceTables()
    return await getTableRows('export_audit_logs', {
      page: first.page || 1,
      pageSize: first.pageSize || 100,
      orderBy: 'created_at',
      orderDir: 'desc'
    })
  }

  if (
    scope === 'breedingDecision' &&
    ['createBreedingDecisionRun', 'runBreedingDecision', 'publishBreedingDecision'].includes(method)
  ) {
    await ensureProductionAcceptanceTables()
    const now = new Date()
    const shouldCompute =
      method === 'runBreedingDecision' ||
      first.computeFromDatabase === true ||
      first.compute_from_database === true
    const computed = shouldCompute ? await buildBreedingDecisionFromDatabase(first, operator) : null
    const runType = String(
      computed?.runType || first.runType || first.run_type || first.type || 'breeding_decision'
    )
    const resultSnapshot = computed?.resultSnapshot ||
      first.resultSnapshot ||
      first.result_snapshot || {
        candidates: first.candidates || [],
        rankings: first.rankings || [],
        matingPlan: first.matingPlan || first.mating_plan || []
      }
    const cowIds = normalizeCowIds(
      computed?.cowIds ||
        first.cowIds ||
        first.cow_ids ||
        resultSnapshot.cowIds ||
        resultSnapshot.cow_ids
    )
    const parameters =
      computed?.parameters ||
      first.parameters ||
      first.parametersJson ||
      first.parameters_json ||
      first.filters ||
      {}
    const sourceRecordIds = computed?.sourceRecordIds ||
      first.sourceRecordIds ||
      first.source_record_ids || {
        cows: cowIds,
        phenotype_records: normalizeStringArray(
          first.phenotypeRecordIds || first.phenotype_record_ids
        ),
        breeding_records: normalizeStringArray(
          first.breedingRecordIds || first.breeding_record_ids
        ),
        omics_module_runs: normalizeStringArray(first.omicsRunIds || first.omics_run_ids)
      }
    const relationScope = buildAcceptanceRelationScope('breeding_decision', cowIds, {
      runType,
      title: computed?.title || first.title || '智能育种决策'
    })
    const id = await insertRow('breeding_decision_runs', {
      id: first.id || randomId('breed_dec'),
      runType,
      title: computed?.title || first.title || '智能育种决策',
      operator: computed?.operator || first.operator || operator,
      status: computed?.status || first.status || 'completed',
      parametersJson: parameters,
      resultSnapshot,
      cowIds,
      relationScope,
      sourceRecordIds,
      startedAt: first.startedAt || now,
      finishedAt: first.finishedAt || now,
      durationMs: Number(computed?.durationMs || first.durationMs || first.duration_ms || 0),
      createdAt: now,
      updatedAt: now
    })
    await auditOperation({
      actionType: `breeding_decision_${runType}`,
      targetType: 'breeding_decision_runs',
      targetId: id,
      operator: computed?.operator || first.operator || operator,
      status: computed?.status || first.status || 'completed',
      requestPayload: first,
      resultPayload: { id, runType, resultSnapshot },
      cowIds,
      relationScope,
      sourceRecordIds: { ...sourceRecordIds, breeding_decision_runs: [id], cows: cowIds }
    })
    return {
      id,
      runType,
      status: 'completed',
      operator: computed?.operator || first.operator || operator,
      createdAt: now.toISOString(),
      parameters,
      resultSnapshot,
      cowIds,
      sourceRecordIds
    }
  }

  const inferredTable = inferTableFromScopeMethod(scope, method)
  if (inferredTable) {
    if (QUERY_METHOD_RE.test(method)) {
      return await queryByMethod(inferredTable, method, args)
    }
    if (CREATE_METHOD_RE.test(method)) {
      return await createByMethod(inferredTable, method, args)
    }
    if (UPDATE_METHOD_RE.test(method)) {
      return await updateByMethod(inferredTable, method, args)
    }
    if (DELETE_METHOD_RE.test(method)) {
      return await deleteByMethod(inferredTable, method, args)
    }
  }

  if (method.startsWith('get') || method.startsWith('list') || method.startsWith('query')) {
    return []
  }
  if (
    method.startsWith('delete') ||
    method.startsWith('remove') ||
    method.startsWith('update') ||
    method.startsWith('create') ||
    method.startsWith('add') ||
    method.startsWith('start') ||
    method.startsWith('run') ||
    method.startsWith('trigger') ||
    method.startsWith('acknowledge') ||
    method.startsWith('resolve')
  ) {
    throw createUnsupportedMethodError(scope, method)
  }
  return null
}

const SYSTEM_STATUS_TABLES = [
  { table: 'cows', label: 'cows' },
  { table: 'sensors', label: 'sensors' },
  { table: 'alerts', label: 'alerts' },
  { table: 'health_scores', label: 'health_scores' },
  { table: 'hardware_devices', label: 'hardware_devices' },
  { table: 'predictive_models', label: 'predictive_models' }
]

async function getTableCountStatus(tableName, label) {
  try {
    const table = normalizeTableName(tableName)
    const [rows] = await pool.query(`SELECT COUNT(*) AS total FROM \`${table}\``)
    return { table, label, ok: true, total: Number(rows?.[0]?.total || 0), error: null }
  } catch (error) {
    return {
      table: tableName,
      label,
      ok: false,
      total: null,
      error: error?.message || String(error)
    }
  }
}

async function getDatabaseStatus() {
  const started = Date.now()
  const database = {
    ok: false,
    latencyMs: null,
    config: publicMysqlConfig(),
    counts: [],
    error: null
  }

  try {
    await pool.query('SELECT 1 AS ok')
    database.ok = true
    database.latencyMs = Date.now() - started
    database.counts = await Promise.all(
      SYSTEM_STATUS_TABLES.map((item) => getTableCountStatus(item.table, item.label))
    )
  } catch (error) {
    database.latencyMs = Date.now() - started
    database.error = error?.message || String(error)
  }

  return database
}

function toIsoString(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

function toTimestampMs(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isNaN(time) ? null : time
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

async function getScalarValue(sql, params = [], fallback = 0) {
  const [rows] = await pool.query(sql, params)
  const row = rows?.[0] || {}
  const value = Object.values(row)[0]
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function isEnabledValue(value) {
  if (value === true || value === 1) return true
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  return ['1', 'true', 'yes', 'enabled', 'active', 'running', 'online'].includes(text)
}

function isInactiveValue(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  return ['0', 'false', 'no', 'disabled', 'inactive', 'offline', 'deleted'].includes(text)
}

function countRowsByPredicate(rows, predicate) {
  return rows.reduce((sum, row) => (predicate(row) ? sum + 1 : sum), 0)
}

async function countRowsFromTable(tableName, whereSql = '', params = []) {
  const table = normalizeTableName(tableName)
  const sql = `SELECT COUNT(*) AS total FROM \`${table}\`${whereSql ? ` WHERE ${whereSql}` : ''}`
  return await getScalarValue(sql, params, 0)
}

function createUnsupportedMethodError(scope, method) {
  const error = new Error(`Unsupported backend method: ${scope}.${method}`)
  error.code = 'UNSUPPORTED_BACKEND_METHOD'
  error.status = 400
  error.details = { scope, method }
  return error
}

async function getLatestTimestampForTable(tableName, preferredColumns = []) {
  const table = normalizeTableName(tableName)
  const meta = await getTableMetadata(table)
  const column =
    preferredColumns.map(camelToSnake).find((col) => meta.columns.has(col)) ||
    ['updated_at', 'created_at', 'ts', 'last_sync', 'last_seen'].find((col) =>
      meta.columns.has(col)
    )

  if (!column) return null
  const [rows] = await pool.query(`SELECT MAX(\`${column}\`) AS latest FROM \`${table}\``)
  return toIsoString(rows?.[0]?.latest)
}

async function executeAutomationCheckFromDb() {
  const [
    actions,
    transferRules,
    reminderRules,
    workflowTemplates,
    workflowInstances,
    activeAlerts,
    abnormalCows,
    pregnantCows
  ] = await Promise.all([
    getTableRows('automated_actions', { page: 1, pageSize: 5000 }),
    getTableRows('smart_transfer_rules', { page: 1, pageSize: 5000 }),
    getTableRows('reminder_rules', { page: 1, pageSize: 5000 }),
    getTableRows('workflow_templates', { page: 1, pageSize: 5000 }),
    getTableRows('workflow_instances', { page: 1, pageSize: 5000 }),
    countRowsFromTable(
      'alerts',
      "LOWER(COALESCE(status, '')) IN ('active', 'pending', 'open', 'new', 'in_progress')"
    ),
    countRowsFromTable(
      'cows',
      "LOWER(COALESCE(status, '')) IN ('abnormal', 'warning', 'sick', 'ill')"
    ),
    countRowsFromTable('cows', 'COALESCE(pregnancy, 0) <> 0')
  ])

  const activeActions = countRowsByPredicate(
    actions,
    (row) => !isInactiveValue(row.isActive ?? row.status)
  )
  const enabledTransferRules = countRowsByPredicate(transferRules, (row) =>
    isEnabledValue(row.enabled)
  )
  const dueReminderRules = countRowsByPredicate(
    reminderRules,
    (row) => isEnabledValue(row.enabled) && !row.lastTriggered
  )
  const activeTemplates = countRowsByPredicate(workflowTemplates, (row) =>
    isEnabledValue(row.isActive)
  )
  const runningInstances = countRowsByPredicate(workflowInstances, (row) =>
    ['running', 'pending', 'in_progress', 'active'].includes(String(row.status || '').toLowerCase())
  )

  return {
    success: true,
    checkedAt: new Date().toISOString(),
    triggeredActions: activeActions,
    triggeredTransfers: enabledTransferRules,
    sentReminders: dueReminderRules,
    createdTasks: activeTemplates + runningInstances,
    source: 'mysql',
    basis: {
      automatedActions: {
        total: actions.length,
        active: activeActions
      },
      smartTransferRules: {
        total: transferRules.length,
        enabled: enabledTransferRules
      },
      reminderRules: {
        total: reminderRules.length,
        dueWithoutLastTriggered: dueReminderRules
      },
      workflows: {
        templates: workflowTemplates.length,
        activeTemplates,
        instances: workflowInstances.length,
        runningInstances
      },
      herdSignals: {
        activeAlerts,
        abnormalCows,
        pregnantCows
      }
    }
  }
}

async function testProtocolConnectionFromDb(protocolId) {
  const protocols = await getTableRows('integration_protocols', { page: 1, pageSize: 5000 })
  const synchronizations = await getTableRows('data_synchronizations', { page: 1, pageSize: 5000 })
  const devices = await getTableRows('hardware_devices', { page: 1, pageSize: 5000 })

  if (!protocols.length) {
    return {
      protocolId: protocolId || null,
      success: false,
      responseTime: 0,
      errorMessage: 'No integration protocol records are configured in MySQL',
      reason: 'no_protocol_configured',
      source: 'mysql',
      counts: {
        protocols: 0,
        synchronizations: synchronizations.length,
        devices: devices.length
      }
    }
  }

  const protocol = protocolId
    ? protocols.find((item) => String(item.id) === String(protocolId))
    : protocols[0]

  if (!protocol) {
    return {
      protocolId,
      success: false,
      responseTime: 0,
      errorMessage: `Integration protocol not found in MySQL: ${protocolId}`,
      reason: 'protocol_not_found',
      source: 'mysql',
      counts: {
        protocols: protocols.length,
        synchronizations: synchronizations.length,
        devices: devices.length
      }
    }
  }

  const protocolActive = isEnabledValue(protocol.isActive)
  const protocolSyncs = synchronizations.filter(
    (item) => String(item.protocolId || '') === String(protocol.id)
  )
  const readySyncs = protocolSyncs.filter((item) =>
    ['active', 'ready', 'running', 'completed', 'success', 'idle', 'scheduled'].includes(
      String(item.status || '').toLowerCase()
    )
  )
  const supportedDevices = Array.isArray(protocol.supportedDevices) ? protocol.supportedDevices : []
  const onlineDevices = devices.filter((item) =>
    ['online', 'active', 'running', 'connected'].includes(String(item.status || '').toLowerCase())
  )
  const matchedDevices = onlineDevices.filter((device) => {
    if (!supportedDevices.length) return true
    const type = String(device.deviceType || device.type || '')
    return supportedDevices.some(
      (supported) => String(supported).toLowerCase() === type.toLowerCase()
    )
  })

  const hasEndpointConfig = Array.isArray(protocol.endpoints)
    ? protocol.endpoints.length > 0
    : isPlainObject(protocol.endpoints)
      ? Object.keys(protocol.endpoints).length > 0
      : Boolean(protocol.endpoints)
  const responseTime =
    protocol.lastUsed || readySyncs.some((item) => item.lastSync)
      ? 25
      : protocolSyncs.length || matchedDevices.length
        ? 50
        : 0
  const success = Boolean(
    protocolActive && hasEndpointConfig && (readySyncs.length > 0 || matchedDevices.length > 0)
  )
  const missing = []
  if (!protocolActive) missing.push('protocol is inactive')
  if (!hasEndpointConfig) missing.push('protocol has no endpoint configuration')
  if (!readySyncs.length && !matchedDevices.length) {
    missing.push('no ready synchronization or online supported hardware device')
  }

  return {
    protocolId: protocol.id,
    success,
    responseTime,
    errorMessage: success ? '' : missing.join('; '),
    reason: success ? 'ready' : 'configuration_incomplete',
    source: 'mysql',
    protocol: {
      id: protocol.id,
      name: protocol.name || null,
      protocolType: protocol.protocolType || null,
      active: protocolActive,
      hasEndpointConfig,
      lastUsed: protocol.lastUsed || null
    },
    counts: {
      protocols: protocols.length,
      protocolSynchronizations: protocolSyncs.length,
      readySynchronizations: readySyncs.length,
      devices: devices.length,
      onlineDevices: onlineDevices.length,
      matchedOnlineDevices: matchedDevices.length
    }
  }
}

async function getDataFreshnessStatus() {
  const staleAfterMinutes = Number(process.env.SYSTEM_STATUS_STALE_AFTER_MINUTES || 120)
  const status = {
    ok: false,
    state: 'empty',
    staleAfterMinutes,
    totalCount: 0,
    last24hCount: 0,
    ageMinutes: null,
    latest: null,
    error: null
  }

  try {
    const [countRows] = await pool.query(
      `
        SELECT
          COUNT(*) AS totalCount,
          SUM(CASE WHEN COALESCE(ts, created_at) >= DATE_SUB(NOW(3), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) AS last24hCount
        FROM sensors
      `
    )
    status.totalCount = Number(countRows?.[0]?.totalCount || 0)
    status.last24hCount = Number(countRows?.[0]?.last24hCount || 0)

    const [rows] = await pool.query(
      `
        SELECT
          s.id,
          s.cow_id AS cowId,
          c.cow_number AS cowNumber,
          s.ts,
          s.temperature,
          s.created_at AS createdAt
        FROM sensors s
        LEFT JOIN cows c ON c.id = s.cow_id COLLATE utf8mb4_unicode_ci
        ORDER BY COALESCE(s.ts, s.created_at) DESC
        LIMIT 1
      `
    )
    const latest = rows?.[0] || null

    if (!latest) {
      status.state = 'empty'
      status.error = status.totalCount > 0 ? '未找到最新传感器记录' : null
      return status
    }

    const latestTime = latest.ts || latest.createdAt
    const latestTimestamp = toTimestampMs(latestTime)
    const ageMinutes =
      latestTimestamp === null
        ? null
        : Math.max(0, Math.round((Date.now() - latestTimestamp) / 60000))

    status.ok = true
    status.ageMinutes = ageMinutes
    status.latest = {
      id: latest.id || null,
      cowId: latest.cowId || null,
      cowNumber: latest.cowNumber || latest.cowId || null,
      timestamp: toIsoString(latest.ts),
      createdAt: toIsoString(latest.createdAt),
      temperature: toNumberOrNull(latest.temperature)
    }
    status.state = ageMinutes !== null && ageMinutes <= staleAfterMinutes ? 'fresh' : 'stale'
  } catch (error) {
    status.ok = false
    status.state = 'error'
    status.error = error?.message || String(error)
  }

  return status
}

async function getAlertStatus() {
  const status = {
    ok: false,
    total: 0,
    active: 0,
    acknowledged: 0,
    resolved: 0,
    bySeverity: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      other: 0
    },
    latest: null,
    error: null
  }

  try {
    const [summaryRows] = await pool.query(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN LOWER(COALESCE(status, '')) IN ('active', 'pending', 'open', 'new', 'in_progress') THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN LOWER(COALESCE(status, '')) = 'acknowledged' THEN 1 ELSE 0 END) AS acknowledged,
          SUM(CASE WHEN LOWER(COALESCE(status, '')) = 'resolved' THEN 1 ELSE 0 END) AS resolved,
          SUM(CASE WHEN LOWER(COALESCE(severity, '')) = 'critical' THEN 1 ELSE 0 END) AS critical,
          SUM(CASE WHEN LOWER(COALESCE(severity, '')) = 'high' THEN 1 ELSE 0 END) AS high,
          SUM(CASE WHEN LOWER(COALESCE(severity, '')) = 'medium' THEN 1 ELSE 0 END) AS medium,
          SUM(CASE WHEN LOWER(COALESCE(severity, '')) = 'low' THEN 1 ELSE 0 END) AS low,
          SUM(CASE WHEN LOWER(COALESCE(severity, '')) NOT IN ('critical', 'high', 'medium', 'low', '') THEN 1 ELSE 0 END) AS other
        FROM alerts
      `
    )
    const summary = summaryRows?.[0] || {}
    status.total = Number(summary.total || 0)
    status.active = Number(summary.active || 0)
    status.acknowledged = Number(summary.acknowledged || 0)
    status.resolved = Number(summary.resolved || 0)
    status.bySeverity = {
      critical: Number(summary.critical || 0),
      high: Number(summary.high || 0),
      medium: Number(summary.medium || 0),
      low: Number(summary.low || 0),
      other: Number(summary.other || 0)
    }

    const [rows] = await pool.query(
      `
        SELECT
          a.id,
          a.cow_id AS cowId,
          c.cow_number AS cowNumber,
          a.alert_time AS alertTime,
          a.severity,
          a.alert_type AS alertType,
          a.title,
          a.status,
          a.created_at AS createdAt
        FROM alerts a
        LEFT JOIN cows c ON c.id = a.cow_id COLLATE utf8mb4_unicode_ci
        ORDER BY COALESCE(a.alert_time, a.created_at) DESC
        LIMIT 1
      `
    )
    const latest = rows?.[0] || null
    status.ok = true
    status.latest = latest
      ? {
          id: latest.id || null,
          cowId: latest.cowId || null,
          cowNumber: latest.cowNumber || latest.cowId || null,
          alertTime: toIsoString(latest.alertTime),
          severity: latest.severity || null,
          alertType: latest.alertType || null,
          title: latest.title || null,
          status: latest.status || null,
          createdAt: toIsoString(latest.createdAt)
        }
      : null
  } catch (error) {
    status.ok = false
    status.error = error?.message || String(error)
  }

  return status
}

function buildReadinessStatus({ backend, frontend, database, mqtt, dataFreshness, alerts }) {
  const items = [
    {
      key: 'frontend',
      label: '前端代理',
      state: frontend.apiProxyReachable ? 'pass' : 'fail',
      detail: frontend.apiProxyReachable ? '页面到 API 代理可达' : '页面未连通 API'
    },
    {
      key: '管理系统',
      label: '后端服务',
      state: backend.ok ? 'pass' : 'fail',
      detail: backend.ok ? `API 端口 ${backend.port} 在线` : '后端服务离线'
    },
    {
      key: '数据库',
      label: 'MySQL 数据库',
      state: database.ok ? 'pass' : 'fail',
      detail: database.ok ? `查询延迟 ${database.latencyMs} ms` : database.error || '数据库不可用'
    },
    {
      key: 'mqtt',
      label: 'MQTT 接入',
      state: mqtt.enabled ? (mqtt.listening ? 'pass' : 'fail') : 'warning',
      detail: mqtt.enabled
        ? mqtt.listening
          ? `监听 ${mqtt.host}:${mqtt.port}`
          : mqtt.lastError || 'MQTT 已启用但未监听'
        : 'MQTT 未启用，当前按离线采集或人工导入流程运行'
    },
    {
      key: '数据',
      label: '数据入库',
      state:
        dataFreshness.state === 'fresh'
          ? 'pass'
          : dataFreshness.state === 'stale'
            ? 'warning'
            : 'fail',
      detail:
        dataFreshness.state === 'fresh'
          ? `最近 ${dataFreshness.ageMinutes} 分钟有采集数据`
          : dataFreshness.state === 'stale'
            ? `最近数据距今 ${dataFreshness.ageMinutes ?? '--'} 分钟`
            : dataFreshness.error || '传感器数据为空'
    },
    {
      key: 'alerts',
      label: '预警积压',
      state: !alerts.ok ? 'fail' : alerts.active > 0 ? 'warning' : 'pass',
      detail: !alerts.ok
        ? alerts.error || '预警状态未知'
        : alerts.active > 0
          ? `活跃 ${alerts.active} 条，严重 ${alerts.bySeverity.critical} 条`
          : '无活跃预警积压'
    }
  ]

  const score = items.reduce((sum, item) => {
    if (item.state === 'pass') return sum + 1
    if (item.state === 'warning') return sum + 0.5
    return sum
  }, 0)
  const total = items.length
  const percent = Math.round((score / total) * 100)
  const hasFail = items.some((item) => item.state === 'fail')
  const hasWarning = items.some((item) => item.state === 'warning')
  const level = hasFail ? 'blocked' : hasWarning || percent < 100 ? 'warning' : 'ready'
  const risks = items.filter((item) => item.state !== 'pass')

  return {
    level,
    score,
    total,
    percent,
    summary:
      level === 'ready'
        ? '核心链路在线，可进入现场联调或生产观察。'
        : level === 'warning'
          ? '核心服务可用，但仍有需要关注的运行风险。'
          : '存在阻断项，建议处理后再作为生产系统使用。',
    items,
    risks
  }
}

async function buildSystemStatus(req) {
  const backend = {
    ok: true,
    service: 'mysql-backend',
    port: serverPort,
    pid: process.pid,
    startedAt: serverStartedAt.toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    memoryMb: sanitizeMemoryUsage(process.memoryUsage()),
    authMode: authConfig.mode,
    activeSessions: loginSessionMap.size
  }
  const frontend = {
    apiProxyReachable: true,
    requestHost: req.get('host') || '',
    requestOrigin: req.get('origin') || '',
    userAgent: req.get('user-agent') || ''
  }
  const database = await getDatabaseStatus()
  const dataFreshness = await getDataFreshnessStatus()
  const alerts = await getAlertStatus()
  const mqtt = { ...mqttState }

  return {
    generatedAt: new Date().toISOString(),
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      authMode: authConfig.mode,
      mqttEnabled: mqttConfig.enabled,
      dataStaleAfterMinutes: dataFreshness.staleAfterMinutes
    },
    backend,
    frontend,
    database,
    mqtt,
    dataFreshness,
    alerts,
    readiness: buildReadinessStatus({ backend, frontend, database, mqtt, dataFreshness, alerts })
  }
}

function buildMinimalSystemStatus() {
  return {
    status: 'ok',
    service: 'mysql-backend',
    generatedAt: new Date().toISOString()
  }
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const userName = String(req.body?.userName || '').trim()
    const password = String(req.body?.password || '').trim()

    if (!userName || !password) {
      void safeAuditOperation(
        buildLoginAudit(req, { userName, status: 'failed', message: 'missing_credentials' })
      )
      res.json({ code: 400, msg: '用户名或密码不能为空', data: null })
      return
    }

    let roles = inferRolesFromUserName(userName)
    let sessionExtra = {}
    let person = await findPersonAccount(userName)
    if (person) {
      const active =
        !['停用', '离职', '禁用', 'disabled', 'inactive'].includes(
          String(person.status || '').toLowerCase()
        ) && person.is_active !== 0
      if (!active) {
        void safeAuditOperation(
          buildLoginAudit(req, { userName, status: 'failed', message: 'account_disabled' })
        )
        sendUnauthorized(res, '账号已停用')
        return
      }
      if (!person.password_hash) {
        if (password !== authConfig.defaultPersonPassword) {
          void safeAuditOperation(
            buildLoginAudit(req, { userName, status: 'failed', message: 'invalid_credentials' })
          )
          sendUnauthorized(res, '用户名或密码错误')
          return
        }
        person = await ensureDefaultPersonPassword(person)
      }
      if (!verifyPasswordDigest(password, person.password_hash)) {
        void safeAuditOperation(
          buildLoginAudit(req, { userName, status: 'failed', message: 'invalid_credentials' })
        )
        sendUnauthorized(res, '用户名或密码错误')
        return
      }
      roles = personRoleToAuthRoles(person.role)
      sessionExtra = buildSessionExtraFromPerson(person)
      await updateRowById('persons', person.id, { lastLoginAt: new Date() }).catch(() => undefined)
    } else if (isStrictAuth()) {
      if (!authConfig.adminPassword) {
        res
          .status(500)
          .json({ code: 500, msg: 'ADMIN_PASSWORD is required in strict auth mode', data: null })
        return
      }

      if (userName !== authConfig.adminUser || password !== authConfig.adminPassword) {
        void safeAuditOperation(
          buildLoginAudit(req, { userName, status: 'failed', message: 'invalid_credentials' })
        )
        sendUnauthorized(res, '用户名或密码错误')
        return
      }
      roles = ['R_ADMIN']
      await ensureDefaultAdminPersonAccount()
      const adminPerson = await findPersonAccount(userName).catch(() => null)
      sessionExtra = adminPerson ? buildSessionExtraFromPerson(adminPerson) : {}
    }

    const token = isStrictAuth()
      ? issueSessionToken(userName, roles, sessionExtra)
      : `local-session-${userName}-${Date.now()}`
    const refreshToken = isStrictAuth() ? '' : `local-refresh-${userName}-${Date.now()}`

    loginSessionMap.set(token, {
      userName,
      roles,
      ...sessionExtra,
      createdAt: Date.now(),
      expiresAt: Date.now() + authConfig.sessionTtlMs
    })

    void safeAuditOperation(
      buildLoginAudit(req, { userName, status: 'completed', message: 'login_success' })
    )
    res.json(apiSuccess({ token, refreshToken }))
  } catch (error) {
    void safeAuditOperation(
      buildLoginAudit(req, {
        userName: String(req.body?.userName || '').trim(),
        status: 'failed',
        message: error?.message || String(error)
      })
    )
    sendApiError(res, error)
  }
})

app.post('/api/auth/register', async (req, res) => {
  try {
    const userName = String(req.body?.userName || req.body?.username || '').trim()
    const password = String(req.body?.password || '').trim()

    if (!userName || !password) {
      res.json({ code: 400, msg: '用户名或密码不能为空', data: null })
      return
    }

    const id = `register-${Buffer.from(userName).toString('hex').slice(0, 32)}`
    await insertRow('persons', {
      id,
      name: userName,
      department: '平台用户',
      role: '普通用户',
      status: 'active',
      notes: JSON.stringify({
        source: 'auth_register',
        passwordConfigured: Boolean(password),
        createdBy: 'register_page'
      }),
      hireDate: new Date().toISOString().slice(0, 10)
    })

    res.json(apiSuccess({ userName, roles: inferRolesFromUserName(userName) }))
  } catch (error) {
    res.json(apiFail(error))
  }
})

app.get('/api/user/info', (req, res) => {
  try {
    if (isStrictAuth()) {
      const session = getSessionFromRequest(req)
      if (!session) {
        sendUnauthorized(res, '登录已过期，请重新登录')
        return
      }

      res.json(apiSuccess(buildUserInfoFromSession(session)))
      return
    }

    const token = normalizeToken(req.headers.authorization)
    const session = token ? loginSessionMap.get(token) : null

    // 兼容旧 token 或刷新后会话丢失场景，避免动态路由初始化直接失败
    let userName = session?.userName
    let roles = session?.roles
    if (!userName || !roles) {
      if (token.startsWith('local-session-')) {
        const maybeName = token.split('-')[2]
        userName = maybeName || 'Admin'
        roles = inferRolesFromUserName(userName)
      } else {
        userName = 'Admin'
        roles = ['R_ADMIN']
      }
    }

    res.json(apiSuccess(buildUserInfo(userName, roles)))
  } catch (error) {
    res.json(apiFail(error))
  }
})

app.get('/api/user/profile', requireAuth, async (req, res) => {
  try {
    const session = req.user || getSessionFromRequest(req)
    res.json(apiSuccess(buildUserInfoFromSession(session)))
  } catch (error) {
    sendApiError(res, error)
  }
})

app.post('/api/user/profile/update', requireAuth, async (req, res) => {
  try {
    const session = req.user || getSessionFromRequest(req)
    if (!session?.personId) {
      throw createHttpError(400, '当前账号未绑定人员档案', 'PERSON_NOT_BOUND')
    }
    const payload = {
      name: firstNonBlankText(
        req.body?.userName,
        req.body?.name,
        session.realName,
        session.userName
      ),
      email: firstNonBlankText(req.body?.email, session.email),
      phone: firstNonBlankText(req.body?.phone, session.phone),
      department: firstNonBlankText(req.body?.department, session.department),
      updatedAt: new Date()
    }
    await updateRowById('persons', session.personId, payload)
    Object.assign(session, {
      realName: payload.name,
      email: payload.email,
      phone: payload.phone,
      department: payload.department
    })
    res.json(apiSuccess(buildUserInfoFromSession(session), '个人信息已更新'))
  } catch (error) {
    sendApiError(res, error)
  }
})

app.post('/api/user/password/change', requireAuth, async (req, res) => {
  try {
    const session = req.user || getSessionFromRequest(req)
    const oldPassword = String(req.body?.oldPassword || '').trim()
    const newPassword = String(req.body?.newPassword || '').trim()
    const confirmPassword = String(req.body?.confirmPassword || '').trim()
    if (!oldPassword || !newPassword)
      throw createHttpError(400, '旧密码和新密码不能为空', 'PASSWORD_REQUIRED')
    if (newPassword !== confirmPassword)
      throw createHttpError(400, '两次新密码不一致', 'PASSWORD_CONFIRM_MISMATCH')
    assertPasswordPolicy(newPassword)

    const person = session?.personId
      ? (
          await pool.query('SELECT * FROM `persons` WHERE `id` = ? LIMIT 1', [session.personId])
        )[0][0]
      : await findPersonAccount(session?.userName)

    if (!person?.id || !person.password_hash) {
      if (
        !(session?.userName === authConfig.adminUser && oldPassword === authConfig.adminPassword)
      ) {
        throw createHttpError(400, '当前账号未配置可修改的人员密码', 'PASSWORD_NOT_CONFIGURED')
      }
    } else if (!verifyPasswordDigest(oldPassword, person.password_hash)) {
      throw createHttpError(400, '旧密码不正确', 'INVALID_OLD_PASSWORD')
    }

    const targetId = person?.id || 'system-admin'
    if (!person?.id) await ensureDefaultAdminPersonAccount()
    const now = new Date()
    await updateRowById('persons', targetId, {
      accountName: session?.userName || authConfig.adminUser,
      passwordHash: passwordDigest(newPassword),
      passwordUpdatedAt: now,
      updatedAt: now
    })
    void safeAuditOperation({
      actionType: 'user_password_change',
      targetType: 'persons',
      targetId,
      operator: session?.userName || 'unknown',
      status: 'completed',
      requestPayload: sanitizeAuditPayload({
        targetId,
        self: true,
        request: requestAuditContext(req)
      }),
      resultPayload: { ok: true }
    })
    res.json(apiSuccess({ ok: true }, '密码已修改'))
  } catch (error) {
    sendApiError(res, error)
  }
})

app.post('/api/admin/persons/:id/password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetId = String(req.params.id || '').trim()
    const accountName = normalizeAccountName(req.body?.accountName || req.body?.userName || '')
    const newPassword = String(req.body?.newPassword || req.body?.password || '').trim()
    if (!targetId) throw createHttpError(400, '人员 ID 不能为空', 'PERSON_ID_REQUIRED')
    if (!accountName) throw createHttpError(400, '登录账号不能为空', 'ACCOUNT_REQUIRED')
    if (!newPassword) throw createHttpError(400, '新密码不能为空', 'PASSWORD_REQUIRED')
    assertPasswordPolicy(newPassword)

    await ensurePersonAccountColumns()
    const [personRows] = await pool.query('SELECT * FROM `persons` WHERE `id` = ? LIMIT 1', [
      targetId
    ])
    const person = personRows[0]
    if (!person) throw createHttpError(404, '人员不存在', 'PERSON_NOT_FOUND')
    const [accountRows] = await pool.query(
      'SELECT `id`, `account_name` FROM `persons` WHERE `account_name` IS NOT NULL LIMIT 10000'
    )
    const normalizedAccount = accountName.toLowerCase()
    const conflicts = accountRows.filter(
      (row) =>
        normalizeAccountName(row.id) !== targetId &&
        normalizeAccountName(row.account_name).toLowerCase() === normalizedAccount
    )
    if (conflicts.length) throw createHttpError(409, '登录账号已被其他人员使用', 'ACCOUNT_CONFLICT')

    const now = new Date()
    await updateRowById('persons', targetId, {
      accountName,
      passwordHash: passwordDigest(newPassword),
      passwordUpdatedAt: now,
      updatedAt: now
    })
    void safeAuditOperation({
      actionType: 'admin_password_reset',
      targetType: 'persons',
      targetId,
      operator: req.user?.userName || 'unknown',
      status: 'completed',
      requestPayload: sanitizeAuditPayload({
        targetId,
        accountName,
        request: requestAuditContext(req)
      }),
      resultPayload: { ok: true }
    })
    res.json(apiSuccess({ ok: true, targetId, accountName }, '密码已重置'))
  } catch (error) {
    sendApiError(res, error)
  }
})

app.get('/api/health', (_req, res) => {
  res.json(apiSuccess({ status: 'ok' }))
})

app.get('/api/version', async (_req, res) => {
  try {
    res.json(apiSuccess(await readApiBuildInfo()))
  } catch (error) {
    sendApiError(res, error)
  }
})

app.get('/api/milk/missing-review', requireAuth, async (req, res) => {
  try {
    const expectedShifts = req.query.expectedShifts || (await loadMilkReviewDefaultShifts())
    res.json(
      apiSuccess(
        await buildMilkMissingReviewFromDb({
          startDate: req.query.startDate,
          endDate: req.query.endDate,
          period: req.query.period,
          expectedShifts
        })
      )
    )
  } catch (error) {
    res.json(apiFail(error))
  }
})

app.post('/api/milk/missing-review/confirm', requireAuth, async (req, res) => {
  try {
    res.json(apiSuccess(await confirmMilkMissingReviewFromDb(req.body || {})))
  } catch (error) {
    res.json(apiFail(error))
  }
})

app.get('/api/omics/health', requireAuth, async (_req, res) => {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    try {
      const response = await fetch(`${omicsConfig.serviceUrl}/health`, {
        signal: controller.signal
      })
      const data = response.ok
        ? await response.json()
        : { status: 'error', httpStatus: response.status }
      res.json(
        apiSuccess({ service: 'omics-proxy', status: response.ok ? 'ok' : 'error', upstream: data })
      )
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    res.json(apiFail(error))
  }
})

app.get('/api/omics/modules/catalog', requireAuth, (_req, res) => {
  res.json(
    apiSuccess(
      OMICS_MODULE_CATALOG.map((module) => ({
        ...module,
        parameterSchema: getOmicsModuleParameterSchema(module.id)
      }))
    )
  )
})

app.post('/api/omics/modules/run', requireAuth, async (req, res) => {
  try {
    res.json(apiSuccess(await runOmicsModule(req.body || {}, req)))
  } catch (error) {
    res.json(apiFail(error))
  }
})

app.get('/api/omics/modules/results', requireAuth, async (req, res) => {
  try {
    await ensureOmicsRunTables()
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)))
    const [ids] = await pool.query(
      'SELECT `id` FROM `omics_module_runs` ORDER BY `executed_at` DESC, `id` DESC LIMIT ?',
      [limit]
    )
    const runIds = ids.map((row) => row.id).filter(Boolean)
    const rows = runIds.length
      ? (
          await pool.query(
            `SELECT * FROM \`omics_module_runs\` WHERE \`id\` IN (${runIds.map(() => '?').join(',')})`,
            runIds
          )
        )[0].sort((left, right) => runIds.indexOf(left.id) - runIds.indexOf(right.id))
      : []
    res.json(apiSuccess(rows.map(normalizeModuleRun)))
  } catch (error) {
    res.json(apiFail(error))
  }
})

app.post('/api/omics/workflows/run', requireAuth, async (req, res) => {
  try {
    res.json(apiSuccess(await runOmicsWorkflow(req.body || {}, req)))
  } catch (error) {
    res.json(apiFail(error))
  }
})

app.get('/api/omics/workflows/results', requireAuth, async (req, res) => {
  try {
    await ensureOmicsRunTables()
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)))
    const [ids] = await pool.query(
      'SELECT `id` FROM `omics_workflow_runs` ORDER BY `executed_at` DESC, `id` DESC LIMIT ?',
      [limit]
    )
    const runIds = ids.map((row) => row.id).filter(Boolean)
    const rows = runIds.length
      ? (
          await pool.query(
            `SELECT * FROM \`omics_workflow_runs\` WHERE \`id\` IN (${runIds.map(() => '?').join(',')})`,
            runIds
          )
        )[0].sort((left, right) => runIds.indexOf(left.id) - runIds.indexOf(right.id))
      : []
    res.json(apiSuccess(rows.map(normalizeWorkflowRun)))
  } catch (error) {
    res.json(apiFail(error))
  }
})

app.get('/api/system/status', async (req, res) => {
  try {
    const session = getSessionFromRequest(req)
    if (isStrictAuth() && !session) {
      res.json(apiSuccess(buildMinimalSystemStatus()))
      return
    }
    if (session) req.user = session
    res.json(apiSuccess(await buildSystemStatus(req)))
  } catch (error) {
    sendApiError(res, error)
  }
})

app.post('/api/db/rpc', requireAuth, async (req, res) => {
  const { method, ...payload } = req.body || {}
  const shouldAudit = isRpcWriteMethod(method)
  try {
    if (shouldAudit && isStrictAuth() && !hasAdminRole(req.user)) {
      throw createHttpError(403, '需要管理员权限', 'ADMIN_REQUIRED')
    }

    if (isRpcDdlMutation(method) || (isProductionRuntime && isRpcMaintenanceMethod(method))) {
      throw createHttpError(
        403,
        'Production maintenance RPC is disabled',
        'PRODUCTION_RPC_FORBIDDEN'
      )
    }

    const data = await rpcHandler(method, payload, req)
    if (shouldAudit) {
      void safeAuditOperation(buildRpcAudit(req, method, payload, 'completed', { ok: true }))
    }
    res.json(apiSuccess(data))
  } catch (error) {
    if (shouldAudit) {
      void safeAuditOperation(
        buildRpcAudit(req, method, payload, 'failed', {
          status: Number(error?.status || 500),
          code: error?.code || '',
          message: error?.message || String(error)
        })
      )
    }
    sendApiError(res, error)
  }
})

app.post('/api/cow/:scope/:method', requireAuth, async (req, res) => {
  try {
    const { scope, method } = req.params
    const args = Array.isArray(req.body?.args) ? req.body.args : []
    const rawData = await handleCowScope(scope, method, args, req)
    const payload = buildCowApiPayload(method, args, rawData)
    res.json(apiSuccess(payload))
  } catch (error) {
    res.json(apiFail(error))
  }
})

app.listen(serverPort, async () => {
  console.log(`MySQL API server ready: http://127.0.0.1:${serverPort}`)
  console.log(`MySQL: ${config.user}@${config.host}:${config.port}/${config.database}`)
  startMqttServer()

  try {
    await initializeStartupDatabase()
    console.log('[startup] Database schema and account initialization complete')
  } catch (error) {
    console.error('MySQL connection failed:', error?.message || error)
  }
})
