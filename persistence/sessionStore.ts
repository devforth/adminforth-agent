import type { AdminUser, IAdminForth } from "adminforth";
import { Filters, Sorts } from "adminforth";
import { randomUUID } from "crypto";
import type { ChatSurfaceIncomingMessage } from "adminforth";
import type { PreviousUserMessage } from "../domain/languageDetect.js";
import type { PluginOptions } from "../types.js";

export const AGENT_SYSTEM_TURN_PROMPT = "__adminforth_system_message__";

export const STEER_PROMPT_MARKER = "__adminforth_steer__:";

export class AgentSessionStore {
  constructor(
    private getAdminforth: () => IAdminForth,
    private options: PluginOptions,
  ) {}

  async createNewTurn(sessionId: string, prompt: string, response?: string) {
    const turnId = randomUUID();
    const turnRecord = {
      [this.options.turnResource.idField]: turnId,
      [this.options.turnResource.sessionIdField]: sessionId,
      [this.options.turnResource.promptField]: prompt,
      [this.options.turnResource.responseField]: response ?? "not_finished",
    };
    const newTurn = await this.getAdminforth().resource(this.options.turnResource.resourceId).create(turnRecord);
    return newTurn.createdRecord[this.options.turnResource.idField];
  }

  async createSystemTurn(sessionId: string, systemMessage: string) {
    const turnId = randomUUID();
    const turnRecord = {
      [this.options.turnResource.idField]: turnId,
      [this.options.turnResource.sessionIdField]: sessionId,
      [this.options.turnResource.promptField]: AGENT_SYSTEM_TURN_PROMPT,
      [this.options.turnResource.responseField]: systemMessage,
    };
    const newTurn = await this.getAdminforth().resource(this.options.turnResource.resourceId).create(turnRecord);
    return newTurn.createdRecord[this.options.turnResource.idField];
  }

  /**
   * Append a mid-turn steer to the current (running) turn's prompt instead of creating a
   * new record. Targets the latest non-system turn so a steer attaches to the real
   * conversation turn, never an audio/system note.
   */
  async appendSteerToCurrentTurn(sessionId: string, steerText: string) {
    const turns = await this.getAdminforth().resource(this.options.turnResource.resourceId).list(
      [Filters.EQ(this.options.turnResource.sessionIdField, sessionId)],
      undefined,
      undefined,
      [Sorts.DESC(this.options.turnResource.createdAtField)]
    );
    const turn = turns.find(
      (candidate) => candidate[this.options.turnResource.promptField] !== AGENT_SYSTEM_TURN_PROMPT
    );
    if (!turn) {
      return;
    }
    const currentPrompt = turn[this.options.turnResource.promptField] ?? "";
    await this.getAdminforth().resource(this.options.turnResource.resourceId).update(
      turn[this.options.turnResource.idField],
      {
        [this.options.turnResource.promptField]: `${currentPrompt}${STEER_PROMPT_MARKER}${steerText}`,
      },
    );
  }

  async getSessionTurns(sessionId: string) {
    const turns = await this.getAdminforth().resource(this.options.turnResource.resourceId).list(
      [Filters.EQ(this.options.turnResource.sessionIdField, sessionId)],
      undefined,
      undefined,
      [Sorts.ASC(this.options.turnResource.createdAtField)]
    );
    return turns.map(turn => ({
      prompt: turn[this.options.turnResource.promptField],
      response: turn[this.options.turnResource.responseField],
    }));
  }

  async getPreviousUserMessages(sessionId: string) {
    const turns = await this.getAdminforth().resource(this.options.turnResource.resourceId).list(
      [Filters.EQ(this.options.turnResource.sessionIdField, sessionId)],
      2,
      undefined,
      [Sorts.DESC(this.options.turnResource.createdAtField)]
    );
    return turns
      .reverse()
      .filter((turn) => turn[this.options.turnResource.promptField] !== AGENT_SYSTEM_TURN_PROMPT)
      .map((turn): PreviousUserMessage => ({
        text: turn[this.options.turnResource.promptField],
      }));
  }

  async getLatestTurn(sessionId: string) {
    const turns = await this.getAdminforth().resource(this.options.turnResource.resourceId).list(
      [Filters.EQ(this.options.turnResource.sessionIdField, sessionId)],
      1,
      undefined,
      [Sorts.DESC(this.options.turnResource.createdAtField)]
    );

    return turns[0];
  }

  getChatSurfaceSessionId(incoming: ChatSurfaceIncomingMessage) {
    return `${incoming.surface}:${incoming.externalConversationId}`;
  }

  async getOrCreateChatSurfaceSession(
    incoming: ChatSurfaceIncomingMessage,
    adminUser: AdminUser,
  ) {
    const sessionId = this.getChatSurfaceSessionId(incoming);
    const sessionResource = this.getAdminforth().resource(this.options.sessionResource.resourceId);
    const session = await sessionResource.get(
      [Filters.EQ(this.options.sessionResource.idField, sessionId)]
    );

    if (session) {
      return sessionId;
    }

    await sessionResource.create({
      [this.options.sessionResource.idField]: sessionId,
      [this.options.sessionResource.titleField]: incoming.prompt.slice(0, 40) || "New Session",
      [this.options.sessionResource.askerIdField]: adminUser.pk,
    });

    return sessionId;
  }

  async touchSession(sessionId: string) {
    await this.getAdminforth().resource(this.options.sessionResource.resourceId).update(sessionId, {
      [this.options.sessionResource.createdAtField]: new Date().toISOString(),
    });
  }

  async saveTurnResponse(input: {
    turnId: string;
    responseText: string;
    debugHistory?: unknown;
  }) {
    const turnUpdates: Record<string, unknown> = {
      [this.options.turnResource.responseField]: input.responseText,
    };

    if (this.options.turnResource.debugField) {
      turnUpdates[this.options.turnResource.debugField] = input.debugHistory;
    }

    await this.getAdminforth()
      .resource(this.options.turnResource.resourceId)
      .update(input.turnId, turnUpdates);
  }

  async getResumeState(sessionId: string): Promise<{ turnId: string; initialResponse: string }> {
    const latestTurn = await this.getLatestTurn(sessionId);

    if (!latestTurn) {
      throw new Error(`No agent turn found for session "${sessionId}".`);
    }

    const response = latestTurn[this.options.turnResource.responseField];

    return {
      turnId: latestTurn[this.options.turnResource.idField],
      initialResponse: response === "not_finished" ? "" : String(response),
    };
  }
}
