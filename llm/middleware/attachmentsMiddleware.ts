import { logger } from "adminforth";
import { HumanMessage, ToolMessage, createMiddleware, type BaseMessage } from "langchain";
import { getErrorMessage } from "../../shared/errors.js";
import {
  ATTACHMENTS_SENT_AT_KWARG,
  MISSING_IMAGE_TEXT,
  VIEW_IMAGE_TOOL_NAME,
  getAttachmentPaths,
  hiddenImageText,
  viewedBelowImageText,
  viewedImageLabel,
  type ImageAttachmentsLimits,
  type ViewImageArtifact,
} from "../../domain/imageAttachments.js";

/** What a view_image result loaded; a failed call (bad arguments, tool off) has no artifact. */
function getViewedImages(message: BaseMessage) {
  return ToolMessage.isInstance(message) && message.name === VIEW_IMAGE_TOOL_NAME
    ? (message.artifact as ViewImageArtifact | undefined) ?? null
    : null;
}

/**
 * The images to show now, by the message they are shown in: the message they were sent with,
 * or the view_image result which loaded them again. Shown for `visibleMinutes` after that, the
 * latest `maxVisible` only.
 */
function getShownImages(messages: BaseMessage[], now: number, { visibleMinutes, maxVisible }: ImageAttachmentsLimits) {
  const visibleMs = visibleMinutes * 60_000;
  const latestByFilePath = new Map<string, { message: BaseMessage; at: number }>();
  const show = (filePath: string, message: BaseMessage, at: number) => {
    if (now - at < visibleMs && at > (latestByFilePath.get(filePath)?.at ?? 0)) {
      latestByFilePath.set(filePath, { message, at });
    }
  };

  for (const message of messages) {
    const filePaths = getAttachmentPaths(message);
    const sentAt = message.additional_kwargs?.[ATTACHMENTS_SENT_AT_KWARG] as string | undefined;
    if (filePaths && sentAt) {
      filePaths.forEach((filePath) => show(filePath, message, Date.parse(sentAt)));
    }
    const viewed = getViewedImages(message);
    if (viewed) {
      viewed.filePaths.forEach((filePath) => show(filePath, message, Date.parse(viewed.viewedAt)));
    }
  }

  const shown = new Map<BaseMessage, string[]>();
  [...latestByFilePath]
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, maxVisible)
    .forEach(([filePath, { message }]) => shown.set(message, [...(shown.get(message) ?? []), filePath]));
  return shown;
}

/**
 * `wrapModelCall` middleware that turns the attachment paths of user messages into image
 * blocks right before the model call. Placed last, so the images reach only the model and
 * not the debug trace or the summarization of other middleware. Created per turn, so an
 * image is loaded from the storage once for all model calls of the turn.
 *
 * An image is shown for `visibleMinutes` after its message is sent, at most `maxVisible` at once; any other image becomes a note with its id and is not
 * read at all. Images the model loads again with view_image follow the tool results of that step
 * as one user message: a user message between tool results is refused by providers, and provider
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

      const shownImages = getShownImages(request.messages, Date.now(), limits);
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
          const images = await Promise.all(filePaths.map((filePath) => {
            if (shown.includes(filePath)) {
              return imageBlock(filePath);
            }
            const text = viewedImages.has(filePath) ? viewedBelowImageText(filePath) : hiddenImageText(filePath);
            return { type: "text" as const, text };
          }));
          messages.push(new HumanMessage({
            content: [
              ...(message.content ? [{ type: "text" as const, text: message.content as string }] : []),
              ...images,
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
