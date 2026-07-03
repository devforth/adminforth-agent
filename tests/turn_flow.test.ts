import { RunTurnUseCase, buildResumeValue } from '../application/runTurnUseCase.js';
import { SteerBuffer } from '../domain/steerBuffer.js';
import type { AgentStreamChunk } from '../domain/turnTypes.js';

// Characterization tests for the turn-orchestration flow (the layer between the HTTP
// endpoint and the LLM). We drive the REAL RunTurnUseCase, faking only the two true
// boundaries: the LlmPort (a scripted typed stream) and the session repository. This
// freezes the emitted AgentEvent sequence, persistence, error/abort handling, and the
// HITL approve -> resume path without a real LLM or database.

async function* streamOf(...chunks: AgentStreamChunk[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

const text = (delta: string): AgentStreamChunk => ({ kind: 'text', delta });
const reasoning = (delta: string): AgentStreamChunk => ({ kind: 'reasoning', delta });
const interrupt = (
  value: unknown,
  descriptors: Array<{ id: string; count: number }> = [{ id: 'int-1', count: 1 }],
): AgentStreamChunk => ({ kind: 'interrupt', interrupt: value, descriptors });

function fakeLlm(
  opts: {
    streamFor?: (call: number, input: any) => AsyncIterable<AgentStreamChunk>;
    pendingInterrupts?: Array<{ id: string; count: number }>;
    pendingInterruptsError?: Error;
  } = {},
) {
  const calls: any[] = [];
  const getPendingInterruptsCalls: any[] = [];
  return {
    calls,
    getPendingInterruptsCalls,
    async streamTurn(input: any) {
      calls.push(input);
      const factory = opts.streamFor ?? (() => streamOf());
      return factory(calls.length, input);
    },
    async detectLanguage() {
      return null;
    },
    async getPendingInterrupts(input: any) {
      getPendingInterruptsCalls.push(input);
      if (opts.pendingInterruptsError) {
        throw opts.pendingInterruptsError;
      }
      return opts.pendingInterrupts ?? [];
    },
  };
}

function fakeSessions(opts: { initialResponse?: string } = {}) {
  const calls = {
    createNewTurn: [] as any[],
    touchSession: [] as string[],
    saveTurnResponse: [] as any[],
    getResumeState: 0,
  };
  return {
    calls,
    async getPreviousUserMessages() {
      return [];
    },
    async createNewTurn(sessionId: string, prompt: string) {
      calls.createNewTurn.push({ sessionId, prompt });
      return 'turn-1';
    },
    async touchSession(sessionId: string) {
      calls.touchSession.push(sessionId);
    },
    async getResumeState() {
      calls.getResumeState += 1;
      return { turnId: 'turn-1', initialResponse: opts.initialResponse ?? '' };
    },
    async saveTurnResponse(payload: any) {
      calls.saveTurnResponse.push(payload);
    },
  };
}

function buildUseCase(opts: {
  streamFor?: (call: number, input: any) => AsyncIterable<AgentStreamChunk>;
  initialResponse?: string;
  pendingInterrupts?: Array<{ id: string; count: number }>;
  pendingInterruptsError?: Error;
  hasPersistentCheckpointer?: boolean;
} = {}) {
  const llm = fakeLlm({
    streamFor: opts.streamFor,
    pendingInterrupts: opts.pendingInterrupts,
    pendingInterruptsError: opts.pendingInterruptsError,
  });
  const sessions = fakeSessions({ initialResponse: opts.initialResponse });
  const steerBuffer = new SteerBuffer();
  const useCase = new RunTurnUseCase({
    llm: llm as any,
    sessions: sessions as any,
    steerBuffer,
    modes: [{ name: 'default', completionAdapter: {} as any }],
    getAdminforth: () => ({ config: { auth: { usernameField: 'email' }, baseUrlSlashed: '/admin/' } }) as any,
    getAgentSystemPrompt: async () => 'SYS',
    hasPersistentCheckpointer: opts.hasPersistentCheckpointer ?? false,
    createDebugSink: () => ({ flush() {}, getHistory: () => [] }),
  });
  return { useCase, llm, sessions, steerBuffer };
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

describe('RunTurnUseCase.handleTurn', () => {
  it('streams a text turn, emits response/finish, and persists the assembled text', async () => {
    const { useCase, llm, sessions } = buildUseCase({
      streamFor: () => streamOf(text('Hello'), text(' world')),
    });
    const { input, events } = makeInput();

    const result = await useCase.handleTurn(input as any);

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
    expect(sessions.calls.saveTurnResponse[0]).toMatchObject({ turnId: 'turn-1', responseText: 'Hello world' });
    expect(sessions.calls.touchSession).toEqual(['s1']);
    expect(llm.calls).toHaveLength(1);
    expect('messages' in llm.calls[0].input).toBe(true);
  });

  it('emits reasoning deltas but excludes reasoning from the persisted response', async () => {
    const { useCase, sessions } = buildUseCase({
      streamFor: () => streamOf(reasoning('thinking...'), text('Answer')),
    });
    const { input, events } = makeInput();

    await useCase.handleTurn(input as any);

    expect(events.some((e) => e.type === 'reasoning-delta' && e.delta === 'thinking...')).toBe(true);
    expect(events.find((e) => e.type === 'response').text).toBe('Answer');
    expect(sessions.calls.saveTurnResponse[0].responseText).toBe('Answer');
  });

  it('turns an LLM failure into an error event and persists the message as the response (current behavior)', async () => {
    const { useCase, sessions } = buildUseCase({
      streamFor: () => {
        throw new Error('llm exploded');
      },
    });
    const { input, events } = makeInput();

    const result = await useCase.handleTurn(input as any);

    expect(events.map((e) => e.type)).toEqual(['turn-started', 'error', 'finish']);
    expect(result.failed).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.text).toContain('llm exploded');
    expect(events.find((e) => e.type === 'error').error).toContain('llm exploded');
    expect(sessions.calls.saveTurnResponse[0].responseText).toContain('llm exploded');
  });

  it('handles a client abort without emitting response/error and still finalizes the turn', async () => {
    const controller = new AbortController();
    controller.abort();
    const { useCase, sessions } = buildUseCase({
      streamFor: () => streamOf(text('partial')),
    });
    const { input, events } = makeInput({ abortSignal: controller.signal });

    const result = await useCase.handleTurn(input as any);

    expect(result.aborted).toBe(true);
    expect(result.failed).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['turn-started', 'finish']);
    expect(sessions.calls.saveTurnResponse).toHaveLength(1);
  });

  it('emits a HITL interrupt and resumes via a provider-agnostic resume payload on approval', async () => {
    const { useCase, llm, sessions } = buildUseCase({
      initialResponse: 'prev ',
      streamFor: (call) =>
        call === 1
          ? streamOf(
              interrupt([
                { id: 'int-1', value: { actionRequests: [{ name: 'delete_record', description: 'Delete row' }] } },
              ]),
            )
          : streamOf(text('Done')),
    });

    const first = makeInput();
    await useCase.handleTurn(first.input as any);

    expect(first.events.map((e) => e.type)).toEqual(['turn-started', 'interrupt', 'response', 'finish']);
    expect(first.events.find((e) => e.type === 'interrupt').sessionId).toBe('s1');

    const second = makeInput({ prompt: '', approvalDecision: 'approve' });
    const result = await useCase.handleTurn(second.input as any);

    expect(sessions.calls.getResumeState).toBe(1);
    expect(llm.calls).toHaveLength(2);
    expect('messages' in llm.calls[1].input).toBe(false);
    expect('resume' in llm.calls[1].input).toBe(true);
    // initialResponse ('prev ') is prepended to the resumed streamed text.
    expect(result.text).toBe('prev Done');
    expect(second.events.find((e) => e.type === 'response').text).toBe('prev Done');
  });

  it('clears unconsumed steers when a turn completes (they must not leak into the next turn)', async () => {
    const { useCase, steerBuffer } = buildUseCase({
      streamFor: () => streamOf(text('done')),
    });
    // Steer enqueued but the (faked) LLM stream never drains it — e.g. it arrived after the
    // last model call. On turn completion the leftover must be discarded.
    steerBuffer.add('s1', 'too late');
    expect(steerBuffer.size('s1')).toBe(1);

    await useCase.handleTurn(makeInput().input as any);

    expect(steerBuffer.size('s1')).toBe(0);
  });

  it('preserves steers across a HITL interrupt and clears them after the resumed turn ends', async () => {
    const { useCase, steerBuffer } = buildUseCase({
      streamFor: (call) =>
        call === 1
          ? streamOf(interrupt([{ id: 'int-1', value: {} }]))
          : streamOf(text('done')),
    });

    // A steer sent while the turn is paused for approval must survive the interrupted turn...
    steerBuffer.add('s1', 'while waiting for approval');
    await useCase.handleTurn(makeInput().input as any);
    expect(steerBuffer.size('s1')).toBe(1);

    // ...and be cleared once the resumed turn finishes.
    await useCase.handleTurn(makeInput({ prompt: '', approvalDecision: 'approve' }).input as any);
    expect(steerBuffer.size('s1')).toBe(0);
  });

  it('with a persistent checkpointer, resumes from checkpoint state (ignoring the local cache)', async () => {
    const { useCase, llm } = buildUseCase({
      hasPersistentCheckpointer: true,
      initialResponse: 'prev ',
      pendingInterrupts: [{ id: 'int-1', count: 1 }],
      streamFor: () => streamOf(text('Resumed')),
    });
    // No interrupt cached in this process (restart / other instance); the checkpoint is authoritative.
    const { input } = makeInput({ prompt: '', approvalDecision: 'approve' });
    const result = await useCase.handleTurn(input as any);

    expect(llm.getPendingInterruptsCalls).toHaveLength(1);
    expect(llm.calls).toHaveLength(1);
    expect('resume' in llm.calls[0].input).toBe(true);
    expect(result.text).toBe('prev Resumed');
  });

  it('surfaces a checkpoint read failure as a real error, not "no pending approval"', async () => {
    const { useCase } = buildUseCase({
      hasPersistentCheckpointer: true,
      pendingInterruptsError: new Error('checkpoint DB unavailable'),
    });
    const { input } = makeInput({ prompt: '', approvalDecision: 'approve' });

    // The infra error must propagate, NOT be masked as a missing interrupt.
    await expect(useCase.handleTurn(input as any)).rejects.toThrow('checkpoint DB unavailable');
    await expect(useCase.handleTurn(input as any)).rejects.not.toThrow('No pending approval');
  });

  it('rejects (does not swallow) an approval with no pending interrupt, after emitting turn-started', async () => {
    const { useCase } = buildUseCase();
    const { input, events } = makeInput({ prompt: '', approvalDecision: 'approve' });
    // prepareTurn() runs BEFORE the try/catch in runAndPersistAgentResponse, so — unlike an
    // LLM failure during streaming — this error propagates out of handleTurn instead of
    // becoming a `failed` result. turn-started has already been emitted by then.
    await expect(useCase.handleTurn(input as any)).rejects.toThrow('No pending approval interrupt');
    expect(events.map((e) => e.type)).toEqual(['turn-started']);
  });
});

describe('buildResumeValue', () => {
  it('fans a single approval across the recorded interrupt count', () => {
    expect(buildResumeValue({ decision: 'approve', interrupts: [{ id: 'a', count: 2 }] })).toEqual({
      decisions: [{ type: 'approve' }, { type: 'approve' }],
    });
  });

  it('keys resume payloads by interrupt id when there are multiple', () => {
    const value = buildResumeValue({
      decision: 'reject',
      interrupts: [{ id: 'a', count: 1 }, { id: 'b', count: 1 }],
      prompt: 'do this instead',
    }) as Record<string, any>;
    expect(Object.keys(value)).toEqual(['a', 'b']);
    expect(value.a.decisions[0]).toMatchObject({ type: 'reject' });
    expect(value.a.decisions[0].message).toContain('do this instead');
  });

  it('throws when there is no interrupt to resume', () => {
    expect(() => buildResumeValue({ decision: 'approve', interrupts: [] })).toThrow('No pending approval interrupt');
  });
});
