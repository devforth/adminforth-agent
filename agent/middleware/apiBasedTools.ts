import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import { logger, type AdminUser, type IAdminForth } from "adminforth";
import {
  formatApiBasedToolCall,
  type ApiBasedTool,
} from "../../apiBasedTools.js";
import {
  createToolCallTracker,
  type ToolCallEventSink,
} from "../toolCallEvents.js";
import { ALWAYS_AVAILABLE_API_TOOL_NAMES } from "../tools/index.js";
import { createApiTool } from "../tools/apiTool.js";
import type { AgentEventEmitter } from "../../agentEvents.js";
import type { SequenceDebugCollector } from "./sequenceDebug.js";

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
  adminforth: IAdminForth,
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
      const availableTools = [...request.tools, ...tools];

      logger.info(
        `AdminForth Agent callable tools: ${availableTools.map((tool) => tool.name).join(", ")}`,
      );

      return handler({
        ...request,
        tools: availableTools,
      });
    },
    async wrapToolCall(request, handler) {
      const startedAt = Date.now();
      const toolInput = JSON.stringify(request.toolCall.args ?? {});
      const { adminUser, emit, sequenceDebugSink, userTimeZone } = request.runtime.context as {
        adminUser: AdminUser;
        emit?: AgentEventEmitter;
        sequenceDebugSink: SequenceDebugCollector;
        userTimeZone: string;
      };
      const emitToolCall: ToolCallEventSink = (event) => {
        sequenceDebugSink.handleToolCallEvent(event);
        void emit?.({
          type: "tool-call",
          data: event,
        });
      };
      const toolArgs = (request.toolCall.args ?? {}) as Record<string, unknown>;
      let toolInfo: string | undefined;

      if (request.toolCall.name === "fetch_skill") {
        toolInfo = `Load ${(toolArgs.skillName as string).split("_").join(" ")} skill`;
      } else if (request.toolCall.name === "fetch_tool_schema") {
        toolInfo = `Load ${(toolArgs.toolName as string).split("_").join(" ")} tool `;
      } else {
        toolInfo = await formatApiBasedToolCall({
          adminforth,
          adminUser,
          inputs: toolArgs,
          toolName: request.toolCall.name,
          userTimeZone,
        });
      }
      const toolCallTracker = createToolCallTracker({
        emit: emitToolCall,
        toolCallId: request.toolCall.id,
        toolName: request.toolCall.name,
        toolInfo,
        input: toolArgs,
        startedAt,
      });
      toolCallTracker.start();
      logger.info(
        `Invoking tool "${request.toolCall.name}" with input: ${toolInput}`,
      );

      try {
        let result;

        if (request.tool) {
          result = await handler(request);
        } else {
          const enabledApiToolNames = getEnabledApiToolNames(request.state.messages);

          if (enabledApiToolNames.has(request.toolCall.name)) {
            result = await handler({
              ...request,
              tool: dynamicTools[request.toolCall.name],
            });
          } else {
            result = new ToolMessage({
              content: `Tool "${request.toolCall.name}" is not loaded. Call fetch_tool_schema first.`,
              tool_call_id: request.toolCall.id ?? "",
              name: request.toolCall.name,
              status: "error",
            });
          }
        }

        toolCallTracker.finishSuccess(result);
        return result;
      } catch (error) {
        const errorDetails =
          error instanceof Error ? error.stack ?? error.message : String(error);

        logger.error(
          `Tool "${request.toolCall.name}" failed after ${Date.now() - startedAt}ms with input: ${toolInput}\n${errorDetails}`,
        );
        toolCallTracker.finishError(error);
        throw error;
      } finally {
        logger.info(
          `Tool "${request.toolCall.name}" finished in ${Date.now() - startedAt}ms`,
        );
      }
    },
  });
}
