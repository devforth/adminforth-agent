import { tool } from "langchain";
import type { Tool } from "@modelcontextprotocol/client";
import { z } from "zod";

// The catalog shows the first sentence of each tool description; the full one comes with the loaded tool.
const FIRST_SENTENCE_RE = /^[\s\S]*?[.!?](?=\s|$)/;
const WHITESPACE_RE = /\s+/g;

const fetchToolSchemaSchema = z.object({
  toolName: z
    .string()
    .describe("Name of the admin panel tool to load, for example create_record."),
});

function catalogEntry({ name, description }: Tool) {
  if (!description) return `- ${name}`;
  const summary = (description.match(FIRST_SENTENCE_RE)?.[0] ?? description).replace(WHITESPACE_RE, " ");
  return `- ${name}: ${summary}`;
}

/**
 * Loads an MCP tool for later steps: the tools middleware adds every tool this returned status 200 for.
 * Like MCP clients that load tool schemas on demand, its description names every tool it can load.
 */
export function createFetchToolSchemaTool(mcpTools: Tool[], loadableTools: Tool[]) {
  const mcpToolNames = new Set(mcpTools.map((mcpTool) => mcpTool.name));

  return tool(
    async ({ toolName }) => JSON.stringify(
      mcpToolNames.has(toolName)
        ? { status: 200, name: toolName, loaded: true }
        : { status: 404, error: "TOOL_NOT_FOUND", message: `Tool "${toolName}" not found.` },
      null,
      2,
    ),
    {
      name: "fetch_tool_schema",
      description: [
        "Loads an admin panel tool so you can call it from the next step. Load a tool before its first call, right after fetch_skill when the skill lists tools you cannot call yet.",
        "Tools you can load:",
        ...loadableTools.map(catalogEntry),
      ].join("\n"),
      schema: fetchToolSchemaSchema,
    },
  );
}
