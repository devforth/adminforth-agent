<template>
  <button @click="scrollContainer.scrollToBottom()">
    <IconArrowDownOutline 
      class="absolute bottom-[165px] right-6 bg-lightPrimary dark:bg-darkPrimary text-white p-1 w-10 h-10 rounded-full transition-opacity duration-100 ease-in" 
      :class="showScrollToBottomButton ? 'opacity-100' : 'opacity-0 pointer-events-none'"
      :disabled="!showScrollToBottomButton"
    />
  </button>
  <SessionsHistory 
    :class="isSessionHistoryOpen ? 'translate-x-0' : '-translate-x-full'"
  />
  <div 
    v-if="isSessionHistoryOpen"
    @click="$emit('update:isSessionHistoryOpen', false)"
    class="absolute bg-black/10 backdrop-blur-md z-10 h-full w-full"
  >

  </div>
  <AutoScrollContainer
    enabled 
    class="flex flex-col overflow-y-auto border-t border-gray-200 dark:border-gray-700"
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
    <div 
      v-if="props.messages.length === 0"
      class="flex-1 flex items-center justify-center text-gray-400 tracking-widest text-xl font-medium"
    >
      Start the conversation
    </div>
  </AutoScrollContainer>
</template>


<script setup lang="ts">
import Message from './Message.vue';
import type { IMessage } from './types';
import { useTemplateRef, ref, defineAsyncComponent, onMounted, watch } from 'vue';
import { IconArrowDownOutline } from '@iconify-prerendered/vue-flowbite';
import SessionsHistory from './SessionsHistory.vue';

const scrollContainer = useTemplateRef('scrollContainer');
const showScrollToBottomButton = ref(false);
const innerScrollContainerRef = ref(null);
const AutoScrollContainer = defineAsyncComponent(() => import('@incremark/vue').then(module => module.AutoScrollContainer))

onMounted(async () => {
  await import('@incremark/theme/styles.css')
});

watch(scrollContainer, () => {
  if (scrollContainer.value) {
    innerScrollContainerRef.value = scrollContainer.value.container;

    innerScrollContainerRef.value.addEventListener('scroll', () => {
      const isScrolledUp = scrollContainer.value?.isUserScrolledUp();
      showScrollToBottomButton.value = !!isScrolledUp;
    });
  }
})

const props = defineProps<{
  messages: IMessage[]
  isSessionHistoryOpen: boolean
}>();

defineEmits<{
  'update:isSessionHistoryOpen': [boolean]
}>();




</script>