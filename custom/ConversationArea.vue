<template>
  <button @click="scrollContainer.scrollToBottom()">
    <IconArrowDownOutline 
      class="absolute bottom-[165px] right-6 bg-lightPrimary text-white p-1 w-10 h-10 rounded-full transition-opacity duration-100 ease-in" 
      :class="showScrollToBottomButton ? 'opacity-100' : 'opacity-0 pointer-events-none'"
      :disabled="!showScrollToBottomButton"
    />
  </button>
  <AutoScrollContainer 
    enabled 
    class="flex flex-col overflow-y-auto border-t"
    ref="scrollContainer"
    behavior="smooth"
  >
    <div 
      v-for="message in props.messages" :key="message.id"
      :class="message.role === 'user' ? 'self-end' : 'self-start'"
    >
      <Message
        v-for="part in message.parts"
        :key="part.type"
        :message="part.text"
        :role="message.role"
        :type="part.type"
        :state="part.state"
      >

      </Message>
    </div>
  </AutoScrollContainer>
</template>


<script setup lang="ts">
import Message from './Message.vue';
import type { IMessage } from './types';
import { AutoScrollContainer } from '@incremark/vue'
import { useTemplateRef, ref, onMounted } from 'vue';
import { IconArrowDownOutline } from '@iconify-prerendered/vue-flowbite';

const scrollContainer = useTemplateRef('scrollContainer');
const showScrollToBottomButton = ref(false);
const innerScrollContainerRef = ref(null);

onMounted(() => {
  innerScrollContainerRef.value = scrollContainer.value.container;

  console.log('scrollContainer', innerScrollContainerRef.value);
  innerScrollContainerRef.value.addEventListener('scroll', () => {
    const isScrolledUp = scrollContainer.value?.isUserScrolledUp();
    showScrollToBottomButton.value = !!isScrolledUp;
  });
});


const props = defineProps<{
  messages: IMessage[]
}>();


</script>