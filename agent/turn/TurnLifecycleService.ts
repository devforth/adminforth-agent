import type { AgentSessionStore } from "../../sessionStore.js";
import type { PluginOptions } from "../../types.js";
import type { BaseAgentTurnInput } from "./turnTypes.js";
import { TurnPersistenceService } from "./TurnPersistenceService.js";

export class TurnLifecycleService {
  constructor(
    private readonly sessionStore: AgentSessionStore,
    private readonly persistence: TurnPersistenceService,
    private readonly options: PluginOptions,
  ) {}

  async start(input: BaseAgentTurnInput) {
    const previousUserMessages = await this.sessionStore.getPreviousUserMessages(input.sessionId);
    const turnId = await this.sessionStore.createNewTurn(input.sessionId, input.prompt);
    await this.persistence.touchSession(input.sessionId);

    return {
      turnId,
      previousUserMessages,
    };
  }

  async resume(input: BaseAgentTurnInput) {
    const latestTurn = await this.sessionStore.getLatestTurn(input.sessionId);

    if (!latestTurn) {
      throw new Error(`No agent turn found for session "${input.sessionId}".`);
    }

    return {
      turnId: latestTurn[this.options.turnResource.idField],
      previousUserMessages: await this.sessionStore.getPreviousUserMessages(input.sessionId),
      initialResponse: latestTurn[this.options.turnResource.responseField] === "not_finished"
        ? ""
        : String(latestTurn[this.options.turnResource.responseField]),
    };
  }

  async finish(input: {
    turnId: string;
    responseText: string;
    debugHistory?: unknown;
  }) {
    await this.persistence.saveTurnResponse(input);
  }
}
