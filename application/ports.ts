import type { CompletionAdapter } from "adminforth";
import type { DetectedLanguage, PreviousUserMessage } from "../domain/languageDetect.js";
import type {
  AgentMessage,
  AgentStreamChunk,
  AgentTurnContext,
  AgentTurnObservability,
  PendingInterrupt,
} from "../domain/turnTypes.js";

export type AgentModelPurpose = "primary" | "summary";

/**
 * The LLM provider adapter contract (the "provider port"). Extends AdminForth's
 * CompletionAdapter with the agent-spec factory. Declared in the application layer
 * so the infrastructure (llm/) depends on this contract — not the other way around.
 */
export type AgentModeCompletionAdapter = CompletionAdapter & {
  getLangChainAgentSpec(params: {
    maxTokens: number;
    purpose: AgentModelPurpose;
  }): Promise<{ model: unknown; middleware?: unknown[] }> | { model: unknown; middleware?: unknown[] };
};

/**
 * Input for a single streamed agent turn. Either a fresh set of messages, or a
 * human-in-the-loop resume payload for a previously interrupted turn.
 */
export type LlmStreamInput = {
  completionAdapter: AgentModeCompletionAdapter;
  systemPrompt: string;
  input: { messages: AgentMessage[] } | { resume: unknown };
  context: AgentTurnContext;
  observability: AgentTurnObservability;
  branchFromCheckpointId?: string;
};

/**
 * The boundary between the application layer and the concrete LLM runtime
 * (LangChain / LangGraph). Everything provider-specific — model construction,
 * the agent graph, middleware, the raw stream shape, and the LangGraph interrupt
 * shape — lives behind this port and is normalized before crossing it.
 */
export interface LlmPort {
  /**
   * Run one turn and return a normalized stream of typed chunks.
   */
  streamTurn(input: LlmStreamInput): Promise<AsyncIterable<AgentStreamChunk>>;

  /**
   * Detect the language the assistant should answer in for the current message.
   */
  detectLanguage(input: {
    completionAdapter: AgentModeCompletionAdapter;
    prompt: string;
    previousUserMessages: PreviousUserMessage[];
  }): Promise<DetectedLanguage | null>;

  /**
   * Rebuild the pending human-in-the-loop interrupts for a session from persisted
   * checkpoint state (used when the in-process cache is empty — after a restart or
   * on another instance). Returns already-normalized descriptors; the LangGraph
   * interrupt shape never leaves the llm layer. Throws on a checkpoint/runtime
   * failure (the caller must not treat that as "no pending interrupt").
   */
  getPendingInterrupts(input: {
    completionAdapter: AgentModeCompletionAdapter;
    sessionId: string;
  }): Promise<PendingInterrupt[]>;

  /**
   * Return the session thread's latest (tip) checkpoint id, or null when the thread
   * has no persisted state. Recorded on each turn so message editing can fork from
   * the previous turn's checkpoint.
   */
  getLatestCheckpointId(input: {
    completionAdapter: AgentModeCompletionAdapter;
    sessionId: string;
  }): Promise<string | null>;

  /**
   * Drop the entire LangGraph checkpoint thread for a session. Used when editing the
   * first message, where there is no earlier checkpoint to fork from.
   */
  resetThreadCheckpoints(input: {
    completionAdapter: AgentModeCompletionAdapter;
    sessionId: string;
  }): Promise<void>;
}
