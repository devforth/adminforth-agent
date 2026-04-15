import { defineStore } from 'pinia';
import { IAgentSession, ISessionsListItem, IMessage } from './types';
import { ref, nextTick, computed } from 'vue';
import { callAdminForthApi } from '@/utils';
import { useAdminforth } from '@/adminforth';
import { Chat } from "@ai-sdk/vue";
import { DefaultChatTransport } from 'ai';

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
  const trimmedUserMessage = computed(() => userMessageInput.value.trim());
  const lastMessage = ref('');
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
    await createNewSession(message);
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
    sessionList.value.push({
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
      sessionList.value.push({
        sessionId: res.sessionId,
        title: res.title,
        timestamp: res.timestamp,
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
    chat.messages = currentSession.value?.messages.map(m => ({
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
    activeSessionId,
    currentSession,
    sessions,
    sessionList,
    createNewSession,
    setActiveSession,
    fetchSessionsList,
    deleteSession,
    createPreSession,
    //////////////////// UI related
    regisrerTextInput,
    isChatOpen,
    setIsChatOpen,
    isSessionHistoryOpen,
    setSessionHistoryOpen,
    sendMessage,
    userMessageInput,
    chatMessages: computed(() => chat.messages),
  }
})