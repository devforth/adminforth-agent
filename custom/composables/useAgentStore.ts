import { defineStore } from 'pinia';
import { IAgentSession, ISessionsListItem } from '../types';
import { ref, nextTick, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
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
import { createAgentSteerQueue } from './agentStore/useAgentSteerQueue';
import { STEER_PERSIST_PREFIX } from './agentStore/constants';

export const useAgentStore = defineStore('agent', () => {
  const agentTransitions = useAgentTransitions();

  const activeSessionId = ref<string | null>(null);
  const currentSession = ref<IAgentSession | null>(null);
  const sessionList = ref<ISessionsListItem[]>([]);
  const sessions = ref<Record<string, IAgentSession>>({});
  const adminforth = useAdminforth();
  const isChatOpen = ref(false);
  const isSessionHistoryOpen = ref(false);
  const router = useRouter();
  const textInput = ref<HTMLTextAreaElement | null>(null);
  const userMessageInput = ref();
  const trimmedUserMessage = computed(() => userMessageInput.value ? userMessageInput.value.trim() : '');
  // Message-edit state. `editingEnabled` mirrors the server capability (checkpointer +
  // turn checkpoints). While a message is being edited its id/turnId are held here and
  // the user's in-progress input is stashed in `savedUserInput` so it can be restored.
  const editingEnabled = ref(false);
  const editingMessageId = ref<string | null>(null);
  const editingMessageTurnId = ref<string | null>(null);
  const savedUserInput = ref('');
  const isEditingMessage = computed(() => editingMessageId.value !== null);
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
    submitToolApproval: submitToolApprovalResponse,
    sendEditMessage,
  } = createAgentChatManager({
    lastMessage,
    activeModeName,
    onOpenPage: openAgentPage,
    onToolApprovalRequest: addToolApprovalMessage,
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

  function getToolApprovalMessages(interrupt: unknown): string[] {
    const interrupts = Array.isArray(interrupt) ? interrupt : [interrupt];

    return interrupts.flatMap((item: any) => {
      const value = item?.value ?? item;
      const actionRequests = Array.isArray(value?.actionRequests) ? value.actionRequests : [];

      return actionRequests.map((actionRequest: any) => (
        typeof actionRequest?.description === 'string'
          ? actionRequest.description
          : String(actionRequest?.name ?? 'Tool execution pending approval')
      ));
    });
  }

  function addToolApprovalMessage(sessionId: string, interrupt: unknown) {
    const approvalPart = {
      type: 'data-tool-approval' as const,
      data: {
        sessionId,
        status: 'pending' as const,
        messages: getToolApprovalMessages(interrupt),
      },
    };
    const lastChatMessage = currentChat.value?.lastMessage;

    if (lastChatMessage?.role === 'assistant') {
      lastChatMessage.parts.push(approvalPart);
      currentChat.value?.messages.splice(currentChat.value.messages.length - 1, 1, lastChatMessage);
      return;
    }

    currentChat.value?.messages.push({
      role: 'assistant',
      parts: [approvalPart],
    });
  }

  async function submitToolApproval(sessionId: string, decision: 'approve' | 'reject') {
    const message = currentChat.value?.messages
      .findLast(candidate => candidate.role === 'assistant' && candidate.parts.some(part => {
        return part.type === 'data-tool-approval'
          && part.data?.sessionId === sessionId
          && part.data?.status === 'pending';
      }));
    const approvalPart = message?.parts.find(part => {
      return part.type === 'data-tool-approval'
        && part.data?.sessionId === sessionId
        && part.data?.status === 'pending';
    });

    if (approvalPart?.data) {
      approvalPart.data.status = 'processing';
    }

    try {
      await submitToolApprovalResponse(sessionId, decision);

      if (approvalPart?.data) {
        approvalPart.data.status = decision === 'approve' ? 'approved' : 'rejected';
      }
    } catch (error) {
      if (approvalPart?.data) {
        approvalPart.data.status = 'pending';
      }
      console.error('Error submitting tool approval', error);
    }
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
  const hasPendingToolApproval = computed(() => (
    currentChat.value?.messages.some((message: any) => (
      message.role === 'assistant'
      && message.parts.some((part: any) => (
        part.type === 'data-tool-approval'
        && (part.data?.status === 'pending' || part.data?.status === 'processing')
      ))
    )) ?? false
  ));
  const isMessageInputBlocked = computed(() => (
    isResponseInProgress.value || hasPendingToolApproval.value
  ));
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
    isMessageInputBlocked,
    userMessageInput,
    lastMessage,
    blockCloseOfChat,
    adminforth,
    setCurrentChat,
  });

  // "Turn active" = a request is in flight (submitted or streaming) or paused for HITL
  // approval. Messages submitted during this window are buffered rather than sent.
  const isTurnActive = computed(() => {
    const status = (currentChat.value as any)?.status;
    return status === 'submitted' || status === 'streaming' || hasPendingToolApproval.value;
  });

  const steerBuffer = createAgentSteerQueue({
    activeSessionId,
    currentChat,
    sendMessage,
  });

  // Submitting while a turn is active buffers the message (it shows up in the steer
  // queue, where the user can steer it or let it send); otherwise it sends right away.
  function submitUserMessage() {
    const message = trimmedUserMessage.value;
    if (!message) {
      return;
    }
    if (isTurnActive.value) {
      steerBuffer.enqueue(message);
      userMessageInput.value = '';
      return;
    }
    return sendMessage();
  }

  // When the active turn finishes, drain the next buffered message as a normal send
  // (one per turn, FIFO). Messages the user explicitly steered were already removed.
  watch(isTurnActive, (active: boolean, wasActive: boolean) => {
    if (wasActive && !active) {
      steerBuffer.flushNext();
    }
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
    // The edited message lives in the outgoing session's chat, so drop edit mode.
    if (editingMessageId.value !== null) {
      exitEditMode();
    }
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
      let isTeleportedToBodyFromLocalStorage = true;
      if (savedIsTeleportedToBody !== null || savedIsTeleportedToBodyBeforeFullScreen !== null) {
        isTeleportedToBodyFromLocalStorage = savedIsTeleportedToBody === 'true' || savedIsTeleportedToBodyBeforeFullScreen === 'true';
      }
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

  function setEditingEnabled(enabled: boolean) {
    editingEnabled.value = enabled;
  }


  function getCompiledMessageTextWithSteeredParts(message: any): string {
    const currentTurnUserMessages = currentChat.value?.messages.filter((msg: any) => msg.metadata?.turnId === message?.metadata?.turnId && msg.role === 'user');
    let messageToCompile = '';
    for(const msg of currentTurnUserMessages) {
      const text = (msg.parts ?? [])
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text ?? '')
        .join('');
      messageToCompile += text + ' ';
    }
    return messageToCompile.trim();
  }
  // Enter edit mode for a user message: stash the current input, then load the
  // message's text into the textarea for the user to amend. Allowed mid-generation —
  // committing the edit stops the running turn (see submitEditMessage).
  function startEditMessage(message: any) {
    if (!editingEnabled.value) {
      return;
    }
    const turnId = message?.metadata?.turnId;
    const messageId = message?.id;
    if (!turnId || !messageId) {
      return;
    }
    if (editingMessageId.value === null) {
      savedUserInput.value = userMessageInput.value ?? '';
    }
    const text = getCompiledMessageTextWithSteeredParts(message);
    editingMessageId.value = messageId;
    editingMessageTurnId.value = turnId;
    userMessageInput.value = text;
    nextTick(() => focusTextInput());
  }

  // Leave edit mode and restore whatever the user had been typing before.
  function exitEditMode() {
    userMessageInput.value = savedUserInput.value;
    savedUserInput.value = '';
    editingMessageId.value = null;
    editingMessageTurnId.value = null;
  }

  function cancelEditMessage() {
    if (editingMessageId.value === null) {
      return;
    }
    exitEditMode();
    nextTick(() => focusTextInput());
  }

  async function submitEditMessage(): Promise<boolean> {
    if (editingMessageId.value === null) {
      return false;
    }
    const text = trimmedUserMessage.value;
    if (!text) {
      return false;
    }
    const messageId = editingMessageId.value;
    const turnId = editingMessageTurnId.value!;
    steerBuffer.clear();
    // Restore the stashed input and leave edit mode before the regeneration streams in.
    exitEditMode();
    const lastMessageText = getCompiledMessageTextWithSteeredParts(currentChat.value?.messages.find((m: any) => m.id === messageId));
    if (lastMessageText.trim() === text.trim()) {
      return false;
    }
    await sendEditMessage({ messageId, turnId, text });
    return true;
  }

  function resolveInternalRoute(href: string): string | null {
    if (href.startsWith('#')) {
      return `${window.location.pathname}${window.location.search}${href}`;
    }

    if (href.startsWith('//')) {
      return null;
    }

    const isAbsoluteWithScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href);
    const baseUrl = isAbsoluteWithScheme
      ? undefined
      : `${window.location.origin}/`;
    const resolvedUrl = new URL(href, baseUrl ?? window.location.href);

    if (resolvedUrl.origin !== window.location.origin) {
      return null;
    }

    return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
  }

  function openAgentPage(targetPath: string) {
    const internalRoute = resolveInternalRoute(targetPath);

    if (internalRoute === null) {
      console.warn('Ignoring external agent navigation target:', targetPath);
      return;
    }

    if (isFullScreen.value && !coreStore.isMobile) {
      setFullScreen(false);
    } else if (coreStore.isMobile) {
      setIsChatOpen(false);
    }

    void router.push(internalRoute);
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
    submitToolApproval,
    userMessageInput,
    userMessagePlaceholder,
    chatMessages: computed(() => currentChat.value?.messages || []),
    trimmedUserMessage,
    isResponseInProgress,
    hasPendingToolApproval,
    isMessageInputBlocked,
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
    //_________-Message editing-_____________
    editingEnabled,
    setEditingEnabled,
    isEditingMessage,
    editingMessageId,
    editingMessageTurnId,
    startEditMessage,
    cancelEditMessage,
    submitEditMessage,
    //_______________________________________
    addSystemMessage,
    isAudioChatMode,
    setIsAudioChatMode,
    registerOnBeforeChatCloseCallback,
    addAgentMessage,
    addUserMessage,
    addDataToolCallMessage,
    openAgentPage,
    setCurrentChatStatus,
    updateLastAgentMessage,
    //_________-Steer queue-_____________
    submitUserMessage,
    isTurnActive,
    steerQueue: steerBuffer.queue,
    steerQueuedMessage: steerBuffer.steerQueuedMessage,
    removeQueuedMessage: steerBuffer.removeQueuedMessage,
    enqueueSteerMessage: steerBuffer.enqueue,
    //___________________________________
  }
})
