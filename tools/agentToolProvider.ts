import type { IAdminForth } from "adminforth";
import type { ClientTool } from "@langchain/core/tools";
import { connectMcp, MCP_PLUGIN_CLASS_NAME, type McpConnectionInput, type McpPlugin } from "./mcpConnection.js";
import { createMcpTool } from "./mcpTool.js";
import { createFetchToolSchemaTool } from "./fetchToolSchema.js";
import { createGetUserLocationTool } from "./getUserLocation.js";
import { createNavigateUserTool } from "./navigateUser.js";

// MCP tools the model can call from the first step; it loads the others with fetch_tool_schema.
const BASE_MCP_TOOL_NAMES = new Set(["fetch_skill", "get_resources_list", "get_resource", "wait_for_confirmation"]);

/** The tools of one agent turn, backed by one MCP connection that `close` ends. */
export type AgentToolSet = {
  /** MCP server instructions, sent ahead of the agent's own system prompt. */
  instructions: string;
  /** Tools the model can call from the first step. */
  baseTools: ClientTool[];
  /** MCP tools the model loads on demand with fetch_tool_schema, by name. */
  dynamicTools: Record<string, ClientTool>;
  /** Tools that pause for the user's approval before they run. */
  approvalToolNames: string[];
  close(): Promise<void>;
};

export class AgentToolProvider {
  constructor(private readonly getAdminforth: () => IAdminForth) {}

  async open(input: Omit<McpConnectionInput, "requestUrl">): Promise<AgentToolSet> {
    const adminforth = this.getAdminforth();
    const connection = await connectMcp(
      adminforth.getPluginByClassName<McpPlugin>(MCP_PLUGIN_CLASS_NAME),
      { ...input, requestUrl: adminforth.config.baseUrlSlashed },
    );
    const baseMcpTools = connection.tools.filter((mcpTool) => BASE_MCP_TOOL_NAMES.has(mcpTool.name));
    const dynamicMcpTools = connection.tools.filter((mcpTool) => !BASE_MCP_TOOL_NAMES.has(mcpTool.name));

    return {
      instructions: connection.instructions,
      baseTools: [
        ...baseMcpTools.map((mcpTool) => createMcpTool(mcpTool, connection)),
        createGetUserLocationTool(),
        createNavigateUserTool(),
        createFetchToolSchemaTool(connection.tools, dynamicMcpTools),
      ],
      dynamicTools: Object.fromEntries(
        dynamicMcpTools.map((mcpTool) => [mcpTool.name, createMcpTool(mcpTool, connection)]),
      ),
      approvalToolNames: connection.tools
        .filter((mcpTool) => mcpTool.annotations?.destructiveHint)
        .map((mcpTool) => mcpTool.name),
      close: connection.close,
    };
  }
}
