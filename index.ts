import { AdminForthPlugin, logger } from "adminforth";
import type { IAdminForth, IHttpServer, AdminForthResource } from "adminforth";
import type { PluginOptions } from './types.js';
import { randomUUID } from 'crypto';
import { HumanMessage, SystemMessage } from "langchain";
import { createAgentChatModel, callAgent } from "./agent/simpleAgent.js";

const AGENT_SYSTEM_MESSAGE = new SystemMessage(
  "You are an AdminForth assistant. Help the current admin user with the active admin panel context and answer concisely."
);

export default class  extends AdminForthPlugin {
  options: PluginOptions;

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
  }
  
  validateConfigAfterDiscover(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    // optional method where you can safely check field types after database discovery was performed
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

          for await (const chunk of stream) {
            if (!Array.isArray(chunk) || chunk.length < 2) {
              continue;
            }
            const [step, content] = Object.entries(chunk)[0];
            const nodeName = typeof content?.langgraph_node === 'string' ? content.langgraph_node : '';
            if (nodeName && nodeName !== 'model') {
              continue;
            }

            // if (reasoning) {
            //   const reasoningId = startBlock('reasoning');
            //   send({
            //     type: 'reasoning-delta',
            //     id: reasoningId,
            //     delta: reasoning,
            //   });
            // }
            if (content?.text) {
              const textId = startBlock('text');
              send({
                type: 'text-delta',
                id: textId,
                delta: content.text,
              });
            }
          }
        } catch (error) {
          logger.error('Agent response streaming failed:', error);
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
  }

}
