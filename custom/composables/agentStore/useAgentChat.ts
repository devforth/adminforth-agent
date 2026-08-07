import { DefaultChatTransport } from 'ai';
import { ref, shallowRef, watch, type Ref } from 'vue';
import { Chat } from '../../chat';
import { getCurrentPageContext } from './pageContext';
// const { DefaultChatTransport } = await import('ai');

type AgentImportMeta = ImportMeta & {
  env: {
    VITE_ADMINFORTH_PUBLIC_PATH?: string;
  };
};

type CreateAgentChatManagerOptions = {
  lastMessage: Ref<string>;
  activeModeName: Ref<string | null>;
  onOpenPage: (targetPath: string) => void;
  onToolApprovalRequest: (sessionId: string, interrupt: unknown) => void;
};

export function createAgentChatManager({
  lastMessage,
  activeModeName,
  onOpenPage,
  onToolApprovalRequest,
}: CreateAgentChatManagerOptions) {
  const chats = new Map<string, Chat<any>>();
  const currentChat = shallowRef<Chat<any> | null>();
  const editingTurnId = ref<string | null>(null);
  const agentApiBase = `${(import.meta as AgentImportMeta).env.VITE_ADMINFORTH_PUBLIC_PATH || ''}/adminapi/v1/agent`;

  function replaceLastMessage(message: any) {
    const chat = currentChat.value;

    if (!chat) {
      return;
    }

    chat.messages.splice(chat.messages.length - 1, 1, message);
  }

  function getOrCreateAssistantMessage() {
    const chat = currentChat.value;
    const lastChatMessage = chat?.lastMessage;

    if (lastChatMessage?.role === 'assistant') {
      return lastChatMessage;
    }

    const assistantMessage = {
      role: 'assistant',
      parts: [],
    };

    chat?.messages.push(assistantMessage);
    return assistantMessage;
  }

  function appendTextDelta(delta: string) {
    const assistantMessage = getOrCreateAssistantMessage();
    const lastPart = assistantMessage.parts.at(-1);

    if (lastPart?.type === 'text') {
      lastPart.text = `${lastPart.text ?? ''}${delta}`;
      lastPart.state = 'streaming';
    } else {
      assistantMessage.parts.push({
        type: 'text',
        text: delta,
        state: 'streaming',
      });
    }

    replaceLastMessage(assistantMessage);
  }

  function finishTextPart() {
    const assistantMessage = currentChat.value?.lastMessage;
    const lastPart = assistantMessage?.parts.at(-1);

    if (assistantMessage?.role === 'assistant' && lastPart?.type === 'text') {
      lastPart.state = 'done';
      replaceLastMessage(assistantMessage);
    }
  }

  function appendDataPart(type: string, data: unknown) {
    const assistantMessage = getOrCreateAssistantMessage();

    assistantMessage.parts.push({ type, data });
    replaceLastMessage(assistantMessage);
  }

  // Stamp the just-finished turn's id onto its prompt message so it becomes editable
  // without a session reload. The prompt is the last user message that isn't a
  // mid-turn steer.
  function tagCurrentTurnPrompt(turnId: string) {
    const messages = currentChat.value?.messages;
    if (!messages) {
      return;
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === 'user') {
        messages.splice(i, 1, {
          ...message,
          metadata: { ...(message.metadata ?? {}), turnId },
        });
        if (!message.metadata?.steer) {
          return;
        }
      }
    }
  }

  function handleRealtimeChatData(dataPart: any) {
    if (dataPart?.type === 'data-open-page' && typeof dataPart.data?.targetPath === 'string') {
      onOpenPage(dataPart.data.targetPath);
      return;
    }

    if (dataPart?.type === 'data-interrupt' && typeof dataPart.data?.sessionId === 'string') {
      onToolApprovalRequest(dataPart.data.sessionId, dataPart.data.interrupt);
      return;
    }

    // `data-turn-persisted` arrives at turn start, `data-response` at turn end — either
    // way, stamp the prompt with its turn id so it can be edited.
    if (
      (dataPart?.type === 'data-turn-persisted' || dataPart?.type === 'data-response')
      && typeof dataPart.data?.turnId === 'string'
    ) {
      tagCurrentTurnPrompt(dataPart.data.turnId);
    }
  }

  function handleManualApprovalStreamPart(dataPart: any) {
    if (dataPart?.type === 'error') {
      const error = dataPart.errorText ?? dataPart.error;
      throw new Error(typeof error === 'string' && error ? error : 'Agent approval failed');
    }

    if (dataPart?.type === 'text-delta' && typeof dataPart.delta === 'string') {
      appendTextDelta(dataPart.delta);
      return;
    }

    if (dataPart?.type === 'text-end') {
      finishTextPart();
      return;
    }

    if (dataPart?.type === 'data-tool-call') {
      appendDataPart('data-tool-call', dataPart.data);
      return;
    }

    if (dataPart?.type === 'data-rendering') {
      appendDataPart('data-rendering', dataPart.data);
      return;
    }

    if (dataPart?.type === 'data-open-page' && typeof dataPart.data?.targetPath === 'string') {
      onOpenPage(dataPart.data.targetPath);
      return;
    }

    if (dataPart?.type === 'data-interrupt' && typeof dataPart.data?.sessionId === 'string') {
      onToolApprovalRequest(dataPart.data.sessionId, dataPart.data.interrupt);
      return;
    }

    if (
      (dataPart?.type === 'data-turn-persisted' || dataPart?.type === 'data-response')
      && typeof dataPart.data?.turnId === 'string'
    ) {
      tagCurrentTurnPrompt(dataPart.data.turnId);
    }
  }

  async function consumeAgentStream(response: Response) {
    const reader = response.body?.getReader();

    if (!reader) {
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        const data = event
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
          .join('\n');

        if (!data || data === '[DONE]') {
          continue;
        }

        handleManualApprovalStreamPart(JSON.parse(data));
      }
    }
  }

  function setCurrentChat(sessionId: string) {
    if (chats.has(sessionId)) {
      currentChat.value = chats.get(sessionId) || null;
    } else {
      const newChat = new Chat({
        transport: new DefaultChatTransport({
          api: `${agentApiBase}/response`,
          credentials: 'include',
          prepareSendMessagesRequest({ messages }: any) {
            const message = lastMessage.value;
            const headers = {
              Accept: 'text/event-stream',
              'x-vercel-ai-ui-message-stream': 'v1',
            };
            const body: Record<string, any> = {
              message,
              sessionId,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              mode: activeModeName.value,
              currentPage: getCurrentPageContext(),
            };

            // Editing an existing message branches from its turn: hit /edit, which
            // truncates every turn after `turnId` and regenerates from that point.
            if (editingTurnId.value) {
              body.turnId = editingTurnId.value;
              return {
                api: `${agentApiBase}/edit`,
                headers,
                body,
              };
            }

            return {
              headers,
              body,
            };
          }
        }),
        onError(error: unknown) {
          console.error('Chat error:', error);
          appendTextDelta(`Error: ${error instanceof Error ? error.message : String(error)}`);
        },
        onData: handleRealtimeChatData,
      });
      chats.set(sessionId, newChat);
      currentChat.value = newChat;
    }
  }

  function abortCurrentChatRequest() {
    currentChat.value?.stop();
  }

  function isChatBusy() {
    const status = (currentChat.value as any)?.status;
    return status === 'streaming' || status === 'submitted';
  }

  async function stopActiveTurnAndWaitForIdle() {
    const chat = currentChat.value;
    if (!chat || !isChatBusy()) {
      return;
    }
    await chat.stop();
    if (!isChatBusy()) {
      return;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      let stopWatch = () => {};
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        stopWatch();
        resolve();
      };
      // Safety valve so a stuck status can never hang the edit indefinitely.
      const timer = setTimeout(finish, 3000);
      stopWatch = watch(
        () => (currentChat.value as any)?.status,
        () => {
          if (!isChatBusy()) {
            finish();
          }
        },
      );
    });
  }

  // Replace the target user message in place and regenerate from it. The SDK's
  // `sendMessage({ messageId })` truncates every message after the replaced one
  // (mirroring the server-side truncate), and `editingTurnId` routes the request
  // to /edit for the matching turn. If a turn is still generating it is stopped
  // first so the edit supersedes it.
  async function sendEditMessage({ messageId, turnId, text }: { messageId: string; turnId: string; text: string; }) {
    const chat = currentChat.value;
    if (!chat) {
      return;
    }
    await stopActiveTurnAndWaitForIdle();
    // The edited text already folds in the turn's steer sub-messages, so drop those extra
    // user messages first — otherwise they linger after the edit as duplicate bubbles.
    const withoutTurnSteers = chat.messages.filter((message: any) =>
      message.id === messageId
      || message.role !== 'user'
      || message.metadata?.turnId !== turnId
    );
    if (withoutTurnSteers.length !== chat.messages.length) {
      chat.messages = withoutTurnSteers;
    }
    editingTurnId.value = turnId;
    lastMessage.value = text;
    try {
      await chat.sendMessage({ text, messageId, metadata: { turnId } });
    } finally {
      editingTurnId.value = null;
    }
  }

  async function submitToolApproval(sessionId: string, decision: 'approve' | 'reject') {
    const response = await fetch(`${agentApiBase}/approval`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        'x-vercel-ai-ui-message-stream': 'v1',
      },
      body: JSON.stringify({
        sessionId,
        decision,
        mode: activeModeName.value,
      }),
    });

    if (!response.ok) {
      throw new Error(`Agent approval failed with status ${response.status}`);
    }

    await consumeAgentStream(response);
  }

  return {
    currentChat,
    setCurrentChat,
    abortCurrentChatRequest,
    submitToolApproval,
    sendEditMessage,
  };
}
