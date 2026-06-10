import type { AdminUser, IAdminForth } from "adminforth";
import { logger } from "adminforth";
import { HumanMessage, SystemMessage } from "langchain";
import { detectUserLanguage, type PreviousUserMessage } from "../languageDetect.js";
import { buildAgentTurnSystemPrompt } from "../systemPrompt.js";
import { getErrorMessage, isAbortError } from "../../errors.js";
import type { AgentModeCompletionAdapter } from "../simpleAgent.js";

export class TurnPromptBuilder {
  constructor(
    private readonly options: {
      getAgentSystemPrompt: () => Promise<string>;
      getAdminforth: () => IAdminForth;
    },
  ) {}

  async build(input: {
    prompt: string;
    previousUserMessages: PreviousUserMessage[];
    adminUser: AdminUser;
    completionAdapter: AgentModeCompletionAdapter;
    chatSurface?: string;
    abortSignal?: AbortSignal;
  }) {
    const adminforth = this.options.getAdminforth();
    const userLanguage = await detectUserLanguage(
      input.completionAdapter,
      input.prompt,
      input.previousUserMessages,
    ).catch((error) => {
      if (input.abortSignal?.aborted || isAbortError(error)) {
        throw error;
      }

      logger.warn(`Failed to detect user language: ${getErrorMessage(error)}`);
      return null;
    });
    const systemPrompt = buildAgentTurnSystemPrompt({
      agentSystemPrompt: await this.options.getAgentSystemPrompt(),
      adminUser: input.adminUser,
      usernameField: adminforth.config.auth!.usernameField,
      userLanguage,
      chatSurface: input.chatSurface,
    });

    return [
      new SystemMessage(systemPrompt),
      new HumanMessage(input.prompt),
    ];
  }
}
