<template>
  <span class="absolute flex items-center justify-center w-5 h-5 bg-brand-softer rounded-full -start-3 ring-4 ring-buffer ">
    <IconBrainOutline class="w-3 h-3" />
  </span>
  <h3 class="flex items-center mb-1 text-sm my-2 ml-3 gap-1 ">
    <span class="font-semibold">{{ reasoningTitle }}</span>
    <ThreeDotsAnimation v-if="isStreaming"/>
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
      {{ reasoningText }}
    </p>
  </transition>    
</template>



<script setup lang="ts">
import { IconBrainOutline, IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';
import type { IPart } from '../types';
import { ref, computed, watch } from 'vue';
import ThreeDotsAnimation from './ThreeDotsAnimation.vue';
import { extractTitleAndTextFromReasoning } from '../utils';

const props = defineProps<{
  state?: IPart['state']
  text?: string
}>();

const isStreaming = computed(() => props.state === 'streaming');
const isExpanded = ref(true);
const parsedReasoning = computed(() => extractTitleAndTextFromReasoning(props.text ?? ''));
const reasoningTitle = computed(() => parsedReasoning.value.title ?? '');
const reasoningText = computed(() => parsedReasoning.value.body);

watch(() => props.state, (newValue: IPart['state']) => {
  if ( newValue !== 'streaming') {
    isExpanded.value = false;
  } 
});



</script>


<style scoped>
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