import { tool } from "langchain";
import { z } from "zod";
import {
  listSkillManifests,
  loadSkillMarkdown,
  type AgentSkillManifest,
} from "../skills/registry.js";
import { logger } from "adminforth";

const fetchSkillSchema = z.object({
  skillName: z
    .string()
    .describe(
      "Name of the custom AdminForth skill to load, for example fetch_data or mutate_data.",
    ),
});

function serializeSkillManifests(skillManifests: AgentSkillManifest[]) {
  return skillManifests.map((skill) => ({
    name: skill.name,
    description: skill.description,
  }));
}

export async function createFetchSkillTool(customComponentsDir: string) {
  const availableSkills = await listSkillManifests(customComponentsDir);
  const availableSkillNames = availableSkills.map((skill) => skill.name);

  return tool(
    async ({ skillName }) => {
      try {
        logger.info(`Fetching ${skillName} skill`)
        const skillMarkdown = await loadSkillMarkdown(skillName, customComponentsDir);

        if (!skillMarkdown) {
          return [
            `Skill "${skillName}" not found.`,
            "Available skills:",
            JSON.stringify(serializeSkillManifests(availableSkills), null, 2),
          ].join("\n");
        }

        return skillMarkdown;
      } catch (error) {
        return `Failed to load skill "${skillName}": ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
    {
      name: "fetch_skill",
      description: `Fetch the raw SKILL.md content for a custom AdminForth skill by name.${
        availableSkillNames.length > 0
          ? ` Available skills: ${availableSkillNames.join(", ")}.`
          : ""
      }`,
      schema: fetchSkillSchema,
    },
  );
}
