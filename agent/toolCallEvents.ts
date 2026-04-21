import { randomUUID } from "crypto";
import YAML from "yaml";
import { serializeUnknownError } from "../apiBasedTools.js";

export type ToolCallEvent =
  | {
      toolCallId: string;
      toolName: string;
      phase: "start";
      input: string;
    }
  | {
      toolCallId: string;
      toolName: string;
      phase: "end";
      durationMs: number;
      output: string | null;
      error: string | null;
    };

export type ToolCallEventSink = (event: ToolCallEvent) => void;

const TOOL_MESSAGE_DEBUG_KEYS = new Set([
  "metadata",
  "additional_kwargs",
  "response_metadata",
]);

function sanitizeToolCallOutputForDebug(output: unknown) {
  if (typeof output !== "object" || output === null) {
    return output;
  }

  const outputRecord = output as Record<string, unknown>;

  if (!("tool_call_id" in outputRecord)) {
    return output;
  }

  return Object.fromEntries(
    Object.entries(outputRecord).filter(([key]) => !TOOL_MESSAGE_DEBUG_KEYS.has(key)),
  );
}

export function createToolCallTracker(params: {
  emit: ToolCallEventSink;
  toolCallId?: string;
  toolName: string;
  input?: Record<string, unknown>;
  startedAt?: number;
}) {
  const toolCallId = params.toolCallId ?? randomUUID();
  const startedAt = params.startedAt ?? Date.now();

  return {
    start() {
      params.emit({
        toolCallId,
        toolName: params.toolName,
        phase: "start",
        input: YAML.stringify(params.input ?? {}),
      });
    },
    finishSuccess(output: unknown) {
      params.emit({
        toolCallId,
        toolName: params.toolName,
        phase: "end",
        durationMs: Date.now() - startedAt,
        output: YAML.stringify(sanitizeToolCallOutputForDebug(output)).trimEnd(),
        error: null,
      });
    },
    finishError(error: unknown) {
      params.emit({
        toolCallId,
        toolName: params.toolName,
        phase: "end",
        durationMs: Date.now() - startedAt,
        output: null,
        error: YAML.stringify(serializeUnknownError(error)).trimEnd(),
      });
    },
  };
}
