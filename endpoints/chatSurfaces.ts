import type {
  IAdminForthEndpointHandlerInput,
  IHttpServer,
} from "adminforth";
import type { ChatSurfaceEndpointsContext } from "./context.js";

function getHeaderValue(headers: Record<string, unknown>, name: string) {
  const value = headers[name] ?? headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" ? value : undefined;
}

function getRequestOrigin(input: IAdminForthEndpointHandlerInput) {
  const forwardedProto = getHeaderValue(input.headers, "x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = getHeaderValue(input.headers, "x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost ?? getHeaderValue(input.headers, "host");

  if (!host) {
    return undefined;
  }

  const proto = forwardedProto
    ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return `${proto}://${host}`;
}

export function setupChatSurfaceEndpoints(ctx: ChatSurfaceEndpointsContext, server: IHttpServer) {
  for (const adapter of ctx.options.chatSurfaceAdapters ?? []) {
    server.endpoint({
      method: "POST",
      noAuth: true,
      path: `/agent/surface/${adapter.name}/webhook`,
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
          adminPublicOrigin: getRequestOrigin(endpointInput),
        };

        const sink = await adapter.createEventSink(surfaceContext, incoming);

        try {
          await ctx.handleChatSurfaceMessage(adapter, incoming, sink);
        } finally {
          await sink.close?.();
        }

        return { ok: true };
      },
    });
  }
}
