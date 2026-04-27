<template>
  <SessionsHistory 
    :class="agentStore.isSessionHistoryOpen ? 'translate-x-0' : '-translate-x-full'"
  />
  <div 
    v-if="agentStore.isSessionHistoryOpen"
    @click="agentStore.setSessionHistoryOpen(false)"
    class="absolute bg-black/10 backdrop-blur-md z-10 h-full w-full"
  >
  </div>
  <div ref="chatContainerRef" class="relative flex-1 min-h-0 overflow-hidden" @click="recalculateScroll()">
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
      :style="{ 
        maxWidth: agentStore.isFullScreen ? agentStore.MAX_WIDTH+'rem' : '100%',
        transition: `
          max-width ${agentTransitions.TRANSITION_DURATION}ms ease-in-out,
          transform ${agentTransitions.TRANSITION_DURATION}ms ease-in-out
        `
      }"
    > 

      <div 
        v-for="(message, index) in props.messages" :key="index"
        class="flex flex-col w-full mt-2"
        :class="message.role === 'user' ? 'self-end' : 'self-start'"
        ref="messagesRefs"
      >
        <MessageRenderer :message="message" :isLastMessageInChat="index === props.messages.length - 1"/>
      </div>
      <div 
        v-if="props.messages.length === 0"
        class="flex-1 flex flex-col items-center justify-center text-gray-400 tracking-widest text-xl font-medium h-max"
        :style="{
          height: chatContainerRef ? chatContainerRef.clientHeight + 'px' : '100%',
        }"
      >
        <p>{{ $t('Start the conversation') }}</p>
        <p class="tracking-normal text-base text">{{ $t('Give any input to begin') }}</p>
      </div>
      <div v-if="showBottomSpacer" class="w-full" :style="{ height: spacerHeight + 'px' }"></div>
    </CustomAutoScrollContainer>
    <button @click="scrollContainer.scrollToBottom();">
      <IconArrowDownOutline 
        class="absolute z-10 bottom-8 left-1/2 bg-lightPrimary dark:bg-darkPrimary text-white p-2 w-10 h-10 rounded-full transition-opacity duration-100 ease-in" 
        :class="showScrollToBottomButton ? 'opacity-100' : 'opacity-0 pointer-events-none'"
        :disabled="!showScrollToBottomButton"
      />
    </button>
  </div>
</template>


<script setup lang="ts">
import type { IMessage } from '../types';
import { useTemplateRef, ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { IconArrowDownOutline } from '@iconify-prerendered/vue-flowbite';
import SessionsHistory from '../SessionsHistory.vue';
import { useAgentStore } from '../composables/useAgentStore';
import { useAgentTransitions } from '../composables/useAgentTransitions';
import MessageRenderer from './MessageRenderer.vue';
import CustomAutoScrollContainer from '../CustomAutoScrollContainer.vue';

const props = defineProps<{
  messages: IMessage[]
}>();

defineExpose({
  handleSendMessage
});

const scrollContainer = useTemplateRef('scrollContainer');
const showScrollToBottomButton = ref(false);
const innerScrollContainerRef = ref<HTMLElement | null>(null);
const agentStore = useAgentStore();
const agentTransitions = useAgentTransitions();
const showScrollContainer = ref(true);
const chatContainerRef = ref<HTMLElement | null>(null);

const messagesRefs = ref<Array<HTMLElement | null>>([]);
const showBottomSpacer = ref(false);
const spacerHeight = ref(0);
const MASK_HEIGHT = 20;
const EMPTY_MESSAGE_HEIGHT = 18;
let messageResizeObserver: ResizeObserver | null = null;
let observedLastUserMessageElement: HTMLElement | null = null;
let observedLastAgentMessageElement: HTMLElement | null = null;

function resetSpacer() {
  showBottomSpacer.value = false;
  spacerHeight.value = 0;
}

watch(() => agentStore.activeSessionId, () => {
  resetSpacer();
});

function getLastMessageElement(role: 'user' | 'assistant') {
  const lastMessageIndex = props.messages.findLastIndex((message: IMessage) => message.role === role);
  return messagesRefs.value[lastMessageIndex] ?? null;
}

function getHeightOfLastUserMessage() {
  return getLastMessageElement('user')?.clientHeight ?? 0;
}

function getHeightOfLastAgentMessage() {
  return getLastMessageElement('assistant')?.clientHeight ?? 0;
}

function getScrollClientHeight() {
  return scrollContainer.value?.container.scrollEl.clientHeight ?? scrollContainer.value?.scrollParams.clientHeight ?? 0;
}

async function waitForRealHeight(role: 'user' | 'assistant'): Promise<number> {
  const realHeightWeCanApprove = role === 'user' ? EMPTY_MESSAGE_HEIGHT : 0;
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const height = role === 'user' ? getHeightOfLastUserMessage() : getHeightOfLastAgentMessage();

      if (height > realHeightWeCanApprove) {
        clearInterval(interval);
        resolve(height);
      }
    }, 50);
  });
}

const useWaitingForHeight = ref(false);
async function updateSpacerHeight() {
  if (!showBottomSpacer.value) {
    return;
  }

  const clientHeight = getScrollClientHeight();

  if (!clientHeight) {
    return;
  }

  const lastUserMessageHeight = useWaitingForHeight.value ? await waitForRealHeight('user') : getHeightOfLastUserMessage();
  const lastAgentMessageHeight = useWaitingForHeight.value ? await waitForRealHeight('assistant') : getHeightOfLastAgentMessage();

  spacerHeight.value = Math.max(0, clientHeight - (lastUserMessageHeight + MASK_HEIGHT + lastAgentMessageHeight));
}

function stopObservingLastMessages() {
  if (!messageResizeObserver) {
    return;
  }

  if (observedLastUserMessageElement) {
    messageResizeObserver.unobserve(observedLastUserMessageElement);
    observedLastUserMessageElement = null;
  }

  if (observedLastAgentMessageElement) {
    messageResizeObserver.unobserve(observedLastAgentMessageElement);
    observedLastAgentMessageElement = null;
  }
}

function observeLastMessages() {
  if (!messageResizeObserver) {
    return;
  }

  stopObservingLastMessages();

  observedLastUserMessageElement = getLastMessageElement('user');
  observedLastAgentMessageElement = getLastMessageElement('assistant');

  if (observedLastUserMessageElement) {
    messageResizeObserver.observe(observedLastUserMessageElement);
  }

  if (observedLastAgentMessageElement) {
    messageResizeObserver.observe(observedLastAgentMessageElement);
  }
}

async function refreshSpacerTracking() {
  await nextTick();
  observeLastMessages();
  await updateSpacerHeight();
}

async function handleSendMessage() {
  const clientHeight = getScrollClientHeight();

  if (clientHeight) {
    showBottomSpacer.value = true;
    useWaitingForHeight.value = true;
    setTimeout(() => {
      useWaitingForHeight.value = false;
    }, 1000);
    await updateSpacerHeight();
    await nextTick();
    scrollContainer.value?.scrollToBottom();
  }
}

function recalculateScroll() {
  if (scrollContainer.value) {
    scrollContainer.value.handleScroll(false);
    const isScrolledUp = scrollContainer.value.isUserScrolledUp();
    showScrollToBottomButton.value = !!isScrolledUp;
  }
}

watch(() => agentStore.activeSessionId, async () => {
  showScrollContainer.value = false;
  await nextTick();
  showScrollContainer.value = true;
  await refreshSpacerTracking();
  recalculateScroll();
});

watch(() => props.messages.length, async () => {
  await refreshSpacerTracking();
});

onMounted(async () => {
  messageResizeObserver = new ResizeObserver(() => {
    updateSpacerHeight();
  });

  await import('@incremark/theme/styles.css')
  await agentStore.fetchPlaceholderMessages()
  await refreshSpacerTracking();
});

onUnmounted(() => {
  if (innerScrollContainerRef.value) {
    innerScrollContainerRef.value.removeEventListener('scroll', recalculateScroll);
  }

  stopObservingLastMessages();
  messageResizeObserver?.disconnect();
  agentStore.stopPlaceholderAnimation();
});

watch(scrollContainer, async () => {
  if (innerScrollContainerRef.value) {
    innerScrollContainerRef.value.removeEventListener('scroll', recalculateScroll);
  }

  if (scrollContainer.value) {
    innerScrollContainerRef.value = scrollContainer.value.container.scrollEl;

    innerScrollContainerRef.value.addEventListener('scroll', recalculateScroll);
    await refreshSpacerTracking();
  }
})



</script>