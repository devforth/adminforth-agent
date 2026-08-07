import { createMiddleware } from "langchain";

type LangChainMessageLike = {
  content?: unknown;
  text?: string;
  type?: string;
  getType?: () => string;
  _getType?: () => string;
};

type LangChainModelCallRequest = {
  systemMessage: LangChainMessageLike & {
    concat: (content: string) => LangChainMessageLike;
  };
  messages: LangChainMessageLike[];
};

function isSystemMessage(message: LangChainMessageLike): boolean {
  return (
    message._getType?.() === "system" ||
    message.getType?.() === "system" ||
    message.type === "system"
  );
}

function contentToText(content: unknown, text?: string): string {
  if (text) return text;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && "text" in block) {
        return String(block.text ?? "");
      }
      return "";
    })
    .join("");
}

function normalizeSystemMessages<T extends LangChainModelCallRequest>(request: T): T {
  const extraSystemText = request.messages
    .filter(isSystemMessage)
    .map((message) => contentToText(message.content, message.text))
    .filter(Boolean)
    .join("\n\n");

  return {
    ...request,
    systemMessage: extraSystemText
      ? request.systemMessage.concat(extraSystemText)
      : request.systemMessage,
    messages: request.messages.filter((message) => !isSystemMessage(message)),
  };
}

export function createSystemMessagesMiddleware() {
  return createMiddleware({
    name: "SystemMessagesMiddleware",
    async wrapModelCall(request, handler) {
      return handler(
        normalizeSystemMessages(
          request as unknown as LangChainModelCallRequest,
        ) as typeof request,
      );
    },
  });
}
