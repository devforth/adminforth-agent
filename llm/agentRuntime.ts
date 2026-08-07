import type { IAdminForth } from "adminforth";
import {
  createAgent,
  summarizationMiddleware,
  humanInTheLoopMiddleware,
  dynamicSystemPromptMiddleware,
} from "langchain";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createApiBasedToolsMiddleware } from "./middleware/apiToolsMiddleware.js";
import { createSequenceDebugMiddleware, type SequenceDebugCollector } from "./middleware/sequenceDebug.js";
import { createSteerMiddleware } from "./middleware/steerMiddleware.js";
import type { SteerBuffer } from "../domain/steerBuffer.js";
import { createAgentLlmMetricsLogger } from "./agentModels.js";
import type { AgentToolProvider } from "../tools/agentToolProvider.js";
import type { AgentRuntimeRunInput, AgentTurnModels } from "./agentModels.js";
import { contextSchema, toLangchainAgentContext, type AgentContext } from "./agentContext.js";
import type { ApiBasedTool } from "../tools/apiBasedTools.js";
import { createLegacySystemMessagesMiddleware } from "./middleware/legacySystemMessages.js";
import { buildDynamicSystemPrompt } from "../domain/systemPrompt.js";

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
    const legacySystemMessagesMiddleware = createLegacySystemMessagesMiddleware();
    const usernameField = adminforth.config.auth!.usernameField;
    const dynamicPromptMiddleware = dynamicSystemPromptMiddleware<AgentContext>(
      (_state, runtime) =>
        buildDynamicSystemPrompt({
          adminUser: runtime.context.adminUser,
          usernameField,
          userLanguage: runtime.context.userLanguage,
          chatSurface: runtime.context.chatSurface,
        }),
    );
    const middleware = [
      steerMiddleware,
      apiBasedToolsMiddleware,
      hitlMiddleware,
      legacySystemMessagesMiddleware,
      dynamicPromptMiddleware,
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
      // Passed as a plain string on purpose: LangChain normalizes it to a single text
      // block, and DynamicSystemPromptMiddleware appends the per-turn half as a second
      // one. That block split is all the agent owes the provider — whether the boundary
      // becomes a cache breakpoint is the adapter's call.
      systemPrompt: input.systemPrompt,
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
        // When editing/branching, fork from this checkpoint instead of the
        // thread's latest state. LangGraph writes the new branch as fresh
        // (time-ordered) checkpoints, so it becomes the thread's latest.
        ...(input.branchFromCheckpointId
          ? { checkpoint_id: input.branchFromCheckpointId }
          : {}),
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

  /**
   * Return the thread's latest (tip) checkpoint id, or null when the thread has no
   * persisted state. Builds a minimal agent and reads its state — no model call is
   * made. Called after a turn completes to record the turn's fork point for editing.
   */
  async getLatestCheckpointId(input: {
    models: AgentTurnModels;
    sessionId: string;
  }): Promise<string | null> {
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
    const checkpointId = state?.config?.configurable?.checkpoint_id;
    return checkpointId ? String(checkpointId) : null;
  }

  /**
   * Drop the entire LangGraph checkpoint thread for a session. Used when editing the
   * first message, where there is no earlier checkpoint to fork from.
   */
  async resetThreadCheckpoints(sessionId: string): Promise<void> {
    await this.options.getCheckpointer().deleteThread(sessionId);
  }
}
