<!-- 用户菜单 -->
<template>
  <ElPopover
    ref="userMenuPopover"
    placement="bottom-end"
    :width="260"
    :hide-after="0"
    :offset="10"
    trigger="click"
    :show-arrow="false"
    popper-class="user-menu-popover"
    popper-style="padding: 10px 14px;"
  >
    <template #reference>
      <button class="account-trigger" type="button" aria-label="账户菜单">
        <img class="account-avatar" :src="userInfo.avatar || defaultAvatar" alt="avatar" />
        <span class="account-name">{{ displayName }}</span>
        <ArtSvgIcon icon="ri:arrow-down-s-line" class="account-arrow" />
      </button>
    </template>
    <template #default>
      <div class="account-menu">
        <div class="account-summary">
          <img class="summary-avatar" :src="userInfo.avatar || defaultAvatar" alt="avatar" />
          <div class="summary-text">
            <span class="summary-name">{{ displayName }}</span>
            <span class="summary-email">{{ userInfo.email || '未配置邮箱' }}</span>
          </div>
        </div>
        <ul class="menu-list">
          <li class="btn-item" @click="goPage('/system/user-center')">
            <ArtSvgIcon icon="ri:user-3-line" />
            <span>{{ $t('topBar.user.userCenter') }}</span>
          </li>
          <li class="btn-item" @click="lockScreen()">
            <ArtSvgIcon icon="ri:lock-line" />
            <span>{{ $t('topBar.user.lockScreen') }}</span>
          </li>
        </ul>
        <button class="log-out" type="button" @click="loginOut">
          <ArtSvgIcon icon="ri:logout-box-r-line" />
          <span>{{ $t('topBar.user.logout') }}</span>
        </button>
      </div>
    </template>
  </ElPopover>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { useRouter } from 'vue-router'
  import { ElMessageBox } from 'element-plus'
  import { useUserStore } from '@/store/modules/user'
  import { mittBus } from '@/utils/sys'
  import defaultAvatar from '@/assets/images/user/avatar-cattle.svg'

  defineOptions({ name: 'ArtUserMenu' })

  const router = useRouter()
  const { t } = useI18n()
  const userStore = useUserStore()

  const { getUserInfo: userInfo } = storeToRefs(userStore)
  const userMenuPopover = ref()
  const displayName = computed(() => userInfo.value.userName || '当前用户')

  /**
   * 页面跳转
   * @param {string} path - 目标路径
   */
  const goPage = (path: string): void => {
    closeUserMenu()
    router.push(path)
  }

  /**
   * 打开锁屏功能
   */
  const lockScreen = (): void => {
    closeUserMenu()
    mittBus.emit('openLockScreen')
  }

  /**
   * 用户登出确认
   */
  const loginOut = (): void => {
    closeUserMenu()
    setTimeout(() => {
      ElMessageBox.confirm(t('common.logOutTips'), t('common.tips'), {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        customClass: 'login-out-dialog'
      }).then(() => {
        userStore.logOut()
      })
    }, 200)
  }

  /**
   * 关闭用户菜单弹出层
   */
  const closeUserMenu = (): void => {
    setTimeout(() => {
      userMenuPopover.value?.hide()
    }, 100)
  }
</script>

<style scoped>
  @reference '@styles/core/tailwind.css';

  .account-trigger {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    min-height: 40px;
    padding: 4px 8px 4px 6px;
    color: var(--fluent-text);
    cursor: pointer;
    background: var(--fluent-surface-subtle);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
    transition:
      transform 0.18s ease,
      box-shadow 0.18s ease,
      border-color 0.18s ease;
    backdrop-filter: var(--fluent-blur);
    -webkit-backdrop-filter: var(--fluent-blur);
  }

  .account-trigger:hover {
    border-color: rgb(38 99 31 / 30%);
    box-shadow: var(--fluent-inset-highlight);
    transform: none;
  }

  .account-avatar,
  .summary-avatar {
    object-fit: cover;
    border-radius: 999px;
  }

  .account-avatar {
    width: 30px;
    height: 30px;
  }

  .account-name {
    max-width: 112px;
    overflow: hidden;
    font-size: 13px;
    font-weight: 650;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .account-arrow {
    font-size: 16px;
    color: var(--art-gray-600);
  }

  .account-menu {
    color: var(--fluent-text);
  }

  .account-summary {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 6px 2px 12px;
    border-bottom: 1px solid var(--fluent-border);
  }

  .summary-avatar {
    width: 42px;
    height: 42px;
    border: 2px solid rgb(255 255 255 / 72%);
    box-shadow: 0 8px 18px rgb(38 83 32 / 12%);
  }

  .summary-text {
    min-width: 0;
  }

  .summary-name,
  .summary-email {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary-name {
    font-size: 14px;
    font-weight: 700;
  }

  .summary-email {
    margin-top: 3px;
    font-size: 12px;
    color: var(--art-gray-600);
  }

  .menu-list {
    padding: 12px 0 8px;
  }

  @layer components {
    .btn-item {
      @apply flex items-center p-2 mb-2 select-none rounded-md cursor-pointer last:mb-0;

      span {
        @apply text-sm;
      }

      .art-svg-icon {
        @apply mr-2 text-base;
      }

      &:hover {
        background-color: var(--art-gray-200);
      }
    }
  }

  .log-out {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 34px;
    margin-top: 6px;
    font-size: 13px;
    color: #b42318;
    cursor: pointer;
    background: rgb(254 243 242 / 70%);
    border: 1px solid rgb(253 162 155 / 70%);
    border-radius: 6px;
    transition:
      border-color 0.18s ease,
      background-color 0.18s ease;
  }

  .log-out:hover {
    background: rgb(254 226 226 / 82%);
    border-color: rgb(248 113 113 / 80%);
    transform: none;
  }

  @media (max-width: 640px) {
    .account-name,
    .account-arrow {
      display: none;
    }

    .account-trigger {
      min-height: 36px;
      padding: 3px;
      border-radius: 999px;
    }
  }
</style>
