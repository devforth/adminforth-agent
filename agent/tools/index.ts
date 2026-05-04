import type { ClientTool } from "@langchain/core/tools";
import { createFetchSkillTool } from "./fetchSkill.js";
import { createFetchToolSchemaTool } from "./fetchToolSchema.js";
import type { ApiBasedTool } from "../../apiBasedTools.js";
import { createApiTool } from "./apiTool.js";
import { createGetUserLocationTool } from "./getUserLocation.js";

export const ALWAYS_AVAILABLE_API_TOOL_NAMES = ["get_resource"] as const;

export async function createAgentTools(
  customComponentsDir: string,
  apiBasedTools: Record<string, ApiBasedTool>,
): Promise<ClientTool[]> {
  return [
    ...ALWAYS_AVAILABLE_API_TOOL_NAMES.map((toolName) => {
      const apiBasedTool = apiBasedTools[toolName];

      if (!apiBasedTool) {
        throw new Error(`Required base API tool "${toolName}" is missing.`);
      }

      return createApiTool(toolName, apiBasedTool);
    }),
    createGetUserLocationTool(),
    await createFetchSkillTool(customComponentsDir),
    await createFetchToolSchemaTool(apiBasedTools),
  ];
}
