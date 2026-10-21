<template>
  <div
    class="flex items-center justify-center min-w-0 text-sm transition-shadow duration-150 z-20"
    @click="handleMarkdownLinkClick"
    :class="[
      hasVegaLite && 'w-full',
      props.role === 'user'
        ? 'self-end max-w-[82%] mr-4 px-3 py-2 rounded-xl rounded-br [&_p]:leading-5 bg-lightSecondaryDarken dark:bg-darkSecondaryLighten'
        : 'self-start max-w-full px-4',
      props.editMode ? `w-full max-w-[calc(100%-2rem)] flex-col items-stretch py-3 border bg-lightInputBackground border-lightInputFocusBorder ring-[3px] ring-lightInputFocusRing
        dark:bg-darkInputBackground dark:border-darkInputFocusBorder dark:ring-darkInputFocusRing` : ''
    ]"
  >
    <MarkdownContent
      class="w-full max-w-full text-lightListTableText dark:text-darkListTableText"
      v-if="content && !props.editMode"
      :content="content"
      :final="isFinished"
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

  import { computed, defineAsyncComponent, ref, watch } from 'vue';
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

  const MarkdownContent = defineAsyncComponent(() => import('./MarkdownContent.vue'))

  const agentStore = useAgentStore();
  const coreStore = useCoreStore();
  const router = useRouter();

  const isThoughtsExpanded = ref(true);

  const content = computed(() => props.message)
  const isFinished = computed(() => props.state === 'done')

  const hasVegaLite = computed(() => props.message?.includes('```vega-lite'))
  const isStateStreaming = computed(() => props.state === 'streaming')

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
