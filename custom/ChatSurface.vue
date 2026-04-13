<template>

  <IconChatBubbleLeft20Solid 
    class="w-5 h-5 text-gray-600 cursor-pointer hover:text-gray-800 hover:scale-110 transition-colors duration-200" 
    @click="openChat"
  />
  
  <div 
    ref="chatSurface"
    class="fixed bg-white h-screen top-0 right-0 border w-[800px] 
          transition-transform duration-200 ease-in-out 
          flex flex-col shadow-2xl"
    :class="isChatOpen ? 'translate-x-0' : 'translate-x-full'"
  >
    <div class="flex items-center justify-between">
      <IconBarsOutline 
        class="m-2 w-8 h-8 p-1 text-gray-600 cursor-pointer hover:text-gray-800 hover:scale-110 hover:bg-gray-100 rounded transition-colors duration-200" 
        @click="closeChat" 
      />
      <IconCloseOutline 
        class="m-2 p-1 w-8 h-8 text-gray-600 cursor-pointer hover:text-gray-800 hover:scale-110 hover:bg-gray-100 rounded transition-colors duration-200" 
        @click="closeChat" 
      />
    </div>

    <div class="flex-1 flex flex-col overflow-hidden">
      <ConversationArea 
        class="flex-1 overflow-auto" 
        :messages="chat.messages"
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

          <Button
            :disabled="!trimmedUserMessage"
            aria-label="Send message"
            @click="sendMessage"
          >
            <IconArrowUpOutline class="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  </div>

</template>

<script setup lang="ts">
import { IconChatBubbleLeft20Solid } from '@iconify-prerendered/vue-heroicons';
import { IconCloseOutline, IconBarsOutline, IconArrowUpOutline } from '@iconify-prerendered/vue-flowbite';
import { computed, ref, useTemplateRef, onMounted, nextTick } from 'vue';
import { onClickOutside } from '@vueuse/core'
import ConversationArea from './ConversationArea.vue';
import type { IMessage } from './types';
import { Button } from '@/afcl'
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Chat } from "@ai-sdk/vue";
import { callAdminForthApi } from '@/utils';

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

onClickOutside(chatSurface, () => isChatOpen.value = false);

onMounted(() => {
  textInput.value.focus();
});

function closeChat() {
  isChatOpen.value = false;
}

function openChat() {
  isChatOpen.value = true;
  nextTick(() => {
    textInput.value.focus();
  });
}


function sendMessage() {
  if (!trimmedUserMessage.value) {
    return;
  }

  console.log('sendMessage placeholder', trimmedUserMessage.value);
  lastMessage.value = trimmedUserMessage.value;
  chat.sendMessage({
    text: trimmedUserMessage.value,
  });
  userMessageInput.value = '';
}



const testMessages: IMessage[] = [
  {
    id: '1',
    role: 'user',
    metadata: {},
    parts: [
      {
        type: 'text',
        state: 'done',
        text: `# Project Title: Markdown Template
---

## 1. Introduction
This is a standard paragraph. Use this space to describe the purpose of your document. You can use **bold text** for emphasis or *italics* for subtle highlights.

> **Pro-Tip:** Use blockquotes to call out specific warnings or important notes.

---IMessage

## 2. Features & Requirements
### Key Features
* **Adaptive:** Works in most editors.
* **Lightweight:** No heavy file size.
* **Portable:** Easy to convert to PDF or HTML.

### Task List
- [x] Define project scope
- [x] Design layout
- [ ] Finalize documentation
- [ ] Export to production

---

## 3. Technical Specifications

### Data Table
| ID | Parameter | Value | Status |
| :--- | :--- | :--- | :--- |
| 001 | Latency | < 20ms | Green |
| 002 | Throughput | 500 gb/s | Yellow |
| 003 | Error Rate | 0.01% | Green |

### Code Implementation
To initialize the script, use the following command:
      `
      }
    ]
  },
  {
    id: '2',
    role: 'assistant',
    metadata: {},
    parts: [
      {
        type: 'text',
        state: 'done',
        text: `
This is a user message. You can also include **markdown** in user messages, and it will be rendered appropriately. For example, you can have:

- Bullet points
- **Bold text**
- *Italic text*
- [Links](https://www.example.com)

Feel free to test out different markdown features in your messages!
        `
      }
    ]
  }
];

</script>