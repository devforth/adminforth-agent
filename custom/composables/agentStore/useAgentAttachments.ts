import { computed, reactive, ref } from 'vue';
import { callAdminForthApi } from '@/utils';
import { i18nInstance } from '@/i18n';
import type { IAttachmentsConfig, IMessageAttachment } from '../../types';

const BYTES_IN_MEGABYTE = 1024 * 1024;

type AdminforthLike = {
  alert(options: { message: string; variant: 'warning' | 'danger' }): void;
};

/** An image in the composer: uploaded to the storage right away, sent with the next message. */
export type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  /** Object URL of the picked file, shown while it uploads. */
  localUrl: string;
  status: 'uploading' | 'ready' | 'error';
  key?: string;
  /** Link to the uploaded image, shown in the sent message. */
  url?: string;
  error?: string;
};

export function createAgentAttachments({ adminforth }: { adminforth: AdminforthLike }) {
  const config = ref<IAttachmentsConfig | null>(null);
  const attachments = ref<ComposerAttachment[]>([]);
  const isUploading = computed(() => attachments.value.some((attachment) => attachment.status === 'uploading'));
  const hasReadyAttachments = computed(() => attachments.value.some((attachment) => attachment.status === 'ready'));

  function t(key: string, params: Record<string, unknown> = {}) {
    return i18nInstance?.global.t(key, params) ?? key;
  }

  function setConfig(newConfig: IAttachmentsConfig | null) {
    config.value = newConfig;
  }

  async function upload(attachment: ComposerAttachment, file: File) {
    try {
      const res = await callAdminForthApi({
        method: 'POST',
        path: '/agent/get-attachment-upload-url',
        body: { mimeType: file.type, size: file.size },
      });
      if (res.error) {
        throw new Error(res.error);
      }
      const response = await fetch(res.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type, ...res.uploadExtraParams },
        body: file,
      });
      if (!response.ok) {
        throw new Error(t('Upload failed with status {status}', { status: response.status }));
      }
      Object.assign(attachment, { status: 'ready', key: res.key, url: res.previewUrl });
    } catch (error) {
      Object.assign(attachment, { status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }

  function addFiles(files: File[]) {
    const limits = config.value!;
    for (const file of files) {
      if (attachments.value.length >= limits.maxFilesPerMessage) {
        adminforth.alert({
          message: t('At most {count} images can be attached to a message', { count: limits.maxFilesPerMessage }),
          variant: 'warning',
        });
        return;
      }
      if (!limits.mimeTypes.includes(file.type)) {
        adminforth.alert({
          message: t('{name} is not a PNG, JPEG or WebP image', { name: file.name }),
          variant: 'warning',
        });
        continue;
      }
      if (file.size > limits.maxFileSizeMb * BYTES_IN_MEGABYTE) {
        adminforth.alert({
          message: t('{name} is larger than {size} MB', { name: file.name, size: limits.maxFileSizeMb }),
          variant: 'warning',
        });
        continue;
      }
      const attachment = reactive<ComposerAttachment>({
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type,
        localUrl: URL.createObjectURL(file),
        status: 'uploading',
      });
      attachments.value.push(attachment);
      void upload(attachment, file);
    }
  }

  function remove(id: string) {
    const attachment = attachments.value.find((candidate) => candidate.id === id)!;
    URL.revokeObjectURL(attachment.localUrl);
    attachments.value = attachments.value.filter((candidate) => candidate.id !== id);
  }

  function clear() {
    attachments.value.forEach((attachment) => URL.revokeObjectURL(attachment.localUrl));
    attachments.value = [];
  }

  // Hand the uploaded images over to a message and empty the composer; images which failed to
  // upload are shown as failed until then and are dropped here.
  function take(): IMessageAttachment[] {
    const ready = attachments.value
      .filter((attachment) => attachment.status === 'ready')
      .map(({ key, name, mimeType, url }) => ({ key: key!, name, mimeType, url: url! }));
    clear();
    return ready;
  }

  return {
    config,
    attachments,
    isUploading,
    hasReadyAttachments,
    setConfig,
    addFiles,
    remove,
    take,
  };
}
