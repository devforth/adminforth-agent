<template>
  <li>
    <button
      type="button"
      class="flex items-center gap-2 w-full py-0.5 text-left text-[0.8125rem] leading-5 select-none"
      :class="hasToolSections ? 'cursor-pointer' : 'cursor-default'"
      @click="hasToolSections && (isInputOutputExpanded = !isInputOutputExpanded)"
    >
      <span class="flex items-center justify-center w-4 h-4 shrink-0 rounded-full" :class="statusClasses">
        <Spinner v-if="isRunning" class="w-3 h-3" />
        <IconXMark16Solid v-else-if="props.data.toolInfo.error" class="w-3 h-3" />
        <IconCheck16Solid v-else class="w-3 h-3" />
      </span>
      <span class="max-w-[55%] shrink-0 truncate font-mono text-xs text-gray-800 dark:text-gray-200">
        {{ props.data.toolInfo.toolName }}
      </span>
      <span class="flex-1 min-w-0 truncate text-gray-500 dark:text-gray-400" :title="props.data.toolInfo.toolInfo">
        {{ props.data.toolInfo.toolInfo }}
      </span>
      <span v-if="durationLabel" class="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">{{ durationLabel }}</span>
      <IconChevronDown
        v-if="hasToolSections"
        class="w-3.5 h-3.5 shrink-0 text-gray-400 transition-transform duration-200"
        :class="isInputOutputExpanded ? 'rotate-180' : 'rotate-0'"
      />
    </button>
    <transition name="expand">
      <div v-if="isInputOutputExpanded" class="max-h-72 mt-1.5 mb-1 ml-6 space-y-2 overflow-y-auto">
        <section
          v-for="section in toolSections"
          :key="section.label"
          class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/40"
        >
          <header class="border-b border-gray-200 px-2.5 py-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {{ section.label }}
          </header>
          <div class="select-all grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 px-2.5 py-2 font-mono text-xs leading-5 text-gray-700 dark:text-gray-200">
            <template v-for="line in section.lines" :key="`${section.label}-${line.number}`">
              <span class="text-[0.7rem] text-gray-400 dark:text-gray-500 select-none">{{ line.number }}</span>
              <span class="whitespace-pre-wrap break-words">{{ line.content || ' ' }}</span>
            </template>
          </div>
        </section>
      </div>
    </transition>
  </li>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { type IFormattedToolCallPart } from '../types';
  import { Spinner } from '@/afcl';
  import { IconCheck16Solid, IconChevronDown, IconXMark16Solid } from '@iconify-prerendered/vue-heroicons';

  const props = defineProps<{
    data: IFormattedToolCallPart
  }>();

  interface IToolSection {
    label: string;
    lines: Array<{
      number: number;
      content: string;
    }>;
  }

  const isInputOutputExpanded = ref(false);

  const isRunning = computed(() => props.data.toolInfo.phase === 'start');
  const durationLabel = computed(() => {
    const { durationMs } = props.data.toolInfo;
    return durationMs === undefined ? null : `${(durationMs / 1000).toFixed(1)}s`;
  });
  const statusClasses = computed(() => {
    if (isRunning.value) {
      return 'text-gray-500 dark:text-gray-400';
    }
    return props.data.toolInfo.error
      ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400'
      : 'bg-lightPrimary/10 text-lightPrimary dark:bg-darkPrimary/20 dark:text-darkPrimary';
  });
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

  const normalizeToolPayload = (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (typeof value === 'string') {
      return value.trim();
    }

    return JSON.stringify(value, null, 2);
  };

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
