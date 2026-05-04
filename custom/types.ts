export interface IPartData {
  toolCallId: string;
  toolName: string;
  phase: 'start' | 'end';
  input?: any;
  output?: any;
  durationMs?: number;
  toolInfo?: string;
}
export interface IPart {
  type: 'reasoning' | 'data-tool-call' | 'text';
  text?: string;
  state?: 'started' | 'thinking' | 'processing' | 'streaming' | 'done';
  data?: IPartData;
}

export interface IFormattedToolCallPart {
  type: 'data-tool-call';
  toolInfo: IPartData;
}

export interface IToolGroup {
  title: string;
  groupedTools: IFormattedToolCallPart[];
}

export interface IMessage {
  role: 'user' | 'assistant' | 'system';
  metadata?: any,
  parts: IPart[];
}

export interface IAgentSession {
  sessionId: string;
  title: string;
  timestamp: string;
  messages: IMessage[];
}

export interface ISessionsListItem {
  sessionId: string;
  title: string;
  timestamp: string;
}

export type SpeechStreamEvent =
  | {
      type: 'transcript';
      data: {
        text: string;
        language?: string;
      };
    }
  | {
      type: 'speech-response';
      data: {
        transcript: {
          text: string;
          language?: string;
        };
        response: {
          text: string;
        };
        sessionId: string;
        turnId: string;
      };
    }
  | {
      type: 'response';
      data: {
        text: string;
        sessionId: string;
        turnId: string;
      };
    }
  | {
      type: 'audio-start';
      data: {
        mimeType: string;
        format: string;
      };
    }
  | {
      type: 'audio-delta';
      data: {
        base64: string;
      };
    }
  | {
      type: 'audio-done';
    }
  | {
      type: 'finish';
    }
  | {
      type: 'error';
      error: string;
    };