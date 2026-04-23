<template>
  <template v-if="ToolOrReasoningParts.length > 0 || isResponseInProgress || showFakeThinkingMessage">
    <div 
      class="ml-2 px-4 flex items-center gap-1 cursor-pointer select-none hover:opacity-80 tracking-wide font-medium text-sm"
      @click="isExpanded = !isExpanded"
    >
      Thoughts
      <span v-if="thinkingDuration > 0">({{ (thinkingDuration/1000).toFixed(2) }} s)</span>
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
        class="mask-y"
      >
        <ol class="ml-8 relative border-l border-l-2 border-black border-default">
          <li class="mb-6 ms-2 z-50" v-for="(part, index) in ToolOrReasoningParts" :key="index"> 
            <ReasoningRenderer v-if="part.type === 'reasoning'" :state="part.state" :text="part.text" />
            <ToolsGroup v-else :toolGroup="groupToolCallParts(message, part)" />
          </li>      
        </ol>
      </AutoScrollContainer>
    </transition>
  </template>
</template>



<script setup lang="ts">
  import type { IFormattedToolCallPart, IMessage, IPart, IToolGroup } from '../types';
  import { ref, computed, watch, defineAsyncComponent, onMounted } from 'vue';
  import ReasoningRenderer from './ReasoningRenderer.vue';
  import { IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';
  import ThreeDotsAnimation from './ThreeDotsAnimation.vue';
  import { useAgentStore } from '../composables/useAgentStore';
  import { getMessageParts } from '../utils';
  import ToolsGroup from './ToolsGroup.vue';

  const props = defineProps<{
    message: IMessage
    isLastMessageInChat: boolean
  }>()

  const AutoScrollContainer = defineAsyncComponent(() => import('@incremark/vue').then(module => module.AutoScrollContainer))
  const agentStore = useAgentStore();
  const thinkingStartTime = ref<number | null>(null);
  const thinkingDuration = ref(0);

  onMounted(() => {
    thinkingStartTime.value = Date.now();
  })

  const ToolOrReasoningParts = computed(() => {
    return props.message.parts.filter((part: IPart) => part.type === 'data-tool-call' || part.type === 'reasoning');
  });
  const isExpanded = ref(true);

  const isResponseInProgress = computed(() =>{
    return props.isLastMessageInChat && agentStore.isResponseInProgress; 
  });
  
  watch(isResponseInProgress, (newValue: boolean) => {
    if (!newValue) {
      isExpanded.value = false;
      thinkingDuration.value = Date.now() - (thinkingStartTime.value ?? Date.now());
    }
  });
  
  const showFakeThinkingMessage = computed(() => {
    if (props.message.parts.length === 0) return true;
    return false;
  })

  const formatToolCallPart = (part: IPart, currentMessage: IMessage): IFormattedToolCallPart | null => {
    if (part.type !== 'data-tool-call' || part.data?.phase !== 'start') {
      return null;
    }

    const finishedPart = currentMessage.parts.find(candidate => {
      return candidate.type === 'data-tool-call'
        && candidate.data?.toolCallId === part.data?.toolCallId
        && candidate.data?.phase === 'end';
    });

    return {
      type: 'data-tool-call',
      toolInfo: {
        toolCallId: part.data.toolCallId,
        toolName: part.data.toolName,
        phase: finishedPart ? 'end' : 'start',
        durationMs: finishedPart?.data?.durationMs,
        input: part.data.input,
        output: finishedPart?.data?.output,
      }
    };
  };

  const getVisibleTimelineParts = (message: IMessage) => {
    return getMessageParts(message).filter(part => {
      return part.type === 'reasoning' || (part.type === 'data-tool-call' && part.data?.phase === 'start');
    });
  };

  const groupToolCallParts = (message: IMessage, currentPart: IPart): IToolGroup[] => {
    if (currentPart.type !== 'data-tool-call') {
      return [];
    }

    const visibleParts = getVisibleTimelineParts(message);
    const currentPartIndex = visibleParts.findIndex(part => part === currentPart);

    if (currentPartIndex === -1) {
      return [];
    }

    if (currentPartIndex > 0 && visibleParts[currentPartIndex - 1]?.type === 'data-tool-call') {
      return [];
    }

    const groupedParts: IToolGroup[] = [];

    for (let index = currentPartIndex; index < visibleParts.length; index += 1) {
      const part = visibleParts[index];

      if (part.type === 'reasoning') {
        break;
      }

      const formattedPart = formatToolCallPart(part, message);

      if (!formattedPart) {
        continue;
      }

      const lastGroup = groupedParts[groupedParts.length - 1];

      if (lastGroup?.title === formattedPart.toolInfo.toolName) {
        lastGroup.groupedTools.push(formattedPart);
        continue;
      }

      groupedParts.push({
        title: formattedPart.toolInfo.toolName,
        groupedTools: [formattedPart],
      });
    }

    return groupedParts;
  };


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

  .mask-y {
    mask-image: linear-gradient(
      to bottom,
      transparent,
      black 20px,
      black calc(100% - 20px),
      transparent
    );
  }
 
</style>