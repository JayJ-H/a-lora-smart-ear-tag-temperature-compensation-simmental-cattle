<template>
  <div class="account-page">
    <div class="page-head">
      <div>
        <h1>个人中心</h1>
        <p>查看当前登录身份、角色权限和会话操作。</p>
      </div>
      <ElButton type="danger" plain @click="confirmLogout">
        <ArtSvgIcon icon="ri:logout-box-r-line" class="mr-2" />退出登录
      </ElButton>
    </div>

    <ElRow :gutter="20">
      <ElCol :xs="24" :lg="8">
        <section class="account-card profile-card">
          <img class="avatar" :src="userInfo.avatar || defaultAvatar" alt="avatar" />
          <h2>{{ displayName }}</h2>
          <p>{{ email }}</p>
          <div class="role-tags">
            <ElTag v-for="role in roles" :key="role" :type="getRoleType(role)">
              {{ getRoleLabel(role) }}
            </ElTag>
          </div>
          <div class="profile-actions">
            <ElButton type="primary" @click="lockScreen">
              <ArtSvgIcon icon="ri:lock-line" class="mr-2" />锁定屏幕
            </ElButton>
            <ElButton @click="goDashboard">返回首页</ElButton>
          </div>
        </section>
      </ElCol>

      <ElCol :xs="24" :lg="16">
        <section class="account-card">
          <div class="section-title">
            <h3>账户信息</h3>
            <ElTag type="success">已登录</ElTag>
          </div>
          <div class="info-grid">
            <div class="info-item">
              <span>登录账号</span>
              <strong>{{ displayName }}</strong>
            </div>
            <div class="info-item">
              <span>邮箱</span>
              <strong>{{ email }}</strong>
            </div>
            <div class="info-item">
              <span>用户 ID</span>
              <strong>{{ userInfo.userId || '-' }}</strong>
            </div>
            <div class="info-item">
              <span>角色</span>
              <strong>{{ roleText }}</strong>
            </div>
          </div>
        </section>

        <section class="account-card">
          <div class="section-title">
            <h3>会话操作</h3>
          </div>
          <div class="session-actions">
            <button type="button" class="session-action" @click="lockScreen">
              <ArtSvgIcon icon="ri:lock-line" />
              <span>
                <strong>锁定屏幕</strong>
                <small>临时离开工位时保留当前会话。</small>
              </span>
            </button>
            <button type="button" class="session-action danger" @click="confirmLogout">
              <ArtSvgIcon icon="ri:logout-box-r-line" />
              <span>
                <strong>退出登录</strong>
                <small>清理本地会话并回到登录页。</small>
              </span>
            </button>
          </div>
        </section>

        <section class="account-card">
          <div class="section-title">
            <h3>修改密码</h3>
          </div>
          <ElForm
            ref="passwordFormRef"
            :model="passwordForm"
            :rules="passwordRules"
            label-width="90px"
            class="password-form"
          >
            <ElFormItem label="旧密码" prop="oldPassword">
              <ElInput
                v-model="passwordForm.oldPassword"
                type="password"
                show-password
                autocomplete="current-password"
              />
            </ElFormItem>
            <ElFormItem label="新密码" prop="newPassword">
              <ElInput
                v-model="passwordForm.newPassword"
                type="password"
                show-password
                autocomplete="new-password"
              />
            </ElFormItem>
            <ElFormItem label="确认密码" prop="confirmPassword">
              <ElInput
                v-model="passwordForm.confirmPassword"
                type="password"
                show-password
                autocomplete="new-password"
              />
            </ElFormItem>
            <div class="form-actions">
              <ElButton @click="resetPasswordForm">清空</ElButton>
              <ElButton type="primary" :loading="passwordSubmitting" @click="submitPasswordChange">
                保存密码
              </ElButton>
            </div>
          </ElForm>
        </section>
      </ElCol>
    </ElRow>
  </div>
</template>

<script setup lang="ts">
  import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
  import { useUserStore } from '@/store/modules/user'
  import { mittBus } from '@/utils/sys'
  import defaultAvatar from '@/assets/images/user/avatar-cattle.svg'
  import { changePassword } from '@/api/account'
  import { HOME_PAGE_PATH } from '@/router'

  defineOptions({ name: 'UserCenter' })

  const router = useRouter()
  const userStore = useUserStore()
  const { getUserInfo: userInfo } = storeToRefs(userStore)

  const displayName = computed(() => userInfo.value.userName || '当前用户')
  const email = computed(() => userInfo.value.email || '未配置邮箱')
  const roles = computed(() => userInfo.value.roles || [])
  const roleText = computed(() => roles.value.map(getRoleLabel).join('、') || '-')
  const passwordFormRef = ref<FormInstance>()
  const passwordSubmitting = ref(false)
  const passwordForm = reactive({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  })

  const passwordRules = computed<FormRules>(() => ({
    oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
    newPassword: [
      { required: true, message: '请输入新密码', trigger: 'blur' },
      { min: 6, message: '密码至少 6 位', trigger: 'blur' }
    ],
    confirmPassword: [
      { required: true, message: '请再次输入新密码', trigger: 'blur' },
      {
        validator: (_rule, value, callback) => {
          if (value !== passwordForm.newPassword) callback(new Error('两次新密码不一致'))
          else callback()
        },
        trigger: 'blur'
      }
    ]
  }))

  function getRoleType(role: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
    const map: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
      R_SUPER: 'danger',
      R_ADMIN: 'primary',
      R_USER: 'success'
    }
    return map[role] || 'info'
  }

  function getRoleLabel(role: string): string {
    const map: Record<string, string> = {
      R_SUPER: '超级管理员',
      R_ADMIN: '管理员',
      R_USER: '普通用户'
    }
    return map[role] || role
  }

  function lockScreen() {
    mittBus.emit('openLockScreen')
  }

  function goDashboard() {
    router.push(HOME_PAGE_PATH)
  }

  async function confirmLogout() {
    await ElMessageBox.confirm('确定要退出当前账号吗？', '退出登录', {
      confirmButtonText: '退出登录',
      cancelButtonText: '取消',
      type: 'warning',
      customClass: 'login-out-dialog'
    })
    userStore.logOut()
  }

  function resetPasswordForm() {
    passwordForm.oldPassword = ''
    passwordForm.newPassword = ''
    passwordForm.confirmPassword = ''
    passwordFormRef.value?.clearValidate()
  }

  async function submitPasswordChange() {
    if (!passwordFormRef.value) return
    const valid = await passwordFormRef.value.validate().catch(() => false)
    if (!valid) return
    passwordSubmitting.value = true
    try {
      await changePassword({ ...passwordForm })
      resetPasswordForm()
      ElMessage.success('密码已修改')
    } finally {
      passwordSubmitting.value = false
    }
  }
</script>

<style scoped lang="scss">
  .account-page {
    padding: 20px;
  }

  .page-head {
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;

    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 760;
      color: var(--fluent-text);
    }

    p {
      margin: 6px 0 0;
      font-size: 14px;
      color: var(--art-gray-600);
    }
  }

  .account-card {
    padding: 22px;
    margin-bottom: 20px;
    background: var(--fluent-surface);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
    transition: border-color 0.18s ease;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .account-card:hover {
    border-color: rgb(38 99 31 / 24%);
    background: var(--fluent-surface);
  }

  .profile-card {
    text-align: center;

    h2 {
      margin: 14px 0 4px;
      font-size: 20px;
      font-weight: 760;
      color: var(--fluent-text);
    }

    p {
      margin: 0;
      font-size: 13px;
      color: var(--art-gray-600);
    }
  }

  .avatar {
    width: 92px;
    height: 92px;
    object-fit: cover;
    border: 4px solid rgb(255 255 255 / 76%);
    border-radius: 999px;
    box-shadow: 0 16px 30px rgb(38 83 32 / 16%);
  }

  .role-tags,
  .profile-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }

  .role-tags {
    margin-top: 16px;
  }

  .profile-actions {
    margin-top: 22px;
  }

  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18px;

    h3 {
      margin: 0;
      font-size: 17px;
      font-weight: 740;
      color: var(--fluent-text);
    }
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .info-item {
    min-height: 74px;
    padding: 14px;
    background: rgb(255 255 255 / 56%);
    border: 1px solid var(--fluent-border);
    border-radius: 8px;

    span,
    strong {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    span {
      font-size: 12px;
      color: var(--art-gray-600);
    }

    strong {
      margin-top: 8px;
      font-size: 15px;
      font-weight: 720;
      color: var(--fluent-text);
    }
  }

  .session-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .session-action {
    display: flex;
    gap: 12px;
    align-items: center;
    min-height: 86px;
    padding: 16px;
    text-align: left;
    cursor: pointer;
    background: rgb(255 255 255 / 58%);
    border: 1px solid var(--fluent-border);
    border-radius: 8px;
    transition:
      transform 0.18s ease,
      box-shadow 0.18s ease,
      border-color 0.18s ease;

    .art-svg-icon {
      flex: 0 0 auto;
      font-size: 22px;
      color: var(--main-color);
    }

    strong,
    small {
      display: block;
    }

    strong {
      font-size: 15px;
      color: var(--fluent-text);
    }

    small {
      margin-top: 5px;
      font-size: 12px;
      color: var(--art-gray-600);
    }
  }

  .session-action:hover {
    border-color: rgb(38 99 31 / 24%);
    box-shadow: var(--fluent-inset-highlight);
    transform: none;
  }

  .session-action.danger {
    .art-svg-icon,
    strong {
      color: #b42318;
    }
  }

  .password-form {
    max-width: 560px;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  @media (max-width: 768px) {
    .page-head,
    .session-actions,
    .info-grid {
      grid-template-columns: 1fr;
    }

    .page-head {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
