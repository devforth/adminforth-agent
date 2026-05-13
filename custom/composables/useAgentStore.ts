import { defineStore } from 'pinia';
import { IAgentSession, ISessionsListItem } from '../types';
import { ref, nextTick, computed, watch, onMounted } from 'vue';
import { useAdminforth } from '@/adminforth';
import { useCoreStore } from '@/stores/core';
import { useAgentTransitions } from './useAgentTransitions';
import { useWindowSize } from '@vueuse/core';
import { remToPx, pxToRem } from '../utils';
import {
  type AgentMode,
  DEFAULT_CHAT_WIDTH,
  MAX_WIDTH,
  MIN_WIDTH,
  RESERVED_SYSTEM_MESSAGE_CONTENT,
  PRE_SESSION_ID
} from './agentStore/constants';
import { createAgentChatManager } from './agentStore/useAgentChat';
import { createAgentPlaceholderController } from './agentStore/useAgentPlaceholder';
import { createAgentSessionManager } from './agentStore/useAgentSessions';

export const useAgentStore = defineStore('agent', () => {
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
  const { width: viewportWidth } = useWindowSize({
    type: 'visual',
    includeScrollbar: false,
  });
  const {
    currentChat,
    setCurrentChat,
    abortCurrentChatRequest,
  } = createAgentChatManager({
    lastMessage,
    activeModeName,
  });
  const {
    userMessagePlaceholder,
    hasTypedMessageInPageSession,
    fetchPlaceholderMessages,
    stopPlaceholderAnimation,
  } = createAgentPlaceholderController({
    userMessageInput,
  });

  function setLocalStorageItem(key: string, value: string) {
    window.localStorage.setItem(`${coreStore.config.brandName || 'adminforth'}-${key}`, value);
  }
  function getLocalStorageItem(key: string) {
    return window.localStorage.getItem(`${coreStore.config.brandName || 'adminforth'}-${key}`);
  }

  const isAudioChatMode = ref(false);

  const onBeforeChatCloseCallbacks: Array<() => Promise<void>> = [];
  function registerOnBeforeChatCloseCallback(hook: () => Promise<void>) {
    onBeforeChatCloseCallbacks.push(hook);
  }

  async function executeOnBeforeChatCloseCallbacks() {
    for(const hook of onBeforeChatCloseCallbacks) {
      try {
        await hook();
      } catch (error) {
        console.error('Error executing onBeforeChatClose callback:', error);
      }
    }
  }

  function setIsAudioChatMode(isAudioChat: boolean) {
    isAudioChatMode.value = isAudioChat;
  }

  watch(isAudioChatMode, (newVal: boolean) => {
    if (newVal) {
      addSystemMessage(RESERVED_SYSTEM_MESSAGE_CONTENT.START_AUDIO_CHAT);
    } else {
      addSystemMessage(RESERVED_SYSTEM_MESSAGE_CONTENT.END_AUDIO_CHAT);
    }
  });


  const isResponseInProgress = computed( () => {
    return currentChat.value?.status === 'streaming';
  });
  const blockCloseOfChat = ref(false);
  const {
    sendMessage,
    createPreSession,
    setActiveSession,
    fetchSessionsList,
    deleteSession,
    addDebugMessage,
    addSystemMessage,
    addAgentMessage,
    addUserMessage,
    addDataToolCallMessage,
    setCurrentChatStatus,
    updateLastAgentMessage
  } = createAgentSessionManager({
    activeSessionId,
    currentSession,
    sessionList,
    sessions,
    currentChat,
    trimmedUserMessage,
    isResponseInProgress,
    userMessageInput,
    lastMessage,
    blockCloseOfChat,
    adminforth,
    setCurrentChat,
  });

  watch(() => viewportWidth.value, (newWidth) => {
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
    if (!coreStore.isMobile) {
      const savedIsTeleportedToBody = getLocalStorageItem('isTeleportedToBody');
      const savedIsTeleportedToBodyBeforeFullScreen = getLocalStorageItem('isTeleportedToBodyBeforeFullScreen');
      const isTeleportedToBodyFromLocalStorage = savedIsTeleportedToBody === 'true' || savedIsTeleportedToBodyBeforeFullScreen === 'true';
      const savedIsChatOpen = getLocalStorageItem('isChatOpen');

      setIsTeleportedToBody(isTeleportedToBodyFromLocalStorage);
      if (isTeleportedToBody.value) {
        isChatOpen.value = savedIsChatOpen === null ? true : savedIsChatOpen === 'true';
      }
    }
    lastSessionId.value = getLocalStorageItem('lastSessionId');
    if (lastSessionId.value && lastSessionId.value !== PRE_SESSION_ID) {
      setActiveSession(lastSessionId.value);
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
    const appElement = document.getElementById('app');

    if (fullScreen) {
      document.body.style.overflow = 'hidden';
      document.body.classList.add('bg-lightHtml', 'dark:bg-darkHtml');
      setTimeout(() => {
        appElement?.setAttribute('style', `opacity: 0; pointer-events: none;`);
      }, agentTransitions.TRANSITION_DURATION);
      setLocalStorageItem('chatWidthBeforeFullScreen', chatWidth.value.toString());
      setLocalStorageItem('isTeleportedToBodyBeforeFullScreen', isTeleportedToBody.value ? 'true' : 'false');
      setIsTeleportedToBody(false);
      useAgentTransitions().setChatSurfaceTransition(false);
      setChatWidth(window.innerWidth, false);
    } else {
      appElement?.setAttribute('style', `opacity: 100; pointer-events: all;`);
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

  function setAvailableModes(modes: AgentMode[], defaultModeName?: string | null) {
    availableModes.value = modes;
    activeModeName.value =
      modes.find((mode: AgentMode) => mode.name === activeModeName.value)?.name
      ?? defaultModeName
      ?? modes[0]?.name
      ?? null;
  }

  function setCurrentGenerationModeFromLocalStorage() {
    const activeModeNameFromLocalStorage = getLocalStorageItem('activeModeName');
    if (activeModeNameFromLocalStorage) {
      setActiveMode(activeModeNameFromLocalStorage);
    }
  }

  function setActiveMode(modeName: string) {
    if (!availableModes.value.some((mode: AgentMode) => mode.name === modeName)) {
      return;
    }
    setLocalStorageItem('activeModeName', modeName);
    activeModeName.value = modeName;
  }

  async function closeChat() {
    if (!isChatOpen.value) {
      return;
    }
    await executeOnBeforeChatCloseCallbacks();
    if(isFullScreen.value) {
      document.body.style.overflow = '';
    }
    if (blockCloseOfChat.value) {
      return;
    }
    isChatOpen.value = false;
    if (isFullScreen.value) {
      setFullScreen(false);
    }
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

  function abortCurrentChatRequestAndAddSystemMessage() {
    abortCurrentChatRequest();
    addSystemMessage(RESERVED_SYSTEM_MESSAGE_CONTENT.AGENT_RESPONSE_ABORTED);
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
    setCurrentGenerationModeFromLocalStorage,
    setActiveMode,
    DEFAULT_CHAT_WIDTH,
    MAX_WIDTH,
    MIN_WIDTH,
    RESERVED_SYSTEM_MESSAGE_CONTENT,
    getLocalStorageItem,
    addDebugMessage,
    abortCurrentChatRequestAndAddSystemMessage,
    addSystemMessage,
    isAudioChatMode,
    setIsAudioChatMode,
    registerOnBeforeChatCloseCallback,
    addAgentMessage,
    addUserMessage,
    addDataToolCallMessage,
    setCurrentChatStatus,
    updateLastAgentMessage
  }
})