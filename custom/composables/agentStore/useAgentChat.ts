import { DefaultChatTransport } from 'ai';
import { shallowRef, type Ref } from 'vue';
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

  function handleRealtimeChatData(dataPart: any) {
    if (dataPart?.type === 'data-open-page' && typeof dataPart.data?.targetPath === 'string') {
      onOpenPage(dataPart.data.targetPath);
      return;
    }

    if (dataPart?.type === 'data-interrupt' && typeof dataPart.data?.sessionId === 'string') {
      onToolApprovalRequest(dataPart.data.sessionId, dataPart.data.interrupt);
    }
  }

  function handleManualApprovalStreamPart(dataPart: any) {
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
            const body = {
              message,
              sessionId,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              mode: activeModeName.value,
              currentPage: getCurrentPageContext(),
            };

            return {
              headers: {
                Accept: 'text/event-stream',
                'x-vercel-ai-ui-message-stream': 'v1',
              },
              body
            };
          }
        }),
        onError(error: unknown) {
          console.error('Chat error:', error);
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
  };
}
