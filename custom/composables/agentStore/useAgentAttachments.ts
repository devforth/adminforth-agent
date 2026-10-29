import { ref } from 'vue';
import { callAdminForthApi } from '@/utils';
import { getErrorMessage, t } from '../../utils';
import type { IAttachmentRef, IAttachmentsConfig, IComposerAttachment, IMessageAttachment } from '../../types';
import {
  IMAGE_ENCODE_QUALITY,
  IMAGE_UPLOAD_FALLBACK_BACKGROUND,
  IMAGE_UPLOAD_FALLBACK_FORMAT,
  IMAGE_UPLOAD_FORMAT,
  MAX_IMAGE_LONG_SIDE,
  MAX_IMAGE_SHORT_SIDE,
} from './constants';

type CreateAgentAttachmentsOptions = {
  alert(options: { message: string; variant: 'warning' | 'danger' }): void;
};

// a new file is shown from memory until it is uploaded or dropped
function freeOriginal(attachment: IComposerAttachment) {
  if (attachment.file) {
    URL.revokeObjectURL(attachment.url);
  }
}

function encodeCanvas(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob>((resolve) => {
    canvas.toBlob((result) => resolve(result!), type, IMAGE_ENCODE_QUALITY);
  });
}

/**
 * Prepares an image for the model: scaled down to fit Full HD and encoded as WebP, so it stays in
 * the size limit and costs fewer tokens. A browser which can not encode WebP (Safari gives PNG
 * instead) encodes JPEG.
 */
async function toFullHdWebp(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    MAX_IMAGE_LONG_SIDE / Math.max(bitmap.width, bitmap.height),
    MAX_IMAGE_SHORT_SIDE / Math.min(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let format = IMAGE_UPLOAD_FORMAT;
  let blob = await encodeCanvas(canvas, format.type);
  if (blob.type !== format.type) {
    format = IMAGE_UPLOAD_FALLBACK_FORMAT;
    // the background goes under the image
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = IMAGE_UPLOAD_FALLBACK_BACKGROUND;
    context.fillRect(0, 0, canvas.width, canvas.height);
    blob = await encodeCanvas(canvas, format.type);
  }
  const baseName = file.name.slice(0, file.name.lastIndexOf('.'));
  return new File([blob], `${baseName}.${format.extension}`, { type: format.type });
}

async function uploadToSession(sessionId: string, file: File): Promise<{ ref: IAttachmentRef; url: string }> {
  const res = await callAdminForthApi({
    method: 'POST',
    path: '/agent/attachment-upload-url',
    body: { sessionId, filename: file.name, contentType: file.type, size: file.size },
  });
  if (res.error) {
    throw new Error(res.error);
  }
  const upload = await fetch(res.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': res.contentType, ...res.uploadExtraParams },
    body: file,
  });
  if (!upload.ok) {
    throw new Error(`Image upload failed with status ${upload.status}`);
  }
  return { ref: { filePath: res.filePath, token: res.token }, url: res.previewUrl };
}

export function createAgentAttachments({ alert }: CreateAgentAttachmentsOptions) {
  const attachments = ref<IComposerAttachment[]>([]);
  const isUploading = ref(false);
  const config = ref<IAttachmentsConfig | null>(null);

  function setConfig(attachmentsConfig: IAttachmentsConfig | null) {
    config.value = attachmentsConfig;
  }

  function addFiles(files: File[]) {
    const { maxPerMessage, mimeTypes } = config.value!;
    const images = files.filter((file) => mimeTypes.includes(file.type));
    if (images.length < files.length) {
      alert({ message: t('Only images can be attached'), variant: 'warning' });
    }
    const free = maxPerMessage - attachments.value.length;
    if (images.length > free) {
      alert({ message: t('You can attach up to {count} images to a message', { count: maxPerMessage }), variant: 'warning' });
    }
    attachments.value = [
      ...attachments.value,
      ...images.slice(0, free).map((file) => ({ id: crypto.randomUUID(), url: URL.createObjectURL(file), file })),
    ];
  }

  function removeAttachment(id: string) {
    freeOriginal(attachments.value.find((candidate) => candidate.id === id)!);
    attachments.value = attachments.value.filter((candidate) => candidate.id !== id);
  }

  /** Frees the files added to the composer which will not be sent. */
  function discardNewFiles() {
    attachments.value.forEach(freeOriginal);
  }

  /** Shows the images of an edited message in the composer. */
  function setFromMessage(messageAttachments: IMessageAttachment[]) {
    attachments.value = messageAttachments.map((attachment) => ({ id: crypto.randomUUID(), ...attachment }));
  }

  /**
   * Uploads the new images of the composer to the session. Returns the refs for the request and
   * the attachments to show in the sent message, or null when an upload failed; the reason is
   * shown to the user. The message shows the stored files, the ones the model gets, so the
   * originals of the composer previews are freed.
   */
  async function upload(sessionId: string, composerAttachments: IComposerAttachment[]) {
    isUploading.value = true;
    try {
      const uploaded = await Promise.all(composerAttachments.map(async (attachment) => {
        const { ref, url } = attachment.file
          ? await uploadToSession(sessionId, await toFullHdWebp(attachment.file))
          : { ref: { filePath: attachment.filePath! }, url: attachment.url };
        return { ref, shown: { filePath: ref.filePath, url } };
      }));
      composerAttachments.forEach(freeOriginal);
      return {
        refs: uploaded.map(({ ref }) => ref),
        shown: uploaded.map(({ shown }) => shown),
      };
    } catch (error) {
      alert({ message: t('Failed to upload the image: {reason}', { reason: getErrorMessage(error) }), variant: 'danger' });
      return null;
    } finally {
      isUploading.value = false;
    }
  }

  return {
    attachments,
    isUploading,
    config,
    setConfig,
    addFiles,
    discardNewFiles,
    removeAttachment,
    setFromMessage,
    upload,
  };
}
