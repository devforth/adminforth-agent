import {
  AgentSessionStore,
  AGENT_SYSTEM_TURN_PROMPT,
} from '../persistence/sessionStore.js';

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

  it('getSessionTurns maps rows to { id, prompt, response }', async () => {
    const store = buildStore(() => ({
      async list() {
        return [
          { id: '1', prompt: 'p1', response: 'r1' },
          { id: '2', prompt: 'p2', response: 'r2' },
        ];
      },
    }));

    expect(await store.getSessionTurns('s1')).toEqual([
      { id: '1', prompt: 'p1', response: 'r1' },
      { id: '2', prompt: 'p2', response: 'r2' },
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

  it('appendSteerToCurrentTurn appends onto the latest non-system turn, skipping system notes', async () => {
    // newest-first (DESC): a system note (e.g. audio) sits on top of the real running turn.
    const rows: any[] = [
      { id: 'sys', prompt: AGENT_SYSTEM_TURN_PROMPT, response: 'END_AUDIO_CHAT' },
      { id: 'main', prompt: 'buy a car', response: 'not_finished' },
    ];
    const store = buildStore(() => ({
      async list() {
        return rows;
      },
      async update(id: string, fields: any) {
        Object.assign(rows.find((r: any) => r.id === id), fields);
      },
    }));

    await store.appendSteerToCurrentTurn('s1', 'and the cheapest one');

    expect(rows.find((r: any) => r.id === 'main').prompt).toBe('buy a car__adminforth_steer__:and the cheapest one');
    expect(rows.find((r: any) => r.id === 'sys').prompt).toBe(AGENT_SYSTEM_TURN_PROMPT);
  });

  it('getAgentTurns excludes system turns and surfaces the stored checkpoint id', async () => {
    const optionsWithCheckpoint = {
      ...OPTIONS,
      turnResource: { ...OPTIONS.turnResource, checkpointIdField: 'checkpoint_id' },
    } as any;
    const adminforth = {
      resource: () => ({
        async list() {
          return [
            { id: 't1', prompt: 'hello', response: 'hi', checkpoint_id: 'cp1' },
            { id: 'sys', prompt: AGENT_SYSTEM_TURN_PROMPT, response: 'note', checkpoint_id: null },
            { id: 't2', prompt: 'again', response: 'ok', checkpoint_id: 'cp2' },
          ];
        },
      }),
    };
    const store = new AgentSessionStore(() => adminforth as any, optionsWithCheckpoint);

    expect(await store.getAgentTurns('s1')).toEqual([
      { id: 't1', prompt: 'hello', response: 'hi', checkpointId: 'cp1' },
      { id: 't2', prompt: 'again', response: 'ok', checkpointId: 'cp2' },
    ]);
  });

  it('getAgentTurns yields null checkpointId when the field is not configured', async () => {
    const store = buildStore(() => ({
      async list() {
        return [{ id: 't1', prompt: 'hello', response: 'hi', checkpoint_id: 'cp1' }];
      },
    }));

    expect(await store.getAgentTurns('s1')).toEqual([
      { id: 't1', prompt: 'hello', response: 'hi', checkpointId: null },
    ]);
  });

  it('editTurnAndTruncateAfter deletes later turns first, then rewrites the edited turn', async () => {
    const optionsWithCheckpoint = {
      ...OPTIONS,
      turnResource: { ...OPTIONS.turnResource, checkpointIdField: 'checkpoint_id' },
    } as any;
    const rows: any[] = [
      { id: 't1', prompt: 'p1', response: 'r1', checkpoint_id: 'cp1' },
      { id: 't2', prompt: 'p2', response: 'r2', checkpoint_id: 'cp2' },
      { id: 't3', prompt: 'p3', response: 'r3', checkpoint_id: 'cp3' },
    ];
    const calls: string[] = [];
    const adminforth = {
      resource: () => ({
        async list() {
          return [...rows];
        },
        async delete(id: string) {
          calls.push(`delete:${id}`);
          const idx = rows.findIndex((r) => r.id === id);
          if (idx !== -1) rows.splice(idx, 1);
        },
        async update(id: string, fields: any) {
          calls.push(`update:${id}`);
          Object.assign(rows.find((r) => r.id === id), fields);
        },
      }),
    };
    const store = new AgentSessionStore(() => adminforth as any, optionsWithCheckpoint);

    await store.editTurnAndTruncateAfter({ sessionId: 's1', turnId: 't2', newPrompt: 'edited' });

    // t3 (later) deleted before the edited turn is updated; t1 untouched.
    expect(calls).toEqual(['delete:t3', 'update:t2']);
    expect(rows.map((r) => r.id)).toEqual(['t1', 't2']);
    expect(rows.find((r) => r.id === 't2')).toMatchObject({
      prompt: 'edited',
      response: 'not_finished',
      checkpoint_id: null,
    });
  });

  it('editTurnAndTruncateAfter throws when the turn is not in the session', async () => {
    const store = buildStore(() => ({
      async list() {
        return [{ id: 't1', prompt: 'p1', response: 'r1' }];
      },
    }));

    await expect(
      store.editTurnAndTruncateAfter({ sessionId: 's1', turnId: 'missing', newPrompt: 'x' }),
    ).rejects.toThrow(/not found/);
  });

  it('saveTurnResponse persists checkpointId only when the field is configured and a value is provided', async () => {
    const optionsWithCheckpoint = {
      ...OPTIONS,
      turnResource: { ...OPTIONS.turnResource, checkpointIdField: 'checkpoint_id' },
    } as any;
    const updates: any[] = [];
    const adminforth = {
      resource: () => ({
        async update(id: string, fields: any) {
          updates.push({ id, fields });
        },
      }),
    };
    const store = new AgentSessionStore(() => adminforth as any, optionsWithCheckpoint);

    await store.saveTurnResponse({ turnId: 't1', responseText: 'done', checkpointId: 'cpX' });
    await store.saveTurnResponse({ turnId: 't2', responseText: 'partial' }); // undefined -> not written

    expect(updates[0].fields).toMatchObject({ response: 'done', checkpoint_id: 'cpX' });
    expect(updates[1].fields).toEqual({ response: 'partial' });
    expect(updates[1].fields).not.toHaveProperty('checkpoint_id');
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
