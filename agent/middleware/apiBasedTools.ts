import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import { logger } from "adminforth";
import type { ApiBasedTool } from "../../apiBasedTools.js";
import { createApiTool } from "../tools/apiTool.js";
import { ALWAYS_AVAILABLE_API_TOOL_NAMES } from "../tools/constants.js";

function getEnabledApiToolNames(messages: unknown[]) {
  const enabledToolNames = new Set<string>();

  for (const message of messages) {
    if (!ToolMessage.isInstance(message) || message.name !== "fetch_tool_schema") {
      continue;
    }

    const content =
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .map((block) =>
                typeof block === "string"
                  ? block
                  : "text" in block
                    ? block.text
                    : "",
              )
              .join("")
          : "";

    try {
      const parsed = JSON.parse(content) as { status?: number; name?: string };

      if (parsed.status === 200 && parsed.name) {
        enabledToolNames.add(parsed.name);
      }
    } catch {}
  }

  return enabledToolNames;
}

export function createApiBasedToolsMiddleware(
  apiBasedTools: Record<string, ApiBasedTool>,
) {
  const alwaysAvailableApiToolNames = new Set<string>(ALWAYS_AVAILABLE_API_TOOL_NAMES);
  const dynamicTools = Object.fromEntries(
    Object.entries(apiBasedTools).map(([toolName, apiBasedTool]) => [
      toolName,
      createApiTool(toolName, apiBasedTool),
    ]),
  );

  return createMiddleware({
    name: "ApiBasedToolsMiddleware",
    async wrapModelCall(request, handler) {
      const enabledApiToolNames = getEnabledApiToolNames(request.state.messages);
      const tools = [...enabledApiToolNames]
        .filter((toolName) => !alwaysAvailableApiToolNames.has(toolName))
        .map((toolName) => dynamicTools[toolName]);

      return handler({
        ...request,
        tools: [...request.tools, ...tools],
      });
    },
    async wrapToolCall(request, handler) {
      const startedAt = Date.now();
      const toolInput = JSON.stringify(request.toolCall.args ?? {});
      logger.info(
        `Invoking tool "${request.toolCall.name}" with input: ${toolInput}`,
      );

      try {
        if (request.tool) {
          return await handler(request);
        }

        const enabledApiToolNames = getEnabledApiToolNames(request.state.messages);

        if (enabledApiToolNames.has(request.toolCall.name)) {
          return await handler({
            ...request,
            tool: dynamicTools[request.toolCall.name],
          });
        }

        return new ToolMessage({
          content: `Tool "${request.toolCall.name}" is not loaded. Call fetch_tool_schema first.`,
          tool_call_id: request.toolCall.id ?? "",
          name: request.toolCall.name,
          status: "error",
        });
      } catch (error) {
        const errorDetails =
          error instanceof Error ? error.stack ?? error.message : String(error);

        logger.error(
          `Tool "${request.toolCall.name}" failed after ${Date.now() - startedAt}ms with input: ${toolInput}\n${errorDetails}`,
        );
        throw error;
      } finally {
        logger.info(
          `Tool "${request.toolCall.name}" finished in ${Date.now() - startedAt}ms`,
        );
      }
    },
  });
}
