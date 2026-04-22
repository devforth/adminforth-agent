<template>
  <template v-if="ToolOrReasoningParts.length > 0 || isResponseInProgress || showFakeThinkingMessage">
    <div 
      class="ml-2 flex items-center gap-1 cursor-pointer select-none hover:opacity-80 tracking-wide font-medium text-sm"
      @click="isExpanded = !isExpanded"
    >
      Thoughts
      <ThreeDotsAnimation v-if="isResponseInProgress || showFakeThinkingMessage" />
      <IconAngleDownOutline 
        :class="isExpanded ? 'rotate-180' : 'rotate-0'"
        class="transition-transform duration-200"
      />
    </div>
    <transition name="expand" class="max-h-96 overflow-y-auto mb-4 ">
      <AutoScrollContainer
        :enabled="true"
        behavior="smooth"
        v-if="ToolOrReasoningParts.length > 0" 
        v-show="isExpanded"
      >
        <ol class="ml-8 relative border-l border-l-2 border-black border-default">
          <li class="mb-6 ms-2 z-50" v-for="(part, index) in ToolOrReasoningParts" :key="index"> 
            <ReasoningRenderer v-if="part.type === 'reasoning'" :state="part.state" :text="part.text" />
            <!-- <ToolRenderer v-else-if="part.type === 'data-tool-call'" :part="part" /> -->
          </li>      
        </ol>
      </AutoScrollContainer>
    </transition>
  </template>
</template>



<script setup lang="ts">
  import type { IMessage, IPart } from '../types';
  import { ref, computed, watch, defineAsyncComponent } from 'vue';
  import ReasoningRenderer from './ReasoningRenderer.vue';
  import { IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';
  import ThreeDotsAnimation from './ThreeDotsAnimation.vue';
  import { useAgentStore } from '../composables/useAgentStore';
  import { getMessageParts } from '../utils';

  const props = defineProps<{
    message: IMessage
    isLastMessageInChat: boolean
  }>()

  const AutoScrollContainer = defineAsyncComponent(() => import('@incremark/vue').then(module => module.AutoScrollContainer))
  const agentStore = useAgentStore();
  const ToolOrReasoningParts = computed(() => {
    return props.message.parts.filter((part: IPart) => part.type === 'data-tool-call' || part.type === 'reasoning');
  });
  const isExpanded = ref(true);

  const isResponseInProgress = computed(() =>{
    return props.isLastMessageInChat && agentStore.isResponseInProgress; 
  });
  
  watch(isResponseInProgress, (newValue: boolean) => {
    console.log('isResponseInProgress changed:', newValue);
    if (!newValue) {
      console.log('Response is no longer in progress, collapsing reasoning section.');
      isExpanded.value = false;
    }
  });
  
  const showFakeThinkingMessage = computed(() => {
    if (props.message.parts.length === 0) return true;
    return false;
  })


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