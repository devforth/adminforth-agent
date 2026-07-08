import { randomUUID } from "crypto";

import type { AgentEvent, AgentEventEmitter } from "../../domain/agentEvents.js";
import type { ToolCallEvent } from "../../domain/toolCallEvents.js";

type AgentEventStreamResponse = {
  writeHead: (statusCode: number, headers: Record<string, string>) => void;
  write: (chunk: string) => unknown;
  end: () => unknown;
  writableEnded: boolean;
  destroyed: boolean;
};

type AgentEventStreamOptions = {
  vercelAiUiMessageStream?: boolean;
  closeActiveBlockOnToolStart?: boolean;
};

function createAgentEventStream(
  res: AgentEventStreamResponse,
  options: AgentEventStreamOptions = {},
) {
  let isStreamClosed = false;
  let activeBlock: { type: "text" | "reasoning"; id: string } | null = null;
  const isAiUiMessageStream = options.vercelAiUiMessageStream === true;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    ...(options.vercelAiUiMessageStream
      ? { "x-vercel-ai-ui-message-stream": "v1" }
      : {}),
  });

  const stream = {
    send(obj: unknown) {
      if (isStreamClosed || res.writableEnded || res.destroyed) {
        return;
      }

      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    },

    endActiveBlock() {
      if (!activeBlock) {
        return;
      }

      stream.send({
        type: `${activeBlock.type}-end`,
        id: activeBlock.id,
      });

      activeBlock = null;
    },

    startBlock(type: "text" | "reasoning") {
      if (activeBlock?.type === type) {
        return activeBlock.id;
      }

      stream.endActiveBlock();

      const id = randomUUID();
      activeBlock = { type, id };

      stream.send({
        type: `${type}-start`,
        id,
      });

      return id;
    },

    start(messageId: string) {
      stream.send({
        type: "start",
        messageId,
      });
    },

    textDelta(delta: string) {
      const textId = stream.startBlock("text");
      stream.send({
        type: "text-delta",
        id: textId,
        delta,
      });
    },

    reasoningDelta(delta: string) {
      const reasoningId = stream.startBlock("reasoning");
      stream.send({
        type: "reasoning-delta",
        id: reasoningId,
        delta,
      });
    },

    toolCall(event: ToolCallEvent) {
      if (options.closeActiveBlockOnToolStart && event.phase === "start") {
        stream.endActiveBlock();
      }

      stream.send({
        type: "data-tool-call",
        data: event,
      });
    },

    rendering(phase: "start" | "end", label: string) {
      if (phase === "start") {
        stream.endActiveBlock();
      }

      stream.send({
        type: "data-rendering",
        data: {
          phase,
          label,
        },
      });
    },

    interrupt(sessionId: string, interrupt: unknown) {
      stream.endActiveBlock();
      stream.send({
        type: isAiUiMessageStream ? "data-interrupt" : "interrupt",
        data: {
          sessionId,
          interrupt,
        },
      });
    },

    steerApplied(count: number, ids: string[]) {
      stream.send({
        type: isAiUiMessageStream ? "data-steer-applied" : "steer-applied",
        data: {
          count,
          ids,
        },
      });
    },

    openPage(targetPath: string) {
      stream.send({
        type: isAiUiMessageStream ? "data-open-page" : "open-page",
        data: {
          targetPath,
        },
      });
    },

    transcript(text: string, language?: string) {
      stream.send({
        type: isAiUiMessageStream ? "data-transcript" : "transcript",
        data: {
          text,
          language,
        },
      });
    },

    turnPersisted(sessionId: string, turnId: string) {
      stream.send({
        type: isAiUiMessageStream ? "data-turn-persisted" : "turn-persisted",
        data: {
          sessionId,
          turnId,
        },
      });
    },

    response(text: string, sessionId: string, turnId: string) {
      stream.send({
        type: isAiUiMessageStream ? "data-response" : "response",
        data: {
          text,
          sessionId,
          turnId,
        },
      });
    },

    speechResponse(
      transcript: { text: string; language?: string },
      response: { text: string },
      sessionId: string,
      turnId: string,
    ) {
      stream.send({
        type: isAiUiMessageStream ? "data-speech-response" : "speech-response",
        data: {
          transcript,
          response,
          sessionId,
          turnId,
        },
      });
    },

    audioStart(
      mimeType: string,
      format: string,
      sampleRate: number,
      channelCount: number,
      bitsPerSample: number,
    ) {
      stream.send({
        type: isAiUiMessageStream ? "data-audio-start" : "audio-start",
        data: {
          mimeType,
          format,
          sampleRate,
          channelCount,
          bitsPerSample,
        },
      });
    },

    audioDelta(value: Uint8Array) {
      stream.send({
        type: isAiUiMessageStream ? "data-audio-delta" : "audio-delta",
        data: {
          base64: Buffer.from(value).toString("base64"),
        },
      });
    },

    audioDone() {
      stream.send({
        type: isAiUiMessageStream ? "data-audio-done" : "audio-done",
        ...(isAiUiMessageStream ? { data: {} } : {}),
      });
    },

    error(error: string) {
      stream.send(isAiUiMessageStream
        ? {
            type: "error",
            errorText: error,
          }
        : {
            type: "error",
            error,
          });
    },

    end() {
      if (isStreamClosed || res.writableEnded || res.destroyed) {
        return;
      }

      stream.endActiveBlock();
      stream.send({
        type: "finish",
      });

      res.write("data: [DONE]\n\n");
      isStreamClosed = true;
      res.end();
    },
  };

  return stream;
}

/**
 * Maps the internal {@link AgentEvent} vocabulary onto the two Server-Sent-Events
 * wire dialects the frontend consumes. Both dialects are HARD external contracts —
 * do not change frame names/shapes without updating the corresponding consumer:
 *
 * - `vercelAiUiMessageStream: true` (used by `/agent/response` and `/agent/approval`):
 *   the Vercel AI SDK message-stream v1 format (`start`, `text-start`/`text-delta`/
 *   `text-end`, `reasoning-*`, `data-*` parts including `data-steer-applied`,
 *   `error` with `errorText`, `finish`, `[DONE]`). Consumed by `DefaultChatTransport`
 *   and the manual approval parser in `custom/composables/agentStore/useAgentChat.ts`.
 * - default (used by `/agent/speech-response`): bare event names
 *   (`transcript`, `speech-response`, `audio-start`/`audio-delta`/`audio-done`,
 *   `open-page`, `error`) plus the Vercel-shaped `data-tool-call`. Consumed by
 *   `custom/composables/useAgentAudio.ts`.
 */
export function createSseEventEmitter(
  res: AgentEventStreamResponse,
  options: AgentEventStreamOptions = {},
): AgentEventEmitter {
  const stream = createAgentEventStream(res, options);

  return async (event: AgentEvent) => {
    switch (event.type) {
      case "turn-started":
        stream.start(event.messageId);
        break;
      case "text-delta":
        stream.textDelta(event.delta);
        break;
      case "reasoning-delta":
        stream.reasoningDelta(event.delta);
        break;
      case "tool-call":
        stream.toolCall(event.data);
        break;
      case "rendering":
        stream.rendering(event.phase, event.label);
        break;
      case "interrupt":
        stream.interrupt(event.sessionId, event.interrupt);
        break;
      case "steer-applied":
        stream.steerApplied(event.count, event.ids);
        break;
      case "open-page":
        stream.openPage(event.targetPath);
        break;
      case "transcript":
        stream.transcript(event.text, event.language);
        break;
      case "turn-persisted":
        stream.turnPersisted(event.sessionId, event.turnId);
        break;
      case "response":
        stream.response(event.text, event.sessionId, event.turnId);
        break;
      case "speech-response":
        stream.speechResponse(event.transcript, event.response, event.sessionId, event.turnId);
        break;
      case "audio-start":
        stream.audioStart(
          event.mimeType,
          event.format,
          event.sampleRate,
          event.channelCount,
          event.bitsPerSample,
        );
        break;
      case "audio-delta":
        stream.audioDelta(event.value);
        break;
      case "audio-done":
        stream.audioDone();
        break;
      case "error":
        stream.error(event.error);
        break;
      case "finish":
        stream.end();
        break;
    }
  };
}
