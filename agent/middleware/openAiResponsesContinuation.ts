import { AIMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

type OpenAiResponsesMetadata = {
  id?: string;
};

type OpenAiResponsesContext = {
  sessionId: string;
  turnId: string;
};

function getTurnKey(context: OpenAiResponsesContext) {
  return `${context.sessionId}:${context.turnId}`;
}

function getResponseId(message: AIMessage) {
  const metadata = message.response_metadata as OpenAiResponsesMetadata | undefined;
  return metadata?.id ?? null;
}

function getPreviousResponseId(modelSettings?: Record<string, unknown>) {
  return (modelSettings as { previous_response_id?: string } | undefined)
    ?.previous_response_id;
}

function getContinuationMessages<T extends { response_metadata?: unknown }>(
  messages: T[],
  previousResponseId: string,
) {
  let continuationStartIndex: number | null = null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (
      AIMessage.isInstance(message) &&
      (message.response_metadata as OpenAiResponsesMetadata | undefined)?.id ===
        previousResponseId
    ) {
      continuationStartIndex = index + 1;
      break;
    }
  }

  if (continuationStartIndex === null) {
    return null;
  }

  return messages.slice(continuationStartIndex);
}

export function createOpenAiResponsesContinuationMiddleware() {
  const responseIdsByTurn = new Map<string, string>();

  return createMiddleware({
    name: "OpenAiResponsesContinuationMiddleware",
    async wrapModelCall(request, handler) {
      const context = request.runtime.context as OpenAiResponsesContext;
      const turnKey = getTurnKey(context);
      const previousResponseId =
        getPreviousResponseId(request.modelSettings) ??
        responseIdsByTurn.get(turnKey);
      const continuationMessages = previousResponseId
        ? getContinuationMessages(request.messages, previousResponseId)
        : null;

      const response = await handler(
        previousResponseId && continuationMessages
          ? {
              ...request,
              messages: continuationMessages,
              modelSettings: {
                ...request.modelSettings,
                previous_response_id: previousResponseId,
              },
            }
          : request,
      ) as AIMessage;

      const responseId = getResponseId(response);

      if (responseId) {
        responseIdsByTurn.set(turnKey, responseId);
      } else {
        responseIdsByTurn.delete(turnKey);
      }

      return response;
    },
  });
}
