import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  type CompletionAdapter,
} from "adminforth";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import type { Messages, Command } from "@langchain/langgraph";
import {
  createSequenceDebugMiddleware,
} from "./middleware/sequenceDebug.js";
import type { AgentModeCompletionAdapter, AgentModelPurpose } from "../application/ports.js";
import type { AgentTurnContext, AgentTurnObservability } from "../domain/turnTypes.js";

export type { AgentModeCompletionAdapter, AgentModelPurpose } from "../application/ports.js";

export type AgentChatModel = BaseChatModel<any, any>;
export type AgentMiddleware = ReturnType<typeof createSequenceDebugMiddleware>;

export type AgentTurnModels = {
  model: AgentChatModel;
  summaryModel: AgentChatModel;
  modelMiddleware?: AgentMiddleware[];
};

export type AgentRuntimeRunInput = {
  models: AgentTurnModels;
  input: { messages: Messages } | Command;
  context: AgentTurnContext;
  observability: AgentTurnObservability;
  branchFromCheckpointId?: string;
};

type AgentChatModelSpec = {
  model: AgentChatModel;
  middleware: AgentMiddleware[];
};

type PendingLlmRun = {
  startedAt: number;
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

class AgentLlmMetricsLogger extends BaseCallbackHandler {
  name = "AgentLlmMetricsLogger";
  lc_prefer_streaming = true;

  private readonly pendingRuns = new Map<string, PendingLlmRun>();

  async handleLLMStart(_llm: unknown, _prompts: string[], runId: string) {
    this.pendingRuns.set(runId, { startedAt: Date.now() });
  }

  async handleLLMEnd(_output: LLMResult, runId: string) {
    this.pendingRuns.delete(runId);
  }

  async handleLLMError(_error: unknown, runId: string) {
    this.pendingRuns.delete(runId);
  }
}

export function createAgentLlmMetricsLogger() {
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
