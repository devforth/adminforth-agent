import path from "path";
import type { AdminForthResource, IAdminForth } from "adminforth";
import {
  listBundledSkillManifestsSync,
  listSkillManifestsFromDirectorySync,
  type AgentSkillManifest,
} from "./skills/registry.js";

export const DEFAULT_AGENT_SYSTEM_PROMPT = [
  "You are AI Assistant for Admin Panel.",
  "Admin has resources which represent some physical data storage (e.g. table/collection), each resource defines list of columns.",
  "Each resource stores data records. Record represents a data item of resource.",
].join(" ");

function formatResources(resources: AdminForthResource[]) {
  return resources
    .map(
      (resource) =>
        `- resourceId: ${resource.resourceId}\n  label: ${resource.label}`,
    )
    .join("\n");
}

function formatSkills(
  skills: AgentSkillManifest[],
  skillNameLabel: "skill_name" | "tool_name",
) {
  return skills
    .map(
      (skill) =>
        `- ${skillNameLabel}: ${skill.name}\n  description: ${skill.description}`,
    )
    .join("\n");
}

export function buildAgentSystemPrompt(adminforth: IAdminForth) {
  const projectSkillsDirectory = path.resolve(
    adminforth.config.customization.customComponentsDir,
    "skills",
  );
  const primarySkills = listSkillManifestsFromDirectorySync(projectSkillsDirectory);
  const defaultSkills = listBundledSkillManifestsSync();
  const sections = [
    DEFAULT_AGENT_SYSTEM_PROMPT,
    `List of resources:\n${formatResources(adminforth.config.resources)}`,
  ];

  if (primarySkills.length > 0) {
    sections.push(
      `You have primary skills set:\n${formatSkills(primarySkills, "tool_name")}`,
    );
  }

  sections.push(
    "You have next default skills which you can fallback to if primary skill set does not provide a good skill:\n" +
      formatSkills(defaultSkills, "skill_name"),
  );
  sections.push("To read the full instructions of a default skill, call fetch_skill.");
  sections.push("Try to call as many tools as possible in parallel in one step.");
  sections.push(
    "When skill mentions use of another tool which is not initially defined you should call fetch_tool_schema.",
  );

  return sections.join("\n\n");
}
