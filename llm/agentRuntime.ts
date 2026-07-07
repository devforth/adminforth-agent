import type { IAdminForth } from "adminforth";
import { createAgent, summarizationMiddleware, humanInTheLoopMiddleware } from "langchain";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createApiBasedToolsMiddleware } from "./middleware/apiToolsMiddleware.js";
import { createSequenceDebugMiddleware, type SequenceDebugCollector } from "./middleware/sequenceDebug.js";
import { createSteerMiddleware } from "./middleware/steerMiddleware.js";
import type { SteerBuffer } from "../domain/steerBuffer.js";
import { createAgentLlmMetricsLogger } from "./agentModels.js";
import type { AgentToolProvider } from "../tools/agentToolProvider.js";
import type { AgentRuntimeRunInput, AgentTurnModels } from "./agentModels.js";
import { contextSchema, toLangchainAgentContext } from "./agentContext.js";
import type { ApiBasedTool } from "../tools/apiBasedTools.js";

function createHumanInTheLoopInterrupts(
  apiBasedTools: Record<string, ApiBasedTool>,
): Record<string, { allowedDecisions: ("approve" | "reject" | "edit")[] }> {
  return Object.fromEntries(
    Object.entries(apiBasedTools)
      .filter(([, apiBasedTool]) => apiBasedTool.agent?.isDangerous === true)
      .map(([toolName]) => [
        toolName,
        {
          allowedDecisions: ["approve", "reject"],
        },
      ]),
  );
}

export type AgentRuntimeOptions = {
  name: string;
  getAdminforth: () => IAdminForth;
  getCheckpointer: () => BaseCheckpointSaver;
  toolProvider: AgentToolProvider;
  /** Per-session buffer of mid-turn steering instructions drained by the steer middleware. */
  steerBuffer: SteerBuffer;
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
    // The domain exposes only the narrow DebugSink; the concrete collector (with the
    // model-call hooks the debug middleware needs) is an llm-layer detail.
    const sequenceDebugSink = input.observability.sequenceDebugSink as SequenceDebugCollector;
    const sequenceDebugMiddleware = createSequenceDebugMiddleware(sequenceDebugSink);
    const hitlMiddleware = humanInTheLoopMiddleware({
      interruptOn: createHumanInTheLoopInterrupts(apiBasedTools),
      descriptionPrefix: "Tool execution pending approval",
    });
    const steerMiddleware = createSteerMiddleware(this.options.steerBuffer);
    const middleware = [
      steerMiddleware,
      apiBasedToolsMiddleware,
      hitlMiddleware,
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

    return agent.stream(input.input as any, {
      streamMode: ["messages", "updates"],
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
        sequenceDebugSink,
      }),
    });
  }

  /**
   * Read the pending human-in-the-loop interrupts persisted for a thread from the
   * checkpointer. Builds a minimal agent (model + checkpointer + HITL middleware) and
   * queries its state — no model call is made. Returns raw LangGraph interrupt objects.
   */
  async getPendingInterrupts(input: {
    models: AgentTurnModels;
    sessionId: string;
  }): Promise<unknown[]> {
    const apiBasedTools = this.options.toolProvider.getApiBasedTools();
    const tools = await this.options.toolProvider.getTools(apiBasedTools);
    const agent = createAgent({
      name: this.options.name,
      model: input.models.model,
      checkpointer: this.options.getCheckpointer(),
      tools,
      contextSchema,
      middleware: [
        humanInTheLoopMiddleware({
          interruptOn: createHumanInTheLoopInterrupts(apiBasedTools),
          descriptionPrefix: "Tool execution pending approval",
        }),
      ],
    });

    const state = await (agent as { getState: (config: unknown) => Promise<any> }).getState({
      configurable: { thread_id: input.sessionId },
    });
    const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
    return tasks.flatMap((task: any) => (Array.isArray(task?.interrupts) ? task.interrupts : []));
  }
}
