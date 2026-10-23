/** One value on the approval card; `from` is the stored value an update replaces. */
export interface IApprovalField {
  label: string;
  from?: string;
  to: string;
}

/** A tool call awaiting approval, as described by the backend. */
export interface IApprovalDescription {
  summary: string;
  fields: IApprovalField[];
}

export interface IPartData {
  toolCallId?: string;
  toolName?: string;
  sessionId?: string;
  phase?: 'start' | 'end';
  label?: string;
  input?: any;
  output?: any;
  durationMs?: number;
  toolInfo?: string;
  status?: 'pending' | 'processing' | 'approved' | 'rejected';
  approvals?: IApprovalDescription[];
  error?: string;
}
export interface IPart {
  type: 'reasoning' | 'data-tool-call' | 'data-rendering' | 'data-tool-approval' | 'text' | 'file';
  text?: string;
  state?: 'started' | 'thinking' | 'processing' | 'streaming' | 'done';
  data?: IPartData;
  /** Link to the image of a `file` part. */
  url?: string;
  mediaType?: string;
  filename?: string;
}

export interface IFormattedToolCallPart {
  type: 'data-tool-call';
  toolInfo: IPartData;
}

export interface IMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  metadata?: any,
  parts: IPart[];
}

/** Limits of image attachments, set in the plugin options. */
export interface IAttachmentsConfig {
  maxFileSizeMb: number;
  maxFilesPerMessage: number;
  mimeTypes: string[];
}

/** An image of a message, with a link to show it. */
export interface IStoredAttachment {
  name: string;
  mimeType: string;
  url: string;
}

/** An uploaded image to send with a message, `key` names it in the storage. */
export interface IMessageAttachment extends IStoredAttachment {
  key: string;
}

export interface IStoredMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  turnId?: string;
  attachments?: IStoredAttachment[];
}

export interface IAgentSession {
  sessionId: string;
  title: string;
  timestamp: string;
  messages: IMessage[];
  /** Tool calls this session is still waiting for the user to approve. */
  pendingApprovals?: IApprovalDescription[];
}

export interface ISessionsListItem {
  sessionId: string;
  title: string;
  timestamp: string;
}

export type SpeechStreamEvent =
  | {
      type: 'error';
      error: string;
    }
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
      type: 'audio-start';
      data: {
        mimeType: string;
        format: string;
        sampleRate: number;
        channelCount: number;
        bitsPerSample: number;
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
      type: 'data-tool-call';
      data: any;
    }
  | {
      type: 'open-page';
      data: {
        targetPath: string;
      };
    }
  | {
      type: 'finish';
    };
