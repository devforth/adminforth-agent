import { HumanMessage } from 'langchain';
import { SteerBuffer } from '../domain/steerBuffer.js';
import { createSteerMiddleware } from '../llm/middleware/steerMiddleware.js';

describe('SteerBuffer', () => {
  it('buffers, counts, drains, and clears per session', () => {
    const buffer = new SteerBuffer();

    const first = buffer.add('s1', 'use table A');
    buffer.add('s1', 'and sort by date');

    expect(first).toMatchObject({ text: 'use table A' });
    expect(typeof first.id).toBe('string');
    expect(buffer.size('s1')).toBe(2);

    const drained = buffer.drain('s1');
    expect(drained.map((m) => m.text)).toEqual(['use table A', 'and sort by date']);
    expect(buffer.size('s1')).toBe(0);
    // Draining is idempotent-empty afterwards.
    expect(buffer.drain('s1')).toEqual([]);
  });

  it('keeps sessions isolated and supports explicit clear', () => {
    const buffer = new SteerBuffer();
    buffer.add('s1', 'a');
    buffer.add('s2', 'b');

    expect(buffer.size('s1')).toBe(1);
    expect(buffer.size('s2')).toBe(1);

    buffer.clear('s1');
    expect(buffer.size('s1')).toBe(0);
    expect(buffer.size('s2')).toBe(1);
    expect(buffer.drain('s2').map((m) => m.text)).toEqual(['b']);
  });
});

describe('createSteerMiddleware beforeModel', () => {
  function runtimeWith(context: { sessionId: string; emit?: (event: any) => void }) {
    return { context } as any;
  }

  it('is a no-op (no messages, no emit) when nothing is buffered', async () => {
    const buffer = new SteerBuffer();
    const middleware = createSteerMiddleware(buffer);
    const events: any[] = [];

    const result = await middleware.beforeModel!(
      {} as any,
      runtimeWith({ sessionId: 's1', emit: (e) => events.push(e) }),
    );

    expect(result).toBeUndefined();
    expect(events).toEqual([]);
  });

  it('drains buffered steers into user messages and emits steer-applied', async () => {
    const buffer = new SteerBuffer();
    const a = buffer.add('s1', 'focus on 2024 orders');
    const b = buffer.add('s1', 'ignore refunds');
    const middleware = createSteerMiddleware(buffer);
    const events: any[] = [];

    const result: any = await middleware.beforeModel!(
      {} as any,
      runtimeWith({ sessionId: 's1', emit: (e) => events.push(e) }),
    );

    // Injected as HumanMessages carrying the steer text, in order.
    expect(result.messages).toHaveLength(2);
    expect(result.messages.every((m: unknown) => HumanMessage.isInstance(m))).toBe(true);
    expect(String(result.messages[0].content)).toContain('focus on 2024 orders');
    expect(String(result.messages[1].content)).toContain('ignore refunds');

    // Signals on the turn stream, and the buffer is now empty.
    expect(events).toEqual([{ type: 'steer-applied', count: 2, ids: [a.id, b.id] }]);
    expect(buffer.size('s1')).toBe(0);
  });

  it('only drains the targeted session', async () => {
    const buffer = new SteerBuffer();
    buffer.add('s1', 'for s1');
    buffer.add('s2', 'for s2');
    const middleware = createSteerMiddleware(buffer);

    const result: any = await middleware.beforeModel!({} as any, runtimeWith({ sessionId: 's1' }));

    expect(result.messages).toHaveLength(1);
    expect(String(result.messages[0].content)).toContain('for s1');
    expect(buffer.size('s2')).toBe(1);
  });

  // Regression: LangChain runs `beforeModel` as its own graph node and filters
  // `runtime.context` down to only the keys named in the middleware's OWN
  // `contextSchema` (MiddlewareNode.invokeMiddleware). Without a schema declaring
  // `sessionId`, the hook received `{}` and drained the buffer for `undefined`,
  // silently dropping every steer. This reproduces that filtering step.
  it('declares a contextSchema that lets sessionId survive the framework filter', async () => {
    const buffer = new SteerBuffer();
    buffer.add('s1', 'for s1');
    const middleware: any = createSteerMiddleware(buffer);

    const schema = middleware.contextSchema;
    expect(schema).toBeDefined();

    // Mirror MiddlewareNode.invokeMiddleware: keep only schema keys, then parse.
    const fullContext: Record<string, unknown> = {
      sessionId: 's1',
      turnId: 't1',
      adminUser: {},
      userTimeZone: 'UTC',
      emit: () => {},
    };
    const relevant: Record<string, unknown> = {};
    for (const key of Object.keys(schema.shape)) {
      if (key in fullContext) relevant[key] = fullContext[key];
    }
    const filtered = schema.parse(relevant);
    expect(filtered.sessionId).toBe('s1');

    // And the drained buffer is keyed by that surviving sessionId.
    const result: any = await middleware.beforeModel!({} as any, { context: filtered });
    expect(result.messages).toHaveLength(1);
    expect(String(result.messages[0].content)).toContain('for s1');
  });
});
