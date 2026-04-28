<template>
  <div
    ref="toolRendererRef" 
    class="py-1 inline-flex justify-center m-2 
      flex-col gap-3 rounded-xl px-2 text-lightListTableHeadingText 
      dark:text-darkListTableHeadingText select-none
    "         
    :class="[
      isInputOutputExpanded ? 'items-start border-none' : '', 
      activateShrinkedStyle ? 'border items-center' : '',
      activateFullWidth ? 'w-full' : '',
    ]"
    :style="{
      maxWidth: activateShrinkedStyle ? toolRendererInitialWidth + 'px' : '',
    }"
  >
    <div 
      class="flex items-center gap-1 cursor-pointer"     
      @click="toggleInputOutput()"
    >
      <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-lightNavbar dark:bg-darkNavbar">
        <Spinner v-if="isRunning" class="h-4 w-4" />
        <IconCheckOutline v-else class="h-4 w-4 text-lightPrimary dark:text-darkPrimary" />
      </div>

      <div class="min-w-0">
        <!-- <p class="text-xs text-gray-500 dark:text-gray-400 font-bold">
          {{ statusLabel }}
          <span v-if="props.data?.toolInfo?.durationMs" class="text-xs">({{ (props.data.toolInfo.durationMs / 1000).toFixed(2) }}s)</span>
        </p> -->
        <p class="break-all font-mono text-sm leading-5 text-nowrap">
          {{ props.data?.toolInfo?.toolInfo ? props.data.toolInfo.toolInfo : props.data?.toolInfo?.toolName}}
        </p>
      </div>
      <IconAngleDownOutline
        v-if="hasToolSections"
        :class="isInputOutputExpanded ? 'rotate-180' : 'rotate-0'"
        @transitionend="finishTransition()"
        class="cursor-pointer transition-transform duration-300 hover:scale-105"
      />
    </div>
    <transition name="expand">
      <div v-if="isInputOutputExpanded" v-show="isInputOutputExpanded" class="max-h-72 space-y-3 overflow-y-auto pr-1 w-full">
        <section
          v-for="section in toolSections"
          :key="section.label"
          class="overflow-hidden rounded-xl border border-black/5 bg-white/70 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-900/50"
        >
          <header class="border-b border-black/5 px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gray-500 dark:border-white/10 dark:text-gray-400">
            {{ section.label }}
          </header>
          <div class="select-all grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 px-3 py-3 font-mono text-xs leading-5 text-gray-700 dark:text-gray-200">
            <template v-for="line in section.lines" :key="`${section.label}-${line.number}`">
              <span class=" text-[0.7rem] text-gray-400 dark:text-gray-500 select-none">{{ line.number }}</span>
              <span class="whitespace-pre-wrap break-words">{{ line.content || ' ' }}</span>
            </template>
          </div>
        </section>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch, onMounted } from 'vue';
  import { type IFormattedToolCallPart } from '../types';
  import { Spinner } from '@/afcl';
  import { IconAngleDownOutline, IconCheckOutline } from '@iconify-prerendered/vue-flowbite';

  const isInputOutputExpanded = ref(false);
  const activateShrinkedStyle = ref(true);
  const isAnimatingShrinkFinal = ref(false);
  const toolRendererInitialWidth = ref<number | null>(null);
  const toolRendererRef = ref<HTMLElement | null>(null);
  const activateFullWidth = ref(false);
  const blockClicksDuringAnimation = ref(false);
  const ANIMATION_DURATION = 300;

  onMounted(() => {
    if (toolRendererRef.value) {
      toolRendererInitialWidth.value = toolRendererRef.value.offsetWidth;
    }
  });  

  function finishTransition() {
    if (!isInputOutputExpanded.value) {
      activateFullWidth.value = false;
      activateShrinkedStyle.value = true;
    }
  }
  watch(isInputOutputExpanded, (newValue) => {
    if (newValue) {
      activateShrinkedStyle.value = false;
      activateFullWidth.value = true;
    }
  });

  function toggleInputOutput() {
    if (blockClicksDuringAnimation.value) return;
    isInputOutputExpanded.value = !isInputOutputExpanded.value;
    blockClicksDuringAnimation.value = true;
    setTimeout(() => {
      blockClicksDuringAnimation.value = false;
    }, ANIMATION_DURATION);
  }

  interface IToolSection {
    label: string;
    lines: Array<{
      number: number;
      content: string;
    }>;
  }

  const props = defineProps<{
    data: IFormattedToolCallPart
  }>();

  const isRunning = computed(() => props.data?.toolInfo?.phase === 'start');
  const statusLabel = computed(() => isRunning.value ? 'Running tool' : 'Tool finished');

  const normalizeToolPayload = (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (typeof value === 'string') {
      return value.trim();
    }

    return JSON.stringify(value, null, 2);
  };

  const toolSections = computed<IToolSection[]>(() => {
    const sections = [
      {
        label: 'Input',
        content: normalizeToolPayload(props.data.toolInfo.input),
      },
      {
        label: 'Output',
        content: normalizeToolPayload(props.data.toolInfo.output),
      },
    ];

    return sections
      .filter((section): section is { label: string; content: string } => Boolean(section.content))
      .map(section => ({
        label: section.label,
        lines: section.content.split('\n').map((content, index) => ({
          number: index + 1,
          content,
        })),
      }));
  });

  const hasToolSections = computed(() => toolSections.value.length > 0);
</script>


<style scoped>

.expand-enter-active,
.expand-leave-active {
  transition: all 300ms ease;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 288px;
}

</style>