import { randomUUID } from "crypto";

import type { ToolCallEvent } from "./agent/toolCallEvents.js";

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

export function createAgentEventStream(
  res: AgentEventStreamResponse,
  options: AgentEventStreamOptions = {},
) {
  let isStreamClosed = false;
  let activeBlock: { type: "text" | "reasoning"; id: string } | null = null;

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

    transcript(text: string, language?: string) {
      stream.send({
        type: "transcript",
        data: {
          text,
          language,
        },
      });
    },

    response(text: string, sessionId: string, turnId: string) {
      stream.send({
        type: "response",
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
        type: "speech-response",
        data: {
          transcript,
          response,
          sessionId,
          turnId,
        },
      });
    },

    audioStart(mimeType: string, format: string) {
      stream.send({
        type: "audio-start",
        data: {
          mimeType,
          format,
        },
      });
    },

    audioDelta(value: Uint8Array) {
      stream.send({
        type: "audio-delta",
        data: {
          base64: Buffer.from(value).toString("base64"),
        },
      });
    },

    audioDone() {
      stream.send({
        type: "audio-done",
      });
    },

    error(error: string) {
      stream.send({
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
