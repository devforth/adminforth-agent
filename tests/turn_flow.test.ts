import { AgentTurnService } from '../agentTurnService.js';
import { TurnStreamConsumer } from '../agent/turn/TurnStreamConsumer.js';

// Characterization tests for the turn-orchestration flow (the layer between the HTTP
// endpoint and the LLM). We drive the REAL AgentTurnService + REAL TurnStreamConsumer,
// injecting fakes only for the outer collaborators (lifecycle / context / mode / model /
// prompt / runtime). The fake runtime yields a scripted LangGraph-shaped stream, so we
// freeze the emitted AgentEvent sequence, persistence, error/abort handling, and the
// HITL approve→resume path WITHOUT spinning up a real LLM.

async function* streamOf(...chunks: any[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// Shapes the real TurnStreamConsumer expects on the ['messages', ...] / ['updates', ...] stream.
function textChunk(text: string) {
  return ['messages', [{ content: [{ type: 'text', text }] }, { langgraph_node: 'model' }]];
}
function reasoningChunk(text: string) {
  return ['messages', [{ content: [{ type: 'reasoning', reasoning: text }] }, { langgraph_node: 'model' }]];
}
function interruptChunk(interrupts: unknown) {
  return ['updates', { __interrupt__: interrupts }];
}

type BuildOpts = {
  streamFor?: (callIndex: number, input: any) => AsyncIterable<any>;
  resumeInitialResponse?: string;
};

function buildService(opts: BuildOpts = {}) {
  const runtimeCalls: any[] = [];
  const finishCalls: any[] = [];
  const startCalls: any[] = [];
  const resumeCalls: any[] = [];

  const lifecycle = {
    async start(input: any) {
      startCalls.push(input);
      return { turnId: 'turn-1', previousUserMessages: [] };
    },
    async resume(input: any) {
      resumeCalls.push(input);
      return {
        turnId: 'turn-1',
        previousUserMessages: [],
        initialResponse: opts.resumeInitialResponse ?? '',
      };
    },
    async finish(payload: any) {
      finishCalls.push(payload);
    },
  };

  const contextBuilder = {
    async build({ base, turnId }: any) {
      return {
        adminUser: base.adminUser,
        sessionId: base.sessionId,
        turnId,
        abortSignal: base.abortSignal,
        userTimeZone: base.userTimeZone ?? 'UTC',
      };
    },
  };

  const modeResolver = { resolve: () => ({ name: 'default', completionAdapter: {} }) };
  const modelFactory = {
    async create() {
      return { model: {}, summaryModel: {}, modelMiddleware: [] };
    },
  };
  const promptBuilder = { async build() { return []; } };

  const runtime = {
    async stream(input: any) {
      runtimeCalls.push(input);
      const factory = opts.streamFor ?? (() => streamOf());
      return factory(runtimeCalls.length, input);
    },
  };

  const service = new AgentTurnService(
    lifecycle as any,
    contextBuilder as any,
    modeResolver as any,
    modelFactory as any,
    promptBuilder as any,
    runtime as any,
    new TurnStreamConsumer() as any,
  );

  return { service, runtimeCalls, finishCalls, startCalls, resumeCalls };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  const events: any[] = [];
  const input = {
    prompt: 'hi',
    sessionId: 's1',
    modeName: null,
    userTimeZone: 'UTC',
    adminUser: { pk: 'u1', username: 'admin', dbUser: { email: 'admin@x.io' } },
    emit: async (event: any) => {
      events.push(event);
    },
    failureLogMessage: 'fail',
    abortLogMessage: 'abort',
    ...overrides,
  };
  return { input, events };
}

describe('adminforth-agent turn flow (AgentTurnService.handleTurn)', () => {
  it('streams a text turn, emits response/finish, and persists the assembled text', async () => {
    const { service, finishCalls, runtimeCalls } = buildService({
      streamFor: () => streamOf(textChunk('Hello'), textChunk(' world')),
    });
    const { input, events } = makeInput();

    const result = await service.handleTurn(input as any);

    expect(events.map((e) => e.type)).toEqual([
      'turn-started',
      'text-delta',
      'text-delta',
      'response',
      'finish',
    ]);
    expect(events.filter((e) => e.type === 'text-delta').map((e) => e.delta).join('')).toBe('Hello world');
    expect(events.find((e) => e.type === 'response')).toMatchObject({
      text: 'Hello world',
      sessionId: 's1',
      turnId: 'turn-1',
    });
    expect(result).toMatchObject({ text: 'Hello world', turnId: 'turn-1', aborted: false, failed: false });
    expect(finishCalls[0]).toMatchObject({ turnId: 'turn-1', responseText: 'Hello world' });
    expect(runtimeCalls).toHaveLength(1);
    expect('messages' in runtimeCalls[0].input).toBe(true);
  });

  it('emits reasoning deltas but excludes reasoning from the persisted response', async () => {
    const { service, finishCalls } = buildService({
      streamFor: () => streamOf(reasoningChunk('thinking...'), textChunk('Answer')),
    });
    const { input, events } = makeInput();

    await service.handleTurn(input as any);

    expect(events.some((e) => e.type === 'reasoning-delta' && e.delta === 'thinking...')).toBe(true);
    expect(events.find((e) => e.type === 'response').text).toBe('Answer');
    expect(finishCalls[0].responseText).toBe('Answer');
  });

  it('turns an LLM failure into an error event and persists the message as the response (current behavior)', async () => {
    const { service, finishCalls } = buildService({
      streamFor: () => {
        throw new Error('llm exploded');
      },
    });
    const { input, events } = makeInput();

    const result = await service.handleTurn(input as any);

    expect(events.map((e) => e.type)).toEqual(['turn-started', 'error', 'finish']);
    expect(result.failed).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.text).toContain('llm exploded');
    expect(events.find((e) => e.type === 'error').error).toContain('llm exploded');
    expect(finishCalls[0].responseText).toContain('llm exploded');
  });

  it('handles a client abort without emitting response/error and still finalizes the turn', async () => {
    const controller = new AbortController();
    controller.abort();
    const { service, finishCalls } = buildService({
      streamFor: () => streamOf(textChunk('partial')),
    });
    const { input, events } = makeInput({ abortSignal: controller.signal });

    const result = await service.handleTurn(input as any);

    expect(result.aborted).toBe(true);
    expect(result.failed).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['turn-started', 'finish']);
    expect(finishCalls).toHaveLength(1);
  });

  it('emits a HITL interrupt and resumes via a langgraph Command on approval', async () => {
    const { service, runtimeCalls, resumeCalls } = buildService({
      resumeInitialResponse: 'prev ',
      streamFor: (callIndex) =>
        callIndex === 1
          ? streamOf(
              interruptChunk([
                { id: 'int-1', value: { actionRequests: [{ name: 'delete_record', description: 'Delete row' }] } },
              ]),
            )
          : streamOf(textChunk('Done')),
    });

    const first = makeInput();
    await service.handleTurn(first.input as any);

    expect(first.events.map((e) => e.type)).toEqual(['turn-started', 'interrupt', 'response', 'finish']);
    expect(first.events.find((e) => e.type === 'interrupt').sessionId).toBe('s1');

    const second = makeInput({ prompt: '', approvalDecision: 'approve' });
    const result = await service.handleTurn(second.input as any);

    expect(resumeCalls).toHaveLength(1);
    expect(runtimeCalls).toHaveLength(2);
    const resumeInput = runtimeCalls[1].input;
    expect('messages' in resumeInput).toBe(false);
    expect(resumeInput.constructor.name).toBe('Command');
    // initialResponse ('prev ') is prepended to the resumed streamed text.
    expect(result.text).toBe('prev Done');
    expect(second.events.find((e) => e.type === 'response').text).toBe('prev Done');
  });

  it('rejects (does not swallow) an approval with no pending interrupt, after emitting turn-started', async () => {
    const { service } = buildService();
    const { input, events } = makeInput({ prompt: '', approvalDecision: 'approve' });
    // prepareTurn() runs BEFORE the try/catch in runAndPersistAgentResponse, so — unlike an
    // LLM failure during streaming — this error propagates out of handleTurn instead of
    // becoming a `failed` result. turn-started has already been emitted by then.
    await expect(service.handleTurn(input as any)).rejects.toThrow('No pending approval interrupt');
    expect(events.map((e) => e.type)).toEqual(['turn-started']);
  });
});
