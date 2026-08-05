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
  isFinalResponseStreaming: Ref<boolean>;
  sendMessage: (text: string) => void | Promise<void>;
};

export function createAgentSteerQueue({
  activeSessionId,
  currentChat,
  isFinalResponseStreaming,
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

  // Break the assistant's live stream at the steer point: freeze whatever streamed so far
  // (e.g. the current reasoning block), drop the steer message in, and let the rest stream
  // into a fresh assistant message after it — so the conversation reads
  // "reasoning block → steer → new reasoning block" instead of the steer landing next to
  // the user's original prompt.
  //
  // This reaches into the AI SDK's in-flight streaming state (`chat.activeResponse`):
  //  - reasoning/text parts are looked up by id reference in `active*Parts`, so pointing
  //    those entries at fresh (empty) parts redirects subsequent deltas past the steer;
  //  - the stream writer pushes a *new* message whenever `state.message.id` no longer
  //    matches the last displayed message, so swapping in a new `message` splits the bubble
  //    without duplicating the frozen block.
  // If that internal shape isn't present (not streaming, or a future SDK change), we fall
  // back to inserting the steer just above the streaming assistant.
  async function injectSteerMessage(text: string) {
    const chat = currentChat.value;
    if (!chat) {
      return;
    }
    const steerMessage: IMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      metadata: { steer: true },
      parts: [{ type: 'text', text, state: 'done' }],
    };
    const messages = chat.messages;

    if (breakStreamWithSteer(chat, messages, steerMessage)) {
      return;
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'assistant') {
      messages.splice(messages.length - 1, 0, steerMessage);
    } else {
      messages.push(steerMessage);
    }
  }

  function breakStreamWithSteer(chat: Chat<any>, messages: any[], steerMessage: IMessage): boolean {
    try {
      const streamingState = (chat as any).activeResponse?.state;
      const streamingMessage = streamingState?.message;
      const lastIndex = messages.length - 1;
      const lastMessage = messages[lastIndex];
      const isStreamingIntoLastAssistant =
        streamingMessage?.role === 'assistant'
        && Array.isArray(streamingMessage.parts)
        && streamingMessage.parts.length > 0
        && lastMessage?.role === 'assistant';

      if (!isStreamingIntoLastAssistant) {
        return false;
      }

      // 1) Freeze block 1 as a fresh, decoupled assistant message. Copying the parts (and
      //    reassigning the array slot) detaches it from the SDK's live parts and forces a
      //    re-render so the block stops showing as "streaming".
      const frozenParts = streamingMessage.parts.map((part: any) => ({
        ...part,
        state: part?.state === 'streaming' ? 'done' : part?.state,
      }));
      messages[lastIndex] = { ...streamingMessage, parts: frozenParts };
      // 2) Redirect the SDK's in-flight reasoning/text parts into a fresh continuation
      //    message so subsequent deltas (resolved by id reference) land after the steer.
      const continuation: any = { id: crypto.randomUUID(), role: 'assistant', parts: [] };
      const redirectActiveParts = (activeParts: Record<string, any> | undefined) => {
        if (!activeParts) {
          return;
        }
        for (const id of Object.keys(activeParts)) {
          const continued = { ...activeParts[id], text: '', state: 'streaming' };
          activeParts[id] = continued;
          continuation.parts.push(continued);
        }
      };
      redirectActiveParts(streamingState.activeReasoningParts);
      redirectActiveParts(streamingState.activeTextParts);

      // 3) Hand the SDK the continuation as its streaming message; its next write() pushes
      //    it as a new assistant bubble. Slot the steer between the frozen block and it.
      streamingState.message = continuation;
      messages.push(steerMessage);
      return true;
    } catch (error) {
      console.error('Steer stream-break failed, inserting steer inline instead', error);
      return false;
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
    // A steer is only consumed before a subsequent model call. Once the assistant is
    // streaming its final text there is no such call left, so retain this item for the
    // normal FIFO follow-up instead of silently losing the instruction server-side.
    if (!item || !sessionId || sessionId === PRE_SESSION_ID || isFinalResponseStreaming.value) {
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

  function clear() {
    queue.value = [];
  }

  return {
    queue,
    enqueue,
    removeQueuedMessage,
    steerQueuedMessage,
    flushNext,
    clear,
  };
}
