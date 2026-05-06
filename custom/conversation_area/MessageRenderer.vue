<template>
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
      :state="part.state ?? (props.message.role === 'user' ? 'done' : undefined)"
    />
    <SystemMessageRenderer 
      v-else
      :message="part.text" 
    />
  </template>

</template>




<script setup lang="ts">
  import TextRenderer from './TextRenderer.vue';
  import type { IMessage } from '../types';
  import { getMessageParts } from '../utils';
  import ProcessingTimeline from './ProcessingTimeline.vue';
  import SystemMessageRenderer from './SystemMessageRenderer.vue';
  import { RESERVED_SYSTEM_MESSAGE_CONTENT } from '../composables/agentStore/constants';

  const props = defineProps<{ 
    message: IMessage 
    isLastMessageInChat: boolean
  }>();

  function checkIfMessageSystemMessage(message: IMessage): boolean {
    const isReserved = Object.values(RESERVED_SYSTEM_MESSAGE_CONTENT).includes(message as RESERVED_SYSTEM_MESSAGE_CONTENT);
    return isReserved;
  }
</script>