import type { AdminForthResource, IAdminForth } from "adminforth";
import {
  listBundledSkillManifests,
  listProjectSkillManifests,
  type AgentSkillManifest,
} from "./skills/registry.js";
import { ALWAYS_AVAILABLE_API_TOOL_NAMES } from "./tools/index.js";

export const DEFAULT_AGENT_SYSTEM_PROMPT = [
  "You are AI Assistant for Admin Panel.",
  "Admin has resources which represent some physical data storage (e.g. table/collection), each resource defines list of columns.",
  "Each resource stores data records. Record represents a data item of resource.",
].join(" ");

function formatResources(resources: AdminForthResource[]) {
  return resources
    .map((resource) => `- resourceId: ${resource.resourceId}\n  label: ${resource.label}`)
    .join("\n");
}

function formatSkills(skills: AgentSkillManifest[], label: "skill_name" | "tool_name") {
  return skills
    .map((skill) => `- ${label}: ${skill.name}\n  description: ${skill.description}`)
    .join("\n");
}

export async function buildAgentSystemPrompt(adminforth: IAdminForth) {
  const [primarySkills, defaultSkills] = await Promise.all([
    listProjectSkillManifests(adminforth.config.customization.customComponentsDir),
    listBundledSkillManifests(),
  ]);
  const alwaysAvailableTools = ALWAYS_AVAILABLE_API_TOOL_NAMES.join(", ");
  const sections = [
    DEFAULT_AGENT_SYSTEM_PROMPT,
    `BASE_URL: ${adminforth.config.baseUrl}`,
    `List of resources:\n${formatResources(adminforth.config.resources)}`,
    `You have always-available base tools: ${alwaysAvailableTools}.`,
    primarySkills.length > 0
      ? `You have primary skills set:\n${formatSkills(primarySkills, "skill_name")}`
      : "",
    "You have next default skills which you can fallback to if primary skill set does not provide a good skill:\n" +
      formatSkills(defaultSkills, "skill_name"),
    "Before using any skill, call fetch_skill to load its full instructions.",
    "You can use get_resource immediately to inspect resource structure and column names.",
    "Only call fetch_tool_schema for tool names that are explicitly mentioned in a fetched skill and are not already available as base tools.",
    "When fetch_tool_schema succeeds, that tool becomes available on the next step.",
    "Try to call as many tools as possible in parallel in one step.",
  ];

  return sections.filter(Boolean).join("\n\n");
}
