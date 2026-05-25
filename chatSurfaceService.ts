import type {
  AdminUser,
  ChatSurfaceAdapter,
  ChatSurfaceEventSink,
  ChatSurfaceIncomingMessage,
  IAdminForth,
} from "adminforth";
import { Filters, logger } from "adminforth";
import type { AgentEventEmitter } from "./agentEvents.js";
import type {
  HandleTurnInput,
  RunAndPersistAgentResponseInput,
  RunAndPersistAgentResponseResult,
} from "./agentTurnService.js";
import { getErrorMessage, isAbortError } from "./errors.js";
import type { AgentSessionStore } from "./sessionStore.js";
import { sanitizeSpeechText } from "./sanitizeSpeechText.js";
import type { PluginOptions } from "./types.js";

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

export class ChatSurfaceService {
  constructor(
    private getAdminforth: () => IAdminForth,
    private options: PluginOptions,
    private sessionStore: AgentSessionStore,
    private handleTurn: (input: HandleTurnInput) => Promise<unknown>,
    private runAndPersistAgentResponse: (
      input: RunAndPersistAgentResponseInput,
    ) => Promise<RunAndPersistAgentResponseResult>,
  ) {}

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

    await sink.emit({
      type: "done",
      text: `Open AdminForth and connect your ${incoming.surface} account from Connected Accounts settings.`,
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

  private async getAdminUserRecordForChatSurface(
    adapter: ChatSurfaceAdapter,
    incoming: ChatSurfaceIncomingMessage,
  ) {
    const adminforth = this.getAdminforth();
    const authResourceId = adminforth.config.auth!.usersResourceId!;
    const externalIdentityResource = this.options.chatExternalIdentityResource;
    if (!externalIdentityResource) {
      return null;
    }

    const surfaceIdentityConfig = externalIdentityResource.surfaces[adapter.name];
    if (!surfaceIdentityConfig) {
      return null;
    }

    const providerField = externalIdentityResource.providerField ?? 'provider';
    const subjectField = externalIdentityResource.subjectField ?? 'subject';
    const adminUserIdField = externalIdentityResource.adminUserIdField ?? 'adminUserId';
    const externalUserIdField = externalIdentityResource.externalUserIdField ?? 'externalUserId';
    const identityFilters = [
      Filters.EQ(providerField, surfaceIdentityConfig.provider),
      Filters.EQ(externalUserIdField, incoming.externalUserId),
    ];
    const identities = await adminforth.resource(externalIdentityResource.resourceId).list(identityFilters);
    const identity = identities.find((identity) => {
      if (String(identity[externalUserIdField]) === incoming.externalUserId) {
        return true;
      }

      if (String(identity[subjectField]) === incoming.externalUserId) {
        return true;
      }

      return false;
    });

    if (!identity) {
      return null;
    }

    const authResource = adminforth.config.resources.find((resource) => resource.resourceId === authResourceId)!;
    const primaryKeyField = authResource.columns.find((column) => column.primaryKey)!.name!;
    return adminforth.resource(authResourceId).get([
      Filters.EQ(primaryKeyField, identity[adminUserIdField]),
    ]);
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
    const adminUserRecord = await this.getAdminUserRecordForChatSurface(adapter, incoming);

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
