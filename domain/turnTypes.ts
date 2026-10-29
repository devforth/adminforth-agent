import type { AdminUser, AudioAdapter } from "adminforth";
import type { DetectedLanguage } from "./languageDetect.js";
import type { CurrentPageContext } from "../tools/getUserLocation.js";
import type { AgentEventEmitter } from "./agentEvents.js";
import type { ApprovalRequest } from "../tools/approvalFormatter.js";

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
  /** Number of decisions the provider expects on resume (one per pending tool call). */
  count: number;
  /** The pending tool calls, normalized so they can be described to the user. */
  requests: ApprovalRequest[];
};

/**
 * An image sent with a user message. `token` proves the file was uploaded through this
 * session's upload URL; it may be omitted only for a file the edited turn already has.
 */
export type AttachmentRef = {
  filePath: string;
  token?: string;
};

/** An image of a stored turn: its storage path and a signed url to show it. */
export type TurnAttachment = {
  filePath: string;
  url: string;
};

export type BaseAgentTurnInput = {
  prompt: string;
  sessionId: string;
  modeName?: string | null;
  userTimeZone?: string;
  currentPage?: CurrentPageContext;
  chatSurface?: string;
  adminPublicOrigin?: string;
  attachments?: AttachmentRef[];
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
  userLanguage?: DetectedLanguage | null;
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

export type AgentMessage = {
  role: "user";
  content: string;
  /** Storage paths of attached images; turned into image blocks only for the model call. */
  attachments: string[];
};

/**
 * Normalized unit of a streamed agent turn. The LLM port converts the raw
 * LangGraph stream into these typed chunks so the application layer never
 * touches LangGraph's tuple/`any` stream shape.
 */
export type AgentStreamChunk =
  | { kind: "text"; delta: string }
  | { kind: "reasoning"; delta: string }
  | {
      kind: "interrupt";
      interrupt: unknown;
      descriptors: PendingInterrupt[];
    };
