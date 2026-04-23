import { randomUUID } from "crypto";
import YAML from "yaml";
import { serializeUnknownError } from "../apiBasedTools.js";

export type ToolCallEvent =
  | {
      toolCallId: string;
      toolName: string;
      toolInfo?: string;
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

function getToolCallDebugPayload(outputRecord: Record<string, unknown>) {
  const lcKwargs =
    typeof outputRecord.lc_kwargs === "object" && outputRecord.lc_kwargs !== null
      ? outputRecord.lc_kwargs as Record<string, unknown>
      : null;

  if (lcKwargs && "tool_call_id" in lcKwargs) {
    return lcKwargs;
  }

  if ("tool_call_id" in outputRecord) {
    return outputRecord;
  }

  return null;
}

function sanitizeToolCallOutputForDebug(output: unknown) {
  if (typeof output !== "object" || output === null) {
    return output;
  }

  const outputRecord = output as Record<string, unknown>;
  const debugPayload = getToolCallDebugPayload(outputRecord);

  if (!debugPayload) {
    return output;
  }

  return Object.fromEntries(
    Object.entries(debugPayload).filter(([key]) => !TOOL_MESSAGE_DEBUG_KEYS.has(key)),
  );
}

export function createToolCallTracker(params: {
  emit: ToolCallEventSink;
  toolCallId?: string;
  toolName: string;
  toolInfo?: string;
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
        toolInfo: params.toolInfo,
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
