import { VegaLiteStreamBuffer } from '../domain/vegaLiteStreamBuffer.js';
import { isAbortError, getErrorMessage } from '../shared/errors.js';
import { sanitizeSpeechText } from '../shared/sanitizeSpeechText.js';
import { detectUserLanguage } from '../domain/languageDetect.js';
import { createToolCallTracker } from '../domain/toolCallEvents.js';

// Characterization tests for the small, deterministic building blocks used across the
// main flows: the vega-lite streaming buffer, error helpers, speech-text sanitizer,
// mode resolver, language detection, and the tool-call event tracker.

describe('VegaLiteStreamBuffer', () => {
  function collector() {
    const events: any[] = [];
    return { events, emit: async (e: any) => void events.push(e) };
  }

  it('streams plain text deltas through without rendering events', async () => {
    const buf = new VegaLiteStreamBuffer();
    const { events, emit } = collector();
    await buf.push('Hello ', emit);
    await buf.push('world', emit);
    await buf.flush(emit);

    expect(events.filter((e) => e.type === 'text-delta').map((e) => e.delta).join('')).toBe('Hello world');
    expect(events.some((e) => e.type === 'rendering')).toBe(false);
  });

  it('buffers an unclosed vega-lite block and brackets it with rendering start/end', async () => {
    const buf = new VegaLiteStreamBuffer();
    const { events, emit } = collector();

    await buf.push('```vega-lite\n{"x":1}', emit); // still open
    expect(events.map((e) => e.type)).toEqual(['rendering']);
    expect(events[0]).toMatchObject({ phase: 'start' });

    events.length = 0;
    await buf.push('\n```\n', emit); // closes the block
    expect(events.find((e) => e.type === 'rendering')).toMatchObject({ phase: 'end' });
    const streamed = events.filter((e) => e.type === 'text-delta').map((e) => e.delta).join('');
    expect(streamed).toContain('```vega-lite');
    expect(streamed).toContain('{"x":1}');
  });

  it('holds back a partial fence prefix until it resolves', async () => {
    const buf = new VegaLiteStreamBuffer();
    const { events, emit } = collector();

    await buf.push('Hi ```', emit);
    // "Hi " is streamable; the trailing "```" (a possible fence start) is held back.
    expect(events.filter((e) => e.type === 'text-delta').map((e) => e.delta).join('')).toBe('Hi ');

    await buf.flush(emit);
    expect(events.filter((e) => e.type === 'text-delta').map((e) => e.delta).join('')).toBe('Hi ```');
  });
});

describe('error helpers', () => {
  it('getErrorMessage extracts Error.message or stringifies', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage('plain')).toBe('plain');
    expect(getErrorMessage(123)).toBe('123');
  });

  it('isAbortError recognizes abort error names only', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError({ name: 'APIUserAbortError' })).toBe(true);
    expect(isAbortError(new Error('nope'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});

describe('sanitizeSpeechText', () => {
  it('strips markdown, urls and inline code while keeping visible text', () => {
    const out = sanitizeSpeechText('# Title\nSee [docs](https://example.com/page) and `code` here.');
    expect(out).toContain('Title');
    expect(out).toContain('docs');
    expect(out).not.toContain('https://');
    expect(out).not.toContain('`');
    expect(out).not.toContain('[');
    expect(out.startsWith('#')).toBe(false);
    expect(out).not.toContain('  ');
  });

  it('removes fenced code blocks entirely', () => {
    const out = sanitizeSpeechText('Before ```js\ncode()\n``` after');
    expect(out).toContain('Before');
    expect(out).toContain('after');
    expect(out).not.toContain('code()');
  });
});

describe('detectUserLanguage', () => {
  it('parses the structured completion output', async () => {
    let captured: any;
    const adapter = {
      async complete(params: any) {
        captured = params;
        return { content: JSON.stringify({ language: 'Ukrainian', code: 'UK', ambiguous: false }) };
      },
    } as any;

    const lang = await detectUserLanguage(adapter, 'Привіт', []);

    expect(lang).toEqual({ language: 'Ukrainian', code: 'UK', ambiguous: false });
    expect(captured.content).toContain('Привіт');
    expect(captured.reasoningEffort).toBe('none');
  });

  it('returns null on adapter error', async () => {
    const adapter = { async complete() { return { error: 'boom' }; } } as any;
    expect(await detectUserLanguage(adapter, 'x', [])).toBeNull();
  });

  it('returns null on unparseable content', async () => {
    const adapter = { async complete() { return { content: 'not json' }; } } as any;
    expect(await detectUserLanguage(adapter, 'x', [])).toBeNull();
  });
});

describe('createToolCallTracker', () => {
  it('emits a start event then a success end event', () => {
    const events: any[] = [];
    const tracker = createToolCallTracker({
      emit: (e) => events.push(e),
      toolCallId: 'c1',
      toolName: 'get_resource',
      input: { resourceId: 'cars' },
      startedAt: Date.now(),
    });

    tracker.start();
    tracker.finishSuccess({ result: 'ok' });

    expect(events[0]).toMatchObject({ toolCallId: 'c1', toolName: 'get_resource', phase: 'start' });
    expect(events[0].input).toContain('resourceId');
    expect(events[1]).toMatchObject({ toolCallId: 'c1', phase: 'end', error: null });
    expect(events[1].output).toContain('result');
    expect(typeof events[1].durationMs).toBe('number');
  });

  it('emits an error end event with a serialized error', () => {
    const events: any[] = [];
    const tracker = createToolCallTracker({ emit: (e) => events.push(e), toolName: 'x' });
    tracker.start();
    tracker.finishError(new Error('bad tool'));

    expect(events[1]).toMatchObject({ phase: 'end', output: null });
    expect(events[1].error).toContain('bad tool');
  });
});
