import { logger } from "adminforth";
import { getErrorMessage, isAbortError } from "../../errors.js";
import { sanitizeSpeechText } from "../../sanitizeSpeechText.js";
import type {
  RunAndPersistAgentResponseInput,
  RunAndPersistAgentResponseResult,
  SpeechAgentTurnInput,
} from "../turn/turnTypes.js";

export class SpeechTurnService {
  constructor(
    private readonly runAndPersistAgentResponse: (
      input: RunAndPersistAgentResponseInput,
    ) => Promise<RunAndPersistAgentResponseResult>,
  ) {}

  async handle(input: SpeechAgentTurnInput) {
    let transcription;

    try {
      transcription = await input.audioAdapter.transcribe({
        buffer: input.audio.buffer,
        filename: input.audio.filename,
        mimeType: input.audio.mimeType,
        language: "auto",
        abortSignal: input.abortSignal,
      });
    } catch (error) {
      if (input.abortSignal?.aborted || isAbortError(error)) {
        logger.info("Agent speech transcription aborted by the client");
        await input.emit({ type: "finish" });
        return null;
      }

      logger.error(`Agent speech transcription failed:\n${getErrorMessage(error)}`);
      await input.emit({
        type: "error",
        error: "Speech transcription failed. Check server logs for details.",
      });
      await input.emit({ type: "finish" });
      return null;
    }

    if (input.abortSignal?.aborted) {
      await input.emit({ type: "finish" });
      return null;
    }

    const prompt = transcription.text;
    if (!prompt) {
      await input.emit({
        type: "error",
        error: "Speech transcription is empty",
      });
      await input.emit({ type: "finish" });
      return null;
    }

    await input.emit({
      type: "transcript",
      text: transcription.text,
      language: transcription.language,
    });

    const agentResponse = await this.runAndPersistAgentResponse({
      prompt,
      sessionId: input.sessionId,
      modeName: input.modeName,
      userTimeZone: input.userTimeZone,
      currentPage: input.currentPage,
      chatSurface: input.chatSurface,
      adminPublicOrigin: input.adminPublicOrigin,
      abortSignal: input.abortSignal,
      adminUser: input.adminUser,
      emit: async (event) => {
        if (event.type === "tool-call") {
          await input.emit(event);
        }
      },
      failureLogMessage: input.failureLogMessage ?? "Agent speech response failed",
      abortLogMessage: input.abortLogMessage ?? "Agent speech response aborted by the client",
    });

    if (agentResponse.aborted) {
      await input.emit({ type: "finish" });
      return agentResponse;
    }

    if (agentResponse.failed) {
      await input.emit({
        type: "error",
        error: agentResponse.text,
      });
      await input.emit({ type: "finish" });
      return agentResponse;
    }

    try {
      await input.emit({
        type: "speech-response",
        transcript: {
          text: transcription.text,
          language: transcription.language,
        },
        response: {
          text: agentResponse.text,
        },
        sessionId: input.sessionId,
        turnId: agentResponse.turnId,
      });
      const speech = await input.audioAdapter.synthesize({
        text: sanitizeSpeechText(agentResponse.text),
        stream: true,
        streamFormat: "audio",
        format: "pcm",
        abortSignal: input.abortSignal,
      });

      await input.emit({
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
        input.abortSignal?.addEventListener("abort", cancelAudioStream, { once: true });

        while (true) {
          if (input.abortSignal?.aborted) {
            await reader.cancel().catch(() => undefined);
            break;
          }

          const { value, done } = await reader.read();

          if (done) {
            break;
          }

          if (input.abortSignal?.aborted) {
            break;
          }

          await input.emit({
            type: "audio-delta",
            value,
          });
        }
      } finally {
        input.abortSignal?.removeEventListener("abort", cancelAudioStream);
        reader.releaseLock();
      }

      await input.emit({ type: "audio-done" });
      await input.emit({ type: "finish" });
      return agentResponse;
    } catch (error) {
      if (input.abortSignal?.aborted || isAbortError(error)) {
        logger.info("Agent speech audio streaming aborted by the client");
      } else {
        logger.error(`Agent speech audio streaming failed:\n${getErrorMessage(error)}`);
        await input.emit({
          type: "error",
          error: getErrorMessage(error),
        });
      }
      await input.emit({ type: "finish" });
      return agentResponse;
    }
  }
}
