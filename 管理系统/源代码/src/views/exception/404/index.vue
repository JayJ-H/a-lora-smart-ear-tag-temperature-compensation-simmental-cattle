<template>
  <ArtException :data="数据" />
</template>

<script setup lang="ts">
  import ArtException from '@/components/core/views/exception/ArtException.vue'
  import img404 from '@imgs/svg/404.svg'

  const data = {
    title: '404',
    desc: '页面不存在，请检查访问地址。',
    btnText: '返回首页',
    imgUrl: img404
  }

  defineOptions({ name: 'Exception404' })
</script>
