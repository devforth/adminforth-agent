import type {
  IAdminForthEndpointHandlerInput,
  IHttpServer,
} from "adminforth";
import type { ChatSurfaceEndpointsContext } from "./context.js";
import { getRequestOrigin } from "./requestOrigin.js";

export function setupChatSurfaceEndpoints(ctx: ChatSurfaceEndpointsContext, server: IHttpServer) {
  for (const adapter of ctx.options.chatSurfaceAdapters ?? []) {
    server.endpoint({
      method: "POST",
      noAuth: true,
      path: `/agent/surface/${adapter.name}/webhook`,
      agent: {
        hiddenFromAgents: true,
      },
      handler: async (endpointInput: IAdminForthEndpointHandlerInput) => {
        const surfaceContext = {
          body: endpointInput.body,
          headers: endpointInput.headers,
          abortSignal: endpointInput.abortSignal,
          rawRequest: endpointInput._raw_express_req,
          rawResponse: endpointInput._raw_express_res,
        };

        const incoming = await adapter.parseIncomingMessage(surfaceContext);
        if (!incoming) return { ok: true };
        incoming.metadata = {
          ...incoming.metadata,
          adminPublicOrigin: getRequestOrigin(endpointInput.headers),
        };

        const sink = await adapter.createEventSink(surfaceContext, incoming);

        try {
          await ctx.handleChatSurfaceMessage(adapter, incoming, sink, endpointInput);
        } finally {
          await sink.close?.();
        }

        return { ok: true };
      },
    });
  }
}
