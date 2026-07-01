import type { IHttpServer } from "adminforth";
import { z } from "zod";
import { createSseEventEmitter } from "../surfaces/web-sse/createSseEventEmitter.js";
import type { CurrentPageContext } from "../agent/tools/getUserLocation.js";
import type { CoreEndpointsContext } from "./context.js";

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

const agentResponseBodySchema = z.object({
  message: z.string(),
  sessionId: z.string(),
  mode: z.string().nullish(),
  timeZone: z.string().optional(),
  currentPage: currentPageContextSchema.optional(),
}).strict();

const agentApprovalBodySchema = z.object({
  sessionId: z.string(),
  decision: z.enum(["approve", "reject"]),
}).strict();

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

export function setupCoreEndpoints(ctx: CoreEndpointsContext, server: IHttpServer) {
  server.endpoint({
    method: 'POST',
    path: `/agent/get-placeholder-messages`,
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
    request_schema: agentResponseBodySchema,
    handler: async ({ body, adminUser, response, _raw_express_res, abortSignal }) => {
      const data = body as z.infer<typeof agentResponseBodySchema>;
      const emit = createSseEventEmitter(_raw_express_res, {
        vercelAiUiMessageStream: true,
        closeActiveBlockOnToolStart: true,
      });

      await ctx.handleTurn({
        prompt: data.message,
        sessionId: data.sessionId,
        modeName: data.mode,
        userTimeZone: data.timeZone ?? 'UTC',
        currentPage: data.currentPage,
        abortSignal,
        adminUser: adminUser!,
        emit,
        failureLogMessage: "Agent response streaming failed",
        abortLogMessage: "Agent response streaming aborted by the client",
      });
      return null;
    }
  });

  server.endpoint({
    method: 'POST',
    path: `/agent/approval`,
    request_schema: agentApprovalBodySchema,
    handler: async ({ body, adminUser, response, _raw_express_res, abortSignal }) => {
      const data = body as z.infer<typeof agentApprovalBodySchema>;
      const emit = createSseEventEmitter(_raw_express_res, {
        vercelAiUiMessageStream: true,
        closeActiveBlockOnToolStart: true,
      });

      await ctx.handleTurn({
        prompt: "",
        sessionId: data.sessionId,
        approvalDecision: data.decision,
        abortSignal,
        adminUser: adminUser!,
        emit,
        failureLogMessage: "Agent approval response streaming failed",
        abortLogMessage: "Agent approval response streaming aborted by the client",
      });
      return null;
    }
  });

  server.endpoint({
    method: 'POST',
    path: `/agent/speech-response`,
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
