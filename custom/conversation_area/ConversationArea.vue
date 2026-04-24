<template>
  <SessionsHistory 
    :class="agentStore.isSessionHistoryOpen ? 'translate-x-0' : '-translate-x-full'"
    @recalculateScroll="recalculateScroll"
  />
  <div 
    v-if="agentStore.isSessionHistoryOpen"
    @click="agentStore.setSessionHistoryOpen(false)"
    class="absolute bg-black/10 backdrop-blur-md z-10 h-full w-full"
  >
  </div>
  <div class="relative flex-1 min-h-0 overflow-hidden" @click="recalculateScroll()">
    <button @click="scrollContainer.scrollToBottom();">
      <IconArrowDownOutline 
        class="absolute z-10 bottom-8 left-1/2 bg-lightPrimary dark:bg-darkPrimary text-white p-2 w-10 h-10 rounded-full transition-opacity duration-100 ease-in" 
        :class="showScrollToBottomButton ? 'opacity-100' : 'opacity-0 pointer-events-none'"
        :disabled="!showScrollToBottomButton"
      />
    </button>
    <CustomAutoScrollContainer
      v-if="showScrollContainer"
      :enabled="!showScrollToBottomButton" 
      class="relative h-full flex flex-col overflow-y-auto translate-x-[-50%] left-1/2"
      ref="scrollContainer"
      :threshold="10"
      behavior="smooth"
      :wrapperStyle = "{ 
        height: '100%',
        maxHeight: '100%',
        maxWidth: agentStore.isFullScreen ? agentStore.MAX_WIDTH+'rem' : '100%',
        width: '100%',
        marginLeft: 'auto',
        marginRight: 'auto',
      }"
      :contentStyle="{
        height: '100%',
        maxHeight: '100%',
      }"
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
        class="flex-1 flex flex-col items-center justify-center text-gray-400 tracking-widest text-xl font-medium h-full"
      >
        <p>{{ $t('Start the conversation') }}</p>
        <p class="tracking-normal text-base text">{{ $t('Give any input to begin') }}</p>
      </div>
    </CustomAutoScrollContainer>
  </div>
</template>


<script setup lang="ts">
import type { IMessage, IPart } from '../types';
import { useTemplateRef, ref, defineAsyncComponent, onMounted, onUnmounted, watch, computed, nextTick } from 'vue';
import { IconArrowDownOutline } from '@iconify-prerendered/vue-flowbite';
import SessionsHistory from '../SessionsHistory.vue';
import { useAgentStore } from '../composables/useAgentStore';
import { useAgentTransitions } from '../composables/useAgentTransitions';
import MessageRenderer from './MessageRenderer.vue';
import CustomAutoScrollContainer from '../CustomAutoScrollContainer.vue';

const props = defineProps<{
  messages: IMessage[]
}>();

const scrollContainer = useTemplateRef('scrollContainer');
const showScrollToBottomButton = ref(false);
const innerScrollContainerRef = ref(null);
const agentStore = useAgentStore();
const agentTransitions = useAgentTransitions();
const clicks = ref(0);
const showScrollContainer = ref(true);

function recalculateScroll() {
  if (scrollContainer.value) {
    scrollContainer.value.handleScroll();
    const isScrolledUp = scrollContainer.value.isUserScrolledUp();
    showScrollToBottomButton.value = !!isScrolledUp;
  }
}

watch(() => agentStore.activeSessionId, async () => {
  showScrollContainer.value = false;
  await nextTick();
  showScrollContainer.value = true;
  await nextTick();
  recalculateScroll();
});

onMounted(async () => {
  await import('@incremark/theme/styles.css')
  await agentStore.fetchPlaceholderMessages()
});

onUnmounted(() => {
  agentStore.stopPlaceholderAnimation();
});

watch(scrollContainer, () => {
  if (scrollContainer.value) {
    innerScrollContainerRef.value = scrollContainer.value.container.scrollEl;

    innerScrollContainerRef.value.addEventListener('scroll', () => {
      recalculateScroll();
    });
  }
})

watch(clicks, () => {
  recalculateScroll();
})


</script>