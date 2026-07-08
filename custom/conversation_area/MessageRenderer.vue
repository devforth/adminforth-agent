<template>
  <div 
    class="relative flex flex-col w-full group/msg" 
  >
      <div 
        v-if="canEdit" 
        class="absolute w-full h-[calc(100%+1.5rem)] pb-8"
        @mouseenter="showEditButtonOnHover" 
        @mouseleave="hideEditButtonOnHover"  
      />
      <Transition
        enter-active-class="transition ease-out duration-200"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition ease-in duration-150"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="canEdit && showEditButton"
          class="absolute flex -bottom-6 right-0 self-end p-1 mr-4 mt-0.5 z-20"
          @mouseenter="showEditButtonOnHover" 
          @mouseleave="hideEditButtonOnHover" 
        >
          <button
            type="button"
            class="flex items-center justify-center w-8 h-8 rounded-md text-gray-400 hover:text-lightPrimary dark:hover:text-darkPrimary opacity-60 group-hover/msg:opacity-100 transition-opacity duration-150 hover:scale-110"
            :title="$t('Copy message')"
            @click="copyMessageToClipboard(message)"
          >
            <IconFileCopySolid class="w-5 h-5" />
          </button>
          <button
            type="button"
            class="flex items-center justify-center w-8 h-8 rounded-md text-gray-400 hover:text-lightPrimary dark:hover:text-darkPrimary opacity-60 group-hover/msg:opacity-100 transition-opacity duration-150 hover:scale-110"
            :title="$t('Edit message')"
            @click="agentStore.startEditMessage(message)"
          >
            <IconPenSolid class="w-5 h-5" />
          </button>
        </div>
      </Transition>
    <div
      v-if="message.role === 'user' && message.metadata?.steer"
      class="self-end mr-4 mb-0.5 text-xs italic text-gray-400 dark:text-gray-500"
    >
      {{ $t('Steering instruction') }}
    </div>
    <ProcessingTimeline
      :message="message"
      :isLastMessageInChat="isLastMessageInChat"
    />
    <template
      v-for="(part, index) in getMessageParts(message)"
      :key="part.type"
    >
      <TextRenderer
        v-if="part.type === 'text' && !checkIfMessageSystemMessage(part.text ?? '')"
        :message="part.text"
        :role="props.message.role"
        :highlight="isBeingEdited"
        :state="part.state ?? (props.message.role === 'user' ? 'done' : undefined)"
      />
      <ToolApprovalRenderer
        v-else-if="part.type === 'data-tool-approval'"
        :data="part.data ?? {}"
      />
      <SystemMessageRenderer
        v-else-if="part.type === 'text'"
        :message="part.text"
      />
    </template>

  </div>

</template>




<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { IconPenSolid, IconFileCopySolid } from '@iconify-prerendered/vue-flowbite';
  import TextRenderer from './TextRenderer.vue';
  import type { IMessage } from '../types';
  import { getMessageParts } from '../utils';
  import ProcessingTimeline from './ProcessingTimeline.vue';
  import SystemMessageRenderer from './SystemMessageRenderer.vue';
  import ToolApprovalRenderer from './ToolApprovalRenderer.vue';
  import { RESERVED_SYSTEM_MESSAGE_CONTENT } from '../composables/agentStore/constants';
  import { useAgentStore } from '../composables/useAgentStore';
  import { useAdminforth } from '@/adminforth';

  const props = defineProps<{
    message: IMessage
    isLastMessageInChat: boolean
  }>();

  const agentStore = useAgentStore();
  const { alert } = useAdminforth();
  const showEditButton = ref(false);
  // A user message is editable once it carries a turnId (loaded from history or stamped
  // after its turn finished). Steer sub-messages and other roles are never editable, and
  // we hide the affordance entirely while another edit or a live turn is in flight.
  const canEdit = computed(() =>
    agentStore.editingEnabled
    && props.message.role === 'user'
    && !props.message.metadata?.steer
    && Boolean(props.message.metadata?.turnId)
    && !agentStore.isEditingMessage
  );

  const isBeingEdited = computed(() =>
    Boolean(props.message.id) && props.message.id === agentStore.editingMessageId
  );

  function checkIfMessageSystemMessage(message: IMessage): boolean {
    const isReserved = Object.values(RESERVED_SYSTEM_MESSAGE_CONTENT).includes(message as RESERVED_SYSTEM_MESSAGE_CONTENT);
    return isReserved;
  }

  function showEditButtonOnHover() {
    showEditButton.value = true;
  }

  function hideEditButtonOnHover() {
    showEditButton.value = false;
  }

  function copyMessageToClipboard(message: IMessage) {
    navigator.clipboard.writeText(message.parts[0].text ?? '')
      .then(() => {
        alert({ message: 'Message copied to clipboard', variant: 'success' });
      })
      .catch((error) => {
        console.error('Failed to copy message to clipboard:', error);
        alert({ message: 'Failed to copy message to clipboard', variant: 'danger' });
      });
  }
</script>