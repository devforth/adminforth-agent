import type { AgentSessionStore } from "../../sessionStore.js";
import type { BaseAgentTurnInput } from "./turnTypes.js";
import { TurnPersistenceService } from "./TurnPersistenceService.js";

export class TurnLifecycleService {
  constructor(
    private readonly sessionStore: AgentSessionStore,
    private readonly persistence: TurnPersistenceService,
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

  async finish(input: {
    turnId: string;
    responseText: string;
    debugHistory?: unknown;
  }) {
    await this.persistence.saveTurnResponse(input);
  }
}
