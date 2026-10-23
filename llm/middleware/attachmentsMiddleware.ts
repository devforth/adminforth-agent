import { HumanMessage, createMiddleware, type BaseMessage } from "langchain";
import type { AttachmentStore } from "../../persistence/attachmentStore.js";
import { getAttachmentKey, isAttachmentImageBlock } from "../attachmentMessages.js";

/**
 * `wrapModelCall` middleware that gives the model the images of the history: an image block in
 * the agent state holds only the storage key of its image, here it gets the image as a data URL,
 * the form every provider accepts. Created per turn, so a turn reads each image once for all its
 * model calls.
 *
 * Placed last in the middleware array (the innermost wrapper), so the debug trace and the other
 * middleware see the small keys instead of the image data.
 */
export function createAttachmentsMiddleware(attachmentStore: AttachmentStore) {
  const dataUrls = new Map<string, Promise<string>>();

  function getDataUrl(key: string) {
    if (!dataUrls.has(key)) {
      dataUrls.set(key, attachmentStore.getDataUrl(key));
    }
    return dataUrls.get(key)!;
  }

  async function withImageData(message: BaseMessage) {
    if (
      !HumanMessage.isInstance(message)
      || !Array.isArray(message.content)
      || !message.content.some(isAttachmentImageBlock)
    ) {
      return message;
    }

    const contentBlocks = await Promise.all(message.content.map(async (block) => (
      isAttachmentImageBlock(block)
        ? { ...block, url: await getDataUrl(getAttachmentKey(block)) }
        : block
    )));
    return new HumanMessage({ id: message.id, contentBlocks: contentBlocks as HumanMessage["contentBlocks"] });
  }

  return createMiddleware({
    name: "AttachmentsMiddleware",
    async wrapModelCall(request, handler) {
      const messages = await Promise.all(request.messages.map(withImageData));
      return handler({ ...request, messages });
    },
  });
}
