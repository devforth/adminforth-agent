import type { AdminUser, AudioAdapter } from "adminforth";
import type { Messages } from "@langchain/langgraph";
import type { Command } from "@langchain/langgraph";
import type { AgentChatModel, AgentMiddleware } from "../simpleAgent.js";
import type { SequenceDebugCollector } from "../middleware/sequenceDebug.js";
import type { PreviousUserMessage } from "../languageDetect.js";
import type { CurrentPageContext } from "../tools/getUserLocation.js";
import type { AgentEventEmitter } from "../../agentEvents.js";

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
