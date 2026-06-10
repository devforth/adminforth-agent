import { logger } from "adminforth";
import { randomUUID } from "crypto";
import { Command } from "@langchain/langgraph";
import { AgentModelFactory } from "./agent/models/AgentModelFactory.js";
import { AgentModeResolver } from "./agent/models/AgentModeResolver.js";
import { createSequenceDebugCollector } from "./agent/middleware/sequenceDebug.js";
import { AgentRuntime } from "./agent/runtime/AgentRuntime.js";
import { TurnContextBuilder } from "./agent/turn/TurnContextBuilder.js";
import { TurnLifecycleService } from "./agent/turn/TurnLifecycleService.js";
import { TurnPromptBuilder } from "./agent/turn/TurnPromptBuilder.js";
import { TurnStreamConsumer } from "./agent/turn/TurnStreamConsumer.js";
import type {
  BaseAgentTurnInput,
  HandleTurnInput,
  PreparedAgentTurn,
  RunAndPersistAgentResponseInput,
  RunAndPersistAgentResponseResult,
} from "./agent/turn/turnTypes.js";
import { getErrorMessage, isAbortError } from "./errors.js";

export type {
  BaseAgentTurnInput,
  HandleSpeechTurnInput,
  HandleTurnInput,
  RunAndPersistAgentResponseInput,
  RunAndPersistAgentResponseResult,
} from "./agent/turn/turnTypes.js";

function getApprovalDecision(input: BaseAgentTurnInput) {
  return "approvalDecision" in input
    && (input.approvalDecision === "approve" || input.approvalDecision === "reject")
    ? input.approvalDecision
    : undefined;
}

function getInterruptItems(interrupt: unknown): unknown[] {
  return Array.isArray(interrupt) ? interrupt : [interrupt];
}

function getHitlInterrupts(interrupt: unknown): { id: string; count: number }[] {
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

function buildLangGraphResume(input: {
  decision: "approve" | "reject";
  interrupts?: { id: string; count: number }[];
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

export class AgentTurnService {
  private readonly pendingInterrupts = new Map<string, { id: string; count: number }[]>();

  constructor(
    private readonly lifecycle: TurnLifecycleService,
    private readonly contextBuilder: TurnContextBuilder,
    private readonly modeResolver: AgentModeResolver,
    private readonly modelFactory: AgentModelFactory,
    private readonly promptBuilder: TurnPromptBuilder,
    private readonly runtime: AgentRuntime,
    private readonly streamConsumer: TurnStreamConsumer,
  ) {}

  private async prepareTurn(input: BaseAgentTurnInput): Promise<PreparedAgentTurn> {
    const sequenceDebugCollector = createSequenceDebugCollector();
    const approvalDecision = getApprovalDecision(input);
    const shouldResume = Boolean(approvalDecision);
    const pendingInterrupts = this.pendingInterrupts.get(input.sessionId);
    const lifecycleTurn = shouldResume
      ? await this.lifecycle.resume(input)
      : await this.lifecycle.start(input);
    const context = await this.contextBuilder.build({
      base: input,
      turnId: lifecycleTurn.turnId,
    });

    return {
      prompt: input.prompt,
      sessionId: input.sessionId,
      turnId: lifecycleTurn.turnId,
      previousUserMessages: lifecycleTurn.previousUserMessages,
      modeName: input.modeName,
      context,
      observability: {
        emit: undefined,
        sequenceDebugSink: sequenceDebugCollector,
      },
      resume: shouldResume
        ? {
            decision: approvalDecision!,
            interrupts: pendingInterrupts,
          }
        : undefined,
      initialResponse: shouldResume && "initialResponse" in lifecycleTurn
        ? (lifecycleTurn as { initialResponse?: string }).initialResponse
        : undefined,
    };
  }

  private async runAgentTurn(input: PreparedAgentTurn) {
    const selectedMode = this.modeResolver.resolve(input.modeName);
    const [models, messages] = await Promise.all([
      this.modelFactory.create(selectedMode.completionAdapter),
      this.promptBuilder.build({
        prompt: input.prompt,
        previousUserMessages: input.previousUserMessages,
        adminUser: input.context.adminUser,
        completionAdapter: selectedMode.completionAdapter,
        chatSurface: input.context.chatSurface,
        abortSignal: input.context.abortSignal,
      }),
    ]);
    const stream = await this.runtime.stream({
      models,
      input: input.resume
        ? new Command({
            resume: buildLangGraphResume({
              decision: input.resume.decision,
              interrupts: input.resume.interrupts,
              prompt: input.prompt,
            }),
          })
        : { messages },
      context: input.context,
      observability: input.observability,
    });

    let interrupted = false;
    try {
      return await this.streamConsumer.consume({
        stream: stream as AsyncIterable<["messages", [any, any]] | ["updates", Record<string, any>]>,
        abortSignal: input.context.abortSignal,
        emit: input.observability.emit,
        onInterrupt: async (interrupt) => {
          interrupted = true;
          const interrupts = getHitlInterrupts(interrupt);
          const pendingInterrupts = this.pendingInterrupts.get(input.sessionId) ?? [];
          const mergedInterrupts = new Map(
            pendingInterrupts.map((pendingInterrupt) => [
              pendingInterrupt.id,
              pendingInterrupt.count,
            ]),
          );

          for (const pendingInterrupt of interrupts) {
            mergedInterrupts.set(pendingInterrupt.id, pendingInterrupt.count);
          }

          this.pendingInterrupts.set(
            input.sessionId,
            [...mergedInterrupts.entries()].map(([id, count]) => ({ id, count })),
          );
          await input.observability.emit?.({
            type: "interrupt",
            sessionId: input.sessionId,
            interrupt,
          });
        },
      });
    } finally {
      if (!interrupted) {
        this.pendingInterrupts.delete(input.sessionId);
      }
    }
  }

  async runAndPersistAgentResponse(
    input: RunAndPersistAgentResponseInput,
  ): Promise<RunAndPersistAgentResponseResult> {
    const preparedTurn = await this.prepareTurn(input);
    preparedTurn.observability.emit = input.emit;

    let fullResponse = preparedTurn.initialResponse ?? "";
    let aborted = false;
    let failed = false;

    try {
      const agentResponse = await this.runAgentTurn(preparedTurn);
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

    preparedTurn.observability.sequenceDebugSink.flush();
    await this.lifecycle.finish({
      turnId: preparedTurn.turnId,
      responseText: fullResponse,
      debugHistory: preparedTurn.observability.sequenceDebugSink.getHistory(),
    });

    return {
      text: fullResponse,
      turnId: preparedTurn.turnId,
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
