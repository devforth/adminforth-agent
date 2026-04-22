<template>
  <span class="absolute flex items-center justify-center w-5 h-5 bg-brand-softer rounded-full -start-3 ring-4 ring-buffer ">
    <IconBrainOutline class="w-3 h-3" />
  </span>

  <h3 class="flex items-center mb-1 text-sm my-2 ml-3 gap-1 ">
    {{  props.part.state === 'streaming' ? 'Thinking' : 'Thoughts' }}
    <template v-if=" props.part.state === 'streaming'">
      <span class="bounce-dot1 rounded-full w-2 h-2 bg-lightPrimary"></span>
      <span class="bounce-dot2 rounded-full w-2 h-2 bg-lightPrimary"></span>
      <span class="bounce-dot3 rounded-full w-2 h-2 bg-lightPrimary"></span>
    </template>
    <span 
      class="flex items-center gap-1 ms-2 bg-brand-softer border border-brand-subtle text-fg-brand-strong text-xs font-medium px-1.5 py-0.5 rounded"
      @click="isExpanded = !isExpanded"
    >
      expand
      <IconAngleDownOutline           
        :class="isExpanded ? 'rotate-180' : 'rotate-0'"
        class="transition-transform duration-200"
      />
    </span>
  </h3>
  <transition name="expand" class="max-h-36 overflow-y-auto">
    <p v-show="isExpanded" class="overflow-hidden mb-4 text-sm">
      <IncremarkContent
        class="text-wrap break-words w-full max-w-full"
        :content="part.text" 
      />
    </p>
  </transition>    
</template>



<script setup lang="ts">
import { IconBrainOutline, IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';
import type { IPart } from '../types';
import { ref, computed, watch, defineAsyncComponent } from 'vue';

const IncremarkContent = defineAsyncComponent(() => import('@incremark/vue').then(module => module.IncremarkContent))

const props = defineProps<{
  part: IPart
}>();

const isStateStreaming = computed(() => props.part.state === 'streaming')
const isExpanded = ref(true);

watch(() => props.part.state, (newValue) => {
  if ( newValue !== 'streaming') {
    isExpanded.value = false;
  } 
})



</script>


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
  max-height: 144px;
}

</style>