import type { ClientTool } from "@langchain/core/tools";
import { createFetchSkillTool } from "./fetchSkill.js";

export async function createAgentTools(): Promise<ClientTool[]> {
  return [await createFetchSkillTool()];
}
