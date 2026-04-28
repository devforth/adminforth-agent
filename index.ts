import type {
  AdminForthResource,
  IAdminForth,
  IHttpServer
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
  type AgentModeCompletionAdapter,
} from "./agent/simpleAgent.js";
import { AdminForthCheckpointSaver } from "./agent/checkpointer.js";
import { createSequenceDebugCollector } from "./agent/middleware/sequenceDebug.js";
import {
  prepareApiBasedTools as buildApiBasedTools,
} from './apiBasedTools.js';
import type { ApiBasedTool } from './apiBasedTools.js';
import {
  appendCustomSystemPrompt,
  buildAgentSystemPrompt,
  DEFAULT_AGENT_SYSTEM_PROMPT,
} from "./agent/systemPrompt.js";
import { ALWAYS_AVAILABLE_API_TOOL_NAMES } from "./agent/tools/index.js";
import type { ToolCallEvent } from "./agent/toolCallEvents.js";

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
  pluginsScope: "resource" | "global" = "global";
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

  constructor(options: PluginOptions) {
    super(options, import.meta.url);
    this.options = options;
    this.agentSystemPromptPromise = Promise.resolve(
      appendCustomSystemPrompt(DEFAULT_AGENT_SYSTEM_PROMPT, this.options.systemPrompt),
    );
    this.shouldHaveSingleInstancePerWholeApp = () => false;
  }

  async modifyGlobalConfig(adminforth: IAdminForth) {
    super.modifyGlobalConfig(adminforth);
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
      }
    });
    if (!this.pluginOptions.sessionResource) {
      throw new Error("sessionResource is required for AdminForthAgentPlugin");
    }
  }
  
  validateConfigAfterDiscover(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    this.agentSystemPromptPromise = buildAgentSystemPrompt(adminforth)
      .then((systemPrompt) => appendCustomSystemPrompt(systemPrompt, this.options.systemPrompt));
  }

  instanceUniqueRepresentation(pluginOptions: any) : string {
    return `single`;
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
      handler: async ({ body, query, headers, cookies, adminUser, response, requestUrl, _raw_express_res }) => {
        const res = _raw_express_res;
        const messageId = randomUUID();
        const prompt = body.message;
        const userTimeZone = (body.timeZone as string | undefined) ?? 'UTC';
        const sessionId = body.sessionId || adminUser?.pk || adminUser?.username || 'default';
        const turnId = await this.createNewTurn(sessionId, prompt);
        await this.updateSessionDate(sessionId);
        let fullResponse = "";
        let isStreamClosed = false;
        const sequenceDebugCollector = createSequenceDebugCollector();

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'x-vercel-ai-ui-message-stream': 'v1',
        });

        const send = (obj: unknown) => {
          if (isStreamClosed || res.writableEnded || res.destroyed) {
            return;
          }
          res.write(`data: ${JSON.stringify(obj)}\n\n`);
        };

        const emitToolCallEvent = (event: ToolCallEvent) => {
          if (event.phase === "start") {
            endActiveBlock();
          }

          sequenceDebugCollector.handleToolCallEvent(event);

          send({
            type: "data-tool-call",
            data: event,
          });
        };

        let activeBlock: { type: 'text' | 'reasoning'; id: string } | null = null;

        const endActiveBlock = () => {
          if (!activeBlock) {
            return;
          }

          send({
            type: `${activeBlock.type}-end`,
            id: activeBlock.id,
          });

          activeBlock = null;
        };

        const startBlock = (type: 'text' | 'reasoning') => {
          if (activeBlock?.type === type) {
            return activeBlock.id;
          }

          endActiveBlock();

          const id = randomUUID();
          activeBlock = { type, id };

          send({
            type: `${type}-start`,
            id,
          });

          return id;
        };

        const endStream = () => {
          if (isStreamClosed || res.writableEnded || res.destroyed) {
            return;
          }
          endActiveBlock();

          send({
            type: 'finish',
          });

          res.write(`data: [DONE]\n\n`);
          isStreamClosed = true;
          res.end();
        }

        try {
          send({
            type: 'start',
            messageId,
          });

          const maxTokens = this.options.maxTokens ?? 10000;
          const selectedMode = this.options.modes.find((mode) => mode.name === body.mode) ?? this.options.modes[0];
          const { model, summaryModel, modelMiddleware } =
            await this.getModeModels(selectedMode, maxTokens);
          const systemPrompt = await this.agentSystemPromptPromise;
          const apiBasedTools = buildApiBasedTools(this.adminforth);
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
              new HumanMessage(prompt),
            ],
            adminUser,
            adminforth: this.adminforth,
            apiBasedTools,
            customComponentsDir: this.adminforth.config.customization.customComponentsDir,
            sessionId,
            turnId,
            httpExtra: {
              body,
              query,
              headers,
              cookies,
              requestUrl,
              response,
            },
            userTimeZone,
            emitToolCallEvent,
            sequenceDebugSink: sequenceDebugCollector,
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
              const reasoningId = startBlock('reasoning');
                send({
                  type: 'reasoning-delta',
                  id: reasoningId,
                  delta: reasoningDelta,
                });
            }

            if (textDelta) {
              const textId = startBlock('text');
              fullResponse += textDelta;
              send({
                type: 'text-delta',
                id: textId,
                delta: textDelta,
              });
            }
          }
        } catch (error) {
          logger.error(`Agent response streaming failed:\n${formatAgentError(error)}`);
          sequenceDebugCollector.flush();
          const textId = startBlock('text');
          send({
            type: 'text-delta',
            id: textId,
            delta: 'Agent response failed. Check server logs for details.',
          });
        }
        sequenceDebugCollector.flush();
        const turnUpdates: Record<string, unknown> = {
          [this.options.turnResource.responseField]: fullResponse,
        };

        if (this.options.turnResource.debugField) {
          turnUpdates[this.options.turnResource.debugField] = sequenceDebugCollector.getHistory();
        }

        await this.updateTurn(turnId, turnUpdates);
        endStream();
        return null;
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
    });
  }
}
