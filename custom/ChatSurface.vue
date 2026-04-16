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

      <div class="w-full mb-8 flex items-center justify-center px-2 bg-transparent relative">
        <textarea
          v-model="agentStore.userMessageInput"
          ref="textInput"
          @input="autoResize"
          class="min-h-12 p-4 pr-12 w-full resize-none overflow-hidden border text-lightInputText dark:text-darkInputText rounded-md bg-transparent  text-sm bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:outline-none"
          placeholder="Type a message..."
          @keydown.enter.exact.prevent="async () => {await agentStore.sendMessage(); autoResize();}"
        />
        <Button 
          class="absolute right-4 bottom-2 !p-1"                    
          @click="async () => {await agentStore.sendMessage(); autoResize();}" 
          :disabled="!agentStore.trimmedUserMessage || agentStore.isResponseInProgress"
        >
          <IconArrowUpOutline 
            class="w-8 h-8 p-1
              text-white" 
          />
        </Button>
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
import { Button } from '@/afcl';

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

function autoResize() {
  const el = textInput.value
  if (!el) return

  el.style.height = 'auto'
  //max-h-48
  const maxHeight = 192
  if (el.scrollHeight > maxHeight) {
    el.style.height = maxHeight + 'px'
    el.style.overflowY = 'auto'
  } else {
    el.style.height = el.scrollHeight + 'px'
    el.style.overflowY = 'hidden'
  }
}

</script>