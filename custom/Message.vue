<template>
  <div 
    class="max-w-[600px] flex px-4 m-2 rounded-xl border"
    :class="props.role === 'user' ? 'bg-gray-100 self-end' : 'bg-blue-100 self-start'"
  >

    <IncremarkContent
      :content="content" 
      :is-finished="isFinished" 
    />
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, watch, ref, onMounted } from 'vue';
  import { IncremarkContent } from '@incremark/vue'
  import '@incremark/theme/styles.css'


  const props = defineProps<{
    type: string,
    message: string
    state: string
    role: 'user' | 'assistant'
  }>();
  
  const content = ref('')
  const isFinished = ref(false)

  onMounted(() => {
    content.value = props.message
  })

  watch(() => props.message, (newMessage) => {
    content.value = newMessage
  })

</script>

<style lang="scss">
  .incremark-paragraph {
    margin: 8px 0;
  }
</style>