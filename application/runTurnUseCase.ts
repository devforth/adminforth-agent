import { logger, type IAdminForth } from "adminforth";
import { randomUUID } from "crypto";
import { createSequenceDebugCollector } from "../llm/middleware/sequenceDebug.js";
import { VegaLiteStreamBuffer } from "../domain/vegaLiteStreamBuffer.js";
import { buildAgentTurnSystemPrompt } from "../domain/systemPrompt.js";
import { getErrorMessage, isAbortError } from "../shared/errors.js";
import type { PreviousUserMessage } from "../domain/languageDetect.js";
import type { AgentSessionStore } from "../persistence/sessionStore.js";
import type { PluginOptions } from "../types.js";
import type { LlmPort } from "./ports.js";
import type {
  AgentMessage,
  AgentTurnContext,
  AgentTurnObservability,
  BaseAgentTurnInput,
  HandleTurnInput,
  RunAndPersistAgentResponseInput,
  RunAndPersistAgentResponseResult,
} from "../domain/turnTypes.js";

type AgentMode = PluginOptions["modes"][number];

type PendingInterrupt = { id: string; count: number };

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
};

function getApprovalDecision(input: BaseAgentTurnInput) {
  return "approvalDecision" in input
    && (input.approvalDecision === "approve" || input.approvalDecision === "reject")
    ? input.approvalDecision
    : undefined;
}

function getInterruptItems(interrupt: unknown): unknown[] {
  return Array.isArray(interrupt) ? interrupt : [interrupt];
}

function getHitlInterrupts(interrupt: unknown): PendingInterrupt[] {
  return getInterruptItems(interrupt).flatMap((item) => {
    const value = item && typeof item === "object" && "value" in item
      ? (item as { value: unknown }).value
      : item;
    const actionRequests = value && typeof value === "object"
      ? (value as { actionRequests?: unknown }).actionRequests
      : undefined;
    const interruptId = item && typeof item === "object"
      ? (item as { id?: unknown }).id
      : undefined;

    return typeof interruptId === "string" && Array.isArray(actionRequests)
      ? [{ id: interruptId, count: actionRequests.length }]
      : [];
  });
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
  modes: PluginOptions["modes"];
  getAdminforth: () => IAdminForth;
  getAgentSystemPrompt: () => Promise<string>;
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
   * Resolve the pending HITL interrupts for a resume. Prefers the in-process cache
   * (populated when the interrupt fired this run) and falls back to the persisted
   * checkpoint via the LLM port when the cache is empty (restart / other instance).
   */
  private async resolvePendingInterrupts(sessionId: string, mode: AgentMode): Promise<PendingInterrupt[]> {
    const cached = this.pendingInterrupts.get(sessionId);
    if (cached && cached.length > 0) {
      return cached;
    }
    const raw = await this.deps.llm
      .getPendingInterrupts({ completionAdapter: mode.completionAdapter, sessionId })
      .catch(() => [] as unknown[]);
    return getHitlInterrupts(raw);
  }

  private async prepareTurn(input: RunAndPersistAgentResponseInput): Promise<PreparedTurn> {
    const sequenceDebugSink = createSequenceDebugCollector();
    const mode = this.resolveMode(input.modeName);
    const approvalDecision = getApprovalDecision(input);
    const shouldResume = Boolean(approvalDecision);

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

  private async handleInterrupt(prepared: PreparedTurn, interrupt: unknown) {
    const interrupts = getHitlInterrupts(interrupt);
    const existing = this.pendingInterrupts.get(prepared.sessionId) ?? [];
    const merged = new Map(existing.map((item) => [item.id, item.count]));
    for (const item of interrupts) {
      merged.set(item.id, item.count);
    }
    this.pendingInterrupts.set(
      prepared.sessionId,
      [...merged.entries()].map(([id, count]) => ({ id, count })),
    );
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
          await this.handleInterrupt(prepared, chunk.interrupt);
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
      if (!interrupted) {
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

    prepared.observability.sequenceDebugSink.flush();
    await this.deps.sessions.saveTurnResponse({
      turnId: prepared.turnId,
      responseText: fullResponse,
      debugHistory: prepared.observability.sequenceDebugSink.getHistory(),
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
}
