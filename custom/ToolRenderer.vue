<template>
  <div v-if="props.data?.toolInfo" class="inline-flex m-2 max-w-[80%] flex-col gap-3 rounded-xl p-2 text-lightListTableHeadingText dark:text-darkListTableHeadingText">
    <div class="flex items-center gap-3">
      <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/70 dark:bg-blue-700/20">
        <Spinner v-if="isRunning" class="h-4 w-4" />
        <IconCheckOutline v-else class="h-4 w-4 text-lightPrimary dark:text-darkPrimary" />
      </div>

      <div class="min-w-0">
        <p class="text-xs text-gray-500 dark:text-gray-400 font-bold">
          {{ statusLabel }}
          <span v-if="props.data?.toolInfo?.durationMs" class="text-xs">({{ (props.data.toolInfo.durationMs / 1000).toFixed(2) }}s)</span>
        </p>
        <p class="break-all font-mono text-sm leading-5">
          {{ props.data?.toolInfo?.toolName }}
        </p>
      </div>
      <IconAngleDownOutline
        v-if="hasToolSections"
        :class="isInputOutputExpanded ? 'rotate-180' : 'rotate-0'"
        class="cursor-pointer transition-transform duration-200 hover:scale-105 hover:opacity-75"
        @click="isInputOutputExpanded = !isInputOutputExpanded"
      />
    </div>
    <transition name="expand">
      <div v-show="isInputOutputExpanded" class="max-h-72 space-y-3 overflow-y-auto pr-1">
        <section
          v-for="section in toolSections"
          :key="section.label"
          class="overflow-hidden rounded-xl border border-black/5 bg-white/70 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-900/50"
        >
          <header class="border-b border-black/5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500 dark:border-white/10 dark:text-gray-400">
            {{ section.label }}
          </header>
          <div class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 px-3 py-3 font-mono text-xs leading-5 text-gray-700 dark:text-gray-200">
            <template v-for="line in section.lines" :key="`${section.label}-${line.number}`">
              <span class="select-none text-[11px] text-gray-400 dark:text-gray-500">{{ line.number }}</span>
              <span class="whitespace-pre-wrap break-words">{{ line.content || ' ' }}</span>
            </template>
          </div>
        </section>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { type IPartData } from './types';
  import { Spinner } from '@/afcl';
  import { IconAngleDownOutline, IconCheckOutline } from '@iconify-prerendered/vue-flowbite';

  const isInputOutputExpanded = ref(false);

  interface IToolSection {
    label: string;
    lines: Array<{
      number: number;
      content: string;
    }>;
  }

  const props = defineProps<{
    data: {
      type: string;
      toolInfo: IPartData;
    }
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
  max-height: 288px;
}

</style>