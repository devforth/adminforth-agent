export interface IPart {
  type: string;
  message: string;
  state: 'started' | 'thinking' | 'processing' | 'done';
}

export interface IMessage {
  id: string;
  role: 'user' | 'assistant';
  metadata: any,
  parts: IPart[];
}