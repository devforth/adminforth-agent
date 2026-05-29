import type { AdminUser, AudioAdapter, IAdminForth } from "adminforth";
import { logger } from "adminforth";
import { randomUUID } from "crypto";
import { HumanMessage, SystemMessage } from "langchain";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createAgentChatModel, callAgent } from "./agent/simpleAgent.js";
import { createSequenceDebugCollector } from "./agent/middleware/sequenceDebug.js";
import { detectUserLanguage, type PreviousUserMessage } from "./agent/languageDetect.js";
import { prepareApiBasedTools as buildApiBasedTools } from "./apiBasedTools.js";
import type { AgentEventEmitter } from "./agentEvents.js";
import { buildAgentTurnSystemPrompt } from "./agent/systemPrompt.js";
import type { CurrentPageContext } from "./agent/tools/getUserLocation.js";
import { isAbortError, getErrorMessage } from "./errors.js";
import { sanitizeSpeechText } from "./sanitizeSpeechText.js";
import type { AgentSessionStore } from "./sessionStore.js";
import type { PluginOptions } from "./types.js";

type AgentTurnRunInput = {
  prompt: string;
  sessionId: string;
  turnId: string;
  previousUserMessages: PreviousUserMessage[];
  modeName?: string | null;
  userTimeZone: string;
  currentPage?: CurrentPageContext;
  abortSignal?: AbortSignal;
  adminUser: AdminUser;
  sequenceDebugCollector: ReturnType<typeof createSequenceDebugCollector>;
  emit?: AgentEventEmitter;
};

export type RunAndPersistAgentResponseInput = {
  prompt: string;
  sessionId: string;
  modeName?: string | null;
  userTimeZone: string;
  currentPage?: CurrentPageContext;
  abortSignal?: AbortSignal;
  adminUser: AdminUser;
  emit?: AgentEventEmitter;
  failureLogMessage: string;
  abortLogMessage: string;
};

export type RunAndPersistAgentResponseResult = {
  text: string;
  turnId: string;
  aborted: boolean;
  failed: boolean;
};

export type HandleTurnInput = Omit<RunAndPersistAgentResponseInput, "failureLogMessage" | "abortLogMessage"> & {
  emit: AgentEventEmitter;
  failureLogMessage?: string;
  abortLogMessage?: string;
};

export type HandleSpeechTurnInput = Omit<HandleTurnInput, "prompt"> & {
  audioAdapter: AudioAdapter;
  audio: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  };
};

type AgentTurnServiceOptions = {
  getAdminforth: () => IAdminForth;
  getPluginInstanceId: () => string;
  options: PluginOptions;
  sessionStore: AgentSessionStore;
  getCheckpointer: () => BaseCheckpointSaver;
  getInternalAgentResourceIds: () => string[];
  getAgentSystemPrompt: () => Promise<string>;
};

const VEGA_LITE_FENCE_START = "```vega-lite";
const COMPLETE_VEGA_LITE_BLOCK_RE = /```vega-lite[\s\S]*?```/;

export class AgentTurnService {
  constructor(private serviceOptions: AgentTurnServiceOptions) {}

  private async runAgentTurn(input: AgentTurnRunInput) {
    const adminforth = this.serviceOptions.getAdminforth();
    const options = this.serviceOptions.options;
    let fullResponse = "";
    let bufferedTextDelta = "";
    let isRenderingVegaLite = false;
    const maxTokens = options.maxTokens ?? 1000;
    const selectedMode = options.modes.find((mode) => mode.name === input.modeName) ?? options.modes[0];
    const [primaryModelSpec, summaryModelSpec] = await Promise.all([
      createAgentChatModel({
        adapter: selectedMode.completionAdapter,
        maxTokens,
        purpose: "primary",
      }),
      createAgentChatModel({
        adapter: selectedMode.completionAdapter,
        maxTokens,
        purpose: "summary",
      }),
    ]);
    const model = primaryModelSpec.model;
    const summaryModel = summaryModelSpec.model;
    const modelMiddleware = primaryModelSpec.middleware;

    const userLanguage = await detectUserLanguage(selectedMode.completionAdapter, input.prompt, input.previousUserMessages)
      .catch((error) => {
        if (input.abortSignal?.aborted || isAbortError(error)) {
          throw error;
        }

        logger.warn(`Failed to detect user language: ${getErrorMessage(error)}`);
        return null;
      });
    const systemPrompt = buildAgentTurnSystemPrompt({
      agentSystemPrompt: await this.serviceOptions.getAgentSystemPrompt(),
      adminUser: input.adminUser,
      usernameField: adminforth.config.auth!.usernameField,
      userLanguage,
    });
    const apiBasedTools = buildApiBasedTools(
      adminforth,
      this.serviceOptions.getInternalAgentResourceIds(),
    );

    const stream = await callAgent({
      name: `adminforth-agent-${this.serviceOptions.getPluginInstanceId()}`,
      model,
      summaryModel,
      modelMiddleware,
      checkpointer: this.serviceOptions.getCheckpointer(),
      messages: [
        new SystemMessage(systemPrompt),
        new HumanMessage(input.prompt),
      ],
      adminUser: input.adminUser,
      adminforth,
      apiBasedTools,
      customComponentsDir: adminforth.config.customization.customComponentsDir ?? "custom",
      pluginCustomFolderPaths: adminforth.activatedPlugins.map((plugin) => plugin.customFolderPath),
      sessionId: input.sessionId,
      turnId: input.turnId,
      currentPage: input.currentPage,
      userTimeZone: input.userTimeZone,
      abortSignal: input.abortSignal,
      emitToolCallEvent: (event) => {
        input.sequenceDebugCollector.handleToolCallEvent(event);
        void input.emit?.({
          type: "tool-call",
          data: event,
        });
      },
      sequenceDebugSink: input.sequenceDebugCollector,
    });

    for await (const rawChunk of stream as AsyncIterable<[any, any]>) {
      if (input.abortSignal?.aborted) {
        throw new DOMException("This operation was aborted", "AbortError");
      }

      const [token, metadata] = rawChunk;

      const nodeName =
        typeof metadata?.langgraph_node === "string"
          ? metadata.langgraph_node
          : "";

      if (nodeName && !["model", "model_request"].includes(nodeName)) {
        continue;
      }

      const blocks = Array.isArray(token?.contentBlocks)
        ? token.contentBlocks
        : Array.isArray(token?.content)
          ? token.content
          : [];
      const reasoningDelta = blocks
        .filter((b: any) => b?.type === "reasoning")
        .map((b: any) => String(b.reasoning ?? ""))
        .join("");

      const textDelta = blocks
        .filter((b: any) => b?.type === "text")
        .map((b: any) => String(b.text ?? ""))
        .join("");

      if (reasoningDelta) {
        await input.emit?.({
          type: "reasoning-delta",
          delta: reasoningDelta,
        });
      }

      if (textDelta) {
        fullResponse += textDelta;
        bufferedTextDelta += textDelta;

        if (
          bufferedTextDelta.includes(VEGA_LITE_FENCE_START) &&
          !COMPLETE_VEGA_LITE_BLOCK_RE.test(bufferedTextDelta)
        ) {
          if (!isRenderingVegaLite) {
            isRenderingVegaLite = true;
            await input.emit?.({
              type: "rendering",
              phase: "start",
              label: "Rendering...",
            });
          }
          continue;
        }

        if (isRenderingVegaLite) {
          isRenderingVegaLite = false;
          await input.emit?.({
            type: "rendering",
            phase: "end",
            label: "Rendering...",
          });
        }

        const streamableLength = bufferedTextDelta.includes(VEGA_LITE_FENCE_START)
          ? bufferedTextDelta.length
          : bufferedTextDelta.length - getPartialVegaLiteFenceStartLength(bufferedTextDelta);

        if (!streamableLength) {
          continue;
        }

        await input.emit?.({
          type: "text-delta",
          delta: bufferedTextDelta.slice(0, streamableLength),
        });
        bufferedTextDelta = bufferedTextDelta.slice(streamableLength);
      }
    }

    if (isRenderingVegaLite) {
      await input.emit?.({
        type: "rendering",
        phase: "end",
        label: "Rendering...",
      });
    }

    if (bufferedTextDelta) {
      await input.emit?.({
        type: "text-delta",
        delta: bufferedTextDelta,
      });
    }

    return {
      text: fullResponse,
    };
  }

  async runAndPersistAgentResponse(input: RunAndPersistAgentResponseInput) {
    const adminforth = this.serviceOptions.getAdminforth();
    const options = this.serviceOptions.options;
    const previousUserMessages = await this.serviceOptions.sessionStore.getPreviousUserMessages(input.sessionId);
    const turnId = await this.serviceOptions.sessionStore.createNewTurn(input.sessionId, input.prompt);
    await adminforth.resource(options.sessionResource.resourceId).update(input.sessionId, {
      [options.sessionResource.createdAtField]: new Date().toISOString(),
    });
    const sequenceDebugCollector = createSequenceDebugCollector();
    let fullResponse = "";
    let aborted = false;
    let failed = false;

    try {
      const agentResponse = await this.runAgentTurn({
        prompt: input.prompt,
        sessionId: input.sessionId,
        turnId,
        previousUserMessages,
        modeName: input.modeName,
        userTimeZone: input.userTimeZone,
        currentPage: input.currentPage,
        abortSignal: input.abortSignal,
        adminUser: input.adminUser,
        sequenceDebugCollector,
        emit: input.emit,
      });
      fullResponse = agentResponse.text;
    } catch (error) {
      if (input.abortSignal?.aborted || isAbortError(error)) {
        aborted = true;
        logger.info(input.abortLogMessage);
      } else {
        failed = true;
        fullResponse = getErrorMessage(error);
        logger.error(`${input.failureLogMessage}:\n${fullResponse}`);
      }
    }

    sequenceDebugCollector.flush();
    const turnUpdates: Record<string, unknown> = {
      [options.turnResource.responseField]: fullResponse,
    };

    if (options.turnResource.debugField) {
      turnUpdates[options.turnResource.debugField] = sequenceDebugCollector.getHistory();
    }

    await adminforth.resource(options.turnResource.resourceId).update(turnId, turnUpdates);

    return {
      text: fullResponse,
      turnId,
      aborted,
      failed,
    };
  }

  async handleTurn(input: HandleTurnInput) {
    await input.emit({
      type: "turn-started",
      messageId: randomUUID(),
    });

    const agentResponse = await this.runAndPersistAgentResponse({
      prompt: input.prompt,
      sessionId: input.sessionId,
      modeName: input.modeName,
      userTimeZone: input.userTimeZone,
      currentPage: input.currentPage,
      abortSignal: input.abortSignal,
      adminUser: input.adminUser,
      emit: input.emit,
      failureLogMessage: input.failureLogMessage ?? "Agent response failed",
      abortLogMessage: input.abortLogMessage ?? "Agent response aborted",
    });

    if (agentResponse.failed) {
      await input.emit({
        type: "error",
        error: agentResponse.text,
      });
    } else if (!agentResponse.aborted) {
      await input.emit({
        type: "response",
        text: agentResponse.text,
        sessionId: input.sessionId,
        turnId: agentResponse.turnId,
      });
    }

    await input.emit({
      type: "finish",
    });

    return agentResponse;
  }

  async handleSpeechTurn(input: HandleSpeechTurnInput) {
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

function getPartialVegaLiteFenceStartLength(text: string): number {
  for (let length = Math.min(text.length, VEGA_LITE_FENCE_START.length - 1); length > 0; length -= 1) {
    if (VEGA_LITE_FENCE_START.startsWith(text.slice(-length))) {
      return length;
    }
  }

  return 0;
}
