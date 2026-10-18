<template>
  <template v-if="timelineParts.length > 0 || inProgress">
    <button
      type="button"
      class="z-20 self-start flex items-center gap-1 mx-4 mb-2 select-none text-[13px] font-medium transition-colors duration-150
        text-lightInputIconColor dark:text-darkInputIconColor"
      :class="timelineParts.length > 0 ? 'hover:text-lightInputText dark:hover:text-darkInputText' : 'cursor-default'"
      @click="isExpanded = !isExpanded"
    >
      <IconChevronRight
        v-if="timelineParts.length > 0"
        class="w-3.5 h-3.5 transition-transform duration-200"
        :class="isExpanded ? 'rotate-90' : 'rotate-0'"
      />
      <template v-if="inProgress">
        <span
          class="shine-text
            bg-[linear-gradient(-65deg,currentColor,theme(colors.lightInputPlaceholderText)_50%,currentColor)]
            dark:bg-[linear-gradient(-65deg,currentColor,theme(colors.darkInputText)_70%,currentColor)]"
        >
          {{ $t('Thinking') }}
        </span>
        <ThreeDotsAnimation />
      </template>
      <template v-else>
        <span>{{ thinkingSeconds ? $t('Thought for {seconds}s', { seconds: thinkingSeconds }) : $t('Thoughts') }}</span>
        <span v-if="toolCallsCount">
          · {{ toolCallsCount === 1 ? $t('1 tool') : $t('{count} tools', { count: toolCallsCount }) }}
        </span>
      </template>
    </button>
    <transition name="expand">
      <!-- the box is inset from the message edge, so its own scrollbar never sits on top of the conversation scrollbar -->
      <div
        v-if="timelineParts.length > 0"
        v-show="isExpanded"
        class="z-20 mx-4 mb-3 overflow-hidden rounded-lg border
          border-lightCardBorder bg-lightCardBackground dark:border-darkCardBorder dark:bg-darkCardBackground"
      >
        <CustomAutoScrollContainer
          ref="scrollContainerRef"
          class="max-h-48 sm:max-h-96 overflow-y-auto"
          :enabled="isResponseInProgress"
          behavior="smooth"
          :threshold="5"
          :scrollBarAutoHide="false"
        >
          <!-- wider right padding keeps the row chevrons clear of the box's scrollbar -->
          <ul class="flex flex-col gap-1 pl-2.5 pr-5 py-2">
            <template v-for="(part, index) in timelineParts" :key="index">
              <ReasoningRenderer v-if="part.type === 'reasoning'" :state="part.state" :text="part.text" />
              <ToolRenderer v-else-if="part.type === 'data-tool-call'" :data="formatToolCallPart(part)" />
              <li
                v-else-if="part.type === 'data-rendering'"
                class="flex items-center gap-2 py-0.5 text-[0.8125rem] text-lightTableText dark:text-darkTableText"
              >
                <span class="flex items-center justify-center w-4 h-4 shrink-0">
                  <span class="w-2 h-2 rounded-full bg-current animate-pulse" />
                </span>
                {{ part.data?.label ?? 'Rendering...' }}
                <ThreeDotsAnimation />
              </li>
            </template>
          </ul>
        </CustomAutoScrollContainer>
      </div>
    </transition>
  </template>
</template>



<script setup lang="ts">
  import type { IFormattedToolCallPart, IMessage, IPart } from '../types';
  import { ref, computed, watch, onUnmounted, onMounted, defineAsyncComponent } from 'vue';
  import { IconChevronRight } from '@iconify-prerendered/vue-lucide';
  import ReasoningRenderer from './ReasoningRenderer.vue';
  import ToolRenderer from './ToolRenderer.vue';
  import ThreeDotsAnimation from './ThreeDotsAnimation.vue';
  import { useAgentStore } from '../composables/useAgentStore';

  const CustomAutoScrollContainer = defineAsyncComponent(() => import('../CustomAutoScrollContainer.vue'));

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
  let isUserScrolled = false;
  // One step per reasoning block and per tool call (its 'start' part; the matching 'end'
  // part is merged in by formatToolCallPart), plus a rendering step while it is running.
  const timelineParts = computed(() => {
    return props.message.parts.filter((part: IPart) => {
      return part.type === 'reasoning'
        || (part.type === 'data-tool-call' && part.data?.phase === 'start')
        || isActiveRenderingPart(part);
    });
  });
  const toolCallsCount = computed(() => timelineParts.value.filter(part => part.type === 'data-tool-call').length);
  const thinkingSeconds = computed(() => (
    thinkingDuration.value > 0 ? Math.max(1, Math.round(thinkingDuration.value / 1000)) : 0
  ));
  const isResponseInProgress = computed(() =>{
    return props.isLastMessageInChat && agentStore.isResponseInProgress;
  });

  const showFakeThinkingMessage = computed(() => {
    if (props.message.parts.length === 0 && props.isLastMessageInChat) return true;
    return false;
  })

  const inProgress = computed(() => {
    return isResponseInProgress.value || showFakeThinkingMessage.value;
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
    scrollContainerRef.value?.container.scrollEl?.removeEventListener('wheel', toggleIsUserScrolled);
    scrollContainerRef.value?.container.scrollEl?.removeEventListener('touchmove', toggleIsUserScrolled);
  })

  watch(scrollContainerRef, async () => {
    if (innerScrollContainerRef.value) {
      innerScrollContainerRef.value.removeEventListener('scroll', handleScroll);
      innerScrollContainerRef.value.removeEventListener('wheel', toggleIsUserScrolled);
      innerScrollContainerRef.value.removeEventListener('touchmove', toggleIsUserScrolled);
    }

    if (scrollContainerRef.value) {
      innerScrollContainerRef.value = scrollContainerRef.value.container.scrollEl;
      innerScrollContainerRef.value.addEventListener('scroll', handleScroll);
      innerScrollContainerRef.value.addEventListener('wheel', toggleIsUserScrolled);
      innerScrollContainerRef.value.addEventListener('touchmove', toggleIsUserScrolled);

    }
  })

  watch(isResponseInProgress, (newValue: boolean) => {
    if (!newValue) {
      isExpanded.value = false;
      thinkingDuration.value = Date.now() - (thinkingStartTime.value ?? Date.now());
    }
  });

  function formatToolCallPart(part: IPart): IFormattedToolCallPart {
    const data = part.data!;
    const finishedPart = props.message.parts.find(candidate => {
      return candidate.type === 'data-tool-call'
        && candidate.data?.toolCallId === data.toolCallId
        && candidate.data?.phase === 'end';
    });

    return {
      type: 'data-tool-call',
      toolInfo: {
        toolCallId: data.toolCallId,
        toolName: data.toolName,
        phase: finishedPart ? 'end' : 'start',
        durationMs: finishedPart?.data?.durationMs,
        input: data.input,
        output: finishedPart?.data?.output,
        toolInfo: data.toolInfo,
        error: finishedPart?.data?.error,
      }
    };
  }

  function isActiveRenderingPart(part: IPart) {
    return part.type === 'data-rendering'
      && part.data?.phase === 'start'
      && !props.message.parts.some((candidate: IPart) => {
        return candidate.type === 'data-rendering' && candidate.data?.phase === 'end';
      });
  }

  function handleScroll() {
    if (isUserScrolled) {
      scrollContainerRef.value?.handleScroll();
    }
  }

  function toggleIsUserScrolled() {
    isUserScrolled = true;
    setTimeout(() => {
      isUserScrolled = false;
    }, 100);
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


.shine-text {

  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-position: -12rem;
}

.shine-text {
  animation: shineText 6s infinite linear;
}

@keyframes shineText {
  to {
    background-position: -100%;
  }
}

</style>
