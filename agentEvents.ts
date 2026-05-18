import type { ToolCallEvent } from "./agent/toolCallEvents.js";

export type AgentEvent =
  | {
      type: "turn-started";
      messageId: string;
    }
  | {
      type: "text-delta";
      delta: string;
    }
  | {
      type: "reasoning-delta";
      delta: string;
    }
  | {
      type: "tool-call";
      data: ToolCallEvent;
    }
  | {
      type: "transcript";
      text: string;
      language?: string;
    }
  | {
      type: "response";
      text: string;
      sessionId: string;
      turnId: string;
    }
  | {
      type: "speech-response";
      transcript: { text: string; language?: string };
      response: { text: string };
      sessionId: string;
      turnId: string;
    }
  | {
      type: "audio-start";
      mimeType: string;
      format: string;
      sampleRate: number;
      channelCount: number;
      bitsPerSample: number;
    }
  | {
      type: "audio-delta";
      value: Uint8Array;
    }
  | {
      type: "audio-done";
    }
  | {
      type: "error";
      error: string;
    }
  | {
      type: "finish";
    };

export type AgentEventEmitter = (event: AgentEvent) => void | Promise<void>;
