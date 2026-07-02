import type { AdminUser, AudioAdapter } from "adminforth";
import type { Messages } from "@langchain/langgraph";
import type { Command } from "@langchain/langgraph";
import type { AgentChatModel, AgentMiddleware } from "../llm/agentModels.js";
import type { SequenceDebugCollector } from "../llm/middleware/sequenceDebug.js";
import type { PreviousUserMessage } from "./languageDetect.js";
import type { CurrentPageContext } from "../tools/getUserLocation.js";
import type { AgentEventEmitter } from "./agentEvents.js";

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
  sequenceDebugSink: SequenceDebugCollector;
};

export type PreparedAgentTurn = {
  prompt: string;
  sessionId: string;
  turnId: string;
  previousUserMessages: PreviousUserMessage[];
  modeName?: string | null;
  context: AgentTurnContext;
  observability: AgentTurnObservability;
  resume?: {
    decision: "approve" | "reject";
    interrupts?: { id: string; count: number }[];
  };
  initialResponse?: string;
};

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
};

export type RunAndPersistAgentResponseInput = BaseAgentTurnInput & {
  emit?: AgentEventEmitter;
  approvalDecision?: "approve" | "reject";
  failureLogMessage: string;
  abortLogMessage: string;
};

export type RunAndPersistAgentResponseResult = {
  text: string;
  turnId: string;
  aborted: boolean;
  failed: boolean;
};

export type HandleTurnInput = TextAgentTurnInput;
export type HandleSpeechTurnInput = SpeechAgentTurnInput;

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
  | { kind: "interrupt"; interrupt: unknown };
