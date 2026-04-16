import { AdminForthPlugin, logger } from "adminforth";
import type {
  AdminForthResource,
  AdminUser,
  IAdminForth,
  IHttpServer,
} from "adminforth";
import type { PluginOptions } from './types.js';
import { randomUUID } from 'crypto';
import { HumanMessage, SystemMessage } from "langchain";
import { createAgentChatModel, callAgent } from "./agent/simpleAgent.js";
import {
  prepareApiBasedTools as buildApiBasedTools,
  serializeUnknownError,
  serializeApiBasedTool,
} from './apiBasedTools.js';
import type { ApiBasedTool } from './apiBasedTools.js';
import { Filters, Sorts } from 'adminforth';

const AGENT_SYSTEM_MESSAGE = new SystemMessage(
  "You are an AdminForth assistant. Help the current admin user with the active admin panel context and answer concisely."
);

export default class  extends AdminForthPlugin {
  options: PluginOptions;
  apiBasedTools: Record<string, ApiBasedTool> = {};
  private apiBasedToolsPrepared = false;

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
    if (this.apiBasedToolsPrepared) {
      return;
    }

    this.prepareApiBasedTools(adminforth);
    void Promise.resolve().then(() => this.logPreparedApiToolProbe(adminforth));
  }

  prepareApiBasedTools(adminforth: IAdminForth) {
    this.apiBasedTools = buildApiBasedTools(adminforth);
    this.apiBasedToolsPrepared = true;
  }

  private async logPreparedApiToolProbe(adminforth: IAdminForth) {
    const getResourceTool = this.apiBasedTools['get_resource'];
    logger.info({ tool: serializeApiBasedTool(getResourceTool) }, "apiBasedTools['get_resource']");

    try {

      const adminUserResource = adminforth.config.resources.find((resource) => resource.resourceId === 'adminuser');

      const [dbUser] = await adminforth.resource('adminuser').list([], 1);

      const primaryKeyName = adminUserResource.columns.find((column) => column.primaryKey)!.name;
      const usernameField = adminforth.config.auth?.usernameField ?? primaryKeyName;
      const adminUser: AdminUser = {
        pk: `${dbUser[primaryKeyName]}`,
        username: `${dbUser[usernameField] ?? dbUser[primaryKeyName]}`,
        dbUser,
      };

      const result = await getResourceTool.call({
        adminUser,
        inputs: {
          resourceId: 'adminuser',
        },
      });

      logger.info(`apiBasedTools['get_resource'].call({ resourceId: 'adminuser' })\n${result}`);
    } catch (error) {
      logger.error({
        error: serializeUnknownError(error),
      }, 'Failed to run apiBasedTools probe');
    }
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

          const stream = await callAgent({
            name: `adminforth-agent-${this.pluginInstanceId}`,
            model,
            summaryModel,
            messages: [
              AGENT_SYSTEM_MESSAGE,
              new HumanMessage(prompt),
            ],
            adminUser,
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
          logger.error(`Agent response streaming failed: ${error}`);
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
        const sessions = await this.adminforth.resource(this.pluginOptions.sessionResource.resource_id).list(
          [Filters.EQ(this.pluginOptions.sessionResource.asker_id_field, userId)], undefined, undefined, [Sorts.DESC(this.pluginOptions.sessionResource.created_at_field)]
        );
        const sessionsToReturn = [];
        for (const session of sessions) {
         sessionsToReturn.push({
          sessionId: session[this.pluginOptions.sessionResource.id_field],
          title: session[this.pluginOptions.sessionResource.title_field],
          timestamp: session[this.pluginOptions.sessionResource.created_at_field],
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
        const session = await this.adminforth.resource(this.pluginOptions.sessionResource.resource_id).get(
          [Filters.EQ(this.pluginOptions.sessionResource.id_field, sessionId)]
        );
        if (!session) {
          return {
            error: 'Session not found'
          };
        }
        if (session[this.pluginOptions.sessionResource.asker_id_field] !== userId) {
          return {
            error: 'Unauthorized'
          };
        }
        const sessionToReturn = {
          sessionId: session[this.pluginOptions.sessionResource.id_field],
          title: session[this.pluginOptions.sessionResource.title_field],
          timestamp: session[this.pluginOptions.sessionResource.created_at_field],
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
          [this.pluginOptions.sessionResource.id_field]: randomUUID(),
          [this.pluginOptions.sessionResource.title_field]: title,
          [this.pluginOptions.sessionResource.asker_id_field]: userId,
        };
        await this.adminforth.resource(this.pluginOptions.sessionResource.resource_id).create(newSession);
        return {
          sessionId: newSession[this.pluginOptions.sessionResource.id_field],
          title: newSession[this.pluginOptions.sessionResource.title_field],
          timestamp: newSession[this.pluginOptions.sessionResource.created_at_field],
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
        const session = await this.adminforth.resource(this.pluginOptions.sessionResource.resource_id).get(
          [Filters.EQ(this.pluginOptions.sessionResource.id_field, sessionId)]
        );
        if (!session) {
          return {
            error: 'Session not found'
          };
        }
        if (session[this.pluginOptions.sessionResource.asker_id_field] !== userId) {
          return {
            error: 'Unauthorized'
          };
        }
        await this.adminforth.resource(this.pluginOptions.sessionResource.resource_id).delete(sessionId);
        return {
          ok: true
        };
      }
    });
  }
}
