import { HumanMessage } from "langchain";
import { createMiddleware } from "langchain";
import type { AgentEventEmitter } from "../../domain/agentEvents.js";
import type { SteerBuffer } from "../../domain/steerBuffer.js";

/**
 * `beforeModel` middleware that folds user "steering" instructions into a running
 * turn. Before every model call in the agent loop it drains the per-session
 * {@link SteerBuffer}; any buffered steers are appended to the conversation as
 * user messages (so the model sees them on the very next call) and a
 * `steer-applied` event is emitted on the turn's already-open SSE stream so the
 * frontend knows the steer was actually consumed (not just received/queued).
 *
 * Placed first in the middleware array so the injected messages are present for
 * every downstream `beforeModel` hook (e.g. summarization) and the model itself.
 */
export function createSteerMiddleware(steerBuffer: SteerBuffer) {
  return createMiddleware({
    name: "SteerMiddleware",
    async beforeModel(_state, runtime) {
      const { sessionId, emit } = runtime.context as {
        sessionId: string;
        emit?: AgentEventEmitter;
      };

      const steers = steerBuffer.drain(sessionId);
      if (steers.length === 0) {
        return;
      }

      void emit?.({
        type: "steer-applied",
        count: steers.length,
        ids: steers.map((steer) => steer.id),
      });

      return {
        messages: steers.map(
          (steer) =>
            new HumanMessage(
              `[User steering — new instruction sent mid-turn, take it into account from now on]\n${steer.text}`,
            ),
        ),
      };
    },
  });
}
