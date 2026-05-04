import type { ComputedRef, Ref, ShallowRef } from 'vue';
import { callAdminForthApi } from '@/utils';
import type { Chat } from '../../chat';
import type { IAgentSession, ISessionsListItem, IPart } from '../../types';

type AdminforthLike = {
  confirm(options: { message: string; yes: string; no: string }): Promise<boolean>;
};

type CreateAgentSessionManagerOptions = {
  activeSessionId: Ref<string | null>;
  currentSession: Ref<IAgentSession | null>;
  sessionList: Ref<ISessionsListItem[]>;
  sessions: Ref<Record<string, IAgentSession>>;
  currentChat: ShallowRef<Chat<any> | null | undefined>;
  trimmedUserMessage: ComputedRef<string>;
  isResponseInProgress: ComputedRef<boolean>;
  userMessageInput: Ref<any>;
  lastMessage: Ref<string>;
  blockCloseOfChat: Ref<boolean>;
  adminforth: AdminforthLike;
  setCurrentChat: (sessionId: string) => void;
};

export function createAgentSessionManager({
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
}: CreateAgentSessionManagerOptions) {
  function sortSessionsListByTimestamp(sessionsListToSort: ISessionsListItem[]) {
    return [...sessionsListToSort].sort((a: ISessionsListItem, b: ISessionsListItem) => b.timestamp.localeCompare(a.timestamp));
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

  async function setActiveSession(sessionId: string) {
    activeSessionId.value = sessionId;
    saveCurrentSessionInCache();
    if (!sessions.value[sessionId]) {
      await fetchSession(sessionId);
    }
    currentSession.value = sessions.value[sessionId];
    setCurrentChat(sessionId);
    if (currentChat.value.messages.length === 0) {
      currentChat.value.messages = currentSession.value?.messages.map((m: any) => ({
        role: m.role,
        parts:[{
          type: 'text',
          text: m.text,
          state: 'done',
        }]
      }));
    }
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

  async function deleteSession(sessionId: string) {
    if (sessionId === 'pre-session') {
      deletePreSession();
      return;
    }
    blockCloseOfChat.value = true;
    const isConfirmed = await adminforth.confirm({message: 'Are you sure, that you want to delete this session?', yes: 'Yes', no: 'No'});
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

  async function fetchSessionsList() {
    try {
      const res = await callAdminForthApi({
        method: 'POST',
        path: '/agent/get-sessions',
        body: {
          limit: 100,
        },
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

  function addDebugMessage(message: string) {
    const debugMessage = {
      role: 'assistant',
      parts: [{
        type: 'text',
        text: message,
        state: 'done',
      }]
    };
    currentChat.value?.messages.push(debugMessage);
  }

  function addSystemMessage(message: string) {
    const systemMessage = {
      role: 'system',
      parts: [{
        type: 'text',
        text: message,
        state: 'done',
      }]
    };
    currentChat.value?.messages.push(systemMessage);
    try {
      const res = callAdminForthApi({
        method: 'POST',
        path: '/agent/add-system-message-to-turns',
        body: {
          sessionId: activeSessionId.value,
          systemMessage: message,
        },
      });
    } catch (error) {
      console.error('Error adding system message', error);
    }
  }

  function addAgentMessage(message: string) {
    const agentMessage = {
      role: 'assistant',
      parts: [{
        type: 'text',
        text: message,
        state: 'done',
      }]
    };
    currentChat.value?.messages.push(agentMessage);
  }

  function addUserMessage(message: string) {
    const userMessage = {
      role: 'user',
      parts: [{
        type: 'text',
        text: message,
        state: 'done',
      }]
    };
    currentChat.value?.messages.push(userMessage);
  }

  return {
    sendMessage,
    createPreSession,
    setActiveSession,
    fetchSessionsList,
    deleteSession,
    addDebugMessage,
    addSystemMessage,
    addAgentMessage,
    addUserMessage,
  };
}