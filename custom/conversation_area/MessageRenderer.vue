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
      v-if="part.type === 'text'" 
      :message="part.text" 
      :role="props.message.role" 
      :state="part.state ?? (props.message.role === 'user' ? 'done' : undefined)"
    />
  </template>

</template>




<script setup lang="ts">
  import TextRenderer from './TextRenderer.vue';
  import type { IMessage } from '../types';
  import { getMessageParts } from '../utils';
  import ProcessingTimeline from './ProcessingTimeline.vue';

  const props = defineProps<{ 
    message: IMessage 
    isLastMessageInChat: boolean
  }>();
</script>