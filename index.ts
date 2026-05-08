import type { AdminUser, AdminForthResource, IAdminForth, IHttpServer } from "adminforth";

import { AdminForthPlugin, logger, Filters, Sorts } from "adminforth";

import type { PluginOptions } from './types.js';
import { randomUUID } from 'crypto';
import { HumanMessage, SystemMessage } from "langchain";
import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { z } from "zod";
import { createAgentChatModel, callAgent } from "./agent/simpleAgent.js";
import { AdminForthCheckpointSaver } from "./agent/checkpointer.js";
import { createSequenceDebugCollector } from "./agent/middleware/sequenceDebug.js";
import { detectUserLanguage, type PreviousUserMessage } from "./agent/languageDetect.js";
import { prepareApiBasedTools as buildApiBasedTools } from './apiBasedTools.js';
import { createAgentEventStream } from "./agentResponseEvents.js";
import { appendCustomSystemPrompt, buildAgentSystemPrompt, buildAgentTurnSystemPrompt, DEFAULT_AGENT_SYSTEM_PROMPT} from "./agent/systemPrompt.js";
import type { ToolCallEvent } from "./agent/toolCallEvents.js";
import type { CurrentPageContext } from "./agent/tools/getUserLocation.js";

type MulterFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

type ExpressMulterRequest = { file?: MulterFile };

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
  emitReasoningDelta?: (delta: string) => void;
  emitTextDelta?: (delta: string) => void;
  emitToolCallEvent?: (event: ToolCallEvent) => void;
};

type RunAndPersistAgentResponseInput =
  Omit<AgentTurnRunInput, "turnId" | "sequenceDebugCollector" | "previousUserMessages"> & {
    emitErrorResponse?: (response: string) => void;
    failureLogMessage: string;
    abortLogMessage: string;
  };

const agentResponseBodySchema = z.object({
  message: z.string(),
  sessionId: z.string(),
  mode: z.string().nullish(),
  timeZone: z.string().optional(),
  currentPage: z.custom<CurrentPageContext>().optional(),
}).strict();

const agentSpeechResponseBodySchema = agentResponseBodySchema.omit({message: true})

const addSystemMessageBodySchema = z.object({
  sessionId: z.string(),
  systemMessage: z.string(),
}).strict();

const getSessionsBodySchema = z.object({
  limit: z.number().optional(),
}).strict();

const sessionIdBodySchema = z.object({
  sessionId: z.string(),
}).strict();

const createSessionBodySchema = z.object({
  triggerMessage: z.string().optional(),
}).strict();

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "AbortError" || error.name === "APIUserAbortError")
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default class AdminForthAgentPlugin extends AdminForthPlugin {
  options: PluginOptions;
  agentSystemPromptPromise: Promise<string>;
  private checkpointer: BaseCheckpointSaver | null = null;
  private parseBody<T>(
    schema: z.ZodType<T>,
    body: unknown,
    response: { setStatus: (code: number, message?: string) => void },
  ): T | null {
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success) {
      response.setStatus(422, parsed.error.message);
      return null;
    }
    return parsed.data;
  }
  private async createNewTurn(sessionId: string, prompt: string, response?: string) {
    const turnId = randomUUID();
    const turnRecord = {
      [this.options.turnResource.idField]: turnId,
      [this.options.turnResource.sessionIdField]: sessionId,
      [this.options.turnResource.promptField]: prompt,
      [this.options.turnResource.responseField]: response || "not_finished",
    };
    const newTurn = await this.adminforth.resource(this.options.turnResource.resourceId).create(turnRecord);
    return newTurn.createdRecord[this.options.turnResource.idField];
  }

  private async getSessionTurns(sessionId: string) {
    const turns = await this.adminforth.resource(this.options.turnResource.resourceId).list(
      [Filters.EQ(this.options.turnResource.sessionIdField, sessionId)],
      undefined,
      undefined,
      [Sorts.ASC(this.options.turnResource.createdAtField)]
    );
    return turns.map(turn => ({
      prompt: turn[this.options.turnResource.promptField],
      response: turn[this.options.turnResource.responseField],
    }));
  }

  private async getPreviousUserMessages(sessionId: string) {
    const turns = await this.adminforth.resource(this.options.turnResource.resourceId).list(
      [Filters.EQ(this.options.turnResource.sessionIdField, sessionId)],
      2,
      undefined,
      [Sorts.DESC(this.options.turnResource.createdAtField)]
    );
    return turns
      .reverse()
      .map((turn): PreviousUserMessage => ({
        text: turn[this.options.turnResource.promptField],
      }));
  }

  private getCheckpointer() {
    if (this.checkpointer) return this.checkpointer;

    this.checkpointer = this.options.checkpointResource
      ? new AdminForthCheckpointSaver(this.adminforth, this.options)
      : new MemorySaver();

    return this.checkpointer;
  }

  private getInternalAgentResourceIds() {
    return [
      this.options.sessionResource.resourceId,
      this.options.turnResource.resourceId,
      this.options.checkpointResource?.resourceId,
    ].filter((resourceId): resourceId is string => Boolean(resourceId));
  }

  constructor(options: PluginOptions) {
    super(options, import.meta.url);
    this.options = options;
    this.agentSystemPromptPromise = Promise.resolve(
      appendCustomSystemPrompt(DEFAULT_AGENT_SYSTEM_PROMPT, this.options.systemPrompt),
    );
    this.shouldHaveSingleInstancePerWholeApp = () => false;
  }

  async modifyResourceConfig(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    super.modifyResourceConfig(adminforth, resourceConfig);
    if (!this.options.modes?.length) {
      throw new Error("modes is required for AdminForthAgentPlugin");
    }
    if (!this.adminforth.config.customization.globalInjections.header) {
      this.adminforth.config.customization.globalInjections.header = [];
    }
    this.adminforth.config.customization.globalInjections.header.push({
      file: this.componentPath("ChatSurface.vue"),
      meta: {
        pluginInstanceId: this.pluginInstanceId,
        modes: this.options.modes.map((mode) => ({ name: mode.name })),
        defaultModeName: this.options.modes[0].name,
        stickByDefault: this.options.stickByDefault ?? false,
        hasAudioAdapter: Boolean(this.options.audioAdapter),
      }
    });
    if (!this.adminforth.config.customization.customHeadItems) {
      this.adminforth.config.customization.customHeadItems = [];
    }
    this.adminforth.config.customization.customHeadItems.push(
      {
        tagName: 'script',
        attributes: {
          src: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.js'
        }
      },
      {
        tagName: 'script',
        attributes: {
          src: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/bundle.min.js'
        },
      }
    );
    if (!this.options.sessionResource) {
      throw new Error("sessionResource is required for AdminForthAgentPlugin");
    }
  }
  
  validateConfigAfterDiscover(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    this.options.audioAdapter?.validate();
    this.agentSystemPromptPromise = buildAgentSystemPrompt(
      adminforth,
      this.getInternalAgentResourceIds(),
    )
      .then((systemPrompt) => appendCustomSystemPrompt(systemPrompt, this.options.systemPrompt));
  }

  instanceUniqueRepresentation(pluginOptions: any) : string {
    return `single`;
  }

  private async runAgentTurn(input: AgentTurnRunInput) {
    let fullResponse = "";
    const maxTokens = this.options.maxTokens ?? 1000;
    const selectedMode = this.options.modes.find((mode) => mode.name === input.modeName) ?? this.options.modes[0];
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
      agentSystemPrompt: await this.agentSystemPromptPromise,
      adminUser: input.adminUser,
      usernameField: this.adminforth.config.auth.usernameField,
      userLanguage,
    });
    const apiBasedTools = buildApiBasedTools(
      this.adminforth,
      this.getInternalAgentResourceIds(),
    );

    const stream = await callAgent({
      name: `adminforth-agent-${this.pluginInstanceId}`,
      model,
      summaryModel,
      modelMiddleware,
      checkpointer: this.getCheckpointer(),
      messages: [
        new SystemMessage(systemPrompt),
        new HumanMessage(input.prompt),
      ],
      adminUser: input.adminUser,
      adminforth: this.adminforth,
      apiBasedTools,
      customComponentsDir: this.adminforth.config.customization.customComponentsDir,
      sessionId: input.sessionId,
      turnId: input.turnId,
      currentPage: input.currentPage,
      userTimeZone: input.userTimeZone,
      abortSignal: input.abortSignal,
      emitToolCallEvent: (event) => {
        input.sequenceDebugCollector.handleToolCallEvent(event);
        input.emitToolCallEvent?.(event);
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
        input.emitReasoningDelta?.(reasoningDelta);
      }

      if (textDelta) {
        fullResponse += textDelta;
        input.emitTextDelta?.(textDelta);
      }
    }

    return {
      text: fullResponse,
    };
  }

  private async runAndPersistAgentResponse(input: RunAndPersistAgentResponseInput) {
    const previousUserMessages = await this.getPreviousUserMessages(input.sessionId);
    const turnId = await this.createNewTurn(input.sessionId, input.prompt);
    await this.adminforth.resource(this.options.sessionResource.resourceId).update(input.sessionId, {
      [this.options.sessionResource.createdAtField]: new Date().toISOString(),
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
        emitToolCallEvent: input.emitToolCallEvent,
        emitReasoningDelta: input.emitReasoningDelta,
        emitTextDelta: input.emitTextDelta,
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
        input.emitErrorResponse?.(fullResponse);
      }
    }

    sequenceDebugCollector.flush();
    const turnUpdates: Record<string, unknown> = {
      [this.options.turnResource.responseField]: fullResponse,
    };

    if (this.options.turnResource.debugField) {
      turnUpdates[this.options.turnResource.debugField] = sequenceDebugCollector.getHistory();
    }

    await this.adminforth.resource(this.options.turnResource.resourceId).update(turnId, turnUpdates);

    return {
      text: fullResponse,
      turnId,
      aborted,
      failed,
    };
  }

  setupEndpoints(server: IHttpServer) {
    server.endpoint({
      method: 'POST',
      path: `/agent/get-placeholder-messages`,
      handler: async ({ headers, adminUser }) => {
        if (!this.options.placeholderMessages) {
          return {
            messages: [],
          };
        }

        const messages = await this.options.placeholderMessages({
          adminUser,
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
        const data = this.parseBody(agentResponseBodySchema, body, response);
        if (!data) return;
        const stream = createAgentEventStream(_raw_express_res, {vercelAiUiMessageStream: true, closeActiveBlockOnToolStart: true});
        const messageId = randomUUID();

        stream.start(messageId);
        await this.runAndPersistAgentResponse({
          prompt: data.message,
          sessionId: data.sessionId,
          modeName: data.mode,
          userTimeZone: data.timeZone ?? 'UTC',
          currentPage: data.currentPage,
          abortSignal,
          adminUser,
          emitToolCallEvent: stream.toolCall,
          emitReasoningDelta: stream.reasoningDelta,
          emitTextDelta: stream.textDelta,
          emitErrorResponse: stream.textDelta,
          failureLogMessage: "Agent response streaming failed",
          abortLogMessage: "Agent response streaming aborted by the client",
        });
        stream.end();
        return null;
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/speech-response`,
      target: 'upload',
      handler: async ({ body, adminUser, response, _raw_express_req, _raw_express_res, abortSignal }) => {
        const req = _raw_express_req as ExpressMulterRequest;
        const audioAdapter = this.options.audioAdapter;
        if (!audioAdapter) {
          response.setStatus(400, undefined);
          return { error: "Audio adapter is not configured for AdminForth Agent" };
        }
        const data = this.parseBody(agentSpeechResponseBodySchema, body, response);
        if (!data) return;
        if (!req.file) {
          response.setStatus(400, undefined);
          return { error: "Audio file is required" };
        }
        const stream = createAgentEventStream(_raw_express_res);
        
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
            stream.end();
            return null;
          }

          logger.error(`Agent speech transcription failed:\n${getErrorMessage(error)}`);
          stream.error("Speech transcription failed. Check server logs for details.");
          stream.end();
          return null;
        }

        if (abortSignal.aborted) {
          stream.end();
          return null;
        }

        const prompt = transcription.text;
        if (!prompt) {
          stream.error("Speech transcription is empty");
          stream.end();
          return null;
        }
        stream.transcript(transcription.text, transcription.language);

        const sessionId = data.sessionId as string;
        const currentPage = data.currentPage;
        const agentResponse = await this.runAndPersistAgentResponse({
          prompt,
          sessionId,
          modeName: data.mode,
          userTimeZone: data.timeZone ?? 'UTC',
          currentPage,
          abortSignal,
          adminUser,
          emitToolCallEvent: stream.toolCall,
          failureLogMessage: "Agent speech response failed",
          abortLogMessage: "Agent speech response aborted by the client",
        });

        if (agentResponse.aborted) {
          stream.end();
          return null;
        }

        if (agentResponse.failed) {
          stream.error(agentResponse.text);
          stream.end();
          return null;
        }

        try {
          stream.speechResponse(
            {
              text: transcription.text,
              language: transcription.language,
            },
            {
              text: agentResponse.text,
            },
            sessionId,
            agentResponse.turnId,
          );
          const speech = await audioAdapter.synthesize({
            text: agentResponse.text,
            stream: true,
            streamFormat: "audio",
            format: "mp3",
            abortSignal,
          });

          stream.audioStart(speech.mimeType, speech.format);

          const reader = speech.audioStream.getReader();
          const cancelAudioStream = () => {
            void reader.cancel();
          };

          try {
            abortSignal.addEventListener("abort", cancelAudioStream, { once: true });

            while (true) {
              if (abortSignal.aborted) {
                await reader.cancel();
                break;
              }

              const { value, done } = await reader.read();

              if (done) {
                break;
              }

              if (abortSignal.aborted) {
                break;
              }

              stream.audioDelta(value);
            }
          } finally {
            abortSignal.removeEventListener("abort", cancelAudioStream);
            reader.releaseLock();
          }

          stream.audioDone();
          stream.end();
          return null;
        } catch (error) {
          if (abortSignal.aborted || isAbortError(error)) {
            logger.info("Agent speech audio streaming aborted by the client");
          } else {
            logger.error(`Agent speech audio streaming failed:\n${error}`);
            stream.error(error);
          }
          stream.end();
          return null;
        }
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/get-sessions`,
      handler: async ({body, adminUser, response }) => {
        const data = this.parseBody(getSessionsBodySchema, body, response);
        if (!data) return;
        const userId = adminUser.pk;
        const limit = data.limit ?? 20;
        const sessions = await this.adminforth.resource(this.options.sessionResource.resourceId).list(
          [Filters.EQ(this.options.sessionResource.askerIdField, userId)], limit, undefined, [Sorts.DESC(this.options.sessionResource.createdAtField)]
        );
        return {
          sessions: sessions.map((session) => ({
            sessionId: session[this.options.sessionResource.idField],
            title: session[this.options.sessionResource.titleField],
            timestamp: session[this.options.sessionResource.createdAtField],
          })),
        };
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/get-session-info`,
      handler: async ({body, adminUser, response }) => {
        const parsedBody = sessionIdBodySchema.safeParse(body);
        if (!parsedBody.success) {
          response.setStatus(422, parsedBody.error.message);
          return;
        }
        const userId = adminUser.pk;
        const sessionId = parsedBody.data.sessionId;
        const session = await this.adminforth.resource(this.options.sessionResource.resourceId).get(
          [Filters.EQ(this.options.sessionResource.idField, sessionId)]
        );
        if (!session) {
          return {
            error: 'Session not found'
          };
        }
        if (session[this.options.sessionResource.askerIdField] !== userId) {
          return {
            error: 'Unauthorized'
          };
        }
        const turns = await this.getSessionTurns(sessionId);
        return {
          session: {
            sessionId,
            title: session[this.options.sessionResource.titleField],
            timestamp: session[this.options.sessionResource.createdAtField],
            messages: turns.flatMap(turn => {
              const messages = [];
              if (turn.prompt) {
                messages.push({
                  text: turn.prompt,
                  role: 'user',
                });
              }
              if (turn.response && turn.response !== "not_finished") {
                messages.push({
                  text: turn.response,
                  role: 'assistant',
                });
              }
              return messages;
            }),
          },
        };
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/create-session`,
      handler: async ({body, adminUser, response }) => {
        const data = this.parseBody(createSessionBodySchema, body, response);
        if (!data) return;
        const triggerMessage = data.triggerMessage;
        const userId = adminUser.pk;
        const title = triggerMessage?.slice(0, 40) || "New Session";
        const newSession = {
          [this.options.sessionResource.idField]: randomUUID(),
          [this.options.sessionResource.titleField]: title,
          [this.options.sessionResource.askerIdField]: userId,
        };
        await this.adminforth.resource(this.options.sessionResource.resourceId).create(newSession);
        return {
          sessionId: newSession[this.options.sessionResource.idField],
          title: newSession[this.options.sessionResource.titleField],
          timestamp: newSession[this.options.sessionResource.createdAtField],
          messages: []
        };
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/delete-session`,
      handler: async ({body, adminUser, response }) => {
        const data = this.parseBody(sessionIdBodySchema, body, response);
        if (!data) return;
        const sessionId = data.sessionId;
        const userId = adminUser.pk;
        const session = await this.adminforth.resource(this.options.sessionResource.resourceId).get(
          [Filters.EQ(this.options.sessionResource.idField, sessionId)]
        );
        if (!session) {
          return {
            error: 'Session not found'
          };
        }
        if (session[this.options.sessionResource.askerIdField] !== userId) {
          return {
            error: 'Unauthorized'
          };
        }
        await this.adminforth.resource(this.options.sessionResource.resourceId).delete(sessionId);
        const turns = await this.adminforth.resource(this.options.turnResource.resourceId).list(
          [Filters.EQ(this.options.turnResource.sessionIdField, sessionId)]
        );
        for (const turn of turns) {
          await this.adminforth.resource(this.options.turnResource.resourceId).delete(turn[this.options.turnResource.idField]);
        }
        return {
          ok: true
        };
      }
    }),
    server.endpoint({
      method: 'POST',
      path: `/agent/add-system-message-to-turns`,
      handler: async ({body, response }) => {
        const data = this.parseBody(addSystemMessageBodySchema, body, response);
        if (!data) return;
        await this.createNewTurn(data.sessionId, data.systemMessage);
        return {
          ok: true
        }
      }
    })
  }
}
