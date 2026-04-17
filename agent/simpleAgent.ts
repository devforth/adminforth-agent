import { createAgent, summarizationMiddleware } from "langchain";
import type { AdminUser, CompletionAdapter } from "adminforth";
import { MemorySaver, type Messages } from "@langchain/langgraph";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { createAgentTools } from "./tools/index.js";
import { createApiBasedToolsMiddleware } from "./middleware/apiBasedTools.js";
import type { ApiBasedTool } from "../apiBasedTools.js";
import type { ToolCallEventSink } from "./toolCallEvents.js";

const checkpointer = new MemorySaver();

export const contextSchema = z.object({
  adminUser: z.custom<AdminUser>(),
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

function normalizeReasoning(reasoning: AgentReasoning) {
  if (reasoning === "none") {
    return undefined;
  }

  return {
    effort: reasoning as "minimal" | "low" | "medium" | "high" | "xhigh",
    summary: "auto" as const,
  };
}

export function createAgentChatModel(params: {
  adapter: CompletionAdapter;
  maxTokens: number;
  reasoning: AgentReasoning;
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
  const reasoning = normalizeReasoning(params.reasoning);

  return new ChatOpenAI({
    apiKey: options.openAiApiKey,
    model,
    maxTokens: params.maxTokens,
    useResponsesApi: true,
    outputVersion: "v1",
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
  emitToolCallEvent: ToolCallEventSink;
}) {
  const {
    model,
    messages,
    adminUser,
    apiBasedTools,
    customComponentsDir,
    sessionId,
    turnId,
    emitToolCallEvent,
    summaryModel,
    name,
  } = params;
  const tools = await createAgentTools(customComponentsDir, apiBasedTools);
  const apiBasedToolsMiddleware = createApiBasedToolsMiddleware(apiBasedTools);

  const middleware = [
    apiBasedToolsMiddleware,
    summarizationMiddleware({
      model: summaryModel,
      trigger: { tokens: 1024 * 8 },
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

  const initialState = { messages } as Parameters<typeof agent.stream>[0];

  return await agent.stream(initialState, {
    streamMode: "messages",
    recursionLimit: 50,
    configurable: {
      thread_id: sessionId,
    },
    context: {
      adminUser,
      sessionId,
      turnId,
      emitToolCallEvent,
    },
  });
}
