import { defineStore } from 'pinia';
import { IAgentSession, ISessionsListItem, IMessage } from './types';
import { ref, nextTick, computed, watch, onMounted } from 'vue';
import { callAdminForthApi } from '@/utils';
import { useAdminforth } from '@/adminforth';
import { Chat } from "@ai-sdk/vue";
import { DefaultChatTransport } from 'ai';
import { useCoreStore } from '@/stores/core';

export const useAgentStore = defineStore('agent', () => {
  const activeSessionId = ref<string | null>(null);
  const currentSession = ref<IAgentSession | null>(null);
  const sessionList = ref<ISessionsListItem[]>([]);
  const sessions = ref<Record<string, IAgentSession>>({});
  const adminforth = useAdminforth();
  const isChatOpen = ref(false);
  const isSessionHistoryOpen = ref(false);
  const textInput = ref<HTMLInputElement | null>(null);
  const userMessageInput = ref();
  const trimmedUserMessage = computed(() => userMessageInput.value ? userMessageInput.value.trim() : '');
  const lastMessage = ref('');
  const isTeleportedToBody = ref(false);
  const setIsTeleportedToBody = (isTeleported: boolean) => {
    isTeleportedToBody.value = isTeleported;
  }
  const coreStore = useCoreStore();
  const appRoot = ref<HTMLElement | null>(null);
  const header = ref<HTMLElement | null>(null);
  const chatWidth = ref(600);
  function setLocalStorageItem(key: string, value: string) {
    window.localStorage.setItem(`${coreStore.config.brandName || 'adminforth'}-${key}`, value);
  }
  function getLocalStorageItem(key: string) {
    return window.localStorage.getItem(`${coreStore.config.brandName || 'adminforth'}-${key}`);
  }
  watch(isTeleportedToBody, (newVal) => {
    setLocalStorageItem('isTeleportedToBody', newVal ? 'true' : 'false');
  })
  watch(isChatOpen, (newVal) => {
    setLocalStorageItem('isChatOpen', newVal ? 'true' : 'false');
  })
  watch(chatWidth, (newVal) => {
    setLocalStorageItem('chatWidth', newVal.toString());
  })
  onMounted(() => {
    chatWidth.value = parseInt(getLocalStorageItem('chatWidth') || '600', 10);
    isTeleportedToBody.value = getLocalStorageItem('isTeleportedToBody') === 'true';
    if (isTeleportedToBody.value) {
      isChatOpen.value = getLocalStorageItem('isChatOpen') === 'true';
    }
    if (coreStore.isMobile) {
      chatWidth.value = window.innerWidth;
    }
    appRoot.value = document.getElementById('app');
    header.value = document.getElementById('af-header-nav');
    if (appRoot.value && header.value) {
      nextTick(() => {
        appRoot.value.style.transition = 'padding-right 200ms ease-in-out';
        header.value.style.transition = 'padding-right 200ms ease-in-out';
      });
    }  
  })
  function setChatWidth(width: number) {
    if (appRoot.value && header.value) {
      appRoot.value.style.transition = '';
      header.value.style.transition = '';
    }
    chatWidth.value = width;

  }
  watch([isTeleportedToBody, isChatOpen, chatWidth], ([newIsTeleportedToBody, newIsChatOpen, newChatWidth]) => {
    if (appRoot.value && header.value) {
      if (newIsTeleportedToBody && newIsChatOpen) {
        appRoot.value.style.paddingRight = `${chatWidth.value}px`;
        header.value.style.paddingRight = `${chatWidth.value}px`;
      } else {
        appRoot.value.style.paddingRight = '';
        header.value.style.paddingRight = '';
      }
    }
  })
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
  const isResponseInProgress = computed( () => {
    return chat.status === 'streaming';
  });
  const blockCloseOfChat = ref(false);

  async function sendMessage() {
    const message = trimmedUserMessage.value;
    if (!message || isResponseInProgress.value) {
      return;
    }
    if (!currentSession.value || currentSession.value.sessionId === 'pre-session') {
      await createNewSession(message);
    }
    lastMessage.value = message;
    chat.sendMessage({
      text: message,
    });
    userMessageInput.value = '';
  }

  function closeChat() {
    if (blockCloseOfChat.value) {
      return;
    }
    isChatOpen.value = false;
    isSessionHistoryOpen.value = false;
  }

  function openChat() {
    isChatOpen.value = true;
    nextTick(() => {
      textInput.value?.focus();
    });
  }

  function setIsChatOpen(isOpen: boolean) {
    isOpen ? openChat() : closeChat();
  }

  function setSessionHistoryOpen(isOpen: boolean) {
    isSessionHistoryOpen.value = isOpen;
  }
  function regisrerTextInput(el: HTMLInputElement | null) {
    textInput.value = el;
  }


  //create a pre-session, until user will type something, so we can save session
  async function createPreSession() {
    sessionList.value.unshift({
      sessionId: 'pre-session',
      title: 'New Session',
      timestamp: new Date().toISOString(),
    })
    activeSessionId.value = 'pre-session';
    currentSession.value = {
      sessionId: 'pre-session',
      title: 'New Session',
      timestamp: new Date().toISOString(),
      messages: [],
    };
    sessions.value['pre-session'] = currentSession.value;
  }

  async function deletePreSession() {
    sessionList.value = sessionList.value.filter((s: ISessionsListItem) => s.sessionId !== 'pre-session');
    if (activeSessionId.value === 'pre-session') {
      activeSessionId.value = null;
      currentSession.value = null;
    }
  }

  async function createNewSession(triggerMessage?: string) {
    try {
      const res = await callAdminForthApi({
        method: 'POST',
        path: '/agent/create-session',
        body: { 
          triggerMessage
        },
      });
      if (res.error) {
        console.error('Error creating new session:', res.error);
        return;
      }
      deletePreSession();
      sessions.value[res.sessionId] = res;
      sessionList.value.unshift({
        sessionId: res.sessionId,
        title: res.title,
        timestamp: new Date().toISOString(),
      });
      setActiveSession(res.sessionId);
    } catch (error) {
      console.error('Error creating new session', error);
    }
  }

  async function deleteSession(sessionId: string) {
    if (sessionId === 'pre-session') {
      deletePreSession();
      return;
    }
    blockCloseOfChat.value = true;
    const isConfirmed = await adminforth.confirm({message: 'Are you sure, that you want to delete this session?', yes: 'Yes', no: 'No'})
    blockCloseOfChat.value = false;
    if (!isConfirmed) {
      return;
    }
    try {
      const res = await callAdminForthApi({
        method: 'POST',
        path: '/agent/delete-session',
        body: { sessionId },
      });
      if (res.error) {
        console.error('Error deleting session:', res.error);
        return;
      }
      delete sessions.value[sessionId];
      sessionList.value = sessionList.value.filter((s: ISessionsListItem) => s.sessionId !== sessionId);
      if (activeSessionId.value === sessionId) {
        activeSessionId.value = null;
        currentSession.value = null;
      }
    } catch (error) {
      console.error('Error deleting session', error);
    }
    if(sessionId === activeSessionId.value) {
      activeSessionId.value = sessionList.value.length > 0 ? sessionList.value[0].sessionId : null;
      if (activeSessionId.value) {
        currentSession.value = sessions.value[activeSessionId.value] || null;
      } else {
        currentSession.value = null;
      }
    }
  }

  async function fetchSession(sessionId: string) {
    try {
      const res = await callAdminForthApi({
        method: 'POST',
        path: '/agent/get-session-info',
        body: { sessionId },
      });
      if (res.error) {
        console.error('Error fetching session:', res.error);
        return;
      }
      sessions.value[sessionId] = res.session;
    } catch (error) {
      console.error('Error fetching session', error);
    }
  }

  async function setActiveSession(sessionId: string) {
    activeSessionId.value = sessionId;
    if (!sessions.value[sessionId]) {
      await fetchSession(sessionId);    
    }
    currentSession.value = sessions.value[sessionId];
    chat.messages = currentSession.value?.messages.map((m: any) => ({
      text: m.text,
      role: m.role,
    })) || [];
  }

  async function fetchSessionsList() {
    try {
      const res = await callAdminForthApi({
        method: 'POST',
        path: '/agent/get-sessions',
      });
      if (res.error) {
        console.error('Error fetching sessions list:', res.error);
        return;
      }
      sessionList.value = res.sessions;
    } catch (error) {
      console.error('Error fetching sessions list', error);
    }
  }

  return {
    //_________-Sessions management-_____________
    activeSessionId,
    currentSession,
    sessions,
    sessionList,
    createNewSession,
    setActiveSession,
    fetchSessionsList,
    deleteSession,
    createPreSession,
    //____________________________________________
    regisrerTextInput,
    isChatOpen,
    setIsChatOpen,
    isSessionHistoryOpen,
    setSessionHistoryOpen,
    sendMessage,
    userMessageInput,
    chatMessages: computed(() => chat.messages),
    trimmedUserMessage,
    isResponseInProgress,
    isTeleportedToBody,
    setIsTeleportedToBody,
    chatWidth,
    setChatWidth,
  }
})