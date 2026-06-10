import type { IAdminForth } from "adminforth";
import { createAgent, summarizationMiddleware } from "langchain";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createApiBasedToolsMiddleware } from "../middleware/apiBasedTools.js";
import { createSequenceDebugMiddleware } from "../middleware/sequenceDebug.js";
import { createAgentLlmMetricsLogger } from "../simpleAgent.js";
import type { AgentToolProvider } from "../tools/AgentToolProvider.js";
import type { AgentRuntimeRunInput } from "../turn/turnTypes.js";
import { contextSchema, toLangchainAgentContext } from "./AgentContext.js";

export type AgentRuntimeOptions = {
  name: string;
  getAdminforth: () => IAdminForth;
  getCheckpointer: () => BaseCheckpointSaver;
  toolProvider: AgentToolProvider;
};

export class AgentRuntime {
  constructor(private readonly options: AgentRuntimeOptions) {}

  async stream(input: AgentRuntimeRunInput) {
    const apiBasedTools = this.options.toolProvider.getApiBasedTools();
    const tools = await this.options.toolProvider.getTools(apiBasedTools);
    const adminforth = this.options.getAdminforth();
    const apiBasedToolsMiddleware = createApiBasedToolsMiddleware(
      apiBasedTools,
      adminforth,
    );
    const sequenceDebugMiddleware = createSequenceDebugMiddleware(
      input.observability.sequenceDebugSink,
    );
    const middleware = [
      apiBasedToolsMiddleware,
      ...(input.models.modelMiddleware ?? []),
      sequenceDebugMiddleware,
      summarizationMiddleware({
        model: input.models.summaryModel,
        trigger: { tokens: 1024 * 64 },
        keep: { messages: 10 },
      }),
    ] as const;

    const agent = createAgent({
      name: this.options.name,
      model: input.models.model,
      checkpointer: this.options.getCheckpointer(),
      tools,
      contextSchema,
      middleware,
    });

    return agent.stream({ messages: input.messages } as any, {
      streamMode: "messages",
      recursionLimit: 100,
      callbacks: [createAgentLlmMetricsLogger()],
      signal: input.context.abortSignal,
      configurable: {
        thread_id: input.context.sessionId,
      },
      context: toLangchainAgentContext({
        ...input.context,
        adminBaseUrl: adminforth.config.baseUrlSlashed,
        emit: input.observability.emit,
        sequenceDebugSink: input.observability.sequenceDebugSink,
      }),
    });
  }
}
