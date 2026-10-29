export type AgentMode = {
  name: string;
};

export const DEFAULT_CHAT_WIDTH = 30;
export const MAX_WIDTH = 60;
export const MIN_WIDTH = 25;

export const DEFAULT_TEXTAREA_PLACEHOLDER = 'Ask anything about your data…';
export const PLACEHOLDER_TYPING_DELAY_MS = 60;
export const PLACEHOLDER_DELETING_DELAY_MS = 35;
export const PLACEHOLDER_HOLD_DELAY_MS = 3000;
export const PRE_SESSION_ID = 'pre-session';
export const STEER_PERSIST_PREFIX = '__adminforth_steer__:';

// Full HD in any orientation: the long side up to 1920px, the short one up to 1080px.
export const MAX_IMAGE_LONG_SIDE = 1920;
export const MAX_IMAGE_SHORT_SIDE = 1080;
// A Full HD WebP or JPEG of this quality stays well under the size limit of the server (3.75 MB)
// even for a photo, which a PNG of the same size can exceed.
export const IMAGE_ENCODE_QUALITY = 0.85;
// images are uploaded as WebP, as JPEG from a browser which can not encode WebP (Safari)
export const IMAGE_UPLOAD_FORMAT = { type: 'image/webp', extension: 'webp' };
export const IMAGE_UPLOAD_FALLBACK_FORMAT = { type: 'image/jpeg', extension: 'jpg' };
// JPEG has no transparency, transparent pixels would turn black
export const IMAGE_UPLOAD_FALLBACK_BACKGROUND = '#fff';
export const ATTACHMENT_URLS_REFRESH_INTERVAL_MS = 60_000;

export enum RESERVED_SYSTEM_MESSAGE_CONTENT {
  START_AUDIO_CHAT = 'START_AUDIO_CHAT',
  END_AUDIO_CHAT = 'END_AUDIO_CHAT',
  AGENT_RESPONSE_ABORTED = 'AGENT_RESPONSE_ABORTED'
}