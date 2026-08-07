<template>
  <FluentBaseInfoPage
    title="人员信息管理"
    description="人员字典"
    entity-label="人员"
    category-label="人员角色"
    :categories="categories"
    :columns="columns"
    :records="records"
    table-name="persons"
  >
    <template #row-actions="{ row }">
      <ElButton v-if="canResetPassword" size="small" type="primary" plain @click="openPasswordDialog(row)">
        重置密码
      </ElButton>
    </template>
  </FluentBaseInfoPage>

  <ElDialog
    v-model="passwordDialogVisible"
    title="重置人员密码"
    width="min(520px, calc(100vw - 32px))"
    @closed="resetPasswordForm"
  >
    <ElForm
      ref="passwordFormRef"
      :model="passwordForm"
      :rules="passwordRules"
      label-width="90px"
    >
      <ElFormItem label="人员">
        <ElInput :model-value="selectedPersonName" disabled />
      </ElFormItem>
      <ElFormItem label="登录账号" prop="accountName">
        <ElInput v-model.trim="passwordForm.accountName" />
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
    </ElForm>
    <template #footer>
      <ElButton @click="passwordDialogVisible = false">取消</ElButton>
      <ElButton type="primary" :loading="passwordSubmitting" @click="submitPasswordReset">
        保存
      </ElButton>
    </template>
  </ElDialog>
</template>

<script setup lang="ts">
  import { computed, reactive, ref } from 'vue'
  import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
  import FluentBaseInfoPage from '../components/FluentBaseInfoPage.vue'
  import request from '@/utils/http'
  import { useUserStore } from '@/store/modules/user'
  import { PERSON_ROLE_OPTIONS } from '@/utils/base-info-normalizers'

  interface PersonRow {
    id: string
    name?: string
    accountName?: string
    account_name?: string
    [key: string]: unknown
  }

  const roleDescriptions: Record<string, string> = {
    管理员: '系统配置与全局数据管理',
    兽医: '健康检查、诊疗和免疫记录',
    饲养员: '日常饲喂、奶厅、巡栏和清洁',
    记录员: '事件录入、台账维护和数据复核',
    育种员: '选配、繁殖、育种值和科研任务',
    技术员: '设备、传感器、实验室和数据接入'
  }

  const categories = PERSON_ROLE_OPTIONS.map((name, index) => ({
    id: String(index + 1),
    name,
    description: roleDescriptions[name] || '场内人员角色'
  }))

  const columns = [
    {
      prop: 'name',
      label: '姓名',
      minWidth: 120,
      required: true,
      aliases: ['personName', 'realName', 'nickname', 'username']
    },
    {
      prop: 'accountName',
      label: '登录账号',
      minWidth: 130,
      aliases: ['account_name', 'loginName', 'login_name', 'userName', 'username']
    },
    {
      prop: 'role',
      label: '角色',
      type: 'tag',
      minWidth: 110,
      required: true,
      options: PERSON_ROLE_OPTIONS,
      aliases: ['roleName', 'role_name', 'position', 'title', 'category', 'categoryName']
    },
    {
      prop: 'department',
      label: '部门',
      minWidth: 130,
      aliases: ['departmentName', 'department_name', 'dept']
    },
    { prop: 'phone', label: '联系电话', minWidth: 140, aliases: ['mobile', 'tel'] },
    { prop: 'email', label: '邮箱', minWidth: 180 },
    {
      prop: 'status',
      label: '状态',
      type: 'tag',
      minWidth: 100,
      required: true,
      options: ['正常', '停用', '离职'],
      aliases: ['state'],
      defaultValue: '正常'
    },
    { prop: 'notes', label: '备注', minWidth: 180 }
  ] as const

  const records = [
    {
      id: 'u1',
      name: '王牧',
      role: '管理员',
      department: '平台管理',
      phone: '',
      email: '',
      status: '正常',
      notes: '平台管理员'
    },
    {
      id: 'u2',
      name: '李医',
      role: '兽医',
      department: '健康管理',
      phone: '',
      email: '',
      status: '正常',
      notes: '负责健康巡检'
    },
    {
      id: 'u3',
      name: '张饲',
      role: '饲养员',
      department: '生产管理',
      phone: '',
      email: '',
      status: '正常',
      notes: '负责 A 区饲喂'
    }
  ]

  const userStore = useUserStore()
  const canResetPassword = computed(() =>
    (userStore.getUserInfo.roles || []).some((role) => ['R_ADMIN', 'R_SUPER'].includes(role))
  )
  const passwordDialogVisible = ref(false)
  const passwordSubmitting = ref(false)
  const passwordFormRef = ref<FormInstance>()
  const selectedPerson = ref<PersonRow | null>(null)
  const passwordForm = reactive({
    accountName: '',
    newPassword: '',
    confirmPassword: ''
  })
  const selectedPersonName = computed(() => String(selectedPerson.value?.name || selectedPerson.value?.id || ''))
  const passwordRules = computed<FormRules>(() => ({
    accountName: [{ required: true, message: '请输入登录账号', trigger: 'blur' }],
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

  function openPasswordDialog(row: PersonRow) {
    selectedPerson.value = row
    passwordForm.accountName = String(row.accountName || row.account_name || row.name || '').trim()
    passwordForm.newPassword = ''
    passwordForm.confirmPassword = ''
    passwordDialogVisible.value = true
  }

  function resetPasswordForm() {
    selectedPerson.value = null
    passwordForm.accountName = ''
    passwordForm.newPassword = ''
    passwordForm.confirmPassword = ''
    passwordFormRef.value?.clearValidate()
  }

  async function submitPasswordReset() {
    if (!selectedPerson.value?.id || !passwordFormRef.value) return
    const valid = await passwordFormRef.value.validate().catch(() => false)
    if (!valid) return
    passwordSubmitting.value = true
    try {
      await request.post({
        url: `/api/admin/persons/${encodeURIComponent(selectedPerson.value.id)}/password`,
        data: {
          accountName: passwordForm.accountName,
          newPassword: passwordForm.newPassword
        },
        showSuccessMessage: true,
        showErrorMessage: false
      })
      selectedPerson.value.accountName = passwordForm.accountName
      selectedPerson.value.account_name = passwordForm.accountName
      passwordDialogVisible.value = false
      ElMessage.success('人员密码已重置')
    } finally {
      passwordSubmitting.value = false
    }
  }

  defineOptions({ name: 'PersonInfo' })
</script>
