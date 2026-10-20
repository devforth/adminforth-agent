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
        <IconX v-else-if="props.data.toolInfo.error" class="w-3 h-3" />
        <IconCheck v-else class="w-3 h-3" />
      </span>
      <span class="max-w-[55%] shrink-0 truncate font-mono text-xs text-lightInputText dark:text-darkInputText">
        {{ props.data.toolInfo.toolName }}
      </span>
      <span class="flex-1 min-w-0 truncate text-lightInputIconColor dark:text-darkInputIconColor" :title="props.data.toolInfo.toolInfo">
        {{ props.data.toolInfo.toolInfo }}
      </span>
      <span v-if="durationLabel" class="shrink-0 tabular-nums text-lightInputIconColor dark:text-darkInputIconColor">{{ durationLabel }}</span>
      <IconChevronDown
        v-if="hasToolSections"
        class="w-3.5 h-3.5 shrink-0 text-lightInputIconColor transition-transform duration-200 dark:text-darkInputIconColor"
        :class="isInputOutputExpanded ? 'rotate-180' : 'rotate-0'"
      />
    </button>
    <transition name="expand">
      <!-- no height cap: the grid row animates between 0fr and 1fr, so the output opens to its full height -->
      <div v-if="isInputOutputExpanded" class="grid">
        <div class="min-h-0 overflow-hidden">
          <div class="pt-1.5 pb-1 pl-6 space-y-2">
            <section
              v-for="section in toolSections"
              :key="section.label"
              class="overflow-hidden rounded-default border border-lightCardBorder bg-lightCardBackground dark:border-darkCardBorder dark:bg-darkCardBackground"
            >
              <header class="border-b border-lightCardBorder px-2.5 py-1.5 text-xs font-medium text-lightInputIconColor dark:border-darkCardBorder dark:text-darkInputIconColor">
                {{ section.label }}
              </header>
              <div class="select-all grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 px-2.5 py-2 font-mono text-xs leading-5 text-lightTableText dark:text-darkTableText">
                <template v-for="line in section.lines" :key="`${section.label}-${line.number}`">
                  <span class="text-[0.7rem] text-lightInputPlaceholderText dark:text-darkInputPlaceholderText select-none">{{ line.number }}</span>
                  <span class="whitespace-pre-wrap break-words">{{ line.content || ' ' }}</span>
                </template>
              </div>
            </section>
          </div>
        </div>
      </div>
    </transition>
  </li>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { type IFormattedToolCallPart } from '../types';
  import { Spinner } from '@/afcl';
  import { IconCheck, IconChevronDown, IconX } from '@iconify-prerendered/vue-lucide';

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
      return 'text-lightInputIconColor dark:text-darkInputIconColor';
    }
    return props.data.toolInfo.error
      ? 'bg-lightDangerSoft text-lightDanger dark:bg-darkDangerSoft dark:text-darkDanger'
      : 'bg-lightSuccessSoft text-lightSuccess dark:bg-darkSuccessSoft dark:text-darkSuccess';
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
  transition: grid-template-rows 300ms ease, opacity 300ms ease;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  grid-template-rows: 0fr;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  grid-template-rows: 1fr;
}

</style>
