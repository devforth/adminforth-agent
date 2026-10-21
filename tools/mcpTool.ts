import { tool } from "langchain";
import type { Tool } from "@modelcontextprotocol/client";
import type { AgentMcpConnection } from "./mcpConnection.js";

// Model providers reject top-level composite keywords in tool schemas; the MCP server still validates them.
function normalizeToolInputSchema(inputSchema: Tool["inputSchema"]) {
  const schema = structuredClone(inputSchema) as Record<string, unknown>;
  const notes: string[] = [];

  if ("if" in schema || "then" in schema || "else" in schema || "allOf" in schema) {
    delete schema.if;
    delete schema.then;
    delete schema.else;
    delete schema.allOf;
    notes.push("Runtime applies additional conditional validation rules.");
  }

  if ("oneOf" in schema || "anyOf" in schema || "not" in schema || "enum" in schema) {
    delete schema.oneOf;
    delete schema.anyOf;
    delete schema.not;
    delete schema.enum;
    notes.push("Top-level composite validation rules are omitted for tool compatibility.");
  }

  if (notes.length > 0) {
    schema.description = typeof schema.description === "string"
      ? `${schema.description}\n\n${notes.join(" ")}`
      : notes.join(" ");
  }

  return schema;
}

export function createMcpTool(mcpTool: Tool, connection: AgentMcpConnection) {
  return tool(
    async (input, runtime) => connection.callTool(
      mcpTool.name,
      input as Record<string, unknown>,
      runtime.context.abortSignal,
    ),
    {
      name: mcpTool.name,
      description: mcpTool.description ?? mcpTool.name,
      schema: normalizeToolInputSchema(mcpTool.inputSchema),
      verboseParsingErrors: true,
    },
  );
}
