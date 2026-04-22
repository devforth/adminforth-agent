<template>
  <div 
    class="max-w-[80%] flex px-4 m-2 rounded-xl border border-gray-200 dark:border-gray-700"
    @click="handleMarkdownLinkClick"
    :class="[
      hasVegaLite ? 'w-full' : '',
      props.role === 'user' ? 'bg-lightListTableHeading dark:bg-darkListTableHeading self-end' 
      : isTypeReasoning || isTypeToolCall ? 'bg-transparent border-none self-start' 
        : 'bg-blue-100 dark:bg-blue-700/10 self-start'
    ]"
  >
    <IncremarkContent
      class="text-wrap break-words w-full max-w-full"
      v-if="content && props.type === 'text'"
      :content="content" 
      :is-finished="isFinished" 
      :components="incremarkComponents"
      :incremark-options="incremarkOptions"
    />
    <!-- reasoning/thinking -->
    <div 
      v-else-if="isTypeReasoning || isStateStreaming" 
      class="flex flex-col items-start gap-1 text-gray-500 py-2 " 
    >
      <div class="flex items-center gap-1 hover:underline cursor-pointer text-lightListTableHeadingText hover:text-lightListTableHeadingText  dark:text-darkListTableHeadingText dark:hover:text-darkListTableHeadingText" @click="isThoughtsExpanded = !isThoughtsExpanded">
        <IconAngleDownOutline 
          v-if="content"
          :class="isThoughtsExpanded ? 'rotate-180' : 'rotate-0'"
          class="transition-transform duration-200"
        />
        {{ isStateStreaming ? 'Thinking' : 'Thoughts' }}
        <template v-if="isStateStreaming">
          <span class="bounce-dot1 rounded-full w-2 h-2 bg-lightPrimary"></span>
          <span class="bounce-dot2 rounded-full w-2 h-2 bg-lightPrimary"></span>
          <span class="bounce-dot3 rounded-full w-2 h-2 bg-lightPrimary"></span>
        </template>
      </div>
      <transition name="expand" class="max-h-36 overflow-y-auto">
        <p v-show="isThoughtsExpanded" class="overflow-hidden">
          {{ content }}
        </p>
      </transition>    
    </div>
    <div v-else-if="isTypeToolCall && isToolCallStart">
      {{ props.data?.toolName }} start
    </div>
    <div v-else-if="isTypeToolCall && isToolCallEnd">
      {{ props.data?.toolName }} end
    </div>
    <p v-else class="text-red-500 py-2">
      Error occured
    </p>
  </div>
</template>

<script setup lang="ts">
  import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
  import { useRouter } from 'vue-router';
  import { IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';
  import { useAgentStore } from './composables/useAgentStore';
  import { useCoreStore } from '@/stores/core';

  const IncremarkContent = defineAsyncComponent(() => import('@incremark/vue').then(module => module.IncremarkContent))
  const ShikiCodeBlock = defineAsyncComponent(() => import('./incremark_code_renderers/IncremarkShikiCodeBlock.vue'))

  const agentStore = useAgentStore();
  const coreStore = useCoreStore();

  const incremarkComponents = {
    code: ShikiCodeBlock,
  };

  const incremarkOptions = {
		gfm: true,
		math: { tex: true },
		containers: true,
		htmlTree: true,
	};

  const router = useRouter();

  onMounted(async () => {
    void import('katex/dist/katex.min.css')
  })

  const props = defineProps<{
    type: string,
    message: string | undefined,
    state: string | undefined,
    data?: any
    role: 'user' | 'assistant'
  }>();

  const emit = defineEmits(['toggle-thoughts']);

  const content = computed(() => props.message)
  const isFinished = computed(() => props.state === 'done')
  const isThoughtsExpanded = ref(false)
  const hasVegaLite = computed(() => props.type === 'text' && props.message.includes('```vega-lite'))

  const isTypeReasoning = computed(() => props.type === 'reasoning')
  const isTypeToolCall = computed(() => props.type === 'data-tool-call')
  const isToolCallStart = computed(() => {
    if (props.type !== 'data-tool-call') return false;
    return props.data?.phase === 'start';
  })
  const isToolCallEnd = computed(() => {
    if (props.type !== 'data-tool-call') return false;
    return props.data?.phase === 'end';
  })
  const isStateStreaming = computed(() => props.state === 'streaming')

  watch(isThoughtsExpanded, (newValue: boolean) => {
    emit('toggle-thoughts', newValue);
  })

  function handleMarkdownLinkClick(event: MouseEvent) {
    if (props.type !== 'text' || event.defaultPrevented || event.button !== 0) {
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
  .incremark-paragraph {
    margin: 8px 0;
  }
</style>

<style scoped>

.bounce-dot1 {
  animation: bounce 1.5s infinite;
  animation-delay: 0s;
}

.bounce-dot2 {
  animation: bounce 1.5s infinite;
  animation-delay: 0.1s;
}

.bounce-dot3 {
  animation: bounce 1.5s infinite;
  animation-delay: 0.2s;
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(20%);
    opacity: 0.3;
    animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
  }
  50% {
    transform: none;
    opacity: 1;
    animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
  }
}

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
  max-height: 144px;
}

</style>

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
</style>