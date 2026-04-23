import { defineStore } from 'pinia';
import { IAgentSession, ISessionsListItem, IMessage, IPart } from '../types';
import { ref, nextTick, computed, watch, onMounted, shallowRef } from 'vue';
import { callAdminForthApi } from '@/utils';
import { useAdminforth } from '@/adminforth';
import { Chat } from '../chat';
import { DefaultChatTransport } from 'ai';
import { useCoreStore } from '@/stores/core';
import { useAgentTransitions } from './useAgentTransitions';
import { useWindowSize } from '@vueuse/core';
import { remToPx, pxToRem } from '../utils';

type AgentMode = {
  name: string;
};

const DEFAULT_TEXTAREA_PLACEHOLDER = 'Type a message...';
const PLACEHOLDER_TYPING_DELAY_MS = 60;
const PLACEHOLDER_DELETING_DELAY_MS = 35;
const PLACEHOLDER_HOLD_DELAY_MS = 3000;

export const useAgentStore = defineStore('agent', () => {
  const DEFAULT_CHAT_WIDTH = 30;
  const MAX_WIDTH = 60;
  const MIN_WIDTH = 25
  const agentTransitions = useAgentTransitions();

  const activeSessionId = ref<string | null>(null);
  const currentSession = ref<IAgentSession | null>(null);
  const sessionList = ref<ISessionsListItem[]>([]);
  const sessions = ref<Record<string, IAgentSession>>({});
  const adminforth = useAdminforth();
  const isChatOpen = ref(false);
  const isSessionHistoryOpen = ref(false);
  const textInput = ref<HTMLTextAreaElement | null>(null);
  const userMessageInput = ref();
  const userMessagePlaceholder = ref(DEFAULT_TEXTAREA_PLACEHOLDER);
  const placeholderMessages = ref<string[]>([]);
  const trimmedUserMessage = computed(() => userMessageInput.value ? userMessageInput.value.trim() : '');
  const lastMessage = ref('');
  const isTeleportedToBody = ref(false);
  const setIsTeleportedToBody = (isTeleported: boolean) => {
    isTeleportedToBody.value = isTeleported;
  }
  const coreStore = useCoreStore();
  const appRoot = ref<HTMLElement | null>(null);
  const header = ref<HTMLElement | null>(null);
  const lastSessionId = ref<string | null>(null);
  const chatWidth = ref(DEFAULT_CHAT_WIDTH);
  const availableModes = ref<AgentMode[]>([]);
  const activeModeName = ref<string | null>(null);
  const hasTypedMessageInPageSession = ref(false);
  const { width: windowWidth } = useWindowSize();
  let placeholderAnimationTimer: ReturnType<typeof setTimeout> | null = null;

  function setLocalStorageItem(key: string, value: string) {
    window.localStorage.setItem(`${coreStore.config.brandName || 'adminforth'}-${key}`, value);
  }
  function getLocalStorageItem(key: string) {
    return window.localStorage.getItem(`${coreStore.config.brandName || 'adminforth'}-${key}`);
  }
  watch(windowWidth, (newWidth: number) => {
    if (isFullScreen.value) {
      setChatWidth(newWidth, false);
    }
  })
  watch(isTeleportedToBody, (newVal: boolean) => {
    setLocalStorageItem('isTeleportedToBody', newVal ? 'true' : 'false');
  })
  watch(isChatOpen, (newVal: boolean) => {
    setLocalStorageItem('isChatOpen', newVal ? 'true' : 'false');
  })
  watch(chatWidth, (newVal: number) => {
    setLocalStorageItem('chatWidth', newVal.toString());
    if (!isFullScreen.value) {
      setLocalStorageItem('chatWidthBeforeFullScreen', newVal.toString());
    }
  })
  watch(activeSessionId, (newVal: string | null) => {
    if (newVal) {
      setLocalStorageItem('lastSessionId', newVal);
    }
  })
  watch(userMessageInput, (newVal: unknown) => {
    if (hasTypedMessageInPageSession.value) {
      return;
    }

    if (typeof newVal === 'string' && newVal.trim() !== '') {
      hasTypedMessageInPageSession.value = true;
      stopPlaceholderAnimation();
    }
  })
  onMounted(() => {
    const chatWidthBeforeFullScreen = parseInt(getLocalStorageItem('chatWidthBeforeFullScreen') || '0', 10);
    if (chatWidthBeforeFullScreen && (chatWidthBeforeFullScreen > MAX_WIDTH || chatWidthBeforeFullScreen < MIN_WIDTH)) {
      setChatWidth(remToPx(DEFAULT_CHAT_WIDTH));
    } else if (chatWidthBeforeFullScreen) {
      setChatWidth(remToPx(chatWidthBeforeFullScreen));
    } else {
      const savedChatWidth = parseInt(getLocalStorageItem('chatWidth') || '0', 10);
      if (savedChatWidth) {
        if (savedChatWidth > MAX_WIDTH || savedChatWidth < MIN_WIDTH) {
          setChatWidth(remToPx(DEFAULT_CHAT_WIDTH));
        } else {
          setChatWidth(remToPx(savedChatWidth));
        }
      }
    }
    setIsTeleportedToBody(getLocalStorageItem('isTeleportedToBody') === 'true' || getLocalStorageItem('isTeleportedToBodyBeforeFullScreen') === 'true');
    lastSessionId.value = getLocalStorageItem('lastSessionId');
    if (lastSessionId.value && lastSessionId.value !== 'pre-session') {
      setActiveSession(lastSessionId.value);
    }
    if (isTeleportedToBody.value) {
      isChatOpen.value = getLocalStorageItem('isChatOpen') === 'true';
    }
    if (coreStore.isMobile) {
      setChatWidth(window.innerWidth);
    }
    appRoot.value = document.getElementById('app');
    header.value = document.getElementById('af-header-nav');
    if (appRoot.value && header.value) {
      nextTick(() => {
        agentTransitions.setAppRootTransition(false);
      });
    }  
  })

  const isFullScreen = ref(false);
  function setFullScreen(fullScreen: boolean) {
    isFullScreen.value = fullScreen;
    if (fullScreen) {
      document.body.style.overflow = 'hidden';
      setLocalStorageItem('chatWidthBeforeFullScreen', chatWidth.value.toString());
      setLocalStorageItem('isTeleportedToBodyBeforeFullScreen', isTeleportedToBody.value ? 'true' : 'false');
      setIsTeleportedToBody(false);
      useAgentTransitions().setChatSurfaceTransition(false);
      setChatWidth(window.innerWidth, false);
    } else {
      document.body.style.overflow = '';
      const lastChatWidth = parseInt(getLocalStorageItem('chatWidthBeforeFullScreen') || DEFAULT_CHAT_WIDTH.toString(), 10);
      const isTeleportedBeforeFullScreen = getLocalStorageItem('isTeleportedToBodyBeforeFullScreen') === 'true';
      agentTransitions.setAppRootTransition(true);
      setIsTeleportedToBody(isTeleportedBeforeFullScreen);
      setChatWidth(remToPx(lastChatWidth), false);
      setTimeout(() => agentTransitions.setAppRootTransition(false), agentTransitions.TRANSITION_DURATION);
    }
  }

  //takes on input width in pixels, converts to rem and sets chat width
  function setChatWidth(width: number, blockTransition = true) {
    if (blockTransition) {
      agentTransitions.setAppRootTransition(true);
    }
    chatWidth.value = pxToRem(width);

  }
  watch([isTeleportedToBody, isChatOpen, chatWidth], ([newIsTeleportedToBody, newIsChatOpen, newChatWidth]: [boolean, boolean, number]) => {
    if (appRoot.value && header.value) {
      if (newIsTeleportedToBody && newIsChatOpen) {
        appRoot.value.style.paddingRight = `${remToPx(chatWidth.value)}px`;
        header.value.style.paddingRight = `${remToPx(chatWidth.value)}px`;
      } else {
        appRoot.value.style.paddingRight = '';
        header.value.style.paddingRight = '';
      }
    }
  })
  const chats = new Map<string, Chat<any>>();
  const currentChat = shallowRef<Chat<any>>();

  function setAvailableModes(modes: AgentMode[], defaultModeName?: string | null) {
    availableModes.value = modes;
    activeModeName.value =
      modes.find((mode: AgentMode) => mode.name === activeModeName.value)?.name
      ?? defaultModeName
      ?? modes[0]?.name
      ?? null;
  }

  function setActiveMode(modeName: string) {
    if (!availableModes.value.some((mode: AgentMode) => mode.name === modeName)) {
      return;
    }

    activeModeName.value = modeName;
  }

  function setCurrentChat(sessionId: string) {
    if (chats.has(sessionId)) {
      currentChat.value = chats.get(sessionId) || null;
    } else {
      const newChat = new Chat({
        transport: new DefaultChatTransport({
          api: `${import.meta.env.VITE_ADMINFORTH_PUBLIC_PATH || ''}/adminapi/v1/agent/response`,
          credentials: 'include',
          prepareSendMessagesRequest({ messages }: any) {
            const message = lastMessage.value;
            const body = {
              message,
              sessionId,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              mode: activeModeName.value,
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
      chats.set(sessionId, newChat);
      currentChat.value = newChat;
    }

  }

  function clearPlaceholderAnimationTimer() {
    if (placeholderAnimationTimer !== null) {
      clearTimeout(placeholderAnimationTimer);
      placeholderAnimationTimer = null;
    }
  }

  function resetPlaceholder() {
    clearPlaceholderAnimationTimer();
    userMessagePlaceholder.value = DEFAULT_TEXTAREA_PLACEHOLDER;
  }

  function stopPlaceholderAnimation() {
    resetPlaceholder();
  }

  function startPlaceholderAnimation(messages: string[]) {
    clearPlaceholderAnimationTimer();

    if (!messages.length) {
      userMessagePlaceholder.value = DEFAULT_TEXTAREA_PLACEHOLDER;
      return;
    }

    let messageIndex = 0;
    let visibleLength = 0;
    let isDeleting = false;

    const animate = () => {
      const currentMessage = messages[messageIndex];

      if (!currentMessage) {
        resetPlaceholder();
        return;
      }

      if (!isDeleting) {
        visibleLength += 1;
        userMessagePlaceholder.value = currentMessage.slice(0, visibleLength);

        if (visibleLength >= currentMessage.length) {
          isDeleting = true;
          placeholderAnimationTimer = setTimeout(animate, PLACEHOLDER_HOLD_DELAY_MS);
          return;
        }

        placeholderAnimationTimer = setTimeout(animate, PLACEHOLDER_TYPING_DELAY_MS);
        return;
      }

      visibleLength -= 1;
      userMessagePlaceholder.value = currentMessage.slice(0, Math.max(visibleLength, 0));

      if (visibleLength <= 0) {
        isDeleting = false;
        messageIndex = (messageIndex + 1) % messages.length;
        placeholderAnimationTimer = setTimeout(animate, PLACEHOLDER_TYPING_DELAY_MS);
        return;
      }

      placeholderAnimationTimer = setTimeout(animate, PLACEHOLDER_DELETING_DELAY_MS);
    };

    animate();
  }

  const isResponseInProgress = computed( () => {
    return currentChat.value?.status === 'streaming';
  });
  const blockCloseOfChat = ref(false);

  function sortSessionsListByTimestamp(sessionsList: ISessionsListItem[]) {
    return [...sessionsList].sort((a: ISessionsListItem, b: ISessionsListItem) => b.timestamp.localeCompare(a.timestamp));
  }

  async function sendMessage() {
    const message = trimmedUserMessage.value;
    if (!message || isResponseInProgress.value) {
      return;
    }
    if (!currentSession.value || currentSession.value.sessionId === 'pre-session') {
      await createNewSession(message);
    }
    currentSession.value!.timestamp = new Date().toISOString();
    sessionList.value = sortSessionsListByTimestamp(sessionList.value.map((s: ISessionsListItem) => s.sessionId === currentSession.value?.sessionId ? {
      ...s,
      timestamp: currentSession.value?.timestamp || s.timestamp,
    } : s));
    lastMessage.value = message;
    currentChat.value?.sendMessage({
      text: message,
    });
    userMessageInput.value = '';
  }

  function closeChat() {
    if(isFullScreen.value) {
      document.body.style.overflow = '';
    }
    if (blockCloseOfChat.value) {
      return;
    }
    isChatOpen.value = false;
    isSessionHistoryOpen.value = false;
  }

  function openChat() {
    if (isFullScreen.value) {
      document.body.style.overflow = 'hidden';
    }
    if (coreStore.isMobile) {
      setFullScreen(true);
    }
    isChatOpen.value = true;
    nextTick(() => {
      focusTextInput();
    });
  }

  function focusTextInput() {
      textInput.value?.focus();
  }

  function setIsChatOpen(isOpen: boolean) {
    isOpen ? openChat() : closeChat();
  }

  function setSessionHistoryOpen(isOpen: boolean) {
    isSessionHistoryOpen.value = isOpen;
  }
  function regisrerTextInput(el: HTMLTextAreaElement | null) {
    textInput.value = el;
  }

  async function fetchPlaceholderMessages() {
    if (hasTypedMessageInPageSession.value) {
      stopPlaceholderAnimation();
      return;
    }

    try {
      const res = await callAdminForthApi({
        method: 'POST',
        path: '/agent/get-placeholder-messages',
      });

      if (res.error) {
        console.error('Error fetching placeholder messages:', res.error);
        placeholderMessages.value = [];
        resetPlaceholder();
        return;
      }

      placeholderMessages.value = Array.isArray(res.messages)
        ? res.messages.filter((message: unknown): message is string => typeof message === 'string' && message.length > 0)
        : [];

      if (!placeholderMessages.value.length) {
        resetPlaceholder();
        return;
      }

      startPlaceholderAnimation(placeholderMessages.value);
    } catch (error) {
      console.error('Error fetching placeholder messages', error);
      placeholderMessages.value = [];
      resetPlaceholder();
    }
  }


  //create a pre-session, until user will type something, so we can save session
  async function createPreSession() {
    saveCurrentSessionInCache();
    if (!sessionList.value.some((s: ISessionsListItem) => s.sessionId === 'pre-session')) {
        sessionList.value.unshift({
        sessionId: 'pre-session',
        title: 'New Session',
        timestamp: new Date().toISOString(),
      });
    }

    activeSessionId.value = 'pre-session';
    currentSession.value = {
      sessionId: 'pre-session',
      title: 'New Session',
      timestamp: new Date().toISOString(),
      messages: [],
    };
    sessions.value['pre-session'] = currentSession.value;
    setCurrentChat('pre-session');
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
      setCurrentChat(sessionId);
    } catch (error) {
      console.error('Error fetching session', error);
    }
  }

  function saveCurrentSessionInCache() {
    if (currentSession.value) {
      currentSession.value.messages = currentChat.value?.messages.map((m: any) => ({
        role: m.role,
        text: m.parts.map((p: IPart) => p.type === 'text' ? p.text : '').join(''),
      })) || [];
      sessions.value[currentSession.value.sessionId] = currentSession.value;
    }
  }

  async function setActiveSession(sessionId: string) {
    activeSessionId.value = sessionId;
    saveCurrentSessionInCache();
    if (!sessions.value[sessionId]) {
      await fetchSession(sessionId);    
    }
    console.log('Set active session from sessions', sessionId, sessions.value[sessionId]);
    currentSession.value = sessions.value[sessionId];
    setCurrentChat(sessionId);
    console.log('Set active session chat', sessionId, currentSession.value);
    currentChat.value.messages = currentSession.value?.messages.map((m: any) => ({
      role: m.role,
      parts:[{
        type: 'text',
        text: m.text,
        state: 'done',
      }]
    }));
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
    setActiveSession,
    fetchSessionsList,
    deleteSession,
    createPreSession,
    //____________________________________________
    regisrerTextInput,
    fetchPlaceholderMessages,
    stopPlaceholderAnimation,
    isChatOpen,
    setIsChatOpen,
    isSessionHistoryOpen,
    setSessionHistoryOpen,
    sendMessage,
    userMessageInput,
    userMessagePlaceholder,
    chatMessages: computed(() => currentChat.value?.messages || []),
    trimmedUserMessage,
    isResponseInProgress,
    isTeleportedToBody,
    setIsTeleportedToBody,
    chatWidth,
    setChatWidth,
    focusTextInput,
    setFullScreen,
    isFullScreen,
    availableModes,
    activeModeName,
    setAvailableModes,
    setActiveMode,
    DEFAULT_CHAT_WIDTH,
    MAX_WIDTH,
    MIN_WIDTH,
    getLocalStorageItem
  }
})
