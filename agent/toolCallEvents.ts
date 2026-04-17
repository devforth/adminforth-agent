export type ToolCallEvent =
  | {
      toolName: string;
      phase: "start";
      input: string;
    }
  | {
      toolName: string;
      phase: "end";
      output: string | null;
      error: string | null;
    };

export type ToolCallEventSink = (event: ToolCallEvent) => void;
