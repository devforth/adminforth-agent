<template>
  <div 
    class="max-w-[600px] flex px-4 m-2 rounded-xl border"
    :class="props.role === 'user' ? 'bg-gray-100 self-end' : 'bg-blue-100 self-start'"
  >

    <IncremarkContent
      v-if="content"
      :content="content" 
      :is-finished="isFinished" 
    />
    <p v-else class="flex items-end gap-1 text-gray-900 py-2">
      Thinking
      <span class="bounce-dot1 rounded-full w-1 h-1 bg-gray-900"></span>
      <span class="bounce-dot2 rounded-full w-1 h-1 bg-gray-900"></span>
      <span class="bounce-dot3 rounded-full w-1 h-1 bg-gray-900"></span>
    </p>
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

<style scoped>

.bounce-dot1 {
  animation: bounce 1s infinite;
  animation-delay: 0s;
}

.bounce-dot2 {
  animation: bounce 1s infinite;
  animation-delay: 0.1s;
}

.bounce-dot3 {
  animation: bounce 1s infinite;
  animation-delay: 0.2s;
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(-100%);
    animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
  }
  50% {
    transform: none;
    animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
  }
}

</style>