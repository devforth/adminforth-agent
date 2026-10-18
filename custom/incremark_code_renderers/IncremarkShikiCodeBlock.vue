<template>
  <div
    class="incremark-shiki-code"
    :data-stream-state="props.blockStatus"
  >
    <div class="incremark-shiki-toolbar">
      <span class="incremark-shiki-language">{{ languageLabel }}</span>
      <button
        type="button"
        class="incremark-shiki-copy"
        :class="copied ? 'is-copied' : ''"
        :disabled="!sourceCode"
        @click="copyCode"
      >
        {{ copied ? $t('Copied') : $t('Copy') }}
      </button>
    </div>

    <div class="incremark-shiki-body">
      <div
        v-if="shouldRenderVega && !renderedHtml"
        ref="vegaContainer"
        class="incremark-vega"
      />

      <div
        v-else-if="renderedHtml"
        class="incremark-shiki-html"
        v-html="renderedHtml"
      />

      <pre v-else class="incremark-shiki-fallback"><code>{{ sourceCode }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Code } from 'mdast';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import embed from 'vega-embed';

import type { IncremarkCodeTheme } from './incremarkCodeHighlight';
import { vegaLiteConfig } from './vegaTheme';

const props = withDefaults(defineProps<{
  node: Code;
  lightTheme?: string;
  darkTheme?: string;
  theme?: string;
  fallbackTheme?: string;
  disableHighlight?: boolean;
  blockStatus?: 'pending' | 'stable' | 'completed';
}>(), {
  lightTheme: 'github-light',
  darkTheme: 'github-dark',
  fallbackTheme: 'github-dark',
  disableHighlight: false,
  blockStatus: 'completed',
});

const renderedHtml = ref('');
const copied = ref(false);
const prefersDarkMode = ref(isDarkDocument());
const vegaContainer = ref<HTMLDivElement | null>(null);

let copyResetTimeout: number | null = null;
let renderRequestId = 0;
let scheduledFrameId: number | null = null;
let themeObserver: MutationObserver | null = null;
let vegaResult: { finalize: () => void } | null = null;
let highlightModulePromise: Promise<typeof import('./incremarkCodeHighlight')> | null = null;

const sourceCode = computed(() => props.node.value ?? '');
const language = computed(() => props.node.lang?.trim().toLowerCase() || 'text');
const languageLabel = computed(() => language.value === 'vega-lite' ? '' : props.node.lang?.trim() || 'text');
const shouldRenderVega = computed(() => language.value === 'vega-lite');
const codeTheme = computed<IncremarkCodeTheme>(() => {
  const requestedTheme = props.theme ?? (prefersDarkMode.value ? props.darkTheme : props.lightTheme);

  if (requestedTheme === 'github-light') {
    return 'light';
  }

  if (requestedTheme === 'github-dark') {
    return 'dark';
  }

  return props.fallbackTheme === 'github-light' ? 'light' : 'dark';
});

watch(
  [sourceCode, language, codeTheme, () => props.disableHighlight, () => props.blockStatus],
  () => {
    scheduleHighlight();
  },
  { immediate: true }
);

onMounted(() => {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
    scheduleHighlight();
    return;
  }

  themeObserver = new MutationObserver(() => {
    prefersDarkMode.value = isDarkDocument();
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  scheduleHighlight();
});

onBeforeUnmount(() => {
  renderRequestId += 1;
  clearVega();

  if (copyResetTimeout !== null) {
    window.clearTimeout(copyResetTimeout);
  }

  if (scheduledFrameId !== null) {
    window.cancelAnimationFrame(scheduledFrameId);
  }

  themeObserver?.disconnect();
});

async function copyCode() {
  if (!sourceCode.value || typeof navigator === 'undefined' || !navigator.clipboard) {
    return;
  }

  try {
    await navigator.clipboard.writeText(sourceCode.value);
    copied.value = true;

    if (copyResetTimeout !== null) {
      window.clearTimeout(copyResetTimeout);
    }

    copyResetTimeout = window.setTimeout(() => {
      copied.value = false;
      copyResetTimeout = null;
    }, 1500);
  } catch (error) {
    console.error('Failed to copy code block', error);
  }
}

function scheduleHighlight() {
  if (typeof window === 'undefined') {
    void renderHighlight();
    return;
  }

  if (scheduledFrameId !== null) {
    window.cancelAnimationFrame(scheduledFrameId);
  }

  scheduledFrameId = window.requestAnimationFrame(() => {
    scheduledFrameId = null;
    void renderHighlight();
  });
}

function loadHighlightModule() {
  if (!highlightModulePromise) {
    highlightModulePromise = import('./incremarkCodeHighlight');
  }

  return highlightModulePromise;
}

async function renderHighlight() {
  const requestId = ++renderRequestId;

  if (shouldRenderVega.value) {
    renderedHtml.value = '';

    if (!sourceCode.value) {
      return;
    }

    await nextTick();

    if (requestId !== renderRequestId || !shouldRenderVega.value || !vegaContainer.value) {
      return;
    }

    try {
      clearVega();
      const spec = JSON.parse(sourceCode.value);

      if (spec.width == null) {
        spec.width = 'container';
      }

      if (spec.autosize == null) {
        spec.autosize = { type: 'fit-x', contains: 'padding' };
      }

      const result = await embed(vegaContainer.value, spec, {
        actions: false,
        renderer: 'svg',
        // read on every render, a theme switch re-renders the chart with the tokens of the new theme
        config: vegaLiteConfig(vegaContainer.value),
        tooltip: { theme: 'af' },
      });

      if (requestId !== renderRequestId) {
        result.finalize();
        return;
      }

      vegaResult = result;
      return;
    } catch (error) {
      clearVega();
      console.error('Failed to render Vega-Lite block', error);
    }
  } else {
    clearVega();
  }

  if (!sourceCode.value || props.disableHighlight) {
    renderedHtml.value = '';
    return;
  }

  try {
    const { highlightCodeSnippetHtml } = await loadHighlightModule();
    const html = await highlightCodeSnippetHtml(sourceCode.value, language.value, codeTheme.value);

    if (requestId === renderRequestId) {
      renderedHtml.value = html;
    }
  } catch (error) {
    if (requestId === renderRequestId) {
      renderedHtml.value = '';
    }

    console.error('Failed to highlight streamed code block', error);
  }
}

function isDarkDocument(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

function clearVega() {
  vegaResult?.finalize();
  vegaResult = null;

  if (vegaContainer.value) {
    vegaContainer.value.innerHTML = '';
  }
}
</script>

<style scoped>
.incremark-shiki-code {
  @apply border border-lightCardBorder bg-lightCardBackground dark:border-darkCardBorder dark:bg-darkCardBackground;
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
  margin: 0 0 8px;
}

.incremark-shiki-toolbar {
  @apply border-b border-lightCardBorder bg-lightCardBackgroundHover dark:border-darkCardBorder dark:bg-darkCardBackgroundHover;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 4px 4px 12px;
}

.incremark-shiki-language {
  @apply text-xs font-medium text-lightInputIconColor dark:text-darkInputIconColor;
}

.incremark-shiki-copy {
  @apply h-6 rounded-default px-2 text-xs font-medium transition-colors text-lightInputIconColor dark:text-darkInputIconColor;
}

.incremark-shiki-copy:hover:not(:disabled) {
  @apply bg-lightSecondaryDarken text-lightInputText dark:bg-darkSecondaryLighten dark:text-darkInputText;
}

.incremark-shiki-copy:focus-visible {
  @apply outline-none ring-[3px] ring-lightFocusRing dark:ring-darkFocusRing;
}

.incremark-shiki-copy:disabled {
  cursor: default;
  opacity: 0.5;
}

.incremark-shiki-copy.is-copied {
  @apply text-lightSuccess dark:text-darkSuccess;
}

.incremark-shiki-body {
  overflow-x: auto;
}

/* tokens for vegaLiteConfig, the chart reads them when it renders */
.incremark-vega {
  width: 100%;
  --chart-text: theme('colors.lightInputText');
  --chart-muted: theme('colors.lightInputIconColor');
  --chart-grid: theme('colors.lightCardBorder');
  --chart-baseline: theme('colors.lightInputBorder');
  --chart-surface: theme('colors.lightCardBackground');
}

.dark .incremark-vega {
  --chart-text: theme('colors.darkInputText');
  --chart-muted: theme('colors.darkInputIconColor');
  --chart-grid: theme('colors.darkCardBorder');
  --chart-baseline: theme('colors.darkInputBorder');
  --chart-surface: theme('colors.darkCardBackground');
}

.incremark-shiki-fallback {
  margin: 0;
  padding: 12px;
  overflow-x: auto;
  background: transparent;
  color: inherit;
}

.incremark-shiki-fallback code {
  display: block;
  font-family: theme('fontFamily.mono');
  font-size: 13px;
  line-height: 1.65;
  white-space: pre;
}

:deep(.incremark-shiki-html pre.shiki) {
  margin: 0;
  padding: 12px;
  overflow-x: auto;
  background: transparent !important;
  font-size: 13px;
  line-height: 1.65;
}

:deep(.incremark-shiki-html code) {
  display: block;
  font-family: theme('fontFamily.mono');
}

:deep(.incremark-shiki-html .line) {
  min-height: 1.65em;
}

:deep(.incremark-vega .vega-embed) {
  width: 100%;
}
</style>

<style>
/* vega-tooltip appends its element to the body, so the "af" tooltip theme is global */
#vg-tooltip-element.af-theme {
  @apply rounded-default border-0 px-2 py-1.5 text-xs bg-lightDropdownOptionsBackground text-lightInputText shadow-popover dark:bg-darkDropdownOptionsBackground dark:text-darkInputText dark:shadow-darkPopover;
  font-family: inherit;
}

#vg-tooltip-element.af-theme h2 {
  @apply mb-1 text-xs font-semibold;
}

#vg-tooltip-element.af-theme td.key {
  @apply pr-2 text-lightInputIconColor dark:text-darkInputIconColor;
}

#vg-tooltip-element.af-theme td.value {
  @apply font-medium tabular-nums;
}
</style>
