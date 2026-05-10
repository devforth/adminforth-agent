<template>
  <div
    class="flex rounded-xl border border-gray-200 dark:border-gray-700"
    @click="handleMarkdownLinkClick"
    :class="[
      hasVegaLite ? 'w-full px-6 my-2' : 'px-4 m-2',
      props.role === 'user' ? 'bg-lightListTableHeading dark:bg-darkListTableHeading self-end max-w-[80%] mr-4' 
        : 'border-none self-start'
    ]"
  >
    <IncremarkContent
      class="text-wrap break-words w-full max-w-full"
      v-if="content"
      :content="content" 
      :is-finished="isFinished" 
      :components="incremarkComponents"
      :incremark-options="incremarkOptions"
    />
    <!-- <p v-else class="text-red-500 py-2">
      {{ $t('No content to render') }}
    </p> -->
  </div>
</template>

<script setup lang="ts">

  import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
  import { useRouter } from 'vue-router';
  import { useAgentStore } from '../composables/useAgentStore';
  import { useCoreStore } from '@/stores/core';
  import type { IMessage } from '../types';

  const props = defineProps<{
    message: string | undefined,
    state: string | undefined,
    role: IMessage['role']
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

    const resolvedUrl = new URL(href, window.location.href);
    if (resolvedUrl.origin !== window.location.origin) {
      return null;
    }

    return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
  }

</script>

<style lang="scss">
.incremark a.incremark-link,
.incremark a.incremark-link:visited {
  display: inline-block;
  text-decoration: underline;
  text-underline-offset: 4px;
  text-decoration-style:dotted;
  color: rgb(0, 0, 0);
  transition: color 0.2s ease;
}

.incremark a.incremark-link:hover {
  color: rgb(74, 74, 255);
  text-decoration: underline;
  text-underline-offset: 4px;
  text-decoration-style:dotted;
}

html[data-theme="dark"] .incremark a.incremark-link,
html[data-theme="dark"] .incremark a.incremark-link:visited {
  color: rgb(220, 220, 220);
}

html[data-theme="dark"] .incremark a.incremark-link:hover {
  color: rgb(147, 147, 255);
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

.incremark-list {
  list-style: disc;
}

.incremark-paragraph {
  margin: 8px 0;
}
</style>