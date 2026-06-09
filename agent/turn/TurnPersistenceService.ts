import type { IAdminForth } from "adminforth";
import type { PluginOptions } from "../../types.js";

export class TurnPersistenceService {
  constructor(
    private readonly getAdminforth: () => IAdminForth,
    private readonly options: PluginOptions,
  ) {}

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
}
