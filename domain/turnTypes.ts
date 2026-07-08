import type { AdminUser, AudioAdapter } from "adminforth";
import type { PreviousUserMessage } from "./languageDetect.js";
import type { CurrentPageContext } from "../tools/getUserLocation.js";
import type { AgentEventEmitter } from "./agentEvents.js";

/**
 * Minimal sink the application layer uses to persist per-turn debug traces. The
 * concrete implementation (the sequence-debug collector) lives in the llm layer;
 * the domain/application layers depend only on this narrow interface, so the
 * dependency direction stays llm -> application/domain.
 */
export type DebugSink = {
  flush(): void;
  getHistory(): unknown[];
};

/** A pending human-in-the-loop approval, normalized (provider-agnostic). */
export type PendingInterrupt = {
  id: string;
  count: number;
};

export type BaseAgentTurnInput = {
  prompt: string;
  sessionId: string;
  modeName?: string | null;
  userTimeZone?: string;
  currentPage?: CurrentPageContext;
  chatSurface?: string;
  adminPublicOrigin?: string;
  abortSignal?: AbortSignal;
  adminUser: AdminUser;
};

export type TextAgentTurnInput = BaseAgentTurnInput & {
  emit: AgentEventEmitter;
  approvalDecision?: "approve" | "reject";
  failureLogMessage?: string;
  abortLogMessage?: string;
};

export type SpeechAgentTurnInput = Omit<BaseAgentTurnInput, "prompt"> & {
  emit: AgentEventEmitter;
  audioAdapter: AudioAdapter;
  audio: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  };
  failureLogMessage?: string;
  abortLogMessage?: string;
};

export type AgentTurnContext = {
  adminUser: AdminUser;
  userTimeZone: string;
  sessionId: string;
  turnId: string;
  abortSignal?: AbortSignal;
  currentPage?: CurrentPageContext;
  chatSurface?: string;
  adminPublicOrigin?: string;
};

export type AgentTurnObservability = {
  emit?: AgentEventEmitter;
  sequenceDebugSink: DebugSink;
};

export type RunAndPersistAgentResponseInput = BaseAgentTurnInput & {
  emit?: AgentEventEmitter;
  approvalDecision?: "approve" | "reject";
  failureLogMessage: string;
  abortLogMessage: string;
  editTurnId?: string;
};

export type RunAndPersistAgentResponseResult = {
  text: string;
  turnId: string;
  aborted: boolean;
  failed: boolean;
};

export type HandleTurnInput = TextAgentTurnInput;
export type HandleSpeechTurnInput = SpeechAgentTurnInput;
export type HandleEditTurnInput = TextAgentTurnInput & { turnId: string };

/**
 * Provider-agnostic message passed from the application layer to the LLM port.
 * The infrastructure adapter maps it onto concrete LangChain messages.
 */
export type AgentMessage = {
  role: "system" | "user";
  content: string;
};

/**
 * Normalized unit of a streamed agent turn. The LLM port converts the raw
 * LangGraph stream into these typed chunks so the application layer never
 * touches LangGraph's tuple/`any` stream shape.
 */
export type AgentStreamChunk =
  | { kind: "text"; delta: string }
  | { kind: "reasoning"; delta: string }
  | { kind: "interrupt"; interrupt: unknown; descriptors: PendingInterrupt[] };
