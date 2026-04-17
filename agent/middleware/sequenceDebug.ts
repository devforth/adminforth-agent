import { AIMessage } from "@langchain/core/messages";
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
  reasoning: string;
  text: string;
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
  reasoning: string;
  text: string;
  resultType: SequenceDebugResultType;
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
    reasoning: "",
    text: "",
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
    reasoning: sequence.reasoning,
    text: sequence.text,
    toolCalls: sequence.toolCalls.map(({ completed: _completed, ...toolCall }) => toolCall),
    endedAt: new Date().toISOString(),
    resultType: sequence.resultType ?? "final_text",
  };
}

function stringifyPromptForDebug(params: {
  systemMessage: { toDict(): unknown };
  messages: Array<{ toDict(): unknown }>;
  tools: unknown[];
  modelSettings?: Record<string, unknown>;
}) {
  const { systemMessage, messages, tools, modelSettings } = params;

  return YAML.stringify({
    systemMessage: systemMessage.toDict(),
    messages: messages.map((message) => message.toDict()),
    tools: tools.map((tool) => {
      if (
        typeof tool === "object" &&
        tool !== null &&
        "name" in tool &&
        typeof tool.name === "string"
      ) {
        return tool.name;
      }

      if (
        typeof tool === "object" &&
        tool !== null &&
        "schema" in tool &&
        typeof tool.schema === "object" &&
        tool.schema !== null &&
        "name" in tool.schema &&
        typeof tool.schema.name === "string"
      ) {
        return tool.schema.name;
      }

      return "";
    }),
    ...(modelSettings && Object.keys(modelSettings).length > 0
      ? { modelSettings }
      : {}),
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
    reasoning,
    text: textFromBlocks || (typeof message.content === "string" ? message.content : ""),
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
      sequenceDebug.reasoning = params.reasoning;
      sequenceDebug.text = params.text;
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
      sink.handleModelCallStart(
        stringifyPromptForDebug({
          systemMessage: request.systemMessage,
          messages: request.messages,
          tools: request.tools,
          modelSettings: request.modelSettings,
        }),
      );

      const response = await handler(request) as AIMessage;
      sink.handleModelCallComplete(extractSequenceResponseDebug(response));
      return response;
    },
  });
}
