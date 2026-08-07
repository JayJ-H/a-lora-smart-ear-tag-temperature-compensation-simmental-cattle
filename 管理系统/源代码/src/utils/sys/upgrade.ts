import { StorageConfig } from '@/utils/storage/storage-config'

/** 将浏览器存储键统一到当前应用版本。 */
export async function systemUpgrade(): Promise<void> {
  if (typeof window === 'undefined') return

  const currentVersion = StorageConfig.CURRENT_VERSION
  const storedVersion = localStorage.getItem(StorageConfig.VERSION_KEY)
  if (storedVersion === currentVersion) return

  for (const key of Object.keys(localStorage)) {
    if (StorageConfig.isVersionedKey(key) && !StorageConfig.isCurrentVersionKey(key)) {
      localStorage.removeItem(key)
    }
  }

  localStorage.setItem(StorageConfig.VERSION_KEY, currentVersion)
}
