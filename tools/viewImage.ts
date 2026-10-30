import path from "path";
import { ToolMessage, tool, type BaseMessage } from "langchain";
import { z } from "zod";
import {
  VIEW_IMAGE_TOOL_NAME,
  getAttachmentPaths,
  type ImageAttachmentsLimits,
  type ViewImageArtifact,
} from "../domain/imageAttachments.js";

/**
 * The storage path of the image the model means. Models tend to pass only the file name of the
 * id from the note, with or without the extension, so a unique file name is accepted too.
 */
function resolveImagePath(filePaths: string[], imageId: string) {
  if (filePaths.includes(imageId)) {
    return imageId;
  }
  const byFileName = filePaths.filter((filePath) => {
    const { base, name } = path.posix.parse(filePath);
    return imageId === base || imageId === name;
  });
  return byFileName.length === 1 ? byFileName[0] : null;
}

/** What a view_image result loaded; a failed call (bad arguments, tool off) has no artifact. */
export function getViewedImages(message: BaseMessage) {
  return ToolMessage.isInstance(message) && message.name === VIEW_IMAGE_TOOL_NAME
    ? (message.artifact as ViewImageArtifact | undefined) ?? null
    : null;
}

/**
 * Shows again images of earlier user messages, once per answer: the model has to pick all the
 * likely messages at once and not search them one call after another. An id loads all images of
 * its message, the model can not tell which image of a message holds what it needs. Messages go in
 * the order of the ids, the most likely first, while they fit into `maxViewedPerTurn` images. The
 * loaded images go to the artifact of the tool result: the attachments middleware shows all of
 * them for the answer of this turn, and the kept ones for a while after it.
 */
export function createViewImageTool({ visibleMinutes, maxVisible, maxViewedPerTurn }: ImageAttachmentsLimits) {
  const viewImageSchema = z.object({
    imageIds: z
      .array(z.string())
      .min(1)
      .max(maxViewedPerTurn)
      .describe("Ids copied from the notes shown in place of the images, never made up; the most likely message first."),
    keepImageIds: z
      .array(z.string())
      .max(maxViewedPerTurn)
      .describe(`Ids out of imageIds to keep seeing in the next messages: the ones the conversation is about, usually up to ${maxVisible}. More are kept only until the next images. Empty when none is needed later.`),
  });

  return tool(
    async ({ imageIds, keepImageIds }, runtime): Promise<[string, ViewImageArtifact]> => {
      // the agent passes its state and its context to every tool call next to the run config
      const { state, context } = runtime as unknown as {
        state: { messages: BaseMessage[] };
        context: { turnId: string };
      };
      const viewedAt = new Date().toISOString();
      if (state.messages.some((message) => getViewedImages(message)?.turnId === context.turnId)) {
        return [
          JSON.stringify({
            error: "ALREADY_VIEWED",
            message: "This answer already loaded images. Answer from them, or ask the user which images matter or to send them again.",
          }, null, 2),
          { filePaths: [], keptFilePaths: [], turnId: context.turnId, viewedAt },
        ];
      }

      const imagesByMessage = state.messages.flatMap((message) => {
        const filePaths = getAttachmentPaths(message);
        return filePaths ? [filePaths] : [];
      });
      const filePathsInHistory = [...new Set(imagesByMessage.flat())];
      const resolve = (imageId: string) => resolveImagePath(filePathsInHistory, imageId);
      const resolved = imageIds.map((imageId) => ({ imageId, filePath: resolve(imageId) }));
      const notFound = resolved.filter(({ filePath }) => !filePath).map(({ imageId }) => imageId);
      // the messages of the found images, in the order of the ids
      const groups = [...new Set(resolved.flatMap(({ filePath }) => (
        filePath ? [imagesByMessage.find((filePaths) => filePaths.includes(filePath))!] : []
      )))];
      let filePaths: string[] = [];
      const overLimit: string[] = [];
      for (const group of groups) {
        const withGroup = [...new Set([...filePaths, ...group])];
        if (withGroup.length > maxViewedPerTurn) {
          overLimit.push(...group.filter((filePath) => !filePaths.includes(filePath)));
        } else {
          filePaths = withGroup;
        }
      }

      const keptFilePaths = [...new Set(keepImageIds.map(resolve))].filter((filePath): filePath is string => (
        filePath !== null && filePaths.includes(filePath)
      ));
      return [
        JSON.stringify({ shown: filePaths, kept: keptFilePaths, notFound, overLimit }, null, 2),
        { filePaths, keptFilePaths, turnId: context.turnId, viewedAt },
      ];
    },
    {
      name: VIEW_IMAGE_TOOL_NAME,
      description: [
        "Shows again images of earlier messages which are replaced with notes, by the ids written in these notes.",
        "Call it before answering anything that depends on what such an image shows: your earlier replies about it are a retelling, not a source, and miss details.",
        "Don't call it for images you see in messages, they are already in full quality, and for a message with new images and no text, it is about the new images only.",
        "Pick the messages by the conversation: your reply right after a user message is about the images of that message.",
        "Call it once per answer, a second call is refused: pass one id of every message whose texts or replies may match the request, the most likely first; an id loads all images of its message.",
        `It loads ${maxViewedPerTurn} images at most; messages over it are not loaded and are listed in overLimit, if the loaded ones are not enough ask the user which images matter or to send them again.`,
        `You see them for this answer and keep seeing the ones in keepImageIds for ${visibleMinutes} minutes.`,
      ].join(" "),
      schema: viewImageSchema,
      responseFormat: "content_and_artifact",
    },
  );
}
