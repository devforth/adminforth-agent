import type { IHttpServer } from "adminforth";
import { logger } from "adminforth";
import { z } from "zod";
import { isAbortError, getErrorMessage } from "../errors.js";
import { sanitizeSpeechText } from "../sanitizeSpeechText.js";
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

      let transcription;

      try {
        transcription = await audioAdapter.transcribe({
          buffer: req.file.buffer,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          language: "auto",
          abortSignal,
        });
      } catch (error) {
        if (abortSignal.aborted || isAbortError(error)) {
          logger.info("Agent speech transcription aborted by the client");
          await emit({ type: "finish" });
          return null;
        }

        logger.error(`Agent speech transcription failed:\n${getErrorMessage(error)}`);
        await emit({
          type: "error",
          error: "Speech transcription failed. Check server logs for details.",
        });
        await emit({ type: "finish" });
        return null;
      }

      if (abortSignal.aborted) {
        await emit({ type: "finish" });
        return null;
      }

      const prompt = transcription.text;
      if (!prompt) {
        await emit({
          type: "error",
          error: "Speech transcription is empty",
        });
        await emit({ type: "finish" });
        return null;
      }
      await emit({
        type: "transcript",
        text: transcription.text,
        language: transcription.language,
      });

      const sessionId = data.sessionId as string;
      const currentPage = data.currentPage;
      const agentResponse = await ctx.runAndPersistAgentResponse({
        prompt,
        sessionId,
        modeName: data.mode,
        userTimeZone: data.timeZone ?? 'UTC',
        currentPage,
        abortSignal,
        adminUser: adminUser!,
        emit: async (event) => {
          if (event.type === "tool-call") {
            await emit(event);
          }
        },
        failureLogMessage: "Agent speech response failed",
        abortLogMessage: "Agent speech response aborted by the client",
      });

      if (agentResponse.aborted) {
        await emit({ type: "finish" });
        return null;
      }

      if (agentResponse.failed) {
        await emit({
          type: "error",
          error: agentResponse.text,
        });
        await emit({ type: "finish" });
        return null;
      }

      try {
        await emit({
          type: "speech-response",
          transcript: {
            text: transcription.text,
            language: transcription.language,
          },
          response: {
            text: agentResponse.text,
          },
          sessionId,
          turnId: agentResponse.turnId,
        });
        const speech = await audioAdapter.synthesize({
          text: sanitizeSpeechText(agentResponse.text),
          stream: true,
          streamFormat: "audio",
          format: "pcm",
          abortSignal,
        });

        await emit({
          type: "audio-start",
          mimeType: speech.mimeType,
          format: speech.format,
          sampleRate: 24000,
          channelCount: 1,
          bitsPerSample: 16,
        });

        const reader = speech.audioStream.getReader();
        const cancelAudioStream = () => {
          void reader.cancel().catch(() => undefined);
        };

        try {
          abortSignal.addEventListener("abort", cancelAudioStream, { once: true });

          while (true) {
            if (abortSignal.aborted) {
              await reader.cancel().catch(() => undefined);
              break;
            }

            const { value, done } = await reader.read();

            if (done) {
              break;
            }

            if (abortSignal.aborted) {
              break;
            }

            await emit({
              type: "audio-delta",
              value,
            });
          }
        } finally {
          abortSignal.removeEventListener("abort", cancelAudioStream);
          reader.releaseLock();
        }

        await emit({ type: "audio-done" });
        await emit({ type: "finish" });
        return null;
      } catch (error) {
        if (abortSignal.aborted || isAbortError(error)) {
          logger.info("Agent speech audio streaming aborted by the client");
        } else {
          logger.error(`Agent speech audio streaming failed:\n${error}`);
          await emit({
            type: "error",
            error: getErrorMessage(error),
          });
        }
        await emit({ type: "finish" });
        return null;
      }
    }
  });
}
