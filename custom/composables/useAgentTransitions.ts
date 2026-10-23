import { defineStore } from 'pinia';
import { useAgentStore } from './useAgentStore';
import { getLayoutElements } from '../utils';


export const useAgentTransitions = defineStore('agentTransitions', () => {
  const TRANSITION_DURATION = 300;

  const agentStore = useAgentStore();

  // elements are looked up on every call, the header and the chat surface are re-created after a re-login
  function setAppRootTransition(blockTransition = true) {
    const transition = blockTransition ? '' : `padding-right ${TRANSITION_DURATION}ms ease-in-out`;
    for (const element of getLayoutElements()) {
      element.style.transition = transition;
    }
  }
  function setChatSurfaceTransition(blockTransition = true) {
    const chatRoot = document.getElementById('adminforth-agent-chat-surface')!;
    if (blockTransition) {
      chatRoot.style.transition = '';
    } else {
      chatRoot.style.transition = `
        transform ${TRANSITION_DURATION}ms ease-in-out,
        width ${TRANSITION_DURATION}ms ease-in-out
      `;
    }
  }
  return {
    TRANSITION_DURATION,
    setAppRootTransition,
    setChatSurfaceTransition
  }
});