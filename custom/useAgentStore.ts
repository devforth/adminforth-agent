import { defineStore } from 'pinia';
import { IAgentSession, ISessionsListItem } from './types';
import { ref } from 'vue';

export const useAgentStore = defineStore('agent', () => {
  const activeSessionId = ref<string | null>(null);
  const currentSession = ref<IAgentSession | null>(null);
  const sessionList = ref<ISessionsListItem[]>([]);
  const sessions = ref<Record<string, IAgentSession>>({});

  function createNewSession() {
    console.log('Creating new session');
  }

  function fetchSession(sessionId: string) {
    console.log('Fetching session', sessionId);
  }

  async function setActiveSession(sessionId: string) {
    activeSessionId.value = sessionId;
    if (!sessions.value[sessionId]) {
      await fetchSession(sessionId);    
    }
    currentSession.value = sessions.value[sessionId];
  }

  async function fetchSessionsList() {
    console.log('Fetching sessions list');
    sessionList.value = [
      { sessionId: '1', title: 'Session 1' },
      { sessionId: '2', title: 'Session 2' },
      { sessionId: '3', title: 'Session 3' },
    ];
  }

  return {
    activeSessionId,
    currentSession,
    sessions,
    sessionList,
    createNewSession,
    setActiveSession,
    fetchSessionsList

  }
})