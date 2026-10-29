import type { AdminUser, IAdminForth } from "adminforth";
import { Filters, Sorts } from "adminforth";
import { randomUUID } from "crypto";
import type { ChatSurfaceIncomingMessage } from "adminforth";
import type { PreviousUserMessage } from "../domain/languageDetect.js";
import type { PluginOptions } from "../types.js";
import type { TurnAttachments } from "./turnAttachments.js";

export const AGENT_SYSTEM_TURN_PROMPT = "__adminforth_system_message__";

export const STEER_PROMPT_MARKER = "__adminforth_steer__:";

export class AgentSessionStore {
  constructor(
    private getAdminforth: () => IAdminForth,
    private options: PluginOptions,
    private attachments: TurnAttachments,
  ) {}

  private getTurnAttachments(turn: Record<string, any>): string[] {
    const attachmentsField = this.options.turnResource.attachmentsField;
    return attachmentsField ? turn[attachmentsField] ?? [] : [];
  }

  async createNewTurn(sessionId: string, prompt: string, attachments: string[] = []) {
    const turnId = randomUUID();
    const turnRecord: Record<string, unknown> = {
      [this.options.turnResource.idField]: turnId,
      [this.options.turnResource.sessionIdField]: sessionId,
      [this.options.turnResource.promptField]: prompt,
      [this.options.turnResource.responseField]: "not_finished",
    };
    if (attachments.length > 0) {
      turnRecord[this.options.turnResource.attachmentsField!] = attachments;
    }
    const newTurn = await this.getAdminforth().resource(this.options.turnResource.resourceId).create(turnRecord);
    await this.attachments.markUsed(attachments);
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
      [Sorts.ASC(this.options.turnResource.createdAtField), Sorts.ASC(this.options.turnResource.idField)]
    );
    return Promise.all(turns.map(async turn => ({
      id: turn[this.options.turnResource.idField],
      prompt: turn[this.options.turnResource.promptField],
      response: turn[this.options.turnResource.responseField],
      attachments: await this.attachments.withUrls(this.getTurnAttachments(turn)),
    })));
  }

  /**
   * Ordered non-system (real conversation) turns with their stored checkpoint id.
   * Used by message editing to locate the target turn and its previous turn's
   * fork point. Stable order (`createdAt ASC, id ASC`) so positions never drift.
   */
  async getAgentTurns(sessionId: string) {
    const checkpointIdField = this.options.turnResource.checkpointIdField;
    const turns = await this.getAdminforth().resource(this.options.turnResource.resourceId).list(
      [Filters.EQ(this.options.turnResource.sessionIdField, sessionId)],
      undefined,
      undefined,
      [Sorts.ASC(this.options.turnResource.createdAtField), Sorts.ASC(this.options.turnResource.idField)]
    );
    return turns
      .filter((turn) => turn[this.options.turnResource.promptField] !== AGENT_SYSTEM_TURN_PROMPT)
      .map((turn) => ({
        id: turn[this.options.turnResource.idField],
        prompt: turn[this.options.turnResource.promptField],
        response: turn[this.options.turnResource.responseField],
        attachments: this.getTurnAttachments(turn),
        checkpointId: checkpointIdField
          ? (turn[checkpointIdField] ? String(turn[checkpointIdField]) : null)
          : null,
      }));
  }

  /**
   * Apply a message edit and branch: replace the edited turn's prompt and truncate
   * everything after it. Deletes later turns FIRST, then updates the edited turn, so
   * an interruption can only leave a consistent "truncated, edit-not-yet-applied"
   * state (recoverable by retry) — never "edited but stale later turns remain".
   * (AdminForth's resource API has no transactions, hence the deliberate ordering.)
   * Files of the deleted turns and the images dropped by the edit are released.
   */
  async editTurnAndTruncateAfter(input: {
    sessionId: string;
    turnId: string;
    newPrompt: string;
    newAttachments: string[];
  }): Promise<void> {
    const r = this.options.turnResource;
    const resource = this.getAdminforth().resource(r.resourceId);
    const turns = await resource.list(
      [Filters.EQ(r.sessionIdField, input.sessionId)],
      undefined,
      undefined,
      [Sorts.ASC(r.createdAtField), Sorts.ASC(r.idField)],
    );

    const targetIndex = turns.findIndex((turn) => turn[r.idField] === input.turnId);
    if (targetIndex === -1) {
      throw new Error(`Turn "${input.turnId}" not found in session "${input.sessionId}".`);
    }

    const oldAttachments = this.getTurnAttachments(turns[targetIndex]);
    const laterTurns = turns.slice(targetIndex + 1);
    for (const turn of laterTurns) {
      await resource.delete(turn[r.idField]);
    }

    const updates: Record<string, unknown> = {
      [r.promptField]: input.newPrompt,
      [r.responseField]: "not_finished",
    };
    if (r.checkpointIdField) {
      updates[r.checkpointIdField] = null;
    }
    if (r.attachmentsField) {
      updates[r.attachmentsField] = input.newAttachments;
    }
    await resource.update(input.turnId, updates);

    await Promise.all([
      this.attachments.markUsed(input.newAttachments.filter((filePath) => !oldAttachments.includes(filePath))),
      this.attachments.markUnused(
        [...oldAttachments, ...laterTurns.flatMap((turn) => this.getTurnAttachments(turn))]
          .filter((filePath) => !input.newAttachments.includes(filePath)),
      ),
    ]);
  }

  /** Delete the session with its turns and release their attachments. */
  async deleteSession(sessionId: string) {
    const r = this.options.turnResource;
    const turnResource = this.getAdminforth().resource(r.resourceId);
    await this.getAdminforth().resource(this.options.sessionResource.resourceId).delete(sessionId);
    const turns = await turnResource.list([Filters.EQ(r.sessionIdField, sessionId)]);
    await Promise.all(turns.map((turn) => turnResource.delete(turn[r.idField])));
    await this.attachments.markUnused(turns.flatMap((turn) => this.getTurnAttachments(turn)));
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
    /**
     * Tip checkpoint id for this turn. Persisted only when provided AND the field is
     * configured — so aborted/failed turns (which pass undefined) never overwrite it
     * with a stale value.
     */
    checkpointId?: string | null;
  }) {
    const turnUpdates: Record<string, unknown> = {
      [this.options.turnResource.responseField]: input.responseText,
    };

    if (this.options.turnResource.debugField) {
      turnUpdates[this.options.turnResource.debugField] = input.debugHistory;
    }

    if (this.options.turnResource.checkpointIdField && input.checkpointId !== undefined) {
      turnUpdates[this.options.turnResource.checkpointIdField] = input.checkpointId;
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
