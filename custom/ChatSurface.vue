<template>
  <Button
    variant="secondary"
    :class="{ 'bg-lightButtonGroupActiveBackground hover:bg-lightButtonGroupActiveBackground dark:bg-darkButtonGroupActiveBackground dark:hover:bg-darkButtonGroupActiveBackground': agentStore.isChatOpen }"
    :aria-expanded="agentStore.isChatOpen"
    @click="agentStore.setIsChatOpen(!agentStore.isChatOpen)"
  >
    <IconBot class="w-4 h-4" />
    {{ $t('Agent') }}
  </Button>

  <Teleport to="body">
    <div 
      ref="chatSurface"
      id="adminforth-agent-chat-surface"
      class="fixed top-0 right-0 z-40 flex h-screen border-l border-lightNavbarBorder bg-lightNavbar dark:border-darkNavbarBorder dark:bg-darkNavbar"
      :class="[agentStore.isChatOpen ? 'translate-x-0' : 'translate-x-full', !agentStore.isTeleportedToBody && !agentStore.isFullScreen ? 'shadow-popover dark:shadow-darkPopover' : '']"
      :style="{ width: agentStore.isFullScreen ? '100%' : agentStore.chatWidth + 'rem' }"
    > 
      <div 
        v-if="!(coreStore.isMobile || agentStore.isFullScreen)"
        class="w-2 cursor-ew-resize absolute left-0 h-full top-0 z-30"
        @mousedown="startResize"
      ></div>
      <div 
        class="w-full min-h-0 max-h-full flex flex-col h-dvh"
        :style="{
          height: !coreStore.isIos ? dvh + 'px' : '100dvh',
        }"
      >
        <ChatHeader />
        <div 
          class="relative flex-1 min-h-0 flex flex-col overflow-hidden"
        >
          <ConversationArea
            ref="conversationArea" 
            v-if="agentStore.isChatOpen"
            :messages="agentStore.chatMessages"
          />
          <ChatFooter 
            :meta="props.meta"
            :adminUser="props.adminUser"
            :conversationAreaRef="conversationArea"
          />
        </div>
      </div>
    </div>
  </Teleport>

</template>

<script setup lang="ts">
import { IconBot } from '@iconify-prerendered/vue-lucide';
import { Button } from '@/afcl';
import { useTemplateRef, onMounted, ref, onUnmounted, onBeforeUnmount, computed, watch, nextTick } from 'vue';
import { onClickOutside } from '@vueuse/core'
import ConversationArea from './conversation_area/ConversationArea.vue';
import ChatHeader from './ChatHeader.vue';
import ChatFooter from './ChatFooter.vue';
import { useAgentStore } from './composables/useAgentStore';
import { useAgentTransitions } from './composables/useAgentTransitions';
import { useCoreStore } from '@/stores/core';
import { remToPx, getLayoutElements } from './utils';

const props = defineProps<{
  meta: {
    pluginInstanceId: string;
    modes: Array<{
      name: string;
    }>;
    defaultModeName: string | null;
    stickByDefault: boolean;
    hasAudioAdapter: boolean;
    editingEnabled: boolean;
  }
  adminUser: any
}>();

const chatSurface = useTemplateRef('chatSurface');
const conversationArea = useTemplateRef('conversationArea');
const agentStore = useAgentStore();
const agentTransitions = useAgentTransitions();
const coreStore = useCoreStore();

const dvh = ref(window.visualViewport?.height || window.innerHeight);

let startX = 0
let startWidth = 0

const layoutPaddingRight = computed(() => agentStore.isTeleportedToBody && agentStore.isChatOpen ? `${remToPx(agentStore.chatWidth)}px` : '');
watch(layoutPaddingRight, setLayoutPaddingRight);

onClickOutside(chatSurface as any, () => {if (!agentStore.isTeleportedToBody && !agentStore.isFullScreen) agentStore.setIsChatOpen(false);});

onMounted(async () => {
  window.addEventListener('resize', updateHeight)
  const savedIsTeleportedToBody = agentStore.getLocalStorageItem('isTeleportedToBody');
  const savedIsTeleportedToBodyBeforeFullScreen = agentStore.getLocalStorageItem('isTeleportedToBodyBeforeFullScreen');
  let isTeleportedToBodyFromLocalStorage = true;
  if (savedIsTeleportedToBody !== null || savedIsTeleportedToBodyBeforeFullScreen !== null) {
    isTeleportedToBodyFromLocalStorage = savedIsTeleportedToBody === 'true' || savedIsTeleportedToBodyBeforeFullScreen === 'true';
  }
  if( coreStore.isMobile ) {
    agentStore.setIsTeleportedToBody(false);
  } else {
    const shouldTeleportToBody = isTeleportedToBodyFromLocalStorage || props.meta.stickByDefault;
    const savedIsChatOpen = agentStore.getLocalStorageItem('isChatOpen');

    agentStore.setIsTeleportedToBody(shouldTeleportToBody);
    if (shouldTeleportToBody && savedIsChatOpen === null) {
      agentStore.setIsChatOpen(true);
    }
  }
  // the header is re-created after a re-login, so the room for the chat is made on every mount
  setLayoutPaddingRight(layoutPaddingRight.value);
  nextTick(() => {
    agentTransitions.setAppRootTransition(false);
    agentTransitions.setChatSurfaceTransition(false);
  });
  await agentStore.fetchSessionsList();
});

// on logout the header goes away with this component, but #app stays and must not keep the room for the chat
onBeforeUnmount(() => {
  agentTransitions.setAppRootTransition(true);
  setLayoutPaddingRight('');
})

onUnmounted(() => {
  window.removeEventListener('resize', updateHeight)
})

const startResize = (e: MouseEvent) => {
  startX = e.clientX
  startWidth = remToPx(agentStore.chatWidth)

  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'ew-resize'

  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
}

const onResize = (e: MouseEvent) => {
  const dx = startX - e.clientX
  agentStore.setChatWidth(Math.min(Math.max(startWidth + dx, remToPx(agentStore.MIN_WIDTH)), remToPx(agentStore.MAX_WIDTH)))
  agentTransitions.setChatSurfaceTransition(true);
}

const stopResize = () => {
  document.body.style.userSelect = ''
  document.body.style.cursor = ''

  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)

  agentTransitions.setAppRootTransition(false);
  agentTransitions.setChatSurfaceTransition(false);
}

function updateHeight() {
  dvh.value = Math.round(window.visualViewport?.height || window.innerHeight);
}

function setLayoutPaddingRight(paddingRight: string) {
  for (const element of getLayoutElements()) {
    element.style.paddingRight = paddingRight;
  }
}

</script>
