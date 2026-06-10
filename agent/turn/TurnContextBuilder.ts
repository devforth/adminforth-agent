import type { AdminUser, IAdminForth } from "adminforth";
import type { AgentTurnContext, BaseAgentTurnInput } from "./turnTypes.js";

export type UserContextProvider = {
  getUserTimeZone(adminUser: AdminUser): Promise<string | null | undefined> | string | null | undefined;
};

export class TurnContextBuilder {
  constructor(
    private readonly getAdminforth: () => IAdminForth,
    private readonly userContextProvider?: UserContextProvider,
  ) {}

  async build(input: {
    base: BaseAgentTurnInput;
    turnId: string;
  }): Promise<AgentTurnContext> {
    const adminforth = this.getAdminforth();

    return {
      adminUser: input.base.adminUser,
      sessionId: input.base.sessionId,
      turnId: input.turnId,
      abortSignal: input.base.abortSignal,
      currentPage: input.base.currentPage,
      chatSurface: input.base.chatSurface,
      userTimeZone:
        input.base.userTimeZone
        ?? await this.userContextProvider?.getUserTimeZone(input.base.adminUser)
        ?? "UTC",
      adminPublicOrigin:
        input.base.adminPublicOrigin
        ?? adminforth.config.baseUrlSlashed,
    };
  }
}
