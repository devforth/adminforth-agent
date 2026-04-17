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
      output: string | null;
      error: string | null;
    };

export type ToolCallEventSink = (event: ToolCallEvent) => void;
