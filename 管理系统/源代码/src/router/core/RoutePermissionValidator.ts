import type { AppRouteRecord } from '@/types/router'

export class RoutePermissionValidator {
  static hasPermission(targetPath: string, menuList: AppRouteRecord[]): boolean {
    if (targetPath === '/') {
      return true
    }

    const pathSet = this.buildMenuPathSet(menuList)
    return pathSet.has(targetPath) || this.checkPathPrefix(targetPath, pathSet)
  }

  static buildMenuPathSet(
    menuList: AppRouteRecord[],
    pathSet: Set<string> = new Set()
  ): Set<string> {
    if (!Array.isArray(menuList) || menuList.length === 0) {
      return pathSet
    }

    for (const menuItem of menuList) {
      if (menuItem.path) {
        this.addRoutePath(pathSet, menuItem.path)
      }

      const aliases = Array.isArray(menuItem.alias)
        ? menuItem.alias
        : menuItem.alias
          ? [menuItem.alias]
          : []

      for (const alias of aliases) {
        if (typeof alias === 'string') {
          this.addRoutePath(pathSet, alias)
        }
      }

      if (menuItem.children?.length) {
        this.buildMenuPathSet(menuItem.children, pathSet)
      }
    }

    return pathSet
  }

  private static addRoutePath(pathSet: Set<string>, rawPath: string): void {
    if (!rawPath || rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
      return
    }

    const routePath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
    pathSet.add(routePath)
  }

  static checkPathPrefix(targetPath: string, pathSet: Set<string>): boolean {
    for (const menuPath of pathSet) {
      if (targetPath.startsWith(`${menuPath}/`)) {
        return true
      }
    }
    return false
  }

  static validatePath(
    targetPath: string,
    menuList: AppRouteRecord[],
    homePath: string = '/'
  ): { path: string; hasPermission: boolean } {
    const hasPermission = this.hasPermission(targetPath, menuList)

    if (hasPermission) {
      return { path: targetPath, hasPermission: true }
    }

    return { path: homePath, hasPermission: false }
  }
}
