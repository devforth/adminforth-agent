import { HumanMessage, countTokensApproximately, type BaseMessage } from "langchain";
import type { AgentAttachment } from "../domain/attachments.js";

/**
 * An image block keeps only the storage key of its image in the agent state (`<scheme><key>`):
 * checkpoints store the whole history on every step, so the image data would be copied into each
 * of them. The attachments middleware swaps the key for the data right before a model call.
 */
export const ATTACHMENT_URL_SCHEME = "adminforth-agent-attachment:";

// Providers charge up to ~1600 tokens for an image (Anthropic, for an image they scale to ~1.15 MP).
const IMAGE_TOKEN_ESTIMATE = 1600;

export type AttachmentImageBlock = {
  type: "image";
  mimeType: string;
  url: string;
};

export function isAttachmentImageBlock(block: unknown): block is AttachmentImageBlock {
  const candidate = block as Partial<AttachmentImageBlock>;
  return candidate.type === "image" && Boolean(candidate.url?.startsWith(ATTACHMENT_URL_SCHEME));
}

export function getAttachmentKey(block: AttachmentImageBlock) {
  return block.url.slice(ATTACHMENT_URL_SCHEME.length);
}

export function toHumanMessage(text: string, attachments: AgentAttachment[]) {
  if (attachments.length === 0) {
    return new HumanMessage(text);
  }

  return new HumanMessage({
    contentBlocks: [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...attachments.map((attachment) => ({
        type: "image" as const,
        mimeType: attachment.mimeType,
        url: `${ATTACHMENT_URL_SCHEME}${attachment.key}`,
      })),
    ],
  });
}

/**
 * Token counter for the summarization trigger. The default one counts text only, so a history
 * full of images would outgrow the context window before summarization starts.
 */
export function countTokensWithImages(messages: BaseMessage[]) {
  const imagesCount = messages
    .filter((message) => HumanMessage.isInstance(message) && Array.isArray(message.content))
    .flatMap((message) => message.content as unknown[])
    .filter(isAttachmentImageBlock)
    .length;

  return countTokensApproximately(messages) + imagesCount * IMAGE_TOKEN_ESTIMATE;
}
