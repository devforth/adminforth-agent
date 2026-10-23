import { AIMessage, HumanMessage } from 'langchain';
import { createAttachmentKey, resolveAttachmentRefs } from '../domain/attachments.js';
import { AttachmentStore } from '../persistence/attachmentStore.js';
import { AgentSessionStore } from '../persistence/sessionStore.js';
import {
  ATTACHMENT_URL_SCHEME,
  countTokensWithImages,
  toHumanMessage,
} from '../llm/attachmentMessages.js';
import { createAttachmentsMiddleware } from '../llm/middleware/attachmentsMiddleware.js';
import { createSteerMiddleware } from '../llm/middleware/steerMiddleware.js';
import { SteerBuffer } from '../domain/steerBuffer.js';
import { setupAttachmentEndpoints } from '../transport/http/attachmentEndpoints.js';
import { setupCoreEndpoints } from '../transport/http/coreEndpoints.js';
import AdminForthAgentPlugin from '../index.js';

// Images attached to user messages: the key rules that keep users to their own images, the
// storage lifecycle of the files, and how the images reach the model without being copied
// into every checkpoint.

const PNG_KEY = 'agent-attachments/u1/0b6c5d5e-8f1a-4f4e-9a3b-2d3c4e5f6a7b.png';

function fakeStorageAdapter() {
  const calls = {
    getUploadSignedUrl: [] as any[],
    markKeyForNotDeletion: [] as string[],
    markKeyForDeletion: [] as string[],
    getKeyAsDataURL: [] as string[],
    setupLifecycle: [] as string[],
  };
  return {
    calls,
    async setupLifecycle(adapterUserUniqueRepresentation: string) {
      calls.setupLifecycle.push(adapterUserUniqueRepresentation);
    },
    async getUploadSignedUrl(key: string, contentType: string, expiresIn: number) {
      calls.getUploadSignedUrl.push({ key, contentType, expiresIn });
      return { uploadUrl: `https://storage/${key}?signed`, uploadExtraParams: { 'x-amz-tagging': 'unused=true' } };
    },
    async getDownloadUrl(key: string) {
      return `https://storage/${key}?download`;
    },
    async markKeyForNotDeletion(key: string) {
      calls.markKeyForNotDeletion.push(key);
    },
    async markKeyForDeletion(key: string) {
      calls.markKeyForDeletion.push(key);
    },
    async getKeyAsDataURL(key: string) {
      calls.getKeyAsDataURL.push(key);
      return `data:image/png;base64,${key.length}`;
    },
  };
}

function attachmentStoreWith(adapter = fakeStorageAdapter(), limits: { maxFileSizeMb?: number; maxFilesPerMessage?: number } = {}) {
  return { adapter, store: new AttachmentStore({ storageAdapter: adapter as any, ...limits }) };
}

function fakeServer() {
  const endpoints = new Map<string, any>();
  return {
    endpoints,
    endpoint(definition: any) {
      endpoints.set(definition.path, definition);
    },
  };
}

function recordCalls() {
  const calls: unknown[][] = [];
  return Object.assign((...args: unknown[]) => {
    calls.push(args);
  }, { calls });
}

function fakeResponse() {
  return {
    status: 200,
    setStatus(status: number) {
      this.status = status;
    },
  };
}

describe('resolveAttachmentRefs', () => {
  it('accepts an image key from the folder of the sending user and derives its type', () => {
    expect(resolveAttachmentRefs([{ key: PNG_KEY, name: 'chart.png' }], 'u1', 5)).toEqual({
      attachments: [{ key: PNG_KEY, name: 'chart.png', mimeType: 'image/png' }],
    });
  });

  it('accepts the keys it creates', () => {
    const key = createAttachmentKey('u1', 'image/webp');

    expect(resolveAttachmentRefs([{ key, name: 'photo' }], 'u1', 5)).toEqual({
      attachments: [{ key, name: 'photo', mimeType: 'image/webp' }],
    });
  });

  it.each([
    ['an image of another user', PNG_KEY.replace('/u1/', '/u2/')],
    ['a key of a user whose pk starts with the same characters', PNG_KEY.replace('/u1/', '/u1/u2/')],
    ['a path out of the folder', 'agent-attachments/u1/../u2/0b6c5d5e-8f1a-4f4e-9a3b-2d3c4e5f6a7b.png'],
    ['a file which is not an image', PNG_KEY.replace('.png', '.svg')],
    ['a key outside of the attachments folder', 'uploads/u1/0b6c5d5e-8f1a-4f4e-9a3b-2d3c4e5f6a7b.png'],
  ])('rejects %s', (_case, key) => {
    expect(resolveAttachmentRefs([{ key, name: 'x.png' }], 'u1', 5)).toEqual({
      error: 'Image "x.png" is not an image uploaded by the current user',
    });
  });

  it('rejects more images than a message can carry', () => {
    const refs = [1, 2, 3].map(() => ({ key: createAttachmentKey('u1', 'image/png'), name: 'a.png' }));

    expect(resolveAttachmentRefs(refs, 'u1', 2)).toEqual({
      error: 'At most 2 images can be attached to a message',
    });
  });
});

describe('AttachmentStore', () => {
  it('creates an upload into the folder of the user, with a link to show the image', async () => {
    const { adapter, store } = attachmentStoreWith();

    const upload = await store.createUpload('u1', 'image/jpeg');

    expect(upload.key).toMatch(/^agent-attachments\/u1\/[0-9a-f-]{36}\.jpg$/);
    expect(adapter.calls.getUploadSignedUrl).toEqual([{ key: upload.key, contentType: 'image/jpeg', expiresIn: 1800 }]);
    expect(upload).toMatchObject({
      uploadUrl: `https://storage/${upload.key}?signed`,
      uploadExtraParams: { 'x-amz-tagging': 'unused=true' },
      previewUrl: `https://storage/${upload.key}?download`,
    });
  });

  it('gives the chat its limits with defaults', () => {
    expect(attachmentStoreWith().store.frontendConfig).toEqual({
      maxFileSizeMb: 10,
      maxFilesPerMessage: 5,
      mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    });
  });
});

describe('attachment messages', () => {
  const attachment = { key: PNG_KEY, name: 'chart.png', mimeType: 'image/png' as const };

  it('keeps a message without images a plain text message', () => {
    expect(toHumanMessage('hello', []).content).toBe('hello');
  });

  it('puts only the storage key of an image into the message', () => {
    expect(toHumanMessage('what is on it?', [attachment]).content).toEqual([
      { type: 'text', text: 'what is on it?' },
      { type: 'image', mimeType: 'image/png', url: `${ATTACHMENT_URL_SCHEME}${PNG_KEY}` },
    ]);
  });

  it('sends a message of images only without an empty text block', () => {
    expect(toHumanMessage('', [attachment]).content).toEqual([
      { type: 'image', mimeType: 'image/png', url: `${ATTACHMENT_URL_SCHEME}${PNG_KEY}` },
    ]);
  });

  it('counts images for the summarization trigger, which counts text only by itself', () => {
    const withImage = countTokensWithImages([toHumanMessage('what is on it?', [attachment])]);
    const withoutImage = countTokensWithImages([new HumanMessage('what is on it?')]);

    expect(withImage - withoutImage).toBe(1600);
  });
});

describe('createAttachmentsMiddleware', () => {
  const attachment = { key: PNG_KEY, name: 'chart.png', mimeType: 'image/png' as const };

  it('gives the model the image data and reads each image once per turn', async () => {
    const { adapter, store } = attachmentStoreWith();
    const middleware: any = createAttachmentsMiddleware(store);
    const stored = toHumanMessage('what is on it?', [attachment]);
    const answer = new AIMessage('a chart');
    const requests: any[] = [];
    const handler = async (request: any) => {
      requests.push(request);
      return new AIMessage('ok');
    };

    await middleware.wrapModelCall({ messages: [stored, answer] }, handler);
    await middleware.wrapModelCall({ messages: [stored, answer, new HumanMessage('and now?')] }, handler);

    expect(requests[0].messages[0].content).toEqual([
      { type: 'text', text: 'what is on it?' },
      { type: 'image', mimeType: 'image/png', url: `data:image/png;base64,${PNG_KEY.length}` },
    ]);
    expect(requests[0].messages[1]).toBe(answer);
    expect(requests[1].messages[2].content).toBe('and now?');
    expect(adapter.calls.getKeyAsDataURL).toEqual([PNG_KEY]);
    // The state keeps the key: the data never gets into checkpoints.
    expect((stored.content as any[])[1].url).toBe(`${ATTACHMENT_URL_SCHEME}${PNG_KEY}`);
  });
});

describe('steer with images', () => {
  it('injects the images of a steer together with its text', async () => {
    const buffer = new SteerBuffer();
    buffer.add('s1', 'look at this', [{ key: PNG_KEY, name: 'chart.png', mimeType: 'image/png' }]);

    const result: any = await createSteerMiddleware(buffer).beforeModel!({} as any, { context: { sessionId: 's1' } } as any);

    expect(result.messages[0].content).toEqual([
      { type: 'text', text: expect.stringContaining('look at this') },
      { type: 'image', mimeType: 'image/png', url: `${ATTACHMENT_URL_SCHEME}${PNG_KEY}` },
    ]);
  });
});

describe('session store with attachments', () => {
  const OPTIONS = {
    sessionResource: { resourceId: 'sessions', idField: 'id' },
    turnResource: {
      resourceId: 'turns',
      idField: 'id',
      sessionIdField: 'session_id',
      createdAtField: 'created_at',
      promptField: 'prompt',
      responseField: 'response',
      attachmentsField: 'attachments',
    },
  } as any;
  const attachment = { key: PNG_KEY, name: 'chart.png', mimeType: 'image/png' };

  it('stores the images of a new turn and keeps their files', async () => {
    const { adapter, store: attachmentStore } = attachmentStoreWith();
    let created: any;
    const store = new AgentSessionStore(() => ({
      resource: () => ({
        async create(record: any) {
          created = record;
          return { createdRecord: record };
        },
      }),
    }) as any, OPTIONS, attachmentStore);

    await store.createNewTurn('s1', 'what is on it?', [attachment as any]);

    expect(created.attachments).toEqual([attachment]);
    expect(adapter.calls.markKeyForNotDeletion).toEqual([PNG_KEY]);
  });

  it('lets the storage delete the images of turns an edit truncates', async () => {
    const { adapter, store: attachmentStore } = attachmentStoreWith();
    const laterKey = PNG_KEY.replace('.png', '.jpg');
    const store = new AgentSessionStore(() => ({
      resource: () => ({
        async list() {
          return [
            { id: 't1', prompt: 'first', attachments: [attachment] },
            { id: 't2', prompt: 'second', attachments: [{ ...attachment, key: laterKey }] },
          ];
        },
        async delete() {},
        async update() {},
      }),
    }) as any, OPTIONS, attachmentStore);

    await store.editTurnAndTruncateAfter({ sessionId: 's1', turnId: 't1', newPrompt: 'edited' });

    // The edited turn keeps its images, the deleted one gives them up.
    expect(adapter.calls.markKeyForDeletion).toEqual([laterKey]);
  });

  it('deletes the turns of a session together with their images', async () => {
    const { adapter, store: attachmentStore } = attachmentStoreWith();
    const deleted: string[] = [];
    const store = new AgentSessionStore(() => ({
      resource: () => ({
        async list() {
          return [
            { id: 't1', prompt: 'first', attachments: [attachment] },
            { id: 't2', prompt: 'second', attachments: [] },
          ];
        },
        async delete(id: string) {
          deleted.push(id);
        },
      }),
    }) as any, OPTIONS, attachmentStore);

    await store.deleteSessionTurns('s1');

    expect(deleted).toEqual(['t1', 't2']);
    expect(adapter.calls.markKeyForDeletion).toEqual([PNG_KEY]);
  });
});

describe('attachment endpoints', () => {
  const adminUser = { pk: 'u1' };

  it('is not registered when attachments are not enabled', () => {
    const server = fakeServer();

    setupAttachmentEndpoints({ attachmentStore: null }, server as any);

    expect(server.endpoints.size).toBe(0);
  });

  it('refuses to upload an image larger than the limit', async () => {
    const server = fakeServer();
    const { adapter, store } = attachmentStoreWith(fakeStorageAdapter(), { maxFileSizeMb: 1 });
    setupAttachmentEndpoints({ attachmentStore: store }, server as any);
    const response = fakeResponse();

    const result = await server.endpoints.get('/agent/get-attachment-upload-url').handler({
      body: { mimeType: 'image/png', size: 1024 * 1024 + 1 },
      adminUser,
      response,
    });

    expect(response.status).toBe(400);
    expect(result).toEqual({ error: 'Image is larger than 1 MB' });
    expect(adapter.calls.getUploadSignedUrl).toEqual([]);
  });

  it('rejects a message with an image of another user before running the turn', async () => {
    const server = fakeServer();
    const handleTurn = recordCalls();
    setupCoreEndpoints({ attachmentStore: attachmentStoreWith().store, handleTurn } as any, server as any);
    const response = fakeResponse();

    const result = await server.endpoints.get('/agent/response').handler({
      body: { message: 'hi', sessionId: 's1', attachments: [{ key: PNG_KEY.replace('/u1/', '/u2/'), name: 'x.png' }] },
      adminUser,
      response,
    });

    expect(response.status).toBe(400);
    expect(result).toEqual({ error: 'Image "x.png" is not an image uploaded by the current user' });
    expect(handleTurn.calls).toEqual([]);
  });

  it('rejects images when attachments are not enabled', async () => {
    const server = fakeServer();
    const handleTurn = recordCalls();
    setupCoreEndpoints({ attachmentStore: null, handleTurn } as any, server as any);
    const response = fakeResponse();

    const result = await server.endpoints.get('/agent/response').handler({
      body: { message: 'hi', sessionId: 's1', attachments: [{ key: PNG_KEY, name: 'x.png' }] },
      adminUser,
      response,
    });

    expect(response.status).toBe(400);
    expect(result).toEqual({ error: 'Image attachments are not enabled for AdminForth Agent' });
    expect(handleTurn.calls).toEqual([]);
  });
});

describe('plugin config with attachments', () => {
  function pluginWith(turnResource: Record<string, unknown>) {
    return new AdminForthAgentPlugin({
      modes: [{ name: 'Default', completionAdapter: {} }],
      sessionResource: { resourceId: 'sessions' },
      turnResource: { resourceId: 'turns', ...turnResource },
      attachments: { storageAdapter: fakeStorageAdapter() },
    } as any);
  }

  function adminforthConfig() {
    return {
      config: { customization: { globalInjections: {} }, resources: [] },
      codeInjector: { srcFoldersToSync: {}, allComponentNames: {} },
    } as any;
  }

  it('requires a turn field to store the images', async () => {
    await expect(pluginWith({}).modifyGlobalConfig(adminforthConfig())).rejects.toThrow(
      'turnResource.attachmentsField is required',
    );
  });

  it('gives the chat the limits of the images', async () => {
    const adminforth = adminforthConfig();

    await pluginWith({ attachmentsField: 'attachments' }).modifyGlobalConfig(adminforth);

    expect(adminforth.config.customization.globalInjections.header[0].meta.attachments).toEqual({
      maxFileSizeMb: 10,
      maxFilesPerMessage: 5,
      mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    });
  });
});
