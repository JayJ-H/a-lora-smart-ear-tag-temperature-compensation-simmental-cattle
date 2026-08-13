<template>
  <ElDropdown trigger="click" @command="changeLanguage">
    <button
      class="language-switch"
      :class="{ 'is-compact': compact }"
      type="button"
      :aria-label="t('system.language')"
      :title="t('system.language')"
    >
      <ArtSvgIcon icon="ri:translate-2" />
      <span>{{ currentLanguage }}</span>
      <ArtSvgIcon v-if="!compact" class="chevron" icon="ri:arrow-down-s-line" />
    </button>
    <template #dropdown>
      <ElDropdownMenu>
        <ElDropdownItem
          v-for="lang in languageOptions"
          :key="lang.value"
          :command="lang.value"
          :class="{ 'is-selected': locale === lang.value }"
        >
          <span>{{
            lang.value === LanguageEnum.ZH ? t('system.chinese') : t('system.english')
          }}</span>
          <ArtSvgIcon v-if="locale === lang.value" icon="ri:check-fill" />
        </ElDropdownItem>
      </ElDropdownMenu>
    </template>
  </ElDropdown>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { LanguageEnum } from '@/enums/appEnum'
  import { languageOptions } from '@/locales'
  import { useUserStore } from '@/store/modules/user'

  defineOptions({ name: 'ArtLanguageSwitch' })
  defineProps<{ compact?: boolean }>()

  const userStore = useUserStore()
  const { locale, t } = useI18n()
  const currentLanguage = computed(() => (locale.value === LanguageEnum.ZH ? '中文' : 'EN'))

  const changeLanguage = (lang: LanguageEnum) => {
    if (locale.value === lang) return
    locale.value = lang
    userStore.setLanguage(lang)
  }
</script>

<style scoped>
  .language-switch {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    min-height: 38px;
    padding: 0 10px;
    font-size: 13px;
    font-weight: 720;
    color: var(--fluent-text);
    white-space: nowrap;
    cursor: pointer;
    background: var(--fluent-surface-subtle, rgb(255 255 255 / 72%));
    border: 1px solid var(--fluent-border, rgb(71 111 89 / 16%));
    border-radius: var(--fluent-radius, 8px);
    box-shadow: var(--fluent-inset-highlight);
    transition:
      border-color 180ms ease,
      box-shadow 180ms ease,
      transform 180ms ease;
  }

  .language-switch:hover,
  .language-switch:focus-visible {
    border-color: var(--fluent-border-strong, rgb(71 111 89 / 32%));
    outline: none;
    box-shadow: var(--fluent-inset-highlight), var(--fluent-shadow-hover);
    transform: translateY(-1px);
  }

  .language-switch .art-svg-icon {
    font-size: 17px;
    color: var(--fluent-primary, var(--el-color-primary));
  }

  .language-switch .chevron {
    font-size: 15px;
    color: currentcolor;
  }

  .language-switch.is-compact {
    justify-content: center;
    min-width: 64px;
    min-height: 32px;
    padding: 0 8px;
    background: rgb(255 255 255 / 68%);
  }

  :global(.el-dropdown-menu__item.is-selected) {
    font-weight: 700;
    color: var(--el-color-primary);
  }

  :global(.el-dropdown-menu__item .art-svg-icon) {
    margin-left: auto;
  }
</style>
