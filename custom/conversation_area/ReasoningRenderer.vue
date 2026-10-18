<template>
  <li class="overflow-hidden">
    <button
      type="button"
      class="flex items-center gap-2 w-full py-0.5 text-left text-[0.8125rem] leading-5 select-none"
      @click="isExpanded = !isExpanded"
    >
      <IconBrain class="w-4 h-4 shrink-0 text-lightInputIconColor dark:text-darkInputIconColor" />
      <span class="min-w-0 truncate font-medium text-lightTableText dark:text-darkTableText">{{ reasoningTitle || $t('Reasoning') }}</span>
      <ThreeDotsAnimation v-if="isStreaming"/>
      <IconChevronDown
        :class="isExpanded ? 'rotate-180' : 'rotate-0'"
        class="ml-auto w-3.5 h-3.5 shrink-0 text-lightInputIconColor transition-transform duration-200 dark:text-darkInputIconColor"
      />
    </button>
    <transition name="expand">
      <IncremarkContent
        v-if="isExpanded"
        v-show="isExpanded"
        class="ml-6 mb-1 text-sm text-lightInputIconColor dark:text-darkInputIconColor"
        :content="reasoningText"
      />
    </transition>
  </li>
</template>



<script setup lang="ts">
import { IconBrain, IconChevronDown } from '@iconify-prerendered/vue-lucide';
import type { IPart } from '../types';
import { ref, computed, watch, defineAsyncComponent } from 'vue';
import ThreeDotsAnimation from './ThreeDotsAnimation.vue';
import { extractTitleAndTextFromReasoning } from '../utils';

const props = defineProps<{
  state?: IPart['state']
  text?: string
}>();

const IncremarkContent = defineAsyncComponent(() => import('@incremark/vue').then(module => module.IncremarkContent))

const isExpanded = ref(true);
const isStreaming = computed(() => props.state === 'streaming');
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
  transition: all 300ms ease;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 256px;
}

</style>