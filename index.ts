import type {
  AdminForthResource,
  AdminUser,
  IAdminForth,
  IHttpServer
} from "adminforth";

import { AdminForthPlugin, logger, Filters, Sorts } from "adminforth";

import type { PluginOptions } from './types.js';
import { randomUUID } from 'crypto';
import { HumanMessage, SystemMessage } from "langchain";
import { createAgentChatModel, callAgent } from "./agent/simpleAgent.js";
import {
  prepareApiBasedTools as buildApiBasedTools,
} from './apiBasedTools.js';
import type { ApiBasedTool } from './apiBasedTools.js';
import {
  buildAgentSystemPrompt,
  DEFAULT_AGENT_SYSTEM_PROMPT,
} from "./agent/systemPrompt.js";
import { ALWAYS_AVAILABLE_API_TOOL_NAMES } from "./agent/tools/constants.js";

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
  agentSystemPromptPromise = Promise.resolve(DEFAULT_AGENT_SYSTEM_PROMPT);

  constructor(options: PluginOptions) {
    super(options, import.meta.url);
    this.options = options;
    this.shouldHaveSingleInstancePerWholeApp = () => false;
  }

  async modifyResourceConfig(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    super.modifyResourceConfig(adminforth, resourceConfig);
    if (!this.adminforth.config.customization.globalInjections.header) {
      this.adminforth.config.customization.globalInjections.header = [];
    }
    this.adminforth.config.customization.globalInjections.header.push({
      file: this.componentPath("ChatSurface.vue"),
      meta: {
        pluginInstanceId: this.pluginInstanceId,
      }
    });

    if (!this.pluginOptions.completionAdapter) {
      throw new Error("CompletionAdapter is required for AdminForthAgentPlugin");
    }
    if (!this.pluginOptions.sessionResource) {
      throw new Error("sessionResource is required for AdminForthAgentPlugin");
    }
  }
  
  validateConfigAfterDiscover(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    this.apiBasedTools = buildApiBasedTools(adminforth);
    for (const toolName of ALWAYS_AVAILABLE_API_TOOL_NAMES) {
      assertRequiredApiTool(this.apiBasedTools, toolName);
    }
    assertRequiredApiTool(this.apiBasedTools, "update_record");
    this.agentSystemPromptPromise = buildAgentSystemPrompt(adminforth);
  }

  instanceUniqueRepresentation(pluginOptions: any) : string {
    return `single`;
  }

  setupEndpoints(server: IHttpServer) {
    server.endpoint({
      method: 'POST',
      path: `/agent/response`,
      handler: async ({ body, adminUser, _raw_express_res }) => {
        const res = _raw_express_res;
        const messageId = randomUUID();
        const prompt = body.message;
        const sessionId = body.sessionId || adminUser?.pk || adminUser?.username || 'default';
        const turnId = body.turnId || randomUUID();
        let isStreamClosed = false;

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

          const maxTokens = this.options.maxTokens ?? 1000;
          const reasoning = this.options.reasoning ?? 'low';
          const summaryReasoning = 'low';

          const model = createAgentChatModel({
            adapter: this.options.completionAdapter,
            maxTokens,
            reasoning,
          });

          const summaryModel = createAgentChatModel({
            adapter: this.options.completionAdapter,
            maxTokens,
            reasoning: summaryReasoning,
          });
          const systemPrompt = await this.agentSystemPromptPromise;
          const stream = await callAgent({
            name: `adminforth-agent-${this.pluginInstanceId}`,
            model,
            summaryModel,
            messages: [
              new SystemMessage(systemPrompt),
              new HumanMessage(prompt),
            ],
            adminUser,
            apiBasedTools: this.apiBasedTools,
            customComponentsDir: this.adminforth.config.customization.customComponentsDir,
            sessionId,
            turnId,
          });

          for await (const rawChunk of stream as AsyncIterable<[any, any]>) {
            const [msgChunk, metadata] = rawChunk;

            const nodeName =
              typeof metadata?.langgraph_node === "string"
                ? metadata.langgraph_node
                : "";

            if (nodeName && !["model", "model_request"].includes(nodeName)) {
              continue;
            }

            const blocks = Array.isArray(msgChunk?.contentBlocks)
              ? msgChunk.contentBlocks
              : Array.isArray(msgChunk?.content)
                ? msgChunk.content
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
              send({
                type: 'text-delta',
                id: textId,
                delta: textDelta,
              });
            }
          }
        } catch (error) {
          logger.error(`Agent response streaming failed:\n${formatAgentError(error)}`);
          const textId = startBlock('text');
          send({
            type: 'text-delta',
            id: textId,
            delta: 'Agent response failed. Check server logs for details.',
          });
        }
        endStream();
        return null;
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/get-sessions`,
      handler: async ({body, adminUser }) => {
        const userId = adminUser.pk;
        const sessions = await this.adminforth.resource(this.pluginOptions.sessionResource.resourceId).list(
          [Filters.EQ(this.pluginOptions.sessionResource.askerIdField, userId)], undefined, undefined, [Sorts.DESC(this.pluginOptions.sessionResource.createdAtField)]
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
        const sessionToReturn = {
          sessionId: session[this.pluginOptions.sessionResource.idField],
          title: session[this.pluginOptions.sessionResource.titleField],
          timestamp: session[this.pluginOptions.sessionResource.createdAtField],
          messages: []
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
        const title = triggerMessage ? (triggerMessage.length > 40 ? triggerMessage.slice(0, 40) + '...' : triggerMessage) : 'New Session';
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
        return {
          ok: true
        };
      }
    });
  }
}
