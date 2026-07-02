import { createSseEventEmitter } from '../surfaces/web-sse/createSseEventEmitter.js';

// Characterization tests for the outbound SSE wire contract. This is the plugin's
// external streaming protocol (consumed by the Vercel-AI-UI frontend on /agent/response
// and by the plain-SSE speech client on /agent/speech-response). These tests freeze the
// exact frame sequence and shapes — including the known dialect inconsistencies — so a
// refactor can be verified against them.

type Frame = Record<string, any>;

function createFakeRes() {
  const raw: string[] = [];
  return {
    writableEnded: false,
    destroyed: false,
    status: 0,
    headers: {} as Record<string, string>,
    writeHead(status: number, headers: Record<string, string>) {
      this.status = status;
      this.headers = headers;
    },
    write(chunk: string) {
      raw.push(chunk);
      return true;
    },
    end() {
      this.writableEnded = true;
    },
    raw,
  };
}

// Each SSE frame is written as `data: <payload>\n\n`. Returns parsed JSON payloads,
// with the terminal `[DONE]` sentinel represented as the string 'DONE'.
function frames(res: ReturnType<typeof createFakeRes>): Array<Frame | 'DONE'> {
  return res.raw
    .join('')
    .split('\n\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .map((payload) => (payload === '[DONE]' ? 'DONE' : (JSON.parse(payload) as Frame)));
}

function types(res: ReturnType<typeof createFakeRes>): string[] {
  return frames(res).map((f) => (f === 'DONE' ? 'DONE' : f.type));
}

describe('adminforth-agent SSE event emitter', () => {
  it('commits 200 + event-stream headers with the vercel marker in AI-UI mode', () => {
    const res = createFakeRes();
    createSseEventEmitter(res as any, { vercelAiUiMessageStream: true });
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['Cache-Control']).toBe('no-cache');
    expect(res.headers['x-vercel-ai-ui-message-stream']).toBe('v1');
  });

  it('omits the vercel marker header in default (non-AI-UI) mode', () => {
    const res = createFakeRes();
    createSseEventEmitter(res as any);
    expect(res.status).toBe(200);
    expect(res.headers['x-vercel-ai-ui-message-stream']).toBeUndefined();
  });

  it('produces the full text-turn frame sequence (start, text block, response, finish, DONE)', async () => {
    const res = createFakeRes();
    const emit = createSseEventEmitter(res as any, { vercelAiUiMessageStream: true });

    await emit({ type: 'turn-started', messageId: 'm1' });
    await emit({ type: 'text-delta', delta: 'Hello' });
    await emit({ type: 'text-delta', delta: ' world' });
    await emit({ type: 'response', text: 'Hello world', sessionId: 's1', turnId: 't1' });
    await emit({ type: 'finish' });

    // Note: `response` does NOT close the open text block, so `text-end` lands AFTER
    // `data-response`. This ordering quirk is intentionally frozen here.
    expect(types(res)).toEqual([
      'start',
      'text-start',
      'text-delta',
      'text-delta',
      'data-response',
      'text-end',
      'finish',
      'DONE',
    ]);

    const parsed = frames(res).filter((f): f is Frame => f !== 'DONE');
    const textStart = parsed.find((f) => f.type === 'text-start')!;
    const textDeltas = parsed.filter((f) => f.type === 'text-delta');
    expect(textDeltas.map((f) => f.delta)).toEqual(['Hello', ' world']);
    // All deltas + the closing end share the block id opened by text-start.
    expect(textDeltas.every((f) => f.id === textStart.id)).toBe(true);
    expect(parsed.find((f) => f.type === 'text-end')!.id).toBe(textStart.id);
    expect(parsed.find((f) => f.type === 'data-response')!.data).toEqual({
      text: 'Hello world',
      sessionId: 's1',
      turnId: 't1',
    });
    expect(res.writableEnded).toBe(true);
  });

  it('closes the active text block before a tool-call when configured', async () => {
    const res = createFakeRes();
    const emit = createSseEventEmitter(res as any, {
      vercelAiUiMessageStream: true,
      closeActiveBlockOnToolStart: true,
    });

    await emit({ type: 'text-delta', delta: 'thinking' });
    await emit({
      type: 'tool-call',
      data: { toolCallId: 'c1', toolName: 'get_resource', toolInfo: 'x', phase: 'start', input: '{}' },
    });
    await emit({ type: 'finish' });

    expect(types(res)).toEqual([
      'text-start',
      'text-delta',
      'text-end',
      'data-tool-call',
      'finish',
      'DONE',
    ]);
  });

  it('opens a reasoning block for reasoning deltas', async () => {
    const res = createFakeRes();
    const emit = createSseEventEmitter(res as any, { vercelAiUiMessageStream: true });
    await emit({ type: 'reasoning-delta', delta: 'hmm' });
    const parsed = frames(res).filter((f): f is Frame => f !== 'DONE');
    expect(parsed.map((f) => f.type)).toEqual(['reasoning-start', 'reasoning-delta']);
    expect(parsed[1].delta).toBe('hmm');
  });

  it('uses errorText in AI-UI mode', async () => {
    const res = createFakeRes();
    const emit = createSseEventEmitter(res as any, { vercelAiUiMessageStream: true });
    await emit({ type: 'error', error: 'boom' });
    expect(frames(res)[0]).toEqual({ type: 'error', errorText: 'boom' });
  });

  it('uses bare event names and the `error` field in default (non-AI-UI) mode', async () => {
    const res = createFakeRes();
    const emit = createSseEventEmitter(res as any);
    await emit({ type: 'response', text: 'hi', sessionId: 's', turnId: 't' });
    await emit({ type: 'open-page', targetPath: '/x' });
    await emit({ type: 'error', error: 'oops' });

    const parsed = frames(res).filter((f): f is Frame => f !== 'DONE');
    expect(parsed.map((f) => f.type)).toEqual(['response', 'open-page', 'error']);
    expect(parsed[0]).toEqual({ type: 'response', data: { text: 'hi', sessionId: 's', turnId: 't' } });
    expect(parsed[1]).toEqual({ type: 'open-page', data: { targetPath: '/x' } });
    expect(parsed[2]).toEqual({ type: 'error', error: 'oops' });
  });

  it('never writes after end() (guards against closed stream)', async () => {
    const res = createFakeRes();
    const emit = createSseEventEmitter(res as any, { vercelAiUiMessageStream: true });
    await emit({ type: 'finish' });
    const countAfterFinish = res.raw.length;
    await emit({ type: 'text-delta', delta: 'late' });
    expect(res.raw.length).toBe(countAfterFinish);
  });
});
