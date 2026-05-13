<template>
  <div 
    class="relative w-6 h-6 cursor-pointer mr-1 mt-1
      text-lightNavbarIcons hover:text-lightNavbarIcons/80 
      dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80
      hover:scale-110 transition-colors duration-200"       
    @click="agentStore.setIsChatOpen(!agentStore.isChatOpen)"
  >
    <IconChatBubbleLeft20Solid 
      class="w-6 h-6" 
    />
    <div class="absolute w-4 h-4 bg-lightNavbar dark:bg-darkNavbar rounded-full -top-1 -right-2">
      <IconSparklesSolid 
        class="w-4 h-4"
      />
    </div>
  </div>

  <Teleport to="body">
    <div 
      ref="chatSurface"
      id="adminforth-agent-chat-surface"
      class="fixed bg-lightNavbar dark:bg-darkNavbar top-0 right-0 border-x border-b border-gray-200 dark:border-gray-700 
            flex flex z-40 h-screen"
      :class="[agentStore.isChatOpen ? 'translate-x-0' : 'translate-x-full', !agentStore.isTeleportedToBody ? 'shadow-2xl' : '']"
      :style="{ width: agentStore.chatWidth + 'rem' }"
    > 
      <div 
        v-if="!(coreStore.isMobile || agentStore.isFullScreen)"
        class="w-2 cursor-ew-resize absolute left-0 h-full top-0 z-30"
        @mousedown="startResize"
      ></div>
      <div 
        class="w-full min-h-0 max-h-full flex flex-col h-dvh"
        :style="{
          height: !agentStore.isIos ? dvh + 'px' : '100dvh',
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
import { IconChatBubbleLeft20Solid, IconSparklesSolid } from '@iconify-prerendered/vue-heroicons';
import { useTemplateRef, onMounted, ref, onUnmounted } from 'vue';
import { onClickOutside } from '@vueuse/core'
import ConversationArea from './conversation_area/ConversationArea.vue';
import ChatHeader from './ChatHeader.vue';
import ChatFooter from './ChatFooter.vue';
import { useAgentStore } from './composables/useAgentStore';
import { useAgentTransitions } from './composables/useAgentTransitions';
import { useCoreStore } from '@/stores/core';
import { remToPx } from './utils';

const props = defineProps<{
  meta: {
    pluginInstanceId: string;
    modes: Array<{
      name: string;
    }>;
    defaultModeName: string | null;
    stickByDefault: boolean;
    hasAudioAdapter: boolean;
  }
  adminUser: any
}>();

const chatSurface = useTemplateRef('chatSurface');
const conversationArea = useTemplateRef('conversationArea');
const agentStore = useAgentStore();
const agentTransitions = useAgentTransitions();
const coreStore = useCoreStore();

const dvh = ref(window.innerHeight)

let startX = 0
let startWidth = 0

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
    agentStore.setIsTeleportedToBody(isTeleportedToBodyFromLocalStorage || props.meta.stickByDefault);
  }
  await agentStore.fetchSessionsList();
});

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

  const appRoot = document.getElementById('app');
  const header = document.getElementById('af-header-nav');
  if (appRoot && header) {
    agentTransitions.setAppRootTransition(false);
    agentTransitions.setChatSurfaceTransition(false);
  }
}

function updateHeight() {
  dvh.value = Math.round(window.visualViewport?.height || window.innerHeight);
}

</script>
