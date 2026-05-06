import { tool } from "langchain";
import type { ApiBasedTool } from "../../apiBasedTools.js";

const emptyToolSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const;

function normalizeToolInputSchema(inputSchema: unknown) {
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    return emptyToolSchema;
  }

  const schema = JSON.parse(JSON.stringify(inputSchema)) as Record<string, unknown>;

  if (schema.type !== "object") {
    return emptyToolSchema;
  }

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

export function createApiTool(toolName: string, apiBasedTool: ApiBasedTool) {
  return tool(
    async (input, runtime) => {
      const normalizedInput = (input ?? {}) as Record<string, unknown>;
      return apiBasedTool.call({
        adminUser: runtime.context.adminUser,
        abortSignal: runtime.context.abortSignal,
        inputs: normalizedInput,
        userTimeZone: runtime.context.userTimeZone,
      });
    },
    {
      name: toolName,
      description: apiBasedTool.description ?? `${toolName} tool`,
      schema: normalizeToolInputSchema(apiBasedTool.input_schema),
    },
  );
}
