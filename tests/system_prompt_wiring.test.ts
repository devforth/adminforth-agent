import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { MemorySaver } from '@langchain/langgraph';
import { AgentRuntime } from '../llm/agentRuntime.js';
import { SteerBuffer } from '../domain/steerBuffer.js';
import { createSequenceDebugCollector } from '../llm/middleware/sequenceDebug.js';

// Integration test for how the system prompt reaches the model. It drives the REAL
// AgentRuntime — real middleware stack, real checkpointer — and records the exact
// message list the model is invoked with. Three things are frozen here, none of them
// visible from unit tests of the prompt builders:
//
//  1. The prompt never enters the graph's message state. It used to be pushed there
//     once per turn, so a session's Nth model call saw N stacked copies of it.
//  2. The static and per-turn halves arrive as two separate content blocks, static
//     first, with the static one byte-identical across every turn of a session.
//  3. The agent attaches no provider metadata of its own. Marking that block boundary
//     (e.g. as an Anthropic cache breakpoint) is the adapter's job, done through the
//     middleware its `getLangChainAgentSpec` returns.

class RecordingModel extends BaseChatModel {
  readonly invocations: BaseMessage[][] = [];
  /** Call options the agent bound to the model — where `modelSettings` ends up. */
  readonly boundOptions: any[] = [];

  _llmType() {
    return 'recording';
  }

  _combineLLMOutput() {
    return [];
  }

  bindTools(_tools: unknown, options?: any) {
    this.boundOptions.push(options);
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.invocations.push(messages);
    const message = new AIMessage({ content: 'ok' });
    return { generations: [{ text: 'ok', message }], llmOutput: {} };
  }
}

/**
 * Stands in for a provider adapter's middleware — shaped like the real one in
 * @adminforth/completion-adapter-anthropic-messages, which marks the static system block
 * and sets a model setting for the conversation tail. Used here only to prove both hooks
 * are reachable from where adapters run; the plugin must not depend on any provider.
 */
function markerMiddleware() {
  return {
    name: 'TestBlockMarkerMiddleware',
    async wrapModelCall(request: any, handler: (r: any) => unknown) {
      const content = request.systemMessage?.content;
      if (!Array.isArray(content) || content.length === 0) {
        return handler(request);
      }
      const blocks = content as Array<Record<string, any>>;
      return handler({
        ...request,
        systemMessage: {
          ...request.systemMessage,
          content: [{ ...blocks[0], marked: true }, ...blocks.slice(1)],
        },
        modelSettings: { ...request.modelSettings, marker_setting: 'tail' },
      });
    },
  };
}

function buildRuntime(opts: { adapterMiddleware?: boolean } = {}) {
  const model = new RecordingModel({});
  const checkpointer = new MemorySaver();
  const runtime = new AgentRuntime({
    name: 'test-agent',
    getAdminforth: () =>
      ({ config: { auth: { usernameField: 'email' }, baseUrlSlashed: '/admin/' } }) as any,
    getCheckpointer: () => checkpointer,
    toolProvider: {
      getApiBasedTools: () => ({}),
      getTools: async () => [],
    } as any,
    steerBuffer: new SteerBuffer(),
  });

  async function run(input: {
    sessionId: string;
    systemPrompt: string;
    messages: BaseMessage[];
    userLanguage?: unknown;
    chatSurface?: string;
  }) {
    const stream = await runtime.stream({
      models: {
        model: model as any,
        summaryModel: model as any,
        modelMiddleware: opts.adapterMiddleware ? [markerMiddleware() as any] : undefined,
      },
      systemPrompt: input.systemPrompt,
      input: { messages: input.messages } as any,
      context: {
        adminUser: { pk: 'u1', dbUser: { email: 'admin@x.io' } } as any,
        userTimeZone: 'UTC',
        sessionId: input.sessionId,
        turnId: 't1',
        userLanguage: input.userLanguage as any,
        chatSurface: input.chatSurface,
      },
      observability: { sequenceDebugSink: createSequenceDebugCollector() },
    });
    // Drain the stream so the graph runs to completion.
    for await (const _ of stream as AsyncIterable<unknown>) {
      // no-op
    }
  }

  return { model, run };
}

const systemMessagesOf = (messages: BaseMessage[]) =>
  messages.filter((m) => SystemMessage.isInstance(m));

const blocksOf = (messages: BaseMessage[]) =>
  systemMessagesOf(messages)[0].content as Array<Record<string, any>>;

describe('system prompt wiring', () => {
  it('sends one system message: static block first, per-turn block after', async () => {
    const { model, run } = buildRuntime();

    await run({
      sessionId: 's1',
      systemPrompt: 'STATIC_PROMPT',
      messages: [new HumanMessage('hi')],
      userLanguage: { language: 'Ukrainian', code: 'UK', ambiguous: false },
      chatSurface: 'telegram',
    });

    expect(systemMessagesOf(model.invocations[0])).toHaveLength(1);

    const blocks = blocksOf(model.invocations[0]);
    expect(blocks).toHaveLength(2);
    // The static half arrives verbatim and unadorned — no provider metadata added here.
    expect(blocks[0]).toEqual({ type: 'text', text: 'STATIC_PROMPT' });
    expect(blocks[1].text).toContain('admin@x.io');
    expect(blocks[1].text).toContain('Respond in Ukrainian (UK).');
    expect(blocks[1].text).toContain('Current chat surface: telegram');
    // Only the user message is in the history.
    expect(model.invocations[0].filter((m) => HumanMessage.isInstance(m)).map((m) => m.text))
      .toEqual(['hi']);
  });

  it('does not accumulate the prompt across turns of the same session', async () => {
    const { model, run } = buildRuntime();

    for (const prompt of ['first', 'second', 'third']) {
      await run({
        sessionId: 's1',
        systemPrompt: 'STATIC_PROMPT',
        messages: [new HumanMessage(prompt)],
        userLanguage: { language: 'English', code: 'EN', ambiguous: false },
      });
    }

    expect(model.invocations).toHaveLength(3);
    for (const invocation of model.invocations) {
      expect(systemMessagesOf(invocation)).toHaveLength(1);
      const blocks = blocksOf(invocation);
      expect(blocks).toHaveLength(2);
      // One copy of the static half, unchanged, on every call — this is what makes it
      // a cacheable prefix for adapters that mark it.
      expect(blocks[0]).toEqual({ type: 'text', text: 'STATIC_PROMPT' });
      expect(blocks[1].text.match(/admin@x\.io/g)).toHaveLength(1);
    }
    // The conversation itself still accumulates, as it should.
    expect(model.invocations[2].filter((m) => HumanMessage.isInstance(m)).map((m) => m.text))
      .toEqual(['first', 'second', 'third']);
  });

  it('rebuilds the per-turn block when the language changes mid-session', async () => {
    const { model, run } = buildRuntime();

    await run({
      sessionId: 's1',
      systemPrompt: 'STATIC_PROMPT',
      messages: [new HumanMessage('привіт')],
      userLanguage: { language: 'Ukrainian', code: 'UK', ambiguous: false },
    });
    await run({
      sessionId: 's1',
      systemPrompt: 'STATIC_PROMPT',
      messages: [new HumanMessage('now in english')],
      userLanguage: { language: 'English', code: 'EN', ambiguous: false },
    });

    // The second call must carry the new instruction only — no stale contradiction.
    const second = blocksOf(model.invocations[1])[1].text;
    expect(second).toContain('Respond in English (EN).');
    expect(second).not.toContain('Ukrainian');
  });

  it('exposes the block boundary to adapter middleware, which sees both halves in place', async () => {
    const { model, run } = buildRuntime({ adapterMiddleware: true });

    for (const prompt of ['first', 'second']) {
      await run({
        sessionId: 's1',
        systemPrompt: 'STATIC_PROMPT',
        messages: [new HumanMessage(prompt)],
        userLanguage: null,
      });
    }

    for (const invocation of model.invocations) {
      const blocks = blocksOf(invocation);
      // Adapter middleware runs inside the dynamic-prompt one, so both blocks already
      // exist by the time it can mark the static one.
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toEqual({ type: 'text', text: 'STATIC_PROMPT', marked: true });
      // The volatile half must stay outside whatever the adapter marks.
      expect(blocks[1].marked).toBeUndefined();
    }

    // The adapter's other hook: `modelSettings` must survive to the model's bound call
    // options. The Anthropic adapter puts its conversation-tail cache breakpoint there,
    // because ChatAnthropic reads it at the final payload-formatting layer.
    expect(model.boundOptions.at(-1)).toMatchObject({ marker_setting: 'tail' });
  });

  it('drops system messages left in pre-refactor checkpoints instead of replaying them', async () => {
    const { model, run } = buildRuntime();

    // Simulate a thread checkpointed by the old code, which seeded the history with the
    // turn's full system prompt. Replaying it would be a stale duplicate — and a hard
    // error on providers that only accept a system message in first position.
    await run({
      sessionId: 's1',
      systemPrompt: 'STATIC_PROMPT',
      messages: [new SystemMessage('STALE_PROMPT_FROM_OLD_CHECKPOINT'), new HumanMessage('hi')],
      userLanguage: null,
    });
    await run({
      sessionId: 's1',
      systemPrompt: 'STATIC_PROMPT',
      messages: [new HumanMessage('again')],
      userLanguage: null,
    });

    for (const invocation of model.invocations) {
      expect(systemMessagesOf(invocation)).toHaveLength(1);
      expect(systemMessagesOf(invocation)[0].text).not.toContain('STALE_PROMPT_FROM_OLD_CHECKPOINT');
    }
  });
});
