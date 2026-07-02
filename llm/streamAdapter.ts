import type { AgentStreamChunk } from "../domain/turnTypes.js";

// Only tokens emitted by the model node(s) are surfaced to the user; other
// graph nodes (tools, summarization, etc.) are internal.
const STREAMABLE_NODES = ["model", "model_request"];

type RawStreamEntry =
  | ["messages", [any, any]]
  | ["updates", Record<string, any>];

function extractBlocks(token: any): any[] {
  if (Array.isArray(token?.contentBlocks)) {
    return token.contentBlocks;
  }
  if (Array.isArray(token?.content)) {
    return token.content;
  }
  return [];
}

/**
 * Convert one raw LangGraph stream entry into zero or more normalized chunks.
 * Pure and synchronous so the parsing rules can be unit-tested in isolation.
 */
export function parseRawStreamChunk(entry: RawStreamEntry): AgentStreamChunk[] {
  const [mode, chunk] = entry;

  if (mode === "updates") {
    if (chunk && typeof chunk === "object" && "__interrupt__" in chunk) {
      return [{ kind: "interrupt", interrupt: (chunk as Record<string, unknown>).__interrupt__ }];
    }
    return [];
  }

  const [token, metadata] = chunk as [any, any];
  const nodeName =
    typeof metadata?.langgraph_node === "string" ? metadata.langgraph_node : "";

  if (nodeName && !STREAMABLE_NODES.includes(nodeName)) {
    return [];
  }

  const blocks = extractBlocks(token);
  const chunks: AgentStreamChunk[] = [];

  const reasoning = blocks
    .filter((block: any) => block?.type === "reasoning")
    .map((block: any) => String(block.reasoning ?? ""))
    .join("");
  const text = blocks
    .filter((block: any) => block?.type === "text")
    .map((block: any) => String(block.text ?? ""))
    .join("");

  if (reasoning) {
    chunks.push({ kind: "reasoning", delta: reasoning });
  }
  if (text) {
    chunks.push({ kind: "text", delta: text });
  }

  return chunks;
}

/**
 * Adapt the raw LangGraph `["messages" | "updates", ...]` stream into a typed
 * `AgentStreamChunk` stream for the application layer.
 */
export async function* adaptRawStream(
  raw: AsyncIterable<RawStreamEntry>,
): AsyncGenerator<AgentStreamChunk> {
  for await (const entry of raw) {
    for (const chunk of parseRawStreamChunk(entry)) {
      yield chunk;
    }
  }
}
