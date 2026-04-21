import { defineStore } from 'pinia';
import { ref, nextTick,onMounted } from 'vue';
import { useAgentStore } from './useAgentStore';


export const useAgentTransitions = defineStore('agentTransitions', () => {
  const TRANSITION_DURATION = 200;

  const agentStore = useAgentStore();
  const appRoot = ref<HTMLElement | null>(null);
  const header = ref<HTMLElement | null>(null);

  const chatRoot = ref<HTMLElement | null>(null);

  onMounted(() => {
    appRoot.value = document.getElementById('app');
    header.value = document.getElementById('af-header-nav');
    chatRoot.value = document.getElementById('adminforth-agent-chat-surface');
    if (appRoot.value && header.value) {
      nextTick(() => {
        setAppRootTransition(false);
      });
    }  
    if (chatRoot.value) {
      nextTick(() => {
        setChatSurfaceTransition(false);
      });
    }
  });
  function setAppRootTransition(blockTransition = true) {
    if (appRoot.value && header.value) {
      if (blockTransition) {
        appRoot.value.style.transition = '';
        header.value.style.transition = '';
      } else {
        appRoot.value.style.transition = `padding-right ${TRANSITION_DURATION}ms ease-in-out`;
        header.value.style.transition = `padding-right ${TRANSITION_DURATION}ms ease-in-out`;
      }
    }
  }
  function setChatSurfaceTransition(blockTransition = true) {
    if (chatRoot.value) {
      if (blockTransition) {
        chatRoot.value.style.transition = '';
      } else {
        chatRoot.value.style.transition = `
          transform ${TRANSITION_DURATION}ms ease-in-out, 
          width ${TRANSITION_DURATION}ms ease-in-out
        `;
      }
    }
  }
  return {
    TRANSITION_DURATION,
    setAppRootTransition,
    setChatSurfaceTransition
  }
});