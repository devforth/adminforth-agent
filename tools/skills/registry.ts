import { readdir, readFile } from "fs/promises";
import path from "path";
import { parse as parseYaml } from "yaml";

const SKILL_MARKDOWN_FILENAME = "SKILL.md";
const SKILL_FRONTMATTER_SEPARATOR = "\n---\n";

export interface AgentSkillManifest {
  directoryName: string;
  name: string;
  description: string;
  instructions: string;
}

function normalizePluginSkillDirectoryPaths(pluginCustomFolderPaths: string[] = []) {
  return Array.from(new Set(
    pluginCustomFolderPaths
      .map((pluginCustomFolderPath) => path.resolve(pluginCustomFolderPath, "skills")),
  ));
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

function getProjectSkillDirectoryPaths(
  customComponentsDir: string,
  pluginCustomFolderPaths: string[] = [],
) {
  return Array.from(new Set([
    getProjectSkillsDirectoryPath(customComponentsDir),
    ...normalizePluginSkillDirectoryPaths(pluginCustomFolderPaths),
  ]));
}

export async function listProjectSkillManifests(
  customComponentsDir: string,
  pluginCustomFolderPaths: string[] = [],
) {
  return mergeSkillManifests(
    await Promise.all(
      getProjectSkillDirectoryPaths(customComponentsDir, pluginCustomFolderPaths).map(
        listDirectorySkillManifests,
      ),
    ),
  );
}

export async function listSkillManifests(
  customComponentsDir: string,
  pluginCustomFolderPaths: string[] = [],
) {
  return await listProjectSkillManifests(customComponentsDir, pluginCustomFolderPaths);
}

export async function loadSkillManifest(
  skillName: string,
  customComponentsDir: string,
  pluginCustomFolderPaths: string[] = [],
) {
  const manifests = await listSkillManifests(customComponentsDir, pluginCustomFolderPaths);

  return (
    manifests.find(
      (manifest) =>
        manifest.name === skillName || manifest.directoryName === skillName,
    ) ?? null
  );
}

export async function loadSkillMarkdown(
  skillName: string,
  customComponentsDir: string,
  pluginCustomFolderPaths: string[] = [],
) {
  const manifest = await loadSkillManifest(
    skillName,
    customComponentsDir,
    pluginCustomFolderPaths,
  );

  if (!manifest) {
    return null;
  }

  const directories = [
    ...getProjectSkillDirectoryPaths(customComponentsDir, pluginCustomFolderPaths),
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
