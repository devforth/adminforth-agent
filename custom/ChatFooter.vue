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
      class="af-agent-composer relative w-full flex flex-col rounded-xl border transition-colors duration-150
        border-lightInputBorder bg-lightInputBackground hover:border-lightInputBorderHover
        focus-within:border-lightInputFocusBorder focus-within:ring-[3px] focus-within:ring-lightInputFocusRing
        dark:border-darkInputBorder dark:bg-darkInputBackground dark:hover:border-darkInputBorderHover
        dark:focus-within:border-darkInputFocusBorder dark:focus-within:ring-darkInputFocusRing"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div
        v-if="isDraggingFiles"
        class="af-agent-composer-drop-overlay absolute inset-0 z-10 flex items-center justify-center rounded-xl border border-dashed pointer-events-none text-sm
          border-lightDropzoneBorderDragging bg-lightInputBackground text-lightDropzoneText
          dark:border-darkDropzoneBorderDragging dark:bg-darkInputBackground dark:text-darkDropzoneText"
      >
        {{ $t('Drop images here') }}
      </div>
      <ComposerAttachments v-if="canAttach && agentStore.composerAttachments.length" />
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
        <template v-if="canAttach">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            type="button"
            :title="$t('Attach images')"
            :aria-label="$t('Attach images')"
            @click="fileInput?.click()"
          >
            <IconImagePlus />
          </Button>
          <input
            ref="fileInput"
            type="file"
            class="hidden"
            multiple
            :accept="props.meta.attachments!.mimeTypes.join(',')"
            @change="onFilesPicked"
          />
        </template>
        <DropdownMenu
          v-if="agentStore.availableModes.length > 1"
          v-model:open="isModeMenuOpen"
          class="af-agent-mode-menu justify-self-start"
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
            <Button
              v-else-if="!agentStore.isResponseInProgress"
              type="button"
              iconOnly
              class="rounded-full"
              :disabled="!agentStore.canSubmitMessage"
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
import { IconArrowUp, IconCheck, IconChevronDown, IconImagePlus, IconSparkles } from '@iconify-prerendered/vue-lucide';
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
import type { IAttachmentsConfig } from './types';

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
    attachments: IAttachmentsConfig | null;
  }
  adminUser: any
  conversationAreaRef: any
}>();

const textInput = useTemplateRef('textInput');
const fileInput = useTemplateRef('fileInput');
const agentStore = useAgentStore();
const agentTransitions = useAgentTransitions();
const coreStore = useCoreStore();
const isModeMenuOpen = ref(false);
const isDraggingFiles = ref(false);

// Images go with a new message only: not into a voice chat, not into an edit of a sent message.
const canAttach = computed(() => (
  Boolean(props.meta.attachments) && !agentStore.isAudioChatMode && !agentStore.isEditingMessage
));

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

function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  agentStore.addComposerFiles(Array.from(input.files!));
  // lets the same file be picked again after it was removed
  input.value = '';
}

// Pasting a screenshot attaches it, pasting text keeps the default behaviour.
function onPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData!.files);
  if (!canAttach.value || files.length === 0) {
    return;
  }
  event.preventDefault();
  agentStore.addComposerFiles(files);
}

function isDraggingFilesEvent(event: DragEvent) {
  return canAttach.value && event.dataTransfer!.types.includes('Files');
}

function onDragOver(event: DragEvent) {
  if (!isDraggingFilesEvent(event)) {
    return;
  }
  event.preventDefault();
  isDraggingFiles.value = true;
}

// `dragleave` also fires when the pointer moves onto a child of the composer.
function onDragLeave(event: DragEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
    isDraggingFiles.value = false;
  }
}

function onDrop(event: DragEvent) {
  if (!isDraggingFilesEvent(event)) {
    return;
  }
  event.preventDefault();
  isDraggingFiles.value = false;
  agentStore.addComposerFiles(Array.from(event.dataTransfer!.files));
}

function stopCurrentRequest() {
  agentStore.abortCurrentChatRequestAndAddSystemMessage();
}

</script>
