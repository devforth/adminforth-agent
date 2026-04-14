export interface IPart {
  type: string;
  text: string;
  state: 'started' | 'thinking' | 'processing' | 'done';
}

export interface IMessage {
  id: string;
  role: 'user' | 'assistant';
  metadata: any,
  parts: IPart[];
}

export interface IAgentSession {
  sessionId: string;
  messages: IMessage[];
}

export interface ISessionsListItem {
  sessionId: string;
  title: string;
}