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

  async getTools() {
    const adminforth = this.getAdminforth();

    return createAgentTools(
      adminforth.config.customization.customComponentsDir ?? "custom",
      this.getApiBasedTools(),
      adminforth.activatedPlugins.map((plugin) => plugin.customFolderPath),
    );
  }
}
