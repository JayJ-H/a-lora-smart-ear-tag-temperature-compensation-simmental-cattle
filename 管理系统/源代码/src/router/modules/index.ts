import { AppRouteRecord } from '@/types/router'
import { dashboardRoutes } from './dashboard'
import {
  informationEntryRoutes,
  informationEditRoutes,
  dataDeviceRoutes,
  germplasmRoutes,
  intelligentBreedingRoutes,
  platformManagementRoutes
} from './cow'

export const routeModules: AppRouteRecord[] = [
  dashboardRoutes,
  informationEntryRoutes,
  informationEditRoutes,
  germplasmRoutes,
  intelligentBreedingRoutes,
  dataDeviceRoutes,
  platformManagementRoutes
]
