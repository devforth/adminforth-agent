import type { AdminForthResource, IAdminForth } from "adminforth";
import {
  listBundledSkillManifests,
  listProjectSkillManifests,
  type AgentSkillManifest,
} from "./skills/registry.js";

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
  const sections = [
    DEFAULT_AGENT_SYSTEM_PROMPT,
    `List of resources:\n${formatResources(adminforth.config.resources)}`,
    primarySkills.length > 0
      ? `You have primary skills set:\n${formatSkills(primarySkills, "tool_name")}`
      : "",
    "You have next default skills which you can fallback to if primary skill set does not provide a good skill:\n" +
      formatSkills(defaultSkills, "skill_name"),
    "To read the full instructions of a default skill, call fetch_skill.",
    "Try to call as many tools as possible in parallel in one step.",
    "When skill mentions use of another tool which is not initially defined you should call fetch_tool_schema.",
  ];

  return sections.filter(Boolean).join("\n\n");
}
