import { ref, watch, type Ref } from 'vue';
import { callAdminForthApi } from '@/utils';
import {
  DEFAULT_TEXTAREA_PLACEHOLDER,
  PLACEHOLDER_DELETING_DELAY_MS,
  PLACEHOLDER_HOLD_DELAY_MS,
  PLACEHOLDER_TYPING_DELAY_MS,
} from './constants';

type CreateAgentPlaceholderControllerOptions = {
  userMessageInput: Ref<unknown>;
};

export function createAgentPlaceholderController({
  userMessageInput,
}: CreateAgentPlaceholderControllerOptions) {
  const userMessagePlaceholder = ref(DEFAULT_TEXTAREA_PLACEHOLDER);
  const placeholderMessages = ref<string[]>([]);
  const hasTypedMessageInPageSession = ref(false);

  let placeholderAnimationTimer: ReturnType<typeof setTimeout> | null = null;

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

  watch(userMessageInput, (newVal: unknown) => {
    if (hasTypedMessageInPageSession.value) {
      return;
    }

    if (typeof newVal === 'string' && newVal.trim() !== '') {
      hasTypedMessageInPageSession.value = true;
      stopPlaceholderAnimation();
    }
  });

  return {
    userMessagePlaceholder,
    hasTypedMessageInPageSession,
    fetchPlaceholderMessages,
    stopPlaceholderAnimation,
  };
}