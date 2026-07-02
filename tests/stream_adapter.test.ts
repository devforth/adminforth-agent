import { parseRawStreamChunk } from '../llm/streamAdapter.js';

// Characterization tests for the raw LangGraph -> typed AgentStreamChunk conversion
// (the parsing that previously lived inside TurnStreamConsumer).

describe('parseRawStreamChunk', () => {
  it('extracts text deltas from model-node messages', () => {
    const out = parseRawStreamChunk([
      'messages',
      [{ content: [{ type: 'text', text: 'Hi' }] }, { langgraph_node: 'model' }],
    ]);
    expect(out).toEqual([{ kind: 'text', delta: 'Hi' }]);
  });

  it('emits reasoning before text within a single chunk', () => {
    const out = parseRawStreamChunk([
      'messages',
      [
        { content: [{ type: 'reasoning', reasoning: 'r' }, { type: 'text', text: 't' }] },
        { langgraph_node: 'model' },
      ],
    ]);
    expect(out).toEqual([
      { kind: 'reasoning', delta: 'r' },
      { kind: 'text', delta: 't' },
    ]);
  });

  it('reads token.contentBlocks as well as token.content', () => {
    const out = parseRawStreamChunk([
      'messages',
      [{ contentBlocks: [{ type: 'text', text: 'B' }] }, { langgraph_node: 'model_request' }],
    ]);
    expect(out).toEqual([{ kind: 'text', delta: 'B' }]);
  });

  it('drops tokens emitted by non-model nodes', () => {
    const out = parseRawStreamChunk([
      'messages',
      [{ content: [{ type: 'text', text: 'x' }] }, { langgraph_node: 'tools' }],
    ]);
    expect(out).toEqual([]);
  });

  it('surfaces interrupts from update entries with normalized descriptors', () => {
    const out = parseRawStreamChunk([
      'updates',
      { __interrupt__: [{ id: 'i1', value: { actionRequests: [{}, {}] } }] },
    ]);
    expect(out).toEqual([
      {
        kind: 'interrupt',
        interrupt: [{ id: 'i1', value: { actionRequests: [{}, {}] } }],
        descriptors: [{ id: 'i1', count: 2 }],
      },
    ]);
  });

  it('yields empty descriptors when the interrupt has no actionRequests', () => {
    const out = parseRawStreamChunk(['updates', { __interrupt__: [{ id: 'i1' }] }]);
    expect(out).toEqual([{ kind: 'interrupt', interrupt: [{ id: 'i1' }], descriptors: [] }]);
  });

  it('ignores non-interrupt update entries', () => {
    expect(parseRawStreamChunk(['updates', { someNode: {} }])).toEqual([]);
  });

  it('returns nothing for empty content', () => {
    expect(
      parseRawStreamChunk(['messages', [{ content: [] }, { langgraph_node: 'model' }]]),
    ).toEqual([]);
  });
});
