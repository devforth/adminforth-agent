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
};

export function createAgentChatManager({
  lastMessage,
  activeModeName,
  onOpenPage,
}: CreateAgentChatManagerOptions) {
  const chats = new Map<string, Chat<any>>();
  const currentChat = shallowRef<Chat<any> | null>();

  function setCurrentChat(sessionId: string) {
    if (chats.has(sessionId)) {
      currentChat.value = chats.get(sessionId) || null;
    } else {
      const newChat = new Chat({
        transport: new DefaultChatTransport({
          api: `${(import.meta as AgentImportMeta).env.VITE_ADMINFORTH_PUBLIC_PATH || ''}/adminapi/v1/agent/response`,
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
        onData(dataPart: any) {
          if (dataPart?.type === 'data-open-page' && typeof dataPart.data?.targetPath === 'string') {
            onOpenPage(dataPart.data.targetPath);
          }
        },
      });
      chats.set(sessionId, newChat);
      currentChat.value = newChat;
    }
  }

  function abortCurrentChatRequest() {
    currentChat.value?.stop();
  }

  return {
    currentChat,
    setCurrentChat,
    abortCurrentChatRequest,
  };
}
