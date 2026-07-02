import {
  AgentSessionStore,
  AGENT_SYSTEM_TURN_PROMPT,
} from '../sessionStore.js';

// Characterization tests for session/turn persistence. Uses a fake AdminForth resource
// so we freeze the field mapping and the read/transform logic (previous-message windowing,
// system-turn filtering, chat-surface session id derivation) independent of a real DB.

const OPTIONS = {
  sessionResource: {
    resourceId: 'sessions',
    idField: 'id',
    titleField: 'title',
    turnsField: 'turns',
    askerIdField: 'asker_id',
    createdAtField: 'created_at',
  },
  turnResource: {
    resourceId: 'turns',
    idField: 'id',
    sessionIdField: 'session_id',
    createdAtField: 'created_at',
    promptField: 'prompt',
    responseField: 'response',
    debugField: 'debug',
  },
} as any;

function buildStore(resourceImpl: (resourceId: string) => any) {
  const adminforth = { resource: (resourceId: string) => resourceImpl(resourceId) };
  return new AgentSessionStore(() => adminforth as any, OPTIONS);
}

describe('adminforth-agent session store', () => {
  it('createNewTurn writes the field mapping and defaults response to "not_finished"', async () => {
    let created: any;
    const store = buildStore(() => ({
      async create(record: any) {
        created = record;
        return { createdRecord: record };
      },
    }));

    const id = await store.createNewTurn('s1', 'hello');

    expect(created).toMatchObject({ session_id: 's1', prompt: 'hello', response: 'not_finished' });
    expect(typeof created.id).toBe('string');
    expect(id).toBe(created.id);
  });

  it('createSystemTurn stores the sentinel prompt and the system message as response', async () => {
    let created: any;
    const store = buildStore(() => ({
      async create(record: any) {
        created = record;
        return { createdRecord: record };
      },
    }));

    await store.createSystemTurn('s1', 'a system note');

    expect(created.prompt).toBe(AGENT_SYSTEM_TURN_PROMPT);
    expect(created.response).toBe('a system note');
    expect(created.session_id).toBe('s1');
  });

  it('getSessionTurns maps rows to { prompt, response }', async () => {
    const store = buildStore(() => ({
      async list() {
        return [
          { id: '1', prompt: 'p1', response: 'r1' },
          { id: '2', prompt: 'p2', response: 'r2' },
        ];
      },
    }));

    expect(await store.getSessionTurns('s1')).toEqual([
      { prompt: 'p1', response: 'r1' },
      { prompt: 'p2', response: 'r2' },
    ]);
  });

  it('getPreviousUserMessages reverses the DESC window into chronological order', async () => {
    const store = buildStore(() => ({
      // resource is queried DESC + limit 2; return newest-first.
      async list() {
        return [
          { prompt: 'newest', response: 'x' },
          { prompt: 'older', response: 'y' },
        ];
      },
    }));

    expect(await store.getPreviousUserMessages('s1')).toEqual([{ text: 'older' }, { text: 'newest' }]);
  });

  it('getPreviousUserMessages drops system turns', async () => {
    const store = buildStore(() => ({
      async list() {
        return [
          { prompt: AGENT_SYSTEM_TURN_PROMPT, response: 'sys' },
          { prompt: 'hello', response: 'x' },
        ];
      },
    }));

    // reversed -> [hello, sys], system filtered out
    expect(await store.getPreviousUserMessages('s1')).toEqual([{ text: 'hello' }]);
  });

  it('derives a deterministic chat-surface session id', () => {
    const store = buildStore(() => ({}));
    expect(
      store.getChatSurfaceSessionId({ surface: 'telegram', externalConversationId: 'conv1' } as any),
    ).toBe('telegram:conv1');
  });

  it('getOrCreateChatSurfaceSession returns the existing session without creating', async () => {
    let createCalled = false;
    const store = buildStore(() => ({
      async get() {
        return { id: 'telegram:conv1' };
      },
      async create() {
        createCalled = true;
      },
    }));

    const sessionId = await store.getOrCreateChatSurfaceSession(
      { surface: 'telegram', externalConversationId: 'conv1', prompt: 'hi', externalUserId: 'u1' } as any,
      { pk: 'admin1' } as any,
    );

    expect(sessionId).toBe('telegram:conv1');
    expect(createCalled).toBe(false);
  });

  it('getOrCreateChatSurfaceSession creates a new session with a truncated title', async () => {
    let created: any;
    const longPrompt = 'x'.repeat(120);
    const store = buildStore(() => ({
      async get() {
        return null;
      },
      async create(record: any) {
        created = record;
      },
    }));

    const sessionId = await store.getOrCreateChatSurfaceSession(
      { surface: 'telegram', externalConversationId: 'conv2', prompt: longPrompt, externalUserId: 'u1' } as any,
      { pk: 'admin1' } as any,
    );

    expect(sessionId).toBe('telegram:conv2');
    expect(created).toMatchObject({ id: 'telegram:conv2', asker_id: 'admin1' });
    expect(created.title.length).toBe(40);
  });
});
