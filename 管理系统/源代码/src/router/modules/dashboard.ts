import { AppRouteRecord } from '@/types/router'

export const dashboardRoutes: AppRouteRecord = {
  name: 'Dashboard',
  path: '/dashboard',
  component: '/dashboard/board',
  meta: {
    title: 'menus.dashboard.title',
    icon: 'ri:dashboard-line',
    roles: ['R_SUPER', 'R_ADMIN'],
    keepAlive: false,
    fixedTab: true
  }
}
