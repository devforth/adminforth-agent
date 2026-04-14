<template>
  <div 
    class="max-w-[500px] flex px-4 m-2 rounded-xl border"
    :class="props.role === 'user' ? 'bg-gray-100 self-end' : 'bg-blue-100 self-start'"
  >

    <IncremarkContent
      class="max-w-[460px]"
      v-if="content"
      :content="content" 
      :is-finished="isFinished" 
    />
    <p v-else-if="props.state === 'streaming'" class="flex items-center gap-1 text-gray-900 py-2">
      Thinking
      <span class="bounce-dot1 rounded-full w-2 h-2 bg-lightPrimary"></span>
      <span class="bounce-dot2 rounded-full w-2 h-2 bg-lightPrimary"></span>
      <span class="bounce-dot3 rounded-full w-2 h-2 bg-lightPrimary"></span>
    </p>
    <p v-else class="text-red-500 py-2">
      Error occured
    </p>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, watch, ref, onMounted } from 'vue';
  import { IncremarkContent, AutoScrollContainer } from '@incremark/vue'
  import '@incremark/theme/styles.css'
  import 'katex/dist/katex.min.css'


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

  watch(() => props.message, (newMessage: string) => {
    content.value = newMessage
  })

  watch(() => props.state, (newState: string) => {
    if (newState === 'done') {
      isFinished.value = true
    }
  })

</script>

<style lang="scss">
  .incremark-paragraph {
    margin: 8px 0;
  }
</style>

<style scoped>

.bounce-dot1 {
  animation: bounce 1.5s infinite;
  animation-delay: 0s;
}

.bounce-dot2 {
  animation: bounce 1.5s infinite;
  animation-delay: 0.1s;
}

.bounce-dot3 {
  animation: bounce 1.5s infinite;
  animation-delay: 0.2s;
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(20%);
    opacity: 0.3;
    animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
  }
  50% {
    transform: none;
    opacity: 1;
    animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
  }
}

</style>