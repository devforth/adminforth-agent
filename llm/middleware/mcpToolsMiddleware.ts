import { ToolMessage } from "@langchain/core/messages";
import { isGraphInterrupt } from "@langchain/langgraph";
import type { ClientTool } from "@langchain/core/tools";
import { createMiddleware } from "langchain";
import { logger, type IAdminForth } from "adminforth";
import { formatToolCall } from "../../tools/toolLabels.js";
import {
  createToolCallTracker,
  type ToolCallEventSink,
} from "../../domain/toolCallEvents.js";
import type { AgentEventEmitter } from "../../domain/agentEvents.js";
import type { SequenceDebugCollector } from "./sequenceDebug.js";
import { isAbortError } from "../../shared/errors.js";

function getEnabledToolNames(messages: unknown[]) {
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

/**
 * Adds the MCP tools loaded with fetch_tool_schema to the next model calls, routes their calls,
 * and reports every tool call to the processing timeline.
 */
export function createMcpToolsMiddleware(
  dynamicTools: Record<string, ClientTool>,
  adminforth: IAdminForth,
) {
  const loadedDynamicToolNames = (messages: unknown[]) =>
    [...getEnabledToolNames(messages)].filter((toolName) => toolName in dynamicTools);

  return createMiddleware({
    name: "McpToolsMiddleware",
    async wrapModelCall(request, handler) {
      return handler({
        ...request,
        tools: [
          ...request.tools,
          ...loadedDynamicToolNames(request.state.messages).map((toolName) => dynamicTools[toolName]),
        ],
      });
    },
    async wrapToolCall(request, handler) {
      const startedAt = Date.now();
      if (!request.toolCall.id) {
        throw new Error(`Tool call "${request.toolCall.name}" has no id.`);
      }

      const toolCallId = request.toolCall.id;
      const { abortSignal, emit, sequenceDebugSink } = request.runtime.context as {
        abortSignal?: AbortSignal;
        emit?: AgentEventEmitter;
        sequenceDebugSink: SequenceDebugCollector;
      };
      const emitToolCall: ToolCallEventSink = (event) => {
        sequenceDebugSink.handleToolCallEvent(event);
        void emit?.({
          type: "tool-call",
          data: event,
        });
      };
      const toolArgs = (request.toolCall.args ?? {}) as Record<string, unknown>;
      const toolCallTracker = createToolCallTracker({
        emit: emitToolCall,
        toolCallId,
        toolName: request.toolCall.name,
        toolInfo: formatToolCall(adminforth, request.toolCall.name, toolArgs),
        input: toolArgs,
        startedAt,
      });
      toolCallTracker.start();

      try {
        const result = loadedDynamicToolNames(request.state.messages).includes(request.toolCall.name)
          ? await handler({
              ...request,
              tool: dynamicTools[request.toolCall.name],
            })
          : await handler(request);

        toolCallTracker.finishSuccess(result);
        return result;
      } catch (error) {
        if (
          isGraphInterrupt(error)
          || abortSignal?.aborted
          || isAbortError(error)
        ) {
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error);

        logger.error(
          `Error calling tool "${request.toolCall.name}": ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
        );
        toolCallTracker.finishError(`Error: ${message}`);
        return new ToolMessage({
          name: request.toolCall.name,
          tool_call_id: toolCallId,
          status: "error",
          content: `Error: ${message}`,
        })
      }
    },
  });
}
