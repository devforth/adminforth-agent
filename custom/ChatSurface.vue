<template>
  <div 
    class="relative w-6 h-6 cursor-pointer mr-6 mt-1
      text-lightNavbarIcons hover:text-lightNavbarIcons/80 
      dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80
      hover:scale-110 transition-colors duration-200"       
    @click="agentStore.setIsChatOpen(true)"
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
    class="fixed bg-lightNavbar dark:bg-darkNavbar h-screen top-0 right-0 border border-gray-200 dark:border-gray-700 sm:w-[600px] w-screen 
          transition-transform duration-200 ease-in-out 
          flex flex-col z-10"
    :class="agentStore.isChatOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full'"
  >
    <div class="flex items-center justify-between">
      <IconBarsOutline 
        class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
          text-lightNavbarIcons hover:text-lightNavbarIcons/80 hover:bg-lightNavbarIcons/20 
          dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 " 
        @click="agentStore.setSessionHistoryOpen(!agentStore.isSessionHistoryOpen)" 
      />

      <IconCloseOutline 
        class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
          text-lightNavbarIcons hover:text-lightNavbarIcons/80 hover:bg-lightNavbarIcons/20 
          dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 " 
        @click="agentStore.setIsChatOpen(false)" 
      />
    </div>
    <div class="relative flex-1 flex flex-col overflow-hidden">
      <ConversationArea 
        v-if="agentStore.isChatOpen"
        class="flex-1 overflow-auto" 
        :messages="agentStore.chatMessages"
      />

      <div class="border-t border-gray-200 dark:border-gray-700 bg-lightNavbar dark:bg-darkNavbar p-4">
        <div class="flex items-end gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-3 shadow-sm transition-colors focus-within:border-gray-400 focus-within:bg-white dark:focus-within:bg-gray-700">
          <textarea
            v-model="agentStore.userMessageInput"
            ref="textInput"
            class="min-h-24 flex-1 resize-none bg-transparent text-sm text-gray-900 dark:text-gray-100 outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
            placeholder="Type a message..."
            @keydown.enter.exact.prevent="agentStore.sendMessage"
          />

          <button
            class="bg-lightPrimary dark:bg-darkPrimary text-white w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer hover:bg-lightPrimary/80 dark:bg-darkPrimary/80 dark:hover:bg-darkPrimary/80 disabled:bg-lightPrimary/50 dark:disabled:darkPrimary dark:disabled:bg-darkPrimary/50"
            :disabled="!agentStore.trimmedUserMessage || agentStore.isResponseInProgress"
            aria-label="Send message"
            @click="agentStore.sendMessage"
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
import { useTemplateRef, onMounted } from 'vue';
import { onClickOutside } from '@vueuse/core'
import ConversationArea from './ConversationArea.vue';
import { useAgentStore } from './useAgentStore';

const props = defineProps<{
  meta: {
    pluginInstanceId: string;
  }
}>();

const chatSurface = useTemplateRef('chatSurface');
const textInput = useTemplateRef('textInput');
const agentStore = useAgentStore();

onClickOutside(chatSurface, () => agentStore.setIsChatOpen(false));

onMounted(async () => {
  agentStore.regisrerTextInput(textInput.value);
  textInput.value?.focus();
  await agentStore.fetchSessionsList();
});

</script>