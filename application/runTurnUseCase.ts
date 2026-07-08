import { logger, Filters, type IAdminForth } from "adminforth";
import { randomUUID } from "crypto";
import { VegaLiteStreamBuffer } from "../domain/vegaLiteStreamBuffer.js";
import { buildAgentTurnSystemPrompt } from "../domain/systemPrompt.js";
import { getErrorMessage, isAbortError } from "../shared/errors.js";
import type { PreviousUserMessage } from "../domain/languageDetect.js";
import type { AgentSessionStore } from "../persistence/sessionStore.js";
import type { SteerBuffer } from "../domain/steerBuffer.js";
import type { PluginOptions } from "../types.js";
import type { LlmPort } from "./ports.js";
import type {
  AgentMessage,
  AgentTurnContext,
  AgentTurnObservability,
  BaseAgentTurnInput,
  DebugSink,
  HandleTurnInput,
  HandleEditTurnInput,
  PendingInterrupt,
  RunAndPersistAgentResponseInput,
  RunAndPersistAgentResponseResult,
} from "../domain/turnTypes.js";

type AgentMode = PluginOptions["modes"][number];

type PreparedTurn = {
  prompt: string;
  sessionId: string;
  turnId: string;
  previousUserMessages: PreviousUserMessage[];
  mode: AgentMode;
  context: AgentTurnContext;
  observability: AgentTurnObservability;
  resume?: { decision: "approve" | "reject"; interrupts?: PendingInterrupt[] };
  initialResponse?: string;
  branchFromCheckpointId?: string;
};

function getApprovalDecision(input: BaseAgentTurnInput) {
  return "approvalDecision" in input
    && (input.approvalDecision === "approve" || input.approvalDecision === "reject")
    ? input.approvalDecision
    : undefined;
}

function buildHitlDecision(decision: "approve" | "reject", prompt?: string) {
  if (decision === "approve") {
    return { type: "approve" as const };
  }

  return {
    type: "reject" as const,
    message: prompt
      ? `User rejected the pending tool execution and sent a new instruction instead: ${prompt}`
      : "User rejected executing this tool",
  };
}

function buildHitlResumeValue(input: {
  decision: "approve" | "reject";
  count: number;
  prompt?: string;
}) {
  return {
    decisions: Array.from({ length: input.count }, () => (
      buildHitlDecision(input.decision, input.prompt)
    )),
  };
}

/**
 * Build the provider-agnostic resume payload for a human-in-the-loop turn.
 * Exported for unit testing; the LLM port wraps it into a LangGraph Command.
 */
export function buildResumeValue(input: {
  decision: "approve" | "reject";
  interrupts?: PendingInterrupt[];
  prompt?: string;
}) {
  const interrupts = input.interrupts ?? [];

  if (interrupts.length === 0) {
    throw new Error("No pending approval interrupt found for resume.");
  }

  if (interrupts.length === 1) {
    return buildHitlResumeValue({
      decision: input.decision,
      count: interrupts[0].count,
      prompt: input.prompt,
    });
  }

  return Object.fromEntries(
    interrupts.map((interrupt) => [
      interrupt.id,
      buildHitlResumeValue({
        decision: input.decision,
        count: interrupt.count,
        prompt: input.prompt,
      }),
    ]),
  );
}

export type RunTurnUseCaseDeps = {
  llm: LlmPort;
  sessions: AgentSessionStore;
  /** Per-session buffer of mid-turn steering instructions; cleared when a turn ends unconsumed. */
  steerBuffer: SteerBuffer;
  modes: PluginOptions["modes"];
  getAdminforth: () => IAdminForth;
  getAgentSystemPrompt: () => Promise<string>;
  /** True when a persistent checkpointer is configured (not the in-memory MemorySaver). */
  hasPersistentCheckpointer: boolean;
  /**
   * True when `turnResource.checkpointIdField` is configured — the tip checkpoint id
   * is then recorded per turn, enabling message editing / branching.
   */
  turnCheckpointsEnabled: boolean;
  /** Resource config used for the edit ownership check + turn lookups. */
  sessionResource: PluginOptions["sessionResource"];
  /** Factory for the per-turn debug sink; the concrete impl lives in the llm layer. */
  createDebugSink: () => DebugSink;
};

/**
 * Single entry point for running an agent turn: prepare (start/resume) → build
 * the prompt → stream from the LLM port → consume the typed stream into SSE
 * events → persist the result. Replaces the former AgentTurnService plus the
 * TurnLifecycle/Context/Prompt/Persistence/StreamConsumer + ModeResolver stack.
 */
export class RunTurnUseCase {
  private readonly pendingInterrupts = new Map<string, PendingInterrupt[]>();

  constructor(private readonly deps: RunTurnUseCaseDeps) {}

  private resolveMode(modeName?: string | null): AgentMode {
    return this.deps.modes.find((mode) => mode.name === modeName) ?? this.deps.modes[0];
  }

  private buildContext(input: BaseAgentTurnInput, turnId: string): AgentTurnContext {
    return {
      adminUser: input.adminUser,
      sessionId: input.sessionId,
      turnId,
      abortSignal: input.abortSignal,
      currentPage: input.currentPage,
      chatSurface: input.chatSurface,
      userTimeZone: input.userTimeZone ?? "UTC",
      adminPublicOrigin:
        input.adminPublicOrigin ?? this.deps.getAdminforth().config.baseUrlSlashed,
    };
  }

  /**
   * Resolve the pending HITL interrupts for a resume. With a persistent checkpointer the
   * checkpoint is authoritative (correct across instances and restarts); with the in-memory
   * MemorySaver the in-process cache is authoritative (single process, cannot be stale).
   */
  private async resolvePendingInterrupts(sessionId: string, mode: AgentMode): Promise<PendingInterrupt[]> {
    if (this.deps.hasPersistentCheckpointer) {
      // The in-process cache can be stale after a cross-instance resume, so it is intentionally
      // NOT consulted here. A failure to read the checkpoint is surfaced as a real error — never
      // masked as "no pending approval".
      try {
        return await this.deps.llm.getPendingInterrupts({
          completionAdapter: mode.completionAdapter,
          sessionId,
        });
      } catch (error) {
        logger.error(
          `Failed to read pending approval state from checkpoint for session "${sessionId}": ${getErrorMessage(error)}`,
        );
        throw error;
      }
    }
    return this.pendingInterrupts.get(sessionId) ?? [];
  }

  /** Verify the session exists and belongs to the requesting admin user. */
  private async assertSessionOwnership(sessionId: string, adminUser: BaseAgentTurnInput["adminUser"]) {
    const s = this.deps.sessionResource;
    const session = await this.deps.getAdminforth().resource(s.resourceId).get(
      [Filters.EQ(s.idField, sessionId)],
    );
    if (!session) {
      throw new Error(`Session "${sessionId}" not found.`);
    }
    if (session[s.askerIdField] !== adminUser.pk) {
      throw new Error(`Session "${sessionId}" does not belong to the current user.`);
    }
  }

  /**
   * Prepare an edit/branch turn: validate ownership, resolve the fork checkpoint from
   * the previous turn, truncate the conversation after the edited turn, and reuse the
   * edited turn's id for the regenerated response.
   */
  private async prepareEditTurn(input: RunAndPersistAgentResponseInput): Promise<PreparedTurn> {
    const sequenceDebugSink = this.deps.createDebugSink();
    const mode = this.resolveMode(input.modeName);
    const editTurnId = input.editTurnId!;

    if (!this.deps.turnCheckpointsEnabled) {
      throw new Error("Edit/fork requires checkpointIdField to be configured on turnResource.");
    }
    await this.assertSessionOwnership(input.sessionId, input.adminUser);

    const agentTurns = await this.deps.sessions.getAgentTurns(input.sessionId);
    const targetIndex = agentTurns.findIndex((turn) => turn.id === editTurnId);
    if (targetIndex === -1) {
      throw new Error(`Turn "${editTurnId}" not found in session "${input.sessionId}".`);
    }

    const previous = agentTurns[targetIndex - 1];
    let branchFromCheckpointId: string | undefined;
    if (previous) {
      if (!previous.checkpointId) {
        throw new Error(
          `Cannot edit this message: the previous turn has no stored checkpoint to branch from.`,
        );
      }
      branchFromCheckpointId = previous.checkpointId;
    } else {
      // No earlier turn to fork from — drop the whole thread and start fresh.
      await this.deps.llm.resetThreadCheckpoints({
        completionAdapter: mode.completionAdapter,
        sessionId: input.sessionId,
      });
    }

    // Language-detection context: the kept user messages just before the edited turn.
    const previousUserMessages: PreviousUserMessage[] = agentTurns
      .slice(Math.max(0, targetIndex - 2), targetIndex)
      .map((turn) => ({ text: turn.prompt }));

    // Editing supersedes any in-flight turn state for this session.
    this.deps.steerBuffer.clear(input.sessionId);
    this.pendingInterrupts.delete(input.sessionId);

    // Apply the edit + truncate (deletes later turns first, then rewrites the edited turn).
    await this.deps.sessions.editTurnAndTruncateAfter({
      sessionId: input.sessionId,
      turnId: editTurnId,
      newPrompt: input.prompt,
    });
    await this.deps.sessions.touchSession(input.sessionId);

    return {
      prompt: input.prompt,
      sessionId: input.sessionId,
      turnId: editTurnId,
      previousUserMessages,
      mode,
      context: this.buildContext(input, editTurnId),
      observability: { emit: input.emit, sequenceDebugSink },
      branchFromCheckpointId,
    };
  }

  private async prepareTurn(input: RunAndPersistAgentResponseInput): Promise<PreparedTurn> {
    const sequenceDebugSink = this.deps.createDebugSink();
    const mode = this.resolveMode(input.modeName);
    const approvalDecision = getApprovalDecision(input);
    const shouldResume = Boolean(approvalDecision);

    if (input.editTurnId && !shouldResume) {
      return this.prepareEditTurn(input);
    }

    let turnId: string;
    let previousUserMessages: PreviousUserMessage[] = [];
    let initialResponse: string | undefined;
    let resumeInterrupts: PendingInterrupt[] | undefined;

    if (shouldResume) {
      resumeInterrupts = await this.resolvePendingInterrupts(input.sessionId, mode);
      if (resumeInterrupts.length === 0) {
        throw new Error(`No pending approval interrupt found for session "${input.sessionId}".`);
      }
      const resumeState = await this.deps.sessions.getResumeState(input.sessionId);
      turnId = resumeState.turnId;
      initialResponse = resumeState.initialResponse;
    } else {
      previousUserMessages = await this.deps.sessions.getPreviousUserMessages(input.sessionId);
      turnId = await this.deps.sessions.createNewTurn(input.sessionId, input.prompt);
      await this.deps.sessions.touchSession(input.sessionId);
    }

    return {
      prompt: input.prompt,
      sessionId: input.sessionId,
      turnId,
      previousUserMessages,
      mode,
      context: this.buildContext(input, turnId),
      observability: {
        emit: input.emit,
        sequenceDebugSink,
      },
      resume: shouldResume
        ? { decision: approvalDecision!, interrupts: resumeInterrupts }
        : undefined,
      initialResponse,
    };
  }

  private async buildMessages(prepared: PreparedTurn): Promise<AgentMessage[]> {
    const userLanguage = await this.deps.llm
      .detectLanguage({
        completionAdapter: prepared.mode.completionAdapter,
        prompt: prepared.prompt,
        previousUserMessages: prepared.previousUserMessages,
      })
      .catch((error) => {
        if (prepared.context.abortSignal?.aborted || isAbortError(error)) {
          throw error;
        }
        logger.warn(`Failed to detect user language: ${getErrorMessage(error)}`);
        return null;
      });

    const adminforth = this.deps.getAdminforth();
    const systemPrompt = buildAgentTurnSystemPrompt({
      agentSystemPrompt: await this.deps.getAgentSystemPrompt(),
      adminUser: prepared.context.adminUser,
      usernameField: adminforth.config.auth!.usernameField,
      userLanguage,
      chatSurface: prepared.context.chatSurface,
    });

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: prepared.prompt },
    ];
  }

  private async handleInterrupt(
    prepared: PreparedTurn,
    interrupt: unknown,
    descriptors: PendingInterrupt[],
  ) {
    if (!this.deps.hasPersistentCheckpointer) {
      const existing = this.pendingInterrupts.get(prepared.sessionId) ?? [];
      const merged = new Map(existing.map((item) => [item.id, item.count]));
      for (const item of descriptors) {
        merged.set(item.id, item.count);
      }
      this.pendingInterrupts.set(
        prepared.sessionId,
        [...merged.entries()].map(([id, count]) => ({ id, count })),
      );
    }
    await prepared.observability.emit?.({
      type: "interrupt",
      sessionId: prepared.sessionId,
      interrupt,
    });
  }

  private async runAgentTurn(prepared: PreparedTurn): Promise<{ text: string }> {
    const streamInput = prepared.resume
      ? {
          resume: buildResumeValue({
            decision: prepared.resume.decision,
            interrupts: prepared.resume.interrupts,
            prompt: prepared.prompt,
          }),
        }
      : { messages: await this.buildMessages(prepared) };

    const stream = await this.deps.llm.streamTurn({
      completionAdapter: prepared.mode.completionAdapter,
      input: streamInput,
      context: prepared.context,
      observability: prepared.observability,
      branchFromCheckpointId: prepared.branchFromCheckpointId,
    });

    const { emit } = prepared.observability;
    const abortSignal = prepared.context.abortSignal;
    const textBuffer = new VegaLiteStreamBuffer();
    let fullResponse = "";
    let interrupted = false;

    try {
      for await (const chunk of stream) {
        if (abortSignal?.aborted) {
          throw new DOMException("This operation was aborted", "AbortError");
        }

        if (chunk.kind === "interrupt") {
          interrupted = true;
          await this.handleInterrupt(prepared, chunk.interrupt, chunk.descriptors);
          continue;
        }

        if (chunk.kind === "reasoning") {
          if (chunk.delta) {
            await emit?.({ type: "reasoning-delta", delta: chunk.delta });
          }
          continue;
        }

        if (chunk.delta) {
          fullResponse += chunk.delta;
          await textBuffer.push(chunk.delta, emit);
        }
      }

      await textBuffer.flush(emit);
      return { text: fullResponse };
    } finally {
      // When the turn is interrupted for HITL approval it will resume, so any steers
      // buffered meanwhile must survive to be applied on resume. Otherwise the turn is
      // done and leftover (unconsumed) steers must not leak into the next turn.
      if (!interrupted) {
        this.deps.steerBuffer.clear(prepared.sessionId);
      }
      if (!this.deps.hasPersistentCheckpointer && !interrupted) {
        this.pendingInterrupts.delete(prepared.sessionId);
      }
    }
  }

  async runAndPersistAgentResponse(
    input: RunAndPersistAgentResponseInput,
  ): Promise<RunAndPersistAgentResponseResult> {
    const prepared = await this.prepareTurn(input);

    let fullResponse = prepared.initialResponse ?? "";
    let aborted = false;
    let failed = false;

    try {
      const agentResponse = await this.runAgentTurn(prepared);
      fullResponse += agentResponse.text;
    } catch (error) {
      if (input.abortSignal?.aborted || isAbortError(error)) {
        aborted = true;
        logger.info(input.abortLogMessage);
      } else {
        failed = true;
        fullResponse = getErrorMessage(error);
        logger.error(`${input.failureLogMessage}:\n${fullResponse}`);
      }
    }

    // Record the turn's tip checkpoint id ONLY on success, so message editing can
    // fork from it. On abort/failure leave the previous value untouched (undefined =
    // don't overwrite). Never let a checkpoint read break response persistence.
    let checkpointId: string | null | undefined;
    if (!aborted && !failed && this.deps.turnCheckpointsEnabled) {
      try {
        checkpointId = await this.deps.llm.getLatestCheckpointId({
          completionAdapter: prepared.mode.completionAdapter,
          sessionId: prepared.sessionId,
        });
      } catch (error) {
        logger.warn(`Failed to read latest checkpoint id for turn "${prepared.turnId}": ${getErrorMessage(error)}`);
        checkpointId = undefined;
      }
    }

    prepared.observability.sequenceDebugSink.flush();
    await this.deps.sessions.saveTurnResponse({
      turnId: prepared.turnId,
      responseText: fullResponse,
      debugHistory: prepared.observability.sequenceDebugSink.getHistory(),
      checkpointId,
    });

    return {
      text: fullResponse,
      turnId: prepared.turnId,
      aborted,
      failed,
    };
  }

  async handleTurn(input: HandleTurnInput) {
    await input.emit({
      type: "turn-started",
      messageId: randomUUID(),
    });

    const agentResponse = await this.runAndPersistAgentResponse({
      prompt: input.prompt,
      sessionId: input.sessionId,
      modeName: input.modeName,
      userTimeZone: input.userTimeZone,
      currentPage: input.currentPage,
      chatSurface: input.chatSurface,
      adminPublicOrigin: input.adminPublicOrigin,
      approvalDecision: input.approvalDecision,
      abortSignal: input.abortSignal,
      adminUser: input.adminUser,
      emit: input.emit,
      failureLogMessage: input.failureLogMessage ?? "Agent response failed",
      abortLogMessage: input.abortLogMessage ?? "Agent response aborted",
    });

    if (agentResponse.failed) {
      await input.emit({
        type: "error",
        error: agentResponse.text,
      });
    } else if (!agentResponse.aborted) {
      await input.emit({
        type: "response",
        text: agentResponse.text,
        sessionId: input.sessionId,
        turnId: agentResponse.turnId,
      });
    }

    await input.emit({
      type: "finish",
    });

    return agentResponse;
  }

  async handleEditTurn(input: HandleEditTurnInput) {
    await input.emit({
      type: "turn-started",
      messageId: randomUUID(),
    });

    const agentResponse = await this.runAndPersistAgentResponse({
      prompt: input.prompt,
      sessionId: input.sessionId,
      modeName: input.modeName,
      userTimeZone: input.userTimeZone,
      currentPage: input.currentPage,
      chatSurface: input.chatSurface,
      adminPublicOrigin: input.adminPublicOrigin,
      editTurnId: input.turnId,
      abortSignal: input.abortSignal,
      adminUser: input.adminUser,
      emit: input.emit,
      failureLogMessage: input.failureLogMessage ?? "Agent message edit failed",
      abortLogMessage: input.abortLogMessage ?? "Agent message edit aborted",
    });

    if (agentResponse.failed) {
      await input.emit({
        type: "error",
        error: agentResponse.text,
      });
    } else if (!agentResponse.aborted) {
      await input.emit({
        type: "response",
        text: agentResponse.text,
        sessionId: input.sessionId,
        turnId: agentResponse.turnId,
      });
    }

    await input.emit({
      type: "finish",
    });

    return agentResponse;
  }
}
