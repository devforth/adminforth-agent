import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createAgent, summarizationMiddleware } from "langchain";
import {
  MODEL_PROVIDER_CONFIG,
  getChatModelByClassName,
} from "langchain/chat_models/universal";
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
import { createOpenAiResponsesContinuationMiddleware } from "./middleware/openAiResponsesContinuation.js";
import type { ApiBasedTool } from "../apiBasedTools.js";
import type { ToolCallEventSink } from "./toolCallEvents.js";

export const contextSchema = z.object({
  adminUser: z.custom<AdminUser>(),
  userTimeZone: z.string(),
  sessionId: z.string(),
  turnId: z.string(),
  emitToolCallEvent: z.custom<ToolCallEventSink>(),
});

export type AgentModelProvider = "openai" | "anthropic" | "google-genai";
export type AgentChatModel = BaseChatModel<any, any>;

type ProviderBackedCompletionAdapter = CompletionAdapter & {
  constructor?: {
    name?: string;
  };
  options?: {
    openAiApiKey?: string;
    openAIApiKey?: string;
    anthropicApiKey?: string;
    geminiApiKey?: string;
    googleApiKey?: string;
    googleGenAiApiKey?: string;
    googleGenerativeAiApiKey?: string;
    apiKey?: string;
    provider?: string;
    modelProvider?: string;
    model?: string;
    baseURL?: string;
    baseUrl?: string;
    timeoutMs?: number;
    extraRequestBodyParameters?: Record<string, unknown>;
  };
};

type AgentChatModelConstructor = new (
  fields?: Record<string, unknown>,
) => AgentChatModel;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeProvider(value: unknown): AgentModelProvider | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.toLowerCase().replace(/[_\s]+/g, "-");

  if (["openai", "open-ai"].includes(normalized)) {
    return "openai";
  }

  if (["anthropic", "claude"].includes(normalized)) {
    return "anthropic";
  }

  if (
    [
      "google",
      "gemini",
      "google-genai",
      "google-gemini",
      "google-generative-ai",
      "google-generativeai",
    ].includes(normalized)
  ) {
    return "google-genai";
  }

  return undefined;
}

function detectProviderFromConstructorName(
  constructorName: string | undefined,
): AgentModelProvider | undefined {
  const normalized = constructorName?.toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized.includes("openai")) {
    return "openai";
  }

  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return "anthropic";
  }

  if (normalized.includes("gemini") || normalized.includes("google")) {
    return "google-genai";
  }

  return undefined;
}

function detectProviderFromModelName(
  model: string | undefined,
): AgentModelProvider | undefined {
  const normalized = model?.toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized.startsWith("claude")) {
    return "anthropic";
  }

  if (normalized.startsWith("gemini")) {
    return "google-genai";
  }

  if (/^(gpt|o[1-9]|chatgpt)/.test(normalized)) {
    return "openai";
  }

  return undefined;
}

function detectAgentModelProvider(
  adapter: ProviderBackedCompletionAdapter,
): AgentModelProvider {
  const options = adapter.options ?? {};

  return (
    normalizeProvider(options.modelProvider) ??
    normalizeProvider(options.provider) ??
    detectProviderFromConstructorName(adapter.constructor?.name) ??
    (options.openAiApiKey || options.openAIApiKey
      ? "openai"
      : undefined) ??
    (options.anthropicApiKey ? "anthropic" : undefined) ??
    (options.geminiApiKey ||
    options.googleApiKey ||
    options.googleGenAiApiKey ||
    options.googleGenerativeAiApiKey
      ? "google-genai"
      : undefined) ??
    detectProviderFromModelName(options.model) ??
    (() => {
      throw new Error(
        "Could not infer completion adapter provider. Set options.modelProvider to openai, anthropic, or google-genai.",
      );
    })()
  );
}

function getProviderApiKey(
  provider: AgentModelProvider,
  options: ProviderBackedCompletionAdapter["options"],
) {
  switch (provider) {
    case "openai":
      return options?.openAiApiKey ?? options?.openAIApiKey ?? options?.apiKey;
    case "anthropic":
      return options?.anthropicApiKey ?? options?.apiKey;
    case "google-genai":
      return (
        options?.geminiApiKey ??
        options?.googleApiKey ??
        options?.googleGenAiApiKey ??
        options?.googleGenerativeAiApiKey ??
        options?.apiKey
      );
  }
}

function getProviderModel(
  provider: AgentModelProvider,
  options: ProviderBackedCompletionAdapter["options"],
) {
  if (options?.model) {
    return options.model;
  }

  if (provider === "openai") {
    return "gpt-5-nano";
  }

  if (provider === "google-genai") {
    return "gemini-3-flash-preview";
  }

  throw new Error(
    `CompletionAdapter for provider ${provider} must expose options.model`,
  );
}

function buildChatModelConfig(params: {
  provider: AgentModelProvider;
  options: ProviderBackedCompletionAdapter["options"];
  maxTokens: number;
}) {
  const { provider, options, maxTokens } = params;
  const apiKey = getProviderApiKey(provider, options);

  if (!apiKey) {
    const optionName =
      provider === "openai"
        ? "options.openAiApiKey"
        : provider === "anthropic"
          ? "options.anthropicApiKey"
          : "options.geminiApiKey";

    throw new Error(
      `CompletionAdapter must expose ${optionName} for ${provider} agent mode`,
    );
  }

  const model = getProviderModel(provider, options);
  const baseURL = options?.baseURL ?? options?.baseUrl;
  const extraRequestBodyParameters = {
    ...(options?.extraRequestBodyParameters ?? {}),
  };

  if (provider === "openai" && isRecord(extraRequestBodyParameters.reasoning)) {
    extraRequestBodyParameters.reasoning = {
      ...extraRequestBodyParameters.reasoning,
      summary: "auto",
    };
  }

  const config: Record<string, unknown> = {
    model,
    apiKey,
    maxTokens,
    streaming: true,
    ...extraRequestBodyParameters,
  };

  if (typeof options?.timeoutMs === "number") {
    config.timeout = options.timeoutMs;
  }

  if (baseURL) {
    config.baseURL = baseURL;
    config.baseUrl = baseURL;
    config.configuration = {
      baseURL,
    };
  }

  if (provider === "openai") {
    config.openAIApiKey = apiKey;
    config.useResponsesApi = true;
    config.outputVersion = "v1";
    config.promptCacheKey = `adminforth-agent:${model}:system-v1:tools-v1`;
    config.promptCacheRetention = "in_memory";
  }

  if (provider === "anthropic") {
    config.anthropicApiKey = apiKey;
  }

  if (provider === "google-genai") {
    config.geminiApiKey = apiKey;
    config.googleApiKey = apiKey;
    config.maxOutputTokens = maxTokens;
  }

  return { model, config };
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
}) {
  const adapter = params.adapter as ProviderBackedCompletionAdapter;
  const options = adapter.options ?? {};
  const provider = detectAgentModelProvider(adapter);
  const { config } = buildChatModelConfig({
    provider,
    options,
    maxTokens: params.maxTokens,
  });
  const className = MODEL_PROVIDER_CONFIG[provider].className;
  const ChatModelClass = await getChatModelByClassName(
    className,
    provider,
  ) as AgentChatModelConstructor;

  return {
    model: new ChatModelClass(config),
    provider,
  };
}

export async function callAgent(params: {
  name: string;
  model: AgentChatModel;
  summaryModel: AgentChatModel;
  modelProvider: AgentModelProvider;
  checkpointer?: BaseCheckpointSaver;
  messages: Messages;
  adminUser: AdminUser;
  adminforth: IAdminForth;
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
    modelProvider,
    checkpointer,
    messages,
    adminUser,
    adminforth,
    apiBasedTools,
    customComponentsDir,
    sessionId,
    turnId,
    userTimeZone,
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
    ...(modelProvider === "openai"
      ? [createOpenAiResponsesContinuationMiddleware()]
      : []),
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
    recursionLimit: 100,
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
