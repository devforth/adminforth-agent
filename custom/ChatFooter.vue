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
    <div
      class="af-agent-composer w-full flex flex-col rounded-xl border transition-colors duration-150
        border-lightInputBorder bg-lightInputBackground hover:border-lightInputBorderHover
        focus-within:border-lightInputFocusBorder focus-within:ring-[3px] focus-within:ring-lightInputFocusRing
        dark:border-darkInputBorder dark:bg-darkInputBackground dark:hover:border-darkInputBorderHover
        dark:focus-within:border-darkInputFocusBorder dark:focus-within:ring-darkInputFocusRing"
    >
      <ComposerAttachments v-if="!agentStore.isAudioChatMode" />
      <textarea
        v-if="!agentStore.isAudioChatMode"
        v-model="agentStore.userMessageInput"
        ref="textInput"
        rows="1"
        @input="autoResize"
        :class="[
          `block w-full px-3 pt-2.5 pb-1 resize-none overflow-hidden bg-transparent border-none text-sm leading-[22px]
            focus:outline-none focus:ring-0
            text-lightInputText placeholder:text-lightInputPlaceholderText dark:text-darkInputText dark:placeholder:text-darkInputPlaceholderText`,
          { '!text-base': coreStore.isIos }
        ]"
        :placeholder="placeholderText"
        @keydown.enter.exact.prevent="sendMessage"
        @keydown.esc="onEscape"
        @paste="onPaste"
      />
      <!-- in audio chat mode the voice button is centered between the mode picker and an empty column -->
      <div
        class="items-center gap-1 px-2 pb-2"
        :class="agentStore.isAudioChatMode ? 'grid grid-cols-[1fr_auto_1fr] pt-2' : 'flex pt-1'"
      >
        <div class="flex items-center gap-1 justify-self-start">
          <template v-if="agentStore.canAttachImages">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              type="button"
              class="af-agent-attach-button"
              :disabled="agentStore.isUploadingAttachments"
              :title="$t('Attach image')"
              :aria-label="$t('Attach image')"
              @click="fileInput?.click()"
            >
              <IconPaperclip />
            </Button>
            <input
              ref="fileInput"
              type="file"
              class="hidden"
              multiple
              :accept="acceptedImageTypes"
              @change="onFilesPicked"
            />
          </template>
          <DropdownMenu
            v-if="agentStore.availableModes.length > 1"
            v-model:open="isModeMenuOpen"
            class="af-agent-mode-menu"
            teleportToBody
          >
            <template #trigger="{ open }">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                :class="open && 'bg-lightSecondaryDarken text-lightInputText dark:bg-darkSecondaryLighten dark:text-darkInputText'"
                :aria-label="$t('Select mode')"
                :aria-expanded="open"
                :title="$t('Select mode')"
              >
                <IconSparkles class="w-4 h-4" />
                {{ agentStore.activeModeName }}
                <IconChevronDown class="w-3.5 h-3.5 transition-transform duration-200" :class="open && 'rotate-180'" />
              </Button>
            </template>
            <DropdownMenuItem
              v-for="mode in agentStore.availableModes"
              :key="mode.name"
              @click="agentStore.setActiveMode(mode.name)"
            >
              {{ mode.name }}
              <template v-if="mode.name === agentStore.activeModeName" #suffix>
                <IconCheck class="w-4 h-4 text-lightPrimary dark:text-darkPrimary" />
              </template>
            </DropdownMenuItem>
          </DropdownMenu>
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
              :confirm-disabled="(!agentStore.trimmedUserMessage && !agentStore.attachments.length) || agentStore.isUploadingAttachments"
              @cancel="cancelEdit"
              @confirm="sendMessage"
            />
            <Button
              v-else-if="!agentStore.isResponseInProgress"
              type="button"
              iconOnly
              class="rounded-full"
              :disabled="!agentStore.canSubmitUserMessage"
              :title="$t('Send message')"
              :aria-label="$t('Send message')"
              @click="sendMessage"
            >
              <IconArrowUp />
            </Button>
            <Button
              v-else
              type="button"
              iconOnly
              class="rounded-full"
              :title="$t('Stop')"
              :aria-label="$t('Stop')"
              @click="stopCurrentRequest"
            >
              <span class="w-2.5 h-2.5 rounded-sm bg-current" />
            </Button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IconArrowUp, IconCheck, IconChevronDown, IconPaperclip, IconSparkles } from '@iconify-prerendered/vue-lucide';
import { useTemplateRef, onMounted, ref, watch, computed } from 'vue';
import { Button, DropdownMenu, DropdownMenuItem } from '@/afcl';
import { useAgentStore } from './composables/useAgentStore';
import { useAgentTransitions } from './composables/useAgentTransitions';
import { useCoreStore } from '@/stores/core';
import { remToPx } from './utils';
import MicrophoneButton from './speech_recognition_frontend/MicrophoneButon.vue';
import SteerQueue from './SteerQueue.vue';
import EditActionButtons from './EditActionButtons.vue';
import ComposerAttachments from './ComposerAttachments.vue';
import type { IChatSurfaceMeta } from './types';

const props = defineProps<{
  meta: IChatSurfaceMeta
  adminUser: any
  conversationAreaRef: any
}>();

const textInput = useTemplateRef('textInput');
const fileInput = useTemplateRef('fileInput');
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

onMounted(async () => {
  agentStore.setAvailableModes(props.meta.modes, props.meta.defaultModeName);
  agentStore.setCurrentGenerationModeFromLocalStorage();
  agentStore.setEditingEnabled(props.meta.editingEnabled);
  agentStore.setAttachmentsConfig(props.meta.attachments);
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

const acceptedImageTypes = props.meta.attachments?.mimeTypes.join(',');

function onPaste(event: ClipboardEvent) {
  const files = [...event.clipboardData!.files];
  if (!agentStore.canAttachImages || files.length === 0) {
    return;
  }
  event.preventDefault();
  agentStore.addAttachmentFiles(files);
}

function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  agentStore.addAttachmentFiles([...input.files!]);
  // picking the same file again must trigger `change` again
  input.value = '';
}

function stopCurrentRequest() {
  agentStore.abortCurrentChatRequestAndAddSystemMessage();
}

</script>
