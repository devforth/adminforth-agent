export type AgentMode = {
  name: string;
};

export const DEFAULT_CHAT_WIDTH = 30;
export const MAX_WIDTH = 60;
export const MIN_WIDTH = 25;

export const DEFAULT_TEXTAREA_PLACEHOLDER = 'Type a message...';
export const PLACEHOLDER_TYPING_DELAY_MS = 60;
export const PLACEHOLDER_DELETING_DELAY_MS = 35;
export const PLACEHOLDER_HOLD_DELAY_MS = 3000;
export const PRE_SESSION_ID = 'pre-session';

export enum RESERVED_SYSTEM_MESSAGE_CONTENT {
  START_AUDIO_CHAT = 'START_AUDIO_CHAT',
  END_AUDIO_CHAT = 'END_AUDIO_CHAT',
  AGENT_RESPONSE_ABORTED = 'AGENT_RESPONSE_ABORTED'
}