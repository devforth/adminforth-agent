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
      const toolCallId = request.toolCall.id as string;
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
        toolCallId,
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

        const result = getEnabledApiToolNames(request.state.messages).has(request.toolCall.name)
          ? await handler({
              ...request,
              tool: dynamicTools[request.toolCall.name],
            })
          : await handler(request);

        toolCallTracker.finishSuccess(result);
        return result;
      } catch (error) {
        logger.error(
          `Error calling tool "${request.toolCall.name}": ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
        );
        toolCallTracker.finishError(`Error: ${error instanceof Error ? error.message : String(error)}`);
        return new ToolMessage({
          name: request.toolCall.name,
          tool_call_id: toolCallId,
          status: "error",
          content: `Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      } finally {
        logger.info(
          `Tool "${request.toolCall.name}" finished in ${Date.now() - startedAt}ms`,
        );
      }
    },
  });
}
