import type { IAdminForth } from "adminforth";
import type { PluginOptions } from "../types.js";
import type { AttachmentRef, TurnAttachment } from "../domain/turnTypes.js";
import {
  ATTACHMENT_TOKEN_TYPE,
  BYTES_IN_MB,
  IMAGE_EXTENSIONS,
  MAX_IMAGE_SIZE_MB,
  PREVIEW_URL_EXPIRES_IN_SECONDS,
  type UploadPlugin,
} from "../domain/imageAttachments.js";

/**
 * Image attachments of user messages, stored by the UploadPlugin installed on
 * `turnResource.attachmentsField`. The browser uploads straight to the storage, so the
 * file paths it reports back are bound to the session with a signed token.
 */
export class TurnAttachments {
  private uploadPlugin!: UploadPlugin;

  constructor(
    private getAdminforth: () => IAdminForth,
    private options: PluginOptions,
  ) {}

  get enabled() {
    return Boolean(this.options.turnResource.attachmentsField);
  }

  /** Binds the UploadPlugin of `turnResource.attachmentsField`, once all plugins are activated. */
  resolveUploadPlugin() {
    const { resourceId, attachmentsField } = this.options.turnResource;
    if (!attachmentsField) {
      return;
    }
    const adminforth = this.getAdminforth();
    const column = adminforth.config.resources
      .find((resource) => resource.resourceId === resourceId)!
      .columns.find((resourceColumn) => resourceColumn.name === attachmentsField);
    if (!column?.isArray?.enabled) {
      throw new Error(`turnResource.attachmentsField "${attachmentsField}" must be an isArray column of resource "${resourceId}"`);
    }
    const plugin = adminforth.getPluginsByClassName<UploadPlugin>("UploadPlugin").find((uploadPlugin) =>
      uploadPlugin.resourceConfig.resourceId === resourceId
      && uploadPlugin.pluginOptions.pathColumnName === attachmentsField
    );
    if (!plugin) {
      throw new Error(`turnResource.attachmentsField "${attachmentsField}" requires UploadPlugin installed on this column of resource "${resourceId}"`);
    }
    const extensions = plugin.pluginOptions.allowedFileExtensions;
    if (!extensions?.length || extensions.some((extension) => !IMAGE_EXTENSIONS.includes(extension))) {
      throw new Error(`UploadPlugin on "${resourceId}.${attachmentsField}" must limit allowedFileExtensions to images: ${IMAGE_EXTENSIONS.join(", ")}`);
    }
    this.uploadPlugin = plugin;
  }

  async createUploadUrl(input: { sessionId: string; filename: string; contentType: string; size: number }) {
    if (input.size > MAX_IMAGE_SIZE_MB * BYTES_IN_MB) {
      throw new Error(`The image is too large: ${(input.size / BYTES_IN_MB).toFixed(1)} MB, at most ${MAX_IMAGE_SIZE_MB} MB can be sent to the model.`);
    }
    const { uploadUrl, uploadExtraParams, contentType, filePath } = await this.uploadPlugin.getUploadUrl({
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
    });
    const token = this.getAdminforth().auth.issueJWT(
      { sessionId: input.sessionId, filePath },
      ATTACHMENT_TOKEN_TYPE,
    );
    // `contentType` is picked by the server from the extension, the upload must send exactly it;
    // `previewUrl` lets the chat show the stored file, the one the model gets
    return { uploadUrl, uploadExtraParams, contentType, filePath, previewUrl: await this.getPreviewUrl(filePath), token };
  }

  /**
   * Returns the paths of attachments uploaded to this session. A ref without a token is
   * accepted only when its file is in `alreadyAttached` (an edited turn keeping its images).
   */
  async verify(sessionId: string, refs: AttachmentRef[], alreadyAttached: string[] = []): Promise<string[]> {
    return Promise.all(refs.map(async ({ filePath, token }) => {
      if (!token && alreadyAttached.includes(filePath)) {
        return filePath;
      }
      const payload = token
        ? await this.getAdminforth().auth.verify(token, ATTACHMENT_TOKEN_TYPE, false)
        : null;
      if (payload?.sessionId !== sessionId || payload.filePath !== filePath) {
        throw new Error(`Attachment "${filePath}" was not uploaded to this session.`);
      }
      return filePath;
    }));
  }

  async markUsed(filePaths: string[]) {
    await Promise.all(filePaths.map((filePath) => this.uploadPlugin.markKeyForNotDeletion(filePath)));
  }

  async markUnused(filePaths: string[]) {
    await Promise.all(filePaths.map((filePath) => this.uploadPlugin.markKeyForDeletion(filePath)));
  }

  private async getPreviewUrl(filePath: string) {
    const { preview, storageAdapter } = this.uploadPlugin.pluginOptions;
    return preview?.previewUrl
      ? preview.previewUrl({ filePath })
      : storageAdapter.getDownloadUrl(filePath, PREVIEW_URL_EXPIRES_IN_SECONDS);
  }

  async withUrls(filePaths: string[]): Promise<TurnAttachment[]> {
    return Promise.all(filePaths.map(async (filePath) => ({ filePath, url: await this.getPreviewUrl(filePath) })));
  }

  /** The image as a data URL, the form every completion adapter accepts in a message. */
  loadAsDataUrl(filePath: string) {
    return this.uploadPlugin.pluginOptions.storageAdapter.getKeyAsDataURL(filePath);
  }
}
