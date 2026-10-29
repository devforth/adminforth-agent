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
      @dragenter="onFileDragEnter"
      @dragover="onFileDragOver"
      @dragleave="onFileDragLeave"
      @drop="onFileDrop"
    > 
      <div
        v-if="isDraggingFiles"
        class="af-agent-drop-overlay pointer-events-none absolute inset-0 z-50 p-2 bg-lightNavbar dark:bg-darkNavbar"
      >
        <div
          class="h-full flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-sm
            border-lightDropzoneBorderDragging bg-lightDropzoneBackgroundDragging text-lightDropzoneIcon
            dark:border-darkDropzoneBorderDragging dark:bg-darkDropzoneBackgroundDragging dark:text-darkDropzoneIcon"
        >
          <span
            class="flex items-center justify-center w-9 h-9 rounded-lg border
              border-lightDropzoneBorder bg-lightDropzoneBackgroundHover dark:border-darkDropzoneBorder dark:bg-darkDropzoneBackgroundHover"
          >
            <IconImagePlus class="w-5 h-5" />
          </span>
          {{ $t('Drop images to attach them') }}
        </div>
      </div>
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
import { IconBot, IconImagePlus } from '@iconify-prerendered/vue-lucide';
import { Button } from '@/afcl';
import { useTemplateRef, onMounted, ref, onUnmounted, onBeforeUnmount, computed, watch, nextTick } from 'vue';
import { onClickOutside } from '@vueuse/core'
import ConversationArea from './conversation_area/ConversationArea.vue';
import ChatHeader from './ChatHeader.vue';
import ChatFooter from './ChatFooter.vue';
import { useAgentStore } from './composables/useAgentStore';
import { useAgentTransitions } from './composables/useAgentTransitions';
import { useCoreStore } from '@/stores/core';
import type { IChatSurfaceMeta } from './types';
import { remToPx, getLayoutElements } from './utils';

const props = defineProps<{
  meta: IChatSurfaceMeta
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


// Images can be dropped anywhere on the chat. A drop target has to cancel both dragenter and
// dragover: otherwise the browser takes the body as the target and opens the dropped file.
// dragenter and dragleave come for every element inside the chat the drag crosses, so the drag is
// over the chat while more of them were entered than left
const fileDragDepth = ref(0);
const isDraggingFiles = computed(() => fileDragDepth.value > 0);

function isFileDrag(event: DragEvent) {
  return agentStore.canAttachImages && event.dataTransfer!.types.includes('Files');
}

function onFileDragEnter(event: DragEvent) {
  if (isFileDrag(event)) {
    event.preventDefault();
    fileDragDepth.value += 1;
  }
}

function onFileDragOver(event: DragEvent) {
  if (isFileDrag(event)) {
    event.preventDefault();
  }
}

function onFileDragLeave(event: DragEvent) {
  if (isFileDrag(event)) {
    fileDragDepth.value -= 1;
  }
}

function onFileDrop(event: DragEvent) {
  fileDragDepth.value = 0;
  if (!agentStore.canAttachImages || event.dataTransfer!.files.length === 0) {
    return;
  }
  event.preventDefault();
  agentStore.addAttachmentFiles([...event.dataTransfer!.files]);
}
</script>
