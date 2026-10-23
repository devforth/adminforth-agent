import { randomUUID } from "crypto";

// The image formats every supported provider accepts (Gemini takes no GIF).
const EXTENSION_BY_MIME_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type AttachmentMimeType = keyof typeof EXTENSION_BY_MIME_TYPE;

export const ATTACHMENT_MIME_TYPES = Object.keys(EXTENSION_BY_MIME_TYPE) as [AttachmentMimeType, ...AttachmentMimeType[]];

const MIME_TYPE_BY_EXTENSION = Object.fromEntries(
  Object.entries(EXTENSION_BY_MIME_TYPE).map(([mimeType, extension]) => [extension, mimeType]),
) as Record<string, AttachmentMimeType>;

const ATTACHMENTS_FOLDER = "agent-attachments";

// The file part of a key, `<uuid>.<extension>`, under the folder of the user who uploaded it.
const ATTACHMENT_FILE_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z]+)$/;

/** An image attached to a user message, stored by the storage adapter under `key`. */
export type AgentAttachment = {
  key: string;
  name: string;
  mimeType: AttachmentMimeType;
};

/** An uploaded image as the client refers to it when sending a message. */
export type AttachmentRef = {
  key: string;
  name: string;
};

function getUserFolder(ownerPk: string) {
  return `${ATTACHMENTS_FOLDER}/${ownerPk}/`;
}

export function createAttachmentKey(ownerPk: string, mimeType: AttachmentMimeType) {
  return `${getUserFolder(ownerPk)}${randomUUID()}.${EXTENSION_BY_MIME_TYPE[mimeType]}`;
}

/**
 * Turn the refs a client sent with a message into attachments. A key is accepted only when it
 * is an image key of the folder of the sending user, so nobody can send an image of another user.
 */
export function resolveAttachmentRefs(
  refs: AttachmentRef[],
  ownerPk: string,
  maxFilesPerMessage: number,
): { attachments: AgentAttachment[] } | { error: string } {
  if (refs.length > maxFilesPerMessage) {
    return { error: `At most ${maxFilesPerMessage} images can be attached to a message` };
  }

  const folder = getUserFolder(ownerPk);
  const attachments: AgentAttachment[] = [];
  for (const ref of refs) {
    const extension = ref.key.startsWith(folder)
      ? ref.key.slice(folder.length).match(ATTACHMENT_FILE_NAME_RE)?.[1]
      : undefined;
    const mimeType = extension && MIME_TYPE_BY_EXTENSION[extension];
    if (!mimeType) {
      return { error: `Image "${ref.name}" is not an image uploaded by the current user` };
    }
    attachments.push({ key: ref.key, name: ref.name, mimeType });
  }

  return { attachments };
}
