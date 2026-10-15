<template>
  <div
    ref="promptInput"
    class="w-full mb-3 px-3 relative translate-x-[-50%] left-1/2"
    :style="{
      maxWidth: agentStore.isFullScreen ? remToPx(agentStore.MAX_WIDTH)+'px' : '100%',
      transition: `transform ${agentTransitions.TRANSITION_DURATION}ms ease-in-out`
    }"
  >
    <SteerQueue />
    <!-- <SteerDebugPanel /> -->
    <div
      class="w-full flex flex-col rounded-2xl border shadow-sm transition-colors duration-150
        border-gray-300 bg-white focus-within:border-gray-400
        dark:border-gray-600 dark:bg-gray-800 dark:focus-within:border-gray-500"
    >
      <textarea
        v-if="!agentStore.isAudioChatMode"
        v-model="agentStore.userMessageInput"
        ref="textInput"
        rows="1"
        @input="autoResize"
        :class="[
          `block w-full px-3.5 pt-3 pb-1 resize-none overflow-hidden bg-transparent border-none text-sm leading-6
            focus:outline-none focus:ring-0
            text-lightInputText placeholder:text-gray-500 dark:text-darkInputText dark:placeholder:text-gray-400`,
          { '!text-base': coreStore.isIos }
        ]"
        :placeholder="placeholderText"
        @keydown.enter.exact.prevent="sendMessage"
        @keydown.esc="onEscape"
      />
      <!-- in audio chat mode the voice button is centered between the mode picker and an empty column -->
      <div
        class="items-center gap-1 px-2 pb-2"
        :class="agentStore.isAudioChatMode ? 'grid grid-cols-[1fr_auto_1fr] pt-2' : 'flex pt-1'"
      >
        <div
          v-if="agentStore.availableModes.length > 1"
          ref="modeMenu"
          class="relative justify-self-start"
        >
          <button
            aria-label="Select mode"
            class="flex items-center gap-1.5 h-7 pl-2 pr-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors duration-150
              text-gray-700 hover:bg-gray-100
              dark:text-gray-200 dark:hover:bg-gray-700"
            :class="isModeMenuOpen ? 'bg-gray-100 dark:bg-gray-700' : ''"
            title="Select mode"
            type="button"
            @click="toggleModeMenu"
          >
            <IconSparklesSolid class="w-3.5 h-3.5 text-lightPrimary dark:text-darkPrimary" />
            {{ agentStore.activeModeName }}
            <IconChevronDown
              class="w-3.5 h-3.5 transition-transform duration-200"
              :class="isModeMenuOpen ? 'rotate-180' : 'rotate-0'"
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
              class="absolute z-20 bottom-full left-0 mb-2 min-w-44 p-1 rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
            >
              <button
                v-for="mode in agentStore.availableModes"
                :key="mode.name"
                class="flex items-center justify-between gap-3 w-full px-2.5 py-1.5 rounded-lg text-left text-sm transition-colors duration-150
                  text-lightInputText hover:bg-gray-100 dark:text-darkInputText dark:hover:bg-gray-700"
                type="button"
                @click="selectMode(mode.name)"
              >
                {{ mode.name }}
                <IconCheck
                  v-if="mode.name === agentStore.activeModeName"
                  class="w-4 h-4 text-lightPrimary dark:text-darkPrimary"
                />
              </button>
            </div>
          </Transition>
        </div>
        <div
          class="ml-auto flex items-center gap-1"
          :class="agentStore.isAudioChatMode ? 'col-start-2' : ''"
        >
          <div v-if="props.meta.hasAudioAdapter" v-show="!agentStore.isEditingMessage" class="contents">
            <MicrophoneButton />
          </div>
          <template v-if="!agentStore.isAudioChatMode">
            <EditActionButtons
              v-if="agentStore.isEditingMessage"
              :confirm-disabled="!agentStore.trimmedUserMessage"
              @cancel="cancelEdit"
              @confirm="sendMessage"
            />
            <button
              v-else-if="!agentStore.isResponseInProgress"
              type="button"
              :class="ROUND_PRIMARY_BUTTON_CLASSES"
              :disabled="!agentStore.trimmedUserMessage"
              :title="$t('Send message')"
              :aria-label="$t('Send message')"
              @click="sendMessage"
            >
              <IconArrowUp class="w-4 h-4" />
            </button>
            <button
              v-else
              type="button"
              :class="ROUND_PRIMARY_BUTTON_CLASSES"
              :title="$t('Stop')"
              :aria-label="$t('Stop')"
              @click="stopCurrentRequest"
            >
              <span class="w-2.5 h-2.5 rounded-sm bg-current" />
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IconArrowUp, IconCheck, IconChevronDown, IconSparklesSolid } from '@iconify-prerendered/vue-heroicons';
import { useTemplateRef, onMounted, ref, watch, computed } from 'vue';
import { onClickOutside } from '@vueuse/core'
import { useAgentStore } from './composables/useAgentStore';
import { useAgentTransitions } from './composables/useAgentTransitions';
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

const ROUND_PRIMARY_BUTTON_CLASSES = `flex items-center justify-center w-8 h-8 shrink-0 rounded-full transition-colors duration-150
  bg-lightPrimary text-lightPrimaryContrast hover:opacity-90
  dark:bg-darkPrimary dark:text-darkPrimaryContrast
  disabled:bg-gray-200 disabled:text-gray-400 disabled:hover:opacity-100 disabled:cursor-default
  dark:disabled:bg-gray-700 dark:disabled:text-gray-500`;

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
  textInput.value?.focus();
  autoResize();
});

// The textarea is re-created after leaving audio chat mode; keep the store pointing at the
// live element, otherwise focusTextInput() targets a detached one and does nothing.
watch(textInput, (el) => agentStore.regisrerTextInput(el), { immediate: true, flush: 'post' });

// Re-measure whenever the text changes programmatically (suggestion picked, edit restored)
// or the textarea is re-mounted after leaving audio chat mode.
watch([() => agentStore.userMessageInput, textInput], autoResize, { flush: 'post' });

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

// Esc discards an in-progress message edit; when not editing it does nothing so the
// keystroke keeps its default textarea behaviour.
function onEscape(event: KeyboardEvent) {
  if (!agentStore.isEditingMessage) {
    return;
  }
  event.preventDefault();
  cancelEdit();
}

function stopCurrentRequest() {
  agentStore.abortCurrentChatRequestAndAddSystemMessage();
}

</script>
