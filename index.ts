import { AdminForthPlugin } from "adminforth";
import type { IAdminForth, IHttpServer, AdminForthResourcePages, AdminForthResourceColumn, AdminForthDataTypes, AdminForthResource } from "adminforth";
import type { PluginOptions } from './types.js';
import { randomUUID } from 'crypto';


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
      handler: async ({body, _raw_express_res }) => {
        const res = _raw_express_res;
        const messageId = randomUUID();
        const textId = randomUUID();
        const prompt = body.message;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'x-vercel-ai-ui-message-stream': 'v1',
        });

        const send = (obj) => {
          res.write(`data: ${JSON.stringify(obj)}\n\n`);
        };

        send({
          type: 'start',
          messageId,
        });

        send({
          type: 'text-start',
          id: textId,
        });
        const response = await this.options.adapter.complete(prompt, this.options.maxTokens || 1000, undefined, "low", (chunk, event) => {
            if (event.type === 'reasoning') {
              send({
                type: 'reasoning',
                id: textId,
                delta: chunk,
                reasoningEvent: event,
              });
            } else {
              send({
                type: 'text-delta',
                id: textId,
                delta: chunk,
              });
            } 
        });
        if (response.error) {
          console.error('Error from adapter:', response.error);
        }
        send({
          type: 'text-end',
          id: textId,
        });

        send({
          type: 'finish',
        });

        res.write(`data: [DONE]\n\n`);
      }
    });
  }

}