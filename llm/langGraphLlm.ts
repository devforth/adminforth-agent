import { Command } from "@langchain/langgraph";
import { HumanMessage } from "langchain";
import type { AgentRuntime } from "./agentRuntime.js";
import type { AgentModelFactory } from "./modelFactory.js";
import { detectUserLanguage, type PreviousUserMessage } from "../domain/languageDetect.js";
import { adaptRawStream, normalizeInterrupts } from "./streamAdapter.js";
import type { AgentModeCompletionAdapter, LlmPort, LlmStreamInput } from "../application/ports.js";
import type { AgentMessage, PendingInterrupt } from "../domain/turnTypes.js";

function toLangchainMessages(messages: AgentMessage[]) {
  return messages.map((message) => new HumanMessage(message.content));
}

/**
 * LangChain/LangGraph implementation of {@link LlmPort}. This is the single
 * place that knows about the agent graph, model construction, and the raw
 * stream shape; the application layer talks only to the port.
 */
export class LangGraphLlm implements LlmPort {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly modelFactory: AgentModelFactory,
  ) {}

  async streamTurn(input: LlmStreamInput) {
    const models = await this.modelFactory.create(input.completionAdapter);
    const runtimeInput =
      "resume" in input.input
        ? new Command({ resume: input.input.resume })
        : { messages: toLangchainMessages(input.input.messages) };

    const rawStream = await this.runtime.stream({
      models,
      systemPrompt: input.systemPrompt,
      input: runtimeInput as any,
      context: input.context,
      observability: input.observability,
      branchFromCheckpointId: input.branchFromCheckpointId,
    });

    return adaptRawStream(rawStream as AsyncIterable<any>);
  }

  detectLanguage(input: {
    completionAdapter: AgentModeCompletionAdapter;
    prompt: string;
    previousUserMessages: PreviousUserMessage[];
  }) {
    return detectUserLanguage(
      input.completionAdapter,
      input.prompt,
      input.previousUserMessages,
    );
  }

  async getPendingInterrupts(input: {
    completionAdapter: AgentModeCompletionAdapter;
    sessionId: string;
  }): Promise<PendingInterrupt[]> {
    const models = await this.modelFactory.create(input.completionAdapter);
    const raw = await this.runtime.getPendingInterrupts({ models, sessionId: input.sessionId });
    return normalizeInterrupts(raw);
  }

  async getLatestCheckpointId(input: {
    completionAdapter: AgentModeCompletionAdapter;
    sessionId: string;
  }): Promise<string | null> {
    const models = await this.modelFactory.create(input.completionAdapter);
    return this.runtime.getLatestCheckpointId({ models, sessionId: input.sessionId });
  }

  async resetThreadCheckpoints(input: {
    completionAdapter: AgentModeCompletionAdapter;
    sessionId: string;
  }): Promise<void> {
    await this.runtime.resetThreadCheckpoints(input.sessionId);
  }
}
