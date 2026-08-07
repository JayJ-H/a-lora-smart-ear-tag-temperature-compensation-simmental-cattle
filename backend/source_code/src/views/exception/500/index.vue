<template>
  <ArtException :data="data" />
</template>

<script setup lang="ts">
  import ArtException from '@/components/core/views/exception/ArtException.vue'
  import img500 from '@imgs/svg/500.svg'

  const data = {
    title: '500',
    desc: '服务器异常，请稍后重试。',
    btnText: '返回首页',
    imgUrl: img500
  }

  defineOptions({ name: 'Exception500' })
</script>
