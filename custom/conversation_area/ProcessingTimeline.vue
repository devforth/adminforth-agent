<template>
  <template v-if="ToolOrReasoningParts.length > 0 || isResponseInProgress || showFakeThinkingMessage">
    <div 
      class="ml-2 px-4 flex items-center gap-1 cursor-pointer select-none hover:opacity-80 tracking-wide font-medium text-sm text-listTableHeadingText dark:text-darkListTableHeadingText"
      @click="isExpanded = !isExpanded"
    >
      {{ $t('Thoughts') }}
      <span v-if="thinkingDuration > 0">({{ (thinkingDuration/1000).toFixed(2) }} s)</span>
      <ThreeDotsAnimation v-if="isResponseInProgress || showFakeThinkingMessage" />
      <IconAngleDownOutline 
        :class="isExpanded ? 'rotate-180' : 'rotate-0'"
        class="transition-transform duration-200"
      />
    </div>
    <transition name="expand" class="sm:max-h-96 max-h-48 overflow-y-auto mb-4 pt-1">
      <CustomAutoScrollContainer
        ref="scrollContainerRef"
        :enabled="isResponseInProgress"
        behavior="smooth"
        v-if="ToolOrReasoningParts.length > 0" 
        v-show="isExpanded"
        :threshold="5"
        :wrapperStyle="{
          marginRight: '1rem',
        }"
        :scrollBarAutoHide="false"
      >
        <ol class="ml-8 my-2 relative border-l border-l-2 border-black border-default border-listTableHeadingText dark:border-darkListTableHeadingText">
          <template v-for="(part, index) in ToolOrReasoningParts" :key="index">
            <ReasoningRenderer v-if="part.type === 'reasoning'" :state="part.state" :text="part.text" />
            <ToolsGroup v-else-if="part.type==='data-tool-call'" :toolGroup="groupToolCallParts(message, part)" />
          </template>
        </ol>
      </CustomAutoScrollContainer>
    </transition>
  </template>
</template>



<script setup lang="ts">
  import type { IFormattedToolCallPart, IMessage, IPart, IToolGroup } from '../types';
  import { ref, computed, watch, onUnmounted, onMounted } from 'vue';
  import ReasoningRenderer from './ReasoningRenderer.vue';
  import { IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';
  import ThreeDotsAnimation from './ThreeDotsAnimation.vue';
  import { useAgentStore } from '../composables/useAgentStore';
  import { getMessageParts } from '../utils';
  import ToolsGroup from './ToolsGroup.vue';
  import CustomAutoScrollContainer from '../CustomAutoScrollContainer.vue';

  const props = defineProps<{
    message: IMessage
    isLastMessageInChat: boolean
  }>()

  const agentStore = useAgentStore();
  const thinkingStartTime = ref<number | null>(null);
  const thinkingDuration = ref(0);
  const scrollContainerRef = ref<InstanceType<typeof CustomAutoScrollContainer> | null>(null);
  const innerScrollContainerRef = ref<HTMLElement | null>(null);
  const isExpanded = ref(true);
  const ToolOrReasoningParts = computed(() => {
    return props.message.parts.filter((part: IPart) => part.type === 'data-tool-call' || part.type === 'reasoning');
  });
  const isResponseInProgress = computed(() =>{
    return props.isLastMessageInChat && agentStore.isResponseInProgress; 
  });
  
  const showFakeThinkingMessage = computed(() => {
    if (props.message.parts.length === 0 && props.isLastMessageInChat) return true;
    return false;
  })

  onMounted(() => {
    thinkingStartTime.value = Date.now();
    if (isResponseInProgress.value) {
      isExpanded.value = true;
    } else {
      isExpanded.value = false;
    }
  })

  onUnmounted(() => {
    scrollContainerRef.value?.container.scrollEl?.removeEventListener('scroll', handleScroll);
  })

  watch(scrollContainerRef, async () => {
    if (innerScrollContainerRef.value) {
      innerScrollContainerRef.value.removeEventListener('scroll', handleScroll);
    }

    if (scrollContainerRef.value) {
      innerScrollContainerRef.value = scrollContainerRef.value.container.scrollEl;
      innerScrollContainerRef.value.addEventListener('scroll', handleScroll);
    }
  })

  watch(isResponseInProgress, (newValue: boolean) => {
    if (!newValue) {
      isExpanded.value = false;
      thinkingDuration.value = Date.now() - (thinkingStartTime.value ?? Date.now());
    }
  });

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
        toolInfo: part.data.toolInfo,
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

  function handleScroll() {
    scrollContainerRef.value?.handleScroll();
  }
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

    @media (max-width: 640px) {
      max-height: 192px;
    }
  }
 
</style>