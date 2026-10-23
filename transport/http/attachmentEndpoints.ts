import type { IHttpServer } from "adminforth";
import { z } from "zod";
import { ATTACHMENT_MIME_TYPES } from "../../domain/attachments.js";
import type { AttachmentEndpointsContext } from "./context.js";

const BYTES_IN_MEGABYTE = 1024 * 1024;

const attachmentUploadUrlBodySchema = z.object({
  mimeType: z.enum(ATTACHMENT_MIME_TYPES),
  size: z.number().int().positive(),
}).strict();

export function setupAttachmentEndpoints(ctx: AttachmentEndpointsContext, server: IHttpServer) {
  const { attachmentStore } = ctx;
  if (!attachmentStore) {
    return;
  }

  // The browser uploads the image itself by the returned link, then sends its key with the message.
  server.endpoint({
    method: 'POST',
    path: `/agent/get-attachment-upload-url`,
    agent: {
      hiddenFromAgents: true,
    },
    request_schema: attachmentUploadUrlBodySchema,
    handler: async ({ body, adminUser, response }) => {
      const data = body as z.infer<typeof attachmentUploadUrlBodySchema>;
      if (data.size > attachmentStore.maxFileSizeMb * BYTES_IN_MEGABYTE) {
        response.setStatus(400);
        return { error: `Image is larger than ${attachmentStore.maxFileSizeMb} MB` };
      }

      return attachmentStore.createUpload(adminUser!.pk!, data.mimeType);
    },
  });
}
