<template>
  <ProcessingTimeline 
    :message="message"
  />
  <template 
    v-for="(part, index) in getMessageParts(message)"
    :key="part.type"
  > 
    
    <TextRenderer 
      v-if="part.type === 'text'" 
      :message="part.text" 
      :role="props.message.role" 
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
  }>();
</script>