<template>
  <div 
    class="max-w-[500px] flex px-4 m-2 rounded-xl border border-gray-200 dark:border-gray-700"
    :class="props.role === 'user' ? 'bg-gray-100 dark:bg-gray-100/10 self-end' : isTypeReasoning ? 'bg-white-100 dark:bg-gray-700 border-none self-start' : 'bg-blue-100 dark:bg-blue-700/10 self-start'"
  >

    <IncremarkContent
      class="max-w-[460px]"
      v-if="content && props.type === 'text'"
      :content="content" 
      :is-finished="isFinished" 
      :components="components"
    />
    <!-- reasoning/thinking -->
    <div 
      v-else-if="isTypeReasoning || isStateStreaming" 
      class="flex flex-col items-start gap-1 text-gray-500 py-2 " 
    >
      <div class="flex items-center gap-1 hover:underline cursor-pointer hover:text-gray-700" @click="isThoughtsExpanded = !isThoughtsExpanded">
        {{ isStateStreaming ? 'Thinking' : 'Thoughts' }}
        <template v-if="isStateStreaming">
          <span class="bounce-dot1 rounded-full w-2 h-2 bg-lightPrimary"></span>
          <span class="bounce-dot2 rounded-full w-2 h-2 bg-lightPrimary"></span>
          <span class="bounce-dot3 rounded-full w-2 h-2 bg-lightPrimary"></span>
        </template>
        <IconAngleDownOutline 
          :class="isThoughtsExpanded ? 'rotate-180' : 'rotate-0'"
          class="transition-transform duration-200"
        />
      </div>
      <transition name="expand">
        <p v-show="isThoughtsExpanded" class="overflow-hidden">
          {{ content }}
        </p>
      </transition>    
    </div>

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
  import { IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';

  const props = defineProps<{
    type: string,
    message: string
    state: string
    role: 'user' | 'assistant'
  }>();
  
  const content = ref('')
  const isFinished = ref(false)
  const isThoughtsExpanded = ref(false)

  onMounted(() => {
    content.value = props.message
  })

  const isTypeReasoning = computed(() => props.type === 'reasoning')
  const isStateStreaming = computed(() => props.state === 'streaming')

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

.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s ease;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 700px;
}

</style>