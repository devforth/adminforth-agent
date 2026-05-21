import type {
  IAdminForthEndpointHandlerInput,
  IHttpServer,
} from "adminforth";
import type { ChatSurfaceAdapterWithConnectAction, ChatSurfaceEndpointsContext } from "./context.js";

const DEFAULT_ADMIN_USER_EXTERNAL_USER_ID_FIELD = "externalUserId";

export function setupChatSurfaceEndpoints(ctx: ChatSurfaceEndpointsContext, server: IHttpServer) {
  if (ctx.getChatSurfaceConnectActionAdapters().length) {
    server.endpoint({
      method: "POST",
      path: "/agent/surfaces/connectable",
      handler: async ({ adminUser }) => {
        const externalUserIdField = ctx.options.chatExternalIdsField ?? DEFAULT_ADMIN_USER_EXTERNAL_USER_ID_FIELD;
        const externalIds = adminUser!.dbUser[externalUserIdField] ?? {};

        return {
          surfaces: ctx.getChatSurfaceConnectActionAdapters().map((adapter) => ({
            name: adapter.name,
            externalUserId: externalIds[adapter.name] ?? null,
          })),
        };
      },
    });
  }

  for (const adapter of ctx.options.chatSurfaceAdapters ?? []) {
    const connectActionAdapter = adapter as ChatSurfaceAdapterWithConnectAction;
    if (connectActionAdapter.createConnectAction) {
      server.endpoint({
        method: "POST",
        path: `/agent/surface/${adapter.name}/connect-action`,
        handler: async ({ adminUser }) => {
          const token = ctx.createChatSurfaceLinkToken(adapter.name, adminUser!);
          const action = await connectActionAdapter.createConnectAction!({ token });

          return {
            action,
          };
        },
      });
      server.endpoint({
        method: "POST",
        path: `/agent/surface/${adapter.name}/disconnect`,
        handler: async ({ adminUser }) => {
          const externalUserIdField = ctx.options.chatExternalIdsField ?? DEFAULT_ADMIN_USER_EXTERNAL_USER_ID_FIELD;
          const externalIds = {
            ...(adminUser!.dbUser[externalUserIdField] ?? {}),
          };

          delete externalIds[adapter.name];

          await ctx.adminforth.resource(ctx.adminforth.config.auth!.usersResourceId!).update(adminUser!.pk, {
            [externalUserIdField]: externalIds,
          });

          return {
            ok: true,
          };
        },
      });
    }

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
