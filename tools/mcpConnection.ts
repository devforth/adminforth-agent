import { Client, type TextContent, type Tool, type Transport } from "@modelcontextprotocol/client";
import type { AdminUser } from "adminforth";

export const MCP_PLUGIN_CLASS_NAME = "AdminForthMcpPlugin";

// Shown in the audit log and on the 2FA confirmation page of the admin panel.
const AGENT_EXECUTED_BY = "af-agent";
const AGENT_CONNECTION_NAME = "AdminForth Agent";
const AGENT_CLIENT_INFO = { name: "adminforth-agent", version: "1.0.0" };

/** The `openConnection` session of @adminforth/mcp: a user this process already authenticated. */
type McpSession = {
  adminUser: AdminUser;
  /** Binds 2FA confirmations of the connection's actions to it. */
  connection: { id: string; name: string };
  readOnly: boolean;
  headers: Record<string, string>;
  requestUrl: string;
  timeZone?: string;
};

/** The part of the @adminforth/mcp plugin the agent works through. */
export type McpPlugin = {
  openConnection(session: McpSession): Promise<Transport>;
};

export type McpConnectionInput = {
  adminUser: AdminUser;
  sessionId: string;
  userTimeZone?: string;
  requestUrl: string;
};

/** One MCP connection of an agent turn, open until `close`. */
export type AgentMcpConnection = {
  /** Server instructions: rules for every MCP client and the list of skills. */
  instructions: string;
  tools: Tool[];
  /** Calls a tool and returns its YAML output; tool-level errors come back as output too. */
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
  close(): Promise<void>;
};

/** The agent has exactly the permissions of the user it runs for, so its connections are never read-only. */
export async function connectMcp(mcp: McpPlugin, input: McpConnectionInput): Promise<AgentMcpConnection> {
  const client = new Client(AGENT_CLIENT_INFO);
  await client.connect(await mcp.openConnection({
    adminUser: { ...input.adminUser, executedBy: AGENT_EXECUTED_BY },
    connection: { id: `agent:${input.sessionId}`, name: AGENT_CONNECTION_NAME },
    readOnly: false,
    headers: {},
    requestUrl: input.requestUrl,
    timeZone: input.userTimeZone,
  }));
  const { tools } = await client.listTools();

  return {
    instructions: client.getInstructions()!,
    tools,
    async callTool(name, args, signal) {
      // The AdminForth MCP server answers every call with a single text block.
      const { content } = await client.callTool({ name, arguments: args }, { signal });
      return (content[0] as TextContent).text;
    },
    close: () => client.close(),
  };
}
