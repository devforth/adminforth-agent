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
      class="fixed bg-lightNavbar dark:bg-darkNavbar h-screen top-0 right-0 border-x border-b border-gray-200 dark:border-gray-700 
            flex flex z-40"
      :class="[agentStore.isChatOpen ? 'translate-x-0' : 'translate-x-full', !agentStore.isTeleportedToBody ? 'shadow-2xl' : '']"
      :style="{ width: agentStore.chatWidth + 'px' }"
    > 
      <div 
        v-if="!coreStore.isMobile"
        class="w-2 cursor-ew-resize absolute left-0 top-0 h-full z-30"
        @mousedown="startResize"
      ></div>

      <div 
        class="w-full h-full flex flex-col"
        :class="{ 'ml-4': agentStore.isFullScreen }"
      >
        <div class="flex items-center justify-between border-b border-gray-200 dark:border-gray-700">
          <div 
            class="flex items-center h-[55px]"
          >
            <IconBarsOutline 
              class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
                text-lightNavbarIcons hover:text-lightNavbarIcons/80 hover:bg-lightNavbarIcons/20 
                dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 "
              :class="agentStore.isSessionHistoryOpen ? 
                'bg-lightNavbarIcons/20 text-lightNavbarIcons/80 dark:bg-darkNavbarIcons/20 dark:text-darkNavbarIcons/80' : 
                ''" 
              @click="agentStore.setSessionHistoryOpen(!agentStore.isSessionHistoryOpen)" 
            />
            <IconOpenSidebarSolid 
              v-if="!agentStore.isTeleportedToBody && !coreStore.isMobile && !agentStore.isFullScreen"
              class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
                text-lightNavbarIcons hover:text-lightNavbarIcons/80 hover:bg-lightNavbarIcons/20 
                dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 " 
              @click="agentStore.setIsTeleportedToBody(true)" 
            />
            <IconCloseSidebarSolid 
              v-else-if="!coreStore.isMobile && !agentStore.isFullScreen"
              class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
                text-lightNavbarIcons hover:text-lightNavbarIcons/80 bg-lightNavbarIcons/20 
                dark:bg-darkNavbarIcons/20 dark:text-darkNavbarIcons/80 hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 " 
              @click="agentStore.setIsTeleportedToBody(false)" 
            />
            <IconArrowsPointingOut 
              v-if="!agentStore.isFullScreen && !coreStore.isMobile"
              class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
                text-lightNavbarIcons hover:text-lightNavbarIcons/80 hover:bg-lightNavbarIcons/20 
                dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 " 
              @click="agentStore.setFullScreen(true)" 
            />
            <IconArrowsPointingIn 
              v-else-if="!coreStore.isMobile"
              class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
                text-lightNavbarIcons hover:text-lightNavbarIcons/80 hover:bg-lightNavbarIcons/20 
                dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 "
              :class="agentStore.isFullScreen ? 
                'bg-lightNavbarIcons/20 text-lightNavbarIcons/80 dark:bg-darkNavbarIcons/20 dark:text-darkNavbarIcons/80' : 
                ''" 
              @click="agentStore.setFullScreen(false)" 
            />
          </div>

          <IconCloseOutline 
            class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
              text-lightNavbarIcons hover:text-lightNavbarIcons/80 hover:bg-lightNavbarIcons/20 
              dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 " 
            @click="agentStore.setIsChatOpen(false)" 
          />

        </div>
        <div 
          class="relative flex-1 flex flex-col overflow-hidden"
        >
          <ConversationArea 
            v-if="agentStore.isChatOpen"
            class="flex-1 overflow-auto" 
            :messages="agentStore.chatMessages"
          />

          <div 
            class="w-full mb-2 flex items-center justify-center px-2 bg-transparent relative"
            :class="agentStore.isFullScreen ? 'mx-auto' : ''"
            :style="{ maxWidth: agentStore.isFullScreen ? agentStore.MAX_WIDTH+'px' : '100%' }"            
          >
            <textarea
              v-model="agentStore.userMessageInput"
              ref="textInput"
              @input="autoResize"
              :class="[
                'min-h-12 w-full resize-none overflow-hidden border text-lightInputText dark:text-darkInputText rounded-md bg-transparent text-sm bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:outline-none',
                agentStore.availableModes.length > 1 ? 'p-4 pr-12 pb-12' : 'p-4 pr-12',
              ]"
              placeholder="Type a message..."
              @keydown.enter.exact.prevent="sendMessage"
            />
            <div
              v-if="agentStore.availableModes.length > 1"
              ref="modeMenu"
              class="absolute bottom-2 left-4"
            >
              <button
                aria-label="Select mode"
                class="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-lightNavbarIcons transition-colors duration-200 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-darkNavbarIcons dark:hover:bg-gray-700"
                :class="isModeMenuOpen ? 'bg-gray-100 dark:bg-gray-700' : ''"
                :disabled="agentStore.isResponseInProgress"
                title="Select mode"
                type="button"
                @click="toggleModeMenu"
              >
                <IconBrainOutline class="h-4 w-4" />
              </button>

              <div
                v-if="isModeMenuOpen"
                class="absolute bottom-full left-0 mb-2 min-w-40 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
              >
                <button
                  v-for="mode in agentStore.availableModes"
                  :key="mode.name"
                  class="block w-full px-3 py-2 text-left text-sm text-lightInputText transition-colors duration-150 hover:bg-gray-100 dark:text-darkInputText dark:hover:bg-gray-700"
                  :class="mode.name === agentStore.activeModeName ? 'bg-gray-100 dark:bg-gray-700' : ''"
                  type="button"
                  @click="selectMode(mode.name)"
                >
                  {{ mode.name }}
                </button>
              </div>
            </div>
            <Button 
              class="absolute right-4 bottom-2 !p-0 h-[34px] w-[34px]"                    
              @click="sendMessage" 
              :disabled="!agentStore.trimmedUserMessage || agentStore.isResponseInProgress"
            >
              <IconArrowUpOutline 
                class="w-8 h-8 p-1
                  text-white" 
              />
            </Button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

</template>

<script setup lang="ts">
import { IconChatBubbleLeft20Solid, IconSparklesSolid, IconArrowsPointingOut, IconArrowsPointingIn } from '@iconify-prerendered/vue-heroicons';
import { IconCloseOutline, IconBarsOutline, IconArrowUpOutline, IconCloseSidebarSolid, IconOpenSidebarSolid, IconBrainOutline } from '@iconify-prerendered/vue-flowbite';
import { useTemplateRef, onMounted, ref,computed } from 'vue';
import { onClickOutside } from '@vueuse/core'
import ConversationArea from './ConversationArea.vue';
import { useAgentStore } from './composables/useAgentStore';
import { useAgentTransitions } from './composables/useAgentTransitions';
import { Button } from '@/afcl';
import { useCoreStore } from '@/stores/core';

const props = defineProps<{
  meta: {
    pluginInstanceId: string;
    modes: Array<{
      name: string;
    }>;
    defaultModeName: string | null;
  }
}>();

const chatSurface = useTemplateRef('chatSurface');
const textInput = useTemplateRef('textInput');
const modeMenu = useTemplateRef('modeMenu');
const agentStore = useAgentStore();
const agentTransitions = useAgentTransitions();
const coreStore = useCoreStore();
const isModeMenuOpen = ref(false);

let startX = 0
let startWidth = 0

const startResize = (e: MouseEvent) => {
  startX = e.clientX
  startWidth = agentStore.chatWidth

  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'ew-resize'

  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
}

const onResize = (e: MouseEvent) => {
  const dx = startX - e.clientX
  agentStore.setChatWidth(Math.min(Math.max(startWidth + dx, agentStore.MIN_WIDTH), agentStore.MAX_WIDTH))
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

onClickOutside(chatSurface, () => {if (!agentStore.isTeleportedToBody) agentStore.setIsChatOpen(false);});
onClickOutside(modeMenu, () => { isModeMenuOpen.value = false; });

onMounted(async () => {
  agentStore.setAvailableModes(props.meta.modes, props.meta.defaultModeName);
  agentStore.regisrerTextInput(textInput.value);
  textInput.value?.focus();
  await agentStore.fetchSessionsList();
});

function autoResize() {
  const el = textInput.value
  if (!el) return

  el.style.height = 'auto'
  //max-w-48
  const maxHeight = 192
  if (el.scrollHeight > maxHeight) {
    el.style.height = maxHeight + 'px'
    el.style.overflowY = 'auto'
  } else {
    el.style.height = el.scrollHeight + 'px'
    el.style.overflowY = 'hidden'
  }
}

function toggleModeMenu() {
  isModeMenuOpen.value = !isModeMenuOpen.value;
}

function selectMode(modeName: string) {
  agentStore.setActiveMode(modeName);
  isModeMenuOpen.value = false;
}

async function sendMessage() {
  isModeMenuOpen.value = false;
  await agentStore.sendMessage();
  autoResize();
}

</script>
