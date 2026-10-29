import { HumanMessage, ToolMessage } from 'langchain';
import { z } from 'zod';
import { TurnAttachments } from '../persistence/turnAttachments.js';
import { AgentSessionStore } from '../persistence/sessionStore.js';
import { buildAgentEditBodySchema } from '../transport/http/coreEndpoints.js';
import { createAttachmentsMiddleware } from '../llm/middleware/attachmentsMiddleware.js';
import {
  ATTACHMENTS_KWARG,
  ATTACHMENTS_SENT_AT_KWARG,
  DEFAULT_IMAGE_ATTACHMENTS_LIMITS,
  VIEW_IMAGE_TOOL_NAME,
  resolveImageAttachmentsLimits,
} from '../domain/imageAttachments.js';
import { createViewImageTool } from '../tools/viewImage.js';

const OPTIONS = {
  turnResource: { resourceId: 'turns', attachmentsField: 'attachments' },
} as any;

function fakeUploadPlugin(overrides: Record<string, unknown> = {}) {
  return {
    resourceConfig: { resourceId: 'turns' },
    pluginOptions: {
      pathColumnName: 'attachments',
      allowedFileExtensions: ['png', 'jpg'],
      storageAdapter: {
        async getKeyAsDataURL(filePath: string) {
          return `data:image/png;base64,${filePath}`;
        },
        async getDownloadUrl(filePath: string) {
          return `https://storage/${filePath}?signed`;
        },
      },
    },
    async getUploadUrl({ filename }: { filename: string }) {
      return { uploadUrl: `https://storage/${filename}`, contentType: 'image/png', filePath: `agent/${filename}` };
    },
    ...overrides,
  };
}

// JWT stand-in: the token is the signed payload itself, so a forged one is just another payload.
function buildAttachments(opts: { isArray?: boolean; plugins?: any[] } = {}) {
  const adminforth = {
    config: {
      resources: [{
        resourceId: 'turns',
        columns: [{ name: 'attachments', isArray: { enabled: opts.isArray ?? true } }],
      }],
    },
    getPluginsByClassName: () => opts.plugins ?? [fakeUploadPlugin()],
    auth: {
      issueJWT: (payload: object, type: string) => JSON.stringify({ ...payload, t: type }),
      async verify(token: string, type: string) {
        const payload = JSON.parse(token);
        return payload.t === type ? payload : null;
      },
    },
  };
  const attachments = new TurnAttachments(() => adminforth as any, OPTIONS);
  attachments.resolveUploadPlugin();
  return attachments;
}

describe('TurnAttachments', () => {
  it('accepts a file only with the token issued for the same session and path', async () => {
    const attachments = buildAttachments();
    const { filePath, token, previewUrl } = await attachments.createUploadUrl({
      sessionId: 's1',
      filename: 'a.png',
      contentType: 'image/png',
      size: 10,
    });

    // the chat shows the stored file right after the upload
    expect(previewUrl).toBe('https://storage/agent/a.png?signed');
    await expect(attachments.verify('s1', [{ filePath, token }])).resolves.toEqual(['agent/a.png']);
    await expect(attachments.verify('s2', [{ filePath, token }])).rejects.toThrow(/not uploaded to this session/);
    await expect(attachments.verify('s1', [{ filePath: 'avatars/b.png', token }])).rejects.toThrow(/not uploaded/);
    await expect(attachments.verify('s1', [{ filePath }])).rejects.toThrow(/not uploaded/);
  });

  it('refuses an image too large for the model before issuing the upload URL', async () => {
    const attachments = buildAttachments();

    await expect(attachments.createUploadUrl({
      sessionId: 's1',
      filename: 'big.png',
      contentType: 'image/png',
      size: 4 * 1024 * 1024,
    })).rejects.toThrow(/too large/);
  });

  it('accepts a file of the edited turn without a token', async () => {
    const attachments = buildAttachments();

    await expect(attachments.verify('s1', [{ filePath: 'old.png' }], ['old.png'])).resolves.toEqual(['old.png']);
  });

  it('requires an isArray column with UploadPlugin limited to images', () => {
    expect(() => buildAttachments({ isArray: false })).toThrow(/isArray column/);
    expect(() => buildAttachments({ plugins: [] })).toThrow(/requires UploadPlugin/);
    expect(() => buildAttachments({
      plugins: [fakeUploadPlugin({
        pluginOptions: { pathColumnName: 'attachments', allowedFileExtensions: ['png', 'pdf'] },
      })],
    })).toThrow(/limit allowedFileExtensions to images/);
  });
});

describe('attachments turned off', () => {
  it('loads the session history without UploadPlugin', async () => {
    const options = {
      turnResource: {
        resourceId: 'turns',
        idField: 'id',
        sessionIdField: 'session_id',
        createdAtField: 'created_at',
        promptField: 'prompt',
        responseField: 'response',
      },
    } as any;
    const adminforth = {
      resource: () => ({
        async list() {
          return [{ id: 't1', prompt: 'hello', response: 'hi' }];
        },
      }),
    };
    const attachments = new TurnAttachments(() => adminforth as any, options);
    attachments.resolveUploadPlugin();
    const store = new AgentSessionStore(() => adminforth as any, options, attachments);

    expect(await store.getSessionTurns('s1')).toEqual([
      { id: 't1', prompt: 'hello', response: 'hi', attachments: [] },
    ]);
  });
});

describe('imageAttachments options', () => {
  it('takes the defaults for the limits not set', () => {
    expect(resolveImageAttachmentsLimits()).toEqual({ maxPerMessage: 5, visibleMinutes: 30, maxVisible: 5 });
    expect(resolveImageAttachmentsLimits({ visibleMinutes: 10 })).toEqual({ maxPerMessage: 5, visibleMinutes: 10, maxVisible: 5 });
  });

  it('accepts whole numbers from 1 only', () => {
    expect(() => resolveImageAttachmentsLimits({ maxPerMessage: 0 })).toThrow('imageAttachments.maxPerMessage must be a whole number from 1, got 0');
    expect(() => resolveImageAttachmentsLimits({ visibleMinutes: 2.5 })).toThrow(/visibleMinutes .* got 2.5/);
    expect(() => resolveImageAttachmentsLimits({ maxVisible: -1 })).toThrow(/maxVisible/);
  });
});

describe('edit request body', () => {
  const agentEditBodySchema = buildAgentEditBodySchema(DEFAULT_IMAGE_ATTACHMENTS_LIMITS);
  const base = { sessionId: 's1', turnId: 't1' };

  it('needs the text or at least one image, up to the limit', () => {
    expect(agentEditBodySchema.safeParse({ ...base, message: 'edited' }).success).toBe(true);
    expect(agentEditBodySchema.safeParse({ ...base, message: '', attachments: [{ filePath: 'a.png' }] }).success).toBe(true);
    expect(agentEditBodySchema.safeParse({ ...base, message: '' }).success).toBe(false);
    expect(agentEditBodySchema.safeParse({ ...base, message: '', attachments: [] }).success).toBe(false);
    const sixImages = Array.from({ length: 6 }, (_, index) => ({ filePath: `${index}.png` }));
    expect(agentEditBodySchema.safeParse({ ...base, message: 'x', attachments: sixImages }).success).toBe(false);
  });

  it('is expressible as the JSON Schema the request is checked with', () => {
    expect(z.toJSONSchema(agentEditBodySchema, { target: 'draft-07' })).toHaveProperty('anyOf');
  });
});

const MINUTE = 60_000;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();

const withImages = (filePaths: string[], sentMinutesAgo?: number) => new HumanMessage({
  content: 'look',
  additional_kwargs: {
    [ATTACHMENTS_KWARG]: filePaths,
    ...(sentMinutesAgo === undefined ? {} : { [ATTACHMENTS_SENT_AT_KWARG]: minutesAgo(sentMinutesAgo) }),
  },
});

const viewed = (filePaths: string[], viewedMinutesAgo: number) => new ToolMessage({
  name: VIEW_IMAGE_TOOL_NAME,
  tool_call_id: `call-${filePaths.join()}`,
  content: JSON.stringify({ shown: filePaths, notFound: [] }),
  artifact: { filePaths, viewedAt: minutesAgo(viewedMinutesAgo) },
});

function buildMiddleware(missing: string[] = [], limits = DEFAULT_IMAGE_ATTACHMENTS_LIMITS) {
  const loaded: string[] = [];
  const middleware = createAttachmentsMiddleware(async (filePath) => {
    if (missing.includes(filePath)) {
      throw new Error('The specified key does not exist.');
    }
    loaded.push(filePath);
    return `data:image/png;base64,${filePath}`;
  }, limits) as any;
  const send = async (messages: any[]) => {
    let sent: any[] = [];
    await middleware.wrapModelCall({ messages }, async (request: any) => {
      sent = request.messages;
      return {};
    });
    return sent;
  };
  return { loaded, send };
}

const image = (filePath: string) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${filePath}` } });
const viewedBelow = (filePath: string) => ({
  type: 'text',
  text: `[Image with id "${filePath}" is shown further below, loaded again with view_image.]`,
});
const hidden = (filePath: string) => ({
  type: 'text',
  text: `[Image with id "${filePath}" is not shown any more. Call view_image with this whole id to see it again.]`,
});

describe('attachments middleware', () => {
  it('turns attachment paths into image blocks, loading each image once per turn', async () => {
    const { loaded, send } = buildMiddleware();
    const message = withImages(['a.png'], 1);

    const sent = await send([message, new HumanMessage('plain')]);
    await send([message]);

    expect(sent[0].content).toEqual([{ type: 'text', text: 'look' }, image('a.png')]);
    expect(sent[0].additional_kwargs[ATTACHMENTS_KWARG]).toBeUndefined();
    expect(sent[1].content).toBe('plain');
    expect(loaded).toEqual(['a.png']);
  });

  it('hides an image sent more than 30 minutes ago behind a note with its id, without reading it', async () => {
    const { loaded, send } = buildMiddleware();

    const sent = await send([withImages(['old.png'], 31), withImages(['recent.png'], 29), withImages(['legacy.png'])]);

    expect(sent[0].content[1]).toEqual(hidden('old.png'));
    expect(sent[1].content[1]).toEqual(image('recent.png'));
    // messages sent before the time was stored count as old
    expect(sent[2].content[1]).toEqual(hidden('legacy.png'));
    expect(loaded).toEqual(['recent.png']);
  });

  it('shows images loaded with view_image after the tool results of that step, for 30 minutes', async () => {
    const { send } = buildMiddleware();
    const viewOld = viewed(['old.png', 'older.png'], 5);
    const otherTool = new ToolMessage({ name: 'get_resource', tool_call_id: 'call-other', content: 'resource' });
    const viewStale = viewed(['stale.png'], 31);

    const sent = await send([
      withImages(['old.png', 'older.png', 'stale.png'], 120),
      viewOld,
      otherTool,
      new HumanMessage('next'),
      viewStale,
    ]);

    // old.png and older.png are shown after the tool results, their own message points there
    expect(sent[0].content.slice(1)).toEqual([viewedBelow('old.png'), viewedBelow('older.png'), hidden('stale.png')]);
    // a user message between tool results of one step is refused by providers
    expect(sent[1]).toBe(viewOld);
    expect(sent[2]).toBe(otherTool);
    expect(sent[3].content).toEqual([
      { type: 'text', text: '[Image with id "old.png", loaded with view_image]' },
      image('old.png'),
      { type: 'text', text: '[Image with id "older.png", loaded with view_image]' },
      image('older.png'),
    ]);
    expect(sent.slice(4)).toHaveLength(2);
  });

  it('shows viewed images when the request continues a previous response with the new messages only', async () => {
    // OpenAI previous_response_id: the earlier history stays on the provider side
    const { send } = buildMiddleware();

    const sent = await send([viewed(['old.png'], 0)]);

    expect(sent[1].content[1]).toEqual(image('old.png'));
  });

  it('ignores a failed view_image call, which has a plain error text and no artifact', async () => {
    const { send } = buildMiddleware();
    const failed = new ToolMessage({ name: VIEW_IMAGE_TOOL_NAME, tool_call_id: 'call-bad', content: 'Error: invalid input' });

    const sent = await send([withImages(['a.png'], 1), failed]);

    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(failed);
  });

  it('shows 5 images at most, the latest sent or viewed', async () => {
    const { send } = buildMiddleware();

    const sent = await send([
      withImages(['1.png', '2.png', '3.png'], 20),
      withImages(['4.png', '5.png'], 10),
      withImages(['viewed.png'], 90),
      viewed(['viewed.png'], 1),
    ]);

    // viewed.png and 4-5.png are the latest; of the three sent at once the first two fit
    expect(sent[4].content[1]).toEqual(image('viewed.png'));
    expect(sent[2].content[1]).toEqual(viewedBelow('viewed.png'));
    expect(sent[1].content.slice(1)).toEqual([image('4.png'), image('5.png')]);
    expect(sent[0].content.slice(1)).toEqual([image('1.png'), image('2.png'), hidden('3.png')]);
  });

  it('follows the visibleMinutes and maxVisible options', async () => {
    const { send } = buildMiddleware([], { maxPerMessage: 5, visibleMinutes: 10, maxVisible: 1 });

    const sent = await send([withImages(['old.png'], 11), withImages(['earlier.png'], 5), withImages(['latest.png'], 1)]);

    expect(sent[0].content[1]).toEqual(hidden('old.png'));
    expect(sent[1].content[1]).toEqual(hidden('earlier.png'));
    expect(sent[2].content[1]).toEqual(image('latest.png'));
  });

  it('replaces an image which can not be read with a note instead of failing the call', async () => {
    const { send } = buildMiddleware(['gone.png']);

    const sent = await send([withImages(['gone.png', 'ok.png'], 1)]);

    expect(sent[0].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'text', text: '[An image of this message is no longer available]' },
      image('ok.png'),
    ]);
  });
});

describe('view_image tool', () => {
  const viewImage = createViewImageTool(DEFAULT_IMAGE_ATTACHMENTS_LIMITS) as any;
  const view = async (imageIds: string[], filePaths: string[]) => viewImage.invoke(
    { name: VIEW_IMAGE_TOOL_NAME, args: { imageIds }, id: 'call-1', type: 'tool_call' },
    { state: { messages: [withImages(filePaths, 120)] } },
  );

  it('loads the images of this conversation and names the unknown ids', async () => {
    const result = await view(['old.png', 'other.png'], ['old.png']);

    expect(JSON.parse(result.content)).toEqual({ shown: ['old.png'], notFound: ['other.png'] });
    expect(result.artifact.filePaths).toEqual(['old.png']);
    expect(Date.now() - Date.parse(result.artifact.viewedAt)).toBeLessThan(MINUTE);
  });

  it('accepts the file name of the id, with or without the extension, when it is unique', async () => {
    const filePaths = ['agent_attachments/54eb.png', 'agent_attachments/same.png', 'other/same.png'];

    expect((await view(['54eb', '54eb.png'], filePaths)).artifact.filePaths).toEqual(['agent_attachments/54eb.png']);
    expect(JSON.parse((await view(['same'], filePaths)).content).notFound).toEqual(['same']);
  });
});
