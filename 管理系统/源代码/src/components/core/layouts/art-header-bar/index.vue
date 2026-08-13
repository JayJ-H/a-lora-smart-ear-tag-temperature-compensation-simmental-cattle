<template>
  <header class="fluent-command-bar">
    <div class="command-left">
      <ArtIconButton
        v-if="isLeftMenu && shouldShowMenuButton"
        icon="ri:layout-left-line"
        class="command-icon"
        @click="visibleMenu"
      />

      <button class="brand-chip" type="button" @click="toHome">
        <ArtLogo class="brand-logo" :size="28" />
        <span>{{ $t('system.name') }}</span>
      </button>
    </div>

    <div class="command-right">
      <button
        class="effect-toggle"
        type="button"
        :aria-pressed="effectsEnabled"
        :title="effectsEnabled ? $t('system.disableEffects') : $t('system.enableEffects')"
        @click="toggleEffects"
      >
        <ArtSvgIcon :icon="effectsIcon" />
        <span>{{ effectsLabel }}</span>
      </button>
      <ArtLanguageSwitch />
      <ArtUserMenu />
    </div>
  </header>
</template>

<script setup lang="ts">
  import { MenuTypeEnum } from '@/enums/appEnum'
  import { useSettingStore } from '@/store/modules/setting'
  import { useCommon } from '@/hooks/core/useCommon'
  import { useHeaderBar } from '@/hooks/core/useHeaderBar'
  import { useUiEffects } from '@/composables/useUiEffects'
  import ArtUserMenu from './widget/ArtUserMenu.vue'
  import ArtLanguageSwitch from '@/components/core/others/ArtLanguageSwitch.vue'

  defineOptions({ name: 'ArtHeaderBar' })

  const router = useRouter()
  const settingStore = useSettingStore()

  const { shouldShowMenuButton } = useHeaderBar()
  const { effectsEnabled, effectsIcon, effectsLabel, toggleEffects } = useUiEffects()

  const { menuOpen, menuType } = storeToRefs(settingStore)

  const isLeftMenu = computed(() => menuType.value === MenuTypeEnum.LEFT)
  const { homePath } = useCommon()

  const visibleMenu = (): void => {
    settingStore.setMenuOpen(!menuOpen.value)
  }

  const toHome = (): void => {
    router.push(homePath.value)
  }
</script>

<style lang="scss" scoped>
  .fluent-command-bar {
    display: flex;
    gap: 12px;
    align-items: center;
    min-height: 68px;
    padding: 10px 18px;
    color: var(--fluent-text);
    background:
      linear-gradient(180deg, rgb(255 255 255 / 82%), rgb(249 252 248 / 70%)),
      rgb(255 255 255 / 72%);
    -webkit-backdrop-filter: var(--fluent-blur);
    backdrop-filter: var(--fluent-blur);
    border-bottom: 1px solid var(--fluent-border);
    box-shadow:
      var(--fluent-inset-highlight),
      0 16px 36px rgb(54 105 39 / 8%);
  }

  .command-left {
    display: flex;
    gap: 10px;
    align-items: center;
    min-width: 0;
  }

  .command-right {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-left: auto;
  }

  .effect-toggle {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    min-height: 38px;
    padding: 0 11px;
    font-size: 13px;
    font-weight: 720;
    color: var(--fluent-text);
    white-space: nowrap;
    cursor: pointer;
    background: var(--fluent-surface-subtle);
    -webkit-backdrop-filter: var(--fluent-blur);
    backdrop-filter: var(--fluent-blur);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
    transition:
      border-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1),
      transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .effect-toggle:hover,
  .effect-toggle:focus-visible {
    border-color: var(--fluent-border-strong);
    outline: none;
    box-shadow: var(--fluent-inset-highlight), var(--fluent-shadow-hover);
    transform: var(--fluent-card-hover-transform);
  }

  .effect-toggle .art-svg-icon {
    font-size: 17px;
    color: var(--fluent-primary);
  }

  .brand-chip {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    min-height: 40px;
    padding: 0 12px 0 8px;
    overflow: hidden;
    font-weight: 720;
    color: var(--fluent-text);
    cursor: pointer;
    background: var(--fluent-surface-subtle);
    -webkit-backdrop-filter: var(--fluent-blur);
    backdrop-filter: var(--fluent-blur);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
  }

  .brand-chip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .brand-logo {
    min-width: 28px;
  }

  .command-icon {
    border: 1px solid var(--fluent-border) !important;
    border-radius: var(--fluent-radius-sm) !important;
  }

  @media (width <= 640px) {
    .fluent-command-bar {
      min-height: 60px;
      padding: 8px 10px;
    }

    .brand-chip span {
      display: none;
    }

    .effect-toggle span {
      display: none;
    }
  }
</style>
