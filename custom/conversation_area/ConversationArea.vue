<template>
  <button @click="scrollContainer.scrollToBottom()">
    <IconArrowDownOutline 
      class="absolute z-10 bottom-32 left-1/2 bg-lightPrimary dark:bg-darkPrimary text-white p-2 w-10 h-10 rounded-full transition-opacity duration-100 ease-in" 
      :class="showScrollToBottomButton ? 'opacity-100' : 'opacity-0 pointer-events-none'"
      :disabled="!showScrollToBottomButton"
    />
  </button>
  
  <SessionsHistory 
    :class="agentStore.isSessionHistoryOpen ? 'translate-x-0' : '-translate-x-full'"
  />
  <div 
    v-if="agentStore.isSessionHistoryOpen"
    @click="agentStore.setSessionHistoryOpen(false)"
    class="absolute bg-black/10 backdrop-blur-md z-10 h-full w-full"
  >

  </div>
  <AutoScrollContainer
    :enabled="!showScrollToBottomButton" 
    class="relative flex flex-col overflow-y-auto translate-x-[-50%] left-1/2"
    ref="scrollContainer"
    :threshold="10"
    behavior="smooth"
    :style="{ 
      maxWidth: agentStore.isFullScreen ? agentStore.MAX_WIDTH+'rem' : '100%',
      transition: `
        max-width ${agentTransitions.TRANSITION_DURATION}ms ease-in-out,
        transform ${agentTransitions.TRANSITION_DURATION}ms ease-in-out
      `
    }"
  > 

    <div 
      v-for="(message, index) in props.messages" :key="message.id"
      class="flex flex-col w-full"
      :class="message.role === 'user' ? 'self-end' : 'self-start'"
    >
      <MessageRenderer :message="message" :isLastMessageInChat="index === props.messages.length - 1"/>
    </div>
    <div 
      v-if="props.messages.length === 0"
      class="flex-1 flex flex-col items-center justify-center text-gray-400 tracking-widest text-xl font-medium"
    >
      <p>{{ $t('Start the conversation') }}</p>
      <p class="tracking-normal text-base text">{{ $t('Give any input to begin') }}</p>
    </div>
  </AutoScrollContainer>
</template>


<script setup lang="ts">
import Message from './Message.vue';
import type { IMessage, IPart } from '../types';
import { useTemplateRef, ref, defineAsyncComponent, onMounted, onUnmounted, watch, computed } from 'vue';
import { IconArrowDownOutline } from '@iconify-prerendered/vue-flowbite';
import SessionsHistory from '../SessionsHistory.vue';
import { useAgentStore } from '../composables/useAgentStore';
import ToolsGroup from './ToolsGroup.vue';
import { useAgentTransitions } from '../composables/useAgentTransitions';
import { getMessageParts } from '../utils';
import MessageRenderer from './MessageRenderer.vue';

const scrollContainer = useTemplateRef('scrollContainer');
const showScrollToBottomButton = ref(false);
const innerScrollContainerRef = ref(null);
const AutoScrollContainer = defineAsyncComponent(() => import('@incremark/vue').then(module => module.AutoScrollContainer))
const agentStore = useAgentStore();
const agentTransitions = useAgentTransitions();
const clicks = ref(0);

function recalculateScroll() {
  if (scrollContainer.value) {
    const isScrolledUp = scrollContainer.value.isUserScrolledUp();
    showScrollToBottomButton.value = !!isScrolledUp;
  }
}

onMounted(async () => {
  await import('@incremark/theme/styles.css')
  await agentStore.fetchPlaceholderMessages()
});

onUnmounted(() => {
  agentStore.stopPlaceholderAnimation();
});

watch(scrollContainer, () => {
  if (scrollContainer.value) {
    innerScrollContainerRef.value = scrollContainer.value.container;

    innerScrollContainerRef.value.addEventListener('scroll', () => {
      recalculateScroll();
    });
  }
})

watch(clicks, () => {
  recalculateScroll();
})



const props = defineProps<{
  messages: IMessage[]
}>();

</script>