import type { AgentEventEmitter } from "../../agentEvents.js";
import { VegaLiteStreamBuffer } from "./VegaLiteStreamBuffer.js";

export class TurnStreamConsumer {
  async consume(input: {
    stream: AsyncIterable<[any, any]>;
    abortSignal?: AbortSignal;
    emit?: AgentEventEmitter;
  }) {
    let fullResponse = "";
    const textBuffer = new VegaLiteStreamBuffer();

    for await (const rawChunk of input.stream) {
      if (input.abortSignal?.aborted) {
        throw new DOMException("This operation was aborted", "AbortError");
      }

      const [token, metadata] = rawChunk;
      const nodeName =
        typeof metadata?.langgraph_node === "string"
          ? metadata.langgraph_node
          : "";

      if (nodeName && !["model", "model_request"].includes(nodeName)) {
        continue;
      }

      const blocks = Array.isArray(token?.contentBlocks)
        ? token.contentBlocks
        : Array.isArray(token?.content)
          ? token.content
          : [];
      const reasoningDelta = blocks
        .filter((block: any) => block?.type === "reasoning")
        .map((block: any) => String(block.reasoning ?? ""))
        .join("");
      const textDelta = blocks
        .filter((block: any) => block?.type === "text")
        .map((block: any) => String(block.text ?? ""))
        .join("");

      if (reasoningDelta) {
        await input.emit?.({
          type: "reasoning-delta",
          delta: reasoningDelta,
        });
      }

      if (textDelta) {
        fullResponse += textDelta;
        await textBuffer.push(textDelta, input.emit);
      }
    }

    await textBuffer.flush(input.emit);

    return {
      text: fullResponse,
    };
  }
}
