<template>
  <template v-if="ToolOrReasoningParts.length > 0">
    <div 
      class="flex items-center gap-1"
      @click="isExpanded = !isExpanded"
    >
      Thoughts
      <ThreeDotsAnimation v-if="isGenerationInProgress" />
      <IconAngleDownOutline 
        :class="isExpanded ? 'rotate-180' : 'rotate-0'"
        class="transition-transform duration-200"
      />
    </div>
    <transition name="expand" class="max-h-96 overflow-y-auto mb-4">
      <ol v-show="isExpanded" class="relative border-l border-l-2 border-lightNavbarIcons border-default">
          <li class="mb-6 ms-2 pl-4 " v-for="(part, index) in ToolOrReasoningParts" :key="index"> 
            <ReasoningRenderer v-if="part.type === 'reasoning'" :state="part.state" :text="part.text" />
            <!-- <ToolRenderer v-else-if="part.type === 'data-tool-call'" :part="part" /> -->
          </li>
      </ol>
    </transition>
  </template>
</template>



<script setup lang="ts">
  import type { IMessage, IPart } from '../types';
  import { ref, computed } from 'vue';
  import ReasoningRenderer from './ReasoningRenderer.vue';
  import { IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';
  import ThreeDotsAnimation from './ThreeDotsAnimation.vue';

  const props = defineProps<{
    message: IMessage
  }>()
  const ToolOrReasoningParts = computed(() => {
    return props.message.parts.filter((part: IPart) => part.type === 'data-tool-call' || part.type === 'reasoning');
  });
  const isExpanded = ref(true);

  const isGenerationInProgress = computed(() => {
    return props.message.parts.some((part: IPart) => part.state === 'streaming');
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
    max-height: 384px;
  }

</style>