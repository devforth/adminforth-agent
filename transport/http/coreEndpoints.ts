import { logger, type IHttpServer } from "adminforth";
import { z } from "zod";
import { createSseEventEmitter } from "../sse/sseWriter.js";
import type { AgentEventEmitter } from "../../domain/agentEvents.js";
import { getErrorMessage } from "../../shared/errors.js";
import type { CurrentPageContext } from "../../tools/getUserLocation.js";
import type { CoreEndpointsContext } from "./context.js";
import type { ImageAttachmentsLimits } from "../../domain/imageAttachments.js";

type MulterFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

type ExpressMulterRequest = { file?: MulterFile };

const currentPageContextSchema = z.object({
  path: z.string(),
  fullPath: z.string(),
  title: z.string(),
  url: z.string(),
}).strict() satisfies z.ZodType<CurrentPageContext>;

const attachmentRefSchema = z.object({
  filePath: z.string(),
  token: z.string(),
}).strict();

function buildAgentResponseBodySchema({ maxPerMessage }: ImageAttachmentsLimits) {
  return z.object({
    message: z.string(),
    sessionId: z.string(),
    mode: z.string().nullish(),
    timeZone: z.string().optional(),
    currentPage: currentPageContextSchema.optional(),
    attachments: z.array(attachmentRefSchema).max(maxPerMessage).optional(),
  }).strict();
}

const attachmentUploadUrlBodySchema = z.object({
  sessionId: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number().int().positive(),
}).strict();

const agentApprovalBodySchema = z.object({
  sessionId: z.string(),
  decision: z.enum(["approve", "reject"]),
  mode: z.string().nullish(),
}).strict();

const agentSteerBodySchema = z.object({
  sessionId: z.string(),
  message: z.string().min(1),
}).strict();

const agentEditFields = {
  sessionId: z.string(),
  turnId: z.string(),
  mode: z.string().nullish(),
  timeZone: z.string().optional(),
  currentPage: currentPageContextSchema.optional(),
};

// An edited message keeps text, images or both. Written as a union, not a refine: the
// request schema is checked as JSON Schema, which has no place for a refine.
export function buildAgentEditBodySchema({ maxPerMessage }: ImageAttachmentsLimits) {
  // images the edited turn keeps are sent without a token
  const editAttachmentsSchema = z.array(attachmentRefSchema.partial({ token: true })).max(maxPerMessage);
  return z.union([
    z.object({ ...agentEditFields, message: z.string().min(1), attachments: editAttachmentsSchema.optional() }).strict(),
    z.object({ ...agentEditFields, message: z.string(), attachments: editAttachmentsSchema.min(1) }).strict(),
  ]);
}

// Sent as multipart/form-data (via multer), so every field arrives as a plain string on the wire.
// `currentPage` is JSON.stringify'd by the client into a form field and must be parsed back into
// an object. Zod -> JSON-Schema conversion cannot represent `.transform()` at all (it throws), so
// `agentSpeechResponseShapeSchema` (plain strings, no transform) is what's passed as request_schema
// for the AJV pre-check, while `agentSpeechResponseBodySchema` (with the transform) is used via an
// inline safeParse in the handler to actually parse `currentPage` into an object.
const agentSpeechResponseShapeSchema = z.object({
  sessionId: z.string(),
  mode: z.string().nullish(),
  timeZone: z.string().optional(),
  currentPage: z.string().optional(),
}).strict();

const agentSpeechResponseBodySchema = agentSpeechResponseShapeSchema.extend({
  currentPage: z.string().optional().transform((value, ctx) => {
    if (value === undefined) return undefined;
    try {
      return currentPageContextSchema.parse(JSON.parse(value));
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `currentPage must be a JSON-encoded object matching CurrentPageContext: ${err instanceof Error ? err.message : String(err)}`,
      });
      return z.NEVER;
    }
  }),
});

/**
 * Runs a turn on the already open event stream. A failure before the agent starts (the edited
 * turn was deleted in another tab, no pending approval) comes as an error event: a thrown error
 * would cut the stream, and the client would see only a network error.
 */
async function runOnStream(emit: AgentEventEmitter, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const message = getErrorMessage(error);
    logger.error(`Agent turn failed before it started: ${message}`);
    await emit({ type: "error", error: message });
    await emit({ type: "finish" });
  }
}

export function setupCoreEndpoints(ctx: CoreEndpointsContext, server: IHttpServer) {
  const agentResponseBodySchema = buildAgentResponseBodySchema(ctx.imageAttachmentsLimits);
  const agentEditBodySchema = buildAgentEditBodySchema(ctx.imageAttachmentsLimits);

  server.endpoint({
    method: 'POST',
    path: `/agent/get-placeholder-messages`,
    agent: {
      hiddenFromAgents: true,
    },
    handler: async ({ headers, adminUser }) => {
      if (!ctx.options.placeholderMessages) {
        return {
          messages: [],
        };
      }

      const messages = await ctx.options.placeholderMessages({
        adminUser: adminUser!,
        headers,
      });

      return {
        messages,
      };
    }
  });

  server.endpoint({
    method: 'POST',
    path: `/agent/response`,
    agent: {
      hiddenFromAgents: true,
    },
    request_schema: agentResponseBodySchema,
    handler: async ({ body, adminUser, _raw_express_res, abortSignal }) => {
      const data = body as z.infer<typeof agentResponseBodySchema>;
      const emit = createSseEventEmitter(_raw_express_res, {
        vercelAiUiMessageStream: true,
        closeActiveBlockOnToolStart: true,
      });

      await runOnStream(emit, () => ctx.handleTurn({
        prompt: data.message,
        sessionId: data.sessionId,
        modeName: data.mode,
        userTimeZone: data.timeZone ?? 'UTC',
        currentPage: data.currentPage,
        attachments: data.attachments,
        abortSignal,
        adminUser: adminUser!,
        emit,
        failureLogMessage: "Agent response streaming failed",
        abortLogMessage: "Agent response streaming aborted by the client",
      }));
      return null;
    }
  });

  server.endpoint({
    method: 'POST',
    path: `/agent/edit`,
    agent: {
      hiddenFromAgents: true,
    },
    request_schema: agentEditBodySchema,
    handler: async ({ body, adminUser, _raw_express_res, abortSignal }) => {
      const data = body as z.infer<typeof agentEditBodySchema>;
      const emit = createSseEventEmitter(_raw_express_res, {
        vercelAiUiMessageStream: true,
        closeActiveBlockOnToolStart: true,
      });

      await runOnStream(emit, () => ctx.handleEditTurn({
        prompt: data.message,
        turnId: data.turnId,
        sessionId: data.sessionId,
        modeName: data.mode,
        userTimeZone: data.timeZone ?? 'UTC',
        currentPage: data.currentPage,
        attachments: data.attachments,
        abortSignal,
        adminUser: adminUser!,
        emit,
        failureLogMessage: "Agent message edit streaming failed",
        abortLogMessage: "Agent message edit streaming aborted by the client",
      }));
      return null;
    }
  });

  server.endpoint({
    method: 'POST',
    path: `/agent/approval`,
    agent: {
      hiddenFromAgents: true,
    },
    request_schema: agentApprovalBodySchema,
    handler: async ({ body, adminUser, _raw_express_res, abortSignal }) => {
      const data = body as z.infer<typeof agentApprovalBodySchema>;
      const emit = createSseEventEmitter(_raw_express_res, {
        vercelAiUiMessageStream: true,
        closeActiveBlockOnToolStart: true,
      });

      await runOnStream(emit, () => ctx.handleTurn({
        prompt: "",
        sessionId: data.sessionId,
        modeName: data.mode,
        approvalDecision: data.decision,
        abortSignal,
        adminUser: adminUser!,
        emit,
        failureLogMessage: "Agent approval response streaming failed",
        abortLogMessage: "Agent approval response streaming aborted by the client",
      }));
      return null;
    }
  });

  server.endpoint({
    method: 'POST',
    path: `/agent/steer`,
    agent: {
      hiddenFromAgents: true,
    },
    request_schema: agentSteerBodySchema,
    handler: async ({ body, adminUser }) => {
      const data = body as z.infer<typeof agentSteerBodySchema>;
      // Fire-and-forget: the steer is buffered and folded into the running turn by the
      // beforeModel steer middleware, which signals `data-steer-applied` on that turn's
      // SSE stream once consumed. This endpoint only confirms it was received/queued.
      const { id, queued } = await ctx.steer({ 
        sessionId: data.sessionId,
        message: data.message,
        adminUser: adminUser
      });
      return { ok: true, id, queued };
    }
  });

  server.endpoint({
    method: 'POST',
    path: `/agent/attachment-upload-url`,
    agent: {
      hiddenFromAgents: true,
    },
    request_schema: attachmentUploadUrlBodySchema,
    handler: async ({ body, adminUser, response }) => {
      const data = body as z.infer<typeof attachmentUploadUrlBodySchema>;
      try {
        return await ctx.createAttachmentUploadUrl({ ...data, adminUser: adminUser! });
      } catch (error) {
        // A disallowed extension or a too large file is the user's input, not a server failure.
        response.setStatus(400);
        return { error: getErrorMessage(error) };
      }
    }
  });

  server.endpoint({
    method: 'POST',
    path: `/agent/speech-response`,
    agent: {
      hiddenFromAgents: true,
    },
    target: 'upload',
    request_schema: agentSpeechResponseShapeSchema,
    handler: async ({ body, adminUser, response, _raw_express_req, _raw_express_res, abortSignal }) => {
      const req = _raw_express_req as ExpressMulterRequest;
      const audioAdapter = ctx.options.audioAdapter;
      if (!audioAdapter) {
        response.setStatus(400, "Audio adapter is not configured for AdminForth Agent");
        return { error: "Audio adapter is not configured for AdminForth Agent" };
      }
      const parsed = agentSpeechResponseBodySchema.safeParse(body);
      if (!parsed.success) {
        response.setStatus(400, 'Request body validation failed');
        return { error: 'Request body validation failed', details: parsed.error.issues };
      }
      const data = parsed.data;
      if (!req.file) {
        response.setStatus(400, "Audio file is required");
        return { error: "Audio file is required" };
      }
      const emit = createSseEventEmitter(_raw_express_res);

      await ctx.handleSpeechTurn({
        audioAdapter,
        audio: {
          buffer: req.file.buffer,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
        },
        sessionId: data.sessionId,
        modeName: data.mode,
        userTimeZone: data.timeZone ?? 'UTC',
        currentPage: data.currentPage,
        abortSignal,
        adminUser: adminUser!,
        emit,
        failureLogMessage: "Agent speech response failed",
        abortLogMessage: "Agent speech response aborted by the client",
      });
      return null;
    }
  });
}
