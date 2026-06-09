import type { CompletionAdapter } from "adminforth";
import { createAgentChatModel } from "../simpleAgent.js";
import type { AgentTurnModels } from "../turn/turnTypes.js";

export class AgentModelFactory {
  constructor(private readonly maxTokens: number) {}

  async create(completionAdapter: CompletionAdapter): Promise<AgentTurnModels> {
    const [primaryModelSpec, summaryModelSpec] = await Promise.all([
      createAgentChatModel({
        adapter: completionAdapter,
        maxTokens: this.maxTokens,
        purpose: "primary",
      }),
      createAgentChatModel({
        adapter: completionAdapter,
        maxTokens: this.maxTokens,
        purpose: "summary",
      }),
    ]);

    return {
      model: primaryModelSpec.model,
      summaryModel: summaryModelSpec.model,
      modelMiddleware: primaryModelSpec.middleware,
    };
  }
}
