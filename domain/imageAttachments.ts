import type { StorageAdapter } from "adminforth";
import type { IImageAttachmentsOptions } from "../types.js";

/**
 * `additional_kwargs` keys of a user message with images: the storage paths and the time the
 * message was sent. The paths, not the images, stay in the agent state, so checkpoints (each
 * one keeps the whole history) do not repeat the base64 of every image.
 */
export const ATTACHMENTS_KWARG = "adminforthAttachments";
export const ATTACHMENTS_SENT_AT_KWARG = "adminforthAttachmentsSentAt";

export function getAttachmentPaths(message: { additional_kwargs?: Record<string, unknown> }) {
  return message.additional_kwargs?.[ATTACHMENTS_KWARG] as string[] | undefined;
}

export const VIEW_IMAGE_TOOL_NAME = "view_image";

/**
 * An image goes to the model as base64, a third bigger than the file: 3.75 MB becomes 5 MB, the
 * smallest per-image limit of the providers (Anthropic). A bigger image would fail every model
 * call while it is shown. The upload URL is bound to the size, so the size the client names is
 * the size of the stored file.
 */
export const MAX_IMAGE_SIZE_MB = 3.75;
export const BYTES_IN_MB = 1024 * 1024;

const IMAGE_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME_TYPES_BY_EXTENSION);

// a token binds the path of an uploaded image to the session it was uploaded to
export const ATTACHMENT_TOKEN_TYPE = "agent-attachment";

// signed preview urls of private storages; the chat asks for fresh ones when they expire
export const PREVIEW_URL_EXPIRES_IN_SECONDS = 1800;

export type ImageAttachmentsLimits = Required<IImageAttachmentsOptions>;

export const DEFAULT_IMAGE_ATTACHMENTS_LIMITS: ImageAttachmentsLimits = {
  maxPerMessage: 5,
  visibleMinutes: 30,
  maxVisible: 5,
  maxViewedPerTurn: 10,
};

/** The `imageAttachments` options with the defaults for the ones not set; each is a whole number from 1. */
export function resolveImageAttachmentsLimits(options: IImageAttachmentsOptions = {}): ImageAttachmentsLimits {
  const limits: ImageAttachmentsLimits = {
    maxPerMessage: options.maxPerMessage ?? DEFAULT_IMAGE_ATTACHMENTS_LIMITS.maxPerMessage,
    visibleMinutes: options.visibleMinutes ?? DEFAULT_IMAGE_ATTACHMENTS_LIMITS.visibleMinutes,
    maxVisible: options.maxVisible ?? DEFAULT_IMAGE_ATTACHMENTS_LIMITS.maxVisible,
    maxViewedPerTurn: options.maxViewedPerTurn ?? DEFAULT_IMAGE_ATTACHMENTS_LIMITS.maxViewedPerTurn,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`imageAttachments.${name} must be a whole number from 1, got ${value}`);
    }
  }
  // view_image loads all images of a message, so a whole message has to fit into one answer
  if (limits.maxPerMessage > limits.maxViewedPerTurn) {
    throw new Error(`imageAttachments.maxPerMessage (${limits.maxPerMessage}) must not exceed maxViewedPerTurn (${limits.maxViewedPerTurn})`);
  }
  return limits;
}

/** Limits of the chat composer, passed to the frontend so both sides share them. */
export function getAttachmentsFrontendConfig(limits: ImageAttachmentsLimits) {
  return {
    maxPerMessage: limits.maxPerMessage,
    mimeTypes: [...new Set(Object.values(IMAGE_MIME_TYPES_BY_EXTENSION))],
  };
}

// notes the model gets in place of images which are not shown
export const MISSING_IMAGE_TEXT = "[An image of this message is no longer available]";

// one note for all such images of a message: the model takes them as one group
const imageIdsText = (filePaths: string[]) => filePaths.map((filePath) => `"${filePath}"`).join(", ");

export const hiddenImagesText = (filePaths: string[]) =>
  `[Images of this message not shown now: ${imageIdsText(filePaths)}. To answer about what they show, call ${VIEW_IMAGE_TOOL_NAME} with these ids first.]`;

export const viewedBelowImagesText = (filePaths: string[]) =>
  `[Images of this message shown further below: ${imageIdsText(filePaths)}.]`;

export const viewedImageLabel = (filePath: string) => `[Image "${filePath}"]`;

/**
 * What view_image loaded, kept as the artifact of its tool result: the attachments middleware
 * reads it there, the text the model gets is separate.
 */
export type ViewImageArtifact = {
  // all the loaded images, shown for the answer of the turn which loaded them
  filePaths: string[];
  // the ones the model keeps seeing in the next turns; the results of agent 3.4.0 have neither
  // this nor turnId and keep all the loaded images
  keptFilePaths?: string[];
  turnId?: string;
  viewedAt: string;
};

/** The part of the UploadPlugin (@adminforth/upload) the agent relies on. */
export type UploadPlugin = {
  resourceConfig: { resourceId: string };
  pluginOptions: {
    pathColumnName: string;
    allowedFileExtensions?: string[];
    storageAdapter: StorageAdapter;
    preview?: { previewUrl?: (input: { filePath: string }) => string };
  };
  getUploadUrl(input: { filename: string; contentType: string; size: number }): Promise<{
    uploadUrl: string;
    uploadExtraParams?: Record<string, string>;
    contentType: string;
    filePath: string;
  }>;
  markKeyForDeletion(filePath: string): Promise<void>;
  markKeyForNotDeletion(filePath: string): Promise<void>;
};
