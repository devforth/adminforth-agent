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

const agentResponseBodySchema = z.object({
  message: z.string(),
  sessionId: z.string(),
  mode: z.string().nullish(),
  timeZone: z.string().optional(),
  currentPage: z.custom<CurrentPageContext>().optional(),
}).strict();

const agentApprovalBodySchema = z.object({
  sessionId: z.string(),
  decision: z.enum(["approve", "reject"]),
}).strict();

const agentSpeechResponseBodySchema = agentResponseBodySchema.omit({ message: true });

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
    handler: async ({ body, adminUser, response, _raw_express_res, abortSignal }) => {
      const data = ctx.parseBody(agentResponseBodySchema, body, response);
      if (!data) return;
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
    handler: async ({ body, adminUser, response, _raw_express_res, abortSignal }) => {
      const data = ctx.parseBody(agentApprovalBodySchema, body, response);
      if (!data) return;
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
    handler: async ({ body, adminUser, response, _raw_express_req, _raw_express_res, abortSignal }) => {
      const req = _raw_express_req as ExpressMulterRequest;
      const audioAdapter = ctx.options.audioAdapter;
      if (!audioAdapter) {
        response.setStatus(400, "Audio adapter is not configured for AdminForth Agent");
        return { error: "Audio adapter is not configured for AdminForth Agent" };
      }
      const data = ctx.parseBody(agentSpeechResponseBodySchema, body, response);
      if (!data) return;
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
