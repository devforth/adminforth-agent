import type { AgentModeCompletionAdapter } from "../llm/agentModels.js";
import type { DetectedLanguage, PreviousUserMessage } from "../domain/languageDetect.js";
import type {
  AgentMessage,
  AgentStreamChunk,
  AgentTurnContext,
  AgentTurnObservability,
} from "../domain/turnTypes.js";

/**
 * Input for a single streamed agent turn. Either a fresh set of messages, or a
 * human-in-the-loop resume payload for a previously interrupted turn.
 */
export type LlmStreamInput = {
  completionAdapter: AgentModeCompletionAdapter;
  input: { messages: AgentMessage[] } | { resume: unknown };
  context: AgentTurnContext;
  observability: AgentTurnObservability;
};

/**
 * The boundary between the application layer and the concrete LLM runtime
 * (LangChain / LangGraph). Everything provider-specific — model construction,
 * the agent graph, middleware, and the raw stream shape — lives behind this
 * port. The application layer depends only on this interface, so the turn
 * orchestration is testable with a scripted fake and reusable across providers.
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
   * state (the checkpointer). Used as a fallback when the in-process interrupt
   * cache is empty — e.g. after a restart or on a second instance — so approvals
   * survive process boundaries. Returns raw interrupt objects (LangGraph shape).
   */
  getPendingInterrupts(input: {
    completionAdapter: AgentModeCompletionAdapter;
    sessionId: string;
  }): Promise<unknown[]>;
}
