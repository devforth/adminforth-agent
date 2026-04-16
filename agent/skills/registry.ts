import { existsSync, readdirSync, readFileSync } from "fs";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";

const SKILLS_DIRECTORY_URL = new URL("../../custom/skills/", import.meta.url);
const SKILLS_DIRECTORY_PATH = fileURLToPath(SKILLS_DIRECTORY_URL);
const SKILL_MARKDOWN_FILENAME = "SKILL.md";
const SKILL_FRONTMATTER_SEPARATOR = "\n---\n";

export interface AgentSkillManifest {
  directoryName: string;
  name: string;
  description: string;
  instructions: string;
}

function normalizeSkillMarkdown(markdown: string) {
  return markdown.split("\r\n").join("\n");
}

function parseSkillMetadata(frontmatterBlock: string) {
  return parseYaml(frontmatterBlock);
}

function parseSkillManifest(directoryName: string, markdown: string): AgentSkillManifest {
  const normalizedMarkdown = normalizeSkillMarkdown(markdown);
  const [frontmatterBlock, instructionsBlock = ""] = normalizedMarkdown.split(
    SKILL_FRONTMATTER_SEPARATOR,
    2,
  );
  const metadata = parseSkillMetadata(frontmatterBlock);

  return {
    directoryName,
    name: metadata.name ?? directoryName,
    description: metadata.description ?? "",
    instructions: instructionsBlock.trim(),
  };
}

function readSkillMarkdownByPathSync(skillsDirectoryPath: string, skillDirectoryName: string) {
  return readFileSync(
    path.join(skillsDirectoryPath, skillDirectoryName, SKILL_MARKDOWN_FILENAME),
    "utf8",
  );
}

function readSkillManifestByPathSync(skillsDirectoryPath: string, skillDirectoryName: string) {
  const skillMarkdown = readSkillMarkdownByPathSync(
    skillsDirectoryPath,
    skillDirectoryName,
  );

  return parseSkillManifest(skillDirectoryName, skillMarkdown);
}

async function getSkillDirectoryNames() {
  const entries = await readdir(SKILLS_DIRECTORY_URL, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function getSkillDirectoryNamesSync(skillsDirectoryPath: string) {
  if (!existsSync(skillsDirectoryPath)) {
    return [];
  }

  return readdirSync(skillsDirectoryPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function readSkillManifest(skillDirectoryName: string) {
  const skillMarkdown = await readSkillMarkdownByDirectory(skillDirectoryName);

  return parseSkillManifest(skillDirectoryName, skillMarkdown);
}

async function readSkillMarkdownByDirectory(skillDirectoryName: string) {
  const skillMarkdownUrl = new URL(
    `../../custom/skills/${skillDirectoryName}/${SKILL_MARKDOWN_FILENAME}`,
    import.meta.url,
  );

  return await readFile(skillMarkdownUrl, "utf8");
}

export async function listSkillManifests() {
  const skillDirectoryNames = await getSkillDirectoryNames();
  return await Promise.all(
    skillDirectoryNames.map((skillDirectoryName) =>
      readSkillManifest(skillDirectoryName),
    ),
  );
}

export function listSkillManifestsFromDirectorySync(skillsDirectoryPath: string) {
  const skillDirectoryNames = getSkillDirectoryNamesSync(skillsDirectoryPath);

  return skillDirectoryNames.map((skillDirectoryName) =>
    readSkillManifestByPathSync(skillsDirectoryPath, skillDirectoryName),
  );
}

export function listBundledSkillManifestsSync() {
  return listSkillManifestsFromDirectorySync(SKILLS_DIRECTORY_PATH);
}

export async function loadSkillManifest(skillName: string) {
  const skillManifests = await listSkillManifests();

  return (
    skillManifests.find(
      (manifest) =>
        manifest.name === skillName || manifest.directoryName === skillName,
    ) ?? null
  );
}

export async function loadSkillMarkdown(skillName: string) {
  const manifest = await loadSkillManifest(skillName);

  if (!manifest) {
    return null;
  }

  return await readSkillMarkdownByDirectory(manifest.directoryName);
}
