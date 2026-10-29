import path from "path";
import { tool, type BaseMessage } from "langchain";
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

/**
 * Shows again images of earlier user messages. The images it found go to the artifact of the
 * tool result: the attachments middleware shows them after the tool results for a while.
 */
export function createViewImageTool({ visibleMinutes, maxVisible }: ImageAttachmentsLimits) {
  const viewImageSchema = z.object({
    imageIds: z
      .array(z.string())
      .min(1)
      .max(maxVisible)
      .describe("Ids of the images, from the notes shown in place of them."),
  });

  return tool(
    async ({ imageIds }, runtime): Promise<[string, ViewImageArtifact]> => {
      // the agent passes its state to every tool call next to the run config
      const { messages } = (runtime as unknown as { state: { messages: BaseMessage[] } }).state;
      const filePathsInHistory = [...new Set(messages.flatMap((message) => getAttachmentPaths(message) ?? []))];
      const resolved = imageIds.map((imageId) => ({ imageId, filePath: resolveImagePath(filePathsInHistory, imageId) }));
      const filePaths = [...new Set(resolved.flatMap(({ filePath }) => (filePath ? [filePath] : [])))];
      const notFound = resolved.filter(({ filePath }) => !filePath).map(({ imageId }) => imageId);
      return [
        JSON.stringify({ shown: filePaths, notFound }, null, 2),
        { filePaths, viewedAt: new Date().toISOString() },
      ];
    },
    {
      name: VIEW_IMAGE_TOOL_NAME,
      description: `Shows again images of earlier user messages, which are replaced with notes when they are not shown any more. Call it when the images matter for the answer, with all the ids you need at once. The images are shown after the tool result, for ${visibleMinutes} minutes.`,
      schema: viewImageSchema,
      responseFormat: "content_and_artifact",
    },
  );
}
