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
  <div class="relative flex-1 min-h-0 overflow-hidden [container-type:size]" @click="recalculateScroll()">
    <CustomAutoScrollContainer
      v-if="showScrollContainer"
      class="relative h-full flex flex-col overflow-y-auto translate-x-[-50%] left-1/2"
      ref="scrollContainer"
      :enabled="false"
      :threshold="THRESHOLD_TO_SHOW_BUTTON"
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
        paddingBottom: showBottomSpacer ? `max(0px, 100cqh - ${lastTurnHeight}px)` : undefined,
        transition: `
          max-width ${agentTransitions.TRANSITION_DURATION}ms ease-in-out,
          transform ${agentTransitions.TRANSITION_DURATION}ms ease-in-out
        `
      }"
    > 

      <div 
        v-for="(message, index) in props.messages" :key="index"
        class="flex flex-col w-full mt-2 pb-2"
        :class="message.role === 'user' ? 'self-end' : 'self-start'"
        ref="messagesRefs"
      >
        <MessageRenderer :message="message" :isLastMessageInChat="index === props.messages.length - 1"/>
      </div>
      <!-- absolute, so it doesn't resize the scroll content when the container resizes (see the spacer comment) -->
      <div
        v-if="props.messages.length === 0"
        class="absolute inset-0 flex flex-col items-center justify-center px-7 pb-10 text-center"
      >
        <div class="flex items-center justify-center w-11 h-11 rounded-xl bg-lightPrimary/10 text-lightPrimary dark:bg-darkPrimary/15 dark:text-darkPrimary">
          <IconSparkles class="w-6 h-6" />
        </div>
        <h2 class="mt-4 text-xl font-semibold text-lightNavbarText dark:text-darkNavbarText">
          {{ $t('How can I help?') }}
        </h2>
        <p class="mt-1.5 max-w-xs text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          {{ $t('Ask about your data, build charts or update records.') }}
        </p>
        <div v-if="suggestions.length" class="mt-7 w-full max-w-sm flex flex-col gap-2 text-left">
          <p class="pl-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">{{ $t('Try asking') }}</p>
          <button
            v-for="suggestion in suggestions"
            :key="suggestion"
            type="button"
            class="group flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl border text-sm text-left transition-colors duration-150
              border-gray-200 text-lightNavbarText hover:border-gray-300 hover:bg-gray-50
              dark:border-gray-700 dark:text-darkNavbarText dark:hover:border-gray-600 dark:hover:bg-gray-800"
            @click="applySuggestion(suggestion)"
          >
            <span class="flex-1 min-w-0">{{ suggestion }}</span>
            <IconArrowRight class="w-4 h-4 shrink-0 text-gray-400 transition-transform duration-150 group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    </CustomAutoScrollContainer>
    <Transition
      enter-active-class="transition-all duration-250 ease-out"
      enter-from-class="opacity-0 translate-y-3 scale-90"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 translate-y-3 scale-90"
    >
      <button 
        v-if="showScrollToBottomButton" 
        @click="scrollContainer.scrollToBottom();"
        class="absolute z-10 bottom-8 left-1/2 -translate-x-1/2 
          bg-lightPrimary/20 dark:bg-darkPrimary/10
          border border-lightPrimary dark:border-darkPrimary 
          text-lightPrimary dark:text-darkPrimary 
          backdrop-blur-sm rounded-full
          w-10 h-10 flex items-center justify-center gap-0.5"
        :class="{ 'w-12 h-8': showAnimationInScrollToBottomButton }"
      >
        <IconArrowDownOutline 
          v-if="!showAnimationInScrollToBottomButton"
          class="p-2 w-10 h-10 transition-opacity duration-100 ease-in " 
          :disabled="!showScrollToBottomButton"
        />
        <ThreeDotsAnimation 
          v-else
          :disabled="!showScrollToBottomButton"
        />
      </button>
    </Transition>
  </div>
</template>


<script setup lang="ts">
import type { IMessage } from '../types';
import { useTemplateRef, ref, onMounted, onUnmounted, watch, nextTick, defineAsyncComponent, computed } from 'vue';
import { IconArrowDownOutline } from '@iconify-prerendered/vue-flowbite';
import { IconArrowRight, IconSparkles } from '@iconify-prerendered/vue-heroicons';
import SessionsHistory from '../SessionsHistory.vue';
import { useAgentStore } from '../composables/useAgentStore';
import { useAgentTransitions } from '../composables/useAgentTransitions';
import MessageRenderer from './MessageRenderer.vue';
import ThreeDotsAnimation from './ThreeDotsAnimation.vue';

const CustomAutoScrollContainer = defineAsyncComponent(() => import('../CustomAutoScrollContainer.vue'));

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
const messagesRefs = ref<Array<HTMLElement | null>>([]);
/*
* Whenever user sends a message, it adds a bottom spacer, that takes the remaining height
* without last user and last agent message. 
* 
* On send message, happens the following logic: 
* 1) showBottomSpacer is set to true
* 2) updateSpacerHeight is called, which measures the last turn (last user + last agent message)
* 3) Spacer moves text up
*
* The spacer is the scroll element's padding-bottom, resolved in CSS (100cqh minus the last turn), so
* it follows the container height in the same layout pass, e.g. when the prompt textarea grows.
* It is padding rather than a child element on purpose: custom-vue-scrollbar measures the viewport and
* the content with separate debounced observers, and when both resize together it briefly computes a
* wrong scroll range and flashes the scrollbar thumb. Padding keeps the content size unchanged.
*/
const showBottomSpacer = ref(false);
const lastTurnHeight = ref(0);
const MASK_HEIGHT = 20;
const EMPTY_MESSAGE_HEIGHT = 18;
const THRESHOLD_TO_SHOW_BUTTON = 10;
const MAX_SUGGESTIONS = 3;
let messageResizeObserver: ResizeObserver | null = null;
let observedLastUserMessageElement: HTMLElement | null = null;
let observedLastAgentMessageElement: HTMLElement | null = null;
let updateSpacerFrameId: number | null = null;
let pendingSpacerUpdate: Promise<void> | null = null;
let spacerUpdateQueued = false;

const showAnimationInScrollToBottomButton = computed(() => {
  return agentStore.isResponseInProgress && showScrollToBottomButton.value;
});

// The configured placeholder examples double as clickable starters on an empty chat.
const suggestions = computed(() => agentStore.placeholderMessages.slice(0, MAX_SUGGESTIONS));

function applySuggestion(suggestion: string) {
  agentStore.userMessageInput = suggestion;
  agentStore.focusTextInput();
}

onMounted(async () => {
  messageResizeObserver = new ResizeObserver(() => {
    scheduleSpacerHeightUpdate();
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
  if (updateSpacerFrameId !== null) {
    cancelAnimationFrame(updateSpacerFrameId);
    updateSpacerFrameId = null;
  }
  agentStore.stopPlaceholderAnimation();
});

watch(() => agentStore.activeSessionId, () => {
  resetSpacer();
});

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

function resetSpacer() {
  showBottomSpacer.value = false;
  lastTurnHeight.value = 0;
}

function getLastMessageElement(role: 'user' | 'assistant') {
  const lastMessageIndex = props.messages.findLastIndex((message: IMessage) => message.role === role);
  return messagesRefs.value[lastMessageIndex] ?? null;
}

function getHeightOfLastUserMessage() {
  return getLastMessageElement('user')?.clientHeight ?? 0;
}

function getHeightOfLastAgentMessage() {
  const lastUserIndex = props.messages.findLastIndex((message: IMessage) => message.role === 'user');
  const lastAgentIndex = props.messages.findLastIndex((message: IMessage) => message.role === 'assistant');
  // Only reserve spacer space for the current turn's answer, i.e. an assistant message that comes
  // after the last user message. Right after a send the "Thinking" placeholder isn't pushed yet, so
  // findLastIndex would return the previous turn's answer (which sits above the just-sent user
  // message). Subtracting its height shrinks the spacer, making scrollToBottom stop short — and once
  // the real placeholder arrives the spacer grows and the true bottom drops below where we scrolled.
  if (lastAgentIndex <= lastUserIndex) {
    return 0;
  }
  return messagesRefs.value[lastAgentIndex]?.clientHeight ?? 0;
}

function getScrollClientHeight() {
  return scrollContainer.value?.container.scrollEl.clientHeight ?? scrollContainer.value?.scrollParams.clientHeight ?? 0;
}

async function updateSpacerHeight() {
  if (!showBottomSpacer.value) {
    return;
  }

  lastTurnHeight.value = getHeightOfLastUserMessage() + MASK_HEIGHT + getHeightOfLastAgentMessage();
}

function scheduleSpacerHeightUpdate() {
  spacerUpdateQueued = true;

  if (updateSpacerFrameId !== null) {
    return;
  }

  updateSpacerFrameId = requestAnimationFrame(() => {
    updateSpacerFrameId = null;

    if (pendingSpacerUpdate) {
      return;
    }

    spacerUpdateQueued = false;
    pendingSpacerUpdate = updateSpacerHeight().finally(() => {
      pendingSpacerUpdate = null;

      // Auto-scroll to bottom if response generation is in progress
      // if (agentStore.isResponseInProgress) {
      //   nextTick(() => {
      //     scrollContainer.value?.scrollToBottom();
      //   });
      // }

      if (spacerUpdateQueued) {
        scheduleSpacerHeightUpdate();
      }
    });
  });
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
    await nextTick(); // render the just-sent user message + spacer before measuring their heights
    await updateSpacerHeight();
    await nextTick(); // apply the computed spacer height before scrolling
    scrollContainer.value?.scrollToBottom();
  }
}

function recalculateScroll() {
  if (scrollContainer.value) {
    const spacerHeight = parseFloat(getComputedStyle(scrollContainer.value.container.scrollEl).paddingBottom);
    scrollContainer.value.handleScroll(false, spacerHeight + THRESHOLD_TO_SHOW_BUTTON);
    const isScrolledUp = scrollContainer.value.isUserScrolledUp();
    showScrollToBottomButton.value = !!isScrolledUp;
  }
}

</script>
