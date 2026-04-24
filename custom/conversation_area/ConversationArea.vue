<template>
  <button @click="handleSendMessage">Send Message</button>
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
      <div class="w-full" :style="{ height: spacerHeight + 'px' }"></div>
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

defineExpose({
  handleSendMessage
});

const scrollContainer = useTemplateRef('scrollContainer');
const showScrollToBottomButton = ref(false);
const innerScrollContainerRef = ref(null);
const agentStore = useAgentStore();
const agentTransitions = useAgentTransitions();
const showScrollContainer = ref(true);
const chatContainerRef = ref(null);

const messagesRefs = ref<Array<HTMLElement | null>>([]);
const showBottomSpacer = ref(false);
const spacerHeight = ref(0);
const scrollHeightBeforeChatResponse = ref(0);
const lastUserMessageHeight = ref(0);

function resetSpacer() {
  showBottomSpacer.value = false;
  spacerHeight.value = 0;
  scrollHeightBeforeChatResponse.value = 0;
  lastUserMessageHeight.value = 0;
}

watch(() => agentStore.activeSessionId, (newValue) => {
  console.log('Active session changed, resetting spacer and scroll parameters.');
  resetSpacer();
});

function getHeightOfLastUserMessage() {
  const lastUserMessageIndex = props.messages.findLastIndex((msg: IMessage) => msg.role === 'user');
  const lastUserMessageElement = messagesRefs.value[lastUserMessageIndex];
  console.log('Last user message element:', lastUserMessageElement);
  console.log('Last user message height:', lastUserMessageElement ? lastUserMessageElement.clientHeight : 'N/A');
  if (lastUserMessageElement) {
    return  lastUserMessageElement.clientHeight;
  }
}

async function handleSendMessage() {
  lastUserMessageHeight.value = getHeightOfLastUserMessage();
  const clientHeight = scrollContainer.value ? scrollContainer.value.scrollParams.clientHeight : 0;
  console.log('Client height:', clientHeight, 'Last user message height:', lastUserMessageHeight.value);
  if (clientHeight) {
    showBottomSpacer.value = true;
    spacerHeight.value = clientHeight - lastUserMessageHeight.value;
    await nextTick();
    scrollHeightBeforeChatResponse.value = scrollHeight.value;
    scrollContainer.value?.scrollToBottom();
  }
}

const scrollHeight = computed(() => {
  return scrollContainer.value ? scrollContainer.value.scrollParams.scrollHeight : 0;
});

const lastScrollHeight = ref(0);
let skipNextScrollAdjustment = false;
watch(scrollHeight, (newScrollHeight) => {
  if (skipNextScrollAdjustment) {
    skipNextScrollAdjustment = false;
    lastScrollHeight.value = newScrollHeight;
    return;
  }
  if (!agentStore.isResponseInProgress) {
    lastScrollHeight.value = newScrollHeight;
    return;
  }
  if (lastScrollHeight.value === 0) {
    lastScrollHeight.value = newScrollHeight;
    return;
  }
  const heightDifference = newScrollHeight - lastScrollHeight.value;
  spacerHeight.value = spacerHeight.value - heightDifference;
  lastScrollHeight.value = newScrollHeight;
  skipNextScrollAdjustment = true;
});


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



</script>