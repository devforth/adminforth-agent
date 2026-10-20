<template>
  <div class="relative flex flex-col w-full group/msg">
    <div
      v-if="message.role === 'user' && message.metadata?.steer && !isBeingEditedTurn"
      class="self-end mr-4 mb-0.5 text-xs italic text-lightInputPlaceholderText dark:text-darkInputPlaceholderText"
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
      <!-- a text part drops the margin of its last block, so a part that follows another one (the stream
           splits the text at every chart and tool call) brings back the gap between markdown blocks -->
      <TextRenderer
        v-if="part.type === 'text' && !checkIfMessageSystemMessage(part.text ?? '') && shouldBeShownWhileEditing"
        class="[&+&]:mt-2"
        :message="isBeingEditedMessage ? agentStore.userMessageInput : part.text"
        :role="props.message.role"
        :editMode="isBeingEditedMessage"
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
    <div
      v-if="reservesActionsRow"
      class="flex h-7 opacity-0 transition-opacity duration-200 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100"
      :class="isUserMessage ? 'self-end mr-5' : 'self-start ml-5'"
    >
      <Button
        v-if="canCopy" 
        variant="ghost"
        size="sm"
        iconOnly
        :title="$t('Copy message')"
        :aria-label="$t('Copy message')"
        @click="copyMessageToClipboard"
      >
        <IconCopy />
      </Button>
      <Button
        v-if="canEdit"
        variant="ghost"
        size="sm"
        iconOnly
        :title="$t('Edit message')"
        :aria-label="$t('Edit message')"
        @click="agentStore.startEditMessage(message)"
      >
        <IconPencil />
      </Button>
    </div>
  </div>

</template>




<script setup lang="ts">
  import { computed } from 'vue';
  import { IconCopy, IconPencil } from '@iconify-prerendered/vue-lucide';
  import { Button } from '@/afcl';
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
  // A user message is editable once it carries a turnId (loaded from history or stamped
  // after its turn finished). Steer sub-messages and other roles are never editable, and
  // we hide the affordance entirely while another edit or a live turn is in flight.
  const canEdit = computed(() =>
    agentStore.editingEnabled
    && props.message.role === 'user'
    // && !props.message.metadata?.steer
    && Boolean(props.message.metadata?.turnId)
    && !agentStore.isEditingMessage
  );

  const isBeingEditedMessage = computed(() =>
    Boolean(props.message.id) && props.message.id === agentStore.editingMessageId
  );

  const isBeingEditedTurn = computed(() =>
    Boolean(agentStore.editingMessageTurnId && props.message?.metadata?.turnId === agentStore.editingMessageTurnId)
  );

  const isUserMessage = computed(() => props.message.role === 'user');

  const copyableText = computed(() =>
    (props.message.parts ?? [])
      .filter((part: any) => part.type === 'text' && !checkIfMessageSystemMessage(part.text ?? ''))
      .map((part: any) => part.text ?? '')
      .join('')
  );
  const canCopy = computed(() =>
    Boolean(copyableText.value.trim()) && !agentStore.isEditingMessage
  );
  // While editing, hide only the *other* user messages of the edited turn (its steer
  // sub-messages); the edited message itself and all non-user parts stay visible.
  const shouldBeShownWhileEditing = computed(() =>
    !(isBeingEditedTurn.value && isUserMessage.value && !isBeingEditedMessage.value)
  );

  // The row under the message is reserved by what the message is, not by hover or transient
  // state (a turnId stamped after the turn, an edit in progress), so the buttons appearing
  // never shift the chat or change its scroll height.
  const reservesActionsRow = computed(() =>
    shouldBeShownWhileEditing.value
    && Boolean(copyableText.value.trim())
    && (!isUserMessage.value || agentStore.editingEnabled)
  );

  function checkIfMessageSystemMessage(message: IMessage): boolean {
    const isReserved = Object.values(RESERVED_SYSTEM_MESSAGE_CONTENT).includes(message as RESERVED_SYSTEM_MESSAGE_CONTENT);
    return isReserved;
  }

  function copyMessageToClipboard() {
    navigator.clipboard.writeText(copyableText.value)
      .then(() => {
        alert({ message: 'Message copied to clipboard', variant: 'success' });
      })
      .catch((error) => {
        console.error('Failed to copy message to clipboard:', error);
        alert({ message: 'Failed to copy message to clipboard', variant: 'danger' });
      });
  }
</script>