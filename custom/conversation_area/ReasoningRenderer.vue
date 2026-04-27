<template>
  <span class="bg-lightNavbar dark:bg-darkNavbar absolute flex items-center text-listTableHeadingText dark:text-darkListTableHeadingText justify-center w-5 h-5 bg-brand-softer rounded-full -start-[0.68rem] ring-4 ring-lightNavbar dark:ring-darkNavbar ring-default">
    <div class="w-5 h-5 rounded-full flex items-center justify-center">
      <IconBrainOutline class="w-4 h-4" />
    </div>
  </span>
  <h3 
    class="flex items-center mb-1 text-sm my-2 ml-3 gap-1 cursor-pointer select-none hover:opacity-80 text-listTableHeadingText dark:text-darkListTableHeadingText"      
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
    <CustomAutoScrollContainer
      v-if="isExpanded" v-show="isExpanded" class="mb-4 text-sm max-h-64 pl-4"
      :wrapperStyle="{
        marginRight: '8rem',
      }"
      :enabled="isStreaming"
    >
      <IncremarkContent
        :content="reasoningText"
      />
    </CustomAutoScrollContainer>
  </transition>    
</template>



<script setup lang="ts">
import { IconBrainOutline, IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';
import type { IPart } from '../types';
import { ref, computed, watch, defineAsyncComponent } from 'vue';
import ThreeDotsAnimation from './ThreeDotsAnimation.vue';
import { extractTitleAndTextFromReasoning } from '../utils';
import CustomAutoScrollContainer from '../CustomAutoScrollContainer.vue';

const IncremarkContent = defineAsyncComponent(() => import('@incremark/vue').then(module => module.IncremarkContent))

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
  max-height: 256px;
}

</style>