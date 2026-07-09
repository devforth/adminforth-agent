<template>
  <div
    ref="promptInput" 
    class="w-full mb-2 flex items-center justify-center px-2 bg-transparent relative translate-x-[-50%] left-1/2"
    :style="{ 
      maxWidth: agentStore.isFullScreen ? remToPx(agentStore.MAX_WIDTH)+'px' : '100%',
      transition: `transform ${agentTransitions.TRANSITION_DURATION}ms ease-in-out`
    }"            
  >
    <SteerQueue />
    <!-- <SteerDebugPanel /> -->
    <div
      class="w-full border rounded-lg flex flex-col"
      :class="agentStore.isAudioChatMode ? 'border-none mt-8' : 'border dark:bg-gray-700'"
    >
      <textarea
        v-if="!agentStore.isAudioChatMode"
        v-model="agentStore.userMessageInput"
        ref="textInput"
        rows="1"
        @input="autoResize"
        :class="[
          'h-8 px-4 py-3 border-b rounded-xl rounded-b-none w-full resize-none overflow-hidden text-lightInputText dark:text-darkInputText rounded-md bg-transparent text-sm bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:outline-none',
          { '!text-base': coreStore.isIos }
        ]"
        :placeholder="placeholderText"
        @keydown.enter.exact.prevent="sendMessage"
      />
      <div class="flex items-center justify-between px-2 py-1">
      <div
        v-if="agentStore.availableModes.length > 1"
        ref="modeMenu"
        class="relative"
      >
        <button
          aria-label="Select mode"
          class="flex px-2 py-1 items-center text-sm justify-center 
            rounded-md bg-white text-lightListTableHeadingText 
            transition-colors duration-200 hover:bg-gray-100 
            dark:text-darkListTableHeadingText dark:bg-gray-700 dark:hover:bg-gray-800"
          :class="isModeMenuOpen ? 'bg-gray-100 dark:bg-gray-700' : ''"
          title="Select mode"
          type="button"
          @click="toggleModeMenu"
        >
          {{ agentStore.activeModeName }}
          <IconAngleDownOutline 
            class="w-4 h-4 ml-1 transition-transform duration-200" 
            :class="isModeMenuOpen ? '!rotate-180' : '!rotate-0'"
          />
        </button>
          <Transition
            enter-active-class="transition ease-out duration-200"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
            leave-active-class="transition ease-in duration-150"
            leave-from-class="opacity-100 scale-100"
            leave-to-class="opacity-0 scale-95"
          >
          <div
            v-if="isModeMenuOpen"
            class="absolute z-20 bottom-full left-0 mb-2 min-w-40 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
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
        </Transition>
      </div>
      <MicrophoneButton 
        v-if="props.meta.hasAudioAdapter"
        v-show="!agentStore.isEditingMessage"   
      />
      <template v-if="!agentStore.isAudioChatMode">
        <template v-if="agentStore.isEditingMessage">
          <EditActionButtons
            :confirm-disabled="!agentStore.trimmedUserMessage"
            @cancel="cancelEdit"
            @confirm="sendMessage"
          />
        </template>
        <template v-else>
          <Button
            v-if="!agentStore.isResponseInProgress"
            class=" !p-0 h-7 w-7 transition-opacity duration-200"
            @click="sendMessage"
            :disabled="!agentStore.trimmedUserMessage"
          >
            <IconArrowUpOutline
              class="w-6 h-6
                text-white"
            />
          </Button>
          <Button
            v-else
            class="right-4 bottom-2 !p-0 h-7 w-7"
            @click="stopCurrentRequest"
          >
            <div
              class="w-2.5 h-2.5 bg-white rounded-sm"
            />
          </Button>
        </template>
      </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IconArrowUpOutline, IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';
import { useTemplateRef, onMounted, ref, onUnmounted, watch, computed } from 'vue';
import { onClickOutside } from '@vueuse/core'
import { useAgentStore } from './composables/useAgentStore';
import { useAgentTransitions } from './composables/useAgentTransitions';
import { Button } from '@/afcl';
import { useCoreStore } from '@/stores/core';
import { remToPx } from './utils';
import MicrophoneButton from './speech_recognition_frontend/MicrophoneButon.vue';
import SteerQueue from './SteerQueue.vue';
import SteerDebugPanel from './SteerDebugPanel.vue';
import EditActionButtons from './EditActionButtons.vue';

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
  conversationAreaRef: any
}>();

const textInput = useTemplateRef('textInput');
const modeMenu = useTemplateRef('modeMenu');
const agentStore = useAgentStore();
const agentTransitions = useAgentTransitions();
const coreStore = useCoreStore();
const isModeMenuOpen = ref(false);

const placeholderText = computed(() => {
  if (agentStore.isTurnActive) {
    return 'Queue a follow-up — send after, or steer it…';
  }
  return agentStore.userMessagePlaceholder;
});

onClickOutside(modeMenu as any, () => { isModeMenuOpen.value = false; });

onMounted(async () => {
  agentStore.setAvailableModes(props.meta.modes, props.meta.defaultModeName);
  agentStore.setCurrentGenerationModeFromLocalStorage();
  agentStore.setEditingEnabled(props.meta.editingEnabled);
  agentStore.regisrerTextInput(textInput.value);
  textInput.value?.focus();
  autoResize();
});

watch(() => textInput.value?.value, () => {
  autoResize();
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
  // While editing a message, the same send action commits the edit (regenerating
  // from that turn) instead of starting/steering a turn.
  if (agentStore.isEditingMessage) {
    const editSubmitted = await agentStore.submitEditMessage();
    if (editSubmitted) {
      autoResize();
      props.conversationAreaRef?.handleSendMessage();
    }
    return;
  }
  // Routes to a steer (folded into the running turn) while generating, or a normal
  // new-turn send when idle.
  await agentStore.submitUserMessage();
  autoResize();
  props.conversationAreaRef?.handleSendMessage();
}

function cancelEdit() {
  agentStore.cancelEditMessage();
  autoResize();
}

function stopCurrentRequest() {
  agentStore.abortCurrentChatRequestAndAddSystemMessage();
}

</script>
