import { createAgent, summarizationMiddleware } from "langchain";
import { logger, type AdminUser, type CompletionAdapter } from "adminforth";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { MemorySaver, type Messages } from "@langchain/langgraph";
import type { LLMResult } from "@langchain/core/outputs";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { createAgentTools } from "./tools/index.js";
import { createApiBasedToolsMiddleware } from "./middleware/apiBasedTools.js";
import {
  createSequenceDebugMiddleware,
  type SequenceDebugModelCallSink,
} from "./middleware/sequenceDebug.js";
import { createOpenAiResponsesContinuationMiddleware } from "./middleware/openAiResponsesContinuation.js";
import type { ApiBasedTool } from "../apiBasedTools.js";
import type { ToolCallEventSink } from "./toolCallEvents.js";

const checkpointer = new MemorySaver();

export const contextSchema = z.object({
  adminUser: z.custom<AdminUser>(),
  userTimeZone: z.string(),
  sessionId: z.string(),
  turnId: z.string(),
  emitToolCallEvent: z.custom<ToolCallEventSink>(),
});

type AgentReasoning =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

type OpenAIBackedCompletionAdapter = CompletionAdapter & {
  options?: {
    openAiApiKey?: string;
    model?: string;
    baseURL?: string;
    baseUrl?: string;
    timeoutMs?: number;
    extraRequestBodyParameters?: Record<string, unknown>;
  };
};

type LlmOutputTokenUsage = {
  promptTokens?: unknown;
  completionTokens?: unknown;
};

type MessageUsageMetadata = {
  input_tokens?: unknown;
  output_tokens?: unknown;
};

type PendingLlmRun = {
  startedAt: number;
  firstTokenAt?: number;
};

function getFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function extractTokenUsage(output: LLMResult) {
  const llmOutputTokenUsage = (
    output.llmOutput as { tokenUsage?: LlmOutputTokenUsage } | undefined
  )?.tokenUsage;

  const promptTokens = getFiniteNumber(llmOutputTokenUsage?.promptTokens);
  const completionTokens = getFiniteNumber(
    llmOutputTokenUsage?.completionTokens,
  );

  if (promptTokens !== undefined || completionTokens !== undefined) {
    return {
      InputTokens: promptTokens ?? 0,
      outputTokens: completionTokens ?? 0,
    };
  }

  let InputTokens = 0;
  let outputTokens = 0;

  for (const generationBatch of output.generations) {
    for (const generation of generationBatch) {
      if (!("message" in generation) || !generation.message) {
        continue;
      }

      const message = generation.message as {
        usage_metadata?: MessageUsageMetadata;
        response_metadata?: {
          tokenUsage?: LlmOutputTokenUsage;
        };
      };

      InputTokens +=
        getFiniteNumber(message.usage_metadata?.input_tokens) ??
        getFiniteNumber(message.response_metadata?.tokenUsage?.promptTokens) ??
        0;
      outputTokens +=
        getFiniteNumber(message.usage_metadata?.output_tokens) ??
        getFiniteNumber(
          message.response_metadata?.tokenUsage?.completionTokens,
        ) ??
        0;
    }
  }

  return { InputTokens, outputTokens };
}

class AgentLlmMetricsLogger extends BaseCallbackHandler {
  name = "AgentLlmMetricsLogger";
  lc_prefer_streaming = true;

  private readonly pendingRuns = new Map<string, PendingLlmRun>();

  async handleLLMStart(_llm: unknown, _prompts: string[], runId: string) {
    this.pendingRuns.set(runId, { startedAt: Date.now() });
  }

  async handleLLMNewToken(
    _token: string,
    _chunk: unknown,
    runId: string,
  ) {
    const pendingRun = this.pendingRuns.get(runId);

    if (!pendingRun || pendingRun.firstTokenAt !== undefined) {
      return;
    }

    pendingRun.firstTokenAt = Date.now();
  }

  async handleLLMEnd(output: LLMResult, runId: string) {
    const pendingRun = this.pendingRuns.get(runId);

    if (!pendingRun) {
      return;
    }

    this.pendingRuns.delete(runId);

    const finishedAt = Date.now();
    const rtt = finishedAt - pendingRun.startedAt;
    const ttft =
      pendingRun.firstTokenAt === undefined
        ? rtt
        : pendingRun.firstTokenAt - pendingRun.startedAt;
    const { InputTokens, outputTokens } = extractTokenUsage(output);

    logger.info(
      { InputTokens, outputTokens, ttft, rtt },
      "LLM call finished",
    );
  }

  async handleLLMError(_error: unknown, runId: string) {
    this.pendingRuns.delete(runId);
  }
}

function createAgentLlmMetricsLogger() {
  return new AgentLlmMetricsLogger();
}

export function createAgentChatModel(params: {
  adapter: CompletionAdapter;
  maxTokens: number;
  modelName?: string;
}) {
  const adapter = params.adapter as OpenAIBackedCompletionAdapter;
  const options = adapter.options ?? {};

  if (!options.openAiApiKey) {
    throw new Error(
      "CompletionAdapter must expose options.openAiApiKey for ChatOpenAI",
    );
  }

  const model = params.modelName ?? options.model ?? "gpt-5-nano";
  const baseURL = options.baseURL ?? options.baseUrl;
  const reasoning = options.extraRequestBodyParameters?.reasoning;

  // @ts-ignore
  return new ChatOpenAI({
    apiKey: options.openAiApiKey,
    model,
    maxTokens: params.maxTokens,
    useResponsesApi: true,
    outputVersion: "v1",

    promptCacheKey: `adminforth-agent:${model}:system-v1:tools-v1`,

    promptCacheRetention: "in_memory", 

    ...(reasoning ? { reasoning } : {}),
    ...(typeof options.timeoutMs === "number"
      ? { timeout: options.timeoutMs }
      : {}),
    ...(baseURL
      ? {
          configuration: {
            baseURL,
          },
        }
      : {}),
  });
}

export async function callAgent(params: {
  name: string;
  model: ChatOpenAI;
  summaryModel: ChatOpenAI;
  messages: Messages;
  adminUser: AdminUser;
  apiBasedTools: Record<string, ApiBasedTool>;
  customComponentsDir: string;
  sessionId: string;
  turnId: string;
  userTimeZone: string;
  emitToolCallEvent: ToolCallEventSink;
  sequenceDebugSink: SequenceDebugModelCallSink;
}) {
  const {
    name,
    model,
    summaryModel,
    messages,
    adminUser,
    apiBasedTools,
    customComponentsDir,
    sessionId,
    turnId,
    userTimeZone,
    emitToolCallEvent,
    sequenceDebugSink,
  } = params;

  const tools = await createAgentTools(customComponentsDir, apiBasedTools);
  const apiBasedToolsMiddleware = createApiBasedToolsMiddleware(apiBasedTools);
  const openAiResponsesContinuationMiddleware =
    createOpenAiResponsesContinuationMiddleware();
  const sequenceDebugMiddleware = createSequenceDebugMiddleware(
    sequenceDebugSink,
  );

  const middleware = [
    apiBasedToolsMiddleware,
    openAiResponsesContinuationMiddleware,
    sequenceDebugMiddleware,
    summarizationMiddleware({
      model: summaryModel,
      trigger: { tokens: 1024 * 128 },
      keep: { messages: 10 },
    }),
  ] as const;

  const agent = createAgent<undefined, typeof contextSchema, typeof middleware>({
    name,
    model,
    checkpointer,
    tools,
    contextSchema,
    middleware,
  });

  return await agent.stream({ messages } as any, {
    streamMode: "messages",
    recursionLimit: 50,
    callbacks: [createAgentLlmMetricsLogger()],
    configurable: {
      thread_id: sessionId,
    },
    context: {
      adminUser,
      userTimeZone,
      sessionId,
      turnId,
      emitToolCallEvent,
    },
  });
}
