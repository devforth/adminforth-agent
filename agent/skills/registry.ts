import { readdir, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";

const PLUGIN_SKILLS_DIRECTORY_PATH = fileURLToPath(
  new URL("../../custom/skills/", import.meta.url),
);
const SKILL_MARKDOWN_FILENAME = "SKILL.md";
const SKILL_FRONTMATTER_SEPARATOR = "\n---\n";

export interface AgentSkillManifest {
  directoryName: string;
  name: string;
  description: string;
  instructions: string;
}

function parseSkillManifest(directoryName: string, markdown: string): AgentSkillManifest {
  const [frontmatterBlock, instructions = ""] = markdown.split("\r\n").join("\n").split(
    SKILL_FRONTMATTER_SEPARATOR,
    2,
  );
  const metadata = parseYaml(frontmatterBlock) as {
    name?: string;
    description?: string;
  };

  return {
    directoryName,
    name: metadata.name ?? directoryName,
    description: metadata.description ?? "",
    instructions: instructions.trim(),
  };
}

async function readSkillManifest(skillsDirectoryPath: string, directoryName: string) {
  const markdown = await readFile(
    path.join(skillsDirectoryPath, directoryName, SKILL_MARKDOWN_FILENAME),
    "utf8",
  );

  return parseSkillManifest(directoryName, markdown);
}

async function listDirectorySkillManifests(skillsDirectoryPath: string) {
  try {
    const entries = await readdir(skillsDirectoryPath, { withFileTypes: true });

    return await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .map((directoryName) => readSkillManifest(skillsDirectoryPath, directoryName)),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function mergeSkillManifests(skillGroups: AgentSkillManifest[][]) {
  return Array.from(
    new Map(
      skillGroups.flat().map((skill) => [
        `${skill.name}:${skill.directoryName}`,
        skill,
      ]),
    ).values(),
  );
}

export function getProjectSkillsDirectoryPath(customComponentsDir: string) {
  return path.resolve(customComponentsDir, "skills");
}

export async function listBundledSkillManifests() {
  return await listDirectorySkillManifests(PLUGIN_SKILLS_DIRECTORY_PATH);
}

export async function listProjectSkillManifests(customComponentsDir: string) {
  return await listDirectorySkillManifests(
    getProjectSkillsDirectoryPath(customComponentsDir),
  );
}

export async function listSkillManifests(customComponentsDir: string) {
  return mergeSkillManifests([
    await listProjectSkillManifests(customComponentsDir),
    await listBundledSkillManifests(),
  ]);
}

export async function loadSkillManifest(skillName: string, customComponentsDir: string) {
  const manifests = await listSkillManifests(customComponentsDir);

  return (
    manifests.find(
      (manifest) =>
        manifest.name === skillName || manifest.directoryName === skillName,
    ) ?? null
  );
}

export async function loadSkillMarkdown(skillName: string, customComponentsDir: string) {
  const manifest = await loadSkillManifest(skillName, customComponentsDir);

  if (!manifest) {
    return null;
  }

  const directories = [
    getProjectSkillsDirectoryPath(customComponentsDir),
    PLUGIN_SKILLS_DIRECTORY_PATH,
  ];

  for (const skillsDirectoryPath of directories) {
    try {
      return await readFile(
        path.join(skillsDirectoryPath, manifest.directoryName, SKILL_MARKDOWN_FILENAME),
        "utf8",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  return null;
}
