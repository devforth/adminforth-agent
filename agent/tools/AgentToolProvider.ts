import type { IAdminForth } from "adminforth";
import { prepareApiBasedTools } from "../../apiBasedTools.js";
import type { ApiBasedTool } from "../../apiBasedTools.js";
import { createAgentTools } from "./index.js";

export class AgentToolProvider {
  constructor(
    private readonly getAdminforth: () => IAdminForth,
    private readonly getInternalAgentResourceIds: () => string[],
  ) {}

  getApiBasedTools(): Record<string, ApiBasedTool> {
    return prepareApiBasedTools(
      this.getAdminforth(),
      this.getInternalAgentResourceIds(),
    );
  }

  async getTools(apiBasedTools: Record<string, ApiBasedTool>) {
    const adminforth = this.getAdminforth();

    return createAgentTools(
      adminforth.config.customization.customComponentsDir ?? "custom",
      apiBasedTools,
      adminforth.activatedPlugins.map((plugin) => plugin.customFolderPath),
    );
  }
}
