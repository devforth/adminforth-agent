import { randomUUID } from "crypto";

/** A single steering instruction the user sent while a turn was already running. */
export type SteerMessage = {
  id: string;
  text: string;
  /** Epoch ms the steer was enqueued; useful for ordering/debugging. */
  at: number;
};

/**
 * In-process, per-session buffer of steering instructions.
 *
 * While an agent turn is streaming (thinking / calling tools) the user may send
 * one or more extra instructions ("steers"). Each is enqueued here by the
 * `/agent/steer` endpoint and drained by the `beforeModel` steer middleware just
 * before the next model call in the same running loop, so the model course-corrects
 * mid-turn instead of the user having to abort and restart.
 *
 * The buffer is deliberately in-process: a steer only makes sense for a turn that
 * is *currently running*, and that turn's SSE stream is held open on exactly one
 * instance/process. In a multi-instance deployment the `/agent/steer` request must
 * therefore reach the same instance running the turn (same constraint the in-memory
 * HITL cache / MemorySaver already carry when no persistent checkpointer is set).
 */
export class SteerBuffer {
  private readonly buffers = new Map<string, SteerMessage[]>();

  /** Enqueue a steering instruction for a session. Returns the created entry. */
  add(sessionId: string, text: string): SteerMessage {
    const message: SteerMessage = { id: randomUUID(), text, at: Date.now() };
    const existing = this.buffers.get(sessionId);

    if (existing) {
      existing.push(message);
    } else {
      this.buffers.set(sessionId, [message]);
    }

    return message;
  }

  /** Number of steers currently buffered for a session. */
  size(sessionId: string): number {
    return this.buffers.get(sessionId)?.length ?? 0;
  }

  /** Return every buffered steer for a session and remove them from the buffer. */
  drain(sessionId: string): SteerMessage[] {
    const messages = this.buffers.get(sessionId);

    if (!messages || messages.length === 0) {
      return [];
    }

    this.buffers.delete(sessionId);
    return messages;
  }

  /** Discard any buffered steers for a session (e.g. when its turn ends unconsumed). */
  clear(sessionId: string): void {
    this.buffers.delete(sessionId);
  }
}
