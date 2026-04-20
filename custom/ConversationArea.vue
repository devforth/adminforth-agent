<template>
  <button @click="scrollContainer.scrollToBottom()">
    <IconArrowDownOutline 
      class="absolute bottom-32 right-4 bg-lightPrimary dark:bg-darkPrimary text-white p-2 w-10 h-10 rounded-full transition-opacity duration-100 ease-in" 
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
    class="flex flex-col overflow-y-auto border-t border-gray-200 dark:border-gray-700"
    ref="scrollContainer"
    :threshold="10"
    behavior="smooth"
  > 

    <div 
      v-for="message in props.messages" :key="message.id"
      class="flex flex-col w-full"
      :class="message.role === 'user' ? 'self-end' : 'self-start'"
    >
      <ToolsGroup :toolGroup="groupToolCallParts(message)" />
      <template 
        v-for="part in getParts(message)"
        :key="part.type"
      >
        <Message
          v-if="part.type !== 'data-tool-call'"
          :message="part.text"
          :role="message.role"
          :type="part.type"
          :state="part.state"
          :data="part.data"
          @toggle-thoughts="() => clicks++"
        >
        </Message>
      </template>
    </div>
    <!-- Show a placeholder message if the last message is not of type 'text' or 'reasoning' -->
    <Message
      v-if="props.messages.length > 0 && showFakeThinkingMessage"
      :message="''"
      :role="props.messages[props.messages.length - 1].role"
      type="reasoning"
      state="streaming"
    />
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
import type { IMessage, IPart } from './types';
import { useTemplateRef, ref, defineAsyncComponent, onMounted, watch, computed } from 'vue';
import { IconArrowDownOutline } from '@iconify-prerendered/vue-flowbite';
import SessionsHistory from './SessionsHistory.vue';
import { useAgentStore } from './useAgentStore';
import ToolRenderer from './ToolRenderer.vue';
import ToolsGroup from './ToolsGroup.vue';

const scrollContainer = useTemplateRef('scrollContainer');
const showScrollToBottomButton = ref(false);
const innerScrollContainerRef = ref(null);
const AutoScrollContainer = defineAsyncComponent(() => import('@incremark/vue').then(module => module.AutoScrollContainer))
const agentStore = useAgentStore();
const clicks = ref(0);

function recalculateScroll() {
  if (scrollContainer.value) {
    const isScrolledUp = scrollContainer.value.isUserScrolledUp();
    showScrollToBottomButton.value = !!isScrolledUp;
  }
}

onMounted(async () => {
  await import('@incremark/theme/styles.css')
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

const showFakeThinkingMessage = computed(() => {
  const lastMessage = props.messages[props.messages.length - 1];
  if (!lastMessage) return false;
  const lastPart = getParts(lastMessage)[getParts(lastMessage).length - 1];
  return lastPart?.type !== 'text' && lastPart?.type !== 'reasoning';
})

const getParts = (message: IMessage) => {
  return message.parts?.length
    ? message.parts
    : [{ text: '', type: 'reasoning', state: 'streaming' }];
};

const formatToolCallTextPart = ((part: IPart, currentMessage: IMessage) => {
  if (part.type === 'data-tool-call') {
    if (part.data?.phase === 'start') {
      const finishedPart = currentMessage.parts?.find(p => p.type === 'data-tool-call' && p.data?.toolCallId === part.data?.toolCallId && p.data?.phase === 'end');
      return {
        type: 'text',
        toolInfo: {
          toolCallId: part.data!.toolCallId,
          toolName: part.data!.toolName,
          phase: finishedPart ? 'end' : 'start',
          durationMs: finishedPart ? finishedPart.data?.durationMs : undefined,
          input: part.data!.input,
          output: finishedPart ? finishedPart.data!.output : undefined,
        }          
      }
    }
  }
  return null;  
});

const groupToolCallParts = (message: IMessage) => {
  const groupedParts = [];
  let currentToolName = null;
  const parts = getParts(message);
  if (!parts) return [];
  const formatedToolParts = parts.map(part => {
    return formatToolCallTextPart(part as IPart, message)
  });
  for( const[index, part] of formatedToolParts.entries()){
    if(!part?.toolInfo) {
      continue;
    }
    if (part.toolInfo.toolName === currentToolName) {
      groupedParts[groupedParts.length - 1].groupedTools.push(part);
      continue;
    }
    currentToolName = part.toolInfo.toolName;
    groupedParts.push({
      title: currentToolName,
      groupedTools: [part]
    });
  }  
  return groupedParts;
}

const props = defineProps<{
  messages: IMessage[]
}>();

</script>