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
      name: '状态总览',
      description: '查看后端、数据库、MQTT 和数据新鲜度',
      icon: 'ri:pie-chart-line',
      iconColor: '#377dff',
      enabled: true,
      order: 1,
      routeName: 'ServiceStatus'
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
      name: '个体查询',
      description: '查询耳号、牛号和体温曲线',
      icon: 'ri:search-line',
      iconColor: '#38c0fc',
      enabled: true,
      order: 5,
      routeName: 'IndividualQuery'
    },
    {
      name: '事件预警',
      description: '查看体温异常与预警处置队列',
      icon: 'ri:alarm-warning-line',
      iconColor: '#f5a524',
      enabled: true,
      order: 6,
      routeName: 'IndividualFilter'
    },
    {
      name: '系谱管理',
      description: '查看牛号系谱与父母代信息',
      icon: 'ri:git-branch-line',
      iconColor: '#6b5cff',
      enabled: true,
      order: 7,
      routeName: 'PedigreeManagement'
    },
    {
      name: '产奶管理',
      description: '查看产奶记录和泌乳汇总',
      icon: 'ri:drop-line',
      iconColor: '#38c0fc',
      enabled: true,
      order: 8,
      routeName: 'MilkManagementLegacy'
    },
    {
      name: 'MQTT 接口',
      description: '查看体温接入、后端与数据库联通状态',
      icon: 'ri:drop-line',
      iconColor: '#13deb9',
      enabled: true,
      order: 9,
      routeName: 'ServiceStatus'
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
