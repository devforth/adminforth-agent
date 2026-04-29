<template>
  <li class="mb-6 mx-2 mt-2 px-2 z-50 overflow-hidden">
    <span class="bg-lightNavbar dark:bg-darkNavbar absolute flex items-center text-listTableHeadingText dark:text-darkListTableHeadingText justify-center w-5 h-5 bg-brand-softer rounded-full -start-[0.68rem] ring-4 ring-lightNavbar dark:ring-darkNavbar ring-default">
      <div class="w-5 h-5 rounded-full flex items-center justify-center">
        <IconBrainOutline class="w-4 h-4" />
      </div>
    </span>
    <h3 
      class=" flex items-center mb-1 text-sm ml-3 gap-1 cursor-pointer select-none hover:opacity-80 text-listTableHeadingText dark:text-darkListTableHeadingText"      
      @click="isExpanded = !isExpanded"
    >
      <span class="font-semibold">{{ reasoningTitle }}</span>
      <ThreeDotsAnimation v-if="isStreaming"/>
      <IconAngleDownOutline           
        :class="isExpanded ? 'rotate-180' : 'rotate-0'"
        class="transition-transform duration-200"
      />
    </h3>
    <transition name="expand">
      <IncremarkContent
        v-if="isExpanded" 
        v-show="isExpanded"
        class="pl-4 text-sm"
        :content="reasoningText"
      />
    </transition>    
  </li>
</template>



<script setup lang="ts">
import { IconBrainOutline, IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';
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