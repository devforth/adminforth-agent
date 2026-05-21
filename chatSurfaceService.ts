import type {
  AdminUser,
  ChatSurfaceAdapter,
  ChatSurfaceEventSink,
  ChatSurfaceIncomingMessage,
  IAdminForth,
} from "adminforth";
import { Filters, logger } from "adminforth";
import { randomUUID } from "crypto";
import type { AgentEventEmitter } from "./agentEvents.js";
import type {
  HandleTurnInput,
  RunAndPersistAgentResponseInput,
  RunAndPersistAgentResponseResult,
} from "./agentTurnService.js";
import type { PluginOptions } from "./types.js";
import type { AgentSessionStore } from "./sessionStore.js";
import { getErrorMessage, isAbortError } from "./errors.js";
import { sanitizeSpeechText } from "./sanitizeSpeechText.js";

type ChatSurfaceConnectAction = {
  type: "url";
  label: string;
  url: string;
};

type ChatSurfaceIncomingMessageWithAudio = ChatSurfaceIncomingMessage & {
  audio?: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  };
};

type ChatSurfaceEventSinkWithAudio = ChatSurfaceEventSink & {
  emit(event: Parameters<ChatSurfaceEventSink["emit"]>[0] | {
    type: "audio";
    audio: Buffer;
    filename: string;
    mimeType: string;
  }): void | Promise<void>;
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
    private runAndPersistAgentResponse: (
      input: RunAndPersistAgentResponseInput,
    ) => Promise<RunAndPersistAgentResponseResult>,
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
    if (incoming.metadata?.isStartCommand !== true) {
      return false;
    }

    const externalUserIdField = this.options.chatExternalIdsField ?? DEFAULT_ADMIN_USER_EXTERNAL_USER_ID_FIELD;
    const adminforth = this.getAdminforth();
    const authResourceId = adminforth.config.auth!.usersResourceId!;
    const authResource = adminforth.config.resources.find((resource) => resource.resourceId === authResourceId)!;
    const primaryKeyField = authResource.columns.find((column) => column.primaryKey)!.name!;
    const linkedAdminUserRecord = (
      await adminforth.resource(authResourceId).list(Filters.IS_NOT_EMPTY(externalUserIdField))
    ).find((user) => user[externalUserIdField]?.[incoming.surface] === incoming.externalUserId);

    if (linkedAdminUserRecord) {
      await sink.emit({
        type: "done",
        text: `${incoming.surface} account is already connected to AdminForth.`,
      });
      return true;
    }

    if (typeof incoming.metadata?.startPayload !== "string") {
      await sink.emit({
        type: "done",
        text: `Open AdminForth and connect your ${incoming.surface} account from Chat Surfaces settings.`,
      });
      return true;
    }

    const payload = this.consumeLinkToken(incoming.surface, incoming.metadata.startPayload);
    if (!payload) {
      await sink.emit({
        type: "error",
        message: "This chat surface link is expired or invalid. Please start linking again from AdminForth.",
      });
      return true;
    }

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

  private async handleAudioMessage(
    incoming: ChatSurfaceIncomingMessageWithAudio,
    sink: ChatSurfaceEventSinkWithAudio,
    adminUser: AdminUser,
  ) {
    const audioAdapter = this.options.audioAdapter;
    if (!audioAdapter) {
      await sink.emit({
        type: "error",
        message: "Audio adapter is not configured for AdminForth Agent.",
      });
      return;
    }

    let transcription;

    try {
      transcription = await audioAdapter.transcribe({
        buffer: incoming.audio!.buffer,
        filename: incoming.audio!.filename,
        mimeType: incoming.audio!.mimeType,
        language: "auto",
      });
    } catch (error) {
      if (isAbortError(error)) {
        logger.info(`Agent ${incoming.surface} surface speech transcription aborted`);
        return;
      }

      logger.error(`Agent ${incoming.surface} surface speech transcription failed:\n${getErrorMessage(error)}`);
      await sink.emit({
        type: "error",
        message: "Speech transcription failed. Check server logs for details.",
      });
      return;
    }

    if (!transcription.text) {
      await sink.emit({
        type: "error",
        message: "Speech transcription is empty",
      });
      return;
    }

    const agentResponse = await this.handleAgentSurfaceResponse(
      incoming,
      sink,
      adminUser,
      transcription.text,
      { emitDone: false },
    );

    if (!agentResponse || agentResponse.aborted || agentResponse.failed) {
      return;
    }

    await sink.emit({
      type: "done",
      text: agentResponse.text,
    });

    try {
      const speech = await audioAdapter.synthesize({
        text: sanitizeSpeechText(agentResponse.text),
        stream: false,
        format: "opus",
      });

      await sink.emit({
        type: "audio",
        audio: speech.audio,
        filename: "agent-response.ogg",
        mimeType: speech.mimeType,
      });
    } catch (error) {
      if (isAbortError(error)) {
        logger.info(`Agent ${incoming.surface} surface speech synthesis aborted`);
        return;
      }

      logger.error(`Agent ${incoming.surface} surface speech synthesis failed:\n${getErrorMessage(error)}`);
      await sink.emit({
        type: "error",
        message: getErrorMessage(error),
      });
    }
  }

  private async handleAgentSurfaceResponse(
    incoming: ChatSurfaceIncomingMessage,
    sink: ChatSurfaceEventSink,
    adminUser: AdminUser,
    prompt: string,
    options?: { emitDone?: boolean },
  ) {
    const emitDone = options?.emitDone ?? true;
    const sessionId = await this.sessionStore.getOrCreateChatSurfaceSession(
      { ...incoming, prompt },
      adminUser,
    );

    if (emitDone) {
      await this.handleTurn({
        prompt,
        sessionId,
        modeName: incoming.modeName,
        userTimeZone: incoming.userTimeZone ?? "UTC",
        adminUser,
        emit: this.createEventEmitter(sink),
        failureLogMessage: `Agent ${incoming.surface} surface response failed`,
        abortLogMessage: `Agent ${incoming.surface} surface response aborted`,
      });
      return null;
    }

    const agentResponse = await this.runAndPersistAgentResponse({
      prompt,
      sessionId,
      modeName: incoming.modeName,
      userTimeZone: incoming.userTimeZone ?? "UTC",
      adminUser,
      emit: this.createEventEmitter(sink),
      failureLogMessage: `Agent ${incoming.surface} surface response failed`,
      abortLogMessage: `Agent ${incoming.surface} surface response aborted`,
    });

    if (agentResponse.failed) {
      await sink.emit({
        type: "error",
        message: agentResponse.text,
      });
    }

    return agentResponse;
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

    const incomingWithAudio = incoming as ChatSurfaceIncomingMessageWithAudio;
    if (incomingWithAudio.audio) {
      await this.handleAudioMessage(incomingWithAudio, sink as ChatSurfaceEventSinkWithAudio, adminUser);
      return;
    }

    await this.handleAgentSurfaceResponse(incoming, sink, adminUser, incoming.prompt);
  }
}
