import type {
  AdminUser,
  ChatSurfaceAdapter,
  ChatSurfaceEventSink,
  ChatSurfaceIncomingMessage,
  IAdminForth,
} from "adminforth";
import { Filters } from "adminforth";
import { randomUUID } from "crypto";
import type { AgentEventEmitter } from "./agentEvents.js";
import type { HandleTurnInput } from "./agentTurnService.js";
import type { PluginOptions } from "./types.js";
import type { AgentSessionStore } from "./sessionStore.js";

type ChatSurfaceConnectAction = {
  type: "url";
  label: string;
  url: string;
};

export type ChatSurfaceAdapterWithConnectAction = ChatSurfaceAdapter & {
  createConnectAction?(input: {
    token: string;
  }): ChatSurfaceConnectAction | Promise<ChatSurfaceConnectAction>;
};

type ChatSurfaceLinkTokenPayload = {
  surface: string;
  adminUserId: AdminUser["pk"];
  expiresAt: number;
};

const DEFAULT_ADMIN_USER_EXTERNAL_USER_ID_FIELD = "externalUserId";
const CHAT_SURFACE_LINK_TOKEN_TTL_MS = 60 * 1000;

export class ChatSurfaceService {
  private linkTokens = new Map<string, ChatSurfaceLinkTokenPayload>();

  constructor(
    private getAdminforth: () => IAdminForth,
    private options: PluginOptions,
    private sessionStore: AgentSessionStore,
    private handleTurn: (input: HandleTurnInput) => Promise<unknown>,
  ) {}

  getConnectActionAdapters() {
    return (this.options.chatSurfaceAdapters ?? [])
      .map((adapter) => adapter as ChatSurfaceAdapterWithConnectAction)
      .filter((adapter) => adapter.createConnectAction);
  }

  createLinkToken(surface: string, adminUser: AdminUser) {
    for (const [token, payload] of this.linkTokens) {
      if (payload.expiresAt <= Date.now()) {
        this.linkTokens.delete(token);
      }
    }

    const token = randomUUID();
    this.linkTokens.set(token, {
      surface,
      adminUserId: adminUser.pk,
      expiresAt: Date.now() + CHAT_SURFACE_LINK_TOKEN_TTL_MS,
    });

    return token;
  }

  private consumeLinkToken(surface: string, token: string) {
    const payload = this.linkTokens.get(token);
    this.linkTokens.delete(token);

    if (!payload || payload.surface !== surface || payload.expiresAt <= Date.now()) {
      return null;
    }

    return payload;
  }

  private createEventEmitter(sink: ChatSurfaceEventSink): AgentEventEmitter {
    return async (event) => {
      if (event.type === "text-delta") {
        await sink.emit({
          type: "text_delta",
          delta: event.delta,
        });
        return;
      }

      if (event.type === "response") {
        await sink.emit({
          type: "done",
          text: event.text,
        });
        return;
      }

      if (event.type === "error") {
        await sink.emit({
          type: "error",
          message: event.error,
        });
      }
    };
  }

  private async handleLink(
    incoming: ChatSurfaceIncomingMessage,
    sink: ChatSurfaceEventSink,
  ) {
    if (typeof incoming.metadata?.startPayload !== "string") {
      return false;
    }

    const payload = this.consumeLinkToken(incoming.surface, incoming.metadata.startPayload);
    if (!payload) {
      await sink.emit({
        type: "error",
        message: "This chat surface link is expired or invalid. Please start linking again from AdminForth.",
      });
      return true;
    }
    const externalUserIdField = this.options.chatExternalIdsField ?? DEFAULT_ADMIN_USER_EXTERNAL_USER_ID_FIELD;
    const adminforth = this.getAdminforth();
    const authResourceId = adminforth.config.auth!.usersResourceId!;
    const authResource = adminforth.config.resources.find((resource) => resource.resourceId === authResourceId)!;
    const primaryKeyField = authResource.columns.find((column) => column.primaryKey)!.name!;
    const adminUserRecord = await adminforth.resource(authResourceId).get([
      Filters.EQ(primaryKeyField, payload.adminUserId),
    ]);

    await adminforth.resource(authResourceId).update(payload.adminUserId, {
      [externalUserIdField]: {
        ...(adminUserRecord[externalUserIdField] ?? {}),
        [incoming.surface]: incoming.externalUserId,
      },
    });
    await sink.emit({
      type: "done",
      text: `${incoming.surface} account connected to AdminForth.`,
    });

    return true;
  }

  async handleMessage(
    adapter: ChatSurfaceAdapter,
    incoming: ChatSurfaceIncomingMessage,
    sink: ChatSurfaceEventSink,
  ) {
    if (await this.handleLink(incoming, sink)) {
      return;
    }

    const adminforth = this.getAdminforth();
    const authResourceId = adminforth.config.auth!.usersResourceId!;
    const authResource = adminforth.config.resources.find((resource) => resource.resourceId === authResourceId)!;
    const primaryKeyField = authResource.columns.find((column) => column.primaryKey)!.name!;
    const externalUserIdField = this.options.chatExternalIdsField ?? DEFAULT_ADMIN_USER_EXTERNAL_USER_ID_FIELD;
    const adminUserRecord = (
      await adminforth.resource(authResourceId).list(Filters.IS_NOT_EMPTY(externalUserIdField))
    ).find((user) => user[externalUserIdField]?.[adapter.name] === incoming.externalUserId);

    if (!adminUserRecord) {
      await sink.emit({
        type: "error",
        message: "This chat account is not authorized to use AdminForth Agent.",
      });
      return;
    }

    const adminUser = {
      pk: adminUserRecord[primaryKeyField],
      username: adminUserRecord[adminforth.config.auth!.usernameField],
      dbUser: adminUserRecord,
    };

    await this.handleTurn({
      prompt: incoming.prompt,
      sessionId: await this.sessionStore.getOrCreateChatSurfaceSession(incoming, adminUser),
      modeName: incoming.modeName,
      userTimeZone: incoming.userTimeZone ?? "UTC",
      adminUser,
      emit: this.createEventEmitter(sink),
      failureLogMessage: `Agent ${incoming.surface} surface response failed`,
      abortLogMessage: `Agent ${incoming.surface} surface response aborted`,
    });
  }
}
