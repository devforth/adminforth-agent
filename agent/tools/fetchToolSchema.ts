import { tool } from "langchain";
import { z } from "zod";
import {
  serializeApiBasedTool,
  type ApiBasedTool,
} from "../../apiBasedTools.js";

const fetchToolSchemaSchema = z.object({
  toolName: z
    .string()
    .describe("Name of the API-based tool to load, for example get_resource."),
});

export async function createFetchToolSchemaTool(
  apiBasedTools: Record<string, ApiBasedTool>,
) {
  return tool(
    async ({ toolName }) => {
      const toolDefinition = apiBasedTools[toolName];

      if (!toolDefinition) {
        return JSON.stringify(
          {
            status: 404,
            error: "TOOL_NOT_FOUND",
            message: `Tool "${toolName}" not found.`,
          },
          null,
          2,
        );
      }

      return JSON.stringify(
        {
          status: 200,
          name: toolName,
          ...serializeApiBasedTool(toolDefinition),
        },
        null,
        2,
      );
    },
    {
      name: "fetch_tool_schema",
      description:
        "Fetch the schema for an API-based AdminForth tool by name and load it for later use.",
      schema: fetchToolSchemaSchema,
    },
  );
}
