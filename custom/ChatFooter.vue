<template>
  <div
    ref="promptInput" 
    class="w-full mb-2 flex items-center justify-center px-2 bg-transparent relative translate-x-[-50%] left-1/2"
    :style="{ 
      maxWidth: agentStore.isFullScreen ? remToPx(agentStore.MAX_WIDTH)+'px' : '100%',
      transition: `transform ${agentTransitions.TRANSITION_DURATION}ms ease-in-out`
    }"            
  >
    <div 
      class="w-full border rounded-lg pb-8"
      :class="agentStore.isAudioChatMode ? 'border-none mt-8' : 'border dark:bg-gray-700'"  
    >
      <textarea
        v-if="!agentStore.isAudioChatMode"
        v-model="agentStore.userMessageInput"
        ref="textInput"
        @input="autoResize"
        :class="[
          'min-h-12 px-4 pt-4 rounded-xl w-full resize-none overflow-hidden text-lightInputText dark:text-darkInputText rounded-md bg-transparent text-sm bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:outline-none',
          { '!text-base': coreStore.isIos }
        ]"
        :placeholder="agentStore.userMessagePlaceholder"
        @keydown.enter.exact.prevent="sendMessage"
      />
      <div
        v-if="agentStore.availableModes.length > 1"
        ref="modeMenu"
        class="absolute bottom-2 left-4"
      >
        <button
          aria-label="Select mode"
          class="flex px-2 py-1 items-center text-sm justify-center 
            rounded-md bg-white text-lightListTableHeadingText 
            transition-colors duration-200 hover:bg-gray-100 
            dark:text-darkListTableHeadingText dark:bg-gray-700 dark:hover:bg-gray-800"
          :class="isModeMenuOpen ? 'bg-gray-100 dark:bg-gray-700' : ''"
          :disabled="agentStore.isResponseInProgress"
          title="Select mode"
          type="button"
          @click="toggleModeMenu"
        >
          {{ agentStore.activeModeName }}
          <IconAngleDownOutline 
            class="w-4 h-4 ml-1" 
          />
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
      <MicrophoneButton 
        v-if="props.meta.hasAudioAdapter"   
      />
      <template v-if="!agentStore.isAudioChatMode">
        <Button 
          v-if="!agentStore.isResponseInProgress"
          class="absolute right-4 bottom-2 !p-0 h-9 w-9 transition-opacity duration-200"                    
          @click="sendMessage" 
          :disabled="!agentStore.trimmedUserMessage || agentStore.isResponseInProgress"
        >
          <IconArrowUpOutline 
            class="w-8 h-8 p-1
              text-white" 
          />
        </Button>
        <Button
          v-else
          class="absolute right-4 bottom-2 !p-0 h-9 w-9"    
          @click="stopCurrentRequest"                
        >
          <div
            class="w-3 h-3 bg-white rounded-sm"
          />
        </Button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IconArrowUpOutline, IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';
import { useTemplateRef, onMounted, ref, onUnmounted } from 'vue';
import { onClickOutside } from '@vueuse/core'
import { useAgentStore } from './composables/useAgentStore';
import { useAgentTransitions } from './composables/useAgentTransitions';
import { Button } from '@/afcl';
import { useCoreStore } from '@/stores/core';
import { remToPx } from './utils';
import MicrophoneButton from './speech_recognition_frontend/MicrophoneButon.vue';

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
  conversationAreaRef: any
}>();

const textInput = useTemplateRef('textInput');
const modeMenu = useTemplateRef('modeMenu');
const agentStore = useAgentStore();
const agentTransitions = useAgentTransitions();
const coreStore = useCoreStore();
const isModeMenuOpen = ref(false);

onClickOutside(modeMenu as any, () => { isModeMenuOpen.value = false; });

onMounted(async () => {
  agentStore.setAvailableModes(props.meta.modes, props.meta.defaultModeName);
  agentStore.setCurrentGenerationModeFromLocalStorage();
  agentStore.regisrerTextInput(textInput.value);
  textInput.value?.focus();
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
  if (agentStore.isAudioChatMode) return;
  isModeMenuOpen.value = false;
  await agentStore.sendMessage();
  autoResize();
  props.conversationAreaRef?.handleSendMessage();
}

function stopCurrentRequest() {
  agentStore.abortCurrentChatRequestAndAddSystemMessage();
}

</script>
