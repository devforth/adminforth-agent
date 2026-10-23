import type { StorageAdapter } from "adminforth";
import {
  ATTACHMENT_MIME_TYPES,
  createAttachmentKey,
  type AgentAttachment,
  type AttachmentMimeType,
} from "../domain/attachments.js";
import type { PluginOptions } from "../types.js";

const DEFAULT_MAX_FILE_SIZE_MB = 10;
const DEFAULT_MAX_FILES_PER_MESSAGE = 5;
const UPLOAD_URL_EXPIRES_IN_SECONDS = 30 * 60;
// Links to show images in the chat live for a day, the chat gets fresh ones with every session load.
const PREVIEW_URL_EXPIRES_IN_SECONDS = 24 * 60 * 60;

/** An attachment as the chat shows it: a link to the image instead of its storage key. */
export type AttachmentPreview = {
  name: string;
  mimeType: AttachmentMimeType;
  url: string;
};

/**
 * Images users attach to their messages, kept by the storage adapter. The browser uploads an image
 * by a presigned link, and the adapter deletes it after a day unless a turn marks it as used.
 */
export class AttachmentStore {
  readonly maxFileSizeMb: number;
  readonly maxFilesPerMessage: number;
  private readonly storageAdapter: StorageAdapter;

  constructor(options: NonNullable<PluginOptions["attachments"]>) {
    this.storageAdapter = options.storageAdapter;
    this.maxFileSizeMb = options.maxFileSizeMb ?? DEFAULT_MAX_FILE_SIZE_MB;
    this.maxFilesPerMessage = options.maxFilesPerMessage ?? DEFAULT_MAX_FILES_PER_MESSAGE;
  }

  /** Limits the chat checks before it uploads an image. */
  get frontendConfig() {
    return {
      maxFileSizeMb: this.maxFileSizeMb,
      maxFilesPerMessage: this.maxFilesPerMessage,
      mimeTypes: ATTACHMENT_MIME_TYPES,
    };
  }

  setupLifecycle(adapterUserUniqueRepresentation: string) {
    return this.storageAdapter.setupLifecycle(adapterUserUniqueRepresentation);
  }

  async createUpload(ownerPk: string, mimeType: AttachmentMimeType) {
    const key = createAttachmentKey(ownerPk, mimeType);
    const { uploadUrl, uploadExtraParams } = await this.storageAdapter.getUploadSignedUrl(
      key,
      mimeType,
      UPLOAD_URL_EXPIRES_IN_SECONDS,
    );

    return {
      key,
      uploadUrl,
      uploadExtraParams,
      previewUrl: await this.storageAdapter.getDownloadUrl(key, PREVIEW_URL_EXPIRES_IN_SECONDS),
    };
  }

  toPreviews(attachments: AgentAttachment[]): Promise<AttachmentPreview[]> {
    return Promise.all(attachments.map(async ({ key, name, mimeType }) => ({
      name,
      mimeType,
      url: await this.storageAdapter.getDownloadUrl(key, PREVIEW_URL_EXPIRES_IN_SECONDS),
    })));
  }

  getDataUrl(key: string) {
    return this.storageAdapter.getKeyAsDataURL(key);
  }

  async markUsed(attachments: AgentAttachment[]) {
    await Promise.all(attachments.map(({ key }) => this.storageAdapter.markKeyForNotDeletion(key)));
  }

  async markUnused(attachments: AgentAttachment[]) {
    await Promise.all(attachments.map(({ key }) => this.storageAdapter.markKeyForDeletion(key)));
  }
}
