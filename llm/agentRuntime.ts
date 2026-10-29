import type { AdminUser, IAdminForth } from "adminforth";
import {
  createAgent,
  summarizationMiddleware,
  humanInTheLoopMiddleware,
  dynamicSystemPromptMiddleware,
} from "langchain";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createMcpToolsMiddleware } from "./middleware/mcpToolsMiddleware.js";
import { createSequenceDebugMiddleware, type SequenceDebugCollector } from "./middleware/sequenceDebug.js";
import { createSteerMiddleware } from "./middleware/steerMiddleware.js";
import { createAttachmentsMiddleware } from "./middleware/attachmentsMiddleware.js";
import { createViewImageTool } from "../tools/viewImage.js";
import type { ImageAttachmentsLimits } from "../domain/imageAttachments.js";
import type { SteerBuffer } from "../domain/steerBuffer.js";
import { createAgentLlmMetricsLogger } from "./agentModels.js";
import type { AgentToolProvider, AgentToolSet } from "../tools/agentToolProvider.js";
import type { AgentRuntimeRunInput, AgentTurnModels } from "./agentModels.js";
import { contextSchema, toLangchainAgentContext, type AgentContext } from "./agentContext.js";
import { createLegacySystemMessagesMiddleware } from "./middleware/legacySystemMessages.js";
import { buildDynamicSystemPrompt } from "../domain/systemPrompt.js";

function createApprovalMiddleware(toolSet: AgentToolSet) {
  return humanInTheLoopMiddleware({
    interruptOn: Object.fromEntries(
      toolSet.approvalToolNames.map((toolName) => [
        toolName,
        {
          allowedDecisions: ["approve", "reject"] as ("approve" | "reject" | "edit")[],
        },
      ]),
    ),
    descriptionPrefix: "Tool execution pending approval",
  });
}

/** Keeps the turn's MCP connection open until its stream is drained or abandoned. */
async function* closeAfter<T>(stream: AsyncIterable<T>, close: () => Promise<void>) {
  try {
    yield* stream;
  } finally {
    await close();
  }
}

export type AgentRuntimeOptions = {
  name: string;
  getAdminforth: () => IAdminForth;
  getCheckpointer: () => BaseCheckpointSaver;
  toolProvider: Pick<AgentToolProvider, "open">;
  steerBuffer: SteerBuffer;
  attachmentsEnabled: boolean;
  imageAttachmentsLimits: ImageAttachmentsLimits;
  loadAttachmentAsDataUrl: (filePath: string) => Promise<string>;
};

export class AgentRuntime {
  constructor(private readonly options: AgentRuntimeOptions) {}

  async stream(input: AgentRuntimeRunInput) {
    const toolSet = await this.options.toolProvider.open({
      adminUser: input.context.adminUser,
      sessionId: input.context.sessionId,
      userTimeZone: input.context.userTimeZone,
    });

    try {
      const adminforth = this.options.getAdminforth();
      const sequenceDebugSink = input.observability.sequenceDebugSink as SequenceDebugCollector;
      const usernameField = adminforth.config.auth!.usernameField;
      const dynamicPromptMiddleware = dynamicSystemPromptMiddleware<AgentContext>(
        (_state, runtime) =>
          buildDynamicSystemPrompt({
            adminUser: runtime.context.adminUser,
            usernameField,
            userTimeZone: runtime.context.userTimeZone,
            userLanguage: runtime.context.userLanguage,
            chatSurface: runtime.context.chatSurface,
          }),
      );
      const middleware = [
        createSteerMiddleware(this.options.steerBuffer),
        createMcpToolsMiddleware(toolSet.dynamicTools, adminforth),
        createApprovalMiddleware(toolSet),
        createLegacySystemMessagesMiddleware(),
        dynamicPromptMiddleware,
        ...(input.models.modelMiddleware ?? []),
        createSequenceDebugMiddleware(sequenceDebugSink),
        summarizationMiddleware({
          model: input.models.summaryModel,
          trigger: { tokens: 1024 * 64 },
          keep: { messages: 10 },
        }),
        createAttachmentsMiddleware(this.options.loadAttachmentAsDataUrl, this.options.imageAttachmentsLimits),
      ] as const;

      const agent = createAgent({
        name: this.options.name,
        model: input.models.model,
        // Passed as a plain string on purpose: LangChain normalizes it to a single text
        // block, and DynamicSystemPromptMiddleware appends the per-turn half as a second
        // one. That block split is all the agent owes the provider — whether the boundary
        // becomes a cache breakpoint is the adapter's call. The MCP server instructions
        // come first: the agent's own rules refine them for this chat.
        systemPrompt: `${toolSet.instructions}\n\n${input.systemPrompt}`,
        checkpointer: this.options.getCheckpointer(),
        tools: this.options.attachmentsEnabled
          ? [...toolSet.baseTools, createViewImageTool(this.options.imageAttachmentsLimits)]
          : toolSet.baseTools,
        contextSchema,
        middleware,
      });

      const stream = await agent.stream(input.input as any, {
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

      return closeAfter(stream, toolSet.close);
    } catch (error) {
      await toolSet.close();
      throw error;
    }
  }

  private async getThreadState(input: {
    models: AgentTurnModels;
    sessionId: string;
    adminUser: AdminUser;
  }): Promise<any> {
    const toolSet = await this.options.toolProvider.open({
      adminUser: input.adminUser,
      sessionId: input.sessionId,
    });

    try {
      const agent = createAgent({
        name: this.options.name,
        model: input.models.model,
        checkpointer: this.options.getCheckpointer(),
        tools: toolSet.baseTools,
        contextSchema,
        middleware: [createApprovalMiddleware(toolSet)],
      });

      return await (agent as { getState: (config: unknown) => Promise<any> }).getState({
        configurable: { thread_id: input.sessionId },
      });
    } finally {
      await toolSet.close();
    }
  }

  /**
   * Read the pending human-in-the-loop interrupts persisted for a thread from the
   * checkpointer. Returns raw LangGraph interrupt objects.
   */
  async getPendingInterrupts(input: {
    models: AgentTurnModels;
    sessionId: string;
    adminUser: AdminUser;
  }): Promise<unknown[]> {
    const state = await this.getThreadState(input);
    const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
    return tasks.flatMap((task: any) => (Array.isArray(task?.interrupts) ? task.interrupts : []));
  }

  /**
   * Return the thread's latest (tip) checkpoint id, or null when the thread has no
   * persisted state. Called after a turn completes to record the turn's fork point
   * for editing.
   */
  async getLatestCheckpointId(input: {
    models: AgentTurnModels;
    sessionId: string;
    adminUser: AdminUser;
  }): Promise<string | null> {
    const state = await this.getThreadState(input);
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
