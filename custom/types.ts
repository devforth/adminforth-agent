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
  type: 'reasoning' | 'data-tool-call' | 'data-rendering' | 'data-tool-approval' | 'text';
  text?: string;
  state?: 'started' | 'thinking' | 'processing' | 'streaming' | 'done';
  data?: IPartData;
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

/** Limits of image attachments, set by the backend; null when attachments are off. */
export interface IAttachmentsConfig {
  maxPerMessage: number;
  mimeTypes: string[];
}

/** Meta of the chat surface injection, set by the plugin backend. */
export interface IChatSurfaceMeta {
  pluginInstanceId: string;
  modes: Array<{
    name: string;
  }>;
  defaultModeName: string | null;
  stickByDefault: boolean;
  hasAudioAdapter: boolean;
  editingEnabled: boolean;
  attachments: IAttachmentsConfig | null;
}

/** An image in the composer: a new file to upload, or one the edited message already has. */
export interface IComposerAttachment {
  id: string;
  url: string;
  file?: File;
  filePath?: string;
}

export interface IMessageAttachment {
  filePath: string;
  url: string;
}

/** An image sent to the agent; the token proves it was uploaded to this session. */
export interface IAttachmentRef {
  filePath: string;
  token?: string;
}

export interface IStoredMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  turnId?: string;
  attachments?: IMessageAttachment[];
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
