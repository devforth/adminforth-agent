import { jest } from '@jest/globals';
import { ChatSurfaceService } from '../transport/surfaces/chatSurfaceService.js';

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
  },
  chatExternalIdentityResource: {
    resourceId: 'external_identities',
    surfaces: {
      telegram: { provider: 'AdminForthAdapterTelegramOauth2' },
    },
  },
} as any;

const ADAPTER = { name: 'telegram' } as any;
const INCOMING = {
  surface: 'telegram',
  externalUserId: 'telegram-user-1',
  externalConversationId: 'telegram-chat-1',
  prompt: 'hello',
} as any;

function buildRequest() {
  return {
    body: {},
    query: {},
    headers: {},
    cookies: [],
    requestUrl: '/adminapi/v1/agent/surface/telegram/webhook',
    response: {
      setHeader: jest.fn(),
      setStatus: jest.fn(),
      blobStream: jest.fn(),
    },
  } as any;
}

function buildService(adminUserRecord: Record<string, unknown>, authorizationHooks: any[]) {
  const adminforth = {
    config: {
      auth: {
        usersResourceId: 'admin_users',
        usernameField: 'email',
        adminUserAuthorize: authorizationHooks,
      },
      resources: [{
        resourceId: 'admin_users',
        columns: [{ name: 'id', primaryKey: true }],
      }],
    },
    resource(resourceId: string) {
      if (resourceId === 'external_identities') {
        return {
          list: jest.fn().mockResolvedValue([{
            provider: 'AdminForthAdapterTelegramOauth2',
            externalUserId: 'telegram-user-1',
            adminUserId: 'user-1',
          }]),
        };
      }

      return {
        get: jest.fn().mockResolvedValue(adminUserRecord),
      };
    },
  };
  const sessionStore = {
    getOrCreateChatSurfaceSession: jest.fn().mockResolvedValue('session-1'),
  };
  const handleTurn = jest.fn().mockResolvedValue(undefined);
  const service = new ChatSurfaceService(
    () => adminforth as any,
    OPTIONS,
    sessionStore as any,
    handleTurn,
    jest.fn(),
  );

  return { service, sessionStore, handleTurn };
}

describe('adminforth-agent chat surface authorization', () => {
  it('blocks a deactivated user before creating an agent session', async () => {
    const authorizationHook = jest.fn(async ({ adminUser }) => ({
      allowed: adminUser.dbUser.is_active,
    }));
    const { service, sessionStore, handleTurn } = buildService(
      { id: 'user-1', email: 'user@example.com', is_active: false },
      [authorizationHook],
    );
    const sink = { emit: jest.fn(), close: jest.fn() };

    await service.handleMessage(ADAPTER, INCOMING, sink as any, buildRequest());

    expect(authorizationHook).toHaveBeenCalledWith(expect.objectContaining({
      adminUser: expect.objectContaining({ pk: 'user-1' }),
      extra: expect.objectContaining({
        meta: { chatSurface: 'telegram' },
      }),
    }));
    expect(sessionStore.getOrCreateChatSurfaceSession).not.toHaveBeenCalled();
    expect(handleTurn).not.toHaveBeenCalled();
    expect(sink.emit).toHaveBeenCalledWith({
      type: 'error',
      message: 'This chat account is not authorized to use AdminForth Agent.',
    });
  });

  it('continues to the agent when all authorization hooks allow the user', async () => {
    const authorizationHook = jest.fn().mockResolvedValue({ allowed: true });
    const { service, sessionStore, handleTurn } = buildService(
      { id: 'user-1', email: 'user@example.com', is_active: true },
      [authorizationHook],
    );
    const sink = { emit: jest.fn(), close: jest.fn() };

    await service.handleMessage(ADAPTER, INCOMING, sink as any, buildRequest());

    expect(sessionStore.getOrCreateChatSurfaceSession).toHaveBeenCalled();
    expect(handleTurn).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      chatSurface: 'telegram',
      adminUser: expect.objectContaining({ pk: 'user-1' }),
    }));
  });
});
