<template>
  <div class="flex flex-col overflow-y-auto border-t">
    <div 
      v-for="message in props.messages" :key="message.id"
      :class="message.role === 'user' ? 'self-end' : 'self-start'"
    >
      <Message
        v-for="part in message.parts"
        :key="part.type"
        :message="part.text"
        :role="message.role"
        type="info"
        state="active"
      >

      </Message>
    </div>
  </div>
</template>


<script setup lang="ts">
import Message from './Message.vue';
import type { IMessage } from './types';


const props = defineProps<{
  messages: IMessage[]
}>();


</script>