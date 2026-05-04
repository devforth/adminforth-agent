import type {
  AdminUser,
  AdminForthResource,
  HttpExtra,
  IAdminForth,
  IHttpServer,
} from "adminforth";

import { AdminForthPlugin, logger, Filters, Sorts } from "adminforth";

import type { PluginOptions } from './types.js';
import { randomUUID } from 'crypto';
import { HumanMessage, SystemMessage } from "langchain";
import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import {
  createAgentChatModel,
  callAgent,
  type AgentChatModel,
} from "./agent/simpleAgent.js";
import { AdminForthCheckpointSaver } from "./agent/checkpointer.js";
import { createSequenceDebugCollector } from "./agent/middleware/sequenceDebug.js";
import {
  detectUserLanguage,
  formatLanguagePrompt,
} from "./agent/languageDetect.js";
import {
  prepareApiBasedTools as buildApiBasedTools,
} from './apiBasedTools.js';
import type { ApiBasedTool } from './apiBasedTools.js';
import { createAgentEventStream } from "./agentResponseEvents.js";
import {
  appendCustomSystemPrompt,
  buildAgentSystemPrompt,
  DEFAULT_AGENT_SYSTEM_PROMPT,
} from "./agent/systemPrompt.js";
import { ALWAYS_AVAILABLE_API_TOOL_NAMES } from "./agent/tools/index.js";
import type { ToolCallEvent } from "./agent/toolCallEvents.js";
import type { CurrentPageContext } from "./agent/tools/getUserLocation.js";


type CurrentPageRequestBody = {
  currentPage?: CurrentPageContext | string;
};

type SpeechResponseRequestBody = CurrentPageRequestBody & {
  sessionId?: string | null;
  mode?: string | null;
  timeZone?: string;
};

type UploadedAudioFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

type AgentTurnRunInput = {
  prompt: string;
  sessionId: string;
  turnId: string;
  modeName?: string | null;
  userTimeZone: string;
  currentPage?: CurrentPageContext;
  abortSignal?: AbortSignal;
  adminUser: AdminUser;
  httpExtra: HttpExtra;
  sequenceDebugCollector: ReturnType<typeof createSequenceDebugCollector>;
  emitReasoningDelta?: (delta: string) => void;
  emitTextDelta?: (delta: string) => void;
  emitToolCallEvent?: (event: ToolCallEvent) => void;
};

function isAggregateErrorLike(
  error: unknown,
): error is { errors: unknown[]; message?: string; stack?: string } {
  return typeof error === "object" && error !== null && Array.isArray((error as { errors?: unknown[] }).errors);
}

function formatAgentError(error: unknown) {
  if (isAggregateErrorLike(error)) {
    const nestedErrors = error.errors
      .map((nestedError, index) => {
        if (nestedError instanceof Error) {
          return `${index + 1}. ${nestedError.stack ?? nestedError.message}`;
        }

        return `${index + 1}. ${String(nestedError)}`;
      })
      .join("\n");

    return `${error.stack ?? error.message}\nNested errors:\n${nestedErrors}`;
  }

  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

function formatAgentResponseError(error: unknown): string {
  if (isAggregateErrorLike(error)) {
    const nestedErrors = error.errors.map(formatAgentResponseError);

    if (nestedErrors.length) {
      return nestedErrors.join("\n");
    }

    return error.message || "Agent response failed";
  }

  if (error instanceof Error) {
    return error.toString();
  }

  return String(error);
}

function formatAdminUserPrompt(adminUser: AdminUser, usernameField: string) {
  const dbUser = adminUser.dbUser as Record<string, unknown>;
  const adminUserContext = {
    id: adminUser.pk,
    email: dbUser[usernameField],
  };

  return [
    "Current admin user context:",
    JSON.stringify(adminUserContext, null, 2),
    "Use this admin user email when the user asks to send information to themselves, the current admin, or the logged-in user.",
  ].join("\n");
}

function parseCurrentPageContext(currentPage: CurrentPageRequestBody["currentPage"]) {
  return typeof currentPage === "string"
    ? JSON.parse(currentPage) as CurrentPageContext
    : currentPage;
}

function assertRequiredApiTool(
  apiBasedTools: Record<string, ApiBasedTool>,
  toolName: string,
) {
  if (toolName in apiBasedTools) {
    return;
  }

  const availableToolNames = Object.keys(apiBasedTools).sort().join(", ");
  throw new Error(
    `Required API tool "${toolName}" is missing from AdminForth Agent tools. Available tools: ${availableToolNames}`,
  );
}

export default class AdminForthAgentPlugin extends AdminForthPlugin {
  options: PluginOptions;
  apiBasedTools: Record<string, ApiBasedTool> = {};
  agentSystemPromptPromise: Promise<string>;
  private checkpointer: BaseCheckpointSaver | null = null;
  private readonly modelsByModeName = new Map<
    string,
    Promise<{
      model: AgentChatModel;
      summaryModel: AgentChatModel;
      modelMiddleware: Awaited<ReturnType<typeof createAgentChatModel>>["middleware"];
    }>
  >();

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

  private async updateTurn(turnId: string, updates: Record<string, unknown>) {
    await this.adminforth.resource(this.options.turnResource.resourceId).update(turnId, updates);
    return {ok: true};
  }

  private async updateSessionDate(sessionId: string) {
    await this.adminforth.resource(this.options.sessionResource.resourceId).update(sessionId, {
      [this.options.sessionResource.createdAtField]: new Date().toISOString(),
    });
    return {ok: true};
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

  private async getModeModels(
    mode: PluginOptions["modes"][number],
    maxTokens: number,
  ) {
    const cachedModels = this.modelsByModeName.get(mode.name);

    if (cachedModels) {
      return await cachedModels;
    }

    const modelsPromise = Promise.all([
      createAgentChatModel({
        adapter: mode.completionAdapter,
        maxTokens,
        purpose: "primary",
      }),
      createAgentChatModel({
        adapter: mode.completionAdapter,
        maxTokens,
        purpose: "summary",
      }),
    ]).then(([primaryModel, summaryModel]) => ({
      model: primaryModel.model,
      summaryModel: summaryModel.model,
      modelMiddleware: primaryModel.middleware,
    }));

    this.modelsByModeName.set(mode.name, modelsPromise);

    try {
      return await modelsPromise;
    } catch (error) {
      this.modelsByModeName.delete(mode.name);
      throw error;
    }
  }

  private getCheckpointer() {
    if (this.checkpointer) {
      return this.checkpointer;
    }

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
    if (!this.pluginOptions.sessionResource) {
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
    const maxTokens = this.options.maxTokens ?? 10000;
    const selectedMode =
      this.options.modes.find((mode) => mode.name === input.modeName) ??
      this.options.modes[0];
    const { model, summaryModel, modelMiddleware } =
      await this.getModeModels(selectedMode, maxTokens);
    const userLanguage = await detectUserLanguage(selectedMode.completionAdapter, input.prompt)
      .catch((error) => {
        logger.warn(`Failed to detect user language: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
    const systemPrompt = [
      await this.agentSystemPromptPromise,
      formatAdminUserPrompt(input.adminUser, this.adminforth.config.auth.usernameField),
      formatLanguagePrompt(userLanguage),
    ].join("\n\n");
    const apiBasedTools = buildApiBasedTools(
      this.adminforth,
      this.getInternalAgentResourceIds(),
    );
    for (const toolName of ALWAYS_AVAILABLE_API_TOOL_NAMES) {
      assertRequiredApiTool(apiBasedTools, toolName);
    }
    assertRequiredApiTool(apiBasedTools, "update_record");
    this.apiBasedTools = apiBasedTools;
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
      httpExtra: input.httpExtra,
      userTimeZone: input.userTimeZone,
      abortSignal: input.abortSignal,
      emitToolCallEvent: (event) => {
        input.sequenceDebugCollector.handleToolCallEvent(event);
        input.emitToolCallEvent?.(event);
      },
      sequenceDebugSink: input.sequenceDebugCollector,
    });

    for await (const rawChunk of stream as AsyncIterable<[any, any]>) {
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

  private async runAndPersistAgentResponse(input: {
    prompt: string;
    sessionId: string;
    modeName?: string | null;
    userTimeZone: string;
    currentPage?: CurrentPageContext;
    abortSignal?: AbortSignal;
    adminUser: AdminUser;
    httpExtra: HttpExtra;
    emitReasoningDelta?: (delta: string) => void;
    emitTextDelta?: (delta: string) => void;
    emitToolCallEvent?: (event: ToolCallEvent) => void;
    emitErrorResponse?: (response: string) => void;
    failureLogMessage: string;
    abortLogMessage: string;
  }) {
    const turnId = await this.createNewTurn(input.sessionId, input.prompt);
    await this.updateSessionDate(input.sessionId);
    const sequenceDebugCollector = createSequenceDebugCollector();
    let fullResponse = "";
    let aborted = false;
    let failed = false;

    try {
      const agentResponse = await this.runAgentTurn({
        prompt: input.prompt,
        sessionId: input.sessionId,
        turnId,
        modeName: input.modeName,
        userTimeZone: input.userTimeZone,
        currentPage: input.currentPage,
        abortSignal: input.abortSignal,
        adminUser: input.adminUser,
        httpExtra: input.httpExtra,
        sequenceDebugCollector,
        emitToolCallEvent: input.emitToolCallEvent,
        emitReasoningDelta: input.emitReasoningDelta,
        emitTextDelta: (textDelta) => {
          fullResponse += textDelta;
          input.emitTextDelta?.(textDelta);
        },
      });
      fullResponse = agentResponse.text;
    } catch (error) {
      if (input.abortSignal?.aborted) {
        aborted = true;
        logger.info(input.abortLogMessage);
      } else {
        failed = true;
        logger.error(`${input.failureLogMessage}:\n${formatAgentError(error)}`);
        fullResponse = formatAgentResponseError(error);
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

    await this.updateTurn(turnId, turnUpdates);

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
      handler: async ({ body, query, headers, cookies, adminUser, response, requestUrl }) => {
        if (!this.options.placeholderMessages) {
          return {
            messages: [],
          };
        }

        const messages = await this.options.placeholderMessages({
          adminUser,
          httpExtra: {
            body,
            query,
            headers,
            cookies,
            requestUrl,
            response,
          },
        });

        return {
          messages,
        };
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/response`,
      handler: async ({ body, query, headers, cookies, adminUser, response, requestUrl, _raw_express_res, abortSignal }) => {
        const stream = createAgentEventStream(_raw_express_res, {
          vercelAiUiMessageStream: true,
          closeActiveBlockOnToolStart: true,
        });
        const messageId = randomUUID();
        const prompt = body.message;
        const userTimeZone = (body.timeZone as string | undefined) ?? 'UTC';
        const currentPage = parseCurrentPageContext((body as CurrentPageRequestBody).currentPage);
        const sessionId = body.sessionId || adminUser?.pk || adminUser?.username || 'default';

        stream.start(messageId);
        await this.runAndPersistAgentResponse({
          prompt,
          sessionId,
          modeName: body.mode,
          userTimeZone,
          currentPage,
          abortSignal,
          adminUser,
          httpExtra: {
            body,
            query,
            headers,
            cookies,
            requestUrl,
            response,
          },
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
      handler: async ({ body, query, headers, cookies, adminUser, response, requestUrl, _raw_express_req, _raw_express_res, abortSignal }) => {
        const audioAdapter = this.options.audioAdapter;
        if (!audioAdapter) {
          response.setStatus(400, undefined);
          return {
            error: "Audio adapter is not configured for AdminForth Agent",
          };
        }
        const speechBody = body as SpeechResponseRequestBody;
        const audio = (_raw_express_req as { file?: UploadedAudioFile }).file;
        if (!audio) {
          response.setStatus(400, undefined);
          return {
            error: "Audio file is required",
          };
        }
        const stream = createAgentEventStream(_raw_express_res);
        
        let transcription;

        try {
          transcription = await audioAdapter.transcribe({
            buffer: audio.buffer,
            filename: audio.originalname,
            mimeType: audio.mimetype,
            language: "auto",
          });
        } catch (error) {
          logger.error(`Agent speech transcription failed:\n${formatAgentError(error)}`);
          stream.error("Speech transcription failed. Check server logs for details.");
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

        const sessionId = speechBody.sessionId as string;
        const currentPage = parseCurrentPageContext(speechBody.currentPage);
        const agentResponse = await this.runAndPersistAgentResponse({
          prompt,
          sessionId,
          modeName: speechBody.mode,
          userTimeZone: speechBody.timeZone ?? 'UTC',
          currentPage,
          abortSignal,
          adminUser,
          httpExtra: {
            body,
            query,
            headers,
            cookies,
            requestUrl,
            response,
          },
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
          stream.response(agentResponse.text, sessionId, agentResponse.turnId);
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
          });

          stream.audioStart(speech.mimeType, speech.format);

          const reader = speech.audioStream.getReader();

          try {
            while (true) {
              const { value, done } = await reader.read();

              if (done) {
                break;
              }

              stream.audioDelta(value);
            }
          } finally {
            reader.releaseLock();
          }

          stream.audioDone();
          stream.end();
          return null;
        } catch (error) {
          if (abortSignal.aborted) {
            logger.info("Agent speech audio streaming aborted by the client");
          } else {
            logger.error(`Agent speech audio streaming failed:\n${formatAgentError(error)}`);
            stream.error(formatAgentResponseError(error));
          }
          stream.end();
          return null;
        }
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/get-sessions`,
      handler: async ({body, adminUser }) => {
        const userId = adminUser.pk;
        const limit = typeof body.limit === 'number' ? body.limit : 20;
        const sessions = await this.adminforth.resource(this.pluginOptions.sessionResource.resourceId).list(
          [Filters.EQ(this.pluginOptions.sessionResource.askerIdField, userId)], limit, undefined, [Sorts.DESC(this.pluginOptions.sessionResource.createdAtField)]
        );
        const sessionsToReturn = [];
        for (const session of sessions) {
         sessionsToReturn.push({
          sessionId: session[this.pluginOptions.sessionResource.idField],
          title: session[this.pluginOptions.sessionResource.titleField],
          timestamp: session[this.pluginOptions.sessionResource.createdAtField],
         })
        }
        return {
          sessions: sessionsToReturn
        };
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/get-session-info`,
      handler: async ({body, adminUser }) => {
        const userId = adminUser.pk;
        const sessionId = body.sessionId;
        const session = await this.adminforth.resource(this.pluginOptions.sessionResource.resourceId).get(
          [Filters.EQ(this.pluginOptions.sessionResource.idField, sessionId)]
        );
        if (!session) {
          return {
            error: 'Session not found'
          };
        }
        if (session[this.pluginOptions.sessionResource.askerIdField] !== userId) {
          return {
            error: 'Unauthorized'
          };
        }
        const turns = await this.getSessionTurns(sessionId);
        const messagesToReturn = [];
        for (const turn of turns) {
          messagesToReturn.push({
            text: turn.prompt,
            role: 'user',
          });
          if (turn.response !== "not_finished") {
            messagesToReturn.push({
              text: turn.response,
              role: 'assistant',
            });
          }
        }
        const sessionToReturn = {
          sessionId: session[this.pluginOptions.sessionResource.idField],
          title: session[this.pluginOptions.sessionResource.titleField],
          timestamp: session[this.pluginOptions.sessionResource.createdAtField],
          messages: messagesToReturn
        }
        return {
          session: sessionToReturn
        }
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/create-session`,
      handler: async ({body, adminUser }) => {
        const triggerMessage = body.triggerMessage;
        const userId = adminUser.pk;
        const title = triggerMessage ? (triggerMessage.length > 40 ? triggerMessage.slice(0, 40) : triggerMessage) : 'New Session';
        const newSession = {
          [this.pluginOptions.sessionResource.idField]: randomUUID(),
          [this.pluginOptions.sessionResource.titleField]: title,
          [this.pluginOptions.sessionResource.askerIdField]: userId,
        };
        await this.adminforth.resource(this.pluginOptions.sessionResource.resourceId).create(newSession);
        return {
          sessionId: newSession[this.pluginOptions.sessionResource.idField],
          title: newSession[this.pluginOptions.sessionResource.titleField],
          timestamp: newSession[this.pluginOptions.sessionResource.createdAtField],
          messages: []
        };
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/delete-session`,
      handler: async ({body, adminUser }) => {
        const sessionId = body.sessionId;
        const userId = adminUser.pk;
        const session = await this.adminforth.resource(this.pluginOptions.sessionResource.resourceId).get(
          [Filters.EQ(this.pluginOptions.sessionResource.idField, sessionId)]
        );
        if (!session) {
          return {
            error: 'Session not found'
          };
        }
        if (session[this.pluginOptions.sessionResource.askerIdField] !== userId) {
          return {
            error: 'Unauthorized'
          };
        }
        await this.adminforth.resource(this.pluginOptions.sessionResource.resourceId).delete(sessionId);
        const turns = await this.adminforth.resource(this.pluginOptions.turnResource.resourceId).list(
          [Filters.EQ(this.pluginOptions.turnResource.sessionIdField, sessionId)]
        );
        for (const turn of turns) {
          await this.adminforth.resource(this.pluginOptions.turnResource.resourceId).delete(turn[this.pluginOptions.turnResource.idField]);
        }
        return {
          ok: true
        };
      }
    }),
    server.endpoint({
      method: 'POST',
      path: `/agent/add-system-message-to-turns`,
      handler: async ({body, adminUser, _raw_express_req }) => {
        const sessionId = body.sessionId;
        const systemMessage = body.systemMessage;
        await this.createNewTurn(sessionId, systemMessage);
        return {
          ok: true
        }
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/add-system-message-to-turns`,
      handler: async ({body, adminUser, _raw_express_req }) => {
        const sessionId = body.sessionId;
        const systemMessage = body.systemMessage;
        await this.createNewTurn(sessionId, systemMessage);
        return {
          ok: true
        }
      }
    }),
    server.endpoint({
      method: 'POST',
      path: `/agent/transcript-audio`,
      target: 'upload',
      handler: async ({body, adminUser, _raw_express_req }) => {
        const audio = (_raw_express_req as any).file;
        if (!audio) {
          return {
            ok: false,
            error: 'No audio provided'
          };
        } else {
          return {
            ok: true,
            transcript: 'Transcription example: audio transcription is not implemented yet'
          };
        }
      }
    });
  }
}
