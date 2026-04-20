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
        {{ copied ? 'Copied' : 'Copy' }}
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import embed from 'vega-embed';

import { highlightCodeSnippetHtml, type IncremarkCodeTheme } from './incremarkCodeHighlight';

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

const sourceCode = computed(() => props.node.value ?? '');
const language = computed(() => props.node.lang?.trim().toLowerCase() || 'text');
const languageLabel = computed(() => props.node.lang?.trim() || 'text');
const shouldRenderVega = computed(() => language.value === 'vega-lite' && props.blockStatus === 'completed');
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

async function renderHighlight() {
  const requestId = ++renderRequestId;

  if (shouldRenderVega.value) {
    renderedHtml.value = '';

    if (!sourceCode.value || !vegaContainer.value) {
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
  --incremark-code-border: rgba(148, 163, 184, 0.24);
  --incremark-code-toolbar-bg: rgba(248, 250, 252, 0.9);
  --incremark-code-toolbar-text: #475569;
  --incremark-code-copy-bg: rgba(226, 232, 240, 0.9);
  --incremark-code-copy-text: #0f172a;
  border: 1px solid var(--incremark-code-border);
  border-radius: 16px;
  overflow: hidden;
  width: 100%;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.96));
  box-shadow: 0 14px 30px -24px rgba(15, 23, 42, 0.45);
}

.dark .incremark-shiki-code {
  --incremark-code-border: rgba(100, 116, 139, 0.38);
  --incremark-code-toolbar-bg: rgba(15, 23, 42, 0.88);
  --incremark-code-toolbar-text: #cbd5e1;
  --incremark-code-copy-bg: rgba(30, 41, 59, 0.88);
  --incremark-code-copy-text: #e2e8f0;
  background:
    linear-gradient(180deg, rgba(2, 6, 23, 0.96), rgba(15, 23, 42, 0.98));
}

.incremark-shiki-code[data-stream-state='pending'],
.incremark-shiki-code[data-stream-state='stable'] {
  box-shadow: 0 10px 24px -24px rgba(15, 23, 42, 0.8);
}

.incremark-shiki-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--incremark-code-border);
  background: var(--incremark-code-toolbar-bg);
  backdrop-filter: blur(10px);
}

.incremark-shiki-language {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--incremark-code-toolbar-text);
}

.incremark-shiki-copy {
  border: none;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  background: var(--incremark-code-copy-bg);
  color: var(--incremark-code-copy-text);
  cursor: pointer;
  transition: transform 0.16s ease, opacity 0.16s ease, background-color 0.16s ease;
}

.incremark-shiki-copy:hover:not(:disabled) {
  transform: translateY(-1px);
}

.incremark-shiki-copy:disabled {
  cursor: default;
  opacity: 0.5;
}

.incremark-shiki-copy.is-copied {
  background: rgba(16, 185, 129, 0.16);
  color: #059669;
}

.dark .incremark-shiki-copy.is-copied {
  background: rgba(16, 185, 129, 0.24);
  color: #6ee7b7;
}

.incremark-shiki-body {
  overflow-x: auto;
}

.incremark-vega {
  padding: 18px;
  width: 100%;
}

.incremark-shiki-fallback {
  margin: 0;
  padding: 18px;
  overflow-x: auto;
  background: transparent;
  color: inherit;
}

.incremark-shiki-fallback code {
  display: block;
  font-family: 'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre;
}

:deep(.incremark-shiki-html pre.shiki) {
  margin: 0;
  padding: 18px;
  overflow-x: auto;
  background: transparent !important;
  font-size: 13px;
  line-height: 1.65;
}

:deep(.incremark-shiki-html code) {
  display: block;
  font-family: 'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

:deep(.incremark-shiki-html .line) {
  min-height: 1.65em;
}

:deep(.incremark-vega .vega-embed) {
  width: 100%;
}

:deep(.incremark-vega){
  padding: 0;
}
</style>