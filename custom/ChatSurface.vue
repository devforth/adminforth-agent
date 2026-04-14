<template>
  <div 
    class="relative w-6 h-6 cursor-pointer
      text-lightNavbarIcons hover:text-lightNavbarIcons/80 
      dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80
      hover:scale-110 transition-colors duration-200"       
    @click="openChat"
  >
    <IconChatBubbleLeft20Solid 
      class="w-6 h-6" 
    />
    <div class="absolute w-4 h-4 bg-lightNavbar dark:bg-darkNavbar rounded-full -top-1 -right-2">
      <IconSparklesSolid 
        class="w-4 h-4"
      />
    </div>
  </div>
  
  <div 
    ref="chatSurface"
    class="fixed bg-white h-screen top-0 right-0 border sm:w-[600px] w-screen 
          transition-transform duration-200 ease-in-out 
          flex flex-col "
    :class="isChatOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full'"
  >
    <div class="flex items-center justify-between">
      <IconBarsOutline 
        class="m-2 w-8 h-8 p-1 text-lightNavbarIcons cursor-pointer hover:text-lightNavbarIcons/80 hover:scale-110 hover:bg-lightNavbarIcons/20 rounded transition-colors duration-200" 
        @click="isSessionHistoryOpen = !isSessionHistoryOpen" 
      />

      <IconCloseOutline 
        class="m-2 p-1 w-8 h-8 text-lightNavbarIcons cursor-pointer hover:text-lightNavbarIcons/80 hover:scale-110 hover:bg-lightNavbarIcons/20 rounded transition-colors duration-200" 
        @click="closeChat" 
      />
    </div>
    <div class="relative flex-1 flex flex-col overflow-hidden">
      <ConversationArea 
        class="flex-1 overflow-auto" 
        :messages="chat.messages"
        :isSessionHistoryOpen="isSessionHistoryOpen"
        @update:isSessionHistoryOpen="isSessionHistoryOpen = $event"
      />

      <div class="border-t bg-white p-4">
        <div class="flex items-end gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 shadow-sm transition-colors focus-within:border-gray-400 focus-within:bg-white">
          <textarea
            v-model="userMessageInput"
            ref="textInput"
            class="min-h-24 flex-1 resize-none bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
            placeholder="Type a message..."
            @keydown.enter.exact.prevent="sendMessage"
          />

          <button
            class="bg-lightPrimary text-white w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer hover:bg-lightPrimary/80 disabled:bg-lightPrimary/50"
            :disabled="!trimmedUserMessage || isResponseInProgress"
            aria-label="Send message"
            @click="sendMessage"
          >
            <IconArrowUpOutline class="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  </div>

</template>

<script setup lang="ts">
import { IconChatBubbleLeft20Solid, IconSparklesSolid } from '@iconify-prerendered/vue-heroicons';
import { IconCloseOutline, IconBarsOutline, IconArrowUpOutline } from '@iconify-prerendered/vue-flowbite';
import { computed, ref, useTemplateRef, onMounted, nextTick } from 'vue';
import { onClickOutside } from '@vueuse/core'
import ConversationArea from './ConversationArea.vue';
import type { IMessage } from './types';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Chat } from "@ai-sdk/vue";
import { useAgentStore } from './useAgentStore';

const props = defineProps<{
  meta: {
    pluginInstanceId: string;
  }
}>();

const chat = new Chat({
  transport: new DefaultChatTransport({
    api: `${import.meta.env.VITE_ADMINFORTH_PUBLIC_PATH || ''}/adminapi/v1/agent/response`,
    credentials: 'include',
    prepareSendMessagesRequest({ messages }: any) {
      const message = lastMessage.value;
      const body = {
        message,
      };

      return {
        headers: {
          Accept: 'text/event-stream',
          'x-vercel-ai-ui-message-stream': 'v1',
        },
        body
      };
    }
  }),
  onError(error: unknown) {
    console.error("Chat error:", error);
  },
});


const isChatOpen = ref(false);
const chatSurface = useTemplateRef('chatSurface');
const textInput = useTemplateRef('textInput');
const userMessageInput = ref('');
const trimmedUserMessage = computed(() => userMessageInput.value.trim());
const lastMessage = ref('');
const isResponseInProgress = computed( () => {
  return chat.status === 'streaming';
})
const isSessionHistoryOpen = ref(false);
const agentStore = useAgentStore();

onClickOutside(chatSurface, () => closeChat());

onMounted(async () => {
  textInput.value.focus();
  await agentStore.fetchSessionsList();
});

function closeChat() {
  isChatOpen.value = false;
  isSessionHistoryOpen.value = false;
}

function openChat() {
  isChatOpen.value = true;
  nextTick(() => {
    textInput.value.focus();
  });
}


function sendMessage() {
  if (!trimmedUserMessage.value || isResponseInProgress.value) {
    return;
  }

  lastMessage.value = trimmedUserMessage.value;
  chat.sendMessage({
    text: trimmedUserMessage.value,
  });
  userMessageInput.value = '';
}

</script>