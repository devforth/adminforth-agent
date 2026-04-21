import { AIMessage } from "@langchain/core/messages";
import { convertMessagesToResponsesInput } from "@langchain/openai";
import { createMiddleware } from "langchain";
import YAML from "yaml";
import type { ToolCallEvent } from "../toolCallEvents.js";

export type SequenceDebugResultType = "tool_calls" | "final_text";

type SequenceDebugToolCall = {
  toolCallId: string;
  toolName: string;
  input: string;
  output: string | null;
  error: string | null;
};

type PendingSequenceDebugToolCall = SequenceDebugToolCall & {
  completed: boolean;
};

export type SequenceDebug = {
  sequenceId: number;
  startedAt: string;
  prompt: string;
  promptTokens: number;
  reasoning: string;
  reasoningTokens: number;
  text: string;
  textTokens: number;
  cachedTokens: number;
  responseId: string | null;
  toolCalls: SequenceDebugToolCall[];
  endedAt: string;
  resultType: SequenceDebugResultType;
};

type PendingSequenceDebug = Omit<SequenceDebug, "toolCalls" | "endedAt" | "resultType"> & {
  toolCalls: PendingSequenceDebugToolCall[];
  pendingToolCalls: number;
  resultType: SequenceDebugResultType | null;
};

type SequenceDebugModelCall = {
  promptTokens: number;
  reasoning: string;
  reasoningTokens: number;
  text: string;
  textTokens: number;
  cachedTokens: number;
  responseId: string | null;
  resultType: SequenceDebugResultType;
};

type OpenAiUsageMetadata = {
  input_tokens?: number;
  input_token_details?: {
    cache_read?: number;
  };
};

type OpenAiResponseMetadata = {
  id?: string;
};

export type SequenceDebugModelCallSink = {
  handleModelCallStart: (prompt: string) => void;
  handleModelCallComplete: (params: SequenceDebugModelCall) => void;
};

export type SequenceDebugCollector = SequenceDebugModelCallSink & {
  handleToolCallEvent: (event: ToolCallEvent) => void;
  flush: () => void;
  getHistory: () => SequenceDebug[];
};

function createPendingSequenceDebug(sequenceId: number): PendingSequenceDebug {
  return {
    sequenceId,
    startedAt: new Date().toISOString(),
    prompt: "",
    promptTokens: 0,
    reasoning: "",
    reasoningTokens: 0,
    text: "",
    textTokens: 0,
    cachedTokens: 0,
    responseId: null,
    toolCalls: [],
    pendingToolCalls: 0,
    resultType: null,
  };
}

function hasSequenceDebugContent(sequence: PendingSequenceDebug | null): sequence is PendingSequenceDebug {
  return Boolean(
    sequence &&
      (
        sequence.prompt ||
        sequence.reasoning ||
        sequence.text ||
        sequence.toolCalls.length > 0
      ),
  );
}

function finalizeSequenceDebug(sequence: PendingSequenceDebug): SequenceDebug {
  return {
    sequenceId: sequence.sequenceId,
    startedAt: sequence.startedAt,
    prompt: sequence.prompt,
    promptTokens: sequence.promptTokens,
    reasoning: sequence.reasoning,
    reasoningTokens: sequence.reasoningTokens,
    text: sequence.text,
    textTokens: sequence.textTokens,
    cachedTokens: sequence.cachedTokens,
    responseId: sequence.responseId,
    toolCalls: sequence.toolCalls.map(({ completed: _completed, ...toolCall }) => toolCall),
    endedAt: new Date().toISOString(),
    resultType: sequence.resultType ?? "final_text",
  };
}

type OpenAiResponsesDebugModel = {
  model: string;
  zdrEnabled?: boolean;
  invocationParams: (options?: Record<string, unknown>) => Record<string, unknown>;
};

function stringifyPromptForDebug(params: {
  model: OpenAiResponsesDebugModel;
  systemMessage: { text: string };
  messages: unknown[];
  tools: unknown[];
  toolChoice?: unknown;
  modelSettings?: Record<string, unknown>;
}) {
  const { model, systemMessage, messages, tools, toolChoice, modelSettings } = params;

  return YAML.stringify({
    input: convertMessagesToResponsesInput({
      messages: [
        ...(systemMessage.text === "" ? [] : [systemMessage]),
        ...messages,
      ] as any[],
      zdrEnabled: model.zdrEnabled ?? false,
      model: model.model,
    }),
    ...model.invocationParams({
    ...(modelSettings ?? {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
    }),
  });
}

function getMessageBlocks(message: {
  contentBlocks?: unknown;
  content?: unknown;
}) {
  if (Array.isArray(message.contentBlocks)) {
    return message.contentBlocks;
  }

  if (Array.isArray(message.content)) {
    return message.content;
  }

  return [];
}

function hasToolCallSignal(message: {
  tool_calls?: unknown;
  tool_call_chunks?: unknown;
  additional_kwargs?: { tool_calls?: unknown };
}) {
  return Boolean(
    (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) ||
      (Array.isArray(message.tool_call_chunks) && message.tool_call_chunks.length > 0) ||
      (Array.isArray(message.additional_kwargs?.tool_calls) &&
        message.additional_kwargs.tool_calls.length > 0),
  );
}

function hasTokenCounter(model: unknown): model is {
  getNumTokens: (content: string) => Promise<number>;
} {
  return (
    typeof model === "object" &&
    model !== null &&
    "getNumTokens" in model &&
    typeof model.getNumTokens === "function"
  );
}

async function countTokens(model: unknown, content: string) {
  if (!content) {
    return 0;
  }

  if (!hasTokenCounter(model)) {
    return 0;
  }

  return await model.getNumTokens(content);
}

function extractSequenceResponseDebug(message: AIMessage): SequenceDebugModelCall {
  const blocks = getMessageBlocks(message);
  const reasoning = blocks
    .filter((block: any) => block?.type === "reasoning")
    .map((block: any) => String(block.reasoning ?? ""))
    .join("");
  const textFromBlocks = blocks
    .filter((block: any) => block?.type === "text")
    .map((block: any) => String(block.text ?? ""))
    .join("");

  return {
    promptTokens:
      (message.usage_metadata as OpenAiUsageMetadata | undefined)?.input_tokens ??
      0,
    reasoning,
    reasoningTokens: 0,
    text: textFromBlocks || (typeof message.content === "string" ? message.content : ""),
    textTokens: 0,
    cachedTokens:
      (message.usage_metadata as OpenAiUsageMetadata | undefined)
        ?.input_token_details?.cache_read ?? 0,
    responseId:
      (message.response_metadata as OpenAiResponseMetadata | undefined)?.id ??
      null,
    resultType: hasToolCallSignal(message) ? "tool_calls" : "final_text",
  };
}

export function createSequenceDebugCollector(): SequenceDebugCollector {
  let nextSequenceId = 1;
  let currentSequenceDebug: PendingSequenceDebug | null = null;
  const history: SequenceDebug[] = [];

  const ensureSequenceDebug = () => {
    if (!currentSequenceDebug) {
      currentSequenceDebug = createPendingSequenceDebug(nextSequenceId++);
    }

    return currentSequenceDebug;
  };

  const flush = () => {
    if (!hasSequenceDebugContent(currentSequenceDebug)) {
      currentSequenceDebug = null;
      return;
    }

    const finalizedSequenceDebug = finalizeSequenceDebug(currentSequenceDebug);
    history.push(finalizedSequenceDebug);
    currentSequenceDebug = null;
  };

  return {
    handleModelCallStart(prompt) {
      if (
        currentSequenceDebug?.resultType &&
        currentSequenceDebug.pendingToolCalls === 0
      ) {
        flush();
      }

      const sequenceDebug = ensureSequenceDebug();
      sequenceDebug.prompt = prompt;
    },
    handleModelCallComplete(params) {
      const sequenceDebug = ensureSequenceDebug();
      sequenceDebug.promptTokens = params.promptTokens;
      sequenceDebug.reasoning = params.reasoning;
      sequenceDebug.reasoningTokens = params.reasoningTokens;
      sequenceDebug.text = params.text;
      sequenceDebug.textTokens = params.textTokens;
      sequenceDebug.cachedTokens = params.cachedTokens;
      sequenceDebug.responseId = params.responseId;
      sequenceDebug.resultType = params.resultType;

      if (
        sequenceDebug.resultType === "final_text" &&
        sequenceDebug.pendingToolCalls === 0
      ) {
        flush();
      }
    },
    handleToolCallEvent(event) {
      const sequenceDebug = ensureSequenceDebug();

      if (event.phase === "start") {
        sequenceDebug.toolCalls.push({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
          output: null,
          error: null,
          completed: false,
        });
        sequenceDebug.pendingToolCalls += 1;
        return;
      }

      const pendingToolCall = sequenceDebug.toolCalls.find(
        (toolCall) => toolCall.toolCallId === event.toolCallId && !toolCall.completed,
      );

      if (pendingToolCall) {
        pendingToolCall.output = event.output;
        pendingToolCall.error = event.error;
        pendingToolCall.completed = true;
      } else {
        sequenceDebug.toolCalls.push({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: "",
          output: event.output,
          error: event.error,
          completed: true,
        });
      }

      sequenceDebug.pendingToolCalls = Math.max(
        0,
        sequenceDebug.pendingToolCalls - 1,
      );

      if (
        sequenceDebug.resultType === "tool_calls" &&
        sequenceDebug.pendingToolCalls === 0
      ) {
        flush();
      }
    },
    flush,
    getHistory() {
      return history;
    },
  };
}

export function createSequenceDebugMiddleware(
  sink: SequenceDebugModelCallSink,
) {
  return createMiddleware({
    name: "SequenceDebugMiddleware",
    async wrapModelCall(request, handler) {
      const prompt = stringifyPromptForDebug({
        model: request.model as unknown as OpenAiResponsesDebugModel,
        systemMessage: request.systemMessage,
        messages: request.messages,
        tools: request.tools,
        toolChoice: request.toolChoice,
        modelSettings: request.modelSettings,
      });

      sink.handleModelCallStart(
        prompt,
      );

      const response = await handler(request) as AIMessage;
      const debug = extractSequenceResponseDebug(response);
      const [promptTokens, reasoningTokens, textTokens] = await Promise.all([
        debug.promptTokens || countTokens(request.model, prompt),
        countTokens(request.model, debug.reasoning),
        countTokens(request.model, debug.text),
      ]);

      sink.handleModelCallComplete({
        ...debug,
        promptTokens,
        reasoningTokens,
        textTokens,
      });
      return response;
    },
  });
}
