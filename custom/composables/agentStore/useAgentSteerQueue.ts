import type { Ref, ShallowRef } from 'vue';
import { ref } from 'vue';
import { callAdminForthApi } from '@/utils';
import type { Chat } from '../../chat';
import type { IMessage } from '../../types';
import { PRE_SESSION_ID } from './constants';

export type QueuedMessage = {
  id: string;
  text: string;
};

type CreateAgentSteerQueueOptions = {
  activeSessionId: Ref<string | null>;
  currentChat: ShallowRef<Chat<any> | null | undefined>;
  sendMessage: (text: string) => void | Promise<void>;
};

export function createAgentSteerQueue({
  activeSessionId,
  currentChat,
  sendMessage,
}: CreateAgentSteerQueueOptions) {
  const queue = ref<QueuedMessage[]>([]);

  function enqueue(text: string) {
    const message = text.trim();
    if (!message) {
      return;
    }
    queue.value.push({ id: crypto.randomUUID(), text: message });
  }

  function removeQueuedMessage(id: string) {
    queue.value = queue.value.filter((item: QueuedMessage) => item.id !== id);
  }

  function injectSteerMessage(text: string) {
    const chat = currentChat.value;
    if (!chat) {
      return;
    }
    const steerMessage: IMessage = {
      role: 'user',
      metadata: { steer: true },
      parts: [{ type: 'text', text, state: 'done' }],
    };
    const messages = chat.messages;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'assistant') {
      messages.splice(messages.length - 1, 0, steerMessage);
    } else {
      messages.push(steerMessage);
    }
  }

  // Persist the steer by appending it onto the running turn's prompt (display only — the
  // LLM already has it via the running turn + checkpointer, so this never re-enters the
  // model context). The backend adds the marker; the reload path splits it back out.
  async function persistSteerMessage(sessionId: string, text: string) {
    try {
      const res = await callAdminForthApi({
        method: 'POST',
        path: '/agent/append-steer-to-turn',
        body: { sessionId, message: text },
      });
      if (res?.error) {
        console.error('Error persisting steer message:', res.error);
      }
    } catch (error) {
      console.error('Error persisting steer message', error);
    }
  }

  async function steerQueuedMessage(id: string) {
    const item = queue.value.find((candidate: QueuedMessage) => candidate.id === id);
    const sessionId = activeSessionId.value;
    if (!item || !sessionId || sessionId === PRE_SESSION_ID) {
      return;
    }
    removeQueuedMessage(id);
    injectSteerMessage(item.text);
    void persistSteerMessage(sessionId, item.text);

    try {
      const res = await callAdminForthApi({
        method: 'POST',
        path: '/agent/steer',
        body: { sessionId, message: item.text },
      });
      if (res?.error) {
        console.error('Error steering agent:', res.error);
      }
    } catch (error) {
      console.error('Error steering agent', error);
    }
  }

  function flushNext() {
    const next = queue.value.shift();
    if (!next) {
      return;
    }
    void sendMessage(next.text);
  }

  return {
    queue,
    enqueue,
    removeQueuedMessage,
    steerQueuedMessage,
    flushNext,
  };
}
