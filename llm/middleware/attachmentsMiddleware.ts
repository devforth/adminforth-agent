import { logger } from "adminforth";
import { HumanMessage, ToolMessage, createMiddleware, type BaseMessage } from "langchain";
import { getViewedImages } from "../../tools/viewImage.js";
import { getErrorMessage } from "../../shared/errors.js";
import {
  ATTACHMENTS_SENT_AT_KWARG,
  MISSING_IMAGE_TEXT,
  getAttachmentPaths,
  hiddenImagesText,
  viewedBelowImagesText,
  viewedImageLabel,
  type ImageAttachmentsLimits,
  type ViewImageArtifact,
} from "../../domain/imageAttachments.js";

/**
 * The images to show now, by the message they are shown in. All the images view_image loaded in
 * this turn, once each, after its latest result that has them. Besides them the kept ones: sent in
 * a message or kept by an earlier view_image for `visibleMinutes`, the latest `maxVisible` only
 * (more when the last images were a view_image which kept more); one loaded in this turn keeps its
 * place among them but is shown after the view_image result.
 */
function getShownImages(
  messages: BaseMessage[],
  now: number,
  turnId: string,
  { visibleMinutes, maxVisible }: ImageAttachmentsLimits,
) {
  const viewedNow = new Map<string, BaseMessage>();
  const kept: Array<{ filePath: string; message: BaseMessage; at: number }> = [];
  // a view_image which kept more than maxVisible widens the buffer until the next images
  let bufferSize = maxVisible;
  for (const message of messages) {
    const filePaths = getAttachmentPaths(message);
    const sentAt = message.additional_kwargs?.[ATTACHMENTS_SENT_AT_KWARG] as string | undefined;
    if (filePaths && sentAt) {
      kept.push(...filePaths.map((filePath) => ({ filePath, message, at: Date.parse(sentAt) })));
      bufferSize = maxVisible;
    }
    const viewed = getViewedImages(message);
    if (viewed?.turnId === turnId) {
      viewed.filePaths.forEach((filePath) => viewedNow.set(filePath, message));
      bufferSize = maxVisible;
    } else if (viewed) {
      const keptFilePaths = viewed.keptFilePaths ?? viewed.filePaths;
      kept.push(...keptFilePaths.map((filePath) => ({ filePath, message, at: Date.parse(viewed.viewedAt) })));
      bufferSize = Math.max(maxVisible, keptFilePaths.length);
    }
  }

  const visibleMs = visibleMinutes * 60_000;
  const latestByFilePath = new Map<string, { message: BaseMessage; at: number }>();
  for (const { filePath, message, at } of kept) {
    if (now - at < visibleMs && at > (latestByFilePath.get(filePath)?.at ?? 0)) {
      latestByFilePath.set(filePath, { message, at });
    }
  }

  const shown = new Map<BaseMessage, string[]>();
  const show = (filePath: string, message: BaseMessage) => shown.set(message, [...(shown.get(message) ?? []), filePath]);
  [...latestByFilePath]
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, bufferSize)
    .filter(([filePath]) => !viewedNow.has(filePath))
    .forEach(([filePath, { message }]) => show(filePath, message));
  viewedNow.forEach((message, filePath) => show(filePath, message));
  return shown;
}

/**
 * `wrapModelCall` middleware that turns the attachment paths of user messages into image
 * blocks right before the model call. Placed last, so the images reach only the model and
 * not the debug trace or the summarization of other middleware. Created per turn, so an
 * image is loaded from the storage once for all model calls of the turn.
 *
 * An image is shown for `visibleMinutes` after its message is sent or a view_image keeps it, at most
 * `maxVisible` at once; the other images of a message become one note with their ids and are not
 * read at all. Images the model loads again with view_image are all shown for the answer of that
 * turn and follow the tool results of that step as one user message: a user message between tool results is refused by providers, and provider
 * adapters may send only the messages after their previous response (OpenAI previous_response_id),
 * so a change in an earlier message would not reach the model. An image which can not be read
 * (deleted from the storage, the storage changed) becomes a note too, so one broken file does not
 * fail every next turn of the session.
 */
export function createAttachmentsMiddleware(
  loadAsDataUrl: (filePath: string) => Promise<string>,
  limits: ImageAttachmentsLimits,
) {
  const dataUrls = new Map<string, Promise<string | null>>();
  const load = (filePath: string) => {
    if (!dataUrls.has(filePath)) {
      dataUrls.set(filePath, loadAsDataUrl(filePath).catch((error) => {
        logger.warn(`Agent attachment "${filePath}" can not be read, the model gets a note instead: ${getErrorMessage(error)}`);
        return null;
      }));
    }
    return dataUrls.get(filePath)!;
  };
  const imageBlock = async (filePath: string) => {
    const dataUrl = await load(filePath);
    return dataUrl
      ? { type: "image_url" as const, image_url: { url: dataUrl } }
      : { type: "text" as const, text: MISSING_IMAGE_TEXT };
  };

  return createMiddleware({
    name: "AttachmentsMiddleware",
    async wrapModelCall(request, handler) {
      if (!request.messages.some((message) => getAttachmentPaths(message) || getViewedImages(message))) {
        return handler(request);
      }

      const shownImages = getShownImages(request.messages, Date.now(), (request.runtime.context as { turnId: string }).turnId, limits);
      // images loaded again are shown after the tool results, their own message only points there
      const viewedImages = new Set([...shownImages]
        .filter(([message]) => getViewedImages(message))
        .flatMap(([, filePaths]) => filePaths));
      const messages: BaseMessage[] = [];
      let viewedInStep: string[] = [];
      for (const [index, message] of request.messages.entries()) {
        const shown = shownImages.get(message) ?? [];
        const filePaths = getAttachmentPaths(message);
        if (filePaths) {
          const images = await Promise.all(filePaths.filter((filePath) => shown.includes(filePath)).map(imageBlock));
          const notShown = filePaths.filter((filePath) => !shown.includes(filePath));
          const viewedBelow = notShown.filter((filePath) => viewedImages.has(filePath));
          const hidden = notShown.filter((filePath) => !viewedImages.has(filePath));
          messages.push(new HumanMessage({
            content: [
              ...(message.content ? [{ type: "text" as const, text: message.content as string }] : []),
              ...images,
              ...(viewedBelow.length ? [{ type: "text" as const, text: viewedBelowImagesText(viewedBelow) }] : []),
              ...(hidden.length ? [{ type: "text" as const, text: hiddenImagesText(hidden) }] : []),
            ],
          }));
          continue;
        }
        messages.push(message);
        if (getViewedImages(message)) {
          viewedInStep.push(...shown);
        }
        const next = request.messages[index + 1];
        if (viewedInStep.length > 0 && !(next && ToolMessage.isInstance(next))) {
          const blocks = await Promise.all(viewedInStep.map(async (filePath) => [
            { type: "text" as const, text: viewedImageLabel(filePath) },
            await imageBlock(filePath),
          ]));
          messages.push(new HumanMessage({ content: blocks.flat() }));
          viewedInStep = [];
        }
      }

      return handler({ ...request, messages });
    },
  });
}
