<template>
  <BusinessCowNumberAutocomplete
    v-model="model"
    :placeholder="placeholder"
    :allow-new="allowNew"
    :max-suggestions="maxSuggestions"
    @blur="$emit('blur')"
    @select="(item) => $emit('select', item)"
  />
</template>

<script setup lang="ts">
  import BusinessCowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'

  withDefaults(
    defineProps<{
      placeholder?: string
      allowNew?: boolean
      maxSuggestions?: number
    }>(),
    {
      placeholder: '请输入或选择牛号',
      allowNew: false,
      maxSuggestions: 30
    }
  )

  defineEmits<{
    blur: []
    select: [item: Record<string, any>]
  }>()

  const model = defineModel<string>({ default: '' })
</script>
