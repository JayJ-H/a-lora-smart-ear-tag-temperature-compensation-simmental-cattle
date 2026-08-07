/**
 * 快速入口配置
 * 包含：应用列表、快速链接等配置
 */
import type { FastEnterConfig } from '@/types/config'

const fastEnterConfig: FastEnterConfig = {
  // 显示条件（屏幕宽度）
  minWidth: 1200,
  // 应用列表
  applications: [
    {
      name: '生产控制台',
      description: '查看今日牛群、泌乳、预警和设备运行情况',
      icon: 'ri:pie-chart-line',
      iconColor: '#377dff',
      enabled: true,
      order: 1,
      routeName: 'Dashboard'
    },
    {
      name: '信息录入',
      description: '录入生产、繁殖、健康、转群和采样事件',
      icon: 'ri:clipboard-line',
      iconColor: '#4f8d6a',
      enabled: true,
      order: 2,
      routeName: 'InformationEntryProduction'
    },
    {
      name: '批量导入',
      description: '按模板导入个体、系谱、表型、泌乳和事件数据',
      icon: 'ri:file-upload-line',
      iconColor: '#00a6a6',
      enabled: true,
      order: 3,
      routeName: 'InformationImport'
    },
    {
      name: '信息导出',
      description: '按业务模板预览和导出场内生产数据',
      icon: 'ri:file-download-line',
      iconColor: '#f5a524',
      enabled: true,
      order: 4,
      routeName: 'InformationExport'
    },
    {
      name: '泌乳复核',
      description: '复核日产奶缺失、班次缺口和汇总待拆数据',
      icon: 'ri:drop-line',
      iconColor: '#38c0fc',
      enabled: true,
      order: 5,
      routeName: 'LactationMissingReview'
    },
    {
      name: '种质评估',
      description: '查看表型、系谱、育种值和候选牛排行',
      icon: 'ri:award-line',
      iconColor: '#6b5cff',
      enabled: true,
      order: 6,
      routeName: 'GermplasmEvaluation'
    },
    {
      name: '硬件传感器',
      description: '管理设备接入、耳标绑定和传感器质量',
      icon: 'ri:base-station-line',
      iconColor: '#13deb9',
      enabled: true,
      order: 7,
      routeName: 'HardwareIntegration'
    }
  ],
  // 快速链接
  quickLinks: [
    {
      name: '登录',
      enabled: true,
      order: 1,
      routeName: 'Login'
    },
    {
      name: '注册',
      enabled: true,
      order: 2,
      routeName: 'Register'
    },
    {
      name: '忘记密码',
      enabled: true,
      order: 3,
      routeName: 'ForgetPassword'
    },
    {
      name: '个人中心',
      enabled: true,
      order: 4,
      routeName: 'UserCenter'
    },
    {
      name: '信息录入',
      enabled: true,
      order: 5,
      routeName: 'InformationEntryProduction'
    },
    {
      name: '批量导入',
      enabled: true,
      order: 6,
      routeName: 'InformationImport'
    }
  ]
}

export default Object.freeze(fastEnterConfig)
