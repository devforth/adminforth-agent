export interface IPartData {
  toolCallId: string;
  toolName: string;
  phase: 'start' | 'end';
  input?: any;
  output?: any;
  durationMs?: number;
}
export interface IPart {
  type: 'reasoning' | 'data-tool-call' | 'text';
  text?: string;
  state?: 'started' | 'thinking' | 'processing' | 'streaming' | 'done';
  data?: IPartData;
}

export interface IMessage {
  id: string;
  role: 'user' | 'assistant';
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