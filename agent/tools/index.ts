import type { ClientTool } from "@langchain/core/tools";
import { createFetchSkillTool } from "./fetchSkill.js";

export async function createAgentTools(
  customComponentsDir: string,
): Promise<ClientTool[]> {
  return [await createFetchSkillTool(customComponentsDir)];
}
