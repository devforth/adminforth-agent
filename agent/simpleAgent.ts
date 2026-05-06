import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createAgent, summarizationMiddleware } from "langchain";
import {
  logger,
  type AdminUser,
  type CompletionAdapter,
  type IAdminForth,
} from "adminforth";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import {type BaseCheckpointSaver, type Messages } from "@langchain/langgraph";
import type { LLMResult } from "@langchain/core/outputs";
import { z } from "zod";
import { createAgentTools } from "./tools/index.js";
import { createApiBasedToolsMiddleware } from "./middleware/apiBasedTools.js";
import {
  createSequenceDebugMiddleware,
  type SequenceDebugModelCallSink,
} from "./middleware/sequenceDebug.js";
import type { ApiBasedTool } from "../apiBasedTools.js";
import type { ToolCallEventSink } from "./toolCallEvents.js";
import type { CurrentPageContext } from "./tools/getUserLocation.js";

export const contextSchema = z.object({
  adminUser: z.custom<AdminUser>(),
  userTimeZone: z.string(),
  sessionId: z.string(),
  turnId: z.string(),
  abortSignal: z.custom<AbortSignal>().optional(),
  currentPage: z.custom<CurrentPageContext>().optional(),
  emitToolCallEvent: z.custom<ToolCallEventSink>(),
});

export type AgentChatModel = BaseChatModel<any, any>;
export type AgentModelPurpose = "primary" | "summary";
export type AgentModeCompletionAdapter = CompletionAdapter & {
  getLangChainAgentSpec(params: {
    maxTokens: number;
    purpose: AgentModelPurpose;
  }): Promise<{
    model: unknown;
    middleware?: unknown[];
  }> | {
    model: unknown;
    middleware?: unknown[];
  };
};

type AgentMiddleware = ReturnType<typeof createSequenceDebugMiddleware>;

type AgentChatModelSpec = {
  model: AgentChatModel;
  middleware: AgentMiddleware[];
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

function isLangChainAgentCompletionAdapter(
  adapter: CompletionAdapter,
): adapter is AgentModeCompletionAdapter {
  return typeof (adapter as AgentModeCompletionAdapter)
    .getLangChainAgentSpec === "function";
}

async function getAgentChatModelSpec(params: {
  adapter: AgentModeCompletionAdapter;
  maxTokens: number;
  purpose: AgentModelPurpose;
}): Promise<AgentChatModelSpec> {
  const spec = await params.adapter.getLangChainAgentSpec({
    maxTokens: params.maxTokens,
    purpose: params.purpose,
  });

  return {
    model: spec.model as AgentChatModel,
    middleware: (spec.middleware ?? []) as AgentMiddleware[],
  };
}

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

export async function createAgentChatModel(params: {
  adapter: CompletionAdapter;
  maxTokens: number;
  purpose: AgentModelPurpose;
}) {
  if (!isLangChainAgentCompletionAdapter(params.adapter)) {
    throw new Error(
      "AdminForth Agent requires completionAdapter to implement getLangChainAgentSpec({ maxTokens, purpose }).",
    );
  }

  return await getAgentChatModelSpec({
    adapter: params.adapter,
    maxTokens: params.maxTokens,
    purpose: params.purpose,
  });
}

export async function callAgent(params: {
  name: string;
  model: AgentChatModel;
  summaryModel: AgentChatModel;
  modelMiddleware?: AgentMiddleware[];
  checkpointer?: BaseCheckpointSaver;
  messages: Messages;
  adminUser: AdminUser;
  adminforth: IAdminForth;
  apiBasedTools: Record<string, ApiBasedTool>;
  customComponentsDir: string;
  sessionId: string;
  turnId: string;
  currentPage?: CurrentPageContext;
  userTimeZone: string;
  abortSignal?: AbortSignal;
  emitToolCallEvent: ToolCallEventSink;
  sequenceDebugSink: SequenceDebugModelCallSink;
}) {
  const {
    name,
    model,
    summaryModel,
    modelMiddleware = [],
    checkpointer,
    messages,
    adminUser,
    adminforth,
    apiBasedTools,
    customComponentsDir,
    sessionId,
    turnId,
    currentPage,
    userTimeZone,
    abortSignal,
    emitToolCallEvent,
    sequenceDebugSink,
  } = params;

  const tools = await createAgentTools(customComponentsDir, apiBasedTools);
  const apiBasedToolsMiddleware = createApiBasedToolsMiddleware(apiBasedTools, adminforth);
  const sequenceDebugMiddleware = createSequenceDebugMiddleware(
    sequenceDebugSink,
  );

  const middleware = [
    apiBasedToolsMiddleware,
    ...modelMiddleware,
    sequenceDebugMiddleware,
    summarizationMiddleware({
      model: summaryModel,
      trigger: { tokens: 1024 * 64 },
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
    recursionLimit: 100,
    callbacks: [createAgentLlmMetricsLogger()],
    signal: abortSignal,
    configurable: {
      thread_id: sessionId,
    },
    context: {
      adminUser,
      userTimeZone,
      sessionId,
      turnId,
      abortSignal,
      currentPage,
      emitToolCallEvent,
    },
  });
}
