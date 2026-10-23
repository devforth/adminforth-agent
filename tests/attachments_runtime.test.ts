import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { MemorySaver } from '@langchain/langgraph';
import { AgentRuntime } from '../llm/agentRuntime.js';
import { SteerBuffer } from '../domain/steerBuffer.js';
import { createSequenceDebugCollector } from '../llm/middleware/sequenceDebug.js';
import { ATTACHMENT_URL_SCHEME, toHumanMessage } from '../llm/attachmentMessages.js';
import { AttachmentStore } from '../persistence/attachmentStore.js';

// Integration test for images in the REAL AgentRuntime — real middleware stack, real
// checkpointer. The model must get the image data, while the checkpoints and the debug
// trace keep only the storage key: checkpoints store the whole history on every step, so
// the data would otherwise be copied into each of them.

const KEY = 'agent-attachments/u1/0b6c5d5e-8f1a-4f4e-9a3b-2d3c4e5f6a7b.png';
const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

class RecordingModel extends BaseChatModel {
  readonly invocations: BaseMessage[][] = [];

  _llmType() {
    return 'recording';
  }

  _combineLLMOutput() {
    return [];
  }

  bindTools() {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.invocations.push(messages);
    const message = new AIMessage({ content: 'a chart' });
    return { generations: [{ text: 'a chart', message }], llmOutput: {} };
  }
}

async function runTurnWithImage() {
  const model = new RecordingModel({});
  const checkpointer = new MemorySaver();
  const readKeys: string[] = [];
  const attachmentStore = new AttachmentStore({
    storageAdapter: {
      async getKeyAsDataURL(key: string) {
        readKeys.push(key);
        return DATA_URL;
      },
    } as any,
  });
  const runtime = new AgentRuntime({
    name: 'test-agent',
    getAdminforth: () =>
      ({ config: { auth: { usernameField: 'email' }, baseUrlSlashed: '/admin/' } }) as any,
    getCheckpointer: () => checkpointer,
    toolProvider: {
      open: async () => ({
        instructions: 'MCP_RULES',
        baseTools: [],
        dynamicTools: {},
        approvalToolNames: [],
        close: async () => {},
      }),
    },
    steerBuffer: new SteerBuffer(),
    attachmentStore,
  });
  const sequenceDebugSink = createSequenceDebugCollector();

  const stream = await runtime.stream({
    models: { model: model as any, summaryModel: model as any },
    systemPrompt: 'STATIC_PROMPT',
    input: {
      messages: [toHumanMessage('what is on it?', [{ key: KEY, name: 'chart.png', mimeType: 'image/png' }])],
    } as any,
    context: {
      adminUser: { pk: 'u1', dbUser: { email: 'admin@x.io' } } as any,
      userTimeZone: 'UTC',
      sessionId: 's1',
      turnId: 't1',
    },
    observability: { sequenceDebugSink },
  });
  for await (const _ of stream as AsyncIterable<unknown>) {
    // no-op
  }
  sequenceDebugSink.flush();

  const checkpoint = await checkpointer.getTuple({ configurable: { thread_id: 's1' } });
  return { model, readKeys, checkpoint, debugHistory: sequenceDebugSink.getHistory() as any[] };
}

describe('images in the agent runtime', () => {
  it('gives the model the image data', async () => {
    const { model, readKeys } = await runTurnWithImage();

    const userMessage = model.invocations[0].find((message) => message.getType() === 'human')!;
    expect(userMessage.content).toEqual([
      { type: 'text', text: 'what is on it?' },
      { type: 'image', mimeType: 'image/png', url: DATA_URL },
    ]);
    expect(readKeys).toEqual([KEY]);
  });

  it('keeps only the storage key in the checkpoint', async () => {
    const { checkpoint } = await runTurnWithImage();

    const messages = (checkpoint!.checkpoint.channel_values as any).messages as BaseMessage[];
    expect(messages[0].content).toEqual([
      { type: 'text', text: 'what is on it?' },
      { type: 'image', mimeType: 'image/png', url: `${ATTACHMENT_URL_SCHEME}${KEY}` },
    ]);
    expect(JSON.stringify(checkpoint)).not.toContain(DATA_URL);
  });

  it('keeps only the storage key in the debug trace', async () => {
    const { debugHistory } = await runTurnWithImage();

    expect(debugHistory[0].prompt).toContain(`${ATTACHMENT_URL_SCHEME}${KEY}`);
    expect(debugHistory[0].prompt).not.toContain(DATA_URL);
  });
});
