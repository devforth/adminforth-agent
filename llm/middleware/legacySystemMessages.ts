import { createMiddleware } from "langchain";

type LangChainMessageLike = {
  content?: unknown;
  text?: string;
  type?: string;
  getType?: () => string;
  _getType?: () => string;
};

type LangChainModelCallRequest = {
  messages: LangChainMessageLike[];
};

function isSystemMessage(message: LangChainMessageLike): boolean {
  return (
    message._getType?.() === "system" ||
    message.getType?.() === "system" ||
    message.type === "system"
  );
}

/**
 * Migration shield for threads checkpointed before the system prompt moved out of the
 * message history.
 *
 * Turns used to be started with `[SystemMessage, HumanMessage]`, so every such turn left
 * a system message inside the thread's persisted state. Those messages are still in old
 * checkpoints and would now arrive mid-history — both an invalid shape for providers that
 * take the system prompt out-of-band, and a stale duplicate of a prompt the agent already
 * supplies. So they are dropped, not re-hoisted: the authoritative prompt is
 * `createAgent({ systemPrompt })` plus DynamicSystemPromptMiddleware.
 *
 * Nothing writes system messages into state any more, so for new threads this is a no-op.
 * It stays as a cheap guard (and can be deleted once no pre-refactor checkpoints remain).
 */
export function createLegacySystemMessagesMiddleware() {
  return createMiddleware({
    name: "LegacySystemMessagesMiddleware",
    async wrapModelCall(request, handler) {
      const typed = request as unknown as LangChainModelCallRequest;
      const messages = typed.messages.filter((message) => !isSystemMessage(message));

      if (messages.length === typed.messages.length) {
        return handler(request);
      }

      return handler({ ...request, messages } as typeof request);
    },
  });
}
