<template>
  <div
    class="flex items-center justify-center min-w-0 text-sm transition-shadow duration-150 z-20"
    @click="handleMarkdownLinkClick"
    :class="[
      hasVegaLite && 'w-full',
      props.role === 'user'
        ? 'self-end max-w-[82%] mr-4 px-3 py-2 rounded-xl rounded-br [&_.incremark-paragraph]:leading-5 bg-lightSecondaryDarken dark:bg-darkSecondaryLighten'
        : 'self-start max-w-full px-4',
      props.editMode ? `w-full max-w-[calc(100%-2rem)] flex-col items-stretch py-3 border bg-lightInputBackground border-lightInputFocusBorder ring-[3px] ring-lightInputFocusRing
        dark:bg-darkInputBackground dark:border-darkInputFocusBorder dark:ring-darkInputFocusRing` : ''
    ]"
  >
    <IncremarkContent
      class="text-wrap break-words w-full max-w-full"
      v-if="content && !props.editMode"
      :key="renderNonce"
      :content="content"
      :is-finished="isFinished"
      :components="incremarkComponents"
      :incremark-options="incremarkOptions"
    />
    <template v-if="props.editMode">
      <textarea
        v-model="agentStore.userMessageInput"
        class="w-full min-h-24 resize-y bg-transparent text-sm text-lightInputText dark:text-darkInputText border-none focus:outline-none focus:ring-0 p-0"
        @keydown.esc.prevent="agentStore.cancelEditMessage"
      />
      <EditActionButtons
        class="mt-2 self-end"
        :confirm-disabled="!agentStore.trimmedUserMessage"
        @cancel="agentStore.cancelEditMessage"
        @confirm="agentStore.submitEditMessage"
      />
    </template>
  </div>
</template>

<script setup lang="ts">

  import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
  import { useRouter } from 'vue-router';
  import { useAgentStore } from '../composables/useAgentStore';
  import { useCoreStore } from '@/stores/core';
  import type { IMessage } from '../types';
  import EditActionButtons from '../EditActionButtons.vue';

  const props = defineProps<{
    message: string | undefined,
    state: string | undefined,
    role: IMessage['role'],
    editMode?: boolean
  }>();

  const emit = defineEmits(['toggle-thoughts']);

  const IncremarkContent = defineAsyncComponent(() => import('@incremark/vue').then(module => module.IncremarkContent))
  const ShikiCodeBlock = defineAsyncComponent(() => import('../incremark_code_renderers/IncremarkShikiCodeBlock.vue'))

  const agentStore = useAgentStore();
  const coreStore = useCoreStore();
  const router = useRouter();

  const isThoughtsExpanded = ref(true);

  const content = computed(() => props.message)
  const isFinished = computed(() => props.state === 'done')

  const renderNonce = ref(0);
  watch(content, (newContent, oldContent) => {
    if (isFinished.value && newContent !== oldContent) {
      renderNonce.value++;
    }
  });
  const hasVegaLite = computed(() => props.message?.includes('```vega-lite'))
  const isStateStreaming = computed(() => props.state === 'streaming')

  const incremarkComponents = {
    code: ShikiCodeBlock,
  };
  const incremarkOptions = {
		gfm: true,
		math: { tex: true },
		containers: true,
		htmlTree: true,
	};

  onMounted(async () => {
    void import('katex/dist/katex.min.css')
  })

  watch(isStateStreaming, (newValue: boolean) => {
    if (!newValue) {
      isThoughtsExpanded.value = false;
    } 
  })

  watch(isThoughtsExpanded, (newValue: boolean) => {
    emit('toggle-thoughts', newValue);
  })

  function handleMarkdownLinkClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const anchor = target.closest('a');
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return;
    }
    event.preventDefault();
    const internalRoute = resolveInternalRoute(href);
    if (internalRoute !== null) {
      if (agentStore.isFullScreen && !coreStore.isMobile) {
        agentStore.setFullScreen(false);
      } else if (coreStore.isMobile) {
        agentStore.setIsChatOpen(false);
      }
      void router.push(internalRoute);
      return;
    }

    window.location.assign(new URL(href, window.location.href).toString());
  }

  function resolveInternalRoute(href: string): string | null {
    if (href.startsWith('#')) {
      return `${window.location.pathname}${window.location.search}${href}`;
    }

    const isAbsoluteWithScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href);
    const baseUrl = isAbsoluteWithScheme
      ? undefined
      : `${window.location.origin}/`;
    const resolvedUrl = new URL(href, baseUrl ?? window.location.href);
    if (resolvedUrl.origin !== window.location.origin) {
      return null;
    }

    return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
  }

</script>

<style lang="scss">
// the incremark theme ships its own fonts and palette, point them to the design tokens
.incremark {
  --incremark-typography-font-family-base: theme('fontFamily.sans');
  --incremark-typography-font-family-mono: theme('fontFamily.mono');
  --incremark-color-text-primary: theme('colors.lightListTableText');
  --incremark-color-text-secondary: theme('colors.lightInputIconColor');
  --incremark-color-text-tertiary: theme('colors.lightInputPlaceholderText');
  --incremark-color-border-default: theme('colors.lightCardBorder');
  --incremark-color-border-strong: theme('colors.lightCardBorder');
  --incremark-color-border-subtle: theme('colors.lightCardBorder');
  --incremark-color-background-base: theme('colors.lightCardBackground');
  --incremark-color-background-elevated: theme('colors.lightCardBackgroundHover');
  --incremark-color-code-inline-background: theme('colors.lightSecondaryDarken');
  --incremark-color-code-inline-text: theme('colors.lightInputText');
  --incremark-color-brand-primary: theme('colors.lightPrimary');
  --incremark-color-interactive-link: theme('colors.lightPrimary');
  --incremark-color-interactive-link-hover: theme('colors.lightPrimary');
  --incremark-color-interactive-link-visited: theme('colors.lightPrimary');
}

.dark .incremark {
  --incremark-color-text-primary: theme('colors.darkListTableText');
  --incremark-color-text-secondary: theme('colors.darkInputIconColor');
  --incremark-color-text-tertiary: theme('colors.darkInputPlaceholderText');
  --incremark-color-border-default: theme('colors.darkCardBorder');
  --incremark-color-border-strong: theme('colors.darkCardBorder');
  --incremark-color-border-subtle: theme('colors.darkCardBorder');
  --incremark-color-background-base: theme('colors.darkCardBackground');
  --incremark-color-background-elevated: theme('colors.darkCardBackgroundHover');
  --incremark-color-code-inline-background: theme('colors.darkSecondaryLighten');
  --incremark-color-code-inline-text: theme('colors.darkInputText');
  --incremark-color-brand-primary: theme('colors.darkPrimary');
  --incremark-color-interactive-link: theme('colors.darkPrimary');
  --incremark-color-interactive-link-hover: theme('colors.darkPrimary');
  --incremark-color-interactive-link-visited: theme('colors.darkPrimary');
}

.incremark a.incremark-link,
.incremark a.incremark-link:visited {
  @apply text-lightPrimary dark:text-darkPrimary;
  display: inline-block;
  text-decoration: underline;
  text-underline-offset: 4px;
  text-decoration-style: dotted;
  word-break: break-all;
}

.incremark a.incremark-link:hover {
  text-decoration-style: solid;
}

a.incremark-link::after {
  content: "";
  display: inline-block;
  width: 16px;
  height: 16px;
  vertical-align: middle;
  rotate: -45deg;
  background-color: currentColor;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M13 12H2m12 0l-4 4m4-4l-4-4'/%3E%3C/svg%3E") no-repeat center;
  mask-size: contain;
}

.incremark-table a.incremark-link {
  word-break: break-word;
}

// scoped under .incremark: the incremark theme is imported lazily and would win an equal selector
.incremark .incremark-list {
  list-style: disc;
  margin: 0 0 8px;
  padding-left: 18px;
}

.incremark .incremark-list-item {
  margin: 2px 0;
}

.incremark .incremark-paragraph {
  margin: 0 0 8px;
}

.incremark .incremark-list-item > .incremark-paragraph {
  margin: 0;
}

// the gap between messages comes from the conversation, not from the last block of a message
.incremark > .incremark-block:last-child > :last-child {
  margin-bottom: 0;
}
</style>