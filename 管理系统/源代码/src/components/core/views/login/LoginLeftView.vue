<!-- 登录、注册、忘记密码左侧背景 -->
<template>
  <div class="login-left-view">
    <div class="logo">
      <ArtLogo class="icon" size="46" />
      <h1 class="title">{{ $t('system.name') }}</h1>
    </div>

    <div class="left-img">
      <ThemeSvg :src="loginIcon" size="100%" />
    </div>

    <div class="text-wrap">
      <h1>{{ $t('login.leftView.title') }}</h1>
    </div>

    <!-- 几何装饰元素 -->
    <div class="geometric-decorations">
      <!-- 基础几何形状 -->
      <div class="geo-element circle-outline animate-fade-in-up" style="animation-delay: 0s"></div>
      <div
        class="geo-element square-rotated animate-fade-in-left"
        style="animation-delay: 0s"
      ></div>
      <div class="geo-element circle-small animate-fade-in-up" style="animation-delay: 0.3s"></div>

      <div
        class="geo-element square-bottom-right animate-fade-in-right"
        style="animation-delay: 0s"
      ></div>

      <!-- 背景泡泡 -->
      <div class="geo-element bg-bubble animate-scale-in" style="animation-delay: 0.5"></div>

      <!-- 太阳/月亮 -->
      <div
        class="geo-element circle-top-right animate-fade-in-down"
        style="animation-delay: 0.5"
        @click="themeAnimation"
      ></div>

      <!-- 装饰点 -->
      <div class="geo-element dot dot-top-left animate-bounce-in" style="animation-delay: 0s"></div>
      <div
        class="geo-element dot dot-top-right animate-bounce-in"
        style="animation-delay: 0s"
      ></div>
      <div
        class="geo-element dot dot-center-right animate-bounce-in"
        style="animation-delay: 0s"
      ></div>

      <!-- 叠加方块组 -->
      <div class="squares-group">
        <i
          class="geo-element square square-green animate-fade-in-left-rotated-green"
          style="animation-delay: 0.2s"
        ></i>
        <i
          class="geo-element square square-amber animate-fade-in-left-rotated-amber"
          style="animation-delay: 0.4s"
        ></i>
        <i
          class="geo-element square square-teal animate-fade-in-left-no-rotation"
          style="animation-delay: 0.6s"
        ></i>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import loginIcon from '@imgs/svg/login_icon.svg'
  import { themeAnimation } from '@/utils/ui/animation'

  // 定义 props
  defineProps<{
    hideContent?: boolean // 是否隐藏内容，只显示 logo
  }>()
</script>

<style lang="scss" scoped>
  // 颜色变量定义
  $primary-light-7: var(--el-color-primary-light-7);
  $primary-light-8: var(--el-color-primary-light-8);
  $primary-light-9: var(--el-color-primary-light-9);
  $primary-base: var(--el-color-primary);
  $main-bg: var(--default-box-color);

  // 混合颜色函数
  $bg-mix-light-9: color-mix(in srgb, $primary-light-9 100%, $main-bg);
  $bg-mix-light-8: color-mix(in srgb, $primary-light-8 80%, $main-bg);
  $bg-mix-light-7: color-mix(in srgb, $primary-light-7 80%, $main-bg);

  .login-left-view {
    position: relative;
    box-sizing: border-box;
    width: 65vw;
    height: 100%;
    padding: 22px;
    overflow: hidden;
    background:
      linear-gradient(
        140deg,
        rgb(255 255 255 / 86%) 0%,
        rgb(244 250 246 / 90%) 43%,
        rgb(225 238 231 / 95%) 100%
      ),
      radial-gradient(circle at 18% 22%, rgb(from $primary-base r g b / 14%), transparent 26%);

    .logo {
      position: relative;
      z-index: 100;
      display: flex;
      align-items: center;

      .title {
        margin-left: 10px;
        font-size: 19px;
        font-weight: 650;
        color: #203228;
        letter-spacing: 0;
      }
    }

    .left-img {
      position: absolute;
      inset: 2% 0 6%;
      z-index: 10;
      width: min(42%, 440px);
      margin: auto;
      filter: none;
      animation: slideInLeft 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
    }

    .field-panel {
      position: absolute;
      top: 18%;
      left: 8%;
      z-index: 20;
      width: min(390px, 44%);
      padding: 18px 18px 16px;
      color: #203228;
      background: rgb(255 255 255 / 70%);
      backdrop-filter: blur(18px);
      border: 1px solid rgb(71 111 89 / 16%);
      border-radius: 8px;
      box-shadow: 0 24px 70px rgb(31 53 42 / 12%);
      animation: slideInLeft 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;

      .panel-kicker {
        font-size: 11px;
        font-weight: 700;
        color: #587263;
        letter-spacing: 0.08em;
      }

      .panel-title {
        margin-top: 8px;
        font-size: 20px;
        font-weight: 750;
        line-height: 1.35;
      }

      .panel-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin-top: 16px;

        div {
          min-width: 0;
          padding: 10px;
          background: rgb(248 252 249 / 82%);
          border: 1px solid rgb(71 111 89 / 12%);
          border-radius: 6px;
        }

        span,
        strong {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        span {
          font-size: 12px;
          color: #6f8276;
        }

        strong {
          margin-top: 3px;
          font-size: 14px;
          color: #203228;
        }
      }
    }

    .text-wrap {
      position: absolute;
      right: 0;
      bottom: 64px;
      left: 0;
      width: 100%;
      text-align: center;
      animation: slideInLeft 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;

      h1 {
        font-size: clamp(23px, 2vw, 26px);
        font-weight: 750;
        color: #203228 !important;
      }

      p {
        max-width: 520px;
        margin: 10px auto 0;
        font-size: 15px;
        color: #587263 !important;
      }
    }

    .geometric-decorations {
      .geo-element {
        position: absolute;
        opacity: 0;
        animation-fill-mode: forwards;
        animation-duration: 0.8s;
        animation-timing-function: cubic-bezier(0.25, 0.46, 0.45, 0.94);
      }

      // 动画 mixin
      /* stylelint-disable at-rule-empty-line-before -- Prettier keeps chained SCSS conditions compact. */
      @mixin fadeAnimation($direction: '', $rotation: 0deg) {
        from {
          opacity: 0;

          @if $direction == 'up' {
            transform: translateY(30px) rotate($rotation);
          } @else if $direction == 'down' {
            transform: translateY(-30px) rotate($rotation);
          } @else if $direction == 'left' {
            transform: translateX(-30px) rotate($rotation);
          } @else if $direction == 'right' {
            transform: translateX(30px) rotate($rotation);
          }
        }

        to {
          opacity: 1;

          @if $direction == 'up' or $direction == 'down' {
            transform: translateY(0) rotate($rotation);
          } @else {
            transform: translateX(0) rotate($rotation);
          }
        }
      }
      /* stylelint-enable at-rule-empty-line-before */

      // 动画定义
      @keyframes fadeInUp {
        @include fadeAnimation('up');
      }

      @keyframes fadeInDown {
        @include fadeAnimation('down');
      }

      @keyframes fadeInLeft {
        @include fadeAnimation('left');
      }

      @keyframes fadeInLeftRotated {
        @include fadeAnimation('left', -25deg);
      }

      @keyframes fadeInRight {
        @include fadeAnimation('right');
      }

      @keyframes fadeInRightRotated {
        @include fadeAnimation('right', 45deg);
      }

      @keyframes fadeInLeftRotatedGreen {
        @include fadeAnimation('left', -10deg);
      }

      @keyframes fadeInLeftRotatedAmber {
        @include fadeAnimation('left', 10deg);
      }

      @keyframes fadeInLeftNoRotation {
        @include fadeAnimation('left');
      }

      @keyframes scaleIn {
        from {
          opacity: 0;
          transform: scale(0.8);
        }

        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      @keyframes bounceIn {
        0% {
          opacity: 0;
          transform: scale(0.3);
        }

        50% {
          opacity: 1;
          transform: scale(1.05);
        }

        70% {
          transform: scale(0.9);
        }

        100% {
          opacity: 1;
          transform: scale(1);
        }
      }

      @keyframes lineGrow {
        from {
          opacity: 0;
        }

        to {
          opacity: 1;
        }
      }

      @keyframes slideInLeft {
        from {
          opacity: 0;
          transform: translateX(-30px);
        }

        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      // 动画类
      .animate-fade-in-up {
        animation-name: fadeInUp;
      }

      .animate-fade-in-down {
        animation-name: fadeInDown;
      }

      .animate-fade-in-left {
        animation-name: fadeInLeft;
      }

      .animate-fade-in-right {
        animation-name: fadeInRight;
      }

      .animate-scale-in {
        animation-name: scaleIn;
        animation-duration: 1.2s;
      }

      .animate-bounce-in {
        animation-name: bounceIn;
        animation-duration: 0.6s;
      }

      .animate-fade-in-left-rotated-green {
        animation-name: fadeInLeftRotatedGreen;
      }

      .animate-fade-in-left-rotated-amber {
        animation-name: fadeInLeftRotatedAmber;
      }

      .animate-fade-in-left-no-rotation {
        animation-name: fadeInLeftNoRotation;
      }

      // 基础几何形状
      .circle-outline {
        top: 10%;
        left: 25%;
        width: 42px;
        height: 42px;
        border: 1px solid rgb(71 111 89 / 18%);
        border-radius: 50%;
      }

      .square-rotated {
        top: 50%;
        left: 16%;
        width: 60px;
        height: 60px;
        background-color: rgb(255 255 255 / 42%);
        border: 1px solid rgb(71 111 89 / 10%);

        &.animate-fade-in-left {
          animation-name: fadeInLeftRotated;
        }
      }

      .circle-small {
        bottom: 26%;
        left: 30%;
        width: 18px;
        height: 18px;
        background-color: rgb(71 111 89 / 22%);
        border-radius: 50%;
      }

      // 太阳/月亮效果
      .circle-top-right {
        top: 3%;
        right: 3%;
        z-index: 100;
        width: 50px;
        height: 50px;
        cursor: pointer;
        background: rgb(255 255 255 / 70%);
        border: 1px solid rgb(71 111 89 / 16%);
        border-radius: 50%;
        transition: all 0.3s;

        &::after {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 100%;
          height: 100%;
          content: '';
          background: linear-gradient(135deg, #ffcd66, #f6efb1);
          border-radius: 50%;
          opacity: 0;
          transition: all 0.5s;
          transform: translate(-50%, -50%);
        }

        &:hover {
          box-shadow: 0 0 34px rgb(255 205 102 / 58%);

          &::after {
            opacity: 1;
          }
        }
      }

      .square-bottom-right {
        right: 10%;
        bottom: 10%;
        width: 50px;
        height: 50px;
        background-color: rgb(71 111 89 / 12%);
        border: 1px solid rgb(71 111 89 / 12%);

        &.animate-fade-in-right {
          animation-name: fadeInRightRotated;
        }
      }

      // 背景泡泡
      .bg-bubble {
        top: -120px;
        right: -120px;
        width: 360px;
        height: 360px;
        background: linear-gradient(135deg, rgb(255 255 255 / 46%), rgb(111 151 129 / 10%));
        border-radius: 50%;
      }

      // 装饰点
      .dot {
        width: 14px;
        height: 14px;
        background-color: rgb(71 111 89 / 20%);
        border-radius: 50%;

        &.dot-top-left {
          top: 140px;
          left: 100px;
        }

        &.dot-top-right {
          top: 140px;
          right: 120px;
        }

        &.dot-center-right {
          top: 46%;
          right: 22%;
          background-color: rgb(71 111 89 / 15%);
        }
      }

      // 叠加方块组
      .squares-group {
        position: absolute;
        bottom: 18px;
        left: 20px;
        width: 140px;
        height: 140px;
        pointer-events: none;

        .square {
          position: absolute;
          display: block;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgb(64 87 167 / 12%);

          &.square-green {
            top: 12px;
            left: 30px;
            z-index: 2;
            width: 50px;
            height: 50px;
            background-color: rgb(59 116 87 / 18%);
          }

          &.square-amber {
            top: 30px;
            left: 48px;
            z-index: 1;
            width: 70px;
            height: 70px;
            background-color: rgb(232 186 108 / 16%);
          }

          &.square-teal {
            top: 66px;
            left: 86px;
            z-index: 3;
            width: 32px;
            height: 32px;
            background-color: rgb(38 63 51 / 22%);
          }
        }

        // 装饰线条
        &::after {
          position: absolute;
          top: 86px;
          left: 72px;
          width: 80px;
          height: 1px;
          content: '';
          background: linear-gradient(90deg, rgb(71 111 89 / 30%), transparent);
          opacity: 0;
          transform: rotate(50deg);
          animation: lineGrow 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
          animation-delay: 1.2s;
        }
      }
    }

    @media only screen and (width <= 1600px) {
      width: 60vw;

      .text-wrap {
        bottom: 40px;
      }

      .field-panel {
        width: min(360px, 48%);
      }
    }

    @media only screen and (width <= 1180px) {
      width: auto;
      height: auto;
      padding: 0;
      // 隐藏背景和其他内容，只保留 logo
      background: transparent;

      .left-img,
      .field-panel,
      .text-wrap,
      .geometric-decorations {
        display: none;
      }

      .logo {
        display: none;
      }
    }
  }

  // 暗色主题
  .dark .login-left-view {
    background:
      linear-gradient(140deg, #111714 0%, #17231d 52%, #0e1612 100%),
      radial-gradient(circle at 18% 22%, rgb(from $primary-base r g b / 18%), transparent 26%);

    @media only screen and (width <= 1180px) {
      background: transparent;
    }

    .geometric-decorations {
      // 月亮效果
      .circle-top-right {
        background-color: $bg-mix-light-8;
        box-shadow: 0 0 25px #333 inset;
        transition: all 0.3s ease-in-out 0.1s;
        rotate: -48deg;

        &::before {
          position: absolute;
          top: 0;
          left: 15px;
          width: 50px;
          height: 50px;
          content: '';
          background-color: $bg-mix-light-9;
          border-radius: 50%;
          transition: all 0.3s ease-in-out;
        }

        &:hover {
          background-color: transparent;
          box-shadow: 0 40px 25px #ddd inset;

          &::before {
            left: 18px;
          }

          &::after {
            opacity: 0;
          }
        }
      }

      .bg-bubble {
        background-color: rgb(255 255 255 / 5%);
      }

      // 其他元素颜色调整
      .square-rotated {
        background-color: rgb(255 255 255 / 5%);
      }

      .circle-small,
      .dot {
        background-color: rgb(255 255 255 / 12%);
      }

      .square-bottom-right {
        background-color: rgb(255 255 255 / 7%);
      }

      .dot.dot-top-right {
        background-color: rgb(255 255 255 / 12%);
      }
    }

    .logo .title,
    .text-wrap h1,
    .field-panel .panel-title,
    .field-panel .panel-grid strong {
      color: #f4fbf6 !important;
    }

    .text-wrap p,
    .field-panel .panel-kicker,
    .field-panel .panel-grid span {
      color: #abc0b3 !important;
    }

    .field-panel {
      background: rgb(14 22 18 / 66%);
      border-color: rgb(255 255 255 / 10%);
      box-shadow: 0 24px 70px rgb(0 0 0 / 22%);

      .panel-grid div {
        background: rgb(255 255 255 / 5%);
        border-color: rgb(255 255 255 / 8%);
      }
    }

    // 方块组暗色调整
    .squares-group {
      .square {
        box-shadow: none;

        &.square-green {
          background-color: rgb(from $primary-base r g b / 18%);
        }

        &.square-amber {
          background-color: rgb(from $primary-base r g b / 10%);
        }

        &.square-teal {
          background-color: rgb(from $primary-base r g b / 20%);
        }
      }

      &::after {
        background: linear-gradient(90deg, $primary-light-8, transparent);
      }
    }
  }

  /* The following theme layer intentionally overrides the structural selectors above. */
  /* stylelint-disable no-duplicate-selectors */
  .login-left-view {
    background:
      linear-gradient(
        140deg,
        rgb(255 255 255 / 88%) 0%,
        rgb(247 252 245 / 91%) 43%,
        rgb(239 248 236 / 95%) 100%
      ),
      radial-gradient(circle at 18% 22%, rgb(var(--fluent-primary-rgb) / 15%), transparent 26%);

    .logo .title,
    .field-panel,
    .field-panel .panel-grid strong,
    .text-wrap h1 {
      color: var(--fluent-text) !important;
    }

    .left-img {
      filter: none;
    }

    .field-panel {
      background: rgb(255 255 255 / 72%);
      -webkit-backdrop-filter: var(--fluent-blur);
      backdrop-filter: var(--fluent-blur);
      border-color: rgb(var(--fluent-primary-rgb) / 18%);
      box-shadow: 0 24px 70px rgb(54 105 39 / 12%);

      .panel-kicker,
      .panel-grid span {
        color: var(--fluent-text-soft) !important;
      }

      .panel-grid div {
        background: rgb(247 252 245 / 82%);
        border-color: rgb(var(--fluent-primary-rgb) / 14%);
      }
    }

    .text-wrap p {
      color: var(--fluent-text-soft) !important;
    }

    .geometric-decorations {
      .circle-outline,
      .square-rotated,
      .circle-top-right,
      .square-bottom-right {
        border-color: rgb(var(--fluent-primary-rgb) / 18%);
      }

      .circle-small,
      .dot,
      .square-bottom-right {
        background-color: rgb(var(--fluent-primary-rgb) / 16%);
      }

      .bg-bubble {
        background: linear-gradient(
          135deg,
          rgb(255 255 255 / 48%),
          rgb(var(--fluent-primary-rgb) / 11%)
        );
      }

      .dot.dot-center-right {
        background-color: rgb(0 166 166 / 14%);
      }

      .squares-group {
        .square-green {
          background-color: rgb(var(--fluent-primary-rgb) / 18%);
        }

        .square-amber {
          background-color: rgb(245 165 36 / 16%);
        }

        .square-teal {
          background-color: rgb(0 166 166 / 18%);
        }

        &::after {
          background: linear-gradient(90deg, rgb(var(--fluent-primary-rgb) / 28%), transparent);
        }
      }
    }
  }

  .dark .login-left-view {
    background:
      linear-gradient(140deg, #0a1020 0%, #101827 52%, #0d1524 100%),
      radial-gradient(circle at 18% 22%, rgb(var(--fluent-primary-rgb) / 20%), transparent 26%);

    .logo .title,
    .text-wrap h1,
    .field-panel .panel-title,
    .field-panel .panel-grid strong {
      color: var(--fluent-text) !important;
    }

    .text-wrap p,
    .field-panel .panel-kicker,
    .field-panel .panel-grid span {
      color: var(--fluent-text-soft) !important;
    }

    .field-panel {
      background: rgb(18 25 38 / 66%);
    }
  }
  /* stylelint-enable no-duplicate-selectors */
</style>
