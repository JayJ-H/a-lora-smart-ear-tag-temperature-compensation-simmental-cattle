/**
 * 用户账户管理 API 接口
 */

import request from '@/utils/http'

/** 更新个人信息参数 */
export interface UpdateProfileParams {
  userName: string
  email: string
  phone?: string
  avatar?: string
  department?: string
}

/** 修改密码参数 */
export interface ChangePasswordParams {
  oldPassword: string
  newPassword: string
  confirmPassword: string
}

/** 用户信息 */
export interface UserProfile {
  userId: number
  userName: string
  email: string
  phone?: string
  avatar?: string
  department?: string
  roles: string[]
  buttons: string[]
}

/** 获取当前用户信息 */
export function getUserProfile() {
  return request.get<UserProfile>({
    url: '/api/user/profile'
  })
}

/** 更新个人信息 */
export function updateUserProfile(params: UpdateProfileParams) {
  return request.post({
    url: '/api/user/profile/update',
    data: params,
    showSuccessMessage: true,
    showErrorMessage: false
  })
}

/** 修改密码 */
export function changePassword(params: ChangePasswordParams) {
  return request.post({
    url: '/api/user/password/change',
    data: params,
    showSuccessMessage: true,
    showErrorMessage: false
  })
}

/** 上传头像 */
export function uploadAvatar(file: File) {
  const formData = new FormData()
  formData.append('avatar', file)
  return request.post<string>({
    url: '/api/user/avatar/upload',
    data: formData,
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}
