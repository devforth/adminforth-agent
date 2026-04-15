import { defineStore } from 'pinia';
import { IAgentSession, ISessionsListItem } from './types';
import { ref } from 'vue';
import { callAdminForthApi } from '@/utils';

export const useAgentStore = defineStore('agent', () => {
  const activeSessionId = ref<string | null>(null);
  const currentSession = ref<IAgentSession | null>(null);
  const sessionList = ref<ISessionsListItem[]>([]);
  const sessions = ref<Record<string, IAgentSession>>({});

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
    deleteSession
  }
})